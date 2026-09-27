// A tool result can be sent only after the reply belonging to that call finishes.
// A previous reply.done is not permission to answer a later tool.call.
export class ToolResults {
  constructor(send) { this.send = send; this.clear(); }
  clear() { this.pending = []; this.completed = new Set(); this.cancelled = new Set(); this.observed = new Set(); this.windowOpen = false; }
  started() { this.windowOpen = false; this.observed.clear(); }
  register(callId) { this.observed.add(callId); }
  cancel(replyId) {
    if (typeof replyId !== 'string' || !replyId.startsWith('fc-')) return;
    const callId = replyId.slice(3);
    this.cancelled.add(callId); this.completed.delete(callId);
    this.observed.delete(callId); this.pending = this.pending.filter(p => p.callId !== callId);
  }
  done(replyId, status) {
    this.windowOpen = true;
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
    this.flush();
  }
  push(callId, frame) { if (this.cancelled.has(callId)) return; this.pending.push({ callId, frame }); this.flush(); }
  flush() {
    if (!this.windowOpen) return;
    this.pending = this.pending.filter(p => {
      if (!this.completed.has(p.callId)) return true;
      this.completed.delete(p.callId); this.send(p.frame); return false;
    });
  }
}
