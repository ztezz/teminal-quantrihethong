"use client";

import { useEffect, useState } from "react";
import { Check, FilePlus2, LockKeyhole, Search, Trash2 } from "lucide-react";
import { apiClient } from "@/lib/client/api";
import type { Note } from "../types";

type NotesResponse = { success: true; notes: Note[] };

export function NotesWorkspace({ notify }: { notify: (kind: "success" | "error" | "info", message: string) => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selected = notes.find((note) => note.id === selectedId);
  const visibleNotes = notes.filter((note) => `${note.title} ${note.content}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  const openNote = (note: Note) => { setSelectedId(note.id); setTitle(note.title); setContent(note.content); };
  const newNote = () => { setSelectedId(null); setTitle(""); setContent(""); };

  useEffect(() => {
    apiClient.request<NotesResponse>("/api/notes")
      .then(({ notes }) => { setNotes(notes); if (notes[0]) openNote(notes[0]); })
      .catch((error: Error) => notify("error", error.message))
      .finally(() => setLoading(false));
  // Initial load only; notify is recreated by the dashboard.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!title.trim() && !content.trim()) return notify("info", "Nhập tiêu đề hoặc nội dung trước khi lưu.");
    setSaving(true);
    try {
      const response = await apiClient.request<{ success: true; note: Note }>("/api/notes" + (selectedId ? `/${selectedId}` : ""), { method: selectedId ? "PUT" : "POST", body: { title, content } });
      setNotes((items) => [response.note, ...items.filter((item) => item.id !== response.note.id)]);
      openNote(response.note);
      notify("success", "Đã lưu ghi chú mã hóa.");
    } catch (error) { notify("error", error instanceof Error ? error.message : "Không thể lưu ghi chú."); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!selectedId || !selected || !window.confirm(`Xóa ghi chú “${selected.title || "Không tiêu đề"}”?`)) return;
    try {
      await apiClient.request(`/api/notes/${selectedId}`, { method: "DELETE" });
      const next = notes.filter((note) => note.id !== selectedId);
      setNotes(next);
      if (next[0]) openNote(next[0]);
      else newNote();
      notify("success", "Đã xóa ghi chú.");
    } catch (error) { notify("error", error instanceof Error ? error.message : "Không thể xóa ghi chú."); }
  }

  return <div className="workspace-screen h-full w-full overflow-hidden p-3 sm:p-6"><div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/45 shadow-2xl shadow-black/20">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-6"><div><div className="flex items-center gap-2 text-emerald-300"><LockKeyhole className="h-4 w-4" /><span className="app-kicker">Private vault</span></div><h2 className="mt-2 text-xl font-semibold text-white">Sổ ghi chú</h2><p className="mt-1 text-xs text-slate-500">Nội dung được mã hóa AES-256-GCM và chỉ hiển thị cho tài khoản của bạn.</p></div><button type="button" onClick={newNote} className="inline-flex items-center gap-2 rounded-lg border border-sky-400/25 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-200 transition hover:bg-sky-400/20"><FilePlus2 className="h-4 w-4" />Ghi chú mới</button></header>
    <div className="grid min-h-0 flex-1 md:grid-cols-[280px_1fr]"><aside className="min-h-0 border-b border-white/10 md:border-r md:border-b-0"><label className="relative m-3 block"><Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm ghi chú" className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-400/50" /></label><div className="max-h-44 overflow-y-auto px-2 pb-2 md:max-h-none md:h-[calc(100%-58px)]">{loading ? <p className="p-3 text-xs text-slate-500">Đang tải...</p> : visibleNotes.map((note) => <button type="button" key={note.id} onClick={() => openNote(note)} className={`mb-1 w-full rounded-lg px-3 py-2.5 text-left transition ${note.id === selectedId ? "bg-sky-400/10 text-white" : "text-slate-400 hover:bg-white/5"}`}><p className="truncate text-xs font-semibold">{note.title || "Không tiêu đề"}</p><p className="mt-1 truncate text-[10px] text-slate-600">{note.content || "Ghi chú trống"}</p><time className="mt-2 block text-[9px] text-slate-600">{new Date(note.updatedAt).toLocaleString("vi-VN")}</time></button>)}</div></aside>
      <section className="flex min-h-0 flex-col p-4 sm:p-6"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Tiêu đề" maxLength={160} className="border-0 border-b border-white/10 bg-transparent pb-3 text-lg font-semibold text-white outline-none placeholder:text-slate-600 focus:border-sky-400/50" /><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Viết điều cần nhớ, thông tin đăng nhập, mã khôi phục..." maxLength={20000} className="mt-4 min-h-48 flex-1 resize-none bg-transparent font-mono text-sm leading-6 text-slate-300 outline-none placeholder:text-slate-700" /><footer className="mt-4 flex items-center justify-between border-t border-white/10 pt-4"><span className="text-[10px] text-slate-600">{content.length.toLocaleString("vi-VN")} / 20.000 ký tự</span><div className="flex gap-2">{selectedId && <button type="button" onClick={() => void remove()} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" />Xóa</button>}<button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-300 disabled:opacity-60"><Check className="h-4 w-4" />{saving ? "Đang lưu" : "Lưu ghi chú"}</button></div></footer></section>
    </div>
  </div></div>;
}
