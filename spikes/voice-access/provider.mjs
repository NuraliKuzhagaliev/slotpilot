import { AppError } from './config.mjs';
export const PROVIDER_TOKEN_URL = 'https://agents.assemblyai.com/v1/token';
export async function mintVoiceToken(config, fetchImpl = fetch) {
  if (!config.apiKey) throw new AppError('KEY_NOT_CONFIGURED', 'Set ASSEMBLYAI_API_KEY in the server .env.local and restart the probe.', 503);
  const url = new URL(PROVIDER_TOKEN_URL);
  url.searchParams.set('expires_in_seconds', String(config.tokenTtlSeconds));
  url.searchParams.set('max_session_duration_seconds', String(config.maxSessionSeconds));
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${config.apiKey}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
  } catch {
    throw new AppError('PROVIDER_UNREACHABLE', 'Cannot reach AssemblyAI. Check the network and account status; no simulated voice was started.', 502);
  }
  // Never forward provider bodies or headers: they may contain sensitive diagnostics.
  if (!response.ok) {
    const auth = [401, 403].includes(response.status);
    throw new AppError(auth ? 'PROVIDER_ACCESS_DENIED' : 'PROVIDER_ERROR', auth
      ? 'AssemblyAI rejected access. Verify that this key has Voice Agent API access and account credits.'
      : 'AssemblyAI could not issue a token. Check account limits and retry later.', 502);
  }
  let body;
  try { body = await response.json(); } catch { throw new AppError('PROVIDER_ERROR', 'AssemblyAI returned an invalid token response.', 502); }
  if (typeof body?.token !== 'string' || !body.token || body.token.length > 16000)
    throw new AppError('PROVIDER_ERROR', 'AssemblyAI returned no usable temporary token.', 502);
  return { token: body.token, expiresInSeconds: config.tokenTtlSeconds, maxSessionSeconds: config.maxSessionSeconds };
}
