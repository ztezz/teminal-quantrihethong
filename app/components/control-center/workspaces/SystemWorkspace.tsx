import { motion } from "motion/react";
import { RefreshCw } from "lucide-react";
import type { SystemProcess, SystemService, UserRole } from "../types";

interface SystemWorkspaceProps {
  view: "services" | "processes";
  services: SystemService[];
  processes: SystemProcess[];
  query: string;
  loading: boolean;
  error: string | null;
  role: UserRole;
  onViewChange: (view: "services" | "processes") => void;
  onQueryChange: (value: string) => void;
  onReload: () => void;
  onOpenServiceLogs: (unit: string) => void;
  onServiceAction: (unit: string, action: string) => void;
  onStopService: (unit: string) => void;
  onSignalProcess: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
}

export function SystemWorkspace({
  view,
  services,
  processes,
  query,
  loading,
  error,
  role,
  onViewChange,
  onQueryChange,
  onReload,
  onOpenServiceLogs,
  onServiceAction,
  onStopService,
  onSignalProcess,
}: SystemWorkspaceProps) {
  return (
    <motion.div
      key="system-tab"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="workspace-screen w-full h-full p-4 sm:p-6 overflow-y-auto"
    >
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-b border-white/10 pb-4">
          <div className="mr-auto">
            <h3 className="text-lg font-bold text-white uppercase tracking-wider">
              Quản Trị Hệ Thống
            </h3>
            <p className="text-xs text-slate-500 font-mono">
              systemd services và Linux processes
            </p>
          </div>
          <div className="flex rounded border border-white/10 overflow-hidden">
            <button
              onClick={() => onViewChange("services")}
              className={`px-3 py-2 text-xs ${view === "services" ? "bg-blue-600 text-white" : "bg-black"}`}
            >
              Services
            </button>
            <button
              onClick={() => onViewChange("processes")}
              className={`px-3 py-2 text-xs ${view === "processes" ? "bg-blue-600 text-white" : "bg-black"}`}
            >
              Processes
            </button>
          </div>
          <button
            onClick={onReload}
            className="px-3 py-2 text-xs border border-white/10 rounded"
          >
            <RefreshCw
              className={`inline w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`}
            />
            Tải lại
          </button>
        </div>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Tìm service, PID, user hoặc command..."
          className="w-full bg-black border border-white/10 rounded px-3 py-2 text-xs"
        />
        {error && (
          <div className="p-3 rounded border border-red-500/20 bg-red-500/5 text-red-400 text-xs">
            {error}
          </div>
        )}
        <div className="rounded-xl border border-white/10 overflow-x-auto bg-[#0d0d12]/60">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#111116] text-[10px] uppercase text-slate-500">
              <tr>
                {view === "services" ? (
                  <>
                    <th className="p-3">Service</th>
                    <th className="p-3">Trạng thái</th>
                    <th className="p-3">Mô tả</th>
                    <th className="p-3">Thao tác</th>
                  </>
                ) : (
                  <>
                    <th className="p-3">PID / User</th>
                    <th className="p-3">CPU / RAM</th>
                    <th className="p-3">Command</th>
                    <th className="p-3">Signal</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono">
              {loading &&
              (view === "services"
                ? services.length === 0
                : processes.length === 0)
                ? Array.from({ length: 6 }).map((_, index) => (
                    <tr
                      key={`system-skeleton-${index}`}
                      className="skeleton-row"
                    >
                      <td colSpan={4}>
                        <span />
                      </td>
                    </tr>
                  ))
                : view === "services"
                  ? services
                      .filter((service) =>
                        `${service.unit} ${service.description}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((service) => (
                        <tr key={service.unit}>
                          <td className="p-3 text-white">{service.unit}</td>
                          <td className="p-3">
                            <span
                              className={
                                service.active === "active"
                                  ? "text-emerald-400"
                                  : service.active === "failed"
                                    ? "text-red-400"
                                    : "text-amber-400"
                              }
                            >
                              {service.active}/{service.sub}
                            </span>
                          </td>
                          <td className="p-3 text-slate-400 max-w-md truncate">
                            {service.description}
                          </td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => onOpenServiceLogs(service.unit)}
                                className="text-blue-400"
                              >
                                Logs
                              </button>
                              <button
                                onClick={() =>
                                  onServiceAction(
                                    service.unit,
                                    service.active === "active"
                                      ? "restart"
                                      : "start",
                                  )
                                }
                                className="text-emerald-400"
                              >
                                {service.active === "active"
                                  ? "Restart"
                                  : "Start"}
                              </button>
                              {role === "root" && (
                                <>
                                  {service.active === "active" && (
                                    <button
                                      onClick={() =>
                                        onStopService(service.unit)
                                      }
                                      className="text-red-400"
                                    >
                                      Stop
                                    </button>
                                  )}
                                  <button
                                    onClick={() =>
                                      onServiceAction(service.unit, "disable")
                                    }
                                    className="text-amber-400"
                                  >
                                    Disable
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() =>
                                  onServiceAction(service.unit, "enable")
                                }
                                className="text-slate-400"
                              >
                                Enable
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                  : processes
                      .filter((process) =>
                        `${process.pid} ${process.user} ${process.command}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      )
                      .map((process) => (
                        <tr key={process.pid}>
                          <td className="p-3">
                            <span className="text-white">{process.pid}</span>
                            <span className="block text-[10px] text-slate-500">
                              {process.user} · PPID {process.ppid} ·{" "}
                              {process.elapsed}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className="text-blue-400">
                              {process.cpu}%
                            </span>{" "}
                            /{" "}
                            <span className="text-purple-400">
                              {process.memory}%
                            </span>
                            <span className="block text-[10px] text-slate-500">
                              {(process.rssKB / 1024).toFixed(1)} MB
                            </span>
                          </td>
                          <td className="p-3 text-slate-300 max-w-2xl break-all">
                            {process.command}
                          </td>
                          <td className="p-3">
                            <div className="flex gap-2">
                              <button
                                disabled={process.pid <= 1}
                                onClick={() =>
                                  onSignalProcess(process.pid, "SIGTERM")
                                }
                                className="text-amber-400 disabled:opacity-20"
                              >
                                TERM
                              </button>
                              {role === "root" && (
                                <button
                                  disabled={process.pid <= 1}
                                  onClick={() =>
                                    onSignalProcess(process.pid, "SIGKILL")
                                  }
                                  className="text-red-400 disabled:opacity-20"
                                >
                                  KILL
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
