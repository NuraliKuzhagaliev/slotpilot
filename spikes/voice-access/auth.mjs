import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError } from './config.mjs';
const digest = value => createHash('sha256').update(value).digest();
export function safeEqual(a, b) { return timingSafeEqual(digest(a), digest(b)); }
export class WindowLimiter {
  constructor(limit, windowMs, clock = () => Date.now()) { this.limit = limit; this.windowMs = windowMs; this.clock = clock; this.entries = new Map(); }
  take(key) {
    const now = this.clock();
    for (const [id, row] of this.entries) if (row.until <= now) this.entries.delete(id);
    const row = this.entries.get(key) ?? { used: 0, until: now + this.windowMs };
    if (row.used >= this.limit) throw new AppError('RATE_LIMITED', 'Too many attempts. Try again after the rate-limit window.', 429);
    row.used++; this.entries.set(key, row);
  }
}
export class SessionStore {
  constructor(passwords, clock = () => Date.now()) { this.passwords = passwords; this.clock = clock; this.sessions = new Map(); }
  create(username, password) {
    const expected = Object.hasOwn(this.passwords, username) ? this.passwords[username] : '';
    if (!expected || !safeEqual(password, expected)) throw new AppError('NOT_AUTHORIZED', 'Incorrect demo username or password.', 401);
    for (const [key, value] of this.sessions) if (value.expiresAt <= this.clock()) this.sessions.delete(key);
    if (this.sessions.size >= 100) throw new AppError('RATE_LIMITED', 'Too many local sessions; restart the access probe.', 429);
    const secret = randomBytes(32).toString('base64url');
    const session = { username, role: username === 'admin' ? 'admin' : 'client', probeId: randomUUID(), expiresAt: this.clock() + 3600000, toolCalls: new Map() };
    this.sessions.set(digest(secret).toString('hex'), session);
    return { secret, session };
  }
  cookieSecret(header = '') {
    const cookies = header.split(';').map(v => v.trim());
    const value = cookies.find(v => v.startsWith('slotpilot_probe='))?.slice('slotpilot_probe='.length);
    return value && /^[\w-]{43}$/.test(value) ? value : null;
  }
  get(header) {
    const secret = this.cookieSecret(header);
    const key = secret && digest(secret).toString('hex');
    const session = key && this.sessions.get(key);
    if (!session || session.expiresAt <= this.clock()) {
      if (key) this.sessions.delete(key);
      throw new AppError('NOT_AUTHORIZED', 'Sign in to the local access probe first.', 401);
    }
    return session;
  }
  delete(header) { const secret = this.cookieSecret(header); if (secret) this.sessions.delete(digest(secret).toString('hex')); }
}
