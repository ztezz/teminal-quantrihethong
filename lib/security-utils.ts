export const ARCHIVE_LIMITS = {
  maxEntries: 1_000,
  maxFileSize: 100 * 1024 * 1024,
  maxTotalSize: 512 * 1024 * 1024,
  maxOutputSize: 512 * 1024 * 1024,
  maxDepth: 64,
  maxCompressionRatio: 100
} as const;

type ArchiveEntryMetadata = { path: string; compressedSize: number; uncompressedSize: number };
export type ArchiveSourceEntry = { path: string; type: 'file' | 'directory' | 'symlink' | 'other'; size: number; depth: number };
export type ArchiveSourceStats = { entries: number; totalSize: number };

export function accountArchiveSourceEntry(stats: ArchiveSourceStats, entry: ArchiveSourceEntry): ArchiveSourceStats {
  if (entry.type === 'symlink') throw Object.assign(new Error(`Không thể lưu symbolic link vào archive: ${entry.path}`), { status: 400 });
  if (entry.type === 'other') throw Object.assign(new Error(`Loại tệp không được hỗ trợ trong archive: ${entry.path}`), { status: 400 });
  if (!Number.isSafeInteger(entry.depth) || entry.depth < 0 || entry.depth > ARCHIVE_LIMITS.maxDepth) throw Object.assign(new Error(`Nguồn archive vượt quá độ sâu ${ARCHIVE_LIMITS.maxDepth}: ${entry.path}`), { status: 413 });
  if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw Object.assign(new Error(`Tệp có dung lượng không hợp lệ: ${entry.path}`), { status: 400 });
  const entries = stats.entries + 1;
  if (entries > ARCHIVE_LIMITS.maxEntries) throw Object.assign(new Error(`Nguồn archive vượt quá ${ARCHIVE_LIMITS.maxEntries} mục`), { status: 413 });
  if (entry.type === 'file' && entry.size > ARCHIVE_LIMITS.maxFileSize) throw Object.assign(new Error(`Tệp nguồn vượt quá ${ARCHIVE_LIMITS.maxFileSize / 1024 / 1024}MB: ${entry.path}`), { status: 413 });
  const totalSize = stats.totalSize + (entry.type === 'file' ? entry.size : 0);
  if (!Number.isSafeInteger(totalSize) || totalSize > ARCHIVE_LIMITS.maxTotalSize) throw Object.assign(new Error(`Nguồn archive vượt quá ${ARCHIVE_LIMITS.maxTotalSize / 1024 / 1024}MB`), { status: 413 });
  return { entries, totalSize };
}

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

export type RuntimeConfig = { frontendOrigin?: string; encryptionKey?: string; terminalPassword?: string; production: boolean; backendOnly: boolean };

export function validateRuntimeConfig(config: RuntimeConfig): { frontendOrigin?: string } {
  let frontendOrigin: string | undefined;
  if (config.frontendOrigin?.trim()) {
    let url: URL;
    try { url = new URL(config.frontendOrigin.trim()); }
    catch { throw new Error('FRONTEND_ORIGIN phải là HTTP(S) origin hợp lệ'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('FRONTEND_ORIGIN chỉ được chứa scheme, host và port');
    if (config.production && url.protocol !== 'https:') throw new Error('FRONTEND_ORIGIN phải dùng HTTPS trong production');
    frontendOrigin = url.origin;
  } else if (config.backendOnly) {
    throw new Error('FRONTEND_ORIGIN is required in backend-only mode');
  }
  if (config.production && (!config.encryptionKey || config.encryptionKey.length < 32)) throw new Error('AUTH_ENCRYPTION_KEY must contain at least 32 characters in production');
  if (config.terminalPassword && (config.terminalPassword.length < 12 || config.terminalPassword.toLowerCase() === 'admin')) throw new Error('TERMINAL_PASSWORD must be at least 12 characters and cannot be admin');
  return { frontendOrigin };
}
