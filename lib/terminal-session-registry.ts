export type TerminalSession = {
  id: string;
  userId: string;
  sessionHash: string;
  disconnect: (reason: string) => void;
};

export type TerminalSessionRegistryOptions = {
  maxSessionsPerUser: number;
  idleTimeoutMs: number;
  maxLifetimeMs: number;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
};

type Entry = TerminalSession & {
  createdAt: number;
  lastActivityAt: number;
  idleTimer?: NodeJS.Timeout;
  lifetimeTimer?: NodeJS.Timeout;
};

export class TerminalSessionRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delay: number) => NodeJS.Timeout;
  private readonly clearTimer: (timer: NodeJS.Timeout) => void;

  constructor(private readonly options: TerminalSessionRegistryOptions) {
    if (!Number.isInteger(options.maxSessionsPerUser) || options.maxSessionsPerUser < 1) throw new Error('maxSessionsPerUser must be a positive integer');
    if (!Number.isFinite(options.idleTimeoutMs) || options.idleTimeoutMs < 0) throw new Error('idleTimeoutMs must be non-negative');
    if (!Number.isFinite(options.maxLifetimeMs) || options.maxLifetimeMs <= 0) throw new Error('maxLifetimeMs must be positive');
    this.now = options.now || Date.now;
    this.setTimer = options.setTimer || ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer || clearTimeout;
  }

  register(session: TerminalSession): boolean {
    if (this.entries.has(session.id)) return false;
    if (this.countForUser(session.userId) >= this.options.maxSessionsPerUser) return false;
    const now = this.now();
    const entry: Entry = { ...session, createdAt: now, lastActivityAt: now };
    this.entries.set(entry.id, entry);
    this.scheduleIdle(entry);
    entry.lifetimeTimer = this.setTimer(() => this.disconnect(entry.id, 'maximum lifetime exceeded'), this.options.maxLifetimeMs);
    entry.lifetimeTimer.unref?.();
    return true;
  }

  touch(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.lastActivityAt = this.now();
    this.scheduleIdle(entry);
    return true;
  }

  remove(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    if (entry.idleTimer) this.clearTimer(entry.idleTimer);
    if (entry.lifetimeTimer) this.clearTimer(entry.lifetimeTimer);
    return true;
  }

  disconnectSession(sessionHash: string, reason = 'session revoked') {
    return this.disconnectWhere(entry => entry.sessionHash === sessionHash, reason);
  }

  disconnectTerminal(id: string, reason: string) {
    return this.disconnect(id, reason);
  }

  disconnectUser(userId: string, reason = 'user access revoked', exceptSessionHash?: string) {
    return this.disconnectWhere(entry => entry.userId === userId && entry.sessionHash !== exceptSessionHash, reason);
  }

  disconnectAll(reason = 'server shutdown', exceptSessionHash?: string) {
    return this.disconnectWhere(entry => entry.sessionHash !== exceptSessionHash, reason);
  }

  countForUser(userId: string) {
    let count = 0;
    for (const entry of this.entries.values()) if (entry.userId === userId) count++;
    return count;
  }

  get size() { return this.entries.size; }

  private scheduleIdle(entry: Entry) {
    if (entry.idleTimer) this.clearTimer(entry.idleTimer);
    if (!this.options.idleTimeoutMs) return;
    const timer = this.setTimer(() => {
      if (this.entries.get(entry.id)?.idleTimer === timer) this.disconnect(entry.id, 'idle timeout exceeded');
    }, this.options.idleTimeoutMs);
    entry.idleTimer = timer;
    timer.unref?.();
  }

  private disconnect(id: string, reason: string) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.remove(id);
    entry.disconnect(reason);
    return true;
  }

  private disconnectWhere(predicate: (entry: Entry) => boolean, reason: string) {
    const ids = [...this.entries.values()].filter(predicate).map(entry => entry.id);
    for (const id of ids) this.disconnect(id, reason);
    return ids.length;
  }
}
