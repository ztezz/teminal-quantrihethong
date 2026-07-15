'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { publicApiUrl } from '@/lib/security-utils';

const API_URL = publicApiUrl(process.env.NEXT_PUBLIC_API_URL || 'https://api-ssh.luugame.fun');
import { 
  Terminal as TerminalIcon, 
  Lock, 
  Settings, 
  History, 
  Key, 
  RefreshCw, 
  Database, 
  Check, 
  AlertCircle,
  Menu,
  X,
  Plus,
  Minus,
  Folder,
  File,
  FolderPlus,
  FilePlus,
  Trash2,
  ArrowLeft,
  ChevronRight,
  Edit,
  Eye,
  Save,
  ArrowUpLeft,
  FileCode,
  FileText,
  FileJson,
  FileClock,
  Download,
  Upload,
  Move,
  Search,
  Bookmark,
  BookmarkCheck,
  ShieldCheck,
  Smartphone,
  Monitor,
  Copy,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  Table2,
  Wrench,
  Archive,
  BarChart3,
  Play,
  RotateCcw
} from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

interface LogEntry {
  id: number;
  category: string;
  action: string;
  event: string;
  level: 'info' | 'warning' | 'critical';
  result: 'success' | 'failure';
  ip: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

interface FileBookmark {
  path: string;
  label: string;
}

interface SecuritySession {
  id: string;
  username?: string;
  createdAt: number;
  expiresAt: number;
  ip: string;
  userAgent: string;
  current: boolean;
}
type UserRole = 'viewer' | 'operator' | 'admin' | 'root';
interface ManagedUser { id: string; username: string; role: UserRole; enabled: boolean; twoFactorEnabled: boolean; createdAt: number; sessions: number }
interface FileSnapshot { id: string; originalPath: string; createdAt: string; reason: string; size: number; mode: number; mtime: string; checksum: string }

interface FileMetadata {
  path: string;
  mode: string;
  uid: number;
  gid: number;
}

interface TrashItem {
  id: string;
  originalPath: string;
  name?: string;
  deletedAt?: string;
}

type ActiveTab = 'terminal' | 'logs' | 'settings' | 'files' | 'system' | 'sqlite';
interface SystemService { unit: string; load: string; active: string; sub: string; description: string }
interface SystemProcess { pid: number; ppid: number; user: string; cpu: number; memory: number; rssKB: number; elapsed: string; command: string }
interface SqliteFile { path: string; name: string; size: number; mtime: string; protected: boolean }
interface SqliteObject { type: string; name: string; tableName: string; sql: string | null }
interface SqliteColumn { name: string; type?: string; pk?: number; notnull?: number; dflt_value?: unknown; primaryKey?: boolean }
interface SqliteBackup { name: string; mtime?: string; size?: number }
interface SqliteHistoryEntry { id: string; path: string; sql: string; ranAt: string; durationMs?: number; rowCount?: number; success: boolean }
type SqliteWorkspace = 'data' | 'sql' | 'schema' | 'operations';
type SqliteRecordModal = { mode: 'add' | 'edit'; row?: Record<string, unknown> } | null;

function getSavedActiveTab(): ActiveTab {
  if (typeof window === 'undefined') return 'terminal';
  const saved = localStorage.getItem('vps_terminal_active_tab');
  return saved === 'logs' || saved === 'settings' || saved === 'files' || saved === 'system' || saved === 'sqlite' ? saved : 'terminal';
}

function getSavedSidebarState(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem('vps_terminal_sidebar_open') !== 'false';
}

const LAST_FILE_PATH_KEY = 'vps_terminal_last_file_path';
const FILE_BOOKMARKS_KEY = 'vps_terminal_file_bookmarks';
const SQLITE_HISTORY_KEY = 'vps_terminal_sqlite_history';
type PreviewKind = 'video' | 'audio' | 'image' | 'pdf' | 'office' | 'text';

function previewKind(filePath: string): PreviewKind {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'oga', 'aac', 'm4a', 'flac', 'opus'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'].includes(ext)) return 'office';
  return 'text';
}

function getSavedFilePath(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(LAST_FILE_PATH_KEY) || '';
}

function getSavedFileBookmarks(): FileBookmark[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = JSON.parse(localStorage.getItem(FILE_BOOKMARKS_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.flatMap((item): FileBookmark[] => {
      if (typeof item === 'string') return [{ path: item, label: item || '/' }];
      if (item && typeof item.path === 'string') {
        return [{ path: item.path, label: typeof item.label === 'string' && item.label.trim() ? item.label : item.path || '/' }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

function getSavedSqliteHistory(): SqliteHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const history = JSON.parse(localStorage.getItem(SQLITE_HISTORY_KEY) || '[]');
    return Array.isArray(history) ? history.slice(0, 50) : [];
  } catch {
    return [];
  }
}

function sqliteCellValue(value: unknown) {
  if (value === null) return <span className="text-slate-600 italic">NULL</span>;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Helper to determine the proper file-type specific icon and color styling
function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'sh':
    case 'bash':
      return <FileCode className="w-4 h-4 shrink-0 text-emerald-400" />;
    case 'txt':
    case 'md':
      return <FileText className="w-4 h-4 shrink-0 text-slate-400" />;
    case 'json':
      return <FileJson className="w-4 h-4 shrink-0 text-blue-400" />;
    case 'log':
      return <FileClock className="w-4 h-4 shrink-0 text-amber-500" />;
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'py':
    case 'go':
    case 'rs':
    case 'c':
    case 'cpp':
    case 'html':
    case 'css':
      return <FileCode className="w-4 h-4 shrink-0 text-purple-400" />;
    default:
      return <File className="w-4 h-4 shrink-0 text-slate-500" />;
  }
}

function SqliteResultTable({ rows, empty }: { rows: Record<string, unknown>[]; empty: string }) {
  const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
  if (!rows.length) return <div className="p-8 text-center text-xs text-slate-600">{empty}</div>;
  return <div className="max-h-96 overflow-auto"><table className="min-w-full text-left text-[11px] font-mono"><thead className="sticky top-0 bg-[#151a18] text-slate-500"><tr>{columns.map(column => <th key={column} className="px-3 py-2 border-b border-r border-white/5 whitespace-nowrap">{column}</th>)}</tr></thead><tbody className="divide-y divide-white/5">{rows.map((row, index) => <tr key={index} className="hover:bg-white/[0.02]">{columns.map(column => <td key={column} className="max-w-80 px-3 py-2 border-r border-white/5 text-slate-300 whitespace-pre-wrap break-all">{sqliteCellValue(row[column])}</td>)}</tr>)}</tbody></table></div>;
}

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('root');
  const [currentUser, setCurrentUser] = useState<{ username: string; role: UserRole } | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [previewTicket, setPreviewTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');

  // Terminal customization preferences
  const [fontSize, setFontSize] = useState<number>(14);
  const [theme, setTheme] = useState<string>('dark-classic');
  const [previewTheme, setPreviewTheme] = useState<string | null>(null);
  const activePreviewTheme = previewTheme !== null ? previewTheme : theme;

  // Save status for persistent server settings.
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSettingsLoadedRef = useRef<boolean>(false);

  // Logs & Settings Management UI State
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logOffset, setLogOffset] = useState(0);
  const [logQuery, setLogQuery] = useState('');
  const [logCategory, setLogCategory] = useState('');
  const [logLevel, setLogLevel] = useState('');
  const [logResult, setLogResult] = useState('');
  const [logIntegrity, setLogIntegrity] = useState<{ valid: boolean; checked: number; brokenAt?: number } | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>(getSavedActiveTab);
  const [isSidebarOpen, setIsSidebarOpen] = useState(getSavedSidebarState);
  const [systemView, setSystemView] = useState<'services' | 'processes'>('services');
  const [services, setServices] = useState<SystemService[]>([]);
  const [processes, setProcesses] = useState<SystemProcess[]>([]);
  const [systemQuery, setSystemQuery] = useState('');
  const [systemLoading, setSystemLoading] = useState(false);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [serviceLogs, setServiceLogs] = useState<{ unit: string; logs: string } | null>(null);
  const [sqliteFiles, setSqliteFiles] = useState<SqliteFile[]>([]);
  const [selectedSqlite, setSelectedSqlite] = useState('');
  const [sqliteObjects, setSqliteObjects] = useState<SqliteObject[]>([]);
  const [selectedSqliteTable, setSelectedSqliteTable] = useState('');
  const [sqliteRows, setSqliteRows] = useState<Record<string, unknown>[]>([]);
  const [sqliteSql, setSqliteSql] = useState('SELECT name, type FROM sqlite_schema ORDER BY type, name;');
  const [sqliteResult, setSqliteResult] = useState<Record<string, unknown>[]>([]);
  const [sqliteMessage, setSqliteMessage] = useState<string | null>(null);
  const [sqliteLoading, setSqliteLoading] = useState(false);
  const [showCreateSqlite, setShowCreateSqlite] = useState(false);
  const [newSqlitePath, setNewSqlitePath] = useState('data/app.sqlite');
  const [newSqliteSchema, setNewSqliteSchema] = useState('');
  const [sqliteWorkspace, setSqliteWorkspace] = useState<SqliteWorkspace>('data');
  const [sqliteColumns, setSqliteColumns] = useState<SqliteColumn[]>([]);
  const [sqliteRowIdentities, setSqliteRowIdentities] = useState<Record<string, unknown>[]>([]);
  const [sqliteIdentityKind, setSqliteIdentityKind] = useState<'primaryKey' | 'rowid' | 'none'>('none');
  const [sqliteTotal, setSqliteTotal] = useState(0);
  const [sqliteOffset, setSqliteOffset] = useState(0);
  const [sqliteLimit, setSqliteLimit] = useState(25);
  const [sqliteSearch, setSqliteSearch] = useState('');
  const [sqliteAppliedSearch, setSqliteAppliedSearch] = useState('');
  const [sqliteSort, setSqliteSort] = useState('');
  const [sqliteOrder, setSqliteOrder] = useState<'asc' | 'desc'>('asc');
  const [sqliteRecordModal, setSqliteRecordModal] = useState<SqliteRecordModal>(null);
  const [sqliteRecordValues, setSqliteRecordValues] = useState<Record<string, unknown>>({});
  const [sqliteSchemaAction, setSqliteSchemaAction] = useState<'createTable' | 'addColumn' | 'createIndex' | 'dropIndex' | 'dropTable'>('createTable');
  const [sqliteSchemaForm, setSqliteSchemaForm] = useState({ table: '', columns: 'id INTEGER PRIMARY KEY\nname TEXT NOT NULL', column: '', type: 'TEXT', index: '', indexColumns: '', unique: false });
  const [sqliteImportFormat, setSqliteImportFormat] = useState<'csv' | 'json'>('csv');
  const [sqliteImportData, setSqliteImportData] = useState('');
  const [sqliteStats, setSqliteStats] = useState<Record<string, unknown> | null>(null);
  const [sqliteBackups, setSqliteBackups] = useState<SqliteBackup[]>([]);
  const [sqlitePlan, setSqlitePlan] = useState<Record<string, unknown>[]>([]);
  const [sqliteHistory, setSqliteHistory] = useState<SqliteHistoryEntry[]>(getSavedSqliteHistory);

  useEffect(() => {
    localStorage.setItem('vps_terminal_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('vps_terminal_sidebar_open', String(isSidebarOpen));
  }, [isSidebarOpen]);

  useEffect(() => {
    if (currentUser && !['admin', 'root'].includes(currentUser.role) && ['terminal', 'logs', 'system', 'sqlite'].includes(activeTab)) setTimeout(() => setActiveTab('files'), 0);
  }, [currentUser, activeTab]);

  // System metrics
  const [cpuPercent, setCpuPercent] = useState<number>(0);
  const [memUsedMB, setMemUsedMB] = useState<number>(0);
  const [memTotalMB, setMemTotalMB] = useState<number>(0);
  const [memPercent, setMemPercent] = useState<number>(0);
  const [diskUsedGB, setDiskUsedGB] = useState<number>(0);
  const [diskTotalGB, setDiskTotalGB] = useState<number>(0);
  const [diskPercent, setDiskPercent] = useState<number>(0);

  // File Manager States
  const [filesList, setFilesList] = useState<any[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [parentPath, setParentPath] = useState<string>('');
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileMtime, setFileMtime] = useState<string | null>(null);
  const [isEditingFile, setIsEditingFile] = useState<boolean>(false);
  const [fileLoading, setFileLoading] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState<boolean>(false);
  const [showCreateFile, setShowCreateFile] = useState<boolean>(false);
  const [newDirName, setNewDirName] = useState<string>('');
  const [newFileName, setNewFileName] = useState<string>('');
  const [fileSearchQuery, setFileSearchQuery] = useState<string>('');
  const [fileBookmarks, setFileBookmarks] = useState<FileBookmark[]>(getSavedFileBookmarks);
  const [pathInput, setPathInput] = useState('');
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyIndexRef = useRef(-1);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [fileClipboard, setFileClipboard] = useState<{ operation: 'copy' | 'move'; paths: string[] } | null>(null);
  const [recursiveSearch, setRecursiveSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [selectedTrashIds, setSelectedTrashIds] = useState<string[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [snapshots, setSnapshots] = useState<FileSnapshot[]>([]);
  const [snapshotPath, setSnapshotPath] = useState('');
  const [editorOriginal, setEditorOriginal] = useState('');
  const [editorFind, setEditorFind] = useState('');
  const [editorReplace, setEditorReplace] = useState('');
  const [editorPosition, setEditorPosition] = useState({ line: 1, char: 1 });
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const pendingTerminalCwdRef = useRef<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const visibleFiles = searchResults ?? filesList;
  const filteredFiles = visibleFiles.filter((file) =>
    file.name.toLowerCase().includes(fileSearchQuery.toLowerCase())
  );

  const loadFiles = useCallback(async (dirPath?: string, _authToken?: string | null, historyMode: 'push' | 'replace' | 'none' = 'push', fallbackToRoot = false) => {
    if (!sessionReady) return;
    setFileLoading(true);
    setFileError(null);
    setFileSearchQuery('');
    try {
      const url = dirPath ? `${API_URL}/api/files?path=${encodeURIComponent(dirPath)}` : `${API_URL}/api/files`;
      const res = await fetch(url, {
        credentials: 'include'
      });
      let data = await res.json();
      if (!data.success && data.code === 'ENOENT' && dirPath && fallbackToRoot) {
        localStorage.removeItem(LAST_FILE_PATH_KEY);
        const rootResponse = await fetch(`${API_URL}/api/files`, {
          credentials: 'include'
        });
        data = await rootResponse.json();
        historyMode = 'replace';
      }
      if (data.success) {
        setFilesList(data.files);
        setCurrentPath(data.currentPath);
        setPathInput(data.currentPath);
        setParentPath(data.parentPath);
        setSelectedPaths([]);
        setSearchResults(null);
        setSearchTruncated(false);
        localStorage.setItem(LAST_FILE_PATH_KEY, data.currentPath);
        if (historyMode !== 'none') {
          setPathHistory((history) => {
            if (historyMode === 'replace') {
              historyIndexRef.current = 0;
              setHistoryIndex(0);
              return [data.currentPath];
            }
            const base = history.slice(0, historyIndexRef.current + 1);
            const next = base[base.length - 1] === data.currentPath ? base : [...base, data.currentPath];
            historyIndexRef.current = next.length - 1;
            setHistoryIndex(historyIndexRef.current);
            return next;
          });
        }
      } else {
        setFileError(data.error || 'Không thể tải danh sách tệp tin');
      }
    } catch (err: any) {
      setFileError('Lỗi kết nối đến máy chủ: ' + err.message);
    } finally {
      setFileLoading(false);
    }
  }, [sessionReady]);

  const toggleFileBookmark = (bookmarkPath: string) => {
    setFileBookmarks((current) => {
      const updated = current.some((item) => item.path === bookmarkPath)
        ? current.filter((item) => item.path !== bookmarkPath)
        : [...current, { path: bookmarkPath, label: bookmarkPath || '/' }];
      localStorage.setItem(FILE_BOOKMARKS_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const requestFileApi = async (endpoint: string, options: RequestInit = {}) => {
    if (!sessionReady) throw new Error('Phiên đăng nhập đã hết hạn');
    let response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    if (response.status === 428 && await requestStepUp()) response = await fetch(`${API_URL}${endpoint}`, { ...options, credentials: 'include', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
    const data = await response.json();
    if (!response.ok && response.status !== 207) throw new Error(data.error || 'Thao tác thất bại');
    return data;
  };

  const requestStepUp = () => new Promise<boolean>((resolve) => setStepUpPrompt({ resolve }));
  const fetchWithStepUp = async (url: string, options: RequestInit) => {
    let response = await fetch(url, { ...options, credentials: 'include' });
    if (response.status === 428 && await requestStepUp()) response = await fetch(url, { ...options, credentials: 'include' });
    return response;
  };

  const loadSystemData = useCallback(async (view: 'services' | 'processes' = systemView) => {
    if (!sessionReady || !currentUser || !['admin', 'root'].includes(currentUser.role)) return;
    setSystemLoading(true); setSystemError(null);
    try {
      const res = await fetch(`${API_URL}/api/system/${view}`, { credentials: 'include' }); const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Không thể tải dữ liệu hệ thống');
      if (view === 'services') setServices(data.services || []); else setProcesses(data.processes || []);
    } catch (error: any) { setSystemError(error.message); }
    finally { setSystemLoading(false); }
  }, [systemView, sessionReady, currentUser, setSystemLoading, setSystemError, setServices, setProcesses]);

  const serviceAction = async (unit: string, action: string) => {
    try {
      const res = await fetchWithStepUp(`${API_URL}/api/system/services/${encodeURIComponent(unit)}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const data = await res.json(); if (!data.success) throw new Error(data.error); await loadSystemData('services');
    } catch (error: any) { setSystemError(error.message); }
  };

  const openServiceLogs = async (unit: string) => {
    try { const res = await fetch(`${API_URL}/api/system/services/${encodeURIComponent(unit)}/logs?lines=200`, { credentials: 'include' }); const data = await res.json(); if (!data.success) throw new Error(data.error); setServiceLogs({ unit, logs: data.logs }); }
    catch (error: any) { setSystemError(error.message); }
  };

  const signalProcess = async (pid: number, signal: 'SIGTERM' | 'SIGKILL') => {
    if (!confirm(`${signal} tiến trình PID ${pid}?`)) return;
    try { const res = await fetchWithStepUp(`${API_URL}/api/system/processes/${pid}/signal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signal }) }); const data = await res.json(); if (!data.success) throw new Error(data.error); await loadSystemData('processes'); }
    catch (error: any) { setSystemError(error.message); }
  };

  const sqliteRequest = async (endpoint: string, options: RequestInit = {}) => {
    const response = await fetchWithStepUp(`${API_URL}/api/sqlite${endpoint}`, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : { success: response.ok, data: await response.text() };
    if (!response.ok || data.success === false) throw new Error(data.error || data.message || 'Thao tác SQLite thất bại');
    return data;
  };

  const loadSqliteRows = async (databasePath: string, table: string, offset = 0, overrides: { q?: string; sort?: string; order?: 'asc' | 'desc'; limit?: number } = {}) => {
    if (!databasePath || !table) return;
    setSqliteLoading(true); setSqliteMessage(null);
    try {
      const limit = overrides.limit ?? sqliteLimit;
      const q = overrides.q ?? sqliteAppliedSearch;
      const sort = overrides.sort ?? sqliteSort;
      const order = overrides.order ?? sqliteOrder;
      const params = new URLSearchParams({ path: databasePath, table, limit: String(limit), offset: String(offset) });
      if (q) params.set('q', q);
      if (sort) { params.set('sort', sort); params.set('order', order); }
      const data = await sqliteRequest(`/rows?${params}`);
      setSelectedSqliteTable(table);
      setSqliteRows(data.rows || data.items || []);
      setSqliteColumns(data.columns || []);
      setSqliteRowIdentities(data.rowIdentities || []);
      setSqliteIdentityKind(data.identity?.kind || 'none');
      setSqliteTotal(Number(data.total ?? data.count ?? (data.rows || data.items || []).length));
      setSqliteOffset(offset);
      setSqliteLimit(limit);
      setSqliteResult([]);
    } catch (error: any) { setSqliteMessage(error.message); }
    finally { setSqliteLoading(false); }
  };

  const openSqlite = async (databasePath: string) => {
    setSqliteLoading(true); setSqliteMessage(null); setSelectedSqlite(databasePath); setSelectedSqliteTable(''); setSqliteRows([]); setSqliteResult([]);
    try {
      const data = await sqliteRequest(`/schema?path=${encodeURIComponent(databasePath)}`);
      setSqliteObjects(data.objects || []);
      const firstTable = data.objects?.find((item: SqliteObject) => item.type === 'table')?.name;
      if (firstTable) await loadSqliteRows(databasePath, firstTable, 0, { q: '', sort: '' });
      setSqliteMessage(`Đã mở database · quick_check: ${data.integrity}`);
    } catch (error: any) { setSqliteObjects([]); setSqliteMessage(error.message); }
    finally { setSqliteLoading(false); }
  };

  const loadSqliteFiles = useCallback(async () => {
    if (!sessionReady || !currentUser || !['admin', 'root'].includes(currentUser.role)) return;
    setSqliteLoading(true); setSqliteMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/sqlite`, { credentials: 'include' }); const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Không thể tải danh sách SQLite');
      setSqliteFiles(data.databases || []);
      if (selectedSqlite && !(data.databases || []).some((item: SqliteFile) => item.path === selectedSqlite)) { setSelectedSqlite(''); setSqliteObjects([]); setSqliteRows([]); }
    } catch (error: any) { setSqliteMessage(error.message); }
    finally { setSqliteLoading(false); }
  }, [sessionReady, currentUser, selectedSqlite]);

  const createSqlite = async () => {
    if (!newSqlitePath.trim()) return;
    setSqliteLoading(true); setSqliteMessage(null);
    try {
      const res = await fetchWithStepUp(`${API_URL}/api/sqlite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: newSqlitePath, schema: newSqliteSchema }) });
      const data = await res.json(); if (!data.success) throw new Error(data.error || 'Không thể tạo database');
      setShowCreateSqlite(false); setNewSqliteSchema(''); await loadSqliteFiles(); await openSqlite(data.path);
    } catch (error: any) { setSqliteMessage(error.message); }
    finally { setSqliteLoading(false); }
  };

  const runSqliteQuery = async () => {
    if (!selectedSqlite || !sqliteSql.trim()) return;
    setSqliteLoading(true); setSqliteMessage(null);
    try {
      const data = await sqliteRequest('/query', { method: 'POST', body: JSON.stringify({ path: selectedSqlite, sql: sqliteSql }) });
      const resultMessage = `Hoàn tất trong ${data.durationMs} ms · ${data.rowCount} dòng${data.truncated ? ' (đã giới hạn)' : ''}`;
      const ranAt = new Date().toISOString();
      const entry: SqliteHistoryEntry = { id: `${ranAt}:${sqliteSql}`, path: selectedSqlite, sql: sqliteSql, ranAt, durationMs: data.durationMs, rowCount: data.rowCount ?? data.rows?.length ?? 0, success: true };
      setSqliteHistory(history => { const next = [entry, ...history].slice(0, 50); localStorage.setItem(SQLITE_HISTORY_KEY, JSON.stringify(next)); return next; });
      const schema = await sqliteRequest(`/schema?path=${encodeURIComponent(selectedSqlite)}`);
      setSqliteObjects(schema.objects || []);
      setSqliteResult(data.rows || []); setSqliteMessage(resultMessage);
    } catch (error: any) {
      const ranAt = new Date().toISOString();
      const entry: SqliteHistoryEntry = { id: `${ranAt}:${sqliteSql}`, path: selectedSqlite, sql: sqliteSql, ranAt, success: false };
      setSqliteHistory(history => { const next = [entry, ...history].slice(0, 50); localStorage.setItem(SQLITE_HISTORY_KEY, JSON.stringify(next)); return next; });
      setSqliteMessage(error.message);
    }
    finally { setSqliteLoading(false); }
  };

  const sqliteIdentity = (row: Record<string, unknown>) => {
    const index = sqliteRows.indexOf(row);
    if (index >= 0 && sqliteRowIdentities[index]) return sqliteRowIdentities[index];
    const primaryKeys = sqliteColumns.filter(column => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map(column => column.name);
    return Object.fromEntries(primaryKeys.map(key => [key, row[key]]));
  };

  const openSqliteRecord = (mode: 'add' | 'edit', row?: Record<string, unknown>) => {
    const names = sqliteColumns.length ? sqliteColumns.map(column => column.name) : Object.keys(row || sqliteRows[0] || {});
    setSqliteRecordValues(Object.fromEntries(names.map(name => [name, row?.[name] ?? ''])));
    setSqliteRecordModal({ mode, row });
  };

  const saveSqliteRecord = async () => {
    if (!selectedSqliteTable || !sqliteRecordModal) return;
    setSqliteLoading(true); setSqliteMessage(null);
    try {
      const values = Object.fromEntries(Object.entries(sqliteRecordValues).map(([key, value]) => [key, value === 'NULL' ? null : value]));
      const editing = sqliteRecordModal.mode === 'edit' && sqliteRecordModal.row;
      await sqliteRequest('/rows', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ path: selectedSqlite, table: selectedSqliteTable, ...(editing ? { identity: sqliteIdentity(editing) } : {}), values }) });
      setSqliteRecordModal(null);
      setSqliteMessage(editing ? 'Đã cập nhật bản ghi.' : 'Đã thêm bản ghi.');
      await loadSqliteRows(selectedSqlite, selectedSqliteTable, sqliteOffset);
    } catch (error: any) { setSqliteMessage(error.message); }
    finally { setSqliteLoading(false); }
  };

  const deleteSqliteRecord = async (row: Record<string, unknown>) => {
    if (!confirm('Xóa vĩnh viễn bản ghi này?')) return;
    setSqliteLoading(true); setSqliteMessage(null);
    try {
      await sqliteRequest('/rows', { method: 'DELETE', body: JSON.stringify({ path: selectedSqlite, table: selectedSqliteTable, identity: sqliteIdentity(row) }) });
      await loadSqliteRows(selectedSqlite, selectedSqliteTable, sqliteOffset);
      setSqliteMessage('Đã xóa bản ghi.');
    } catch (error: any) { setSqliteMessage(error.message); }
    finally { setSqliteLoading(false); }
  };

  const applySqliteSchemaAction = async () => {
    setSqliteLoading(true); setSqliteMessage(null);
    try {
      const payload: Record<string, unknown> = { path: selectedSqlite };
      let endpoint = '';
      let method = 'POST';
      if (sqliteSchemaAction === 'createTable') {
        const columns = sqliteSchemaForm.columns.split('\n').map(value => value.trim()).filter(Boolean).map(definition => {
          const match = /^(\S+)\s+(\S+)(.*)$/i.exec(definition);
          if (!match) throw new Error(`Định nghĩa cột không hợp lệ: ${definition}`);
          const flags = match[3];
          return { name: match[1], type: match[2], primaryKey: /\bPRIMARY\s+KEY\b/i.test(flags), autoIncrement: /\bAUTOINCREMENT\b/i.test(flags), notNull: /\bNOT\s+NULL\b/i.test(flags), unique: /\bUNIQUE\b/i.test(flags) };
        });
        Object.assign(payload, { table: sqliteSchemaForm.table, columns }); endpoint = '/schema/tables';
      }
      if (sqliteSchemaAction === 'addColumn') { Object.assign(payload, { table: selectedSqliteTable || sqliteSchemaForm.table, column: { name: sqliteSchemaForm.column, type: sqliteSchemaForm.type } }); endpoint = '/schema/columns'; }
      if (sqliteSchemaAction === 'createIndex') { Object.assign(payload, { table: selectedSqliteTable || sqliteSchemaForm.table, index: sqliteSchemaForm.index, columns: sqliteSchemaForm.indexColumns.split(',').map(value => value.trim()).filter(Boolean), unique: sqliteSchemaForm.unique }); endpoint = '/schema/indexes'; }
      if (sqliteSchemaAction === 'dropIndex') { Object.assign(payload, { index: sqliteSchemaForm.index }); endpoint = '/schema/indexes'; method = 'DELETE'; }
      if (sqliteSchemaAction === 'dropTable') { Object.assign(payload, { table: selectedSqliteTable || sqliteSchemaForm.table }); endpoint = '/schema/tables'; method = 'DELETE'; }
      if (['dropIndex', 'dropTable'].includes(sqliteSchemaAction) && !confirm(`Xác nhận ${sqliteSchemaAction}?`)) return;
      await sqliteRequest(endpoint, { method, body: JSON.stringify(payload) });
      await openSqlite(selectedSqlite);
      setSqliteMessage('Đã cập nhật schema.');
    } catch (error: any) { setSqliteMessage(error.message); }
    finally { setSqliteLoading(false); }
  };

  const importSqliteTable = async () => {
    if (!selectedSqliteTable || !sqliteImportData.trim()) return;
    setSqliteLoading(true); setSqliteMessage(null);
    try {
      const data = await sqliteRequest('/import', { method: 'POST', body: JSON.stringify({ path: selectedSqlite, table: selectedSqliteTable, format: sqliteImportFormat, data: sqliteImportData }) });
      setSqliteImportData('');
      await loadSqliteRows(selectedSqlite, selectedSqliteTable, 0);
      setSqliteMessage(`Import hoàn tất${data.rowCount !== undefined ? ` · ${data.rowCount} dòng` : ''}.`);
    } catch (error: any) { setSqliteMessage(error.message); }
    finally { setSqliteLoading(false); }
  };

  const loadSqliteOperations = async () => {
    if (!selectedSqlite) return;
    setSqliteLoading(true); setSqliteMessage(null);
    try {
      const [stats, backups] = await Promise.all([sqliteRequest(`/statistics?path=${encodeURIComponent(selectedSqlite)}`), sqliteRequest('/backups')]);
      setSqliteStats(stats.stats || stats.data || stats);
      setSqliteBackups(backups.backups || backups.items || []);
    } catch (error: any) { setSqliteMessage(error.message); }
    finally { setSqliteLoading(false); }
  };

  const sqliteMaintenance = async (action: 'vacuum' | 'analyze' | 'integrity_check') => {
    setSqliteLoading(true); setSqliteMessage(null);
    try { const data = await sqliteRequest('/maintenance', { method: 'POST', body: JSON.stringify({ path: selectedSqlite, action }) }); setSqliteMessage(data.message || `${action} hoàn tất.`); await loadSqliteOperations(); }
    catch (error: any) { setSqliteMessage(error.message); }
    finally { setSqliteLoading(false); }
  };

  const explainSqliteQuery = async () => {
    if (!sqliteSql.trim()) return;
    setSqliteLoading(true); setSqliteMessage(null);
    try { const data = await sqliteRequest('/explain', { method: 'POST', body: JSON.stringify({ path: selectedSqlite, sql: sqliteSql }) }); setSqlitePlan(data.plan || data.rows || data.items || []); }
    catch (error: any) { setSqliteMessage(error.message); }
    finally { setSqliteLoading(false); }
  };

  const sqliteBackupAction = async (action: 'create' | 'restore' | 'delete', id?: string) => {
    if (action !== 'create' && !confirm(action === 'restore' ? 'Khôi phục backup này và ghi đè database hiện tại?' : 'Xóa backup này?')) return;
    setSqliteLoading(true); setSqliteMessage(null);
    try {
      const name = id ? encodeURIComponent(id) : '';
      const endpoint = action === 'create' ? '/backups' : action === 'restore' ? `/backups/${name}/restore` : `/backups/${name}`;
      await sqliteRequest(endpoint, { method: action === 'delete' ? 'DELETE' : 'POST', body: JSON.stringify({ path: selectedSqlite }) });
      await loadSqliteOperations();
      if (action === 'restore') await openSqlite(selectedSqlite);
      setSqliteMessage(action === 'create' ? 'Đã tạo backup.' : action === 'restore' ? 'Đã khôi phục backup.' : 'Đã xóa backup.');
    } catch (error: any) { setSqliteMessage(error.message); }
    finally { setSqliteLoading(false); }
  };

  const deleteSqlite = async (databasePath: string) => {
    if (!confirm(`Xóa vĩnh viễn database ${databasePath}?`)) return;
    setSqliteLoading(true); setSqliteMessage(null);
    try {
      const res = await fetchWithStepUp(`${API_URL}/api/sqlite`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: databasePath }) });
      const data = await res.json(); if (!data.success) throw new Error(data.error || 'Không thể xóa database');
      setSelectedSqlite(''); setSqliteObjects([]); setSqliteRows([]); setSqliteResult([]); await loadSqliteFiles();
    } catch (error: any) { setSqliteMessage(error.message); }
    finally { setSqliteLoading(false); }
  };

  const navigateHistory = (offset: number) => {
    const nextIndex = historyIndex + offset;
    const nextPath = pathHistory[nextIndex];
    if (nextPath === undefined) return;
    historyIndexRef.current = nextIndex;
    setHistoryIndex(nextIndex);
    loadFiles(nextPath, null, 'none');
  };

  const transferFiles = async (operation: 'copy' | 'move', paths: string[]) => {
    if (!paths.length) return;
    try {
      const data = await requestFileApi('/api/files/transfer', {
        method: 'POST',
        body: JSON.stringify({ operation, paths, destinationDir: currentPath }),
      });
      if (data.results?.some((item: any) => !item.success)) setFileError('Một số mục không thể được xử lý.');
      if (operation === 'move') setFileClipboard(null);
      setSelectedPaths([]);
      await loadFiles(currentPath, null, 'none');
    } catch (error: any) { setFileError(error.message); }
  };

  const trashPaths = async (paths: string[]) => {
    if (!paths.length || !confirm(`Chuyển ${paths.length} mục vào thùng rác?`)) return;
    try {
      const data = await requestFileApi('/api/files/trash', { method: 'POST', body: JSON.stringify({ paths }) });
      if (data.results?.some((item: any) => !item.success)) setFileError('Một số mục không thể chuyển vào thùng rác.');
      setSelectedPaths([]);
      await loadFiles(currentPath, null, 'none');
    } catch (error: any) { setFileError(error.message); }
  };

  const runRecursiveSearch = async () => {
    if (!fileSearchQuery.trim()) { setSearchResults(null); return; }
    try {
      const data = await requestFileApi(`/api/files/search?path=${encodeURIComponent(currentPath)}&query=${encodeURIComponent(fileSearchQuery.trim())}`);
      setSearchResults(data.results || []);
      setSearchTruncated(Boolean(data.truncated));
    } catch (error: any) { setFileError(error.message); }
  };

  const uploadFiles = (files: globalThis.File[]) => {
    if (!sessionReady || !files.length) return;
    setFileLoading(true);
    setFileError(null);
    let remaining = files.length;
    files.forEach((file) => {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_URL}/api/files/upload`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
      xhr.setRequestHeader('X-Directory', encodeURIComponent(currentPath));
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) setUploadProgress((progress) => ({ ...progress, [key]: Math.round(event.loaded / event.total * 100) }));
      };
      xhr.onerror = () => setFileError(`Upload ${file.name} thất bại`);
      xhr.onload = async () => {
        if (xhr.status === 428 && await requestStepUp()) {
          uploadFiles([file]);
          return;
        }
        if (xhr.status >= 400) {
          try { setFileError(JSON.parse(xhr.responseText).error || `Upload ${file.name} thất bại`); }
          catch { setFileError(`Upload ${file.name} thất bại`); }
        }
      };
      xhr.onloadend = () => {
        setUploadProgress((progress) => { const next = { ...progress }; delete next[key]; return next; });
        remaining -= 1;
        if (remaining === 0) { setFileLoading(false); loadFiles(currentPath, null, 'none'); }
      };
      xhr.send(file);
    });
  };

  const openTrash = async () => {
    try {
      const data = await requestFileApi('/api/files/trash');
      setTrashItems(data.items || []);
      setSelectedTrashIds([]);
      setShowTrash(true);
    } catch (error: any) { setFileError(error.message); }
  };

  const trashAction = async (action: 'restore' | 'delete' | 'empty', ids: string[] = []) => {
    try {
      if (action === 'restore') await requestFileApi('/api/files/trash/restore', { method: 'POST', body: JSON.stringify({ ids }) });
      if (action === 'delete') await requestFileApi('/api/files/trash', { method: 'DELETE', body: JSON.stringify({ ids }) });
      if (action === 'empty') await requestFileApi('/api/files/trash/empty', { method: 'DELETE' });
      await openTrash();
      await loadFiles(currentPath, null, 'none');
    } catch (error: any) { setFileError(error.message); }
  };

  const openSnapshots = async (filePath = '') => {
    try {
      const data = await requestFileApi(`/api/files/snapshots${filePath ? `?path=${encodeURIComponent(filePath)}` : ''}`);
      setSnapshots(data.items || []); setSnapshotPath(filePath); setShowSnapshots(true);
    } catch (error: any) { setFileError(error.message); }
  };

  const restoreSnapshot = async (id: string) => {
    if (!confirm('Khôi phục phiên bản này và ghi đè file hiện tại?')) return;
    try { await requestFileApi('/api/files/snapshots/restore', { method: 'POST', body: JSON.stringify({ id }) }); await openSnapshots(snapshotPath); await loadFiles(currentPath, null, 'none'); }
    catch (error: any) { setFileError(error.message); }
  };

  const deleteSnapshot = async (id: string) => {
    if (!confirm('Xóa vĩnh viễn snapshot này?')) return;
    try { await requestFileApi('/api/files/snapshots', { method: 'DELETE', body: JSON.stringify({ id }) }); await openSnapshots(snapshotPath); }
    catch (error: any) { setFileError(error.message); }
  };

  const downloadSnapshot = async (id: string, fileName: string) => {
    const res = await fetch(`${API_URL}/api/files/snapshots/download?id=${encodeURIComponent(id)}`, { credentials: 'include' });
    if (!res.ok) return setFileError('Không thể tải snapshot');
    const url = URL.createObjectURL(await res.blob()); const link = document.createElement('a'); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url);
  };

  const openFile = async (filePath: string) => {
    if (!sessionReady) return;
    if (previewKind(filePath) !== 'text') {
      const ticketData = await requestFileApi('/api/auth/preview-ticket', { method: 'POST', body: JSON.stringify({ path: filePath }) });
      setPreviewTicket(ticketData.ticket);
      setViewingFile(filePath);
      setFileContent(null);
      setFileMtime(null);
      setIsEditingFile(false);
      setFileError(null);
      return;
    }
    setFileLoading(true);
    setFileError(null);
    try {
      const res = await fetch(`${API_URL}/api/files/read?path=${encodeURIComponent(filePath)}`, {
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        if (data.isBinary) {
          setFileError('Tệp tin này là định dạng nhị phân, không thể xem trực tiếp.');
          setViewingFile(null);
          setFileContent(null);
        } else {
          setViewingFile(filePath);
          setFileContent(data.content);
          setEditorOriginal(data.content);
          setFileMtime(data.mtime);
          setIsEditingFile(false);
        }
      } else {
        setFileError(data.error || 'Không thể mở tệp tin');
      }
    } catch (err: any) {
      setFileError('Lỗi kết nối máy chủ: ' + err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const saveEditedFile = async () => {
    if (!sessionReady || !viewingFile || fileContent === null) return;
    setFileLoading(true);
    setFileError(null);
    try {
      const res = await fetchWithStepUp(`${API_URL}/api/files/write`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ filePath: viewingFile, content: fileContent, expectedMtime: fileMtime })
      });
      const data = await res.json();
      if (data.success) {
        setFileMtime(data.mtime);
        setEditorOriginal(fileContent);
        setIsEditingFile(false);
      } else {
        setFileError(data.error || 'Lỗi khi lưu tệp tin');
      }
    } catch (err: any) {
      setFileError('Lỗi kết nối: ' + err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const deleteFileOrFolder = async (filePath: string) => {
    if (!sessionReady) return;
    const itemName = filePath.replace(/\\/g, '/').split('/').pop() || 'tệp/thư mục';
    if (!confirm(`Bạn có chắc chắn muốn xóa "${itemName}" không?`)) return;
    setFileLoading(true);
    setFileError(null);
    try {
      const res = await fetchWithStepUp(`${API_URL}/api/files?path=${encodeURIComponent(filePath)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        await loadFiles(currentPath);
        if (viewingFile === filePath) {
          setViewingFile(null);
          setFileContent(null);
        }
      } else {
        setFileError(data.error || 'Lỗi khi xóa tệp/thư mục');
      }
    } catch (err: any) {
      setFileError('Lỗi kết nối: ' + err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const createNewDir = async () => {
    if (!sessionReady || !newDirName.trim()) return;
    setFileLoading(true);
    setFileError(null);
    try {
      const res = await fetchWithStepUp(`${API_URL}/api/files/mkdir`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ dirPath: currentPath, name: newDirName.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setNewDirName('');
        setShowCreateFolder(false);
        await loadFiles(currentPath);
      } else {
        setFileError(data.error || 'Lỗi tạo thư mục mới');
      }
    } catch (err: any) {
      setFileError('Lỗi kết nối: ' + err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const createNewFile = async () => {
    if (!sessionReady || !newFileName.trim()) return;
    setFileLoading(true);
    setFileError(null);
    try {
      const res = await fetchWithStepUp(`${API_URL}/api/files/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ dirPath: currentPath, name: newFileName.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setNewFileName('');
        setShowCreateFile(false);
        await loadFiles(currentPath);
        await openFile(data.path);
      } else {
        setFileError(data.error || 'Lỗi tạo tệp mới');
      }
    } catch (err: any) {
      setFileError('Lỗi kết nối: ' + err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const downloadFile = async (filePath: string) => {
    if (!sessionReady) return;
    setFileError(null);
    try {
      const res = await fetch(`${API_URL}/api/files/download?path=${encodeURIComponent(filePath)}`, {
        credentials: 'include'
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Không thể tải tệp');
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filePath.split('/').pop() || 'download';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error: any) { setFileError(error.message); }
  };

  const moveOrRename = async (filePath: string) => {
    if (!sessionReady) return;
    const currentName = filePath.split('/').pop() || '';
    const newName = prompt('Tên mới:', currentName)?.trim();
    if (!newName || newName === currentName) return;
    const res = await fetchWithStepUp(`${API_URL}/api/files/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sourcePath: filePath, destinationDir: currentPath, newName })
    });
    const data = await res.json();
    if (!data.success) setFileError(data.error || 'Không thể đổi tên');
    else await loadFiles(currentPath);
  };

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);
  const [securityStatus, setSecurityStatus] = useState<{ twoFactorEnabled: boolean; twoFactorAvailable: boolean; recoveryCodesRemaining: number; sessions: SecuritySession[] } | null>(null);
  const [twoFactorPassword, setTwoFactorPassword] = useState('');
  const [twoFactorSetup, setTwoFactorSetup] = useState<{ secret: string; qrCode: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [newUser, setNewUser] = useState<{ username: string; password: string; role: UserRole }>({ username: '', password: '', role: 'viewer' });
  const [stepUpPrompt, setStepUpPrompt] = useState<{ resolve: (granted: boolean) => void } | null>(null);
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpError, setStepUpError] = useState<string | null>(null);

  const submitStepUp = async () => {
    setStepUpError(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/step-up`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: stepUpPassword, code: stepUpCode }) });
      const data = await res.json(); if (!data.success) throw new Error(data.error || 'Xác nhận thất bại');
      const prompt = stepUpPrompt; setStepUpPrompt(null); setStepUpPassword(''); setStepUpCode(''); prompt?.resolve(true);
    } catch (err: any) { setStepUpError(err.message); }
  };
  const cancelStepUp = () => { const prompt = stepUpPrompt; setStepUpPrompt(null); setStepUpPassword(''); setStepUpCode(''); setStepUpError(null); prompt?.resolve(false); };

  // Terminal and socket refs
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<any>(null);
  const socketInstance = useRef<Socket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Stable refs to always access latest fontSize/theme inside effects without adding them as deps
  const fontSizeRef = useRef<number>(fontSize);
  const themeRef = useRef<string>(theme);
  useEffect(() => { fontSizeRef.current = fontSize; }, [fontSize]);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const autoScrollRef = useRef<boolean>(true);

  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  const exportTerminalHistory = () => {
    if (!xtermInstance.current) return;
    try {
      const activeBuffer = xtermInstance.current.buffer.active;
      let text = '';
      for (let i = 0; i < activeBuffer.length; i++) {
        const line = activeBuffer.getLine(i);
        if (line) {
          text += line.translateToString(true) + '\n';
        }
      }
      
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.id = 'download-temp-link';
      link.href = url;
      link.download = `terminal_scrollback_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Lỗi khi xuất dữ liệu terminal:', err);
    }
  };

  const clearTerminal = () => {
    if (xtermInstance.current) {
      xtermInstance.current.clear();
      xtermInstance.current.focus();
    }
  };

  const handleInsertCommand = (cmd: string) => {
    if (socketInstance.current && socketInstance.current.connected) {
      socketInstance.current.emit('input', cmd + '\r');
      if (xtermInstance.current) {
        xtermInstance.current.focus();
      }
    }
  };

  // Fetch log history and current preferences
  const loadLogs = useCallback(async (offset = logOffset) => {
    if (!sessionReady) return;
    try {
      const params = new URLSearchParams({ offset: String(offset), limit: '50' });
      if (logQuery.trim()) params.set('q', logQuery.trim());
      if (logCategory) params.set('category', logCategory);
      if (logLevel) params.set('level', logLevel);
      if (logResult) params.set('result', logResult);
      const res = await fetch(`${API_URL}/api/logs?${params}`, {
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs);
        setLogTotal(data.total || 0);
        setLogOffset(offset);
      }
    } catch (err) {
      console.error('Failed to load logs:', err);
    }
  }, [sessionReady, logOffset, logQuery, logCategory, logLevel, logResult]);

  const exportAuditLogs = async (format: 'json' | 'csv') => {
    const params = new URLSearchParams({ format });
    if (logQuery.trim()) params.set('q', logQuery.trim());
    if (logCategory) params.set('category', logCategory);
    if (logLevel) params.set('level', logLevel);
    if (logResult) params.set('result', logResult);
    const res = await fetch(`${API_URL}/api/logs/export?${params}`, { credentials: 'include' });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob()); const link = document.createElement('a');
    link.href = url; link.download = `audit-log.${format}`; link.click(); URL.revokeObjectURL(url);
  };

  const checkLogIntegrity = async () => {
    const res = await fetch(`${API_URL}/api/logs/integrity`, { credentials: 'include' });
    const data = await res.json();
    if (data.success) setLogIntegrity(data);
  };

  const loadMetrics = useCallback(async () => {
    if (!sessionReady) return;
    try {
      const res = await fetch(`${API_URL}/api/metrics`, {
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success) {
        setCpuPercent(data.cpu);
        setMemUsedMB(data.memUsedMB);
        setMemTotalMB(data.memTotalMB);
        setMemPercent(data.memPercent);
        setDiskUsedGB(data.diskUsedGB);
        setDiskTotalGB(data.diskTotalGB);
        setDiskPercent(data.diskPercent);
      }
    } catch {
      // Silently ignore metrics errors
    }
  }, [sessionReady]);

  const loadSettings = useCallback(async () => {
    if (!sessionReady) return;
    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success && data.settings) {
        setFontSize(parseInt(data.settings.fontSize) || 14);
        setTheme(data.settings.theme || 'dark-classic');
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      // Mark settings as loaded after initial load triggers state updates
      setTimeout(() => {
        isSettingsLoadedRef.current = true;
      }, 300);
    }
  }, [sessionReady]);

  const saveSettings = useCallback(async (newSize: number, newTheme: string) => {
    if (!sessionReady) return;
    const shouldShowStatus = isSettingsLoadedRef.current;
    if (shouldShowStatus) {
      Promise.resolve().then(() => {
        setSaveStatus('saving');
      });
    }
    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fontSize: newSize, theme: newTheme })
      });
      const data = await res.json();
      if (data.success) {
        if (shouldShowStatus) {
          setSaveStatus('saved');
          if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
          }
          saveTimeoutRef.current = setTimeout(() => {
            setSaveStatus('idle');
          }, 3000);
        }
      } else {
        if (shouldShowStatus) {
          setSaveStatus('error');
        }
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      if (shouldShowStatus) {
        setSaveStatus('error');
      }
    }
  }, [sessionReady]);

  // Check if session already exists on load
  useEffect(() => {
    localStorage.removeItem('vps_terminal_token');
    setTimeout(() => setLoading(true), 0);
    fetch(`${API_URL}/api/auth/verify`, {
      method: 'POST',
      credentials: 'include'
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setCurrentUser(data.user);
          setSessionReady(true);
          setIsAuthenticated(true);
        } else {
          setSessionReady(false);
          setIsAuthenticated(false);
        }
      })
      .catch(() => {
        setIsAuthenticated(false);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const timer = setTimeout(() => {
      loadSettings();
      loadFiles(getSavedFilePath(), null, 'push', true);
    }, 0);
    return () => clearTimeout(timer);
  }, [sessionReady, loadSettings, loadFiles]);

  useEffect(() => {
    if (!sessionReady || activeTab !== 'logs') return;
    const timer = setTimeout(() => loadLogs(0), 0);
    return () => clearTimeout(timer);
  }, [sessionReady, activeTab, loadLogs]);

  useEffect(() => {
    if (!sessionReady || activeTab !== 'system') return;
    const timer = setTimeout(() => loadSystemData(systemView), 0); return () => clearTimeout(timer);
  }, [sessionReady, activeTab, systemView, loadSystemData]);

  useEffect(() => {
    if (!sessionReady || activeTab !== 'sqlite') return;
    const timer = setTimeout(() => loadSqliteFiles(), 0); return () => clearTimeout(timer);
  }, [sessionReady, activeTab, loadSqliteFiles]);

  // Handle master password validation
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (data.success) {
        if (data.requiresTwoFactor) {
          setTwoFactorChallenge(data.challenge);
          setPassword('');
          return;
        }
        setSessionReady(true);
        setCurrentUser(data.user);
        setIsAuthenticated(true);
      } else {
        setError(data.error || 'Authentication failed');
      }
    } catch {
      setError('Connection to server authentication API failed');
    } finally {
      setLoading(false);
    }
  };

  const handleTwoFactorLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorChallenge || !twoFactorCode.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/2fa`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge: twoFactorChallenge, code: twoFactorCode.trim() })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Mã xác thực không hợp lệ');
      setTwoFactorChallenge(null); setTwoFactorCode(''); setCurrentUser(data.user); setSessionReady(true); setIsAuthenticated(true);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const loadSecurity = useCallback(async () => {
    if (!sessionReady) return;
    try {
      const res = await fetch(`${API_URL}/api/security`, { credentials: 'include' });
      const data = await res.json();
      if (data.success) setSecurityStatus(data);
    } catch (err) { console.error('Failed to load security status:', err); }
  }, [sessionReady, setSecurityStatus]);

  const securityRequest = async (endpoint: string, options: RequestInit = {}) => {
    setSecurityMessage(null);
    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options, credentials: 'include',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Thao tác bảo mật thất bại');
    return data;
  };

  const startTwoFactorSetup = async () => {
    try {
      const data = await securityRequest('/api/security/2fa/setup', { method: 'POST', body: JSON.stringify({ password: twoFactorPassword }) });
      setTwoFactorSetup({ secret: data.secret, qrCode: data.qrCode }); setTwoFactorCode('');
    } catch (err: any) { setSecurityMessage(err.message); }
  };

  const confirmTwoFactorSetup = async () => {
    try {
      const data = await securityRequest('/api/security/2fa/confirm', { method: 'POST', body: JSON.stringify({ code: twoFactorCode }) });
      setRecoveryCodes(data.recoveryCodes); setTwoFactorSetup(null); setTwoFactorPassword(''); setTwoFactorCode(''); setSecurityMessage('Đã bật xác thực hai lớp. Hãy lưu các mã khôi phục.'); await loadSecurity();
    } catch (err: any) { setSecurityMessage(err.message); }
  };

  const disableTwoFactor = async () => {
    if (!confirm('Tắt xác thực hai lớp?')) return;
    try {
      await securityRequest('/api/security/2fa/disable', { method: 'POST', body: JSON.stringify({ password: twoFactorPassword, code: twoFactorCode }) });
      setTwoFactorPassword(''); setTwoFactorCode(''); setRecoveryCodes([]); setSecurityMessage('Đã tắt xác thực hai lớp.'); await loadSecurity();
    } catch (err: any) { setSecurityMessage(err.message); }
  };

  const revokeSession = async (id?: string) => {
    try {
      await securityRequest(id ? `/api/security/sessions/${id}` : '/api/security/sessions', { method: 'DELETE' });
      setSecurityMessage(id ? 'Đã thu hồi phiên.' : 'Đã thu hồi tất cả phiên khác.'); await loadSecurity();
    } catch (err: any) { setSecurityMessage(err.message); }
  };

  const loadUsers = useCallback(async () => {
    if (!sessionReady || currentUser?.role !== 'root') return;
    const res = await fetch(`${API_URL}/api/users`, { credentials: 'include' }); const data = await res.json();
    if (data.success) setManagedUsers(data.users);
  }, [sessionReady, currentUser, setManagedUsers]);

  const createUser = async () => {
    try {
      await securityRequest('/api/users', { method: 'POST', body: JSON.stringify(newUser) });
      setNewUser({ username: '', password: '', role: 'viewer' }); setSecurityMessage('Đã tạo tài khoản.'); await loadUsers();
    } catch (err: any) { setSecurityMessage(err.message); }
  };

  const updateUser = async (id: string, changes: Record<string, unknown>) => {
    try { await securityRequest(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }); await loadUsers(); }
    catch (err: any) { setSecurityMessage(err.message); }
  };

  const deleteUser = async (id: string) => {
    if (!confirm('Xóa tài khoản và toàn bộ phiên của tài khoản này?')) return;
    try { await securityRequest(`/api/users/${id}`, { method: 'DELETE' }); await loadUsers(); }
    catch (err: any) { setSecurityMessage(err.message); }
  };

  useEffect(() => {
    if (!sessionReady || activeTab !== 'settings') return;
    const timer = setTimeout(() => loadSecurity(), 0);
    return () => clearTimeout(timer);
  }, [sessionReady, activeTab, loadSecurity]);

  useEffect(() => {
    if (!sessionReady || activeTab !== 'settings' || currentUser?.role !== 'root') return;
    const timer = setTimeout(() => loadUsers(), 0); return () => clearTimeout(timer);
  }, [sessionReady, activeTab, currentUser, loadUsers]);

  // Handle password modification
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(null);

    if (newPassword !== confirmPassword) {
      setPwdError('New passwords do not match');
      return;
    }

    if (newPassword.length < 12) {
      setPwdError('New password must be at least 12 characters long');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/settings/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();

      if (data.success) {
        setPwdSuccess('Master password changed successfully!');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        loadLogs();
      } else {
        setPwdError(data.error || 'Failed to change password');
      }
    } catch {
      setPwdError('Server connection error during password update');
    } finally {
      setLoading(false);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    if (socketInstance.current) {
      socketInstance.current.disconnect();
    }
    
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (e) {
      console.error(e);
    }

    setSessionReady(false);
    setCurrentUser(null);
    setIsAuthenticated(false);
    setPassword('');
  };

  // Convert theme keys to xterm configuration colors
  const getTerminalColors = (themeKey: string) => {
    switch (themeKey) {
      case 'matrix':
        return {
          background: '#02120b',
          foreground: '#39ff14',
          cursor: '#39ff14',
          black: '#000000',
          red: '#ff5555',
          green: '#39ff14',
          yellow: '#ffb86c',
          blue: '#bd93f9',
          magenta: '#ff79c6',
          cyan: '#8be9fd',
          white: '#f8f8f2',
        };
      case 'amber':
        return {
          background: '#120b00',
          foreground: '#ffb200',
          cursor: '#ffb200',
          black: '#000000',
          red: '#d9534f',
          green: '#5cb85c',
          yellow: '#f0ad4e',
          blue: '#0275d8',
          magenta: '#e11d48',
          cyan: '#5bc0de',
          white: '#f7f7f7',
        };
      case 'cyberpunk':
        return {
          background: '#13001c',
          foreground: '#00ffff',
          cursor: '#ff007f',
          black: '#1a1a24',
          red: '#ff0055',
          green: '#00ff66',
          yellow: '#ffe600',
          blue: '#0099ff',
          magenta: '#ff00ff',
          cyan: '#00ffff',
          white: '#ffffff',
        };
      case 'dracula':
        return {
          background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2',
          black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
          blue: '#6272a4', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
        };
      case 'tokyo-night':
        return {
          background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5',
          black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
          blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
        };
      case 'nord':
        return {
          background: '#2e3440', foreground: '#d8dee9', cursor: '#88c0d0',
          black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
          blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
        };
      case 'solarized-dark':
        return {
          background: '#002b36', foreground: '#839496', cursor: '#93a1a1',
          black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
          blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
        };
      case 'solarized-light':
        return {
          background: '#fdf6e3', foreground: '#657b83', cursor: '#586e75',
          black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
          blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
        };
      case 'gruvbox':
        return {
          background: '#282828', foreground: '#ebdbb2', cursor: '#fabd2f',
          black: '#1d2021', red: '#fb4934', green: '#b8bb26', yellow: '#fabd2f',
          blue: '#83a598', magenta: '#d3869b', cyan: '#8ec07c', white: '#fbf1c7',
        };
      case 'one-dark':
        return {
          background: '#282c34', foreground: '#abb2bf', cursor: '#528bff',
          black: '#1e2127', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
          blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#d7dae0',
        };
      case 'github-light':
        return {
          background: '#ffffff', foreground: '#24292f', cursor: '#0969da',
          black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#9a6700',
          blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#f6f8fa',
        };
      case 'dark-classic':
      default:
        return {
          background: '#0f172a', // slate-900
          foreground: '#f8fafc', // slate-50
          cursor: '#38bdf8', // sky-400
          black: '#1e293b',
          red: '#ef4444',
          green: '#22c55e',
          yellow: '#eab308',
          blue: '#3b82f6',
          magenta: '#a855f7',
          cyan: '#06b6d4',
          white: '#f1f5f9',
        };
    }
  };

  // Main Terminal Mounting & Socket Connection logic
  useEffect(() => {
    if (!isAuthenticated || !sessionReady || activeTab !== 'terminal') {
      // Disconnect socket if navigating away from terminal tab
      if (socketInstance.current) {
        socketInstance.current.disconnect();
        socketInstance.current = null;
      }
      if (xtermInstance.current) {
        xtermInstance.current.dispose();
        xtermInstance.current = null;
      }
      return;
    }

    let isMounted = true;
    let term: any = null;
    let fitAddon: any = null;
    let socket: Socket | null = null;
    let contextMenuHandler: ((event: MouseEvent) => void) | null = null;
    let terminalElement: HTMLDivElement | null = null;

    const setupTerminal = async () => {
      // AnimatePresence can delay mounting the dashboard after authentication.
      // Wait briefly for the terminal container instead of abandoning setup.
      for (let attempt = 0; attempt < 40 && !terminalRef.current; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        if (!isMounted) return;
      }

      if (!terminalRef.current) {
        console.error('[TERMINAL] Container did not mount in time.');
        return;
      }

      // Load Xterm.js packages dynamically to prevent server-side errors
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');

      if (!isMounted || !terminalRef.current) return;
      terminalElement = terminalRef.current;

      // Create new terminal instance
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontFamily: '"JetBrains Mono", "Fira Code", Courier, monospace',
        fontSize: fontSizeRef.current,
        lineHeight: 1.25,
        theme: getTerminalColors(themeRef.current),
        scrollback: 5000,
        allowProposedApi: true
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalElement);
      
      // Force instant resize computation
      setTimeout(() => {
        if (isMounted && fitAddon) {
          fitAddon.fit();
        }
      }, 150);

      xtermInstance.current = term;

      const copySelection = async () => {
        const selection = term.getSelection();
        if (selection) await navigator.clipboard.writeText(selection);
      };

      const pasteClipboard = async () => {
        const text = await navigator.clipboard.readText();
        if (text && socket?.connected) socket.emit('input', text);
        term.focus();
      };

      term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true;

        if (event.key.toLowerCase() === 'c') {
          copySelection().catch(error => console.error('[TERMINAL] Copy failed:', error));
          return false;
        }

        if (event.key.toLowerCase() === 'v') {
          pasteClipboard().catch(error => console.error('[TERMINAL] Paste failed:', error));
          return false;
        }

        return true;
      });

      contextMenuHandler = (event) => {
        event.preventDefault();
        const clipboardAction = term.hasSelection() ? copySelection() : pasteClipboard();
        clipboardAction.catch(error => console.error('[TERMINAL] Clipboard action failed:', error));
      };
      terminalElement.addEventListener('contextmenu', contextMenuHandler);

      // Welcome Banner in terminal
      term.writeln('\x1b[38;5;86m╔═════════════════════════════════════════════════════════════╗\x1b[0m');
      term.writeln('\x1b[38;5;86m║             SELF-HOSTED WEB VPS SHELL TERMINAL              ║\x1b[0m');
      term.writeln('\x1b[38;5;86m╚═════════════════════════════════════════════════════════════╝\x1b[0m');
      term.writeln('\x1b[33mConnecting to local VPS shell process...\x1b[0m');

      const ticketResponse = await fetch(`${API_URL}/api/auth/socket-ticket`, { method: 'POST', credentials: 'include' });
      const ticketData = await ticketResponse.json();
      if (!ticketData.success) throw new Error(ticketData.error || 'Không thể cấp vé kết nối terminal');

      socket = io(API_URL || undefined, {
        auth: { ticket: ticketData.ticket, cwd: pendingTerminalCwdRef.current || undefined },
        reconnectionDelay: 2000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
      });

      socketInstance.current = socket;
      pendingTerminalCwdRef.current = null;

      // Connection state listeners
      socket.on('connect', () => {
        term.writeln('\x1b[32m✔ Connected to real-time process manager successfully.\x1b[0m');
        term.writeln('\x1b[90mPress Enter to start interacting with the terminal.\x1b[0m\r\n');
        fitAddon.fit();
        socket?.emit('resize', { cols: term.cols, rows: term.rows });
        term.focus();
      });

      socket.on('connect_error', async (err) => {
        term.writeln(`\r\n\x1b[31m✖ Connection failed: ${err.message}\x1b[0m\r\n`);
        if (!isMounted || !socket || socket.connected) return;
        try {
          const response = await fetch(`${API_URL}/api/auth/socket-ticket`, { method: 'POST', credentials: 'include' });
          const data = await response.json();
          if (data.success && isMounted && socket) {
            socket.auth = { ticket: data.ticket, cwd: pendingTerminalCwdRef.current || undefined };
            socket.connect();
          }
        } catch (error) {
          console.error('[TERMINAL] Failed to refresh connection ticket:', error);
        }
      });

      // Stream data from server to terminal
      socket.on('output', (data: string) => {
        if (term) {
          if (autoScrollRef.current) {
            term.write(data);
            term.scrollToBottom();
          } else {
            const previousViewportY = term.buffer.active.viewportY;
            term.write(data);
            term.scrollToLine(previousViewportY);
          }
        }
      });

      // Forward user keyboard input to server shell
      term.onData((data: string) => {
        if (socket && socket.connected) {
          socket.emit('input', data);
        }
      });

      // Observe terminal panel resize and communicate dimensions
      if (typeof window !== 'undefined') {
        resizeObserverRef.current = new ResizeObserver(() => {
          if (isMounted && fitAddon) {
            try {
              fitAddon.fit();
              if (socket?.connected) {
                socket.emit('resize', { cols: term.cols, rows: term.rows });
              }
            } catch {
              // Ignore occasional race dimension fitting errors on fast toggling
            }
          }
        });
        resizeObserverRef.current.observe(terminalElement);
      }
    };

    setupTerminal().catch((error) => {
      console.error('[TERMINAL] Failed to initialize:', error);
      if (terminalRef.current) {
        terminalRef.current.textContent = `Không thể khởi tạo terminal: ${error instanceof Error ? error.message : String(error)}`;
        terminalRef.current.classList.add('p-3', 'font-mono', 'text-sm', 'text-red-400');
      }
    });

    return () => {
      isMounted = false;
      if (contextMenuHandler && terminalElement) {
        terminalElement.removeEventListener('contextmenu', contextMenuHandler);
      }
      if (socket) {
        socket.disconnect();
      }
      if (term) {
        term.dispose();
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, [isAuthenticated, sessionReady, activeTab]);

  // Handle dynamic font size or theme adjustment in living terminal
  useEffect(() => {
    if (xtermInstance.current) {
      xtermInstance.current.options.fontSize = fontSize;
      xtermInstance.current.options.theme = getTerminalColors(theme);
      // Wait for font styling to re-render in container, then fit
      setTimeout(async () => {
        try {
          const { FitAddon } = await import('@xterm/addon-fit');
          const fitAddon = new FitAddon();
          xtermInstance.current.loadAddon(fitAddon);
          fitAddon.fit();
        } catch {}
      }, 50);
    }
    setTimeout(() => {
      saveSettings(fontSize, theme);
    }, 0);
  }, [fontSize, theme, saveSettings]);

  // Poll system metrics every 5 seconds when authenticated
  useEffect(() => {
    if (!isAuthenticated || !sessionReady) return;
    // Use setTimeout(0) to avoid setState-in-effect lint error
    const initialTimer = setTimeout(() => loadMetrics(), 0);
    const interval = setInterval(() => loadMetrics(), 5000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [isAuthenticated, sessionReady, loadMetrics]);

  // Loading indicator for verification check
  if (isAuthenticated === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0c] text-slate-100 font-sans">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-4" />
        <p className="text-sm text-slate-400">Đang xác thực phiên bảo mật...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#0a0a0c] text-slate-300 font-sans selection:bg-blue-500/30 selection:text-white">
      <AnimatePresence mode="wait">
        {!isAuthenticated ? (
          // 1. Sleek Password Protected Authorization Screen
          <motion.div
            key="login"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="fixed inset-0 bg-[#0a0a0c] flex items-center justify-center p-6 z-50 overflow-y-auto"
          >
            <div className="w-full max-w-md p-8 bg-[#16161d] border border-white/10 rounded-xl shadow-2xl shadow-black relative overflow-hidden">
              {/* Subtle top decoration glow */}
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />
              
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-500/10 mb-4 border border-blue-500/20">
                  {twoFactorChallenge ? <ShieldCheck className="w-6 h-6 text-blue-500" /> : <Lock className="w-6 h-6 text-blue-500" />}
                </div>
                <h2 className="text-lg font-semibold text-white tracking-tight">{twoFactorChallenge ? 'Xác Thực Hai Lớp' : 'Yêu Cầu Xác Thực'}</h2>
                <p className="text-sm text-slate-500 mt-1">{twoFactorChallenge ? 'Nhập mã 6 số hoặc mã khôi phục' : 'Nhập khóa truy cập VPS để khởi tạo Node-PTY'}</p>
              </div>

              <form onSubmit={twoFactorChallenge ? handleTwoFactorLogin : handleLogin} className="space-y-5">
                {!twoFactorChallenge && <input type="text" required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tên đăng nhập" autoComplete="username" className="w-full bg-black border border-white/10 rounded-lg py-3 px-4 text-center text-white focus:outline-none focus:border-blue-500" />}
                <div>
                  <input
                    type={twoFactorChallenge ? 'text' : 'password'}
                    required
                    placeholder={twoFactorChallenge ? '123456' : '••••••••••••'}
                    value={twoFactorChallenge ? twoFactorCode : password}
                    onChange={(e) => twoFactorChallenge ? setTwoFactorCode(e.target.value) : setPassword(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-lg py-3 px-4 text-center text-white focus:outline-none focus:border-blue-500 transition-colors tracking-widest text-lg"
                    autoComplete={twoFactorChallenge ? 'one-time-code' : 'current-password'}
                    autoFocus
                  />
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="flex items-start gap-2.5 p-3 rounded-lg bg-red-950/30 border border-red-900/40 text-red-400 text-xs font-mono"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </motion.div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)] disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Key className="w-4 h-4" />
                      <span>{twoFactorChallenge ? 'XÁC NHẬN MÃ' : 'KẾT NỐI SHELL'}</span>
                    </>
                  )}
                </button>
                {twoFactorChallenge && <button type="button" onClick={() => { setTwoFactorChallenge(null); setTwoFactorCode(''); setError(null); }} className="w-full text-xs text-slate-500 hover:text-white">Quay lại nhập mật khẩu</button>}
              </form>

              <p className="mt-6 text-[10px] text-center text-slate-600 uppercase tracking-wider font-mono">
                Các phiên đã xác thực được ghi nhật ký vào SQLite nội bộ
              </p>
            </div>
          </motion.div>
        ) : (
          // 2. Fully Loaded Interactive Web Terminal Sleek Dashboard
          <motion.div
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col w-full h-screen overflow-hidden bg-[#0a0a0c]"
          >
            {/* Top Navigation Bar */}
            <header className="h-14 border-b border-white/10 bg-[#111116] flex items-center justify-between px-6 shrink-0 z-10">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                  className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-white/5 transition"
                >
                  <Menu className="w-4 h-4" />
                </button>
                <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
                <h1 className="text-xs sm:text-sm font-bold tracking-tight text-white uppercase flex items-center gap-2">
                  Terminal NodeShell 
                  <span className="text-slate-500 font-normal">v1.1.0</span>
                </h1>
              </div>

              <div className="flex items-center gap-4 sm:gap-8">
                <div className="hidden md:flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-[9px] uppercase text-slate-500 leading-none mb-1">Cơ sở dữ liệu</p>
                    <p className="text-xs font-mono text-blue-400 font-semibold uppercase">SQLite Đang Hoạt Động</p>
                  </div>
                  <div className="h-8 w-[1px] bg-white/10"></div>
                  <div className="text-right">
                    <p className="text-[9px] uppercase text-slate-500 leading-none mb-1">Trạng thái kết nối</p>
                    <p className="text-xs font-mono text-emerald-400 font-semibold uppercase flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                      ĐÃ ĐỒNG BỘ
                    </p>
                  </div>
                </div>

                <button 
                  onClick={handleLogout}
                  className="px-4 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold rounded border border-red-500/30 transition-colors cursor-pointer"
                >
                  CHẤM DỨT PHIÊN
                </button>
              </div>
            </header>

            {/* Main Content Area */}
            <div className="flex flex-1 overflow-hidden">
              {/* COLLAPSIBLE SIDEBAR */}
              <AnimatePresence initial={false}>
                {isSidebarOpen && (
                  <motion.aside
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 280, opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    className="bg-[#0d0d12] border-r border-white/10 flex flex-col h-full shrink-0 overflow-y-auto"
                  >
                    {/* System Resource Widgets */}
                    <div className="p-5 border-b border-white/10 space-y-5">
                      <h3 className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">GIÁM SÁT HỆ THỐNG</h3>
                      
                      <div>
                        <div className="flex justify-between items-end mb-1.5">
                          <label className="text-[9px] uppercase font-bold text-slate-500">Tải CPU</label>
                          <span className="text-xs font-mono text-white">{cpuPercent}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${cpuPercent}%` }}></div>
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between items-end mb-1.5">
                          <label className="text-[9px] uppercase font-bold text-slate-500">Sử dụng Bộ nhớ</label>
                          <span className="text-xs font-mono text-white">{memUsedMB}MB / {memTotalMB}MB</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-500 transition-all duration-500" style={{ width: `${memPercent}%` }}></div>
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between items-end mb-1.5">
                          <label className="text-[9px] uppercase font-bold text-slate-500">Dung lượng ổ đĩa</label>
                          <span className="text-xs font-mono text-white">{diskUsedGB}GB / {diskTotalGB}GB</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${diskPercent >= 90 ? 'bg-red-500' : diskPercent >= 75 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${diskPercent}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    {/* Navigation Menu */}
                    <div className="p-4 border-b border-white/10">
                      <h3 className="text-[10px] uppercase font-bold text-slate-500 tracking-widest mb-3 px-2">DI CHUYỂN</h3>
                      <nav className="space-y-1">
                        {currentUser && ['admin', 'root'].includes(currentUser.role) && <button
                          onClick={() => setActiveTab('terminal')}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition cursor-pointer ${
                            activeTab === 'terminal' 
                              ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' 
                              : 'text-slate-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <TerminalIcon className="w-4 h-4" />
                          <span>Cửa Sổ Dòng Lệnh</span>
                        </button>}

                        {currentUser && ['admin', 'root'].includes(currentUser.role) && <button onClick={() => setActiveTab('system')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition ${activeTab === 'system' ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><Database className="w-4 h-4" /><span>Hệ Thống</span></button>}

                        {currentUser && ['admin', 'root'].includes(currentUser.role) && <button onClick={() => setActiveTab('sqlite')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition ${activeTab === 'sqlite' ? 'bg-emerald-600/10 text-emerald-400 border border-emerald-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><Database className="w-4 h-4" /><span>Quản Lý SQLite</span></button>}

                        {currentUser && ['admin', 'root'].includes(currentUser.role) && <button
                          onClick={() => {
                            setActiveTab('logs');
                            loadLogs();
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition cursor-pointer ${
                            activeTab === 'logs' 
                              ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' 
                              : 'text-slate-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <History className="w-4 h-4" />
                          <span>Nhật Ký Bảo Mật</span>
                        </button>}

                        <button
                          onClick={() => {
                            setActiveTab('files');
                            loadFiles(currentPath || getSavedFilePath());
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition cursor-pointer ${
                            activeTab === 'files' 
                              ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' 
                              : 'text-slate-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <Folder className="w-4 h-4" />
                          <span>Quản Lý Tệp Tin</span>
                        </button>

                        <button
                          onClick={() => setActiveTab('settings')}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition cursor-pointer ${
                            activeTab === 'settings' 
                              ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' 
                              : 'text-slate-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <Settings className="w-4 h-4" />
                          <span>Cấu Hình</span>
                        </button>
                      </nav>
                    </div>

                    {/* Interactive Logs in Sidebar */}
                    <div className="p-5 mt-auto">
                      <h3 className="text-[10px] uppercase font-bold text-slate-500 mb-3 tracking-widest">ĐĂNG NHẬP GẦN ĐÂY</h3>
                      <div className="space-y-3 font-mono text-[11px] leading-relaxed">
                        {logs.slice(0, 3).map((log, i) => (
                          <div key={i} className="border-b border-white/5 pb-2 last:border-0 last:pb-0">
                            <p className="text-slate-400 text-[10px]">{new Date(log.timestamp).toLocaleTimeString()}</p>
                            <p className="text-slate-500 truncate">
                              IP: <span className="text-blue-400">{log.ip}</span> • {log.event.includes('fail') ? <span className="text-red-400 font-bold">LỖI</span> : <span className="text-emerald-400 font-bold">OK</span>}
                            </p>
                          </div>
                        ))}
                        {logs.length === 0 && (
                          <p className="text-slate-600 italic">Chưa ghi nhận lượt kết nối nào.</p>
                        )}
                      </div>
                    </div>
                  </motion.aside>
                )}
              </AnimatePresence>

              {/* MAIN CONTENT INNER */}
              <main className="flex-1 flex flex-col overflow-hidden bg-black">
                {/* Dynamic Workspace Rendering */}
                <div className="flex-1 overflow-hidden relative">
                  <AnimatePresence mode="wait">
                    {/* TAB 1: Real-time Terminal Canvas */}
                    {activeTab === 'terminal' && currentUser && ['admin', 'root'].includes(currentUser.role) && (
                      <motion.div
                        key="terminal-tab"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="w-full h-full p-6 bg-black flex flex-col"
                      >
                        {/* Quick Commands & Info Header Bar */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-[#0d0d12] border border-white/10 border-b-0 rounded-t-lg px-4 py-3 gap-3 shrink-0">
                          <div className="flex items-center gap-2 font-mono text-xs text-white">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span>Phiên dòng lệnh chuẩn (tty)</span>
                          </div>

                          {/* Quick Commands Selector */}
                          <div className="flex items-center gap-2 w-full sm:w-auto">
                            <span className="text-[10px] uppercase font-bold text-slate-500 font-mono whitespace-nowrap">Lệnh nhanh:</span>
                            <select
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val) {
                                  handleInsertCommand(val);
                                  e.target.value = ''; // Reset selection
                                }
                              }}
                              className="w-full sm:w-64 bg-black hover:bg-[#111116] border border-white/10 hover:border-white/20 text-xs font-mono text-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 transition cursor-pointer"
                              defaultValue=""
                              id="select-quick-commands"
                            >
                              <option value="" disabled>-- Chọn lệnh nhanh --</option>
                              <optgroup label="Hệ Thống & Tài Nguyên" className="text-slate-400 bg-[#0d0d12]">
                                <option value="top" className="text-white">top (Giám sát quy trình)</option>
                                <option value="df -h" className="text-white">df -h (Xem dung lượng đĩa)</option>
                                <option value="free -m" className="text-white">free -m (Xem RAM trống)</option>
                                <option value="uname -a" className="text-white">uname -a (Thông tin kernel)</option>
                                <option value="uptime" className="text-white">uptime (Thời gian hoạt động)</option>
                              </optgroup>
                              <optgroup label="Tệp Tin & Thư Mục" className="text-slate-400 bg-[#0d0d12]">
                                <option value="ls -la" className="text-white">ls -la (Liệt kê tệp chi tiết)</option>
                                <option value="pwd" className="text-white">pwd (Đường dẫn hiện tại)</option>
                              </optgroup>
                              <optgroup label="Mạng & Kết Nối" className="text-slate-400 bg-[#0d0d12]">
                                <option value="ping -c 4 google.com" className="text-white">ping -c 4 google.com (Kiểm tra mạng)</option>
                                <option value="ifconfig" className="text-white">ifconfig (Cấu hình mạng)</option>
                                <option value="netstat -tuln" className="text-white">netstat -tuln (Cổng đang mở)</option>
                              </optgroup>
                              <optgroup label="Phát Triển & Quản Lý" className="text-slate-400 bg-[#0d0d12]">
                                <option value="node -v" className="text-white">node -v (Phiên bản Node.js)</option>
                                <option value="npm -v" className="text-white">npm -v (Phiên bản NPM)</option>
                                <option value="git status" className="text-white">git status (Trạng thái Git)</option>
                              </optgroup>
                            </select>
                          </div>
                        </div>

                        {/* Terminal wrapper */}
                        <div className="flex-1 rounded-b-lg bg-black border border-white/10 overflow-hidden relative p-4 shadow-2xl">
                          <div 
                            ref={terminalRef} 
                            className="w-full h-full [&_.xterm-viewport]:!overflow-y-auto" 
                            title="Chuột phải: sao chép vùng chọn hoặc dán | Ctrl+Shift+C / Ctrl+Shift+V"
                          />
                        </div>
                        <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between text-[11px] text-slate-500 font-mono px-1 gap-2">
                          <span className="text-emerald-500/80 font-semibold">[HỆ THỐNG] Chuột phải: sao chép vùng chọn hoặc dán | Ctrl+Shift+C / Ctrl+Shift+V</span>
                          <div className="flex items-center gap-3 flex-wrap">
                            <label className="flex items-center gap-1.5 select-none cursor-pointer text-slate-400 hover:text-slate-300 transition-colors" id="label-autoscroll">
                              <input
                                type="checkbox"
                                checked={autoScroll}
                                onChange={(e) => setAutoScroll(e.target.checked)}
                                className="w-3.5 h-3.5 rounded border-white/10 bg-[#111116] text-blue-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-blue-500"
                                id="toggle-autoscroll"
                              />
                              <span>Tự động cuộn</span>
                            </label>
                            <span className="text-slate-700">|</span>
                            <button
                              onClick={exportTerminalHistory}
                              className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-600/10 text-blue-400 border border-blue-500/20 hover:bg-blue-600/20 hover:text-blue-300 cursor-pointer transition-colors"
                              title="Xuất lịch sử terminal"
                              id="btn-export-terminal"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Xuất log</span>
                            </button>
                            <button
                              onClick={clearTerminal}
                              className="flex items-center gap-1.5 px-2 py-1 rounded bg-rose-600/10 text-rose-400 border border-rose-500/20 hover:bg-rose-600/20 hover:text-rose-300 cursor-pointer transition-colors"
                              title="Xóa sạch màn hình terminal"
                              id="btn-clear-terminal"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Xóa màn hình</span>
                            </button>
                            <span className="text-slate-700">|</span>
                            <button 
                              onClick={() => setFontSize(prev => Math.max(10, prev - 1))}
                              className="p-1 rounded bg-[#111116] hover:bg-[#1c1c24] border border-white/10 cursor-pointer transition-colors"
                              title="Giảm cỡ chữ"
                              id="btn-decrease-font"
                            >
                              <Minus className="w-3 h-3 text-slate-400" />
                            </button>
                            <span>Cỡ chữ: {fontSize}px</span>
                            <button 
                              onClick={() => setFontSize(prev => Math.min(24, prev + 1))}
                              className="p-1 rounded bg-[#111116] hover:bg-[#1c1c24] border border-white/10 cursor-pointer transition-colors"
                              title="Tăng cỡ chữ"
                              id="btn-increase-font"
                            >
                              <Plus className="w-3 h-3 text-slate-400" />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* TAB 2: Security Event Log history */}
                    {activeTab === 'logs' && currentUser && ['admin', 'root'].includes(currentUser.role) && (
                      <motion.div
                        key="logs-tab"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="w-full h-full p-8 overflow-y-auto bg-[#0a0a0c]"
                      >
                        <div className="max-w-6xl mx-auto space-y-6">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
                            <div>
                              <h3 className="text-lg font-bold text-white uppercase tracking-wider mb-1">Nhật Ký Kiểm Toán</h3>
                              <p className="text-xs text-slate-500 font-mono">{logTotal} sự kiện xác thực, terminal và filesystem</p>
                            </div>
                            <div className="flex flex-wrap gap-2"><button onClick={checkLogIntegrity} className={`px-3 py-1.5 text-xs border rounded ${logIntegrity?.valid === false ? 'text-red-400 border-red-500/30' : logIntegrity?.valid ? 'text-emerald-400 border-emerald-500/30' : 'border-white/10'}`}>{logIntegrity ? logIntegrity.valid ? `Chuỗi hợp lệ (${logIntegrity.checked})` : `Chuỗi lỗi tại #${logIntegrity.brokenAt}` : 'Kiểm tra toàn vẹn'}</button><button onClick={() => exportAuditLogs('json')} className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded">JSON</button><button onClick={() => exportAuditLogs('csv')} className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded">CSV</button><button onClick={() => loadLogs(logOffset)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111116] text-xs border border-white/10 rounded"><RefreshCw className="w-3.5 h-3.5" />Tải lại</button></div>
                          </div>

                          <form onSubmit={(e) => { e.preventDefault(); loadLogs(0); }} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                            <input value={logQuery} onChange={(e) => setLogQuery(e.target.value)} placeholder="Tìm sự kiện, IP, lệnh..." className="lg:col-span-2 bg-black border border-white/10 rounded px-3 py-2 text-xs" />
                            <select value={logCategory} onChange={(e) => setLogCategory(e.target.value)} className="bg-black border border-white/10 rounded px-3 py-2 text-xs"><option value="">Mọi nhóm</option><option value="auth">Xác thực</option><option value="security">Bảo mật</option><option value="terminal">Terminal</option><option value="file">Tệp tin</option><option value="legacy">Cũ</option></select>
                            <select value={logLevel} onChange={(e) => setLogLevel(e.target.value)} className="bg-black border border-white/10 rounded px-3 py-2 text-xs"><option value="">Mọi mức</option><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select>
                            <div className="flex gap-2"><select value={logResult} onChange={(e) => setLogResult(e.target.value)} className="min-w-0 flex-1 bg-black border border-white/10 rounded px-2 py-2 text-xs"><option value="">Mọi kết quả</option><option value="success">Thành công</option><option value="failure">Thất bại</option></select><button type="submit" className="px-3 bg-blue-600 rounded text-xs">Lọc</button></div>
                          </form>

                          <div className="rounded-xl border border-white/10 bg-[#0d0d12]/60 overflow-hidden shadow-2xl">
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse text-sm">
                                <thead>
                                  <tr className="bg-[#111116]/80 border-b border-white/10 text-[10px] text-slate-500 font-mono uppercase tracking-widest">
                                    <th className="py-3.5 px-4 font-semibold">Mức / Nhóm</th>
                                    <th className="py-3.5 px-4 font-semibold">Mô tả sự kiện</th>
                                    <th className="py-3.5 px-5 font-semibold">Địa chỉ IP</th>
                                    <th className="py-3.5 px-5 font-semibold">Thời gian</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5 font-mono text-xs">
                                  {logs.length === 0 ? (
                                    <tr>
                                      <td colSpan={4} className="py-12 text-center text-slate-600 font-mono italic">
                                        Không có sự kiện phù hợp.
                                      </td>
                                    </tr>
                                  ) : (
                                    logs.map((log) => (
                                      <tr key={log.id} className="hover:bg-white/[0.02] transition align-top">
                                        <td className="py-3.5 px-4"><span className={`block w-fit rounded px-1.5 py-0.5 text-[9px] uppercase ${log.level === 'critical' ? 'bg-red-500/15 text-red-400' : log.level === 'warning' ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/10 text-blue-400'}`}>{log.level}</span><span className="block mt-1 text-[10px] text-slate-500">{log.category}/{log.action}</span></td>
                                        <td className="py-3.5 px-4 text-slate-300"><div>{log.event}</div>{log.metadata && <code className="block mt-1 max-w-xl whitespace-pre-wrap break-all text-[10px] text-slate-500">{JSON.stringify(log.metadata)}</code>}<span className={`mt-1 inline-block text-[9px] ${log.result === 'failure' ? 'text-red-400' : 'text-emerald-500'}`}>{log.result}</span></td>
                                        <td className="py-3.5 px-5 text-blue-400 font-semibold">{log.ip}</td>
                                        <td className="py-3.5 px-5 text-slate-500">
                                          {new Date(log.timestamp).toLocaleString()}
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-xs text-slate-500"><span>{logTotal ? `${logOffset + 1}-${Math.min(logOffset + logs.length, logTotal)} / ${logTotal}` : '0 kết quả'}</span><div className="flex gap-2"><button disabled={logOffset === 0} onClick={() => loadLogs(Math.max(0, logOffset - 50))} className="px-3 py-1.5 border border-white/10 rounded disabled:opacity-30">Trước</button><button disabled={logOffset + logs.length >= logTotal} onClick={() => loadLogs(logOffset + 50)} className="px-3 py-1.5 border border-white/10 rounded disabled:opacity-30">Sau</button></div></div>
                        </div>
                      </motion.div>
                    )}

                    {activeTab === 'system' && currentUser && ['admin', 'root'].includes(currentUser.role) && <motion.div key="system-tab" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full h-full p-6 overflow-y-auto bg-[#0a0a0c]">
                      <div className="max-w-7xl mx-auto space-y-5">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-b border-white/10 pb-4"><div className="mr-auto"><h3 className="text-lg font-bold text-white uppercase tracking-wider">Quản Trị Hệ Thống</h3><p className="text-xs text-slate-500 font-mono">systemd services và Linux processes</p></div><div className="flex rounded border border-white/10 overflow-hidden"><button onClick={() => setSystemView('services')} className={`px-3 py-2 text-xs ${systemView === 'services' ? 'bg-blue-600 text-white' : 'bg-black'}`}>Services</button><button onClick={() => setSystemView('processes')} className={`px-3 py-2 text-xs ${systemView === 'processes' ? 'bg-blue-600 text-white' : 'bg-black'}`}>Processes</button></div><button onClick={() => loadSystemData()} className="px-3 py-2 text-xs border border-white/10 rounded"><RefreshCw className={`inline w-3.5 h-3.5 mr-1 ${systemLoading ? 'animate-spin' : ''}`} />Tải lại</button></div>
                        <input value={systemQuery} onChange={(e) => setSystemQuery(e.target.value)} placeholder="Tìm service, PID, user hoặc command..." className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs" />
                        {systemError && <div className="p-3 rounded border border-red-500/20 bg-red-500/5 text-red-400 text-xs">{systemError}</div>}
                        <div className="rounded-xl border border-white/10 overflow-x-auto bg-[#0d0d12]/60"><table className="w-full text-left text-xs"><thead className="bg-[#111116] text-[10px] uppercase text-slate-500"><tr>{systemView === 'services' ? <><th className="p-3">Service</th><th className="p-3">Trạng thái</th><th className="p-3">Mô tả</th><th className="p-3">Thao tác</th></> : <><th className="p-3">PID / User</th><th className="p-3">CPU / RAM</th><th className="p-3">Command</th><th className="p-3">Signal</th></>}</tr></thead><tbody className="divide-y divide-white/5 font-mono">
                          {systemView === 'services' ? services.filter(service => `${service.unit} ${service.description}`.toLowerCase().includes(systemQuery.toLowerCase())).map(service => <tr key={service.unit}><td className="p-3 text-white">{service.unit}</td><td className="p-3"><span className={service.active === 'active' ? 'text-emerald-400' : service.active === 'failed' ? 'text-red-400' : 'text-amber-400'}>{service.active}/{service.sub}</span></td><td className="p-3 text-slate-400 max-w-md truncate">{service.description}</td><td className="p-3"><div className="flex flex-wrap gap-2"><button onClick={() => openServiceLogs(service.unit)} className="text-blue-400">Logs</button><button onClick={() => serviceAction(service.unit, service.active === 'active' ? 'restart' : 'start')} className="text-emerald-400">{service.active === 'active' ? 'Restart' : 'Start'}</button>{currentUser?.role === 'root' && <>{service.active === 'active' && <button onClick={() => confirm(`Dừng ${service.unit}?`) && serviceAction(service.unit, 'stop')} className="text-red-400">Stop</button>}<button onClick={() => serviceAction(service.unit, 'disable')} className="text-amber-400">Disable</button></>}<button onClick={() => serviceAction(service.unit, 'enable')} className="text-slate-400">Enable</button></div></td></tr>) : processes.filter(process => `${process.pid} ${process.user} ${process.command}`.toLowerCase().includes(systemQuery.toLowerCase())).map(process => <tr key={process.pid}><td className="p-3"><span className="text-white">{process.pid}</span><span className="block text-[10px] text-slate-500">{process.user} · PPID {process.ppid} · {process.elapsed}</span></td><td className="p-3"><span className="text-blue-400">{process.cpu}%</span> / <span className="text-purple-400">{process.memory}%</span><span className="block text-[10px] text-slate-500">{(process.rssKB / 1024).toFixed(1)} MB</span></td><td className="p-3 text-slate-300 max-w-2xl break-all">{process.command}</td><td className="p-3"><div className="flex gap-2"><button disabled={process.pid <= 1} onClick={() => signalProcess(process.pid, 'SIGTERM')} className="text-amber-400 disabled:opacity-20">TERM</button>{currentUser?.role === 'root' && <button disabled={process.pid <= 1} onClick={() => signalProcess(process.pid, 'SIGKILL')} className="text-red-400 disabled:opacity-20">KILL</button>}</div></td></tr>)}
                        </tbody></table></div>
                      </div>
                    </motion.div>}

                    {activeTab === 'sqlite' && currentUser && ['admin', 'root'].includes(currentUser.role) && <motion.div key="sqlite-tab" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="w-full h-full overflow-y-auto bg-[#080b0a]">
                      <div className="max-w-[1600px] mx-auto p-3 sm:p-6 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-b border-emerald-500/15 pb-4">
                          <div className="mr-auto"><div className="flex items-center gap-2"><Database className="w-5 h-5 text-emerald-400" /><h3 className="text-lg font-bold text-white uppercase tracking-wider">SQLite Studio</h3><span className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[9px] font-mono text-emerald-400">LOCAL DATA LAB</span></div><p className="mt-1 text-xs text-slate-500 font-mono">Browse, mutate, inspect and safeguard server databases</p></div>
                          <button onClick={() => setShowCreateSqlite(true)} className="flex items-center justify-center gap-2 px-3 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold"><Plus className="w-4 h-4" />Tạo SQLite</button>
                          <button onClick={() => loadSqliteFiles()} className="flex items-center justify-center gap-2 px-3 py-2 rounded border border-white/10 bg-white/5 text-xs"><RefreshCw className={`w-4 h-4 ${sqliteLoading ? 'animate-spin' : ''}`} />Quét lại</button>
                        </div>
                        {sqliteMessage && <div className={`px-3 py-2 rounded border text-xs font-mono ${/không|lỗi|thất bại|invalid|error/i.test(sqliteMessage) ? 'border-red-500/25 bg-red-500/5 text-red-400' : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'}`}>{sqliteMessage}</div>}

                        <div className="grid lg:grid-cols-[270px_minmax(0,1fr)] gap-4 items-start">
                          <aside className="rounded-xl border border-white/10 bg-[#0d1110] overflow-hidden lg:sticky lg:top-0">
                            <div className="flex items-center px-4 py-3 border-b border-white/10"><h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Databases</h4><span className="ml-auto rounded bg-white/5 px-2 py-0.5 text-[9px] font-mono text-slate-500">{sqliteFiles.length}</span></div>
                            <div className="max-h-52 lg:max-h-[32vh] overflow-y-auto p-2 space-y-1">
                              {sqliteFiles.length === 0 && <p className="p-5 text-center text-xs text-slate-600">Chưa tìm thấy database SQLite.</p>}
                              {sqliteFiles.map(file => <button key={file.path} onClick={() => { setSqliteWorkspace('data'); setSqliteAppliedSearch(''); setSqliteSearch(''); setSqliteSort(''); openSqlite(file.path); }} className={`w-full text-left p-3 rounded border transition ${selectedSqlite === file.path ? 'bg-emerald-500/10 border-emerald-500/30' : 'border-transparent hover:bg-white/5'}`}>
                                <span className="flex items-center gap-2 text-xs text-white font-semibold"><Database className={`w-4 h-4 ${file.protected ? 'text-amber-400' : 'text-emerald-400'}`} /><span className="truncate">{file.name}</span>{file.protected && <Lock className="w-3 h-3 ml-auto text-amber-400" />}</span>
                                <span className="block mt-1 text-[10px] text-slate-500 font-mono truncate" title={file.path}>{file.path}</span><span className="block mt-1 text-[9px] text-slate-600">{(file.size / 1024).toFixed(1)} KB · {new Date(file.mtime).toLocaleString()}</span>
                              </button>)}
                            </div>
                            {selectedSqlite && <><div className="px-4 py-2 border-y border-white/10 text-[9px] font-bold uppercase tracking-widest text-slate-600">Objects</div><div className="max-h-64 overflow-y-auto p-2 space-y-1">{sqliteObjects.map(object => <button key={`${object.type}:${object.name}`} disabled={!['table', 'view'].includes(object.type)} onClick={() => { setSqliteWorkspace('data'); setSqliteSearch(''); setSqliteAppliedSearch(''); setSqliteSort(''); loadSqliteRows(selectedSqlite, object.name, 0, { q: '', sort: '' }); }} title={object.sql || object.name} className={`w-full flex items-center gap-2 px-2 py-2 rounded text-left text-xs ${selectedSqliteTable === object.name ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400 hover:bg-white/5 disabled:hover:bg-transparent'}`}><span className={`w-1.5 h-1.5 rounded-full ${object.type === 'table' ? 'bg-emerald-400' : object.type === 'view' ? 'bg-blue-400' : 'bg-slate-600'}`} /><span className="truncate">{object.name}</span><span className="ml-auto text-[8px] uppercase text-slate-600">{object.type}</span></button>)}</div></>}
                          </aside>

                          <section className="min-w-0 space-y-4">
                            {!selectedSqlite ? <div className="min-h-96 rounded-xl border border-dashed border-white/10 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.05),transparent_60%)] flex flex-col items-center justify-center text-center p-8"><Database className="w-12 h-12 text-slate-700 mb-3" /><h4 className="text-white font-semibold">Chọn một database</h4><p className="mt-1 max-w-sm text-xs text-slate-500">Khám phá bảng, chỉnh sửa dữ liệu, chạy truy vấn và quản lý backup từ một workspace.</p></div> : <>
                              <div className="rounded-xl border border-white/10 bg-[#0d1110] overflow-hidden">
                                <div className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center"><div className="min-w-0 mr-auto"><h4 className="text-sm text-white font-bold font-mono truncate">{selectedSqlite}</h4><p className="text-[10px] text-slate-500 font-mono">{sqliteObjects.filter(item => item.type === 'table').length} bảng · {sqliteObjects.filter(item => item.type === 'view').length} view · {sqliteObjects.filter(item => item.type === 'index').length} index</p></div><button onClick={() => openSqlite(selectedSqlite)} className="px-3 py-1.5 text-xs border border-white/10 rounded">Làm mới</button>{currentUser.role === 'root' && !sqliteFiles.find(file => file.path === selectedSqlite)?.protected && <button onClick={() => deleteSqlite(selectedSqlite)} className="px-3 py-1.5 text-xs border border-red-500/20 bg-red-500/5 text-red-400 rounded">Xóa database</button>}</div>
                                <div className="flex overflow-x-auto border-t border-white/10 px-2">{([{ key: 'data', label: 'Data browser', icon: Table2 }, { key: 'sql', label: 'SQL console', icon: TerminalIcon }, { key: 'schema', label: 'Schema', icon: Wrench }, { key: 'operations', label: 'Operations', icon: Archive }] as const).map(item => <button key={item.key} onClick={() => { setSqliteWorkspace(item.key); if (item.key === 'operations') loadSqliteOperations(); }} className={`flex items-center gap-2 px-4 py-3 border-b-2 text-[10px] uppercase tracking-wider font-bold whitespace-nowrap ${sqliteWorkspace === item.key ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}><item.icon className="w-3.5 h-3.5" />{item.label}</button>)}</div>
                              </div>

                              {sqliteWorkspace === 'data' && <div className="rounded-xl border border-white/10 bg-[#0d1110] overflow-hidden">
                                <form onSubmit={event => { event.preventDefault(); setSqliteAppliedSearch(sqliteSearch.trim()); loadSqliteRows(selectedSqlite, selectedSqliteTable, 0, { q: sqliteSearch.trim() }); }} className="p-3 border-b border-white/10 flex flex-col md:flex-row gap-2">
                                  <div className="relative flex-1"><Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-600" /><input value={sqliteSearch} onChange={event => setSqliteSearch(event.target.value)} disabled={!selectedSqliteTable} placeholder="Tìm trong mọi cột..." className="w-full bg-black border border-white/10 rounded pl-9 pr-3 py-2 text-xs outline-none focus:border-emerald-500/40" /></div>
                                  <button type="submit" disabled={!selectedSqliteTable} className="px-3 py-2 rounded bg-white/5 border border-white/10 text-xs disabled:opacity-30">Tìm</button>
                                  <select value={sqliteLimit} onChange={event => loadSqliteRows(selectedSqlite, selectedSqliteTable, 0, { limit: Number(event.target.value) })} disabled={!selectedSqliteTable} className="bg-black border border-white/10 rounded px-2 py-2 text-xs"><option value={10}>10 / trang</option><option value={25}>25 / trang</option><option value={50}>50 / trang</option><option value={100}>100 / trang</option></select>
                                  <button type="button" onClick={() => openSqliteRecord('add')} disabled={!selectedSqliteTable || sqliteObjects.find(item => item.name === selectedSqliteTable)?.type === 'view'} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded bg-emerald-500 text-black text-xs font-bold disabled:opacity-30"><Plus className="w-3.5 h-3.5" />Thêm dòng</button>
                                </form>
                                <div className="overflow-auto max-h-[55vh]"><table className="min-w-full text-left text-[11px] font-mono"><thead className="sticky top-0 z-[1] bg-[#151a18] text-slate-500"><tr><th className="w-20 px-3 py-2 border-b border-r border-white/5">Actions</th>{Array.from(new Set(sqliteRows.flatMap(row => Object.keys(row)))).map(column => <th key={column} className="px-3 py-2 border-b border-r border-white/5 whitespace-nowrap"><button onClick={() => { const order = sqliteSort === column && sqliteOrder === 'asc' ? 'desc' : 'asc'; setSqliteSort(column); setSqliteOrder(order); loadSqliteRows(selectedSqlite, selectedSqliteTable, 0, { sort: column, order }); }} className={sqliteSort === column ? 'text-emerald-300' : ''}>{column} {sqliteSort === column ? sqliteOrder === 'asc' ? '↑' : '↓' : ''}</button></th>)}</tr></thead><tbody className="divide-y divide-white/5">{sqliteRows.map((row, index) => <tr key={index} className="hover:bg-white/[0.025]"><td className="px-3 py-2 border-r border-white/5"><div className="flex gap-2"><button disabled={sqliteIdentityKind === 'none'} onClick={() => openSqliteRecord('edit', row)} title={sqliteIdentityKind === 'none' ? 'Bảng không có khóa ổn định' : 'Sửa'} className="text-blue-400 disabled:text-slate-700"><Edit className="w-3.5 h-3.5" /></button><button disabled={sqliteIdentityKind === 'none'} onClick={() => deleteSqliteRecord(row)} title={sqliteIdentityKind === 'none' ? 'Bảng không có khóa ổn định' : 'Xóa'} className="text-red-400 disabled:text-slate-700"><Trash2 className="w-3.5 h-3.5" /></button></div></td>{Object.keys(row).map(column => <td key={column} className="max-w-80 px-3 py-2 border-r border-white/5 text-slate-300 whitespace-pre-wrap break-all">{sqliteCellValue(row[column])}</td>)}</tr>)}</tbody></table>{!sqliteRows.length && <div className="p-10 text-center text-xs text-slate-600">{selectedSqliteTable ? 'Không có dữ liệu phù hợp.' : 'Chọn một table hoặc view.'}</div>}</div>
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3 py-2.5 border-t border-white/10 text-[10px] text-slate-500"><span>{sqliteTotal ? `${sqliteOffset + 1}-${Math.min(sqliteOffset + sqliteRows.length, sqliteTotal)} / ${sqliteTotal}` : '0 dòng'}</span><div className="flex items-center gap-1"><button title="Trang đầu" disabled={sqliteOffset === 0} onClick={() => loadSqliteRows(selectedSqlite, selectedSqliteTable, 0)} className="p-1.5 border border-white/10 rounded disabled:opacity-25"><ChevronsLeft className="w-3.5 h-3.5" /></button><button title="Trang trước" disabled={sqliteOffset === 0} onClick={() => loadSqliteRows(selectedSqlite, selectedSqliteTable, Math.max(0, sqliteOffset - sqliteLimit))} className="p-1.5 border border-white/10 rounded disabled:opacity-25"><ChevronLeft className="w-3.5 h-3.5" /></button><span className="px-2">Trang {Math.floor(sqliteOffset / sqliteLimit) + 1} / {Math.max(1, Math.ceil(sqliteTotal / sqliteLimit))}</span><button title="Trang sau" disabled={sqliteOffset + sqliteRows.length >= sqliteTotal} onClick={() => loadSqliteRows(selectedSqlite, selectedSqliteTable, sqliteOffset + sqliteLimit)} className="p-1.5 border border-white/10 rounded disabled:opacity-25"><ChevronRight className="w-3.5 h-3.5" /></button><button title="Trang cuối" disabled={sqliteOffset + sqliteRows.length >= sqliteTotal} onClick={() => loadSqliteRows(selectedSqlite, selectedSqliteTable, Math.max(0, (Math.ceil(sqliteTotal / sqliteLimit) - 1) * sqliteLimit))} className="p-1.5 border border-white/10 rounded disabled:opacity-25"><ChevronsRight className="w-3.5 h-3.5" /></button></div></div>
                              </div>}

                              {sqliteWorkspace === 'sql' && <div className="grid xl:grid-cols-[minmax(0,1fr)_280px] gap-4">
                                <div className="min-w-0 space-y-4"><div className="rounded-xl border border-white/10 bg-[#0d1110] overflow-hidden"><div className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3 border-b border-white/10"><div className="mr-auto"><h4 className="text-xs text-white font-bold uppercase tracking-wider">SQL Console</h4><p className="text-[9px] text-slate-600 font-mono">Ctrl-like workflow with persisted local history</p></div><button onClick={explainSqliteQuery} disabled={sqliteLoading || !sqliteSql.trim()} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded border border-purple-500/25 bg-purple-500/5 text-purple-300 text-xs disabled:opacity-40"><BarChart3 className="w-3.5 h-3.5" />Query plan</button><button onClick={runSqliteQuery} disabled={sqliteLoading || !sqliteSql.trim()} className="flex items-center justify-center gap-1.5 px-4 py-2 rounded bg-emerald-500 disabled:opacity-40 text-black text-xs font-bold"><Play className="w-3.5 h-3.5" />Chạy SQL</button></div><textarea value={sqliteSql} onChange={event => setSqliteSql(event.target.value)} spellCheck={false} className="w-full min-h-52 p-4 resize-y bg-[#070908] text-emerald-200 font-mono text-xs outline-none" /><div className="border-t border-white/10"><SqliteResultTable rows={sqliteResult} empty="Kết quả truy vấn sẽ hiển thị tại đây." /></div></div>{sqlitePlan.length > 0 && <div className="rounded-xl border border-purple-500/20 bg-[#0d1110] overflow-hidden"><div className="px-4 py-3 border-b border-white/10 text-[10px] uppercase font-bold tracking-wider text-purple-300">Query plan</div><SqliteResultTable rows={sqlitePlan} empty="Không có query plan." /></div>}</div>
                                <aside className="rounded-xl border border-white/10 bg-[#0d1110] overflow-hidden self-start"><div className="flex items-center px-3 py-3 border-b border-white/10"><History className="w-3.5 h-3.5 text-slate-500 mr-2" /><h4 className="text-[10px] uppercase font-bold tracking-wider text-slate-400">SQL History</h4>{sqliteHistory.length > 0 && <button onClick={() => { setSqliteHistory([]); localStorage.removeItem(SQLITE_HISTORY_KEY); }} className="ml-auto text-[9px] text-red-400">Xóa</button>}</div><div className="max-h-[60vh] overflow-y-auto divide-y divide-white/5">{sqliteHistory.filter(entry => entry.path === selectedSqlite).map(entry => <button key={entry.id} onClick={() => setSqliteSql(entry.sql)} className="w-full p-3 text-left hover:bg-white/[0.03]"><code className="block line-clamp-3 text-[10px] text-slate-300">{entry.sql}</code><span className={`block mt-2 text-[9px] ${entry.success ? 'text-emerald-500' : 'text-red-400'}`}>{new Date(entry.ranAt).toLocaleString()} · {entry.durationMs} ms{entry.rowCount !== undefined ? ` · ${entry.rowCount} rows` : ''}</span></button>)}{!sqliteHistory.some(entry => entry.path === selectedSqlite) && <p className="p-6 text-center text-[10px] text-slate-600">Chưa có truy vấn trong database này.</p>}</div></aside>
                              </div>}

                              {sqliteWorkspace === 'schema' && <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
                                <div className="rounded-xl border border-white/10 bg-[#0d1110] overflow-hidden"><div className="px-4 py-3 border-b border-white/10 text-[10px] uppercase font-bold tracking-wider text-slate-400">Schema objects</div><div className="divide-y divide-white/5">{sqliteObjects.map(object => <div key={`${object.type}:${object.name}`} className="p-4"><div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${object.type === 'table' ? 'bg-emerald-400' : object.type === 'view' ? 'bg-blue-400' : 'bg-purple-400'}`} /><span className="text-xs font-bold text-white">{object.name}</span><span className="ml-auto text-[9px] uppercase text-slate-600">{object.type}</span></div>{object.sql && <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/50 p-3 text-[10px] leading-relaxed text-slate-500">{object.sql}</pre>}</div>)}</div></div>
                                <div className="rounded-xl border border-emerald-500/15 bg-[#0d1110] p-4 space-y-4 self-start"><div><h4 className="text-xs font-bold text-white uppercase tracking-wider">Schema manager</h4><p className="mt-1 text-[10px] text-slate-600">DDL actions are sent as structured payloads.</p></div><select value={sqliteSchemaAction} onChange={event => setSqliteSchemaAction(event.target.value as typeof sqliteSchemaAction)} className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs"><option value="createTable">Create table</option><option value="addColumn">Add column</option><option value="createIndex">Create index</option><option value="dropIndex">Drop index</option><option value="dropTable">Drop table</option></select>
                                  {sqliteSchemaAction === 'createTable' && <><input value={sqliteSchemaForm.table} onChange={event => setSqliteSchemaForm(form => ({ ...form, table: event.target.value }))} placeholder="Table name" className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs" /><textarea value={sqliteSchemaForm.columns} onChange={event => setSqliteSchemaForm(form => ({ ...form, columns: event.target.value }))} placeholder="One column definition per line" className="w-full min-h-32 resize-y bg-black border border-white/10 rounded p-3 font-mono text-xs text-emerald-200" /></>}
                                  {sqliteSchemaAction === 'addColumn' && <><input value={selectedSqliteTable || sqliteSchemaForm.table} onChange={event => setSqliteSchemaForm(form => ({ ...form, table: event.target.value }))} placeholder="Table" className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs" /><div className="grid grid-cols-2 gap-2"><input value={sqliteSchemaForm.column} onChange={event => setSqliteSchemaForm(form => ({ ...form, column: event.target.value }))} placeholder="Column name" className="bg-black border border-white/10 rounded px-3 py-2 text-xs" /><input value={sqliteSchemaForm.type} onChange={event => setSqliteSchemaForm(form => ({ ...form, type: event.target.value }))} placeholder="TEXT" className="bg-black border border-white/10 rounded px-3 py-2 text-xs" /></div></>}
                                  {sqliteSchemaAction === 'createIndex' && <><input value={selectedSqliteTable || sqliteSchemaForm.table} onChange={event => setSqliteSchemaForm(form => ({ ...form, table: event.target.value }))} placeholder="Table" className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs" /><input value={sqliteSchemaForm.index} onChange={event => setSqliteSchemaForm(form => ({ ...form, index: event.target.value }))} placeholder="Index name" className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs" /><input value={sqliteSchemaForm.indexColumns} onChange={event => setSqliteSchemaForm(form => ({ ...form, indexColumns: event.target.value }))} placeholder="column_a, column_b" className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs" /><label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={sqliteSchemaForm.unique} onChange={event => setSqliteSchemaForm(form => ({ ...form, unique: event.target.checked }))} className="accent-emerald-500" />Unique index</label></>}
                                  {sqliteSchemaAction === 'dropIndex' && <select value={sqliteSchemaForm.index} onChange={event => setSqliteSchemaForm(form => ({ ...form, index: event.target.value }))} className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs"><option value="">Chọn index</option>{sqliteObjects.filter(object => object.type === 'index').map(object => <option key={object.name} value={object.name}>{object.name}</option>)}</select>}
                                  {sqliteSchemaAction === 'dropTable' && <select value={selectedSqliteTable || sqliteSchemaForm.table} onChange={event => { setSelectedSqliteTable(''); setSqliteSchemaForm(form => ({ ...form, table: event.target.value })); }} className="w-full bg-black border border-red-500/20 rounded px-3 py-2 text-xs"><option value="">Chọn table</option>{sqliteObjects.filter(object => object.type === 'table').map(object => <option key={object.name} value={object.name}>{object.name}</option>)}</select>}
                                  <button onClick={applySqliteSchemaAction} disabled={sqliteLoading} className={`w-full px-4 py-2.5 rounded text-xs font-bold ${sqliteSchemaAction.startsWith('drop') ? 'bg-red-500/10 border border-red-500/25 text-red-400' : 'bg-emerald-500 text-black'}`}>Áp dụng thay đổi</button>
                                </div>
                              </div>}

                              {sqliteWorkspace === 'operations' && <div className="grid xl:grid-cols-2 gap-4">
                                <div className="space-y-4"><div className="rounded-xl border border-white/10 bg-[#0d1110] p-4"><div className="flex items-center mb-4"><BarChart3 className="w-4 h-4 text-emerald-400 mr-2" /><h4 className="text-xs font-bold text-white uppercase tracking-wider">Database stats</h4><button onClick={loadSqliteOperations} className="ml-auto text-[10px] text-slate-500">Refresh</button></div>{sqliteStats ? <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{Object.entries(sqliteStats).filter(([key]) => key !== 'success').map(([key, value]) => <div key={key} className="rounded border border-white/5 bg-black/30 p-3"><span className="block text-[9px] uppercase text-slate-600 truncate">{key}</span><span className="mt-1 block text-xs font-mono text-slate-200 break-all">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span></div>)}</div> : <p className="text-xs text-slate-600">Chưa tải thống kê.</p>}</div>
                                  <div className="rounded-xl border border-white/10 bg-[#0d1110] p-4"><h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3">Maintenance</h4><div className="grid sm:grid-cols-3 gap-2"><button onClick={() => sqliteMaintenance('vacuum')} className="px-3 py-3 rounded border border-white/10 bg-white/[0.02] text-xs hover:border-emerald-500/30"><Wrench className="w-4 h-4 mx-auto mb-1 text-emerald-400" />VACUUM</button><button onClick={() => sqliteMaintenance('analyze')} className="px-3 py-3 rounded border border-white/10 bg-white/[0.02] text-xs hover:border-blue-500/30"><BarChart3 className="w-4 h-4 mx-auto mb-1 text-blue-400" />ANALYZE</button><button onClick={() => sqliteMaintenance('integrity_check')} className="px-3 py-3 rounded border border-white/10 bg-white/[0.02] text-xs hover:border-amber-500/30"><ShieldCheck className="w-4 h-4 mx-auto mb-1 text-amber-400" />INTEGRITY</button></div></div>
                                  <div className="rounded-xl border border-white/10 bg-[#0d1110] p-4 space-y-3"><div><h4 className="text-xs font-bold text-white uppercase tracking-wider">Import / Export table</h4><p className="mt-1 text-[10px] text-slate-600">Target: {selectedSqliteTable || 'chọn một table'}</p></div><div className="flex gap-2"><select value={sqliteImportFormat} onChange={event => setSqliteImportFormat(event.target.value as 'csv' | 'json')} className="bg-black border border-white/10 rounded px-3 py-2 text-xs"><option value="csv">CSV</option><option value="json">JSON</option></select><label className="flex-1 flex items-center justify-center gap-2 border border-white/10 rounded text-xs cursor-pointer hover:bg-white/5"><Upload className="w-3.5 h-3.5" />Nạp file<input type="file" accept={sqliteImportFormat === 'csv' ? '.csv,text/csv' : '.json,application/json'} className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) file.text().then(setSqliteImportData); event.target.value = ''; }} /></label>{selectedSqliteTable && <a href={`${API_URL}/api/sqlite/export?path=${encodeURIComponent(selectedSqlite)}&table=${encodeURIComponent(selectedSqliteTable)}&format=${sqliteImportFormat}`} className="flex items-center justify-center gap-2 px-3 border border-emerald-500/20 rounded text-xs text-emerald-300"><Download className="w-3.5 h-3.5" />Export</a>}</div><textarea value={sqliteImportData} onChange={event => setSqliteImportData(event.target.value)} placeholder={sqliteImportFormat === 'csv' ? 'id,name\n1,Ada' : '[{"id":1,"name":"Ada"}]'} className="w-full min-h-28 resize-y bg-black border border-white/10 rounded p-3 font-mono text-[10px] text-slate-300" /><button onClick={importSqliteTable} disabled={!selectedSqliteTable || !sqliteImportData.trim()} className="w-full py-2 rounded bg-emerald-500 text-black text-xs font-bold disabled:opacity-30">Import vào {selectedSqliteTable || 'table'}</button></div>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-[#0d1110] overflow-hidden self-start"><div className="flex items-center p-4 border-b border-white/10"><Archive className="w-4 h-4 text-purple-400 mr-2" /><div><h4 className="text-xs font-bold text-white uppercase tracking-wider">Backups</h4><p className="mt-1 text-[9px] text-slate-600">Restore points for this database</p></div><button onClick={() => sqliteBackupAction('create')} className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded bg-purple-500/10 border border-purple-500/25 text-purple-300 text-xs"><Plus className="w-3.5 h-3.5" />Tạo backup</button></div><div className="divide-y divide-white/5">{sqliteBackups.map(backup => <div key={backup.name} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3"><div className="min-w-0 mr-auto"><p className="text-xs font-mono text-white truncate">{backup.name}</p><p className="mt-1 text-[9px] text-slate-600">{backup.mtime ? new Date(backup.mtime).toLocaleString() : 'Không rõ thời gian'}{backup.size !== undefined ? ` · ${(backup.size / 1024).toFixed(1)} KB` : ''}</p></div><div className="flex gap-2"><a title="Download" href={`${API_URL}/api/sqlite/backups/${encodeURIComponent(backup.name)}/download`} className="p-2 rounded border border-white/10 text-slate-400"><Download className="w-3.5 h-3.5" /></a>{currentUser.role === 'root' && <><button title="Restore" onClick={() => sqliteBackupAction('restore', backup.name)} className="p-2 rounded border border-blue-500/20 text-blue-400"><RotateCcw className="w-3.5 h-3.5" /></button><button title="Delete" onClick={() => sqliteBackupAction('delete', backup.name)} className="p-2 rounded border border-red-500/20 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button></>}</div></div>)}{sqliteBackups.length === 0 && <p className="p-8 text-center text-xs text-slate-600">Chưa có backup.</p>}</div></div>
                              </div>}
                            </>}
                          </section>
                        </div>
                      </div>
                    </motion.div>}

                    {/* TAB 3: Admin Configurations & Security Settings */}
                    {activeTab === 'settings' && (
                      <motion.div
                        key="settings-tab"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="w-full h-full p-8 overflow-y-auto bg-[#0a0a0c]"
                      >
                        <div className="max-w-3xl mx-auto space-y-8">
                          {/* Section 1: Terminal UI Styles */}
                          <div className="p-6 rounded-xl border border-white/10 bg-[#111116]/40 space-y-6">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
                              <div>
                                <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1">Tùy biến dòng lệnh</h3>
                                <p className="text-xs text-slate-500 font-mono">Chỉnh sửa các tùy chọn thiết lập được lưu vào cấu hình cục bộ</p>
                              </div>
                              <AnimatePresence>
                                {saveStatus !== 'idle' && (
                                  <motion.div
                                    initial={{ opacity: 0, x: 10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 10 }}
                                    className="flex items-center gap-1.5 text-xs font-mono select-none self-start sm:self-auto"
                                    id="settings-save-status"
                                  >
                                    {saveStatus === 'saving' && (
                                      <span className="flex items-center gap-1.5 text-blue-400">
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                        <span>Đang tự động lưu...</span>
                                      </span>
                                    )}
                                    {saveStatus === 'saved' && (
                                      <span className="flex items-center gap-1.5 text-emerald-400">
                                        <Database className="w-3.5 h-3.5 animate-pulse" />
                                        <span>Đã lưu vào máy chủ</span>
                                      </span>
                                    )}
                                    {saveStatus === 'error' && (
                                      <span className="flex items-center gap-1.5 text-rose-400">
                                        <AlertCircle className="w-3.5 h-3.5" />
                                        <span>Lỗi lưu cơ sở dữ liệu</span>
                                      </span>
                                    )}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div>
                                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">
                                  Thanh Chọn Cỡ Chữ
                                </label>
                                <div className="flex items-center gap-4">
                                  <input
                                    type="range"
                                    min="12"
                                    max="24"
                                    value={fontSize}
                                    onChange={(e) => setFontSize(parseInt(e.target.value))}
                                    className="flex-1 accent-blue-500 cursor-pointer"
                                  />
                                  <span className="font-mono text-sm font-semibold bg-black px-3 py-1.5 rounded border border-white/10 w-12 text-center text-white">
                                    {fontSize}
                                  </span>
                                </div>
                              </div>

                              <div>
                                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">
                                  Chủ Đề Màu Sắc
                                </label>
                                <select
                                  value={activePreviewTheme}
                                  onChange={(e) => setPreviewTheme(e.target.value)}
                                  className="w-full py-2.5 px-3 bg-black border border-white/10 rounded text-sm text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                                >
                                  <option value="dark-classic">Mặc định Phiến đá (Tối cổ điển)</option>
                                  <option value="matrix">Xanh lục Ma trận (Cổ điển)</option>
                                  <option value="amber">Cam Hổ phách (CRT Phosphor)</option>
                                  <option value="cyberpunk">Neon Cyberpunk (Xanh & Hồng)</option>
                                  <option value="dracula">Dracula (Tím cổ điển)</option>
                                  <option value="tokyo-night">Tokyo Night (Xanh đêm)</option>
                                  <option value="nord">Nord (Băng giá dịu mắt)</option>
                                  <option value="solarized-dark">Solarized Dark (Tối cân bằng)</option>
                                  <option value="solarized-light">Solarized Light (Sáng dịu mắt)</option>
                                  <option value="gruvbox">Gruvbox (Retro ấm)</option>
                                  <option value="one-dark">One Dark (Phong cách Atom)</option>
                                  <option value="github-light">GitHub Light (Sáng tối giản)</option>
                                </select>
                              </div>
                            </div>

                            {/* Live Theme Preview */}
                            <div className="border-t border-white/5 pt-6 space-y-4">
                              <div className="flex items-center justify-between">
                                <label className="block text-[10px] uppercase font-bold text-slate-500">
                                  Trực quan hóa Chủ đề (Live Preview)
                                </label>
                                {activePreviewTheme !== theme && (
                                  <span className="text-[10px] text-amber-400 font-mono italic animate-pulse">
                                    Chủ đề chưa được áp dụng
                                  </span>
                                )}
                              </div>
                              
                              <div 
                                style={{ 
                                  backgroundColor: getTerminalColors(activePreviewTheme).background, 
                                  color: getTerminalColors(activePreviewTheme).foreground 
                                }} 
                                className="rounded-lg p-5 font-mono text-xs border border-white/10 shadow-inner select-none flex flex-col justify-between transition-all duration-300 min-h-[160px]"
                                id="terminal-theme-preview"
                              >
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1.5 mb-3 pb-2 border-b border-white/5 opacity-50">
                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/80"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/80"></div>
                                    <span className="text-[9px] uppercase tracking-wider text-slate-400 ml-1">Cửa sổ xem trước</span>
                                  </div>
                                  <p className="flex items-center gap-1 flex-wrap">
                                    <span style={{ color: getTerminalColors(activePreviewTheme).cyan }}>visitor@nodeshell:~$</span>
                                    <span>cat welcome.txt</span>
                                  </p>
                                  <p style={{ color: getTerminalColors(activePreviewTheme).green }}>✔ VPS connected on secure tunnel.</p>
                                  <p className="flex items-center gap-1 flex-wrap">
                                    <span style={{ color: getTerminalColors(activePreviewTheme).cyan }}>visitor@nodeshell:~$</span>
                                    <span style={{ color: getTerminalColors(activePreviewTheme).yellow }}>node --version</span>
                                  </p>
                                  <p className="flex items-center">
                                    <span>v20.11.0</span>
                                    <span 
                                      style={{ backgroundColor: getTerminalColors(activePreviewTheme).cursor }} 
                                      className="inline-block w-2 h-4 ml-1.5 animate-pulse align-middle"
                                    />
                                  </p>
                                </div>
                                <div className="text-[9px] text-slate-500 text-right opacity-60 font-mono mt-4">
                                  Mã nền: {getTerminalColors(activePreviewTheme).background} | Mã chữ: {getTerminalColors(activePreviewTheme).foreground} | Mã con trỏ: {getTerminalColors(activePreviewTheme).cursor}
                                </div>
                              </div>

                              <div className="flex justify-end gap-3">
                                <button
                                  type="button"
                                  onClick={() => setPreviewTheme(null)}
                                  disabled={previewTheme === null}
                                  className="px-4 py-2 text-xs font-semibold rounded bg-[#111116] hover:bg-[#1a1a24] text-slate-400 hover:text-white border border-white/10 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                                >
                                  Hoàn tác thay đổi
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTheme(activePreviewTheme);
                                    setPreviewTheme(null);
                                  }}
                                  disabled={activePreviewTheme === theme}
                                  className="px-4 py-2 text-xs font-semibold rounded bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/10 transition disabled:bg-emerald-600/20 disabled:text-emerald-400/80 disabled:shadow-none disabled:border disabled:border-emerald-500/10 cursor-pointer flex items-center gap-1.5"
                                  id="btn-apply-theme"
                                >
                                  {activePreviewTheme === theme ? (
                                    <>
                                      <Check className="w-3.5 h-3.5" />
                                      <span>Chủ đề đang áp dụng</span>
                                    </>
                                  ) : (
                                    <span>Áp dụng chủ đề</span>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Section 2: Password Management */}
                          <div className="p-6 rounded-xl border border-white/10 bg-[#111116]/40 space-y-6">
                            <div>
                              <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1">Thay Đổi Khóa Truy Cập</h3>
                              <p className="text-xs text-slate-500 font-mono">Cập nhật mật khẩu chính để bảo vệ quyền truy cập Node-PTY</p>
                            </div>

                            <form onSubmit={handlePasswordChange} className="space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                  <label className="block text-xs text-slate-400 mb-1.5 font-mono">Mật khẩu hiện tại</label>
                                  <input
                                    type="password"
                                    required
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    className="w-full px-3 py-2 bg-black border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs text-slate-400 mb-1.5 font-mono">Mật khẩu mới</label>
                                  <input
                                    type="password"
                                    required
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    className="w-full px-3 py-2 bg-black border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs text-slate-400 mb-1.5 font-mono">Xác nhận mật khẩu</label>
                                  <input
                                    type="password"
                                    required
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full px-3 py-2 bg-black border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500"
                                  />
                                </div>
                              </div>

                              {pwdError && (
                                <div className="flex items-start gap-2.5 p-3 rounded bg-red-950/30 border border-red-900/40 text-red-400 text-xs font-mono">
                                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                  <span>{pwdError}</span>
                                </div>
                              )}

                              {pwdSuccess && (
                                <div className="flex items-start gap-2.5 p-3 rounded bg-emerald-950/30 border border-emerald-900/40 text-emerald-400 text-xs font-mono">
                                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                                  <span>{pwdSuccess}</span>
                                </div>
                              )}

                              <div className="flex justify-end pt-2">
                                <button
                                  type="submit"
                                  disabled={loading}
                                  className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-5 rounded text-xs transition cursor-pointer disabled:opacity-50"
                                >
                                  {loading ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    'CẬP NHẬT KHÓA CHÍNH'
                                  )}
                                </button>
                              </div>
                            </form>
                          </div>

                          <div className="p-6 rounded-xl border border-white/10 bg-[#111116]/40 space-y-6">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1">Xác Thực Hai Lớp</h3>
                                <p className="text-xs text-slate-500 font-mono">TOTP tương thích Google Authenticator, Authy và 1Password</p>
                              </div>
                              <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase border ${securityStatus?.twoFactorEnabled ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-slate-400 bg-white/5 border-white/10'}`}>{securityStatus?.twoFactorEnabled ? 'Đã bật' : 'Đang tắt'}</span>
                            </div>

                            {securityMessage && <div className="p-3 rounded bg-blue-950/30 border border-blue-900/40 text-blue-300 text-xs font-mono">{securityMessage}</div>}
                            {securityStatus && !securityStatus.twoFactorAvailable && <div className="p-3 rounded bg-amber-950/30 border border-amber-900/40 text-amber-300 text-xs font-mono">Backend cần biến AUTH_ENCRYPTION_KEY dài ít nhất 32 ký tự để bật 2FA.</div>}

                            {!securityStatus?.twoFactorEnabled ? (
                              <div className="space-y-4">
                                {!twoFactorSetup ? <div className="flex flex-col sm:flex-row gap-3">
                                  <input type="password" value={twoFactorPassword} onChange={(e) => setTwoFactorPassword(e.target.value)} placeholder="Mật khẩu hiện tại" className="flex-1 px-3 py-2 bg-black border border-white/10 rounded text-sm text-white" />
                                  <button type="button" disabled={!securityStatus?.twoFactorAvailable || !twoFactorPassword} onClick={startTwoFactorSetup} className="px-4 py-2 rounded bg-blue-600 text-white text-xs font-semibold disabled:opacity-40"><Smartphone className="w-4 h-4 inline mr-2" />Thiết lập ứng dụng</button>
                                </div> : <div className="grid md:grid-cols-[180px_1fr] gap-5 items-center">
                                  {/* QR code is generated locally by the authenticated backend. */}
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={twoFactorSetup.qrCode} alt="QR thiết lập TOTP" className="w-44 h-44 rounded bg-white p-2" />
                                  <div className="space-y-3 min-w-0">
                                    <p className="text-xs text-slate-400">Quét QR rồi nhập mã 6 số để xác nhận. Có thể nhập secret thủ công:</p>
                                    <code className="block p-2 bg-black rounded text-xs text-blue-300 break-all select-all">{twoFactorSetup.secret}</code>
                                    <div className="flex gap-2"><input value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="flex-1 px-3 py-2 bg-black border border-white/10 rounded text-center tracking-widest" /><button type="button" onClick={confirmTwoFactorSetup} className="px-4 bg-emerald-600 rounded text-xs font-semibold text-white">Xác nhận bật</button></div>
                                  </div>
                                </div>}
                              </div>
                            ) : <div className="space-y-3">
                              <p className="text-xs text-slate-400">Còn {securityStatus.recoveryCodesRemaining} mã khôi phục. Để tắt 2FA, nhập mật khẩu và mã TOTP hoặc recovery code.</p>
                              <div className="grid sm:grid-cols-2 gap-3"><input type="password" value={twoFactorPassword} onChange={(e) => setTwoFactorPassword(e.target.value)} placeholder="Mật khẩu hiện tại" className="px-3 py-2 bg-black border border-white/10 rounded text-sm" /><input value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} placeholder="Mã xác thực" className="px-3 py-2 bg-black border border-white/10 rounded text-sm" /></div>
                              <button type="button" onClick={disableTwoFactor} className="px-4 py-2 rounded bg-red-600/80 text-white text-xs font-semibold">Tắt xác thực hai lớp</button>
                            </div>}

                            {recoveryCodes.length > 0 && <div className="p-4 rounded border border-amber-500/30 bg-amber-500/5 space-y-3">
                              <p className="text-xs font-semibold text-amber-300">Các mã này chỉ hiển thị một lần. Lưu ở nơi an toàn.</p>
                              <div className="grid grid-cols-2 gap-2 font-mono text-xs">{recoveryCodes.map(code => <code key={code} className="bg-black p-2 rounded text-center select-all">{code}</code>)}</div>
                              <button type="button" onClick={() => navigator.clipboard.writeText(recoveryCodes.join('\n'))} className="text-xs text-amber-300"><Copy className="inline w-3.5 h-3.5 mr-1" />Sao chép tất cả</button>
                            </div>}
                          </div>

                          <div className="p-6 rounded-xl border border-white/10 bg-[#111116]/40 space-y-5">
                            <div className="flex items-start justify-between gap-4"><div><h3 className="text-base font-bold text-white uppercase tracking-wider mb-1">Phiên Đăng Nhập</h3><p className="text-xs text-slate-500 font-mono">Phiên tự hết hạn sau 12 giờ</p></div><button type="button" onClick={() => revokeSession()} className="px-3 py-2 text-xs rounded bg-red-600/15 text-red-300 border border-red-500/20">Thu hồi phiên khác</button></div>
                            <div className="space-y-2">
                              {securityStatus?.sessions.map(session => <div key={session.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-black/50 rounded border border-white/5">
                                <Monitor className="w-4 h-4 text-blue-400 shrink-0" />
                                <div className="flex-1 min-w-0"><div className="text-xs text-white truncate">{session.username && <span className="text-blue-400 mr-2">{session.username}</span>}{session.userAgent}</div><div className="text-[10px] text-slate-500 font-mono">{session.ip} · tạo {new Date(session.createdAt).toLocaleString()} · hết hạn {new Date(session.expiresAt).toLocaleString()}</div></div>
                                {session.current ? <span className="text-[10px] text-emerald-400">Phiên hiện tại</span> : <button type="button" onClick={() => revokeSession(session.id)} className="text-xs text-red-400">Thu hồi</button>}
                              </div>)}
                            </div>
                          </div>

                          {currentUser?.role === 'root' && <div className="p-6 rounded-xl border border-white/10 bg-[#111116]/40 space-y-5">
                            <div><h3 className="text-base font-bold text-white uppercase tracking-wider mb-1">Quản Lý Người Dùng</h3><p className="text-xs text-slate-500 font-mono">Viewer chỉ xem; Operator sửa file; Admin có terminal; Root toàn quyền.</p></div>
                            <div className="grid sm:grid-cols-4 gap-2"><input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="Username" className="bg-black border border-white/10 rounded px-3 py-2 text-xs" /><input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="Mật khẩu ≥ 12 ký tự" className="bg-black border border-white/10 rounded px-3 py-2 text-xs" /><select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })} className="bg-black border border-white/10 rounded px-3 py-2 text-xs"><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Admin</option><option value="root">Root</option></select><button onClick={createUser} className="bg-blue-600 rounded text-xs font-semibold">Tạo tài khoản</button></div>
                            <div className="space-y-2">{managedUsers.map(user => <div key={user.id} className="grid sm:grid-cols-[1fr_120px_90px_auto] items-center gap-3 bg-black/50 border border-white/5 rounded p-3"><div><div className="text-sm text-white">{user.username} {user.id === 'root' && <span className="text-[9px] text-red-400">PRIMARY</span>}</div><div className="text-[10px] text-slate-500">{user.sessions} phiên · 2FA {user.twoFactorEnabled ? 'bật' : 'tắt'} · tạo {new Date(user.createdAt).toLocaleDateString()}</div></div><select value={user.role} disabled={user.id === 'root'} onChange={(e) => updateUser(user.id, { role: e.target.value })} className="bg-black border border-white/10 rounded px-2 py-1.5 text-xs disabled:opacity-50"><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Admin</option><option value="root">Root</option></select><button disabled={user.id === 'root'} onClick={() => updateUser(user.id, { enabled: !user.enabled })} className={`text-xs ${user.enabled ? 'text-emerald-400' : 'text-slate-500'} disabled:opacity-30`}>{user.enabled ? 'Đang bật' : 'Đã khóa'}</button><div className="flex gap-2">{user.id !== 'root' && <><button onClick={() => { const password = prompt('Mật khẩu mới (ít nhất 12 ký tự):'); if (password) updateUser(user.id, { password }); }} className="text-xs text-blue-400">Reset MK</button><button onClick={() => deleteUser(user.id)} className="text-xs text-red-400">Xóa</button></>}</div></div>)}</div>
                          </div>}

                          {/* Floating Toast Notification */}
                          <AnimatePresence>
                            {saveStatus === 'saved' && (
                              <motion.div
                                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                                className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-[#0d0d12] border border-emerald-500/30 text-slate-100 px-5 py-3.5 rounded-lg shadow-2xl shadow-black max-w-sm pointer-events-auto"
                                id="settings-save-toast"
                              >
                                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                                  <Database className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">Đã lưu tự động</h4>
                                  <p className="text-[11px] text-slate-500 font-mono mt-0.5">Cấu hình giao diện đã đồng bộ thành công vào máy chủ.</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setSaveStatus('idle')}
                                  className="text-slate-500 hover:text-slate-300 transition-colors p-1 cursor-pointer"
                                  title="Đóng thông báo"
                                  id="btn-close-save-toast"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    )}

                    {/* TAB 4: File Manager */}
                    {activeTab === 'files' && (
                      <motion.div
                        key="files-tab"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="w-full h-full p-6 overflow-y-auto bg-[#0a0a0c]"
                      >
                        <div className="max-w-6xl mx-auto space-y-6">
                          {/* Top Header */}
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-4 gap-4">
                            <div>
                              <h3 className="text-lg font-bold text-white uppercase tracking-wider mb-1">Quản Lý Tệp Tin</h3>
                              <p className="text-xs text-slate-500 font-mono">Duyệt, xem, tạo, sửa và xóa tệp tin trên hệ thống VPS</p>
                              {currentUser?.role === 'viewer' && <span className="mt-2 inline-block text-[10px] px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">CHẾ ĐỘ CHỈ ĐỌC</span>}
                            </div>
                            <div className={`flex flex-wrap gap-2 ${currentUser?.role === 'viewer' ? 'pointer-events-none opacity-40' : ''}`}>
                              <input
                                ref={uploadInputRef}
                                type="file"
                                multiple
                                className="hidden"
                                onChange={(event) => {
                                  uploadFiles(Array.from(event.target.files || []));
                                  event.target.value = '';
                                }}
                              />
                              <button
                                onClick={() => loadFiles(parentPath)}
                                disabled={!parentPath || currentPath === parentPath}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111116] hover:bg-[#1a1a24] disabled:opacity-40 text-xs font-semibold text-slate-300 border border-white/10 rounded transition cursor-pointer"
                                title="Quay lại thư mục cha"
                              >
                                <ArrowUpLeft className="w-3.5 h-3.5" />
                                <span>Thư mục cha</span>
                              </button>
                              <button
                                onClick={() => loadFiles(currentPath)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111116] hover:bg-[#1a1a24] text-xs font-semibold text-slate-300 border border-white/10 rounded transition cursor-pointer"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${fileLoading ? 'animate-spin' : ''}`} />
                                <span>Tải lại</span>
                              </button>
                              <button
                                onClick={() => uploadInputRef.current?.click()}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white rounded transition cursor-pointer"
                              >
                                <Upload className="w-3.5 h-3.5" />
                                <span>Upload</span>
                              </button>
                              <button
                                onClick={openTrash}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111116] hover:bg-[#1a1a24] text-xs font-semibold text-slate-300 border border-white/10 rounded transition cursor-pointer"
                              >
                                <History className="w-3.5 h-3.5" />
                                <span>Thùng rác</span>
                              </button>
                              <button onClick={() => openSnapshots()} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111116] hover:bg-[#1a1a24] text-xs font-semibold text-slate-300 border border-white/10 rounded"><Database className="w-3.5 h-3.5" /><span>Snapshots</span></button>
                              <button
                                onClick={() => { setShowCreateFolder(true); setShowCreateFile(false); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white rounded transition cursor-pointer"
                              >
                                <FolderPlus className="w-3.5 h-3.5" />
                                <span>Thư mục mới</span>
                              </button>
                              <button
                                onClick={() => { setShowCreateFile(true); setShowCreateFolder(false); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white rounded transition cursor-pointer"
                              >
                                <FilePlus className="w-3.5 h-3.5" />
                                <span>Tệp tin mới</span>
                              </button>
                            </div>
                          </div>

                          {/* Error / Alert */}
                          {fileError && (
                            <div className="flex items-start gap-2.5 p-3 rounded bg-red-950/30 border border-red-900/40 text-red-400 text-xs font-mono">
                              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                              <span>{fileError}</span>
                              <button onClick={() => setFileError(null)} className="ml-auto text-red-400 hover:text-white font-bold">X</button>
                            </div>
                          )}
                          {Object.keys(uploadProgress).length > 0 && (
                            <div className="space-y-1 rounded border border-emerald-500/20 bg-emerald-500/5 p-3 text-[11px] font-mono">
                              {Object.entries(uploadProgress).map(([name, progress]) => <div key={name} className="flex gap-3"><span className="flex-1 truncate">{name.split('-').slice(0, -2).join('-')}</span><span>{progress}%</span></div>)}
                            </div>
                          )}

                          {/* Create Folder Inline Form */}
                          {showCreateFolder && (
                            <div className="p-4 rounded-lg bg-[#111116] border border-blue-500/30 flex flex-col sm:flex-row gap-3 items-end sm:items-center">
                              <div className="flex-1">
                                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1.5 font-mono">Tên thư mục mới</label>
                                <input
                                  type="text"
                                  value={newDirName}
                                  onChange={(e) => setNewDirName(e.target.value)}
                                  placeholder="Nhập tên thư mục..."
                                  className="w-full px-3 py-2 bg-black border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500 font-mono"
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={createNewDir}
                                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white rounded transition cursor-pointer"
                                >
                                  Tạo thư mục
                                </button>
                                <button
                                  onClick={() => setShowCreateFolder(false)}
                                  className="px-4 py-2 bg-[#1c1c24] hover:bg-[#252530] text-xs font-semibold text-slate-400 rounded transition cursor-pointer"
                                >
                                  Hủy
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Create File Inline Form */}
                          {showCreateFile && (
                            <div className="p-4 rounded-lg bg-[#111116] border border-purple-500/30 flex flex-col sm:flex-row gap-3 items-end sm:items-center">
                              <div className="flex-1">
                                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1.5 font-mono">Tên tệp tin mới</label>
                                <input
                                  type="text"
                                  value={newFileName}
                                  onChange={(e) => setNewFileName(e.target.value)}
                                  placeholder="Nhập tên tệp (ví dụ: script.sh, notes.txt)..."
                                  className="w-full px-3 py-2 bg-black border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500 font-mono"
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={createNewFile}
                                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white rounded transition cursor-pointer"
                                >
                                  Tạo tệp
                                </button>
                                <button
                                  onClick={() => setShowCreateFile(false)}
                                  className="px-4 py-2 bg-[#1c1c24] hover:bg-[#252530] text-xs font-semibold text-slate-400 rounded transition cursor-pointer"
                                >
                                  Hủy
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Breadcrumb & Search Bar */}
                          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
                            {/* Breadcrumb Path Bar */}
                            <div className="flex-1 flex items-center gap-1 px-2 py-2 bg-[#0d0d12] border border-white/10 rounded-lg text-xs font-mono text-slate-400 min-w-0">
                              <button onClick={() => navigateHistory(-1)} disabled={historyIndex <= 0} className="p-1 disabled:opacity-30"><ArrowLeft className="w-3.5 h-3.5" /></button>
                              <button onClick={() => navigateHistory(1)} disabled={historyIndex >= pathHistory.length - 1} className="p-1 disabled:opacity-30"><ChevronRight className="w-3.5 h-3.5" /></button>
                              <span className="text-slate-500 uppercase tracking-widest shrink-0">Đường dẫn:</span>
                              <input value={pathInput} onChange={(event) => setPathInput(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && loadFiles(pathInput)} className="min-w-24 flex-1 bg-white/5 px-2 py-1 text-white outline-none focus:ring-1 focus:ring-blue-500" />
                              <button
                                onClick={() => toggleFileBookmark(currentPath)}
                                className={`shrink-0 p-1.5 rounded border transition-colors cursor-pointer ${fileBookmarks.some((item) => item.path === currentPath) ? 'text-amber-400 bg-amber-500/10 border-amber-500/30' : 'text-slate-500 hover:text-amber-400 border-white/10'}`}
                                title="Ghim hoặc bỏ ghim đường dẫn"
                              >
                                {fileBookmarks.some((item) => item.path === currentPath) ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
                              </button>
                            </div>

                            {/* Search Input Bar */}
                            {!viewingFile && (
                              <div className="relative w-full md:w-80 shrink-0">
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                  <Search className="h-4 w-4 text-slate-500" />
                                </span>
                                <input
                                  type="text"
                                  value={fileSearchQuery}
                                  onChange={(e) => { setFileSearchQuery(e.target.value); if (!e.target.value) setSearchResults(null); }}
                                  onKeyDown={(event) => event.key === 'Enter' && recursiveSearch && runRecursiveSearch()}
                                  placeholder="Tìm kiếm tệp, thư mục..."
                                  className="w-full pl-9 pr-8 py-2.5 bg-[#0d0d12] border border-white/10 rounded-lg text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                                />
                                {fileSearchQuery && (
                                  <button
                                    onClick={() => setFileSearchQuery('')}
                                    className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-500 hover:text-white cursor-pointer"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 overflow-x-auto text-[11px] font-mono text-slate-500">
                            <button onClick={() => loadFiles('/')} className="px-1.5 py-1 hover:text-blue-400">/</button>
                            {currentPath.replace(/\\/g, '/').split('/').filter(Boolean).map((segment, index, segments) => {
                              const prefix = currentPath.startsWith('/') ? '/' : '';
                              const path = prefix + segments.slice(0, index + 1).join('/');
                              return <span key={`${path}-${index}`} className="flex items-center gap-1"><ChevronRight className="w-3 h-3" /><button onClick={() => loadFiles(path)} className="whitespace-nowrap px-1 py-1 hover:text-blue-400">{segment}</button></span>;
                            })}
                          </div>
                          {!viewingFile && <label className="flex items-center gap-2 text-[11px] text-slate-400"><input type="checkbox" checked={recursiveSearch} onChange={(e) => { setRecursiveSearch(e.target.checked); setSearchResults(null); }} /> Tìm đệ quy (Enter để tìm){searchTruncated && <span className="text-amber-400">Kết quả đã bị giới hạn</span>}</label>}

                          {!viewingFile && currentUser?.role !== 'viewer' && selectedPaths.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded border border-blue-500/20 bg-blue-500/5 p-2 text-xs">
                            <span className="mr-auto">Đã chọn {selectedPaths.length} mục</span>
                            <button onClick={() => setFileClipboard({ operation: 'copy', paths: selectedPaths })} className="px-2 py-1 bg-white/10 rounded">Sao chép</button>
                            <button onClick={() => setFileClipboard({ operation: 'move', paths: selectedPaths })} className="px-2 py-1 bg-white/10 rounded">Cắt</button>
                            <button onClick={() => trashPaths(selectedPaths)} className="px-2 py-1 bg-red-500/20 text-red-300 rounded">Thùng rác</button>
                          </div>}
                          {!viewingFile && fileClipboard && <button onClick={() => transferFiles(fileClipboard.operation, fileClipboard.paths)} className="text-xs px-3 py-2 rounded bg-emerald-600 text-white">Dán {fileClipboard.paths.length} mục vào đây</button>}

                          {fileBookmarks.length > 0 && (
                            <div className="flex items-center gap-2 overflow-x-auto pb-1">
                              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono shrink-0">Đã ghim:</span>
                              {fileBookmarks.map((bookmark) => (
                                <div key={bookmark.path} className="flex items-center shrink-0 rounded border border-amber-500/20 bg-amber-500/5 overflow-hidden">
                                  <button
                                    onClick={() => loadFiles(bookmark.path)}
                                    className="max-w-64 truncate px-2.5 py-1.5 text-[11px] font-mono text-amber-300 hover:bg-amber-500/10 cursor-pointer"
                                    title={`Mở ${bookmark.path || '/'}`}
                                  >
                                    {bookmark.label}
                                  </button>
                                  <button onClick={() => { const label = prompt('Nhãn bookmark:', bookmark.label)?.trim(); if (label) setFileBookmarks((items) => { const next = items.map((item) => item.path === bookmark.path ? { ...item, label } : item); localStorage.setItem(FILE_BOOKMARKS_KEY, JSON.stringify(next)); return next; }); }} className="p-1.5 border-l border-amber-500/20"><Edit className="w-3 h-3" /></button>
                                  <button
                                    onClick={() => toggleFileBookmark(bookmark.path)}
                                    className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 border-l border-amber-500/20 cursor-pointer"
                                    title="Bỏ ghim"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Conditional View: File Editor OR Directory List */}
                          {viewingFile ? (
                            <div className="rounded-xl border border-white/10 bg-[#0d0d12]/60 overflow-hidden shadow-2xl flex flex-col">
                              {/* Editor Header */}
                              <div className="bg-[#111116]/80 px-5 py-3.5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex items-center gap-2 font-mono">
                                  {getFileIcon(viewingFile)}
                                  <span className="text-xs text-white truncate max-w-md" title={viewingFile}>
                                    {viewingFile.replace(/\\/g, '/').split('/').pop()}
                                  </span>
                                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                    {previewKind(viewingFile) !== 'text' ? previewKind(viewingFile) : isEditingFile ? (fileContent !== editorOriginal ? 'Chưa lưu' : 'Đang chỉnh sửa') : 'Chỉ xem'}
                                  </span>
                                </div>
                                <div className="flex gap-2">
                                  <button onClick={() => openSnapshots(viewingFile)} className="px-3 py-1.5 bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded text-xs">Lịch sử</button>
                                  {previewKind(viewingFile) !== 'text' ? null : isEditingFile ? (
                                    <>
                                      <button
                                        onClick={saveEditedFile}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white rounded transition cursor-pointer"
                                      >
                                        <Save className="w-3.5 h-3.5" />
                                        <span>Lưu tệp</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          setIsEditingFile(false);
                                          openFile(viewingFile);
                                        }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1c1c24] hover:bg-[#252530] text-xs font-semibold text-slate-300 rounded border border-white/10 transition cursor-pointer"
                                      >
                                        <span>Hủy</span>
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => setIsEditingFile(true)}
                                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white rounded transition cursor-pointer"
                                    >
                                      <Edit className="w-3.5 h-3.5" />
                                      <span>Chỉnh sửa</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => { if (isEditingFile && fileContent !== editorOriginal && !confirm('Bỏ các thay đổi chưa lưu?')) return; setViewingFile(null); setFileContent(null); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111116] hover:bg-[#1c1c24] text-xs font-semibold text-slate-400 border border-white/10 rounded transition cursor-pointer"
                                  >
                                    <ArrowLeft className="w-3.5 h-3.5" />
                                    <span>Đóng</span>
                                  </button>
                                </div>
                              </div>

                              {/* Editor Content */}
                              {previewKind(viewingFile) === 'video' ? (
                                <div className="bg-black p-4 flex justify-center">
                                  <video
                                    key={viewingFile}
                                    src={`${API_URL}/api/files/media?path=${encodeURIComponent(viewingFile)}&ticket=${encodeURIComponent(previewTicket || '')}`}
                                    controls
                                    playsInline
                                    preload="metadata"
                                    className="max-h-[70vh] w-full bg-black"
                                  >
                                    Trình duyệt không hỗ trợ phát video này.
                                  </video>
                                </div>
                              ) : previewKind(viewingFile) === 'audio' ? (
                                <div className="min-h-64 bg-gradient-to-br from-slate-950 via-purple-950/40 to-black p-8 flex items-center justify-center">
                                  <audio
                                    key={viewingFile}
                                    src={`${API_URL}/api/files/media?path=${encodeURIComponent(viewingFile)}&ticket=${encodeURIComponent(previewTicket || '')}`}
                                    controls
                                    preload="metadata"
                                    className="w-full max-w-2xl"
                                  >
                                    Trình duyệt không hỗ trợ phát âm thanh này.
                                  </audio>
                                </div>
                              ) : previewKind(viewingFile) === 'image' ? (
                                <div className="min-h-96 bg-[linear-gradient(45deg,#111_25%,transparent_25%),linear-gradient(-45deg,#111_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#111_75%),linear-gradient(-45deg,transparent_75%,#111_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0px] p-4 flex items-center justify-center overflow-auto">
                                  {/* Authenticated filesystem images cannot use Next's build-time image optimizer. */}
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={`${API_URL}/api/files/media?path=${encodeURIComponent(viewingFile)}&ticket=${encodeURIComponent(previewTicket || '')}`}
                                    alt={viewingFile.replace(/\\/g, '/').split('/').pop() || 'Ảnh xem trước'}
                                    className="max-h-[75vh] max-w-full object-contain shadow-2xl"
                                  />
                                </div>
                              ) : previewKind(viewingFile) === 'pdf' || previewKind(viewingFile) === 'office' ? (
                                <iframe
                                  key={viewingFile}
                                  src={`${API_URL}/api/files/${previewKind(viewingFile) === 'office' ? 'office-preview' : 'media'}?path=${encodeURIComponent(viewingFile)}&ticket=${encodeURIComponent(previewTicket || '')}`}
                                  title={`Xem trước ${viewingFile}`}
                                  className="h-[75vh] w-full bg-white"
                                />
                              ) : <div className="p-4 bg-black">
                                <div className="flex flex-wrap gap-2 mb-2">
                                  <input value={editorFind} onChange={(e) => setEditorFind(e.target.value)} placeholder="Tìm" className="bg-[#111116] border border-white/10 px-2 py-1 text-xs rounded" />
                                  <input value={editorReplace} onChange={(e) => setEditorReplace(e.target.value)} placeholder="Thay thế" className="bg-[#111116] border border-white/10 px-2 py-1 text-xs rounded" />
                                  <button onClick={() => { const area = editorRef.current; if (!area || !editorFind) return; const start = (fileContent || '').indexOf(editorFind, area.selectionEnd); const index = start < 0 ? (fileContent || '').indexOf(editorFind) : start; if (index >= 0) { area.focus(); area.setSelectionRange(index, index + editorFind.length); } }} className="px-2 py-1 text-xs bg-white/10 rounded">Tìm tiếp</button>
                                  <button disabled={!isEditingFile} onClick={() => setFileContent((fileContent || '').split(editorFind).join(editorReplace))} className="px-2 py-1 text-xs bg-white/10 rounded disabled:opacity-30">Thay tất cả</button>
                                </div>
                                <textarea
                                  ref={editorRef}
                                  value={fileContent || ''}
                                  onChange={(e) => setFileContent(e.target.value)}
                                  onSelect={(e) => { const value = e.currentTarget.value.slice(0, e.currentTarget.selectionStart); const lines = value.split('\n'); setEditorPosition({ line: lines.length, char: lines[lines.length - 1].length + 1 }); }}
                                  onKeyDown={(e) => {
                                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveEditedFile(); }
                                    if (isEditingFile && e.key === 'Tab') { e.preventDefault(); const area = e.currentTarget; const start = area.selectionStart; const next = `${area.value.slice(0, start)}  ${area.value.slice(area.selectionEnd)}`; setFileContent(next); requestAnimationFrame(() => area.setSelectionRange(start + 2, start + 2)); }
                                  }}
                                  readOnly={!isEditingFile}
                                  className="w-full h-96 bg-black text-slate-300 font-mono text-xs focus:outline-none resize-y p-3 rounded border border-white/5 focus:border-white/20 select-all leading-relaxed"
                                  spellCheck={false}
                                  placeholder="Nội dung tệp rỗng..."
                                />
                                <div className="mt-2 text-right text-[10px] font-mono text-slate-500">Dòng {editorPosition.line}, ký tự {editorPosition.char} | {(fileContent || '').length} ký tự | Ctrl+S để lưu</div>
                              </div>}
                            </div>
                          ) : (
                            /* Directory List */
                            <div className="rounded-xl border border-white/10 bg-[#0d0d12]/60 overflow-hidden shadow-2xl" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); uploadFiles(Array.from(event.dataTransfer.files)); }}>
                              <div className="flex flex-wrap gap-2 p-2 border-b border-white/10 text-[11px]">
                                <span className="text-slate-500 mr-auto">Kéo nhiều tệp từ máy tính vào đây để upload</span>
                                {currentUser && ['admin', 'root'].includes(currentUser.role) && <button onClick={() => { pendingTerminalCwdRef.current = currentPath; setActiveTab('terminal'); }} className="px-2 py-1 bg-white/5 rounded">Mở Terminal tại đây</button>}
                                <button onClick={async () => { const name = prompt('Tên archive (gồm phần mở rộng):', 'archive.zip')?.trim(); if (!name) return; const format = name.endsWith('.tar.gz') ? 'tar.gz' : name.split('.').pop() || 'zip'; try { await requestFileApi('/api/files/archive/create', { method: 'POST', body: JSON.stringify({ paths: selectedPaths.length ? selectedPaths : [currentPath], destinationDir: currentPath, name, format }) }); await loadFiles(currentPath, null, 'none'); } catch (error: any) { setFileError(error.message); } }} className="px-2 py-1 bg-white/5 rounded">Tạo archive</button>
                                <button onClick={async () => { const name = prompt('Tên symlink mới:', 'link')?.trim(); const targetPath = name && prompt('Đường dẫn đích:')?.trim(); if (!name || !targetPath) return; try { await requestFileApi('/api/files/symlink', { method: 'POST', body: JSON.stringify({ name, targetPath, destinationDir: currentPath }) }); await loadFiles(currentPath, null, 'none'); } catch (error: any) { setFileError(error.message); } }} className="px-2 py-1 bg-white/5 rounded">Tạo symlink</button>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse text-sm">
                                  <thead>
                                    <tr className="bg-[#111116]/80 border-b border-white/10 text-[10px] text-slate-500 font-mono uppercase tracking-widest">
                                      <th className="py-3.5 pl-4 font-semibold"><input type="checkbox" checked={filteredFiles.length > 0 && filteredFiles.every((item) => selectedPaths.includes(item.path))} onChange={(event) => setSelectedPaths(event.target.checked ? filteredFiles.map((item) => item.path) : [])} aria-label="Chọn tất cả" /></th>
                                      <th className="py-3.5 px-3 font-semibold">Tên</th>
                                      <th className="py-3.5 px-5 font-semibold hidden sm:table-cell">Kích thước</th>
                                      <th className="py-3.5 px-5 font-semibold hidden md:table-cell">Lần cuối sửa</th>
                                      <th className="py-3.5 px-5 font-semibold text-right">Thao tác</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/5 font-mono text-xs">
                                    {filteredFiles.length === 0 ? (
                                      <tr>
                                        <td colSpan={4} className="py-12 text-center text-slate-600 font-mono italic">
                                          {fileSearchQuery ? 'Không tìm thấy tệp hoặc thư mục phù hợp.' : 'Thư mục này trống hoặc không có quyền truy cập.'}
                                        </td>
                                      </tr>
                                    ) : (
                                      filteredFiles.map((file, index) => {
                                        const fullItemPath = file.path;
                                        return (
                                          <tr key={index} className="hover:bg-white/[0.02] transition-colors group">
                                            {/* File / Folder Name Clickable */}
                                            <td className="py-3.5 pl-4"><input type="checkbox" checked={selectedPaths.includes(fullItemPath)} onChange={() => setSelectedPaths((items) => items.includes(fullItemPath) ? items.filter((item) => item !== fullItemPath) : [...items, fullItemPath])} aria-label={`Chọn ${file.name}`} /></td>
                                            <td className="py-3.5 px-3">
                                              {file.isDirectory ? (
                                                <button
                                                  onClick={() => loadFiles(fullItemPath)}
                                                  className="flex items-center gap-2.5 text-blue-400 hover:text-blue-300 font-semibold cursor-pointer text-left"
                                                >
                                                  <Folder className="w-4 h-4 shrink-0 text-blue-500" />
                                                  <span className="truncate max-w-xs sm:max-w-md">{file.name}/</span>
                                                </button>
                                              ) : (
                                                <button
                                                  onClick={() => openFile(fullItemPath)}
                                                  className="flex items-center gap-2.5 text-slate-300 hover:text-white cursor-pointer text-left"
                                                >
                                                  {getFileIcon(file.name)}
                                                  <span className="truncate max-w-xs sm:max-w-md">{file.name}</span>
                                                </button>
                                              )}
                                            </td>

                                            {/* Size */}
                                            <td className="py-3.5 px-5 text-slate-400 hidden sm:table-cell">
                                              {file.isDirectory ? (
                                                <span className="text-[10px] text-slate-600 uppercase">Thư mục</span>
                                              ) : (
                                                <span>
                                                  {file.size < 1024
                                                    ? `${file.size} B`
                                                    : file.size < 1024 * 1024
                                                    ? `${(file.size / 1024).toFixed(1)} KB`
                                                    : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
                                                </span>
                                              )}
                                            </td>

                                            {/* Mtime */}
                                            <td className="py-3.5 px-5 text-slate-500 hidden md:table-cell">
                                              {new Date(file.mtime).toLocaleString()}
                                            </td>

                                            {/* Actions */}
                                            <td className="py-2.5 px-5 text-right">
                                              <div className="flex items-center justify-end gap-1.5">
                                                {file.isDirectory ? (
                                                  <button
                                                    onClick={() => loadFiles(fullItemPath)}
                                                    className="p-1.5 rounded bg-blue-500/5 hover:bg-blue-500/20 text-blue-400 border border-blue-500/10 cursor-pointer transition-colors"
                                                    title="Mở thư mục"
                                                  >
                                                    <ChevronRight className="w-3.5 h-3.5" />
                                                  </button>
                                                ) : (
                                                  <>
                                                    <button
                                                      onClick={() => downloadFile(fullItemPath)}
                                                      className="p-1.5 rounded bg-emerald-500/5 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/10 cursor-pointer transition-colors"
                                                      title="Tải xuống"
                                                    >
                                                      <Download className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                      onClick={() => openFile(fullItemPath)}
                                                      className="p-1.5 rounded bg-purple-500/5 hover:bg-purple-500/20 text-purple-400 border border-purple-500/10 cursor-pointer transition-colors"
                                                      title="Xem tệp"
                                                    >
                                                      <Eye className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                      onClick={() => {
                                                        openFile(fullItemPath).then(() => {
                                                          setIsEditingFile(true);
                                                        });
                                                      }}
                                                      className="p-1.5 rounded bg-blue-500/5 hover:bg-blue-500/20 text-blue-400 border border-blue-500/10 cursor-pointer transition-colors"
                                                      title="Sửa tệp"
                                                    >
                                                      <Edit className="w-3.5 h-3.5" />
                                                    </button>
                                                  </>
                                                 )}
                                                 <button onClick={async () => { try { const data = await requestFileApi(`/api/files/metadata?path=${encodeURIComponent(fullItemPath)}`); setMetadata({ path: fullItemPath, mode: String(data.mode ?? data.metadata?.mode ?? ''), uid: Number(data.uid ?? data.metadata?.uid ?? 0), gid: Number(data.gid ?? data.metadata?.gid ?? 0) }); } catch (error: any) { setFileError(error.message); } }} className="p-1.5 rounded bg-white/5 text-slate-400 border border-white/10" title="Quyền"><Lock className="w-3.5 h-3.5" /></button>
                                                  {!file.isDirectory && /\.(zip|tar|tgz|tar\.gz)$/i.test(file.name) && <button onClick={async () => { const destinationDir = prompt('Giải nén vào:', currentPath)?.trim(); if (!destinationDir) return; try { await requestFileApi('/api/files/archive/extract', { method: 'POST', body: JSON.stringify({ archivePath: fullItemPath, destinationDir }) }); await loadFiles(currentPath, null, 'none'); } catch (error: any) { setFileError(error.message); } }} className="p-1.5 rounded bg-cyan-500/5 text-cyan-400 border border-cyan-500/10" title="Giải nén"><Download className="w-3.5 h-3.5" /></button>}
                                                 <button
                                                  onClick={() => moveOrRename(fullItemPath)}
                                                  className="p-1.5 rounded bg-amber-500/5 hover:bg-amber-500/20 text-amber-400 border border-amber-500/10 cursor-pointer transition-colors"
                                                  title="Đổi tên"
                                                >
                                                  <Move className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                  onClick={() => deleteFileOrFolder(fullItemPath)}
                                                  className="p-1.5 rounded bg-red-500/5 hover:bg-red-500/20 text-red-400 border border-red-500/10 cursor-pointer transition-colors"
                                                  title="Xóa"
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                    {metadata && <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"><div className="w-full max-w-md rounded-xl border border-white/10 bg-[#111116] p-5 space-y-4">
                      <div className="flex"><h4 className="font-bold text-white">Quyền và sở hữu</h4><button onClick={() => setMetadata(null)} className="ml-auto"><X className="w-4 h-4" /></button></div>
                      <p className="text-xs font-mono truncate">{metadata.path}</p>
                      <label className="block text-xs">Mode<input value={metadata.mode} onChange={(e) => setMetadata({ ...metadata, mode: e.target.value })} className="mt-1 w-full bg-black border border-white/10 rounded p-2 font-mono" /></label>
                      <div className="grid grid-cols-2 gap-3"><label className="text-xs">UID<input type="number" value={metadata.uid} onChange={(e) => setMetadata({ ...metadata, uid: Number(e.target.value) })} className="mt-1 w-full bg-black border border-white/10 rounded p-2" /></label><label className="text-xs">GID<input type="number" value={metadata.gid} onChange={(e) => setMetadata({ ...metadata, gid: Number(e.target.value) })} className="mt-1 w-full bg-black border border-white/10 rounded p-2" /></label></div>
                      <button onClick={async () => { try { await requestFileApi('/api/files/metadata', { method: 'PATCH', body: JSON.stringify(metadata) }); setMetadata(null); await loadFiles(currentPath, null, 'none'); } catch (error: any) { setFileError(error.message); } }} className="w-full bg-blue-600 rounded py-2 text-sm text-white">Lưu quyền</button>
                    </div></div>}
                    {showTrash && <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"><div className="w-full max-w-2xl max-h-[80vh] overflow-auto rounded-xl border border-white/10 bg-[#111116] p-5 space-y-4">
                      <div className="flex items-center"><h4 className="font-bold text-white">Thùng rác</h4><button onClick={() => setShowTrash(false)} className="ml-auto"><X className="w-4 h-4" /></button></div>
                      {trashItems.length === 0 ? <p className="text-sm text-slate-500">Thùng rác trống.</p> : trashItems.map((item) => <label key={item.id} className="flex gap-3 p-3 border border-white/5 rounded text-xs"><input type="checkbox" checked={selectedTrashIds.includes(item.id)} onChange={() => setSelectedTrashIds((ids) => ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id])} /><span className="flex-1 min-w-0"><span className="block text-white truncate">{item.name || item.originalPath.split('/').pop()}</span><span className="text-slate-500 font-mono break-all">{item.originalPath}</span></span><span className="text-slate-500">{item.deletedAt ? new Date(item.deletedAt).toLocaleString() : ''}</span></label>)}
                      <div className="flex flex-wrap gap-2"><button disabled={!selectedTrashIds.length} onClick={() => trashAction('restore', selectedTrashIds)} className="px-3 py-2 bg-emerald-600 rounded text-xs disabled:opacity-30">Khôi phục</button><button disabled={!selectedTrashIds.length} onClick={() => confirm('Xóa vĩnh viễn các mục đã chọn?') && trashAction('delete', selectedTrashIds)} className="px-3 py-2 bg-red-600 rounded text-xs disabled:opacity-30">Xóa vĩnh viễn</button><button onClick={() => confirm('Dọn sạch toàn bộ thùng rác?') && trashAction('empty')} className="ml-auto px-3 py-2 bg-red-950 text-red-300 rounded text-xs">Dọn sạch</button></div>
                    </div></div>}
                    {showSnapshots && <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"><div className="w-full max-w-4xl max-h-[85vh] overflow-auto rounded-xl border border-white/10 bg-[#111116] p-5 space-y-4">
                      <div className="flex items-center gap-3"><Database className="w-5 h-5 text-amber-400" /><div><h4 className="font-bold text-white">Lịch sử snapshot</h4><p className="text-[10px] text-slate-500 font-mono">{snapshotPath || 'Tất cả tệp'} · {snapshots.length} phiên bản</p></div><button onClick={() => setShowSnapshots(false)} className="ml-auto"><X className="w-4 h-4" /></button></div>
                      {snapshots.length === 0 ? <p className="py-12 text-center text-sm text-slate-500">Chưa có snapshot phù hợp.</p> : <div className="space-y-2">{snapshots.map(snapshot => <div key={snapshot.id} className="grid md:grid-cols-[1fr_180px_auto] gap-3 items-center p-3 rounded border border-white/5 bg-black/40"><div className="min-w-0"><div className="text-xs text-white truncate">{snapshot.originalPath}</div><div className="mt-1 text-[10px] text-slate-500 font-mono">{snapshot.reason} · {(snapshot.size / 1024).toFixed(1)} KB · mode {snapshot.mode.toString(8)}</div><code className="block mt-1 text-[9px] text-slate-600 truncate" title={snapshot.checksum}>SHA-256 {snapshot.checksum}</code></div><div className="text-[10px] text-slate-500">{new Date(snapshot.createdAt).toLocaleString()}</div><div className="flex gap-2"><button onClick={() => downloadSnapshot(snapshot.id, snapshot.originalPath.split('/').pop() || 'snapshot')} className="text-xs text-blue-400">Tải</button>{currentUser?.role !== 'viewer' && <><button onClick={() => restoreSnapshot(snapshot.id)} className="text-xs text-emerald-400">Khôi phục</button><button onClick={() => deleteSnapshot(snapshot.id)} className="text-xs text-red-400">Xóa</button></>}</div></div>)}</div>}
                    </div></div>}
                    {serviceLogs && <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"><div className="w-full max-w-5xl max-h-[85vh] flex flex-col rounded-xl border border-white/10 bg-[#111116] p-5 gap-4"><div className="flex items-center"><div><h4 className="font-bold text-white">Journal: {serviceLogs.unit}</h4><p className="text-[10px] text-slate-500">200 dòng gần nhất</p></div><button onClick={() => setServiceLogs(null)} className="ml-auto"><X className="w-4 h-4" /></button></div><pre className="flex-1 overflow-auto whitespace-pre-wrap break-words bg-black border border-white/5 rounded p-4 text-[11px] leading-relaxed text-slate-300 font-mono">{serviceLogs.logs || 'Không có log.'}</pre></div></div>}
                    {sqliteRecordModal && <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"><div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-emerald-500/20 bg-[#0d1110] shadow-2xl"><div className="sticky top-0 z-[1] flex items-center gap-3 p-5 border-b border-white/10 bg-[#0d1110]"><Table2 className="w-5 h-5 text-emerald-400" /><div><h4 className="font-bold text-white">{sqliteRecordModal.mode === 'add' ? 'Thêm bản ghi' : 'Chỉnh sửa bản ghi'}</h4><p className="mt-1 text-[10px] text-slate-500 font-mono">{selectedSqliteTable} · nhập chính xác <span className="text-emerald-400">NULL</span> để lưu giá trị null</p></div><button onClick={() => setSqliteRecordModal(null)} className="ml-auto"><X className="w-4 h-4" /></button></div><div className="grid sm:grid-cols-2 gap-3 p-5">{Object.entries(sqliteRecordValues).map(([column, value]) => <label key={column} className="block text-[10px] uppercase tracking-wider text-slate-500"><span className="flex items-center gap-2">{column}{sqliteColumns.find(item => item.name === column)?.primaryKey && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[8px] text-amber-400">PK</span>}</span><textarea value={value === null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value)} onChange={event => setSqliteRecordValues(values => ({ ...values, [column]: event.target.value }))} rows={2} className="mt-1.5 w-full resize-y rounded border border-white/10 bg-black p-2.5 text-xs font-mono normal-case tracking-normal text-white outline-none focus:border-emerald-500/40" /></label>)}</div><div className="sticky bottom-0 flex justify-end gap-2 p-4 border-t border-white/10 bg-[#0d1110]"><button onClick={() => setSqliteRecordModal(null)} className="px-4 py-2 text-xs border border-white/10 rounded">Hủy</button><button onClick={saveSqliteRecord} disabled={sqliteLoading} className="flex items-center gap-2 px-4 py-2 text-xs bg-emerald-500 text-black font-bold rounded disabled:opacity-40"><Save className="w-3.5 h-3.5" />{sqliteRecordModal.mode === 'add' ? 'Thêm bản ghi' : 'Lưu thay đổi'}</button></div></div></div>}
                    {showCreateSqlite && <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"><div className="w-full max-w-2xl rounded-xl border border-emerald-500/20 bg-[#0d1110] p-5 space-y-4 shadow-2xl"><div className="flex items-start gap-3"><Database className="w-5 h-5 text-emerald-400" /><div><h4 className="font-bold text-white">Tạo SQLite mới</h4><p className="mt-1 text-[10px] text-slate-500 font-mono">Đường dẫn tương đối trong vùng SQLite của server</p></div><button onClick={() => setShowCreateSqlite(false)} className="ml-auto"><X className="w-4 h-4" /></button></div><label className="block text-xs text-slate-400">Đường dẫn database<input value={newSqlitePath} onChange={event => setNewSqlitePath(event.target.value)} placeholder="data/app.sqlite" className="mt-1.5 w-full bg-black border border-white/10 focus:border-emerald-500/50 outline-none rounded px-3 py-2.5 text-white font-mono" /></label><label className="block text-xs text-slate-400">Schema khởi tạo <span className="text-slate-600">(không bắt buộc)</span><textarea value={newSqliteSchema} onChange={event => setNewSqliteSchema(event.target.value)} placeholder={'CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL\n);'} spellCheck={false} className="mt-1.5 w-full min-h-48 resize-y bg-black border border-white/10 focus:border-emerald-500/50 outline-none rounded p-3 text-emerald-200 text-xs font-mono" /></label><div className="flex justify-end gap-2"><button onClick={() => setShowCreateSqlite(false)} className="px-4 py-2 text-xs border border-white/10 rounded">Hủy</button><button onClick={createSqlite} disabled={sqliteLoading || !newSqlitePath.trim()} className="px-4 py-2 text-xs bg-emerald-500 text-black font-bold rounded disabled:opacity-40">Tạo database</button></div></div></div>}
                  </AnimatePresence>
                </div>
              </main>
            </div>

            {/* Footer Status Bar */}
            <footer className="h-8 bg-[#111116] border-t border-white/10 flex items-center justify-between px-6 shrink-0 text-[10px] font-mono text-slate-500 uppercase tracking-widest z-10 select-none">
              <div className="flex gap-6">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                  Socket.io: Sẵn sàng
                </span>
                <span className="hidden sm:inline">Bộ nhớ đệm: 1024kb</span>
                <span className="hidden md:inline text-slate-400">Node-PTY: Hoạt động</span>
              </div>
              <div className="flex gap-6">
                <span>Cổng: 3000</span>
                <span className="hidden sm:inline">Máy chủ: 127.0.0.1</span>
                <span className="text-slate-400">UTF-8</span>
              </div>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
      {stepUpPrompt && <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"><div className="w-full max-w-md rounded-xl border border-red-500/30 bg-[#111116] p-6 space-y-4 shadow-2xl">
        <div className="flex items-start gap-3"><ShieldCheck className="w-6 h-6 text-red-400 shrink-0" /><div><h3 className="font-bold text-white">Xác nhận thao tác nguy hiểm</h3><p className="mt-1 text-xs text-slate-400">Quyền xác nhận có hiệu lực 5 phút cho session hiện tại.</p></div></div>
        <input type="password" value={stepUpPassword} onChange={(e) => setStepUpPassword(e.target.value)} placeholder="Mật khẩu hiện tại" autoFocus className="w-full bg-black border border-white/10 rounded px-3 py-2 text-sm" />
        <input value={stepUpCode} onChange={(e) => setStepUpCode(e.target.value)} placeholder="Mã 2FA hoặc recovery code (nếu đã bật)" autoComplete="one-time-code" className="w-full bg-black border border-white/10 rounded px-3 py-2 text-sm" />
        {stepUpError && <p className="text-xs text-red-400">{stepUpError}</p>}
        <div className="flex justify-end gap-2"><button onClick={cancelStepUp} className="px-4 py-2 text-xs border border-white/10 rounded">Hủy</button><button onClick={submitStepUp} disabled={!stepUpPassword} className="px-4 py-2 text-xs bg-red-600 text-white rounded disabled:opacity-40">Xác nhận</button></div>
      </div></div>}
    </div>
  );
}
