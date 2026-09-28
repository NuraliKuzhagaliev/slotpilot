// Reply IDs are opaque. Production uses resp_ IDs, independently of call_id.
// Bind calls to the reply in which they arrive, never to an invented ID prefix.
export class ToolResults {
  constructor(send) { this.send = send; this.clear(); }
  clear() {
    this.pending = [];
    this.calls = new Map();
    this.replies = new Map();
    this.idle = false;
    this.activeReply = null;
    this.latestReply = null;
  }
  started(replyId) {
    this.idle = false;
    if (replyId) this.activeReply = this.latestReply = replyId;
    else this.latestReply = null;
  }
  register(callId, replyId = this.activeReply ?? this.latestReply) {
    if (!this.calls.has(callId)) this.calls.set(callId, { replyId, status: this.replies.get(replyId) ?? 'running' });
  }
  hasReply(replyId) { return [...this.calls.values()].some(call => call.replyId === replyId); }
  cancel(replyId) {
    this.replies.set(replyId, 'interrupted');
    for (const call of this.calls.values()) if (call.replyId === replyId) call.status = 'interrupted';
    this.pending = this.pending.filter(p => this.calls.get(p.callId)?.status !== 'interrupted');
  }
  done(replyId, status = 'completed') {
    const target = replyId ?? this.activeReply ?? this.latestReply;
    const current = !this.activeReply || !target || this.activeReply === target;
    if (target) this.replies.set(target, status);
    for (const call of this.calls.values()) {
      if (call.status === 'running' && (!call.replyId || call.replyId === target)) call.status = status;
    }
    if (status === 'interrupted') this.cancel(target);
    if (current) {
      this.activeReply = null;
      this.latestReply = target;
      this.idle = status === 'completed';
    }
    this.flush();
  }
  push(callId, frame) {
    if (!this.calls.has(callId)) this.register(callId);
    const call = this.calls.get(callId);
    if (call.status === 'interrupted' || call.sent) return;
    if (!this.pending.some(p => p.callId === callId)) this.pending.push({ callId, frame });
    this.flush();
  }
  flush() {
    if (!this.idle) return;
    this.pending = this.pending.filter(p => {
      const call = this.calls.get(p.callId);
      if (call.status === 'interrupted') return false;
      if (call.status !== 'completed') return true;
      call.sent = true;
      this.send(p.frame);
      return false;
    });
  }
}
