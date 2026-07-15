import { motion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  Clock3,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  RefreshCw,
  ServerCog,
  ShieldAlert,
  TerminalSquare,
  Users,
} from "lucide-react";
import { useOverviewPolling } from "@/hooks/use-operations-data";

const number = new Intl.NumberFormat("vi-VN");

function duration(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds % 86_400 / 3_600);
  const minutes = Math.floor(seconds % 3_600 / 60);
  return [days && `${days} ngày`, hours && `${hours} giờ`, !days && `${minutes} phút`].filter(Boolean).join(" ");
}

function MetricCard({ label, value, detail, percent, icon: Icon, tone = "sky" }: { label: string; value: string; detail: string; percent?: number; icon: typeof Cpu; tone?: "sky" | "violet" | "emerald" | "amber" }) {
  const tones = {
    sky: "text-sky-300 bg-sky-400/10 border-sky-400/15",
    violet: "text-violet-300 bg-violet-400/10 border-violet-400/15",
    emerald: "text-emerald-300 bg-emerald-400/10 border-emerald-400/15",
    amber: "text-amber-300 bg-amber-400/10 border-amber-400/15",
  };
  const bars = { sky: "bg-sky-400", violet: "bg-violet-400", emerald: "bg-emerald-400", amber: "bg-amber-400" };
  return (
    <div className="app-panel p-4 sm:p-5 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="app-kicker text-slate-500!">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-white truncate">{value}</p></div>
        <span className={`rounded-xl border p-2.5 ${tones[tone]}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-2 truncate font-mono text-[10px] text-slate-500">{detail}</p>
      {percent !== undefined && <div className="metric-track mt-3 h-1.5 overflow-hidden rounded-full"><div className={`h-full ${bars[tone]}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div>}
    </div>
  );
}

export function OverviewWorkspace({ onOpenJobs }: { onOpenJobs: () => void }) {
  const { data, loading, error, refresh } = useOverviewPolling(true);

  return (
    <motion.div key="overview-tab" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="workspace-screen h-full w-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="workspace-heading flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="mr-auto"><p className="app-kicker">Live operations</p><h2 className="mt-1 text-xl font-bold uppercase tracking-wider text-white">Tổng Quan Hệ Thống</h2><p className="mt-1 font-mono text-xs text-slate-500">Tình trạng máy chủ, bảo mật và lớp ứng dụng trong một màn hình</p></div>
          <div className="flex items-center gap-3"><span className="font-mono text-[10px] text-slate-500">{data ? `Cập nhật ${new Date(data.generatedAt).toLocaleTimeString("vi-VN")}` : "Đang đồng bộ"}</span><button onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:border-sky-400/30 hover:text-white disabled:opacity-50"><RefreshCw className={`mr-1.5 inline h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Làm mới</button></div>
        </header>

        {error && <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-300">{error}</div>}
        {!data ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="app-panel h-32 p-2"><span className="skeleton-card h-full!" /></div>)}</div> : <>
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="CPU" value={`${data.host.cpu}%`} detail={`Load ${data.host.loadAverage.join(" / ")}`} percent={data.host.cpu} icon={Cpu} />
            <MetricCard label="Bộ nhớ" value={`${data.host.memory.percent}%`} detail={`${number.format(data.host.memory.usedMB)} / ${number.format(data.host.memory.totalMB)} MB`} percent={data.host.memory.percent} icon={MemoryStick} tone="violet" />
            <MetricCard label="Ổ đĩa" value={`${data.host.disk.percent}%`} detail={`${data.host.disk.usedGB} / ${data.host.disk.totalGB} GB`} percent={data.host.disk.percent} icon={HardDrive} tone={data.host.disk.percent >= 85 ? "amber" : "emerald"} />
            <MetricCard label="Uptime" value={duration(data.application.uptimeSeconds)} detail={`Khởi động ${new Date(data.application.startedAt).toLocaleString("vi-VN")}`} icon={Clock3} tone="emerald" />
          </section>

          <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <div className="app-panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-white/8 px-4 py-3 sm:px-5"><div><p className="app-kicker">Application telemetry</p><h3 className="mt-1 text-sm font-semibold text-white">Lưu lượng API</h3></div><Activity className="h-4 w-4 text-sky-300" /></div>
              <div className="grid grid-cols-2 gap-px bg-white/5 sm:grid-cols-4">
                {[{ label: "Requests", value: number.format(data.api.requests), icon: Network }, { label: "P95 latency", value: `${data.api.latencyMs.p95} ms`, icon: Gauge }, { label: "Error rate", value: `${data.api.errorRate}%`, icon: AlertTriangle }, { label: "In flight", value: String(data.api.inFlight), icon: Activity }].map(({ label, value, icon: Icon }) => <div key={label} className="bg-[#0d1623] p-4"><Icon className="mb-3 h-4 w-4 text-slate-500" /><p className="text-xl font-semibold text-white">{value}</p><p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-slate-500">{label}</p></div>)}
              </div>
              <div className="flex flex-wrap gap-2 px-4 py-3 font-mono text-[10px] text-slate-500 sm:px-5">{Object.entries(data.api.statusCodes).map(([status, count]) => <span key={status} className={`rounded border px-2 py-1 ${status.startsWith("4") || status.startsWith("5") ? "border-rose-400/15 text-rose-300" : "border-white/8"}`}>{status}: {count}</span>)}</div>
            </div>

            <div className="app-panel p-4 sm:p-5"><p className="app-kicker">Runtime inventory</p><div className="mt-4 grid grid-cols-2 gap-3">
              {[{ label: "Phiên hoạt động", value: data.sessions.active, icon: Users, tone: "text-sky-300" }, { label: "Terminal socket", value: data.terminalConnections, icon: TerminalSquare, tone: "text-emerald-300" }, { label: "Services", value: data.system.services.supported ? `${data.system.services.active}/${data.system.services.total}` : "N/A", icon: ServerCog, tone: "text-violet-300" }, { label: "Processes", value: data.system.processes.supported ? data.system.processes.total : "N/A", icon: Activity, tone: "text-amber-300" }].map(({ label, value, icon: Icon, tone }) => <div key={label} className="rounded-xl border border-white/8 bg-white/[0.025] p-3"><Icon className={`h-4 w-4 ${tone}`} /><p className="mt-3 text-lg font-semibold text-white">{value}</p><p className="mt-1 text-[9px] uppercase tracking-wider text-slate-500">{label}</p></div>)}
            </div></div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="app-panel p-4 sm:p-5"><div className="flex items-center justify-between"><div><p className="app-kicker">Data layer</p><h3 className="mt-1 text-sm font-semibold text-white">SQLite được quản lý</h3></div><Database className="h-4 w-4 text-emerald-300" /></div><div className="mt-5 flex items-end gap-3"><span className="text-4xl font-semibold text-white">{data.databases.managed}</span><span className="mb-1 text-xs text-slate-500">database</span></div><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-lg bg-emerald-400/6 p-3 text-emerald-300"><p className="text-lg font-semibold">{data.databases.healthy}</p><p className="text-[9px] uppercase">Khỏe mạnh</p></div><div className="rounded-lg bg-rose-400/6 p-3 text-rose-300"><p className="text-lg font-semibold">{data.databases.unhealthy}</p><p className="text-[9px] uppercase">Cần kiểm tra</p></div></div>{data.databases.truncated && <p className="mt-3 text-[10px] text-amber-300">Kết quả bị giới hạn sau {number.format(data.databases.scanned)} mục.</p>}<button type="button" onClick={onOpenJobs} className="mt-4 w-full rounded-lg border border-emerald-400/15 bg-emerald-400/5 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/10">Mở tác vụ SQLite</button></div>
            <div className="app-panel overflow-hidden"><div className="flex items-center justify-between border-b border-white/8 px-4 py-3 sm:px-5"><div><p className="app-kicker">Security pulse</p><h3 className="mt-1 text-sm font-semibold text-white">Sự kiện gần đây</h3></div><div className="flex gap-2 font-mono text-[10px]"><span className="rounded border border-rose-400/15 bg-rose-400/5 px-2 py-1 text-rose-300"><ShieldAlert className="mr-1 inline h-3 w-3" />{data.audit.critical}</span><span className="rounded border border-amber-400/15 bg-amber-400/5 px-2 py-1 text-amber-300"><AlertTriangle className="mr-1 inline h-3 w-3" />{data.audit.warning}</span></div></div><div className="divide-y divide-white/5">{data.audit.recent.map(event => <div key={event.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 sm:px-5"><span className={`h-2 w-2 rounded-full ${event.level === "critical" ? "bg-rose-400" : event.level === "warning" ? "bg-amber-400" : "bg-sky-400"}`} /><div className="min-w-0"><p className="truncate text-xs text-slate-300">{event.event}</p><p className="mt-0.5 font-mono text-[9px] uppercase text-slate-600">{event.category} / {event.action}</p></div><time className="font-mono text-[9px] text-slate-600">{new Date(event.timestamp).toLocaleTimeString("vi-VN")}</time></div>)}{data.audit.recent.length === 0 && <p className="p-5 text-xs italic text-slate-600">Chưa có sự kiện kiểm toán.</p>}</div></div>
          </section>
        </>}
      </div>
    </motion.div>
  );
}
