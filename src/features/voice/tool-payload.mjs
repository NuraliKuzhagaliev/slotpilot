// The UI needs the entire snapshot. The model needs the operation result and
// current version, not duplicated search results, event history and UI state.
export function voiceToolPayload(result) {
  const { ok, data, error, request, comparison, bookings } = result;
  return {
    ok, data, error, comparison,
    // Keep the IDs, versions and visit details needed to discuss an existing
    // booking or prepare a cancellation/reschedule without guessing an ID.
    bookings: bookings?.map(({ bookingId, bookingVersion, status, snapshot }) => ({
      bookingId, bookingVersion, status, snapshot,
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
