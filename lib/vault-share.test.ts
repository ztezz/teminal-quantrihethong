import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { generateSharedTotp, readSharedTotp } from './vault-share';
import { SqliteDatabase, type StoredUser } from './sqlite-database';

function encrypt(value: unknown, key: Buffer, context: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]);
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}`;
}

test('shared TOTP reads authenticated vault data and produces the current code', () => {
  const key = crypto.randomBytes(32);
  const id = crypto.randomUUID();
  const item = {
    id,
    envelope: encrypt({ title: 'Example', type: 'totp' }, key, `item:${id}:envelope`),
    content: encrypt({ totp: { secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', account: 'alice', algorithm: 'SHA1', digits: 8, period: 30 } }, key, `item:${id}:content`),
  };
  const config = readSharedTotp(item, key.toString('base64url'));
  assert.equal(config.title, 'Example');
  assert.equal(config.account, 'alice');
  assert.equal(generateSharedTotp(config, 59_000), '94287082');
  assert.throws(() => readSharedTotp({ ...item, id: crypto.randomUUID() }, key.toString('base64url')));
});

test('vault share token lookup, expiry, revocation, and item deletion', () => {
  const db = new SqliteDatabase(':memory:');
  const user: StoredUser = { id: 'owner', username: 'owner', passwordHash: 'test', role: 'root', enabled: true, createdAt: 1 };
  db.saveUser(user);
  db.createVaultItem({ id: 'item', userId: user.id, envelope: 'cipher', content: 'cipher', version: 1, pinned: false, createdAt: '', updatedAt: '' });
  const share = { id: 'share', userId: user.id, itemId: 'item', tokenHash: crypto.createHash('sha256').update('secret-token').digest('hex'), createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
  db.createVaultShare(share);
  assert.equal(db.getVaultShareByTokenHash(share.tokenHash)?.id, share.id);
  assert.equal(db.listVaultShares(user.id, 'item').length, 1);
  assert.equal(db.revokeVaultShare('other', 'item', share.id), false);
  assert.equal(db.revokeVaultShare(user.id, 'item', share.id), true);
  assert.equal(db.getVaultShareByTokenHash(share.tokenHash), undefined);
  db.createVaultShare({ ...share, id: 'expired', expiresAt: Date.now() - 1 });
  assert.equal(db.getVaultShareByTokenHash(share.tokenHash), undefined);
  assert.equal(db.pruneVaultShares(), 1);
  db.createVaultShare(share);
  db.trashVaultItem(user.id, 'item');
  db.purgeVaultItem(user.id, 'item');
  assert.equal(db.getVaultShareByTokenHash(share.tokenHash), undefined);
  db.close();
});
