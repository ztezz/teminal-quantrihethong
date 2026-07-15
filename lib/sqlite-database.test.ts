import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SqliteDatabase, type StoredUser } from './sqlite-database';

const rootUser: StoredUser = {
  id: 'root',
  username: 'root',
  passwordHash: '$argon2id$test',
  role: 'root',
  enabled: true,
  createdAt: 1
};

test('SQLite persists users, settings, sessions, and audit records', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-sqlite-'));
  const filename = path.join(directory, 'database.sqlite');
  try {
    let database = new SqliteDatabase(filename, undefined, 60_000);
    assert.equal(database.ping(), true);
    database.saveUser(rootUser);
    await database.run('INSERT INTO settings (key, value) VALUES (?, ?)', 'key', 'value');
    database.addSession('raw-token', rootUser.id, '127.0.0.1', 'test-agent');
    database.addAudit({ category: 'test', action: 'persist', event: 'Persisted', level: 'info', result: 'success', ip: '127.0.0.1' });
    database.close();

    database = new SqliteDatabase(filename, undefined, 60_000);
    assert.equal(database.getUserByName('ROOT')?.id, rootUser.id);
    assert.equal((await database.get('SELECT value FROM settings WHERE key = ?', 'key'))?.value, 'value');
    assert.equal(database.hasSession('raw-token'), true);
    assert.equal(database.queryAudit({ offset: 0, limit: 10 }).total, 1);
    assert.deepEqual(database.verifyAuditIntegrity(), { valid: true, checked: 1 });
    database.deleteUser(rootUser.id);
    assert.equal(database.getSessions().length, 0, 'foreign key cascade removes user sessions');
    database.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite migrates legacy JSON transactionally and creates a backup', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-migration-'));
  const filename = path.join(directory, 'database.sqlite');
  const legacyFile = path.join(directory, 'terminal_database.json');
  fs.writeFileSync(legacyFile, JSON.stringify({
    settings: { password_hash: '$argon2id$legacy' },
    terminal_settings: { font_size: '16' },
    users: [rootUser],
    sessions: [],
    logs: [{ id: 1, category: 'legacy', action: 'event', event: 'Imported', level: 'info', result: 'success', ip: '127.0.0.1', timestamp: '2026-01-01T00:00:00.000Z', previousHash: '', hash: '' }]
  }));
  try {
    const database = new SqliteDatabase(filename, legacyFile);
    assert.equal(database.getUsers().length, 1);
    assert.equal((await database.get('SELECT value FROM settings WHERE key = ?', 'password_hash'))?.value, '$argon2id$legacy');
    assert.equal((await database.get('SELECT value FROM terminal_settings WHERE key = ?', 'font_size'))?.value, '16');
    assert.equal(database.queryAudit({ offset: 0, limit: 10 }).total, 1);
    assert.equal(fs.existsSync(legacyFile), false);
    assert.equal(fs.readdirSync(directory).filter(name => name.startsWith('terminal_database.json.migrated-') && name.endsWith('.bak')).length, 1);
    database.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite refuses malformed legacy JSON without renaming it', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-migration-invalid-'));
  const filename = path.join(directory, 'database.sqlite');
  const legacyFile = path.join(directory, 'terminal_database.json');
  fs.writeFileSync(legacyFile, '{invalid');
  try {
    assert.throws(() => new SqliteDatabase(filename, legacyFile), /Cannot migrate legacy database/);
    assert.equal(fs.existsSync(legacyFile), true);
    assert.equal(fs.existsSync(filename), false, 'failed first migration removes the empty SQLite database');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('audit pruning rebuilds the retained chain transactionally and preserves increasing ids', async () => {
  const database = new SqliteDatabase(':memory:');
  for (let index = 0; index < 5; index++) database.addAudit({ category: 'test', action: String(index), event: `Event ${index}`, level: 'info', result: 'success', ip: '127.0.0.1' });
  const result = database.pruneAudit({ retentionDays: 0, maxEntries: 3 });
  assert.deepEqual(result, { pruned: 2, retained: 3 });
  assert.deepEqual(database.verifyAuditIntegrity(), { valid: true, checked: 3 });
  assert.deepEqual(database.queryAudit({ offset: 0, limit: 10 }).items.map(entry => entry.id), [5, 4, 3]);
  database.addAudit({ category: 'test', action: 'next', event: 'Next', level: 'info', result: 'success', ip: '127.0.0.1' });
  assert.equal(database.queryAudit({ offset: 0, limit: 1 }).items[0].id, 6);
  database.close();
});

test('audit HMAC detects legacy hashes and rebuilds them during retention', () => {
  const database = new SqliteDatabase(':memory:');
  database.addAudit({ category: 'test', action: 'legacy', event: 'Legacy', level: 'info', result: 'success', ip: '127.0.0.1' });
  const rows = database.queryAudit({ offset: 0, limit: 10 }).items;
  database.close();

  const keyed = new SqliteDatabase(':memory:', undefined, 60_000, 'k'.repeat(32));
  const entry = rows[0];
  keyed.run('INSERT INTO audit_logs (id, category, action, event, level, result, ip, session_id, metadata, timestamp, previous_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', entry.id, entry.category, entry.action, entry.event, entry.level, entry.result, entry.ip, null, null, entry.timestamp, entry.previousHash, entry.hash);
  assert.deepEqual(keyed.verifyAuditIntegrity(), { valid: true, checked: 1, legacyUnkeyed: 1 });
  keyed.pruneAudit({ retentionDays: 0, maxEntries: 0 });
  assert.deepEqual(keyed.verifyAuditIntegrity(), { valid: true, checked: 1, legacyUnkeyed: 0 });
  keyed.close();
});

test('audit retention applies age and count limits and refuses a broken chain', async () => {
  const database = new SqliteDatabase(':memory:');
  for (let index = 0; index < 4; index++) database.addAudit({ category: 'test', action: String(index), event: `Event ${index}`, level: 'info', result: 'success', ip: '127.0.0.1' });
  await database.run('UPDATE audit_logs SET timestamp = ? WHERE id <= 2', '2020-01-01T00:00:00.000Z');
  assert.throws(() => database.pruneAudit({ retentionDays: 30, maxEntries: 1, now: new Date('2026-07-15T00:00:00.000Z') }), /invalid audit chain/);

  database.close();
  const valid = new SqliteDatabase(':memory:');
  for (let index = 0; index < 4; index++) valid.addAudit({ category: 'test', action: String(index), event: `Event ${index}`, level: 'info', result: 'success', ip: '127.0.0.1' });
  assert.deepEqual(valid.pruneAudit({ retentionDays: 1, maxEntries: 0, now: new Date('2030-01-01T00:00:00.000Z') }), { pruned: 4, retained: 0 });
  assert.deepEqual(valid.verifyAuditIntegrity(), { valid: true, checked: 0 });
  valid.close();
});
