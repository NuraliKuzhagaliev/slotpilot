import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolResultQueue } from '../spikes/voice-access/public/tool-queue.mjs';
import { LinearResampler, floatToPcm16, pcm16ToFloat, PlaybackRing } from '../spikes/voice-access/public/pcm.mjs';
import { fadeOut } from '../public/audio/pcm.mjs';
import { ToolResults } from '../src/features/voice/tool-results.mjs';
import { transcriptEntry, endVoiceSocket } from '../spikes/voice-access/public/controller.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const call = { type: 'tool.call', call_id: 'call_1', name: 'get_services', arguments: {} };
const done = { type: 'reply.done', reply_id: 'fc-call_1', status: 'completed' };
const result = { ok: true, data: { value: 37 } };
test('production tool results wait for their own completed reply, not an earlier reply.done',()=>{
  const sent=[];const gate=new ToolResults(frame=>sent.push(frame));
  gate.done('reply-before-call','completed');gate.started();gate.push('call_1',{call_id:'call_1'});
  assert.equal(sent.length,0);
  gate.done('reply-other','completed');assert.equal(sent.length,0);
  gate.done('fc-call_1','completed');assert.deepEqual(sent,[{call_id:'call_1'}]);
});
test('a slow production tool result is sent after its own reply.done and interrupted results are dropped',()=>{
  const sent=[];const gate=new ToolResults(frame=>sent.push(frame));
  gate.started();gate.done('fc-slow','completed');gate.push('slow',{call_id:'slow'});
  assert.equal(sent.length,1);
  gate.started();gate.push('cancelled',{call_id:'cancelled'});gate.done('fc-cancelled','interrupted');
  assert.equal(sent.length,1);gate.clear();gate.push('stale',{call_id:'stale'});assert.equal(sent.length,1);
});
test('production playback buffers bursts, plays short final chunks and fades from the last heard sample',async()=>{
  globalThis.sampleRate=48000;
  globalThis.AudioWorkletProcessor=class {constructor(){this.port={postMessage:()=>{}}}};
  let Processor;globalThis.registerProcessor=(_name,ctor)=>{Processor=ctor};
  await import('../public/audio/playback.worklet.mjs');
  const node=new Processor();const out=()=>{const output=new Float32Array(128);node.process([],[ [output] ]);return output};
  const pcm=new Int16Array(2400).fill(24000);
  node.port.onmessage({data:pcm.buffer});
  let output;for(let i=0;i<20;i++)output=out();
  assert.ok(output.some(v=>v>0));
  node.port.onmessage({data:'clear'});const tail=out();
  assert.ok(tail[0]>0&&tail[0]<0.75);assert.ok(tail.at(-1)<tail[0]);
  node.port.onmessage({data:new Int16Array(480).fill(12000).buffer});
  node.port.onmessage({data:'end'});
  let heard=false;for(let i=0;i<20;i++)if(out().some(v=>v>.1))heard=true;
  assert.ok(heard,'a 20 ms final packet must play even below prebuffer length');
  delete globalThis.registerProcessor;delete globalThis.AudioWorkletProcessor;delete globalThis.sampleRate;
});
test('production playback interruption fades the queued tail to silence without changing sample type',()=>{
  const source=new Float32Array([.4,.4,.4,.4]),faded=fadeOut(source);
  assert.ok(Math.abs(source[0]-.4)<1e-6);assert.equal(faded.length,source.length);assert.ok(faded[0]>.3);assert.ok(faded[0]>faded[1]);assert.ok(faded[1]>faded[2]);assert.ok(Math.abs(faded.at(-1))<1e-6);
});
test('tool.result waits until reply.done even when the backend responds immediately', async () => {
  const sent = []; const queue = new ToolResultQueue(async () => result, data => sent.push(data));
  queue.event(call); await tick(); assert.equal(sent.length, 0);
  queue.event(done); assert.equal(sent.length, 1); assert.equal(sent[0].call_id, 'call_1');
  assert.equal(typeof sent[0].result, 'string'); assert.deepEqual(JSON.parse(sent[0].result), result);
});
test('a backend response after reply.done is sent without requiring a second done event', async () => {
  let resolve; const sent = []; const queue = new ToolResultQueue(() => new Promise(r => { resolve = r; }), data => sent.push(data));
  queue.event(call); await tick(); queue.event(done); resolve(result); await tick(); assert.equal(sent.length, 1);
});
test('interruption drops queued results', async () => {
  const sent = []; const queue = new ToolResultQueue(async () => result, data => sent.push(data));
  queue.event(call); await tick(); queue.event({ ...done, status: 'interrupted' }); queue.event(done);
  assert.equal(sent.length, 0);
});
test('interruption drops an in-flight result and does not update the screen', async () => {
  let resolve; const sent = [], accepted = [];
  const queue = new ToolResultQueue(() => new Promise(r => { resolve = r; }), d => sent.push(d), () => {}, (id, d) => accepted.push(d));
  queue.event(call); await tick(); queue.event({ ...done, status: 'interrupted' }); resolve(result); await tick(); queue.event(done);
  assert.equal(sent.length, 0); assert.equal(accepted.length, 0);
});
test('a new user turn invalidates read-only catalogue results', async () => {
  const sent = []; const queue = new ToolResultQueue(async () => result, data => sent.push(data));
  queue.event(call); await tick(); queue.event({ type: 'input.speech.started' }); queue.event(done); assert.equal(sent.length, 0);
});
test('reply.started closes the idle sending window', async () => {
  const sent = []; const queue = new ToolResultQueue(async () => result, data => sent.push(data));
  queue.event(done); queue.event({ type: 'reply.started' }); queue.event(call); await tick(); assert.equal(sent.length, 0);
  queue.event(done); assert.equal(sent.length, 1);
});
test('duplicate tool.call is executed only once in a connection', async () => {
  let count = 0; const sent = [];
  const queue = new ToolResultQueue(async () => { count++; return result; }, data => sent.push(data));
  queue.event(call); queue.event(call); queue.event(done); await tick(); assert.equal(count, 1); assert.equal(sent.length, 1);
});
test('tool failure is an is_error result, not invented business success', async () => {
  const sent = []; const queue = new ToolResultQueue(async () => { throw new Error('private-error'); }, data => sent.push(data));
  queue.event(call); queue.event(done); await tick();
  assert.equal(sent[0].is_error, true); assert.equal(JSON.parse(sent[0].result).ok, false); assert.equal(sent[0].result.includes('private-error'), false);
});
test('closing the controller makes late tool results inert', async () => {
  let resolve; const sent = []; const queue = new ToolResultQueue(() => new Promise(r => { resolve = r; }), data => sent.push(data));
  queue.event(call); await tick(); queue.close(); resolve(result); await tick(); queue.event(done); assert.equal(sent.length, 0);
});
test('partial user text replaces the same item instead of being concatenated', () => {
  const first = transcriptEntry({ type: 'transcript.user.delta', item_id: 'a', text: 'Oil' });
  const second = transcriptEntry({ type: 'transcript.user.delta', item_id: 'a', text: 'Oil change' });
  assert.equal(first.id, second.id); assert.equal(second.text, 'Oil change'); assert.equal(second.final, false);
});
test('only a final user transcript is final, and trimmed agent text keeps its interruption flag', () => {
  assert.equal(transcriptEntry({ type: 'transcript.user', item_id: 'a', text: 'Yes, but add diagnostics.' }).final, true);
  assert.equal(transcriptEntry({ type: 'transcript.agent', item_id: 'b', text: 'We offer', interrupted: true }).interrupted, true);
  assert.equal(transcriptEntry({ type: 'session.ready' }), null);
});
test('PCM conversion clamps values and writes little-endian PCM16', () => {
  const buffer = floatToPcm16(Float32Array.from([-2, -1, 0, 1, 2, NaN]));
  const view = new DataView(buffer);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => view.getInt16(i * 2, true)), [-32768, -32768, 0, 32767, 32767, 0]);
  assert.equal(pcm16ToFloat(buffer)[0], -1);
  assert.throws(() => pcm16ToFloat(new ArrayBuffer(3)));
});
test('48 kHz capture is resampled to 24 kHz across audio chunks', () => {
  const resampler = new LinearResampler(48000, 24000); let length = 0;
  for (let n = 0; n < 375; n++) length += resampler.process(new Float32Array(128)).length;
  assert.equal(length, 24000);
});
test('44.1 kHz chunk boundaries retain the fractional resampling position', () => {
  const input = Float32Array.from({ length: 44100 }, (_, i) => Math.sin(i / 100));
  const whole = new LinearResampler(44100, 24000).process(input);
  const chunked = new LinearResampler(44100, 24000), parts = [];
  for (let n = 0; n < input.length; n += 128) parts.push(...chunked.process(input.subarray(n, n + 128)));
  assert.ok(Math.abs(parts.length - 24000) <= 1); assert.ok(Math.abs(parts.length - whole.length) <= 1);
  for (let i = 0; i < Math.min(parts.length, whole.length); i++) assert.ok(Math.abs(parts[i] - whole[i]) < 0.00001);
});
test('playback resampling produces 48 kHz frames from 24 kHz speech', () => {
  assert.equal(new LinearResampler(24000, 48000).process(new Float32Array(480)).length, 960);
});
test('playback clear silences all queued audio rather than just resetting a timestamp', () => {
  const ring = new PlaybackRing(20), out = new Float32Array(5);
  ring.push(Float32Array.from([1, 1, 1, 1, 1])); ring.clear(); ring.pull(out);
  assert.deepEqual([...out], [0, 0, 0, 0, 0]); assert.equal(ring.available, 0);
});
test('playback underflow is silence and overflow is bounded', () => {
  const ring = new PlaybackRing(3), out = new Float32Array(4);
  assert.equal(ring.push(Float32Array.from([.5, 1])), true); ring.pull(out); assert.deepEqual([...out], [.5, 1, 0, 0]);
  assert.equal(ring.push(new Float32Array(5)), false); assert.equal(ring.available, 0);
});

class EndSocketFixture extends EventTarget {
  constructor(state = 1) { super(); this.readyState = state; this.sent = []; this.closeCount = 0; }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.closeCount++; this.readyState = 3; this.dispatchEvent(new Event('close')); }
  receive(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
}
test('Stop sends session.end synchronously and waits for session.ended before closing', () => {
  const socket = new EndSocketFixture(); endVoiceSocket(socket);
  assert.deepEqual(socket.sent, [{ type: 'session.end' }]); assert.equal(socket.closeCount, 0);
  socket.receive({ type: 'transcript.agent', text: 'Goodbye' }); assert.equal(socket.closeCount, 0);
  socket.receive({ type: 'session.ended' }); assert.equal(socket.closeCount, 1);
});
test('Stop closes after a bounded timeout when no end acknowledgment arrives', async () => {
  const socket = new EndSocketFixture(); endVoiceSocket(socket, 5);
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(socket.closeCount, 1);
});
test('Stop during connection closes without sending a frame to an unopened socket', () => {
  const socket = new EndSocketFixture(0); endVoiceSocket(socket);
  assert.equal(socket.sent.length, 0); assert.equal(socket.closeCount, 1);
});
