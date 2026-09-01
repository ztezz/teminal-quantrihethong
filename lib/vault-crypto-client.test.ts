import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptBackup, decryptVaultValue, deriveVaultKey, encryptBackup, encryptVaultValue, generatePassword, randomSalt } from './client/vault-crypto';

test('browser vault crypto authenticates context and backup passwords', async () => {
  const key = await deriveVaultKey('strong-vault-password', randomSalt(), 200_000);
  const encrypted = await encryptVaultValue({ password: 'secret' }, key, 'item:one:content');
  assert.deepEqual(await decryptVaultValue(encrypted, key, 'item:one:content'), { password: 'secret' });
  await assert.rejects(() => decryptVaultValue(encrypted, key, 'item:two:content'));
  const backup = await encryptBackup({ notes: ['one'] }, 'backup-password');
  assert.deepEqual(await decryptBackup(backup, 'backup-password'), { notes: ['one'] });
  await assert.rejects(() => decryptBackup(backup, 'wrong-password'));
});

test('password generator uses the requested length and allowed alphabet', () => {
  const generated = generatePassword(32, false);
  assert.equal(generated.length, 32);
  assert.match(generated, /^[A-HJ-NP-Za-km-z2-9]+$/);
});
