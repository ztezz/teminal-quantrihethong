import express from 'express';
import next from 'next';
import { createServer } from 'http';
import { Server } from 'socket.io';
import crypto from 'crypto';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import * as pty from 'node-pty';
import { createFileManagerRouter } from './lib/file-manager-router';
import os from 'os';
import path from 'path';
import fs from 'fs';

const dev = process.env.NODE_ENV !== 'production';
const backendOnly = process.argv.includes('--backend');
const nextApp = backendOnly ? null : next({ dev });
const handle = nextApp?.getRequestHandler();
const FILE_MANAGER_ROOT = path.resolve(process.env.FILE_MANAGER_ROOT || process.cwd());
const FILE_MANAGER_TRASH_DIR = path.resolve(process.env.FILE_MANAGER_TRASH_DIR || path.join(process.cwd(), '.terminal-trash'));
const SESSION_COOKIE = 'terminal_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
type StoredSession = { tokenHash: string; createdAt: number; expiresAt: number; ip: string; userAgent: string };

// Pure JavaScript File-Based Database to bypass binary sqlite3 GLIBC errors
const DB_FILE = path.join(process.cwd(), 'terminal_database.json');

class JsonDatabase {
  private data: {
    settings: Record<string, string>;
    terminal_settings: Record<string, string>;
    logs: Array<{ id: number; event: string; ip: string; timestamp: string }>;
    sessions: StoredSession[];
  };

  constructor() {
    this.data = {
      settings: {},
      terminal_settings: {},
      logs: [],
      sessions: []
    };
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(fileContent);
        if (!Array.isArray(this.data.sessions) || this.data.sessions.some(session => typeof session === 'string')) this.data.sessions = [];
        else this.data.sessions = this.data.sessions.map(session => ({ ...session, createdAt: session.createdAt || Date.now(), ip: session.ip || 'unknown', userAgent: session.userAgent || 'unknown' }));
      } else {
        this.save();
      }
    } catch (err) {
      console.error('[DB] Error loading database file, initializing empty:', err);
    }
  }

  private save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('[DB] Error saving database file:', err);
    }
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
      const id = this.data.logs.length + 1;
      const timestamp = new Date().toISOString();
      this.data.logs.push({ id, event, ip, timestamp });
      this.save();
      return { lastID: id, changes: 1 };
    }

    return { lastID: 0, changes: 0 };
  }

  async all(sql: string, ...params: any[]) {
    this.load();
    const normalized = sql.toLowerCase().trim();

    if (normalized.includes('select event, ip, timestamp from logs')) {
      return [...this.data.logs]
        .reverse()
        .slice(0, 50);
    }

    return [];
  }

  addSession(token: string, ip = 'unknown', userAgent = 'unknown') {
    if (!this.data.sessions) this.data.sessions = [];
    this.data.sessions = this.data.sessions.filter(session => session.expiresAt > Date.now());
    this.data.sessions.push({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, ip, userAgent: userAgent.slice(0, 300) });
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
    return this.data.sessions.some(session => session.tokenHash === tokenHash && session.expiresAt > Date.now());
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

function sessionTokenFromCookie(cookieHeader: string | undefined): string {
  const cookies = String(cookieHeader || '').split(';');
  for (const cookie of cookies) {
    const [name, ...value] = cookie.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join('='));
  }
  return '';
}

function sessionToken(req: express.Request): string {
  return sessionTokenFromCookie(req.headers.cookie);
}

function authenticated(req: express.Request): boolean {
  const token = sessionToken(req);
  return Boolean(token && hasSession(token));
}

function setSessionCookie(res: express.Response, token: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

function clearSessionCookie(res: express.Response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

const previewTickets = new Map<string, { path: string; expiresAt: number }>();
const socketTickets = new Map<string, number>();
const loginChallenges = new Map<string, { expiresAt: number; ip: string; userAgent: string }>();
function createTicket<T>(store: Map<string, T>, value: T): string {
  const ticket = crypto.randomBytes(32).toString('base64url');
  store.set(ticket, value);
  return ticket;
}
function consumePreviewTicket(ticket: string, filePath: string): boolean {
  const entry = previewTickets.get(ticket);
  if (!entry || entry.expiresAt <= Date.now() || entry.path !== filePath) return false;
  return true;
}
function consumeSocketTicket(ticket: string): boolean {
  const expiresAt = socketTickets.get(ticket);
  socketTickets.delete(ticket);
  return Boolean(expiresAt && expiresAt > Date.now());
}

async function verifyPassword(password: string): Promise<boolean> {
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
    ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim(),
    userAgent: String(req.headers['user-agent'] || 'unknown')
  };
}

function createSession(req: express.Request, res: express.Response) {
  const token = crypto.randomBytes(32).toString('hex');
  const { ip, userAgent } = requestInfo(req);
  db.addSession(token, ip, userAgent);
  setSessionCookie(res, token);
}

function recoveryHash(code: string): string {
  return crypto.createHash('sha256').update(code.replace(/\s|-/g, '').toUpperCase()).digest('hex');
}

async function verifySecondFactor(code: string): Promise<boolean> {
  const secretRow = await db.get('SELECT value FROM settings WHERE key = ?', 'totp_secret');
  if (!secretRow || typeof code !== 'string') return false;
  const normalized = code.replace(/\s/g, '');
  if (/^\d{6}$/.test(normalized) && authenticator.check(normalized, decryptSecret(secretRow.value))) return true;
  const recoveryRow = await db.get('SELECT value FROM settings WHERE key = ?', 'recovery_codes');
  const hashes: string[] = recoveryRow ? JSON.parse(recoveryRow.value) : [];
  const hash = recoveryHash(normalized);
  if (!hashes.includes(hash)) return false;
  await db.run('UPDATE settings SET value = ? WHERE key = ?', JSON.stringify(hashes.filter(item => item !== hash)), 'recovery_codes');
  return true;
}

// Simple rate limiter for auth endpoint: max 10 attempts per IP per 15 minutes
const authAttempts = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  const MAX_ATTEMPTS = 10;
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

  // Check if password setting exists, otherwise set a default
  const dbPasswordHash = await db.get('SELECT value FROM settings WHERE key = ?', 'password_hash');
  if (!dbPasswordHash) {
    const defaultPassword = process.env.TERMINAL_PASSWORD || 'admin';
    const hash = await argon2.hash(defaultPassword, { type: argon2.argon2id });
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', 'password_hash', hash);
    console.log(`[DB] Initialized default terminal password. Defaults to: "${defaultPassword}"`);
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
  const httpServer = createServer(expressApp);
  
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
  }

  // --- API Routes ---

  // Auth check & login endpoint
  expressApp.post('/api/auth', async (req, res) => {
    try {
      const { password } = req.body;
      const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';

      if (!checkRateLimit(clientIp)) {
        await db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', 'Auth blocked: Rate limit exceeded', clientIp);
        return res.status(429).json({ success: false, error: 'Quá nhiều lần thử. Vui lòng đợi 15 phút.' });
      }

      if (!password) {
        await db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', 'Auth attempt failed: Missing password input', clientIp);
        return res.status(400).json({ success: false, error: 'Password is required' });
      }

      if (await verifyPassword(password)) {
        resetRateLimit(clientIp);
        const totpRow = await db.get('SELECT value FROM settings WHERE key = ?', 'totp_secret');
        if (totpRow) {
          const challenge = createTicket(loginChallenges, { expiresAt: Date.now() + 5 * 60_000, ...requestInfo(req) });
          return res.json({ success: true, requiresTwoFactor: true, challenge });
        }
        createSession(req, res);
        await db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', 'Login successful - Session started', clientIp);
        return res.json({ success: true });
      } else {
        await db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', 'Login failed: Incorrect password attempt', clientIp);
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
      if (!await verifySecondFactor(code)) return res.status(401).json({ success: false, error: 'Mã xác thực không hợp lệ' });
      loginChallenges.delete(challenge);
      resetRateLimit(`2fa:${entry.ip}`);
      createSession(req, res);
      await db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', 'Two-factor login successful', entry.ip);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  });

  // Verify session token
  expressApp.post('/api/auth/verify', (req, res) => {
    if (authenticated(req)) {
      return res.json({ success: true });
    }
    return res.status(401).json({ success: false, error: 'Invalid or expired session token' });
  });

  // Fetch log history
  expressApp.get('/api/logs', async (req, res) => {
    try {
      if (!authenticated(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const history = await db.all('SELECT event, ip, timestamp FROM logs ORDER BY id DESC LIMIT 50');
      return res.json({ success: true, logs: history });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
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
      if (!authenticated(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, error: 'Both current and new passwords are required' });
      }
      if (typeof newPassword !== 'string' || newPassword.length < 12) {
        return res.status(400).json({ success: false, error: 'New password must be at least 12 characters long' });
      }

      if (!await verifyPassword(currentPassword)) {
        return res.status(400).json({ success: false, error: 'Incorrect current password' });
      }

      // Update password hash and salt
      const newHash = await argon2.hash(newPassword, { type: argon2.argon2id });
      await db.run('UPDATE settings SET value = ? WHERE key = ?', newHash, 'password_hash');
      db.clearSessions();
      const nextToken = crypto.randomBytes(32).toString('hex');
      db.addSession(nextToken);
      setSessionCookie(res, nextToken);

      const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
      await db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', 'Master password was changed successfully', clientIp);

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
        await db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', 'User logged out', clientIp);
      }
      clearSessionCookie(res);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  expressApp.post('/api/auth/socket-ticket', (req, res) => {
    if (!authenticated(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    return res.json({ success: true, ticket: createTicket(socketTickets, Date.now() + 30_000) });
  });

  expressApp.post('/api/auth/preview-ticket', (req, res) => {
    if (!authenticated(req) || typeof req.body.path !== 'string') return res.status(401).json({ success: false, error: 'Unauthorized' });
    return res.json({ success: true, ticket: createTicket(previewTickets, { path: req.body.path, expiresAt: Date.now() + 60_000 }) });
  });

  expressApp.get('/api/security', async (req, res) => {
    if (!authenticated(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const totpRow = await db.get('SELECT value FROM settings WHERE key = ?', 'totp_secret');
    const recoveryRow = await db.get('SELECT value FROM settings WHERE key = ?', 'recovery_codes');
    const currentHash = crypto.createHash('sha256').update(sessionToken(req)).digest('hex');
    return res.json({
      success: true,
      twoFactorEnabled: Boolean(totpRow),
      twoFactorAvailable: Boolean(encryptionKey()),
      recoveryCodesRemaining: recoveryRow ? JSON.parse(recoveryRow.value).length : 0,
      sessions: db.getSessions().map((session: StoredSession) => ({ id: session.tokenHash.slice(0, 16), createdAt: session.createdAt, expiresAt: session.expiresAt, ip: session.ip, userAgent: session.userAgent, current: session.tokenHash === currentHash }))
    });
  });

  expressApp.post('/api/security/2fa/setup', async (req, res) => {
    if (!authenticated(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
      if (!await verifyPassword(req.body?.password)) return res.status(400).json({ success: false, error: 'Mật khẩu hiện tại không đúng' });
      const secret = authenticator.generateSecret();
      const issuer = process.env.TOTP_ISSUER || 'Terminal Admin';
      const uri = authenticator.keyuri('root', issuer, secret);
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'totp_pending_secret', encryptSecret(secret));
      return res.json({ success: true, secret, qrCode: await QRCode.toDataURL(uri) });
    } catch (error: any) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  });

  expressApp.post('/api/security/2fa/confirm', async (req, res) => {
    if (!authenticated(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
      const pending = await db.get('SELECT value FROM settings WHERE key = ?', 'totp_pending_secret');
      if (!pending || !authenticator.check(String(req.body?.code || ''), decryptSecret(pending.value))) return res.status(400).json({ success: false, error: 'Mã xác thực không hợp lệ' });
      const recoveryCodes = Array.from({ length: 10 }, () => `${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`);
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'totp_secret', pending.value);
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 'recovery_codes', JSON.stringify(recoveryCodes.map(recoveryHash)));
      db.deleteSetting('totp_pending_secret');
      return res.json({ success: true, recoveryCodes });
    } catch (error: any) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  });

  expressApp.post('/api/security/2fa/disable', async (req, res) => {
    if (!authenticated(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
      if (!await verifyPassword(req.body?.password) || !await verifySecondFactor(req.body?.code)) return res.status(400).json({ success: false, error: 'Mật khẩu hoặc mã xác thực không đúng' });
      db.deleteSetting('totp_secret'); db.deleteSetting('totp_pending_secret'); db.deleteSetting('recovery_codes');
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  });

  expressApp.delete('/api/security/sessions/:id', (req, res) => {
    if (!authenticated(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const currentHash = crypto.createHash('sha256').update(sessionToken(req)).digest('hex');
    if (currentHash.startsWith(req.params.id)) return res.status(400).json({ success: false, error: 'Hãy dùng đăng xuất để kết thúc phiên hiện tại' });
    db.removeSessionById(req.params.id);
    return res.json({ success: true });
  });

  expressApp.delete('/api/security/sessions', (req, res) => {
    if (!authenticated(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const currentToken = sessionToken(req); const info = requestInfo(req);
    db.clearSessions(); db.addSession(currentToken, info.ip, info.userAgent);
    return res.json({ success: true });
  });

  expressApp.use('/api/files', createFileManagerRouter({
    hasSession,
    consumePreviewTicket,
    log: (event, ip) => db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', event, ip),
    rootDir: FILE_MANAGER_ROOT,
    trashDir: FILE_MANAGER_TRASH_DIR
  }));

  // --- Socket.io Terminal Implementation ---

  io.use((socket, nextFn) => {
    const ticket = socket.handshake.auth?.ticket;
      if (typeof ticket === 'string' && consumeSocketTicket(ticket)) {
        return nextFn();
      }
    console.log('[SOCKET] Rejecting unauthenticated socket connection attempt.');
    return nextFn(new Error('Authentication failed: Invalid terminal session token'));
  });

  io.on('connection', async (socket) => {
    const clientIp = socket.handshake.address || '127.0.0.1';
    console.log(`[SOCKET] User connected to terminal session. Socket ID: ${socket.id} | IP: ${clientIp}`);
    
    await db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', `SSH/Local Terminal process spawned (Socket: ${socket.id})`, clientIp);

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
    shell.onData((data) => socket.emit('output', data));

    // Handle clean close from the shell itself
    shell.onExit(async ({ exitCode }) => {
      console.log(`[SHELL] Shell process exited with code ${exitCode}. Socket ID: ${socket.id}`);
      socket.emit('output', `\r\n\r\n\x1b[33m[SHELL EXIT] Terminal process exited (code ${exitCode}). Closing connection...\x1b[0m\r\n`);
      await db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', `Terminal shell exited with code ${exitCode}`, clientIp);
      socket.disconnect();
    });

    // Handle inputs from frontend
    socket.on('input', (data: string) => {
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
      
      await db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', `Terminal session disconnected & process killed (Socket: ${socket.id})`, clientIp);
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
