import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Eye, EyeOff, FileKey2, LoaderCircle, Pin, Plus, RefreshCw, Save, Search, ShieldCheck, Trash2 } from "lucide-react";
import { apiClient } from "@/lib/client/api";
import type { ConfirmOptions, ToastKind } from "../types";

interface SecureNote { id: string; title: string; content: string; pinned: boolean; createdAt: string; updatedAt: string }

interface NotesWorkspaceProps {
  active: boolean;
  askConfirm: (options: ConfirmOptions) => Promise<boolean>;
  notify: (kind: ToastKind, message: string, duration?: number) => number;
}

export function NotesWorkspace({ active, askConfirm, notify }: NotesWorkspaceProps) {
  const [notes, setNotes] = useState<SecureNote[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [query, setQuery] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = notes.find(note => note.id === selectedId) ?? null;
  const filtered = notes.filter(note => `${note.title} ${note.content}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  const selectNote = (note: SecureNote | null) => {
    setSelectedId(note?.id ?? null); setTitle(note?.title ?? ""); setContent(note?.content ?? ""); setPinned(note?.pinned ?? false); setRevealed(false); setError(null);
  };
  const loadNotes = async () => {
    setLoading(true); setError(null);
    try {
      const result = await apiClient.request<{ notes: SecureNote[] }>("/api/notes");
      setNotes(result.notes);
      const current = result.notes.find(note => note.id === selectedId) ?? result.notes[0] ?? null;
      selectNote(current);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không thể tải ghi chú"); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void loadNotes(), 0);
    return () => window.clearTimeout(timer);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!title.trim()) return setError("Hãy nhập tiêu đề ghi chú.");
    setSaving(true); setError(null);
    try {
      const result = await apiClient.request<{ note: SecureNote }>(selectedId ? `/api/notes/${selectedId}` : "/api/notes", { method: selectedId ? "PUT" : "POST", body: { title, content, pinned } });
      setNotes(previous => [result.note, ...previous.filter(note => note.id !== result.note.id)].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)));
      selectNote(result.note); notify("success", selectedId ? "Đã cập nhật ghi chú." : "Đã tạo ghi chú mã hóa.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không thể lưu ghi chú"); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!selected || !await askConfirm({ title: "Xóa ghi chú", message: `Xóa vĩnh viễn “${selected.title}”? Không thể khôi phục nội dung đã mã hóa.`, danger: true, confirmLabel: "Xóa ghi chú" })) return;
    try {
      await apiClient.request(`/api/notes/${selected.id}`, { method: "DELETE" });
      const remaining = notes.filter(note => note.id !== selected.id); setNotes(remaining); selectNote(remaining[0] ?? null); notify("success", "Đã xóa ghi chú.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Không thể xóa ghi chú"); }
  };

  return <motion.div key="notes-tab" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="workspace-screen h-full w-full overflow-y-auto p-4 sm:p-6">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="workspace-heading flex flex-col gap-3 sm:flex-row sm:items-end"><div className="mr-auto"><p className="app-kicker">Encrypted personal vault</p><h2 className="mt-1 text-xl font-bold uppercase tracking-wider text-white">Sổ Ghi Chú</h2><p className="mt-1 font-mono text-xs text-slate-500">Ghi chú riêng theo tài khoản, mã hóa AES-256-GCM trên máy chủ</p></div><div className="flex gap-2"><button type="button" onClick={() => selectNote(null)} className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-amber-300"><Plus className="mr-1.5 inline h-4 w-4" />Ghi chú mới</button><button type="button" onClick={() => void loadNotes()} disabled={loading} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300"><RefreshCw className={`mr-1.5 inline h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Làm mới</button></div></header>
      <div className="flex items-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/5 px-4 py-3 text-xs text-emerald-300"><ShieldCheck className="h-4 w-4 shrink-0" /><span>Nội dung được mã hóa trước khi lưu SQLite. Không đưa mật khẩu hoặc nội dung vào tiêu đề nếu không cần thiết.</span></div>
      {error && <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-300">{error}</div>}
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="app-panel h-fit overflow-hidden lg:sticky lg:top-0"><div className="border-b border-white/8 p-3"><label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3"><Search className="h-4 w-4 text-slate-600" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm trong ghi chú..." className="w-full bg-transparent py-2.5 text-xs text-white outline-none" /></label></div><div className="max-h-[65vh] divide-y divide-white/5 overflow-auto">{filtered.map(note => <button type="button" key={note.id} onClick={() => selectNote(note)} className={`block w-full p-4 text-left transition hover:bg-white/[0.025] ${selectedId === note.id ? "bg-amber-400/7 shadow-[inset_3px_0_0_#fbbf24]" : ""}`}><div className="flex items-start gap-2"><FileKey2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{note.title}</p><p className="mt-1 text-[11px] text-slate-600">Nội dung được che</p><time className="mt-2 block font-mono text-[9px] text-slate-700">{new Date(note.updatedAt).toLocaleString("vi-VN")}</time></div>{note.pinned && <Pin className="h-3.5 w-3.5 fill-amber-300 text-amber-300" />}</div></button>)}{!filtered.length && <div className="p-10 text-center text-xs text-slate-600"><FileKey2 className="mx-auto mb-3 h-8 w-8 text-slate-700" />{loading ? "Đang tải..." : "Chưa có ghi chú phù hợp."}</div>}</div></aside>
        <section className="app-panel overflow-hidden"><div className="flex flex-wrap items-center gap-2 border-b border-white/8 p-4"><div className="mr-auto"><p className="app-kicker">{selected ? "Chỉnh sửa ghi chú" : "Ghi chú mới"}</p><p className="mt-1 font-mono text-[9px] text-slate-600">{selected ? `Cập nhật ${new Date(selected.updatedAt).toLocaleString("vi-VN")}` : "Chưa lưu trên máy chủ"}</p></div><button type="button" onClick={() => setPinned(value => !value)} className={`rounded-lg border px-3 py-2 text-xs ${pinned ? "border-amber-300/30 bg-amber-300/10 text-amber-300" : "border-white/10 text-slate-400"}`}><Pin className={`mr-1 inline h-3.5 w-3.5 ${pinned ? "fill-current" : ""}`} />{pinned ? "Đã ghim" : "Ghim"}</button>{selected && <button type="button" onClick={() => void remove()} className="rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-xs text-rose-300"><Trash2 className="mr-1 inline h-3.5 w-3.5" />Xóa</button>}<button type="button" onClick={() => void save()} disabled={saving || !title.trim()} className="rounded-lg bg-sky-400 px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-40">{saving ? <LoaderCircle className="mr-1 inline h-4 w-4 animate-spin" /> : <Save className="mr-1 inline h-4 w-4" />}Lưu</button></div>
          <div className="space-y-4 p-4 sm:p-6"><label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Tiêu đề<input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} placeholder="Ví dụ: Tài khoản máy chủ staging" className="mt-2 w-full rounded-xl border border-white/10 bg-[#09111d] px-4 py-3 text-sm text-white outline-none focus:border-sky-400/40" /></label><div><div className="mb-2 flex items-center justify-between"><label htmlFor="secure-note-content" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Nội dung</label><button type="button" onClick={() => setRevealed(value => !value)} className="text-[10px] text-slate-400 hover:text-white">{revealed ? <EyeOff className="mr-1 inline h-3.5 w-3.5" /> : <Eye className="mr-1 inline h-3.5 w-3.5" />}{revealed ? "Che nội dung" : "Hiện nội dung"}</button></div><div className="relative"><textarea id="secure-note-content" value={content} maxLength={100000} autoComplete="off" spellCheck={false} onChange={event => setContent(event.target.value)} placeholder="Mật khẩu, lệnh cần nhớ, checklist hoặc thông tin quan trọng..." className={`min-h-[430px] w-full resize-y rounded-xl border border-white/10 bg-[#07101a] p-4 font-mono text-sm leading-6 text-slate-200 outline-none focus:border-sky-400/40 ${revealed ? "" : "blur-sm select-none"}`} /><button type="button" onClick={() => setRevealed(true)} className={`absolute inset-0 flex items-center justify-center rounded-xl bg-[#07101a]/60 text-xs font-semibold text-slate-300 backdrop-blur-sm ${revealed ? "hidden" : ""}`}><Eye className="mr-2 h-4 w-4" />Bấm để hiện nội dung nhạy cảm</button></div><p className="mt-2 text-right font-mono text-[9px] text-slate-700">{content.length.toLocaleString("vi-VN")} / 100.000 ký tự</p></div></div>
        </section>
      </div>
    </div>
  </motion.div>;
}
