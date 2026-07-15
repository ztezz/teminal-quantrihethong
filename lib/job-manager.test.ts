import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { JobError, JobManager, validateAlertWebhook, type Job } from './job-manager';

function createDatabase(filename: string, valid = true) {
  if (!valid) return fs.writeFileSync(filename, 'not a sqlite database');
  const database = new DatabaseSync(filename);
  database.exec("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO records (value) VALUES ('one'), ('two')");
  database.close();
}

async function fixture(options: { historyLimit?: number; retention?: number; fetch?: typeof fetch; webhook?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-'));
  const dataDir = path.join(root, 'job-data');
  const backupDir = path.join(root, 'backups');
  const filename = path.join(root, 'sample.sqlite');
  createDatabase(filename);
  const manager = await JobManager.create({
    dataDir, sqliteRoot: root, sqliteBrowserRoot: root, sqliteBackupDir: backupDir,
    historyLimit: options.historyLimit, backupRetentionCount: options.retention,
    alertWebhookUrl: options.webhook, fetch: options.fetch
  });
  const wait = async (id: string) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const job = manager.get(id)!;
      if (!['pending', 'running'].includes(job.state)) return job;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Job did not finish');
  };
  return { root, dataDir, backupDir, filename, manager, wait, close: async () => { await manager.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('runs explicit SQLite jobs, persists bounded history, and rejects duplicate active jobs', async () => {
  const context = await fixture({ historyLimit: 2 });
  try {
    const first = await context.manager.createJob({ type: 'sqlite_integrity', path: 'sample.sqlite' }, 'alice');
    await assert.rejects(context.manager.createJob({ type: 'sqlite_integrity', path: 'sample.sqlite' }, 'alice'), (error: unknown) => error instanceof JobError && error.status === 409);
    const integrity = await context.wait(first.id);
    assert.equal(integrity.state, 'success');
    assert.deepEqual(integrity.result, { integrity: 'ok' });
    assert.ok(integrity.startedAt);
    assert.ok(integrity.finishedAt);
    assert.equal(integrity.progress, 100);

    const second = await context.manager.createJob({ type: 'sqlite_backup', path: 'sample.sqlite' }, 'alice');
    assert.equal((await context.wait(second.id)).state, 'success');
    const third = await context.manager.createJob({ type: 'sqlite_integrity', path: 'sample.sqlite' }, 'alice');
    await context.wait(third.id);
    await context.manager.waitForIdle();
    assert.equal(context.manager.list().length, 2);
    const persisted = JSON.parse(fs.readFileSync(path.join(context.dataDir, 'jobs.json'), 'utf8')) as Job[];
    assert.equal(persisted.length, 2);
    assert.equal(fs.readdirSync(context.dataDir).some(name => name.endsWith('.tmp')), false);
  } finally { await context.close(); }
});

test('scheduled backup retention is isolated per database', async () => {
  const context = await fixture({ retention: 1 });
  try {
    const other = path.join(context.root, 'other.sqlite');
    createDatabase(other);
    for (const filename of ['sample.sqlite', 'sample.sqlite', 'other.sqlite']) {
      const job = await context.manager.createJob({ type: 'sqlite_backup', path: filename }, 'scheduler', 'schedule');
      assert.equal((await context.wait(job.id)).state, 'success');
    }
    const backups = fs.readdirSync(context.backupDir).filter(name => name.endsWith('.sqlite'));
    assert.equal(backups.length, 2);
    assert.equal(backups.filter(name => name.includes('sample')).length, 1);
    assert.equal(backups.filter(name => name.includes('other')).length, 1);
  } finally { await context.close(); }
});

test('rejects unsafe paths and records failures with webhook alerts', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const context = await fixture({ webhook: 'https://alerts.example.test/job', fetch: fakeFetch });
  try {
    await assert.rejects(context.manager.createJob({ type: 'sqlite_backup', path: '../outside.sqlite' }, 'alice'), (error: unknown) => error instanceof JobError && error.status === 403);
    const broken = path.join(context.root, 'broken.sqlite');
    createDatabase(broken, false);
    const job = await context.manager.createJob({ type: 'sqlite_integrity', path: 'broken.sqlite' }, 'alice');
    const failed = await context.wait(job.id);
    assert.equal(failed.state, 'failure');
    assert.ok(failed.error);
    for (let attempt = 0; attempt < 50 && !requests.length; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://alerts.example.test/job');
    assert.equal(requests[0].init?.redirect, 'error');
    assert.equal(JSON.parse(String(requests[0].init?.body)).event, 'job.failure');
  } finally { await context.close(); }
});

test('webhook validation requires HTTPS and a production hostname allowlist', () => {
  assert.throws(() => validateAlertWebhook('http://example.test/hook', [], false), /HTTPS/);
  assert.throws(() => validateAlertWebhook('https://example.test/hook', [], true), /ALERT_WEBHOOK_HOSTS/);
  assert.throws(() => validateAlertWebhook('https://other.test/hook', ['example.test'], true), /not in/);
  assert.equal(validateAlertWebhook('https://EXAMPLE.test/hook', ['example.test'], true)?.hostname, 'example.test');
});

test('pending or running jobs can be cancelled', async () => {
  const context = await fixture();
  try {
    const job = await context.manager.createJob({ type: 'sqlite_backup', path: 'sample.sqlite' }, 'alice');
    const cancelled = await context.manager.cancel(job.id);
    assert.ok(['running', 'cancelled'].includes(cancelled.state));
    assert.equal((await context.wait(job.id)).state, 'cancelled');
  } finally { await context.close(); }
});
