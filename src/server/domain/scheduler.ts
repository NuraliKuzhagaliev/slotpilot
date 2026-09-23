import { BookingRequestSchema, SearchResultSchema, VisitPreviewSchema, PreviousOptionComparisonSchema, RULES,
  type BookingRequest, type CustomerConstraints, type Dataset, type Branch, type Technician, type Bay,
  type Service, type SlotOption, type SearchResult, type Reason, type Relaxation, type RequestPatch,
  type PreviousOptionComparison, type Actor } from '../../contracts/domain.ts';
import { localParts, horizonDates, localToIso, addMinutes, minutes, timeOfDay, overlaps } from './time.ts';
import { missingFields, normalizeConstraints, patchConstraints, requireOwner, requireVersion, requireEditable } from './requests.ts';
import { validateDataset } from './dataset.ts';
import { DomainError } from './errors.ts';
export type Quote = { services: Service[]; totalDurationMinutes: number; totalPriceKzt: number };
type Candidate = { branch: Branch; technician: Technician; bay: Bay; date: string; startAt: string; readyAt: string; quote: Quote };
const reason = (code: Reason['code'], message: string): Reason => ({ code, message });
function dedupeReasons(reasons: Reason[]): Reason[] {
  return [...new Map(reasons.map(item => [item.code, item])).values()].sort((a, b) => compare(a.code, b.code));
}
function compare(a: string | number, b: string | number): number { return a < b ? -1 : a > b ? 1 : 0; }
export function quoteVisit(constraints: CustomerConstraints, data: Dataset): Quote {
  if (!constraints.vehicleId || !constraints.serviceIds.length) throw new DomainError('MISSING_FIELDS', 'Choose a vehicle and at least one service.');
  const services = constraints.serviceIds.map(id => data.services.find(service => service.id === id));
  if (services.some(service => !service)) throw new DomainError('VALIDATION_ERROR', 'Service is not in the catalogue.');
  const selected = services as Service[];
  if (!data.vehicles.some(vehicle => vehicle.id === constraints.vehicleId)
    || selected.some(service => !service.vehicleIds.includes(constraints.vehicleId!)))
    throw new DomainError('VEHICLE_UNSUPPORTED', 'The selected service combination is not supported for this demo vehicle.');
  return { services: selected, totalDurationMinutes: selected.reduce<number>((sum, service) => sum + service.durationMinutes, RULES.visitBufferMinutes),
    totalPriceKzt: selected.reduce((sum, service) => sum + service.priceKzt, 0) };
}
function inspect(candidate: Candidate, constraints: CustomerConstraints, data: Dataset, now: string): Reason[] {
  const { branch, technician, bay, date, startAt, readyAt, quote } = candidate;
  const rejected: Reason[] = [];
  const part = data.parts?.find(p => p.branchId === branch.id && p.vehicleId === constraints.vehicleId);
  if (constraints.serviceIds.includes('oil-change') && part && (!part.availableFrom || date < part.availableFrom))
    rejected.push(reason('PART_UNAVAILABLE', 'The demo oil filter is unavailable at this branch on this date.'));
  const start = Date.parse(startAt), end = Date.parse(readyAt);
  if (constraints.allowedBranchIds && !constraints.allowedBranchIds.includes(branch.id))
    rejected.push(reason('BRANCH_NOT_ALLOWED', 'This branch is not allowed by the current request.'));
  if (constraints.allowedDates && !constraints.allowedDates.includes(date)) rejected.push(reason('DATE_NOT_ALLOWED', 'This date is not allowed.'));
  if (!horizonDates(now).includes(date)) rejected.push(reason('OUTSIDE_HORIZON', 'Date is outside the next seven local calendar days.'));
  if (start < Date.parse(now)) rejected.push(reason('PAST_TIME', 'This visit would start in the past.'));
  if (constraints.arrivalNotBefore && start < Date.parse(localToIso(date, constraints.arrivalNotBefore)))
    rejected.push(reason('BEFORE_ARRIVAL', `Starts before ${constraints.arrivalNotBefore}.`));
  if (constraints.readyNoLaterThan && end > Date.parse(localToIso(date, constraints.readyNoLaterThan)))
    rejected.push(reason('AFTER_DEADLINE', `Finishes at ${localParts(readyAt).time}, after ${constraints.readyNoLaterThan}.`));
  if (constraints.maxBudgetKzt !== null && quote.totalPriceKzt > constraints.maxBudgetKzt)
    rejected.push(reason('BUDGET_EXCEEDED', `Exceeds the budget by ${quote.totalPriceKzt - constraints.maxBudgetKzt} KZT.`));
  for (const resource of [branch, technician, bay]) {
    if (start < Date.parse(localToIso(date, resource.workingHours.open)) || end > Date.parse(localToIso(date, resource.workingHours.close)))
      rejected.push(reason('OUTSIDE_HOURS', 'The full visit, including the buffer, must fit branch and resource working hours.'));
  }
  if (!constraints.serviceIds.every(id => technician.serviceIds.includes(id)))
    rejected.push(reason('NO_COMPATIBLE_TECHNICIAN', 'No compatible assignment: the technician cannot perform all selected services.'));
  if (!constraints.serviceIds.every(id => bay.serviceIds.includes(id)))
    rejected.push(reason('NO_COMPATIBLE_BAY', 'No compatible assignment: the bay does not support all selected services.'));
  if (data.reservations.some(item => item.status === 'active' && item.resourceKind === 'technician'
    && item.resourceId === technician.id && overlaps(startAt, readyAt, item.startAt, item.endAt)))
    rejected.push(reason('TECHNICIAN_BUSY', 'A compatible technician is busy during this interval.'));
  if (data.reservations.some(item => item.status === 'active' && item.resourceKind === 'bay'
    && item.resourceId === bay.id && overlaps(startAt, readyAt, item.startAt, item.endAt)))
    rejected.push(reason('BAY_BUSY', 'A compatible bay is busy during this interval.'));
  return dedupeReasons(rejected);
}
function rank(a: Candidate, b: Candidate, constraints: CustomerConstraints): number {
  const byPrice = compare(a.quote.totalPriceKzt, b.quote.totalPriceKzt);
  const preferred = (candidate: Candidate) => candidate.branch.id === constraints.preferredBranchId ? 0 : 1;
  return (constraints.rankingPreference === 'cheapest' ? byPrice : 0)
    || compare(preferred(a), preferred(b)) || compare(Date.parse(a.readyAt), Date.parse(b.readyAt)) || byPrice
    || compare(a.branch.id, b.branch.id) || compare(a.startAt, b.startAt)
    || compare(a.technician.id, b.technician.id) || compare(a.bay.id, b.bay.id);
}
function enumerate(constraints: CustomerConstraints, data: Dataset, now: string): { candidates: Candidate[]; reasons: Reason[] } {
  const missing = missingFields(constraints);
  if (missing.length) return { candidates: [], reasons: [reason('MISSING_FIELDS', `Still needed: ${missing.join(', ')}.`)] };
  let quote: Quote;
  try { quote = quoteVisit(constraints, data); }
  catch (error) { if (error instanceof DomainError) return { candidates: [], reasons: [reason(error.code, error.message)] }; throw error; }
  if (constraints.maxBudgetKzt !== null && quote.totalPriceKzt > constraints.maxBudgetKzt)
    return { candidates: [], reasons: [reason('BUDGET_EXCEEDED', `Exceeds the budget by ${quote.totalPriceKzt - constraints.maxBudgetKzt} KZT.`)] };
  const candidates: Candidate[] = [], rejected: Reason[] = [];
  const dates = horizonDates(now);
  for (const date of constraints.allowedDates!) {
    if (!dates.includes(date)) { rejected.push(reason('OUTSIDE_HORIZON', 'Date is outside the next seven local calendar days.')); continue; }
    for (const branch of data.branches) {
      if (constraints.allowedBranchIds && !constraints.allowedBranchIds.includes(branch.id)) continue;
      const technicians = data.technicians.filter(item => item.branchId === branch.id && constraints.serviceIds.every(id => item.serviceIds.includes(id)));
      const bays = data.bays.filter(item => item.branchId === branch.id && constraints.serviceIds.every(id => item.serviceIds.includes(id)));
      if (!technicians.length) rejected.push(reason('NO_COMPATIBLE_TECHNICIAN', 'No technician in an allowed branch can perform all services.'));
      if (!bays.length) rejected.push(reason('NO_COMPATIBLE_BAY', 'No bay in an allowed branch supports all services.'));
      if (!technicians.length || !bays.length) continue;
      const first = Math.ceil(minutes(branch.workingHours.open) / RULES.slotStepMinutes) * RULES.slotStepMinutes;
      const last = minutes(branch.workingHours.close) - quote.totalDurationMinutes;
      if (last < first) { rejected.push(reason('OUTSIDE_HOURS', 'The full visit is longer than the branch working day.')); continue; }
      for (let minute = first; minute <= last; minute += RULES.slotStepMinutes) {
        const startAt = localToIso(date, timeOfDay(minute), branch.timeZone), readyAt = addMinutes(startAt, quote.totalDurationMinutes);
        for (const technician of technicians) for (const bay of bays) {
          const candidate: Candidate = { branch, technician, bay, date, startAt, readyAt, quote };
          const reasons = inspect(candidate, constraints, data, now);
          if (reasons.length) rejected.push(...reasons); else candidates.push(candidate);
        }
      }
    }
  }
  const distinct = new Map<string, Candidate>();
  candidates.sort((a, b) => rank(a, b, constraints)).forEach(candidate => {
    const key = `${candidate.branch.id}:${candidate.startAt}:${candidate.readyAt}`;
    if (!distinct.has(key)) distinct.set(key, candidate);
  });
  return { candidates: [...distinct.values()], reasons: dedupeReasons(rejected) };
}
function preview(candidate: Candidate, constraints: CustomerConstraints) {
  return VisitPreviewSchema.parse({ branchId: candidate.branch.id, date: candidate.date, startAt: candidate.startAt,
    readyAt: candidate.readyAt, serviceIds: [...constraints.serviceIds], vehicleId: constraints.vehicleId,
    totalPriceKzt: candidate.quote.totalPriceKzt, totalDurationMinutes: candidate.quote.totalDurationMinutes,
    timeZone: RULES.timeZone, currency: RULES.currency });
}
function relaxations(constraints: CustomerConstraints, data: Dataset, now: string): Relaxation[] {
  if (missingFields(constraints).length) return [];
  const attempts: { kind: Relaxation['kind']; patch: RequestPatch; message: string }[] = [];
  if (constraints.allowedBranchIds) {
    for (const branch of data.branches.filter(branch => !constraints.allowedBranchIds!.includes(branch.id)))
      attempts.push({ kind: 'another_branch', patch: { allowedBranchIds: [...constraints.allowedBranchIds, branch.id] },
        message: `Ask whether ${branch.name} may also be considered. This does not confirm a booking.` });
  }
  // Offer only a strictly later date, never silently replace the requested date.
  const lastDate = [...constraints.allowedDates!].sort().at(-1)!;
  for (const date of horizonDates(now).filter(date => date > lastDate))
    attempts.push({ kind: 'another_day', patch: { allowedDates: [date] }, message: `Ask whether ${date} is acceptable instead.` });
  if (constraints.readyNoLaterThan) attempts.push({ kind: 'later_ready', patch: { readyNoLaterThan: null },
    message: 'Ask whether a later ready time is acceptable. The preview shows the earliest feasible completion.' });
  if (constraints.maxBudgetKzt !== null) {
    try {
      const quote = quoteVisit(constraints, data);
      if (quote.totalPriceKzt > constraints.maxBudgetKzt) attempts.push({ kind: 'larger_budget', patch: { maxBudgetKzt: quote.totalPriceKzt },
        message: `Ask whether a budget of ${quote.totalPriceKzt} KZT is acceptable.` });
    } catch { /* An incompatible combination does not have a valid quote. */ }
  }
  if (constraints.serviceIds.length > 1) for (const serviceId of constraints.serviceIds) {
    attempts.push({ kind: 'fewer_services', patch: { removeServiceIds: [serviceId] },
      message: `Ask whether to remove ${data.services.find(service => service.id === serviceId)!.name} from this visit.` });
  }
  const results: Relaxation[] = [], seen = new Set<string>();
  for (const attempt of attempts) {
    if (results.length >= 3) break;
    const next = patchConstraints(constraints, attempt.patch);
    const candidate = enumerate(next, data, now).candidates[0];
    if (!candidate) continue;
    // Do not fill all cards with indistinguishable "another day" relaxations.
    if (seen.has(attempt.kind)) continue;
    seen.add(attempt.kind);
    const concretePatch = attempt.kind === 'later_ready'
      ? { readyNoLaterThan: localParts(candidate.readyAt).time } : attempt.patch;
    results.push({ ...attempt, patch: concretePatch, requiresNewConsent: true, preview: preview(candidate, next) });
  }
  return results;
}
export interface SearchContext { now: string; nextOptionId: () => string }
/** Pure, deterministic search aside from injected opaque IDs/clock. No LLM, I/O or writes. */
export function findOptions(input: BookingRequest, rawData: Dataset, context: SearchContext): SearchResult {
  const request = BookingRequestSchema.parse(input), data = validateDataset(rawData);
  const constraints = normalizeConstraints(request.constraints), { now } = context;
  localParts(now); // validate the injected server clock
  const found = enumerate(constraints, data, now);
  const options: SlotOption[] = found.candidates.slice(0, RULES.maxOptions).map(candidate => ({
    ...preview(candidate, constraints), optionId: context.nextOptionId(), requestId: request.requestId,
    requestVersion: request.requestVersion, calendarRevision: data.calendarRevision,
    technicianId: candidate.technician.id, bayId: candidate.bay.id, expiresAt: addMinutes(now, RULES.optionTtlSeconds / 60),
    explanations: ['All specified hard constraints are satisfied.', 'One compatible technician and bay cover the entire visit.',
      `Includes one ${RULES.visitBufferMinutes}-minute visit buffer; demo consumables are already included in the price.`,
      candidate.branch.id === constraints.preferredBranchId ? 'Your preferred allowed branch is ranked first.'
        : 'Ranked by your preference, then earliest ready time and deterministic resource tie-breakers.'],
  }));
  if (new Set(options.map(option => option.optionId)).size !== options.length)
    throw new DomainError('INTERNAL_ERROR', 'The server option ID factory returned duplicate identifiers.');
  return SearchResultSchema.parse({ requestId: request.requestId, requestVersion: request.requestVersion,
    sourceStateRevision: request.stateRevision, calendarRevision: data.calendarRevision, computedAt: now,
    status: options.length ? 'ok' : 'no_options', options,
    reasons: options.length ? [] : found.reasons.length ? found.reasons : [reason('NO_OPTIONS', 'No compatible interval found.')],
    relaxations: options.length ? [] : relaxations(constraints, data, now) });
}
/** Local application-service boundary; a future HTTP adapter must derive actor from its own session. */
export function searchOwnedRequest(request: BookingRequest, actor: Actor, expectedRequestVersion: number, data: Dataset, context: SearchContext): SearchResult {
  const state = BookingRequestSchema.parse(request);
  requireOwner(state, actor); requireVersion(state, expectedRequestVersion); requireEditable(state);
  return findOptions(state, data, context);
}
export function comparePreviousOption(previous: SlotOption, current: CustomerConstraints, rawData: Dataset, now: string): PreviousOptionComparison {
  const data = validateDataset(rawData), constraints = normalizeConstraints(current);
  let quote: Quote;
  try { quote = quoteVisit(constraints, data); }
  catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return PreviousOptionComparisonSchema.parse({ previousOptionId: previous.optionId, stillFits: false, newReadyAt: null,
      totalDurationMinutes: null, totalPriceKzt: null, reasons: [reason(error.code, error.message)] });
  }
  const branch = data.branches.find(item => item.id === previous.branchId)!;
  const technician = data.technicians.find(item => item.id === previous.technicianId);
  const bay = data.bays.find(item => item.id === previous.bayId);
  if (!branch || !technician || !bay || technician.branchId !== branch.id || bay.branchId !== branch.id)
    throw new DomainError('VALIDATION_ERROR', 'Previous assignment no longer exists.');
  const readyAt = addMinutes(previous.startAt, quote.totalDurationMinutes);
  const reasons = inspect({ branch, technician, bay, date: previous.date, startAt: previous.startAt, readyAt, quote }, constraints, data, now);
  return PreviousOptionComparisonSchema.parse({ previousOptionId: previous.optionId, stillFits: !reasons.length,
    newReadyAt: readyAt, totalDurationMinutes: quote.totalDurationMinutes, totalPriceKzt: quote.totalPriceKzt, reasons });
}
