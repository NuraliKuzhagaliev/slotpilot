import test from 'node:test';
import assert from 'node:assert/strict';
import { getServices, branchNow } from '../spikes/voice-access/catalog.mjs';
import { readConfig } from '../spikes/voice-access/config.mjs';
import { SessionStore, WindowLimiter, safeEqual } from '../spikes/voice-access/auth.mjs';
import { getServicesParameters, parseToolCall } from '../spikes/voice-access/shared/contracts.mjs';
import { inlineSession } from '../agents/voice-access.mjs';
import { mintVoiceToken } from '../spikes/voice-access/provider.mjs';

const config = () => readConfig({ ASSEMBLYAI_API_KEY: 'unit-test-secret-not-a-real-key' });
const call = args => ({ callId: 'call_1', name: 'get_services', arguments: args });
test('catalogue matches the four prices and durations from the specification', () => {
  assert.deepEqual(getServices().services.map(s => [s.id, s.durationMinutes, s.priceKzt]), [
    ['oil-change', 30, 15000], ['brake-check', 45, 10000], ['diagnostics', 30, 12000], ['tire-service', 45, 20000],
  ]);
});
test('central-demo catalogue values total 37,000 KZT and 120 minutes including one reserve', () => {
  const data = getServices(); const selected = data.services.slice(0, 3);
  assert.equal(selected.reduce((sum, s) => sum + s.priceKzt, 0), 37000);
  assert.equal(selected.reduce((sum, s) => sum + s.durationMinutes, data.rules.visitBufferMinutes), 120);
});
test('catalogue response explicitly declares demo and disabled scheduling', () => {
  assert.equal(getServices().demoData, true); assert.equal(getServices().rules.schedulingEnabled, false);
});
test('petrol and electric demo compatibility is different', () => {
  assert.equal(getServices('sedan-petrol').services.length, 4);
  assert.equal(getServices('ev-demo').services.some(s => s.id === 'oil-change'), false);
});
test('callers cannot mutate the shared catalogue', () => {
  getServices().services[0].priceKzt = -1; assert.equal(getServices().services[0].priceKzt, 15000);
});
test('branch date crosses midnight by Asia/Almaty, not by the machine timezone', () => {
  assert.deepEqual(branchNow(new Date('2026-09-23T20:15:00Z')), {
    date: '2026-09-24', time: '01:15', timeZone: 'Asia/Almaty', serverTime: '2026-09-23T20:15:00.000Z',
  });
});
test('tool parameters and runtime validation use the same vehicle enum', () => {
  for (const vehicleId of getServicesParameters.properties.vehicleId.enum) assert.equal(parseToolCall(call({ vehicleId })).arguments.vehicleId, vehicleId);
  assert.deepEqual(parseToolCall(call({})).arguments, {});
});
test('tool rejects unknown vehicles and null vehicle IDs', () => {
  assert.throws(() => parseToolCall(call({ vehicleId: 'invented-car' })));
  assert.throws(() => parseToolCall(call({ vehicleId: null })));
});
test('tool rejects owner or role spoofing and unknown operation names', () => {
  assert.throws(() => parseToolCall({ ...call({}), userId: 'other' }));
  assert.throws(() => parseToolCall(call({ role: 'admin' })));
  assert.throws(() => parseToolCall({ ...call({}), name: 'confirm_booking' }));
});
test('tool rejects malformed call IDs and string arguments', () => {
  assert.throws(() => parseToolCall({ ...call({}), callId: '<script>' }));
  assert.throws(() => parseToolCall(call('{}')));
});
test('empty credentials do not enable a default demo account', () => {
  const store = new SessionStore({ client: '', admin: '' }); assert.throws(() => store.create('client', ''), /Incorrect/);
});
test('authentication compares strings with different lengths safely', () => {
  assert.equal(safeEqual('abc', 'abc'), true); assert.equal(safeEqual('abc', ''), false);
});
test('server assigns the role and a unique probe identity', () => {
  const store = new SessionStore({ client: 'client-password-123', admin: 'admin-password-456' });
  const a = store.create('client', 'client-password-123'), b = store.create('admin', 'admin-password-456');
  assert.equal(a.session.role, 'client'); assert.equal(b.session.role, 'admin'); assert.notEqual(a.session.probeId, b.session.probeId);
  assert.equal(store.get(`slotpilot_probe=${a.secret}`).probeId, a.session.probeId);
});
test('expired and logged-out cookies cannot be reused', () => {
  let now = 0; const store = new SessionStore({ client: 'client-password-123' }, () => now);
  const a = store.create('client', 'client-password-123'), cookie = `slotpilot_probe=${a.secret}`;
  now = 3600001; assert.throws(() => store.get(cookie));
  const b = store.create('client', 'client-password-123'), otherCookie = `slotpilot_probe=${b.secret}`;
  store.delete(otherCookie); assert.throws(() => store.get(otherCookie));
});
test('limiter rejects exhaustion and allows the next time window', () => {
  let now = 0; const limiter = new WindowLimiter(2, 1000, () => now);
  limiter.take('client'); limiter.take('client'); assert.throws(() => limiter.take('client'), /Too many/);
  limiter.take('admin'); now = 1001; assert.doesNotThrow(() => limiter.take('client'));
});
test('configuration rejects unsafe durations, short passwords and duplicate role passwords', () => {
  assert.throws(() => readConfig({ VOICE_MAX_SESSION_SECONDS: '9999' }));
  assert.throws(() => readConfig({ DEMO_CLIENT_PASSWORD: '123' }));
  assert.throws(() => readConfig({ DEMO_CLIENT_PASSWORD: 'abcdefghijklmnop', DEMO_ADMIN_PASSWORD: 'abcdefghijklmnop' }));
});
test('inline session uses one function tool, English and no stored-agent ID', () => {
  const session = inlineSession(branchNow(new Date('2026-09-23T00:00:00Z')));
  assert.equal('agent_id' in session, false); assert.equal(session.tools.length, 1);
  assert.equal(session.tools[0].name, 'get_services'); assert.deepEqual(session.input.language_codes, ['en']);
  assert.match(session.system_prompt, /NOT a scheduling system/); assert.match(session.system_prompt, /2026-09-23/);
});
test('mint token calls only the documented endpoint with server credentials and limits', async () => {
  let captured;
  const result = await mintVoiceToken(config(), async (url, options) => {
    captured = { url, options }; return Response.json({ token: 'temporary-test-token', expires_in_seconds: 60 });
  });
  assert.equal(captured.url.origin, 'https://agents.assemblyai.com'); assert.equal(captured.url.pathname, '/v1/token');
  assert.equal(captured.url.searchParams.get('max_session_duration_seconds'), '180');
  assert.equal(captured.options.headers.Authorization, 'Bearer unit-test-secret-not-a-real-key');
  assert.equal(captured.options.redirect, 'error'); assert.equal(result.token, 'temporary-test-token');
  assert.equal(JSON.stringify(result).includes(config().apiKey), false);
});
test('missing key fails before any provider request; there is no voice mock fallback', async () => {
  let called = false;
  await assert.rejects(mintVoiceToken(readConfig({}), () => { called = true; }), { code: 'KEY_NOT_CONFIGURED' });
  assert.equal(called, false);
});
test('provider errors cannot leak their response body or the key', async () => {
  const secret = config().apiKey;
  await assert.rejects(mintVoiceToken(config(), async () => new Response(`Secret: ${secret}`, { status: 403 })), error => {
    assert.equal(error.code, 'PROVIDER_ACCESS_DENIED'); assert.equal(error.message.includes(secret), false); return true;
  });
});
test('network failures and malformed provider token replies are reported honestly', async () => {
  await assert.rejects(mintVoiceToken(config(), async () => { throw new Error('private network diagnostic'); }), { code: 'PROVIDER_UNREACHABLE' });
  await assert.rejects(mintVoiceToken(config(), async () => Response.json({ hello: 'world' })), { code: 'PROVIDER_ERROR' });
});
