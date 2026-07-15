import type { CSSProperties, RefObject } from "react";
import { AlertCircle, Check, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import type {
  ConfirmPrompt,
  ContextMenuState,
  PaletteAction,
  ToastItem,
} from "./types";

interface CommandPaletteProps {
  open: boolean;
  query: string;
  actions: PaletteAction[];
  inputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onClose: () => void;
}

export function CommandPalette({ open, query, actions, inputRef, onQueryChange, onClose }: CommandPaletteProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-start justify-center p-3 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Bảng lệnh" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="command-palette app-modal w-full max-w-xl overflow-hidden">
        <div className="flex items-center gap-3 border-b border-white/10 px-4">
          <Search className="w-4 h-4 text-sky-400" />
          <input ref={inputRef} value={query} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && actions[0]) actions[0].run(); }} placeholder="Tìm workspace hoặc thao tác..." className="h-14 min-w-0 flex-1 bg-transparent text-sm text-white outline-none" aria-label="Tìm lệnh" />
          <kbd>Esc</kbd>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {actions.map((action) => <button key={action.label} onClick={action.run} className="palette-action"><span>{action.label}</span><kbd>{action.hint}</kbd></button>)}
          {!actions.length && <p className="p-8 text-center text-xs text-slate-500">Không tìm thấy thao tác.</p>}
        </div>
        <div className="border-t border-white/10 px-4 py-2 text-[10px] text-slate-600 font-mono">Enter để mở · Alt+1..6 chuyển workspace</div>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  prompt: ConfirmPrompt | null;
  text: string;
  onTextChange: (value: string) => void;
  onClose: (confirmed: boolean) => void;
}

export function ConfirmDialog({ prompt, text, onTextChange, onClose }: ConfirmDialogProps) {
  if (!prompt) return null;
  return (
    <div className="fixed inset-0 z-[130] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <form onSubmit={(event) => { event.preventDefault(); if (!prompt.requiredText || text === prompt.requiredText) onClose(true); }} className={`app-modal w-full max-w-md p-6 space-y-5 ${prompt.danger ? "!border-rose-500/30" : ""}`}>
        <div className="flex items-start gap-3"><AlertCircle className={`w-5 h-5 shrink-0 ${prompt.danger ? "text-rose-400" : "text-sky-400"}`} /><div><h3 id="confirm-title" className="font-bold text-white">{prompt.title || "Xác nhận thao tác"}</h3><p id="confirm-message" className="mt-2 text-sm leading-6 text-slate-400">{prompt.message}</p></div></div>
        {prompt.requiredText && <label className="block text-xs text-slate-400">Nhập <code className="text-rose-300 break-all">{prompt.requiredText}</code> để tiếp tục<input autoFocus value={text} onChange={(event) => onTextChange(event.target.value)} className="mt-2 w-full bg-black border border-white/10 rounded px-3 py-2 text-sm text-white font-mono" autoComplete="off" /></label>}
        <div className="flex justify-end gap-2"><button type="button" autoFocus={!prompt.requiredText} onClick={() => onClose(false)} className="px-4 py-2 text-xs border border-white/10 rounded">Hủy</button><button type="submit" disabled={Boolean(prompt.requiredText && text !== prompt.requiredText)} className={`px-4 py-2 text-xs font-bold rounded disabled:opacity-30 ${prompt.danger ? "bg-rose-600 text-white" : "bg-sky-500 text-black"}`}>{prompt.confirmLabel || "Xác nhận"}</button></div>
      </form>
    </div>
  );
}

interface ContextMenuProps {
  menu: ContextMenuState | null;
  role?: string;
  selectedSqlite: string;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onLoadFiles: (path: string) => void;
  onDownloadFile: (path: string) => void;
  onMoveFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onOpenSqlite: (path: string) => void;
  onOpenSqliteOperations: (path: string) => void;
  onDeleteSqlite: (path: string) => void;
  onBrowseObject: (database: string, name: string) => void;
  onCopySchema: (value: string) => Promise<void>;
  onDropTable: (name: string) => void;
}

export function ContextMenu({ menu, role, selectedSqlite, onClose, onOpenFile, onLoadFiles, onDownloadFile, onMoveFile, onDeleteFile, onOpenSqlite, onOpenSqliteOperations, onDeleteSqlite, onBrowseObject, onCopySchema, onDropTable }: ContextMenuProps) {
  if (!menu) return null;
  const run = (action: () => void) => { action(); onClose(); };
  return (
    <div className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
      <p className="context-menu-title">{menu.item.name}</p>
      {menu.kind === "file" && <><button role="menuitem" onClick={() => run(() => menu.item.isDirectory ? onLoadFiles(menu.item.path) : onOpenFile(menu.item.path))}>{menu.item.isDirectory ? "Mở thư mục" : "Xem tệp"}</button>{!menu.item.isDirectory && <button role="menuitem" onClick={() => run(() => onDownloadFile(menu.item.path))}>Tải xuống</button>}{role !== "viewer" && <button role="menuitem" onClick={() => run(() => onMoveFile(menu.item.path))}>Đổi tên</button>}{role !== "viewer" && <button role="menuitem" className="danger" onClick={() => run(() => onDeleteFile(menu.item.path))}>Xóa</button>}</>}
      {menu.kind === "database" && <><button role="menuitem" onClick={() => run(() => onOpenSqlite(menu.item.path))}>Mở database</button><button role="menuitem" onClick={() => run(() => onOpenSqliteOperations(menu.item.path))}>Backup và vận hành</button>{role === "root" && !menu.item.protected && <button role="menuitem" className="danger" onClick={() => run(() => onDeleteSqlite(menu.item.path))}>Xóa database</button>}</>}
      {menu.kind === "object" && <>{["table", "view"].includes(menu.item.type) && <button role="menuitem" onClick={() => run(() => onBrowseObject(selectedSqlite, menu.item.name))}>Duyệt dữ liệu</button>}<button role="menuitem" onClick={async () => { await onCopySchema(menu.item.sql || menu.item.name); onClose(); }}>Sao chép schema</button>{menu.item.type === "table" && role === "root" && <button role="menuitem" className="danger" onClick={() => run(() => onDropTable(menu.item.name))}>Xóa bảng...</button>}</>}
    </div>
  );
}

interface ToastRegionProps { toasts: ToastItem[]; onDismiss: (id: number) => void; }
export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  return <div className="toast-region" aria-live="polite" aria-label="Thông báo">{toasts.map((toast) => <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"} style={{ "--toast-duration": `${toast.duration}ms` } as CSSProperties}><span className="toast-icon">{toast.kind === "success" ? <Check /> : toast.kind === "loading" ? <RefreshCw className="animate-spin" /> : <AlertCircle />}</span><span className="toast-message">{toast.message}</span>{toast.kind !== "loading" && <button onClick={() => onDismiss(toast.id)} aria-label="Đóng thông báo"><X /></button>}{toast.duration > 0 && <span className="toast-progress" />}</div>)}</div>;
}

interface StepUpDialogProps { open: boolean; password: string; code: string; error: string | null; onPasswordChange: (value: string) => void; onCodeChange: (value: string) => void; onCancel: () => void; onSubmit: () => void; }
export function StepUpDialog({ open, password, code, error, onPasswordChange, onCodeChange, onCancel, onSubmit }: StepUpDialogProps) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"><div className="app-modal w-full max-w-md p-6 space-y-4 !border-rose-500/25"><div className="flex items-start gap-3"><ShieldCheck className="w-6 h-6 text-red-400 shrink-0" /><div><h3 className="font-bold text-white">Xác nhận thao tác nguy hiểm</h3><p className="mt-1 text-xs text-slate-400">Quyền xác nhận có hiệu lực 5 phút cho session hiện tại.</p></div></div><input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="Mật khẩu hiện tại" autoFocus className="w-full bg-black border border-white/10 rounded px-3 py-2 text-sm" /><input value={code} onChange={(event) => onCodeChange(event.target.value)} placeholder="Mã 2FA hoặc recovery code (nếu đã bật)" autoComplete="one-time-code" className="w-full bg-black border border-white/10 rounded px-3 py-2 text-sm" />{error && <p className="text-xs text-red-400">{error}</p>}<div className="flex justify-end gap-2"><button onClick={onCancel} className="px-4 py-2 text-xs border border-white/10 rounded">Hủy</button><button onClick={onSubmit} disabled={!password} className="px-4 py-2 text-xs bg-red-600 text-white rounded disabled:opacity-40">Xác nhận</button></div></div></div>;
}
