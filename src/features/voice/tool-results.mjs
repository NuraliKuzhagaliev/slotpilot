// A tool result can be sent only after the reply belonging to that call finishes.
// A previous reply.done is not permission to answer a later tool.call.
export class ToolResults {
  constructor(send) { this.send = send; this.clear(); }
  clear() { this.pending = []; this.completed = new Set(); this.windowOpen = false; }
  started() { this.windowOpen = false; }
  done(replyId, status) {
    this.windowOpen = true;
    if (typeof replyId === 'string' && replyId.startsWith('fc-')) {
      const callId = replyId.slice(3);
      if (status === 'completed') this.completed.add(callId);
      else this.pending = this.pending.filter(p => p.callId !== callId);
    }
    this.flush();
  }
  push(callId, frame) { this.pending.push({ callId, frame }); this.flush(); }
  flush() {
    if (!this.windowOpen) return;
    this.pending = this.pending.filter(p => {
      if (!this.completed.has(p.callId)) return true;
      this.completed.delete(p.callId); this.send(p.frame); return false;
    });
  }
}
