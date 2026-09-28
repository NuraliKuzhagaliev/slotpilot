import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ToolResults } from '../src/features/voice/tool-results.mjs';

test('incident replay: all three real resp_ replies release their tool errors immediately after HTTP completion', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/voice-result-stall.json', import.meta.url)));
  const sent = [], expected = [];
  let now = 0;
  const gate = new ToolResults(frame => sent.push({ callId: frame.call_id, ms: now }));
  for (const event of fixture.events) {
    now = event.ms;
    if (event.type === 'reply.started') gate.started(event.replyId);
    if (event.type === 'tool.call') gate.register(event.callId);
    if (event.type === 'reply.done.completed') gate.done(event.replyId, 'completed');
    if (event.type === 'tool.result.queued') {
      expected.push({ callId: event.callId, ms: now });
      gate.push(event.callId, { type: 'tool.result', call_id: event.callId, is_error: true, result: JSON.stringify({ ok: false, error: { code: 'VALIDATION_ERROR' } }) });
    }
  }
  assert.equal(expected.length, 3);
  assert.deepEqual(sent, expected, 'the incident lost every result by assuming reply_id = fc-call_id');
  assert.equal(gate.pending.length, 0);
});
