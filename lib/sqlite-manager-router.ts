import { backup, DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';

const fsp = fs.promises;
const SQLITE_EXTENSIONS = new Set(['.sqlite', '.sqlite3', '.db']);
const MAX_SCAN_ENTRIES = 20_000;
const MAX_RESULT_ROWS = 500;
const MAX_EXPORT_ROWS = 10_000;
const MAX_IMPORT_ROWS = 10_000;
const MAX_IMPORT_BYTES = 1_500_000;
const MAX_SQL_LENGTH = 100_000;
const MAX_FILTERS = 20;
const IDENTIFIER = /^[^\0-\x1f\x7f]{1,255}$/;
const TYPE = /^(?:INTEGER|REAL|TEXT|BLOB|NUMERIC|BOOLEAN|DATE|DATETIME|JSON|VARCHAR\([1-9]\d{0,4}\)|DECIMAL\([1-9]\d{0,2}(?:,[0-9]\d?)?\))$/i;

type Options = {
  authorize: (req: Request, res: Response, minimum: 'admin' | 'root') => boolean;
  hasStepUp: (req: Request) => boolean;
  log: (req: Request, action: string, event: string, metadata?: Record<string, unknown>) => void;
  rootDir?: string;
  backupDir?: string;
  protectedFiles?: string[];
};

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number };
type RowIdentity = { kind: 'primaryKey'; columns: string[] } | { kind: 'rowid'; columns: ['rowid'] } | { kind: 'none'; columns: [] };

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

function csvCell(value: unknown) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function parseCsv(input: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') { record.push(field); field = ''; }
    else if (char === '\n') { record.push(field.replace(/\r$/, '')); records.push(record); record = []; field = ''; }
    else field += char;
  }
  if (quoted) throw new Error('CSV có dấu nháy chưa đóng');
  if (field || record.length) { record.push(field.replace(/\r$/, '')); records.push(record); }
  const headers = records.shift() || [];
  if (!headers.length || headers.some(header => !header)) throw new Error('CSV phải có hàng tiêu đề hợp lệ');
  if (new Set(headers).size !== headers.length) throw new Error('Tiêu đề CSV bị trùng');
  return records.filter(row => row.some(value => value !== '')).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

export function createSqliteManagerRouter({ authorize, hasStepUp, log, rootDir, backupDir, protectedFiles = [] }: Options) {
  const router = Router();
  const root = path.resolve(rootDir || process.cwd());
  const canonicalRoot = fs.realpathSync(root);
  const backupRoot = path.resolve(backupDir || path.join(root, '.terminal-sqlite-backups'));
  const backupRelative = path.relative(root, backupRoot);
  if (backupRelative === '..' || backupRelative.startsWith(`..${path.sep}`) || path.isAbsolute(backupRelative)) throw new Error('SQLite backup directory must be inside the manager root');
  const protectedPaths = new Set(protectedFiles.map(file => path.resolve(file)));
  const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
  const fail = (res: Response, error: any) => {
    const statuses: Record<string, number> = { ENOENT: 404, EEXIST: 409, EACCES: 403, EPERM: 403, ENOSPC: 507, SQLITE_BUSY: 409, SQLITE_CONSTRAINT_UNIQUE: 409, SQLITE_CONSTRAINT_PRIMARYKEY: 409, SQLITE_CONSTRAINT_FOREIGNKEY: 409 };
    const status = error.status || statuses[error.code] || 500;
    return res.status(status).json({ success: false, error: error.message || 'Không thể xử lý SQLite' });
  };
  const relative = (target: string) => path.relative(root, target).split(path.sep).join('/');
  const isInside = (parent: string, target: string) => {
    const value = path.relative(parent, target);
    return value === '' || !value.startsWith(`..${path.sep}`) && value !== '..' && !path.isAbsolute(value);
  };
  const validIdentifier = (value: unknown, label = 'Tên') => {
    if (typeof value !== 'string' || !IDENTIFIER.test(value) || value.trim() !== value) throw httpError(400, `${label} không hợp lệ`);
    return value;
  };
  const resolveDatabase = (userPath: unknown, mustExist = true) => {
    if (typeof userPath !== 'string' || !userPath.trim() || userPath.length > 1024) throw httpError(400, 'Đường dẫn database không hợp lệ');
    const target = path.resolve(root, userPath.replace(/^[/\\]+/, ''));
    if (!isInside(root, target)) throw httpError(403, 'Database nằm ngoài thư mục quản lý');
    if (isInside(backupRoot, target)) throw httpError(403, 'Thư mục backup không thể được mở như database quản lý');
    if (!SQLITE_EXTENSIONS.has(path.extname(target).toLowerCase())) throw httpError(400, 'Database phải có đuôi .sqlite, .sqlite3 hoặc .db');
    let existing = mustExist ? target : path.dirname(target);
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) throw httpError(403, 'Không thể xác minh đường dẫn');
      existing = parent;
    }
    const canonicalExisting = fs.realpathSync(existing);
    if (!isInside(canonicalRoot, canonicalExisting)) throw httpError(403, 'Symbolic link trỏ ra ngoài thư mục quản lý');
    return target;
  };
  const openDatabase = (userPath: unknown, readOnly = false) => {
    const filename = resolveDatabase(userPath);
    const stat = fs.statSync(filename);
    if (!stat.isFile()) throw httpError(400, 'Đường dẫn không phải tệp tin');
    const database = new DatabaseSync(filename, { readOnly, timeout: 5000 });
    database.exec('PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;');
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
  const requireStepUp = (req: Request, res: Response, message: string) => hasStepUp(req) || (res.status(428).json({ success: false, code: 'STEP_UP_REQUIRED', error: message }), false);
  const requireRootStepUp = (req: Request, res: Response, message: string) => authorize(req, res, 'root') && requireStepUp(req, res, message);
  const schemaObject = (database: DatabaseSync, tableValue: unknown, writable = false) => {
    const table = validIdentifier(tableValue, 'Tên bảng');
    const row = database.prepare("SELECT type, sql FROM sqlite_schema WHERE type IN ('table', 'view') AND name = ?").get(table) as { type: string; sql: string | null } | undefined;
    if (!row) throw httpError(404, 'Không tìm thấy bảng hoặc view');
    if (writable && row.type !== 'table') throw httpError(400, 'View không hỗ trợ thao tác này');
    return { table, sql: row.sql || '', type: row.type };
  };
  const columnsFor = (database: DatabaseSync, table: string) => database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as unknown as ColumnInfo[];
  const rowIdentity = (database: DatabaseSync, table: string, sql: string): RowIdentity => {
    const primary = columnsFor(database, table).filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name);
    if (primary.length) return { kind: 'primaryKey', columns: primary };
    return /\bWITHOUT\s+ROWID\b/i.test(sql) ? { kind: 'none', columns: [] } : { kind: 'rowid', columns: ['rowid'] };
  };
  const sqlValue = (value: unknown): SQLInputValue => {
    if (value === null || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value && typeof value === 'object' && (value as any).type === 'blob' && typeof (value as any).base64 === 'string' && (value as any).base64.length <= MAX_IMPORT_BYTES * 2) return Buffer.from((value as any).base64, 'base64');
    throw httpError(400, 'Giá trị SQLite không hợp lệ');
  };
  const valuesObject = (value: unknown, columns: ColumnInfo[], allowEmpty = false) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'values phải là object');
    const entries = Object.entries(value as Record<string, unknown>);
    if (!allowEmpty && !entries.length) throw httpError(400, 'values không được trống');
    const names = new Set(columns.map(column => column.name));
    if (entries.some(([name]) => !names.has(name))) throw httpError(400, 'values chứa cột không tồn tại');
    return entries.map(([name, item]) => [name, sqlValue(item)] as const);
  };
  const identityWhere = (identity: RowIdentity, input: unknown) => {
    if (identity.kind === 'none') throw httpError(400, 'Bảng không có primary key hoặc rowid ổn định');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, 'identity không hợp lệ');
    const source = input as Record<string, unknown>;
    if (identity.columns.some(column => !(column in source)) || Object.keys(source).some(column => !(identity.columns as string[]).includes(column))) throw httpError(400, 'identity không khớp khóa của bảng');
    return { sql: identity.columns.map(column => `${quoteIdentifier(column)} IS ?`).join(' AND '), values: identity.columns.map(column => sqlValue(source[column])) };
  };
  const filterSql = (database: DatabaseSync, table: string, filterValue: unknown) => {
    if (filterValue === undefined || filterValue === null || filterValue === '') return { sql: '', values: [] as SQLInputValue[] };
    let filters: unknown = filterValue;
    if (typeof filters === 'string') { try { filters = JSON.parse(filters); } catch { throw httpError(400, 'filter phải là JSON hợp lệ'); } }
    if (!Array.isArray(filters) || filters.length > MAX_FILTERS) throw httpError(400, `filter phải là mảng tối đa ${MAX_FILTERS} phần tử`);
    const names = new Set(columnsFor(database, table).map(column => column.name));
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];
    for (const raw of filters) {
      if (!raw || typeof raw !== 'object') throw httpError(400, 'Điều kiện lọc không hợp lệ');
      const { column, operator = 'eq', value } = raw as { column?: unknown; operator?: unknown; value?: unknown };
      if (typeof column !== 'string' || !names.has(column)) throw httpError(400, 'Cột lọc không tồn tại');
      const quoted = quoteIdentifier(column);
      if (operator === 'isNull' || operator === 'notNull') clauses.push(`${quoted} IS ${operator === 'notNull' ? 'NOT ' : ''}NULL`);
      else if (['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith'].includes(String(operator))) {
        const operators: Record<string, string> = { eq: 'IS', ne: 'IS NOT', gt: '>', gte: '>=', lt: '<', lte: '<=', contains: 'LIKE', startsWith: 'LIKE' };
        clauses.push(`${quoted} ${operators[String(operator)]} ?${operator === 'contains' || operator === 'startsWith' ? " ESCAPE '\\'" : ''}`);
        const bound = sqlValue(value);
        if (operator === 'contains' || operator === 'startsWith') {
          const escaped = String(bound).replace(/[\\%_]/g, '\\$&');
          values.push(operator === 'contains' ? `%${escaped}%` : `${escaped}%`);
        } else values.push(bound);
      } else throw httpError(400, 'Toán tử lọc không được hỗ trợ');
    }
    return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', values };
  };
  const searchSql = (database: DatabaseSync, table: string, queryValue: unknown) => {
    if (queryValue === undefined || queryValue === null || queryValue === '') return { sql: '', values: [] as SQLInputValue[] };
    const query = String(queryValue);
    if (query.length > 500) throw httpError(400, 'Từ khóa tìm kiếm quá dài');
    const columns = columnsFor(database, table);
    if (!columns.length) return { sql: '', values: [] as SQLInputValue[] };
    const escaped = query.replace(/[\%_]/g, '\$&');
    return { sql: ` WHERE (${columns.map(column => `CAST(${quoteIdentifier(column.name)} AS TEXT) LIKE ? ESCAPE '\\'`).join(' OR ')})`, values: columns.map(() => `%${escaped}%`) };
  };
  const requestedFilter = (database: DatabaseSync, table: string, query: Record<string, unknown>) => query.q !== undefined && query.q !== '' ? searchSql(database, table, query.q) : filterSql(database, table, query.filter);
  const sortSql = (database: DatabaseSync, table: string, sortValue: unknown, orderValue: unknown) => {
    if (sortValue === undefined || sortValue === null || sortValue === '') return '';
    const sort = String(sortValue);
    if (!columnsFor(database, table).some(column => column.name === sort)) throw httpError(400, 'Cột sắp xếp không tồn tại');
    const order = String(orderValue || 'asc').toLowerCase();
    if (order !== 'asc' && order !== 'desc') throw httpError(400, 'Thứ tự sắp xếp không hợp lệ');
    return ` ORDER BY ${quoteIdentifier(sort)} ${order.toUpperCase()}`;
  };
  const defaultSql = (value: unknown) => {
    if (value === undefined) return '';
    if (value === null) return ' DEFAULT NULL';
    if (typeof value === 'boolean') return ` DEFAULT ${value ? 1 : 0}`;
    if (typeof value === 'number' && Number.isFinite(value)) return ` DEFAULT ${value}`;
    if (typeof value === 'string' && value.length <= 10_000) return ` DEFAULT '${value.replaceAll("'", "''")}'`;
    throw httpError(400, 'Default chỉ được là null, boolean, số hữu hạn hoặc chuỗi');
  };
  const columnDefinition = (input: unknown, primaryAllowed: boolean) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, 'Định nghĩa cột không hợp lệ');
    const item = input as Record<string, unknown>;
    const name = validIdentifier(item.name, 'Tên cột');
    const type = String(item.type || '').toUpperCase();
    if (!TYPE.test(type)) throw httpError(400, 'Kiểu cột không được hỗ trợ');
    if (item.primaryKey && !primaryAllowed) throw httpError(400, 'ADD COLUMN không hỗ trợ primary key');
    return `${quoteIdentifier(name)} ${type}${item.primaryKey ? ' PRIMARY KEY' : ''}${item.autoIncrement ? item.primaryKey && type === 'INTEGER' ? ' AUTOINCREMENT' : (() => { throw httpError(400, 'AUTOINCREMENT chỉ dùng với INTEGER PRIMARY KEY'); })() : ''}${item.notNull ? ' NOT NULL' : ''}${item.unique ? ' UNIQUE' : ''}${defaultSql(item.default)}`;
  };
  const ensureBackupRoot = async () => {
    await fsp.mkdir(backupRoot, { recursive: true });
    if (!isInside(canonicalRoot, fs.realpathSync(backupRoot))) throw httpError(403, 'Symbolic link của thư mục backup không an toàn');
  };
  const backupPath = (value: unknown) => {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}\.sqlite$/.test(value)) throw httpError(400, 'Tên backup không hợp lệ');
    const target = path.resolve(backupRoot, value);
    if (!isInside(backupRoot, target)) throw httpError(403, 'Đường dẫn backup không an toàn');
    return target;
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
          if (entry.isDirectory() && !entry.isSymbolicLink() && path.resolve(target) !== backupRoot) queue.push(target);
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
    if (!requireStepUp(req, res, 'Tạo database yêu cầu xác nhận lại danh tính')) return;
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
      } catch (error) { database.close(); await fsp.rm(filename, { force: true }); throw error; }
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
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.post('/schema/tables', (req, res) => {
    if (!requireStepUp(req, res, 'Tạo bảng yêu cầu xác nhận lại danh tính')) return;
    let database: DatabaseSync | undefined;
    try {
      const table = validIdentifier(req.body?.table, 'Tên bảng');
      if (!Array.isArray(req.body?.columns) || !req.body.columns.length || req.body.columns.length > 200) throw httpError(400, 'columns phải có từ 1 đến 200 cột');
      const names = req.body.columns.map((column: any) => validIdentifier(column?.name, 'Tên cột'));
      if (new Set(names).size !== names.length) throw httpError(400, 'Tên cột bị trùng');
      ({ database } = openDatabase(req.body?.path));
      database.exec(`CREATE TABLE ${quoteIdentifier(table)} (${req.body.columns.map((column: unknown) => columnDefinition(column, true)).join(', ')})${req.body.withoutRowid ? ' WITHOUT ROWID' : ''}`);
      log(req, 'sqlite_create_table', 'SQLite table created', { path: req.body.path, table });
      return res.status(201).json({ success: true, table });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.post('/schema/columns', (req, res) => {
    if (!requireStepUp(req, res, 'Thêm cột yêu cầu xác nhận lại danh tính')) return;
    let database: DatabaseSync | undefined;
    try {
      ({ database } = openDatabase(req.body?.path));
      const { table } = schemaObject(database, req.body?.table, true);
      database.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${columnDefinition(req.body?.column, false)}`);
      log(req, 'sqlite_add_column', 'SQLite column added', { path: req.body.path, table });
      return res.status(201).json({ success: true });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.post('/schema/indexes', (req, res) => {
    if (!requireStepUp(req, res, 'Tạo index yêu cầu xác nhận lại danh tính')) return;
    let database: DatabaseSync | undefined;
    try {
      const index = validIdentifier(req.body?.index, 'Tên index');
      ({ database } = openDatabase(req.body?.path));
      const { table } = schemaObject(database, req.body?.table, true);
      const known = new Set(columnsFor(database, table).map(column => column.name));
      if (!Array.isArray(req.body?.columns) || !req.body.columns.length || req.body.columns.length > 20 || req.body.columns.some((column: unknown) => typeof column !== 'string' || !known.has(column))) throw httpError(400, 'Danh sách cột index không hợp lệ');
      database.exec(`CREATE ${req.body.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdentifier(index)} ON ${quoteIdentifier(table)} (${req.body.columns.map(quoteIdentifier).join(', ')})`);
      log(req, 'sqlite_create_index', 'SQLite index created', { path: req.body.path, table, index });
      return res.status(201).json({ success: true, index });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.delete('/schema/indexes', (req, res) => {
    if (!requireRootStepUp(req, res, 'Xóa index yêu cầu quyền root và xác nhận lại danh tính')) return;
    let database: DatabaseSync | undefined;
    try {
      const index = validIdentifier(req.body?.index, 'Tên index');
      ({ database } = openDatabase(req.body?.path));
      const found = database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = ? AND sql IS NOT NULL").get(index);
      if (!found) throw httpError(404, 'Không tìm thấy index có thể xóa');
      database.exec(`DROP INDEX ${quoteIdentifier(index)}`);
      log(req, 'sqlite_drop_index', 'SQLite index dropped', { path: req.body.path, index });
      return res.json({ success: true });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.delete('/schema/tables', (req, res) => {
    if (!requireRootStepUp(req, res, 'Xóa bảng yêu cầu quyền root và xác nhận lại danh tính')) return;
    let database: DatabaseSync | undefined;
    try {
      ({ database } = openDatabase(req.body?.path));
      const { table } = schemaObject(database, req.body?.table, true);
      database.exec(`DROP TABLE ${quoteIdentifier(table)}`);
      log(req, 'sqlite_drop_table', 'SQLite table dropped', { path: req.body.path, table });
      return res.json({ success: true });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.get('/rows', (req, res) => {
    let database: DatabaseSync | undefined;
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
      const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
      ({ database } = openDatabase(req.query.path, true));
      const object = schemaObject(database, req.query.table);
      const identity = object.type === 'table' ? rowIdentity(database, object.table, object.sql) : { kind: 'none', columns: [] } as RowIdentity;
      const filter = requestedFilter(database, object.table, req.query as Record<string, unknown>);
      const sort = sortSql(database, object.table, req.query.sort, req.query.order);
      const rowid = identity.kind === 'rowid' ? `${quoteIdentifier('rowid')} AS ${quoteIdentifier('__terminal_rowid')}, ` : '';
      const rawRows = database.prepare(`SELECT ${rowid}* FROM ${quoteIdentifier(object.table)}${filter.sql}${sort} LIMIT ? OFFSET ?`).all(...filter.values, limit + 1, offset) as Record<string, unknown>[];
      const hasMore = rawRows.length > limit;
      if (hasMore) rawRows.pop();
      const rowIdentities = rawRows.map(row => Object.fromEntries(identity.columns.map(column => [column, jsonValue(identity.kind === 'rowid' ? row.__terminal_rowid : row[column])])));
      const rows = rawRows.map(row => {
        if (identity.kind !== 'rowid') return jsonRow(row);
        const data = { ...row };
        delete data.__terminal_rowid;
        return jsonRow(data);
      });
      const total = Number((database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(object.table)}${filter.sql}`).get(...filter.values) as { count: number }).count);
      return res.json({ success: true, table: object.table, columns: columnsFor(database, object.table).map(row => jsonRow(row as unknown as Record<string, unknown>)), identity, rows, rowIdentities, total, limit, offset, hasMore });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.post('/rows', (req, res) => {
    if (!requireStepUp(req, res, 'Thêm dữ liệu yêu cầu xác nhận lại danh tính')) return;
    let database: DatabaseSync | undefined;
    try {
      ({ database } = openDatabase(req.body?.path));
      const object = schemaObject(database, req.body?.table, true);
      const entries = valuesObject(req.body?.values, columnsFor(database, object.table), true);
      const statement = entries.length ? database.prepare(`INSERT INTO ${quoteIdentifier(object.table)} (${entries.map(([name]) => quoteIdentifier(name)).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`) : database.prepare(`INSERT INTO ${quoteIdentifier(object.table)} DEFAULT VALUES`);
      const result = statement.run(...entries.map(([, value]) => value));
      log(req, 'sqlite_insert_row', 'SQLite row inserted', { path: req.body.path, table: object.table, changes: result.changes });
      return res.status(201).json({ success: true, changes: result.changes, lastInsertRowid: jsonValue(result.lastInsertRowid) });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.patch('/rows', (req, res) => {
    if (!requireStepUp(req, res, 'Sửa dữ liệu yêu cầu xác nhận lại danh tính')) return;
    let database: DatabaseSync | undefined;
    try {
      ({ database } = openDatabase(req.body?.path));
      const object = schemaObject(database, req.body?.table, true);
      const entries = valuesObject(req.body?.values, columnsFor(database, object.table));
      const where = identityWhere(rowIdentity(database, object.table, object.sql), req.body?.identity);
      const result = database.prepare(`UPDATE ${quoteIdentifier(object.table)} SET ${entries.map(([name]) => `${quoteIdentifier(name)} = ?`).join(', ')} WHERE ${where.sql}`).run(...entries.map(([, value]) => value), ...where.values);
      if (!result.changes) throw httpError(404, 'Không tìm thấy hàng cần sửa');
      log(req, 'sqlite_update_row', 'SQLite row updated', { path: req.body.path, table: object.table, changes: result.changes });
      return res.json({ success: true, changes: result.changes });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.delete('/rows', (req, res) => {
    if (!requireStepUp(req, res, 'Xóa dữ liệu yêu cầu xác nhận lại danh tính')) return;
    let database: DatabaseSync | undefined;
    try {
      ({ database } = openDatabase(req.body?.path));
      const object = schemaObject(database, req.body?.table, true);
      const where = identityWhere(rowIdentity(database, object.table, object.sql), req.body?.identity);
      const result = database.prepare(`DELETE FROM ${quoteIdentifier(object.table)} WHERE ${where.sql}`).run(...where.values);
      if (!result.changes) throw httpError(404, 'Không tìm thấy hàng cần xóa');
      log(req, 'sqlite_delete_row', 'SQLite row deleted', { path: req.body.path, table: object.table, changes: result.changes });
      return res.json({ success: true, changes: result.changes });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.get('/statistics', (req, res) => {
    let database: DatabaseSync | undefined;
    try {
      const opened = openDatabase(req.query.path, true); database = opened.database;
      const pragmaNumber = (name: string) => Number(Object.values(database!.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>)[0]);
      const journalMode = String(Object.values(database.prepare('PRAGMA journal_mode').get() as Record<string, unknown>)[0]);
      const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as unknown as Array<{ name: string }>;
      const hasStat1 = database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'sqlite_stat1'").get();
      const statRows = hasStat1 ? database.prepare("SELECT tbl AS name, stat FROM sqlite_stat1 WHERE idx IS NULL").all() as unknown as Array<{ name: string; stat: string }> : [];
      const estimates = new Map(statRows.map(item => [item.name, Number(String(item.stat).split(' ')[0]) || null]));
      const tableRows = tables.slice(0, 200).map(({ name }) => ({ name, estimatedRows: estimates.get(name) ?? null, rowCount: Number((database!.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get() as { count: number }).count) }));
      const stat = fs.statSync(opened.filename);
      const wal = awaitStat(opened.filename + '-wal');
      const pageCount = pragmaNumber('page_count');
      const pageSize = pragmaNumber('page_size');
      return res.json({ success: true, fileSize: stat.size, pageCount, pageSize, databaseBytes: pageCount * pageSize, freelistCount: pragmaNumber('freelist_count'), freelistBytes: pragmaNumber('freelist_count') * pageSize, journalMode, walSize: wal, tables: tableRows, tablesTruncated: tables.length > 200 });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  const awaitStat = (filename: string) => { try { return fs.statSync(filename).size; } catch { return 0; } };

  router.post('/maintenance', (req, res) => {
    const action = String(req.body?.action || '');
    const checks = new Set(['quick_check', 'integrity_check']);
    const rootActions = new Set(['vacuum']);
    const writeActions = new Set(['optimize', 'analyze', 'checkpoint']);
    if (!checks.has(action) && !rootActions.has(action) && !writeActions.has(action)) return fail(res, httpError(400, 'Hành động bảo trì không hợp lệ'));
    if (rootActions.has(action) ? !requireRootStepUp(req, res, 'VACUUM yêu cầu quyền root và xác nhận lại danh tính') : writeActions.has(action) && !requireStepUp(req, res, 'Bảo trì database yêu cầu xác nhận lại danh tính')) return;
    let database: DatabaseSync | undefined;
    try {
      const opened = openDatabase(req.body?.path, checks.has(action)); database = opened.database;
      let rows: unknown[] = [];
      if (action === 'quick_check' || action === 'integrity_check') rows = database.prepare(`PRAGMA ${action}`).all().map(row => jsonRow(row as Record<string, unknown>));
      else if (action === 'checkpoint') rows = database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all().map(row => jsonRow(row as Record<string, unknown>));
      else database.exec(action === 'optimize' ? 'PRAGMA optimize' : action.toUpperCase());
      log(req, `sqlite_${action}`, `SQLite maintenance: ${action}`, { path: relative(opened.filename) });
      return res.json({ success: true, action, rows });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.post('/explain', (req, res) => {
    let database: DatabaseSync | undefined;
    try {
      const sql = String(req.body?.sql || '').trim();
      if (!sql || sql.length > MAX_SQL_LENGTH || !/^(?:SELECT|WITH)\b/i.test(sql)) throw httpError(400, 'EXPLAIN chỉ chấp nhận SELECT hoặc WITH');
      if (/\b(?:ATTACH|DETACH)\b|\bVACUUM\s+INTO\b|load_extension\s*\(/i.test(sql)) throw httpError(403, 'Câu lệnh có thể truy cập ngoài database hiện tại đã bị chặn');
      ({ database } = openDatabase(req.body?.path, true));
      const params = Array.isArray(req.body?.params) ? req.body.params.map(sqlValue) : [];
      if (params.length > 100) throw httpError(400, 'Quá nhiều tham số');
      const rows = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map(row => jsonRow(row as Record<string, unknown>));
      return res.json({ success: true, rows });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.get('/export', (req, res) => {
    let database: DatabaseSync | undefined;
    try {
      const format = String(req.query.format || 'json').toLowerCase();
      if (format !== 'json' && format !== 'csv') throw httpError(400, 'format phải là json hoặc csv');
      const limit = Math.min(MAX_EXPORT_ROWS, Math.max(1, Number(req.query.limit) || MAX_EXPORT_ROWS));
      ({ database } = openDatabase(req.query.path, true));
      const object = schemaObject(database, req.query.table);
      const filter = requestedFilter(database, object.table, req.query as Record<string, unknown>);
      const sort = sortSql(database, object.table, req.query.sort, req.query.order);
      const rawRows = database.prepare(`SELECT * FROM ${quoteIdentifier(object.table)}${filter.sql}${sort} LIMIT ?`).all(...filter.values, limit + 1);
      const truncated = rawRows.length > limit;
      if (truncated) rawRows.pop();
      const rows = rawRows.map(row => jsonRow(row as Record<string, unknown>));
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(object.table)}.${format}"`);
      if (format === 'json') return res.type('application/json').send(JSON.stringify({ table: object.table, rows, truncated }));
      const headers = columnsFor(database, object.table).map(column => column.name);
      return res.type('text/csv').send([headers.map(csvCell).join(','), ...rows.map(row => headers.map(header => csvCell(row[header])).join(','))].join('\r\n'));
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.post('/import', (req, res) => {
    if (!requireStepUp(req, res, 'Import dữ liệu yêu cầu xác nhận lại danh tính')) return;
    let database: DatabaseSync | undefined;
    try {
      const format = String(req.body?.format || 'json').toLowerCase();
      if (format !== 'json' && format !== 'csv') throw httpError(400, 'format phải là json hoặc csv');
      const payloadSize = Buffer.byteLength(JSON.stringify(req.body?.data ?? req.body?.rows ?? ''));
      if (payloadSize > MAX_IMPORT_BYTES) throw httpError(413, 'Payload import quá lớn');
      let rows: unknown = format === 'csv' ? parseCsv(String(req.body?.data || '')) : (req.body?.rows ?? req.body?.data);
      if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch { throw httpError(400, 'JSON import không hợp lệ'); } }
      if (!Array.isArray(rows) || !rows.length || rows.length > MAX_IMPORT_ROWS) throw httpError(400, `Import cần từ 1 đến ${MAX_IMPORT_ROWS} hàng`);
      ({ database } = openDatabase(req.body?.path));
      const object = schemaObject(database, req.body?.table, true);
      const columns = columnsFor(database, object.table);
      const prepared = rows.map(row => valuesObject(row, columns));
      const names = prepared[0].map(([name]) => name);
      if (prepared.some(entries => entries.length !== names.length || entries.some(([name], index) => name !== names[index]))) throw httpError(400, 'Mọi hàng import phải có cùng thứ tự cột');
      const statement = database.prepare(`INSERT INTO ${quoteIdentifier(object.table)} (${names.map(quoteIdentifier).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`);
      database.exec('BEGIN IMMEDIATE');
      try { for (const entries of prepared) statement.run(...entries.map(([, value]) => value)); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
      log(req, 'sqlite_import', 'SQLite rows imported', { path: req.body.path, table: object.table, rowCount: rows.length, format });
      return res.status(201).json({ success: true, rowCount: rows.length });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.post('/query', (req, res) => {
    let database: DatabaseSync | undefined;
    try {
      const sql = String(req.body?.sql || '').trim();
      if (!sql || sql.length > MAX_SQL_LENGTH) throw httpError(400, 'Câu lệnh SQL trống hoặc quá dài');
      const readOnly = /^(?:SELECT|WITH|EXPLAIN)\b/i.test(sql);
      if (!readOnly && !requireStepUp(req, res, 'Thay đổi database yêu cầu xác nhận lại danh tính')) return;
      if (/\b(?:ATTACH|DETACH)\b|\bVACUUM\s+INTO\b|load_extension\s*\(/i.test(sql)) throw httpError(403, 'Câu lệnh có thể truy cập ngoài database hiện tại đã bị chặn');
      const opened = openDatabase(req.body?.path, readOnly); database = opened.database;
      const startedAt = Date.now();
      if (readOnly) {
        const statement = database.prepare(sql);
        const rows: Record<string, unknown>[] = [];
        let truncated = false;
        for (const row of statement.iterate()) { if (rows.length === MAX_RESULT_ROWS) { truncated = true; break; } rows.push(jsonRow(row as Record<string, unknown>)); }
        log(req, 'sqlite_query', 'SQLite read query executed', { path: relative(opened.filename), rowCount: rows.length });
        return res.json({ success: true, rows, rowCount: rows.length, truncated, durationMs: Date.now() - startedAt });
      }
      database.exec(sql);
      log(req, 'sqlite_execute', 'SQLite write query executed', { path: relative(opened.filename) });
      return res.json({ success: true, rows: [], rowCount: 0, durationMs: Date.now() - startedAt });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.get('/backups', async (_req, res) => {
    try {
      await ensureBackupRoot();
      const entries = await fsp.readdir(backupRoot, { withFileTypes: true });
      const backups = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith('.sqlite')).map(async entry => { const stat = await fsp.stat(path.join(backupRoot, entry.name)); return { name: entry.name, size: stat.size, mtime: stat.mtime.toISOString() }; }));
      backups.sort((a, b) => b.mtime.localeCompare(a.mtime));
      return res.json({ success: true, backups });
    } catch (error) { return fail(res, error); }
  });

  router.post('/backups', async (req, res) => {
    if (!requireStepUp(req, res, 'Tạo backup yêu cầu xác nhận lại danh tính')) return;
    let database: DatabaseSync | undefined;
    try {
      await ensureBackupRoot();
      const opened = openDatabase(req.body?.path, true); database = opened.database;
      const base = path.basename(opened.filename, path.extname(opened.filename)).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'database';
      const name = req.body?.name === undefined ? `${base}-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite` : String(req.body.name);
      const target = backupPath(name);
      if (fs.existsSync(target)) throw httpError(409, 'Backup đã tồn tại');
      await backup(database, target);
      log(req, 'sqlite_backup_create', 'SQLite backup created', { path: relative(opened.filename), backup: name });
      const stat = await fsp.stat(target);
      return res.status(201).json({ success: true, backup: { name, size: stat.size, mtime: stat.mtime.toISOString() } });
    } catch (error) { return fail(res, error); } finally { database?.close(); }
  });

  router.get('/backups/:name/download', async (req, res) => {
    try {
      await ensureBackupRoot();
      const filename = backupPath(req.params.name);
      const stat = await fsp.lstat(filename);
      if (!stat.isFile() || !isInside(fs.realpathSync(backupRoot), fs.realpathSync(filename))) throw httpError(403, 'Backup không phải tệp tin an toàn');
      return res.download(filename, req.params.name);
    }
    catch (error) { return fail(res, error); }
  });

  router.post('/backups/:name/restore', async (req, res) => {
    if (!requireRootStepUp(req, res, 'Khôi phục backup yêu cầu quyền root và xác nhận lại danh tính')) return;
    try {
      await ensureBackupRoot();
      const source = backupPath(req.params.name);
      const sourceStat = await fsp.lstat(source);
      if (!sourceStat.isFile() || !isInside(fs.realpathSync(backupRoot), fs.realpathSync(source)) || await sqliteHeader(source) !== 'SQLite format 3\0') throw httpError(400, 'Backup không phải SQLite hợp lệ');
      const target = resolveDatabase(req.body?.path);
      if (protectedPaths.has(path.resolve(target))) throw httpError(403, 'Không thể khôi phục đè database hệ thống đang sử dụng');
      const temporary = `${target}.restore-${process.pid}-${Date.now()}`;
      const previous = `${target}.previous-${process.pid}-${Date.now()}`;
      await fsp.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
      try {
        const check = new DatabaseSync(temporary, { readOnly: true });
        try { if ((check.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check !== 'ok') throw httpError(400, 'Backup không vượt qua quick_check'); } finally { check.close(); }
        await Promise.all(['-wal', '-shm'].map(suffix => fsp.rm(target + suffix, { force: true })));
        await fsp.rename(target, previous);
        try { await fsp.rename(temporary, target); } catch (error) { await fsp.rename(previous, target); throw error; }
        await fsp.rm(previous, { force: true });
      } finally { await fsp.rm(temporary, { force: true }); }
      log(req, 'sqlite_backup_restore', 'SQLite backup restored', { path: relative(target), backup: req.params.name });
      return res.json({ success: true });
    } catch (error) { return fail(res, error); }
  });

  router.delete('/backups/:name', async (req, res) => {
    if (!requireRootStepUp(req, res, 'Xóa backup yêu cầu quyền root và xác nhận lại danh tính')) return;
    try { await ensureBackupRoot(); const filename = backupPath(req.params.name); await fsp.rm(filename); log(req, 'sqlite_backup_delete', 'SQLite backup deleted', { backup: req.params.name }); return res.json({ success: true }); }
    catch (error) { return fail(res, error); }
  });

  router.delete('/', async (req, res) => {
    if (!requireRootStepUp(req, res, 'Xóa database yêu cầu xác nhận lại danh tính')) return;
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
