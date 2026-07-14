import assert from 'node:assert/strict';
import test from 'node:test';
import { ARCHIVE_LIMITS, escapeCsvCell, publicApiUrl, validateArchivePlan } from './security-utils';

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
