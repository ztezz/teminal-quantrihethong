import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Ban, CheckCircle2, Clock3, ListTodo, LoaderCircle, Plus, RefreshCw, XCircle } from "lucide-react";
import { useJobs } from "@/hooks/use-jobs";
import type { ConfirmOptions, Job, JobState, JobType, SqliteFile, ToastKind, UserRole } from "../types";

const typeLabels: Record<JobType, string> = {
  sqlite_backup: "Sao lưu",
  sqlite_integrity: "Kiểm tra toàn vẹn",
  sqlite_vacuum: "VACUUM",
};
const stateLabels: Record<JobState, string> = {
  pending: "Đang chờ",
  running: "Đang chạy",
  success: "Hoàn tất",
  failure: "Thất bại",
  cancelled: "Đã hủy",
};
const stateStyles: Record<JobState, string> = {
  pending: "border-amber-400/20 bg-amber-400/5 text-amber-300",
  running: "border-sky-400/20 bg-sky-400/5 text-sky-300",
  success: "border-emerald-400/20 bg-emerald-400/5 text-emerald-300",
  failure: "border-rose-400/20 bg-rose-400/5 text-rose-300",
  cancelled: "border-slate-400/20 bg-slate-400/5 text-slate-400",
};

interface JobsWorkspaceProps {
  active: boolean;
  role: UserRole;
  databases: SqliteFile[];
  askConfirm: (options: ConfirmOptions) => Promise<boolean>;
  notify: (kind: ToastKind, message: string, duration?: number) => number;
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("vi-VN") : "Chưa có";
}

function StateIcon({ state }: { state: JobState }) {
  if (state === "running") return <LoaderCircle className="h-4 w-4 animate-spin" />;
  if (state === "success") return <CheckCircle2 className="h-4 w-4" />;
  if (state === "failure") return <XCircle className="h-4 w-4" />;
  if (state === "cancelled") return <Ban className="h-4 w-4" />;
  return <Clock3 className="h-4 w-4" />;
}

export function JobsWorkspace({ active, role, databases, askConfirm, notify }: JobsWorkspaceProps) {
  const { jobs, total, stateFilter, setStateFilter, typeFilter, setTypeFilter, selectedId, setSelectedId, loading, refreshing, error, refresh, create, cancel } = useJobs(active);
  const [creating, setCreating] = useState(false);
  const [databasePath, setDatabasePath] = useState("");
  const [jobType, setJobType] = useState<JobType>("sqlite_backup");
  const selected = jobs.find((job) => job.id === selectedId) ?? jobs[0];

  useEffect(() => {
    if (!databasePath && databases[0]) {
      const timer = window.setTimeout(() => setDatabasePath(databases[0].path), 0);
      return () => window.clearTimeout(timer);
    }
  }, [databasePath, databases]);

  const createJob = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!databasePath) return;
    if (jobType === "sqlite_vacuum" && !await askConfirm({
      title: "Xác nhận VACUUM",
      message: `VACUUM sẽ khóa và ghi lại database ${databasePath}. Nhập VACUUM để tiếp tục.`,
      danger: true,
      requiredText: "VACUUM",
      confirmLabel: "Tạo tác vụ",
    })) return;
    setCreating(true);
    try {
      await create(jobType, databasePath);
      notify("success", `Đã đưa ${typeLabels[jobType].toLowerCase()} vào hàng đợi.`);
    } catch (caught) {
      notify("error", caught instanceof Error ? caught.message : "Không thể tạo tác vụ");
    } finally { setCreating(false); }
  };

  const cancelJob = async (job: Job) => {
    const rootLevel = job.requiredRole === "root";
    const confirmed = await askConfirm({
      title: "Hủy tác vụ",
      message: `Hủy ${typeLabels[job.type].toLowerCase()} cho ${job.path}?${rootLevel ? ` Nhập ${job.id} để xác nhận tác vụ cấp root.` : ""}`,
      danger: true,
      requiredText: rootLevel ? job.id : undefined,
      confirmLabel: "Hủy tác vụ",
    });
    if (!confirmed) return;
    try {
      await cancel(job);
      notify("success", "Đã gửi yêu cầu hủy tác vụ.");
    } catch (caught) {
      notify("error", caught instanceof Error ? caught.message : "Không thể hủy tác vụ");
    }
  };

  return (
    <motion.div key="jobs-tab" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="workspace-screen h-full w-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="workspace-heading flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="mr-auto"><p className="app-kicker">Operations queue</p><h2 className="mt-1 text-xl font-bold uppercase tracking-wider text-white">Tác Vụ SQLite</h2><p className="mt-1 font-mono text-xs text-slate-500">Theo dõi sao lưu, kiểm tra toàn vẹn và bảo trì database</p></div>
          <button type="button" onClick={() => void refresh()} disabled={refreshing} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:text-white disabled:opacity-50"><RefreshCw className={`mr-1.5 inline h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />Làm mới</button>
        </header>

        <form onSubmit={createJob} className="app-panel grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
          <label className="min-w-0 text-[10px] font-bold uppercase tracking-wider text-slate-500">Database đã đăng ký<select value={databasePath} onChange={(event) => setDatabasePath(event.target.value)} required className="mt-2 w-full rounded-lg border border-white/10 bg-[#09111d] px-3 py-2.5 text-xs normal-case text-slate-200"><option value="">Chọn database</option>{databases.map((database) => <option key={database.path} value={database.path}>{database.name} - {database.path}</option>)}</select></label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Loại tác vụ<select value={jobType} onChange={(event) => setJobType(event.target.value as JobType)} className="mt-2 w-full rounded-lg border border-white/10 bg-[#09111d] px-3 py-2.5 text-xs normal-case text-slate-200"><option value="sqlite_backup">Sao lưu</option><option value="sqlite_integrity">Kiểm tra toàn vẹn</option>{role === "root" && <option value="sqlite_vacuum">VACUUM (root)</option>}</select></label>
          <button type="submit" disabled={creating || !databasePath} className="rounded-lg bg-sky-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-sky-400 disabled:opacity-40"><Plus className="mr-1.5 inline h-4 w-4" />{creating ? "Đang tạo..." : "Tạo tác vụ"}</button>
          {!databases.length && <p className="text-xs text-amber-300 md:col-span-3"><AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />Chưa có database SQLite đã đăng ký. Mở SQLite Studio để đăng ký database.</p>}
        </form>

        <div className="flex flex-col gap-3 sm:flex-row">
          <select aria-label="Lọc theo trạng thái" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as JobState | "")} className="rounded-lg border border-white/10 bg-[#09111d] px-3 py-2 text-xs text-slate-300"><option value="">Mọi trạng thái</option>{Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select aria-label="Lọc theo loại" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as JobType | "")} className="rounded-lg border border-white/10 bg-[#09111d] px-3 py-2 text-xs text-slate-300"><option value="">Mọi loại tác vụ</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <span className="self-center font-mono text-[10px] text-slate-500">{total} tác vụ</span>
        </div>

        {error && <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-300">{error}</div>}
        {loading ? <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]"><div className="app-panel h-96 p-4"><span className="skeleton-card h-full!" /></div><div className="app-panel h-96 p-4"><span className="skeleton-card h-full!" /></div></div> : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
            <section className="app-panel overflow-hidden"><div className="border-b border-white/8 px-4 py-3"><p className="app-kicker">Queue & history</p></div><div className="divide-y divide-white/5">
              {jobs.map((job) => <button type="button" key={job.id} onClick={() => setSelectedId(job.id)} className={`block w-full p-4 text-left transition hover:bg-white/[0.025] ${selected?.id === job.id ? "bg-sky-400/5" : ""}`}><div className="flex items-start gap-3"><span className={`rounded-lg border p-2 ${stateStyles[job.state]}`}><StateIcon state={job.state} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-white">{typeLabels[job.type]}</p><span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${stateStyles[job.state]}`}>{stateLabels[job.state]}</span></div><p className="mt-1 truncate font-mono text-[10px] text-slate-500">{job.path}</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5"><div className={`h-full transition-all ${job.state === "failure" ? "bg-rose-400" : job.state === "cancelled" ? "bg-slate-500" : "bg-sky-400"}`} style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }} /></div><div className="mt-2 flex justify-between font-mono text-[9px] text-slate-600"><span>{job.message}</span><span>{job.progress}%</span></div></div></div></button>)}
              {!jobs.length && <div className="p-10 text-center"><ListTodo className="mx-auto h-8 w-8 text-slate-700" /><p className="mt-3 text-sm text-slate-500">Không có tác vụ phù hợp bộ lọc.</p></div>}
            </div></section>

            <aside className="app-panel h-fit overflow-hidden lg:sticky lg:top-0">{selected ? <><div className="border-b border-white/8 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="app-kicker">Job detail</p><h3 className="mt-1 text-base font-semibold text-white">{typeLabels[selected.type]}</h3><p className="mt-1 break-all font-mono text-[10px] text-slate-500">{selected.id}</p></div>{["pending", "running"].includes(selected.state) && <button type="button" onClick={() => void cancelJob(selected)} className="shrink-0 rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-xs text-rose-300 hover:bg-rose-400/10"><Ban className="mr-1 inline h-3.5 w-3.5" />Hủy</button>}</div></div>
              <div className="grid grid-cols-2 gap-px bg-white/5"><Detail label="Tạo lúc" value={formatDate(selected.createdAt)} /><Detail label="Bắt đầu" value={formatDate(selected.startedAt)} /><Detail label="Kết thúc" value={formatDate(selected.finishedAt)} /><Detail label="Người tạo" value={`${selected.createdBy} / ${selected.source}`} /></div>
              <div className="space-y-4 p-4"><div><p className="app-kicker">Database</p><p className="mt-2 break-all font-mono text-[11px] text-slate-300">{selected.path}</p></div>{selected.error && <div className="rounded-lg border border-rose-400/15 bg-rose-400/5 p-3 text-xs text-rose-300">{selected.error}</div>}{selected.result && <div><p className="app-kicker">Kết quả</p><pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/20 p-3 font-mono text-[10px] text-emerald-300">{JSON.stringify(selected.result, null, 2)}</pre></div>}<div><p className="app-kicker">Nhật ký</p><div className="mt-2 max-h-72 space-y-2 overflow-auto rounded-lg border border-white/8 bg-black/20 p-3">{selected.logs.map((log, index) => <div key={`${log.timestamp}-${index}`} className="grid grid-cols-[auto_1fr] gap-3 font-mono text-[10px]"><time className="text-slate-600">{new Date(log.timestamp).toLocaleTimeString("vi-VN")}</time><span className="text-slate-300">{log.message}</span></div>)}</div></div></div>
            </> : <div className="p-10 text-center text-sm text-slate-600">Chọn một tác vụ để xem chi tiết.</div>}</aside>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#0d1623] p-3"><p className="text-[9px] uppercase tracking-wider text-slate-600">{label}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-300">{value}</p></div>;
}
