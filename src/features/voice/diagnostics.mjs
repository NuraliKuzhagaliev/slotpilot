// Allowlisted metadata only: no audio, transcripts, arguments, URLs or tokens.
export function diagnosticEvent(type, detail = {}, now = new Date()) {
  const event = { type, at: now.toISOString() };
  for (const key of ['name', 'callId', 'replyId', 'sessionId', 'code']) {
    const value = detail[key];
    if (typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value)) event[key] = value;
    else if (key === 'code' && Number.isInteger(value)) event[key] = value;
  }
  for (const key of ['durationMs', 'status']) {
    if (Number.isFinite(detail[key]) && detail[key] >= 0) event[key] = Math.round(detail[key]);
  }
  return event;
}
export function diagnosticExport(events) {
  return { schemaVersion: 1, clientVersion: 'voice-queue-v2', exportedAt: new Date().toISOString(), events: events.slice(-400).map(e => diagnosticEvent(e.type, e, new Date(e.at))) };
}
