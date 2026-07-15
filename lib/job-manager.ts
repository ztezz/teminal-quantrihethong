import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const fsp = fs.promises;
const SQLITE_EXTENSIONS = new Set(['.sqlite', '.sqlite3', '.db']);

export type JobType = 'sqlite_backup' | 'sqlite_integrity' | 'sqlite_vacuum';
export type JobState = 'pending' | 'running' | 'success' | 'failure' | 'cancelled';
export type JobSource = 'api' | 'schedule';
export type JobLog = { timestamp: string; message: string };
export type Job = {
  id: string;
  type: JobType;
  state: JobState;
  path: string;
  source: JobSource;
  createdBy: string;
  requiredRole: 'admin' | 'root';
  progress: number;
  message: string;
  logs: JobLog[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: Record<string, unknown>;
  error?: string;
};

export type JobManagerOptions = {
  dataDir: string;
  sqliteRoot: string;
  sqliteBrowserRoot: string;
  sqliteBackupDir: string;
  historyLimit?: number;
  backupRetentionCount?: number;
  alertWebhookUrl?: string;
  alertWebhookHosts?: string[];
  production?: boolean;
  fetch?: typeof fetch;
};

export type CreateJobInput = { type: JobType; path: string };

export class JobError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function isInside(parent: string, target: string) {
  const relative = path.relative(parent, target);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 2000);
  return String(error).slice(0, 2000);
}

function abortError() {
  return Object.assign(new Error('Job cancelled'), { name: 'AbortError' });
}

export function validateAlertWebhook(urlValue: string | undefined, hosts: string[], production: boolean): URL | null {
  if (!urlValue?.trim()) return null;
  let url: URL;
  try { url = new URL(urlValue); } catch { throw new Error('ALERT_WEBHOOK_URL must be a valid URL'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('ALERT_WEBHOOK_URL must use HTTPS and cannot contain credentials');
  const allowlist = new Set(hosts.map(host => host.trim().toLowerCase()).filter(Boolean));
  if (production && !allowlist.size) throw new Error('ALERT_WEBHOOK_HOSTS is required in production when ALERT_WEBHOOK_URL is configured');
  if (allowlist.size && !allowlist.has(url.hostname.toLowerCase())) throw new Error('ALERT_WEBHOOK_URL hostname is not in ALERT_WEBHOOK_HOSTS');
  return url;
}

export class JobManager {
  private readonly dataFile: string;
  private readonly sqliteRoot: string;
  private readonly canonicalSqliteRoot: string;
  private readonly browserRoot: string;
  private readonly canonicalBrowserRoot: string;
  private readonly backupRoot: string;
  private readonly historyLimit: number;
  private readonly retentionCount: number;
  private readonly webhook: URL | null;
  private readonly fetchImpl: typeof fetch;
  private jobs: Job[] = [];
  private controllers = new Map<string, AbortController>();
  private processing = false;
  private processPromise: Promise<void> = Promise.resolve();
  private persistChain = Promise.resolve();
  private scheduleTimer?: NodeJS.Timeout;

  private constructor(private readonly options: JobManagerOptions) {
    this.dataFile = path.join(path.resolve(options.dataDir), 'jobs.json');
    this.sqliteRoot = path.resolve(options.sqliteRoot);
    this.canonicalSqliteRoot = fs.realpathSync(this.sqliteRoot);
    this.browserRoot = path.resolve(options.sqliteBrowserRoot);
    this.canonicalBrowserRoot = fs.realpathSync(this.browserRoot);
    this.backupRoot = path.resolve(options.sqliteBackupDir);
    if (!isInside(this.sqliteRoot, this.backupRoot)) throw new Error('SQLite backup directory must be inside the manager root');
    this.historyLimit = Math.min(5000, Math.max(1, options.historyLimit ?? 200));
    this.retentionCount = Math.max(0, Math.min(10_000, options.backupRetentionCount ?? 10));
    this.webhook = validateAlertWebhook(options.alertWebhookUrl, options.alertWebhookHosts || [], Boolean(options.production));
    this.fetchImpl = options.fetch || fetch;
  }

  static async create(options: JobManagerOptions) {
    const manager = new JobManager(options);
    await manager.load();
    return manager;
  }

  list() { return this.jobs.map(job => structuredClone(job)); }

  get(id: string) {
    const job = this.jobs.find(item => item.id === id);
    return job ? structuredClone(job) : undefined;
  }

  async createJob(input: CreateJobInput, createdBy: string, source: JobSource = 'api') {
    if (!input || !['sqlite_backup', 'sqlite_integrity', 'sqlite_vacuum'].includes(input.type)) throw new JobError(400, 'Unsupported job type');
    const filename = this.resolveDatabase(input.path);
    const duplicate = this.jobs.find(job => job.type === input.type && path.resolve(job.path) === filename && (job.state === 'pending' || job.state === 'running'));
    if (duplicate) throw new JobError(409, `An active ${input.type} job already exists for this database`);
    if (this.jobs.filter(job => job.state === 'pending' || job.state === 'running').length >= this.historyLimit) throw new JobError(429, 'Job queue is full');
    const now = new Date().toISOString();
    const job: Job = {
      id: crypto.randomUUID(), type: input.type, state: 'pending', path: filename, source, createdBy,
      requiredRole: input.type === 'sqlite_vacuum' ? 'root' : 'admin', progress: 0,
      message: 'Queued', logs: [{ timestamp: now, message: 'Job queued' }], createdAt: now
    };
    this.jobs.unshift(job);
    this.trim();
    await this.persist();
    this.processQueue();
    return structuredClone(job);
  }

  async cancel(id: string) {
    const job = this.jobs.find(item => item.id === id);
    if (!job) throw new JobError(404, 'Job not found');
    if (!['pending', 'running'].includes(job.state)) throw new JobError(409, 'Job is already finished');
    const controller = this.controllers.get(id);
    if (controller) {
      job.message = 'Cancellation requested';
      this.addLog(job, 'Cancellation requested');
      controller.abort();
    } else {
      job.state = 'cancelled'; job.progress = 100; job.message = 'Cancelled'; job.finishedAt = new Date().toISOString();
      this.addLog(job, 'Job cancelled before it started');
    }
    await this.persist();
    return structuredClone(job);
  }

  startSchedule(minutes: number, databases: string[]) {
    this.stopSchedule();
    if (!Number.isFinite(minutes) || minutes <= 0 || !databases.length) return;
    const interval = Math.max(1, minutes) * 60_000;
    this.scheduleTimer = setInterval(() => { void this.runScheduledBackups(databases); }, interval);
    this.scheduleTimer.unref();
  }

  stopSchedule() {
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
    this.scheduleTimer = undefined;
  }

  async runScheduledBackups(databases: string[]) {
    for (const database of databases) {
      try { await this.createJob({ type: 'sqlite_backup', path: database }, 'scheduler', 'schedule'); }
      catch (error) { if (!(error instanceof JobError && error.status === 409)) console.error('[JOBS] Could not schedule SQLite backup:', errorMessage(error)); }
    }
  }

  async close() {
    this.stopSchedule();
    for (const controller of this.controllers.values()) controller.abort();
    await this.processPromise;
    await this.persistChain;
  }

  async waitForIdle() {
    await this.processPromise;
    await this.persistChain;
  }

  private async load() {
    await fsp.mkdir(path.dirname(this.dataFile), { recursive: true });
    try {
      const parsed = JSON.parse(await fsp.readFile(this.dataFile, 'utf8'));
      if (Array.isArray(parsed)) this.jobs = parsed.filter(this.isStoredJob).slice(0, this.historyLimit);
    } catch (error: any) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    const interrupted = this.jobs.filter(job => job.state === 'pending' || job.state === 'running');
    for (const job of interrupted) {
      job.state = 'failure'; job.progress = 100; job.message = 'Interrupted by server restart'; job.error = job.message; job.finishedAt = new Date().toISOString();
      this.addLog(job, job.message);
    }
    if (interrupted.length) await this.persist();
  }

  private isStoredJob(value: unknown): value is Job {
    if (!value || typeof value !== 'object') return false;
    const job = value as Partial<Job>;
    return typeof job.id === 'string' && typeof job.path === 'string' && typeof job.createdAt === 'string'
      && ['sqlite_backup', 'sqlite_integrity', 'sqlite_vacuum'].includes(String(job.type))
      && ['pending', 'running', 'success', 'failure', 'cancelled'].includes(String(job.state))
      && Array.isArray(job.logs);
  }

  private resolveDatabase(userPath: unknown) {
    if (typeof userPath !== 'string' || !userPath.trim() || userPath.length > 1024) throw new JobError(400, 'Invalid database path');
    const absoluteInput = path.isAbsolute(userPath);
    const target = absoluteInput ? path.resolve(userPath) : path.resolve(this.sqliteRoot, userPath.replace(/^[/\\]+/, ''));
    const allowedRoot = absoluteInput ? this.browserRoot : this.sqliteRoot;
    const canonicalRoot = absoluteInput ? this.canonicalBrowserRoot : this.canonicalSqliteRoot;
    if (!isInside(allowedRoot, target)) throw new JobError(403, 'Database is outside the allowed root');
    if (isInside(this.backupRoot, target)) throw new JobError(403, 'Backup files cannot be job targets');
    if (!SQLITE_EXTENSIONS.has(path.extname(target).toLowerCase())) throw new JobError(400, 'Database must use .sqlite, .sqlite3, or .db');
    let canonical: string;
    try { canonical = fs.realpathSync(target); } catch (error: any) { throw new JobError(error.code === 'ENOENT' ? 404 : 403, 'Database path cannot be verified'); }
    if (!isInside(canonicalRoot, canonical)) throw new JobError(403, 'Database symlink leaves the allowed root');
    const stat = fs.statSync(canonical);
    if (!stat.isFile()) throw new JobError(400, 'Database path is not a file');
    return canonical;
  }

  private processQueue() {
    if (this.processing) return;
    this.processing = true;
    this.processPromise = (async () => {
      try {
        let job: Job | undefined;
        while ((job = this.jobs.find(item => item.state === 'pending'))) await this.run(job);
      } finally { this.processing = false; }
    })();
  }

  private async run(job: Job) {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    job.state = 'running'; job.startedAt = new Date().toISOString(); job.message = 'Running'; job.progress = 1;
    this.addLog(job, 'Job started');
    await this.persist();
    try {
      job.result = job.type === 'sqlite_backup' ? await this.runBackup(job, controller.signal) : await this.runMaintenance(job, controller.signal);
      if (controller.signal.aborted) throw abortError();
      job.state = 'success'; job.progress = 100; job.message = 'Completed';
      this.addLog(job, 'Job completed');
    } catch (error) {
      const cancelled = controller.signal.aborted || error instanceof Error && error.name === 'AbortError';
      job.state = cancelled ? 'cancelled' : 'failure'; job.progress = 100;
      job.message = cancelled ? 'Cancelled' : 'Failed';
      if (!cancelled) job.error = errorMessage(error);
      this.addLog(job, cancelled ? 'Job cancelled' : `Job failed: ${job.error}`);
      if (!cancelled) {
        job.finishedAt = new Date().toISOString();
        void this.sendFailureAlert(job);
      }
    } finally {
      job.finishedAt = new Date().toISOString();
      this.controllers.delete(job.id);
      this.trim();
      await this.persist();
    }
  }

  private async runBackup(job: Job, signal: AbortSignal) {
    await this.ensureBackupRoot();
    if (signal.aborted) throw abortError();
    const database = new DatabaseSync(job.path, { readOnly: true, timeout: 5000 });
    const safeBase = path.basename(job.path, path.extname(job.path)).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'database';
    const hash = crypto.createHash('sha256').update(job.path).digest('hex').slice(0, 12);
    const prefix = `${job.source === 'schedule' ? 'scheduled' : 'job'}-${safeBase}-${hash}-`;
    const name = `${prefix}${new Date().toISOString().replace(/[:.]/g, '-')}-${job.id.slice(0, 8)}.sqlite`;
    const target = path.join(this.backupRoot, name);
    try {
      await backup(database, target, {
        rate: 100,
        progress: ({ totalPages, remainingPages }) => {
          if (signal.aborted) throw abortError();
          job.progress = totalPages ? Math.max(1, Math.min(99, Math.round((totalPages - remainingPages) / totalPages * 100))) : 50;
          job.message = `Backing up (${job.progress}%)`;
          return 100;
        }
      });
      if (signal.aborted) { await fsp.rm(target, { force: true }); throw abortError(); }
      const stat = await fsp.stat(target);
      if (job.source === 'schedule') await this.enforceRetention(prefix);
      this.addLog(job, `Backup created: ${name}`);
      return { backup: name, size: stat.size };
    } catch (error) {
      await fsp.rm(target, { force: true }).catch(() => undefined);
      throw error;
    } finally { database.close(); }
  }

  private async runMaintenance(job: Job, signal: AbortSignal) {
    if (signal.aborted) throw abortError();
    const readOnly = job.type === 'sqlite_integrity';
    const database = new DatabaseSync(job.path, { readOnly, timeout: 5000 });
    try {
      if (job.type === 'sqlite_integrity') {
        job.progress = 20; job.message = 'Running integrity_check';
        const rows = database.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>;
        if (signal.aborted) throw abortError();
        const messages = rows.flatMap(row => Object.values(row).map(String)).slice(0, 1000);
        if (messages.length !== 1 || messages[0] !== 'ok') throw new Error(`SQLite integrity check failed: ${messages.join('; ').slice(0, 1500)}`);
        return { integrity: 'ok' };
      }
      job.progress = 20; job.message = 'Running VACUUM';
      database.exec('VACUUM');
      if (signal.aborted) throw abortError();
      return { vacuumed: true };
    } finally {
      database.close();
    }
  }

  private async ensureBackupRoot() {
    await fsp.mkdir(this.backupRoot, { recursive: true });
    if (!isInside(this.canonicalSqliteRoot, fs.realpathSync(this.backupRoot))) throw new JobError(403, 'Backup directory symlink is unsafe');
  }

  private async enforceRetention(prefix: string) {
    const entries = await fsp.readdir(this.backupRoot, { withFileTypes: true });
    const files = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.sqlite')).map(async entry => ({ name: entry.name, mtime: (await fsp.stat(path.join(this.backupRoot, entry.name))).mtimeMs })));
    files.sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
    await Promise.all(files.slice(this.retentionCount).map(file => fsp.rm(path.join(this.backupRoot, file.name), { force: true })));
  }

  private addLog(job: Job, message: string) {
    job.logs.push({ timestamp: new Date().toISOString(), message: message.slice(0, 2000) });
    if (job.logs.length > 200) job.logs.splice(0, job.logs.length - 200);
  }

  private trim() {
    if (this.jobs.length <= this.historyLimit) return;
    const active = this.jobs.filter(job => job.state === 'pending' || job.state === 'running');
    const finished = this.jobs.filter(job => job.state !== 'pending' && job.state !== 'running').slice(0, Math.max(0, this.historyLimit - active.length));
    this.jobs = [...active, ...finished].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private persist() {
    const snapshot = JSON.stringify(this.jobs, null, 2);
    this.persistChain = this.persistChain.then(async () => {
      const temporary = `${this.dataFile}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      await fsp.writeFile(temporary, snapshot, { flag: 'wx', mode: 0o600 });
      try {
        try { await fsp.rename(temporary, this.dataFile); }
        catch (error: any) {
          if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
          await fsp.rm(this.dataFile, { force: true });
          await fsp.rename(temporary, this.dataFile);
        }
      } finally { await fsp.rm(temporary, { force: true }); }
    });
    return this.persistChain;
  }

  private async sendFailureAlert(job: Job) {
    if (!this.webhook) return;
    try {
      const response = await this.fetchImpl(this.webhook, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'job.failure', job: { id: job.id, type: job.type, path: job.path, source: job.source, createdBy: job.createdBy, error: job.error, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt } })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) { console.error('[JOBS] Failure webhook could not be delivered:', errorMessage(error)); }
  }
}
