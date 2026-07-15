import { motion } from "motion/react";
import { RefreshCw } from "lucide-react";
import type { LogEntry } from "../types";

interface LogIntegrity {
  valid: boolean;
  checked: number;
  brokenAt?: number;
}

interface LogsWorkspaceProps {
  logs: LogEntry[];
  total: number;
  offset: number;
  query: string;
  category: string;
  level: string;
  result: string;
  integrity: LogIntegrity | null;
  onQueryChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onLevelChange: (value: string) => void;
  onResultChange: (value: string) => void;
  onLoad: (offset: number) => void;
  onCheckIntegrity: () => void;
  onExport: (format: "json" | "csv") => void;
}

export function LogsWorkspace({
  logs,
  total,
  offset,
  query,
  category,
  level,
  result,
  integrity,
  onQueryChange,
  onCategoryChange,
  onLevelChange,
  onResultChange,
  onLoad,
  onCheckIntegrity,
  onExport,
}: LogsWorkspaceProps) {
  return (
    <motion.div
      key="logs-tab"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="workspace-screen w-full h-full p-4 sm:p-8 overflow-y-auto"
    >
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="workspace-heading flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white uppercase tracking-wider mb-1">
              Nhật Ký Kiểm Toán
            </h3>
            <p className="text-xs text-slate-500 font-mono">
              {total} sự kiện xác thực, terminal và filesystem
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onCheckIntegrity}
              className={`px-3 py-1.5 text-xs border rounded ${integrity?.valid === false ? "text-red-400 border-red-500/30" : integrity?.valid ? "text-emerald-400 border-emerald-500/30" : "border-white/10"}`}
            >
              {integrity
                ? integrity.valid
                  ? `Chuỗi hợp lệ (${integrity.checked})`
                  : `Chuỗi lỗi tại #${integrity.brokenAt}`
                : "Kiểm tra toàn vẹn"}
            </button>
            <button
              onClick={() => onExport("json")}
              className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded"
            >
              JSON
            </button>
            <button
              onClick={() => onExport("csv")}
              className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded"
            >
              CSV
            </button>
            <button
              onClick={() => onLoad(offset)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111116] text-xs border border-white/10 rounded"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Tải lại
            </button>
          </div>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onLoad(0);
          }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2"
        >
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Tìm sự kiện, IP, lệnh..."
            className="lg:col-span-2 bg-black border border-white/10 rounded px-3 py-2 text-xs"
          />
          <select
            value={category}
            onChange={(event) => onCategoryChange(event.target.value)}
            className="bg-black border border-white/10 rounded px-3 py-2 text-xs"
          >
            <option value="">Mọi nhóm</option>
            <option value="auth">Xác thực</option>
            <option value="security">Bảo mật</option>
            <option value="terminal">Terminal</option>
            <option value="file">Tệp tin</option>
            <option value="legacy">Cũ</option>
          </select>
          <select
            value={level}
            onChange={(event) => onLevelChange(event.target.value)}
            className="bg-black border border-white/10 rounded px-3 py-2 text-xs"
          >
            <option value="">Mọi mức</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
          <div className="flex gap-2">
            <select
              value={result}
              onChange={(event) => onResultChange(event.target.value)}
              className="min-w-0 flex-1 bg-black border border-white/10 rounded px-2 py-2 text-xs"
            >
              <option value="">Mọi kết quả</option>
              <option value="success">Thành công</option>
              <option value="failure">Thất bại</option>
            </select>
            <button type="submit" className="px-3 bg-blue-600 rounded text-xs">
              Lọc
            </button>
          </div>
        </form>

        <div className="app-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-[#111116]/80 border-b border-white/10 text-[10px] text-slate-500 font-mono uppercase tracking-widest">
                  <th className="py-3.5 px-4 font-semibold">Mức / Nhóm</th>
                  <th className="py-3.5 px-4 font-semibold">Mô tả sự kiện</th>
                  <th className="py-3.5 px-5 font-semibold">Địa chỉ IP</th>
                  <th className="py-3.5 px-5 font-semibold">Thời gian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono text-xs">
                {logs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-12 text-center text-slate-600 font-mono italic"
                    >
                      Không có sự kiện phù hợp.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr
                      key={log.id}
                      className="hover:bg-white/[0.02] transition align-top"
                    >
                      <td className="py-3.5 px-4">
                        <span
                          className={`block w-fit rounded px-1.5 py-0.5 text-[9px] uppercase ${log.level === "critical" ? "bg-red-500/15 text-red-400" : log.level === "warning" ? "bg-amber-500/15 text-amber-400" : "bg-blue-500/10 text-blue-400"}`}
                        >
                          {log.level}
                        </span>
                        <span className="block mt-1 text-[10px] text-slate-500">
                          {log.category}/{log.action}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-300">
                        <div>{log.event}</div>
                        {log.metadata && (
                          <code className="block mt-1 max-w-xl whitespace-pre-wrap break-all text-[10px] text-slate-500">
                            {JSON.stringify(log.metadata)}
                          </code>
                        )}
                        <span
                          className={`mt-1 inline-block text-[9px] ${log.result === "failure" ? "text-red-400" : "text-emerald-500"}`}
                        >
                          {log.result}
                        </span>
                      </td>
                      <td className="py-3.5 px-5 text-blue-400 font-semibold">
                        {log.ip}
                      </td>
                      <td className="py-3.5 px-5 text-slate-500">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {total
              ? `${offset + 1}-${Math.min(offset + logs.length, total)} / ${total}`
              : "0 kết quả"}
          </span>
          <div className="flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => onLoad(Math.max(0, offset - 50))}
              className="px-3 py-1.5 border border-white/10 rounded disabled:opacity-30"
            >
              Trước
            </button>
            <button
              disabled={offset + logs.length >= total}
              onClick={() => onLoad(offset + 50)}
              className="px-3 py-1.5 border border-white/10 rounded disabled:opacity-30"
            >
              Sau
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
