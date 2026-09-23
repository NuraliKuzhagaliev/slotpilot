/** Provider-specific adapter. No booking logic belongs here.
 * Results wait for reply.done; an interrupted turn invalidates pending/in-flight results.
 * A new speech turn also invalidates READ-ONLY catalogue results. Do not reuse this
 * cancellation policy for future writes: persisted actions must be reconciled by actionId.
 */
export class ToolResultQueue {
  constructor(execute, send, log = () => {}, accepted = () => {}) {
    this.execute = execute; this.send = send; this.log = log; this.accepted = accepted;
    this.epoch = 0; this.phase = 'busy'; this.pending = []; this.seen = new Set(); this.closed = false;
  }
  event(event) {
    if (this.closed) return;
    if (event.type === 'input.speech.started') { this.invalidate('new-user-turn'); this.phase = 'busy'; }
    else if (event.type === 'reply.started') this.phase = 'busy';
    else if (event.type === 'reply.done') {
      if (event.status === 'interrupted') { this.invalidate('interrupted'); this.phase = 'busy'; }
      else if (event.status === 'completed') { this.phase = 'idle'; this.flush(); }
    } else if (event.type === 'tool.call') this.call(event);
  }
  call(event) {
    if (typeof event.call_id !== 'string' || this.seen.has(event.call_id)) return;
    this.seen.add(event.call_id);
    const epoch = this.epoch;
    Promise.resolve().then(() => this.execute(event)).then(result => this.complete(event.call_id, result, epoch))
      .catch(() => this.complete(event.call_id, { ok: false, error: { code: 'TOOL_TRANSPORT_ERROR', message: 'The SlotPilot server could not be reached. Do not invent results or report a booking.' } }, epoch));
  }
  complete(callId, result, epoch) {
    if (this.closed || epoch !== this.epoch) { this.log('tool.result.discarded'); return; }
    this.accepted(callId, result);
    this.pending.push({ type: 'tool.result', call_id: callId, result: JSON.stringify(result), is_error: result.ok === false });
    this.flush();
  }
  flush() {
    if (this.closed || this.phase !== 'idle') return;
    const ready = this.pending.splice(0);
    for (const result of ready) { this.send(result); this.log('tool.result.sent'); }
  }
  invalidate(reason) { this.epoch++; this.pending = []; this.log(`tool.queue.${reason}`); }
  close() { this.closed = true; this.invalidate('closed'); this.seen.clear(); }
}
