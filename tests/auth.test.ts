import test from 'node:test';
import assert from 'node:assert/strict';
import { currentUser, login, signUp } from '../src/server/app/auth.ts';

test('personal sign-in preserves identity and only trusted app metadata grants admin', async () => {
  const previous = globalThis.fetch;
  const env = { url: process.env.SUPABASE_URL, secret: process.env.SESSION_SECRET, publishable: process.env.SUPABASE_PUBLISHABLE_KEY, dbKey: process.env.SUPABASE_SECRET_KEY };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  process.env.SESSION_SECRET = 'test-only-hmac-secret-which-is-at-least-32-characters';
  let role = 'client', signupBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/slotpilot_rate_limit')) return Response.json(true);
    if (url.endsWith('/signup')) { signupBody = JSON.parse(String(init?.body)); return Response.json({ user: { id: 'test-id', app_metadata: { role: 'admin' } } }); }
    if (url.includes('/token?')) return Response.json({ access_token: 'mock-token', user: { id: 'auth-user-1', app_metadata: { role } } });
    throw new Error('Unexpected endpoint');
  };
  try {
    const request = new Request('https://slotpilot.test/api/session', { headers: { origin: 'https://slotpilot.test' } });
    await signUp(request, 'someone@example.com', 'valid-password');
    assert.deepEqual(signupBody, { email: 'someone@example.com', password: 'valid-password' });
    const client = await login(request, 'someone@example.com', 'valid-password');
    assert.equal(client.user.role, 'client');
    assert.deepEqual(await currentUser(new Request(request.url, { headers: { cookie: client.cookie.split(';')[0] } })), client.user);
    role = 'admin';
    const admin = await login(request, 'someone@example.com', 'valid-password');
    assert.equal(admin.user.role, 'admin');
    assert.equal(await currentUser(new Request(request.url, { headers: { cookie: client.cookie.split(';')[0] + 'tamper' } })), null);
  } finally {
    globalThis.fetch = previous;
    for (const [name, value] of Object.entries({ SUPABASE_URL: env.url, SESSION_SECRET: env.secret, SUPABASE_PUBLISHABLE_KEY: env.publishable, SUPABASE_SECRET_KEY: env.dbKey })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
