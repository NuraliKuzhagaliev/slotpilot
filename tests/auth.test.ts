import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSessionCookie, currentUser, login, recover, requireAdmin, resendConfirmation, resetPassword, signUp } from '../src/server/app/auth.ts';

test('personal sign-in preserves identity and only trusted app metadata grants admin', async () => {
  const previous = globalThis.fetch;
  const env = { url: process.env.SUPABASE_URL, secret: process.env.SESSION_SECRET, publishable: process.env.SUPABASE_PUBLISHABLE_KEY, dbKey: process.env.SUPABASE_SECRET_KEY };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  process.env.SESSION_SECRET = 'test-only-hmac-secret-which-is-at-least-32-characters';
  let role = 'client', updatedAt='2026-11-21T12:00:00Z', mailFailure=false;
  let signupBody: Record<string, unknown> | null = null, resendBody: Record<string, unknown> | null = null;
  let recoveryTarget:string|null=null;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/slotpilot_rate_limit')) return Response.json(true);
    if (url.endsWith('/signup')) { signupBody = JSON.parse(String(init?.body)); return Response.json({ user: { id: 'test-id', app_metadata: { role: 'admin' } } }); }
    if (url.endsWith('/resend')) { resendBody = JSON.parse(String(init?.body)); return Response.json({}, {status:mailFailure?503:200}); }
    if (url.includes('/recover?')) {
      recoveryTarget=new URL(url).searchParams.get('redirect_to');
      return Response.json({}, {status:mailFailure?503:200});
    }
    if (url.endsWith('/auth/v1/user')) {
      assert.equal(init?.method,'PUT');
      assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer recovery-fixture');
      assert.deepEqual(JSON.parse(String(init?.body)),{password:'new-test-password'});
      return Response.json({});
    }
    const account={id:'auth-user-1',updated_at:updatedAt,app_metadata:{role}};
    if (url.includes('/token?')) return Response.json({ access_token: 'mock-token', user: account });
    if (url.endsWith('/auth/v1/admin/users/auth-user-1')) return Response.json(account);
    throw new Error('Unexpected endpoint');
  };
  try {
    const request = new Request('https://slotpilot.test/api/session', { headers: { origin: 'https://slotpilot.test' } });
    await signUp(request, 'someone@example.com', 'valid-password');
    assert.deepEqual(signupBody, { email: 'someone@example.com', password: 'valid-password' });
    await resendConfirmation(request, 'someone@example.com');
    assert.deepEqual(resendBody, { email: 'someone@example.com',type:'signup' });
    await recover(request,'someone@example.com');
    assert.equal(recoveryTarget,'https://slotpilot.test/');
    await resetPassword(request,'recovery-fixture','new-test-password');
    assert.match(clearSessionCookie(request),/Max-Age=0; Secure$/);
    mailFailure=true;
    await assert.rejects(resendConfirmation(request,'someone@example.com'),{code:'PROVIDER_ERROR',status:502});
    await assert.rejects(recover(request,'someone@example.com'),{code:'PROVIDER_ERROR',status:502});
    const client = await login(request, 'someone@example.com', 'valid-password');
    assert.equal(client.user.role, 'client');
    assert.deepEqual(await currentUser(new Request(request.url, { headers: { cookie: client.cookie.split(';')[0] } })), client.user);
    role = 'admin';
    const admin = await login(request, 'someone@example.com', 'valid-password');
    assert.equal(admin.user.role, 'admin');
    const signedAdmin=new Request(request.url,{headers:{cookie:admin.cookie.split(';')[0]}});
    assert.deepEqual(await requireAdmin(signedAdmin),admin.user);
    role='client';
    await assert.rejects(requireAdmin(signedAdmin),{status:403});
    role='admin';
    updatedAt='2026-11-21T12:01:00Z';
    await assert.rejects(requireAdmin(signedAdmin),{status:403});
    assert.equal(await currentUser(new Request(request.url, { headers: { cookie: client.cookie.split(';')[0] + 'tamper' } })), null);
  } finally {
    globalThis.fetch = previous;
    for (const [name, value] of Object.entries({ SUPABASE_URL: env.url, SESSION_SECRET: env.secret, SUPABASE_PUBLISHABLE_KEY: env.publishable, SUPABASE_SECRET_KEY: env.dbKey })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
