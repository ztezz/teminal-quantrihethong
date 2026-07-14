export const ARCHIVE_LIMITS = {
  maxEntries: 1_000,
  maxFileSize: 100 * 1024 * 1024,
  maxTotalSize: 512 * 1024 * 1024,
  maxCompressionRatio: 100
} as const;

type ArchiveEntryMetadata = { path: string; compressedSize: number; uncompressedSize: number };

export function validateArchivePlan(entries: ArchiveEntryMetadata[]): string[] {
  if (entries.length > ARCHIVE_LIMITS.maxEntries) throw Object.assign(new Error(`ZIP vượt quá ${ARCHIVE_LIMITS.maxEntries} mục`), { status: 413 });
  let declaredTotal = 0;
  return entries.map(entry => {
    const normalized = entry.path.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) throw Object.assign(new Error(`ZIP chứa đường dẫn không an toàn: ${entry.path}`), { status: 400 });
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || !Number.isSafeInteger(entry.compressedSize) || entry.compressedSize < 0) throw Object.assign(new Error('ZIP có metadata dung lượng không hợp lệ'), { status: 400 });
    if (entry.uncompressedSize > ARCHIVE_LIMITS.maxFileSize) throw Object.assign(new Error(`Tệp trong ZIP vượt quá ${ARCHIVE_LIMITS.maxFileSize / 1024 / 1024}MB: ${entry.path}`), { status: 413 });
    declaredTotal += entry.uncompressedSize;
    if (declaredTotal > ARCHIVE_LIMITS.maxTotalSize) throw Object.assign(new Error(`ZIP vượt quá ${ARCHIVE_LIMITS.maxTotalSize / 1024 / 1024}MB sau giải nén`), { status: 413 });
    if (entry.compressedSize === 0 ? entry.uncompressedSize > 0 : entry.uncompressedSize / entry.compressedSize > ARCHIVE_LIMITS.maxCompressionRatio) throw Object.assign(new Error(`Tỷ lệ nén không an toàn: ${entry.path}`), { status: 413 });
    return normalized;
  });
}

export function escapeCsvCell(value: unknown): string {
  const text = String(value ?? '');
  const safe = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function publicApiUrl(value: string | undefined): string {
  const candidate = value?.trim();
  if (!candidate) return '';
  let url: URL;
  try { url = new URL(candidate); }
  catch { throw new Error('NEXT_PUBLIC_API_URL phải là URL HTTP(S) tuyệt đối'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('NEXT_PUBLIC_API_URL không hợp lệ');
  return url.toString().replace(/\/$/, '');
}
