import type { PointerEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Database,
  Folder,
  History,
  Menu,
  Settings,
  Terminal as TerminalIcon,
} from "lucide-react";
import type { ActiveTab, LogEntry, UserRole } from "./types";

export type SocketStatus = "idle" | "connecting" | "connected" | "error";

interface HeaderProps {
  socketStatus: SocketStatus;
  onToggleSidebar: () => void;
  onLogout: () => void;
}

export function Header({ socketStatus, onToggleSidebar, onLogout }: HeaderProps) {
  return (
    <header className="app-topbar h-14 sm:h-16 border-b flex items-center justify-between px-3 sm:px-6 shrink-0 z-50">
      <div className="flex items-center gap-4">
        <button onClick={onToggleSidebar} className="p-2 text-slate-400 hover:text-white rounded-lg border border-transparent hover:border-white/10 hover:bg-white/5 transition">
          <Menu className="w-4 h-4" />
        </button>
        <div className="relative hidden sm:block">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          <div className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-30" />
        </div>
        <h1 className="text-xs sm:text-sm font-bold tracking-tight text-white flex items-center gap-2">
          <span className="hidden sm:inline">NodeShell</span> Control
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[8px] text-slate-500 font-mono font-normal">v1.1</span>
        </h1>
      </div>
      <div className="flex items-center gap-4 sm:gap-8">
        <div className="hidden md:flex items-center gap-6">
          <div className="text-right">
            <p className="text-[9px] uppercase text-slate-500 leading-none mb-1">Cơ sở dữ liệu</p>
            <p className="text-xs font-mono text-blue-400 font-semibold uppercase">SQLite Đang Hoạt Động</p>
          </div>
          <div className="h-8 w-[1px] bg-white/10" />
          <div className="text-right">
            <p className="text-[9px] uppercase text-slate-500 leading-none mb-1">Trạng thái kết nối</p>
            <p className="text-xs font-mono text-emerald-400 font-semibold uppercase flex items-center gap-1">
              <StatusDot status={socketStatus} />
              {socketStatus === "connected" ? "ĐÃ KẾT NỐI" : socketStatus === "connecting" ? "ĐANG KẾT NỐI" : socketStatus === "error" ? "LỖI KẾT NỐI" : "SẴN SÀNG"}
            </p>
          </div>
        </div>
        <button onClick={onLogout} className="px-3 sm:px-4 py-2 bg-rose-500/8 hover:bg-rose-500/15 text-rose-300 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-rose-500/20 transition-colors cursor-pointer">
          <span className="hidden sm:inline">Chấm dứt phiên</span><span className="sm:hidden">Thoát</span>
        </button>
      </div>
    </header>
  );
}

interface SidebarMetrics {
  cpuPercent: number;
  memUsedMB: number;
  memTotalMB: number;
  memPercent: number;
  diskUsedGB: number;
  diskTotalGB: number;
  diskPercent: number;
}

interface SidebarProps {
  open: boolean;
  width: number;
  activeTab: ActiveTab;
  role: UserRole;
  metrics: SidebarMetrics;
  logs: LogEntry[];
  onSelectTab: (tab: ActiveTab) => void;
  onStartResize: (event: PointerEvent) => void;
}

const navigation: Array<{ tab: ActiveTab; label: string; restricted?: boolean; icon: typeof Database }> = [
  { tab: "terminal", label: "Cửa Sổ Dòng Lệnh", restricted: true, icon: TerminalIcon },
  { tab: "system", label: "Hệ Thống", restricted: true, icon: Database },
  { tab: "sqlite", label: "Quản Lý SQLite", restricted: true, icon: Database },
  { tab: "logs", label: "Nhật Ký Bảo Mật", restricted: true, icon: History },
  { tab: "files", label: "Quản Lý Tệp Tin", icon: Folder },
  { tab: "settings", label: "Cấu Hình", icon: Settings },
];

export function Sidebar({ open, width, activeTab, role, metrics, logs, onSelectTab, onStartResize }: SidebarProps) {
  const privileged = ["admin", "root"].includes(role);
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside initial={{ width: 0, opacity: 0 }} animate={{ width, opacity: 1 }} exit={{ width: 0, opacity: 0 }} className="app-sidebar relative border-r flex flex-col h-full shrink-0 overflow-y-auto">
          <div className="p-4 border-b border-white/10 space-y-3">
            <div className="flex items-center justify-between"><h3 className="app-kicker">Tài nguyên</h3><span className="text-[9px] font-mono text-emerald-400">LIVE</span></div>
            <Metric label="Tải CPU" value={`${metrics.cpuPercent}%`} percent={metrics.cpuPercent} barClass="bg-gradient-to-r from-sky-500 to-cyan-300" />
            <Metric label="Sử dụng Bộ nhớ" value={`${metrics.memUsedMB}MB / ${metrics.memTotalMB}MB`} percent={metrics.memPercent} barClass="bg-gradient-to-r from-violet-500 to-fuchsia-400" />
            <Metric label="Dung lượng ổ đĩa" value={`${metrics.diskUsedGB}GB / ${metrics.diskTotalGB}GB`} percent={metrics.diskPercent} barClass={metrics.diskPercent >= 90 ? "bg-red-500" : metrics.diskPercent >= 75 ? "bg-amber-500" : "bg-emerald-500"} />
          </div>
          <div className="p-3 border-b border-white/10">
            <h3 className="app-kicker mb-3 px-2">Workspace</h3>
            <nav className="space-y-1.5">
              {navigation.filter((item) => !item.restricted || privileged).map(({ tab, label, icon: Icon }) => (
                <button key={tab} onClick={() => onSelectTab(tab)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition cursor-pointer border ${activeTab === tab ? tab === "sqlite" ? "bg-emerald-500/10 text-emerald-300 border-emerald-400/20 shadow-[inset_3px_0_0_#34d399]" : "bg-sky-500/10 text-sky-300 border-sky-400/20 shadow-[inset_3px_0_0_#38bdf8]" : "text-slate-400 border-transparent hover:bg-white/5 hover:text-white"}`}>
                  <Icon className="w-4 h-4" /><span>{label}</span>
                </button>
              ))}
            </nav>
          </div>
          <div className="p-4 mt-auto">
            <h3 className="app-kicker mb-3">Hoạt động gần đây</h3>
            <div className="space-y-3 font-mono text-[11px] leading-relaxed">
              {logs.slice(0, 3).map((log) => <div key={log.id} className="border-b border-white/5 pb-2 last:border-0 last:pb-0"><p className="text-slate-400 text-[10px]">{new Date(log.timestamp).toLocaleTimeString()}</p><p className="text-slate-500 truncate">IP: <span className="text-blue-400">{log.ip}</span> • {log.event.includes("fail") ? <span className="text-red-400 font-bold">LỖI</span> : <span className="text-emerald-400 font-bold">OK</span>}</p></div>)}
              {logs.length === 0 && <p className="text-slate-600 italic">Chưa ghi nhận lượt kết nối nào.</p>}
            </div>
          </div>
          <div role="separator" aria-label="Thay đổi chiều rộng thanh điều hướng" aria-orientation="vertical" onPointerDown={onStartResize} className="sidebar-resizer right-0" />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Metric({ label, value, percent, barClass }: { label: string; value: string; percent: number; barClass: string }) {
  return <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3"><div className="flex justify-between items-end mb-1.5"><label className="text-[9px] uppercase font-bold text-slate-500">{label}</label><span className="text-xs font-mono text-white">{value}</span></div><div className="metric-track h-1.5 w-full rounded-full overflow-hidden"><div className={`h-full transition-all duration-500 ${barClass}`} style={{ width: `${percent}%` }} /></div></div>;
}

export function MobileBackdrop({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <button aria-label="Đóng thanh điều hướng" onClick={onClose} className="fixed inset-x-0 top-14 bottom-8 z-30 bg-black/60 backdrop-blur-sm md:hidden" /> : null;
}

export function Footer({ socketStatus }: { socketStatus: SocketStatus }) {
  return <footer className="status-footer h-8 border-t flex items-center justify-between px-3 sm:px-6 shrink-0 text-[9px] sm:text-[10px] font-mono text-slate-500 uppercase tracking-widest z-50 select-none"><div className="flex gap-6"><span className="flex items-center gap-1.5"><StatusDot status={socketStatus} />Socket.io: {socketStatus === "connected" ? "Kết nối" : socketStatus === "connecting" ? "Đang nối" : socketStatus === "error" ? "Lỗi" : "Sẵn sàng"}</span><span className="hidden sm:inline">Bộ nhớ đệm: 1024kb</span><span className="hidden md:inline text-slate-400">Node-PTY: Hoạt động</span></div><div className="flex gap-6"><span>Cổng: 3000</span><span className="hidden sm:inline">Máy chủ: 127.0.0.1</span><span className="text-slate-400">UTF-8</span></div></footer>;
}

function StatusDot({ status }: { status: SocketStatus }) {
  return <span className={`w-1.5 h-1.5 rounded-full inline-block ${status === "connected" ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400 animate-pulse" : status === "error" ? "bg-rose-400" : "bg-slate-500"}`} />;
}
