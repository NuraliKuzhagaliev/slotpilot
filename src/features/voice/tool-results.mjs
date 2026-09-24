// A tool result can be sent only after the reply belonging to that call finishes.
// A previous reply.done is not permission to answer a later tool.call.
export class ToolResults {
  constructor(send) { this.send = send; this.clear(); }
  clear() { this.pending = []; this.completed = new Set(); this.cancelled = new Set(); this.windowOpen = false; }
  started() { this.windowOpen = false; }
  cancel(replyId) {
    if (typeof replyId !== 'string' || !replyId.startsWith('fc-')) return;
    const callId = replyId.slice(3);
    this.cancelled.add(callId); this.completed.delete(callId);
    this.pending = this.pending.filter(p => p.callId !== callId);
  }
  done(replyId, status) {
    this.windowOpen = true;
    if (typeof replyId === 'string' && replyId.startsWith('fc-')) {
      const callId = replyId.slice(3);
      if (status === 'completed' && !this.cancelled.has(callId)) this.completed.add(callId);
      else this.cancel(replyId);
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
