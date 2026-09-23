import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { createProbeServer } from '../spikes/voice-access/server.mjs';
import { readConfig } from '../spikes/voice-access/config.mjs';
const clientPassword = 'test-only-client-password';
async function fixture(t, overrides = {}, dependencies = {}) {
  const config = readConfig({ DEMO_CLIENT_PASSWORD: clientPassword, DEMO_ADMIN_PASSWORD: 'test-only-admin-password', ...overrides });
  const server = createProbeServer(config, dependencies);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, cookie, extras = {}) => fetch(`${base}${path}`, { method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extras }, body: JSON.stringify(body) });
  const login = async () => {
    const response = await post('/api/login', { username: 'client', password: clientPassword });
    assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
  };
  return { base, post, login };
}
test('static UI loads, secrets are not served, and status makes no provider request', async t => {
  let called = false;
  const { base } = await fixture(t, {}, { fetchImpl: () => { called = true; } });
  const page = await fetch(base); assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const path of ['/.env.local', '/.env.example', '/server.mjs', '/package.json']) assert.equal((await fetch(base + path)).status, 404);
  const status = await (await fetch(base + '/api/status')).json();
  assert.equal(status.apiKeyConfigured, false); assert.equal(status.bookingEnabled, false); assert.equal(called, false);
});
test('tokens and tools require an authenticated session', async t => {
  const { post } = await fixture(t);
  assert.equal((await post('/api/voice/token', { consent: true })).status, 401);
  assert.equal((await post('/api/tools', { callId: 'x', name: 'get_services', arguments: {} })).status, 401);
});
test('cross-origin mutation and untrusted Host are denied', async t => {
  const { post, base } = await fixture(t);
  assert.equal((await post('/api/login', {}, null, { Origin: 'https://malicious.example' })).status, 403);
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(base + '/api/status', { headers: { Host: 'malicious.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(status, 403);
});
test('demo login sets an HttpOnly SameSite=Strict cookie; missing key produces a real error', async t => {
  const { post } = await fixture(t);
  const login = await post('/api/login', { username: 'client', password: clientPassword });
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await post('/api/voice/token', { consent: true }, cookie);
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'KEY_NOT_CONFIGURED');
});
test('catalogue checks are server results bound to the authenticated probe', async t => {
  const { post, login } = await fixture(t); const cookie = await login();
  const response = await post('/api/tools', { callId: 'read_1', name: 'get_services', arguments: {} }, cookie);
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.data.services.length, 4); assert.equal(result.meta.source, 'server-demo-catalog'); assert.ok(result.meta.probeId);
});
test('repeated tool calls return the identical result; a changed payload is rejected', async t => {
  const { post, login } = await fixture(t); const cookie = await login();
  const call = { callId: 'read_1', name: 'get_services', arguments: {} };
  const a = await (await post('/api/tools', call, cookie)).json();
  const b = await (await post('/api/tools', call, cookie)).json(); assert.deepEqual(a, b);
  const changed = await post('/api/tools', { ...call, arguments: { vehicleId: 'ev-demo' } }, cookie);
  assert.equal(changed.status, 409);
});
test('role and owner injection are rejected; unavailable write tools cannot be called', async t => {
  const { post, login } = await fixture(t); const cookie = await login();
  for (const body of [
    { callId: 'x', name: 'get_services', arguments: {}, role: 'admin' },
    { callId: 'x', name: 'get_services', arguments: { userId: 'someone-else' } },
    { callId: 'x', name: 'confirm_booking', arguments: { confirmed: true } },
  ]) assert.equal((await post('/api/tools', body, cookie)).status, 400);
});
test('local provider fixture verifies token mapping, server-only key and required consent', async t => {
  let calls = 0;
  const { post, login } = await fixture(t, { ASSEMBLYAI_API_KEY: 'not-a-real-test-api-key' }, {
    fetchImpl: async () => { calls++; return Response.json({ token: 'one-use-fixture-token' }); },
  });
  const cookie = await login();
  assert.equal((await post('/api/voice/token', { consent: false }, cookie)).status, 400); assert.equal(calls, 0);
  const response = await post('/api/voice/token', { consent: true }, cookie); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.token, 'one-use-fixture-token');
  assert.equal(JSON.stringify(body).includes('not-a-real-test-api-key'), false);
  assert.equal(body.session.tools[0].name, 'get_services'); assert.equal(body.session.agent_id, undefined);
});
test('token rate limit applies to the user across fresh logins', async t => {
  let calls = 0;
  const { post, login } = await fixture(t, { ASSEMBLYAI_API_KEY: 'test', VOICE_TOKENS_PER_10_MINUTES: '1' }, {
    fetchImpl: async () => { calls++; return Response.json({ token: 'fixture' }); },
  });
  const a = await login(), b = await login();
  assert.equal((await post('/api/voice/token', { consent: true }, a)).status, 200);
  assert.equal((await post('/api/voice/token', { consent: true }, b)).status, 429); assert.equal(calls, 1);
});
test('logout revokes the cookie and credentials never appear in normal responses', async t => {
  const { post, login, base } = await fixture(t); const cookie = await login();
  const session = await (await fetch(base + '/api/session', { headers: { Cookie: cookie } })).json();
  assert.equal(JSON.stringify(session).includes(clientPassword), false);
  await post('/api/logout', {}, cookie);
  assert.equal((await post('/api/tools', { callId: 'x', name: 'get_services', arguments: {} }, cookie)).status, 401);
});
