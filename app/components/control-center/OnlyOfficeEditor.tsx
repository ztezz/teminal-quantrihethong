"use client";

import { useEffect, useId, useState } from "react";
import { API_URL } from "./helpers";

declare global {
  interface Window {
    DocsAPI?: { DocEditor: new (elementId: string, config: Record<string, unknown>) => { destroyEditor: () => void } };
  }
}

interface OnlyOfficeEditorProps { filePath: string; }

export function OnlyOfficeEditor({ filePath }: OnlyOfficeEditorProps) {
  const containerId = `onlyoffice-${useId().replaceAll(":", "")}`;
  const [status, setStatus] = useState("Đang mở trình chỉnh sửa tài liệu...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let editor: { destroyEditor: () => void } | undefined;
    let script: HTMLScriptElement | undefined;
    let cancelled = false;
    const start = async () => {
      try {
        const response = await fetch(`${API_URL}/api/files/onlyoffice/session`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ path: filePath }) });
        const data = await response.json() as { success?: boolean; error?: string; documentServerUrl?: string; config?: Record<string, unknown> };
        if (!response.ok || !data.success || !data.documentServerUrl || !data.config) throw new Error(data.error || "Không thể tạo phiên OnlyOffice");
        script = document.createElement("script");
        script.src = `${data.documentServerUrl}/web-apps/apps/api/documents/api.js`;
        script.async = true;
        script.onload = () => {
          if (cancelled) return;
          if (!window.DocsAPI) { setError("OnlyOffice Document Server không tải được API editor."); return; }
          editor = new window.DocsAPI.DocEditor(containerId, { ...data.config, width: "100%", height: "100%" });
          setStatus("");
        };
        script.onerror = () => setError("Không thể tải OnlyOffice Document Server. Kiểm tra URL và reverse proxy.");
        document.head.appendChild(script);
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : "Không thể mở tài liệu OnlyOffice");
      }
    };
    void start();
    return () => { cancelled = true; editor?.destroyEditor(); script?.remove(); };
  }, [containerId, filePath]);

  return <div className="relative h-full min-h-[65vh] bg-slate-950"><div id={containerId} className="h-full w-full" />{(status || error) && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-500">{error || status}</div>}</div>;
}
