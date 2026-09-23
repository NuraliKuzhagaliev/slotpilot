import { BrowserAudio } from './audio.mjs';
import { ToolResultQueue } from './tool-queue.mjs';
export async function api(path, body, signal) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message ?? 'The server request failed.');
    error.code = data.error?.code ?? 'REQUEST_FAILED'; throw error;
  }
  return data;
}
export function transcriptEntry(event) {
  if (!['transcript.user', 'transcript.user.delta', 'transcript.agent'].includes(event.type)) return null;
  if (typeof event.text !== 'string') return null;
  const speaker = event.type.startsWith('transcript.user') ? 'user' : 'agent';
  return { id: `${speaker}:${event.item_id ?? event.reply_id ?? 'current'}`, speaker,
    text: event.text.slice(0, 12000), final: event.type !== 'transcript.user.delta', interrupted: event.interrupted === true };
}
function safeProviderCode(code) {
  return typeof code === 'string' && /^[A-Za-z_]{1,48}$/.test(code) ? code : 'PROVIDER_ERROR';
}
// Send the end frame synchronously (also from pagehide), wait for the
// provider acknowledgment, and close with a bounded fallback on a broken link.
export function endVoiceSocket(socket, graceMs = 1500) {
  if (!socket) return;
  if (socket.readyState === 0) { socket.close(); return; }
  if (socket.readyState !== 1) return;
  let timer;
  let finished = false;
  function cleanup() {
    clearTimeout(timer);
    socket.removeEventListener('message', onMessage);
    socket.removeEventListener('close', onClose);
  }
  function finish() {
    if (finished) return;
    finished = true; cleanup();
    if (socket.readyState < 2) socket.close();
  }
  function onMessage(event) {
    try { if (JSON.parse(event.data)?.type === 'session.ended') finish(); }
    catch { /* Non-JSON frames are handled by the active controller. */ }
  }
  function onClose() { finished = true; cleanup(); }
  socket.addEventListener('message', onMessage);
  socket.addEventListener('close', onClose);
  timer = setTimeout(finish, graceMs);
  try { socket.send(JSON.stringify({ type: 'session.end' })); }
  catch { finish(); }
}
export class VoiceController {
  constructor(callbacks = {}) { this.callbacks = callbacks; this.generation = 0; this.active = false; this.ready = false; }
  emit(name, value) { this.callbacks[name]?.(value); }
  log(event) { this.emit('event', { type: event, at: new Date().toISOString() }); }
  state(value) { this.emit('state', value); }
  async start() {
    if (this.active) return;
    this.active = true; this.ready = false;
    const generation = ++this.generation;
    this.abort = new AbortController();
    this.state('microphone');
    this.audio = new BrowserAudio(buffer => {
      if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return;
      if (this.socket.bufferedAmount > 24000 * 2) { this.fail('CONNECTION_SLOW', 'The connection is falling behind. The conversation was stopped instead of replaying stale audio.'); return; }
      const bytes = new Uint8Array(buffer); let raw = '';
      for (const byte of bytes) raw += String.fromCharCode(byte);
      this.send({ type: 'input.audio', audio: btoa(raw) });
    }, event => {
      if (event === 'overflow' || event === 'invalid-audio') this.fail('AUDIO_ERROR', 'Audio playback could not keep up. Start a new test after checking the device.');
    });
    try {
      const rates = await this.audio.open();
      if (generation !== this.generation) return;
      this.emit('microphone', rates); this.log('microphone.ready'); this.state('connecting');
      const tokenData = await api('/api/voice/token', { consent: true }, this.abort.signal);
      if (generation !== this.generation) return;
      const url = new URL(tokenData.websocketUrl);
      if (url.origin !== 'wss://agents.assemblyai.com' || url.pathname !== '/v1/ws') throw new Error('Unexpected voice endpoint.');
      url.searchParams.set('token', tokenData.token);
      const socket = new WebSocket(url); this.socket = socket;
      this.queue = new ToolResultQueue(async event => {
        try { return await api('/api/tools', { callId: event.call_id, name: event.name, arguments: event.arguments }, this.abort.signal); }
        catch (error) { return { ok: false, error: { code: error.code ?? 'TOOL_TRANSPORT_ERROR', message: error.code ? error.message : 'The server could not be reached. Do not invent results.' } }; }
      }, result => this.send(result), event => this.log(event), (callId, result) => this.emit('toolResult', { callId, result }));
      this.connectTimer = setTimeout(() => this.fail('CONNECT_TIMEOUT', 'AssemblyAI did not become ready. Check Voice Agent API access, credits and network connectivity.'), 20000);
      socket.addEventListener('open', () => {
        if (generation !== this.generation) { socket.close(); return; }
        this.send({ type: 'session.update', session: tokenData.session });
      });
      socket.addEventListener('message', ({ data }) => {
        if (generation !== this.generation) return;
        try {
          const event = JSON.parse(data);
          if (!event || typeof event.type !== 'string') return;
          this.queue.event(event);
          if (event.type === 'session.ready') {
            if (this.ready) return;
            clearTimeout(this.connectTimer); this.ready = true; this.state('listening');
            this.emit('connected', { maxSessionSeconds: tokenData.maxSessionSeconds }); this.log('session.ready');
            this.durationTimer = setTimeout(() => this.stop('Session duration limit reached.'), tokenData.maxSessionSeconds * 1000);
          } else if (event.type === 'input.speech.started') {
            this.audio.clear(); this.state('listening'); this.log('input.speech.started');
          } else if (event.type === 'reply.started') this.state('responding');
          else if (event.type === 'reply.audio') { this.audio.play(event.data); this.emit('audioReceived', true); }
          else if (event.type === 'reply.done') {
            if (event.status === 'interrupted') { this.audio.clear(); this.emit('interrupted', true); this.log('playback.cleared'); }
            this.state('listening'); this.log(`reply.${event.status === 'interrupted' ? 'interrupted' : 'completed'}`);
          } else if (event.type === 'tool.call') this.log('tool.call');
          else if (event.type === 'session.ended') { this.log('session.ended'); void this.stop('Session ended.'); }
          else if (event.type === 'session.error' || event.type === 'error') {
            this.fail(safeProviderCode(event.code), 'AssemblyAI reported an error. Check Voice Agent access, credits and the documented error code.');
          }
          const entry = transcriptEntry(event);
          if (entry) this.emit('transcript', entry);
        } catch { this.fail('INVALID_PROVIDER_MESSAGE', 'A voice protocol or audio message could not be processed. The session was stopped.'); }
      });
      socket.addEventListener('error', () => {
        if (generation === this.generation) this.fail('WEBSOCKET_ERROR', 'Could not connect to AssemblyAI. No mock provider was substituted.');
      });
      socket.addEventListener('close', () => {
        if (generation === this.generation) this.fail('CONNECTION_CLOSED', 'The voice connection closed. No automatic reconnect was attempted. No booking can be created in this stage.');
      });
    } catch (error) {
      if (generation !== this.generation) return;
      const denied = ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
      this.fail(error.code ?? (denied ? 'MIC_PERMISSION_DENIED' : 'START_FAILED'), denied ? 'Allow microphone access in your browser, then start again.' : error.message === 'MIC_UNAVAILABLE' ? 'Use a supported browser on localhost with an available microphone.' : error.code ? error.message : 'The microphone or voice connection could not be started. Check permissions and device access.');
    }
  }
  send(event) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event)); }
  fail(code, message) { this.emit('error', { code, message }); void this.stop('', true); }
  async stop(message = 'Conversation stopped.', failed = false) {
    const stoppedGeneration = ++this.generation; this.active = false; this.ready = false;
    clearTimeout(this.connectTimer); clearTimeout(this.durationTimer);
    this.abort?.abort(); this.queue?.close();
    const socket = this.socket; this.socket = null;
    endVoiceSocket(socket);
    const audio = this.audio; this.audio = null;
    await audio?.close();
    if (stoppedGeneration !== this.generation) return;
    this.state(failed ? 'error' : 'idle');
    if (message) this.emit('notice', message);
  }
}
