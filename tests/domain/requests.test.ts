import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerConstraintsSchema, RequestPatchSchema } from '../../src/contracts/domain.ts';
import { createDraft, emptyConstraints, updateRequest, acceptSearchResult, normalizeConstraints, missingFields } from '../../src/server/domain/requests.ts';
import { request, search, NOW, ACTOR, TOMORROW } from './helpers.ts';
import { addMinutes } from '../../src/server/domain/time.ts';

test('draft uses unknown values, not invented dates/budget/car', () => {
  const state = createDraft('req', ACTOR.userId, 'a'); assert.deepEqual(state.constraints, emptyConstraints());
  assert.equal(state.requestVersion, 1); assert.equal(state.stateRevision, 0);
  assert.deepEqual(missingFields(state.constraints), ['serviceIds', 'vehicleId', 'allowedDates']);
});
test('patch omits fields to preserve them; adding services never erases budget/date', () => {
  const before = request(); const after = updateRequest(before, ACTOR, { addServiceIds: ['brake-check'] }, before.requestVersion);
  assert.deepEqual(after.constraints.serviceIds, ['brake-check', 'oil-change']);
  assert.equal(after.constraints.maxBudgetKzt, 40000); assert.deepEqual(after.constraints.allowedDates, [TOMORROW]);
  assert.equal(after.constraints.arrivalNotBefore, '14:00'); assert.equal(before.constraints.serviceIds.length, 1);
});
test('an inclusive natural-language date range expands deterministically across month boundaries', () => {
  const state=request();
  const october=updateRequest(state,ACTOR,{allowedDateRange:{from:'2026-10-01',to:'2026-10-10'}},state.requestVersion);
  assert.deepEqual(october.constraints.allowedDates,Array.from({length:10},(_,i)=>`2026-10-${String(i+1).padStart(2,'0')}`));
  const yearEnd=updateRequest(state,ACTOR,{allowedDateRange:{from:'2026-12-30',to:'2027-01-02'}},state.requestVersion);
  assert.deepEqual(yearEnd.constraints.allowedDates,['2026-12-30','2026-12-31','2027-01-01','2027-01-02']);
});
test('date ranges reject inverted, oversized, and simultaneous list/range inputs', () => {
  const state=request();
  for(const patch of [
    {allowedDateRange:{from:'2026-10-10',to:'2026-10-01'}},
    {allowedDateRange:{from:'2026-10-01',to:'2026-10-31'}},
    {allowedDateRange:{from:'2026-10-01',to:'2026-10-10'},allowedDates:['2026-10-01']},
  ]) assert.throws(()=>updateRequest(state,ACTOR,patch,state.requestVersion),{code:'VALIDATION_ERROR'});
});
test('legacy stored constraints normalize to an unbounded latest arrival',()=>{
  const {arrivalNotAfter:_,...legacy}=emptyConstraints();
  assert.equal(normalizeConstraints(legacy).arrivalNotAfter,null);
});
test('explicit null removes only that nullable restriction', () => {
  const before = request(); const after = updateRequest(before, ACTOR, { maxBudgetKzt: null }, before.requestVersion);
  assert.equal(after.constraints.maxBudgetKzt, null); assert.equal(after.constraints.vehicleId, 'sedan-petrol');
});
test('same semantic update does not increase versions', () => {
  const before = request({ serviceIds: ['oil-change', 'brake-check'], allowedBranchIds: ['centre', 'north'] });
  const after = updateRequest(before, ACTOR, { serviceIds: ['brake-check', 'oil-change'], allowedBranchIds: ['north', 'centre'] }, before.requestVersion);
  assert.deepEqual(after, before);
});
test('adding a service already present is a no-op', () => {
  const before = request(); assert.deepEqual(updateRequest(before, ACTOR, { addServiceIds: ['oil-change'] }, before.requestVersion), before);
});
test('empty patch is a no-op', () => {
  const before = request(); assert.deepEqual(updateRequest(before, ACTOR, {}, before.requestVersion), before);
});
test('changed constraint invalidates options and prepared snapshot and increases both counters once', () => {
  let state = request(); state = acceptSearchResult(state, search(state)).state;
  state.preparedAction = { actionId: 'test-only-action', requestId: state.requestId, actionType: 'create',
    requestVersion: state.requestVersion, expectedBookingVersion: null, bookingId: null,
    snapshot: state.options[0]!, createdAt: NOW, expiresAt: addMinutes(NOW, 2) };
  state.stage = 'awaiting_confirmation';
  const after = updateRequest(state, ACTOR, { maxBudgetKzt: 20000 }, state.requestVersion);
  assert.equal(after.requestVersion, state.requestVersion + 1); assert.equal(after.stateRevision, state.stateRevision + 1);
  assert.deepEqual(after.options, []); assert.equal(after.preparedAction, null); assert.equal(after.stage, 'collecting');
});
test('stale update is rejected even when the patch looks like a no-op', () => {
  const state = request(); assert.throws(() => updateRequest(state, ACTOR, {}, state.requestVersion - 1), { code: 'STALE_REQUEST' });
});
test('another user cannot change a request; admin role is not model-supplied ownership', () => {
  const state = request();
  for (const role of ['client', 'admin'] as const)
    assert.throws(() => updateRequest(state, { userId: 'other', role }, {}, state.requestVersion), { code: 'NOT_AUTHORIZED' });
});
test('saved requests cannot create a second booking by changing constraints', () => {
  const state = request(); state.bookingId = 'existing'; state.stage = 'booked';
  assert.throws(() => updateRequest(state, ACTOR, { maxBudgetKzt: 20000 }, state.requestVersion), { code: 'REQUEST_CLOSED' });
});
for (const stage of ['executing', 'reconciling'] as const) test(`${stage} blocks edits until result is reconciled`, () => {
  const state = request(); state.stage = stage;
  assert.throws(() => updateRequest(state, ACTOR, {}, state.requestVersion), { code: 'OPERATION_PENDING' });
});
test('late search for an old request version is ignored', () => {
  const state = request(), result = search(state);
  const next = updateRequest(state, ACTOR, { maxBudgetKzt: 20000 }, state.requestVersion);
  const merged = acceptSearchResult(next, result); assert.equal(merged.applied, false); assert.deepEqual(merged.state, next);
});
test('late same-version search cannot overwrite a newer stateRevision', () => {
  const state = request(), result = search(state), first = acceptSearchResult(state, result);
  assert.equal(first.applied, true); assert.equal(first.state.requestVersion, state.requestVersion);
  assert.equal(first.state.stateRevision, state.stateRevision + 1);
  assert.equal(acceptSearchResult(first.state, result).applied, false);
});
test('search results for another request do not merge', () => {
  const state = request(), result = search(state); result.requestId = 'another-request';
  assert.equal(acceptSearchResult(state, result).applied, false);
});
test('search cannot overwrite a saved result', () => {
  const state = request(), result = search(state); state.bookingId = 'saved'; state.stage = 'booked';
  assert.equal(acceptSearchResult(state, result).applied, false);
});
test('a result with mismatched nested option versions is rejected', () => {
  const state = request(), result = search(state); result.options[0]!.requestVersion++;
  assert.throws(() => acceptSearchResult(state, result), { code: 'VALIDATION_ERROR' });
});
test('more than three services rejected after an additive update', () => {
  const state = request({ serviceIds: ['oil-change', 'brake-check', 'diagnostics'] });
  assert.throws(() => updateRequest(state, ACTOR, { addServiceIds: ['tire-service'] }, state.requestVersion));
});
test('conflicting service edits and replacement mixed with deltas rejected', () => {
  const state = request();
  assert.throws(() => updateRequest(state, ACTOR, { addServiceIds: ['oil-change'], removeServiceIds: ['oil-change'] }, state.requestVersion));
  assert.throws(() => updateRequest(state, ACTOR, { serviceIds: [], addServiceIds: ['oil-change'] }, state.requestVersion));
});
test('remove service preserves remaining services and constraints', () => {
  const state = request({ serviceIds: ['oil-change', 'brake-check'] });
  const after = updateRequest(state, ACTOR, { removeServiceIds: ['oil-change'] }, state.requestVersion);
  assert.deepEqual(after.constraints.serviceIds, ['brake-check']); assert.equal(after.constraints.maxBudgetKzt, 40000);
});
test('empty allowed branches/dates and unknown service IDs are rejected', () => {
  for (const patch of [{ allowedBranchIds: [] }, { allowedDates: [] }, { serviceIds: ['engine-overhaul'] }])
    assert.throws(() => RequestPatchSchema.parse(patch));
});
test('hard branch list and preferred branch cannot contradict each other', () => {
  assert.throws(() => normalizeConstraints({ ...request().constraints, preferredBranchId: 'north' }), { code: 'VALIDATION_ERROR' });
});
test('null service list is invalid; an explicit empty list clears it', () => {
  assert.throws(() => CustomerConstraintsSchema.parse({ ...emptyConstraints(), serviceIds: null }));
  const state = request(), after = updateRequest(state, ACTOR, { serviceIds: [] }, state.requestVersion);
  assert.deepEqual(missingFields(after.constraints), ['serviceIds']);
});
