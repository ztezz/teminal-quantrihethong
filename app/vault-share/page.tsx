"use client";

import { useEffect, useState } from 'react';
import { Clipboard, ShieldCheck } from 'lucide-react';
import { apiClient } from '@/lib/client/api';

type SharedCode = { title: string; account: string; code: string; period: number; expiresAt: number; serverTime: number; receivedAt: number };

export default function VaultSharePage() {
  const [data, setData] = useState<SharedCode | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    let active = true;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) { queueMicrotask(() => { if (active) setError('Link không hợp lệ.'); }); return () => { active = false; }; }
    const refresh = async () => {
      try {
        const result = await apiClient.request<SharedCode>(`/api/vault/shared/${token}`, { cache: 'no-store' });
        if (active) { setData({ ...result, receivedAt: Date.now() }); setError(''); }
      } catch (caught) { if (active) { setData(null); setError(caught instanceof Error ? caught.message : 'Không thể tải mã 2FA.'); } }
    };
    void refresh();
    const poll = window.setInterval(() => void refresh(), 2000);
    return () => { active = false; window.clearInterval(poll); };
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const serverNow = data ? data.serverTime + now - data.receivedAt : now;
  const remaining = data ? Math.max(0, Math.ceil((data.expiresAt - serverNow) / 1000)) : 0;
  const codeRemaining = data ? data.period - Math.floor(serverNow / 1000) % data.period : 0;
  const visibleCode = data && remaining > 0 && Math.floor(serverNow / 1000 / data.period) === Math.floor(data.serverTime / 1000 / data.period);
  return <main className="flex min-h-screen items-center justify-center bg-[#07101b] p-4 text-white"><section className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-[#0d1928] p-6 shadow-2xl">
    <div className="flex items-center gap-3"><ShieldCheck className="h-7 w-7 text-emerald-400" /><div><h1 className="text-lg font-bold">Mã 2FA được chia sẻ</h1><p className="text-xs text-slate-400">Link chỉ hoạt động trong thời gian được cấp.</p></div></div>
    {error ? <p role="alert" className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p> : data && remaining > 0 ? <><div><h2 className="text-base font-semibold">{data.title}</h2><p className="text-sm text-slate-400">{data.account}</p></div><div className="flex items-center justify-between rounded-xl bg-black/25 p-4"><div><p className="font-mono text-3xl font-bold tracking-[0.18em] text-emerald-300">{visibleCode ? data.code : '••••••'}</p><p className="mt-2 text-xs text-slate-400">{visibleCode ? `Mã đổi sau ${codeRemaining} giây` : 'Đang cập nhật mã...'}</p></div><button type="button" disabled={!visibleCode} onClick={() => void navigator.clipboard.writeText(data.code).then(() => setCopied(true))} aria-label="Sao chép mã 2FA" className="rounded-lg border border-white/10 p-2 text-slate-300 disabled:opacity-40"><Clipboard className="h-4 w-4" /></button></div><p className="text-xs text-slate-400">{copied ? 'Đã sao chép. ' : ''}Link hết hạn sau {Math.floor(remaining / 60)} phút {remaining % 60} giây.</p></> : <p className="text-sm text-slate-400">{data ? 'Link đã hết hạn.' : 'Đang tải mã...'}</p>}
  </section></main>;
}
