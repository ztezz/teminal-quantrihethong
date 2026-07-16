import type { Dispatch, MouseEvent, RefObject, SetStateAction } from "react";
import { motion } from "motion/react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpLeft,
  Bookmark,
  BookmarkCheck,
  ChevronRight,
  Database,
  Download,
  Edit,
  Eye,
  FilePlus,
  Folder,
  FolderPlus,
  History,
  Lock,
  Move,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { getFileIcon } from "../FileIcon";
import { API_URL, previewKind } from "../helpers";
import { CodeEditor } from "../CodeEditor";
import { PdfViewer } from "../PdfViewer";
import type { ConfirmOptions, FileBookmark, UserRole } from "../types";

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: string;
  [key: string]: unknown;
}
interface FileClipboard {
  operation: "copy" | "move";
  paths: string[];
}
export interface FileWorkspaceData {
  role?: UserRole;
  filteredFiles: FileItem[];
  currentPath: string;
  parentPath: string;
  viewingFile: string | null;
  fileContent: string | null;
  editorOriginal: string;
  isEditing: boolean;
  loading: boolean;
  error: string | null;
  showCreateFolder: boolean;
  showCreateFile: boolean;
  newDirName: string;
  newFileName: string;
  searchQuery: string;
  bookmarks: FileBookmark[];
  pathInput: string;
  pathHistory: string[];
  historyIndex: number;
  selectedPaths: string[];
  clipboard: FileClipboard | null;
  recursiveSearch: boolean;
  searchTruncated: boolean;
  uploadProgress: Record<string, number>;
  previewTicket: string | null;
}
export interface FileWorkspaceActions {
  uploadInputRef: RefObject<HTMLInputElement | null>;
  uploadFiles: (files: globalThis.File[]) => void;
  loadFiles: (
    path?: string,
    search?: string | null,
    history?: "push" | "none",
  ) => void | Promise<void>;
  openTrash: () => void;
  openSnapshots: (path?: string) => void;
  setShowCreateFolder: Dispatch<SetStateAction<boolean>>;
  setShowCreateFile: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setNewDirName: Dispatch<SetStateAction<string>>;
  setNewFileName: Dispatch<SetStateAction<string>>;
  createNewDir: () => void;
  createNewFile: () => void;
  navigateHistory: (offset: number) => void;
  setPathInput: Dispatch<SetStateAction<string>>;
  toggleBookmark: (path: string) => void;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setSearchResults: Dispatch<SetStateAction<FileItem[] | null>>;
  runRecursiveSearch: () => void;
  setRecursiveSearch: Dispatch<SetStateAction<boolean>>;
  setSelectedPaths: Dispatch<SetStateAction<string[]>>;
  setClipboard: Dispatch<SetStateAction<FileClipboard | null>>;
  trashPaths: (paths: string[]) => void;
  transferFiles: (operation: "copy" | "move", paths: string[]) => void;
  renameBookmark: (bookmark: FileBookmark) => void;
  setIsEditing: Dispatch<SetStateAction<boolean>>;
  saveEditedFile: () => void;
  openFile: (path: string, edit?: boolean) => Promise<void>;
  askConfirm: (options: ConfirmOptions) => Promise<boolean>;
  setViewingFile: Dispatch<SetStateAction<string | null>>;
  setFileContent: Dispatch<SetStateAction<string | null>>;
  openContextMenu: (event: MouseEvent, kind: "file", item: FileItem) => void;
  openTerminal: () => void;
  createArchive: () => void;
  createSymlink: () => void;
  openMetadata: (path: string) => void;
  extractArchive: (path: string) => void;
  moveOrRename: (path: string) => void;
  deleteFileOrFolder: (path: string) => void;
  downloadFile: (path: string) => void;
}
export interface FileWorkspaceProps {
  data: FileWorkspaceData;
  actions: FileWorkspaceActions;
}
export function FileWorkspace({ data, actions }: FileWorkspaceProps) {
  const {
    role,
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
  } = data;
  const currentUser = role ? { role } : null;
  const {
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
    renameBookmark,
    setIsEditing: setIsEditingFile,
    saveEditedFile,
    openFile,
    askConfirm,
    setViewingFile,
    setFileContent,
    openContextMenu,
    openTerminal,
    createArchive,
    createSymlink,
    openMetadata,
    extractArchive,
    moveOrRename,
    deleteFileOrFolder,
    downloadFile,
  } = actions;
  return (
    <motion.div
      key="files-tab"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="workspace-screen w-full h-full p-3 sm:p-6 overflow-y-auto"
    >
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top Header */}
        <div className="workspace-heading flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white uppercase tracking-wider mb-1">
              Quản Lý Tệp Tin
            </h3>
            <p className="text-xs text-slate-500 font-mono">
              Duyệt, xem, tạo, sửa và xóa tệp tin trên hệ thống VPS
            </p>
            {currentUser?.role === "viewer" && (
              <span className="mt-2 inline-block text-[10px] px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                CHẾ ĐỘ CHỈ ĐỌC
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
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
              <RefreshCw
                className={`w-3.5 h-3.5 ${fileLoading ? "animate-spin" : ""}`}
              />
              <span>Tải lại</span>
            </button>
            <button
              onClick={() => uploadInputRef.current?.click()}
              disabled={currentUser?.role === "viewer"}
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
            <button
              onClick={() => openSnapshots()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111116] hover:bg-[#1a1a24] text-xs font-semibold text-slate-300 border border-white/10 rounded"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Snapshots</span>
            </button>
            <button
              onClick={() => {
                setShowCreateFolder(true);
                setShowCreateFile(false);
              }}
              disabled={currentUser?.role === "viewer"}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white rounded transition cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Thư mục mới</span>
            </button>
            <button
              onClick={() => {
                setShowCreateFile(true);
                setShowCreateFolder(false);
              }}
              disabled={currentUser?.role === "viewer"}
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
            <button
              onClick={() => setFileError(null)}
              className="ml-auto text-red-400 hover:text-white font-bold"
            >
              X
            </button>
          </div>
        )}
        {Object.keys(uploadProgress).length > 0 && (
          <div className="space-y-1 rounded border border-emerald-500/20 bg-emerald-500/5 p-3 text-[11px] font-mono">
            {Object.entries(uploadProgress).map(([name, progress]) => (
              <div key={name} className="flex gap-3">
                <span className="flex-1 truncate">
                  {name.split("-").slice(0, -2).join("-")}
                </span>
                <span>{progress}%</span>
              </div>
            ))}
          </div>
        )}

        {/* Create Folder Inline Form */}
        {showCreateFolder && (
          <div className="p-4 rounded-lg bg-[#111116] border border-blue-500/30 flex flex-col sm:flex-row gap-3 items-end sm:items-center">
            <div className="flex-1">
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1.5 font-mono">
                Tên thư mục mới
              </label>
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
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1.5 font-mono">
                Tên tệp tin mới
              </label>
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
            <button
              onClick={() => navigateHistory(-1)}
              disabled={historyIndex <= 0}
              className="p-1 disabled:opacity-30"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => navigateHistory(1)}
              disabled={historyIndex >= pathHistory.length - 1}
              className="p-1 disabled:opacity-30"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <span className="text-slate-500 uppercase tracking-widest shrink-0">
              Đường dẫn:
            </span>
            <input
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              onKeyDown={(event) =>
                event.key === "Enter" && loadFiles(pathInput)
              }
              className="min-w-24 flex-1 bg-white/5 px-2 py-1 text-white outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={() => toggleFileBookmark(currentPath)}
              className={`shrink-0 p-1.5 rounded border transition-colors cursor-pointer ${fileBookmarks.some((item) => item.path === currentPath) ? "text-amber-400 bg-amber-500/10 border-amber-500/30" : "text-slate-500 hover:text-amber-400 border-white/10"}`}
              title="Ghim hoặc bỏ ghim đường dẫn"
            >
              {fileBookmarks.some((item) => item.path === currentPath) ? (
                <BookmarkCheck className="w-3.5 h-3.5" />
              ) : (
                <Bookmark className="w-3.5 h-3.5" />
              )}
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
                onChange={(e) => {
                  setFileSearchQuery(e.target.value);
                  if (!e.target.value) setSearchResults(null);
                }}
                onKeyDown={(event) =>
                  event.key === "Enter" &&
                  recursiveSearch &&
                  runRecursiveSearch()
                }
                placeholder="Tìm kiếm tệp, thư mục..."
                className="w-full pl-9 pr-8 py-2.5 bg-[#0d0d12] border border-white/10 rounded-lg text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
              />
              {fileSearchQuery && (
                <button
                  onClick={() => setFileSearchQuery("")}
                  className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-500 hover:text-white cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 overflow-x-auto text-[11px] font-mono text-slate-500">
          <button
            onClick={() => loadFiles("/")}
            className="px-1.5 py-1 hover:text-blue-400"
          >
            /
          </button>
          {currentPath
            .replace(/\\/g, "/")
            .split("/")
            .filter(Boolean)
            .map((segment, index, segments) => {
              const prefix = currentPath.startsWith("/") ? "/" : "";
              const path = prefix + segments.slice(0, index + 1).join("/");
              return (
                <span
                  key={`${path}-${index}`}
                  className="flex items-center gap-1"
                >
                  <ChevronRight className="w-3 h-3" />
                  <button
                    onClick={() => loadFiles(path)}
                    className="whitespace-nowrap px-1 py-1 hover:text-blue-400"
                  >
                    {segment}
                  </button>
                </span>
              );
            })}
        </div>
        {!viewingFile && (
          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            <input
              type="checkbox"
              checked={recursiveSearch}
              onChange={(e) => {
                setRecursiveSearch(e.target.checked);
                setSearchResults(null);
              }}
            />{" "}
            Tìm đệ quy (Enter để tìm)
            {searchTruncated && (
              <span className="text-amber-400">Kết quả đã bị giới hạn</span>
            )}
          </label>
        )}

        {!viewingFile &&
          currentUser?.role !== "viewer" &&
          selectedPaths.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded border border-blue-500/20 bg-blue-500/5 p-2 text-xs">
              <span className="mr-auto">
                Đã chọn {selectedPaths.length} mục
              </span>
              <button
                onClick={() =>
                  setFileClipboard({
                    operation: "copy",
                    paths: selectedPaths,
                  })
                }
                className="px-2 py-1 bg-white/10 rounded"
              >
                Sao chép
              </button>
              <button
                onClick={() =>
                  setFileClipboard({
                    operation: "move",
                    paths: selectedPaths,
                  })
                }
                className="px-2 py-1 bg-white/10 rounded"
              >
                Cắt
              </button>
              <button
                onClick={() => trashPaths(selectedPaths)}
                className="px-2 py-1 bg-red-500/20 text-red-300 rounded"
              >
                Thùng rác
              </button>
            </div>
          )}
        {!viewingFile && fileClipboard && (
          <button
            onClick={() =>
              transferFiles(fileClipboard.operation, fileClipboard.paths)
            }
            className="text-xs px-3 py-2 rounded bg-emerald-600 text-white"
          >
            Dán {fileClipboard.paths.length} mục vào đây
          </button>
        )}

        {fileBookmarks.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono shrink-0">
              Đã ghim:
            </span>
            {fileBookmarks.map((bookmark) => (
              <div
                key={bookmark.path}
                className="flex items-center shrink-0 rounded border border-amber-500/20 bg-amber-500/5 overflow-hidden"
              >
                <button
                  onClick={() => loadFiles(bookmark.path)}
                  className="max-w-64 truncate px-2.5 py-1.5 text-[11px] font-mono text-amber-300 hover:bg-amber-500/10 cursor-pointer"
                  title={`Mở ${bookmark.path || "/"}`}
                >
                  {bookmark.label}
                </button>
                <button
                  onClick={() => renameBookmark(bookmark)}
                  className="p-1.5 border-l border-amber-500/20"
                >
                  <Edit className="w-3 h-3" />
                </button>
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
                <span
                  className="text-xs text-white truncate max-w-md"
                  title={viewingFile}
                >
                  {viewingFile.replace(/\\/g, "/").split("/").pop()}
                </span>
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  {previewKind(viewingFile) !== "text"
                    ? previewKind(viewingFile)
                    : isEditingFile
                      ? fileContent !== editorOriginal
                        ? "Chưa lưu"
                        : "Đang chỉnh sửa"
                      : "Chỉ xem"}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => openSnapshots(viewingFile)}
                  className="px-3 py-1.5 bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded text-xs"
                >
                  Lịch sử
                </button>
                {previewKind(viewingFile) !== "text" ? null : isEditingFile ? (
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
                ) : currentUser?.role !== "viewer" ? (
                  <button
                    onClick={() => setIsEditingFile(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white rounded transition cursor-pointer"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    <span>Chỉnh sửa</span>
                  </button>
                ) : null}
                <button
                  onClick={async () => {
                    if (
                      isEditingFile &&
                      fileContent !== editorOriginal &&
                      !(await askConfirm({
                        message: "Bỏ các thay đổi chưa lưu?",
                        danger: true,
                        confirmLabel: "Bỏ thay đổi",
                      }))
                    )
                      return;
                    setViewingFile(null);
                    setFileContent(null);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111116] hover:bg-[#1c1c24] text-xs font-semibold text-slate-400 border border-white/10 rounded transition cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Đóng</span>
                </button>
              </div>
            </div>

            {/* Editor Content */}
            {previewKind(viewingFile) === "video" ? (
              <div className="bg-black p-4 flex justify-center">
                <video
                  key={viewingFile}
                  src={`${API_URL}/api/files/media?path=${encodeURIComponent(viewingFile)}&ticket=${encodeURIComponent(previewTicket || "")}`}
                  controls
                  playsInline
                  preload="metadata"
                  className="max-h-[70vh] w-full bg-black"
                >
                  Trình duyệt không hỗ trợ phát video này.
                </video>
              </div>
            ) : previewKind(viewingFile) === "audio" ? (
              <div className="min-h-64 bg-gradient-to-br from-slate-950 via-purple-950/40 to-black p-8 flex items-center justify-center">
                <audio
                  key={viewingFile}
                  src={`${API_URL}/api/files/media?path=${encodeURIComponent(viewingFile)}&ticket=${encodeURIComponent(previewTicket || "")}`}
                  controls
                  preload="metadata"
                  className="w-full max-w-2xl"
                >
                  Trình duyệt không hỗ trợ phát âm thanh này.
                </audio>
              </div>
            ) : previewKind(viewingFile) === "image" ? (
              <div className="min-h-96 bg-[linear-gradient(45deg,#111_25%,transparent_25%),linear-gradient(-45deg,#111_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#111_75%),linear-gradient(-45deg,transparent_75%,#111_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0px] p-4 flex items-center justify-center overflow-auto">
                {/* Authenticated filesystem images cannot use Next's build-time image optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${API_URL}/api/files/media?path=${encodeURIComponent(viewingFile)}&ticket=${encodeURIComponent(previewTicket || "")}`}
                  alt={
                    viewingFile.replace(/\\/g, "/").split("/").pop() ||
                    "Ảnh xem trước"
                  }
                  className="max-h-[75vh] max-w-full object-contain shadow-2xl"
                />
              </div>
            ) : previewKind(viewingFile) === "pdf" ||
              previewKind(viewingFile) === "office" ? (
              <PdfViewer key={`${viewingFile}-${previewTicket}`} fileName={viewingFile.replace(/\\/g, "/").split("/").pop() || viewingFile} src={`${API_URL}/api/files/${previewKind(viewingFile) === "office" ? "office-preview" : "media"}?path=${encodeURIComponent(viewingFile)}&ticket=${encodeURIComponent(previewTicket || "")}`} />
            ) : (
              <div className="p-2 sm:p-4 bg-black">
                <CodeEditor value={fileContent || ""} fileName={viewingFile} readOnly={!isEditingFile} dirty={fileContent !== editorOriginal} onChange={setFileContent} onSave={saveEditedFile} />
              </div>
            )}
          </div>
        ) : (
          /* Directory List */
          <div
            className="rounded-xl border border-white/10 bg-[#0d0d12]/60 overflow-hidden shadow-2xl"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (currentUser?.role !== "viewer") uploadFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <div className="flex flex-wrap gap-2 p-2 border-b border-white/10 text-[11px]">
              <span className="text-slate-500 mr-auto">
                Kéo nhiều tệp từ máy tính vào đây để upload
              </span>
              {currentUser && ["admin", "root"].includes(currentUser.role) && (
                <button
                  onClick={openTerminal}
                  className="px-2 py-1 bg-white/5 rounded"
                >
                  Mở Terminal tại đây
                </button>
              )}
              {currentUser?.role !== "viewer" && <>
                <button onClick={createArchive} className="px-2 py-1 bg-white/5 rounded">Tạo archive</button>
                <button onClick={createSymlink} className="px-2 py-1 bg-white/5 rounded">Tạo symlink</button>
              </>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-[#111116]/80 border-b border-white/10 text-[10px] text-slate-500 font-mono uppercase tracking-widest">
                    <th className="py-3.5 pl-4 font-semibold">
                        <input
                          type="checkbox"
                          disabled={currentUser?.role === "viewer"}
                        checked={
                          filteredFiles.length > 0 &&
                          filteredFiles.every((item) =>
                            selectedPaths.includes(item.path),
                          )
                        }
                        onChange={(event) =>
                          setSelectedPaths(
                            event.target.checked
                              ? filteredFiles.map((item) => item.path)
                              : [],
                          )
                        }
                        aria-label="Chọn tất cả"
                      />
                    </th>
                    <th className="py-3.5 px-3 font-semibold">Tên</th>
                    <th className="py-3.5 px-5 font-semibold hidden sm:table-cell">
                      Kích thước
                    </th>
                    <th className="py-3.5 px-5 font-semibold hidden md:table-cell">
                      Lần cuối sửa
                    </th>
                    <th className="py-3.5 px-5 font-semibold text-right">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono text-xs">
                  {fileLoading && filteredFiles.length === 0 ? (
                    Array.from({ length: 7 }).map((_, index) => (
                      <tr
                        key={`file-skeleton-${index}`}
                        className="skeleton-row"
                      >
                        <td colSpan={5}>
                          <span />
                        </td>
                      </tr>
                    ))
                  ) : filteredFiles.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-12 text-center text-slate-600 font-mono italic"
                      >
                        {fileSearchQuery
                          ? "Không tìm thấy tệp hoặc thư mục phù hợp."
                          : "Thư mục này trống hoặc không có quyền truy cập."}
                      </td>
                    </tr>
                  ) : (
                    filteredFiles.map((file) => {
                      const fullItemPath = file.path;
                      return (
                        <tr
                          key={fullItemPath}
                          onContextMenu={currentUser?.role === "viewer" ? undefined : (event) => openContextMenu(event, "file", file)}
                          className="hover:bg-white/[0.02] transition-colors group"
                        >
                          {/* File / Folder Name Clickable */}
                          <td className="py-3.5 pl-4">
                            <input
                              type="checkbox"
                              disabled={currentUser?.role === "viewer"}
                              checked={selectedPaths.includes(fullItemPath)}
                              onChange={() =>
                                setSelectedPaths((items) =>
                                  items.includes(fullItemPath)
                                    ? items.filter(
                                        (item) => item !== fullItemPath,
                                      )
                                    : [...items, fullItemPath],
                                )
                              }
                              aria-label={`Chọn ${file.name}`}
                            />
                          </td>
                          <td className="py-3.5 px-3">
                            {file.isDirectory ? (
                              <button
                                onClick={() => loadFiles(fullItemPath)}
                                className="flex items-center gap-2.5 text-blue-400 hover:text-blue-300 font-semibold cursor-pointer text-left"
                              >
                                <Folder className="w-4 h-4 shrink-0 text-blue-500" />
                                <span className="truncate max-w-xs sm:max-w-md">
                                  {file.name}/
                                </span>
                              </button>
                            ) : (
                              <button
                                onClick={() => openFile(fullItemPath)}
                                className="flex items-center gap-2.5 text-slate-300 hover:text-white cursor-pointer text-left"
                              >
                                {getFileIcon(file.name)}
                                <span className="truncate max-w-xs sm:max-w-md">
                                  {file.name}
                                </span>
                              </button>
                            )}
                          </td>

                          {/* Size */}
                          <td className="py-3.5 px-5 text-slate-400 hidden sm:table-cell">
                            {file.isDirectory ? (
                              <span className="text-[10px] text-slate-600 uppercase">
                                Thư mục
                              </span>
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
                                  {currentUser?.role !== "viewer" && (
                                    <button onClick={() => openFile(fullItemPath, true)} className="p-1.5 rounded bg-blue-500/5 hover:bg-blue-500/20 text-blue-400 border border-blue-500/10 cursor-pointer transition-colors" title="Sửa tệp"><Edit className="w-3.5 h-3.5" /></button>
                                  )}
                                </>
                              )}
                              {currentUser?.role !== "viewer" && <>
                                <button onClick={() => openMetadata(fullItemPath)} className="p-1.5 rounded bg-white/5 text-slate-400 border border-white/10" title="Quyền"><Lock className="w-3.5 h-3.5" /></button>
                                {!file.isDirectory && /\.(zip|tar|tgz|tar\.gz)$/i.test(file.name) && (
                                  <button onClick={() => extractArchive(fullItemPath)} className="p-1.5 rounded bg-cyan-500/5 text-cyan-400 border border-cyan-500/10" title="Giải nén"><Download className="w-3.5 h-3.5" /></button>
                                )}
                                <button onClick={() => moveOrRename(fullItemPath)} className="p-1.5 rounded bg-amber-500/5 hover:bg-amber-500/20 text-amber-400 border border-amber-500/10 cursor-pointer transition-colors" title="Đổi tên"><Move className="w-3.5 h-3.5" /></button>
                                <button onClick={() => deleteFileOrFolder(fullItemPath)} className="p-1.5 rounded bg-red-500/5 hover:bg-red-500/20 text-red-400 border border-red-500/10 cursor-pointer transition-colors" title="Xóa"><Trash2 className="w-3.5 h-3.5" /></button>
                              </>}
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
  );
}
