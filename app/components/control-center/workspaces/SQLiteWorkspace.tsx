import type { Dispatch, MouseEvent, PointerEvent, SetStateAction } from "react";
import { motion } from "motion/react";
import {
  Archive,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Download,
  Edit,
  Folder,
  History,
  Lock,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Table2,
  Terminal as TerminalIcon,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
import { SqliteResultTable, sqliteCellValue } from "../SqliteResultTable";
import { SqlConsoleTabs } from "../SqlConsoleTabs";
import { API_URL } from "../helpers";
import type {
  SqliteBackup,
  SqliteColumn,
  SqliteFile,
  SqliteHistoryEntry,
  SqliteObject,
  SqliteWorkspace as SqliteWorkspaceView,
  UserRole,
} from "../types";

type SchemaAction =
  "createTable" | "addColumn" | "createIndex" | "dropIndex" | "dropTable";
interface SchemaForm {
  table: string;
  columns: string;
  column: string;
  type: string;
  index: string;
  indexColumns: string;
  unique: boolean;
}
interface LoadRowsOptions {
  limit?: number;
  q?: string;
  sort?: string;
  order?: "asc" | "desc";
}
export interface SQLiteWorkspaceData {
  role: UserRole;
  files: SqliteFile[];
  selected: string;
  objects: SqliteObject[];
  selectedTable: string;
  rows: Record<string, unknown>[];
  sql: string;
  result: Record<string, unknown>[];
  message: string | null;
  loading: boolean;
  workspace: SqliteWorkspaceView;
  columns: SqliteColumn[];
  identityKind: "primaryKey" | "rowid" | "none";
  total: number;
  offset: number;
  limit: number;
  search: string;
  sort: string;
  order: "asc" | "desc";
  schemaAction: SchemaAction;
  schemaForm: SchemaForm;
  importFormat: "csv" | "json";
  importData: string;
  stats: Record<string, unknown> | null;
  backups: SqliteBackup[];
  plan: Record<string, unknown>[];
  history: SqliteHistoryEntry[];
  sidebarWidth: number;
  highlightedRow: number | null;
}
export interface SQLiteWorkspaceActions {
  showOpen: () => void;
  loadFiles: () => void;
  open: (path: string) => void | Promise<void>;
  remove: (path: string) => void;
  openContextMenu: (
    event: MouseEvent,
    kind: "database" | "object",
    item: SqliteFile | SqliteObject,
  ) => void;
  startResize: (event: PointerEvent, target: "sqlite") => void;
  loadRows: (
    database: string,
    table: string,
    offset: number,
    options?: LoadRowsOptions,
  ) => void | Promise<void>;
  setWorkspace: Dispatch<SetStateAction<SqliteWorkspaceView>>;
  setAppliedSearch: Dispatch<SetStateAction<string>>;
  setSearch: Dispatch<SetStateAction<string>>;
  setSort: Dispatch<SetStateAction<string>>;
  setOrder: Dispatch<SetStateAction<"asc" | "desc">>;
  openRecord: (mode: "add" | "edit", row?: Record<string, unknown>) => void;
  deleteRecord: (row: Record<string, unknown>) => void;
  loadOperations: () => void | Promise<void>;
  explainQuery: () => void;
  runQuery: () => void;
  setSql: Dispatch<SetStateAction<string>>;
  clearHistory: () => void;
  setSchemaAction: Dispatch<SetStateAction<SchemaAction>>;
  setSchemaForm: Dispatch<SetStateAction<SchemaForm>>;
  setSelectedTable: Dispatch<SetStateAction<string>>;
  applySchemaAction: () => void;
  maintenance: (action: "vacuum" | "analyze" | "integrity_check") => void;
  setImportFormat: Dispatch<SetStateAction<"csv" | "json">>;
  setImportData: Dispatch<SetStateAction<string>>;
  importTable: () => void;
  backupAction: (
    action: "create" | "restore" | "delete",
    name?: string,
  ) => void;
}
export interface SQLiteWorkspaceProps {
  data: SQLiteWorkspaceData;
  actions: SQLiteWorkspaceActions;
}
export function SQLiteWorkspace({ data, actions }: SQLiteWorkspaceProps) {
  const {
    role,
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
  } = data;
  const currentUser = { role };
  const {
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
    clearHistory: clearSqliteHistory,
    setSchemaAction: setSqliteSchemaAction,
    setSchemaForm: setSqliteSchemaForm,
    setSelectedTable: setSelectedSqliteTable,
    applySchemaAction: applySqliteSchemaAction,
    maintenance: sqliteMaintenance,
    setImportFormat: setSqliteImportFormat,
    setImportData: setSqliteImportData,
    importTable: importSqliteTable,
    backupAction: sqliteBackupAction,
  } = actions;
  return (
    <motion.div
      key="sqlite-tab"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="workspace-screen w-full h-full overflow-y-auto"
    >
      <div className="max-w-[1600px] mx-auto p-3 sm:p-6 space-y-4">
        <div className="workspace-heading flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="mr-auto">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-400" />
              <h3 className="text-lg font-bold text-white uppercase tracking-wider">
                SQLite Studio
              </h3>
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 text-[9px] font-mono text-emerald-400">
                LOCAL DATA LAB
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 font-mono">
              Browse, mutate, inspect and safeguard server databases
            </p>
          </div>
          <button
            onClick={showOpenSqlite}
            className="flex items-center justify-center gap-2 px-3 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold"
          >
            <Folder className="w-4 h-4" />
            Mở SQLite
          </button>
          <button
            onClick={() => loadSqliteFiles()}
            className="flex items-center justify-center gap-2 px-3 py-2 rounded border border-white/10 bg-white/5 text-xs"
          >
            <RefreshCw
              className={`w-4 h-4 ${sqliteLoading ? "animate-spin" : ""}`}
            />
            Quét lại
          </button>
        </div>
        {sqliteMessage && (
          <div
            className={`px-3 py-2 rounded border text-xs font-mono ${/không|lỗi|thất bại|invalid|error/i.test(sqliteMessage) ? "border-red-500/25 bg-red-500/5 text-red-400" : "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"}`}
          >
            {sqliteMessage}
          </div>
        )}

        <div
          className="sqlite-layout gap-4 items-start"
          style={
            {
              "--sqlite-sidebar-width": `${sqliteSidebarWidth}px`,
            } as import("react").CSSProperties
          }
        >
          <aside className="sqlite-sidebar relative rounded-xl border border-white/10 bg-[#0d1110] overflow-hidden lg:sticky lg:top-0">
            <div className="flex items-center px-4 py-3 border-b border-white/10">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Databases
              </h4>
              <span className="ml-auto rounded bg-white/5 px-2 py-0.5 text-[9px] font-mono text-slate-500">
                {sqliteFiles.length}
              </span>
            </div>
            <div className="max-h-52 lg:max-h-[32vh] overflow-y-auto p-2 space-y-1">
              {sqliteLoading && sqliteFiles.length === 0
                ? Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="skeleton-card" />
                  ))
                : sqliteFiles.length === 0 && (
                    <p className="p-5 text-center text-xs text-slate-600">
                      Chưa tìm thấy database SQLite.
                    </p>
                  )}
              {sqliteFiles.map((file) => (
                <button
                  key={file.path}
                  onContextMenu={(event) =>
                    openContextMenu(event, "database", file)
                  }
                  onClick={() => {
                    setSqliteWorkspace("data");
                    setSqliteAppliedSearch("");
                    setSqliteSearch("");
                    setSqliteSort("");
                    openSqlite(file.path);
                  }}
                  className={`w-full text-left p-3 rounded border transition ${selectedSqlite === file.path ? "bg-emerald-500/10 border-emerald-500/30" : "border-transparent hover:bg-white/5"}`}
                >
                  <span className="flex items-center gap-2 text-xs text-white font-semibold">
                    <Database
                      className={`w-4 h-4 ${file.protected ? "text-amber-400" : "text-emerald-400"}`}
                    />
                    <span className="truncate">{file.name}</span>
                    {file.protected && (
                      <Lock className="w-3 h-3 ml-auto text-amber-400" />
                    )}
                  </span>
                  <span
                    className="block mt-1 text-[10px] text-slate-500 font-mono truncate"
                    title={file.path}
                  >
                    {file.path}
                  </span>
                  <span className="block mt-1 text-[9px] text-slate-600">
                    {(file.size / 1024).toFixed(1)} KB ·{" "}
                    {new Date(file.mtime).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
            {selectedSqlite && (
              <>
                <div className="px-4 py-2 border-y border-white/10 text-[9px] font-bold uppercase tracking-widest text-slate-600">
                  Objects
                </div>
                <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                  {sqliteObjects.map((object) => (
                    <button
                      key={`${object.type}:${object.name}`}
                      onContextMenu={(event) =>
                        openContextMenu(event, "object", object)
                      }
                      disabled={!["table", "view"].includes(object.type)}
                      onClick={() => {
                        setSqliteWorkspace("data");
                        setSqliteSearch("");
                        setSqliteAppliedSearch("");
                        setSqliteSort("");
                        loadSqliteRows(selectedSqlite, object.name, 0, {
                          q: "",
                          sort: "",
                        });
                      }}
                      title={object.sql || object.name}
                      className={`w-full flex items-center gap-2 px-2 py-2 rounded text-left text-xs ${selectedSqliteTable === object.name ? "bg-emerald-500/10 text-emerald-300" : "text-slate-400 hover:bg-white/5 disabled:hover:bg-transparent"}`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${object.type === "table" ? "bg-emerald-400" : object.type === "view" ? "bg-blue-400" : "bg-slate-600"}`}
                      />
                      <span className="truncate">{object.name}</span>
                      <span className="ml-auto text-[8px] uppercase text-slate-600">
                        {object.type}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div
              role="separator"
              aria-label="Thay đổi chiều rộng trình duyệt SQLite"
              aria-orientation="vertical"
              onPointerDown={(event) => startResize(event, "sqlite")}
              className="sidebar-resizer -right-1"
            />
          </aside>

          <section className="min-w-0 space-y-4">
            {!selectedSqlite ? (
              <div className="min-h-96 rounded-xl border border-dashed border-white/10 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.05),transparent_60%)] flex flex-col items-center justify-center text-center p-8">
                <Database className="w-12 h-12 text-slate-700 mb-3" />
                <h4 className="text-white font-semibold">Chọn một database</h4>
                <p className="mt-1 max-w-sm text-xs text-slate-500">
                  Khám phá bảng, chỉnh sửa dữ liệu, chạy truy vấn và quản lý
                  backup từ một workspace.
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-white/10 bg-[#0d1110] overflow-hidden">
                  <div className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
                    <div className="min-w-0 mr-auto">
                      <h4 className="text-sm text-white font-bold font-mono truncate">
                        {selectedSqlite}
                      </h4>
                      <p className="text-[10px] text-slate-500 font-mono">
                        {
                          sqliteObjects.filter((item) => item.type === "table")
                            .length
                        }{" "}
                        bảng ·{" "}
                        {
                          sqliteObjects.filter((item) => item.type === "view")
                            .length
                        }{" "}
                        view ·{" "}
                        {
                          sqliteObjects.filter((item) => item.type === "index")
                            .length
                        }{" "}
                        index
                      </p>
                    </div>
                    <button
                      onClick={() => openSqlite(selectedSqlite)}
                      className="px-3 py-1.5 text-xs border border-white/10 rounded"
                    >
                      Làm mới
                    </button>
                    {currentUser.role === "root" &&
                      !sqliteFiles.find((file) => file.path === selectedSqlite)
                        ?.protected && (
                        <button
                          onClick={() => deleteSqlite(selectedSqlite)}
                          className="px-3 py-1.5 text-xs border border-red-500/20 bg-red-500/5 text-red-400 rounded"
                        >
                          Xóa database
                        </button>
                      )}
                  </div>
                  <div className="flex overflow-x-auto border-t border-white/10 px-2">
                    {(
                      [
                        {
                          key: "data",
                          label: "Data browser",
                          icon: Table2,
                        },
                        {
                          key: "sql",
                          label: "SQL console",
                          icon: TerminalIcon,
                        },
                        {
                          key: "schema",
                          label: "Schema",
                          icon: Wrench,
                        },
                        {
                          key: "operations",
                          label: "Operations",
                          icon: Archive,
                        },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.key}
                        onClick={() => {
                          setSqliteWorkspace(item.key);
                          if (item.key === "operations") loadSqliteOperations();
                        }}
                        className={`flex items-center gap-2 px-4 py-3 border-b-2 text-[10px] uppercase tracking-wider font-bold whitespace-nowrap ${sqliteWorkspace === item.key ? "border-emerald-400 text-emerald-300" : "border-transparent text-slate-500 hover:text-slate-300"}`}
                      >
                        <item.icon className="w-3.5 h-3.5" />
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {sqliteWorkspace === "data" && (
                  <div
                    className="rounded-xl border border-white/10 bg-[#0d1110] overflow-hidden"
                    aria-busy={sqliteLoading}
                  >
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        setSqliteAppliedSearch(sqliteSearch.trim());
                        loadSqliteRows(selectedSqlite, selectedSqliteTable, 0, {
                          q: sqliteSearch.trim(),
                        });
                      }}
                      className="p-3 border-b border-white/10 flex flex-col md:flex-row gap-2"
                    >
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-600" />
                        <input
                          value={sqliteSearch}
                          onChange={(event) =>
                            setSqliteSearch(event.target.value)
                          }
                          disabled={!selectedSqliteTable}
                          placeholder="Tìm trong mọi cột..."
                          className="w-full bg-black border border-white/10 rounded pl-9 pr-3 py-2 text-xs outline-none focus:border-emerald-500/40"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={!selectedSqliteTable}
                        className="px-3 py-2 rounded bg-white/5 border border-white/10 text-xs disabled:opacity-30"
                      >
                        Tìm
                      </button>
                      <select
                        value={sqliteLimit}
                        onChange={(event) =>
                          loadSqliteRows(
                            selectedSqlite,
                            selectedSqliteTable,
                            0,
                            {
                              limit: Number(event.target.value),
                            },
                          )
                        }
                        disabled={!selectedSqliteTable}
                        className="bg-black border border-white/10 rounded px-2 py-2 text-xs"
                      >
                        <option value={10}>10 / trang</option>
                        <option value={25}>25 / trang</option>
                        <option value={50}>50 / trang</option>
                        <option value={100}>100 / trang</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => openSqliteRecord("add")}
                        disabled={
                          !selectedSqliteTable ||
                          sqliteObjects.find(
                            (item) => item.name === selectedSqliteTable,
                          )?.type === "view"
                        }
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded bg-emerald-500 text-black text-xs font-bold disabled:opacity-30"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Thêm dòng
                      </button>
                    </form>
                    <div className="overflow-auto max-h-[55vh]">
                      <table className="min-w-full text-left text-[11px] font-mono">
                        <thead className="sticky top-0 z-[1] bg-[#151a18] text-slate-500">
                          <tr>
                            <th className="w-20 px-3 py-2 border-b border-r border-white/5">
                              Actions
                            </th>
                            {Array.from(
                              new Set(
                                sqliteRows.flatMap((row) => Object.keys(row)),
                              ),
                            ).map((column) => (
                              <th
                                key={column}
                                className="px-3 py-2 border-b border-r border-white/5 whitespace-nowrap"
                              >
                                <button
                                  onClick={() => {
                                    const order =
                                      sqliteSort === column &&
                                      sqliteOrder === "asc"
                                        ? "desc"
                                        : "asc";
                                    setSqliteSort(column);
                                    setSqliteOrder(order);
                                    loadSqliteRows(
                                      selectedSqlite,
                                      selectedSqliteTable,
                                      0,
                                      {
                                        sort: column,
                                        order,
                                      },
                                    );
                                  }}
                                  className={
                                    sqliteSort === column
                                      ? "text-emerald-300"
                                      : ""
                                  }
                                >
                                  {column}{" "}
                                  {sqliteSort === column
                                    ? sqliteOrder === "asc"
                                      ? "↑"
                                      : "↓"
                                    : ""}
                                </button>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {sqliteLoading && !sqliteRows.length
                            ? Array.from({ length: 6 }).map((_, index) => (
                                <tr
                                  key={`sqlite-skeleton-${index}`}
                                  className="skeleton-row"
                                >
                                  <td
                                    colSpan={Math.max(
                                      2,
                                      sqliteColumns.length + 1,
                                    )}
                                  >
                                    <span />
                                  </td>
                                </tr>
                              ))
                            : sqliteRows.map((row, index) => (
                                <tr
                                  key={index}
                                  className={
                                    highlightedSqliteRow === index
                                      ? "sqlite-row-highlight"
                                      : "hover:bg-white/[0.025]"
                                  }
                                >
                                  <td className="px-3 py-2 border-r border-white/5">
                                    <div className="flex gap-2">
                                      <button
                                        disabled={sqliteIdentityKind === "none"}
                                        onClick={() =>
                                          openSqliteRecord("edit", row)
                                        }
                                        title={
                                          sqliteIdentityKind === "none"
                                            ? "Bảng không có khóa ổn định"
                                            : "Sửa"
                                        }
                                        className="text-blue-400 disabled:text-slate-700"
                                      >
                                        <Edit className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        disabled={sqliteIdentityKind === "none"}
                                        onClick={() => deleteSqliteRecord(row)}
                                        title={
                                          sqliteIdentityKind === "none"
                                            ? "Bảng không có khóa ổn định"
                                            : "Xóa"
                                        }
                                        className="text-red-400 disabled:text-slate-700"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                  {Object.keys(row).map((column) => (
                                    <td
                                      key={column}
                                      className="max-w-80 px-3 py-2 border-r border-white/5 text-slate-300 whitespace-pre-wrap break-all"
                                    >
                                      {sqliteCellValue(row[column])}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                        </tbody>
                      </table>
                      {!sqliteLoading && !sqliteRows.length && (
                        <div className="p-10 text-center text-xs text-slate-600">
                          {selectedSqliteTable
                            ? "Không có dữ liệu phù hợp."
                            : "Chọn một table hoặc view."}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3 py-2.5 border-t border-white/10 text-[10px] text-slate-500">
                      <span>
                        {sqliteTotal
                          ? `${sqliteOffset + 1}-${Math.min(sqliteOffset + sqliteRows.length, sqliteTotal)} / ${sqliteTotal}`
                          : "0 dòng"}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          title="Trang đầu"
                          disabled={sqliteOffset === 0}
                          onClick={() =>
                            loadSqliteRows(
                              selectedSqlite,
                              selectedSqliteTable,
                              0,
                            )
                          }
                          className="p-1.5 border border-white/10 rounded disabled:opacity-25"
                        >
                          <ChevronsLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          title="Trang trước"
                          disabled={sqliteOffset === 0}
                          onClick={() =>
                            loadSqliteRows(
                              selectedSqlite,
                              selectedSqliteTable,
                              Math.max(0, sqliteOffset - sqliteLimit),
                            )
                          }
                          className="p-1.5 border border-white/10 rounded disabled:opacity-25"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <span className="px-2">
                          Trang {Math.floor(sqliteOffset / sqliteLimit) + 1} /{" "}
                          {Math.max(1, Math.ceil(sqliteTotal / sqliteLimit))}
                        </span>
                        <button
                          title="Trang sau"
                          disabled={
                            sqliteOffset + sqliteRows.length >= sqliteTotal
                          }
                          onClick={() =>
                            loadSqliteRows(
                              selectedSqlite,
                              selectedSqliteTable,
                              sqliteOffset + sqliteLimit,
                            )
                          }
                          className="p-1.5 border border-white/10 rounded disabled:opacity-25"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          title="Trang cuối"
                          disabled={
                            sqliteOffset + sqliteRows.length >= sqliteTotal
                          }
                          onClick={() =>
                            loadSqliteRows(
                              selectedSqlite,
                              selectedSqliteTable,
                              Math.max(
                                0,
                                (Math.ceil(sqliteTotal / sqliteLimit) - 1) *
                                  sqliteLimit,
                              ),
                            )
                          }
                          className="p-1.5 border border-white/10 rounded disabled:opacity-25"
                        >
                          <ChevronsRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {sqliteWorkspace === "sql" && (
                  <div className="grid xl:grid-cols-[minmax(0,1fr)_280px] gap-4">
                    <div className="min-w-0 space-y-4">
                      <div className="rounded-xl border border-white/10 bg-[#0d1110] overflow-hidden">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3 border-b border-white/10">
                          <div className="mr-auto">
                            <h4 className="text-xs text-white font-bold uppercase tracking-wider">
                              SQL Console
                            </h4>
                            <p className="text-[9px] text-slate-600 font-mono">
                              Ctrl/Cmd+Enter để chạy truy vấn
                            </p>
                          </div>
                          <button
                            onClick={explainSqliteQuery}
                            disabled={sqliteLoading || !sqliteSql.trim()}
                            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded border border-purple-500/25 bg-purple-500/5 text-purple-300 text-xs disabled:opacity-40"
                          >
                            <BarChart3 className="w-3.5 h-3.5" />
                            Query plan
                          </button>
                          <button
                            onClick={runSqliteQuery}
                            disabled={sqliteLoading || !sqliteSql.trim()}
                            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded bg-emerald-500 disabled:opacity-40 text-black text-xs font-bold"
                          >
                            <Play className="w-3.5 h-3.5" />
                            Chạy SQL
                          </button>
                        </div>
                        <SqlConsoleTabs key={selectedSqlite} database={selectedSqlite} sql={sqliteSql} setSql={setSqliteSql} objects={sqliteObjects} loading={sqliteLoading} onRun={runSqliteQuery} />
                        <div className="border-t border-white/10">
                          {sqliteLoading ? (
                            <div className="p-4 space-y-2">
                              {Array.from({
                                length: 4,
                              }).map((_, index) => (
                                <div key={index} className="skeleton-line" />
                              ))}
                            </div>
                          ) : (
                            <SqliteResultTable
                              rows={sqliteResult}
                              empty="Kết quả truy vấn sẽ hiển thị tại đây."
                            />
                          )}
                        </div>
                      </div>
                      {sqlitePlan.length > 0 && (
                        <div className="rounded-xl border border-purple-500/20 bg-[#0d1110] overflow-hidden">
                          <div className="px-4 py-3 border-b border-white/10 text-[10px] uppercase font-bold tracking-wider text-purple-300">
                            Query plan
                          </div>
                          <SqliteResultTable
                            rows={sqlitePlan}
                            empty="Không có query plan."
                          />
                        </div>
                      )}
                    </div>
                    <aside className="rounded-xl border border-white/10 bg-[#0d1110] overflow-hidden self-start">
                      <div className="flex items-center px-3 py-3 border-b border-white/10">
                        <History className="w-3.5 h-3.5 text-slate-500 mr-2" />
                        <h4 className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                          SQL History
                        </h4>
                        {sqliteHistory.length > 0 && (
                          <button
                            onClick={clearSqliteHistory}
                            className="ml-auto text-[9px] text-red-400"
                          >
                            Xóa
                          </button>
                        )}
                      </div>
                      <div className="max-h-[60vh] overflow-y-auto divide-y divide-white/5">
                        {sqliteHistory
                          .filter((entry) => entry.path === selectedSqlite)
                          .map((entry) => (
                            <button
                              key={entry.id}
                              onClick={() => setSqliteSql(entry.sql)}
                              className="w-full p-3 text-left hover:bg-white/[0.03]"
                            >
                              <code className="block line-clamp-3 text-[10px] text-slate-300">
                                {entry.sql}
                              </code>
                              <span
                                className={`block mt-2 text-[9px] ${entry.success ? "text-emerald-500" : "text-red-400"}`}
                              >
                                {new Date(entry.ranAt).toLocaleString()} ·{" "}
                                {entry.durationMs} ms
                                {entry.rowCount !== undefined
                                  ? ` · ${entry.rowCount} rows`
                                  : ""}
                              </span>
                            </button>
                          ))}
                        {!sqliteHistory.some(
                          (entry) => entry.path === selectedSqlite,
                        ) && (
                          <p className="p-6 text-center text-[10px] text-slate-600">
                            Chưa có truy vấn trong database này.
                          </p>
                        )}
                      </div>
                    </aside>
                  </div>
                )}

                {sqliteWorkspace === "schema" && (
                  <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
                    <div className="rounded-xl border border-white/10 bg-[#0d1110] overflow-hidden">
                      <div className="px-4 py-3 border-b border-white/10 text-[10px] uppercase font-bold tracking-wider text-slate-400">
                        Schema objects
                      </div>
                      <div className="divide-y divide-white/5">
                        {sqliteObjects.map((object) => (
                          <div
                            key={`${object.type}:${object.name}`}
                            className="p-4"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-2 h-2 rounded-full ${object.type === "table" ? "bg-emerald-400" : object.type === "view" ? "bg-blue-400" : "bg-purple-400"}`}
                              />
                              <span className="text-xs font-bold text-white">
                                {object.name}
                              </span>
                              <span className="ml-auto text-[9px] uppercase text-slate-600">
                                {object.type}
                              </span>
                            </div>
                            {object.sql && (
                              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/50 p-3 text-[10px] leading-relaxed text-slate-500">
                                {object.sql}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-emerald-500/15 bg-[#0d1110] p-4 space-y-4 self-start">
                      <div>
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                          Schema manager
                        </h4>
                        <p className="mt-1 text-[10px] text-slate-600">
                          DDL actions are sent as structured payloads.
                        </p>
                      </div>
                      <select
                        value={sqliteSchemaAction}
                        onChange={(event) =>
                          setSqliteSchemaAction(
                            event.target.value as typeof sqliteSchemaAction,
                          )
                        }
                        className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs"
                      >
                        <option value="createTable">Create table</option>
                        <option value="addColumn">Add column</option>
                        <option value="createIndex">Create index</option>
                        <option value="dropIndex">Drop index</option>
                        <option value="dropTable">Drop table</option>
                      </select>
                      {sqliteSchemaAction === "createTable" && (
                        <>
                          <input
                            value={sqliteSchemaForm.table}
                            onChange={(event) =>
                              setSqliteSchemaForm((form) => ({
                                ...form,
                                table: event.target.value,
                              }))
                            }
                            placeholder="Table name"
                            className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs"
                          />
                          <textarea
                            value={sqliteSchemaForm.columns}
                            onChange={(event) =>
                              setSqliteSchemaForm((form) => ({
                                ...form,
                                columns: event.target.value,
                              }))
                            }
                            placeholder="One column definition per line"
                            className="w-full min-h-32 resize-y bg-black border border-white/10 rounded p-3 font-mono text-xs text-emerald-200"
                          />
                        </>
                      )}
                      {sqliteSchemaAction === "addColumn" && (
                        <>
                          <input
                            value={
                              selectedSqliteTable || sqliteSchemaForm.table
                            }
                            onChange={(event) =>
                              setSqliteSchemaForm((form) => ({
                                ...form,
                                table: event.target.value,
                              }))
                            }
                            placeholder="Table"
                            className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              value={sqliteSchemaForm.column}
                              onChange={(event) =>
                                setSqliteSchemaForm((form) => ({
                                  ...form,
                                  column: event.target.value,
                                }))
                              }
                              placeholder="Column name"
                              className="bg-black border border-white/10 rounded px-3 py-2 text-xs"
                            />
                            <input
                              value={sqliteSchemaForm.type}
                              onChange={(event) =>
                                setSqliteSchemaForm((form) => ({
                                  ...form,
                                  type: event.target.value,
                                }))
                              }
                              placeholder="TEXT"
                              className="bg-black border border-white/10 rounded px-3 py-2 text-xs"
                            />
                          </div>
                        </>
                      )}
                      {sqliteSchemaAction === "createIndex" && (
                        <>
                          <input
                            value={
                              selectedSqliteTable || sqliteSchemaForm.table
                            }
                            onChange={(event) =>
                              setSqliteSchemaForm((form) => ({
                                ...form,
                                table: event.target.value,
                              }))
                            }
                            placeholder="Table"
                            className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs"
                          />
                          <input
                            value={sqliteSchemaForm.index}
                            onChange={(event) =>
                              setSqliteSchemaForm((form) => ({
                                ...form,
                                index: event.target.value,
                              }))
                            }
                            placeholder="Index name"
                            className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs"
                          />
                          <input
                            value={sqliteSchemaForm.indexColumns}
                            onChange={(event) =>
                              setSqliteSchemaForm((form) => ({
                                ...form,
                                indexColumns: event.target.value,
                              }))
                            }
                            placeholder="column_a, column_b"
                            className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs"
                          />
                          <label className="flex items-center gap-2 text-xs text-slate-400">
                            <input
                              type="checkbox"
                              checked={sqliteSchemaForm.unique}
                              onChange={(event) =>
                                setSqliteSchemaForm((form) => ({
                                  ...form,
                                  unique: event.target.checked,
                                }))
                              }
                              className="accent-emerald-500"
                            />
                            Unique index
                          </label>
                        </>
                      )}
                      {sqliteSchemaAction === "dropIndex" && (
                        <select
                          value={sqliteSchemaForm.index}
                          onChange={(event) =>
                            setSqliteSchemaForm((form) => ({
                              ...form,
                              index: event.target.value,
                            }))
                          }
                          className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs"
                        >
                          <option value="">Chọn index</option>
                          {sqliteObjects
                            .filter((object) => object.type === "index")
                            .map((object) => (
                              <option key={object.name} value={object.name}>
                                {object.name}
                              </option>
                            ))}
                        </select>
                      )}
                      {sqliteSchemaAction === "dropTable" && (
                        <select
                          value={selectedSqliteTable || sqliteSchemaForm.table}
                          onChange={(event) => {
                            setSelectedSqliteTable("");
                            setSqliteSchemaForm((form) => ({
                              ...form,
                              table: event.target.value,
                            }));
                          }}
                          className="w-full bg-black border border-red-500/20 rounded px-3 py-2 text-xs"
                        >
                          <option value="">Chọn table</option>
                          {sqliteObjects
                            .filter((object) => object.type === "table")
                            .map((object) => (
                              <option key={object.name} value={object.name}>
                                {object.name}
                              </option>
                            ))}
                        </select>
                      )}
                      <button
                        onClick={applySqliteSchemaAction}
                        disabled={sqliteLoading}
                        className={`w-full px-4 py-2.5 rounded text-xs font-bold ${sqliteSchemaAction.startsWith("drop") ? "bg-red-500/10 border border-red-500/25 text-red-400" : "bg-emerald-500 text-black"}`}
                      >
                        Áp dụng thay đổi
                      </button>
                    </div>
                  </div>
                )}

                {sqliteWorkspace === "operations" && (
                  <div className="grid xl:grid-cols-2 gap-4">
                    <div className="space-y-4">
                      <div className="rounded-xl border border-white/10 bg-[#0d1110] p-4">
                        <div className="flex items-center mb-4">
                          <BarChart3 className="w-4 h-4 text-emerald-400 mr-2" />
                          <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                            Database stats
                          </h4>
                          <button
                            onClick={loadSqliteOperations}
                            className="ml-auto text-[10px] text-slate-500"
                          >
                            Refresh
                          </button>
                        </div>
                        {sqliteStats ? (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {Object.entries(sqliteStats)
                              .filter(([key]) => key !== "success")
                              .map(([key, value]) => (
                                <div
                                  key={key}
                                  className="rounded border border-white/5 bg-black/30 p-3"
                                >
                                  <span className="block text-[9px] uppercase text-slate-600 truncate">
                                    {key}
                                  </span>
                                  <span className="mt-1 block text-xs font-mono text-slate-200 break-all">
                                    {typeof value === "object"
                                      ? JSON.stringify(value)
                                      : String(value)}
                                  </span>
                                </div>
                              ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-600">
                            Chưa tải thống kê.
                          </p>
                        )}
                      </div>
                      <div className="rounded-xl border border-white/10 bg-[#0d1110] p-4">
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3">
                          Maintenance
                        </h4>
                        <div className="grid sm:grid-cols-3 gap-2">
                          <button
                            onClick={() => sqliteMaintenance("vacuum")}
                            className="px-3 py-3 rounded border border-white/10 bg-white/[0.02] text-xs hover:border-emerald-500/30"
                          >
                            <Wrench className="w-4 h-4 mx-auto mb-1 text-emerald-400" />
                            VACUUM
                          </button>
                          <button
                            onClick={() => sqliteMaintenance("analyze")}
                            className="px-3 py-3 rounded border border-white/10 bg-white/[0.02] text-xs hover:border-blue-500/30"
                          >
                            <BarChart3 className="w-4 h-4 mx-auto mb-1 text-blue-400" />
                            ANALYZE
                          </button>
                          <button
                            onClick={() => sqliteMaintenance("integrity_check")}
                            className="px-3 py-3 rounded border border-white/10 bg-white/[0.02] text-xs hover:border-amber-500/30"
                          >
                            <ShieldCheck className="w-4 h-4 mx-auto mb-1 text-amber-400" />
                            INTEGRITY
                          </button>
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-[#0d1110] p-4 space-y-3">
                        <div>
                          <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                            Import / Export table
                          </h4>
                          <p className="mt-1 text-[10px] text-slate-600">
                            Target: {selectedSqliteTable || "chọn một table"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <select
                            value={sqliteImportFormat}
                            onChange={(event) =>
                              setSqliteImportFormat(
                                event.target.value as "csv" | "json",
                              )
                            }
                            className="bg-black border border-white/10 rounded px-3 py-2 text-xs"
                          >
                            <option value="csv">CSV</option>
                            <option value="json">JSON</option>
                          </select>
                          <label className="flex-1 flex items-center justify-center gap-2 border border-white/10 rounded text-xs cursor-pointer hover:bg-white/5">
                            <Upload className="w-3.5 h-3.5" />
                            Nạp file
                            <input
                              type="file"
                              accept={
                                sqliteImportFormat === "csv"
                                  ? ".csv,text/csv"
                                  : ".json,application/json"
                              }
                              className="hidden"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) file.text().then(setSqliteImportData);
                                event.target.value = "";
                              }}
                            />
                          </label>
                          {selectedSqliteTable && (
                            <a
                              href={`${API_URL}/api/sqlite/export?path=${encodeURIComponent(selectedSqlite)}&table=${encodeURIComponent(selectedSqliteTable)}&format=${sqliteImportFormat}`}
                              className="flex items-center justify-center gap-2 px-3 border border-emerald-500/20 rounded text-xs text-emerald-300"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Export
                            </a>
                          )}
                        </div>
                        <textarea
                          value={sqliteImportData}
                          onChange={(event) =>
                            setSqliteImportData(event.target.value)
                          }
                          placeholder={
                            sqliteImportFormat === "csv"
                              ? "id,name\n1,Ada"
                              : '[{"id":1,"name":"Ada"}]'
                          }
                          className="w-full min-h-28 resize-y bg-black border border-white/10 rounded p-3 font-mono text-[10px] text-slate-300"
                        />
                        <button
                          onClick={importSqliteTable}
                          disabled={
                            !selectedSqliteTable || !sqliteImportData.trim()
                          }
                          className="w-full py-2 rounded bg-emerald-500 text-black text-xs font-bold disabled:opacity-30"
                        >
                          Import vào {selectedSqliteTable || "table"}
                        </button>
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#0d1110] overflow-hidden self-start">
                      <div className="flex items-center p-4 border-b border-white/10">
                        <Archive className="w-4 h-4 text-purple-400 mr-2" />
                        <div>
                          <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                            Backups
                          </h4>
                          <p className="mt-1 text-[9px] text-slate-600">
                            Restore points for this database
                          </p>
                        </div>
                        <button
                          onClick={() => sqliteBackupAction("create")}
                          className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded bg-purple-500/10 border border-purple-500/25 text-purple-300 text-xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Tạo backup
                        </button>
                      </div>
                      <div className="divide-y divide-white/5">
                        {sqliteBackups.map((backup) => (
                          <div
                            key={backup.name}
                            className="p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                          >
                            <div className="min-w-0 mr-auto">
                              <p className="text-xs font-mono text-white truncate">
                                {backup.name}
                              </p>
                              <p className="mt-1 text-[9px] text-slate-600">
                                {backup.mtime
                                  ? new Date(backup.mtime).toLocaleString()
                                  : "Không rõ thời gian"}
                                {backup.size !== undefined
                                  ? ` · ${(backup.size / 1024).toFixed(1)} KB`
                                  : ""}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <a
                                title="Download"
                                href={`${API_URL}/api/sqlite/backups/${encodeURIComponent(backup.name)}/download`}
                                className="p-2 rounded border border-white/10 text-slate-400"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </a>
                              {currentUser.role === "root" && (
                                <>
                                  <button
                                    title="Restore"
                                    onClick={() =>
                                      sqliteBackupAction("restore", backup.name)
                                    }
                                    className="p-2 rounded border border-blue-500/20 text-blue-400"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    title="Delete"
                                    onClick={() =>
                                      sqliteBackupAction("delete", backup.name)
                                    }
                                    className="p-2 rounded border border-red-500/20 text-red-400"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                        {sqliteBackups.length === 0 && (
                          <p className="p-8 text-center text-xs text-slate-600">
                            Chưa có backup.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </motion.div>
  );
}
