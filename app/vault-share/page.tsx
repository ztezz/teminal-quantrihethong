"use client";

import { useEffect, useState } from 'react';
import { Check, Clipboard, LockKeyhole, ShieldCheck } from 'lucide-react';
import { apiClient } from '@/lib/client/api';
import styles from './page.module.css';

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
  return <main className={styles.scene}>
    <div className={styles.grid} aria-hidden="true" />
    <div className={`${styles.orb} ${styles.orbOne}`} aria-hidden="true" />
    <div className={`${styles.orb} ${styles.orbTwo}`} aria-hidden="true" />
    <div className={`${styles.orb} ${styles.orbThree}`} aria-hidden="true" />
    <div className={styles.rings} aria-hidden="true"><span /><span /><span /></div>
    <section className={styles.card} aria-labelledby="share-title">
      <div className={styles.cardGlow} aria-hidden="true" />
      <div className={styles.header}>
        <div className={styles.mark}><ShieldCheck size={27} strokeWidth={1.8} /></div>
        <div><p className={styles.eyebrow}>SECURE ACCESS · 2FA</p><h1 id="share-title">Mã 2FA được chia sẻ</h1><p className={styles.subtitle}>Truy cập an toàn trong thời gian được cấp.</p></div>
      </div>
      {error ? <div role="alert" className={styles.error}>{error}</div> : data && remaining > 0 ? <>
        <div className={styles.account}><span className={styles.accountIcon}><LockKeyhole size={18} /></span><div><span className={styles.microLabel}>TÀI KHOẢN</span><h2>{data.title}</h2><p>{data.account}</p></div><span className={styles.live}><span />ĐANG HOẠT ĐỘNG</span></div>
        <div className={styles.codePanel}>
          <div className={styles.codeTop}><span className={styles.microLabel}>MÃ XÁC THỰC HIỆN TẠI</span><span className={styles.codeTimer}>{visibleCode ? `${codeRemaining}s` : 'Đang cập nhật'}</span></div>
          <div className={styles.codeRow}><p className={`${styles.code} ${data.code.length === 8 ? styles.codeWide : ''}`}>{visibleCode ? data.code : '••••••'}</p><button type="button" disabled={!visibleCode} onClick={() => void navigator.clipboard.writeText(data.code).then(() => setCopied(true))} aria-label="Sao chép mã 2FA" className={styles.copyButton}>{copied ? <Check size={19} /> : <Clipboard size={19} />}</button></div>
          <div className={styles.progressTrack}><span style={{ width: `${visibleCode ? codeRemaining / data.period * 100 : 0}%` }} /></div>
          <p className={styles.codeHint}>{copied ? 'Đã sao chép mã.' : visibleCode ? `Mã mới sau ${codeRemaining} giây.` : 'Đang đồng bộ mã mới...'}</p>
        </div>
        <div className={styles.expiry}><span>LINK HẾT HẠN SAU</span><strong>{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</strong></div>
      </> : <div className={styles.emptyState} role="status"><ShieldCheck size={28} /><p>{data ? 'Link đã hết hạn.' : 'Đang tải mã...'}</p></div>}
      <p className={styles.footer}>Chỉ người có liên kết này mới xem được mã trong thời gian còn hiệu lực.</p>
    </section>
  </main>;
}
