import { File, FileClock, FileCode, FileJson, FileText } from "lucide-react";

export function getFileIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "sh":
    case "bash":
      return <FileCode className="w-4 h-4 shrink-0 text-emerald-400" />;
    case "txt":
    case "md":
      return <FileText className="w-4 h-4 shrink-0 text-slate-400" />;
    case "json":
      return <FileJson className="w-4 h-4 shrink-0 text-blue-400" />;
    case "log":
      return <FileClock className="w-4 h-4 shrink-0 text-amber-500" />;
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
    case "py":
    case "go":
    case "rs":
    case "c":
    case "cpp":
    case "html":
    case "css":
      return <FileCode className="w-4 h-4 shrink-0 text-purple-400" />;
    default:
      return <File className="w-4 h-4 shrink-0 text-slate-500" />;
  }
}
