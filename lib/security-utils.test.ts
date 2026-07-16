import assert from 'node:assert/strict';
import test from 'node:test';
import { ARCHIVE_LIMITS, accountArchiveSourceEntry, escapeCsvCell, publicApiUrl, validateArchivePlan, validateRuntimeConfig } from './security-utils';

test('publicApiUrl defaults to same-origin and normalizes an absolute URL', () => {
  assert.equal(publicApiUrl(undefined), '');
  assert.equal(publicApiUrl('  https://api.example.com/  '), 'https://api.example.com');
});

test('publicApiUrl rejects unsafe or ambiguous values', () => {
  assert.throws(() => publicApiUrl('/api'));
  assert.throws(() => publicApiUrl('javascript:alert(1)'));
  assert.throws(() => publicApiUrl('https://user:password@example.com'));
  assert.throws(() => publicApiUrl('https://api.example.com?target=other'));
});

test('escapeCsvCell quotes values and neutralizes spreadsheet formulas', () => {
  assert.equal(escapeCsvCell('normal "value"'), '"normal ""value"""');
  assert.equal(escapeCsvCell('=HYPERLINK("https://example.com")'), '"\'=HYPERLINK(""https://example.com"")"');
  assert.equal(escapeCsvCell('  +1+1'), '"\'  +1+1"');
});

test('validateArchivePlan accepts a bounded safe archive', () => {
  assert.deepEqual(validateArchivePlan([
    { path: 'folder/file.txt', compressedSize: 50, uncompressedSize: 100 }
  ]), ['folder/file.txt']);
});

test('validateArchivePlan rejects traversal, oversized files, and suspicious ratios', () => {
  assert.throws(() => validateArchivePlan([{ path: '../secret', compressedSize: 1, uncompressedSize: 1 }]), /không an toàn/);
  assert.throws(() => validateArchivePlan([{ path: 'large.bin', compressedSize: 1_000_000, uncompressedSize: ARCHIVE_LIMITS.maxFileSize + 1 }]), /vượt quá/);
  assert.throws(() => validateArchivePlan([{ path: 'bomb.txt', compressedSize: 1, uncompressedSize: ARCHIVE_LIMITS.maxCompressionRatio + 1 }]), /Tỷ lệ nén/);
});

test('validateArchivePlan enforces entry and total-size limits', () => {
  const entries = Array.from({ length: ARCHIVE_LIMITS.maxEntries + 1 }, (_, index) => ({ path: `${index}.txt`, compressedSize: 1, uncompressedSize: 1 }));
  assert.throws(() => validateArchivePlan(entries), /vượt quá/);
  assert.throws(() => validateArchivePlan([
    { path: 'a.bin', compressedSize: ARCHIVE_LIMITS.maxFileSize, uncompressedSize: ARCHIVE_LIMITS.maxFileSize },
    { path: 'b.bin', compressedSize: ARCHIVE_LIMITS.maxFileSize, uncompressedSize: ARCHIVE_LIMITS.maxFileSize },
    { path: 'c.bin', compressedSize: ARCHIVE_LIMITS.maxFileSize, uncompressedSize: ARCHIVE_LIMITS.maxFileSize },
    { path: 'd.bin', compressedSize: ARCHIVE_LIMITS.maxFileSize, uncompressedSize: ARCHIVE_LIMITS.maxFileSize },
    { path: 'e.bin', compressedSize: ARCHIVE_LIMITS.maxFileSize, uncompressedSize: ARCHIVE_LIMITS.maxFileSize },
    { path: 'f.bin', compressedSize: ARCHIVE_LIMITS.maxFileSize, uncompressedSize: ARCHIVE_LIMITS.maxFileSize }
  ]), /sau giải nén/);
});

test('accountArchiveSourceEntry accounts bounded files and directories', () => {
  const directory = accountArchiveSourceEntry({ entries: 0, totalSize: 0 }, { path: 'folder', type: 'directory', size: 4096, depth: 0 });
  assert.deepEqual(accountArchiveSourceEntry(directory, { path: 'folder/file.txt', type: 'file', size: 123, depth: 1 }), { entries: 2, totalSize: 123 });
});

test('accountArchiveSourceEntry rejects symlinks and excessive depth', () => {
  assert.throws(() => accountArchiveSourceEntry({ entries: 0, totalSize: 0 }, { path: 'link', type: 'symlink', size: 1, depth: 0 }), Object.assign(/symbolic link/, { status: 400 }));
  assert.throws(() => accountArchiveSourceEntry({ entries: 0, totalSize: 0 }, { path: 'deep/file', type: 'file', size: 1, depth: ARCHIVE_LIMITS.maxDepth + 1 }), /độ sâu/);
});

test('accountArchiveSourceEntry enforces entry, file, and total source limits', () => {
  assert.throws(() => accountArchiveSourceEntry({ entries: ARCHIVE_LIMITS.maxEntries, totalSize: 0 }, { path: 'extra', type: 'directory', size: 0, depth: 0 }), /mục/);
  assert.throws(() => accountArchiveSourceEntry({ entries: 0, totalSize: 0 }, { path: 'large.bin', type: 'file', size: ARCHIVE_LIMITS.maxFileSize + 1, depth: 0 }), /Tệp nguồn/);
  assert.throws(() => accountArchiveSourceEntry({ entries: 1, totalSize: ARCHIVE_LIMITS.maxTotalSize }, { path: 'extra.bin', type: 'file', size: 1, depth: 0 }), /Nguồn archive/);
});

test('validateRuntimeConfig normalizes a secure production origin', () => {
  assert.deepEqual(validateRuntimeConfig({ frontendOrigin: 'https://ssh.luugame.fun/', encryptionKey: 'x'.repeat(32), terminalPassword: 'strong-password-value', production: true, backendOnly: true }), { frontendOrigin: 'https://ssh.luugame.fun' });
});

test('validateRuntimeConfig rejects unsafe production configuration', () => {
  assert.throws(() => validateRuntimeConfig({ frontendOrigin: 'http://ssh.luugame.fun', encryptionKey: 'x'.repeat(32), production: true, backendOnly: true }), /HTTPS/);
  assert.throws(() => validateRuntimeConfig({ frontendOrigin: 'https://ssh.luugame.fun/path', encryptionKey: 'x'.repeat(32), production: true, backendOnly: true }), /scheme, host và port/);
  assert.throws(() => validateRuntimeConfig({ frontendOrigin: 'https://ssh.luugame.fun', encryptionKey: 'short', production: true, backendOnly: true }), /AUTH_ENCRYPTION_KEY/);
  assert.throws(() => validateRuntimeConfig({ frontendOrigin: 'https://ssh.luugame.fun', encryptionKey: 'x'.repeat(32), terminalPassword: 'admin', production: true, backendOnly: true }), /TERMINAL_PASSWORD/);
});
