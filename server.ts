import express from 'express';
import next from 'next';
import { createServer } from 'http';
import { Server } from 'socket.io';
import crypto from 'crypto';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import dotenv from 'dotenv';
import * as pty from 'node-pty';
import { createFileManagerRouter } from './lib/file-manager-router';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

dotenv.config({ path: path.join(process.cwd(), '.env'), override: false, quiet: true });

const dev = process.env.NODE_ENV !== 'production';
const backendOnly = process.argv.includes('--backend');
const nextApp = backendOnly ? null : next({ dev });
const handle = nextApp?.getRequestHandler();
const FILE_MANAGER_ROOT = path.resolve(process.env.FILE_MANAGER_ROOT || process.cwd());
const FILE_MANAGER_TRASH_DIR = path.resolve(process.env.FILE_MANAGER_TRASH_DIR || path.join(process.cwd(), '.terminal-trash'));
const FILE_MANAGER_SNAPSHOT_DIR = path.resolve(process.env.FILE_MANAGER_SNAPSHOT_DIR || path.join(process.cwd(), '.terminal-snapshots'));
const SESSION_COOKIE = 'terminal_session';
const STEP_UP_COOKIE = 'terminal_step_up';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const STEP_UP_TTL_MS = 5 * 60 * 1000;
const COMPROMISED_PASSWORD_SALT = 'ed74ba34ba1f20c6b1412f49bc818008';
const COMPROMISED_PASSWORD_HASH = 'b2a92f363ad27b41f5a5080674cd20c400940abbe6cfe2ab17eb6175375f735f';
const execFileAsync = promisify(execFile);
type Role = 'viewer' | 'operator' | 'admin' | 'root';
type StoredUser = { id: string; username: string; passwordHash: string; legacySalt?: string; role: Role; enabled: boolean; createdAt: number; totpSecret?: string; recoveryCodes?: string[]; pendingTotpSecret?: string };
type StoredSession = { tokenHash: string; userId: string; createdAt: number; expiresAt: number; ip: string; userAgent: string };
type AuditLevel = 'info' | 'warning' | 'critical';
type AuditResult = 'success' | 'failure';
type AuditEntry = { id: number; category: string; action: string; event: string; level: AuditLevel; result: AuditResult; ip: string; sessionId?: string; metadata?: Record<string, unknown>; timestamp: string; previousHash: string; hash: string };

// Pure JavaScript File-Based Database to bypass binary sqlite3 GLIBC errors
const DB_FILE = path.join(process.cwd(), 'terminal_database.json');

class JsonDatabase {
  private data: {
    settings: Record<string, string>;
    terminal_settings: Record<string, string>;
    logs: AuditEntry[];
    sessions: StoredSession[];
    users: StoredUser[];
  };

  constructor() {
    this.data = {
      settings: {},
      terminal_settings: {},
      logs: [],
      sessions: [],
      users: []
    };
    this.load();
  }

  private load() {
    if (fs.existsSync(DB_FILE)) {
      try {
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(fileContent);
        if (!this.data.settings || typeof this.data.settings !== 'object') this.data.settings = {};
        if (!this.data.terminal_settings || typeof this.data.terminal_settings !== 'object') this.data.terminal_settings = {};
        if (!Array.isArray(this.data.sessions) || this.data.sessions.some(session => typeof session === 'string')) this.data.sessions = [];
        else this.data.sessions = this.data.sessions.map(session => ({ ...session, userId: session.userId || 'root', createdAt: session.createdAt || Date.now(), ip: session.ip || 'unknown', userAgent: session.userAgent || 'unknown' }));
        if (!Array.isArray(this.data.users)) this.data.users = [];
        if (!Array.isArray(this.data.logs)) this.data.logs = [];
        this.data.logs = this.data.logs.map((entry: any, index) => this.normalizeAuditEntry(entry, index));
      } catch (err) {
        throw new Error(`Cannot load database ${DB_FILE}; refusing to start with empty data`, { cause: err });
      }
    } else {
      this.save();
    }
  }

  private save() {
    const tempFile = `${DB_FILE}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tempFile, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(tempFile, DB_FILE);
      if (process.platform !== 'win32') fs.chmodSync(DB_FILE, 0o600);
    } catch (err) {
      try { fs.rmSync(tempFile, { force: true }); } catch { /* Preserve the original persistence error. */ }
      throw new Error(`Cannot save database ${DB_FILE}`, { cause: err });
    }
  }

  private normalizeAuditEntry(entry: any, index: number): AuditEntry {
    return {
      id: Number(entry.id) || index + 1,
      category: entry.category || 'legacy', action: entry.action || 'event', event: String(entry.event || 'Unknown event'),
      level: entry.level || 'info', result: entry.result || 'success', ip: String(entry.ip || 'unknown'),
      sessionId: entry.sessionId, metadata: entry.metadata, timestamp: entry.timestamp || new Date().toISOString(),
      previousHash: entry.previousHash || '', hash: entry.hash || ''
    };
  }

  addAudit(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'previousHash' | 'hash'>) {
    this.load();
    const previousHash = this.data.logs.at(-1)?.hash || '';
    const base = { id: (this.data.logs.at(-1)?.id || 0) + 1, ...entry, timestamp: new Date().toISOString(), previousHash };
    const hash = crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex');
    this.data.logs.push({ ...base, hash });
    this.save();
  }

  queryAudit(filters: { query?: string; category?: string; level?: string; result?: string; offset: number; limit: number }) {
    this.load();
    const query = filters.query?.toLocaleLowerCase();
    const items = [...this.data.logs].reverse().filter(entry =>
      (!query || `${entry.event} ${entry.action} ${entry.ip} ${JSON.stringify(entry.metadata || {})}`.toLocaleLowerCase().includes(query)) &&
      (!filters.category || entry.category === filters.category) && (!filters.level || entry.level === filters.level) && (!filters.result || entry.result === filters.result)
    );
    return { total: items.length, items: items.slice(filters.offset, filters.offset + filters.limit) };
  }

  verifyAuditIntegrity() {
    let checked = 0;
    let previousHash = '';
    for (const entry of this.data.logs) {
      if (!entry.hash) continue;
      const { hash, ...base } = entry;
      if (entry.previousHash !== previousHash || crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex') !== hash) return { valid: false, checked, brokenAt: entry.id };
      previousHash = hash;
      checked++;
    }
    return { valid: true, checked };
  }

  async exec(sql: string) {
    // No-op for CREATE TABLE as structure is handled in memory
    return this;
  }

  async get(sql: string, ...params: any[]) {
    this.load();
    const normalized = sql.toLowerCase().trim();
    
    if (normalized.includes('select value from settings where key =')) {
      const key = params[0];
      const val = this.data.settings[key];
      return val !== undefined ? { value: val } : undefined;
    }
    
    if (normalized.includes('select value from terminal_settings where key =')) {
      const key = params[0];
      const val = this.data.terminal_settings[key];
      return val !== undefined ? { value: val } : undefined;
    }
    
    return undefined;
  }

  async run(sql: string, ...params: any[]) {
    this.load();
    const normalized = sql.toLowerCase().trim();

    if (normalized.includes('insert into settings') || normalized.includes('insert or replace into settings') || normalized.includes('update settings set value')) {
      if (normalized.includes('insert into settings') || normalized.includes('insert or replace into settings')) {
        const key = params[0];
        const val = params[1];
        this.data.settings[key] = val;
      } else {
        const val = params[0];
        const key = params[1];
        this.data.settings[key] = val;
      }
      this.save();
      return { lastID: 1, changes: 1 };
    }

    if (normalized.includes('insert or replace into terminal_settings') || normalized.includes('insert into terminal_settings')) {
      const key = params[0];
      const val = params[1];
      this.data.terminal_settings[key] = val;
      this.save();
      return { lastID: 1, changes: 1 };
    }

    if (normalized.includes('insert into logs')) {
      const event = params[0];
      const ip = params[1];
      this.addAudit({ category: 'legacy', action: 'event', event, level: 'info', result: 'success', ip });
      return { lastID: this.data.logs.at(-1)?.id || 0, changes: 1 };
    }

    return { lastID: 0, changes: 0 };
  }

  async all(sql: string, ...params: any[]) {
    this.load();
    const normalized = sql.toLowerCase().trim();

    if (normalized.includes('select event, ip, timestamp from logs')) {
      return this.queryAudit({ offset: 0, limit: 50 }).items;
    }

    return [];
  }

  addSession(token: string, userId: string, ip = 'unknown', userAgent = 'unknown') {
    if (!this.data.sessions) this.data.sessions = [];
    this.data.sessions = this.data.sessions.filter(session => session.expiresAt > Date.now());
    this.data.sessions.push({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, ip, userAgent: userAgent.slice(0, 300) });
    this.save();
  }

  removeSession(token: string) {
    if (!this.data.sessions) return;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    this.data.sessions = this.data.sessions.filter(session => session.tokenHash !== tokenHash);
    this.save();
  }

  hasSession(token: string): boolean {
    if (!this.data.sessions) return false;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = this.data.sessions.find(session => session.tokenHash === tokenHash && session.expiresAt > Date.now());
    return Boolean(session && this.data.users.find(user => user.id === session.userId && user.enabled));
  }

  clearSessions() {
    this.data.sessions = [];
    this.save();
  }

  deleteSetting(key: string) {
    delete this.data.settings[key];
    this.save();
  }

  removeSessionById(id: string) {
    this.data.sessions = (this.data.sessions || []).filter(session => !session.tokenHash.startsWith(id));
    this.save();
  }

  getSessions(): StoredSession[] {
    return (this.data.sessions || []).filter(session => session.expiresAt > Date.now());
  }

  getSession(token: string): StoredSession | undefined {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    return this.getSessions().find(session => session.tokenHash === tokenHash);
  }

  getUsers(): StoredUser[] { return this.data.users || []; }
  getUserById(id: string): StoredUser | undefined { return this.data.users.find(user => user.id === id); }
  getUserByName(username: string): StoredUser | undefined { return this.data.users.find(user => user.username.toLowerCase() === username.toLowerCase()); }
  saveUser(user: StoredUser) { const index = this.data.users.findIndex(item => item.id === user.id); if (index >= 0) this.data.users[index] = user; else this.data.users.push(user); this.save(); }
  deleteUser(id: string) { this.data.users = this.data.users.filter(user => user.id !== id); this.data.sessions = this.data.sessions.filter(session => session.userId !== id); this.save(); }
  clearUserSessions(userId: string) { this.data.sessions = this.data.sessions.filter(session => session.userId !== userId); this.save(); }
}

// Mimic sqlite pack API
async function open(config: any) {
  return new JsonDatabase();
}

let db: any = null;

// Helper: check session via persistent database
function hasSession(token: string): boolean {
  return db ? db.hasSession(token) : false;
}
function sessionRole(token: string): Role | null { const session = db?.getSession(token); return session ? db.getUserById(session.userId)?.role || null : null; }

function cookieValue(cookieHeader: string | undefined, targetName: string): string {
  const cookies = String(cookieHeader || '').split(';');
  for (const cookie of cookies) {
    const [name, ...value] = cookie.trim().split('=');
    if (name === targetName) return decodeURIComponent(value.join('='));
  }
  return '';
}

function sessionToken(req: express.Request): string {
  return cookieValue(req.headers.cookie, SESSION_COOKIE);
}

function authenticated(req: express.Request): boolean {
  return Boolean(authContext(req));
}

function authContext(req: express.Request): { token: string; session: StoredSession; user: StoredUser } | null {
  const token = sessionToken(req); const session = token ? db?.getSession(token) : undefined; const user = session ? db?.getUserById(session.userId) : undefined;
  return session && user?.enabled ? { token, session, user } : null;
}

const roleRank: Record<Role, number> = { viewer: 0, operator: 1, admin: 2, root: 3 };
function isRole(value: unknown): value is Role { return typeof value === 'string' && value in roleRank; }
function requireRole(req: express.Request, res: express.Response, minimum: Role) {
  const context = authContext(req);
  if (!context) { res.status(401).json({ success: false, error: 'Unauthorized' }); return null; }
  if (roleRank[context.user.role] < roleRank[minimum]) { res.status(403).json({ success: false, error: 'Bạn không có quyền thực hiện thao tác này' }); return null; }
  return context;
}

function setSessionCookie(res: express.Response, token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

function clearSessionCookie(res: express.Response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

const stepUpGrants = new Map<string, { sessionHash: string; expiresAt: number }>();
function setStepUpCookie(req: express.Request, res: express.Response) {
  const grant = crypto.randomBytes(32).toString('base64url'); const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const now = Date.now();
  for (const [key, entry] of stepUpGrants) if (entry.expiresAt <= now) stepUpGrants.delete(key);
  while (stepUpGrants.size >= 10_000) stepUpGrants.delete(stepUpGrants.keys().next().value!);
  stepUpGrants.set(grant, { sessionHash: crypto.createHash('sha256').update(sessionToken(req)).digest('hex'), expiresAt: Date.now() + STEP_UP_TTL_MS });
  res.setHeader('Set-Cookie', `${STEP_UP_COOKIE}=${encodeURIComponent(grant)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${STEP_UP_TTL_MS / 1000}${secure}`);
}
function hasStepUp(req: express.Request): boolean {
  const grant = cookieValue(req.headers.cookie, STEP_UP_COOKIE);
  const entry = grant ? stepUpGrants.get(grant) : undefined; const token = sessionToken(req);
  return Boolean(entry && token && entry.expiresAt > Date.now() && entry.sessionHash === crypto.createHash('sha256').update(token).digest('hex'));
}

const previewTickets = new Map<string, { path: string; expiresAt: number; remainingUses: number }>();
const socketTickets = new Map<string, { expiresAt: number; userId: string }>();
const loginChallenges = new Map<string, { expiresAt: number; ip: string; userAgent: string; userId: string }>();
function createTicket<T extends { expiresAt: number }>(store: Map<string, T>, value: T): string {
  const now = Date.now();
  for (const [key, entry] of store) if (entry.expiresAt <= now) store.delete(key);
  while (store.size >= 10_000) store.delete(store.keys().next().value!);
  const ticket = crypto.randomBytes(32).toString('base64url');
  store.set(ticket, value);
  return ticket;
}
function consumePreviewTicket(ticket: string, filePath: string): boolean {
  const entry = previewTickets.get(ticket);
  if (!entry || entry.expiresAt <= Date.now() || entry.path !== filePath) return false;
  entry.remainingUses--;
  if (entry.remainingUses <= 0) previewTickets.delete(ticket);
  return true;
}
function consumeSocketTicket(ticket: string): string | null {
  const entry = socketTickets.get(ticket);
  socketTickets.delete(ticket);
  return entry && entry.expiresAt > Date.now() ? entry.userId : null;
}

async function verifyPassword(password: string, user?: StoredUser): Promise<boolean> {
  if (user?.passwordHash) {
    if (user.passwordHash.startsWith('$argon2')) return argon2.verify(user.passwordHash, password);
    if (!user.legacySalt) return false;
    const legacyHash = hashPassword(password, user.legacySalt); const valid = legacyHash.length === user.passwordHash.length && crypto.timingSafeEqual(Buffer.from(legacyHash), Buffer.from(user.passwordHash));
    if (valid) { user.passwordHash = await argon2.hash(password, { type: argon2.argon2id }); delete user.legacySalt; db.saveUser(user); }
    return valid;
  }
  const hashRow = await db.get('SELECT value FROM settings WHERE key = ?', 'password_hash');
  if (!hashRow) return false;
  if (hashRow.value.startsWith('$argon2')) return argon2.verify(hashRow.value, password);
  const saltRow = await db.get('SELECT value FROM settings WHERE key = ?', 'password_salt');
  if (!saltRow) return false;
  const legacyHash = hashPassword(password, saltRow.value);
  const valid = legacyHash.length === hashRow.value.length && crypto.timingSafeEqual(Buffer.from(legacyHash), Buffer.from(hashRow.value));
  if (valid) await db.run('UPDATE settings SET value = ? WHERE key = ?', await argon2.hash(password, { type: argon2.argon2id }), 'password_hash');
  return valid;
}

function encryptionKey(): Buffer | null {
  const value = process.env.AUTH_ENCRYPTION_KEY;
  return value && value.length >= 32 ? crypto.createHash('sha256').update(value).digest() : null;
}

function encryptSecret(secret: string): string {
  const key = encryptionKey();
  if (!key) throw Object.assign(new Error('AUTH_ENCRYPTION_KEY must contain at least 32 characters'), { status: 503 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64url')).join('.');
}

function decryptSecret(payload: string): string {
  const key = encryptionKey();
  if (!key) throw Object.assign(new Error('AUTH_ENCRYPTION_KEY is missing'), { status: 503 });
  const [iv, tag, encrypted] = payload.split('.').map(value => Buffer.from(value, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function requestInfo(req: express.Request) {
  return {
    ip: req.ip || req.socket.remoteAddress || 'unknown',
    userAgent: String(req.headers['user-agent'] || 'unknown')
  };
}

function audit(entry: { category: string; action: string; event: string; level?: AuditLevel; result?: AuditResult; ip: string; sessionId?: string; metadata?: Record<string, unknown> }) {
  db.addAudit({ level: 'info', result: 'success', ...entry });
}

function auditRequest(req: express.Request, entry: Omit<Parameters<typeof audit>[0], 'ip' | 'sessionId'>) {
  const token = sessionToken(req);
  const context = authContext(req);
  audit({ ...entry, ip: requestInfo(req).ip, sessionId: token ? crypto.createHash('sha256').update(token).digest('hex').slice(0, 16) : undefined, metadata: { username: context?.user.username, ...(entry.metadata || {}) } });
}

function redactCommand(command: string): string {
  return command.slice(0, 2000)
    .replace(/((?:password|passwd|token|secret|api[_-]?key)\s*[=:]\s*)([^\s]+)/gi, '$1[REDACTED]')
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]');
}

async function runSystemCommand(file: string, args: string[], timeout = 15_000) {
  if (process.platform === 'win32') throw Object.assign(new Error('Tính năng này chỉ hỗ trợ Linux'), { status: 501 });
  try { return await execFileAsync(file, args, { timeout, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }); }
  catch (error: any) { throw Object.assign(new Error(String(error.stderr || error.message).trim()), { status: error.code === 'ENOENT' ? 501 : 422 }); }
}

function validUnitName(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9@_.:-]{1,255}$/.test(value); }

function createSession(req: express.Request, res: express.Response, userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  const { ip, userAgent } = requestInfo(req);
  db.addSession(token, userId, ip, userAgent);
  setSessionCookie(res, token);
}

function recoveryHash(code: string): string {
  return crypto.createHash('sha256').update(code.replace(/\s|-/g, '').toUpperCase()).digest('hex');
}

async function verifySecondFactor(code: string, user: StoredUser): Promise<boolean> {
  if (!user.totpSecret || typeof code !== 'string') return false;
  const normalized = code.replace(/\s/g, '');
  if (/^\d{6}$/.test(normalized) && authenticator.check(normalized, decryptSecret(user.totpSecret))) return true;
  const hashes = user.recoveryCodes || [];
  const hash = recoveryHash(normalized);
  if (!hashes.includes(hash)) return false;
  user.recoveryCodes = hashes.filter(item => item !== hash); db.saveUser(user);
  return true;
}

// Simple rate limiter for auth endpoint: max 10 attempts per IP per 15 minutes
const authAttempts = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  const MAX_ATTEMPTS = 10;
  if (authAttempts.size >= 10_000) for (const [key, value] of authAttempts) if (value.resetAt <= now) authAttempts.delete(key);
  while (authAttempts.size >= 20_000) authAttempts.delete(authAttempts.keys().next().value!);
  const entry = authAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    authAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count++;
  return true;
}
function resetRateLimit(ip: string) {
  authAttempts.delete(ip);
}

function hashPassword(password: string, salt: string): string {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

async function initializeDatabase() {
  db = await open({
    filename: DB_FILE
  });

  // Create tables if they don't exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT,
      ip TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS terminal_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // New installations must receive an explicit password; there is no shared fallback credential.
  const dbPasswordHash = await db.get('SELECT value FROM settings WHERE key = ?', 'password_hash');
  const dbPasswordSalt = await db.get('SELECT value FROM settings WHERE key = ?', 'password_salt');
  const compromisedCredential = dbPasswordHash?.value === COMPROMISED_PASSWORD_HASH && dbPasswordSalt?.value === COMPROMISED_PASSWORD_SALT;
  const compromisedUsers = db.getUsers().filter((user: StoredUser) => user.passwordHash === COMPROMISED_PASSWORD_HASH && user.legacySalt === COMPROMISED_PASSWORD_SALT);
  let replacementHash: string | undefined;
  if (!dbPasswordHash || compromisedCredential) {
    const initialPassword = process.env.TERMINAL_PASSWORD;
    if (!initialPassword || initialPassword.length < 12 || initialPassword.toLowerCase() === 'admin') {
      throw new Error(`${compromisedCredential ? 'The committed admin credential is compromised' : 'No password is configured'}. Set TERMINAL_PASSWORD to a new password of at least 12 characters.`);
    }
    replacementHash = await argon2.hash(initialPassword, { type: argon2.argon2id });
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', 'password_hash', replacementHash);
    db.deleteSetting('password_salt');
    console.log(`[DB] ${compromisedCredential ? 'Replaced compromised credentials' : 'Initialized credentials'} from TERMINAL_PASSWORD.`);
  }

  if (compromisedUsers.length) {
    const initialPassword = process.env.TERMINAL_PASSWORD;
    if (!initialPassword || initialPassword.length < 12 || initialPassword.toLowerCase() === 'admin') {
      throw new Error('A user still has the committed admin credential. Set TERMINAL_PASSWORD to a new password of at least 12 characters.');
    }
    replacementHash ||= await argon2.hash(initialPassword, { type: argon2.argon2id });
    for (const user of compromisedUsers) {
      user.passwordHash = replacementHash;
      delete user.legacySalt;
      db.saveUser(user);
      db.clearUserSessions(user.id);
    }
    console.log(`[DB] Replaced compromised credentials for ${compromisedUsers.length} user(s) and revoked their sessions.`);
  }

  if (!db.getUsers().length) {
    const passwordRow = await db.get('SELECT value FROM settings WHERE key = ?', 'password_hash');
    const legacySalt = await db.get('SELECT value FROM settings WHERE key = ?', 'password_salt');
    const passwordHash = passwordRow?.value;
    const totpRow = await db.get('SELECT value FROM settings WHERE key = ?', 'totp_secret');
    const recoveryRow = await db.get('SELECT value FROM settings WHERE key = ?', 'recovery_codes');
    db.saveUser({ id: 'root', username: 'root', passwordHash, legacySalt: passwordHash?.startsWith('$argon2') ? undefined : legacySalt?.value, role: 'root', enabled: true, createdAt: Date.now(), totpSecret: totpRow?.value, recoveryCodes: recoveryRow ? JSON.parse(recoveryRow.value) : undefined });
    console.log('[DB] Migrated existing credentials to root user.');
  }

  // Set default terminal settings if not present
  const dbFontSize = await db.get('SELECT value FROM terminal_settings WHERE key = ?', 'font_size');
  if (!dbFontSize) {
    await db.run('INSERT INTO terminal_settings (key, value) VALUES (?, ?)', 'font_size', '14');
    await db.run('INSERT INTO terminal_settings (key, value) VALUES (?, ?)', 'theme', 'dark-classic');
  }

  console.log('[DB] Database tables verified & connected successfully.');
}

async function startServer() {
  await nextApp?.prepare();
  const expressApp = express();
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy) expressApp.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  const httpServer = createServer(expressApp);
  const authKeyLength = process.env.AUTH_ENCRYPTION_KEY?.length || 0;
  console.log(`[SECURITY] AUTH_ENCRYPTION_KEY: ${authKeyLength >= 32 ? 'configured' : authKeyLength ? `invalid (${authKeyLength} characters)` : 'missing'}`);
  
  // Set up socket.io server
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_ORIGIN || false,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE']
    }
  });

  expressApp.use(express.json({ limit: '2mb' }));

  if (backendOnly) {
    const allowedOrigin = process.env.FRONTEND_ORIGIN;
    if (!allowedOrigin) throw new Error('FRONTEND_ORIGIN is required in backend-only mode');
    expressApp.use((req, res, nextMiddleware) => {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name, X-Directory');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== allowedOrigin) return res.status(403).json({ success: false, error: 'Invalid request origin' });
      nextMiddleware();
    });
  }

  // Wait for database initialization
  try {
    await initializeDatabase();
  } catch (err) {
    console.error('[DB ERROR] Failed to initialize database:', err);
    throw err;
  }

  // --- API Routes ---

  // Auth check & login endpoint
  expressApp.post('/api/auth', async (req, res) => {
    try {
      const { username, password } = req.body;
      const clientIp = requestInfo(req).ip;

      if (!checkRateLimit(clientIp)) {
        audit({ category: 'auth', action: 'rate_limit', event: 'Auth blocked: Rate limit exceeded', level: 'critical', result: 'failure', ip: clientIp });
        return res.status(429).json({ success: false, error: 'Quá nhiều lần thử. Vui lòng đợi 15 phút.' });
      }

      if (!username || !password) {
        audit({ category: 'auth', action: 'login', event: 'Auth attempt failed: Missing password input', level: 'warning', result: 'failure', ip: clientIp });
        return res.status(400).json({ success: false, error: 'Password is required' });
      }

      const user = db.getUserByName(String(username));
      if (user?.enabled && await verifyPassword(password, user)) {
        resetRateLimit(clientIp);
        if (user.totpSecret) {
          const challenge = createTicket(loginChallenges, { expiresAt: Date.now() + 5 * 60_000, userId: user.id, ...requestInfo(req) });
          return res.json({ success: true, requiresTwoFactor: true, challenge });
        }
        createSession(req, res, user.id);
        audit({ category: 'auth', action: 'login', event: 'Login successful - Session started', ip: clientIp, metadata: { username: user.username } });
        return res.json({ success: true, user: { username: user.username, role: user.role } });
      } else {
        audit({ category: 'auth', action: 'login', event: 'Login failed: Incorrect password attempt', level: 'warning', result: 'failure', ip: clientIp });
        return res.status(401).json({ success: false, error: 'Incorrect password!' });
      }
    } catch (error: any) {
      console.error('[API AUTH ERROR]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  expressApp.post('/api/auth/2fa', async (req, res) => {
    const { challenge, code } = req.body || {};
    const entry = typeof challenge === 'string' ? loginChallenges.get(challenge) : undefined;
    if (!entry || entry.expiresAt <= Date.now() || entry.ip !== requestInfo(req).ip) return res.status(401).json({ success: false, error: 'Yêu cầu xác thực đã hết hạn' });
    if (!checkRateLimit(`2fa:${entry.ip}`)) return res.status(429).json({ success: false, error: 'Quá nhiều lần thử. Vui lòng đợi 15 phút.' });
    try {
      const user = db.getUserById(entry.userId);
      if (!user?.enabled || !await verifySecondFactor(code, user)) return res.status(401).json({ success: false, error: 'Mã xác thực không hợp lệ' });
      loginChallenges.delete(challenge);
      resetRateLimit(`2fa:${entry.ip}`);
      createSession(req, res, user.id);
      audit({ category: 'auth', action: 'two_factor_login', event: 'Two-factor login successful', ip: entry.ip });
      return res.json({ success: true, user: { username: user.username, role: user.role } });
    } catch (error: any) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  });

  // Verify session token
  expressApp.post('/api/auth/verify', (req, res) => {
    const context = authContext(req);
    if (context) {
      return res.json({ success: true, user: { username: context.user.username, role: context.user.role } });
    }
    return res.status(401).json({ success: false, error: 'Invalid or expired session token' });
  });

  // Fetch log history
  expressApp.get('/api/logs', async (req, res) => {
    try {
      if (!requireRole(req, res, 'admin')) return;

      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const history = db.queryAudit({ query: typeof req.query.q === 'string' ? req.query.q : undefined, category: typeof req.query.category === 'string' ? req.query.category : undefined, level: typeof req.query.level === 'string' ? req.query.level : undefined, result: typeof req.query.result === 'string' ? req.query.result : undefined, offset, limit });
      return res.json({ success: true, logs: history.items, total: history.total, offset, limit });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  expressApp.get('/api/logs/export', (req, res) => {
    if (!requireRole(req, res, 'admin')) return;
    const items = db.queryAudit({ query: typeof req.query.q === 'string' ? req.query.q : undefined, category: typeof req.query.category === 'string' ? req.query.category : undefined, level: typeof req.query.level === 'string' ? req.query.level : undefined, result: typeof req.query.result === 'string' ? req.query.result : undefined, offset: 0, limit: 20_000 }).items;
    if (req.query.format === 'csv') {
      const escape = (value: unknown) => {
        const text = String(value ?? '');
        const safe = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
        return `"${safe.replace(/"/g, '""')}"`;
      };
      const csv = ['timestamp,category,action,level,result,ip,sessionId,event,metadata', ...items.map((entry: AuditEntry) => [entry.timestamp, entry.category, entry.action, entry.level, entry.result, entry.ip, entry.sessionId, entry.event, JSON.stringify(entry.metadata || {})].map(escape).join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"'); return res.send('\uFEFF' + csv);
    }
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Disposition', 'attachment; filename="audit-log.json"'); return res.send(JSON.stringify(items, null, 2));
  });

  expressApp.get('/api/logs/integrity', (req, res) => {
    if (!requireRole(req, res, 'admin')) return;
    return res.json({ success: true, ...db.verifyAuditIntegrity() });
  });

  // Get terminal settings
  expressApp.get('/api/settings', async (req, res) => {
    try {
      if (!authenticated(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const fontSizeRow = await db.get('SELECT value FROM terminal_settings WHERE key = ?', 'font_size');
      const themeRow = await db.get('SELECT value FROM terminal_settings WHERE key = ?', 'theme');

      return res.json({
        success: true,
        settings: {
          fontSize: fontSizeRow ? fontSizeRow.value : '14',
          theme: themeRow ? themeRow.value : 'dark-classic'
        }
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // Save terminal settings
  expressApp.post('/api/settings', async (req, res) => {
    try {
      if (!authenticated(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { fontSize, theme } = req.body;
      if (fontSize) {
        await db.run('INSERT OR REPLACE INTO terminal_settings (key, value) VALUES (?, ?)', 'font_size', String(fontSize));
      }
      if (theme) {
        await db.run('INSERT OR REPLACE INTO terminal_settings (key, value) VALUES (?, ?)', 'theme', String(theme));
      }

      return res.json({ success: true, message: 'Settings saved successfully' });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // Change password endpoint
  expressApp.post('/api/settings/password', async (req, res) => {
    try {
      const context = authContext(req); if (!context) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, error: 'Both current and new passwords are required' });
      }
      if (typeof newPassword !== 'string' || newPassword.length < 12) {
        return res.status(400).json({ success: false, error: 'New password must be at least 12 characters long' });
      }

      if (!await verifyPassword(currentPassword, context.user)) {
        return res.status(400).json({ success: false, error: 'Incorrect current password' });
      }

      // Update password hash and salt
      const newHash = await argon2.hash(newPassword, { type: argon2.argon2id });
      context.user.passwordHash = newHash; db.saveUser(context.user);
      db.clearUserSessions(context.user.id);
      const nextToken = crypto.randomBytes(32).toString('hex');
      const info = requestInfo(req); db.addSession(nextToken, context.user.id, info.ip, info.userAgent);
      setSessionCookie(res, nextToken);

      const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
      audit({ category: 'security', action: 'password_change', event: 'Master password was changed successfully', level: 'critical', ip: clientIp });

      return res.json({ success: true, message: 'Password updated successfully' });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // System metrics endpoint (CPU & RAM usage)
  expressApp.get('/api/metrics', async (req, res) => {
    try {
      if (!authenticated(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memPercent = Math.round((usedMem / totalMem) * 100);
      const diskPath = path.parse(process.cwd()).root;
      const disk = await fs.promises.statfs(diskPath);
      const diskTotal = Number(disk.blocks) * Number(disk.bsize);
      const diskFree = Number(disk.bavail) * Number(disk.bsize);
      const diskUsed = diskTotal - diskFree;

      // CPU usage: compare idle/total across a 200ms interval
      function getCpuTimes() {
        const cpus = os.cpus();
        let idle = 0, total = 0;
        for (const cpu of cpus) {
          for (const val of Object.values(cpu.times)) total += val;
          idle += cpu.times.idle;
        }
        return { idle, total };
      }
      const t1 = getCpuTimes();
      await new Promise(r => setTimeout(r, 200));
      const t2 = getCpuTimes();
      const idleDiff = t2.idle - t1.idle;
      const totalDiff = t2.total - t1.total;
      const cpuPercent = totalDiff === 0 ? 0 : Math.round((1 - idleDiff / totalDiff) * 100);

      return res.json({
        success: true,
        cpu: cpuPercent,
        memUsedMB: Math.round(usedMem / 1024 / 1024),
        memTotalMB: Math.round(totalMem / 1024 / 1024),
        memPercent,
        diskUsedGB: Math.round(diskUsed / 1024 / 1024 / 1024 * 10) / 10,
        diskTotalGB: Math.round(diskTotal / 1024 / 1024 / 1024 * 10) / 10,
        diskPercent: diskTotal === 0 ? 0 : Math.round(diskUsed / diskTotal * 100)
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // Log logout event
  expressApp.post('/api/auth/logout', async (req, res) => {
    try {
      const token = sessionToken(req);
      if (token) {
        db.removeSession(token);
        const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
        audit({ category: 'auth', action: 'logout', event: 'User logged out', ip: clientIp });
      }
      clearSessionCookie(res);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  expressApp.post('/api/auth/socket-ticket', (req, res) => {
    const context = requireRole(req, res, 'admin'); if (!context) return;
    return res.json({ success: true, ticket: createTicket(socketTickets, { expiresAt: Date.now() + 30_000, userId: context.user.id }) });
  });

  expressApp.post('/api/auth/preview-ticket', (req, res) => {
    if (!authenticated(req) || typeof req.body.path !== 'string') return res.status(401).json({ success: false, error: 'Unauthorized' });
    return res.json({ success: true, ticket: createTicket(previewTickets, { path: req.body.path, expiresAt: Date.now() + 60_000, remainingUses: 16 }) });
  });

  expressApp.post('/api/auth/step-up', async (req, res) => {
    const context = authContext(req); if (!context) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
      const rateKey = `step-up:${requestInfo(req).ip}`;
      if (!checkRateLimit(rateKey)) return res.status(429).json({ success: false, error: 'Quá nhiều lần thử. Vui lòng đợi 15 phút.' });
      const passwordValid = await verifyPassword(String(req.body?.password || ''), context.user);
      const secondFactorValid = !context.user.totpSecret || await verifySecondFactor(String(req.body?.code || ''), context.user);
      if (!passwordValid || !secondFactorValid) {
        auditRequest(req, { category: 'security', action: 'step_up', event: 'Step-up authorization failed', level: 'warning', result: 'failure' });
        return res.status(401).json({ success: false, error: 'Mật khẩu hoặc mã xác thực không đúng' });
      }
      resetRateLimit(rateKey);
      setStepUpCookie(req, res);
      auditRequest(req, { category: 'security', action: 'step_up', event: 'Step-up authorization granted', level: 'critical' });
      return res.json({ success: true, expiresIn: STEP_UP_TTL_MS / 1000 });
    } catch (error: any) { return res.status(error.status || 500).json({ success: false, error: error.message }); }
  });

  expressApp.get('/api/security', async (req, res) => {
    const context = authContext(req); if (!context) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const currentHash = crypto.createHash('sha256').update(sessionToken(req)).digest('hex');
    return res.json({
      success: true,
      twoFactorEnabled: Boolean(context.user.totpSecret),
      twoFactorAvailable: Boolean(encryptionKey()),
      recoveryCodesRemaining: context.user.recoveryCodes?.length || 0,
      sessions: db.getSessions().filter((session: StoredSession) => context.user.role === 'root' || session.userId === context.user.id).map((session: StoredSession) => ({ id: session.tokenHash.slice(0, 16), username: db.getUserById(session.userId)?.username || 'unknown', createdAt: session.createdAt, expiresAt: session.expiresAt, ip: session.ip, userAgent: session.userAgent, current: session.tokenHash === currentHash }))
    });
  });

  expressApp.post('/api/security/2fa/setup', async (req, res) => {
    const context = authContext(req); if (!context) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
      if (!await verifyPassword(req.body?.password, context.user)) return res.status(400).json({ success: false, error: 'Mật khẩu hiện tại không đúng' });
      const secret = authenticator.generateSecret();
      const issuer = process.env.TOTP_ISSUER || 'Terminal Admin';
      const uri = authenticator.keyuri(context.user.username, issuer, secret);
      context.user.pendingTotpSecret = encryptSecret(secret); db.saveUser(context.user);
      return res.json({ success: true, secret, qrCode: await QRCode.toDataURL(uri) });
    } catch (error: any) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  });

  expressApp.post('/api/security/2fa/confirm', async (req, res) => {
    const context = authContext(req); if (!context) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
      const pending = context.user.pendingTotpSecret;
      if (!pending || !authenticator.check(String(req.body?.code || ''), decryptSecret(pending))) return res.status(400).json({ success: false, error: 'Mã xác thực không hợp lệ' });
      const recoveryCodes = Array.from({ length: 10 }, () => `${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`);
      context.user.totpSecret = pending; context.user.recoveryCodes = recoveryCodes.map(recoveryHash); delete context.user.pendingTotpSecret; db.saveUser(context.user);
      auditRequest(req, { category: 'security', action: 'two_factor_enable', event: 'Two-factor authentication enabled', level: 'critical' });
      return res.json({ success: true, recoveryCodes });
    } catch (error: any) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  });

  expressApp.post('/api/security/2fa/disable', async (req, res) => {
    const context = authContext(req); if (!context) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
      if (!await verifyPassword(req.body?.password, context.user) || !await verifySecondFactor(req.body?.code, context.user)) return res.status(400).json({ success: false, error: 'Mật khẩu hoặc mã xác thực không đúng' });
      delete context.user.totpSecret; delete context.user.pendingTotpSecret; delete context.user.recoveryCodes; db.saveUser(context.user);
      auditRequest(req, { category: 'security', action: 'two_factor_disable', event: 'Two-factor authentication disabled', level: 'critical' });
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  });

  expressApp.delete('/api/security/sessions/:id', (req, res) => {
    const context = authContext(req); if (!context) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const currentHash = crypto.createHash('sha256').update(sessionToken(req)).digest('hex');
    if (currentHash.startsWith(req.params.id)) return res.status(400).json({ success: false, error: 'Hãy dùng đăng xuất để kết thúc phiên hiện tại' });
    const target = db.getSessions().find((session: StoredSession) => session.tokenHash.startsWith(req.params.id));
    if (!target || context.user.role !== 'root' && target.userId !== context.user.id) return res.status(404).json({ success: false, error: 'Không tìm thấy phiên' });
    db.removeSessionById(req.params.id);
    auditRequest(req, { category: 'security', action: 'session_revoke', event: 'Session revoked', level: 'warning', metadata: { sessionId: req.params.id } });
    return res.json({ success: true });
  });

  expressApp.delete('/api/security/sessions', (req, res) => {
    const context = authContext(req); if (!context) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const currentToken = sessionToken(req); const info = requestInfo(req);
    if (context.user.role === 'root') { db.clearSessions(); db.addSession(currentToken, context.user.id, info.ip, info.userAgent); }
    else { db.clearUserSessions(context.user.id); db.addSession(currentToken, context.user.id, info.ip, info.userAgent); }
    auditRequest(req, { category: 'security', action: 'sessions_revoke_others', event: 'All other sessions revoked', level: 'warning' });
    return res.json({ success: true });
  });

  expressApp.get('/api/users', (req, res) => {
    if (!requireRole(req, res, 'root')) return;
    return res.json({ success: true, users: db.getUsers().map((user: StoredUser) => ({ id: user.id, username: user.username, role: user.role, enabled: user.enabled, twoFactorEnabled: Boolean(user.totpSecret), createdAt: user.createdAt, sessions: db.getSessions().filter((session: StoredSession) => session.userId === user.id).length })) });
  });

  expressApp.post('/api/users', async (req, res) => {
    const context = requireRole(req, res, 'root'); if (!context) return;
    const username = String(req.body?.username || '').trim(); const password = String(req.body?.password || ''); const role = req.body?.role as Role;
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username) || password.length < 12 || !['viewer', 'operator', 'admin', 'root'].includes(role)) return res.status(400).json({ success: false, error: 'Username, mật khẩu hoặc vai trò không hợp lệ' });
    if (db.getUserByName(username)) return res.status(409).json({ success: false, error: 'Username đã tồn tại' });
    const user: StoredUser = { id: crypto.randomUUID(), username, passwordHash: await argon2.hash(password, { type: argon2.argon2id }), role, enabled: true, createdAt: Date.now() };
    db.saveUser(user); auditRequest(req, { category: 'security', action: 'user_create', event: 'User created', level: 'critical', metadata: { target: username, role } });
    return res.status(201).json({ success: true });
  });

  expressApp.patch('/api/users/:id', async (req, res) => {
    const context = requireRole(req, res, 'root'); if (!context) return;
    const user = db.getUserById(req.params.id); if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user' });
    if (user.id === 'root' && (req.body.role && req.body.role !== 'root' || req.body.enabled === false)) return res.status(400).json({ success: false, error: 'Không thể khóa hoặc hạ quyền tài khoản root' });
    if (req.body.role !== undefined) { if (!['viewer', 'operator', 'admin', 'root'].includes(req.body.role)) return res.status(400).json({ success: false, error: 'Vai trò không hợp lệ' }); user.role = req.body.role; }
    if (req.body.enabled !== undefined) user.enabled = Boolean(req.body.enabled);
    if (req.body.password !== undefined) { if (String(req.body.password).length < 12) return res.status(400).json({ success: false, error: 'Mật khẩu phải có ít nhất 12 ký tự' }); user.passwordHash = await argon2.hash(String(req.body.password), { type: argon2.argon2id }); db.clearUserSessions(user.id); }
    db.saveUser(user); auditRequest(req, { category: 'security', action: 'user_update', event: 'User updated', level: 'critical', metadata: { target: user.username, role: user.role, enabled: user.enabled } });
    return res.json({ success: true });
  });

  expressApp.delete('/api/users/:id', (req, res) => {
    if (!requireRole(req, res, 'root')) return;
    const user = db.getUserById(req.params.id); if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user' });
    if (user.id === 'root') return res.status(400).json({ success: false, error: 'Không thể xóa tài khoản root' });
    db.deleteUser(user.id); auditRequest(req, { category: 'security', action: 'user_delete', event: 'User deleted', level: 'critical', metadata: { target: user.username } });
    return res.json({ success: true });
  });

  expressApp.get('/api/system/services', async (req, res) => {
    if (!requireRole(req, res, 'admin')) return;
    try {
      const { stdout } = await runSystemCommand('systemctl', ['list-units', '--type=service', '--all', '--no-legend', '--no-pager', '--plain']);
      const services = stdout.split(/\r?\n/).filter(Boolean).map(line => {
        line = line.replace(/^\s*[●*]\s*/, '');
        const match = /^\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
        return match ? { unit: match[1], load: match[2], active: match[3], sub: match[4], description: match[5] } : null;
      }).filter(Boolean).slice(0, 1000);
      return res.json({ success: true, services });
    } catch (error: any) { return res.status(error.status || 500).json({ success: false, error: error.message }); }
  });

  expressApp.get('/api/system/services/:unit/logs', async (req, res) => {
    if (!requireRole(req, res, 'admin')) return;
    if (!validUnitName(req.params.unit)) return res.status(400).json({ success: false, error: 'Tên service không hợp lệ' });
    try {
      const lines = Math.min(500, Math.max(10, Number(req.query.lines) || 100));
      const { stdout } = await runSystemCommand('journalctl', ['-u', req.params.unit, '-n', String(lines), '--no-pager', '--output=short-iso'], 20_000);
      return res.json({ success: true, unit: req.params.unit, logs: stdout });
    } catch (error: any) { return res.status(error.status || 500).json({ success: false, error: error.message }); }
  });

  expressApp.post('/api/system/services/:unit/action', async (req, res) => {
    const context = requireRole(req, res, 'admin'); if (!context) return;
    if (!hasStepUp(req)) return res.status(428).json({ success: false, code: 'STEP_UP_REQUIRED', error: 'Điều khiển service yêu cầu xác nhận lại danh tính' });
    const action = req.body?.action; if (!validUnitName(req.params.unit) || !['start', 'stop', 'restart', 'enable', 'disable'].includes(action)) return res.status(400).json({ success: false, error: 'Service hoặc hành động không hợp lệ' });
    if (['stop', 'disable'].includes(action) && context.user.role !== 'root') return res.status(403).json({ success: false, error: 'Chỉ root được dừng hoặc disable service' });
    try {
      await runSystemCommand('systemctl', [action, req.params.unit], 30_000);
      auditRequest(req, { category: 'system', action: `service_${action}`, event: `Service ${action}: ${req.params.unit}`, level: ['stop', 'disable'].includes(action) ? 'critical' : 'warning', metadata: { unit: req.params.unit } });
      return res.json({ success: true });
    } catch (error: any) { auditRequest(req, { category: 'system', action: `service_${action}`, event: `Service action failed: ${req.params.unit}`, level: 'critical', result: 'failure', metadata: { unit: req.params.unit, error: error.message } }); return res.status(error.status || 500).json({ success: false, error: error.message }); }
  });

  expressApp.get('/api/system/processes', async (req, res) => {
    const context = requireRole(req, res, 'admin'); if (!context) return;
    try {
      const { stdout } = await runSystemCommand('ps', ['-eo', 'pid=,ppid=,user=,%cpu=,%mem=,rss=,etime=,args=', '--sort=-%cpu']);
      const processes = stdout.split(/\r?\n/).filter(Boolean).slice(0, 500).map(line => {
        const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
        return match ? { pid: Number(match[1]), ppid: Number(match[2]), user: match[3], cpu: Number(match[4]), memory: Number(match[5]), rssKB: Number(match[6]), elapsed: match[7], command: match[8] } : null;
      }).filter(Boolean);
      return res.json({ success: true, processes });
    } catch (error: any) { return res.status(error.status || 500).json({ success: false, error: error.message }); }
  });

  expressApp.post('/api/system/processes/:pid/signal', async (req, res) => {
    const context = requireRole(req, res, 'admin'); if (!context) return;
    if (!hasStepUp(req)) return res.status(428).json({ success: false, code: 'STEP_UP_REQUIRED', error: 'Gửi signal yêu cầu xác nhận lại danh tính' });
    const pid = Number(req.params.pid); const signal = req.body?.signal;
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid || !['SIGTERM', 'SIGKILL'].includes(signal)) return res.status(400).json({ success: false, error: 'PID hoặc signal không hợp lệ' });
    if (signal === 'SIGKILL' && context.user.role !== 'root') return res.status(403).json({ success: false, error: 'Chỉ root được gửi SIGKILL' });
    try {
      process.kill(pid, signal); auditRequest(req, { category: 'system', action: 'process_signal', event: `${signal} sent to process ${pid}`, level: signal === 'SIGKILL' ? 'critical' : 'warning', metadata: { pid, signal } }); return res.json({ success: true });
    } catch (error: any) { auditRequest(req, { category: 'system', action: 'process_signal', event: `Failed to signal process ${pid}`, level: 'critical', result: 'failure', metadata: { pid, signal, error: error.message } }); return res.status(error.code === 'ESRCH' ? 404 : 500).json({ success: false, error: error.message }); }
  });

  expressApp.use('/api/files', createFileManagerRouter({
    hasSession,
    sessionRole,
    hasStepUp,
    consumePreviewTicket,
    log: async (event, ip, details) => audit({ category: 'file', action: details?.action || event.split(':', 1)[0].slice(0, 80), event, level: details?.level || (/xóa|metadata|quyền/i.test(event) ? 'warning' : 'info'), result: details?.result || 'success', ip, metadata: details?.metadata }),
    rootDir: FILE_MANAGER_ROOT,
    trashDir: FILE_MANAGER_TRASH_DIR,
    snapshotDir: FILE_MANAGER_SNAPSHOT_DIR
  }));

  // --- Socket.io Terminal Implementation ---

  io.use((socket, nextFn) => {
    const ticket = socket.handshake.auth?.ticket;
      const userId = typeof ticket === 'string' ? consumeSocketTicket(ticket) : null;
      const user: StoredUser | undefined = userId ? db.getUserById(userId) : undefined;
      if (user?.enabled && isRole(user.role) && roleRank[user.role] >= roleRank.admin) {
        socket.data.user = { id: user.id, username: user.username, role: user.role };
        return nextFn();
      }
    console.log('[SOCKET] Rejecting unauthenticated socket connection attempt.');
    return nextFn(new Error('Authentication failed: Invalid terminal session token'));
  });

  io.on('connection', async (socket) => {
    const clientIp = socket.handshake.address || '127.0.0.1';
    console.log(`[SOCKET] User connected to terminal session. Socket ID: ${socket.id} | IP: ${clientIp}`);
    
    audit({ category: 'terminal', action: 'connect', event: 'Terminal process spawned', ip: clientIp, sessionId: socket.id, metadata: { username: socket.data.user?.username } });

    // Spawn shell process. On Windows: cmd.exe. On POSIX: bash or sh.
    const isWin = os.platform() === 'win32';
    const shellExec = isWin ? 'cmd.exe' : '/bin/bash';
    const args = isWin ? [] : ['-i']; // Interactive mode to force bash prompt
    let terminalCwd = process.cwd();
    const requestedCwd = socket.handshake.auth?.cwd ?? socket.handshake.query?.cwd;
    if (typeof requestedCwd === 'string') {
      const candidate = path.resolve(FILE_MANAGER_ROOT, requestedCwd.replace(/^[/\\]+/, ''));
      const relativeCandidate = path.relative(FILE_MANAGER_ROOT, candidate);
      try {
        if (!relativeCandidate.startsWith('..' + path.sep) && relativeCandidate !== '..' && !path.isAbsolute(relativeCandidate) && (await fs.promises.stat(candidate)).isDirectory()) terminalCwd = candidate;
        else throw new Error('CWD is not a directory');
      } catch {
        socket.emit('output', '\r\n\x1b[33m[SYSTEM] Requested working directory is invalid; using the server default.\x1b[0m\r\n');
      }
    }

    let shell: pty.IPty | null = null;
    let commandBuffer = '';
    let acceptingCommandInput = false;

    try {
      shell = pty.spawn(shellExec, args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: terminalCwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          LANG: 'en_US.UTF-8'
        }
      });
    } catch (err: any) {
      console.error('[SPAWN ERROR] Failed to spawn bash child process:', err);
      socket.emit('output', `\r\n\x1b[31;1m[SYSTEM ERROR] Failed to spawn local shell process: ${err.message}\x1b[0m\r\n`);
      socket.disconnect();
      return;
    }

    // Stream shell output back to frontend
    shell.onData((data) => {
      socket.emit('output', data);
      if (/(?:^|[\r\n])[^\r\n]*[#$]\s$/.test(data)) acceptingCommandInput = true;
    });

    // Handle clean close from the shell itself
    shell.onExit(async ({ exitCode }) => {
      console.log(`[SHELL] Shell process exited with code ${exitCode}. Socket ID: ${socket.id}`);
      socket.emit('output', `\r\n\r\n\x1b[33m[SHELL EXIT] Terminal process exited (code ${exitCode}). Closing connection...\x1b[0m\r\n`);
      audit({ category: 'terminal', action: 'exit', event: `Terminal shell exited with code ${exitCode}`, level: exitCode === 0 ? 'info' : 'warning', result: exitCode === 0 ? 'success' : 'failure', ip: clientIp, sessionId: socket.id, metadata: { exitCode } });
      socket.disconnect();
    });

    // Handle inputs from frontend
    socket.on('input', (data: string) => {
      for (const char of acceptingCommandInput ? data : '') {
        if (char === '\r' || char === '\n') {
          const command = commandBuffer.trim(); commandBuffer = '';
          if (command) audit({ category: 'terminal', action: 'command', event: 'Terminal command executed', ip: clientIp, sessionId: socket.id, metadata: { command: redactCommand(command), cwd: terminalCwd } });
          acceptingCommandInput = false;
        } else if (char === '\u007f') commandBuffer = commandBuffer.slice(0, -1);
        else if (char >= ' ' && commandBuffer.length < 2000) commandBuffer += char;
      }
      shell?.write(data);
    });

    socket.on('resize', ({ cols, rows }: { cols: number; rows: number }) => {
      if (!shell || !Number.isInteger(cols) || !Number.isInteger(rows)) return;
      shell.resize(Math.max(2, Math.min(cols, 500)), Math.max(1, Math.min(rows, 200)));
    });

    // Handle disconnect (CRITICAL security & cleanup step!)
    socket.on('disconnect', async () => {
      console.log(`[SOCKET] Socket disconnected. Forcefully killing active shell process: ${socket.id}`);
      
      if (shell) {
        try {
          // Send SIGKILL immediately to terminate shell process & avoid resource leakage
          shell.kill();
          console.log(`[CLEANUP] Successfully killed terminal shell process for Socket ID ${socket.id}`);
        } catch (err) {
          console.error(`[CLEANUP ERROR] Failed to kill terminal process for Socket ID ${socket.id}:`, err);
        }
        shell = null;
      }
      
      audit({ category: 'terminal', action: 'disconnect', event: 'Terminal session disconnected and process killed', ip: clientIp, sessionId: socket.id });
    });
  });


  // --- Next.js Pages routing fallback ---
  if (handle) {
    expressApp.all(/.*/, (req, res) => handle(req, res));
  }

  const port = backendOnly ? Number(process.env.BACKEND_PORT) || 3001 : Number(process.env.PORT) || 3000;
  httpServer.listen(port, () => {
    const mode = backendOnly ? 'Backend-only' : 'Full-stack Web Terminal';
    console.log(`> ${mode} server running on port ${port}`);
  });
}

startServer().catch((err) => {
  console.error('[STARTUP ERROR]', err);
  process.exit(1);
});
