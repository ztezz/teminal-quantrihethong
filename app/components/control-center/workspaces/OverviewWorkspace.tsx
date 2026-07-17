import { motion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Clock3,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  TerminalSquare,
  Users,
} from "lucide-react";
import { useOverviewPolling } from "@/hooks/use-operations-data";

const number = new Intl.NumberFormat("vi-VN");

function duration(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return [days && `${days} ngày`, hours && `${hours} giờ`, !days && `${minutes} phút`].filter(Boolean).join(" ");
}

function ResourceGauge({ label, value, detail, icon: Icon, tone }: { label: string; value: number; detail: string; icon: typeof Cpu; tone: "sky" | "violet" | "emerald" | "amber" }) {
  const colors = { sky: "#38bdf8", violet: "#a78bfa", emerald: "#34d399", amber: "#fbbf24" };
  const color = value >= 90 ? "#fb7185" : colors[tone];
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const percent = Math.min(100, Math.max(0, value));
  return (
    <div className="overview-resource group">
      <div className="overview-gauge" style={{ "--gauge-color": color } as React.CSSProperties}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="overview-gauge-track" cx="50" cy="50" r={radius} />
          <motion.circle initial={{ strokeDashoffset: circumference }} animate={{ strokeDashoffset: circumference * (1 - percent / 100) }} transition={{ duration: 0.8, ease: "easeOut" }} className="overview-gauge-value" cx="50" cy="50" r={radius} strokeDasharray={circumference} />
        </svg>
        <div><Icon /><strong>{value}%</strong></div>
      </div>
      <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p><p className="mt-2 truncate font-mono text-[10px] text-slate-400">{detail}</p></div>
    </div>
  );
}

function Distribution({ values }: { values: Record<string, number> }) {
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1]);
  const total = Math.max(1, entries.reduce((sum, [, count]) => sum + count, 0));
  if (!entries.length) return <p className="text-xs italic text-slate-600">Chưa có dữ liệu phân bố.</p>;
  return <div className="space-y-3">{entries.slice(0, 5).map(([label, count]) => <div key={label} className="grid grid-cols-[46px_1fr_auto] items-center gap-3"><span className="font-mono text-[10px] text-slate-400">{label}</span><div className="metric-track h-1.5 overflow-hidden rounded-full"><motion.div initial={{ width: 0 }} animate={{ width: `${count / total * 100}%` }} className="h-full rounded-full bg-sky-400" /></div><span className="font-mono text-[10px] tabular-nums text-slate-500">{number.format(count)}</span></div>)}</div>;
}

export function OverviewWorkspace({ onOpenJobs }: { onOpenJobs: () => void }) {
  const { data, loading, error, refresh } = useOverviewPolling(true);
  const failedServices = data?.system.services.failed ?? 0;
  const issueCount = data ? Number(data.host.cpu >= 90) + Number(data.host.memory.percent >= 90) + Number(data.host.disk.percent >= 90) + data.databases.unhealthy + failedServices + data.audit.critical : 0;
  const health = issueCount ? { label: `${issueCount} cảnh báo cần chú ý`, detail: "Kiểm tra tài nguyên và sự kiện bên dưới", className: "is-warning", icon: AlertTriangle } : { label: "Hệ thống hoạt động ổn định", detail: "Tất cả lớp vận hành đang trong ngưỡng an toàn", className: "is-healthy", icon: ShieldCheck };

  return (
    <motion.div key="overview-tab" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="workspace-screen h-full w-full overflow-y-auto p-3 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="overview-hero">
          <div className="relative z-1 max-w-2xl">
            <div className="flex items-center gap-2"><span className="overview-live-dot" /><p className="app-kicker">Live command overview</p></div>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.035em] text-white sm:text-3xl">Trạng thái vận hành</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Toàn cảnh máy chủ, lưu lượng ứng dụng và tín hiệu bảo mật trong thời gian thực.</p>
          </div>
          <div className="relative z-1 flex flex-col items-start gap-3 sm:items-end">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{data ? `Đồng bộ lúc ${new Date(data.generatedAt).toLocaleTimeString("vi-VN")}` : "Đang thiết lập telemetry"}</span>
            <button onClick={() => void refresh()} disabled={loading} className="overview-refresh"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Làm mới dữ liệu</button>
          </div>
        </header>

        {error && <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-300">{error}</div>}
        {!data ? <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="app-panel h-40 p-2"><span className="skeleton-card h-full!" /></div>)}</div> : <>
          <section className={`overview-health ${health.className}`}>
            <div className="overview-health-icon"><health.icon /></div>
            <div className="min-w-0 flex-1"><p className="text-base font-semibold text-white">{health.label}</p><p className="mt-1 text-xs text-slate-500">{health.detail}</p></div>
            <div className="overview-uptime"><Clock3 /><span>Uptime</span><strong>{duration(data.application.uptimeSeconds)}</strong></div>
          </section>

          <section className="overview-resource-grid">
            <ResourceGauge label="CPU utilization" value={data.host.cpu} detail={`Load ${data.host.loadAverage.join(" / ")}`} icon={Cpu} tone="sky" />
            <ResourceGauge label="Memory usage" value={data.host.memory.percent} detail={`${number.format(data.host.memory.usedMB)} / ${number.format(data.host.memory.totalMB)} MB`} icon={MemoryStick} tone="violet" />
            <ResourceGauge label="Disk capacity" value={data.host.disk.percent} detail={`${data.host.disk.usedGB} / ${data.host.disk.totalGB} GB`} icon={HardDrive} tone={data.host.disk.percent >= 85 ? "amber" : "emerald"} />
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.5fr_0.8fr]">
            <div className="overview-panel overflow-hidden">
              <div className="overview-panel-heading"><div><p className="app-kicker">Application telemetry</p><h3>Lưu lượng API</h3></div><Activity className="text-sky-300" /></div>
              <div className="grid grid-cols-2 gap-px bg-white/6 sm:grid-cols-4">
                {[{ label: "Requests", value: number.format(data.api.requests), icon: Network, tone: "text-sky-300" }, { label: "P95 latency", value: `${data.api.latencyMs.p95} ms`, icon: Gauge, tone: "text-violet-300" }, { label: "Error rate", value: `${data.api.errorRate}%`, icon: AlertTriangle, tone: data.api.errorRate > 5 ? "text-rose-300" : "text-emerald-300" }, { label: "In flight", value: String(data.api.inFlight), icon: Activity, tone: "text-amber-300" }].map(({ label, value, icon: Icon, tone }) => <div key={label} className="overview-api-stat"><div className={tone}><Icon /></div><strong>{value}</strong><span>{label}</span></div>)}
              </div>
              <div className="grid gap-6 p-5 md:grid-cols-2"><div><p className="overview-section-label">Theo phương thức</p><Distribution values={data.api.methods} /></div><div><p className="overview-section-label">Theo mã phản hồi</p><Distribution values={data.api.statusCodes} /></div></div>
            </div>

            <div className="overview-panel p-5"><div className="overview-panel-heading px-0! pt-0! border-0!"><div><p className="app-kicker">Runtime inventory</p><h3>Hạ tầng đang chạy</h3></div><ServerCog className="text-violet-300" /></div><div className="mt-5 space-y-2">
              {[{ label: "Phiên hoạt động", value: data.sessions.active, icon: Users, tone: "sky" }, { label: "Terminal socket", value: data.terminalConnections, icon: TerminalSquare, tone: "emerald" }, { label: "Services", value: data.system.services.supported ? `${data.system.services.active}/${data.system.services.total}` : "N/A", icon: ServerCog, tone: "violet" }, { label: "Processes", value: data.system.processes.supported ? data.system.processes.total : "N/A", icon: Activity, tone: "amber" }].map(({ label, value, icon: Icon, tone }) => <div key={label} className="overview-runtime-row"><span className={`tone-${tone}`}><Icon /></span><p>{label}</p><strong>{value}</strong></div>)}
            </div></div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[0.72fr_1.28fr]">
            <div className="overview-database"><div className="flex items-start justify-between"><div><p className="app-kicker">Data layer</p><h3 className="mt-2 text-base font-semibold text-white">SQLite fleet</h3></div><Database /></div><div className="mt-7 flex items-end gap-3"><strong className="text-5xl font-semibold tracking-tight text-white">{data.databases.managed}</strong><span className="mb-1 text-xs text-slate-500">database được quản lý</span></div><div className="mt-7 grid grid-cols-2 gap-3"><div className="overview-db-status is-ok"><span /><strong>{data.databases.healthy}</strong><p>Khỏe mạnh</p></div><div className="overview-db-status is-bad"><span /><strong>{data.databases.unhealthy}</strong><p>Cần kiểm tra</p></div></div><button type="button" onClick={onOpenJobs} className="overview-jobs-button">Mở tác vụ SQLite <ArrowUpRight /></button></div>
            <div className="overview-panel overflow-hidden"><div className="overview-panel-heading"><div><p className="app-kicker">Security pulse</p><h3>Dòng sự kiện gần đây</h3></div><div className="flex gap-2"><span className="overview-event-count is-critical">{data.audit.critical} critical</span><span className="overview-event-count is-warning">{data.audit.warning} warning</span></div></div><div className="overview-timeline">{data.audit.recent.map(event => <div key={event.id} className="overview-event"><span className={`overview-event-dot is-${event.level}`} /><div className="min-w-0"><p className="truncate text-xs text-slate-300">{event.event}</p><span>{event.category} / {event.action}</span></div><time>{new Date(event.timestamp).toLocaleTimeString("vi-VN")}</time></div>)}{data.audit.recent.length === 0 && <div className="p-8 text-center"><ShieldCheck className="mx-auto h-6 w-6 text-emerald-400" /><p className="mt-3 text-xs text-slate-500">Chưa có sự kiện kiểm toán.</p></div>}</div></div>
          </section>
        </>}
      </div>
    </motion.div>
  );
}
