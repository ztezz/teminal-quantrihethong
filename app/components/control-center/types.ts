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
  | "overview"
  | "terminal"
  | "logs"
  | "jobs"
  | "settings"
  | "files"
  | "system"
  | "sqlite";

export interface OverviewData {
  success: true;
  generatedAt: string;
  application: { uptimeSeconds: number; startedAt: string };
  host: {
    cpu: number;
    memory: { usedMB: number; totalMB: number; percent: number };
    disk: { usedGB: number; totalGB: number; percent: number };
    loadAverage: number[];
  };
  system: {
    services: { supported: boolean; total: number | null; active: number | null; failed: number | null };
    processes: { supported: boolean; total: number | null };
  };
  audit: {
    critical: number;
    warning: number;
    recent: Array<Pick<LogEntry, "id" | "category" | "action" | "event" | "level" | "result" | "timestamp">>;
  };
  sessions: { active: number };
  databases: { managed: number; healthy: number; unhealthy: number; scanned: number; truncated: boolean };
  api: {
    startedAt: string;
    requests: number;
    inFlight: number;
    errors: number;
    errorRate: number;
    latencyMs: { average: number; p95: number; maximum: number };
    statusCodes: Record<string, number>;
    methods: Record<string, number>;
  };
  terminalConnections: number;
}

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

export type JobType = "sqlite_backup" | "sqlite_integrity" | "sqlite_vacuum";
export type JobState = "pending" | "running" | "success" | "failure" | "cancelled";

export interface JobLog {
  timestamp: string;
  message: string;
}

export interface Job {
  id: string;
  type: JobType;
  state: JobState;
  path: string;
  source: "api" | "schedule";
  createdBy: string;
  requiredRole: "admin" | "root";
  progress: number;
  message: string;
  logs: JobLog[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: Record<string, unknown>;
  error?: string;
}

export interface JobsResponse {
  success: true;
  jobs: Job[];
  total: number;
  offset: number;
  limit: number;
}

export interface JobResponse {
  success: true;
  job: Job;
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
