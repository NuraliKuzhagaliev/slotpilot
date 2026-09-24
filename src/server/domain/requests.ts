import { ActorSchema, BookingRequestSchema, CustomerConstraintsSchema, DateSchema, RequestPatchSchema, SearchResultSchema, RULES, TimeSchema,
  type Actor, type BookingRequest, type CustomerConstraints, type RequestPatch, type SearchResult } from '../../contracts/domain.ts';
import { DomainError } from './errors.ts';
export function emptyConstraints(): CustomerConstraints {
  return CustomerConstraintsSchema.parse({ serviceIds: [], vehicleId: null, allowedDates: null, arrivalNotBefore: null,
    arrivalNotAfter: null, readyNoLaterThan: null, maxBudgetKzt: null, allowedBranchIds: null, preferredBranchId: null, rankingPreference: 'earliest_ready' });
}
export function normalizeConstraints(value: unknown): CustomerConstraints {
  const result = CustomerConstraintsSchema.parse(value);
  result.arrivalNotAfter ??= null; // Accept stored requests created before arrival windows were added.
  result.serviceIds.sort(); result.allowedDates?.sort(); result.allowedBranchIds?.sort();
  if (result.arrivalNotBefore && result.arrivalNotAfter && TimeSchema.parse(result.arrivalNotBefore) > TimeSchema.parse(result.arrivalNotAfter))
    throw new DomainError('VALIDATION_ERROR', 'The latest arrival must be after the earliest arrival.');
  if (result.allowedBranchIds && result.preferredBranchId && !result.allowedBranchIds.includes(result.preferredBranchId))
    throw new DomainError('VALIDATION_ERROR', 'Preferred branch must be among allowed branches.');
  return result;
}
export function patchConstraints(current: CustomerConstraints, rawPatch: unknown): CustomerConstraints {
  const patch: RequestPatch = RequestPatchSchema.parse(rawPatch);
  const { addServiceIds, removeServiceIds, allowedDateRange, ...direct } = patch;
  if (allowedDateRange && patch.allowedDates !== undefined)
    throw new DomainError('VALIDATION_ERROR', 'Provide a date range or a list of dates, not both.');
  if (allowedDateRange) {
    const from = DateSchema.parse(allowedDateRange.from), to = DateSchema.parse(allowedDateRange.to);
    const first = Date.parse(`${from}T00:00:00.000Z`), last = Date.parse(`${to}T00:00:00.000Z`);
    const count = Math.floor((last - first) / 86_400_000) + 1;
    if (count < 1) throw new DomainError('VALIDATION_ERROR', 'The end date must be on or after the start date.');
    if (count > RULES.horizonDays) throw new DomainError('VALIDATION_ERROR', `A date range can include up to ${RULES.horizonDays} days.`);
    direct.allowedDates = Array.from({ length: count }, (_, index) => new Date(first + index * 86_400_000).toISOString().slice(0, 10));
  }
  if (patch.serviceIds !== undefined && (addServiceIds !== undefined || removeServiceIds !== undefined))
    throw new DomainError('VALIDATION_ERROR', 'Use replacement or add/remove services, not both.');
  if (addServiceIds?.some(id => removeServiceIds?.includes(id)))
    throw new DomainError('VALIDATION_ERROR', 'The same service cannot be both added and removed.');
  const next = { ...normalizeConstraints(current), ...direct };
  if (addServiceIds !== undefined || removeServiceIds !== undefined) {
    next.serviceIds = [...new Set([...next.serviceIds, ...(addServiceIds ?? [])])]
      .filter(id => !removeServiceIds?.includes(id));
  }
  return normalizeConstraints(next);
}
export function missingFields(constraints: CustomerConstraints): string[] {
  const missing: string[] = [];
  if (!constraints.serviceIds.length) missing.push('serviceIds');
  if (!constraints.vehicleId) missing.push('vehicleId');
  if (!constraints.allowedDates?.length) missing.push('allowedDates');
  return missing;
}
export function createDraft(requestId: string, ownerId: string, namespace: string): BookingRequest {
  return BookingRequestSchema.parse({ requestId, ownerId, namespace, requestVersion: 1, stateRevision: 0,
    constraints: emptyConstraints(), stage: 'collecting', options: [], preparedAction: null, bookingId: null });
}
/** Actor must be supplied by a trusted server session, never by tool arguments. */
export function requireOwner(request: BookingRequest, rawActor: Actor): void {
  const actor = ActorSchema.parse(rawActor);
  if (request.ownerId !== actor.userId) throw new DomainError('NOT_AUTHORIZED', 'This request does not belong to the current user.');
}
export function requireVersion(request: BookingRequest, expectedVersion: number): void {
  if (request.requestVersion !== expectedVersion) throw new DomainError('STALE_REQUEST', 'Read the current request before retrying.');
}
export function requireEditable(request: BookingRequest): void {
  if (request.bookingId || request.stage === 'booked') throw new DomainError('REQUEST_CLOSED', 'Use an explicit change flow for a saved booking.');
  if (request.stage === 'executing' || request.stage === 'reconciling')
    throw new DomainError('OPERATION_PENDING', 'Reconcile the operation before changing this request.');
}
/** Pure transition, not persistence or a transaction. Caller must serialize DB mutations. */
export function updateRequest(input: BookingRequest, actor: Actor, rawPatch: unknown, expectedVersion: number): BookingRequest {
  const request = BookingRequestSchema.parse(input);
  requireOwner(request, actor); requireVersion(request, expectedVersion); requireEditable(request);
  const normalized = normalizeConstraints(request.constraints);
  const next = patchConstraints(normalized, rawPatch);
  if (JSON.stringify(normalized) === JSON.stringify(next)) return request;
  return BookingRequestSchema.parse({ ...request, constraints: next, requestVersion: request.requestVersion + 1,
    stateRevision: request.stateRevision + 1, stage: 'collecting', options: [], preparedAction: null });
}
/** A late read never overwrites a newer version OR a newer same-version operation. */
export function acceptSearchResult(input: BookingRequest, rawResult: SearchResult): { applied: boolean; state: BookingRequest } {
  const state = BookingRequestSchema.parse(input); const result = SearchResultSchema.parse(rawResult);
  if (state.requestId !== result.requestId || state.requestVersion !== result.requestVersion
    || state.stateRevision !== result.sourceStateRevision || state.bookingId
    || ['executing', 'booked', 'reconciling'].includes(state.stage)) return { applied: false, state };
  if (result.options.some(option => option.requestId !== state.requestId || option.requestVersion !== state.requestVersion
    || option.calendarRevision !== result.calendarRevision)) throw new DomainError('VALIDATION_ERROR', 'Inconsistent search result.');
  return { applied: true, state: BookingRequestSchema.parse({ ...state, options: result.options, preparedAction: null,
    stage: result.options.length ? 'offered' : 'collecting', stateRevision: state.stateRevision + 1 }) };
}
