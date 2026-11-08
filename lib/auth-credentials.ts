import crypto from 'node:crypto';

export function cookieValue(cookieHeader: string | undefined, targetName: string): string {
  for (const cookie of String(cookieHeader || '').split(';')) {
    const [name, ...value] = cookie.trim().split('=');
    if (name === targetName) {
      try { return decodeURIComponent(value.join('=')); } catch { return ''; }
    }
  }
  return '';
}

// An explicitly supplied Authorization header always takes precedence, including
// malformed headers: never silently fall back to a different user's cookie.
export function sessionCredential(authorization: string | undefined, cookie: string | undefined): string {
  if (authorization !== undefined) return /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(authorization)?.[1] || '';
  return cookieValue(cookie, 'terminal_session');
}

export class StepUpGrants {
  private grants = new Map<string, { sessionHash: string; expiresAt: number }>();
  constructor(private readonly ttlMs: number) {}
  issue(sessionToken: string): string {
    const now = Date.now();
    for (const [key, entry] of this.grants) if (entry.expiresAt <= now) this.grants.delete(key);
    while (this.grants.size >= 10_000) this.grants.delete(this.grants.keys().next().value!);
    const grant = crypto.randomBytes(32).toString('base64url');
    this.grants.set(grant, { sessionHash: this.hash(sessionToken), expiresAt: now + this.ttlMs });
    return grant;
  }
  valid(grant: string, sessionToken: string): boolean {
    const entry = this.grants.get(grant);
    return Boolean(entry && sessionToken && entry.expiresAt > Date.now() && entry.sessionHash === this.hash(sessionToken));
  }
  private hash(token: string): string { return crypto.createHash('sha256').update(token).digest('hex'); }
}
