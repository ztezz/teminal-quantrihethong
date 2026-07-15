import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import express from 'express';
import { JobManager } from './job-manager';
import { createOperationsRouter } from './operations-router';

test('jobs REST API enforces admin/root permissions and exposes job contracts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-router-'));
  const database = new DatabaseSync(path.join(root, 'sample.sqlite'));
  database.exec('CREATE TABLE records (id INTEGER PRIMARY KEY)');
  database.close();
  const manager = await JobManager.create({ dataDir: path.join(root, 'jobs'), sqliteRoot: root, sqliteBrowserRoot: root, sqliteBackupDir: path.join(root, 'backups') });
  let role: 'viewer' | 'admin' | 'root' = 'viewer';
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', createOperationsRouter({
    manager,
    authorize: (_req, res, minimum) => role === 'root' || role === 'admin' && minimum === 'admin' ? { user: { username: role } } : (res.status(role === 'viewer' ? 403 : 403).json({ success: false, error: 'Forbidden' }), null)
  }));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  const request = async (route: string, init?: RequestInit) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/jobs${route}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
    return { status: response.status, body: JSON.parse(await response.text()) };
  };
  try {
    assert.equal((await request('/')).status, 403);
    role = 'admin';
    assert.equal((await request('/', { method: 'POST', body: JSON.stringify({ type: 'sqlite_vacuum', path: 'sample.sqlite' }) })).status, 403);
    const created = await request('/', { method: 'POST', body: JSON.stringify({ type: 'sqlite_integrity', path: 'sample.sqlite' }) });
    assert.equal(created.status, 202);
    assert.equal(created.body.job.type, 'sqlite_integrity');
    assert.equal(created.body.job.requiredRole, 'admin');
    assert.equal((await request(`/${created.body.job.id}`)).status, 200);
    const listed = await request('/?limit=10&type=sqlite_integrity');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.total, 1);
    assert.equal((await request('/', { method: 'POST', body: JSON.stringify({ type: 'shell', command: 'rm -rf /' }) })).status, 400);
    role = 'root';
    const vacuum = await request('/', { method: 'POST', body: JSON.stringify({ type: 'sqlite_vacuum', path: 'sample.sqlite' }) });
    assert.equal(vacuum.status, 202);
  } finally {
    await manager.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
