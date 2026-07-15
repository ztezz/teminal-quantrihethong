import { publicApiUrl } from "@/lib/security-utils";
import type {
  ActiveTab,
  FileBookmark,
  PreviewKind,
  SqliteHistoryEntry,
} from "./types";

export const API_URL = publicApiUrl(
  process.env.NEXT_PUBLIC_API_URL || "https://api-ssh.luugame.fun",
);

export const LAST_FILE_PATH_KEY = "vps_terminal_last_file_path";
export const FILE_BOOKMARKS_KEY = "vps_terminal_file_bookmarks";
export const SQLITE_HISTORY_KEY = "vps_terminal_sqlite_history";
export const MAIN_SIDEBAR_WIDTH_KEY = "vps_terminal_sidebar_width";
export const SQLITE_SIDEBAR_WIDTH_KEY = "vps_terminal_sqlite_sidebar_width";

export function getSavedActiveTab(): ActiveTab {
  if (typeof window === "undefined") return "terminal";
  const saved = localStorage.getItem("vps_terminal_active_tab");
  return saved === "logs" ||
    saved === "settings" ||
    saved === "files" ||
    saved === "system" ||
    saved === "sqlite"
    ? saved
    : "terminal";
}

export function getSavedSidebarState(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem("vps_terminal_sidebar_open") !== "false";
}

export function previewKind(filePath: string): PreviewKind {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  if (["mp4", "webm", "ogv", "mov", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "oga", "aac", "m4a", "flac", "opus"].includes(ext))
    return "audio";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico"].includes(ext))
    return "image";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp"].includes(ext))
    return "office";
  return "text";
}

export function getSavedFilePath(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(LAST_FILE_PATH_KEY) || "";
}

export function getSavedFileBookmarks(): FileBookmark[] {
  if (typeof window === "undefined") return [];
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(FILE_BOOKMARKS_KEY) || "[]",
    );
    if (!Array.isArray(saved)) return [];
    return saved.flatMap((item): FileBookmark[] => {
      if (typeof item === "string") return [{ path: item, label: item || "/" }];
      if (
        item &&
        typeof item === "object" &&
        "path" in item &&
        typeof item.path === "string"
      ) {
        const label =
          "label" in item && typeof item.label === "string"
            ? item.label
            : "";
        return [{ path: item.path, label: label.trim() ? label : item.path || "/" }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

export function getSavedSqliteHistory(): SqliteHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const history: unknown = JSON.parse(
      localStorage.getItem(SQLITE_HISTORY_KEY) || "[]",
    );
    return Array.isArray(history) ? history.slice(0, 50) : [];
  } catch {
    return [];
  }
}
