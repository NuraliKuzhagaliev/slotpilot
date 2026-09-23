/** Secret keys are not JWTs. Keep this helper on the server. */
export function supabaseHeaders(key){return {apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}), 'Content-Type':'application/json'}}
