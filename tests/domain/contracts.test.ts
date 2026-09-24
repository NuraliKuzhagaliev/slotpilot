import test from 'node:test';
import assert from 'node:assert/strict';
import { v, ContractError } from '../../src/contracts/schema.ts';
import { DateSchema, TimeSchema, InstantSchema, RequestPatchSchema, RULES } from '../../src/contracts/domain.ts';
import { toolInputs, parseToolArguments, exportToolInputSchemas } from '../../src/contracts/tools.ts';
import { localParts, localToIso, horizonDates, addDays, minutes, timeOfDay, overlaps } from '../../src/server/domain/time.ts';
import { makeDemoDataset } from '../../src/server/db/demo-fixtures.ts';
import { getServices } from '../../spikes/voice-access/catalog.mjs';
import { NOW } from './helpers.ts';

test('expanded catalogue preserves the isolated voice probe services and vehicles', () => {
  const canonical = makeDemoDataset(NOW), probe = getServices();
  assert.deepEqual(canonical.services.slice(0,probe.services.length).map(s=>({...s,vehicleIds:s.vehicleIds.filter(id=>probe.vehicles.some(v=>v.id===id))})), probe.services);
  assert.deepEqual(canonical.vehicles.slice(0,probe.vehicles.length), probe.vehicles);
  assert.equal(probe.rules.visitBufferMinutes, RULES.visitBufferMinutes);
});
test('schema output objects are immutable and parsers return copies', () => {
  const schema = v.object({ ids: v.array(v.string()) }), input = { ids: ['a'] };
  const parsed = schema.parse(input); parsed.ids.push('b'); assert.deepEqual(input.ids, ['a']);
  assert.ok(Object.isFrozen(schema.jsonSchema)); assert.ok(Object.isFrozen(schema.jsonSchema.properties));
});
test('plain-object schemas reject prototype objects, arrays, null, symbols and unknown fields', () => {
  const schema = v.object({ id: v.string() });
  for (const value of [null, [], new Date(), { id: 'a', extra: true }, Object.create({ id: 'a' }), { id: 'a', [Symbol('x')]: true }])
    assert.throws(() => schema.parse(value), ContractError);
  assert.throws(() => schema.parse(JSON.parse('{"id":"a","__proto__":{"role":"admin"}}')), ContractError);
});
test('unsafe keys cannot be used in schema definitions', () => {
  assert.throws(() => v.object({ constructor: v.string() }));
});
test('optional omission and explicit null are different', () => {
  const schema = v.object({ known: v.nullable(v.string()), extra: v.optional(v.string()) });
  assert.deepEqual(schema.parse({ known: null }), { known: null });
  assert.throws(() => schema.parse({ extra: 'x' })); assert.throws(() => schema.parse({ known: 'a', extra: null }));
});
test('integer runtime rejects NaN, Infinity, floats, strings and unsafe integers', () => {
  for (const value of [NaN, Infinity, 1.2, '2', Number.MAX_SAFE_INTEGER + 1, -1]) assert.throws(() => v.int().parse(value));
  assert.equal(v.int().parse(0), 0);
});
test('string length follows Unicode code points like JSON Schema', () => {
  assert.equal(v.string({ max: 1 }).parse('😀'), '😀'); assert.throws(() => v.string({ max: 1 }).parse('ab'));
});
test('array schemas reject duplicates, holes, bad values and excessive length', () => {
  const schema = v.array(v.int(1, 3), { min: 1, max: 3, unique: true });
  for (const value of [[], [1, 1], new Array(1), [4], [1, 2, 3, 4]]) assert.throws(() => schema.parse(value));
});
test('union validates exactly the declared alternatives', () => {
  const schema = v.union([v.object({ a: v.string() }), v.object({ b: v.int() })]);
  assert.deepEqual(schema.parse({ a: 'ok' }), { a: 'ok' }); assert.deepEqual(schema.parse({ b: 3 }), { b: 3 });
  assert.throws(() => schema.parse({ a: 'ok', b: 3 })); assert.throws(() => schema.parse({}));
});
for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-9-01', 'not-a-date'])
  test(`invalid calendar date ${date} is rejected`, () => assert.throws(() => DateSchema.parse(date)));
test('leap day is accepted in a leap year', () => assert.equal(DateSchema.parse('2028-02-29'), '2028-02-29'));
for (const time of ['24:00', '12:60', '9:00', 'noon']) test(`invalid local clock ${time} rejected`, () => assert.throws(() => TimeSchema.parse(time)));
test('timestamp needs an explicit zone and a real calendar date', () => {
  for (const time of ['2026-09-23T10:00:00', '2026-02-30T10:00:00Z', '2026-09-23T24:00:00Z']) assert.throws(() => InstantSchema.parse(time));
  assert.equal(InstantSchema.parse('2026-09-23T10:00:00+05:00'), '2026-09-23T10:00:00+05:00');
});
test('Almaty date rolls over according to IANA zone, not UTC or OS locale', () => {
  assert.deepEqual(localParts('2026-09-23T19:01:00.000Z'), { date: '2026-09-24', time: '00:01' });
  assert.equal(horizonDates('2026-09-23T19:01:00.000Z')[0], '2026-09-24');
});
test('local-to-ISO round trip uses IANA zone', () => {
  const iso = localToIso('2026-09-24', '14:00'); assert.equal(iso, '2026-09-24T09:00:00.000Z');
  assert.deepEqual(localParts(iso), { date: '2026-09-24', time: '14:00' });
});
test('calendar arithmetic handles month/year/leap boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01'); assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29'); assert.throws(() => addDays('2026-09-23', 0.5));
});
test('horizon is exactly thirty local calendar days including today', () => {
  assert.equal(horizonDates(NOW).length, 30); assert.equal(horizonDates(NOW).at(-1), '2026-10-22');
});
test('time conversion and interval adjacency', () => {
  assert.equal(minutes('14:15'), 855); assert.equal(timeOfDay(855), '14:15');
  assert.throws(() => timeOfDay(1440));
  const a = localToIso('2026-09-24', '14:00'), b = localToIso('2026-09-24', '15:00'), c = localToIso('2026-09-24', '16:00');
  assert.equal(overlaps(a, b, b, c), false); assert.equal(overlaps(a, c, b, c), true);
});
test('model-supplied ownership, role, route and confirmed flags cannot enter tool inputs', () => {
  const valid = { patch: {}, expectedRequestVersion: 1 };
  for (const extra of [{ userId: 'admin' }, { role: 'admin' }, { requestId: 'other' }, { url: 'https://attacker.invalid' }])
    assert.throws(() => parseToolArguments('update_request', { ...valid, ...extra }));
  assert.throws(() => parseToolArguments('confirm_booking', { actionId: 'a', confirmed: true }));
  assert.throws(() => parseToolArguments('confirm_booking', { actionId: 'a', confirmationRef: 'r', confirmed: true }));
});
test('confirmationRef is a reference only, never evidence validated by this contract', () => {
  assert.deepEqual(parseToolArguments('confirm_booking', { actionId: 'a', confirmationRef: 'server-reference' }), { actionId: 'a', confirmationRef: 'server-reference' });
});
test('get_booking requires exactly one lookup selector', () => {
  assert.throws(() => parseToolArguments('get_booking', {}));
  assert.throws(() => parseToolArguments('get_booking', { bookingId: 'b', actionId: 'a' }));
  assert.deepEqual(parseToolArguments('get_booking', { actionId: 'a' }), { actionId: 'a' });
});
test('prepare_change cancellation and reschedule have distinct conditional schemas', () => {
  assert.deepEqual(parseToolArguments('prepare_change', { changeType: 'cancel', bookingId: 'b', expectedBookingVersion: 1 }),
    { changeType: 'cancel', bookingId: 'b', expectedBookingVersion: 1 });
  assert.throws(() => parseToolArguments('prepare_change', { changeType: 'reschedule', bookingId: 'b', expectedBookingVersion: 1 }));
  assert.throws(() => parseToolArguments('prepare_change', { changeType: 'cancel', bookingId: 'b', expectedBookingVersion: 1, optionId: 'x' }));
});
test('all ten tool input schemas derive from runtime definitions', () => {
  const schemas = exportToolInputSchemas(); assert.equal(Object.keys(schemas).length, 10);
  for (const name of Object.keys(toolInputs) as (keyof typeof toolInputs)[]) assert.deepEqual(schemas[name], toolInputs[name].jsonSchema);
});
test('patch model cannot inject a prepared action or booking number', () => {
  for (const patch of [{ preparedAction: { actionId: 'x' } }, { bookingId: 'fake' }, { priceKzt: 1 }, { requestVersion: 99 }])
    assert.throws(() => RequestPatchSchema.parse(patch));
});
