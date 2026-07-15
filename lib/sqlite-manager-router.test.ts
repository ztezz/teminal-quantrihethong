import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import express from 'express';
import { createSqliteManagerRouter } from './sqlite-manager-router';

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-manager-'));
  const filename = path.join(root, 'sample.sqlite');
  const database = new DatabaseSync(filename);
  database.exec("CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score INTEGER); INSERT INTO people (name, score) VALUES ('Ada', 10), ('Grace', 20), ('Alan', 15); CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('first')");
  database.close();
  let role: 'admin' | 'root' = 'root';
  let stepUp = true;
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/sqlite', createSqliteManagerRouter({
    rootDir: root,
    browserRoot: root,
    authorize: (_req, res, minimum) => role === 'root' || minimum === 'admin' ? true : (res.status(403).json({ success: false }), false),
    hasStepUp: () => stepUp,
    log: () => undefined
  }));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  const request = async (route: string, init?: RequestInit) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/sqlite${route}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  return { root, filename, request, setRole: (value: 'admin' | 'root') => { role = value; }, setStepUp: (value: boolean) => { stepUp = value; }, close: async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('rows support bounded filtering, sorting, pagination, and primary-key mutations', async () => {
  const context = await fixture();
  try {
    const page = await context.request('/rows?path=sample.sqlite&table=people&limit=1&offset=0&sort=score&order=desc&filter=' + encodeURIComponent(JSON.stringify([{ column: 'name', operator: 'contains', value: 'a' }])));
    assert.equal(page.status, 200);
    assert.equal(page.body.total, 3);
    assert.equal(page.body.hasMore, true);
    assert.equal(page.body.rows[0].name, 'Grace');
    assert.deepEqual(page.body.identity, { kind: 'primaryKey', columns: ['id'] });
    assert.deepEqual(page.body.rowIdentities[0], { id: 2 });

    const searched = await context.request('/rows?path=sample.sqlite&table=people&q=Grace');
    assert.equal(searched.status, 200);
    assert.equal(searched.body.total, 1);
    assert.equal(searched.body.rows[0].name, 'Grace');

    const updated = await context.request('/rows', { method: 'PATCH', body: JSON.stringify({ path: 'sample.sqlite', table: 'people', identity: { id: 2 }, values: { score: 25 } }) });
    assert.equal(updated.status, 200);
    const deleted = await context.request('/rows', { method: 'DELETE', body: JSON.stringify({ path: 'sample.sqlite', table: 'people', identity: { id: 1 } }) });
    assert.equal(deleted.status, 200);
    const inserted = await context.request('/rows', { method: 'POST', body: JSON.stringify({ path: 'sample.sqlite', table: 'people', values: { name: 'Edsger', score: 30 } }) });
    assert.equal(inserted.status, 201);
  } finally { await context.close(); }
});

test('rowid fallback is explicit and schema operations enforce root and step-up', async () => {
  const context = await fixture();
  try {
    const rows = await context.request('/rows?path=sample.sqlite&table=notes');
    assert.deepEqual(rows.body.identity, { kind: 'rowid', columns: ['rowid'] });
    assert.deepEqual(rows.body.rowIdentities, [{ rowid: 1 }]);
    assert.equal('__terminal_rowid' in rows.body.rows[0], false);

    context.setRole('admin');
    const forbidden = await context.request('/schema/tables', { method: 'DELETE', body: JSON.stringify({ path: 'sample.sqlite', table: 'notes' }) });
    assert.equal(forbidden.status, 403);
    context.setRole('root');
    context.setStepUp(false);
    const stepUp = await context.request('/schema/tables', { method: 'DELETE', body: JSON.stringify({ path: 'sample.sqlite', table: 'notes' }) });
    assert.equal(stepUp.status, 428);
    context.setStepUp(true);
    const invalidType = await context.request('/schema/columns', { method: 'POST', body: JSON.stringify({ path: 'sample.sqlite', table: 'notes', column: { name: 'unsafe', type: 'TEXT); DROP TABLE notes;--' } }) });
    assert.equal(invalidType.status, 400);
  } finally { await context.close(); }
});

test('backup files are isolated from scans and can be created and listed', async () => {
  const context = await fixture();
  try {
    const created = await context.request('/backups', { method: 'POST', body: JSON.stringify({ path: 'sample.sqlite', name: 'manual.sqlite' }) });
    assert.equal(created.status, 201);
    assert.equal(fs.existsSync(path.join(context.root, '.terminal-sqlite-backups', 'manual.sqlite')), true);
    const listed = await context.request('/backups');
    assert.deepEqual(listed.body.backups.map((item: { name: string }) => item.name), ['manual.sqlite']);
    const databases = await context.request('/');
    assert.deepEqual(databases.body.databases.map((item: { path: string }) => item.path), ['sample.sqlite']);
    const escaped = await context.request('/backups', { method: 'POST', body: JSON.stringify({ path: 'sample.sqlite', name: '../escape.sqlite' }) });
    assert.equal(escaped.status, 400);
  } finally { await context.close(); }
});

test('filesystem browser lists directories and valid SQLite files only', async () => {
  const context = await fixture();
  try {
    fs.mkdirSync(path.join(context.root, 'nested'));
    fs.writeFileSync(path.join(context.root, 'fake.sqlite'), 'not sqlite');
    fs.writeFileSync(path.join(context.root, 'notes.txt'), 'text');
    const browsed = await context.request('/browse');
    assert.equal(browsed.status, 200);
    assert.deepEqual(browsed.body.items.map((item: { name: string }) => item.name), ['nested', 'sample.sqlite']);
    assert.equal(browsed.body.items.find((item: { name: string }) => item.name === 'sample.sqlite').type, 'database');
    const escaped = await context.request(`/browse?path=${encodeURIComponent(path.dirname(context.root))}`);
    assert.equal(escaped.status, 403);
  } finally { await context.close(); }
});

test('schema endpoint opens an existing database by absolute browser path', async () => {
  const context = await fixture();
  try {
    const opened = await context.request(`/schema?path=${encodeURIComponent(context.filename)}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.integrity, 'ok');
    assert.equal(opened.body.objects.some((item: { name: string }) => item.name === 'people'), true);
  } finally { await context.close(); }
});

test('opened database registry persists absolute paths in the database list', async () => {
  const context = await fixture();
  try {
    const nestedDirectory = path.join(context.root, 'external');
    fs.mkdirSync(nestedDirectory);
    const external = path.join(nestedDirectory, 'external.sqlite');
    const database = new DatabaseSync(external);
    database.exec('CREATE TABLE saved (id INTEGER PRIMARY KEY)');
    database.close();
    const registered = await context.request('/opened', { method: 'POST', body: JSON.stringify({ path: external }) });
    assert.equal(registered.status, 201);
    const registeredAgain = await context.request('/opened', { method: 'POST', body: JSON.stringify({ path: external }) });
    assert.equal(registeredAgain.status, 201);
    const listed = await context.request('/');
    assert.equal(listed.body.databases.some((item: { path: string }) => path.resolve(context.root, item.path) === external), true);
    assert.equal(listed.body.databases.filter((item: { path: string }) => path.resolve(context.root, item.path) === external).length, 1);
    assert.equal(fs.existsSync(path.join(context.root, '.terminal-sqlite-backups', 'opened-databases.json')), true);
  } finally { await context.close(); }
});
