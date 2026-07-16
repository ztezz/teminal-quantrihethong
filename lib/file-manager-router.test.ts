import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import express from 'express';
import { createFileManagerRouter } from './file-manager-router';

type Role = 'viewer' | 'operator' | 'admin' | 'root';

async function fixture() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'file-manager-router-'));
  const root = path.join(temporaryDirectory, 'root');
  const trash = path.join(temporaryDirectory, 'trash');
  const snapshots = path.join(temporaryDirectory, 'snapshots');
  fs.mkdirSync(root);
  let role: Role = 'root';
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    next();
  });
  app.use(express.json({ limit: '3mb' }));
  app.use('/api/files', createFileManagerRouter({
    rootDir: root,
    trashDir: trash,
    snapshotDir: snapshots,
    hasSession: token => token === 'valid-token',
    sessionRole: token => token === 'valid-token' ? role : null,
    hasStepUp: () => true,
    consumePreviewTicket: () => false,
    log: async () => undefined,
    previewFrameAncestor: 'https://terminal.example.com'
  }));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  const request = async (route: string, init?: RequestInit, authenticated = true) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/files${route}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(authenticated ? { cookie: 'terminal_session=valid-token' } : {}),
        ...init?.headers
      }
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';
    return { status: response.status, headers: response.headers, body: text ? contentType.includes('application/json') ? JSON.parse(text) : text : null };
  };
  return {
    root,
    trash,
    request,
    setRole: (value: Role) => { role = value; },
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  };
}

function createSymlinkOrSkip(t: TestContext, target: string, link: string) {
  try {
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'file' : undefined);
    return true;
  } catch (error: any) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) {
      t.skip(`Symlink creation is not permitted on this system (${error.code})`);
      return false;
    }
    throw error;
  }
}

test('rejects unauthenticated requests', async () => {
  const context = await fixture();
  try {
    const response = await context.request('/', undefined, false);
    assert.equal(response.status, 401);
    assert.equal(response.body.code, 'UNAUTHORIZED');
  } finally { await context.close(); }
});

test('viewer can list and read files but cannot mutate them', async () => {
  const context = await fixture();
  try {
    fs.writeFileSync(path.join(context.root, 'visible.txt'), 'viewer content');
    context.setRole('viewer');

    const listed = await context.request('/');
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.files.map((file: { name: string }) => file.name), ['visible.txt']);

    const read = await context.request('/read?path=visible.txt');
    assert.equal(read.status, 200);
    assert.equal(read.body.content, 'viewer content');

    const create = await context.request('/create', { method: 'POST', body: JSON.stringify({ dirPath: '', name: 'blocked.txt' }) });
    assert.equal(create.status, 403);
    assert.equal(create.body.code, 'READ_ONLY');
    assert.equal(fs.existsSync(path.join(context.root, 'blocked.txt')), false);
  } finally { await context.close(); }
});

test('media preview permits framing only from the configured frontend origin', async () => {
  const context = await fixture();
  try {
    fs.writeFileSync(path.join(context.root, 'document.pdf'), '%PDF-1.4\n%%EOF');
    const response = await context.request('/media?path=document.pdf');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-frame-options'), null);
    assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors https://terminal.example.com");
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(response.headers.get('content-type'), 'application/pdf');
  } finally { await context.close(); }
});

test('media preview serves AVIF with the correct MIME type', async () => {
  const context = await fixture();
  try {
    fs.writeFileSync(path.join(context.root, 'sample.avif'), Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 97, 118, 105, 102]));
    const response = await context.request('/media?path=sample.avif');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/avif');
    assert.equal(response.headers.get('content-disposition'), "inline; filename*=UTF-8''sample.avif");
  } finally { await context.close(); }
});

test('media preview supports bounded byte ranges for video seeking', async () => {
  const context = await fixture();
  try {
    fs.writeFileSync(path.join(context.root, 'clip.mp4'), Buffer.from('0123456789'));
    const response = await context.request('/media?path=clip.mp4', { headers: { range: 'bytes=2-5' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(response.headers.get('content-length'), '4');
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.body, '2345');
  } finally { await context.close(); }
});

test('rejects path traversal outside the managed root', async () => {
  const context = await fixture();
  try {
    const response = await context.request(`/read?path=${encodeURIComponent('../outside.txt')}`);
    assert.equal(response.status, 403);
  } finally { await context.close(); }
});

test('rejects a symlink resolving outside the managed root', async t => {
  const context = await fixture();
  try {
    const outside = path.join(path.dirname(context.root), 'outside.txt');
    fs.writeFileSync(outside, 'secret');
    if (!createSymlinkOrSkip(t, outside, path.join(context.root, 'outside-link.txt'))) return;

    const response = await context.request('/read?path=outside-link.txt');
    assert.equal(response.status, 403);
  } finally { await context.close(); }
});

test('supports create, write, move, and trash flow', async () => {
  const context = await fixture();
  try {
    const created = await context.request('/create', { method: 'POST', body: JSON.stringify({ dirPath: '', name: 'draft.txt' }) });
    assert.equal(created.status, 201);

    const written = await context.request('/write', { method: 'POST', body: JSON.stringify({ filePath: 'draft.txt', content: 'finished', expectedMtime: created.body.mtime }) });
    assert.equal(written.status, 200);
    assert.equal(fs.readFileSync(path.join(context.root, 'draft.txt'), 'utf8'), 'finished');

    assert.equal((await context.request('/mkdir', { method: 'POST', body: JSON.stringify({ dirPath: '', name: 'documents' }) })).status, 201);
    const moved = await context.request('/move', { method: 'POST', body: JSON.stringify({ sourcePath: 'draft.txt', destinationDir: 'documents', newName: 'final.txt' }) });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.path, 'documents/final.txt');

    const trashed = await context.request(`/?path=${encodeURIComponent('documents/final.txt')}`, { method: 'DELETE' });
    assert.equal(trashed.status, 200);
    assert.equal(fs.existsSync(path.join(context.root, 'documents', 'final.txt')), false);
    assert.equal(fs.existsSync(path.join(context.trash, trashed.body.id)), true);
  } finally { await context.close(); }
});

test('archive creation rejects a destination inside its source', async () => {
  const context = await fixture();
  try {
    fs.mkdirSync(path.join(context.root, 'source'));
    fs.writeFileSync(path.join(context.root, 'source', 'file.txt'), 'safe');
    const response = await context.request('/archive/create', { method: 'POST', body: JSON.stringify({ paths: ['source'], destinationDir: 'source', name: 'nested.zip', format: 'zip' }) });
    assert.equal(response.status, 400);
    assert.equal(fs.existsSync(path.join(context.root, 'source', 'nested.zip')), false);
  } finally { await context.close(); }
});

test('archive creation rejects symlinks', async t => {
  const context = await fixture();
  try {
    fs.mkdirSync(path.join(context.root, 'source'));
    const target = path.join(context.root, 'target.txt');
    fs.writeFileSync(target, 'target');
    if (!createSymlinkOrSkip(t, target, path.join(context.root, 'source', 'link.txt'))) return;

    const response = await context.request('/archive/create', { method: 'POST', body: JSON.stringify({ paths: ['source'], destinationDir: '', name: 'links.zip', format: 'zip' }) });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /symbolic link/i);
    assert.equal(fs.existsSync(path.join(context.root, 'links.zip')), false);
  } finally { await context.close(); }
});

test('archive creation succeeds for a small safe source', async () => {
  const context = await fixture();
  try {
    fs.mkdirSync(path.join(context.root, 'safe'));
    fs.writeFileSync(path.join(context.root, 'safe', 'hello.txt'), 'hello archive');
    const response = await context.request('/archive/create', { method: 'POST', body: JSON.stringify({ paths: ['safe'], destinationDir: '', name: 'safe.zip', format: 'zip' }) });
    assert.equal(response.status, 201);
    assert.equal(response.body.path, 'safe.zip');
    const archive = fs.readFileSync(path.join(context.root, 'safe.zip'));
    assert.equal(archive.subarray(0, 2).toString('ascii'), 'PK');
    assert.ok(archive.length > 20);
  } finally { await context.close(); }
});
