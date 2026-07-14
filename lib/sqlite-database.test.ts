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
