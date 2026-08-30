"use client";

import { ChangeEvent, useState } from "react";
import { Download, FileUp, KeyRound, LockKeyhole, Send, Timer, Upload } from "lucide-react";
import { apiClient } from "@/lib/client/api";

export default function QuickSharePage() {
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] || null;
    setFile(selected); setStatus(""); setProgress(null); setCode("");
  }

  async function send() {
    if (!file) return;
    setBusy(true); setProgress(0); setStatus("Đang tạo kênh truyền file...");
    try {
      const initialized = await apiClient.request<{ success: true; code: string; chunkSize: number; expiresAt: number }>("/api/quick-share", { method: "POST", body: { name: file.name, size: file.size } });
      for (let offset = 0; offset < file.size;) {
        const chunk = await file.slice(offset, offset + initialized.chunkSize).arrayBuffer();
        const result = await apiClient.request<{ success: true; offset: number }>(`/api/quick-share/${initialized.code}`, { method: "PUT", headers: { "content-type": "application/octet-stream", "x-upload-offset": String(offset) }, body: chunk });
        offset = result.offset; setProgress(Math.round(offset / file.size * 100));
      }
      await apiClient.request(`/api/quick-share/${initialized.code}/complete`, { method: "POST" });
      setCode(initialized.code); setStatus("File đã sẵn sàng. Gửi mã này cho người nhận.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Không thể gửi file."); setProgress(null); }
    finally { setBusy(false); }
  }

  function normalizeCode(value: string) { setCode(value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 12)); }
  function receive() { if (code.length === 12) window.location.assign(`${apiClient.baseUrl}/api/quick-share/${code}`); else setStatus("Nhập mã truyền file gồm 12 ký tự."); }

  return <main className="min-h-screen bg-[#070b14] px-4 py-8 text-slate-200 sm:px-6 sm:py-14"><div className="mx-auto max-w-4xl">
    <header className="mb-10 text-center"><div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-400/30 bg-sky-400/10 text-sky-300"><Send className="h-5 w-5" /></div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-400">NodeShell Quick Share</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Truyền file không cần đăng nhập</h1><p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500">Gửi file bằng một mã ngắn. File tự hết hạn sau 24 giờ và bị xóa ngay sau lần tải xuống đầu tiên.</p></header>
    <section className="grid gap-5 md:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-black/20 sm:p-7"><div className="flex items-center gap-3"><span className="rounded-lg bg-sky-400/10 p-2 text-sky-300"><FileUp className="h-5 w-5" /></span><div><h2 className="font-semibold text-white">Gửi file</h2><p className="text-xs text-slate-500">Tối đa 2 GB</p></div></div><label className="mt-7 flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/15 px-4 text-center transition hover:border-sky-400/50 hover:bg-sky-400/5"><Upload className="h-5 w-5 text-slate-500" /><span className="mt-3 text-xs font-medium text-slate-300">{file ? file.name : "Chọn file để gửi"}</span><span className="mt-1 text-[10px] text-slate-600">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Không cần tài khoản"}</span><input type="file" onChange={selectFile} className="sr-only" disabled={busy} /></label>{progress !== null && <div className="mt-4"><div className="mb-1 flex justify-between text-[10px] text-slate-500"><span>Đang tải lên</span><span>{progress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-sky-400 transition-all" style={{ width: `${progress}%` }} /></div></div>}<button type="button" disabled={!file || busy} onClick={() => void send()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-sky-400 px-4 py-3 text-xs font-bold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40"><Upload className="h-4 w-4" />{busy ? "Đang truyền..." : "Tạo mã gửi file"}</button></div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-black/20 sm:p-7"><div className="flex items-center gap-3"><span className="rounded-lg bg-emerald-400/10 p-2 text-emerald-300"><Download className="h-5 w-5" /></span><div><h2 className="font-semibold text-white">Nhận file</h2><p className="text-xs text-slate-500">Tải một lần duy nhất</p></div></div><div className="mt-7"><label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Mã truyền file</label><div className="relative mt-2"><KeyRound className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" /><input value={code} onChange={(event) => normalizeCode(event.target.value)} placeholder="VD: A2BC3DE4FGHJ" className="w-full rounded-lg border border-white/10 bg-black/20 py-3 pl-10 pr-3 font-mono text-sm tracking-[0.16em] text-white outline-none placeholder:tracking-normal placeholder:text-slate-700 focus:border-emerald-400/50" /></div></div><button type="button" onClick={receive} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-3 text-xs font-bold text-slate-950 transition hover:bg-emerald-300"><Download className="h-4 w-4" />Nhận và tải file</button><div className="mt-8 space-y-3 border-t border-white/10 pt-5 text-[11px] leading-5 text-slate-500"><p className="flex gap-2"><Timer className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />Mã và file hết hạn sau 24 giờ.</p><p className="flex gap-2"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />Không có thư mục công khai và không thể duyệt file trên máy chủ.</p></div></div></section>
    {status && <p role="status" className={`mx-auto mt-5 max-w-2xl rounded-lg border px-4 py-3 text-center text-xs ${code ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-200" : "border-white/10 bg-white/[0.03] text-slate-400"}`}>{status}{code && <strong className="ml-2 font-mono tracking-[0.16em] text-white">{code}</strong>}</p>}
  </div></main>;
}
