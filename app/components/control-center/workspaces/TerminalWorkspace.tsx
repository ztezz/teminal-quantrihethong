import type { RefObject } from "react";
import { motion } from "motion/react";
import { Download, Minus, Plus, Trash2 } from "lucide-react";

interface TerminalWorkspaceProps {
  terminalRef: RefObject<HTMLDivElement | null>;
  autoScroll: boolean;
  fontSize: number;
  onInsertCommand: (command: string) => void;
  onAutoScrollChange: (enabled: boolean) => void;
  onExportHistory: () => void;
  onClear: () => void;
  onDecreaseFontSize: () => void;
  onIncreaseFontSize: () => void;
}

export function TerminalWorkspace({
  terminalRef,
  autoScroll,
  fontSize,
  onInsertCommand,
  onAutoScrollChange,
  onExportHistory,
  onClear,
  onDecreaseFontSize,
  onIncreaseFontSize,
}: TerminalWorkspaceProps) {
  return (
    <motion.div
      key="terminal-tab"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full p-3 sm:p-6 flex flex-col"
    >
      {/* Quick Commands & Info Header Bar */}
      <div className="app-panel flex flex-col sm:flex-row items-start sm:items-center justify-between border-b-0 rounded-b-none px-4 py-3 gap-3 shrink-0">
        <div className="flex items-center gap-2 font-mono text-xs text-white">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Phiên dòng lệnh chuẩn (tty)</span>
        </div>

        {/* Quick Commands Selector */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-[10px] uppercase font-bold text-slate-500 font-mono whitespace-nowrap">
            Lệnh nhanh:
          </span>
          <select
            onChange={(event) => {
              const value = event.target.value;
              if (value) {
                onInsertCommand(value);
                event.target.value = "";
              }
            }}
            className="w-full sm:w-64 bg-black hover:bg-[#111116] border border-white/10 hover:border-white/20 text-xs font-mono text-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 transition cursor-pointer"
            defaultValue=""
            id="select-quick-commands"
          >
            <option value="" disabled>
              -- Chọn lệnh nhanh --
            </option>
            <optgroup
              label="Hệ Thống & Tài Nguyên"
              className="text-slate-400 bg-[#0d0d12]"
            >
              <option value="top" className="text-white">
                top (Giám sát quy trình)
              </option>
              <option value="df -h" className="text-white">
                df -h (Xem dung lượng đĩa)
              </option>
              <option value="free -m" className="text-white">
                free -m (Xem RAM trống)
              </option>
              <option value="uname -a" className="text-white">
                uname -a (Thông tin kernel)
              </option>
              <option value="uptime" className="text-white">
                uptime (Thời gian hoạt động)
              </option>
            </optgroup>
            <optgroup
              label="Tệp Tin & Thư Mục"
              className="text-slate-400 bg-[#0d0d12]"
            >
              <option value="ls -la" className="text-white">
                ls -la (Liệt kê tệp chi tiết)
              </option>
              <option value="pwd" className="text-white">
                pwd (Đường dẫn hiện tại)
              </option>
            </optgroup>
            <optgroup
              label="Mạng & Kết Nối"
              className="text-slate-400 bg-[#0d0d12]"
            >
              <option value="ping -c 4 google.com" className="text-white">
                ping -c 4 google.com (Kiểm tra mạng)
              </option>
              <option value="ifconfig" className="text-white">
                ifconfig (Cấu hình mạng)
              </option>
              <option value="netstat -tuln" className="text-white">
                netstat -tuln (Cổng đang mở)
              </option>
            </optgroup>
            <optgroup
              label="Phát Triển & Quản Lý"
              className="text-slate-400 bg-[#0d0d12]"
            >
              <option value="node -v" className="text-white">
                node -v (Phiên bản Node.js)
              </option>
              <option value="npm -v" className="text-white">
                npm -v (Phiên bản NPM)
              </option>
              <option value="git status" className="text-white">
                git status (Trạng thái Git)
              </option>
            </optgroup>
          </select>
        </div>
      </div>

      {/* Terminal wrapper */}
      <div className="flex-1 min-h-0 rounded-b-2xl bg-[#030609] border border-white/10 overflow-hidden relative p-2 sm:p-4 shadow-[0_24px_70px_rgba(0,0,0,0.35)]">
        <div
          ref={terminalRef}
          className="w-full h-full [&_.xterm-viewport]:!overflow-y-auto"
          title="Chuột phải: sao chép vùng chọn hoặc dán | Ctrl+Shift+C / Ctrl+Shift+V"
        />
      </div>
      <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between text-[11px] text-slate-500 font-mono px-1 gap-2">
        <span className="text-emerald-500/80 font-semibold">
          [HỆ THỐNG] Chuột phải: sao chép vùng chọn hoặc dán |
          Ctrl+Shift+C / Ctrl+Shift+V
        </span>
        <div className="flex items-center gap-3 flex-wrap">
          <label
            className="flex items-center gap-1.5 select-none cursor-pointer text-slate-400 hover:text-slate-300 transition-colors"
            id="label-autoscroll"
          >
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(event) => onAutoScrollChange(event.target.checked)}
              className="w-3.5 h-3.5 rounded border-white/10 bg-[#111116] text-blue-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-blue-500"
              id="toggle-autoscroll"
            />
            <span>Tự động cuộn</span>
          </label>
          <span className="text-slate-700">|</span>
          <button
            onClick={onExportHistory}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-600/10 text-blue-400 border border-blue-500/20 hover:bg-blue-600/20 hover:text-blue-300 cursor-pointer transition-colors"
            title="Xuất lịch sử terminal"
            id="btn-export-terminal"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Xuất log</span>
          </button>
          <button
            onClick={onClear}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-rose-600/10 text-rose-400 border border-rose-500/20 hover:bg-rose-600/20 hover:text-rose-300 cursor-pointer transition-colors"
            title="Xóa sạch màn hình terminal"
            id="btn-clear-terminal"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Xóa màn hình</span>
          </button>
          <span className="text-slate-700">|</span>
          <button
            onClick={onDecreaseFontSize}
            className="p-1 rounded bg-[#111116] hover:bg-[#1c1c24] border border-white/10 cursor-pointer transition-colors"
            title="Giảm cỡ chữ"
            id="btn-decrease-font"
          >
            <Minus className="w-3 h-3 text-slate-400" />
          </button>
          <span>Cỡ chữ: {fontSize}px</span>
          <button
            onClick={onIncreaseFontSize}
            className="p-1 rounded bg-[#111116] hover:bg-[#1c1c24] border border-white/10 cursor-pointer transition-colors"
            title="Tăng cỡ chữ"
            id="btn-increase-font"
          >
            <Plus className="w-3 h-3 text-slate-400" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
