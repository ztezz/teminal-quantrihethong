"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Clipboard, Download, FileText, FileUp, Globe, KeyRound, LockKeyhole, RotateCcw, Send, ShieldCheck, Sparkles, Timer, Trash2, Upload } from "lucide-react";
import { ApiError, apiClient } from "@/lib/client/api";
import { InstallShareButton } from "./install-share-button";

type UploadSession = { code: string; uploadToken: string; name: string; size: number };
type PublicFile = { code: string; name: string; size: number; createdAt: string; expiresAt: number; checksum?: string };
type PublicUploadSession = UploadSession & { lastModified: number; expiresAt: number };
type OwnedPublicFile = { token: string; expiresAt: number };
type ShareMode = "public" | "private";
const UPLOAD_SESSION_KEY = "nodeshell_quick_share_upload";
const PUBLIC_UPLOAD_KEY = "nodeshell_public_share_upload";
const PUBLIC_OWNED_KEY = "nodeshell_public_share_owned";

function fileExt(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 1024 * 1024 * 1024 ? 0 : 1)} ${bytes >= 1024 * 1024 * 1024 ? "GB" : "MB"}`;
}

function timeLeft(expiresAt: number, now: number) {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}p ${String(seconds % 60).padStart(2, "0")}s`;
}

function parseSharedFileCode(): string {
  if (typeof window === "undefined") return "";
  const fromQuery = new URLSearchParams(window.location.search).get("file") || new URLSearchParams(window.location.search).get("code") || "";
  if (/^\d{4}$/.test(fromQuery)) return fromQuery;
  const rawHash = window.location.hash.replace(/^#/, "");
  const fromHashParams = new URLSearchParams(rawHash).get("file") || new URLSearchParams(rawHash).get("code") || "";
  if (/^\d{4}$/.test(fromHashParams)) return fromHashParams;
  if (/^\d{4}$/.test(rawHash)) return rawHash;
  return "";
}

export default function QuickSharePage() {
  const [activeTab, setActiveTab] = useState<ShareMode>("public");
  const [viewingCode, setViewingCode] = useState<string>("");
  const [viewingFile, setViewingFile] = useState<PublicFile | null>(null);
  const [viewingLoading, setViewingLoading] = useState(false);
  const [viewingError, setViewingError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [checksum, setChecksum] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [receiveError, setReceiveError] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [resumeSession, setResumeSession] = useState<UploadSession | null>(null);
  const [publicFiles, setPublicFiles] = useState<PublicFile[]>([]);
  const [publicStatus, setPublicStatus] = useState("");
  const [publicBusy, setPublicBusy] = useState(false);
  const [publicProgress, setPublicProgress] = useState<number | null>(null);
  const [pendingPublicSession, setPendingPublicSession] = useState<PublicUploadSession | null>(null);
  const [selectedPublicFile, setSelectedPublicFile] = useState<File | null>(null);
  const [ownedPublicFiles, setOwnedPublicFiles] = useState<Record<string, OwnedPublicFile>>({});
  const ownedPublicRef = useRef<Record<string, OwnedPublicFile>>({});
  const [copiedPublicCode, setCopiedPublicCode] = useState("");
  const [removingCode, setRemovingCode] = useState("");
  const [dragging, setDragging] = useState(false);
  const [privateDragging, setPrivateDragging] = useState(false);
  const publicDragDepthRef = useRef(0);
  const privateDragDepthRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  const refreshPublicFiles = useCallback(async () => {
    try {
      const result = await apiClient.request<{ files: PublicFile[] }>("/api/quick-share/public", { cache: "no-store" });
      setPublicFiles(result.files);
    } catch (error) { setPublicStatus(error instanceof Error ? error.message : "Không thể tải danh sách file."); }
  }, []);

  useEffect(() => {
    const syncViewingCode = () => setViewingCode(parseSharedFileCode());
    const init = window.setTimeout(syncViewingCode, 0);
    window.addEventListener("hashchange", syncViewingCode);
    window.addEventListener("popstate", syncViewingCode);
    return () => {
      window.clearTimeout(init);
      window.removeEventListener("hashchange", syncViewingCode);
      window.removeEventListener("popstate", syncViewingCode);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadFileInfo = async () => {
      if (!viewingCode) {
        setViewingFile(null);
        setViewingError("");
        setViewingLoading(false);
        return;
      }
      setViewingLoading(true);
      setViewingError("");
      try {
        let found: PublicFile | null = null;
        try {
          const info = await apiClient.request<{ file: PublicFile }>(`/api/quick-share/public/${viewingCode}/info`, { cache: "no-store" });
          found = info.file;
        } catch {
          const list = await apiClient.request<{ files: PublicFile[] }>("/api/quick-share/public", { cache: "no-store" });
          found = list.files.find(item => item.code === viewingCode && item.expiresAt > Date.now()) || null;
        }
        if (!active) return;
        if (!found || found.expiresAt <= Date.now()) {
          setViewingFile(null);
          setViewingError("File này không tồn tại, đã hết thời gian chia sẻ (60 phút) hoặc đã được người gửi gỡ bỏ.");
          return;
        }
        setViewingFile(found);
      } catch (error) {
        if (!active) return;
        setViewingFile(null);
        setViewingError(error instanceof Error ? error.message : "Không thể tải thông tin file.");
      } finally {
        if (active) setViewingLoading(false);
      }
    };
    const timer = window.setTimeout(() => void loadFileInfo(), 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [viewingCode]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshPublicFiles(), 0);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const refresh = window.setInterval(() => void refreshPublicFiles(), 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(clock); window.clearInterval(refresh); };
  }, [refreshPublicFiles]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setResumeSession(JSON.parse(localStorage.getItem(UPLOAD_SESSION_KEY) || "null") as UploadSession | null); }
      catch { localStorage.removeItem(UPLOAD_SESSION_KEY); }
      try {
        const pending = JSON.parse(localStorage.getItem(PUBLIC_UPLOAD_KEY) || "null") as PublicUploadSession | null;
        if (pending && /^\d{4}$/.test(pending.code) && typeof pending.uploadToken === "string" && Number.isSafeInteger(pending.size) && Number.isFinite(pending.expiresAt) && pending.expiresAt > Date.now()) setPendingPublicSession(pending);
        else localStorage.removeItem(PUBLIC_UPLOAD_KEY);
      } catch { localStorage.removeItem(PUBLIC_UPLOAD_KEY); }
      try {
        const saved = JSON.parse(localStorage.getItem(PUBLIC_OWNED_KEY) || "{}") as Record<string, OwnedPublicFile>;
        const valid = Object.fromEntries(Object.entries(saved).filter(([id, owner]) => /^\d{4}$/.test(id) && typeof owner?.token === "string" && owner.expiresAt > Date.now()));
        ownedPublicRef.current = valid; setOwnedPublicFiles(valid);
      } catch { localStorage.removeItem(PUBLIC_OWNED_KEY); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function openFileViewer(itemCode: string) {
    const url = `${window.location.pathname}?file=${encodeURIComponent(itemCode)}`;
    window.history.pushState({}, "", url);
    setViewingCode(itemCode);
  }

  function closeFileViewer() {
    window.history.pushState({}, "", window.location.pathname);
    setViewingCode("");
    setViewingFile(null);
    setViewingError("");
  }

  function buildShareViewUrl(itemCode: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : (apiClient.baseUrl || "");
    return `${origin}/share?file=${encodeURIComponent(itemCode)}`;
  }

  function savePublicSession(session: PublicUploadSession | null) {
    if (session) localStorage.setItem(PUBLIC_UPLOAD_KEY, JSON.stringify(session));
    else localStorage.removeItem(PUBLIC_UPLOAD_KEY);
    setPendingPublicSession(session);
  }

  function saveOwnedPublicFiles(files: Record<string, OwnedPublicFile>) {
    ownedPublicRef.current = files;
    localStorage.setItem(PUBLIC_OWNED_KEY, JSON.stringify(files));
    setOwnedPublicFiles(files);
  }

  async function copyPublicLink(item: PublicFile) {
    try {
      await navigator.clipboard.writeText(buildShareViewUrl(item.code));
      setCopiedPublicCode(item.code);
      window.setTimeout(() => setCopiedPublicCode(current => current === item.code ? "" : current), 1800);
    } catch { setPublicStatus("Không thể sao chép liên kết. Hãy kiểm tra quyền clipboard của trình duyệt."); }
  }

  async function removePublicFile(item: PublicFile) {
    const owner = ownedPublicRef.current[item.code];
    if (!owner || removingCode) return;
    setRemovingCode(item.code); setPublicStatus("");
    try {
      await apiClient.request(`/api/quick-share/public/${item.code}`, { method: "DELETE", headers: { "x-quick-share-token": owner.token } });
      const next = { ...ownedPublicRef.current }; delete next[item.code]; saveOwnedPublicFiles(next);
      setPublicFiles(current => current.filter(file => file.code !== item.code));
      setPublicStatus(`Đã gỡ ${item.name} khỏi danh sách chia sẻ.`);
      if (viewingCode === item.code) closeFileViewer();
    } catch (error) { setPublicStatus(error instanceof Error ? error.message : "Không thể gỡ file."); }
    finally { setRemovingCode(""); }
  }

  function applyPrivateFile(chosen: File | null) {
    setFile(chosen); setStatus(""); setChecksum(""); setProgress(null); setCode("");
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    applyPrivateFile(event.target.files?.[0] || null);
  }

  function dropPrivateFile(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    privateDragDepthRef.current = 0;
    setPrivateDragging(false);
    if (busy) return;
    const dropped = event.dataTransfer.files?.[0] || null;
    if (dropped) applyPrivateFile(dropped);
  }

  async function upload(session: UploadSession, startOffset: number) {
    if (!file) return;
    setBusy(true); setProgress(Math.round(startOffset / file.size * 100));
    try {
      for (let offset = startOffset; offset < file.size;) {
        const chunk = await file.slice(offset, offset + 8 * 1024 * 1024).arrayBuffer();
        const result = await apiClient.request<{ offset: number }>(`/api/quick-share/${session.code}`, { method: "PUT", headers: { "content-type": "application/octet-stream", "x-upload-offset": String(offset), "x-quick-share-token": session.uploadToken }, body: chunk });
        offset = result.offset; setProgress(Math.round(offset / file.size * 100));
      }
      const completed = await apiClient.request<{ checksum: string }>(`/api/quick-share/${session.code}/complete`, { method: "POST", headers: { "x-quick-share-token": session.uploadToken } });
      localStorage.removeItem(UPLOAD_SESSION_KEY); setResumeSession(null); setCode(session.code); setChecksum(completed.checksum); setStatus("File đã sẵn sàng để nhận.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Không thể gửi file."); setProgress(null); }
    finally { setBusy(false); }
  }

  async function send() {
    if (!file) return;
    setStatus("Đang tạo kênh truyền file...");
    try {
      const initialized = await apiClient.request<{ code: string; uploadToken: string }>("/api/quick-share", { method: "POST", body: { name: file.name, size: file.size } });
      const session = { code: initialized.code, uploadToken: initialized.uploadToken, name: file.name, size: file.size };
      localStorage.setItem(UPLOAD_SESSION_KEY, JSON.stringify(session)); setResumeSession(session); await upload(session, 0);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Không thể tạo kênh truyền file."); }
  }

  async function uploadPublicFiles(files: File[]) {
    if (!files.length || publicBusy) return;
    setPublicBusy(true); setPublicStatus("");
    let uploaded = 0;
    let interrupted = false;
    let activeSession = pendingPublicSession;
    try {
      for (const current of files) {
        let session = activeSession;
        if (session && (session.name !== current.name || session.size !== current.size || session.lastModified !== current.lastModified)) {
          throw new Error(`Có phiên upload dở của ${session.name}. Chọn lại đúng file để tiếp tục hoặc hủy phiên dở trước khi gửi file khác.`);
        }
        setSelectedPublicFile(current);
        setPublicProgress(0);
        setPublicStatus(`Đang tải lên ${current.name} (${uploaded + 1}/${files.length})...`);
        let offset = 0;
        let ready = false;
        let expiresAt = 0;
        if (session) {
          interrupted = true;
          const state = await apiClient.request<{ offset: number; ready: boolean; expiresAt: number }>(`/api/quick-share/${session.code}/upload`, { headers: { "x-quick-share-token": session.uploadToken }, cache: "no-store" });
          offset = state.offset; ready = state.ready; expiresAt = state.expiresAt;
          if (offset > current.size || (ready && offset !== current.size)) throw new Error("Dữ liệu phiên upload không hợp lệ.");
          setPublicProgress(Math.round(offset / current.size * 100));
        } else {
          const initialized = await apiClient.request<{ code: string; uploadToken: string; expiresAt: number }>("/api/quick-share", { method: "POST", body: { name: current.name, size: current.size, public: true } });
          session = { ...initialized, name: current.name, size: current.size, lastModified: current.lastModified };
          savePublicSession(session);
        }
        interrupted = true;
        if (!ready) {
          for (; offset < current.size;) {
            const chunk = await current.slice(offset, offset + 8 * 1024 * 1024).arrayBuffer();
            const result = await apiClient.request<{ offset: number }>(`/api/quick-share/${session.code}`, { method: "PUT", headers: { "content-type": "application/octet-stream", "x-upload-offset": String(offset), "x-quick-share-token": session.uploadToken }, body: chunk });
            offset = result.offset;
            setPublicProgress(Math.round(offset / current.size * 100));
          }
          const completed = await apiClient.request<{ expiresAt: number }>(`/api/quick-share/${session.code}/complete`, { method: "POST", headers: { "x-quick-share-token": session.uploadToken } });
          expiresAt = completed.expiresAt;
        }
        saveOwnedPublicFiles({ ...ownedPublicRef.current, [session.code]: { token: session.uploadToken, expiresAt } });
        savePublicSession(null);
        activeSession = null;
        interrupted = false;
        uploaded++;
        await refreshPublicFiles();
      }
      setSelectedPublicFile(null);
      setPublicStatus(`Đã tải lên ${uploaded} file. Mọi người có thể tải trong 60 phút.`);
    } catch (error) {
      setPublicStatus(`${uploaded ? `Đã tải lên ${uploaded}/${files.length} file. ` : ""}${error instanceof Error ? error.message : "Không thể tải file lên."}${interrupted ? " Upload bị gián đoạn; chọn lại đúng file hoặc bấm Tiếp tục để gửi phần còn lại." : ""}`);
    } finally { setPublicBusy(false); if (!interrupted) setPublicProgress(null); }
  }

  function dropPublicFiles(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    publicDragDepthRef.current = 0;
    setDragging(false);
    void uploadPublicFiles(Array.from(event.dataTransfer.files));
  }

  async function discardPublicSession() {
    if (!pendingPublicSession || publicBusy) return;
    setPublicBusy(true);
    try {
      await apiClient.request(`/api/quick-share/public/${pendingPublicSession.code}`, { method: "DELETE", headers: { "x-quick-share-token": pendingPublicSession.uploadToken } });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        setPublicStatus(error instanceof Error ? error.message : "Không thể hủy phiên upload.");
        setPublicBusy(false);
        return;
      }
    }
    savePublicSession(null); setSelectedPublicFile(null); setPublicProgress(null);
    setPublicStatus("Đã hủy phiên upload dở. Bạn có thể gửi file khác.");
    setPublicBusy(false);
  }

  async function resume() {
    if (!file || !resumeSession) return;
    if (file.name !== resumeSession.name || file.size !== resumeSession.size) return setStatus("Chọn đúng file cũ để tiếp tục upload.");
    try {
      setStatus("Đang khôi phục phiên upload...");
      const state = await apiClient.request<{ offset: number; ready: boolean }>(`/api/quick-share/${resumeSession.code}/upload`, { headers: { "x-quick-share-token": resumeSession.uploadToken } });
      if (state.ready) return setStatus("File này đã hoàn tất upload.");
      await upload(resumeSession, state.offset);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Không thể tiếp tục upload."); }
  }

  function normalizeCode(value: string) { setCode(value.replace(/\D/g, "").slice(0, 4)); setReceiveError(""); }
  async function receive() {
    if (code.length !== 4) return setReceiveError("Nhập đủ 4 chữ số để nhận file.");
    setReceiving(true); setReceiveError("");
    try {
      await apiClient.request(`/api/quick-share/${code}/status`, { cache: "no-store" });
      const link = document.createElement("a");
      link.href = `${apiClient.baseUrl}/api/quick-share/${code}`;
      link.download = "";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      setReceiveError(error instanceof ApiError && error.status === 404 ? "Mã không đúng, đã hết hạn hoặc file đã được nhận." : error instanceof Error ? error.message : "Không thể kiểm tra mã. Vui lòng thử lại.");
    } finally { setReceiving(false); }
  }
  async function copyCode() { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }

  const activePublicFiles = publicFiles.filter(item => item.expiresAt > now);
  const currentViewedFile = viewingFile && viewingFile.expiresAt > now ? viewingFile : null;
  const downloadUrl = currentViewedFile ? `${apiClient.baseUrl}/api/quick-share/public/${currentViewedFile.code}` : "";

  return <main className="quick-share-shell"><div className="quick-share-orb is-one" /><div className="quick-share-orb is-two" /><div className="quick-share-wrap">
    <header className="quick-share-hero">
      <div className="quick-share-brand">
        <div className="quick-share-mark"><Send /></div>
        <div>
          <p>NODE SHELL / QUICK SHARE</p>
          <h1>Chia sẻ file <em>nhanh chóng.</em></h1>
          <span>Chọn truyền công khai 60 phút hoặc truyền riêng tư bằng mã 4 chữ số.</span>
        </div>
      </div>
      <div className="quick-share-hero-meta">
        <b><Timer />Công khai 60p · Mã 24h</b>
        <b><ShieldCheck />Tối đa 2 GB</b>
        <InstallShareButton />
      </div>
    </header>

    {viewingCode ? (
      <section className="quick-share-card quick-share-viewer" aria-label="Chi tiết file chia sẻ">
        <div className="quick-share-viewer-top">
          <button type="button" className="quick-share-back-btn" onClick={closeFileViewer}>
            <ArrowLeft />Quay lại danh sách chia sẻ
          </button>
          {currentViewedFile && (
            <span className="quick-share-viewer-badge">
              <Timer />Còn {timeLeft(currentViewedFile.expiresAt, now)}
            </span>
          )}
        </div>

        {viewingLoading ? (
          <div className="quick-share-viewer-state">
            <div className="quick-share-drop-icon"><Upload /></div>
            <strong>Đang tải thông tin file...</strong>
            <span>Vui lòng chờ trong giây lát.</span>
          </div>
        ) : viewingError || !currentViewedFile ? (
          <div className="quick-share-viewer-state is-error" role="alert">
            <div className="quick-share-drop-icon"><FileText /></div>
            <strong>Không tìm thấy file chia sẻ</strong>
            <span>{viewingError || "Liên kết này đã hết hạn hoặc file đã được gỡ bỏ."}</span>
            <button type="button" className="quick-share-primary" onClick={closeFileViewer}>
              <ArrowLeft />Mở trang truyền file
            </button>
          </div>
        ) : (
          <>
            <div className="quick-share-viewer-hero">
              <div className="quick-share-viewer-icon">
                <FileUp />
              </div>
              <div className="quick-share-viewer-meta">
                <p>THÔNG TIN FILE CHIA SẺ · #{currentViewedFile.code}</p>
                <h2 title={currentViewedFile.name}>{currentViewedFile.name}</h2>
                <div className="quick-share-viewer-tags">
                  <span>Dung lượng: <strong>{fileSize(currentViewedFile.size)}</strong></span>
                  <span>Định dạng: <strong>{(fileExt(currentViewedFile.name) || "FILE").replace(".", "").toUpperCase()}</strong></span>
                  <span>Thời gian còn lại: <strong>{timeLeft(currentViewedFile.expiresAt, now)}</strong></span>
                </div>
              </div>
            </div>

            <div className="quick-share-viewer-actions">
              <a href={downloadUrl} download={currentViewedFile.name} className="quick-share-viewer-download">
                <Download />Tải file xuống ({fileSize(currentViewedFile.size)})
              </a>
              <button type="button" className="quick-share-viewer-copy" onClick={() => void copyPublicLink(currentViewedFile)}>
                {copiedPublicCode === currentViewedFile.code ? <Check /> : <Clipboard />}
                {copiedPublicCode === currentViewedFile.code ? "Đã sao chép link" : "Sao chép link trang này"}
              </button>
              {ownedPublicFiles[currentViewedFile.code] && (
                <button
                  type="button"
                  className="quick-share-viewer-remove"
                  disabled={removingCode === currentViewedFile.code}
                  onClick={() => void removePublicFile(currentViewedFile)}
                >
                  <Trash2 />Gỡ file
                </button>
              )}
            </div>

            {currentViewedFile.checksum && (
              <footer className="quick-share-viewer-checksum">
                <span>SHA-256</span>
                <code>{currentViewedFile.checksum}</code>
              </footer>
            )}
          </>
        )}
      </section>
    ) : (
      <>
        <div className="quick-share-tabs" role="tablist" aria-label="Chế độ truyền file">
          <button
            type="button"
            role="tab"
            id="tab-public"
            aria-selected={activeTab === "public"}
            aria-controls="panel-public"
            className={`quick-share-tab ${activeTab === "public" ? "is-active" : ""}`}
            onClick={() => setActiveTab("public")}
          >
            <Globe />
            <div>
              <strong>Truyền nhanh công khai</strong>
              <span>Không cần mã · Lưu 60 phút</span>
            </div>
            <em className="quick-share-tab-badge">{activePublicFiles.length}</em>
          </button>
          <button
            type="button"
            role="tab"
            id="tab-private"
            aria-selected={activeTab === "private"}
            aria-controls="panel-private"
            className={`quick-share-tab ${activeTab === "private" ? "is-active" : ""}`}
            onClick={() => setActiveTab("private")}
          >
            <KeyRound />
            <div>
              <strong>Truyền riêng tư mã 4 số</strong>
              <span>Bảo mật 1-1 · Tự xóa sau khi tải</span>
            </div>
            {(resumeSession || (code && checksum)) && <em className="quick-share-tab-dot" aria-hidden="true" />}
          </button>
        </div>

        <section
          id="panel-public"
          role="tabpanel"
          aria-labelledby="tab-public"
          hidden={activeTab !== "public"}
          className="quick-share-card quick-share-public"
        >
          <div className="quick-share-card-heading">
            <span className="quick-share-step">★</span>
            <div>
              <p>CHIA SẺ KHÔNG CẦN MÃ</p>
              <h2>Kéo thả file vào đây</h2>
            </div>
            <FileUp />
          </div>
          <label
            className={`quick-share-drop ${dragging ? "is-dragging" : ""} ${publicBusy ? "is-uploading" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); publicDragDepthRef.current += 1; setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              event.preventDefault();
              publicDragDepthRef.current = Math.max(0, publicDragDepthRef.current - 1);
              if (publicDragDepthRef.current === 0) setDragging(false);
            }}
            onDrop={dropPublicFiles}
          >
            <input type="file" multiple disabled={publicBusy} onChange={(event) => { void uploadPublicFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
            <div className="quick-share-drop-aura" aria-hidden="true">
              <i className="is-ring-one" />
              <i className="is-ring-two" />
            </div>
            <div className="quick-share-drop-icon">
              {dragging ? <Sparkles /> : <Upload />}
            </div>
            <strong>
              {publicBusy
                ? `Đang tải lên ${selectedPublicFile?.name || "file"}...`
                : dragging
                  ? "Thả tay ngay để bắn file lên trạm!"
                  : "Thả nhiều file vào đây hoặc bấm để chọn"}
            </strong>
            <span>
              {publicBusy && publicProgress !== null
                ? `Đang truyền dữ liệu tốc độ cao · Đã đạt ${publicProgress}%`
                : dragging
                  ? "Hỗ trợ thả nhiều file cùng lúc · Tự động chia sẻ ngay lập tức"
                  : "File hiển thị ngay bên dưới trong 60 phút, ai mở trang này cũng có thể tải xuống."}
            </span>
          </label>
          {publicProgress !== null && <div className="quick-share-progress is-live">
            <div className="quick-share-progress-head">
              <span><i className="quick-share-pulse-dot" />{publicStatus || "Đang tải file lên..."}</span>
              <strong>{publicProgress}%</strong>
            </div>
            <i className="quick-share-progress-track"><b style={{ width: `${publicProgress}%` }} /></i>
          </div>}
          {pendingPublicSession && <div className="quick-share-interrupted"><div><strong>Phiên upload chưa hoàn tất: {pendingPublicSession.name}</strong><span>Chọn lại đúng file trên thiết bị này để tiếp tục từ phần đã tải lên. Phiên chờ còn {timeLeft(pendingPublicSession.expiresAt, now)}.</span></div><div className="quick-share-interrupted-actions"><label><input type="file" disabled={publicBusy} onChange={(event) => { setSelectedPublicFile(event.target.files?.[0] || null); event.target.value = ""; }} />Chọn lại file</label><button type="button" disabled={publicBusy || !selectedPublicFile} onClick={() => { if (selectedPublicFile) void uploadPublicFiles([selectedPublicFile]); }}><RotateCcw />Tiếp tục</button><button type="button" disabled={publicBusy} onClick={() => void discardPublicSession()}>Hủy phiên dở</button></div></div>}
          {publicStatus && <p role="status" className="quick-share-status">{publicStatus}</p>}
          <div className="quick-share-list-heading">
            <div>
              <h2>File đang chia sẻ</h2>
              <p>Bấm vào tên file hoặc sao chép link để mở trang thông tin & tải file</p>
            </div>
            <span className="quick-share-count-pill">{activePublicFiles.length} file</span>
          </div>
          <div className="quick-share-files">
            {activePublicFiles.map(item => <div className="quick-share-file" key={item.code}>
              <div className="quick-share-file-icon"><FileUp /></div>
              <div className="quick-share-file-info">
                <button type="button" className="quick-share-file-title-btn" onClick={() => openFileViewer(item.code)} title={`Xem thông tin ${item.name}`}>
                  <strong>{item.name}</strong>
                </button>
                <span>{fileSize(item.size)} · Còn {timeLeft(item.expiresAt, now)}</span>
              </div>
              <div className="quick-share-file-actions">
                <button type="button" onClick={() => void copyPublicLink(item)} aria-label={`Sao chép liên kết ${item.name}`} title="Sao chép liên kết trang tải file">
                  {copiedPublicCode === item.code ? <Check /> : <Clipboard />}
                  {copiedPublicCode === item.code ? "Đã sao chép" : "Sao chép link"}
                </button>
                <a href={`${apiClient.baseUrl}/api/quick-share/public/${item.code}`} aria-label={`Tải ${item.name}`} title={`Tải ${item.name}`}>
                  <Download />Tải xuống
                </a>
                {ownedPublicFiles[item.code] && <button type="button" className="is-remove" disabled={removingCode === item.code} onClick={() => void removePublicFile(item)} aria-label={`Gỡ ${item.name}`} title="Gỡ file ngay">
                  <Trash2 />Gỡ file
                </button>}
              </div>
            </div>)}
            {!activePublicFiles.length && <div className="quick-share-empty-box"><Upload /><p className="quick-share-empty">Chưa có file nào đang chia sẻ. Kéo thả file lên trên để bắt đầu!</p></div>}
          </div>
        </section>

        <div
          id="panel-private"
          role="tabpanel"
          aria-labelledby="tab-private"
          hidden={activeTab !== "private"}
          className="quick-share-private-pane"
        >
          <section className="quick-share-grid">
            <article className="quick-share-card is-send">
              <div className="quick-share-card-heading">
                <span className="quick-share-step">01</span>
                <div>
                  <p>GỬI FILE RIÊNG TƯ</p>
                  <h2>Tạo mã truyền 4 số</h2>
                </div>
                <FileUp />
              </div>
              <label
                className={`quick-share-drop ${file ? "has-file" : ""} ${privateDragging ? "is-dragging" : ""} ${busy ? "is-uploading" : ""}`}
                onDragEnter={(event) => { event.preventDefault(); privateDragDepthRef.current += 1; setPrivateDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  event.preventDefault();
                  privateDragDepthRef.current = Math.max(0, privateDragDepthRef.current - 1);
                  if (privateDragDepthRef.current === 0) setPrivateDragging(false);
                }}
                onDrop={dropPrivateFile}
              >
                <input type="file" onChange={selectFile} disabled={busy} />
                <div className="quick-share-drop-aura" aria-hidden="true">
                  <i className="is-ring-one" />
                  <i className="is-ring-two" />
                </div>
                <div className="quick-share-drop-icon">
                  {privateDragging ? <Sparkles /> : file && !busy ? <Check /> : <Upload />}
                </div>
                <strong>
                  {privateDragging
                    ? "Thả file vào kênh riêng tư!"
                    : file?.name || "Kéo thả hoặc chọn 1 file để bắt đầu"}
                </strong>
                <span>
                  {busy && progress !== null
                    ? `Đang mã hóa & truyền lên kênh · ${progress}%`
                    : file
                      ? `${fileSize(file.size)} · Sẵn sàng tạo mã 4 số`
                      : "Bấm để duyệt file hoặc kéo thả trực tiếp (tối đa 2 GB)"}
                </span>
              </label>
              {progress !== null && <div className="quick-share-progress is-live">
                <div className="quick-share-progress-head">
                  <span><i className="quick-share-pulse-dot" />{busy ? "Đang truyền an toàn" : "Tiến độ upload"}</span>
                  <strong>{progress}%</strong>
                </div>
                <i className="quick-share-progress-track"><b style={{ width: `${progress}%` }} /></i>
              </div>}
              <button type="button" disabled={!file || busy} onClick={() => void send()} className="quick-share-primary"><Upload />{busy ? "Đang truyền file..." : "Tạo mã gửi file"}</button>
              {resumeSession && <button type="button" disabled={!file || busy} onClick={() => void resume()} className="quick-share-resume"><RotateCcw />Tiếp tục phiên dở <span>{resumeSession.code}</span></button>}
              <small className="quick-share-caption">Upload gián đoạn có thể tiếp tục trên thiết bị này bằng đúng file đã chọn.</small>
              {code && checksum && <section className="quick-share-ready">
                <div>
                  <p>FILE ĐÃ SẴN SÀNG</p>
                  <strong>Mã nhận file 4 số</strong>
                  <span>{status}</span>
                </div>
                <div className="quick-share-code-display">{code.split("").map((digit, index) => <i key={index}>{digit}</i>)}</div>
                <button type="button" onClick={() => void copyCode()}>{copied ? <Check /> : <Clipboard />}{copied ? "Đã sao chép" : "Sao chép mã"}</button>
                <footer><span>SHA-256</span><code>{checksum}</code></footer>
              </section>}
              {status && !(code && checksum) && <p role="status" className="quick-share-status">{status}</p>}
            </article>

            <article className="quick-share-card is-receive">
              <div className="quick-share-card-heading">
                <span className="quick-share-step">02</span>
                <div>
                  <p>NHẬN FILE</p>
                  <h2>Nhập mã 4 chữ số</h2>
                </div>
                <Download />
              </div>
              <div className="quick-share-code-input">
                <label htmlFor="receive-code">MÃ NHẬN FILE</label>
                <div>
                  <KeyRound />
                  <input id="receive-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => normalizeCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void receive(); }} placeholder="0000" aria-invalid={Boolean(receiveError)} aria-describedby={receiveError ? "receive-error" : undefined} />
                </div>
                <span>Nhập 4 chữ số từ người gửi. File sẽ tự động xóa ngay sau lượt tải đầu tiên.</span>
                {receiveError && <p id="receive-error" role="alert" className="quick-share-receive-error">{receiveError}</p>}
              </div>
              <button type="button" disabled={receiving} onClick={() => void receive()} className="quick-share-download"><Download />{receiving ? "Đang kiểm tra mã..." : "Nhận và tải file"}</button>
              <div className="quick-share-rules">
                <p><Timer />Mã nhận file có hiệu lực trong vòng 24 giờ.</p>
                <p><LockKeyhole />Ẩn danh hoàn toàn — không hiển thị trên danh sách công khai.</p>
              </div>
            </article>
          </section>
        </div>
      </>
    )}
  </div></main>;
}
