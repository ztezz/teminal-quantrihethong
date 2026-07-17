"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import {
  LoadingScreen,
  LoginScreen,
} from "./components/control-center/AuthScreens";
import {
  CommandPalette,
  ConfirmDialog,
  ContextMenu,
  StepUpDialog,
  ToastRegion,
} from "./components/control-center/Overlays";
import {
  Footer,
  Header,
  MobileBackdrop,
  Sidebar,
} from "./components/control-center/DashboardChrome";
import { ResourceModals } from "./components/control-center/ResourceModals";
import { LogsWorkspace } from "./components/control-center/workspaces/LogsWorkspace";
import { SystemWorkspace } from "./components/control-center/workspaces/SystemWorkspace";
import { TerminalWorkspace } from "./components/control-center/workspaces/TerminalWorkspace";
import { SQLiteWorkspace } from "./components/control-center/workspaces/SQLiteWorkspace";
import { SettingsWorkspace } from "./components/control-center/workspaces/SettingsWorkspace";
import { FileWorkspace } from "./components/control-center/workspaces/FileWorkspace";
import { OverviewWorkspace } from "./components/control-center/workspaces/OverviewWorkspace";
import { JobsWorkspace } from "./components/control-center/workspaces/JobsWorkspace";
import { apiClient } from "@/lib/client/api";
import { applyUiPreferences } from "@/lib/client/preferences";
import { useMetricsPolling } from "@/hooks/use-operations-data";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useSystemManagement } from "@/hooks/use-system-management";
import {
  API_URL,
  FILE_BOOKMARKS_KEY,
  getSavedActiveTab,
  getSavedFileBookmarks,
  getSavedFilePath,
  getSavedSidebarState,
  getSavedSqliteHistory,
  LAST_FILE_PATH_KEY,
  MAIN_SIDEBAR_WIDTH_KEY,
  previewKind,
  SQLITE_HISTORY_KEY,
  SQLITE_SIDEBAR_WIDTH_KEY,
} from "./components/control-center/helpers";
import type {
  ActiveTab,
  ConfirmOptions,
  ConfirmPrompt,
  ContextMenuState,
  FileBookmark,
  FileMetadata,
  FileSnapshot,
  ManagedUser,
  SecuritySession,
  SqliteBackup,
  SqliteBrowserItem,
  SqliteColumn,
  SqliteFile,
  SqliteHistoryEntry,
  SqliteObject,
  SqliteRecordModal,
  SqliteWorkspace,
  ToastItem,
  ToastKind,
  TrashItem,
  UserRole,
} from "./components/control-center/types";
import "@xterm/xterm/css/xterm.css";

export default function Home() {
  useEffect(() => applyUiPreferences(), []);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("root");
  const [currentUser, setCurrentUser] = useState<{
    username: string;
    role: UserRole;
  } | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [previewTicket, setPreviewTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<string | null>(
    null,
  );
  const [twoFactorCode, setTwoFactorCode] = useState("");

  // Terminal customization preferences
  const [fontSize, setFontSize] = useState<number>(14);
  const [theme, setTheme] = useState<string>("dark-classic");
  const [previewTheme, setPreviewTheme] = useState<string | null>(null);
  const activePreviewTheme = previewTheme !== null ? previewTheme : theme;

  // Save status for persistent server settings.
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSettingsLoadedRef = useRef<boolean>(false);
  const settingsDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const stepUpPromiseRef = useRef<Promise<boolean> | null>(null);
  const stepUpResolveRef = useRef<((granted: boolean) => void) | null>(null);

  // Logs & Settings Management UI State
  const auditLog = useAuditLog(sessionReady);
  const { logs, total: logTotal, offset: logOffset, query: logQuery, setQuery: setLogQuery, category: logCategory, setCategory: setLogCategory, level: logLevel, setLevel: setLogLevel, result: logResult, setResult: setLogResult, integrity: logIntegrity, loading: logLoading, error: logError, load: loadLogs, checkIntegrity: checkLogIntegrity, exportLogs: exportAuditLogs } = auditLog;
  const [activeTab, setActiveTab] = useState<ActiveTab>(getSavedActiveTab);
  const [isSidebarOpen, setIsSidebarOpen] = useState(getSavedSidebarState);
  const [sqliteFiles, setSqliteFiles] = useState<SqliteFile[]>([]);
  const [selectedSqlite, setSelectedSqlite] = useState("");
  const [sqliteObjects, setSqliteObjects] = useState<SqliteObject[]>([]);
  const [selectedSqliteTable, setSelectedSqliteTable] = useState("");
  const [sqliteRows, setSqliteRows] = useState<Record<string, unknown>[]>([]);
  const [sqliteSql, setSqliteSql] = useState(
    "SELECT name, type FROM sqlite_schema ORDER BY type, name;",
  );
  const [sqliteResult, setSqliteResult] = useState<Record<string, unknown>[]>(
    [],
  );
  const [sqliteMessage, setSqliteMessage] = useState<string | null>(null);
  const [sqliteLoading, setSqliteLoading] = useState(false);
  const [showSqliteBrowser, setShowSqliteBrowser] = useState(false);
  const [sqliteBrowserPath, setSqliteBrowserPath] = useState("");
  const [sqliteBrowserParent, setSqliteBrowserParent] = useState<string | null>(
    null,
  );
  const [sqliteBrowserRoot, setSqliteBrowserRoot] = useState("");
  const [sqliteBrowserItems, setSqliteBrowserItems] = useState<
    SqliteBrowserItem[]
  >([]);
  const [sqliteWorkspace, setSqliteWorkspace] =
    useState<SqliteWorkspace>("data");
  const [sqliteColumns, setSqliteColumns] = useState<SqliteColumn[]>([]);
  const [sqliteRowIdentities, setSqliteRowIdentities] = useState<
    Record<string, unknown>[]
  >([]);
  const [sqliteIdentityKind, setSqliteIdentityKind] = useState<
    "primaryKey" | "rowid" | "none"
  >("none");
  const [sqliteTotal, setSqliteTotal] = useState(0);
  const [sqliteOffset, setSqliteOffset] = useState(0);
  const [sqliteLimit, setSqliteLimit] = useState(25);
  const [sqliteSearch, setSqliteSearch] = useState("");
  const [sqliteAppliedSearch, setSqliteAppliedSearch] = useState("");
  const [sqliteSort, setSqliteSort] = useState("");
  const [sqliteOrder, setSqliteOrder] = useState<"asc" | "desc">("asc");
  const [sqliteRecordModal, setSqliteRecordModal] =
    useState<SqliteRecordModal>(null);
  const [sqliteRecordValues, setSqliteRecordValues] = useState<
    Record<string, unknown>
  >({});
  const [sqliteSchemaAction, setSqliteSchemaAction] = useState<
    "createTable" | "addColumn" | "createIndex" | "dropIndex" | "dropTable"
  >("createTable");
  const [sqliteSchemaForm, setSqliteSchemaForm] = useState({
    table: "",
    columns: "id INTEGER PRIMARY KEY\nname TEXT NOT NULL",
    column: "",
    type: "TEXT",
    index: "",
    indexColumns: "",
    unique: false,
  });
  const [sqliteImportFormat, setSqliteImportFormat] = useState<"csv" | "json">(
    "csv",
  );
  const [sqliteImportData, setSqliteImportData] = useState("");
  const [sqliteStats, setSqliteStats] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [sqliteBackups, setSqliteBackups] = useState<SqliteBackup[]>([]);
  const [sqlitePlan, setSqlitePlan] = useState<Record<string, unknown>[]>([]);
  const [sqliteHistory, setSqliteHistory] = useState<SqliteHistoryEntry[]>(
    getSavedSqliteHistory,
  );
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(
    null,
  );
  const [confirmText, setConfirmText] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [mainSidebarWidth, setMainSidebarWidth] = useState(() =>
    typeof window === "undefined"
      ? 280
      : Number(localStorage.getItem(MAIN_SIDEBAR_WIDTH_KEY)) || 280,
  );
  const [sqliteSidebarWidth, setSqliteSidebarWidth] = useState(() =>
    typeof window === "undefined"
      ? 270
      : Number(localStorage.getItem(SQLITE_SIDEBAR_WIDTH_KEY)) || 270,
  );
  const [highlightedSqliteRow, setHighlightedSqliteRow] = useState<
    number | null
  >(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);

  const notify = useCallback(
    (
      kind: ToastKind,
      message: string,
      duration = kind === "loading" ? 0 : 4200,
    ) => {
      const id = ++toastIdRef.current;
      setToasts((items) => [
        ...items.slice(-4),
        { id, kind, message, duration },
      ]);
      if (duration)
        window.setTimeout(
          () => setToasts((items) => items.filter((item) => item.id !== id)),
          duration,
        );
      return id;
    },
    [],
  );

  const dismissToast = (id: number) =>
    setToasts((items) => items.filter((item) => item.id !== id));
  const replaceToast = (
    id: number,
    kind: ToastKind,
    message: string,
    duration = 4200,
  ) => {
    setToasts((items) =>
      items.map((item) =>
        item.id === id ? { id, kind, message, duration } : item,
      ),
    );
    window.setTimeout(() => dismissToast(id), duration);
  };
  const askConfirm = (options: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      setConfirmText("");
      setConfirmPrompt({ ...options, resolve });
    });
  const closeConfirm = (confirmed: boolean) => {
    const prompt = confirmPrompt;
    setConfirmPrompt(null);
    setConfirmText("");
    prompt?.resolve(confirmed);
  };
  const openContextMenu = (
    event: React.MouseEvent,
    kind: ContextMenuState["kind"],
    item: any,
  ) => {
    event.preventDefault();
    const menuWidth = 220;
    const menuHeight = 250;
    setContextMenu({
      x: Math.max(
        8,
        Math.min(event.clientX, window.innerWidth - menuWidth - 8),
      ),
      y: Math.max(
        8,
        Math.min(event.clientY, window.innerHeight - menuHeight - 8),
      ),
      kind,
      item,
    });
  };
  const startResize = (
    event: React.PointerEvent,
    target: "main" | "sqlite",
  ) => {
    if (window.innerWidth < 768) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const onMove = (moveEvent: PointerEvent) => {
      const width = Math.round(
        Math.max(
          target === "main" ? 220 : 210,
          Math.min(
            target === "main" ? 420 : 480,
            target === "main"
              ? moveEvent.clientX
              : moveEvent.clientX - (isSidebarOpen ? mainSidebarWidth : 0) - 24,
          ),
        ),
      );
      if (target === "main") setMainSidebarWidth(width);
      else setSqliteSidebarWidth(width);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      localStorage.setItem(MAIN_SIDEBAR_WIDTH_KEY, String(mainSidebarWidth));
      localStorage.setItem(
        SQLITE_SIDEBAR_WIDTH_KEY,
        String(sqliteSidebarWidth),
      );
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    localStorage.setItem("vps_terminal_active_tab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem("vps_terminal_sidebar_open", String(isSidebarOpen));
  }, [isSidebarOpen]);

  useEffect(() => {
    localStorage.setItem(MAIN_SIDEBAR_WIDTH_KEY, String(mainSidebarWidth));
  }, [mainSidebarWidth]);
  useEffect(() => {
    localStorage.setItem(SQLITE_SIDEBAR_WIDTH_KEY, String(sqliteSidebarWidth));
  }, [sqliteSidebarWidth]);
  useEffect(() => {
    if (paletteOpen)
      requestAnimationFrame(() => paletteInputRef.current?.focus());
  }, [paletteOpen]);

  useEffect(() => {
    if (
      currentUser &&
      !["admin", "root"].includes(currentUser.role) &&
      ["overview", "terminal", "logs", "jobs", "system", "sqlite"].includes(activeTab)
    )
      setTimeout(() => setActiveTab("files"), 0);
  }, [currentUser, activeTab]);

  // System metrics
  const { metrics, error: metricsError } = useMetricsPolling(Boolean(isAuthenticated && sessionReady));
  const cpuPercent = metrics?.cpu ?? null;
  const memUsedMB = metrics?.memUsedMB ?? null;
  const memTotalMB = metrics?.memTotalMB ?? null;
  const memPercent = metrics?.memPercent ?? null;
  const diskUsedGB = metrics?.diskUsedGB ?? null;
  const diskTotalGB = metrics?.diskTotalGB ?? null;
  const diskPercent = metrics?.diskPercent ?? null;

  // File Manager States
  const [filesList, setFilesList] = useState<any[]>([]);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [parentPath, setParentPath] = useState<string>("");
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileMtime, setFileMtime] = useState<string | null>(null);
  const [isEditingFile, setIsEditingFile] = useState<boolean>(false);
  const [fileLoading, setFileLoading] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState<boolean>(false);
  const [showCreateFile, setShowCreateFile] = useState<boolean>(false);
  const [newDirName, setNewDirName] = useState<string>("");
  const [newFileName, setNewFileName] = useState<string>("");
  const [fileSearchQuery, setFileSearchQuery] = useState<string>("");
  const [fileBookmarks, setFileBookmarks] = useState<FileBookmark[]>(
    getSavedFileBookmarks,
  );
  const [pathInput, setPathInput] = useState("");
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyIndexRef = useRef(-1);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [fileClipboard, setFileClipboard] = useState<{
    operation: "copy" | "move";
    paths: string[];
  } | null>(null);
  const [recursiveSearch, setRecursiveSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>(
    {},
  );
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [selectedTrashIds, setSelectedTrashIds] = useState<string[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [snapshots, setSnapshots] = useState<FileSnapshot[]>([]);
  const [snapshotPath, setSnapshotPath] = useState("");
  const [editorOriginal, setEditorOriginal] = useState("");
  const pendingTerminalCwdRef = useRef<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const fileListRequestRef = useRef(0);
  const fileOpenRequestRef = useRef(0);
  const sqliteOpenRequestRef = useRef(0);
  const sqliteRowsRequestRef = useRef(0);

  const visibleFiles = searchResults ?? filesList;
  const filteredFiles = visibleFiles.filter((file) =>
    file.name.toLowerCase().includes(fileSearchQuery.toLowerCase()),
  );

  const loadFiles = useCallback(
    async (
      dirPath?: string,
      _authToken?: string | null,
      historyMode: "push" | "replace" | "none" = "push",
      fallbackToRoot = false,
    ) => {
      if (!sessionReady) return;
      const requestId = ++fileListRequestRef.current;
      setFileLoading(true);
      setFileError(null);
      setFileSearchQuery("");
      try {
        const url = dirPath
          ? `${API_URL}/api/files?path=${encodeURIComponent(dirPath)}`
          : `${API_URL}/api/files`;
        const res = await fetch(url, {
          credentials: "include",
        });
        let data = await res.json();
        if (
          !data.success &&
          data.code === "ENOENT" &&
          dirPath &&
          fallbackToRoot
        ) {
          localStorage.removeItem(LAST_FILE_PATH_KEY);
          const rootResponse = await fetch(`${API_URL}/api/files`, {
            credentials: "include",
          });
          data = await rootResponse.json();
          historyMode = "replace";
        }
        if (requestId !== fileListRequestRef.current) return;
        if (data.success) {
          setFilesList(data.files);
          setCurrentPath(data.currentPath);
          setPathInput(data.currentPath);
          setParentPath(data.parentPath);
          setSelectedPaths([]);
          setSearchResults(null);
          setSearchTruncated(false);
          localStorage.setItem(LAST_FILE_PATH_KEY, data.currentPath);
          if (historyMode !== "none") {
            setPathHistory((history) => {
              if (historyMode === "replace") {
                historyIndexRef.current = 0;
                setHistoryIndex(0);
                return [data.currentPath];
              }
              const base = history.slice(0, historyIndexRef.current + 1);
              const next =
                base[base.length - 1] === data.currentPath
                  ? base
                  : [...base, data.currentPath];
              historyIndexRef.current = next.length - 1;
              setHistoryIndex(historyIndexRef.current);
              return next;
            });
          }
        } else {
          setFileError(data.error || "Không thể tải danh sách tệp tin");
        }
      } catch (err: any) {
        if (requestId === fileListRequestRef.current)
          setFileError("Lỗi kết nối đến máy chủ: " + err.message);
      } finally {
        if (requestId === fileListRequestRef.current) setFileLoading(false);
      }
    },
    [sessionReady],
  );

  const toggleFileBookmark = (bookmarkPath: string) => {
    setFileBookmarks((current) => {
      const updated = current.some((item) => item.path === bookmarkPath)
        ? current.filter((item) => item.path !== bookmarkPath)
        : [...current, { path: bookmarkPath, label: bookmarkPath || "/" }];
      localStorage.setItem(FILE_BOOKMARKS_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const requestFileApi = async (
    endpoint: string,
    options: RequestInit = {},
  ) => {
    if (!sessionReady) throw new Error("Phiên đăng nhập đã hết hạn");
    let response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    if (response.status === 428 && (await requestStepUp()))
      response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        credentials: "include",
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
      });
    const data = await response.json();
    if (!response.ok && response.status !== 207)
      throw new Error(data.error || "Thao tác thất bại");
    return data;
  };

  const requestStepUp = () => {
    if (stepUpPromiseRef.current) return stepUpPromiseRef.current;
    const promise = new Promise<boolean>((resolve) => {
      stepUpResolveRef.current = resolve;
      setStepUpPrompt({ resolve });
    });
    stepUpPromiseRef.current = promise;
    return promise;
  };
  const system = useSystemManagement(sessionReady && activeTab === "system", currentUser?.role, requestStepUp);
  const { view: systemView, setView: setSystemView, services, processes, query: systemQuery, setQuery: setSystemQuery, loading: systemLoading, error: systemError, setError: setSystemError, serviceLogs, setServiceLogs, load: loadSystemData, openServiceLogs } = system;
  const serviceAction = async (unit: string, action: string) => {
    const toast = notify("loading", `${action} ${unit}...`);
    try {
      await system.serviceAction(unit, action);
      replaceToast(toast, "success", `${unit}: ${action} hoàn tất.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Thao tác thất bại";
      setSystemError(message);
      replaceToast(toast, "error", message);
    }
  };
  const signalProcess = async (pid: number, signal: "SIGTERM" | "SIGKILL") => {
    if (!(await askConfirm({ title: `${signal} tiến trình`, message: `${signal} tiến trình PID ${pid}?`, danger: true, requiredText: signal === "SIGKILL" ? String(pid) : undefined, confirmLabel: signal }))) return;
    const toast = notify("loading", `Đang gửi ${signal} tới PID ${pid}...`);
    try {
      await system.signalProcess(pid, signal);
      replaceToast(toast, "success", `Đã gửi ${signal} tới PID ${pid}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Thao tác thất bại";
      setSystemError(message);
      replaceToast(toast, "error", message);
    }
  };
  const stopService = async (unit: string) => {
    if (await askConfirm({ message: `Dừng ${unit}?`, danger: true, confirmLabel: "Dừng service" })) await serviceAction(unit, "stop");
  };
  const fetchWithStepUp = async (url: string, options: RequestInit) => {
    let response = await fetch(url, { ...options, credentials: "include" });
    if (response.status === 428 && (await requestStepUp()))
      response = await fetch(url, { ...options, credentials: "include" });
    return response;
  };

  const sqliteRequest = async (endpoint: string, options: RequestInit = {}) => {
    const response = await fetchWithStepUp(`${API_URL}/api/sqlite${endpoint}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : { success: response.ok, data: await response.text() };
    if (!response.ok || data.success === false)
      throw new Error(data.error || data.message || "Thao tác SQLite thất bại");
    return data;
  };

  const loadSqliteRows = async (
    databasePath: string,
    table: string,
    offset = 0,
    overrides: {
      q?: string;
      sort?: string;
      order?: "asc" | "desc";
      limit?: number;
    } = {},
  ) => {
    if (!databasePath || !table) return;
    const requestId = ++sqliteRowsRequestRef.current;
    setSqliteLoading(true);
    setSqliteMessage(null);
    try {
      const limit = overrides.limit ?? sqliteLimit;
      const q = overrides.q ?? sqliteAppliedSearch;
      const sort = overrides.sort ?? sqliteSort;
      const order = overrides.order ?? sqliteOrder;
      const params = new URLSearchParams({
        path: databasePath,
        table,
        limit: String(limit),
        offset: String(offset),
      });
      if (q) params.set("q", q);
      if (sort) {
        params.set("sort", sort);
        params.set("order", order);
      }
      const data = await sqliteRequest(`/rows?${params}`);
      if (requestId !== sqliteRowsRequestRef.current) return;
      setSelectedSqliteTable(table);
      setSqliteRows(data.rows || data.items || []);
      setSqliteColumns(data.columns || []);
      setSqliteRowIdentities(data.rowIdentities || []);
      setSqliteIdentityKind(data.identity?.kind || "none");
      setSqliteTotal(
        Number(
          data.total ?? data.count ?? (data.rows || data.items || []).length,
        ),
      );
      setSqliteOffset(offset);
      setSqliteLimit(limit);
      setSqliteResult([]);
    } catch (error: any) {
      if (requestId === sqliteRowsRequestRef.current) setSqliteMessage(error.message);
    } finally {
      if (requestId === sqliteRowsRequestRef.current) setSqliteLoading(false);
    }
  };

  const openSqlite = async (databasePath: string) => {
    const requestId = ++sqliteOpenRequestRef.current;
    sqliteRowsRequestRef.current += 1;
    setSqliteLoading(true);
    setSqliteMessage(null);
    setSelectedSqlite(databasePath);
    setSelectedSqliteTable("");
    setSqliteRows([]);
    setSqliteResult([]);
    try {
      const data = await sqliteRequest(
        `/schema?path=${encodeURIComponent(databasePath)}`,
      );
      if (requestId !== sqliteOpenRequestRef.current) return;
      setSqliteObjects(data.objects || []);
      setSqliteFiles((files) =>
        files.some((file) => file.path === databasePath)
          ? files
          : [
              {
                path: databasePath,
                name: databasePath.split(/[\\/]/).pop() || databasePath,
                size: 0,
                mtime: new Date().toISOString(),
                protected: false,
              },
              ...files,
            ],
      );
      const firstTable = data.objects?.find(
        (item: SqliteObject) => item.type === "table",
      )?.name;
      if (firstTable)
        await loadSqliteRows(databasePath, firstTable, 0, { q: "", sort: "" });
      if (requestId !== sqliteOpenRequestRef.current) return;
      setSqliteMessage(`Đã mở database · quick_check: ${data.integrity}`);
    } catch (error: any) {
      if (requestId === sqliteOpenRequestRef.current) {
        setSqliteObjects([]);
        setSqliteMessage(error.message);
      }
    } finally {
      if (requestId === sqliteOpenRequestRef.current) setSqliteLoading(false);
    }
  };

  const loadSqliteFiles = useCallback(async () => {
    if (
      !sessionReady ||
      !currentUser ||
      !["admin", "root"].includes(currentUser.role)
    )
      return;
    setSqliteLoading(true);
    setSqliteMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/sqlite`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!data.success)
        throw new Error(data.error || "Không thể tải danh sách SQLite");
      setSqliteFiles((files) => {
        const scanned = data.databases || [];
        const openedExternal =
          selectedSqlite &&
          !scanned.some((item: SqliteFile) => item.path === selectedSqlite)
            ? files.find((file) => file.path === selectedSqlite)
            : undefined;
        return openedExternal ? [openedExternal, ...scanned] : scanned;
      });
    } catch (error: any) {
      setSqliteMessage(error.message);
    } finally {
      setSqliteLoading(false);
    }
  }, [sessionReady, currentUser, selectedSqlite]);

  const browseSqlitePath = async (requestedPath?: string) => {
    setSqliteLoading(true);
    setSqliteMessage(null);
    try {
      const endpoint = requestedPath?.trim()
        ? `/browse?path=${encodeURIComponent(requestedPath.trim())}`
        : "/browse";
      const data = await sqliteRequest(endpoint);
      setSqliteBrowserPath(data.currentPath);
      setSqliteBrowserParent(data.parentPath);
      setSqliteBrowserRoot(data.root);
      setSqliteBrowserItems(data.items || []);
    } catch (error: any) {
      setSqliteMessage(error.message);
    } finally {
      setSqliteLoading(false);
    }
  };

  const showOpenSqlite = async () => {
    setShowSqliteBrowser(true);
    await browseSqlitePath(sqliteBrowserPath || undefined);
  };

  const selectExistingSqlite = async (databasePath: string) => {
    setSqliteLoading(true);
    setSqliteMessage(null);
    try {
      await sqliteRequest("/opened", {
        method: "POST",
        body: JSON.stringify({ path: databasePath }),
      });
      setShowSqliteBrowser(false);
      await openSqlite(databasePath);
      await loadSqliteFiles();
    } catch (error: any) {
      setSqliteMessage(error.message);
    } finally {
      setSqliteLoading(false);
    }
  };

  const runSqliteQuery = async () => {
    if (!selectedSqlite || !sqliteSql.trim()) return;
    setSqliteLoading(true);
    setSqliteMessage(null);
    const toast = notify("loading", "Đang chạy truy vấn SQL...");
    try {
      const data = await sqliteRequest("/query", {
        method: "POST",
        body: JSON.stringify({ path: selectedSqlite, sql: sqliteSql }),
      });
      const resultMessage = `Hoàn tất trong ${data.durationMs} ms · ${data.rowCount} dòng${data.truncated ? " (đã giới hạn)" : ""}`;
      const ranAt = new Date().toISOString();
      const entry: SqliteHistoryEntry = {
        id: `${ranAt}:${sqliteSql}`,
        path: selectedSqlite,
        sql: sqliteSql,
        ranAt,
        durationMs: data.durationMs,
        rowCount: data.rowCount ?? data.rows?.length ?? 0,
        success: true,
      };
      setSqliteHistory((history) => {
        const next = [entry, ...history].slice(0, 50);
        localStorage.setItem(SQLITE_HISTORY_KEY, JSON.stringify(next));
        return next;
      });
      const schema = await sqliteRequest(
        `/schema?path=${encodeURIComponent(selectedSqlite)}`,
      );
      setSqliteObjects(schema.objects || []);
      setSqliteResult(data.rows || []);
      setSqliteMessage(resultMessage);
      replaceToast(toast, "success", resultMessage);
    } catch (error: any) {
      const ranAt = new Date().toISOString();
      const entry: SqliteHistoryEntry = {
        id: `${ranAt}:${sqliteSql}`,
        path: selectedSqlite,
        sql: sqliteSql,
        ranAt,
        success: false,
      };
      setSqliteHistory((history) => {
        const next = [entry, ...history].slice(0, 50);
        localStorage.setItem(SQLITE_HISTORY_KEY, JSON.stringify(next));
        return next;
      });
      setSqliteMessage(error.message);
      replaceToast(toast, "error", error.message);
    } finally {
      setSqliteLoading(false);
    }
  };

  const sqliteIdentity = (row: Record<string, unknown>) => {
    const index = sqliteRows.indexOf(row);
    if (index >= 0 && sqliteRowIdentities[index])
      return sqliteRowIdentities[index];
    const primaryKeys = sqliteColumns
      .filter((column) => Number(column.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map((column) => column.name);
    return Object.fromEntries(primaryKeys.map((key) => [key, row[key]]));
  };

  const openSqliteRecord = (
    mode: "add" | "edit",
    row?: Record<string, unknown>,
  ) => {
    const names = sqliteColumns.length
      ? sqliteColumns.map((column) => column.name)
      : Object.keys(row || sqliteRows[0] || {});
    setSqliteRecordValues(
      Object.fromEntries(names.map((name) => [name, row?.[name] ?? ""])),
    );
    setSqliteRecordModal({ mode, row });
  };

  const saveSqliteRecord = async () => {
    if (!selectedSqliteTable || !sqliteRecordModal) return;
    setSqliteLoading(true);
    setSqliteMessage(null);
    const toast = notify("loading", "Đang lưu bản ghi...");
    try {
      const values = Object.fromEntries(
        Object.entries(sqliteRecordValues).map(([key, value]) => [
          key,
          value === "NULL" ? null : value,
        ]),
      );
      const editing =
        sqliteRecordModal.mode === "edit" && sqliteRecordModal.row;
      await sqliteRequest("/rows", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          path: selectedSqlite,
          table: selectedSqliteTable,
          ...(editing ? { identity: sqliteIdentity(editing) } : {}),
          values,
        }),
      });
      setSqliteRecordModal(null);
      setSqliteMessage(editing ? "Đã cập nhật bản ghi." : "Đã thêm bản ghi.");
      await loadSqliteRows(selectedSqlite, selectedSqliteTable, sqliteOffset);
      setHighlightedSqliteRow(editing ? sqliteRows.indexOf(editing) : 0);
      window.setTimeout(() => setHighlightedSqliteRow(null), 1800);
      replaceToast(
        toast,
        "success",
        editing ? "Đã cập nhật bản ghi." : "Đã thêm bản ghi.",
      );
    } catch (error: any) {
      setSqliteMessage(error.message);
      replaceToast(toast, "error", error.message);
    } finally {
      setSqliteLoading(false);
    }
  };

  const deleteSqliteRecord = async (row: Record<string, unknown>) => {
    if (
      !(await askConfirm({
        message: "Xóa vĩnh viễn bản ghi này?",
        danger: true,
        confirmLabel: "Xóa bản ghi",
      }))
    )
      return;
    setSqliteLoading(true);
    setSqliteMessage(null);
    try {
      await sqliteRequest("/rows", {
        method: "DELETE",
        body: JSON.stringify({
          path: selectedSqlite,
          table: selectedSqliteTable,
          identity: sqliteIdentity(row),
        }),
      });
      await loadSqliteRows(selectedSqlite, selectedSqliteTable, sqliteOffset);
      setSqliteMessage("Đã xóa bản ghi.");
    } catch (error: any) {
      setSqliteMessage(error.message);
    } finally {
      setSqliteLoading(false);
    }
  };

  const applySqliteSchemaAction = async () => {
    setSqliteLoading(true);
    setSqliteMessage(null);
    try {
      const payload: Record<string, unknown> = { path: selectedSqlite };
      let endpoint = "";
      let method = "POST";
      if (sqliteSchemaAction === "createTable") {
        const columns = sqliteSchemaForm.columns
          .split("\n")
          .map((value) => value.trim())
          .filter(Boolean)
          .map((definition) => {
            const match = /^(\S+)\s+(\S+)(.*)$/i.exec(definition);
            if (!match)
              throw new Error(`Định nghĩa cột không hợp lệ: ${definition}`);
            const flags = match[3];
            return {
              name: match[1],
              type: match[2],
              primaryKey: /\bPRIMARY\s+KEY\b/i.test(flags),
              autoIncrement: /\bAUTOINCREMENT\b/i.test(flags),
              notNull: /\bNOT\s+NULL\b/i.test(flags),
              unique: /\bUNIQUE\b/i.test(flags),
            };
          });
        Object.assign(payload, { table: sqliteSchemaForm.table, columns });
        endpoint = "/schema/tables";
      }
      if (sqliteSchemaAction === "addColumn") {
        Object.assign(payload, {
          table: selectedSqliteTable || sqliteSchemaForm.table,
          column: {
            name: sqliteSchemaForm.column,
            type: sqliteSchemaForm.type,
          },
        });
        endpoint = "/schema/columns";
      }
      if (sqliteSchemaAction === "createIndex") {
        Object.assign(payload, {
          table: selectedSqliteTable || sqliteSchemaForm.table,
          index: sqliteSchemaForm.index,
          columns: sqliteSchemaForm.indexColumns
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          unique: sqliteSchemaForm.unique,
        });
        endpoint = "/schema/indexes";
      }
      if (sqliteSchemaAction === "dropIndex") {
        Object.assign(payload, { index: sqliteSchemaForm.index });
        endpoint = "/schema/indexes";
        method = "DELETE";
      }
      if (sqliteSchemaAction === "dropTable") {
        Object.assign(payload, {
          table: selectedSqliteTable || sqliteSchemaForm.table,
        });
        endpoint = "/schema/tables";
        method = "DELETE";
      }
      if (["dropIndex", "dropTable"].includes(sqliteSchemaAction)) {
        const target =
          sqliteSchemaAction === "dropTable"
            ? String(payload.table || "")
            : String(payload.index || "");
        if (
          !(await askConfirm({
            title:
              sqliteSchemaAction === "dropTable" ? "Xóa bảng" : "Xóa index",
            message: `Thao tác ${sqliteSchemaAction} không thể hoàn tác.`,
            danger: true,
            requiredText:
              sqliteSchemaAction === "dropTable" ? target : undefined,
            confirmLabel: "Xóa",
          }))
        )
          return;
      }
      await sqliteRequest(endpoint, { method, body: JSON.stringify(payload) });
      await openSqlite(selectedSqlite);
      setSqliteMessage("Đã cập nhật schema.");
    } catch (error: any) {
      setSqliteMessage(error.message);
    } finally {
      setSqliteLoading(false);
    }
  };

  const importSqliteTable = async () => {
    if (!selectedSqliteTable || !sqliteImportData.trim()) return;
    setSqliteLoading(true);
    setSqliteMessage(null);
    try {
      const data = await sqliteRequest("/import", {
        method: "POST",
        body: JSON.stringify({
          path: selectedSqlite,
          table: selectedSqliteTable,
          format: sqliteImportFormat,
          data: sqliteImportData,
        }),
      });
      setSqliteImportData("");
      await loadSqliteRows(selectedSqlite, selectedSqliteTable, 0);
      setSqliteMessage(
        `Import hoàn tất${data.rowCount !== undefined ? ` · ${data.rowCount} dòng` : ""}.`,
      );
    } catch (error: any) {
      setSqliteMessage(error.message);
    } finally {
      setSqliteLoading(false);
    }
  };

  const loadSqliteOperations = async (databasePath = selectedSqlite) => {
    if (!databasePath) return;
    setSqliteLoading(true);
    setSqliteMessage(null);
    try {
      const [stats, backups] = await Promise.all([
        sqliteRequest(`/statistics?path=${encodeURIComponent(databasePath)}`),
        sqliteRequest("/backups"),
      ]);
      setSqliteStats(stats.stats || stats.data || stats);
      setSqliteBackups(backups.backups || backups.items || []);
    } catch (error: any) {
      setSqliteMessage(error.message);
    } finally {
      setSqliteLoading(false);
    }
  };

  const sqliteMaintenance = async (
    action: "vacuum" | "analyze" | "integrity_check",
  ) => {
    setSqliteLoading(true);
    setSqliteMessage(null);
    try {
      const data = await sqliteRequest("/maintenance", {
        method: "POST",
        body: JSON.stringify({ path: selectedSqlite, action }),
      });
      setSqliteMessage(data.message || `${action} hoàn tất.`);
      await loadSqliteOperations();
    } catch (error: any) {
      setSqliteMessage(error.message);
    } finally {
      setSqliteLoading(false);
    }
  };

  const explainSqliteQuery = async () => {
    if (!sqliteSql.trim()) return;
    setSqliteLoading(true);
    setSqliteMessage(null);
    try {
      const data = await sqliteRequest("/explain", {
        method: "POST",
        body: JSON.stringify({ path: selectedSqlite, sql: sqliteSql }),
      });
      setSqlitePlan(data.plan || data.rows || data.items || []);
    } catch (error: any) {
      setSqliteMessage(error.message);
    } finally {
      setSqliteLoading(false);
    }
  };

  const sqliteBackupAction = async (
    action: "create" | "restore" | "delete",
    id?: string,
  ) => {
    if (
      action !== "create" &&
      !(await askConfirm({
        title: action === "restore" ? "Khôi phục backup" : "Xóa backup",
        message:
          action === "restore"
            ? "Khôi phục backup này và ghi đè database hiện tại?"
            : "Xóa backup này?",
        danger: true,
        requiredText: action === "restore" ? id : undefined,
        confirmLabel: action === "restore" ? "Khôi phục" : "Xóa",
      }))
    )
      return;
    setSqliteLoading(true);
    setSqliteMessage(null);
    try {
      const name = id ? encodeURIComponent(id) : "";
      const endpoint =
        action === "create"
          ? "/backups"
          : action === "restore"
            ? `/backups/${name}/restore`
            : `/backups/${name}`;
      await sqliteRequest(endpoint, {
        method: action === "delete" ? "DELETE" : "POST",
        body: JSON.stringify({ path: selectedSqlite }),
      });
      await loadSqliteOperations();
      if (action === "restore") await openSqlite(selectedSqlite);
      setSqliteMessage(
        action === "create"
          ? "Đã tạo backup."
          : action === "restore"
            ? "Đã khôi phục backup."
            : "Đã xóa backup.",
      );
    } catch (error: any) {
      setSqliteMessage(error.message);
    } finally {
      setSqliteLoading(false);
    }
  };

  const deleteSqlite = async (databasePath: string) => {
    if (
      !(await askConfirm({
        title: "Xóa database",
        message: `Xóa vĩnh viễn database ${databasePath}?`,
        danger: true,
        requiredText: databasePath,
        confirmLabel: "Xóa database",
      }))
    )
      return;
    setSqliteLoading(true);
    setSqliteMessage(null);
    try {
      const res = await fetchWithStepUp(`${API_URL}/api/sqlite`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: databasePath }),
      });
      const data = await res.json();
      if (!data.success)
        throw new Error(data.error || "Không thể xóa database");
      setSelectedSqlite("");
      setSqliteObjects([]);
      setSqliteRows([]);
      setSqliteResult([]);
      await loadSqliteFiles();
    } catch (error: any) {
      setSqliteMessage(error.message);
    } finally {
      setSqliteLoading(false);
    }
  };

  const navigateHistory = (offset: number) => {
    const nextIndex = historyIndex + offset;
    const nextPath = pathHistory[nextIndex];
    if (nextPath === undefined) return;
    historyIndexRef.current = nextIndex;
    setHistoryIndex(nextIndex);
    loadFiles(nextPath, null, "none");
  };

  const transferFiles = async (operation: "copy" | "move", paths: string[]) => {
    if (!paths.length) return;
    try {
      const data = await requestFileApi("/api/files/transfer", {
        method: "POST",
        body: JSON.stringify({ operation, paths, destinationDir: currentPath }),
      });
      if (data.results?.some((item: any) => !item.success))
        setFileError("Một số mục không thể được xử lý.");
      if (operation === "move") setFileClipboard(null);
      setSelectedPaths([]);
      await loadFiles(currentPath, null, "none");
    } catch (error: any) {
      setFileError(error.message);
    }
  };

  const trashPaths = async (paths: string[]) => {
    if (
      !paths.length ||
      !(await askConfirm({
        message: `Chuyển ${paths.length} mục vào thùng rác?`,
        danger: true,
        confirmLabel: "Chuyển vào thùng rác",
      }))
    )
      return;
    try {
      const data = await requestFileApi("/api/files/trash", {
        method: "POST",
        body: JSON.stringify({ paths }),
      });
      if (data.results?.some((item: any) => !item.success))
        setFileError("Một số mục không thể chuyển vào thùng rác.");
      setSelectedPaths([]);
      await loadFiles(currentPath, null, "none");
    } catch (error: any) {
      setFileError(error.message);
    }
  };

  const runRecursiveSearch = async () => {
    if (!fileSearchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const data = await requestFileApi(
        `/api/files/search?path=${encodeURIComponent(currentPath)}&query=${encodeURIComponent(fileSearchQuery.trim())}`,
      );
      setSearchResults(data.results || []);
      setSearchTruncated(Boolean(data.truncated));
    } catch (error: any) {
      setFileError(error.message);
    }
  };

  const uploadFiles = async (files: globalThis.File[]) => {
    if (!sessionReady || !files.length) return;
    setFileLoading(true);
    setFileError(null);
    const directory = currentPath;
    setUploadProgress(
      Object.fromEntries(
        files.map((file) => [
          `${file.name}-${file.size}-${file.lastModified}`,
          0,
        ]),
      ),
    );
    const uploadOne = async (file: globalThis.File): Promise<void> => {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      const initialized = await requestFileApi("/api/files/upload", {
        method: "POST",
        body: JSON.stringify({ name: file.name, dirPath: directory, size: file.size }),
      });
      const uploadId = String(initialized.uploadId);
      const chunkSize = Number(initialized.chunkSize);
      if (!uploadId || !Number.isSafeInteger(chunkSize) || chunkSize <= 0)
        throw new Error("Máy chủ trả về cấu hình upload không hợp lệ");

      try {
        for (let offset = 0; offset < file.size; offset += chunkSize) {
          const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", `${API_URL}/api/files/upload/${uploadId}`);
            xhr.withCredentials = true;
            xhr.setRequestHeader("Content-Type", "application/octet-stream");
            xhr.setRequestHeader("X-Upload-Offset", String(offset));
            xhr.upload.onprogress = (event) => {
              if (!event.lengthComputable) return;
              const uploaded = Math.min(file.size, offset + event.loaded);
              setUploadProgress((progress) => ({
                ...progress,
                [key]: file.size ? Math.round((uploaded / file.size) * 100) : 100,
              }));
            };
            xhr.onerror = () => reject(new Error(`Mất kết nối khi upload ${file.name}`));
            xhr.onload = () => {
              if (xhr.status < 400) return resolve();
              let message = `Upload ${file.name} thất bại (HTTP ${xhr.status})`;
              try { message = JSON.parse(xhr.responseText).error || message; } catch {}
              reject(new Error(message));
            };
            xhr.send(chunk);
          });
        }
        await requestFileApi(`/api/files/upload/${uploadId}/complete`, { method: "POST" });
        setUploadProgress((progress) => ({ ...progress, [key]: 100 }));
      } catch (error) {
        await requestFileApi(`/api/files/upload/${uploadId}`, { method: "DELETE" }).catch(() => undefined);
        throw error;
      }
    };

    const results = await Promise.allSettled(files.map(uploadOne));
    setUploadProgress({});
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : "Upload thất bại");
    if (failures.length) setFileError(failures.join("; "));
    setFileLoading(false);
    await loadFiles(directory, null, "none");
  };

  const openTrash = async () => {
    try {
      const data = await requestFileApi("/api/files/trash");
      setTrashItems(data.items || []);
      setSelectedTrashIds([]);
      setShowTrash(true);
    } catch (error: any) {
      setFileError(error.message);
    }
  };

  const trashAction = async (
    action: "restore" | "delete" | "empty",
    ids: string[] = [],
  ) => {
    try {
      if (action === "restore")
        await requestFileApi("/api/files/trash/restore", {
          method: "POST",
          body: JSON.stringify({ ids }),
        });
      if (action === "delete")
        await requestFileApi("/api/files/trash", {
          method: "DELETE",
          body: JSON.stringify({ ids }),
        });
      if (action === "empty")
        await requestFileApi("/api/files/trash/empty", { method: "DELETE" });
      await openTrash();
      await loadFiles(currentPath, null, "none");
    } catch (error: any) {
      setFileError(error.message);
    }
  };

  const openSnapshots = async (filePath = "") => {
    try {
      const data = await requestFileApi(
        `/api/files/snapshots${filePath ? `?path=${encodeURIComponent(filePath)}` : ""}`,
      );
      setSnapshots(data.items || []);
      setSnapshotPath(filePath);
      setShowSnapshots(true);
    } catch (error: any) {
      setFileError(error.message);
    }
  };

  const restoreSnapshot = async (id: string) => {
    if (
      !(await askConfirm({
        title: "Khôi phục snapshot",
        message: "Khôi phục phiên bản này và ghi đè file hiện tại?",
        danger: true,
        confirmLabel: "Khôi phục",
      }))
    )
      return;
    try {
      await requestFileApi("/api/files/snapshots/restore", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      await openSnapshots(snapshotPath);
      await loadFiles(currentPath, null, "none");
    } catch (error: any) {
      setFileError(error.message);
    }
  };

  const deleteSnapshot = async (id: string) => {
    if (
      !(await askConfirm({
        message: "Xóa vĩnh viễn snapshot này?",
        danger: true,
        confirmLabel: "Xóa snapshot",
      }))
    )
      return;
    try {
      await requestFileApi("/api/files/snapshots", {
        method: "DELETE",
        body: JSON.stringify({ id }),
      });
      await openSnapshots(snapshotPath);
    } catch (error: any) {
      setFileError(error.message);
    }
  };

  const downloadSnapshot = async (id: string, fileName: string) => {
    const res = await fetch(
      `${API_URL}/api/files/snapshots/download?id=${encodeURIComponent(id)}`,
      { credentials: "include" },
    );
    if (!res.ok) return setFileError("Không thể tải snapshot");
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openFile = async (filePath: string, edit = false) => {
    if (!sessionReady) return;
    const requestId = ++fileOpenRequestRef.current;
    setFileLoading(true);
    setFileError(null);
    try {
      if (previewKind(filePath) !== "text") {
        if (edit) throw new Error("Chỉ có thể chỉnh sửa tệp văn bản");
        const ticketData = await requestFileApi("/api/auth/preview-ticket", {
          method: "POST",
          body: JSON.stringify({ path: filePath }),
        });
        if (requestId !== fileOpenRequestRef.current) return;
        setPreviewTicket(ticketData.ticket);
        setViewingFile(filePath);
        setFileContent(null);
        setFileMtime(null);
        setIsEditingFile(false);
        return;
      }
      const res = await fetch(
        `${API_URL}/api/files/read?path=${encodeURIComponent(filePath)}`,
        {
          credentials: "include",
        },
      );
      const data = await res.json();
      if (requestId !== fileOpenRequestRef.current) return;
      if (data.success) {
        if (data.isBinary) {
          setFileError(
            "Tệp tin này là định dạng nhị phân, không thể xem trực tiếp.",
          );
          setViewingFile(null);
          setFileContent(null);
        } else {
          setViewingFile(filePath);
          setFileContent(data.content);
          setEditorOriginal(data.content);
          setFileMtime(data.mtime);
          setIsEditingFile(edit);
        }
      } else {
        setFileError(data.error || "Không thể mở tệp tin");
      }
    } catch (err: any) {
      if (requestId === fileOpenRequestRef.current) setFileError(err.message);
    } finally {
      if (requestId === fileOpenRequestRef.current) setFileLoading(false);
    }
  };

  const saveEditedFile = async () => {
    if (!sessionReady || !viewingFile || fileContent === null) return;
    setFileLoading(true);
    setFileError(null);
    const toast = notify("loading", "Đang lưu tệp...");
    try {
      const res = await fetchWithStepUp(`${API_URL}/api/files/write`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          filePath: viewingFile,
          content: fileContent,
          expectedMtime: fileMtime,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setFileMtime(data.mtime);
        setEditorOriginal(fileContent);
        replaceToast(toast, "success", "Đã lưu tệp.");
      } else {
        setFileError(data.error || "Lỗi khi lưu tệp tin");
        replaceToast(toast, "error", data.error || "Lỗi khi lưu tệp tin");
      }
    } catch (err: any) {
      setFileError("Lỗi kết nối: " + err.message);
      replaceToast(toast, "error", "Lỗi kết nối: " + err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const deleteFileOrFolder = async (filePath: string) => {
    if (!sessionReady) return;
    const itemName =
      filePath.replace(/\\/g, "/").split("/").pop() || "tệp/thư mục";
    if (
      !(await askConfirm({
        message: `Bạn có chắc chắn muốn xóa "${itemName}" không?`,
        danger: true,
        confirmLabel: "Xóa",
      }))
    )
      return;
    setFileLoading(true);
    setFileError(null);
    try {
      const res = await fetchWithStepUp(
        `${API_URL}/api/files?path=${encodeURIComponent(filePath)}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      const data = await res.json();
      if (data.success) {
        await loadFiles(currentPath);
        if (viewingFile === filePath) {
          setViewingFile(null);
          setFileContent(null);
        }
      } else {
        setFileError(data.error || "Lỗi khi xóa tệp/thư mục");
      }
    } catch (err: any) {
      setFileError("Lỗi kết nối: " + err.message);
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
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ dirPath: currentPath, name: newDirName.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setNewDirName("");
        setShowCreateFolder(false);
        await loadFiles(currentPath);
      } else {
        setFileError(data.error || "Lỗi tạo thư mục mới");
      }
    } catch (err: any) {
      setFileError("Lỗi kết nối: " + err.message);
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
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          dirPath: currentPath,
          name: newFileName.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNewFileName("");
        setShowCreateFile(false);
        await loadFiles(currentPath);
        await openFile(data.path);
      } else {
        setFileError(data.error || "Lỗi tạo tệp mới");
      }
    } catch (err: any) {
      setFileError("Lỗi kết nối: " + err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const downloadFile = async (filePath: string) => {
    if (!sessionReady) return;
    setFileError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/files/download?path=${encodeURIComponent(filePath)}`,
        {
          credentials: "include",
        },
      );
      if (!res.ok)
        throw new Error((await res.json()).error || "Không thể tải tệp");
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filePath.split("/").pop() || "download";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      setFileError(error.message);
    }
  };

  const moveOrRename = async (filePath: string) => {
    if (!sessionReady) return;
    const currentName = filePath.split("/").pop() || "";
    const newName = prompt("Tên mới:", currentName)?.trim();
    if (!newName || newName === currentName) return;
    const destinationDir = filePath.includes("/")
      ? filePath.slice(0, filePath.lastIndexOf("/"))
      : "";
    try {
      const res = await fetchWithStepUp(`${API_URL}/api/files/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sourcePath: filePath,
          destinationDir,
          newName,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Không thể đổi tên");
      setSelectedPaths([]);
      await loadFiles(currentPath, null, "none");
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Không thể đổi tên");
    }
  };

  const renameFileBookmark = (bookmark: FileBookmark) => {
    const label = prompt("Nhãn bookmark:", bookmark.label)?.trim();
    if (!label) return;
    setFileBookmarks((items) => {
      const next = items.map((item) =>
        item.path === bookmark.path ? { ...item, label } : item,
      );
      localStorage.setItem(FILE_BOOKMARKS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const openTerminalAtCurrentPath = () => {
    pendingTerminalCwdRef.current = currentPath;
    setActiveTab("terminal");
  };

  const createFileArchive = async () => {
    const name = prompt(
      "Tên archive (gồm phần mở rộng):",
      "archive.zip",
    )?.trim();
    if (!name) return;
    try {
      await requestFileApi("/api/files/archive/create", {
        method: "POST",
        body: JSON.stringify({
          paths: selectedPaths.length ? selectedPaths : [currentPath],
          destinationDir: currentPath,
          name,
          format: name.endsWith(".tar.gz")
            ? "tar.gz"
            : name.split(".").pop() || "zip",
        }),
      });
      await loadFiles(currentPath, null, "none");
    } catch (error: any) {
      setFileError(error.message);
    }
  };

  const createFileSymlink = async () => {
    const name = prompt("Tên symlink mới:", "link")?.trim();
    const targetPath = name && prompt("Đường dẫn đích:")?.trim();
    if (!name || !targetPath) return;
    try {
      await requestFileApi("/api/files/symlink", {
        method: "POST",
        body: JSON.stringify({ name, targetPath, destinationDir: currentPath }),
      });
      await loadFiles(currentPath, null, "none");
    } catch (error: any) {
      setFileError(error.message);
    }
  };

  const openFileMetadata = async (filePath: string) => {
    try {
      const data = await requestFileApi(
        `/api/files/metadata?path=${encodeURIComponent(filePath)}`,
      );
      setMetadata({
        path: filePath,
        mode: String(data.mode ?? data.metadata?.mode ?? ""),
        uid: Number(data.uid ?? data.metadata?.uid ?? 0),
        gid: Number(data.gid ?? data.metadata?.gid ?? 0),
      });
    } catch (error: any) {
      setFileError(error.message);
    }
  };

  const extractFileArchive = async (archivePath: string) => {
    const destinationDir = prompt("Giải nén vào:", currentPath)?.trim();
    if (!destinationDir) return;
    try {
      await requestFileApi("/api/files/archive/extract", {
        method: "POST",
        body: JSON.stringify({ archivePath, destinationDir }),
      });
      await loadFiles(currentPath, null, "none");
    } catch (error: any) {
      setFileError(error.message);
    }
  };

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);
  const [securityStatus, setSecurityStatus] = useState<{
    twoFactorEnabled: boolean;
    twoFactorAvailable: boolean;
    recoveryCodesRemaining: number;
    sessions: SecuritySession[];
  } | null>(null);
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [twoFactorSetup, setTwoFactorSetup] = useState<{
    secret: string;
    qrCode: string;
  } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [newUser, setNewUser] = useState<{
    username: string;
    password: string;
    role: UserRole;
  }>({ username: "", password: "", role: "viewer" });
  const [stepUpPrompt, setStepUpPrompt] = useState<{
    resolve: (granted: boolean) => void;
  } | null>(null);
  const [stepUpPassword, setStepUpPassword] = useState("");
  const [stepUpCode, setStepUpCode] = useState("");
  const [stepUpError, setStepUpError] = useState<string | null>(null);

  const settleStepUp = (granted: boolean) => {
    const resolve = stepUpResolveRef.current;
    stepUpResolveRef.current = null;
    stepUpPromiseRef.current = null;
    setStepUpPrompt(null);
    setStepUpPassword("");
    setStepUpCode("");
    setStepUpError(null);
    resolve?.(granted);
  };

  const submitStepUp = async () => {
    setStepUpError(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/step-up`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: stepUpPassword, code: stepUpCode }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Xác nhận thất bại");
      settleStepUp(true);
    } catch (err: any) {
      setStepUpError(err.message);
    }
  };
  const cancelStepUp = () => {
    settleStepUp(false);
  };

  // Terminal and socket refs
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<any>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const socketInstance = useRef<Socket | null>(null);
  const [socketStatus, setSocketStatus] = useState<
    "idle" | "connecting" | "connected" | "error"
  >("idle");
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Stable refs to always access latest fontSize/theme inside effects without adding them as deps
  const fontSizeRef = useRef<number>(fontSize);
  const themeRef = useRef<string>(theme);
  useEffect(() => {
    fontSizeRef.current = fontSize;
  }, [fontSize]);
  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const autoScrollRef = useRef<boolean>(true);

  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  const exportTerminalHistory = () => {
    if (!xtermInstance.current) return;
    try {
      const activeBuffer = xtermInstance.current.buffer.active;
      let text = "";
      for (let i = 0; i < activeBuffer.length; i++) {
        const line = activeBuffer.getLine(i);
        if (line) {
          text += line.translateToString(true) + "\n";
        }
      }

      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.id = "download-temp-link";
      link.href = url;
      link.download = `terminal_scrollback_${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Lỗi khi xuất dữ liệu terminal:", err);
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
      socketInstance.current.emit("input", cmd + "\r");
      if (xtermInstance.current) {
        xtermInstance.current.focus();
      }
    }
  };

  const loadSettings = useCallback(async () => {
    if (!sessionReady) return;
    try {
      const data = await apiClient.request<{ success: boolean; settings?: { fontSize?: string; theme?: string } }>("/api/settings");
      if (data.success && data.settings) {
        setFontSize(parseInt(data.settings.fontSize || "", 10) || 14);
        setTheme(data.settings.theme || "dark-classic");
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      isSettingsLoadedRef.current = true;
    }
  }, [sessionReady]);

  const saveSettings = useCallback(
    async (newSize: number, newTheme: string) => {
      if (!sessionReady) return;
      const shouldShowStatus = isSettingsLoadedRef.current;
      if (shouldShowStatus) {
        Promise.resolve().then(() => {
          setSaveStatus("saving");
        });
      }
      try {
        const data = await apiClient.request<{ success: boolean }, { fontSize: number; theme: string }>("/api/settings", {
          method: "POST",
          body: { fontSize: newSize, theme: newTheme },
        });
        if (data.success) {
          if (shouldShowStatus) {
            setSaveStatus("saved");
            if (saveTimeoutRef.current) {
              clearTimeout(saveTimeoutRef.current);
            }
            saveTimeoutRef.current = setTimeout(() => {
              setSaveStatus("idle");
            }, 3000);
          }
        } else {
          if (shouldShowStatus) {
            setSaveStatus("error");
          }
        }
      } catch (err) {
        console.error("Failed to save settings:", err);
        if (shouldShowStatus) {
          setSaveStatus("error");
        }
      }
    },
    [sessionReady],
  );

  // Check if session already exists on load
  useEffect(() => {
    localStorage.removeItem("vps_terminal_token");
    setTimeout(() => setLoading(true), 0);
    fetch(`${API_URL}/api/auth/verify`, {
      method: "POST",
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data) => {
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
      loadFiles(getSavedFilePath(), null, "push", true);
    }, 0);
    return () => clearTimeout(timer);
  }, [sessionReady, loadSettings, loadFiles]);

  useEffect(() => {
    if (!sessionReady || activeTab !== "logs") return;
    const timer = setTimeout(() => loadLogs(0), 0);
    return () => clearTimeout(timer);
  }, [sessionReady, activeTab, loadLogs]);

  useEffect(() => {
    if (!sessionReady || activeTab !== "system") return;
    const timer = setTimeout(() => loadSystemData(systemView), 0);
    return () => clearTimeout(timer);
  }, [sessionReady, activeTab, systemView, loadSystemData]);

  useEffect(() => {
    if (!sessionReady || !["sqlite", "jobs"].includes(activeTab)) return;
    const timer = setTimeout(() => loadSqliteFiles(), 0);
    return () => clearTimeout(timer);
  }, [sessionReady, activeTab, loadSqliteFiles]);

  // Handle master password validation
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (data.success) {
        if (data.requiresTwoFactor) {
          setTwoFactorChallenge(data.challenge);
          setPassword("");
          return;
        }
        setSessionReady(true);
        setCurrentUser(data.user);
        setIsAuthenticated(true);
      } else {
        setError(data.error || "Authentication failed");
      }
    } catch {
      setError("Connection to server authentication API failed");
    } finally {
      setLoading(false);
    }
  };

  const handleTwoFactorLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorChallenge || !twoFactorCode.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/2fa`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge: twoFactorChallenge,
          code: twoFactorCode.trim(),
        }),
      });
      const data = await res.json();
      if (!data.success)
        throw new Error(data.error || "Mã xác thực không hợp lệ");
      setTwoFactorChallenge(null);
      setTwoFactorCode("");
      setCurrentUser(data.user);
      setSessionReady(true);
      setIsAuthenticated(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSecurity = useCallback(async () => {
    if (!sessionReady) return;
    try {
      const res = await fetch(`${API_URL}/api/security`, {
        credentials: "include",
      });
      const data = await res.json();
      if (data.success) setSecurityStatus(data);
    } catch (err) {
      console.error("Failed to load security status:", err);
    }
  }, [sessionReady, setSecurityStatus]);

  const securityRequest = async (
    endpoint: string,
    options: RequestInit = {},
  ) => {
    setSecurityMessage(null);
    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const data = await res.json();
    if (!data.success)
      throw new Error(data.error || "Thao tác bảo mật thất bại");
    return data;
  };

  const startTwoFactorSetup = async () => {
    try {
      const data = await securityRequest("/api/security/2fa/setup", {
        method: "POST",
        body: JSON.stringify({ password: twoFactorPassword }),
      });
      setTwoFactorSetup({ secret: data.secret, qrCode: data.qrCode });
      setTwoFactorCode("");
    } catch (err: any) {
      setSecurityMessage(err.message);
    }
  };

  const confirmTwoFactorSetup = async () => {
    try {
      const data = await securityRequest("/api/security/2fa/confirm", {
        method: "POST",
        body: JSON.stringify({ code: twoFactorCode }),
      });
      setRecoveryCodes(data.recoveryCodes);
      setTwoFactorSetup(null);
      setTwoFactorPassword("");
      setTwoFactorCode("");
      setSecurityMessage("Đã bật xác thực hai lớp. Hãy lưu các mã khôi phục.");
      await loadSecurity();
    } catch (err: any) {
      setSecurityMessage(err.message);
    }
  };

  const disableTwoFactor = async () => {
    if (
      !(await askConfirm({
        message: "Tắt xác thực hai lớp?",
        danger: true,
        confirmLabel: "Tắt 2FA",
      }))
    )
      return;
    try {
      await securityRequest("/api/security/2fa/disable", {
        method: "POST",
        body: JSON.stringify({
          password: twoFactorPassword,
          code: twoFactorCode,
        }),
      });
      setTwoFactorPassword("");
      setTwoFactorCode("");
      setRecoveryCodes([]);
      setSecurityMessage("Đã tắt xác thực hai lớp.");
      await loadSecurity();
    } catch (err: any) {
      setSecurityMessage(err.message);
    }
  };

  const revokeSession = async (id?: string) => {
    try {
      await securityRequest(
        id ? `/api/security/sessions/${id}` : "/api/security/sessions",
        { method: "DELETE" },
      );
      setSecurityMessage(
        id ? "Đã thu hồi phiên." : "Đã thu hồi tất cả phiên khác.",
      );
      await loadSecurity();
    } catch (err: any) {
      setSecurityMessage(err.message);
    }
  };

  const loadUsers = useCallback(async () => {
    if (!sessionReady || currentUser?.role !== "root") return;
    const res = await fetch(`${API_URL}/api/users`, { credentials: "include" });
    const data = await res.json();
    if (data.success) setManagedUsers(data.users);
  }, [sessionReady, currentUser, setManagedUsers]);

  const createUser = async () => {
    try {
      await securityRequest("/api/users", {
        method: "POST",
        body: JSON.stringify(newUser),
      });
      setNewUser({ username: "", password: "", role: "viewer" });
      setSecurityMessage("Đã tạo tài khoản.");
      await loadUsers();
    } catch (err: any) {
      setSecurityMessage(err.message);
    }
  };

  const updateUser = async (id: string, changes: Record<string, unknown>) => {
    try {
      await securityRequest(`/api/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      await loadUsers();
    } catch (err: any) {
      setSecurityMessage(err.message);
    }
  };

  const deleteUser = async (id: string) => {
    if (
      !(await askConfirm({
        message: "Xóa tài khoản và toàn bộ phiên của tài khoản này?",
        danger: true,
        requiredText: id,
        confirmLabel: "Xóa tài khoản",
      }))
    )
      return;
    try {
      await securityRequest(`/api/users/${id}`, { method: "DELETE" });
      await loadUsers();
    } catch (err: any) {
      setSecurityMessage(err.message);
    }
  };

  const resetUserPassword = (id: string) => {
    const password = prompt("Mật khẩu mới (ít nhất 12 ký tự):");
    if (password) updateUser(id, { password });
  };

  useEffect(() => {
    if (!sessionReady || activeTab !== "settings") return;
    const timer = setTimeout(() => loadSecurity(), 0);
    return () => clearTimeout(timer);
  }, [sessionReady, activeTab, loadSecurity]);

  useEffect(() => {
    if (
      !sessionReady ||
      activeTab !== "settings" ||
      currentUser?.role !== "root"
    )
      return;
    const timer = setTimeout(() => loadUsers(), 0);
    return () => clearTimeout(timer);
  }, [sessionReady, activeTab, currentUser, loadUsers]);

  // Handle password modification
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(null);

    if (newPassword !== confirmPassword) {
      setPwdError("New passwords do not match");
      return;
    }

    if (newPassword.length < 12) {
      setPwdError("New password must be at least 12 characters long");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/settings/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();

      if (data.success) {
        setPwdSuccess("Master password changed successfully!");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        loadLogs();
      } else {
        setPwdError(data.error || "Failed to change password");
      }
    } catch {
      setPwdError("Server connection error during password update");
    } finally {
      setLoading(false);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    if (socketInstance.current) {
      socketInstance.current.disconnect();
    }
    if (stepUpPromiseRef.current) settleStepUp(false);
    isSettingsLoadedRef.current = false;
    if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current);

    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (e) {
      console.error(e);
    }

    setSessionReady(false);
    setCurrentUser(null);
    setIsAuthenticated(false);
    setPassword("");
  };

  // Convert theme keys to xterm configuration colors
  const getTerminalColors = (themeKey: string) => {
    switch (themeKey) {
      case "matrix":
        return {
          background: "#02120b",
          foreground: "#39ff14",
          cursor: "#39ff14",
          black: "#000000",
          red: "#ff5555",
          green: "#39ff14",
          yellow: "#ffb86c",
          blue: "#bd93f9",
          magenta: "#ff79c6",
          cyan: "#8be9fd",
          white: "#f8f8f2",
        };
      case "amber":
        return {
          background: "#120b00",
          foreground: "#ffb200",
          cursor: "#ffb200",
          black: "#000000",
          red: "#d9534f",
          green: "#5cb85c",
          yellow: "#f0ad4e",
          blue: "#0275d8",
          magenta: "#e11d48",
          cyan: "#5bc0de",
          white: "#f7f7f7",
        };
      case "cyberpunk":
        return {
          background: "#13001c",
          foreground: "#00ffff",
          cursor: "#ff007f",
          black: "#1a1a24",
          red: "#ff0055",
          green: "#00ff66",
          yellow: "#ffe600",
          blue: "#0099ff",
          magenta: "#ff00ff",
          cyan: "#00ffff",
          white: "#ffffff",
        };
      case "dracula":
        return {
          background: "#282a36",
          foreground: "#f8f8f2",
          cursor: "#f8f8f2",
          black: "#21222c",
          red: "#ff5555",
          green: "#50fa7b",
          yellow: "#f1fa8c",
          blue: "#6272a4",
          magenta: "#ff79c6",
          cyan: "#8be9fd",
          white: "#f8f8f2",
        };
      case "tokyo-night":
        return {
          background: "#1a1b26",
          foreground: "#c0caf5",
          cursor: "#c0caf5",
          black: "#15161e",
          red: "#f7768e",
          green: "#9ece6a",
          yellow: "#e0af68",
          blue: "#7aa2f7",
          magenta: "#bb9af7",
          cyan: "#7dcfff",
          white: "#a9b1d6",
        };
      case "nord":
        return {
          background: "#2e3440",
          foreground: "#d8dee9",
          cursor: "#88c0d0",
          black: "#3b4252",
          red: "#bf616a",
          green: "#a3be8c",
          yellow: "#ebcb8b",
          blue: "#81a1c1",
          magenta: "#b48ead",
          cyan: "#88c0d0",
          white: "#e5e9f0",
        };
      case "solarized-dark":
        return {
          background: "#002b36",
          foreground: "#839496",
          cursor: "#93a1a1",
          black: "#073642",
          red: "#dc322f",
          green: "#859900",
          yellow: "#b58900",
          blue: "#268bd2",
          magenta: "#d33682",
          cyan: "#2aa198",
          white: "#eee8d5",
        };
      case "solarized-light":
        return {
          background: "#fdf6e3",
          foreground: "#657b83",
          cursor: "#586e75",
          black: "#073642",
          red: "#dc322f",
          green: "#859900",
          yellow: "#b58900",
          blue: "#268bd2",
          magenta: "#d33682",
          cyan: "#2aa198",
          white: "#eee8d5",
        };
      case "gruvbox":
        return {
          background: "#282828",
          foreground: "#ebdbb2",
          cursor: "#fabd2f",
          black: "#1d2021",
          red: "#fb4934",
          green: "#b8bb26",
          yellow: "#fabd2f",
          blue: "#83a598",
          magenta: "#d3869b",
          cyan: "#8ec07c",
          white: "#fbf1c7",
        };
      case "one-dark":
        return {
          background: "#282c34",
          foreground: "#abb2bf",
          cursor: "#528bff",
          black: "#1e2127",
          red: "#e06c75",
          green: "#98c379",
          yellow: "#e5c07b",
          blue: "#61afef",
          magenta: "#c678dd",
          cyan: "#56b6c2",
          white: "#d7dae0",
        };
      case "github-light":
        return {
          background: "#ffffff",
          foreground: "#24292f",
          cursor: "#0969da",
          black: "#24292f",
          red: "#cf222e",
          green: "#116329",
          yellow: "#9a6700",
          blue: "#0969da",
          magenta: "#8250df",
          cyan: "#1b7c83",
          white: "#f6f8fa",
        };
      case "dark-classic":
      default:
        return {
          background: "#0f172a", // slate-900
          foreground: "#f8fafc", // slate-50
          cursor: "#38bdf8", // sky-400
          black: "#1e293b",
          red: "#ef4444",
          green: "#22c55e",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#06b6d4",
          white: "#f1f5f9",
        };
    }
  };

  // Main Terminal Mounting & Socket Connection logic
  useEffect(() => {
    if (!isAuthenticated || !sessionReady || activeTab !== "terminal") {
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
      setSocketStatus("connecting");
      // AnimatePresence can delay mounting the dashboard after authentication.
      // Wait briefly for the terminal container instead of abandoning setup.
      for (let attempt = 0; attempt < 40 && !terminalRef.current; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (!isMounted) return;
      }

      if (!terminalRef.current) {
        console.error("[TERMINAL] Container did not mount in time.");
        return;
      }

      // Load Xterm.js packages dynamically to prevent server-side errors
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      if (!isMounted || !terminalRef.current) return;
      terminalElement = terminalRef.current;

      // Create new terminal instance
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        fontFamily: '"JetBrains Mono", "Fira Code", Courier, monospace',
        fontSize: fontSizeRef.current,
        lineHeight: 1.25,
        theme: getTerminalColors(themeRef.current),
        scrollback: 5000,
        allowProposedApi: true,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      fitAddonRef.current = fitAddon;
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
        if (text && socket?.connected) socket.emit("input", text);
        term.focus();
      };

      term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey)
          return true;

        if (event.key.toLowerCase() === "c") {
          copySelection().catch((error) =>
            console.error("[TERMINAL] Copy failed:", error),
          );
          return false;
        }

        if (event.key.toLowerCase() === "v") {
          pasteClipboard().catch((error) =>
            console.error("[TERMINAL] Paste failed:", error),
          );
          return false;
        }

        return true;
      });

      contextMenuHandler = (event) => {
        event.preventDefault();
        const clipboardAction = term.hasSelection()
          ? copySelection()
          : pasteClipboard();
        clipboardAction.catch((error) =>
          console.error("[TERMINAL] Clipboard action failed:", error),
        );
      };
      terminalElement.addEventListener("contextmenu", contextMenuHandler);

      // Welcome Banner in terminal
      term.writeln(
        "\x1b[38;5;86m╔═════════════════════════════════════════════════════════════╗\x1b[0m",
      );
      term.writeln(
        "\x1b[38;5;86m║             SELF-HOSTED WEB VPS SHELL TERMINAL              ║\x1b[0m",
      );
      term.writeln(
        "\x1b[38;5;86m╚═════════════════════════════════════════════════════════════╝\x1b[0m",
      );
      term.writeln("\x1b[33mConnecting to local VPS shell process...\x1b[0m");

      const ticketResponse = await fetch(`${API_URL}/api/auth/socket-ticket`, {
        method: "POST",
        credentials: "include",
      });
      const ticketData = await ticketResponse.json();
      if (!ticketData.success)
        throw new Error(
          ticketData.error || "Không thể cấp vé kết nối terminal",
        );

      socket = io(API_URL || undefined, {
        auth: {
          ticket: ticketData.ticket,
          cwd: pendingTerminalCwdRef.current || undefined,
          cols: term.cols,
          rows: term.rows,
        },
        reconnectionDelay: 2000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
      });

      socketInstance.current = socket;
      pendingTerminalCwdRef.current = null;

      // Connection state listeners
      socket.on("connect", () => {
        setSocketStatus("connected");
        term.writeln(
          "\x1b[32m✔ Connected to real-time process manager successfully.\x1b[0m",
        );
        term.writeln(
          "\x1b[90mPress Enter to start interacting with the terminal.\x1b[0m\r\n",
        );
        fitAddon.fit();
        socket?.emit("resize", { cols: term.cols, rows: term.rows });
        term.focus();
      });

      socket.on("connect_error", async (err) => {
        setSocketStatus("error");
        term.writeln(
          `\r\n\x1b[31m✖ Connection failed: ${err.message}\x1b[0m\r\n`,
        );
        if (!isMounted || !socket || socket.connected) return;
        try {
          const response = await fetch(`${API_URL}/api/auth/socket-ticket`, {
            method: "POST",
            credentials: "include",
          });
          const data = await response.json();
          if (data.success && isMounted && socket) {
            socket.auth = {
              ticket: data.ticket,
              cwd: pendingTerminalCwdRef.current || undefined,
            };
            socket.connect();
          }
        } catch (error) {
          console.error(
            "[TERMINAL] Failed to refresh connection ticket:",
            error,
          );
        }
      });

      // Stream data from server to terminal
      socket.on("output", (data: string) => {
        if (term) {
          if (term.buffer.active.type === "alternate") {
            term.write(data);
          } else if (autoScrollRef.current) {
            term.write(data, () => term.scrollToBottom());
          } else {
            const previousViewportY = term.buffer.active.viewportY;
            term.write(data, () => term.scrollToLine(previousViewportY));
          }
        }
      });

      // Forward user keyboard input to server shell
      term.onData((data: string) => {
        if (socket && socket.connected) {
          socket.emit("input", data);
        }
      });

      // Observe terminal panel resize and communicate dimensions
      if (typeof window !== "undefined") {
        resizeObserverRef.current = new ResizeObserver(() => {
          if (isMounted && fitAddon) {
            try {
              fitAddon.fit();
              if (socket?.connected) {
                socket.emit("resize", { cols: term.cols, rows: term.rows });
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
      console.error("[TERMINAL] Failed to initialize:", error);
      if (terminalRef.current) {
        terminalRef.current.textContent = `Không thể khởi tạo terminal: ${error instanceof Error ? error.message : String(error)}`;
        terminalRef.current.classList.add(
          "p-3",
          "font-mono",
          "text-sm",
          "text-red-400",
        );
      }
    });

    return () => {
      isMounted = false;
      if (contextMenuHandler && terminalElement) {
        terminalElement.removeEventListener("contextmenu", contextMenuHandler);
      }
      if (socket) {
        socket.disconnect();
      }
      if (term) {
        term.dispose();
      }
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, [isAuthenticated, sessionReady, activeTab]);

  // Handle dynamic font size or theme adjustment in living terminal
  useEffect(() => {
    let fitTimer: number | undefined;
    if (xtermInstance.current) {
      xtermInstance.current.options.fontSize = fontSize;
      xtermInstance.current.options.theme = getTerminalColors(theme);
      fitTimer = window.setTimeout(() => {
        fitAddonRef.current?.fit();
        if (socketInstance.current?.connected && xtermInstance.current) {
          socketInstance.current.emit("resize", {
            cols: xtermInstance.current.cols,
            rows: xtermInstance.current.rows,
          });
        }
      }, 50);
    }
    if (!isSettingsLoadedRef.current) {
      return () => { if (fitTimer) window.clearTimeout(fitTimer); };
    }
    if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current);
    settingsDebounceRef.current = setTimeout(() => saveSettings(fontSize, theme), 300);
    return () => {
      if (fitTimer) window.clearTimeout(fitTimer);
      if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current);
    };
  }, [fontSize, theme, saveSettings]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches(
        'input, textarea, select, [contenteditable="true"]',
      );
      const terminalHasFocus = Boolean(
        activeTab === "terminal" &&
          target &&
          terminalRef.current?.contains(target),
      );
      if (terminalHasFocus) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        setPaletteQuery("");
        setContextMenu(null);
        return;
      }
      if (event.key === "Escape") {
        if (confirmPrompt) closeConfirm(false);
        else if (paletteOpen) setPaletteOpen(false);
        else if (contextMenu) setContextMenu(null);
        else if (window.innerWidth < 768 && isSidebarOpen)
          setIsSidebarOpen(false);
        return;
      }
      if (!editing && event.altKey && /^[1-8]$/.test(event.key)) {
        const tabs: ActiveTab[] = [
          "overview",
          "terminal",
          "system",
          "sqlite",
          "jobs",
          "logs",
          "files",
          "settings",
        ];
        const tab = tabs[Number(event.key) - 1];
        if (
          tab &&
          (["files", "settings"].includes(tab) ||
            ["admin", "root"].includes(currentUser?.role || ""))
        ) {
          event.preventDefault();
          setActiveTab(tab);
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // Action functions intentionally use the latest render values listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isAuthenticated,
    activeTab,
    sqliteWorkspace,
    paletteOpen,
    contextMenu,
    confirmPrompt,
    isSidebarOpen,
    currentUser,
  ]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("pointerdown", close);
    };
  }, [contextMenu]);

  const navigateWorkspace = (tab: ActiveTab, sqliteView?: SqliteWorkspace) => {
    setActiveTab(tab);
    if (sqliteView) setSqliteWorkspace(sqliteView);
    setPaletteOpen(false);
    setPaletteQuery("");
  };
  const displayedSocketStatus =
    activeTab === "terminal" ? socketStatus : "idle";
  // Actions execute after user input; callbacks do not read refs during render.
  // eslint-disable-next-line react-hooks/refs
  const paletteActions = [
    {
      label: "Tổng quan",
      hint: "Alt+1",
      keywords: "overview dashboard metrics observability",
      allowed: ["admin", "root"].includes(currentUser?.role || ""),
      run: () => navigateWorkspace("overview"),
    },
    {
      label: "Terminal",
      hint: "Alt+2",
      keywords: "shell command",
      allowed: ["admin", "root"].includes(currentUser?.role || ""),
      run: () => navigateWorkspace("terminal"),
    },
    {
      label: "Quản trị hệ thống",
      hint: "Alt+3",
      keywords: "services processes",
      allowed: ["admin", "root"].includes(currentUser?.role || ""),
      run: () => navigateWorkspace("system"),
    },
    {
      label: "SQLite Studio",
      hint: "Alt+4",
      keywords: "database data",
      allowed: ["admin", "root"].includes(currentUser?.role || ""),
      run: () => navigateWorkspace("sqlite"),
    },
    {
      label: "Chạy SQL",
      hint: "Ctrl+Enter",
      keywords: "query console",
      allowed: Boolean(selectedSqlite),
      run: () => navigateWorkspace("sqlite", "sql"),
    },
    {
      label: "Tác vụ SQLite",
      hint: "Alt+5",
      keywords: "jobs operations backup integrity vacuum queue",
      allowed: ["admin", "root"].includes(currentUser?.role || ""),
      run: () => navigateWorkspace("jobs"),
    },
    {
      label: "Nhật ký bảo mật",
      hint: "Alt+6",
      keywords: "audit logs",
      allowed: ["admin", "root"].includes(currentUser?.role || ""),
      run: () => navigateWorkspace("logs"),
    },
    {
      label: "Quản lý tệp tin",
      hint: "Alt+7",
      keywords: "files folders",
      allowed: true,
      run: () => navigateWorkspace("files"),
    },
    {
      label: "Cấu hình",
      hint: "Alt+8",
      keywords: "settings security",
      allowed: true,
      run: () => navigateWorkspace("settings"),
    },
    {
      label: "Tải lại workspace hiện tại",
      hint: "Refresh",
      keywords: "reload refresh",
      allowed: true,
      run: () => {
        setPaletteOpen(false);
        if (activeTab === "files") loadFiles(currentPath, null, "none");
        else if (activeTab === "system") loadSystemData();
        else if (activeTab === "sqlite") loadSqliteFiles();
        else if (activeTab === "jobs") window.dispatchEvent(new Event("jobs:refresh"));
        else if (activeTab === "logs") loadLogs();
      },
    },
    {
      label: "Tạo tệp mới",
      hint: "Files",
      keywords: "new file create",
      allowed: currentUser?.role !== "viewer",
      run: () => {
        navigateWorkspace("files");
        setShowCreateFile(true);
      },
    },
    {
      label: "Upload tệp",
      hint: "Files",
      keywords: "upload",
      allowed: currentUser?.role !== "viewer",
      run: () => {
        uploadInputRef.current?.click();
        navigateWorkspace("files");
      },
    },
  ].filter(
    (action) =>
      action.allowed &&
      `${action.label} ${action.keywords}`
        .toLowerCase()
        .includes(paletteQuery.toLowerCase()),
  );

  // Loading indicator for verification check
  if (isAuthenticated === null) {
    return <LoadingScreen />;
  }

  return (
    <div className="app-shell app-grid-bg flex flex-col min-h-screen text-slate-300 font-sans selection:bg-blue-500/30 selection:text-white">
      <AnimatePresence mode="wait">
        {!isAuthenticated ? (
          <LoginScreen
            username={username}
            password={password}
            twoFactorChallenge={Boolean(twoFactorChallenge)}
            twoFactorCode={twoFactorCode}
            error={error}
            loading={loading}
            onUsernameChange={setUsername}
            onPasswordChange={setPassword}
            onTwoFactorCodeChange={setTwoFactorCode}
            onSubmit={twoFactorChallenge ? handleTwoFactorLogin : handleLogin}
            onCancelTwoFactor={() => {
              setTwoFactorChallenge(null);
              setTwoFactorCode("");
              setError(null);
            }}
          />
        ) : (
          // 2. Fully Loaded Interactive Web Terminal Sleek Dashboard
          <motion.div
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="app-shell flex flex-col w-full h-screen overflow-hidden"
          >
            <input
              id="file-upload-input"
              ref={uploadInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                uploadFiles(Array.from(event.target.files || []));
                event.target.value = "";
              }}
            />
            <Header
              socketStatus={displayedSocketStatus}
              onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
              onLogout={handleLogout}
            />

            {/* Main Content Area */}
            <div className="flex flex-1 overflow-hidden">
              <MobileBackdrop open={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
              {currentUser && (
                <Sidebar
                  open={isSidebarOpen}
                  width={mainSidebarWidth}
                  activeTab={activeTab}
                  role={currentUser.role}
                  metrics={{ cpuPercent, memUsedMB, memTotalMB, memPercent, diskUsedGB, diskTotalGB, diskPercent, unavailable: Boolean(metricsError) }}
                  logs={logs}
                  onSelectTab={(tab) => {
                    setActiveTab(tab);
                    if (tab === "logs") loadLogs();
                    if (tab === "files") loadFiles(currentPath || getSavedFilePath());
                  }}
                  onStartResize={(event) => startResize(event, "main")}
                />
              )}

              {/* MAIN CONTENT INNER */}
              <main className="app-workspace flex-1 flex flex-col overflow-hidden min-w-0">
                {/* Dynamic Workspace Rendering */}
                <div className="flex-1 overflow-hidden relative">
                  <AnimatePresence mode="wait">
                    {activeTab === "overview" &&
                      currentUser &&
                      ["admin", "root"].includes(currentUser.role) && (
                        <OverviewWorkspace onOpenJobs={() => setActiveTab("jobs")} />
                      )}

                    {activeTab === "terminal" &&
                      currentUser &&
                      ["admin", "root"].includes(currentUser.role) && (
                        <TerminalWorkspace
                          terminalRef={terminalRef}
                          autoScroll={autoScroll}
                          fontSize={fontSize}
                          onInsertCommand={handleInsertCommand}
                          onAutoScrollChange={setAutoScroll}
                          onExportHistory={exportTerminalHistory}
                          onClear={clearTerminal}
                          onDecreaseFontSize={() =>
                            setFontSize((previous) =>
                              Math.max(10, previous - 1),
                            )
                          }
                          onIncreaseFontSize={() =>
                            setFontSize((previous) =>
                              Math.min(24, previous + 1),
                            )
                          }
                        />
                      )}

                    {activeTab === "logs" &&
                      currentUser &&
                      ["admin", "root"].includes(currentUser.role) && (
                        <LogsWorkspace
                          logs={logs}
                          total={logTotal}
                          offset={logOffset}
                          query={logQuery}
                          category={logCategory}
                          level={logLevel}
                          result={logResult}
                          integrity={logIntegrity}
                          loading={logLoading}
                          error={logError}
                          onQueryChange={setLogQuery}
                          onCategoryChange={setLogCategory}
                          onLevelChange={setLogLevel}
                          onResultChange={setLogResult}
                          onLoad={loadLogs}
                          onCheckIntegrity={checkLogIntegrity}
                          onExport={exportAuditLogs}
                        />
                      )}

                    {activeTab === "system" &&
                      currentUser &&
                      ["admin", "root"].includes(currentUser.role) && (
                        <SystemWorkspace
                          view={systemView}
                          services={services}
                          processes={processes}
                          query={systemQuery}
                          loading={systemLoading}
                          error={systemError}
                          role={currentUser.role}
                          onViewChange={setSystemView}
                          onQueryChange={setSystemQuery}
                          onReload={() => loadSystemData()}
                          onOpenServiceLogs={openServiceLogs}
                          onServiceAction={serviceAction}
                          onStopService={stopService}
                          onSignalProcess={signalProcess}
                        />
                      )}

                    {activeTab === "sqlite" &&
                      currentUser &&
                      ["admin", "root"].includes(currentUser.role) && (
                        <SQLiteWorkspace
                          data={{
                            role: currentUser.role,
                            files: sqliteFiles,
                            selected: selectedSqlite,
                            objects: sqliteObjects,
                            selectedTable: selectedSqliteTable,
                            rows: sqliteRows,
                            sql: sqliteSql,
                            result: sqliteResult,
                            message: sqliteMessage,
                            loading: sqliteLoading,
                            workspace: sqliteWorkspace,
                            columns: sqliteColumns,
                            identityKind: sqliteIdentityKind,
                            total: sqliteTotal,
                            offset: sqliteOffset,
                            limit: sqliteLimit,
                            search: sqliteSearch,
                            sort: sqliteSort,
                            order: sqliteOrder,
                            schemaAction: sqliteSchemaAction,
                            schemaForm: sqliteSchemaForm,
                            importFormat: sqliteImportFormat,
                            importData: sqliteImportData,
                            stats: sqliteStats,
                            backups: sqliteBackups,
                            plan: sqlitePlan,
                            history: sqliteHistory,
                            sidebarWidth: sqliteSidebarWidth,
                            highlightedRow: highlightedSqliteRow,
                          }}
                          actions={{
                            showOpen: showOpenSqlite,
                            loadFiles: loadSqliteFiles,
                            open: openSqlite,
                            remove: deleteSqlite,
                            openContextMenu,
                            startResize,
                            loadRows: loadSqliteRows,
                            setWorkspace: setSqliteWorkspace,
                            setAppliedSearch: setSqliteAppliedSearch,
                            setSearch: setSqliteSearch,
                            setSort: setSqliteSort,
                            setOrder: setSqliteOrder,
                            openRecord: openSqliteRecord,
                            deleteRecord: deleteSqliteRecord,
                            loadOperations: loadSqliteOperations,
                            explainQuery: explainSqliteQuery,
                            runQuery: runSqliteQuery,
                            setSql: setSqliteSql,
                            clearHistory: () => {
                              setSqliteHistory([]);
                              localStorage.removeItem(SQLITE_HISTORY_KEY);
                            },
                            setSchemaAction: setSqliteSchemaAction,
                            setSchemaForm: setSqliteSchemaForm,
                            setSelectedTable: setSelectedSqliteTable,
                            applySchemaAction: applySqliteSchemaAction,
                            maintenance: sqliteMaintenance,
                            setImportFormat: setSqliteImportFormat,
                            setImportData: setSqliteImportData,
                            importTable: importSqliteTable,
                            backupAction: sqliteBackupAction,
                          }}
                        />
                      )}

                    {activeTab === "jobs" &&
                      currentUser &&
                      ["admin", "root"].includes(currentUser.role) && (
                        <JobsWorkspace
                          active={activeTab === "jobs"}
                          role={currentUser.role}
                          databases={sqliteFiles}
                          askConfirm={askConfirm}
                          notify={notify}
                        />
                      )}

                    {/* TAB 3: Admin Configurations & Security Settings */}
                    {activeTab === "settings" && (
                      <SettingsWorkspace
                        data={{
                          fontSize,
                          theme,
                          previewTheme,
                          activePreviewTheme,
                          saveStatus,
                          loading,
                          currentPassword,
                          newPassword,
                          confirmPassword,
                          passwordError: pwdError,
                          passwordSuccess: pwdSuccess,
                          securityStatus,
                          securityMessage,
                          twoFactorPassword,
                          twoFactorSetup,
                          twoFactorCode,
                          recoveryCodes,
                          currentRole: currentUser?.role,
                          managedUsers,
                          newUser,
                        }}
                        actions={{
                          setFontSize,
                          setPreviewTheme,
                          setTheme,
                          setSaveStatus,
                          getTerminalColors,
                          handlePasswordChange,
                          setCurrentPassword,
                          setNewPassword,
                          setConfirmPassword,
                          setTwoFactorPassword,
                          setTwoFactorCode,
                          startTwoFactorSetup,
                          confirmTwoFactorSetup,
                          disableTwoFactor,
                          revokeSession,
                          setNewUser,
                          createUser,
                          updateUser,
                          deleteUser,
                          copyRecoveryCodes: () =>
                            navigator.clipboard.writeText(
                              recoveryCodes.join("\n"),
                            ),
                          resetUserPassword,
                        }}
                      />
                    )}

                    {/* TAB 4: File Manager */}
                    {activeTab === "files" && (
                      <FileWorkspace
                        data={{
                          role: currentUser?.role,
                          filteredFiles,
                          currentPath,
                          parentPath,
                          viewingFile,
                          fileContent,
                          editorOriginal,
                          isEditing: isEditingFile,
                          loading: fileLoading,
                          error: fileError,
                          showCreateFolder,
                          showCreateFile,
                          newDirName,
                          newFileName,
                          searchQuery: fileSearchQuery,
                          bookmarks: fileBookmarks,
                          pathInput,
                          pathHistory,
                          historyIndex,
                          selectedPaths,
                          clipboard: fileClipboard,
                          recursiveSearch,
                          searchTruncated,
                          uploadProgress,
                          previewTicket,
                        }}
                        actions={{
                          uploadInputRef,
                          uploadFiles,
                          loadFiles,
                          openTrash,
                          openSnapshots,
                          setShowCreateFolder,
                          setShowCreateFile,
                          setError: setFileError,
                          setNewDirName,
                          setNewFileName,
                          createNewDir,
                          createNewFile,
                          navigateHistory,
                          setPathInput,
                          toggleBookmark: toggleFileBookmark,
                          setSearchQuery: setFileSearchQuery,
                          setSearchResults,
                          runRecursiveSearch,
                          setRecursiveSearch,
                          setSelectedPaths,
                          setClipboard: setFileClipboard,
                          trashPaths,
                          transferFiles,
                          renameBookmark: renameFileBookmark,
                          setIsEditing: setIsEditingFile,
                          saveEditedFile,
                          openFile,
                          askConfirm,
                          setViewingFile,
                          setFileContent,
                          openContextMenu,
                          openTerminal: openTerminalAtCurrentPath,
                          createArchive: createFileArchive,
                          createSymlink: createFileSymlink,
                          openMetadata: openFileMetadata,
                          extractArchive: extractFileArchive,
                          moveOrRename,
                          deleteFileOrFolder,
                          downloadFile,
                        }}
                      />
                    )}
                    <ResourceModals
                      metadata={{
                        value: metadata,
                        onChange: setMetadata,
                        onClose: () => setMetadata(null),
                        onSave: async () => {
                          if (!metadata) return;
                          try {
                            await requestFileApi("/api/files/metadata", {
                              method: "PATCH",
                              body: JSON.stringify(metadata),
                            });
                            setMetadata(null);
                            await loadFiles(currentPath, null, "none");
                          } catch (error: any) {
                            setFileError(error.message);
                          }
                        },
                      }}
                      trash={{
                        open: showTrash,
                        items: trashItems,
                        selectedIds: selectedTrashIds,
                        onToggle: (id) =>
                          setSelectedTrashIds((ids) =>
                            ids.includes(id)
                              ? ids.filter((selectedId) => selectedId !== id)
                              : [...ids, id],
                          ),
                        onClose: () => setShowTrash(false),
                        onRestore: () => trashAction("restore", selectedTrashIds),
                        onDelete: async () => {
                          if (
                            await askConfirm({
                              message: "Xóa vĩnh viễn các mục đã chọn?",
                              danger: true,
                              confirmLabel: "Xóa vĩnh viễn",
                            })
                          )
                            trashAction("delete", selectedTrashIds);
                        },
                        onEmpty: async () => {
                          if (
                            await askConfirm({
                              message: "Dọn sạch toàn bộ thùng rác?",
                              danger: true,
                              requiredText: "DỌN SẠCH",
                              confirmLabel: "Dọn sạch",
                            })
                          )
                            trashAction("empty");
                        },
                      }}
                      snapshots={{
                        open: showSnapshots,
                        items: snapshots,
                        path: snapshotPath,
                        role: currentUser?.role,
                        onClose: () => setShowSnapshots(false),
                        onDownload: downloadSnapshot,
                        onRestore: restoreSnapshot,
                        onDelete: deleteSnapshot,
                      }}
                      serviceLogs={{
                        value: serviceLogs,
                        onClose: () => setServiceLogs(null),
                      }}
                      record={{
                        modal: sqliteRecordModal,
                        table: selectedSqliteTable,
                        values: sqliteRecordValues,
                        columns: sqliteColumns,
                        loading: sqliteLoading,
                        onValuesChange: setSqliteRecordValues,
                        onClose: () => setSqliteRecordModal(null),
                        onSave: saveSqliteRecord,
                      }}
                      browser={{
                        open: showSqliteBrowser,
                        path: sqliteBrowserPath,
                        parent: sqliteBrowserParent,
                        root: sqliteBrowserRoot,
                        items: sqliteBrowserItems,
                        onPathChange: setSqliteBrowserPath,
                        onBrowse: browseSqlitePath,
                        onSelect: selectExistingSqlite,
                        onClose: () => setShowSqliteBrowser(false),
                      }}
                    />
                  </AnimatePresence>
                </div>
              </main>
            </div>

            <Footer socketStatus={displayedSocketStatus} />
          </motion.div>
        )}
      </AnimatePresence>
      <CommandPalette
        open={paletteOpen && isAuthenticated}
        query={paletteQuery}
        actions={paletteActions}
        inputRef={paletteInputRef}
        onQueryChange={setPaletteQuery}
        onClose={() => setPaletteOpen(false)}
      />
      <ConfirmDialog
        prompt={confirmPrompt}
        text={confirmText}
        onTextChange={setConfirmText}
        onClose={closeConfirm}
      />
      <ContextMenu
        menu={contextMenu}
        role={currentUser?.role}
        selectedSqlite={selectedSqlite}
        onClose={() => setContextMenu(null)}
        onOpenFile={(path) => {
          void openFile(path);
        }}
        onLoadFiles={(path) => {
          void loadFiles(path);
        }}
        onDownloadFile={downloadFile}
        onMoveFile={moveOrRename}
        onDeleteFile={deleteFileOrFolder}
        onOpenSqlite={(path) => {
          void openSqlite(path);
        }}
        onOpenSqliteOperations={(path) => {
          setSelectedSqlite(path);
          setSqliteWorkspace("operations");
          void loadSqliteOperations(path);
        }}
        onDeleteSqlite={deleteSqlite}
        onBrowseObject={(database, name) => {
          setSqliteWorkspace("data");
          void loadSqliteRows(database, name, 0, { q: "", sort: "" });
        }}
        onCopySchema={async (value) => {
          await navigator.clipboard.writeText(value);
          notify("info", "Đã sao chép schema.");
        }}
        onDropTable={(name) => {
          setSelectedSqliteTable(name);
          setSqliteSchemaAction("dropTable");
          setSqliteWorkspace("schema");
        }}
      />
      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
      <StepUpDialog
        open={Boolean(stepUpPrompt)}
        password={stepUpPassword}
        code={stepUpCode}
        error={stepUpError}
        onPasswordChange={setStepUpPassword}
        onCodeChange={setStepUpCode}
        onCancel={cancelStepUp}
        onSubmit={submitStepUp}
      />
    </div>
  );
}
