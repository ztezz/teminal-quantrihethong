import { useEffect, useState } from 'react';
import { Clipboard, Link2, Trash2, X } from 'lucide-react';
import type { apiClient } from '@/lib/client/api';

type Share = { id: string; createdAt: number; expiresAt: number };
type Props = {
  item: { id: string; title: string };
  onClose: () => void;
  request: <T>(path: string, options?: Parameters<typeof apiClient.request>[1]) => Promise<T>;
};

export function AuthenticatorSharePanel({ item, onClose, request }: Props) {
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [shares, setShares] = useState<Share[]>([]);
  const [newLink, setNewLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    void request<{ shares: Share[] }>(`/api/vault/items/${item.id}/shares`).then(result => { if (active) setShares(result.shares); }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : 'Không thể tải link chia sẻ.'); });
    return () => { active = false; };
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    setBusy(true); setError(''); setCopied(false);
    try {
      const result = await request<{ share: Share; token: string }>(`/api/vault/items/${item.id}/shares`, { method: 'POST', body: { durationMinutes } });
      setShares(previous => [result.share, ...previous]);
      setNewLink(`${window.location.origin}/vault-share#token=${encodeURIComponent(result.token)}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể tạo link chia sẻ.'); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setError('');
    try {
      await request(`/api/vault/items/${item.id}/shares/${id}`, { method: 'DELETE' });
      setShares(previous => previous.filter(share => share.id !== id));
      setNewLink('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể thu hồi link.'); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(newLink); setCopied(true); }
    catch { setError('Không thể sao chép link.'); }
  };
  return <section className="app-panel space-y-3 p-4" aria-label={`Chia sẻ ${item.title}`}>
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-white"><Link2 className="mr-2 inline h-4 w-4" />Chia sẻ mã {item.title}</h3><p className="mt-1 text-xs text-amber-300">Bất kỳ ai có link đều xem được mã 2FA đang đổi cho đến khi hết hạn hoặc bạn thu hồi.</p></div><button type="button" onClick={onClose} aria-label="Đóng chia sẻ" className="text-slate-400"><X className="h-4 w-4" /></button></div>
    <div className="flex flex-wrap items-end gap-2"><label className="text-xs text-slate-400">Thời gian chia sẻ<select value={durationMinutes} onChange={event => setDurationMinutes(Number(event.target.value))} className="mt-1 block rounded-lg border border-white/10 bg-[#09111d] px-3 py-2 text-sm text-white"><option value={5}>5 phút</option><option value={15}>15 phút</option><option value={60}>1 giờ</option><option value={360}>6 giờ</option><option value={1440}>24 giờ</option></select></label><button type="button" disabled={busy} onClick={() => void create()} className="rounded-lg bg-emerald-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40">{busy ? 'Đang xử lý...' : 'Tạo link chia sẻ'}</button></div>
    {newLink && <><div className="flex gap-2"><input readOnly value={newLink} aria-label="Link chia sẻ mới" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white" /><button type="button" onClick={() => void copy()} className="rounded-lg border border-white/10 px-3 text-xs text-emerald-300"><Clipboard className="mr-1 inline h-3.5 w-3.5" />{copied ? 'Đã sao chép' : 'Sao chép'}</button></div><p className="text-xs text-slate-500">Hãy lưu link ngay. Sau khi đóng, link không thể xem lại; bạn vẫn có thể thu hồi.</p></>}
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    {shares.length > 0 && <div className="space-y-2"><p className="text-xs text-slate-400">Link đang hoạt động</p>{shares.map(share => <div key={share.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs"><span>Hết hạn: {new Date(share.expiresAt).toLocaleString('vi-VN')}</span><button type="button" disabled={busy} onClick={() => void revoke(share.id)} className="text-rose-300 disabled:opacity-40"><Trash2 className="mr-1 inline h-3.5 w-3.5" />Thu hồi</button></div>)}</div>}
  </section>;
}
