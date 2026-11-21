const workshopTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Model-facing facts use workshop time. The UI and database keep UTC instants.
export function voiceLocalTimes(value) {
  if (Array.isArray(value)) return value.map(voiceLocalTimes);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, field] of Object.entries(value)) {
    if ((key === 'startAt' || key === 'readyAt') && typeof field === 'string' && Number.isFinite(Date.parse(field))) {
      out[key === 'startAt' ? 'dropOffLocal' : 'readyLocal'] = workshopTime.format(new Date(field));
      out.timeZone = 'Asia/Almaty';
    } else out[key] = voiceLocalTimes(field);
  }
  return out;
}

export function voiceToolPayload(result) {
  const { ok, data, error, request, comparison, bookings } = result;
  return {
    ok, data: voiceLocalTimes(data), error, comparison: voiceLocalTimes(comparison),
    // Keep the IDs, versions and visit details needed to discuss an existing
    // booking or prepare a cancellation/reschedule without guessing an ID.
    bookings: bookings?.map(({ bookingId, bookingVersion, status, snapshot }) => ({
      bookingId, bookingVersion, status, snapshot: voiceLocalTimes(snapshot),
    })),
    currentRequest: request ? {
      requestId: request.requestId,
      requestVersion: request.requestVersion,
      constraints: request.constraints,
      stage: request.stage,
      bookingId: request.bookingId,
    } : undefined,
  };
}
