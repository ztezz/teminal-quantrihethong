import { Router, type Request, type Response } from 'express';
import { JobError, JobManager, type Job, type JobType } from './job-manager';

type Role = 'admin' | 'root';
type Options = {
  manager: JobManager;
  authorize: (req: Request, res: Response, minimum: Role) => { user?: { username?: string } } | boolean | null;
  log?: (req: Request, action: string, metadata?: Record<string, unknown>) => void;
  deletionJobs?: { getDeleteJobs: (owner?: string, limit?: number) => any[]; getDeleteJob: (id: string) => any };
};

export function createOperationsRouter({ manager, authorize, log, deletionJobs }: Options) {
  const router = Router();
  const fail = (res: Response, error: unknown) => {
    const status = error instanceof JobError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Job operation failed';
    return res.status(status).json({ success: false, error: message });
  };
  const admin = (req: Request, res: Response) => authorize(req, res, 'admin');

  router.get('/', (req, res) => {
    if (!admin(req, res)) return;
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const type = typeof req.query.type === 'string' ? req.query.type : '';
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
    const fileJobs = (deletionJobs?.getDeleteJobs(undefined, 200) || []).map(job => ({ ...job, type: 'file_delete', path: job.paths.map(String).join(', '), source: 'api', createdBy: job.owner.slice(0, 12), requiredRole: 'admin', logs: [], result: { completed: job.completed, total: job.total, results: job.results } })) as Array<Job & { type: 'file_delete' }>;
    const filtered = [...manager.list(), ...fileJobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter(job => (!state || job.state === state) && (!type || job.type === type));
    return res.json({ success: true, jobs: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit });
  });

  router.get('/:id', (req, res) => {
    if (!admin(req, res)) return;
    const stored = deletionJobs?.getDeleteJob(req.params.id); const job = manager.get(req.params.id) || (stored ? { ...stored, type: 'file_delete', path: stored.paths.map(String).join(', '), source: 'api', createdBy: stored.owner.slice(0, 12), requiredRole: 'admin', logs: [], result: { completed: stored.completed, total: stored.total, results: stored.results } } : undefined);
    return job ? res.json({ success: true, job }) : res.status(404).json({ success: false, error: 'Job not found' });
  });

  router.post('/', async (req, res) => {
    const context = admin(req, res);
    if (!context) return;
    const type = req.body?.type as JobType;
    if (type === 'sqlite_vacuum' && !authorize(req, res, 'root')) return;
    try {
      const username = typeof context === 'object' && context.user?.username ? context.user.username : 'admin';
      const job = await manager.createJob({ type, path: req.body?.path }, username);
      log?.(req, 'job_create', { jobId: job.id, type: job.type, path: job.path });
      return res.status(202).json({ success: true, job });
    } catch (error) { return fail(res, error); }
  });

  router.post('/:id/cancel', async (req, res) => {
    if (!admin(req, res)) return;
    const job = manager.get(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    if (job.requiredRole === 'root' && !authorize(req, res, 'root')) return;
    try {
      const cancelled = await manager.cancel(job.id);
      log?.(req, 'job_cancel', { jobId: job.id, type: job.type });
      return res.json({ success: true, job: cancelled });
    } catch (error) { return fail(res, error); }
  });

  return router;
}
