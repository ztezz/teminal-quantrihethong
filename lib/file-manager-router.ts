import { Router, raw, type Request } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const fsp = fs.promises;
const MAX_EDITOR_SIZE = 2 * 1024 * 1024;
const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;

type Options = {
  hasSession: (token: string) => boolean;
  log: (event: string, ip: string) => Promise<unknown>;
};

function clientIp(req: Request) {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
}

function validName(name: unknown): name is string {
  if (typeof name !== 'string' || !name || name.length > 255 || name === '.' || name === '..') return false;
  if (/[\\/\0]/.test(name)) return false;
  return !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}

export function createFileManagerRouter({ hasSession, log }: Options) {
  const router = Router();
  const root = path.resolve(process.env.FILE_MANAGER_ROOT || process.cwd());
  const trashRoot = path.join(root, '.terminal-trash');

  const authenticate = (req: Request) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return Boolean(token && hasSession(token));
  };

  const relative = (absolutePath: string) => path.relative(root, absolutePath).split(path.sep).join('/');

  const resolveInsideRoot = (userPath: unknown) => {
    if (typeof userPath !== 'string' && userPath !== undefined) throw Object.assign(new Error('Đường dẫn không hợp lệ'), { status: 400 });
    const normalized = typeof userPath === 'string' ? userPath.replace(/^[/\\]+/, '') : '';
    const target = path.resolve(root, normalized);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw Object.assign(new Error('Đường dẫn nằm ngoài thư mục quản lý'), { status: 403 });
    }
    if (target === trashRoot || target.startsWith(trashRoot + path.sep)) {
      throw Object.assign(new Error('Không thể truy cập trực tiếp thùng rác'), { status: 403 });
    }
    return target;
  };

  const assertNoSymlink = async (target: string, allowMissingLeaf = false) => {
    const rel = path.relative(root, target);
    let current = root;
    for (const segment of rel.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        const stat = await fsp.lstat(current);
        if (stat.isSymbolicLink()) throw Object.assign(new Error('Không cho phép truy cập liên kết tượng trưng'), { status: 403 });
      } catch (error: any) {
        if (allowMissingLeaf && error.code === 'ENOENT' && current === target) return;
        throw error;
      }
    }
  };

  const fail = (res: any, error: any) => {
    const status = error.status || (error.code === 'ENOENT' ? 404 : error.code === 'EEXIST' ? 409 : 500);
    return res.status(status).json({ success: false, error: error.message || 'Lỗi hệ thống tệp tin' });
  };

  router.use((req, res, next) => {
    if (!authenticate(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    next();
  });

  router.get('/', async (req, res) => {
    try {
      const target = resolveInsideRoot(req.query.path);
      await assertNoSymlink(target);
      const stat = await fsp.stat(target);
      if (!stat.isDirectory()) return res.status(400).json({ success: false, error: 'Đường dẫn không phải thư mục' });
      const entries = await fsp.readdir(target, { withFileTypes: true });
      const files = (await Promise.all(entries.filter(entry => !(target === root && entry.name === '.terminal-trash')).map(async entry => {
        const itemPath = path.join(target, entry.name);
        const itemStat = await fsp.lstat(itemPath);
        return { name: entry.name, path: relative(itemPath), isDirectory: itemStat.isDirectory(), isSymlink: itemStat.isSymbolicLink(), size: itemStat.size, mtime: itemStat.mtime.toISOString() };
      }))).sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
      const currentPath = relative(target);
      return res.json({ success: true, currentPath, parentPath: target === root ? null : relative(path.dirname(target)), files });
    } catch (error) { return fail(res, error); }
  });

  router.get('/read', async (req, res) => {
    try {
      const target = resolveInsideRoot(req.query.path);
      await assertNoSymlink(target);
      const stat = await fsp.stat(target);
      if (!stat.isFile()) return res.status(400).json({ success: false, error: 'Đường dẫn không phải tệp tin' });
      if (stat.size > MAX_EDITOR_SIZE) return res.status(413).json({ success: false, error: 'Tệp quá lớn để chỉnh sửa (giới hạn 2MB)' });
      const buffer = await fsp.readFile(target);
      if (buffer.subarray(0, 512).includes(0)) return res.json({ success: true, isBinary: true, size: stat.size, mtime: stat.mtime.toISOString() });
      return res.json({ success: true, isBinary: false, content: buffer.toString('utf8'), size: stat.size, mtime: stat.mtime.toISOString() });
    } catch (error) { return fail(res, error); }
  });

  router.post('/create', async (req, res) => {
    try {
      const { dirPath, name } = req.body;
      if (!validName(name)) return res.status(400).json({ success: false, error: 'Tên tệp không hợp lệ' });
      const dir = resolveInsideRoot(dirPath);
      await assertNoSymlink(dir);
      const target = path.join(dir, name);
      const handle = await fsp.open(target, 'wx');
      await handle.close();
      await log(`Đã tạo tệp: ${relative(target)}`, clientIp(req));
      return res.status(201).json({ success: true, path: relative(target), mtime: (await fsp.stat(target)).mtime.toISOString() });
    } catch (error) { return fail(res, error); }
  });

  router.post('/write', async (req, res) => {
    try {
      const { filePath, content, expectedMtime } = req.body;
      if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_EDITOR_SIZE) return res.status(413).json({ success: false, error: 'Nội dung vượt giới hạn 2MB' });
      const target = resolveInsideRoot(filePath);
      await assertNoSymlink(target);
      const stat = await fsp.stat(target);
      if (!stat.isFile()) return res.status(400).json({ success: false, error: 'Đường dẫn không phải tệp tin' });
      if (!expectedMtime || stat.mtime.toISOString() !== expectedMtime) return res.status(409).json({ success: false, error: 'Tệp đã thay đổi trên máy chủ. Hãy tải lại trước khi lưu.' });
      const temp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
      await fsp.writeFile(temp, content, { encoding: 'utf8', flag: 'wx', mode: stat.mode });
      await fsp.rename(temp, target);
      const updated = await fsp.stat(target);
      await log(`Đã chỉnh sửa tệp: ${relative(target)}`, clientIp(req));
      return res.json({ success: true, mtime: updated.mtime.toISOString() });
    } catch (error) { return fail(res, error); }
  });

  router.post('/mkdir', async (req, res) => {
    try {
      const { dirPath, name } = req.body;
      if (!validName(name)) return res.status(400).json({ success: false, error: 'Tên thư mục không hợp lệ' });
      const dir = resolveInsideRoot(dirPath);
      await assertNoSymlink(dir);
      const target = path.join(dir, name);
      await fsp.mkdir(target);
      await log(`Đã tạo thư mục: ${relative(target)}`, clientIp(req));
      return res.status(201).json({ success: true, path: relative(target) });
    } catch (error) { return fail(res, error); }
  });

  router.get('/download', async (req, res) => {
    try {
      const target = resolveInsideRoot(req.query.path);
      await assertNoSymlink(target);
      const stat = await fsp.stat(target);
      if (!stat.isFile()) return res.status(400).json({ success: false, error: 'Chỉ có thể tải tệp tin' });
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`);
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(target).pipe(res);
    } catch (error) { return fail(res, error); }
  });

  router.post('/upload', raw({ type: 'application/octet-stream', limit: MAX_UPLOAD_SIZE }), async (req: any, res) => {
    try {
      const name = decodeURIComponent(String(req.headers['x-file-name'] || ''));
      const dirPath = decodeURIComponent(String(req.headers['x-directory'] || ''));
      if (!validName(name)) return res.status(400).json({ success: false, error: 'Tên tệp upload không hợp lệ' });
      const dir = resolveInsideRoot(dirPath);
      await assertNoSymlink(dir);
      const target = path.join(dir, name);
      await fsp.writeFile(target, req.body, { flag: 'wx' });
      await log(`Đã upload tệp: ${relative(target)}`, clientIp(req));
      return res.status(201).json({ success: true, path: relative(target) });
    } catch (error) { return fail(res, error); }
  });

  router.post('/move', async (req, res) => {
    try {
      const { sourcePath, destinationDir, newName } = req.body;
      const source = resolveInsideRoot(sourcePath);
      const destination = resolveInsideRoot(destinationDir);
      const name = newName || path.basename(source);
      if (!validName(name)) return res.status(400).json({ success: false, error: 'Tên mới không hợp lệ' });
      await assertNoSymlink(source);
      await assertNoSymlink(destination);
      const target = path.join(destination, name);
      await fsp.access(target).then(() => { throw Object.assign(new Error('Đích đã tồn tại'), { status: 409 }); }).catch((error: any) => { if (error.status) throw error; if (error.code !== 'ENOENT') throw error; });
      await fsp.rename(source, target);
      await log(`Đã di chuyển/đổi tên: ${relative(source)} -> ${relative(target)}`, clientIp(req));
      return res.json({ success: true, path: relative(target) });
    } catch (error) { return fail(res, error); }
  });

  router.delete('/', async (req, res) => {
    try {
      const target = resolveInsideRoot(req.query.path);
      if (target === root) return res.status(400).json({ success: false, error: 'Không thể xóa thư mục gốc' });
      await assertNoSymlink(target);
      await fsp.mkdir(trashRoot, { recursive: true });
      const trashName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${path.basename(target)}`;
      await fsp.rename(target, path.join(trashRoot, trashName));
      await fsp.writeFile(path.join(trashRoot, `${trashName}.json`), JSON.stringify({ originalPath: relative(target), deletedAt: new Date().toISOString() }));
      await log(`Đã chuyển vào thùng rác: ${relative(target)}`, clientIp(req));
      return res.json({ success: true, message: 'Đã chuyển vào thùng rác' });
    } catch (error) { return fail(res, error); }
  });

  router.get('/trash', async (_req, res) => {
    try {
      await fsp.mkdir(trashRoot, { recursive: true });
      const names = (await fsp.readdir(trashRoot)).filter(name => !name.endsWith('.json'));
      const items = await Promise.all(names.map(async name => {
        const metadata = JSON.parse(await fsp.readFile(path.join(trashRoot, `${name}.json`), 'utf8'));
        return { id: name, ...metadata };
      }));
      return res.json({ success: true, items });
    } catch (error) { return fail(res, error); }
  });

  router.post('/trash/restore', async (req, res) => {
    try {
      const { id } = req.body;
      if (!validName(id)) return res.status(400).json({ success: false, error: 'Mục thùng rác không hợp lệ' });
      const trashed = path.join(trashRoot, id);
      const metadataFile = `${trashed}.json`;
      const metadata = JSON.parse(await fsp.readFile(metadataFile, 'utf8'));
      const target = resolveInsideRoot(metadata.originalPath);
      await assertNoSymlink(path.dirname(target));
      await fsp.access(target).then(() => { throw Object.assign(new Error('Vị trí khôi phục đã tồn tại'), { status: 409 }); }).catch((error: any) => { if (error.status) throw error; if (error.code !== 'ENOENT') throw error; });
      await fsp.rename(trashed, target);
      await fsp.unlink(metadataFile);
      await log(`Đã khôi phục: ${metadata.originalPath}`, clientIp(req));
      return res.json({ success: true, path: metadata.originalPath });
    } catch (error) { return fail(res, error); }
  });

  return router;
}
