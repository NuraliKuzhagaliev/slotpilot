import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, SearchResultSchema, type RequestPatch } from '../../src/contracts/domain.ts';
import { findOptions, quoteVisit, comparePreviousOption, searchOwnedRequest } from '../../src/server/domain/scheduler.ts';
import { updateRequest, acceptSearchResult, createDraft, patchConstraints } from '../../src/server/domain/requests.ts';
import { validateDataset } from '../../src/server/domain/dataset.ts';
import { makeDemoDataset } from '../../src/server/db/demo-fixtures.ts';
import { localParts, localToIso, addMinutes, overlaps } from '../../src/server/domain/time.ts';
import { request, search, freeData, NOW, TOMORROW, ACTOR } from './helpers.ts';
const bundle: RequestPatch = { serviceIds: ['oil-change', 'brake-check', 'diagnostics'] };

test('central demo: 45 minutes / 15000, then 120 / 37000; no silent branch switch', () => {
  const data = makeDemoDataset(NOW);
  const initial = request(); const first = search(initial, data); const previous = first.options[0]!;
  assert.equal(localParts(previous.startAt).time, '15:00'); assert.equal(localParts(previous.readyAt).time, '15:45');
  assert.equal(previous.totalPriceKzt, 15000); assert.equal(previous.totalDurationMinutes, 45);
  let state = acceptSearchResult(initial, first).state;
  state = updateRequest(state, ACTOR, { addServiceIds: ['brake-check', 'diagnostics'], readyNoLaterThan: '16:00' }, state.requestVersion);
  const comparison = comparePreviousOption(previous, state.constraints, data, NOW);
  assert.equal(comparison.stillFits, false); assert.equal(localParts(comparison.newReadyAt!).time, '17:00');
  assert.equal(comparison.totalDurationMinutes, 120); assert.equal(comparison.totalPriceKzt, 37000);
  assert.ok(comparison.reasons.some(item => item.code === 'AFTER_DEADLINE'));
  const second = search(state, data); assert.equal(second.status, 'no_options'); assert.equal(second.options.length, 0);
  const alternative = second.relaxations.find(item => item.kind === 'another_branch')!;
  assert.equal(alternative.preview.branchId, 'north'); assert.equal(localParts(alternative.preview.startAt).time, '14:00');
  assert.equal(localParts(alternative.preview.readyAt).time, '16:00'); assert.equal(alternative.requiresNewConsent, true);
  assert.equal('optionId' in alternative.preview, false); assert.deepEqual(state.constraints.allowedBranchIds, ['centre']);
  state = updateRequest(state, ACTOR, alternative.patch, state.requestVersion);
  const third = search(state, data); assert.equal(third.options[0]!.branchId, 'north');
  assert.equal(third.options[0]!.totalPriceKzt, 37000); assert.equal(state.bookingId, null); assert.equal(state.preparedAction, null);
});
test('one buffer per visit, not per service; no double charge for parts', () => {
  const state = request(bundle), quote = quoteVisit(state.constraints, makeDemoDataset(NOW));
  assert.equal(quote.totalDurationMinutes, 30 + 45 + 30 + RULES.visitBufferMinutes); assert.equal(quote.totalPriceKzt, 37000);
});
test('a deadline includes the buffer and is inclusive at exactly 16:00', () => {
  const exact = search(request({ ...bundle, allowedBranchIds: ['north'], readyNoLaterThan: '16:00' }));
  assert.equal(exact.options.length, 1); assert.equal(localParts(exact.options[0]!.readyAt).time, '16:00');
  const earlier = search(request({ ...bundle, allowedBranchIds: ['north'], readyNoLaterThan: '15:59' }));
  assert.equal(earlier.options.length, 0);
});
test('earliest arrival is a hard bound; starts use the next 15-minute grid point', () => {
  const result = search(request({ allowedBranchIds: ['north'], arrivalNotBefore: '14:01' }));
  assert.equal(localParts(result.options[0]!.startAt).time, '14:15');
});
test('arrival range constrains the start time and does not confuse it with a ready-by deadline',()=>{
  const inRange=search(request({allowedBranchIds:['north'],arrivalNotBefore:'14:00',arrivalNotAfter:'16:00'}));
  assert.ok(inRange.options.length);assert.ok(inRange.options.every(o=>localParts(o.startAt).time>='14:00'&&localParts(o.startAt).time<='16:00'));
  const noMatch=search(request({allowedBranchIds:['north'],arrivalNotBefore:'16:00',arrivalNotAfter:'16:00'}));
  assert.equal(noMatch.options.length,1);assert.equal(localParts(noMatch.options[0]!.startAt).time,'16:00');
  assert.equal(localParts(noMatch.options[0]!.readyAt).time,'16:45');
  assert.throws(()=>request({arrivalNotBefore:'16:00',arrivalNotAfter:'14:00'}),{code:'VALIDATION_ERROR'});
});
test('over-budget options excluded and exact excess explained', () => {
  const result = search(request({ maxBudgetKzt: 13000 }));
  assert.equal(result.options.length, 0); assert.deepEqual(result.reasons[0], { code: 'BUDGET_EXCEEDED', message: 'Exceeds the budget by 2000 KZT.' });
  assert.equal(result.relaxations.find(item => item.kind === 'larger_budget')!.patch.maxBudgetKzt, 15000);
});
test('equal budget is allowed, zero is a real constraint, null removes budget', () => {
  assert.ok(search(request({ maxBudgetKzt: 15000 })).options.length);
  assert.equal(search(request({ maxBudgetKzt: 0 })).options.length, 0);
  assert.ok(search(request({ maxBudgetKzt: null })).options.length);
});
test('hard Centre branch is not exchanged for an earlier North slot', () => {
  const result = search(request()); assert.ok(result.options.every(option => option.branchId === 'centre'));
});
test('soft preferred Centre precedes earlier North within allowed branches', () => {
  const result = search(request({ allowedBranchIds: ['centre', 'north'], preferredBranchId: 'centre' }));
  assert.equal(result.options[0]!.branchId, 'centre');
});
test('without preferred branch, earliest ready time wins across allowed branches', () => {
  assert.equal(search(request({ allowedBranchIds: null })).options[0]!.branchId, 'north');
});
test('cheapest preference is stable (shared catalogue means equal prices in this demo)', () => {
  const state = request({ allowedBranchIds: null, rankingPreference: 'cheapest' });
  const first = search(state); const second = search(state); assert.deepEqual(first, second);
  assert.ok(first.options.every(option => option.totalPriceKzt === 15000));
});
test('incompatible EV oil change has no eligible option', () => {
  const result = search(request({ vehicleId: 'ev-demo' })); assert.equal(result.options.length, 0);
  assert.equal(result.reasons[0]!.code, 'VEHICLE_UNSUPPORTED');
});
test('compatible EV diagnostics still work', () => {
  assert.ok(search(request({ vehicleId: 'ev-demo', serviceIds: ['diagnostics'] })).options.length);
});
test('missing conditions do not invent a vehicle, date or service', () => {
  const result = search(createDraft('empty', ACTOR.userId, 'test-fixture'));
  assert.equal(result.options.length, 0); assert.equal(result.relaxations.length, 0);
  assert.equal(result.reasons[0]!.code, 'MISSING_FIELDS');
});
test('no single technician has all skills, even if separate technicians could split the work', () => {
  const data = freeData();
  data.technicians.filter(item => item.branchId === 'centre').forEach((item, i) => { item.serviceIds = i ? ['brake-check'] : ['oil-change']; });
  const result = search(request({ serviceIds: ['oil-change', 'brake-check'] }), data);
  assert.equal(result.options.length, 0); assert.ok(result.reasons.some(item => item.code === 'NO_COMPATIBLE_TECHNICIAN'));
});
test('no single bay supports the whole visit', () => {
  const data = freeData(); data.bays.filter(item => item.branchId === 'centre').forEach(item => { item.serviceIds = ['oil-change']; });
  const result = search(request(bundle), data); assert.equal(result.options.length, 0);
  assert.ok(result.reasons.some(item => item.code === 'NO_COMPATIBLE_BAY'));
});
for (const kind of ['technician', 'bay'] as const) {
  test(`busy ${kind} prevents a pair even when the other resource is free`, () => {
    const data = freeData(); data.reservations.push({ id: 'occupied', resourceKind: kind,
      resourceId: kind === 'technician' ? 'centre-universal-tech' : 'centre-universal-bay',
      startAt: localToIso(TOMORROW, '09:00'), endAt: localToIso(TOMORROW, '18:00'), status: 'active' });
    const result = search(request(), data); assert.equal(result.options.length, 0);
    assert.ok(result.reasons.some(item => item.code === (kind === 'technician' ? 'TECHNICIAN_BUSY' : 'BAY_BUSY')));
  });
  test(`${kind} working hours must cover the full visit`, () => {
    const data = freeData(); const resources = kind === 'technician' ? data.technicians : data.bays;
    resources.filter(item => item.branchId === 'centre').forEach(item => { item.workingHours.close = '14:30'; });
    const result = search(request(), data); assert.equal(result.options.length, 0);
    assert.ok(result.reasons.some(item => item.code === 'OUTSIDE_HOURS'));
  });
}
test('resource branch locality: a free technician in North cannot pair with a Centre bay', () => {
  const data = freeData(); data.technicians.filter(item => item.branchId === 'centre').forEach(item => { item.serviceIds = ['tire-service']; });
  assert.equal(search(request(), data).options.length, 0);
});
test('adjacent reservations are allowed: interval end is exclusive', () => {
  const data = freeData(); data.reservations.push({ id: 'ends-exactly', resourceKind: 'technician', resourceId: 'centre-universal-tech',
    startAt: localToIso(TOMORROW, '13:00'), endAt: localToIso(TOMORROW, '14:00'), status: 'active' });
  const result = search(request(), data); assert.equal(localParts(result.options[0]!.startAt).time, '14:00');
});
test('reservation beginning during buffer excludes a slot', () => {
  const data = freeData(); data.reservations.push({ id: 'buffer-busy', resourceKind: 'bay', resourceId: 'centre-universal-bay',
    startAt: localToIso(TOMORROW, '14:30'), endAt: localToIso(TOMORROW, '15:00'), status: 'active' });
  const result = search(request(), data); assert.equal(localParts(result.options[0]!.startAt).time, '15:00');
});
test('cancelled fixture reservations do not block slots', () => {
  const data = makeDemoDataset(NOW); data.reservations.forEach(item => { item.status = 'cancelled'; });
  assert.equal(localParts(search(request(), data).options[0]!.startAt).time, '14:00');
});
test('same branch/time using different pairs is one client option', () => {
  const data = freeData(); data.technicians.forEach(item => { item.serviceIds = ['oil-change']; });
  data.bays.forEach(item => { item.serviceIds = ['oil-change']; });
  const result = search(request(), data); assert.equal(result.options.length, 3);
  assert.deepEqual(result.options.map(option => localParts(option.startAt).time), ['14:00', '14:15', '14:30']);
  assert.equal(new Set(result.options.map(option => `${option.branchId}:${option.startAt}:${option.readyAt}`)).size, 3);
});
test('resource tie-break is deterministic when input arrays are reordered', () => {
  const data = freeData(); data.technicians.forEach(item => { item.serviceIds = ['oil-change']; });
  data.bays.forEach(item => { item.serviceIds = ['oil-change']; });
  const first = search(request(), data); const reversed = structuredClone(data);
  reversed.branches.reverse(); reversed.technicians.reverse(); reversed.bays.reverse(); reversed.services.reverse();
  assert.deepEqual(search(request(), reversed), first);
});
test('today never produces a start before the server clock', () => {
  const result = search(request({ allowedDates: ['2026-09-23'], arrivalNotBefore: null }), freeData(), '2026-09-23T10:01:00.000Z');
  assert.equal(localParts(result.options[0]!.startAt).time, '15:15');
  assert.ok(result.options.every(option => Date.parse(option.startAt) >= Date.parse('2026-09-23T10:01:00.000Z')));
});
test('past/out-of-horizon dates do not return admissible options', () => {
  for (const date of ['2026-09-22', '2026-10-23']) {
    const result = search(request({ allowedDates: [date] })); assert.equal(result.options.length, 0);
    assert.ok(result.reasons.some(item => item.code === 'OUTSIDE_HORIZON'));
  }
});
test('branch working hours include the buffer and prevent closing-time overflow', () => {
  const result = search(request({ arrivalNotBefore: '17:30' }), freeData()); assert.equal(result.options.length, 0);
});
test('relaxation preview has no optionId and preserves existing constraints until applied', () => {
  const state = request({ ...bundle, readyNoLaterThan: '16:00' }); const before = structuredClone(state);
  const result = search(state); assert.deepEqual(state, before);
  for (const item of result.relaxations) {
    assert.equal('optionId' in item.preview, false); assert.equal(item.requiresNewConsent, true);
    const changed = { ...state, constraints: patchConstraints(state.constraints, item.patch) };
    assert.ok(search(changed).options.length, `${item.kind} must actually make a slot feasible`);
  }
});
test('fixture and request inputs are not mutated by scheduling or comparison', () => {
  const state = request(), data = makeDemoDataset(NOW), before = JSON.stringify({ state, data });
  const result = search(state, data); comparePreviousOption(result.options[0]!, state.constraints, data, NOW);
  assert.equal(JSON.stringify({ state, data }), before);
});
test('IDs come from server context; repeated ID factory output is rejected', () => {
  assert.throws(() => findOptions(request(), makeDemoDataset(NOW), { now: NOW, nextOptionId: () => 'same' }), { code: 'INTERNAL_ERROR' });
});
test('option expiry is 120 seconds from injected server time', () => {
  const result = search(); assert.equal(result.options[0]!.expiresAt, addMinutes(NOW, 2));
});
test('returned object passes the canonical runtime output schema', () => {
  assert.deepEqual(SearchResultSchema.parse(search()), search());
});
test('owned search boundary rejects another client and a stale version', () => {
  const state = request(), data = makeDemoDataset(NOW), context = { now: NOW, nextOptionId: () => 'id' };
  assert.throws(() => searchOwnedRequest(state, { userId: 'another', role: 'client' }, state.requestVersion, data, context), { code: 'NOT_AUTHORIZED' });
  assert.throws(() => searchOwnedRequest(state, ACTOR, state.requestVersion - 1, data, context), { code: 'STALE_REQUEST' });
});
test('changing fixture occupancy changes output; this is not a scripted conflict response', () => {
  const state = request(); const data = makeDemoDataset(NOW); const first = search(state, data).options[0]!;
  data.reservations.push({ id: 'occupied-after-proposal', resourceKind: 'technician', resourceId: first.technicianId,
    startAt: first.startAt, endAt: first.readyAt, status: 'active' }); data.calendarRevision++;
  const next = search(state, data); assert.ok(next.options.every(option => !overlaps(option.startAt, option.readyAt, first.startAt, first.readyAt)));
  assert.equal(next.options[0]!.calendarRevision, 2);
});
test('malformed dataset identifiers, references and ranges are rejected', () => {
  const duplicate = freeData(); duplicate.services[1]!.id = duplicate.services[0]!.id;
  assert.throws(() => validateDataset(duplicate), { code: 'VALIDATION_ERROR' });
  const orphan = freeData(); orphan.reservations.push({ id: 'orphan', resourceKind: 'bay', resourceId: 'missing',
    startAt: localToIso(TOMORROW, '14:00'), endAt: localToIso(TOMORROW, '15:00'), status: 'active' });
  assert.throws(() => validateDataset(orphan), { code: 'VALIDATION_ERROR' });
  const inverted = makeDemoDataset(NOW); inverted.reservations[0]!.endAt = inverted.reservations[0]!.startAt;
  assert.throws(() => validateDataset(inverted), { code: 'VALIDATION_ERROR' });
});
test('horizon can be reproduced at a future clock without stale calendar dates', () => {
  const now = '2027-02-10T01:00:00.000Z', data = makeDemoDataset(now);
  const result = search(request({ allowedDates: ['2027-02-11'] }), data, now);
  assert.ok(result.options.length); assert.equal(result.options[0]!.date, '2027-02-11');
});
test('generated scenarios: every returned option independently satisfies all hard constraints', () => {
  let seed = 8123;
  const rand = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const combinations = [['oil-change'], ['brake-check'], ['diagnostics'], ['tire-service'],
    ['oil-change', 'brake-check'], ['oil-change', 'brake-check', 'diagnostics']] as const;
  for (let trial = 0; trial < 60; trial++) {
    const state = request({ serviceIds: [...combinations[rand(combinations.length)]!],
      allowedBranchIds: rand(2) ? ['centre'] : ['north'], arrivalNotBefore: rand(2) ? '14:00' : '15:00',
      readyNoLaterThan: ['15:00', '16:00', '18:00'][rand(3)]!, maxBudgetKzt: [15000, 30000, 40000, null][rand(4)]! });
    const data = rand(2) ? freeData() : makeDemoDataset(NOW);
    if (rand(2)) data.reservations.push({ id: 'extra-random-block', resourceKind: 'technician', resourceId: 'north-universal-tech',
      startAt: localToIso(TOMORROW, '15:00'), endAt: localToIso(TOMORROW, '16:00'), status: 'active' });
    for (const option of search(state, data).options) {
      const c = state.constraints, selected = data.services.filter(service => c.serviceIds.includes(service.id));
      const technician = data.technicians.find(item => item.id === option.technicianId)!;
      const bay = data.bays.find(item => item.id === option.bayId)!;
      assert.ok(c.allowedBranchIds!.includes(option.branchId)); assert.ok(c.allowedDates!.includes(option.date));
      assert.ok(localParts(option.startAt).time >= c.arrivalNotBefore!); assert.ok(localParts(option.readyAt).time <= c.readyNoLaterThan!);
      const duration = selected.reduce((sum, service) => sum + service.durationMinutes, 15);
      const price = selected.reduce((sum, service) => sum + service.priceKzt, 0);
      assert.equal(option.totalDurationMinutes, duration); assert.equal(Date.parse(option.readyAt) - Date.parse(option.startAt), duration * 60000);
      assert.equal(option.totalPriceKzt, price); if (c.maxBudgetKzt !== null) assert.ok(price <= c.maxBudgetKzt);
      assert.ok(selected.every(service => service.vehicleIds.includes(c.vehicleId!)));
      for (const resource of [technician, bay]) {
        assert.equal(resource.branchId, option.branchId); assert.ok(c.serviceIds.every(id => resource.serviceIds.includes(id)));
        assert.ok(localParts(option.startAt).time >= resource.workingHours.open); assert.ok(localParts(option.readyAt).time <= resource.workingHours.close);
      }
      assert.ok(!data.reservations.some(item => item.status === 'active' &&
        item.resourceId === (item.resourceKind === 'technician' ? technician.id : bay.id)
        && Date.parse(option.startAt) < Date.parse(item.endAt) && Date.parse(item.startAt) < Date.parse(option.readyAt)));
    }
  }
});
