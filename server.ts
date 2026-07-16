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
import { createSqliteManagerRouter } from './lib/sqlite-manager-router';
import { JobManager } from './lib/job-manager';
import { createOperationsRouter } from './lib/operations-router';
import { escapeCsvCell, validateRuntimeConfig } from './lib/security-utils';
import { SqliteDatabase, type AuditEntry, type AuditLevel, type AuditResult, type Role, type StoredSession, type StoredUser } from './lib/sqlite-database';
import { RequestMetricsCollector } from './lib/observability';
import { collectHostMetrics, collectSqliteHealth, collectSystemSummary } from './lib/overview';
import { TerminalSessionRegistry } from './lib/terminal-session-registry';
import { hasCapability, type Capability } from './lib/capabilities';
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
const SQLITE_MANAGER_ROOT = path.resolve(process.env.SQLITE_MANAGER_ROOT || FILE_MANAGER_ROOT);
const SQLITE_BROWSER_ROOT = path.resolve(process.env.SQLITE_BROWSER_ROOT || path.parse(process.cwd()).root);
const SQLITE_BACKUP_DIR = path.resolve(process.env.SQLITE_BACKUP_DIR || path.join(SQLITE_MANAGER_ROOT, '.terminal-sqlite-backups'));
const JOB_DATA_DIR = path.resolve(process.env.JOB_DATA_DIR || path.join(process.cwd(), '.terminal-jobs'));
const SESSION_COOKIE = 'terminal_session';
const STEP_UP_COOKIE = 'terminal_step_up';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const STEP_UP_TTL_MS = 5 * 60 * 1000;
const COMPROMISED_PASSWORD_SALT = 'ed74ba34ba1f20c6b1412f49bc818008';
const COMPROMISED_PASSWORD_HASH = 'b2a92f363ad27b41f5a5080674cd20c400940abbe6cfe2ab17eb6175375f735f';
const execFileAsync = promisify(execFile);
const DB_FILE = path.resolve(process.env.DATABASE_PATH || path.join(process.cwd(), 'terminal_database.sqlite'));
const LEGACY_DB_FILE = path.resolve(process.env.LEGACY_DATABASE_PATH || path.join(path.dirname(DB_FILE), 'terminal_database.json'));
let db: SqliteDatabase;

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

function requireCapability(req: express.Request, res: express.Response, capability: Capability) {
  const context = authContext(req);
  if (!context) { res.status(401).json({ success: false, error: 'Unauthorized' }); return null; }
  if (!hasCapability(context.user.role, capability)) { res.status(403).json({ success: false, error: 'Bạn không có quyền thực hiện thao tác này' }); return null; }
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
const socketTickets = new Map<string, { expiresAt: number; userId: string; sessionHash: string }>();
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
function consumeSocketTicket(ticket: string): { userId: string; sessionHash: string } | null {
  const entry = socketTickets.get(ticket);
  socketTickets.delete(ticket);
  return entry && entry.expiresAt > Date.now() ? { userId: entry.userId, sessionHash: entry.sessionHash } : null;
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
  db = new SqliteDatabase(DB_FILE, LEGACY_DB_FILE, SESSION_TTL_MS, process.env.AUDIT_HMAC_KEY);

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
    if (!passwordHash) throw new Error('Cannot create root user without a password hash');
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
  const runtimeConfig = validateRuntimeConfig({ frontendOrigin: process.env.FRONTEND_ORIGIN, encryptionKey: process.env.AUTH_ENCRYPTION_KEY, terminalPassword: process.env.TERMINAL_PASSWORD, production: !dev, backendOnly });
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy) expressApp.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  const httpServer = createServer(expressApp);
  const requestMetrics = new RequestMetricsCollector();
  const authKeyLength = process.env.AUTH_ENCRYPTION_KEY?.length || 0;
  console.log(`[SECURITY] AUTH_ENCRYPTION_KEY: ${authKeyLength >= 32 ? 'configured' : authKeyLength ? `invalid (${authKeyLength} characters)` : 'missing'}`);
  
  // Set up socket.io server
  const io = new Server(httpServer, {
    cors: {
      origin: runtimeConfig.frontendOrigin || false,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE']
    }
  });

  expressApp.disable('x-powered-by');
  expressApp.use((req, res, nextMiddleware) => {
    const requestId = crypto.randomUUID();
    const startedAt = process.hrtime.bigint();
    const completeRequest = req.path.startsWith('/api/') ? requestMetrics.start() : null;
    res.setHeader('X-Request-ID', requestId);
    res.locals.requestId = requestId;
    res.once('finish', () => completeRequest?.({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000
    }));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Security-Policy', `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; frame-src 'self' https:; form-action 'self'; script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: https:; font-src 'self' data:; connect-src 'self' https: wss:; worker-src 'self' blob:; manifest-src 'self'`);
    if (!dev) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    nextMiddleware();
  });
  expressApp.use(express.json({ limit: '2mb' }));

  if (backendOnly) {
    const allowedOrigin = runtimeConfig.frontendOrigin!;
    expressApp.use((req, res, nextMiddleware) => {
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name, X-Directory');
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== allowedOrigin) return res.status(403).json({ success: false, error: 'Invalid request origin' });
      nextMiddleware();
    });
  }

  expressApp.use('/api', (_req, res, nextMiddleware) => { res.setHeader('Cache-Control', 'no-store'); nextMiddleware(); });
  expressApp.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

  // Wait for database initialization
  try {
    await initializeDatabase();
  } catch (err) {
    console.error('[DB ERROR] Failed to initialize database:', err);
    throw err;
  }

  const numberConfig = (name: string, fallback: number) => {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
    return value;
  };
  const auditRetentionDays = numberConfig('AUDIT_RETENTION_DAYS', 90);
  const auditMaxEntries = numberConfig('AUDIT_MAX_ENTRIES', 100_000);
  const pruneAudit = () => {
    try {
      const result = db.pruneAudit({ retentionDays: auditRetentionDays, maxEntries: auditMaxEntries });
      if (result.pruned) console.log(`[AUDIT] Pruned ${result.pruned} entries; ${result.retained} retained.`);
    } catch (error) { console.error('[AUDIT] Retention prune skipped:', error); }
  };
  pruneAudit();
  const auditPruneTimer = setInterval(pruneAudit, 6 * 60 * 60 * 1000);
  auditPruneTimer.unref();
  const scheduledDatabases = (process.env.SQLITE_SCHEDULED_DATABASES || '').split(',').map(value => value.trim()).filter(Boolean);
  const jobManager = await JobManager.create({
    dataDir: JOB_DATA_DIR,
    sqliteRoot: SQLITE_MANAGER_ROOT,
    sqliteBrowserRoot: SQLITE_BROWSER_ROOT,
    sqliteBackupDir: SQLITE_BACKUP_DIR,
    historyLimit: numberConfig('JOB_HISTORY_LIMIT', 200),
    backupRetentionCount: numberConfig('SQLITE_BACKUP_RETENTION_COUNT', 10),
    alertWebhookUrl: process.env.ALERT_WEBHOOK_URL,
    alertWebhookHosts: (process.env.ALERT_WEBHOOK_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean),
    production: !dev
  });
  jobManager.startSchedule(numberConfig('SQLITE_BACKUP_SCHEDULE_MINUTES', 0), scheduledDatabases);
  const terminalRegistry = new TerminalSessionRegistry({
    maxSessionsPerUser: numberConfig('TERMINAL_MAX_SESSIONS_PER_USER', 3),
    idleTimeoutMs: numberConfig('TERMINAL_IDLE_TIMEOUT_MINUTES', 30) * 60_000,
    maxLifetimeMs: numberConfig('TERMINAL_MAX_LIFETIME_MINUTES', 480) * 60_000
  });

  expressApp.get('/readyz', (_req, res) => db?.ping() ? res.json({ status: 'ready' }) : res.status(503).json({ status: 'unavailable' }));

  // --- API Routes ---

  let overviewCache: { expiresAt: number; host: Awaited<ReturnType<typeof collectHostMetrics>>; system: Awaited<ReturnType<typeof collectSystemSummary>>; databases: Awaited<ReturnType<typeof collectSqliteHealth>> } | null = null;
  async function collectOverviewInfrastructure() {
    if (overviewCache && overviewCache.expiresAt > Date.now()) return overviewCache;
    const [host, system, databases] = await Promise.all([
      collectHostMetrics(),
      collectSystemSummary(),
      collectSqliteHealth(SQLITE_MANAGER_ROOT, DB_FILE)
    ]);
    overviewCache = { expiresAt: Date.now() + 15_000, host, system, databases };
    return overviewCache;
  }

  expressApp.get('/api/observability', async (req, res) => {
    if (!requireCapability(req, res, 'overview:read')) return;
    try {
      const { host } = await collectOverviewInfrastructure();
      return res.json({
        success: true,
        generatedAt: new Date().toISOString(),
        application: { uptimeSeconds: Math.floor(process.uptime()), startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() },
        host,
        api: requestMetrics.snapshot(),
        terminalConnections: io.sockets.sockets.size
      });
    } catch (error: any) { return res.status(500).json({ success: false, error: error.message }); }
  });

  expressApp.get('/api/overview', async (req, res) => {
    if (!requireCapability(req, res, 'overview:read')) return;
    try {
      const [{ host, system, databases }, critical, warning, recent] = await Promise.all([
        collectOverviewInfrastructure(),
        Promise.resolve(db.queryAudit({ level: 'critical', offset: 0, limit: 1 }).total),
        Promise.resolve(db.queryAudit({ level: 'warning', offset: 0, limit: 1 }).total),
        Promise.resolve(db.queryAudit({ offset: 0, limit: 8 }).items)
      ]);
      return res.json({
        success: true,
        generatedAt: new Date().toISOString(),
        application: { uptimeSeconds: Math.floor(process.uptime()), startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() },
        host,
        system,
        audit: {
          critical,
          warning,
          recent: recent.map(({ id, category, action, event, level, result, timestamp }) => ({ id, category, action, event, level, result, timestamp }))
        },
        sessions: { active: db.getSessions().length },
        databases,
        api: requestMetrics.snapshot(),
        terminalConnections: io.sockets.sockets.size
      });
    } catch (error: any) { return res.status(500).json({ success: false, error: error.message }); }
  });

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
      if (!requireCapability(req, res, 'audit:read')) return;

      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const history = db.queryAudit({ query: typeof req.query.q === 'string' ? req.query.q : undefined, category: typeof req.query.category === 'string' ? req.query.category : undefined, level: typeof req.query.level === 'string' ? req.query.level : undefined, result: typeof req.query.result === 'string' ? req.query.result : undefined, offset, limit });
      return res.json({ success: true, logs: history.items, total: history.total, offset, limit });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  expressApp.get('/api/logs/export', (req, res) => {
    if (!requireCapability(req, res, 'audit:read')) return;
    const items = db.queryAudit({ query: typeof req.query.q === 'string' ? req.query.q : undefined, category: typeof req.query.category === 'string' ? req.query.category : undefined, level: typeof req.query.level === 'string' ? req.query.level : undefined, result: typeof req.query.result === 'string' ? req.query.result : undefined, offset: 0, limit: 20_000 }).items;
    if (req.query.format === 'csv') {
      const csv = ['timestamp,category,action,level,result,ip,sessionId,event,metadata', ...items.map((entry: AuditEntry) => [entry.timestamp, entry.category, entry.action, entry.level, entry.result, entry.ip, entry.sessionId, entry.event, JSON.stringify(entry.metadata || {})].map(escapeCsvCell).join(','))].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"'); return res.send('\uFEFF' + csv);
    }
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Disposition', 'attachment; filename="audit-log.json"'); return res.send(JSON.stringify(items, null, 2));
  });

  expressApp.get('/api/logs/integrity', (req, res) => {
    if (!requireCapability(req, res, 'audit:read')) return;
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
      terminalRegistry.disconnectUser(context.user.id, 'password changed');
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

      const metrics = await collectHostMetrics();

      return res.json({
        success: true,
        cpu: metrics.cpu,
        memUsedMB: metrics.memory.usedMB,
        memTotalMB: metrics.memory.totalMB,
        memPercent: metrics.memory.percent,
        diskUsedGB: metrics.disk.usedGB,
        diskTotalGB: metrics.disk.totalGB,
        diskPercent: metrics.disk.percent
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
        const sessionHash = crypto.createHash('sha256').update(token).digest('hex');
        db.removeSession(token);
        terminalRegistry.disconnectSession(sessionHash, 'logout');
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
    const context = requireCapability(req, res, 'terminal:use'); if (!context) return;
    return res.json({ success: true, ticket: createTicket(socketTickets, { expiresAt: Date.now() + 30_000, userId: context.user.id, sessionHash: context.session.tokenHash }) });
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
    terminalRegistry.disconnectSession(target.tokenHash, 'session revoked');
    auditRequest(req, { category: 'security', action: 'session_revoke', event: 'Session revoked', level: 'warning', metadata: { sessionId: req.params.id } });
    return res.json({ success: true });
  });

  expressApp.delete('/api/security/sessions', (req, res) => {
    const context = authContext(req); if (!context) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const currentToken = sessionToken(req); const info = requestInfo(req);
    if (context.user.role === 'root') { db.clearSessions(); db.addSession(currentToken, context.user.id, info.ip, info.userAgent); terminalRegistry.disconnectAll('all sessions revoked', context.session.tokenHash); }
    else { db.clearUserSessions(context.user.id); db.addSession(currentToken, context.user.id, info.ip, info.userAgent); terminalRegistry.disconnectUser(context.user.id, 'all sessions revoked', context.session.tokenHash); }
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
    const previousRole = user.role;
    if (req.body.role !== undefined) { if (!['viewer', 'operator', 'admin', 'root'].includes(req.body.role)) return res.status(400).json({ success: false, error: 'Vai trò không hợp lệ' }); user.role = req.body.role; }
    if (req.body.enabled !== undefined) user.enabled = Boolean(req.body.enabled);
    const passwordChanged = req.body.password !== undefined;
    if (passwordChanged) { if (String(req.body.password).length < 12) return res.status(400).json({ success: false, error: 'Mật khẩu phải có ít nhất 12 ký tự' }); user.passwordHash = await argon2.hash(String(req.body.password), { type: argon2.argon2id }); }
    db.saveUser(user); auditRequest(req, { category: 'security', action: 'user_update', event: 'User updated', level: 'critical', metadata: { target: user.username, role: user.role, enabled: user.enabled } });
    if (passwordChanged || !user.enabled) db.clearUserSessions(user.id);
    const disconnectReason = user.role !== previousRole ? 'role changed' : !user.enabled ? 'user disabled' : passwordChanged ? 'password reset' : undefined;
    if (disconnectReason) terminalRegistry.disconnectUser(user.id, disconnectReason);
    return res.json({ success: true });
  });

  expressApp.delete('/api/users/:id', (req, res) => {
    if (!requireRole(req, res, 'root')) return;
    const user = db.getUserById(req.params.id); if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user' });
    if (user.id === 'root') return res.status(400).json({ success: false, error: 'Không thể xóa tài khoản root' });
    terminalRegistry.disconnectUser(user.id, 'user deleted'); db.deleteUser(user.id); auditRequest(req, { category: 'security', action: 'user_delete', event: 'User deleted', level: 'critical', metadata: { target: user.username } });
    return res.json({ success: true });
  });

  expressApp.get('/api/system/services', async (req, res) => {
    if (!requireCapability(req, res, 'system:manage')) return;
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
    if (!requireCapability(req, res, 'system:manage')) return;
    if (!validUnitName(req.params.unit)) return res.status(400).json({ success: false, error: 'Tên service không hợp lệ' });
    try {
      const lines = Math.min(500, Math.max(10, Number(req.query.lines) || 100));
      const { stdout } = await runSystemCommand('journalctl', ['-u', req.params.unit, '-n', String(lines), '--no-pager', '--output=short-iso'], 20_000);
      return res.json({ success: true, unit: req.params.unit, logs: stdout });
    } catch (error: any) { return res.status(error.status || 500).json({ success: false, error: error.message }); }
  });

  expressApp.post('/api/system/services/:unit/action', async (req, res) => {
    const context = requireCapability(req, res, 'system:manage'); if (!context) return;
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
    const context = requireCapability(req, res, 'system:manage'); if (!context) return;
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
    const context = requireCapability(req, res, 'system:manage'); if (!context) return;
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
    snapshotDir: FILE_MANAGER_SNAPSHOT_DIR,
    previewFrameAncestor: runtimeConfig.frontendOrigin || "'self'"
  }));

  expressApp.use('/api/sqlite', createSqliteManagerRouter({
    authorize: (req, res, minimum) => Boolean(requireCapability(req, res, minimum === 'root' ? 'sqlite:dangerous' : 'sqlite:manage')),
    hasStepUp,
    rootDir: SQLITE_MANAGER_ROOT,
    browserRoot: SQLITE_BROWSER_ROOT,
    backupDir: SQLITE_BACKUP_DIR,
    protectedFiles: [DB_FILE],
    log: (req, action, event, metadata) => auditRequest(req, { category: 'database', action, event, level: action === 'sqlite_query' ? 'info' : 'warning', metadata })
  }));

  expressApp.use('/api/jobs', createOperationsRouter({
    manager: jobManager,
    authorize: (req, res, minimum) => requireCapability(req, res, minimum === 'root' ? 'sqlite:dangerous' : 'jobs:manage'),
    log: (req, action, metadata) => auditRequest(req, { category: 'operations', action, event: action === 'job_create' ? 'Background job created' : 'Background job cancellation requested', level: 'warning', metadata })
  }));

  // --- Socket.io Terminal Implementation ---

  io.use((socket, nextFn) => {
    const ticket = socket.handshake.auth?.ticket;
      const ticketEntry = typeof ticket === 'string' ? consumeSocketTicket(ticket) : null;
      const session = ticketEntry ? db.getSessionByHash(ticketEntry.sessionHash) : undefined;
      const user: StoredUser | undefined = session && session.userId === ticketEntry?.userId ? db.getUserById(session.userId) : undefined;
      if (session && user?.enabled && isRole(user.role) && hasCapability(user.role, 'terminal:use')) {
        socket.data.user = { id: user.id, username: user.username, role: user.role };
        socket.data.sessionHash = session.tokenHash;
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
    const registered = terminalRegistry.register({
      id: socket.id,
      userId: socket.data.user.id,
      sessionHash: socket.data.sessionHash,
      disconnect: reason => {
        socket.emit('output', `\r\n\x1b[33m[SYSTEM] Terminal closed: ${reason}.\x1b[0m\r\n`);
        socket.disconnect(true);
      }
    });
    if (!registered) {
      socket.emit('output', '\r\n\x1b[31;1m[SYSTEM] Terminal session limit reached.\x1b[0m\r\n');
      socket.disconnect(true);
      return;
    }

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
      if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > 64 * 1024) {
        terminalRegistry.disconnectTerminal(socket.id, 'invalid input packet');
        return;
      }
      terminalRegistry.touch(socket.id);
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
      terminalRegistry.remove(socket.id);
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

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    const fallback = setTimeout(() => process.exit(1), 10_000);
    fallback.unref();
    shutdownPromise = (async () => {
      clearInterval(auditPruneTimer);
      terminalRegistry.disconnectAll('server shutdown');
      const listenerClosed = new Promise<void>((resolve, reject) => httpServer.close(error => error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()));
      const results = await Promise.allSettled([
        listenerClosed,
        new Promise<void>(resolve => io.close(() => resolve())),
        jobManager.close()
      ]);
      let databaseError: unknown;
      try { db.close(); } catch (error) { databaseError = error; }
      clearTimeout(fallback);
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason);
      if (databaseError) errors.push(databaseError);
      if (errors.length) throw new AggregateError(errors, 'One or more resources failed to close');
    })().catch(error => {
      console.error('[SHUTDOWN ERROR]', error);
      process.exitCode = 1;
    });
    return shutdownPromise;
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

startServer().catch((err) => {
  console.error('[STARTUP ERROR]', err);
  process.exitCode = 1;
});
