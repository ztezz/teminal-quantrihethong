import { useState, type FormEventHandler, type PointerEvent } from "react";
import { motion } from "motion/react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Database,
  Eye,
  EyeOff,
  Key,
  Lock,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Wifi,
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
  const [showPassword, setShowPassword] = useState(false);
  const updateSpotlight = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--login-pointer-x", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--login-pointer-y", `${event.clientY - bounds.top}px`);
  };

  return (
    <motion.div
      key="login"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      onPointerMove={updateSpotlight}
      className="login-ambient app-grid-bg fixed inset-0 flex items-center justify-center p-3 sm:p-6 z-50 overflow-y-auto"
    >
      <div className="login-orb login-orb-one" aria-hidden="true" />
      <div className="login-orb login-orb-two" aria-hidden="true" />
      <div className="login-shell grid w-full max-w-6xl lg:grid-cols-[1.16fr_0.84fr] overflow-hidden">
        <section className="login-command-deck hidden lg:flex flex-col justify-between p-10 xl:p-12">
          <div>
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-2.5 text-xs font-semibold tracking-[0.18em] text-slate-200 uppercase">
                <span className="login-brand-mark"><Terminal className="w-4 h-4" /></span>
                NodeShell
              </div>
              <span className="login-live-badge"><i /> System online</span>
            </div>
            <p className="mt-16 text-[11px] font-mono uppercase tracking-[0.28em] text-sky-400">Operations / Access gateway</p>
            <h1 className="mt-5 max-w-xl text-5xl xl:text-[3.5rem] font-semibold leading-[1.06] tracking-[-0.045em] text-white">
              Hệ thống của bạn.<br />Một điểm kiểm soát.
            </h1>
            <p className="mt-5 max-w-lg text-[15px] leading-7 text-slate-400">
              Theo dõi tài nguyên, điều khiển terminal và quản trị dữ liệu trong một không gian vận hành được bảo vệ xuyên suốt.
            </p>
          </div>
          <div className="space-y-4">
            <div className="login-terminal-window">
              <div className="login-terminal-bar">
                <span className="bg-rose-400/80" /><span className="bg-amber-300/80" /><span className="bg-emerald-400/80" />
                <p>nodeshell / secure-channel</p>
                <Wifi className="ml-auto h-3.5 w-3.5 text-emerald-400" />
              </div>
              <div className="space-y-2.5 p-5 font-mono text-[11px]">
                <p><span className="text-sky-400">$</span> nodeshell status --secure</p>
                <p className="text-slate-500"><span className="text-emerald-400">✓</span> encrypted transport established</p>
                <p className="text-slate-500"><span className="text-emerald-400">✓</span> audit stream ready</p>
                <p className="text-slate-300"><span className="text-sky-400">›</span> awaiting operator authentication<span className="login-cursor" /></p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="login-stat"><Activity /><span>Realtime</span><strong>Monitoring</strong></div>
              <div className="login-stat"><ShieldCheck /><span>Protected</span><strong>Audit trail</strong></div>
              <div className="login-stat"><Database /><span>Integrated</span><strong>Data studio</strong></div>
            </div>
          </div>
        </section>
        <section className="login-form-panel relative flex flex-col justify-center p-6 sm:p-10 xl:p-12">
          <div className="login-mobile-brand mb-10 flex items-center justify-between lg:hidden">
            <div className="inline-flex items-center gap-2.5 text-xs font-semibold tracking-[0.16em] text-white uppercase"><span className="login-brand-mark"><Terminal className="w-4 h-4" /></span>NodeShell</div>
            <span className="login-live-badge"><i /> Online</span>
          </div>
          <motion.div
            key={twoFactorChallenge ? "two-factor" : "credentials"}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            className="mx-auto w-full max-w-sm"
          >
            <div className="mb-9">
              <div className="login-auth-icon mb-6">
                {twoFactorChallenge ? <ShieldCheck className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                <span />
              </div>
              <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.24em] text-sky-400">Secure operator access</p>
              <h2 className="mt-3 text-3xl font-semibold text-white tracking-[-0.035em]">
                {twoFactorChallenge ? "Xác minh danh tính" : "Chào mừng trở lại"}
              </h2>
              <p className="text-sm leading-6 text-slate-500 mt-2">
                {twoFactorChallenge ? "Nhập mã 6 số từ ứng dụng xác thực hoặc sử dụng mã khôi phục." : "Đăng nhập để mở phiên điều khiển server được mã hóa."}
              </p>
            </div>
            <form onSubmit={onSubmit} className="space-y-5">
            {!twoFactorChallenge && (
              <label className="login-field">
                <span>Tên đăng nhập</span>
                <div><Server className="w-4 h-4" /><input type="text" required value={username} onChange={(event) => onUsernameChange(event.target.value)} placeholder="operator" autoComplete="username" /></div>
              </label>
            )}
            <label className="login-field">
              <span>{twoFactorChallenge ? "Mã xác thực" : "Mật khẩu"}</span>
              <div>
                <Key className="w-4 h-4" />
                <input
                  type={twoFactorChallenge || showPassword ? "text" : "password"}
                  required
                  inputMode={twoFactorChallenge ? "numeric" : undefined}
                  placeholder={twoFactorChallenge ? "000 000" : "Nhập mật khẩu bảo mật"}
                  value={twoFactorChallenge ? twoFactorCode : password}
                  onChange={(event) => twoFactorChallenge ? onTwoFactorCodeChange(event.target.value) : onPasswordChange(event.target.value)}
                  className={twoFactorChallenge ? "tracking-[0.3em] font-mono" : ""}
                  autoComplete={twoFactorChallenge ? "one-time-code" : "current-password"}
                  autoFocus
                />
                {!twoFactorChallenge && <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>{showPassword ? <EyeOff /> : <Eye />}</button>}
              </div>
            </label>
            {error && (
              <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} role="alert" className="flex items-start gap-2.5 p-3 rounded-lg bg-red-950/30 border border-red-900/50 text-red-300 text-xs font-mono">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </motion.div>
            )}
            <button type="submit" disabled={loading} className="login-submit group">
              {loading ? <><RefreshCw className="w-4 h-4 animate-spin" /><span>Đang thiết lập phiên...</span></> : <><span>{twoFactorChallenge ? "Xác nhận truy cập" : "Đăng nhập hệ thống"}</span><ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>}
            </button>
            {twoFactorChallenge && (
              <button type="button" onClick={onCancelTwoFactor} className="w-full text-xs text-slate-500 hover:text-white">Quay lại đăng nhập bằng mật khẩu</button>
            )}
            </form>
            <div className="mt-8 flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-slate-600"><span className="h-px flex-1 bg-white/8" />Phiên được mã hóa và kiểm toán<span className="h-px flex-1 bg-white/8" /></div>
          </motion.div>
        </section>
      </div>
    </motion.div>
  );
}
