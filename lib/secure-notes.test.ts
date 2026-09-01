import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptNoteText, encryptNoteText, noteEncryptionKey } from './secure-notes';

test('secure notes encrypt and decrypt with authenticated context', () => {
  const key = noteEncryptionKey('a'.repeat(32));
  const encrypted = encryptNoteText('mat-khau-bi-mat', key, 'user-1:note-1:content');
  assert.equal(encrypted.includes('mat-khau-bi-mat'), false);
  assert.equal(decryptNoteText(encrypted, key, 'user-1:note-1:content'), 'mat-khau-bi-mat');
  assert.throws(() => decryptNoteText(encrypted, key, 'user-2:note-1:content'));
});

test('secure notes require a stable strong encryption key', () => {
  assert.throws(() => noteEncryptionKey('short'), /at least 32 characters/);
});
