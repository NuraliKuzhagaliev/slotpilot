import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AppError, readConfig } from './config.mjs';
import { SessionStore, WindowLimiter } from './auth.mjs';
import { parseToolCall } from './shared/contracts.mjs';
import { getServices, branchNow } from './catalog.mjs';
import { mintVoiceToken } from './provider.mjs';
import { inlineSession } from '../../agents/voice-access.mjs';

const STATIC_FILES = new Map([
  ['/', 'index.html'], ['/app.mjs', 'app.mjs'], ['/style.css', 'style.css'],
  ['/controller.mjs', 'controller.mjs'], ['/tool-queue.mjs', 'tool-queue.mjs'],
  ['/audio.mjs', 'audio.mjs'], ['/pcm.mjs', 'pcm.mjs'],
  ['/capture.worklet.mjs', 'capture.worklet.mjs'], ['/playback.worklet.mjs', 'playback.worklet.mjs'],
]);
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, {
    'Content-Type': type, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY', 'Permissions-Policy': 'microphone=(self), camera=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' wss://agents.assemblyai.com; img-src 'self' data:; media-src 'self' blob:; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...extra,
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('VALIDATION_ERROR', 'Send application/json.', 415);
  if (Number(req.headers['content-length'] ?? 0) > 16384) throw new AppError('VALIDATION_ERROR', 'Request body is too large.', 413);
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 16384) throw new AppError('VALIDATION_ERROR', 'Request body is too large.', 413);
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new AppError('VALIDATION_ERROR', 'Invalid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('VALIDATION_ERROR', 'Expected a JSON object.');
  return body;
}
function exactKeys(body, keys) {
  if (Object.keys(body).some(key => !keys.includes(key))) throw new AppError('VALIDATION_ERROR', 'Unexpected request field.');
}
// Loopback-only probe. This is not production auth, storage or a booking backend.
export function createProbeServer(config, { fetchImpl = fetch, clock = () => Date.now() } = {}) {
  const auth = new SessionStore(config.passwords, clock);
  const logins = new WindowLimiter(10, 300000, clock);
  const tokens = new WindowLimiter(config.tokensPerWindow, 600000, clock);
  let issuedAttempts = 0;
  const server = createServer(async (req, res) => {
    try {
      const port = server.address()?.port;
      if (![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(req.headers.host)) throw new AppError('NOT_AUTHORIZED', 'This access probe only accepts its loopback host.', 403);
      const origin = `http://${req.headers.host}`;
      if (req.method !== 'GET' && req.headers.origin !== origin) throw new AppError('NOT_AUTHORIZED', 'Same-origin request required.', 403);
      const url = new URL(req.url, origin);
      const path = url.pathname;
      if (req.method === 'GET' && STATIC_FILES.has(path)) {
        const file = STATIC_FILES.get(path);
        const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'text/javascript';
        return send(res, 200, await readFile(new URL(`public/${file}`, import.meta.url)), `${type}; charset=utf-8`);
      }
      if (req.method === 'GET' && path === '/api/status') return send(res, 200, {
        stage: 'voice-access-probe', localOnly: true, voiceProvider: 'AssemblyAI',
        apiKeyConfigured: Boolean(config.apiKey), authConfigured: Boolean(config.passwords.client),
        maxSessionSeconds: config.maxSessionSeconds, serverClock: branchNow(new Date(clock())),
        bookingEnabled: false, storageEnabled: false,
      });
      if (req.method === 'POST' && path === '/api/login') {
        logins.take(req.socket.remoteAddress ?? 'local');
        const body = await readBody(req); exactKeys(body, ['username', 'password']);
        if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.password.length > 256) throw new AppError('VALIDATION_ERROR', 'Username and password are required.');
        const { secret, session } = auth.create(body.username, body.password);
        return send(res, 200, { role: session.role, probeId: session.probeId }, undefined,
          { 'Set-Cookie': `slotpilot_probe=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600` });
      }
      if (req.method === 'POST' && path === '/api/logout') {
        await readBody(req); auth.delete(req.headers.cookie);
        return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': 'slotpilot_probe=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }
      if (req.method === 'GET' && path === '/api/session') {
        const session = auth.get(req.headers.cookie);
        return send(res, 200, { role: session.role, probeId: session.probeId });
      }
      if (req.method === 'POST' && path === '/api/voice/token') {
        const session = auth.get(req.headers.cookie);
        const body = await readBody(req); exactKeys(body, ['consent']);
        if (body.consent !== true) throw new AppError('CONSENT_REQUIRED', 'Confirm that microphone audio is sent to AssemblyAI before starting.', 400);
        if (!config.apiKey) throw new AppError('KEY_NOT_CONFIGURED', 'Set ASSEMBLYAI_API_KEY in .env.local and restart the server.', 503);
        tokens.take(session.username);
        if (issuedAttempts >= config.tokensPerProcess) throw new AppError('RATE_LIMITED', 'Local token-attempt cap reached. Review account usage before restarting.', 429);
        issuedAttempts++; // Failures count too; concurrent requests cannot bypass the cap.
        const token = await mintVoiceToken(config, fetchImpl);
        return send(res, 200, { ...token, websocketUrl: 'wss://agents.assemblyai.com/v1/ws', session: inlineSession(branchNow(new Date(clock()))) });
      }
      if (req.method === 'POST' && path === '/api/tools') {
        const session = auth.get(req.headers.cookie);
        let call;
        try { call = parseToolCall(await readBody(req)); }
        catch (e) { if (e instanceof AppError) throw e; throw new AppError('VALIDATION_ERROR', e.message); }
        const fingerprint = JSON.stringify(call.arguments);
        const previous = session.toolCalls.get(call.callId);
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new AppError('IDEMPOTENCY_MISMATCH', 'This callId was already used with different arguments.', 409);
          return send(res, 200, previous.result);
        }
        if (session.toolCalls.size >= 200) throw new AppError('RATE_LIMITED', 'Local session tool-call limit reached.', 429);
        const result = { ok: true, data: getServices(call.arguments.vehicleId), meta: {
          source: 'server-demo-catalog', scope: 'voice-access-probe', probeId: session.probeId,
          callId: call.callId, executedAt: new Date(clock()).toISOString(),
        } };
        session.toolCalls.set(call.callId, { fingerprint, result });
        return send(res, 200, result);
      }
      throw new AppError('NOT_FOUND', 'This endpoint is not implemented in the access probe.', 404);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const known = error instanceof AppError;
      send(res, known ? error.status : 500, { ok: false, error: {
        code: known ? error.code : 'INTERNAL_ERROR',
        message: known ? error.message : 'The local server could not complete the request.',
      } });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = readConfig();
    const server = createProbeServer(config);
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? 'Port is occupied. Change PORT in .env.local.' : 'Could not start the local server.');
      process.exitCode = 1;
    });
    server.listen(config.port, '127.0.0.1', () => {
      console.log(`SlotPilot access probe: http://localhost:${server.address().port}`);
      console.log('Stage 0 only. No database, bookings, paid requests or agent publishing on startup.');
      if (!config.passwords.client) console.log('Run npm run setup to generate demo sign-in credentials.');
      if (!config.apiKey) console.log('Voice disabled until ASSEMBLYAI_API_KEY is set in .env.local.');
    });
  } catch (error) { console.error(error instanceof AppError ? error.message : 'Configuration could not be loaded.'); process.exitCode = 1; }
}
