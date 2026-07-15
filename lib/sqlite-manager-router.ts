import { DatabaseSync } from 'node:sqlite';
import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';

const fsp = fs.promises;
const SQLITE_EXTENSIONS = new Set(['.sqlite', '.sqlite3', '.db']);
const MAX_SCAN_ENTRIES = 20_000;
const MAX_RESULT_ROWS = 500;
const MAX_SQL_LENGTH = 100_000;

type Options = {
  authorize: (req: Request, res: Response, minimum: 'admin' | 'root') => boolean;
  hasStepUp: (req: Request) => boolean;
  log: (req: Request, action: string, event: string, metadata?: Record<string, unknown>) => void;
  rootDir?: string;
  protectedFiles?: string[];
};

function jsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(value).toString('base64') };
  return value;
}

function jsonRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, jsonValue(value)]));
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function createSqliteManagerRouter({ authorize, hasStepUp, log, rootDir, protectedFiles = [] }: Options) {
  const router = Router();
  const root = path.resolve(rootDir || process.cwd());
  const canonicalRoot = fs.realpathSync(root);
  const protectedPaths = new Set(protectedFiles.map(file => path.resolve(file)));
  const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
  const fail = (res: Response, error: any) => {
    const statuses: Record<string, number> = { ENOENT: 404, EEXIST: 409, EACCES: 403, EPERM: 403, ENOSPC: 507, SQLITE_BUSY: 409 };
    const status = error.status || statuses[error.code] || 500;
    return res.status(status).json({ success: false, error: error.message || 'Không thể xử lý SQLite' });
  };
  const relative = (target: string) => path.relative(root, target).split(path.sep).join('/');
  const resolveDatabase = (userPath: unknown, mustExist = true) => {
    if (typeof userPath !== 'string' || !userPath.trim() || userPath.length > 1024) throw httpError(400, 'Đường dẫn database không hợp lệ');
    const target = path.resolve(root, userPath.replace(/^[/\\]+/, ''));
    const relativeTarget = path.relative(root, target);
    if (relativeTarget.startsWith('..' + path.sep) || relativeTarget === '..' || path.isAbsolute(relativeTarget)) throw httpError(403, 'Database nằm ngoài thư mục quản lý');
    if (!SQLITE_EXTENSIONS.has(path.extname(target).toLowerCase())) throw httpError(400, 'Database phải có đuôi .sqlite, .sqlite3 hoặc .db');
    let existing = mustExist ? target : path.dirname(target);
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) throw httpError(403, 'Không thể xác minh đường dẫn');
      existing = parent;
    }
    const canonicalExisting = fs.realpathSync(existing);
    const canonicalRelative = path.relative(canonicalRoot, canonicalExisting);
    if (canonicalRelative.startsWith('..' + path.sep) || canonicalRelative === '..' || path.isAbsolute(canonicalRelative)) throw httpError(403, 'Symbolic link trỏ ra ngoài thư mục quản lý');
    return target;
  };
  const openDatabase = (userPath: unknown, readOnly = false) => {
    const filename = resolveDatabase(userPath);
    const stat = fs.statSync(filename);
    if (!stat.isFile()) throw httpError(400, 'Đường dẫn không phải tệp tin');
    const database = new DatabaseSync(filename, { readOnly });
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA trusted_schema = OFF;');
    return { database, filename };
  };
  const sqliteHeader = async (filename: string) => {
    const handle = await fsp.open(filename, 'r');
    try {
      const buffer = Buffer.alloc(16);
      await handle.read(buffer, 0, buffer.length, 0);
      return buffer.toString('utf8');
    } finally { await handle.close(); }
  };

  router.use((req, res, next) => authorize(req, res, 'admin') ? next() : undefined);

  router.get('/', async (_req, res) => {
    try {
      const queue = [root];
      const databases: Array<{ path: string; name: string; size: number; mtime: string; protected: boolean }> = [];
      let scanned = 0;
      while (queue.length && scanned < MAX_SCAN_ENTRIES) {
        const directory = queue.shift()!;
        let entries: fs.Dirent[];
        try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          scanned++;
          const target = path.join(directory, entry.name);
          if (entry.isDirectory() && !entry.isSymbolicLink()) queue.push(target);
          if (entry.isFile() && SQLITE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            const stat = await fsp.stat(target);
            const header = stat.size >= 16 ? await sqliteHeader(target).catch(() => '') : '';
            if (stat.size === 0 || header === 'SQLite format 3\0') databases.push({ path: relative(target), name: entry.name, size: stat.size, mtime: stat.mtime.toISOString(), protected: protectedPaths.has(path.resolve(target)) });
          }
          if (scanned >= MAX_SCAN_ENTRIES) break;
        }
      }
      databases.sort((a, b) => a.path.localeCompare(b.path));
      return res.json({ success: true, root: canonicalRoot, databases, scanned, truncated: Boolean(queue.length) });
    } catch (error) { return fail(res, error); }
  });

  router.post('/', async (req, res) => {
    if (!hasStepUp(req)) return res.status(428).json({ success: false, code: 'STEP_UP_REQUIRED', error: 'Tạo database yêu cầu xác nhận lại danh tính' });
    try {
      let databasePath = String(req.body?.path || '').trim().replace(/\\/g, '/');
      if (!path.posix.extname(databasePath)) databasePath += '.sqlite';
      const filename = resolveDatabase(databasePath, false);
      await fsp.mkdir(path.dirname(filename), { recursive: true });
      if (fs.existsSync(filename)) throw httpError(409, 'Database đã tồn tại');
      const database = new DatabaseSync(filename, { open: true });
      try {
        database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA user_version = 0;');
        if (typeof req.body?.schema === 'string' && req.body.schema.trim()) {
          if (req.body.schema.length > MAX_SQL_LENGTH) throw httpError(413, 'Schema SQL quá dài');
          if (/\b(?:ATTACH|DETACH)\b|\bVACUUM\s+INTO\b|load_extension\s*\(/i.test(req.body.schema)) throw httpError(403, 'Schema có thể truy cập ngoài database hiện tại đã bị chặn');
          database.exec(req.body.schema);
        }
      } catch (error) {
        database.close();
        await fsp.rm(filename, { force: true });
        throw error;
      }
      database.close();
      log(req, 'sqlite_create', 'SQLite database created', { path: relative(filename) });
      return res.status(201).json({ success: true, path: relative(filename) });
    } catch (error) { return fail(res, error); }
  });

  router.get('/schema', (req, res) => {
    let database: DatabaseSync | undefined;
    try {
      ({ database } = openDatabase(req.query.path, true));
      const objects = database.prepare("SELECT type, name, tbl_name AS tableName, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END, name").all().map(row => jsonRow(row as Record<string, unknown>));
      const integrity = database.prepare('PRAGMA quick_check').get() as { quick_check: string };
      return res.json({ success: true, objects, integrity: integrity.quick_check });
    } catch (error) { return fail(res, error); }
    finally { database?.close(); }
  });

  router.get('/rows', (req, res) => {
    let database: DatabaseSync | undefined;
    try {
      const table = String(req.query.table || '');
      if (!table || table.length > 255) throw httpError(400, 'Tên bảng không hợp lệ');
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      ({ database } = openDatabase(req.query.path, true));
      const exists = database.prepare("SELECT 1 FROM sqlite_schema WHERE type IN ('table', 'view') AND name = ?").get(table);
      if (!exists) throw httpError(404, 'Không tìm thấy bảng hoặc view');
      const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(table)} LIMIT ? OFFSET ?`).all(limit, offset).map(row => jsonRow(row as Record<string, unknown>));
      const columns = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map(row => jsonRow(row as Record<string, unknown>));
      return res.json({ success: true, table, columns, rows, limit, offset, hasMore: rows.length === limit });
    } catch (error) { return fail(res, error); }
    finally { database?.close(); }
  });

  router.post('/query', (req, res) => {
    let database: DatabaseSync | undefined;
    try {
      const sql = String(req.body?.sql || '').trim();
      if (!sql || sql.length > MAX_SQL_LENGTH) throw httpError(400, 'Câu lệnh SQL trống hoặc quá dài');
      const readOnly = /^(?:SELECT|WITH|EXPLAIN)\b/i.test(sql);
      if (!readOnly && !hasStepUp(req)) return res.status(428).json({ success: false, code: 'STEP_UP_REQUIRED', error: 'Thay đổi database yêu cầu xác nhận lại danh tính' });
      if (/\b(?:ATTACH|DETACH)\b|\bVACUUM\s+INTO\b|load_extension\s*\(/i.test(sql)) throw httpError(403, 'Câu lệnh có thể truy cập ngoài database hiện tại đã bị chặn');
      const opened = openDatabase(req.body?.path, readOnly); database = opened.database;
      const startedAt = Date.now();
      if (readOnly) {
        const statement = database.prepare(sql);
        const rows: Record<string, unknown>[] = [];
        let truncated = false;
        for (const row of statement.iterate()) {
          if (rows.length === MAX_RESULT_ROWS) { truncated = true; break; }
          rows.push(jsonRow(row as Record<string, unknown>));
        }
        log(req, 'sqlite_query', 'SQLite read query executed', { path: relative(opened.filename), rowCount: rows.length });
        return res.json({ success: true, rows, rowCount: rows.length, truncated, durationMs: Date.now() - startedAt });
      }
      database.exec(sql);
      log(req, 'sqlite_execute', 'SQLite write query executed', { path: relative(opened.filename) });
      return res.json({ success: true, rows: [], rowCount: 0, durationMs: Date.now() - startedAt });
    } catch (error) { return fail(res, error); }
    finally { database?.close(); }
  });

  router.delete('/', async (req, res) => {
    if (!authorize(req, res, 'root')) return;
    if (!hasStepUp(req)) return res.status(428).json({ success: false, code: 'STEP_UP_REQUIRED', error: 'Xóa database yêu cầu xác nhận lại danh tính' });
    try {
      const filename = resolveDatabase(req.body?.path);
      if (protectedPaths.has(path.resolve(filename))) throw httpError(403, 'Không thể xóa database hệ thống đang sử dụng');
      await fsp.rm(filename);
      await Promise.all(['-wal', '-shm'].map(suffix => fsp.rm(filename + suffix, { force: true })));
      log(req, 'sqlite_delete', 'SQLite database deleted', { path: relative(filename) });
      return res.json({ success: true });
    } catch (error) { return fail(res, error); }
  });

  return router;
}
