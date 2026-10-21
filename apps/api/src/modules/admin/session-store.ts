export type AdminSession = { csrfToken: string; expiresAt: number };
export interface AdminSessionStore {
  reserveAttempt(ipKey: string, now: number): Promise<boolean>;
  clearAttempts(ipKey: string): Promise<void>;
  create(key: string, session: AdminSession, now: number): Promise<boolean>;
  get(key: string, now: number): Promise<AdminSession | null>;
  revoke(key: string): Promise<void>;
}

// Local development/test provider. Production selects PostgreSQL explicitly.
export class MemoryAdminSessionStore implements AdminSessionStore {
  private sessions = new Map<string, AdminSession>();
  private attempts = new Map<string, { count: number; expiresAt: number }>();
  private global = { count: 0, expiresAt: 0 };
  async reserveAttempt(key: string, now: number) {
    for (const [k, value] of this.attempts)
      if (value.expiresAt <= now) this.attempts.delete(k);
    if (this.global.expiresAt <= now)
      this.global = { count: 0, expiresAt: now + 60_000 };
    const value = this.attempts.get(key) ?? {
      count: 0,
      expiresAt: now + 15 * 60_000,
    };
    if (
      value.count >= 5 ||
      this.global.count >= 30 ||
      (this.attempts.size >= 10_000 && !this.attempts.has(key))
    )
      return false;
    value.count++;
    this.global.count++;
    this.attempts.set(key, value);
    return true;
  }
  async clearAttempts(key: string) {
    this.attempts.delete(key);
  }
  async create(key: string, session: AdminSession, now: number) {
    for (const [k, value] of this.sessions)
      if (value.expiresAt <= now) this.sessions.delete(k);
    if (this.sessions.size >= 1000) return false;
    this.sessions.set(key, session);
    return true;
  }
  async get(key: string, now: number) {
    const session = this.sessions.get(key);
    return session && session.expiresAt > now ? session : null;
  }
  async revoke(key: string) {
    this.sessions.delete(key);
  }
}
