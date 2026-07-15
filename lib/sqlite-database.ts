import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';

export type Role = 'viewer' | 'operator' | 'admin' | 'root';
export type StoredUser = { id: string; username: string; passwordHash: string; legacySalt?: string; role: Role; enabled: boolean; createdAt: number; totpSecret?: string; recoveryCodes?: string[]; pendingTotpSecret?: string };
export type StoredSession = { tokenHash: string; userId: string; createdAt: number; expiresAt: number; ip: string; userAgent: string };
export type AuditLevel = 'info' | 'warning' | 'critical';
export type AuditResult = 'success' | 'failure';
export type AuditEntry = { id: number; category: string; action: string; event: string; level: AuditLevel; result: AuditResult; ip: string; sessionId?: string; metadata?: Record<string, unknown>; timestamp: string; previousHash: string; hash: string };

type LegacyData = {
  settings?: Record<string, string>;
  terminal_settings?: Record<string, string>;
  logs?: unknown[];
  sessions?: unknown[];
  users?: unknown[];
};

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

export class SqliteDatabase {
  private readonly database: DatabaseSync;
  private readonly auditHmacKey?: string;

  constructor(private readonly filename: string, legacyJsonFile?: string, private readonly sessionTtlMs = 12 * 60 * 60 * 1000, auditHmacKey?: string) {
    if (auditHmacKey && auditHmacKey.length < 32) throw new Error('AUDIT_HMAC_KEY must contain at least 32 characters');
    this.auditHmacKey = auditHmacKey;
    const databaseExisted = filename !== ':memory:' && fs.existsSync(filename);
    this.database = new DatabaseSync(filename);
    try {
      this.database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA trusted_schema = OFF;');
      this.createSchema();
      if (legacyJsonFile && fs.existsSync(legacyJsonFile) && this.isEmpty()) this.migrateLegacyJson(legacyJsonFile);
      if (process.platform !== 'win32' && filename !== ':memory:') fs.chmodSync(filename, 0o600);
    } catch (error) {
      this.database.close();
      if (!databaseExisted && filename !== ':memory:') {
        for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${filename}${suffix}`, { force: true });
      }
      throw error;
    }
  }

  close() { this.database.close(); }
  ping() { return Number((this.database.prepare('SELECT 1 AS ok').get() as { ok: number }).ok) === 1; }

  private createSchema() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS terminal_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL,
        legacy_salt TEXT, role TEXT NOT NULL CHECK (role IN ('viewer','operator','admin','root')),
        enabled INTEGER NOT NULL CHECK (enabled IN (0,1)), created_at INTEGER NOT NULL,
        totp_secret TEXT, recovery_codes TEXT, pending_totp_secret TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT NOT NULL, user_agent TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, action TEXT NOT NULL, event TEXT NOT NULL,
        level TEXT NOT NULL, result TEXT NOT NULL, ip TEXT NOT NULL, session_id TEXT, metadata TEXT,
        timestamp TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_logs_timestamp_idx ON audit_logs(timestamp DESC);
    `);
  }

  private isEmpty() {
    const tables = ['settings', 'terminal_settings', 'users', 'sessions', 'audit_logs'];
    return tables.every(table => Number((this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count) === 0);
  }

  private normalizeAuditEntry(value: unknown, index: number): AuditEntry {
    const entry = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
      id: Number(entry.id) || index + 1,
      category: String(entry.category || 'legacy'), action: String(entry.action || 'event'), event: String(entry.event || 'Unknown event'),
      level: (entry.level || 'info') as AuditLevel, result: (entry.result || 'success') as AuditResult, ip: String(entry.ip || 'unknown'),
      sessionId: typeof entry.sessionId === 'string' ? entry.sessionId : undefined,
      metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata as Record<string, unknown> : undefined,
      timestamp: String(entry.timestamp || new Date().toISOString()), previousHash: String(entry.previousHash || ''), hash: String(entry.hash || '')
    };
  }

  private migrateLegacyJson(legacyFile: string) {
    let data: LegacyData;
    try { data = JSON.parse(fs.readFileSync(legacyFile, 'utf8')) as LegacyData; }
    catch (error) { throw new Error(`Cannot migrate legacy database ${legacyFile}`, { cause: error }); }

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const insertSetting = this.database.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
      for (const [key, value] of Object.entries(data.settings || {})) insertSetting.run(key, String(value));
      const insertTerminalSetting = this.database.prepare('INSERT INTO terminal_settings (key, value) VALUES (?, ?)');
      for (const [key, value] of Object.entries(data.terminal_settings || {})) insertTerminalSetting.run(key, String(value));
      for (const value of Array.isArray(data.users) ? data.users : []) {
        const user = value as StoredUser;
        if (user?.id && user.username && user.passwordHash) this.saveUser(user);
      }
      const userIds = new Set(this.getUsers().map(user => user.id));
      const insertSession = this.database.prepare('INSERT OR IGNORE INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)');
      for (const value of Array.isArray(data.sessions) ? data.sessions : []) {
        const session = value as StoredSession;
        if (session?.tokenHash && userIds.has(session.userId)) insertSession.run(session.tokenHash, session.userId, session.createdAt || Date.now(), session.expiresAt || 0, session.ip || 'unknown', session.userAgent || 'unknown');
      }
      const insertAudit = this.database.prepare('INSERT INTO audit_logs (id, category, action, event, level, result, ip, session_id, metadata, timestamp, previous_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      (Array.isArray(data.logs) ? data.logs : []).map((entry, index) => this.normalizeAuditEntry(entry, index)).forEach(entry => insertAudit.run(entry.id, entry.category, entry.action, entry.event, entry.level, entry.result, entry.ip, entry.sessionId ?? null, entry.metadata ? JSON.stringify(entry.metadata) : null, entry.timestamp, entry.previousHash, entry.hash));
      this.database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(new Date().toISOString());
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw new Error(`Cannot migrate legacy database ${legacyFile}`, { cause: error });
    }

    const backup = `${legacyFile}.migrated-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    fs.renameSync(legacyFile, backup);
    if (process.platform !== 'win32') fs.chmodSync(backup, 0o600);
    console.log(`[DB] Migrated legacy JSON data to SQLite. Backup: ${backup}`);
  }

  async exec(sql: string) { this.database.exec(sql); return this; }
  async get(sql: string, ...params: SQLInputValue[]): Promise<{ value: string } | undefined> {
    const row = this.database.prepare(sql).get(...params) as Record<string, unknown> | undefined;
    return row?.value === undefined || row.value === null ? undefined : { value: String(row.value) };
  }
  async run(sql: string, ...params: SQLInputValue[]) {
    const result = this.database.prepare(sql).run(...params);
    return { lastID: Number(result.lastInsertRowid), changes: Number(result.changes) };
  }
  async all(sql: string, ...params: SQLInputValue[]) { return this.database.prepare(sql).all(...params); }

  private rowToUser(row: Record<string, unknown>): StoredUser {
    return { id: String(row.id), username: String(row.username), passwordHash: String(row.password_hash), legacySalt: row.legacy_salt ? String(row.legacy_salt) : undefined, role: row.role as Role, enabled: Boolean(row.enabled), createdAt: Number(row.created_at), totpSecret: row.totp_secret ? String(row.totp_secret) : undefined, recoveryCodes: parseJson<string[]>(row.recovery_codes, []), pendingTotpSecret: row.pending_totp_secret ? String(row.pending_totp_secret) : undefined };
  }

  private rowToSession(row: Record<string, unknown>): StoredSession {
    return { tokenHash: String(row.token_hash), userId: String(row.user_id), createdAt: Number(row.created_at), expiresAt: Number(row.expires_at), ip: String(row.ip), userAgent: String(row.user_agent) };
  }

  private rowToAudit(row: Record<string, unknown>): AuditEntry {
    return { id: Number(row.id), category: String(row.category), action: String(row.action), event: String(row.event), level: row.level as AuditLevel, result: row.result as AuditResult, ip: String(row.ip), sessionId: row.session_id ? String(row.session_id) : undefined, metadata: parseJson<Record<string, unknown> | undefined>(row.metadata, undefined), timestamp: String(row.timestamp), previousHash: String(row.previous_hash), hash: String(row.hash) };
  }

  private auditHash(base: Omit<AuditEntry, 'hash'>, keyed = Boolean(this.auditHmacKey)) {
    const hash = keyed ? crypto.createHmac('sha256', this.auditHmacKey!) : crypto.createHash('sha256');
    return hash.update(JSON.stringify(base)).digest('hex');
  }

  addAudit(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'previousHash' | 'hash'>) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.database.prepare('SELECT id, hash FROM audit_logs ORDER BY id DESC LIMIT 1').get() as { id: number; hash: string } | undefined;
      const sequence = this.database.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'audit_logs'").get() as { seq: number } | undefined;
      const base = { id: Math.max(Number(previous?.id || 0), Number(sequence?.seq || 0)) + 1, ...entry, timestamp: new Date().toISOString(), previousHash: previous?.hash || '' };
      const hash = this.auditHash(base);
      this.database.prepare('INSERT INTO audit_logs (id, category, action, event, level, result, ip, session_id, metadata, timestamp, previous_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(base.id, base.category, base.action, base.event, base.level, base.result, base.ip, base.sessionId ?? null, base.metadata ? JSON.stringify(base.metadata) : null, base.timestamp, base.previousHash, hash);
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  queryAudit(filters: { query?: string; category?: string; level?: string; result?: string; offset: number; limit: number }) {
    const conditions: string[] = []; const params: SQLInputValue[] = [];
    if (filters.query) { conditions.push("lower(event || ' ' || action || ' ' || ip || ' ' || coalesce(metadata, '')) LIKE ?"); params.push(`%${filters.query.toLocaleLowerCase()}%`); }
    for (const [column, value] of [['category', filters.category], ['level', filters.level], ['result', filters.result]] as const) if (value) { conditions.push(`${column} = ?`); params.push(value); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM audit_logs ${where}`).get(...params) as { count: number }).count);
    const rows = this.database.prepare(`SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, filters.limit, filters.offset) as Record<string, unknown>[];
    return { total, items: rows.map(row => this.rowToAudit(row)) };
  }

  verifyAuditIntegrity() {
    let checked = 0; let previousHash = ''; let legacyUnkeyed = 0;
    const entries = (this.database.prepare('SELECT * FROM audit_logs ORDER BY id').all() as Record<string, unknown>[]).map(row => this.rowToAudit(row));
    for (const entry of entries) {
      if (!entry.hash) continue;
      const { hash, ...base } = entry;
      const keyedValid = Boolean(this.auditHmacKey) && this.auditHash(base, true) === hash;
      const unkeyedValid = this.auditHash(base, false) === hash;
      if (entry.previousHash !== previousHash || !keyedValid && !unkeyedValid) return { valid: false, checked, brokenAt: entry.id, ...(this.auditHmacKey ? { legacyUnkeyed } : {}) };
      if (this.auditHmacKey && unkeyedValid) legacyUnkeyed++;
      previousHash = hash; checked++;
    }
    return { valid: true, checked, ...(this.auditHmacKey ? { legacyUnkeyed } : {}) };
  }

  pruneAudit(options: { retentionDays: number; maxEntries: number; now?: Date }) {
    const integrity = this.verifyAuditIntegrity();
    if (!integrity.valid) throw new Error(`Cannot prune an invalid audit chain (broken at entry ${'brokenAt' in integrity ? integrity.brokenAt : 'unknown'})`);
    const cutoff = options.retentionDays > 0 ? (options.now || new Date()).getTime() - options.retentionDays * 86_400_000 : -Infinity;
    let retained = (this.database.prepare('SELECT * FROM audit_logs ORDER BY id').all() as Record<string, unknown>[]).map(row => this.rowToAudit(row));
    if (options.retentionDays > 0) retained = retained.filter(entry => new Date(entry.timestamp).getTime() >= cutoff);
    if (options.maxEntries > 0 && retained.length > options.maxEntries) retained = retained.slice(-options.maxEntries);
    const total = Number((this.database.prepare('SELECT COUNT(*) AS count FROM audit_logs').get() as { count: number }).count);
    if (retained.length === total && (!this.auditHmacKey || (integrity.legacyUnkeyed || 0) === 0)) return { pruned: 0, retained: total };

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec('DELETE FROM audit_logs');
      const insert = this.database.prepare('INSERT INTO audit_logs (id, category, action, event, level, result, ip, session_id, metadata, timestamp, previous_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      let previousHash = '';
      for (const entry of retained) {
        const base = { ...entry, previousHash }; delete (base as Partial<AuditEntry>).hash;
        const hash = this.auditHash(base as Omit<AuditEntry, 'hash'>);
        insert.run(base.id!, base.category!, base.action!, base.event!, base.level!, base.result!, base.ip!, base.sessionId ?? null, base.metadata ? JSON.stringify(base.metadata) : null, base.timestamp!, previousHash, hash);
        previousHash = hash;
      }
      this.database.exec('COMMIT');
      return { pruned: total - retained.length, retained: retained.length };
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  addSession(token: string, userId: string, ip = 'unknown', userAgent = 'unknown') {
    const now = Date.now(); this.database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    this.database.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)').run(crypto.createHash('sha256').update(token).digest('hex'), userId, now, now + this.sessionTtlMs, ip, userAgent.slice(0, 300));
  }
  removeSession(token: string) { this.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(crypto.createHash('sha256').update(token).digest('hex')); }
  hasSession(token: string) { const session = this.getSession(token); return Boolean(session && this.getUserById(session.userId)?.enabled); }
  clearSessions() { this.database.exec('DELETE FROM sessions'); }
  deleteSetting(key: string) { this.database.prepare('DELETE FROM settings WHERE key = ?').run(key); }
  removeSessionById(id: string) { this.database.prepare('DELETE FROM sessions WHERE token_hash LIKE ?').run(`${id}%`); }
  getSessions() { return (this.database.prepare('SELECT * FROM sessions WHERE expires_at > ? ORDER BY created_at DESC').all(Date.now()) as Record<string, unknown>[]).map(row => this.rowToSession(row)); }
  getSession(token: string) { const row = this.database.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(crypto.createHash('sha256').update(token).digest('hex'), Date.now()) as Record<string, unknown> | undefined; return row ? this.rowToSession(row) : undefined; }
  getSessionByHash(tokenHash: string) { const row = this.database.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, Date.now()) as Record<string, unknown> | undefined; return row ? this.rowToSession(row) : undefined; }
  getUsers() { return (this.database.prepare('SELECT * FROM users ORDER BY created_at').all() as Record<string, unknown>[]).map(row => this.rowToUser(row)); }
  getUserById(id: string) { const row = this.database.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined; return row ? this.rowToUser(row) : undefined; }
  getUserByName(username: string) { const row = this.database.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) as Record<string, unknown> | undefined; return row ? this.rowToUser(row) : undefined; }
  saveUser(user: StoredUser) { this.database.prepare('INSERT INTO users (id, username, password_hash, legacy_salt, role, enabled, created_at, totp_secret, recovery_codes, pending_totp_secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash,legacy_salt=excluded.legacy_salt,role=excluded.role,enabled=excluded.enabled,created_at=excluded.created_at,totp_secret=excluded.totp_secret,recovery_codes=excluded.recovery_codes,pending_totp_secret=excluded.pending_totp_secret').run(user.id, user.username, user.passwordHash, user.legacySalt ?? null, user.role, user.enabled ? 1 : 0, user.createdAt, user.totpSecret ?? null, user.recoveryCodes ? JSON.stringify(user.recoveryCodes) : null, user.pendingTotpSecret ?? null); }
  deleteUser(id: string) { this.database.prepare('DELETE FROM users WHERE id = ?').run(id); }
  clearUserSessions(userId: string) { this.database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); }
}
