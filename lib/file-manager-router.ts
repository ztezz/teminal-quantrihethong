import { Router, raw, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { execFile } from 'child_process';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import * as archiver from 'archiver';
import unzipper from 'unzipper';
import { ARCHIVE_LIMITS, accountArchiveSourceEntry, validateArchivePlan, type ArchiveSourceStats } from './security-utils';

const fsp = fs.promises;
const MAX_EDITOR_SIZE = 2 * 1024 * 1024;
const MAX_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
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
  sessionRole: (token: string) => 'viewer' | 'operator' | 'admin' | 'root' | null;
  hasStepUp: (req: Request) => boolean;
  consumePreviewTicket: (ticket: string, filePath: string) => boolean;
  log: (event: string, ip: string, details?: { action?: string; level?: 'info' | 'warning' | 'critical'; result?: 'success' | 'failure'; metadata?: Record<string, unknown> }) => Promise<unknown>;
  rootDir?: string;
  trashDir?: string;
  snapshotDir?: string;
  directDeletePaths?: string[];
  deleteJobStore?: {
    saveDeleteJob: (job: any) => void;
    getDeleteJobs: (owner?: string, limit?: number) => any[];
    getDeleteJob: (id: string) => any;
    getDeleteJobByIdempotency: (owner: string, key: string) => any;
    interruptDeleteJobs: () => void;
    pruneDeleteJobs: (limit?: number) => void;
  };
  deletionMetrics?: { record: (event: { success: boolean; durationMs: number; orphaned?: number }) => void; queueDepth: (value: number) => void };
  alert?: (event: string, details: Record<string, unknown>) => Promise<void>;
  previewFrameAncestor?: string;
  onlyOffice?: { documentServerUrl: string; publicApiUrl: string; jwtSecret: string };
};

type TrashMetadata = { originalPath: string; deletedAt: string };
type SnapshotMetadata = { id: string; originalPath: string; createdAt: string; reason: string; size: number; mode: number; mtime: string; checksum: string };
type UploadMetadata = { id: string; targetPath: string; size: number; owner: string; createdAt: string };
type DeletionMode = 'trash' | 'configured_direct' | 'cross_device' | 'exdev_fallback';
type DeleteJob = {
  id: string;
  owner: string;
  state: 'pending' | 'running' | 'success' | 'failure' | 'cancelled';
  progress: number;
  completed: number;
  total: number;
  message: string;
  results: Record<string, unknown>[];
  createdAt: string;
  finishedAt?: string;
  cancelRequested: boolean;
  paths: unknown[];
  idempotencyKey?: string;
};

function clientIp(req: Request) {
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
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

export function createFileManagerRouter({ hasSession, sessionRole, hasStepUp, consumePreviewTicket, log, rootDir, trashDir, snapshotDir, directDeletePaths = [], deleteJobStore, deletionMetrics, alert, previewFrameAncestor = "'self'", onlyOffice }: Options) {
  const router = Router();
  const root = path.resolve(rootDir || process.cwd());
  const trashRoot = path.resolve(trashDir || path.join(process.cwd(), '.terminal-trash'));
  const snapshotRoot = path.resolve(snapshotDir || path.join(process.cwd(), '.terminal-snapshots'));
  const uploadRoot = path.join(root, '.terminal-uploads');
  const directDeleteRoots = directDeletePaths.map(value => {
    const configuredPath = value.trim();
    if (!configuredPath || path.isAbsolute(configuredPath)) throw new Error('FILE_MANAGER_DIRECT_DELETE_PATHS chỉ chấp nhận đường dẫn tương đối không rỗng');
    const target = path.resolve(root, configuredPath);
    const relativeTarget = path.relative(root, target);
    if (!relativeTarget || relativeTarget === '..' || relativeTarget.startsWith('..' + path.sep) || path.isAbsolute(relativeTarget)) throw new Error('FILE_MANAGER_DIRECT_DELETE_PATHS phải nằm bên trong FILE_MANAGER_ROOT');
    return target;
  });
  const reservedUploadTargets = new Map<string, string>();
  const canonicalRoot = fs.realpathSync(root);
  const maxSnapshotFileSize = Number(process.env.SNAPSHOT_MAX_FILE_MB || 100) * 1024 * 1024;
  const maxSnapshotTotalSize = Number(process.env.SNAPSHOT_MAX_TOTAL_MB || 2048) * 1024 * 1024;
  const configuredOfficeConcurrency = Number(process.env.OFFICE_MAX_CONCURRENCY || 1);
  const maxOfficeConversions = Number.isSafeInteger(configuredOfficeConcurrency) && configuredOfficeConcurrency > 0 ? configuredOfficeConcurrency : 1;
  const configuredMaxUploadSize = Number(process.env.UPLOAD_MAX_FILE_MB || 10240) * 1024 * 1024;
  const maxUploadSize = Number.isSafeInteger(configuredMaxUploadSize) && configuredMaxUploadSize > 0 ? configuredMaxUploadSize : 10 * 1024 * 1024 * 1024;
  const configuredDeleteConcurrency = Number(process.env.FILE_DELETE_CONCURRENCY || 4);
  const deleteConcurrency = Number.isSafeInteger(configuredDeleteConcurrency) ? Math.min(10, Math.max(1, configuredDeleteConcurrency)) : 4;
  const configuredBackgroundThreshold = Number(process.env.FILE_DELETE_BACKGROUND_THRESHOLD || 20);
  const backgroundDeleteThreshold = Number.isSafeInteger(configuredBackgroundThreshold) ? Math.min(MAX_BULK_ITEMS, Math.max(2, configuredBackgroundThreshold)) : 20;
  const maxDeleteEntries = Math.max(1, Number(process.env.FILE_DELETE_MAX_ENTRIES || 100000));
  const maxDeleteDepth = Math.max(1, Number(process.env.FILE_DELETE_MAX_DEPTH || 256));
  const deleteJobTimeoutMs = Math.max(1, Number(process.env.FILE_DELETE_JOB_TIMEOUT_MINUTES || 60)) * 60_000;
  const deleteItemTimeoutMs = Math.max(1, Number(process.env.FILE_DELETE_ITEM_TIMEOUT_SECONDS || 120)) * 1000;
  const protectDirectDeleteRoots = process.env.FILE_MANAGER_PROTECT_DIRECT_DELETE_ROOTS !== 'false';
  let activeOfficeConversions = 0;
  const officeSessions = new Map<string, { path: string; expiresAt: number }>();
  const deleteJobs = new Map<string, DeleteJob>();
  const activeTrashTransactions = new Set<string>();
  const lockedDeletePaths = new Set<string>();
  const policySecret = crypto.randomBytes(32);
  deleteJobStore?.interruptDeleteJobs();
  const base64Url = (value: Buffer | string) => Buffer.from(value).toString('base64url');
  const signJwt = (payload: Record<string, unknown>) => {
    const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64Url(JSON.stringify(payload));
    const signature = crypto.createHmac('sha256', onlyOffice!.jwtSecret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
  };
  const verifyJwt = (token: unknown) => {
    if (typeof token !== 'string') return null;
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return null;
    const expected = crypto.createHmac('sha256', onlyOffice!.jwtSecret).update(`${header}.${body}`).digest('base64url');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
      return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now() ? payload : null;
    } catch { return null; }
  };

  const cookieToken = (req: Request) => {
    const encodedToken = String(req.headers.cookie || '').split(';').map(cookie => cookie.trim().split('=')).find(([name]) => name === 'terminal_session')?.slice(1).join('=') || '';
    return encodedToken ? decodeURIComponent(encodedToken) : '';
  };
  const authenticate = (req: Request) => { const token = cookieToken(req); return Boolean(token && hasSession(token)); };
  const uploadOwner = (req: Request) => crypto.createHash('sha256').update(cookieToken(req)).digest('hex');
  const relative = (absolutePath: string) => path.relative(root, absolutePath).split(path.sep).join('/');
  const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
  const sensitivePath = (value: unknown) => {
    if (typeof value !== 'string') return false;
    let decoded = value; try { decoded = decodeURIComponent(value); } catch { /* Invalid encoding is handled by the route. */ }
    const normalized = decoded.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
    return /^(etc|boot|usr|root|var|bin|sbin|lib|lib32|lib64)(?:\/|$)/.test(normalized);
  };
  const dangerousRequest = (req: Request) => {
    if ((req.method === 'POST' && req.path === '/snapshots/restore') || (req.method === 'DELETE' && req.path === '/snapshots')) return true;
    if (req.method === 'PATCH' && req.path === '/metadata') return true;
    if ((req.method === 'DELETE' && req.path === '/') || (req.method === 'POST' && ['/trash', '/delete-policy', '/delete-plan'].includes(req.path))) return false;
    if ((req.method === 'DELETE' && (req.path === '/trash' || req.path === '/trash/empty')) || (req.method === 'POST' && req.path === '/trash/restore')) return true;
    const values = [req.query.path, req.body?.path, req.body?.filePath, req.body?.dirPath, req.body?.sourcePath, req.body?.destinationDir, req.body?.destinationPath, req.body?.archivePath, req.body?.targetPath, req.body?.paths, req.body?.ids, req.headers['x-directory']];
    return values.flatMap(value => Array.isArray(value) ? value : [value]).some(sensitivePath);
  };
  const assertCanonicalInsideRoot = (target: string) => {
    let existingPath = target;
    while (!fs.existsSync(existingPath)) {
      const parent = path.dirname(existingPath);
      if (parent === existingPath) throw httpError(403, 'Không thể xác minh đường dẫn');
      existingPath = parent;
    }
    const canonicalExistingPath = fs.realpathSync(existingPath);
    const canonicalRelative = path.relative(canonicalRoot, canonicalExistingPath);
    if (canonicalRelative.startsWith('..' + path.sep) || canonicalRelative === '..' || path.isAbsolute(canonicalRelative)) throw httpError(403, 'Symbolic link trỏ ra ngoài thư mục quản lý');
  };
  const resolveInsideRoot = (userPath: unknown, allowTrash = false) => {
    if (typeof userPath !== 'string' && userPath !== undefined) throw httpError(400, 'Đường dẫn không hợp lệ');
    const normalized = typeof userPath === 'string' ? userPath.replace(/^[/\\]+/, '') : '';
    const target = path.resolve(root, normalized);
    const relativeTarget = path.relative(root, target);
    if (relativeTarget.startsWith('..' + path.sep) || relativeTarget === '..' || path.isAbsolute(relativeTarget)) throw httpError(403, 'Đường dẫn nằm ngoài thư mục quản lý');
    assertCanonicalInsideRoot(target);
    const relativeTrash = path.relative(trashRoot, target);
    if (!allowTrash && (relativeTrash === '' || (!relativeTrash.startsWith('..' + path.sep) && relativeTrash !== '..' && !path.isAbsolute(relativeTrash)))) throw httpError(403, 'Không thể truy cập trực tiếp thùng rác');
    const relativeSnapshots = path.relative(snapshotRoot, target);
    if (relativeSnapshots === '' || (!relativeSnapshots.startsWith('..' + path.sep) && relativeSnapshots !== '..' && !path.isAbsolute(relativeSnapshots))) throw httpError(403, 'Không thể truy cập trực tiếp kho snapshot');
    const relativeUploads = path.relative(uploadRoot, target);
    if (relativeUploads === '' || (!relativeUploads.startsWith('..' + path.sep) && relativeUploads !== '..' && !path.isAbsolute(relativeUploads))) throw httpError(403, 'Không thể truy cập vùng upload tạm');
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
  const uploadPaths = (id: string) => {
    if (!/^[a-f0-9]{32}$/.test(id)) throw httpError(400, 'Mã upload không hợp lệ');
    return { data: path.join(uploadRoot, `${id}.data`), metadata: path.join(uploadRoot, `${id}.json`) };
  };
  const releaseUploadTarget = (metadata: UploadMetadata) => {
    const target = resolveInsideRoot(metadata.targetPath);
    if (reservedUploadTargets.get(target) === metadata.id) reservedUploadTargets.delete(target);
  };
  const readUpload = async (req: Request, id: string) => {
    const paths = uploadPaths(id);
    const metadata = JSON.parse(await fsp.readFile(paths.metadata, 'utf8')) as UploadMetadata;
    if (metadata.id !== id || metadata.owner !== uploadOwner(req)) throw httpError(403, 'Không có quyền truy cập phiên upload này');
    return { metadata, paths };
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
  const pathIsBusy = (target: string) => [...lockedDeletePaths].some(locked => target === locked || target.startsWith(locked + path.sep) || locked.startsWith(target + path.sep));
  const safeMove = async (source: string, destination: string) => {
    if (pathIsBusy(source) || pathIsBusy(destination)) throw Object.assign(httpError(409, 'Đường dẫn đang được thao tác bởi yêu cầu xóa'), { code: 'PATH_BUSY' });
    try {
      await fsp.rename(source, destination);
      return;
    } catch (error: any) {
      if (error?.code !== 'EXDEV') throw error;
    }
    try {
      await fsp.cp(source, destination, { recursive: true, errorOnExist: true, force: false });
    } catch (copyError) {
      await fsp.rm(destination, { recursive: true, force: true }).catch(() => undefined);
      throw copyError;
    }
    await fsp.rm(source, { recursive: true, force: true });
  };
  const deletionPolicy = async (userPath: unknown) => {
    const target = resolveInsideRoot(userPath);
    if (target === root) throw httpError(400, 'Không thể xóa thư mục gốc');
    const targetStat = await fsp.lstat(target);
    await fsp.mkdir(trashRoot, { recursive: true });
    const configuredForDirectDelete = directDeleteRoots.some(configuredRoot => target === configuredRoot || target.startsWith(configuredRoot + path.sep));
    if (protectDirectDeleteRoots && directDeleteRoots.includes(target)) throw Object.assign(httpError(403, 'Không thể xóa thư mục gốc của ổ đĩa mạng'), { code: 'PROTECTED_DELETE_ROOT' });
    const mode: DeletionMode = configuredForDirectDelete ? 'configured_direct' : targetStat.dev !== (await fsp.stat(trashRoot)).dev ? 'cross_device' : 'trash';
    return { target, targetStat, path: relative(target), mode, permanentlyDeleted: mode !== 'trash' };
  };
  const policyFingerprint = (policy: Awaited<ReturnType<typeof deletionPolicy>>) => ({ path: policy.path, dev: policy.targetStat.dev.toString(), ino: policy.targetStat.ino.toString(), mtimeMs: policy.targetStat.mtimeMs, size: policy.targetStat.size, exp: Date.now() + 5 * 60_000 });
  const signPolicy = (fingerprint: Record<string, unknown>) => { const body = Buffer.from(JSON.stringify(fingerprint)).toString('base64url'); return `${body}.${crypto.createHmac('sha256', policySecret).update(body).digest('base64url')}`; };
  const verifyPolicyToken = async (userPath: unknown, token: unknown) => {
    if (typeof token !== 'string') throw Object.assign(httpError(409, 'Cần xác nhận lại kế hoạch xóa'), { code: 'FILE_CHANGED' });
    const [body, signature] = token.split('.'); const expected = body && crypto.createHmac('sha256', policySecret).update(body).digest('base64url');
    if (!body || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw Object.assign(httpError(409, 'Kế hoạch xóa không hợp lệ'), { code: 'FILE_CHANGED' });
    const fingerprint = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
    const policy = await deletionPolicy(userPath); const current = policyFingerprint(policy);
    const keys: Array<keyof typeof current> = ['path', 'dev', 'ino', 'mtimeMs', 'size'];
    if (Number(fingerprint.exp) < Date.now() || keys.some(key => String(fingerprint[key]) !== String(current[key]))) throw Object.assign(httpError(409, 'Tệp hoặc thư mục đã thay đổi, vui lòng xác nhận lại'), { code: 'FILE_CHANGED' });
    return policy;
  };
  const removeDirect = async (target: string, shouldStop?: () => boolean): Promise<{ entries: number; bytes: number }> => {
    const stack: Array<{ target: string; depth: number; visited: boolean }> = [{ target, depth: 0, visited: false }];
    let entries = 0; let bytes = 0;
    while (stack.length) {
      if (shouldStop?.()) throw Object.assign(new Error('Tác vụ xóa đã bị hủy'), { name: 'AbortError' });
      const item = stack.pop()!;
      if (item.depth > maxDeleteDepth) throw Object.assign(httpError(413, `Cây thư mục vượt giới hạn độ sâu ${maxDeleteDepth}`), { code: 'DELETE_DEPTH_LIMIT' });
      if (item.visited) { await fsp.rmdir(item.target); continue; }
      const stat = await fsp.lstat(item.target); entries++; bytes += stat.size;
      if (entries > maxDeleteEntries) throw Object.assign(httpError(413, `Số mục vượt giới hạn ${maxDeleteEntries}`), { code: 'DELETE_ENTRY_LIMIT' });
      if (!stat.isDirectory() || stat.isSymbolicLink()) { await fsp.rm(item.target, { force: false }); continue; }
      stack.push({ ...item, visited: true });
      const names = await fsp.readdir(item.target);
      for (let index = names.length - 1; index >= 0; index--) stack.push({ target: path.join(item.target, names[index]), depth: item.depth + 1, visited: false });
    }
    return { entries, bytes };
  };
  const trashOneUnlocked = async (userPath: unknown, shouldStop?: () => boolean) => {
    const policy = await deletionPolicy(userPath);
    const { target } = policy;
    // Mounted network filesystems cannot reliably be moved into a local trash directory.
    if (policy.permanentlyDeleted) {
      await removeDirect(target, shouldStop);
      return { path: policy.path, permanentlyDeleted: true, deletionMode: policy.mode };
    }
    try {
      await createSnapshot(target, 'before_trash');
    } catch (error: any) {
      void log(`Không thể tạo snapshot trước khi xóa: ${relative(target)}`, 'system', { action: 'snapshot_create', level: 'warning', result: 'failure', metadata: { error: error.message } });
    }
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${path.basename(target)}`;
    const metadataFile = path.join(trashRoot, `${id}.json`);
    const pendingMetadataFile = path.join(trashRoot, `${id}.pending`);
    activeTrashTransactions.add(id);
    try { await fsp.writeFile(pendingMetadataFile, JSON.stringify({ originalPath: relative(target), deletedAt: new Date().toISOString() } satisfies TrashMetadata), { flag: 'wx' }); }
    catch (error) { activeTrashTransactions.delete(id); throw error; }
    try {
      await fsp.rename(target, path.join(trashRoot, id));
    } catch (error: any) {
      if (error?.code === 'EXDEV') {
        try {
          await removeDirect(target, shouldStop);
          return { path: policy.path, permanentlyDeleted: true, deletionMode: 'exdev_fallback' as DeletionMode };
        } finally {
          await fsp.rm(pendingMetadataFile, { force: true });
          activeTrashTransactions.delete(id);
        }
      }
      await fsp.rm(pendingMetadataFile, { force: true });
      activeTrashTransactions.delete(id);
      throw error;
    }
    try { await fsp.rename(pendingMetadataFile, metadataFile); }
    finally { activeTrashTransactions.delete(id); }
    return { id, path: policy.path, permanentlyDeleted: false, deletionMode: 'trash' as DeletionMode };
  };
  const trashOne = async (userPath: unknown, shouldStop?: () => boolean) => {
    const startedAt = Date.now();
    const target = resolveInsideRoot(userPath);
    if (pathIsBusy(target)) throw Object.assign(httpError(409, 'Đường dẫn đang được thao tác bởi yêu cầu khác'), { code: 'PATH_BUSY' });
    lockedDeletePaths.add(target);
    try { const result = await trashOneUnlocked(userPath, shouldStop); deletionMetrics?.record({ success: true, durationMs: Date.now() - startedAt }); return result; }
    catch (error) { deletionMetrics?.record({ success: false, durationMs: Date.now() - startedAt }); throw error; }
    finally { lockedDeletePaths.delete(target); }
  };
  const reconcileTrashOnce = async () => {
    await fsp.mkdir(trashRoot, { recursive: true });
    const names = await fsp.readdir(trashRoot);
    const data = new Set(names.filter(name => !name.endsWith('.json') && !name.endsWith('.pending')));
    const metadata = new Set(names.filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)));
    const pending = new Set(names.filter(name => name.endsWith('.pending')).map(name => name.slice(0, -8)));
    let removedMetadata = 0;
    let removedData = 0;
    let recovered = 0;
    for (const id of pending) {
      if (activeTrashTransactions.has(id)) continue;
      if (data.has(id) && !metadata.has(id)) { await fsp.rename(path.join(trashRoot, `${id}.pending`), path.join(trashRoot, `${id}.json`)); metadata.add(id); recovered++; }
      else { await fsp.rm(path.join(trashRoot, `${id}.pending`), { force: true }); }
    }
    for (const id of metadata) if (!data.has(id)) { await fsp.rm(path.join(trashRoot, `${id}.json`), { force: true }); removedMetadata++; }
    const lostFound = path.join(trashRoot, '.lost-found');
    for (const id of data) if (!metadata.has(id) && id !== '.lost-found') { await fsp.mkdir(lostFound, { recursive: true }); await fsp.rename(path.join(trashRoot, id), path.join(lostFound, `${Date.now()}-${id}`)); removedData++; }
    return { removedMetadata, movedToLostFound: removedData, recovered };
  };
  let reconcilePromise: ReturnType<typeof reconcileTrashOnce> | null = null;
  const reconcileTrash = () => {
    if (reconcilePromise) return reconcilePromise;
    reconcilePromise = reconcileTrashOnce().finally(() => { reconcilePromise = null; });
    return reconcilePromise;
  };
  const summarizeDeletionResults = (results: Record<string, unknown>[]) => {
    const successful = results.filter(item => item.success).length;
    const failed = results.length - successful;
    const modes = Object.fromEntries((['trash', 'configured_direct', 'cross_device', 'exdev_fallback'] as DeletionMode[]).map(mode => [mode, results.filter(item => item.success && item.deletionMode === mode).length]));
    return { successful, failed, modes, directlyDeleted: modes.configured_direct + modes.cross_device + modes.exdev_fallback, trashed: modes.trash };
  };
  const pruneDeleteJobs = () => {
    if (deleteJobs.size < 200) return;
    for (const [id, job] of deleteJobs) {
      if (!['pending', 'running'].includes(job.state)) deleteJobs.delete(id);
      if (deleteJobs.size < 150) break;
    }
    deleteJobStore?.pruneDeleteJobs(500);
  };
  const persistDeleteJob = (job: DeleteJob) => deleteJobStore?.saveDeleteJob(job);
  const processDeleteJob = (job: DeleteJob, values: unknown[]) => {
    job.state = 'running'; job.message = 'Đang xóa'; persistDeleteJob(job);
    deletionMetrics?.queueDepth([...deleteJobs.values()].filter(item => ['pending', 'running'].includes(item.state)).length);
    const watchdog = setTimeout(() => { job.cancelRequested = true; job.message = 'Đã vượt thời gian tối đa, đang dừng'; persistDeleteJob(job); }, deleteJobTimeoutMs); watchdog.unref();
    void runItemsLimited(values, value => Promise.race([trashOne(value, () => job.cancelRequested), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(Object.assign(new Error('Mục xóa vượt thời gian tối đa'), { code: 'DELETE_ITEM_TIMEOUT' })), deleteItemTimeoutMs); timer.unref(); })]), result => {
      job.results.push(result); job.completed++; job.progress = Math.round(job.completed / job.total * 100); job.message = `Đã xử lý ${job.completed}/${job.total} mục`; persistDeleteJob(job);
    }, () => job.cancelRequested).then(async results => {
      if (job.cancelRequested) { job.state = 'cancelled'; job.message = `Đã hủy sau ${job.completed}/${job.total} mục`; }
      else { const summary = summarizeDeletionResults(results); job.state = summary.failed ? 'failure' : 'success'; job.message = summary.failed ? `Có ${summary.failed} mục thất bại` : 'Hoàn tất'; }
      job.progress = 100; job.finishedAt = new Date().toISOString(); clearTimeout(watchdog); persistDeleteJob(job);
      const summary = summarizeDeletionResults(job.results); deletionMetrics?.queueDepth([...deleteJobs.values()].filter(item => ['pending', 'running'].includes(item.state) && item.id !== job.id).length);
      await log(`Tác vụ xóa ${job.id} kết thúc: ${job.message}`, 'system', { action: 'file_delete_job', level: summary.failed ? 'warning' : 'info', result: summary.failed ? 'failure' : 'success', metadata: { jobId: job.id, paths: job.results.map(item => item.path), ...summary } });
      if (summary.failed) void alert?.('file.delete.failure', { jobId: job.id, message: job.message, ...summary });
    }).catch(async error => {
      job.state = 'failure'; job.progress = 100; job.message = error.message || 'Tác vụ xóa thất bại'; job.finishedAt = new Date().toISOString(); clearTimeout(watchdog); persistDeleteJob(job);
      deletionMetrics?.queueDepth([...deleteJobs.values()].filter(item => ['pending', 'running'].includes(item.state) && item.id !== job.id).length); await log(`Tác vụ xóa ${job.id} thất bại`, 'system', { action: 'file_delete_job', level: 'critical', result: 'failure', metadata: { jobId: job.id, error: job.message } });
      void alert?.('file.delete.failure', { jobId: job.id, error: job.message });
    });
  };
  void reconcileTrash().then(result => {
    if (result.movedToLostFound || result.removedMetadata || result.recovered) { deletionMetrics?.record({ success: true, durationMs: 0, orphaned: result.movedToLostFound + result.removedMetadata }); void log('Đã sửa dữ liệu thùng rác mồ côi', 'system', { action: 'trash_reconcile', level: 'warning', metadata: result }); void alert?.('trash.orphans', result); }
  }).catch(error => void log('Không thể kiểm tra thùng rác khi khởi động', 'system', { action: 'trash_reconcile', level: 'warning', result: 'failure', metadata: { error: error.message } }));
  for (const configuredRoot of directDeleteRoots) void fsp.stat(configuredRoot).then(stat => {
    if (!stat.isDirectory()) void log(`Đường dẫn xóa trực tiếp không phải thư mục: ${relative(configuredRoot)}`, 'system', { action: 'direct_delete_path_check', level: 'warning', result: 'failure' });
    else void log(`Đã bật xóa trực tiếp: ${relative(configuredRoot)}`, 'system', { action: 'direct_delete_path_check', metadata: { path: relative(configuredRoot) } });
  }).catch(error => { void log(`Đường dẫn xóa trực tiếp chưa sẵn sàng: ${relative(configuredRoot)}`, 'system', { action: 'direct_delete_path_check', level: 'warning', result: 'failure', metadata: { error: error.message } }); void alert?.('file.mount.unavailable', { path: relative(configuredRoot), error: error.message }); });
  const restoreOne = async (id: unknown) => {
    if (!validName(id)) throw httpError(400, 'Mục thùng rác không hợp lệ');
    const trashed = path.join(trashRoot, id);
    const metadataFile = `${trashed}.json`;
    const metadata = JSON.parse(await fsp.readFile(metadataFile, 'utf8')) as TrashMetadata;
    const target = resolveInsideRoot(metadata.originalPath);
    await ensureMissing(target);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await safeMove(trashed, target);
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
  const runItemsLimited = async (values: unknown[], action: (value: unknown) => Promise<Record<string, unknown>>, onComplete?: (result: Record<string, unknown>) => void, shouldStop?: () => boolean) => {
    const results: Record<string, unknown>[] = [];
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(deleteConcurrency, values.length) }, async () => {
      while (nextIndex < values.length && !shouldStop?.()) {
        const value = values[nextIndex++];
        let result: Record<string, unknown>;
        try { result = { success: true, ...(await action(value)) }; }
        catch (error: any) { result = { success: false, path: value, code: error.code || `HTTP_${error.status || 500}`, error: error.message || 'Thao tác thất bại' }; }
        results.push(result);
        onComplete?.(result);
      }
    });
    await Promise.all(workers);
    return results;
  };
  const checksumFile = (filePath: string) => new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256'); fs.createReadStream(filePath).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
  const pruneSnapshots = async () => {
    const files = await fsp.readdir(snapshotRoot).catch(() => []); const metadataFiles = files.filter(name => name.endsWith('.json'));
    const entries = (await Promise.all(metadataFiles.map(async name => { try { const metadata = JSON.parse(await fsp.readFile(path.join(snapshotRoot, name), 'utf8')) as SnapshotMetadata; return { metadata, metadataFile: path.join(snapshotRoot, name), dataFile: path.join(snapshotRoot, `${metadata.id}.data`) }; } catch { return null; } }))).filter(Boolean) as Array<{ metadata: SnapshotMetadata; metadataFile: string; dataFile: string }>;
    let total = entries.reduce((sum, entry) => sum + entry.metadata.size, 0);
    for (const entry of entries.sort((a, b) => a.metadata.createdAt.localeCompare(b.metadata.createdAt))) {
      if (total <= maxSnapshotTotalSize) break;
      await fsp.rm(entry.dataFile, { force: true }); await fsp.rm(entry.metadataFile, { force: true }); total -= entry.metadata.size;
    }
  };
  const createSnapshot = async (target: string, reason: string) => {
    let stat: fs.Stats; try { stat = await fsp.stat(target); } catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.size > maxSnapshotFileSize) return null;
    await fsp.mkdir(snapshotRoot, { recursive: true });
    const id = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`; const dataFile = path.join(snapshotRoot, `${id}.data`); const metadataFile = path.join(snapshotRoot, `${id}.json`);
    await fsp.copyFile(target, dataFile, fs.constants.COPYFILE_EXCL);
    const metadata: SnapshotMetadata = { id, originalPath: relative(target), createdAt: new Date().toISOString(), reason, size: stat.size, mode: stat.mode & 0o7777, mtime: stat.mtime.toISOString(), checksum: await checksumFile(dataFile) };
    await fsp.writeFile(metadataFile, JSON.stringify(metadata), { flag: 'wx' }); await pruneSnapshots();
    await log(`Đã tạo snapshot: ${metadata.originalPath}`, 'system', { action: 'snapshot_create', metadata: { id, reason, size: stat.size } });
    return metadata;
  };

  router.use((req, res, next) => {
    const isOnlyOfficeServerRequest = req.path.startsWith('/onlyoffice/document/') || req.path.startsWith('/onlyoffice/callback/');
    if (isOnlyOfficeServerRequest) return next();

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      res.once('finish', () => {
        if (res.statusCode >= 400) void log(`File operation failed: ${req.method} ${req.path}`, clientIp(req), { action: `${req.method.toLowerCase()}_${req.path.replace(/\W+/g, '_')}`, level: res.statusCode >= 500 ? 'critical' : 'warning', result: 'failure', metadata: { status: res.statusCode } });
      });
    }
    const acceptsQueryToken = req.path === '/media' || req.path === '/office-preview';
    const ticket = acceptsQueryToken && typeof req.query.ticket === 'string' ? req.query.ticket : '';
    const filePath = acceptsQueryToken && typeof req.query.path === 'string' ? req.query.path : '';
    if (!authenticate(req) && !Boolean(ticket && consumePreviewTicket(ticket, filePath))) return res.status(401).json({ success: false, code: 'UNAUTHORIZED', error: 'Unauthorized' });
    if (acceptsQueryToken) {
      res.removeHeader('X-Frame-Options');
      res.setHeader('Content-Security-Policy', `default-src 'none'; frame-ancestors ${previewFrameAncestor}`);
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
    const role = sessionRole(cookieToken(req));
    if (!acceptsQueryToken && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && role === 'viewer') return res.status(403).json({ success: false, code: 'READ_ONLY', error: 'Tài khoản chỉ có quyền xem' });
    if (req.method === 'PATCH' && req.path === '/metadata' && role !== 'root') return res.status(403).json({ success: false, code: 'ROOT_REQUIRED', error: 'Chỉ tài khoản root được thay đổi quyền và chủ sở hữu' });
    if (!acceptsQueryToken && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && dangerousRequest(req) && !hasStepUp(req)) {
      void log(`Step-up required: ${req.method} ${req.path}`, clientIp(req), { action: 'step_up_required', level: 'warning', result: 'failure', metadata: { path: req.query.path || req.body?.path || req.body?.filePath || req.body?.dirPath || req.body?.sourcePath || req.headers['x-directory'] } });
      return res.status(428).json({ success: false, code: 'STEP_UP_REQUIRED', error: 'Thao tác nguy hiểm yêu cầu xác nhận lại danh tính' });
    }
    return next();
  });

  router.get('/', async (req, res) => {
    try {
      const target = resolveInsideRoot(req.query.path);
      await mustBeDirectory(target);
      const entries = await fsp.readdir(target, { withFileTypes: true });
      const files = (await Promise.all(entries.filter(entry => ![trashRoot, snapshotRoot, uploadRoot].includes(path.join(target, entry.name))).map(entry => itemDetails(path.join(target, entry.name))))).sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
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

  router.post('/onlyoffice/session', async (req, res) => {
    try {
      if (!onlyOffice) throw httpError(501, 'OnlyOffice chưa được cấu hình trên backend');
      if (!authenticate(req)) throw httpError(401, 'Unauthorized');
      const requestedPath = typeof req.body?.path === 'string' ? req.body.path : '';
      const target = resolveInsideRoot(requestedPath); const stat = await fsp.stat(target);
      const extension = path.extname(target).toLowerCase();
      if (!stat.isFile() || !OFFICE_EXTENSIONS.has(extension)) throw httpError(415, 'Chỉ hỗ trợ tài liệu Office');
      const id = crypto.randomBytes(32).toString('base64url'); const expiresAt = Date.now() + 60 * 60_000;
      officeSessions.set(id, { path: relative(target), expiresAt });
      for (const [key, session] of officeSessions) if (session.expiresAt <= Date.now()) officeSessions.delete(key);
      const canEdit = sessionRole(cookieToken(req)) !== 'viewer';
      const expiresInSeconds = Math.floor(expiresAt / 1000);
      const documentUrl = `${onlyOffice.publicApiUrl}/api/files/onlyoffice/document/${encodeURIComponent(id)}`;
      const callbackUrl = `${onlyOffice.publicApiUrl}/api/files/onlyoffice/callback/${encodeURIComponent(id)}`;
      const documentType = ['.xls', '.xlsx', '.ods'].includes(extension) ? 'cell' : ['.ppt', '.pptx', '.odp'].includes(extension) ? 'slide' : 'word';
      const token = signJwt({ document: { fileType: extension.slice(1), key: id, title: path.basename(target), url: documentUrl }, editorConfig: { callbackUrl, mode: canEdit ? 'edit' : 'view', user: { id: crypto.createHash('sha256').update(cookieToken(req)).digest('hex').slice(0, 16), name: 'Operator' } }, exp: expiresInSeconds });
      return res.json({ success: true, documentServerUrl: onlyOffice.documentServerUrl, config: { document: { fileType: extension.slice(1), key: id, title: path.basename(target), url: documentUrl }, documentType, editorConfig: { callbackUrl, mode: canEdit ? 'edit' : 'view', user: { id: 'operator', name: 'Operator' } }, token } });
    } catch (error) { return fail(res, error); }
  });

  router.get('/onlyoffice/document/:id', async (req, res) => {
    try {
      const session = officeSessions.get(req.params.id);
      if (!session || session.expiresAt <= Date.now()) throw httpError(404, 'Phiên chỉnh sửa đã hết hạn');
      const target = resolveInsideRoot(session.path); const stat = await fsp.stat(target);
      if (!stat.isFile()) throw httpError(404, 'Không tìm thấy tài liệu');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', stat.size);
      return fs.createReadStream(target).on('error', error => res.destroy(error)).pipe(res);
    } catch (error) { return fail(res, error); }
  });

  router.post('/onlyoffice/callback/:id', async (req, res) => {
    let temp: string | undefined;
    try {
      if (!onlyOffice) throw httpError(501, 'OnlyOffice chưa được cấu hình trên backend');
      const session = officeSessions.get(req.params.id);
      const payload = req.body as { status?: unknown; url?: unknown; token?: unknown };
      if (!session || session.expiresAt <= Date.now() || !verifyJwt(payload.token)) throw httpError(403, 'Callback OnlyOffice không hợp lệ');
      const status = Number(payload.status);
      if (status === 2 || status === 6) {
        if (typeof payload.url !== 'string') throw httpError(400, 'OnlyOffice không trả về URL tài liệu');
        const savedDocumentUrl = new URL(payload.url);
        if (!['http:', 'https:'].includes(savedDocumentUrl.protocol) || savedDocumentUrl.origin !== new URL(onlyOffice.documentServerUrl).origin) throw httpError(400, 'URL tài liệu OnlyOffice không hợp lệ');
        const response = await fetch(savedDocumentUrl);
        if (!response.ok || !response.body) throw httpError(502, 'Không thể tải bản tài liệu đã sửa từ OnlyOffice');
        const target = resolveInsideRoot(session.path); const stat = await fsp.stat(target);
        await createSnapshot(target, 'before_onlyoffice_write');
        temp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
        const handle = await fsp.open(temp, 'wx', stat.mode);
        const stream = fs.createWriteStream('', { fd: handle.fd, autoClose: true });
        await pipeline(response.body as unknown as NodeJS.ReadableStream, stream);
        await fsp.rename(temp, target); temp = undefined;
        await log(`Đã lưu tài liệu OnlyOffice: ${session.path}`, clientIp(req), { action: 'onlyoffice_write' });
      }
      return res.json({ error: 0 });
    } catch { if (temp) await fsp.rm(temp, { force: true }).catch(() => undefined); return res.json({ error: 1 }); }
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
    let conversionStarted = false;
    try {
      const target = resolveInsideRoot(req.query.path); const stat = await fsp.stat(target);
      if (!stat.isFile() || !OFFICE_EXTENSIONS.has(path.extname(target).toLowerCase())) throw httpError(415, 'Định dạng Office không được hỗ trợ');
      if (activeOfficeConversions >= maxOfficeConversions) throw httpError(429, 'Máy chủ đang xử lý tài liệu khác. Vui lòng thử lại sau.');
      activeOfficeConversions++; conversionStarted = true;
      tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'terminal-office-'));
      await new Promise<void>((resolve, reject) => {
        execFile(process.env.LIBREOFFICE_PATH || 'libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', tempDir!, target], { timeout: 120_000, maxBuffer: 1024 * 1024 }, (error) => error ? reject(error) : resolve());
      }).catch((error: any) => {
        if (error.code === 'ENOENT') throw httpError(501, 'Chưa cài LibreOffice trên backend. Hãy cài gói libreoffice để xem tài liệu Office.');
        throw httpError(422, `Không thể chuyển tài liệu Office sang PDF: ${error.message}`);
      });
      activeOfficeConversions--; conversionStarted = false;
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
      if (conversionStarted) activeOfficeConversions--;
      if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      return fail(res, error);
    }
  });

  const readSnapshot = async (id: unknown) => {
    if (!validName(id)) throw httpError(400, 'Snapshot không hợp lệ');
    const metadata = JSON.parse(await fsp.readFile(path.join(snapshotRoot, `${id}.json`), 'utf8')) as SnapshotMetadata;
    if (metadata.id !== id) throw httpError(400, 'Metadata snapshot không hợp lệ');
    return { metadata, dataFile: path.join(snapshotRoot, `${id}.data`) };
  };

  router.get('/snapshots', async (req, res) => {
    try {
      const requestedPath = typeof req.query.path === 'string' ? req.query.path.replace(/^[/\\]+/, '') : '';
      const files = await fsp.readdir(snapshotRoot).catch(() => []);
      const items = (await Promise.all(files.filter(name => name.endsWith('.json')).map(async name => { try { return JSON.parse(await fsp.readFile(path.join(snapshotRoot, name), 'utf8')) as SnapshotMetadata; } catch { return null; } }))).filter((item): item is SnapshotMetadata => Boolean(item && (!requestedPath || item.originalPath === requestedPath))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return res.json({ success: true, items: items.slice(0, 500), maxFileMB: maxSnapshotFileSize / 1024 / 1024, maxTotalMB: maxSnapshotTotalSize / 1024 / 1024 });
    } catch (error) { return fail(res, error); }
  });

  router.get('/snapshots/download', async (req, res) => {
    try {
      const { metadata, dataFile } = await readSnapshot(req.query.id); const stat = await fsp.stat(dataFile);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(metadata.originalPath))}`); res.setHeader('Content-Length', stat.size);
      return fs.createReadStream(dataFile).on('error', error => res.destroy(error)).pipe(res);
    } catch (error) { return fail(res, error); }
  });

  router.post('/snapshots/restore', async (req, res) => {
    let temp: string | undefined;
    try {
      const { metadata, dataFile } = await readSnapshot(req.body?.id); const checksum = await checksumFile(dataFile);
      if (checksum !== metadata.checksum) throw httpError(409, 'Snapshot hỏng hoặc đã bị thay đổi');
      const target = resolveInsideRoot(metadata.originalPath); await fsp.mkdir(path.dirname(target), { recursive: true }); await createSnapshot(target, 'before_snapshot_restore');
      temp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.restore`); await fsp.copyFile(dataFile, temp, fs.constants.COPYFILE_EXCL); await fsp.chmod(temp, metadata.mode); await fsp.rename(temp, target); temp = undefined;
      await log(`Đã khôi phục snapshot: ${metadata.originalPath}`, clientIp(req), { action: 'snapshot_restore', level: 'critical', metadata: { id: metadata.id, checksum } });
      return res.json({ success: true, path: metadata.originalPath });
    } catch (error) { if (temp) await fsp.rm(temp, { force: true }).catch(() => undefined); return fail(res, error); }
  });

  router.delete('/snapshots', async (req, res) => {
    try {
      const { metadata, dataFile } = await readSnapshot(req.body?.id); await fsp.rm(dataFile); await fsp.rm(path.join(snapshotRoot, `${metadata.id}.json`));
      await log(`Đã xóa snapshot: ${metadata.originalPath}`, clientIp(req), { action: 'snapshot_delete', level: 'critical', metadata: { id: metadata.id } });
      return res.json({ success: true });
    } catch (error) { return fail(res, error); }
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
      await createSnapshot(target, 'before_write');
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

  router.post('/upload', async (req, res) => {
    try {
      const { name, dirPath, size } = req.body;
      if (!validName(name)) throw httpError(400, 'Tên tệp upload không hợp lệ');
      if (!Number.isSafeInteger(size) || size < 0 || size > maxUploadSize) throw httpError(413, `Tệp vượt giới hạn ${Math.floor(maxUploadSize / 1024 / 1024)}MB`);
      const directory = resolveInsideRoot(dirPath); await mustBeDirectory(directory);
      const target = path.join(directory, name); await ensureMissing(target);
      if (reservedUploadTargets.has(target)) throw httpError(409, 'Đã có một phiên upload khác dùng tên tệp này. Hãy chờ hoàn tất hoặc đổi tên tệp.');
      await fsp.mkdir(uploadRoot, { recursive: true });
      const id = crypto.randomBytes(16).toString('hex'); const paths = uploadPaths(id);
      const metadata: UploadMetadata = { id, targetPath: relative(target), size, owner: uploadOwner(req), createdAt: new Date().toISOString() };
      reservedUploadTargets.set(target, id);
      await fsp.writeFile(paths.data, Buffer.alloc(0), { flag: 'wx' });
      try { await fsp.writeFile(paths.metadata, JSON.stringify(metadata), { flag: 'wx' }); }
      catch (error) { releaseUploadTarget(metadata); await fsp.rm(paths.data, { force: true }); throw error; }
      return res.status(201).json({ success: true, uploadId: id, chunkSize: MAX_UPLOAD_CHUNK_SIZE });
    } catch (error) { return fail(res, error); }
  });

  router.put('/upload/:id', raw({ type: 'application/octet-stream', limit: MAX_UPLOAD_CHUNK_SIZE }), async (req: any, res) => {
    try {
      const { metadata, paths } = await readUpload(req, req.params.id);
      const offset = Number(req.headers['x-upload-offset']);
      if (!Number.isSafeInteger(offset) || offset < 0) throw httpError(400, 'Offset upload không hợp lệ');
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw httpError(400, 'Chunk upload trống');
      const stat = await fsp.stat(paths.data);
      if (stat.size !== offset) throw httpError(409, `Offset upload không khớp, máy chủ đang ở byte ${stat.size}`);
      if (offset + req.body.length > metadata.size) throw httpError(400, 'Chunk vượt quá dung lượng tệp đã khai báo');
      await fsp.appendFile(paths.data, req.body);
      return res.json({ success: true, received: offset + req.body.length });
    } catch (error) { return fail(res, error); }
  });

  router.post('/upload/:id/complete', async (req, res) => {
    try {
      const { metadata, paths } = await readUpload(req, req.params.id);
      const stat = await fsp.stat(paths.data);
      if (stat.size !== metadata.size) throw httpError(409, `Upload chưa hoàn tất (${stat.size}/${metadata.size} byte)`);
      const target = resolveInsideRoot(metadata.targetPath);
      await ensureMissing(target);
      await safeMove(paths.data, target);
      await fsp.rm(paths.metadata, { force: true });
      releaseUploadTarget(metadata);
      await log(`Đã upload tệp: ${relative(target)}`, clientIp(req));
      return res.status(201).json({ success: true, path: relative(target) });
    } catch (error) { return fail(res, error); }
  });

  router.delete('/upload/:id', async (req, res) => {
    try {
      const { metadata, paths } = await readUpload(req, req.params.id);
      await Promise.all([fsp.rm(paths.data, { force: true }), fsp.rm(paths.metadata, { force: true })]);
      releaseUploadTarget(metadata);
      return res.json({ success: true });
    } catch (error) { return fail(res, error); }
  });

  router.post('/move', async (req, res) => {
    try {
      const { sourcePath, destinationDir, newName } = req.body; const source = resolveInsideRoot(sourcePath); const destination = resolveInsideRoot(destinationDir); await mustBeDirectory(destination);
      const name = newName || path.basename(source); if (!validName(name)) throw httpError(400, 'Tên mới không hợp lệ');
      const target = path.join(destination, name); await ensureMissing(target); await createSnapshot(source, 'before_move'); await safeMove(source, target); await log(`Đã di chuyển/đổi tên: ${relative(source)} -> ${relative(target)}`, clientIp(req));
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
        if (operation === 'copy') await fsp.cp(source, target, { recursive: true, errorOnExist: true }); else { await createSnapshot(source, 'before_bulk_move'); await safeMove(source, target); }
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
      let parsedMode: number | undefined;
      if (mode !== undefined) {
        const candidate = typeof mode === 'string' ? Number.parseInt(mode, 8) : Number(mode);
        if (!Number.isInteger(candidate) || candidate < 0 || candidate > 0o7777) throw httpError(400, 'Mode không hợp lệ');
        parsedMode = candidate;
      }
      let ownership: { uid: number; gid: number } | undefined;
      if (uid !== undefined || gid !== undefined) {
        if (process.platform === 'win32') throw httpError(501, 'Chown không được hỗ trợ trên Windows');
        const stat = await fsp.stat(target); const nextUid = uid === undefined ? stat.uid : Number(uid); const nextGid = gid === undefined ? stat.gid : Number(gid);
        if (!Number.isInteger(nextUid) || !Number.isInteger(nextGid) || nextUid < 0 || nextGid < 0) throw httpError(400, 'UID/GID không hợp lệ');
        ownership = { uid: nextUid, gid: nextGid };
      }
      await createSnapshot(target, 'before_metadata_change');
      if (parsedMode !== undefined) await fsp.chmod(target, parsedMode);
      if (ownership) await fsp.chown(target, ownership.uid, ownership.gid);
      await log(`Đã cập nhật metadata: ${relative(target)}`, clientIp(req)); return res.json({ success: true, ...(await itemDetails(target)) });
    } catch (error) { return fail(res, error); }
  });

  router.post('/archive/create', async (req, res) => {
    try {
      const sources = pathsFrom(req.body); const destinationDir = resolveInsideRoot(req.body.destinationDir ?? ''); await mustBeDirectory(destinationDir);
      const format = req.body.format ?? 'zip'; if (!['zip', 'tar', 'tar.gz'].includes(format)) throw httpError(400, 'Định dạng archive không được hỗ trợ');
      const defaultName = `archive-${Date.now()}.${format}`; const name = req.body.name ?? defaultName; if (!validName(name)) throw httpError(400, 'Tên archive không hợp lệ');
      const target = path.join(destinationDir, name); await ensureMissing(target);
      const canonicalTarget = path.join(await fsp.realpath(destinationDir), name);
      const plan: Array<{ source: string; archivePath: string; stat: fs.Stats; directory: boolean }> = [];
      let sourceStats: ArchiveSourceStats = { entries: 0, totalSize: 0 };
      const inspect = async (source: string, archivePath: string, depth: number): Promise<void> => {
        const stat = await fsp.lstat(source);
        const type = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
        sourceStats = accountArchiveSourceEntry(sourceStats, { path: relative(source), type, size: stat.size, depth });
        plan.push({ source, archivePath, stat, directory: type === 'directory' });
        if (type === 'directory') {
          const children = await fsp.readdir(source);
          for (const child of children) await inspect(path.join(source, child), path.posix.join(archivePath, child), depth + 1);
        }
      };
      for (const value of sources) {
        const source = resolveInsideRoot(value); const stat = await fsp.lstat(source);
        if (stat.isDirectory()) {
          const canonicalSource = await fsp.realpath(source);
          const targetRelative = path.relative(canonicalSource, canonicalTarget);
          if (targetRelative === '' || (!targetRelative.startsWith('..' + path.sep) && targetRelative !== '..' && !path.isAbsolute(targetRelative))) throw httpError(400, 'Archive đích không thể nằm trong thư mục nguồn');
        }
        await inspect(source, path.basename(source), 0);
      }
      await (async () => {
        const archive = format === 'zip' ? new archiver.ZipArchive() : new archiver.TarArchive(format === 'tar.gz' ? { gzip: true } : {});
        let outputBytes = 0;
        const quota = new Transform({ transform(chunk, _encoding, callback) {
          outputBytes += chunk.length;
          if (outputBytes > ARCHIVE_LIMITS.maxOutputSize) return callback(httpError(413, 'Archive đầu ra vượt quá giới hạn dung lượng'));
          callback(null, chunk);
        } });
        const outputPipeline = pipeline(archive, quota, fs.createWriteStream(target, { flags: 'wx' }));
        try {
          for (const entry of plan) {
            if (entry.directory) archive.append(Buffer.alloc(0), { name: entry.archivePath.endsWith('/') ? entry.archivePath : `${entry.archivePath}/`, type: 'directory', stats: entry.stat });
            else archive.file(entry.source, { name: entry.archivePath, stats: entry.stat });
          }
          await Promise.all([archive.finalize(), outputPipeline]);
        } catch (error) {
          archive.abort();
          await outputPipeline.catch(() => undefined);
          throw error;
        }
      })().catch(async error => { await fsp.rm(target, { force: true }); throw error; });
      await log(`Đã tạo archive: ${relative(target)}`, clientIp(req)); return res.status(201).json({ success: true, path: relative(target) });
    } catch (error) { return fail(res, error); }
  });

  router.post('/archive/extract', async (req, res) => {
    const createdFiles: string[] = [];
    const createdDirectories: string[] = [];
    try {
      const source = resolveInsideRoot(req.body.path ?? req.body.archivePath); const destination = resolveInsideRoot(req.body.destinationDir); await mustBeDirectory(destination);
      if (path.extname(source).toLowerCase() !== '.zip') throw httpError(400, 'Chỉ hỗ trợ giải nén ZIP');
      const directory = await unzipper.Open.file(source);
      const normalizedPaths = validateArchivePlan(directory.files);
      const planned = directory.files.map((entry, index) => {
        const normalized = normalizedPaths[index];
        const target = path.resolve(destination, normalized); if (target !== destination && !target.startsWith(destination + path.sep)) throw httpError(400, `ZIP chứa đường dẫn không an toàn: ${entry.path}`);
        assertCanonicalInsideRoot(target);
        return { entry, target };
      });
      const ensureDirectory = async (directoryPath: string) => {
        const missing: string[] = [];
        let current = directoryPath;
        while (current !== destination && !fs.existsSync(current)) { missing.push(current); current = path.dirname(current); }
        await fsp.mkdir(directoryPath, { recursive: true });
        createdDirectories.push(...missing);
      };
      let actualTotal = 0;
      for (const { entry, target } of planned) {
        if (entry.type === 'Directory') await ensureDirectory(target);
        else {
          await ensureDirectory(path.dirname(target)); await ensureMissing(target); createdFiles.push(target);
          let fileSize = 0;
          const quota = new Transform({ transform(chunk, _encoding, callback) {
            fileSize += chunk.length; actualTotal += chunk.length;
            if (fileSize > ARCHIVE_LIMITS.maxFileSize || actualTotal > ARCHIVE_LIMITS.maxTotalSize) return callback(httpError(413, 'ZIP vượt quá giới hạn dung lượng khi giải nén'));
            callback(null, chunk);
          } });
          await pipeline(entry.stream(), quota, fs.createWriteStream(target, { flags: 'wx' }));
        }
      }
      await log(`Đã giải nén: ${relative(source)} -> ${relative(destination)}`, clientIp(req)); return res.json({ success: true, destinationPath: relative(destination), entries: planned.length });
    } catch (error) {
      await Promise.all(createdFiles.map(file => fsp.rm(file, { force: true }).catch(() => undefined)));
      for (const directory of [...new Set(createdDirectories)].sort((a, b) => b.length - a.length)) await fsp.rmdir(directory).catch(() => undefined);
      return fail(res, error);
    }
  });

  router.post('/symlink', async (req, res) => {
    try {
      const source = resolveInsideRoot(req.body.targetPath ?? req.body.sourcePath); await fsp.lstat(source);
      const destinationDir = resolveInsideRoot(req.body.destinationDir); await mustBeDirectory(destinationDir); const name = req.body.name ?? path.basename(source); if (!validName(name)) throw httpError(400, 'Tên liên kết không hợp lệ');
      const target = path.join(destinationDir, name); await ensureMissing(target); const type = process.platform === 'win32' ? ((await fsp.stat(source)).isDirectory() ? 'junction' : 'file') : undefined;
      await fsp.symlink(source, target, type); await log(`Đã tạo symlink: ${relative(target)} -> ${relative(source)}`, clientIp(req)); return res.status(201).json({ success: true, path: relative(target) });
    } catch (error) { return fail(res, error); }
  });

  router.post('/delete-policy', async (req, res) => {
    try {
      const policies = await runItemsLimited(pathsFrom(req.body), async value => {
        const policy = await deletionPolicy(value);
        return { path: policy.path, isDirectory: policy.targetStat.isDirectory(), deletionMode: policy.mode, permanentlyDeleted: policy.permanentlyDeleted, policyToken: signPolicy(policyFingerprint(policy)) };
      });
      const permanent = policies.filter(item => item.success && item.permanentlyDeleted).length;
      return res.json({ success: policies.every(item => item.success), permanent, trashed: policies.filter(item => item.success).length - permanent, policies });
    } catch (error) { return fail(res, error); }
  });

  router.post('/delete-plan', async (req, res) => {
    try {
      const plans = await runItemsLimited(pathsFrom(req.body), async value => {
        const policy = await deletionPolicy(value); const stack = [{ target: policy.target, depth: 0 }]; let entries = 0; let bytes = 0; let truncated = false;
        while (stack.length) {
          const item = stack.pop()!; if (item.depth > maxDeleteDepth || entries >= maxDeleteEntries) { truncated = true; break; }
          const stat = await fsp.lstat(item.target); entries++; bytes += stat.size;
          if (stat.isDirectory() && !stat.isSymbolicLink()) for (const name of await fsp.readdir(item.target)) stack.push({ target: path.join(item.target, name), depth: item.depth + 1 });
        }
        return { path: policy.path, entries, bytes, truncated, isDirectory: policy.targetStat.isDirectory(), deletionMode: policy.mode, permanentlyDeleted: policy.permanentlyDeleted, policyToken: signPolicy(policyFingerprint(policy)) };
      });
      return res.json({ success: plans.every(item => item.success), totalEntries: plans.reduce((sum, item) => sum + Number(item.entries || 0), 0), totalBytes: plans.reduce((sum, item) => sum + Number(item.bytes || 0), 0), truncated: plans.some(item => item.truncated), permanent: plans.filter(item => item.success && item.permanentlyDeleted).length, trashed: plans.filter(item => item.success && !item.permanentlyDeleted).length, plans });
    } catch (error) { return fail(res, error); }
  });

  router.get('/delete-jobs/:id', (req, res) => {
    const job = deleteJobs.get(req.params.id) || deleteJobStore?.getDeleteJob(req.params.id);
    const role = sessionRole(cookieToken(req)); if (!job || job.owner !== uploadOwner(req) && role !== 'admin' && role !== 'root') return res.status(404).json({ success: false, error: 'Không tìm thấy tác vụ xóa' });
    return res.json({ success: true, job: { ...job, owner: undefined, cancelRequested: undefined } });
  });

  router.post('/delete-jobs/:id/cancel', (req, res) => {
    const job = deleteJobs.get(req.params.id);
    const role = sessionRole(cookieToken(req)); if (!job || job.owner !== uploadOwner(req) && role !== 'admin' && role !== 'root') return res.status(404).json({ success: false, error: 'Không tìm thấy tác vụ xóa' });
    if (!['pending', 'running'].includes(job.state)) return res.status(409).json({ success: false, error: 'Tác vụ xóa đã kết thúc' });
    job.cancelRequested = true; job.message = 'Đang yêu cầu hủy'; persistDeleteJob(job);
    return res.json({ success: true, job: { ...job, owner: undefined, cancelRequested: undefined } });
  });

  router.get('/delete-jobs', (req, res) => {
    const owner = uploadOwner(req); const role = sessionRole(cookieToken(req)); const jobs = deleteJobStore?.getDeleteJobs(role === 'admin' || role === 'root' ? undefined : owner, 200) || [...deleteJobs.values()].filter(job => role === 'admin' || role === 'root' || job.owner === owner);
    return res.json({ success: true, jobs: jobs.map(job => ({ ...job, owner: undefined, cancelRequested: undefined })) });
  });

  router.delete('/', async (req, res) => {
    try {
      const owner = uploadOwner(req); const requestedIdempotencyKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'].slice(0, 128) : undefined;
      const existing = requestedIdempotencyKey && (deleteJobStore?.getDeleteJobByIdempotency(owner, requestedIdempotencyKey) || [...deleteJobs.values()].find(job => job.owner === owner && job.idempotencyKey === requestedIdempotencyKey));
      if (existing) return res.status(202).json({ success: true, queued: true, jobId: existing.id, message: existing.message, idempotent: true });
      const policy = await verifyPolicyToken(req.query.path, req.headers['x-policy-token']);
      if (policy.permanentlyDeleted || requestedIdempotencyKey) {
        const idempotencyKey = requestedIdempotencyKey;
        const id = crypto.randomUUID(); const job: DeleteJob = { id, owner, state: 'pending', progress: 0, completed: 0, total: 1, message: 'Đang chờ', paths: [req.query.path], results: [], createdAt: new Date().toISOString(), cancelRequested: false, idempotencyKey };
        pruneDeleteJobs(); deleteJobs.set(id, job); persistDeleteJob(job); processDeleteJob(job, job.paths);
        return res.status(202).json({ success: true, queued: true, jobId: id, message: 'Đã đưa thao tác xóa thư mục vào hàng đợi' });
      }
      const result = await trashOne(req.query.path); const message = result.permanentlyDeleted ? 'Đã xóa trực tiếp khỏi ổ đĩa mạng' : 'Đã chuyển vào thùng rác'; await log(`${message}: ${result.path}`, clientIp(req), { action: 'file_delete', level: result.permanentlyDeleted ? 'critical' : 'warning', metadata: { path: result.path, deletionMode: result.deletionMode } }); return res.json({ success: true, message, ...result });
    }
    catch (error) { return fail(res, error); }
  });

  router.post('/trash', async (req, res) => {
    try {
      const owner = uploadOwner(req); const requestedIdempotencyKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'].slice(0, 128) : undefined;
      const existing = requestedIdempotencyKey && (deleteJobStore?.getDeleteJobByIdempotency(owner, requestedIdempotencyKey) || [...deleteJobs.values()].find(job => job.owner === owner && job.idempotencyKey === requestedIdempotencyKey));
      if (existing) return res.status(202).json({ success: true, queued: true, jobId: existing.id, message: existing.message, idempotent: true });
      const values = pathsFrom(req.body);
      const tokens = req.body?.policyTokens; if (!tokens || typeof tokens !== 'object') throw Object.assign(httpError(409, 'Cần xác nhận lại kế hoạch xóa'), { code: 'FILE_CHANGED' });
      await Promise.all(values.map(value => verifyPolicyToken(value, tokens[String(value)])));
      if (values.length >= backgroundDeleteThreshold || requestedIdempotencyKey) {
        const idempotencyKey = requestedIdempotencyKey;
        const id = crypto.randomUUID(); const job: DeleteJob = { id, owner, state: 'pending', progress: 0, completed: 0, total: values.length, message: 'Đang chờ', paths: values, results: [], createdAt: new Date().toISOString(), cancelRequested: false, idempotencyKey };
        pruneDeleteJobs(); deleteJobs.set(id, job); persistDeleteJob(job); processDeleteJob(job, values);
        return res.status(202).json({ success: true, queued: true, jobId: id, message: `Đã đưa ${values.length} mục vào hàng đợi xóa` });
      }
      const results = await runItemsLimited(values, trashOne); const summary = summarizeDeletionResults(results); const message = `Đã xóa trực tiếp ${summary.directlyDeleted} mục và chuyển ${summary.trashed} mục vào thùng rác`; await log(message, clientIp(req), { action: 'file_bulk_delete', level: summary.directlyDeleted ? 'critical' : 'warning', result: summary.failed ? 'failure' : 'success', metadata: { paths: values, ...summary } });
      return res.status(summary.failed ? 207 : 200).json({ success: !summary.failed, message, ...summary, results });
    } catch (error) { return fail(res, error); }
  });

  router.get('/trash', async (_req, res) => {
    try {
      await reconcileTrash();
      await fsp.mkdir(trashRoot, { recursive: true }); const names = (await fsp.readdir(trashRoot)).filter(name => !name.endsWith('.json') && !name.endsWith('.pending') && name !== '.lost-found');
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
