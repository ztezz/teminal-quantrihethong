import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { createPortal } from "react-dom";
import { ArchiveRestore, Camera, Clipboard, Eye, EyeOff, Link2, Plus, Search, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { ApiError, apiClient } from "@/lib/client/api";
import { decodeQrFile, decodeQrSource } from "@/lib/client/qr-decoder";
import { decryptVaultValue, encryptVaultValue, importVaultKey } from "@/lib/client/vault-crypto";
import { generateTotp, normalizeTotpSecret, parseTotpUri, type TotpConfig } from "@/lib/client/totp";
import type { ConfirmOptions, ToastKind } from "../types";
import { AuthenticatorSharePanel } from "./AuthenticatorSharePanel";
import { AuthenticatorShareManager } from "./AuthenticatorShareManager";

type VaultItem = { id: string; envelope: string; content?: string; version: number; pinned: boolean; deletedAt?: string; createdAt: string };
type Entry = { id: string; title: string; config: TotpConfig; version: number; pinned: boolean; createdAt: string };
type Draft = { id?: string; title: string; config: TotpConfig; version: number; pinned: boolean };
type Code = { step: number; value: string };
type Props = { askConfirm: (options: ConfirmOptions) => Promise<boolean>; notify: (kind: ToastKind, message: string, duration?: number) => number; requestStepUp: () => Promise<boolean> };

const emptyConfig = (): TotpConfig => ({ secret: "", issuer: "", account: "", algorithm: "SHA1", digits: 6, period: 30 });
const emptyDraft = (): Draft => ({ title: "", config: emptyConfig(), version: 0, pinned: false });
const inputClass = "w-full rounded-lg border border-white/10 bg-[#09111d] px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/50";
const cameraErrorMessage = (caught: unknown) => {
  if (caught instanceof Error && ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(caught.name)) return 'Camera bị từ chối. Hãy cho phép quyền Camera cho trang này trong biểu tượng ổ khóa của trình duyệt, rồi tải lại trang.';
  if (caught instanceof Error && caught.name === 'NotFoundError') return 'Không tìm thấy camera trên thiết bị này.';
  if (caught instanceof Error && caught.name === 'NotReadableError') return 'Camera đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại.';
  return caught instanceof Error ? caught.message : 'Không thể mở camera.';
};

export function AuthenticatorWorkspace({ askConfirm, notify, requestStepUp }: Props) {
  const keyRef = useRef<CryptoKey | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [codes, setCodes] = useState<Record<string, Code>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => { savingRef.current = saving; }, [saving]);
  const [error, setError] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [sharing, setSharing] = useState<{ id: string; title: string } | null>(null);
  const [managingShares, setManagingShares] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const editorOpen = Boolean(draft && !showTrash);
  useEffect(() => {
    if (!editorOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => editorRef.current?.querySelector<HTMLElement>('input, select, button')?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) { event.preventDefault(); setDraft(null); }
      if (event.key !== 'Tab' || !editorRef.current) return;
      const focusable = Array.from(editorRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!editorRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener('keydown', onKeyDown); previouslyFocused?.focus(); };
  }, [editorOpen]);
  const request = async <T,>(path: string, options?: Parameters<typeof apiClient.request>[1]): Promise<T> => {
    try { return await apiClient.request<T>(path, options); }
    catch (caught) { if (caught instanceof ApiError && caught.status === 428 && await requestStepUp()) return apiClient.request<T>(path, options); throw caught; }
  };

  const loadEntries = async (key: CryptoKey, trash: boolean) => {
    const result = await request<{ items: VaultItem[] }>(`/api/vault/items?trash=${trash}&content=true`);
    const envelopes = await Promise.all(result.items.map(async item => ({ item, meta: await decryptVaultValue<{ title: string; type: string }>(item.envelope, key, `item:${item.id}:envelope`) })));
    const totpItems = envelopes.filter(({ meta }) => meta.type === "totp");
    const loaded = await Promise.all(totpItems.map(async ({ item, meta }) => {
      const content = await decryptVaultValue<{ totp?: TotpConfig }>(item.content!, key, `item:${item.id}:content`);
      if (!content.totp) throw new Error(`Mục “${meta.title}” thiếu khóa 2FA.`);
      return { id: item.id, title: meta.title, config: content.totp, version: item.version, pinned: item.pinned, createdAt: item.createdAt } satisfies Entry;
    }));
    setEntries(loaded.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.title.localeCompare(b.title)));
  };

  useEffect(() => {
    let cancelled = false;
    const open = async () => {
      setLoading(true); setError(null);
      try {
        const result = await request<{ key: string }>("/api/vault/config");
        const key = await importVaultKey(result.key);
        if (cancelled) return;
        keyRef.current = key;
        await loadEntries(key, showTrash);
      } catch (caught) { if (!cancelled) setError(caught instanceof Error ? caught.message : "Không thể mở ví 2FA."); }
      finally { if (!cancelled) setLoading(false); }
    };
    void open();
    return () => { cancelled = true; keyRef.current = null; };
  }, [showTrash]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const stepsKey = entries.map(entry => `${entry.id}:${Math.floor(now / 1000 / entry.config.period)}`).join("|");
  useEffect(() => {
    if (showTrash) return;
    let cancelled = false;
    void Promise.all(entries.map(async entry => {
      try { return [entry.id, { step: Math.floor(Date.now() / 1000 / entry.config.period), value: await generateTotp(entry.config) }] as const; }
      catch { return [entry.id, { step: -1, value: "" }] as const; }
    })).then(values => { if (!cancelled) setCodes(Object.fromEntries(values)); });
    return () => { cancelled = true; };
  }, [entries, stepsKey, showTrash]);

  const applyUri = useCallback((value: string) => {
    try {
      const config = parseTotpUri(value);
      setDraft(previous => ({ ...(previous || emptyDraft()), title: previous?.title || config.issuer || config.account, config }));
      setError(null); setCameraOpen(false); setShowTrash(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "QR không chứa liên kết otpauth hợp lệ."); }
  }, []);

  const importImage = async (file: File) => {
    try {
      setError(null);
      const value = await decodeQrFile(file);
      if (!value) throw new Error("Không tìm thấy mã QR trong ảnh.");
      applyUri(value);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không thể đọc ảnh QR."); }
  };

  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let timer: number | null = null;
    let scanning = false;
    const start = async () => {
      try {
        if (!window.isSecureContext) throw new Error('Camera chỉ hoạt động trên HTTPS hoặc localhost.');
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Trình duyệt không hỗ trợ camera hoặc camera đang bị chặn.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
        const activeVideo = videoRef.current;
        if (!activeVideo) { stream.getTracks().forEach(track => track.stop()); return; }
        video = activeVideo; activeVideo.srcObject = stream;
        await activeVideo.play();
        timer = window.setInterval(async () => {
          if (scanning || activeVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
          scanning = true;
          try {
            const value = await decodeQrSource(activeVideo, activeVideo.videoWidth, activeVideo.videoHeight, 960);
            if (value && !cancelled) applyUri(value);
          } catch (caught) { if (!cancelled) { setError(caught instanceof Error ? caught.message : "Không thể quét QR."); setCameraOpen(false); } }
          finally { scanning = false; }
        }, 300);
      } catch (caught) { if (!cancelled) { setError(cameraErrorMessage(caught)); setCameraOpen(false); } }
    };
    void start();
    return () => { cancelled = true; if (timer !== null) window.clearInterval(timer); stream?.getTracks().forEach(track => track.stop()); if (video) video.srcObject = null; };
  }, [cameraOpen, applyUri]);

  const save = async () => {
    if (!draft || !keyRef.current || saving) return;
    setSaving(true); setError(null);
    try {
      const title = draft.title.trim();
      const config = { ...draft.config, secret: normalizeTotpSecret(draft.config.secret), issuer: draft.config.issuer.trim(), account: draft.config.account.trim() };
      if (!title || !config.account) throw new Error("Nhập tên dịch vụ và tài khoản.");
      await generateTotp(config);
      const id = draft.id || crypto.randomUUID();
      const envelope = await encryptVaultValue({ title, type: "totp", tags: [], folder: "" }, keyRef.current, `item:${id}:envelope`);
      const content = await encryptVaultValue({ body: "", totp: config }, keyRef.current, `item:${id}:content`);
      await request(draft.id ? `/api/vault/items/${id}` : "/api/vault/items", { method: draft.id ? "PUT" : "POST", body: { clientId: draft.id ? undefined : id, version: draft.id ? draft.version : undefined, envelope, content, pinned: draft.pinned } });
      setDraft(null); setShowSecret(false); notify("success", "Đã lưu mã 2FA vào ví.");
      await loadEntries(keyRef.current, false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không thể lưu mã 2FA."); }
    finally { setSaving(false); }
  };

  const moveToTrash = async (entry: Entry) => {
    if (!await askConfirm({ title: "Xóa mã 2FA", message: `Chuyển mã của “${entry.title}” vào thùng rác?`, danger: true, confirmLabel: "Chuyển vào thùng rác" })) return;
    try { await request(`/api/vault/items/${entry.id}`, { method: "DELETE" }); setEntries(previous => previous.filter(item => item.id !== entry.id)); if (draft?.id === entry.id) setDraft(null); notify("success", "Đã chuyển mã 2FA vào thùng rác."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Không thể xóa mã 2FA."); }
  };
  const restore = async (entry: Entry) => {
    try { await request(`/api/vault/items/${entry.id}/restore`, { method: "POST" }); setEntries(previous => previous.filter(item => item.id !== entry.id)); notify("success", "Đã khôi phục mã 2FA."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Không thể khôi phục."); }
  };
  const purge = async (entry: Entry) => {
    if (!await askConfirm({ title: "Xóa vĩnh viễn", message: `Xóa vĩnh viễn mã 2FA của “${entry.title}”?`, danger: true, requiredText: "XOA", confirmLabel: "Xóa vĩnh viễn" })) return;
    try { await request(`/api/vault/items/${entry.id}/purge`, { method: "DELETE" }); setEntries(previous => previous.filter(item => item.id !== entry.id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Không thể xóa vĩnh viễn."); }
  };
  const copyCode = async (value: string) => { try { await navigator.clipboard.writeText(value); notify("success", "Đã sao chép mã 2FA."); } catch { setError("Không thể sao chép mã. Hãy kiểm tra quyền clipboard."); } };
  const editEntry = (entry: Entry) => {
    setDraft({ id: entry.id, title: entry.title, config: { ...entry.config }, version: entry.version, pinned: entry.pinned });
    setSharing(null);
    setShowSecret(false);
    setError(null);
  };

  const visible = entries.filter(entry => `${entry.title} ${entry.config.issuer} ${entry.config.account}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="workspace-screen h-full w-full overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-6xl space-y-4">
    <header className="workspace-heading flex flex-wrap items-end gap-3"><div className="mr-auto"><p className="app-kicker">Authenticator vault</p><h2 className="mt-1 text-xl font-bold uppercase tracking-wider text-white">Ví 2FA</h2><p className="mt-1 text-xs text-slate-500">Quản lý nhiều tài khoản và lấy mã xác thực ngay trong trình duyệt.</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/5 px-3 py-1 text-xs text-emerald-300">{entries.length} mã {showTrash ? "trong thùng rác" : "đang lưu"}</span></header>
    <div className="app-panel flex flex-wrap gap-2 p-3"><button type="button" onClick={() => { setDraft(emptyDraft()); setShowTrash(false); setShowSecret(false); }} className="rounded-lg bg-emerald-400 px-3 py-2 text-xs font-bold text-slate-950"><Plus className="mr-1 inline h-4 w-4" />Thêm mã</button><button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200"><Upload className="mr-1 inline h-4 w-4" />Nhập QR từ ảnh</button><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void importImage(file); event.target.value = ""; }} /><button type="button" onClick={() => setCameraOpen(value => !value)} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200"><Camera className="mr-1 inline h-4 w-4" />{cameraOpen ? "Đóng camera" : "Quét QR bằng camera"}</button><button type="button" onClick={() => { setManagingShares(value => !value); setSharing(null); setShowTrash(false); }} className="ml-auto rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300"><Link2 className="mr-1 inline h-4 w-4" />{managingShares ? "Đóng quản lý link" : "Quản lý link"}</button><button type="button" onClick={() => { setShowTrash(value => !value); setDraft(null); setCameraOpen(false); setManagingShares(false); }} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300"><Trash2 className="mr-1 inline h-4 w-4" />{showTrash ? "Mã đang lưu" : "Thùng rác"}</button></div>
    {cameraOpen && <div className="app-panel overflow-hidden"><video ref={videoRef} autoPlay muted playsInline aria-label="Camera quét QR" className="max-h-96 w-full bg-black object-contain" /><p className="p-3 text-center text-xs text-slate-400">Đưa QR thiết lập 2FA vào khung hình. Camera tắt sau khi quét hoặc đóng.</p></div>}
    {error && <div role="alert" className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-300">{error}</div>}
    {managingShares && !showTrash && <AuthenticatorShareManager entries={entries.map(entry => ({ id: entry.id, title: entry.title, account: entry.config.account }))} onClose={() => setManagingShares(false)} request={request} />}
    {sharing && !showTrash && <AuthenticatorSharePanel key={sharing.id} item={sharing} onClose={() => setSharing(null)} request={request} askConfirm={askConfirm} notify={notify} />}
    {draft && !showTrash && createPortal(<div className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setDraft(null); }}><section ref={editorRef} role="dialog" aria-modal="true" aria-labelledby="authenticator-editor-title" className="app-panel max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl p-4 shadow-2xl sm:p-6"><div className="flex items-center justify-between"><h3 id="authenticator-editor-title" className="text-sm font-bold text-white">{draft.id ? "Sửa mã 2FA" : "Thêm mã 2FA"}</h3><button type="button" onClick={() => setDraft(null)} disabled={saving} aria-label="Đóng biểu mẫu" className="text-slate-400"><X className="h-4 w-4" /></button></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Tên dịch vụ"><input className={inputClass} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Ví dụ: GitHub" /></Field><Field label="Tài khoản"><input className={inputClass} value={draft.config.account} onChange={event => setDraft({ ...draft, config: { ...draft.config, account: event.target.value } })} placeholder="email@example.com" /></Field><Field label="Tổ chức phát hành"><input className={inputClass} value={draft.config.issuer} onChange={event => setDraft({ ...draft, config: { ...draft.config, issuer: event.target.value } })} placeholder="Tên hiển thị trong QR" /></Field><Field label="Liên kết otpauth"><input className={inputClass} placeholder="Dán otpauth://totp/... rồi nhấn Enter" autoComplete="off" onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); applyUri(event.currentTarget.value); event.currentTarget.value = ""; } }} /></Field><Field label="Khóa bí mật Base32"><div className="flex"><input className={inputClass} type={showSecret ? "text" : "password"} value={draft.config.secret} onChange={event => setDraft({ ...draft, config: { ...draft.config, secret: event.target.value } })} autoComplete="off" spellCheck={false} placeholder="Khóa từ dịch vụ" /><button type="button" onClick={() => setShowSecret(value => !value)} aria-label={showSecret ? "Ẩn khóa" : "Hiện khóa"} className="ml-1 rounded-lg border border-white/10 px-3 text-slate-400">{showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></Field><div className="grid grid-cols-3 gap-2"><Field label="Thuật toán"><select className={inputClass} value={draft.config.algorithm} onChange={event => setDraft({ ...draft, config: { ...draft.config, algorithm: event.target.value as TotpConfig["algorithm"] } })}><option>SHA1</option><option>SHA256</option><option>SHA512</option></select></Field><Field label="Chữ số"><select className={inputClass} value={draft.config.digits} onChange={event => setDraft({ ...draft, config: { ...draft.config, digits: Number(event.target.value) as 6 | 8 } })}><option value={6}>6</option><option value={8}>8</option></select></Field><Field label="Chu kỳ"><input className={inputClass} type="number" min={15} max={120} value={draft.config.period} onChange={event => setDraft({ ...draft, config: { ...draft.config, period: Number(event.target.value) } })} /></Field></div></div>{error && <p role="alert" className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-300">{error}</p>}<div className="flex justify-end gap-2"><button type="button" onClick={() => setDraft(null)} disabled={saving} className="rounded-lg border border-white/10 px-4 py-2 text-xs disabled:opacity-40">Hủy</button><button type="button" onClick={() => void save()} disabled={saving || !draft.title.trim() || !draft.config.secret.trim()} className="rounded-lg bg-emerald-400 px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-40">{saving ? "Đang lưu..." : "Lưu vào ví"}</button></div></section></div>, document.body)}
    <div className="app-panel p-3"><label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3"><Search className="h-4 w-4 text-slate-500" /><input className="w-full bg-transparent py-2.5 text-xs outline-none" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm dịch vụ hoặc tài khoản..." /></label></div>
    {loading ? <div className="app-panel p-10 text-center text-sm text-slate-400">Đang mở ví 2FA...</div> : visible.length === 0 ? <div className="app-panel p-10 text-center"><ShieldCheck className="mx-auto h-8 w-8 text-emerald-400" /><p className="mt-3 text-sm text-slate-400">{showTrash ? "Thùng rác trống." : query ? "Không tìm thấy mã phù hợp." : "Chưa có mã 2FA. Hãy thêm tài khoản đầu tiên."}</p></div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map(entry => { const step = Math.floor(now / 1000 / entry.config.period); const value = codes[entry.id]?.step === step ? codes[entry.id].value : ""; const remaining = entry.config.period - Math.floor(now / 1000) % entry.config.period; return <article key={entry.id} className="app-panel min-w-0 space-y-3 p-4"><div className="flex items-start gap-3"><div className="rounded-lg bg-emerald-400/10 p-2 text-emerald-300"><ShieldCheck className="h-5 w-5" /></div><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-bold text-white">{entry.title}</h3><p className="truncate text-xs text-slate-500">{entry.config.account}</p></div></div>{!showTrash && <><div className="flex items-center justify-between rounded-lg bg-black/30 p-3"><div><p className="font-mono text-2xl font-bold tracking-[0.14em] text-emerald-300">{value || "••••••"}</p><p className="mt-1 text-[10px] text-slate-500">Đổi sau {remaining} giây</p></div><button type="button" disabled={!value} onClick={() => void copyCode(value)} aria-label={`Sao chép mã ${entry.title}`} className="rounded-lg border border-white/10 p-2 text-slate-300 disabled:opacity-40"><Clipboard className="h-4 w-4" /></button></div><div className="h-1 overflow-hidden rounded bg-white/5"><div className="h-full bg-emerald-400" style={{ width: `${remaining / entry.config.period * 100}%` }} /></div></>}<div className="flex justify-end gap-3 text-xs">{showTrash ? <><button type="button" onClick={() => void restore(entry)} className="text-emerald-300"><ArchiveRestore className="mr-1 inline h-3.5 w-3.5" />Khôi phục</button><button type="button" onClick={() => void purge(entry)} className="text-rose-300">Xóa vĩnh viễn</button></> : <><button type="button" onClick={() => { setSharing({ id: entry.id, title: entry.title }); setManagingShares(false); }} className="text-emerald-300">Chia sẻ</button><button type="button" onClick={() => editEntry(entry)} className="text-sky-300">Sửa</button><button type="button" onClick={() => void moveToTrash(entry)} className="text-rose-300">Xóa</button></>}</div></article>; })}</div>}
    <p className="text-xs text-slate-600">Khóa 2FA được mã hóa trong két theo tài khoản. Giữ bản sao dự phòng của khóa hoặc mã khôi phục từ từng dịch vụ.</p>
  </div></motion.div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block min-w-0 text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}<div className="mt-2">{children}</div></label>; }
