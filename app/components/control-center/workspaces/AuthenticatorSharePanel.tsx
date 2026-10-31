import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clipboard, Link2, Trash2, X } from 'lucide-react';
import type { apiClient } from '@/lib/client/api';
import { requestNotificationPermission, showNotification } from '@/lib/client/notifications';
import type { ConfirmOptions, ToastKind } from '../types';

type Share = { id: string; createdAt: number; expiresAt: number };
type Props = {
  item: { id: string; title: string };
  onClose: () => void;
  request: <T>(path: string, options?: Parameters<typeof apiClient.request>[1]) => Promise<T>;
  askConfirm: (options: ConfirmOptions) => Promise<boolean>;
  notify: (kind: ToastKind, message: string, duration?: number) => number;
};

const durationLabels: Record<number, string> = { 5: '5 phút', 15: '15 phút', 60: '1 giờ', 360: '6 giờ', 1440: '24 giờ' };

export function AuthenticatorSharePanel({ item, onClose, request, askConfirm, notify }: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(false);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [shares, setShares] = useState<Share[]>([]);
  const [newLink, setNewLink] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('select')?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog || !dialog.contains(document.activeElement)) return;
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener('keydown', onKeyDown); previouslyFocused?.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    void request<{ shares: Share[] }>(`/api/vault/items/${item.id}/shares`).then(result => { if (active) setShares(result.shares); }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Không thể tải link chia sẻ.'); });
    return () => { active = false; };
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    if (!await askConfirm({ title: 'Xác nhận chia sẻ mã 2FA', message: `Tạo link cho “${item.title}” trong ${durationLabels[durationMinutes]}? Bất kỳ ai có link đều xem được mã đang đổi trong thời gian này.`, confirmLabel: 'Xác nhận chia sẻ' })) return;
    const permission = requestNotificationPermission().catch(() => 'unsupported' as const);
    setBusy(true); setError(''); setCopied(false);
    try {
      const result = await request<{ share: Share; token: string }>(`/api/vault/items/${item.id}/shares`, { method: 'POST', body: { durationMinutes } });
      setShares(previous => [result.share, ...previous]);
      setNewLink(`${window.location.origin}/vault-share#token=${encodeURIComponent(result.token)}`);
      notify('success', `Đã tạo link chia sẻ ${item.title} trong ${durationLabels[durationMinutes]}.`);
      void permission.then(granted => granted === 'granted' ? showNotification('Đã tạo link chia sẻ 2FA', { body: `${item.title} · Hết hạn sau ${durationLabels[durationMinutes]}`, tag: `vault-share-${result.share.id}` }) : null).catch(() => undefined);
    } catch (caught) { const message = caught instanceof Error ? caught.message : 'Không thể tạo link chia sẻ.'; setError(message); notify('error', message); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setError('');
    try {
      await request(`/api/vault/items/${item.id}/shares/${id}`, { method: 'DELETE' });
      setShares(previous => previous.filter(share => share.id !== id));
      setNewLink('');
      notify('success', 'Đã thu hồi link chia sẻ.');
    } catch (caught) { const message = caught instanceof Error ? caught.message : 'Không thể thu hồi link.'; setError(message); notify('error', message); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(newLink); setCopied(true); }
    catch { setError('Không thể sao chép link.'); }
  };
  return createPortal(<div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="authenticator-share-title" className="app-panel max-h-[90vh] w-full max-w-xl space-y-3 overflow-y-auto rounded-2xl p-4 shadow-2xl sm:p-6">
    <div className="flex items-start justify-between gap-3"><div><h3 id="authenticator-share-title" className="text-sm font-bold text-white"><Link2 className="mr-2 inline h-4 w-4" />Chia sẻ mã {item.title}</h3><p className="mt-1 text-xs text-amber-300">Bất kỳ ai có link đều xem được mã 2FA đang đổi cho đến khi hết hạn hoặc bạn thu hồi.</p></div><button type="button" disabled={busy} onClick={onClose} aria-label="Đóng chia sẻ" className="text-slate-400 disabled:opacity-40"><X className="h-4 w-4" /></button></div>
    <div className="flex flex-wrap items-end gap-2"><label className="text-xs text-slate-400">Thời gian chia sẻ<select value={durationMinutes} onChange={event => setDurationMinutes(Number(event.target.value))} className="mt-1 block rounded-lg border border-white/10 bg-[#09111d] px-3 py-2 text-sm text-white"><option value={5}>5 phút</option><option value={15}>15 phút</option><option value={60}>1 giờ</option><option value={360}>6 giờ</option><option value={1440}>24 giờ</option></select></label><button type="button" disabled={busy} onClick={() => void create()} className="rounded-lg bg-emerald-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40">{busy ? 'Đang xử lý...' : 'Tạo link chia sẻ'}</button></div>
    {newLink && <><div className="flex gap-2"><input readOnly value={newLink} aria-label="Link chia sẻ mới" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white" /><button type="button" onClick={() => void copy()} className="rounded-lg border border-white/10 px-3 text-xs text-emerald-300"><Clipboard className="mr-1 inline h-3.5 w-3.5" />{copied ? 'Đã sao chép' : 'Sao chép'}</button></div><p className="text-xs text-slate-500">Hãy lưu link ngay. Sau khi đóng, link không thể xem lại; bạn vẫn có thể thu hồi.</p></>}
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    {shares.length > 0 && <div className="space-y-2"><p className="text-xs text-slate-400">Link đang hoạt động</p>{shares.map(share => <div key={share.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs"><span>Hết hạn: {new Date(share.expiresAt).toLocaleString('vi-VN')}</span><button type="button" disabled={busy} onClick={() => void revoke(share.id)} className="text-rose-300 disabled:opacity-40"><Trash2 className="mr-1 inline h-3.5 w-3.5" />Thu hồi</button></div>)}</div>}
  </section></div>, document.body);
}
