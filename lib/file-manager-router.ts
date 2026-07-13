import { Router, raw, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { execFile } from 'child_process';
import * as archiver from 'archiver';
import unzipper from 'unzipper';

const fsp = fs.promises;
const MAX_EDITOR_SIZE = 2 * 1024 * 1024;
const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;
const MAX_BULK_ITEMS = 100;
const MAX_SEARCH_RESULTS = 500;
const MAX_SEARCH_ENTRIES = 20_000;
const PREVIEW_TYPES: Record<string, string> = {
  '.aac': 'audio/aac',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.flac': 'audio/flac',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4v': 'video/x-m4v',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.ogv': 'video/ogg',
  '.opus': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp'
};
const OFFICE_EXTENSIONS = new Set(['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp']);

type Options = {
  hasSession: (token: string) => boolean;
  consumePreviewTicket: (ticket: string, filePath: string) => boolean;
  log: (event: string, ip: string, details?: { action?: string; level?: 'info' | 'warning' | 'critical'; result?: 'success' | 'failure'; metadata?: Record<string, unknown> }) => Promise<unknown>;
  rootDir?: string;
  trashDir?: string;
};

type TrashMetadata = { originalPath: string; deletedAt: string };

function clientIp(req: Request) {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
}

function validName(name: unknown): name is string {
  if (typeof name !== 'string' || !name || name.length > 255 || name === '.' || name === '..') return false;
  if (/[\\/\0]/.test(name)) return false;
  return !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}

function modeInfo(mode: number) {
  const value = mode & 0o7777;
  const bit = (mask: number, char: string) => value & mask ? char : '-';
  return {
    mode: value.toString(8).padStart(4, '0'),
    permissions: `${bit(0o400, 'r')}${bit(0o200, 'w')}${bit(0o100, 'x')}${bit(0o040, 'r')}${bit(0o020, 'w')}${bit(0o010, 'x')}${bit(0o004, 'r')}${bit(0o002, 'w')}${bit(0o001, 'x')}`,
    platform: process.platform
  };
}

export function createFileManagerRouter({ hasSession, consumePreviewTicket, log, rootDir, trashDir }: Options) {
  const router = Router();
  const root = path.resolve(rootDir || process.cwd());
  const trashRoot = path.resolve(trashDir || path.join(process.cwd(), '.terminal-trash'));

  const authenticate = (req: Request) => {
    const encodedToken = String(req.headers.cookie || '').split(';').map(cookie => cookie.trim().split('=')).find(([name]) => name === 'terminal_session')?.slice(1).join('=') || '';
    const token = encodedToken ? decodeURIComponent(encodedToken) : '';
    return Boolean(token && hasSession(token));
  };
  const relative = (absolutePath: string) => path.relative(root, absolutePath).split(path.sep).join('/');
  const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
  const resolveInsideRoot = (userPath: unknown, allowTrash = false) => {
    if (typeof userPath !== 'string' && userPath !== undefined) throw httpError(400, 'Đường dẫn không hợp lệ');
    const normalized = typeof userPath === 'string' ? userPath.replace(/^[/\\]+/, '') : '';
    const target = path.resolve(root, normalized);
    const relativeTarget = path.relative(root, target);
    if (relativeTarget.startsWith('..' + path.sep) || relativeTarget === '..' || path.isAbsolute(relativeTarget)) throw httpError(403, 'Đường dẫn nằm ngoài thư mục quản lý');
    const relativeTrash = path.relative(trashRoot, target);
    if (!allowTrash && (relativeTrash === '' || (!relativeTrash.startsWith('..' + path.sep) && relativeTrash !== '..' && !path.isAbsolute(relativeTrash)))) throw httpError(403, 'Không thể truy cập trực tiếp thùng rác');
    return target;
  };
  const fail = (res: Response, error: any) => {
    const statuses: Record<string, number> = { ENOENT: 404, EEXIST: 409, EACCES: 403, EPERM: 403, ENOTDIR: 400, EISDIR: 400, EXDEV: 409, ENOSPC: 507 };
    const status = error.status || statuses[error.code] || 500;
    return res.status(status).json({ success: false, code: error.code || `HTTP_${status}`, error: error.message || 'Lỗi hệ thống tệp tin' });
  };
  const mustBeDirectory = async (target: string) => {
    if (!(await fsp.stat(target)).isDirectory()) throw httpError(400, 'Đường dẫn không phải thư mục');
  };
  const ensureMissing = async (target: string) => {
    try { await fsp.access(target); throw httpError(409, 'Đích đã tồn tại'); }
    catch (error: any) { if (error.status || error.code !== 'ENOENT') throw error; }
  };
  const itemDetails = async (itemPath: string) => {
    const linkStat = await fsp.lstat(itemPath);
    let stat = linkStat;
    if (linkStat.isSymbolicLink()) {
      try { stat = await fsp.stat(itemPath); } catch { /* Broken links still have useful metadata. */ }
    }
    return { name: path.basename(itemPath), path: relative(itemPath), isDirectory: stat.isDirectory(), isSymlink: linkStat.isSymbolicLink(), size: stat.size, mtime: stat.mtime.toISOString(), ...modeInfo(linkStat.mode) };
  };
  const pathsFrom = (body: any, singular = 'path') => {
    const value = body?.paths ?? body?.ids ?? (body?.[singular] !== undefined ? [body[singular]] : undefined);
    if (!Array.isArray(value) || !value.length || value.length > MAX_BULK_ITEMS) throw httpError(400, `Danh sách phải có từ 1 đến ${MAX_BULK_ITEMS} mục`);
    return value;
  };
  const trashOne = async (userPath: unknown) => {
    const target = resolveInsideRoot(userPath);
    if (target === root) throw httpError(400, 'Không thể xóa thư mục gốc');
    await fsp.lstat(target);
    await fsp.mkdir(trashRoot, { recursive: true });
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${path.basename(target)}`;
    await fsp.rename(target, path.join(trashRoot, id));
    await fsp.writeFile(path.join(trashRoot, `${id}.json`), JSON.stringify({ originalPath: relative(target), deletedAt: new Date().toISOString() } satisfies TrashMetadata));
    return { id, path: relative(target) };
  };
  const restoreOne = async (id: unknown) => {
    if (!validName(id)) throw httpError(400, 'Mục thùng rác không hợp lệ');
    const trashed = path.join(trashRoot, id);
    const metadataFile = `${trashed}.json`;
    const metadata = JSON.parse(await fsp.readFile(metadataFile, 'utf8')) as TrashMetadata;
    const target = resolveInsideRoot(metadata.originalPath);
    await ensureMissing(target);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(trashed, target);
    await fsp.unlink(metadataFile);
    return { id, path: metadata.originalPath };
  };
  const removeTrashOne = async (id: unknown) => {
    if (!validName(id)) throw httpError(400, 'Mục thùng rác không hợp lệ');
    await fsp.rm(path.join(trashRoot, id), { recursive: true, force: false });
    await fsp.rm(path.join(trashRoot, `${id}.json`), { force: true });
    return { id };
  };
  const runItems = async (values: unknown[], action: (value: unknown) => Promise<Record<string, unknown>>) => Promise.all(values.map(async value => {
    try { return { success: true, ...(await action(value)) }; }
    catch (error: any) { return { success: false, path: value, code: error.code || `HTTP_${error.status || 500}`, error: error.message || 'Thao tác thất bại' }; }
  }));

  router.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      res.once('finish', () => {
        if (res.statusCode >= 400) void log(`File operation failed: ${req.method} ${req.path}`, clientIp(req), { action: `${req.method.toLowerCase()}_${req.path.replace(/\W+/g, '_')}`, level: res.statusCode >= 500 ? 'critical' : 'warning', result: 'failure', metadata: { status: res.statusCode } });
      });
    }
    const acceptsQueryToken = req.path === '/media' || req.path === '/office-preview';
    const ticket = acceptsQueryToken && typeof req.query.ticket === 'string' ? req.query.ticket : '';
    const filePath = acceptsQueryToken && typeof req.query.path === 'string' ? req.query.path : '';
    return authenticate(req) || Boolean(ticket && consumePreviewTicket(ticket, filePath)) ? next() : res.status(401).json({ success: false, code: 'UNAUTHORIZED', error: 'Unauthorized' });
  });

  router.get('/', async (req, res) => {
    try {
      const target = resolveInsideRoot(req.query.path);
      await mustBeDirectory(target);
      const entries = await fsp.readdir(target, { withFileTypes: true });
      const files = (await Promise.all(entries.filter(entry => path.join(target, entry.name) !== trashRoot).map(entry => itemDetails(path.join(target, entry.name))))).sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
      return res.json({ success: true, currentPath: relative(target), parentPath: target === root ? null : relative(path.dirname(target)), platform: process.platform, files });
    } catch (error) { return fail(res, error); }
  });

  router.get('/search', async (req, res) => {
    try {
      const query = String(req.query.q ?? req.query.query ?? '').trim().toLocaleLowerCase();
      if (!query || query.length > 255) throw httpError(400, 'Từ khóa tìm kiếm không hợp lệ');
      const start = resolveInsideRoot(req.query.path);
      await mustBeDirectory(start);
      const requestedLimit = Number(req.query.limit || 100);
      const limit = Math.min(MAX_SEARCH_RESULTS, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 100));
      const queue = [start];
      const results: Awaited<ReturnType<typeof itemDetails>>[] = [];
      let scanned = 0;
      while (queue.length && results.length < limit && scanned < MAX_SEARCH_ENTRIES) {
        const directory = queue.shift()!;
        let entries: fs.Dirent[];
        try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          const itemPath = path.join(directory, entry.name);
          if (itemPath === trashRoot) continue;
          scanned++;
          if (entry.name.toLocaleLowerCase().includes(query)) {
            try { results.push(await itemDetails(itemPath)); } catch { /* Continue through inaccessible entries. */ }
          }
          if (entry.isDirectory() && !entry.isSymbolicLink()) queue.push(itemPath);
          if (results.length >= limit || scanned >= MAX_SEARCH_ENTRIES) break;
        }
      }
      return res.json({ success: true, results, scanned, truncated: Boolean(queue.length || results.length >= limit), limit });
    } catch (error) { return fail(res, error); }
  });

  router.get('/read', async (req, res) => {
    try {
      const target = resolveInsideRoot(req.query.path); const stat = await fsp.stat(target);
      if (!stat.isFile()) throw httpError(400, 'Đường dẫn không phải tệp tin');
      if (stat.size > MAX_EDITOR_SIZE) throw httpError(413, 'Tệp quá lớn để chỉnh sửa (giới hạn 2MB)');
      const buffer = await fsp.readFile(target);
      if (buffer.subarray(0, 512).includes(0)) return res.json({ success: true, isBinary: true, size: stat.size, mtime: stat.mtime.toISOString() });
      return res.json({ success: true, isBinary: false, content: buffer.toString('utf8'), size: stat.size, mtime: stat.mtime.toISOString() });
    } catch (error) { return fail(res, error); }
  });

  router.get('/media', async (req, res) => {
    try {
      const target = resolveInsideRoot(req.query.path); const stat = await fsp.stat(target);
      if (!stat.isFile()) throw httpError(400, 'Đường dẫn không phải tệp tin');
      const contentType = PREVIEW_TYPES[path.extname(target).toLowerCase()];
      if (!contentType) throw httpError(415, 'Định dạng xem trước không được hỗ trợ');
      const range = req.headers.range;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`);
      if (!range) {
        res.setHeader('Content-Length', stat.size);
        return fs.createReadStream(target).on('error', error => res.destroy(error)).pipe(res);
      }
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) { res.setHeader('Content-Range', `bytes */${stat.size}`); return res.sendStatus(416); }
      const start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
      const end = match[2] && match[1] ? Number(match[2]) : stat.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= stat.size) {
        res.setHeader('Content-Range', `bytes */${stat.size}`); return res.sendStatus(416);
      }
      const boundedEnd = Math.min(end, stat.size - 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${boundedEnd}/${stat.size}`);
      res.setHeader('Content-Length', boundedEnd - start + 1);
      return fs.createReadStream(target, { start, end: boundedEnd }).on('error', error => res.destroy(error)).pipe(res);
    } catch (error) { return fail(res, error); }
  });

  router.get('/office-preview', async (req, res) => {
    let tempDir: string | undefined;
    try {
      const target = resolveInsideRoot(req.query.path); const stat = await fsp.stat(target);
      if (!stat.isFile() || !OFFICE_EXTENSIONS.has(path.extname(target).toLowerCase())) throw httpError(415, 'Định dạng Office không được hỗ trợ');
      tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'terminal-office-'));
      await new Promise<void>((resolve, reject) => {
        execFile(process.env.LIBREOFFICE_PATH || 'libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', tempDir!, target], { timeout: 120_000, maxBuffer: 1024 * 1024 }, (error) => error ? reject(error) : resolve());
      }).catch((error: any) => {
        if (error.code === 'ENOENT') throw httpError(501, 'Chưa cài LibreOffice trên backend. Hãy cài gói libreoffice để xem tài liệu Office.');
        throw httpError(422, `Không thể chuyển tài liệu Office sang PDF: ${error.message}`);
      });
      const pdfPath = path.join(tempDir, `${path.parse(target).name}.pdf`);
      const pdfStat = await fsp.stat(pdfPath);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', pdfStat.size);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(`${path.parse(target).name}.pdf`)}`);
      const cleanup = () => tempDir && fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      res.once('finish', cleanup); res.once('close', cleanup);
      return fs.createReadStream(pdfPath).on('error', error => res.destroy(error)).pipe(res);
    } catch (error) {
      if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      return fail(res, error);
    }
  });

  router.post('/create', async (req, res) => {
    try {
      const { dirPath, name } = req.body; if (!validName(name)) throw httpError(400, 'Tên tệp không hợp lệ');
      const target = path.join(resolveInsideRoot(dirPath), name); const handle = await fsp.open(target, 'wx'); await handle.close();
      await log(`Đã tạo tệp: ${relative(target)}`, clientIp(req));
      return res.status(201).json({ success: true, path: relative(target), mtime: (await fsp.stat(target)).mtime.toISOString() });
    } catch (error) { return fail(res, error); }
  });

  router.post('/write', async (req, res) => {
    let temp: string | undefined;
    try {
      const { filePath, content, expectedMtime } = req.body;
      if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_EDITOR_SIZE) throw httpError(413, 'Nội dung vượt giới hạn 2MB');
      const target = resolveInsideRoot(filePath); const stat = await fsp.stat(target);
      if (!stat.isFile()) throw httpError(400, 'Đường dẫn không phải tệp tin');
      if (!expectedMtime || stat.mtime.toISOString() !== expectedMtime) throw httpError(409, 'Tệp đã thay đổi trên máy chủ. Hãy tải lại trước khi lưu.');
      temp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
      await fsp.writeFile(temp, content, { encoding: 'utf8', flag: 'wx', mode: stat.mode }); await fsp.rename(temp, target); temp = undefined;
      const updated = await fsp.stat(target); await log(`Đã chỉnh sửa tệp: ${relative(target)}`, clientIp(req));
      return res.json({ success: true, mtime: updated.mtime.toISOString() });
    } catch (error) { if (temp) await fsp.rm(temp, { force: true }).catch(() => undefined); return fail(res, error); }
  });

  router.post('/mkdir', async (req, res) => {
    try {
      const { dirPath, name } = req.body; if (!validName(name)) throw httpError(400, 'Tên thư mục không hợp lệ');
      const target = path.join(resolveInsideRoot(dirPath), name); await fsp.mkdir(target); await log(`Đã tạo thư mục: ${relative(target)}`, clientIp(req));
      return res.status(201).json({ success: true, path: relative(target) });
    } catch (error) { return fail(res, error); }
  });

  router.get('/download', async (req, res) => {
    try {
      const target = resolveInsideRoot(req.query.path); const stat = await fsp.stat(target); if (!stat.isFile()) throw httpError(400, 'Chỉ có thể tải tệp tin');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`); res.setHeader('Content-Length', stat.size); fs.createReadStream(target).on('error', error => fail(res, error)).pipe(res);
    } catch (error) { return fail(res, error); }
  });

  router.post('/upload', raw({ type: 'application/octet-stream', limit: MAX_UPLOAD_SIZE }), async (req: any, res) => {
    try {
      const name = decodeURIComponent(String(req.headers['x-file-name'] || '')); const dirPath = decodeURIComponent(String(req.headers['x-directory'] || ''));
      if (!validName(name)) throw httpError(400, 'Tên tệp upload không hợp lệ');
      const target = path.join(resolveInsideRoot(dirPath), name); await fsp.writeFile(target, req.body, { flag: 'wx' }); await log(`Đã upload tệp: ${relative(target)}`, clientIp(req));
      return res.status(201).json({ success: true, path: relative(target) });
    } catch (error) { return fail(res, error); }
  });

  router.post('/move', async (req, res) => {
    try {
      const { sourcePath, destinationDir, newName } = req.body; const source = resolveInsideRoot(sourcePath); const destination = resolveInsideRoot(destinationDir); await mustBeDirectory(destination);
      const name = newName || path.basename(source); if (!validName(name)) throw httpError(400, 'Tên mới không hợp lệ');
      const target = path.join(destination, name); await ensureMissing(target); await fsp.rename(source, target); await log(`Đã di chuyển/đổi tên: ${relative(source)} -> ${relative(target)}`, clientIp(req));
      return res.json({ success: true, path: relative(target) });
    } catch (error) { return fail(res, error); }
  });

  router.post('/transfer', async (req, res) => {
    try {
      const sources = pathsFrom(req.body, 'sourcePath'); const destination = resolveInsideRoot(req.body.destinationDir ?? req.body.destinationPath); await mustBeDirectory(destination);
      const operation = req.body.operation ?? req.body.action ?? 'copy'; if (!['copy', 'move'].includes(operation)) throw httpError(400, 'Thao tác phải là copy hoặc move');
      const results = await runItems(sources, async value => {
        const source = resolveInsideRoot(value); if (source === root) throw httpError(400, 'Không thể chuyển thư mục gốc');
        const target = path.join(destination, path.basename(source)); if (target === source || target.startsWith(source + path.sep)) throw httpError(400, 'Đích không thể nằm trong nguồn');
        await ensureMissing(target);
        if (operation === 'copy') await fsp.cp(source, target, { recursive: true, errorOnExist: true }); else await fsp.rename(source, target);
        return { sourcePath: relative(source), path: relative(target) };
      });
      await log(`Đã ${operation === 'copy' ? 'sao chép' : 'di chuyển'} hàng loạt ${results.filter(item => item.success).length} mục`, clientIp(req));
      return res.status(results.some(item => !item.success) ? 207 : 200).json({ success: results.every(item => item.success), results });
    } catch (error) { return fail(res, error); }
  });

  router.get('/metadata', async (req, res) => {
    try {
      const target = resolveInsideRoot(req.query.path); const details = await itemDetails(target); const stat = await fsp.lstat(target);
      return res.json({ success: true, ...details, uid: stat.uid, gid: stat.gid, birthtime: stat.birthtime.toISOString(), atime: stat.atime.toISOString() });
    } catch (error) { return fail(res, error); }
  });

  router.patch('/metadata', async (req, res) => {
    try {
      const target = resolveInsideRoot(req.body.path); const { mode, uid, gid } = req.body;
      if (mode === undefined && uid === undefined && gid === undefined) throw httpError(400, 'Cần cung cấp mode, uid hoặc gid');
      if (mode !== undefined) {
        const parsed = typeof mode === 'string' ? Number.parseInt(mode, 8) : mode;
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0o7777) throw httpError(400, 'Mode không hợp lệ');
        await fsp.chmod(target, parsed);
      }
      if (uid !== undefined || gid !== undefined) {
        if (process.platform === 'win32') throw httpError(501, 'Chown không được hỗ trợ trên Windows');
        const stat = await fsp.stat(target); const nextUid = uid === undefined ? stat.uid : Number(uid); const nextGid = gid === undefined ? stat.gid : Number(gid);
        if (!Number.isInteger(nextUid) || !Number.isInteger(nextGid) || nextUid < 0 || nextGid < 0) throw httpError(400, 'UID/GID không hợp lệ');
        await fsp.chown(target, nextUid, nextGid);
      }
      await log(`Đã cập nhật metadata: ${relative(target)}`, clientIp(req)); return res.json({ success: true, ...(await itemDetails(target)) });
    } catch (error) { return fail(res, error); }
  });

  router.post('/archive/create', async (req, res) => {
    try {
      const sources = pathsFrom(req.body); const destinationDir = resolveInsideRoot(req.body.destinationDir ?? ''); await mustBeDirectory(destinationDir);
      const format = req.body.format ?? 'zip'; if (!['zip', 'tar', 'tar.gz'].includes(format)) throw httpError(400, 'Định dạng archive không được hỗ trợ');
      const defaultName = `archive-${Date.now()}.${format}`; const name = req.body.name ?? defaultName; if (!validName(name)) throw httpError(400, 'Tên archive không hợp lệ');
      const target = path.join(destinationDir, name); await ensureMissing(target);
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(target, { flags: 'wx' }); const archive = format === 'zip' ? new archiver.ZipArchive() : new archiver.TarArchive(format === 'tar.gz' ? { gzip: true } : {});
        output.on('close', resolve); output.on('error', reject); archive.on('error', reject); archive.pipe(output);
        try { for (const value of sources) { const source = resolveInsideRoot(value); const stat = fs.lstatSync(source); if (stat.isDirectory()) archive.directory(source, path.basename(source)); else archive.file(source, { name: path.basename(source) }); } archive.finalize(); } catch (error) { archive.abort(); reject(error); }
      }).catch(async error => { await fsp.rm(target, { force: true }); throw error; });
      await log(`Đã tạo archive: ${relative(target)}`, clientIp(req)); return res.status(201).json({ success: true, path: relative(target) });
    } catch (error) { return fail(res, error); }
  });

  router.post('/archive/extract', async (req, res) => {
    try {
      const source = resolveInsideRoot(req.body.path ?? req.body.archivePath); const destination = resolveInsideRoot(req.body.destinationDir); await mustBeDirectory(destination);
      if (path.extname(source).toLowerCase() !== '.zip') throw httpError(400, 'Chỉ hỗ trợ giải nén ZIP');
      const directory = await unzipper.Open.file(source); const planned = directory.files.map(entry => {
        const normalized = entry.path.replace(/\\/g, '/');
        if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) throw httpError(400, `ZIP chứa đường dẫn không an toàn: ${entry.path}`);
        const target = path.resolve(destination, normalized); if (target !== destination && !target.startsWith(destination + path.sep)) throw httpError(400, `ZIP chứa đường dẫn không an toàn: ${entry.path}`);
        return { entry, target };
      });
      for (const { entry, target } of planned) {
        if (entry.type === 'Directory') await fsp.mkdir(target, { recursive: true });
        else { await fsp.mkdir(path.dirname(target), { recursive: true }); await ensureMissing(target); await new Promise<void>((resolve, reject) => entry.stream().pipe(fs.createWriteStream(target, { flags: 'wx' })).on('finish', resolve).on('error', reject)); }
      }
      await log(`Đã giải nén: ${relative(source)} -> ${relative(destination)}`, clientIp(req)); return res.json({ success: true, destinationPath: relative(destination), entries: planned.length });
    } catch (error) { return fail(res, error); }
  });

  router.post('/symlink', async (req, res) => {
    try {
      const source = resolveInsideRoot(req.body.targetPath ?? req.body.sourcePath); await fsp.lstat(source);
      const destinationDir = resolveInsideRoot(req.body.destinationDir); await mustBeDirectory(destinationDir); const name = req.body.name ?? path.basename(source); if (!validName(name)) throw httpError(400, 'Tên liên kết không hợp lệ');
      const target = path.join(destinationDir, name); await ensureMissing(target); const type = process.platform === 'win32' ? ((await fsp.stat(source)).isDirectory() ? 'junction' : 'file') : undefined;
      await fsp.symlink(source, target, type); await log(`Đã tạo symlink: ${relative(target)} -> ${relative(source)}`, clientIp(req)); return res.status(201).json({ success: true, path: relative(target) });
    } catch (error) { return fail(res, error); }
  });

  router.delete('/', async (req, res) => {
    try { const result = await trashOne(req.query.path); await log(`Đã chuyển vào thùng rác: ${result.path}`, clientIp(req)); return res.json({ success: true, message: 'Đã chuyển vào thùng rác', ...result }); }
    catch (error) { return fail(res, error); }
  });

  router.post('/trash', async (req, res) => {
    try {
      const results = await runItems(pathsFrom(req.body), trashOne); await log(`Đã chuyển hàng loạt ${results.filter(item => item.success).length} mục vào thùng rác`, clientIp(req));
      return res.status(results.some(item => !item.success) ? 207 : 200).json({ success: results.every(item => item.success), results });
    } catch (error) { return fail(res, error); }
  });

  router.get('/trash', async (_req, res) => {
    try {
      await fsp.mkdir(trashRoot, { recursive: true }); const names = (await fsp.readdir(trashRoot)).filter(name => !name.endsWith('.json'));
      const items = await Promise.all(names.map(async id => { try { const metadata = JSON.parse(await fsp.readFile(path.join(trashRoot, `${id}.json`), 'utf8')) as TrashMetadata; const details = await itemDetails(path.join(trashRoot, id)); return { id, ...metadata, name: path.basename(metadata.originalPath), isDirectory: details.isDirectory, size: details.size, mtime: details.mtime, mode: details.mode, permissions: details.permissions, platform: process.platform }; } catch (error: any) { return { id, error: error.message || 'Metadata thùng rác không hợp lệ' }; } }));
      return res.json({ success: true, items: items.sort((a: any, b: any) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || ''))) });
    } catch (error) { return fail(res, error); }
  });

  router.post('/trash/restore', async (req, res) => {
    try {
      const ids = req.body.ids ?? (req.body.id !== undefined ? [req.body.id] : undefined); if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BULK_ITEMS) throw httpError(400, 'Danh sách khôi phục không hợp lệ');
      const results = await runItems(ids, restoreOne); await log(`Đã khôi phục ${results.filter(item => item.success).length} mục`, clientIp(req));
      if (req.body.id !== undefined && req.body.ids === undefined && results[0].success) return res.json(results[0]);
      return res.status(results.some(item => !item.success) ? 207 : 200).json({ success: results.every(item => item.success), results });
    } catch (error) { return fail(res, error); }
  });

  router.delete('/trash', async (req, res) => {
    try { const ids = req.body?.ids ?? (req.query.id !== undefined ? [req.query.id] : undefined); if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BULK_ITEMS) throw httpError(400, 'Danh sách xóa vĩnh viễn không hợp lệ'); const results = await runItems(ids, removeTrashOne); await log(`Đã xóa vĩnh viễn ${results.filter(item => item.success).length} mục`, clientIp(req)); return res.status(results.some(item => !item.success) ? 207 : 200).json({ success: results.every(item => item.success), results }); }
    catch (error) { return fail(res, error); }
  });

  router.delete('/trash/empty', async (req, res) => {
    try { await fsp.rm(trashRoot, { recursive: true, force: true }); await fsp.mkdir(trashRoot, { recursive: true }); await log('Đã dọn sạch thùng rác', clientIp(req)); return res.json({ success: true }); }
    catch (error) { return fail(res, error); }
  });

  return router;
}
