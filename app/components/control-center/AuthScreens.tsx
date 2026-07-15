import type { FormEventHandler } from "react";
import { motion } from "motion/react";
import {
  AlertCircle,
  Database,
  Key,
  Lock,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from "lucide-react";

export function LoadingScreen() {
  return (
    <div className="login-ambient app-grid-bg flex flex-col items-center justify-center min-h-screen text-slate-100 font-sans">
      <div className="app-panel flex flex-col items-center px-10 py-8">
        <div className="relative mb-5">
          <div className="absolute inset-0 rounded-full bg-sky-400/20 blur-xl" />
          <RefreshCw className="relative w-8 h-8 text-sky-400 animate-spin" />
        </div>
        <p className="app-kicker mb-2">Secure handshake</p>
        <p className="text-sm text-slate-400">Đang xác thực phiên bảo mật...</p>
      </div>
    </div>
  );
}

interface LoginScreenProps {
  username: string;
  password: string;
  twoFactorChallenge: boolean;
  twoFactorCode: string;
  error: string | null;
  loading: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTwoFactorCodeChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onCancelTwoFactor: () => void;
}

export function LoginScreen({
  username,
  password,
  twoFactorChallenge,
  twoFactorCode,
  error,
  loading,
  onUsernameChange,
  onPasswordChange,
  onTwoFactorCodeChange,
  onSubmit,
  onCancelTwoFactor,
}: LoginScreenProps) {
  return (
    <motion.div
      key="login"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="login-ambient app-grid-bg fixed inset-0 flex items-center justify-center p-4 sm:p-6 z-50 overflow-y-auto"
    >
      <div className="grid w-full max-w-5xl lg:grid-cols-[1.1fr_0.9fr] app-modal overflow-hidden">
        <div className="hidden lg:flex flex-col justify-between p-10 border-r border-white/10 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.12),transparent_45%)]">
          <div>
            <div className="inline-flex items-center gap-2 app-kicker">
              <Terminal className="w-4 h-4" />
              NodeShell Control
            </div>
            <h1 className="mt-6 max-w-lg text-4xl font-semibold leading-tight tracking-tight text-white">
              Một trung tâm vận hành cho toàn bộ server của bạn.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-400">
              Terminal thời gian thực, quản lý tệp, dịch vụ hệ thống, SQLite
              Studio và nhật ký kiểm toán trong cùng một phiên bảo mật.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <Terminal className="w-4 h-4 text-sky-400" />
              <span className="mt-3 block text-[10px] uppercase tracking-wider text-slate-500">Live shell</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="mt-3 block text-[10px] uppercase tracking-wider text-slate-500">Audited</span>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <Database className="w-4 h-4 text-violet-400" />
              <span className="mt-3 block text-[10px] uppercase tracking-wider text-slate-500">Persistent</span>
            </div>
          </div>
        </div>
        <div className="relative p-6 sm:p-10">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-sky-400 via-cyan-300 to-emerald-400" />
          <div className="text-center mb-8">
            <p className="app-kicker mb-4">Authorized access only</p>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-sky-500/10 mb-5 border border-sky-500/20 shadow-[0_0_35px_rgba(56,189,248,0.08)]">
              {twoFactorChallenge ? <ShieldCheck className="w-6 h-6 text-sky-400" /> : <Lock className="w-6 h-6 text-sky-400" />}
            </div>
            <h2 className="text-lg font-semibold text-white tracking-tight">
              {twoFactorChallenge ? "Xác Thực Hai Lớp" : "Yêu Cầu Xác Thực"}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {twoFactorChallenge ? "Nhập mã 6 số hoặc mã khôi phục" : "Nhập khóa truy cập VPS để khởi tạo Node-PTY"}
            </p>
          </div>
          <form onSubmit={onSubmit} className="space-y-5">
            {!twoFactorChallenge && (
              <input type="text" required value={username} onChange={(event) => onUsernameChange(event.target.value)} placeholder="Tên đăng nhập" autoComplete="username" className="app-input w-full py-3 px-4 text-center text-white focus:outline-none" />
            )}
            <input
              type={twoFactorChallenge ? "text" : "password"}
              required
              placeholder={twoFactorChallenge ? "123456" : "••••••••••••"}
              value={twoFactorChallenge ? twoFactorCode : password}
              onChange={(event) => twoFactorChallenge ? onTwoFactorCodeChange(event.target.value) : onPasswordChange(event.target.value)}
              className="app-input w-full py-3 px-4 text-center text-white focus:outline-none tracking-widest text-lg"
              autoComplete={twoFactorChallenge ? "one-time-code" : "current-password"}
              autoFocus
            />
            {error && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="flex items-start gap-2.5 p-3 rounded-lg bg-red-950/30 border border-red-900/40 text-red-400 text-xs font-mono">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </motion.div>
            )}
            <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-bold py-3 rounded-xl transition-all shadow-[0_12px_35px_rgba(14,165,233,0.2)] disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2">
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <><Key className="w-4 h-4" /><span>{twoFactorChallenge ? "XÁC NHẬN MÃ" : "KẾT NỐI SHELL"}</span></>}
            </button>
            {twoFactorChallenge && (
              <button type="button" onClick={onCancelTwoFactor} className="w-full text-xs text-slate-500 hover:text-white">Quay lại nhập mật khẩu</button>
            )}
          </form>
          <p className="mt-6 text-[10px] text-center text-slate-600 uppercase tracking-wider font-mono">Các phiên đã xác thực được ghi nhật ký vào SQLite nội bộ</p>
        </div>
      </div>
    </motion.div>
  );
}
