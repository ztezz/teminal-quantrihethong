import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('public shares support resumed uploads, repeat downloads, and owner-only deletion', { timeout: 30_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-share-test-'));
  const listener = net.createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No free port');
  const port = address.port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const origin = 'http://127.0.0.1:3000';
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts', '--backend'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'development', BACKEND_PORT: String(port), FRONTEND_ORIGIN: origin, TERMINAL_PASSWORD: 'temporary-test-password-2398', DATABASE_PATH: path.join(root, 'database.sqlite'), LEGACY_DATABASE_PATH: path.join(root, 'legacy.json'), QUICK_SHARE_DIR: path.join(root, 'shares'), JOB_DATA_DIR: path.join(root, 'jobs') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout?.on('data', data => { output += data.toString(); });
  child.stderr?.on('data', data => { output += data.toString(); });
  const request = (route: string, init: RequestInit = {}) => fetch(`${baseUrl}${route}`, { ...init, headers: { origin, ...init.headers } });
  try {
    let started = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) break;
      try { if ((await fetch(`${baseUrl}/healthz`)).ok) { started = true; break; } } catch { /* Still starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(started, `Backend did not start: ${output}`);
    const initialized = await request('/api/quick-share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'sample.txt', size: 10, public: true }) });
    assert.equal(initialized.status, 201);
    const { code, uploadToken } = await initialized.json() as { code: string; uploadToken: string };
    const headers = { 'content-type': 'application/octet-stream', 'x-quick-share-token': uploadToken };
    assert.equal((await request(`/api/quick-share/${code}`, { method: 'PUT', headers: { ...headers, 'x-upload-offset': '0' }, body: Buffer.from('0123') })).status, 200);
    const pending = await request(`/api/quick-share/${code}/upload`, { headers: { 'x-quick-share-token': uploadToken } });
    assert.equal((await pending.json() as { offset: number }).offset, 4);
    assert.equal((await request(`/api/quick-share/${code}`, { method: 'PUT', headers: { ...headers, 'x-upload-offset': '4' }, body: Buffer.from('456789') })).status, 200);
    assert.equal((await request(`/api/quick-share/${code}/complete`, { method: 'POST', headers: { 'x-quick-share-token': uploadToken } })).status, 200);
    const listed = await request('/api/quick-share/public');
    assert.equal((await listed.json() as { files: { code: string }[] }).files[0].code, code);
    const firstDownload = await request(`/api/quick-share/public/${code}`);
    assert.equal(await firstDownload.text(), '0123456789');
    assert.equal(await (await request(`/api/quick-share/public/${code}`)).text(), '0123456789');
    assert.equal((await request(`/api/quick-share/public/${code}`, { method: 'DELETE' })).status, 403);
    assert.equal((await request(`/api/quick-share/public/${code}`, { method: 'DELETE', headers: { 'x-quick-share-token': 'wrong' } })).status, 403);
    assert.equal((await request(`/api/quick-share/public/${code}`, { method: 'DELETE', headers: { 'x-quick-share-token': uploadToken } })).status, 200);
    assert.equal((await request(`/api/quick-share/public/${code}`)).status, 404);
    assert.deepEqual((await (await request('/api/quick-share/public')).json() as { files: unknown[] }).files, []);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise<void>(resolve => child.once('exit', () => resolve()));
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
