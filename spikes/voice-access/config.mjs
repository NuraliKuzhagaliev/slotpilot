export class AppError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
function integer(env, key, fallback, min, max) {
  const value = Number(env[key] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new AppError('CONFIG_ERROR', `${key} must be an integer between ${min} and ${max}.`, 503);
  return value;
}
export function readConfig(env = process.env) {
  const passwords = { client: env.DEMO_CLIENT_PASSWORD ?? '', admin: env.DEMO_ADMIN_PASSWORD ?? '' };
  for (const [role, value] of Object.entries(passwords)) {
    if (value && value.length < 16) throw new AppError('CONFIG_ERROR', `${role} password must have at least 16 characters.`, 503);
  }
  if (passwords.client && passwords.client === passwords.admin)
    throw new AppError('CONFIG_ERROR', 'Client and administrator passwords must differ.', 503);
  return {
    apiKey: (env.ASSEMBLYAI_API_KEY ?? '').trim(), passwords,
    port: integer(env, 'PORT', 3000, 0, 65535),
    tokenTtlSeconds: integer(env, 'VOICE_TOKEN_TTL_SECONDS', 60, 1, 600),
    maxSessionSeconds: integer(env, 'VOICE_MAX_SESSION_SECONDS', 180, 60, 600),
    tokensPerWindow: integer(env, 'VOICE_TOKENS_PER_10_MINUTES', 3, 1, 10),
    tokensPerProcess: integer(env, 'VOICE_TOKENS_PER_PROCESS', 20, 1, 100),
  };
}
