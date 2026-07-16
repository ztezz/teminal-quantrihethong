"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Download, Edit, History, Save, X } from "lucide-react";
import { API_URL, previewKind } from "./helpers";
import { getFileIcon } from "./FileIcon";
import { CodeEditor } from "./CodeEditor";
import { PdfViewer } from "./PdfViewer";
import { VideoPlayer } from "./VideoPlayer";
import type { ConfirmOptions, UserRole } from "./types";

interface FilePreviewModalProps {
  role?: UserRole;
  filePath: string;
  fileContent: string | null;
  editorOriginal: string;
  editing: boolean;
  previewTicket: string | null;
  onContentChange: (value: string) => void;
  onEditingChange: (value: boolean) => void;
  onSave: () => void;
  onReload: () => void;
  onSnapshots: () => void;
  onClose: () => void;
  onConfirm: (options: ConfirmOptions) => Promise<boolean>;
}

function ImagePreview({ src, alt, fileName }: { src: string; alt: string; fileName: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    void fetch(src, { credentials: "include", signal: controller.signal }).then(async (response) => {
      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        const message = contentType.includes("application/json") ? ((await response.json()) as { error?: string }).error : await response.text();
        throw new Error(message || `Không thể tải ảnh (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      url = URL.createObjectURL(blob);
      setObjectUrl(url);
    }).catch((caught) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Không thể tải ảnh");
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);

  if (error) return <div className="flex min-h-[55vh] items-center justify-center p-8 text-center"><div className="max-w-md rounded-xl border border-red-500/20 bg-red-500/5 p-6"><AlertCircle className="mx-auto mb-3 h-7 w-7 text-red-400" /><p className="text-sm text-red-300">{error}</p><p className="mt-2 text-xs text-slate-500">Nếu đây là AVIF, trình duyệt hoặc hệ điều hành hiện tại có thể chưa hỗ trợ giải mã định dạng này.</p></div></div>;
  if (!objectUrl) return <div className="flex min-h-[55vh] items-center justify-center text-sm text-slate-500">Đang tải ảnh...</div>;
  return (
    <div className="relative flex min-h-[55vh] items-center justify-center overflow-auto bg-[linear-gradient(45deg,#111_25%,transparent_25%),linear-gradient(-45deg,#111_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#111_75%),linear-gradient(-45deg,transparent_75%,#111_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0px] p-4">
      {/* Object URLs are generated from authenticated filesystem responses. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={objectUrl} alt={alt} onError={() => setError(`Không thể giải mã ảnh ${fileName}`)} className="max-h-[78vh] max-w-full object-contain shadow-2xl" />
      <a href={objectUrl} download={fileName} className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-lg border border-white/15 bg-black/70 px-3 py-2 text-xs text-white backdrop-blur"><Download className="h-3.5 w-3.5" />Tải ảnh</a>
    </div>
  );
}

export function FilePreviewModal({ role, filePath, fileContent, editorOriginal, editing, previewTicket, onContentChange, onEditingChange, onSave, onReload, onSnapshots, onClose, onConfirm }: FilePreviewModalProps) {
  const kind = previewKind(filePath);
  const dirty = editing && fileContent !== editorOriginal;
  const fileName = filePath.replace(/\\/g, "/").split("/").pop() || filePath;
  const mediaUrl = `${API_URL}/api/files/media?path=${encodeURIComponent(filePath)}&ticket=${encodeURIComponent(previewTicket || "")}`;
  const close = async () => {
    if (dirty && !(await onConfirm({ message: "Bỏ các thay đổi chưa lưu?", danger: true, confirmLabel: "Bỏ thay đổi" }))) return;
    onClose();
  };
  const closeEvent = useEffectEvent(() => { void close(); });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !document.getElementById("confirm-title")) { event.preventDefault(); closeEvent(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-2 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="file-preview-title" onMouseDown={(event) => { if (event.target === event.currentTarget) void close(); }}>
      <div className="flex h-[94vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-xl border border-white/15 bg-[#090e17] shadow-[0_30px_100px_rgba(0,0,0,0.65)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-[#0d131e] px-3 py-3 sm:px-5">
          <span className="text-sky-400">{getFileIcon(filePath)}</span>
          <div className="min-w-0 flex-1"><h3 id="file-preview-title" className="truncate text-sm font-semibold text-white" title={filePath}>{fileName}</h3><p className="truncate text-[10px] font-mono text-slate-500" title={filePath}>{filePath}</p></div>
          <span className="rounded border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[9px] font-bold uppercase text-sky-300">{kind === "text" ? editing ? dirty ? "Chưa lưu" : "Đang sửa" : "Chỉ xem" : kind}</span>
          <button type="button" onClick={onSnapshots} className="inline-flex items-center gap-1.5 rounded border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"><History className="h-3.5 w-3.5" />Lịch sử</button>
          {kind === "text" && editing && <><button type="button" onClick={onSave} disabled={!dirty} className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-35"><Save className="h-3.5 w-3.5" />Lưu</button><button type="button" onClick={() => { onEditingChange(false); onReload(); }} className="rounded border border-white/10 px-3 py-2 text-xs text-slate-300">Hủy</button></>}
          {kind === "text" && !editing && role !== "viewer" && <button type="button" onClick={() => onEditingChange(true)} className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white"><Edit className="h-3.5 w-3.5" />Chỉnh sửa</button>}
          <button type="button" onClick={() => void close()} aria-label="Đóng xem trước" className="ml-0 inline-flex h-9 w-9 items-center justify-center rounded border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {kind === "video" ? <VideoPlayer key={`${filePath}-${previewTicket}`} src={mediaUrl} fileName={fileName} />
            : kind === "audio" ? <div className="flex h-full min-h-64 items-center justify-center bg-gradient-to-br from-slate-950 via-purple-950/40 to-black p-8"><audio key={filePath} src={mediaUrl} controls preload="metadata" className="w-full max-w-2xl">Trình duyệt không hỗ trợ âm thanh.</audio></div>
              : kind === "image" ? <ImagePreview src={mediaUrl} alt={`Xem trước ${fileName}`} fileName={fileName} />
                : kind === "pdf" || kind === "office" ? <PdfViewer key={`${filePath}-${previewTicket}`} fileName={fileName} src={`${API_URL}/api/files/${kind === "office" ? "office-preview" : "media"}?path=${encodeURIComponent(filePath)}&ticket=${encodeURIComponent(previewTicket || "")}`} />
                  : <div className="h-full bg-black p-2 sm:p-4"><CodeEditor value={fileContent || ""} fileName={filePath} readOnly={!editing} dirty={fileContent !== editorOriginal} onChange={onContentChange} onSave={onSave} /></div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
