"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { Check, Clipboard, Download, FileUp, KeyRound, LockKeyhole, RotateCcw, Send, ShieldCheck, Timer, Trash2, Upload } from "lucide-react";
import { ApiError, apiClient } from "@/lib/client/api";
import { InstallShareButton } from "./install-share-button";

type UploadSession = { code: string; uploadToken: string; name: string; size: number };
type PublicFile = { code: string; name: string; size: number; createdAt: string; expiresAt: number };
type PublicUploadSession = UploadSession & { lastModified: number; expiresAt: number };
type OwnedPublicFile = { token: string; expiresAt: number };
const UPLOAD_SESSION_KEY = "nodeshell_quick_share_upload";
const PUBLIC_UPLOAD_KEY = "nodeshell_public_share_upload";
const PUBLIC_OWNED_KEY = "nodeshell_public_share_owned";

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 1024 * 1024 * 1024 ? 0 : 1)} ${bytes >= 1024 * 1024 * 1024 ? "GB" : "MB"}`;
}

function timeLeft(expiresAt: number, now: number) {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}p ${String(seconds % 60).padStart(2, "0")}s`;
}

export default function QuickSharePage() {
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
  const [now, setNow] = useState(() => Date.now());

  const refreshPublicFiles = useCallback(async () => {
    try {
      const result = await apiClient.request<{ files: PublicFile[] }>("/api/quick-share/public", { cache: "no-store" });
      setPublicFiles(result.files);
    } catch (error) { setPublicStatus(error instanceof Error ? error.message : "Không thể tải danh sách file."); }
  }, []);

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
      await navigator.clipboard.writeText(`${apiClient.baseUrl || window.location.origin}/api/quick-share/public/${item.code}`);
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
    } catch (error) { setPublicStatus(error instanceof Error ? error.message : "Không thể gỡ file."); }
    finally { setRemovingCode(""); }
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] || null); setStatus(""); setChecksum(""); setProgress(null); setCode("");
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
    event.preventDefault(); setDragging(false);
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

  return <main className="quick-share-shell"><div className="quick-share-orb is-one" /><div className="quick-share-orb is-two" /><div className="quick-share-wrap">
    <header className="quick-share-hero"><div className="quick-share-mark"><Send /></div><div><p>NODE SHELL / QUICK SHARE</p><h1>Chia sẻ file <em>nhanh chóng.</em></h1><span>Kéo thả để chia sẻ công khai hoặc gửi riêng bằng mã 4 số.</span></div><div className="quick-share-hero-meta"><b><Timer />Công khai 60 phút</b><b><ShieldCheck />Tối đa 2 GB</b><InstallShareButton /></div></header>
    <section className="quick-share-card quick-share-public"><div className="quick-share-card-heading"><span className="quick-share-step">★</span><div><p>CHIA SẺ KHÔNG CẦN MÃ</p><h2>Kéo thả file vào đây</h2></div><FileUp /></div>
      <label className={`quick-share-drop ${dragging ? "is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { event.preventDefault(); setDragging(false); }} onDrop={dropPublicFiles}><input type="file" multiple disabled={publicBusy} onChange={(event) => { void uploadPublicFiles(Array.from(event.target.files || [])); event.target.value = ""; }} /><Upload /><strong>{publicBusy ? "Đang tải file lên..." : "Thả file hoặc bấm để chọn file"}</strong><span>File hiển thị bên dưới trong 60 phút, ai mở trang này cũng có thể tải xuống.</span></label>
      {publicProgress !== null && <div className="quick-share-progress"><div><span>{publicStatus}</span><strong>{publicProgress}%</strong></div><i><b style={{ width: `${publicProgress}%` }} /></i></div>}
      {pendingPublicSession && <div className="quick-share-interrupted"><div><strong>Phiên upload chưa hoàn tất: {pendingPublicSession.name}</strong><span>Chọn lại đúng file trên thiết bị này để tiếp tục từ phần đã tải lên. Phiên chờ còn {timeLeft(pendingPublicSession.expiresAt, now)}.</span></div><div className="quick-share-interrupted-actions"><label><input type="file" disabled={publicBusy} onChange={(event) => { setSelectedPublicFile(event.target.files?.[0] || null); event.target.value = ""; }} />Chọn lại file</label><button type="button" disabled={publicBusy || !selectedPublicFile} onClick={() => { if (selectedPublicFile) void uploadPublicFiles([selectedPublicFile]); }}><RotateCcw />Tiếp tục</button><button type="button" disabled={publicBusy} onClick={() => void discardPublicSession()}>Hủy phiên dở</button></div></div>}
      {publicStatus && <p role="status" className="quick-share-status">{publicStatus}</p>}
      <div className="quick-share-list-heading"><h2>File đang chia sẻ</h2><span>{publicFiles.filter(item => item.expiresAt > now).length} file</span></div>
      <div className="quick-share-files">{publicFiles.filter(item => item.expiresAt > now).map(item => <div className="quick-share-file" key={item.code}><FileUp /><div><strong title={item.name}>{item.name}</strong><span>{fileSize(item.size)} · Còn {timeLeft(item.expiresAt, now)}</span></div><div className="quick-share-file-actions"><button type="button" onClick={() => void copyPublicLink(item)} aria-label={`Sao chép liên kết ${item.name}`} title="Sao chép liên kết tải"><Clipboard />{copiedPublicCode === item.code ? "Đã sao chép" : "Sao chép link"}</button><a href={`${apiClient.baseUrl}/api/quick-share/public/${item.code}`} aria-label={`Tải ${item.name}`} title={`Tải ${item.name}`}><Download />Tải xuống</a>{ownedPublicFiles[item.code] && <button type="button" className="is-remove" disabled={removingCode === item.code} onClick={() => void removePublicFile(item)} aria-label={`Gỡ ${item.name}`} title="Gỡ file ngay"><Trash2 />Gỡ file</button>}</div></div>)}{!publicFiles.some(item => item.expiresAt > now) && <p className="quick-share-empty">Chưa có file nào. Kéo thả file để bắt đầu chia sẻ.</p>}</div>
    </section>
    <section className="quick-share-grid">
      <article className="quick-share-card is-send"><div className="quick-share-card-heading"><span className="quick-share-step">01</span><div><p>GỬI FILE</p><h2>Đặt file vào kênh</h2></div><FileUp /></div>
        <label className={`quick-share-drop ${file ? "has-file" : ""}`}><input type="file" onChange={selectFile} disabled={busy} /><Upload /><strong>{file?.name || "Chọn một file để bắt đầu"}</strong><span>{file ? `${fileSize(file.size)} · sẵn sàng truyền` : "Bấm để duyệt file từ thiết bị"}</span></label>
        {progress !== null && <div className="quick-share-progress"><div><span>{busy ? "Đang truyền an toàn" : "Tiến độ upload"}</span><strong>{progress}%</strong></div><i><b style={{ width: `${progress}%` }} /></i></div>}
        <button type="button" disabled={!file || busy} onClick={() => void send()} className="quick-share-primary"><Upload />{busy ? "Đang truyền file..." : "Tạo mã gửi file"}</button>
        {resumeSession && <button type="button" disabled={!file || busy} onClick={() => void resume()} className="quick-share-resume"><RotateCcw />Tiếp tục phiên dở <span>{resumeSession.code}</span></button>}
        <small className="quick-share-caption">Upload gián đoạn có thể tiếp tục trên thiết bị này bằng đúng file đã chọn.</small>
      </article>
      <article className="quick-share-card is-receive"><div className="quick-share-card-heading"><span className="quick-share-step">02</span><div><p>NHẬN FILE</p><h2>Nhập mã bạn nhận được</h2></div><Download /></div>
        <div className="quick-share-code-input"><label htmlFor="receive-code">MÃ NHẬN FILE</label><div><KeyRound /><input id="receive-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => normalizeCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void receive(); }} placeholder="0000" aria-invalid={Boolean(receiveError)} aria-describedby={receiveError ? "receive-error" : undefined} /></div><span>File sẽ bị xóa sau lượt tải đầu tiên.</span>{receiveError && <p id="receive-error" role="alert" className="quick-share-receive-error">{receiveError}</p>}</div>
        <button type="button" disabled={receiving} onClick={() => void receive()} className="quick-share-download"><Download />{receiving ? "Đang kiểm tra mã..." : "Nhận và tải file"}</button>
        <div className="quick-share-rules"><p><Timer />Mã hết hạn sau 24 giờ.</p><p><LockKeyhole />Không thể tìm hoặc duyệt file trên máy chủ.</p></div>
      </article>
    </section>
    {code && checksum && <section className="quick-share-ready"><div><p>FILE ĐÃ SẴN SÀNG</p><strong>Mã nhận file</strong><span>{status}</span></div><div className="quick-share-code-display">{code.split("").map((digit, index) => <i key={index}>{digit}</i>)}</div><button type="button" onClick={() => void copyCode()}>{copied ? <Check /> : <Clipboard />}{copied ? "Đã sao chép" : "Sao chép mã"}</button><footer><span>SHA-256</span><code>{checksum}</code></footer></section>}
    {status && !(code && checksum) && <p role="status" className="quick-share-status">{status}</p>}
  </div></main>;
}
