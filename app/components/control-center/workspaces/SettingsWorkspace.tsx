import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  Bell,
  Check,
  Copy,
  Database,
  Monitor,
  RefreshCw,
  Smartphone,
  X,
} from "lucide-react";
import { applyUiPreferences, getUiPreferences, saveUiPreferences, type UiPreferences } from "@/lib/client/preferences";
import { notificationPermission, requestNotificationPermission, type NotificationPermissionResult } from "@/lib/client/notifications";
import type { ManagedUser, SecuritySession, UserRole } from "../types";

type SaveStatus = "idle" | "saving" | "saved" | "error";
interface TerminalColors {
  background: string;
  foreground: string;
  cyan: string;
  green: string;
  yellow: string;
  cursor: string;
}
interface SecurityStatus {
  twoFactorEnabled: boolean;
  twoFactorAvailable: boolean;
  recoveryCodesRemaining: number;
  sessions: SecuritySession[];
}
interface TwoFactorSetup {
  qrCode: string;
  secret: string;
}
interface NewUser {
  username: string;
  password: string;
  role: UserRole;
}
export interface SettingsWorkspaceData {
  fontSize: number;
  theme: string;
  previewTheme: string | null;
  activePreviewTheme: string;
  saveStatus: SaveStatus;
  loading: boolean;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  passwordError: string | null;
  passwordSuccess: string | null;
  securityStatus: SecurityStatus | null;
  securityMessage: string | null;
  twoFactorPassword: string;
  twoFactorSetup: TwoFactorSetup | null;
  twoFactorCode: string;
  recoveryCodes: string[];
  currentRole?: UserRole;
  managedUsers: ManagedUser[];
  newUser: NewUser;
}
export interface SettingsWorkspaceActions {
  setFontSize: Dispatch<SetStateAction<number>>;
  setPreviewTheme: Dispatch<SetStateAction<string | null>>;
  setTheme: Dispatch<SetStateAction<string>>;
  setSaveStatus: Dispatch<SetStateAction<SaveStatus>>;
  getTerminalColors: (theme: string) => TerminalColors;
  handlePasswordChange: (event: FormEvent) => void;
  setCurrentPassword: Dispatch<SetStateAction<string>>;
  setNewPassword: Dispatch<SetStateAction<string>>;
  setConfirmPassword: Dispatch<SetStateAction<string>>;
  setTwoFactorPassword: Dispatch<SetStateAction<string>>;
  setTwoFactorCode: Dispatch<SetStateAction<string>>;
  startTwoFactorSetup: () => void;
  confirmTwoFactorSetup: () => void;
  disableTwoFactor: () => void;
  revokeSession: (id?: string) => void;
  setNewUser: Dispatch<SetStateAction<NewUser>>;
  createUser: () => void;
  updateUser: (id: string, changes: Record<string, unknown>) => void;
  deleteUser: (id: string) => void;
  copyRecoveryCodes: () => void;
  resetUserPassword: (id: string) => void;
}
export interface SettingsWorkspaceProps {
  data: SettingsWorkspaceData;
  actions: SettingsWorkspaceActions;
}
export function SettingsWorkspace({ data, actions }: SettingsWorkspaceProps) {
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(getUiPreferences);
  const [notifications, setNotifications] = useState<NotificationPermissionResult>(notificationPermission);
  useEffect(() => applyUiPreferences(uiPreferences), [uiPreferences]);
  const updateUiPreferences = (changes: Partial<UiPreferences>) => {
    const next = { ...uiPreferences, ...changes };
    setUiPreferences(next);
    saveUiPreferences(next);
  };
  const {
    fontSize,
    theme,
    previewTheme,
    activePreviewTheme,
    saveStatus,
    loading,
    currentPassword,
    newPassword,
    confirmPassword,
    passwordError: pwdError,
    passwordSuccess: pwdSuccess,
    securityStatus,
    securityMessage,
    twoFactorPassword,
    twoFactorSetup,
    twoFactorCode,
    recoveryCodes,
    currentRole,
    managedUsers,
    newUser,
  } = data;
  const currentUser = currentRole ? { role: currentRole } : null;
  const {
    setFontSize,
    setPreviewTheme,
    setTheme,
    setSaveStatus,
    getTerminalColors,
    handlePasswordChange,
    setCurrentPassword,
    setNewPassword,
    setConfirmPassword,
    setTwoFactorPassword,
    setTwoFactorCode,
    startTwoFactorSetup,
    confirmTwoFactorSetup,
    disableTwoFactor,
    revokeSession,
    setNewUser,
    createUser,
    updateUser,
    deleteUser,
    copyRecoveryCodes,
    resetUserPassword,
  } = actions;
  return (
    <motion.div
      key="settings-tab"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="workspace-screen w-full h-full p-4 sm:p-8 overflow-y-auto"
    >
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="app-panel p-4 sm:p-6 space-y-5">
          <div>
            <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1">Trải Nghiệm Giao Diện</h3>
            <p className="text-xs text-slate-500 font-mono">Áp dụng ngay trên trình duyệt này và lưu cục bộ</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs text-slate-400">
              Mật độ hiển thị
              <select value={uiPreferences.density} onChange={(event) => updateUiPreferences({ density: event.target.value as UiPreferences["density"] })} className="mt-2 w-full rounded border border-white/10 bg-black px-3 py-2.5 text-sm text-slate-200">
                <option value="comfortable">Thoải mái</option>
                <option value="compact">Gọn</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-4 rounded border border-white/10 bg-black/40 px-4 py-3 text-xs text-slate-300">
              <span><span className="block font-semibold text-white">Giảm chuyển động</span><span className="mt-1 block text-[10px] text-slate-500">Tắt animation và transition không thiết yếu</span></span>
              <input type="checkbox" checked={uiPreferences.reduceAnimation} onChange={(event) => updateUiPreferences({ reduceAnimation: event.target.checked })} className="accent-blue-500" />
            </label>
          </div>
          <div className="flex flex-col gap-3 rounded border border-white/10 bg-black/40 p-4 sm:flex-row sm:items-center">
            <Bell className="h-4 w-4 text-blue-400" />
            <div className="mr-auto"><p className="text-xs font-semibold text-white">Thông báo trình duyệt</p><p className="mt-1 text-[10px] text-slate-500">Trạng thái: {notifications === "granted" ? "đã cho phép" : notifications === "denied" ? "đã chặn" : notifications === "unsupported" ? "không hỗ trợ" : "chưa chọn"}</p></div>
            <button type="button" disabled={notifications !== "default"} onClick={async () => setNotifications(await requestNotificationPermission())} className="rounded bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">Bật thông báo</button>
          </div>
        </div>
        {/* Section 1: Terminal UI Styles */}
        <div className="app-panel p-4 sm:p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
            <div>
              <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1">
                Tùy biến dòng lệnh
              </h3>
              <p className="text-xs text-slate-500 font-mono">
                Chỉnh sửa các tùy chọn thiết lập được lưu vào cấu hình cục bộ
              </p>
            </div>
            <AnimatePresence>
              {saveStatus !== "idle" && (
                <motion.div
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="flex items-center gap-1.5 text-xs font-mono select-none self-start sm:self-auto"
                  id="settings-save-status"
                >
                  {saveStatus === "saving" && (
                    <span className="flex items-center gap-1.5 text-blue-400">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Đang tự động lưu...</span>
                    </span>
                  )}
                  {saveStatus === "saved" && (
                    <span className="flex items-center gap-1.5 text-emerald-400">
                      <Database className="w-3.5 h-3.5 animate-pulse" />
                      <span>Đã lưu vào máy chủ</span>
                    </span>
                  )}
                  {saveStatus === "error" && (
                    <span className="flex items-center gap-1.5 text-rose-400">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Lỗi lưu cơ sở dữ liệu</span>
                    </span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">
                Thanh Chọn Cỡ Chữ
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="12"
                  max="24"
                  value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="flex-1 accent-blue-500 cursor-pointer"
                />
                <span className="font-mono text-sm font-semibold bg-black px-3 py-1.5 rounded border border-white/10 w-12 text-center text-white">
                  {fontSize}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">
                Chủ Đề Màu Sắc
              </label>
              <select
                value={activePreviewTheme}
                onChange={(e) => setPreviewTheme(e.target.value)}
                className="w-full py-2.5 px-3 bg-black border border-white/10 rounded text-sm text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="dark-classic">
                  Mặc định Phiến đá (Tối cổ điển)
                </option>
                <option value="matrix">Xanh lục Ma trận (Cổ điển)</option>
                <option value="amber">Cam Hổ phách (CRT Phosphor)</option>
                <option value="cyberpunk">Neon Cyberpunk (Xanh & Hồng)</option>
                <option value="dracula">Dracula (Tím cổ điển)</option>
                <option value="tokyo-night">Tokyo Night (Xanh đêm)</option>
                <option value="nord">Nord (Băng giá dịu mắt)</option>
                <option value="solarized-dark">
                  Solarized Dark (Tối cân bằng)
                </option>
                <option value="solarized-light">
                  Solarized Light (Sáng dịu mắt)
                </option>
                <option value="gruvbox">Gruvbox (Retro ấm)</option>
                <option value="one-dark">One Dark (Phong cách Atom)</option>
                <option value="github-light">
                  GitHub Light (Sáng tối giản)
                </option>
              </select>
            </div>
          </div>

          {/* Live Theme Preview */}
          <div className="border-t border-white/5 pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-[10px] uppercase font-bold text-slate-500">
                Trực quan hóa Chủ đề (Live Preview)
              </label>
              {activePreviewTheme !== theme && (
                <span className="text-[10px] text-amber-400 font-mono italic animate-pulse">
                  Chủ đề chưa được áp dụng
                </span>
              )}
            </div>

            <div
              style={{
                backgroundColor:
                  getTerminalColors(activePreviewTheme).background,
                color: getTerminalColors(activePreviewTheme).foreground,
              }}
              className="rounded-lg p-5 font-mono text-xs border border-white/10 shadow-inner select-none flex flex-col justify-between transition-all duration-300 min-h-[160px]"
              id="terminal-theme-preview"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 mb-3 pb-2 border-b border-white/5 opacity-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/80"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/80"></div>
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 ml-1">
                    Cửa sổ xem trước
                  </span>
                </div>
                <p className="flex items-center gap-1 flex-wrap">
                  <span
                    style={{
                      color: getTerminalColors(activePreviewTheme).cyan,
                    }}
                  >
                    visitor@nodeshell:~$
                  </span>
                  <span>cat welcome.txt</span>
                </p>
                <p
                  style={{
                    color: getTerminalColors(activePreviewTheme).green,
                  }}
                >
                  ✔ VPS connected on secure tunnel.
                </p>
                <p className="flex items-center gap-1 flex-wrap">
                  <span
                    style={{
                      color: getTerminalColors(activePreviewTheme).cyan,
                    }}
                  >
                    visitor@nodeshell:~$
                  </span>
                  <span
                    style={{
                      color: getTerminalColors(activePreviewTheme).yellow,
                    }}
                  >
                    node --version
                  </span>
                </p>
                <p className="flex items-center">
                  <span>v20.11.0</span>
                  <span
                    style={{
                      backgroundColor:
                        getTerminalColors(activePreviewTheme).cursor,
                    }}
                    className="inline-block w-2 h-4 ml-1.5 animate-pulse align-middle"
                  />
                </p>
              </div>
              <div className="text-[9px] text-slate-500 text-right opacity-60 font-mono mt-4">
                Mã nền: {getTerminalColors(activePreviewTheme).background} | Mã
                chữ: {getTerminalColors(activePreviewTheme).foreground} | Mã con
                trỏ: {getTerminalColors(activePreviewTheme).cursor}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPreviewTheme(null)}
                disabled={previewTheme === null}
                className="px-4 py-2 text-xs font-semibold rounded bg-[#111116] hover:bg-[#1a1a24] text-slate-400 hover:text-white border border-white/10 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
              >
                Hoàn tác thay đổi
              </button>
              <button
                type="button"
                onClick={() => {
                  setTheme(activePreviewTheme);
                  setPreviewTheme(null);
                }}
                disabled={activePreviewTheme === theme}
                className="px-4 py-2 text-xs font-semibold rounded bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/10 transition disabled:bg-emerald-600/20 disabled:text-emerald-400/80 disabled:shadow-none disabled:border disabled:border-emerald-500/10 cursor-pointer flex items-center gap-1.5"
                id="btn-apply-theme"
              >
                {activePreviewTheme === theme ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Chủ đề đang áp dụng</span>
                  </>
                ) : (
                  <span>Áp dụng chủ đề</span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Section 2: Password Management */}
        <div className="p-6 rounded-xl border border-white/10 bg-[#111116]/40 space-y-6">
          <div>
            <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1">
              Thay Đổi Khóa Truy Cập
            </h3>
            <p className="text-xs text-slate-500 font-mono">
              Cập nhật mật khẩu chính để bảo vệ quyền truy cập Node-PTY
            </p>
          </div>

          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-mono">
                  Mật khẩu hiện tại
                </label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-black border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-mono">
                  Mật khẩu mới
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-black border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-mono">
                  Xác nhận mật khẩu
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-black border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {pwdError && (
              <div className="flex items-start gap-2.5 p-3 rounded bg-red-950/30 border border-red-900/40 text-red-400 text-xs font-mono">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{pwdError}</span>
              </div>
            )}

            {pwdSuccess && (
              <div className="flex items-start gap-2.5 p-3 rounded bg-emerald-950/30 border border-emerald-900/40 text-emerald-400 text-xs font-mono">
                <Check className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{pwdSuccess}</span>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-5 rounded text-xs transition cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  "CẬP NHẬT KHÓA CHÍNH"
                )}
              </button>
            </div>
          </form>
        </div>

        <div className="p-6 rounded-xl border border-white/10 bg-[#111116]/40 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1">
                Xác Thực Hai Lớp
              </h3>
              <p className="text-xs text-slate-500 font-mono">
                TOTP tương thích Google Authenticator, Authy và 1Password
              </p>
            </div>
            <span
              className={`px-2 py-1 rounded text-[10px] font-bold uppercase border ${securityStatus?.twoFactorEnabled ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-slate-400 bg-white/5 border-white/10"}`}
            >
              {securityStatus?.twoFactorEnabled ? "Đã bật" : "Đang tắt"}
            </span>
          </div>

          {securityMessage && (
            <div className="p-3 rounded bg-blue-950/30 border border-blue-900/40 text-blue-300 text-xs font-mono">
              {securityMessage}
            </div>
          )}
          {securityStatus && !securityStatus.twoFactorAvailable && (
            <div className="p-3 rounded bg-amber-950/30 border border-amber-900/40 text-amber-300 text-xs font-mono">
              Backend cần biến AUTH_ENCRYPTION_KEY dài ít nhất 32 ký tự để bật
              2FA.
            </div>
          )}

          {!securityStatus?.twoFactorEnabled ? (
            <div className="space-y-4">
              {!twoFactorSetup ? (
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="password"
                    value={twoFactorPassword}
                    onChange={(e) => setTwoFactorPassword(e.target.value)}
                    placeholder="Mật khẩu hiện tại"
                    className="flex-1 px-3 py-2 bg-black border border-white/10 rounded text-sm text-white"
                  />
                  <button
                    type="button"
                    disabled={
                      !securityStatus?.twoFactorAvailable || !twoFactorPassword
                    }
                    onClick={startTwoFactorSetup}
                    className="px-4 py-2 rounded bg-blue-600 text-white text-xs font-semibold disabled:opacity-40"
                  >
                    <Smartphone className="w-4 h-4 inline mr-2" />
                    Thiết lập ứng dụng
                  </button>
                </div>
              ) : (
                <div className="grid md:grid-cols-[180px_1fr] gap-5 items-center">
                  {/* QR code is generated locally by the authenticated backend. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={twoFactorSetup.qrCode}
                    alt="QR thiết lập TOTP"
                    className="w-44 h-44 rounded bg-white p-2"
                  />
                  <div className="space-y-3 min-w-0">
                    <p className="text-xs text-slate-400">
                      Quét QR rồi nhập mã 6 số để xác nhận. Có thể nhập secret
                      thủ công:
                    </p>
                    <code className="block p-2 bg-black rounded text-xs text-blue-300 break-all select-all">
                      {twoFactorSetup.secret}
                    </code>
                    <div className="flex gap-2">
                      <input
                        value={twoFactorCode}
                        onChange={(e) => setTwoFactorCode(e.target.value)}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        className="flex-1 px-3 py-2 bg-black border border-white/10 rounded text-center tracking-widest"
                      />
                      <button
                        type="button"
                        onClick={confirmTwoFactorSetup}
                        className="px-4 bg-emerald-600 rounded text-xs font-semibold text-white"
                      >
                        Xác nhận bật
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Còn {securityStatus.recoveryCodesRemaining} mã khôi phục. Để tắt
                2FA, nhập mật khẩu và mã TOTP hoặc recovery code.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  type="password"
                  value={twoFactorPassword}
                  onChange={(e) => setTwoFactorPassword(e.target.value)}
                  placeholder="Mật khẩu hiện tại"
                  className="px-3 py-2 bg-black border border-white/10 rounded text-sm"
                />
                <input
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  placeholder="Mã xác thực"
                  className="px-3 py-2 bg-black border border-white/10 rounded text-sm"
                />
              </div>
              <button
                type="button"
                onClick={disableTwoFactor}
                className="px-4 py-2 rounded bg-red-600/80 text-white text-xs font-semibold"
              >
                Tắt xác thực hai lớp
              </button>
            </div>
          )}

          {recoveryCodes.length > 0 && (
            <div className="p-4 rounded border border-amber-500/30 bg-amber-500/5 space-y-3">
              <p className="text-xs font-semibold text-amber-300">
                Các mã này chỉ hiển thị một lần. Lưu ở nơi an toàn.
              </p>
              <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                {recoveryCodes.map((code) => (
                  <code
                    key={code}
                    className="bg-black p-2 rounded text-center select-all"
                  >
                    {code}
                  </code>
                ))}
              </div>
              <button
                type="button"
                onClick={copyRecoveryCodes}
                className="text-xs text-amber-300"
              >
                <Copy className="inline w-3.5 h-3.5 mr-1" />
                Sao chép tất cả
              </button>
            </div>
          )}
        </div>

        <div className="p-6 rounded-xl border border-white/10 bg-[#111116]/40 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1">
                Phiên Đăng Nhập
              </h3>
              <p className="text-xs text-slate-500 font-mono">
                Phiên tự hết hạn sau 12 giờ
              </p>
            </div>
            <button
              type="button"
              onClick={() => revokeSession()}
              className="px-3 py-2 text-xs rounded bg-red-600/15 text-red-300 border border-red-500/20"
            >
              Thu hồi phiên khác
            </button>
          </div>
          <div className="space-y-2">
            {securityStatus?.sessions.map((session) => (
              <div
                key={session.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-black/50 rounded border border-white/5"
              >
                <Monitor className="w-4 h-4 text-blue-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">
                    {session.username && (
                      <span className="text-blue-400 mr-2">
                        {session.username}
                      </span>
                    )}
                    {session.userAgent}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    {session.ip} · tạo{" "}
                    {new Date(session.createdAt).toLocaleString()} · hết hạn{" "}
                    {new Date(session.expiresAt).toLocaleString()}
                  </div>
                </div>
                {session.current ? (
                  <span className="text-[10px] text-emerald-400">
                    Phiên hiện tại
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => revokeSession(session.id)}
                    className="text-xs text-red-400"
                  >
                    Thu hồi
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {currentUser?.role === "root" && (
          <div className="p-6 rounded-xl border border-white/10 bg-[#111116]/40 space-y-5">
            <div>
              <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1">
                Quản Lý Người Dùng
              </h3>
              <p className="text-xs text-slate-500 font-mono">
                Viewer chỉ xem; Operator sửa file; Admin có terminal; Root toàn
                quyền.
              </p>
            </div>
            <div className="grid sm:grid-cols-4 gap-2">
              <input
                value={newUser.username}
                onChange={(e) =>
                  setNewUser({
                    ...newUser,
                    username: e.target.value,
                  })
                }
                placeholder="Username"
                className="bg-black border border-white/10 rounded px-3 py-2 text-xs"
              />
              <input
                type="password"
                value={newUser.password}
                onChange={(e) =>
                  setNewUser({
                    ...newUser,
                    password: e.target.value,
                  })
                }
                placeholder="Mật khẩu ≥ 12 ký tự"
                className="bg-black border border-white/10 rounded px-3 py-2 text-xs"
              />
              <select
                value={newUser.role}
                onChange={(e) =>
                  setNewUser({
                    ...newUser,
                    role: e.target.value as UserRole,
                  })
                }
                className="bg-black border border-white/10 rounded px-3 py-2 text-xs"
              >
                <option value="viewer">Viewer</option>
                <option value="operator">Operator</option>
                <option value="admin">Admin</option>
                <option value="root">Root</option>
              </select>
              <button
                onClick={createUser}
                className="bg-blue-600 rounded text-xs font-semibold"
              >
                Tạo tài khoản
              </button>
            </div>
            <div className="space-y-2">
              {managedUsers.map((user) => (
                <div
                  key={user.id}
                  className="grid sm:grid-cols-[1fr_120px_90px_auto] items-center gap-3 bg-black/50 border border-white/5 rounded p-3"
                >
                  <div>
                    <div className="text-sm text-white">
                      {user.username}{" "}
                      {user.id === "root" && (
                        <span className="text-[9px] text-red-400">PRIMARY</span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {user.sessions} phiên · 2FA{" "}
                      {user.twoFactorEnabled ? "bật" : "tắt"} · tạo{" "}
                      {new Date(user.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <select
                    value={user.role}
                    disabled={user.id === "root"}
                    onChange={(e) =>
                      updateUser(user.id, {
                        role: e.target.value,
                      })
                    }
                    className="bg-black border border-white/10 rounded px-2 py-1.5 text-xs disabled:opacity-50"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="operator">Operator</option>
                    <option value="admin">Admin</option>
                    <option value="root">Root</option>
                  </select>
                  <button
                    disabled={user.id === "root"}
                    onClick={() =>
                      updateUser(user.id, {
                        enabled: !user.enabled,
                      })
                    }
                    className={`text-xs ${user.enabled ? "text-emerald-400" : "text-slate-500"} disabled:opacity-30`}
                  >
                    {user.enabled ? "Đang bật" : "Đã khóa"}
                  </button>
                  <div className="flex gap-2">
                    {user.id !== "root" && (
                      <>
                        <button
                          onClick={() => resetUserPassword(user.id)}
                          className="text-xs text-blue-400"
                        >
                          Reset MK
                        </button>
                        <button
                          onClick={() => deleteUser(user.id)}
                          className="text-xs text-red-400"
                        >
                          Xóa
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Floating Toast Notification */}
        <AnimatePresence>
          {saveStatus === "saved" && (
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-[#0d0d12] border border-emerald-500/30 text-slate-100 px-5 py-3.5 rounded-lg shadow-2xl shadow-black max-w-sm pointer-events-auto"
              id="settings-save-toast"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                <Database className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Đã lưu tự động
                </h4>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  Cấu hình giao diện đã đồng bộ thành công vào máy chủ.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSaveStatus("idle")}
                className="text-slate-500 hover:text-slate-300 transition-colors p-1 cursor-pointer"
                title="Đóng thông báo"
                id="btn-close-save-toast"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
