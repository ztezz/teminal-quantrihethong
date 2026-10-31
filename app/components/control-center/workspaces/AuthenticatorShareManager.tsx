import { useEffect, useState } from 'react';
import { Link2, Trash2, X } from 'lucide-react';
import type { apiClient } from '@/lib/client/api';

type Share = { id: string; itemId: string; createdAt: number; expiresAt: number };
type Entry = { id: string; title: string; account: string };
type Props = {
  entries: Entry[];
  onClose: () => void;
  request: <T>(path: string, options?: Parameters<typeof apiClient.request>[1]) => Promise<T>;
};

export function AuthenticatorShareManager({ entries, onClose, request }: Props) {
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let active = true;
    void request<{ shares: Share[] }>('/api/vault/shares').then(result => { if (active) { setShares(result.shares); setLoading(false); } }).catch(caught => { if (active) { setError(caught instanceof Error ? caught.message : 'Không thể tải link chia sẻ.'); setLoading(false); } });
    return () => { active = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);

  const revoke = async (share: Share) => {
    setBusyId(share.id); setError('');
    try {
      await request(`/api/vault/items/${share.itemId}/shares/${share.id}`, { method: 'DELETE' });
      setShares(previous => previous.filter(value => value.id !== share.id));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Không thể thu hồi link.'); }
    finally { setBusyId(''); }
  };
  const active = shares.filter(share => share.expiresAt > now);
  const names = new Map(entries.map(entry => [entry.id, entry]));
  return <section className="app-panel space-y-3 p-4" aria-label="Quản lý link chia sẻ">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-white"><Link2 className="mr-2 inline h-4 w-4" />Quản lý link chia sẻ</h3><p className="mt-1 text-xs text-slate-400">{active.length} link còn hiệu lực. Link đã tạo chỉ xem được lúc cấp; bạn có thể thu hồi tại đây.</p></div><button type="button" onClick={onClose} aria-label="Đóng quản lý link" className="text-slate-400"><X className="h-4 w-4" /></button></div>
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    {loading ? <p className="text-xs text-slate-400">Đang tải link...</p> : active.length === 0 ? <p className="rounded-lg border border-white/10 p-4 text-center text-xs text-slate-400">Chưa có link chia sẻ nào còn hiệu lực.</p> : <div className="space-y-2">{active.map(share => { const entry = names.get(share.itemId); return <div key={share.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 p-3 text-xs"><div className="min-w-0 flex-1"><p className="truncate font-semibold text-white">{entry?.title || 'Mã 2FA'}</p><p className="truncate text-slate-500">{entry?.account}</p><p className="mt-1 text-slate-400">Tạo {new Date(share.createdAt).toLocaleString('vi-VN')} · Hết hạn {new Date(share.expiresAt).toLocaleString('vi-VN')}</p></div><button type="button" disabled={Boolean(busyId)} onClick={() => void revoke(share)} className="text-rose-300 disabled:opacity-40"><Trash2 className="mr-1 inline h-3.5 w-3.5" />Thu hồi</button></div>; })}</div>}
    <p className="text-xs text-slate-500">Muốn cấp link mới? Chọn “Chia sẻ” trên mã 2FA tương ứng.</p>
  </section>;
}
