export interface LogEntry {
  id: number;
  category: string;
  action: string;
  event: string;
  level: "info" | "warning" | "critical";
  result: "success" | "failure";
  ip: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface FileBookmark {
  path: string;
  label: string;
}

export interface SecuritySession {
  id: string;
  username?: string;
  createdAt: number;
  expiresAt: number;
  ip: string;
  userAgent: string;
  current: boolean;
}

export type UserRole = "viewer" | "operator" | "admin" | "root";

export interface ManagedUser {
  id: string;
  username: string;
  role: UserRole;
  enabled: boolean;
  twoFactorEnabled: boolean;
  createdAt: number;
  sessions: number;
}

export interface FileSnapshot {
  id: string;
  originalPath: string;
  createdAt: string;
  reason: string;
  size: number;
  mode: number;
  mtime: string;
  checksum: string;
}

export interface FileMetadata {
  path: string;
  mode: string;
  uid: number;
  gid: number;
}

export interface TrashItem {
  id: string;
  originalPath: string;
  name?: string;
  deletedAt?: string;
}

export type ActiveTab =
  | "terminal"
  | "logs"
  | "settings"
  | "files"
  | "system"
  | "sqlite";

export interface SystemService {
  unit: string;
  load: string;
  active: string;
  sub: string;
  description: string;
}

export interface SystemProcess {
  pid: number;
  ppid: number;
  user: string;
  cpu: number;
  memory: number;
  rssKB: number;
  elapsed: string;
  command: string;
}

export interface SqliteFile {
  path: string;
  name: string;
  size: number;
  mtime: string;
  protected: boolean;
}

export interface SqliteObject {
  type: string;
  name: string;
  tableName: string;
  sql: string | null;
}

export interface SqliteColumn {
  name: string;
  type?: string;
  pk?: number;
  notnull?: number;
  dflt_value?: unknown;
  primaryKey?: boolean;
}

export interface SqliteBackup {
  name: string;
  mtime?: string;
  size?: number;
}

export interface SqliteBrowserItem {
  name: string;
  path: string;
  type: "directory" | "database";
  size?: number;
  mtime?: string;
  protected?: boolean;
}

export interface SqliteHistoryEntry {
  id: string;
  path: string;
  sql: string;
  ranAt: string;
  durationMs?: number;
  rowCount?: number;
  success: boolean;
}

export type SqliteWorkspace = "data" | "sql" | "schema" | "operations";

export type SqliteRecordModal = {
  mode: "add" | "edit";
  row?: Record<string, unknown>;
} | null;

export type ToastKind = "success" | "error" | "info" | "loading";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  duration: number;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  danger?: boolean;
  requiredText?: string;
  confirmLabel?: string;
}

export type ConfirmPrompt = ConfirmOptions & {
  resolve: (confirmed: boolean) => void;
};

export interface ContextMenuState {
  x: number;
  y: number;
  kind: "file" | "database" | "object";
  // Context menu payloads come directly from several API response shapes.
  item: any;
}

export interface PaletteAction {
  label: string;
  hint: string;
  run: () => void;
}

export type PreviewKind =
  | "video"
  | "audio"
  | "image"
  | "pdf"
  | "office"
  | "text";
