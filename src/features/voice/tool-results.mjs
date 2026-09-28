// AssemblyAI accepts results in the idle window following reply.done. Keep a
// completed call's result across new speech, but do not send during that speech.
export class ToolResults {
  constructor(send) { this.send = send; this.clear(); }
  clear() { this.pending = []; this.completed = new Set(); this.cancelled = new Set(); this.observed = new Set(); this.idle = false; this.activeReply = null; }
  started(replyId) { this.idle = false; this.activeReply = replyId ?? null; }
  register(callId) { this.observed.add(callId); }
  cancel(replyId) {
    if (typeof replyId !== 'string' || !replyId.startsWith('fc-')) return;
    const callId = replyId.slice(3);
    this.cancelled.add(callId); this.completed.delete(callId);
    this.observed.delete(callId); this.pending = this.pending.filter(p => p.callId !== callId);
  }
  done(replyId, status) {
    const current = !this.activeReply || !replyId || this.activeReply === replyId;
    if (typeof replyId === 'string' && replyId.startsWith('fc-')) {
      const callId = replyId.slice(3);
      if (status !== 'interrupted' && !this.cancelled.has(callId)) this.completed.add(callId);
      else this.cancel(replyId);
      this.observed.delete(callId);
    } else if (!replyId) {
      // The documented reply.done payload may omit reply_id. Grant only calls
      // observed before this event, never a call arriving after an older done.
      for (const callId of this.observed) {
        if (status === 'interrupted') this.cancel(`fc-${callId}`);
        else if (!this.cancelled.has(callId)) this.completed.add(callId);
      }
      this.observed.clear();
    }
    if (current) { this.activeReply = null; this.idle = status !== 'interrupted'; }
    this.flush();
  }
  push(callId, frame) { if (this.cancelled.has(callId)) return; this.pending.push({ callId, frame }); this.flush(); }
  flush() {
    if (!this.idle) return;
    this.pending = this.pending.filter(p => {
      if (!this.completed.has(p.callId)) return true;
      this.completed.delete(p.callId); this.send(p.frame); return false;
    });
  }
}
