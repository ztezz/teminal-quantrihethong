import express from 'express';
import next from 'next';
import { createServer } from 'http';
import { Server } from 'socket.io';
import crypto from 'crypto';
import * as pty from 'node-pty';
import { createFileManagerRouter } from './lib/file-manager-router';
import os from 'os';
import path from 'path';
import fs from 'fs';

const dev = process.env.NODE_ENV !== 'production';
const backendOnly = process.argv.includes('--backend');
const nextApp = backendOnly ? null : next({ dev });
const handle = nextApp?.getRequestHandler();

// Pure JavaScript File-Based Database to bypass binary sqlite3 GLIBC errors
const DB_FILE = path.join(process.cwd(), 'terminal_database.json');

class JsonDatabase {
  private data: {
    settings: Record<string, string>;
    terminal_settings: Record<string, string>;
    logs: Array<{ id: number; event: string; ip: string; timestamp: string }>;
    sessions: string[];
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

    if (normalized.includes('insert into settings') || normalized.includes('update settings set value')) {
      if (normalized.includes('insert into settings')) {
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

  addSession(token: string) {
    if (!this.data.sessions) this.data.sessions = [];
    if (!this.data.sessions.includes(token)) {
      this.data.sessions.push(token);
      this.save();
    }
  }

  removeSession(token: string) {
    if (!this.data.sessions) return;
    this.data.sessions = this.data.sessions.filter(t => t !== token);
    this.save();
  }

  hasSession(token: string): boolean {
    if (!this.data.sessions) return false;
    return this.data.sessions.includes(token);
  }

  getSessions(): string[] {
    return this.data.sessions || [];
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

// Helper functions for password hashing
function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
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
    const salt = generateSalt();
    const defaultPassword = process.env.TERMINAL_PASSWORD || 'admin';
    const hash = hashPassword(defaultPassword, salt);
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', 'password_salt', salt);
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
      origin: '*',
      methods: ['GET', 'POST', 'PATCH', 'DELETE']
    }
  });

  expressApp.use(express.json({ limit: '2mb' }));

  if (backendOnly) {
    const allowedOrigin = process.env.FRONTEND_ORIGIN || '*';
    expressApp.use((req, res, nextMiddleware) => {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-File-Name, X-Directory');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
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

      const saltRow = await db.get('SELECT value FROM settings WHERE key = ?', 'password_salt');
      const hashRow = await db.get('SELECT value FROM settings WHERE key = ?', 'password_hash');

      if (!saltRow || !hashRow) {
        return res.status(500).json({ success: false, error: 'Internal auth configuration missing' });
      }

      const calculatedHash = hashPassword(password, saltRow.value);

      if (calculatedHash === hashRow.value) {
        // Correct password, generate token & reset rate limit
        resetRateLimit(clientIp);
        const token = crypto.randomBytes(32).toString('hex');
        db.addSession(token);
        
        await db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', 'Login successful - Session started', clientIp);
        return res.json({ success: true, token });
      } else {
        await db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', 'Login failed: Incorrect password attempt', clientIp);
        return res.status(401).json({ success: false, error: 'Incorrect password!' });
      }
    } catch (error: any) {
      console.error('[API AUTH ERROR]', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // Verify session token
  expressApp.post('/api/auth/verify', (req, res) => {
    const { token } = req.body;
      if (token && hasSession(token)) {
      return res.json({ success: true });
    }
    return res.status(401).json({ success: false, error: 'Invalid or expired session token' });
  });

  // Fetch log history
  expressApp.get('/api/logs', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader ? authHeader.replace('Bearer ', '') : '';

      if (!token || !hasSession(token)) {
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
      const authHeader = req.headers.authorization;
      const token = authHeader ? authHeader.replace('Bearer ', '') : '';

      if (!token || !hasSession(token)) {
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
      const authHeader = req.headers.authorization;
      const token = authHeader ? authHeader.replace('Bearer ', '') : '';

      if (!token || !hasSession(token)) {
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
      const authHeader = req.headers.authorization;
      const token = authHeader ? authHeader.replace('Bearer ', '') : '';

      if (!token || !hasSession(token)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, error: 'Both current and new passwords are required' });
      }

      const saltRow = await db.get('SELECT value FROM settings WHERE key = ?', 'password_salt');
      const hashRow = await db.get('SELECT value FROM settings WHERE key = ?', 'password_hash');

      if (!saltRow || !hashRow) {
        return res.status(500).json({ success: false, error: 'Internal auth configuration missing' });
      }

      const calculatedHash = hashPassword(currentPassword, saltRow.value);
      if (calculatedHash !== hashRow.value) {
        return res.status(400).json({ success: false, error: 'Incorrect current password' });
      }

      // Update password hash and salt
      const newSalt = generateSalt();
      const newHash = hashPassword(newPassword, newSalt);

      await db.run('UPDATE settings SET value = ? WHERE key = ?', newSalt, 'password_salt');
      await db.run('UPDATE settings SET value = ? WHERE key = ?', newHash, 'password_hash');

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
      const authHeader = req.headers.authorization;
      const token = authHeader ? authHeader.replace('Bearer ', '') : '';
      if (!token || !hasSession(token)) {
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
      const { token } = req.body;
      if (token) {
        db.removeSession(token);
        const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
        await db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', 'User logged out', clientIp);
      }
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  expressApp.use('/api/files', createFileManagerRouter({
    hasSession,
    log: (event, ip) => db.run('INSERT INTO logs (event, ip) VALUES (?, ?)', event, ip)
  }));

  // --- Socket.io Terminal Implementation ---

  io.use((socket, nextFn) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (token && hasSession(token)) {
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
      const filesystemRoot = path.parse(process.cwd()).root;
      const candidate = path.resolve(filesystemRoot, requestedCwd.replace(/^[/\\]+/, ''));
      try {
        if ((candidate === filesystemRoot || candidate.startsWith(filesystemRoot + path.sep)) && (await fs.promises.stat(candidate)).isDirectory()) terminalCwd = candidate;
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
