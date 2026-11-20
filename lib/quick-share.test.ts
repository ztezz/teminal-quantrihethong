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

async function getFreePort(): Promise<number> {
  const listener = net.createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No free port');
  const port = address.port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  return port;
}

async function startBackend(options: {
  root: string;
  port: number;
  origin: string;
  rootPassword: string;
  extraEnv?: Record<string, string>;
}) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts', '--backend'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      BACKEND_PORT: String(options.port),
      FRONTEND_ORIGIN: options.origin,
      TERMINAL_PASSWORD: options.rootPassword,
      DATABASE_PATH: path.join(options.root, 'database.sqlite'),
      LEGACY_DATABASE_PATH: path.join(options.root, 'legacy.json'),
      QUICK_SHARE_DIR: path.join(options.root, 'shares'),
      JOB_DATA_DIR: path.join(options.root, 'jobs'),
      ...options.extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout?.on('data', data => { output += data.toString(); });
  child.stderr?.on('data', data => { output += data.toString(); });
  const baseUrl = `http://127.0.0.1:${options.port}`;
  let started = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) { started = true; break; }
    } catch { /* Still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(started, `Backend did not start: ${output}`);
  return {
    child,
    baseUrl,
    request(route: string, init: RequestInit = {}) {
      return fetch(`${baseUrl}${route}`, { ...init, headers: { origin: options.origin, ...init.headers } });
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await new Promise<void>(resolve => child.once('exit', () => resolve()));
      }
    }
  };
}

async function loginAs(
  request: (route: string, init?: RequestInit) => Promise<Response>,
  username: string,
  password: string
): Promise<string> {
  const response = await request('/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(response.status, 200, `Expected login success for ${username}`);
  const body = await response.json() as { success: boolean; token: string };
  assert.equal(body.success, true);
  assert.ok(body.token);
  return body.token;
}

test('admin open/lock quick-share controls enforce RBAC, gate all endpoints, persist across restart, and audit changes', { timeout: 60_000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-share-lock-test-'));
  const origin = 'http://127.0.0.1:3000';
  const rootPassword = 'root-test-password-987654';
  const userPassword = 'user-test-password-987654';
  let backend = await startBackend({ root, port: await getFreePort(), origin, rootPassword });

  try {
    const rootToken = await loginAs(backend.request, 'root', rootPassword);

    for (const [username, role] of [['viewer1', 'viewer'], ['operator1', 'operator'], ['admin1', 'admin']] as const) {
      const created = await backend.request('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${rootToken}` },
        body: JSON.stringify({ username, password: userPassword, role })
      });
      assert.equal(created.status, 201);
    }

    const viewerToken = await loginAs(backend.request, 'viewer1', userPassword);
    const operatorToken = await loginAs(backend.request, 'operator1', userPassword);
    const adminToken = await loginAs(backend.request, 'admin1', userPassword);

    // Default enabled: true + RBAC matrix on GET/POST /api/settings/quick-share
    assert.equal((await backend.request('/api/settings/quick-share')).status, 401);
    assert.equal((await backend.request('/api/settings/quick-share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) })).status, 401);

    for (const lowPrivToken of [viewerToken, operatorToken]) {
      assert.equal((await backend.request('/api/settings/quick-share', { headers: { authorization: `Bearer ${lowPrivToken}` } })).status, 403);
      assert.equal((await backend.request('/api/settings/quick-share', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${lowPrivToken}` },
        body: JSON.stringify({ enabled: false })
      })).status, 403);
    }

    const adminGetDefault = await backend.request('/api/settings/quick-share', {
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminGetDefault.status, 200);
    const adminSettings = await adminGetDefault.json() as Record<string, unknown>;
    assert.equal(adminSettings.success, true);
    assert.equal(adminSettings.enabled, true);
    assert.equal('directory' in adminSettings, false);
    assert.equal(adminSettings.activeFiles, 0);
    assert.equal(adminSettings.activeBytes, 0);

    const rootGetDefault = await backend.request('/api/settings/quick-share', {
      headers: { authorization: `Bearer ${rootToken}` }
    });
    assert.equal(rootGetDefault.status, 200);
    const rootSettings = await rootGetDefault.json() as Record<string, unknown>;
    assert.equal(rootSettings.success, true);
    assert.equal(rootSettings.enabled, true);
    assert.equal(rootSettings.directory, path.resolve(path.join(root, 'shares')));

    // Invalid payloads return 400
    assert.equal((await backend.request('/api/settings/quick-share', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({})
    })).status, 400);
    assert.equal((await backend.request('/api/settings/quick-share', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ enabled: 'yes' })
    })).status, 400);

    // Non-root admin cannot change directory, and atomic validation prevents partial enabled mutation
    const customDir = path.join(root, 'custom-shares');
    const adminDirAttempt = await backend.request('/api/settings/quick-share', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ enabled: false, directory: customDir })
    });
    assert.equal(adminDirAttempt.status, 403);
    const stillEnabledCheck = await (await backend.request('/api/settings/quick-share', {
      headers: { authorization: `Bearer ${adminToken}` }
    })).json() as { enabled: boolean };
    assert.equal(stillEnabledCheck.enabled, true);

    // Root invalid directory returns 400 and does not mutate enabled
    const rootInvalidDir = await backend.request('/api/settings/quick-share', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${rootToken}` },
      body: JSON.stringify({ enabled: false, directory: 'relative/shares' })
    });
    assert.equal(rootInvalidDir.status, 400);
    assert.equal(((await (await backend.request('/api/settings/quick-share', {
      headers: { authorization: `Bearer ${rootToken}` }
    })).json()) as { enabled: boolean }).enabled, true);

    // Root can update directory (and restore or use it)
    const rootValidDir = await backend.request('/api/settings/quick-share', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${rootToken}` },
      body: JSON.stringify({ directory: customDir })
    });
    assert.equal(rootValidDir.status, 200);
    const rootValidDirJson = await rootValidDir.json() as Record<string, unknown>;
    assert.equal(rootValidDirJson.directory, path.resolve(customDir));
    assert.equal(rootValidDirJson.enabled, true);

    // Upload 1: completed public file
    const pubInit = await backend.request('/api/quick-share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'public-note.txt', size: 11, public: true })
    });
    assert.equal(pubInit.status, 201);
    const { code: publicCode, uploadToken: publicUploadToken } = await pubInit.json() as { code: string; uploadToken: string };
    assert.equal((await backend.request(`/api/quick-share/${publicCode}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-quick-share-token': publicUploadToken, 'x-upload-offset': '0' },
      body: Buffer.from('hello-world')
    })).status, 200);
    assert.equal((await backend.request(`/api/quick-share/${publicCode}/complete`, {
      method: 'POST',
      headers: { 'x-quick-share-token': publicUploadToken }
    })).status, 200);

    // Upload 2: completed private 4-digit file
    const privInit = await backend.request('/api/quick-share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'secret.txt', size: 7, public: false })
    });
    assert.equal(privInit.status, 201);
    const { code: privateCode, uploadToken: privateUploadToken } = await privInit.json() as { code: string; uploadToken: string };
    assert.equal((await backend.request(`/api/quick-share/${privateCode}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-quick-share-token': privateUploadToken, 'x-upload-offset': '0' },
      body: Buffer.from('secrets')
    })).status, 200);
    assert.equal((await backend.request(`/api/quick-share/${privateCode}/complete`, {
      method: 'POST',
      headers: { 'x-quick-share-token': privateUploadToken }
    })).status, 200);

    // Upload 3: incomplete upload session
    const pendingInit = await backend.request('/api/quick-share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'partial.bin', size: 10, public: false })
    });
    assert.equal(pendingInit.status, 201);
    const { code: pendingCode, uploadToken: pendingUploadToken } = await pendingInit.json() as { code: string; uploadToken: string };
    assert.equal((await backend.request(`/api/quick-share/${pendingCode}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-quick-share-token': pendingUploadToken, 'x-upload-offset': '0' },
      body: Buffer.from('1234')
    })).status, 200);

    // Check activeFiles and activeBytes before lock
    const preLockSettings = await (await backend.request('/api/settings/quick-share', {
      headers: { authorization: `Bearer ${adminToken}` }
    })).json() as Record<string, unknown>;
    assert.equal(preLockSettings.activeFiles, 3);
    assert.equal(preLockSettings.activeBytes, 11 + 7 + 10);
    assert.equal('directory' in preLockSettings, false);

    // Lock as admin
    const lockResp = await backend.request('/api/settings/quick-share', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ enabled: false })
    });
    assert.equal(lockResp.status, 200);
    const lockJson = await lockResp.json() as Record<string, unknown>;
    assert.equal(lockJson.success, true);
    assert.equal(lockJson.enabled, false);
    assert.equal('directory' in lockJson, false);
    assert.equal(lockJson.activeFiles, 3);
    assert.equal(lockJson.activeBytes, 28);

    // Verify all 10 /api/quick-share* endpoints return 403 QUICK_SHARE_DISABLED
    const lockedChecks: Array<[string, RequestInit?]> = [
      ['/api/quick-share/public'],
      [`/api/quick-share/public/${publicCode}/info`],
      [`/api/quick-share/public/${publicCode}`],
      [`/api/quick-share/public/${publicCode}`, { method: 'DELETE', headers: { 'x-quick-share-token': publicUploadToken } }],
      ['/api/quick-share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'blocked.txt', size: 4, public: true }) }],
      [`/api/quick-share/${pendingCode}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-quick-share-token': pendingUploadToken, 'x-upload-offset': '4' }, body: Buffer.from('567890') }],
      [`/api/quick-share/${pendingCode}/complete`, { method: 'POST', headers: { 'x-quick-share-token': pendingUploadToken } }],
      [`/api/quick-share/${pendingCode}/upload`, { headers: { 'x-quick-share-token': pendingUploadToken } }],
      [`/api/quick-share/${privateCode}/status`],
      [`/api/quick-share/${privateCode}`]
    ];
    for (const [route, init] of lockedChecks) {
      const resp = await backend.request(route, init);
      assert.equal(resp.status, 403, `Expected 403 on ${init?.method || 'GET'} ${route}`);
      assert.equal(resp.headers.get('cache-control'), 'no-store');
      const payload = await resp.json() as { success: boolean; code: string; enabled: boolean; error: string };
      assert.equal(payload.success, false);
      assert.equal(payload.code, 'QUICK_SHARE_DISABLED');
      assert.equal(payload.enabled, false);
      assert.ok(payload.error.length > 0);
    }

    // Restart backend against the same SQLite DB while locked
    await backend.stop();
    backend = await startBackend({
      root,
      port: await getFreePort(),
      origin,
      rootPassword,
      extraEnv: { QUICK_SHARE_ENABLED: 'true' }
    });

    const afterRestartPublic = await backend.request('/api/quick-share/public');
    assert.equal(afterRestartPublic.status, 403);
    const afterRestartPayload = await afterRestartPublic.json() as { success: boolean; code: string; enabled: boolean };
    assert.equal(afterRestartPayload.success, false);
    assert.equal(afterRestartPayload.code, 'QUICK_SHARE_DISABLED');
    assert.equal(afterRestartPayload.enabled, false);

    const afterRestartSettings = await backend.request('/api/settings/quick-share', {
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(afterRestartSettings.status, 200);
    const afterRestartSettingsJson = await afterRestartSettings.json() as { enabled: boolean; activeFiles: number; activeBytes: number };
    assert.equal(afterRestartSettingsJson.enabled, false);
    assert.equal(afterRestartSettingsJson.activeFiles, 3);
    assert.equal(afterRestartSettingsJson.activeBytes, 28);

    // Re-enable as admin
    const unlockResp = await backend.request('/api/settings/quick-share', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ enabled: true })
    });
    assert.equal(unlockResp.status, 200);
    assert.equal(((await unlockResp.json()) as { enabled: boolean }).enabled, true);

    // Public list includes enabled: true and the previously uploaded public file
    const unlockedPublic = await backend.request('/api/quick-share/public');
    assert.equal(unlockedPublic.status, 200);
    const unlockedPublicJson = await unlockedPublic.json() as { success: boolean; enabled: boolean; files: Array<{ code: string; name: string }> };
    assert.equal(unlockedPublicJson.success, true);
    assert.equal(unlockedPublicJson.enabled, true);
    assert.equal(unlockedPublicJson.files.length, 1);
    assert.equal(unlockedPublicJson.files[0].code, publicCode);
    assert.equal(unlockedPublicJson.files[0].name, 'public-note.txt');

    // Previously uploaded public & private files remain accessible
    const publicDownload = await backend.request(`/api/quick-share/public/${publicCode}`);
    assert.equal(publicDownload.status, 200);
    assert.equal(await publicDownload.text(), 'hello-world');

    assert.equal((await backend.request(`/api/quick-share/${privateCode}/status`)).status, 200);
    const privateDownload = await backend.request(`/api/quick-share/${privateCode}`);
    assert.equal(privateDownload.status, 200);
    assert.equal(await privateDownload.text(), 'secrets');

    // New uploads work after re-enabling
    const newInit = await backend.request('/api/quick-share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'after-unlock.txt', size: 4, public: true })
    });
    assert.equal(newInit.status, 201);
    const { code: newCode, uploadToken: newToken } = await newInit.json() as { code: string; uploadToken: string };
    assert.equal((await backend.request(`/api/quick-share/${newCode}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream', 'x-quick-share-token': newToken, 'x-upload-offset': '0' },
      body: Buffer.from('done')
    })).status, 200);
    assert.equal((await backend.request(`/api/quick-share/${newCode}/complete`, {
      method: 'POST',
      headers: { 'x-quick-share-token': newToken }
    })).status, 200);

    // Audit log check
    const logsResp = await backend.request('/api/logs?category=quick_share', {
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(logsResp.status, 200);
    const logsJson = await logsResp.json() as {
      success: boolean;
      logs: Array<{ action: string; level: string; metadata?: Record<string, unknown> }>;
    };
    assert.equal(logsJson.success, true);
    const disableEvent = logsJson.logs.find(entry => entry.action === 'disable');
    const enableEvent = logsJson.logs.find(entry => entry.action === 'enable');
    assert.ok(disableEvent, 'Expected critical disable audit event');
    assert.equal(disableEvent.level, 'critical');
    assert.equal(disableEvent.metadata?.enabled, false);
    assert.equal(disableEvent.metadata?.username, 'admin1');
    assert.ok(enableEvent, 'Expected critical enable audit event');
    assert.equal(enableEvent.level, 'critical');
    assert.equal(enableEvent.metadata?.enabled, true);
    assert.equal(enableEvent.metadata?.username, 'admin1');
  } finally {
    await backend.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
