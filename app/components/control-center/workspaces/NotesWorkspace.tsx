"use client";

import { useEffect, useState } from "react";
import {
  Check,
  FilePlus2,
  FileText,
  FolderOpen,
  LockKeyhole,
  Plus,
  Search,
  Table2,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { apiClient } from "@/lib/client/api";
import type { Note, Notebook } from "../types";

type NotesResponse = { success: true; notes: Note[]; notebooks: Notebook[] };
type NoteTable = NonNullable<Note["table"]>;

const emptyTable = (): NoteTable => ({ columns: ["Mục", "Thông tin"], rows: [["", ""]] });
const noteBookName = (note: Note) => note.notebook || "Sổ cá nhân";

export function NotesWorkspace({ notify }: { notify: (kind: "success" | "error" | "info", message: string) => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [notebook, setNotebook] = useState("");
  const [table, setTable] = useState<NoteTable | undefined>();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [newNotebook, setNewNotebook] = useState("");
  const [query, setQuery] = useState("");
  const [notebookFilter, setNotebookFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selected = notes.find((note) => note.id === selectedId);
  const visibleNotes = notes.filter((note) => noteBookName(note) === notebookFilter && `${note.title} ${note.content} ${note.table?.rows.flat().join(" ") || ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  const openNote = (note: Note) => {
    setSelectedId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setNotebook(noteBookName(note));
    setTable(note.table);
  };

  const newNote = (targetNotebook = notebookFilter) => {
    setSelectedId(null);
    setTitle("");
    setContent("");
    setNotebook(targetNotebook || "Sổ cá nhân");
    setTable(undefined);
  };

  const selectNotebook = (nextNotebook: string) => {
    setNotebookFilter(nextNotebook);
    setQuery("");
    const first = notes.find((note) => noteBookName(note) === nextNotebook);
    if (first) openNote(first);
    else newNote(nextNotebook);
  };

  useEffect(() => {
    apiClient.request<NotesResponse>("/api/notes")
      .then(({ notes: loadedNotes, notebooks: loadedNotebooks }) => {
        setNotes(loadedNotes);
        setNotebooks(loadedNotebooks);
        const firstNotebook = loadedNotebooks[0]?.name || "Sổ cá nhân";
        setNotebookFilter(firstNotebook);
        const first = loadedNotes.find((note) => noteBookName(note) === firstNotebook);
        if (first) openNote(first);
        else newNote(firstNotebook);
      })
      .catch((error: Error) => notify("error", error.message))
      .finally(() => setLoading(false));
    // Initial load only; notify is recreated by the dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!title.trim() && !content.trim() && !table?.columns.length) {
      notify("info", "Nhập tiêu đề, nội dung hoặc tạo bảng trước khi lưu.");
      return;
    }

    setSaving(true);
    try {
      const response = await apiClient.request<{ note: Note }>(`/api/notes${selectedId ? `/${selectedId}` : ""}`, {
        method: selectedId ? "PUT" : "POST",
        body: { title, content, notebook, table },
      });
      setNotes((items) => [response.note, ...items.filter((item) => item.id !== response.note.id)]);
      if (!notebooks.some((item) => item.name === response.note.notebook)) {
        setNotebooks((items) => [...items, { id: response.note.notebook || "", name: response.note.notebook || "Sổ cá nhân", createdAt: response.note.createdAt }]);
      }
      openNote(response.note);
      notify("success", "Đã lưu ghi chú mã hóa.");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Không thể lưu ghi chú.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selectedId || !selected || !window.confirm(`Xóa ghi chú “${selected.title || "Không tiêu đề"}”?`)) return;
    try {
      await apiClient.request(`/api/notes/${selectedId}`, { method: "DELETE" });
      const next = notes.filter((note) => note.id !== selectedId);
      setNotes(next);
      const replacement = next.find((note) => noteBookName(note) === notebookFilter) || next[0];
      if (replacement) openNote(replacement);
      else newNote(notebookFilter);
      notify("success", "Đã xóa ghi chú.");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Không thể xóa ghi chú.");
    }
  }

  async function createNotebook() {
    const name = newNotebook.trim();
    if (!name) return;
    try {
      const response = await apiClient.request<{ notebook: Notebook }>("/api/notebooks", { method: "POST", body: { name } });
      setNotebooks((items) => [...items, response.notebook]);
      setNewNotebook("");
      selectNotebook(response.notebook.name);
      notify("success", "Đã tạo sổ ghi chú.");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Không thể tạo sổ.");
    }
  }

  return (
    <div className="workspace-screen h-full w-full overflow-hidden p-3 sm:p-6">
      <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/55 shadow-2xl shadow-black/20">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2 text-emerald-300"><LockKeyhole className="h-3.5 w-3.5" /><span className="app-kicker">Không gian riêng tư</span></div>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-white">Sổ ghi chú</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-[11px] text-slate-500 sm:inline-flex"><LockKeyhole className="h-3.5 w-3.5" />Mã hóa AES-256-GCM</span>
            <button type="button" onClick={() => newNote()} className="inline-flex items-center gap-2 rounded-lg bg-sky-400 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-sky-300"><FilePlus2 className="h-4 w-4" />Ghi chú mới</button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[210px_minmax(0_1fr)]">
          <aside className="min-h-0 overflow-auto border-b border-white/10 p-3 lg:border-r lg:border-b-0">
            <div className="mb-3 flex items-center gap-2 px-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-500"><FolderOpen className="h-3.5 w-3.5" />Sổ tay</div>
            <nav className="space-y-1">
              {notebooks.map((item) => {
                const count = notes.filter((note) => noteBookName(note) === item.name).length;
                const active = notebookFilter === item.name;
                return <button type="button" key={item.id} onClick={() => selectNotebook(item.name)} className={`group flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-xs ${active ? "bg-sky-400/12 text-sky-100 shadow-sm shadow-sky-950/40" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}><span className="truncate font-medium">{item.name}</span><span className={`grid h-5 min-w-5 place-items-center rounded-md px-1 font-mono text-[10px] ${active ? "bg-sky-300/15 text-sky-200" : "bg-white/5 text-slate-600 group-hover:text-slate-400"}`}>{count}</span></button>;
              })}
            </nav>
            <form onSubmit={(event) => { event.preventDefault(); void createNotebook(); }} className="mt-5 border-t border-white/10 pt-4">
              <label className="px-1 text-[10px] font-bold uppercase tracking-[.14em] text-slate-600">Sổ tay mới</label>
              <div className="mt-2 flex gap-1.5"><input value={newNotebook} onChange={(event) => setNewNotebook(event.target.value)} placeholder="Tên sổ tay" maxLength={48} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[.035] px-2.5 py-2 text-xs text-slate-300 outline-none placeholder:text-slate-600 focus:border-sky-400/40" /><button type="submit" className="rounded-lg border border-sky-400/25 px-2 text-sky-200 hover:bg-sky-400/10" aria-label="Tạo sổ tay"><Plus className="h-4 w-4" /></button></div>
            </form>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-white/10 bg-black/10 px-4 pt-3 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300"><FileText className="h-4 w-4 text-sky-300" />{notebookFilter || "Sổ ghi chú"}<span className="font-mono text-[10px] font-normal text-slate-600">{visibleNotes.length} tệp</span></div>
                <label className="relative w-full sm:w-56"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm ghi chú..." className="w-full rounded-lg border border-white/10 bg-white/[.035] py-2 pl-9 pr-3 text-xs text-slate-300 outline-none placeholder:text-slate-600 focus:border-sky-400/40" /></label>
              </div>
              <div className="flex min-w-0 gap-1 overflow-x-auto pb-0.5">
                {loading && <span className="px-3 py-2 text-xs text-slate-500">Đang tải ghi chú...</span>}
                {!loading && visibleNotes.length === 0 && <button type="button" onClick={() => newNote()} className="inline-flex items-center gap-2 rounded-t-lg border border-dashed border-white/15 px-3 py-2 text-xs text-slate-500 hover:border-sky-400/35 hover:text-sky-200"><Plus className="h-3.5 w-3.5" />Tạo ghi chú đầu tiên</button>}
                {visibleNotes.map((note) => <button type="button" key={note.id} onClick={() => openNote(note)} className={`flex max-w-52 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 py-2.5 text-left text-xs ${selectedId === note.id ? "border-white/15 bg-slate-950/80 text-sky-100" : "border-transparent text-slate-500 hover:bg-white/[.035] hover:text-slate-300"}`}><FileText className={`h-3.5 w-3.5 shrink-0 ${selectedId === note.id ? "text-sky-300" : "text-slate-600"}`} /><span className="truncate font-medium">{note.title || "Không tiêu đề"}</span></button>)}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
            <section className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-5 py-7 sm:px-10 sm:py-9">
            <div className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-4">
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Tiêu đề ghi chú" maxLength={160} className="min-w-48 flex-1 border-0 bg-transparent text-xl font-semibold tracking-tight text-white outline-none placeholder:text-slate-600" />
              <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[.035] px-2.5 py-1.5 text-[11px] text-slate-400"><Tag className="h-3.5 w-3.5 text-sky-300" />{notebook || "Sổ cá nhân"}</span>
            </div>
            <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Viết điều cần ghi nhớ..." maxLength={20000} className="mt-6 min-h-80 w-full flex-1 resize-y bg-transparent text-[15px] leading-8 text-slate-300 outline-none placeholder:text-slate-700" />

            <div className="mt-5 border-t border-white/10 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2 text-sm font-semibold text-slate-200"><Table2 className="h-4 w-4 text-sky-300" />Bảng dữ liệu</div><p className="mt-1 text-[11px] text-slate-600">Thêm thông tin có cấu trúc vào ghi chú.</p></div>{!table ? <button type="button" onClick={() => setTable(emptyTable())} className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/25 px-2.5 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-400/10"><Plus className="h-3.5 w-3.5" />Tạo bảng</button> : <button type="button" onClick={() => setTable(undefined)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10"><X className="h-3.5 w-3.5" />Bỏ bảng</button>}</div>
              {table && <div className="mt-4 overflow-x-auto rounded-xl border border-white/10"><table className="min-w-full border-collapse text-xs"><thead><tr>{table.columns.map((column, columnIndex) => <th key={columnIndex} className="min-w-36 border-b border-r border-white/10 bg-white/[.035] p-0 last:border-r-0"><input value={column} onChange={(event) => setTable({ ...table, columns: table.columns.map((value, index) => index === columnIndex ? event.target.value : value) })} placeholder={`Cột ${columnIndex + 1}`} className="w-full bg-transparent px-3 py-2.5 font-semibold text-slate-300 outline-none placeholder:text-slate-600" /></th>)}<th className="w-9 border-b border-white/10 bg-white/[.035]" /></tr></thead><tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => <td key={columnIndex} className="border-r border-b border-white/8 p-0 last:border-r-0"><input value={cell} onChange={(event) => setTable({ ...table, rows: table.rows.map((values, index) => index === rowIndex ? values.map((value, cellIndex) => cellIndex === columnIndex ? event.target.value : value) : values) })} className="w-full bg-transparent px-3 py-2.5 text-slate-400 outline-none focus:bg-sky-400/5" /></td>)}<td className="border-b border-white/8 text-center"><button type="button" onClick={() => setTable({ ...table, rows: table.rows.filter((_, index) => index !== rowIndex) })} className="p-2 text-slate-600 hover:text-rose-300" aria-label="Xóa hàng"><Trash2 className="h-3.5 w-3.5" /></button></td></tr>)}</tbody></table><div className="flex gap-2 border-t border-white/10 p-2"><button type="button" onClick={() => setTable({ ...table, rows: [...table.rows, table.columns.map(() => "")] })} disabled={table.rows.length >= 100} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-sky-200 hover:bg-sky-400/10 disabled:opacity-40"><Plus className="h-3 w-3" />Thêm hàng</button><button type="button" onClick={() => setTable({ columns: [...table.columns, `Cột ${table.columns.length + 1}`], rows: table.rows.map((row) => [...row, ""]) })} disabled={table.columns.length >= 12} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-sky-200 hover:bg-sky-400/10 disabled:opacity-40"><Plus className="h-3 w-3" />Thêm cột</button></div></div>}
            </div>

            <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4"><span className="text-[10px] text-slate-600">{content.length.toLocaleString("vi-VN")} / 20.000 ký tự</span><div className="flex items-center gap-2">{selectedId && <button type="button" onClick={() => void remove()} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" />Xóa</button>}<button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-300 disabled:opacity-60"><Check className="h-4 w-4" />{saving ? "Đang lưu" : "Lưu ghi chú"}</button></div></footer>
            </section>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
