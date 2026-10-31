"use client";

import { useEffect, useRef, useState } from 'react';
import { Check, Clipboard, Hourglass, LockKeyhole, ShieldCheck } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/client/api';
import styles from './page.module.css';

type SharedCode = { title: string; account: string; code: string; period: number; expiresAt: number; serverTime: number; receivedAt: number };
const dustParticles = Array.from({ length: 22 }, (_, index) => index);

export default function VaultSharePage() {
  const [data, setData] = useState<SharedCode | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [copyStatus, setCopyStatus] = useState<'copied' | 'error' | null>(null);
  const [expired, setExpired] = useState(false);
  const [dust, setDust] = useState(false);
  const lastStepRef = useRef<number | null>(null);
  const lastServerTimeRef = useRef(0);
  const dustTimerRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    let active = true;
    let poll: number | null = null;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) { queueMicrotask(() => { if (active) setError('Link không hợp lệ.'); }); return () => { active = false; }; }
    const refresh = async () => {
      try {
        const result = await apiClient.request<SharedCode>(`/api/vault/shared/${token}`, { cache: 'no-store' });
        if (!active || result.serverTime < lastServerTimeRef.current) return;
        const step = Math.floor(result.serverTime / 1000 / result.period);
        if (lastStepRef.current !== null && step !== lastStepRef.current) {
          if (dustTimerRef.current !== null) window.clearTimeout(dustTimerRef.current);
          setDust(true);
          if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
          setCopyStatus(null);
          dustTimerRef.current = window.setTimeout(() => { if (active) setDust(false); }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 580);
        }
        lastStepRef.current = step;
        lastServerTimeRef.current = result.serverTime;
        setData({ ...result, receivedAt: Date.now() });
        setError('');
        setExpired(false);
      } catch (caught) {
        if (!active) return;
        setData(null);
        if (caught instanceof ApiError && caught.status === 404) { setExpired(true); setError(''); if (poll !== null) window.clearInterval(poll); }
        else setError(caught instanceof Error ? caught.message : 'Không thể tải mã 2FA.');
      }
    };
    void refresh();
    poll = window.setInterval(() => void refresh(), 2000);
    return () => { active = false; if (poll !== null) window.clearInterval(poll); if (dustTimerRef.current !== null) window.clearTimeout(dustTimerRef.current); if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current); };
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(timer); }, []);
  const serverNow = data ? data.serverTime + now - data.receivedAt : now;
  const remaining = data ? Math.max(0, Math.ceil((data.expiresAt - serverNow) / 1000)) : 0;
  const codeRemaining = data ? data.period - Math.floor(serverNow / 1000) % data.period : 0;
  const visibleCode = data && remaining > 0 && Math.floor(serverNow / 1000 / data.period) === Math.floor(data.serverTime / 1000 / data.period);
  const showCode = Boolean(visibleCode && !dust);
  const dispersing = Boolean(data && remaining > 0 && (!visibleCode || dust));
  const codeStep = data ? Math.floor(data.serverTime / 1000 / data.period) : 0;
  const ringProgress = data ? Math.max(0, Math.min(1, (data.period - serverNow / 1000 % data.period) / data.period)) : 0;
  const ringCircumference = 2 * Math.PI * 18;
  const copyCode = async () => {
    if (!data || !showCode) return;
    const liveServerNow = data.serverTime + Date.now() - data.receivedAt;
    if (liveServerNow >= data.expiresAt || Math.floor(liveServerNow / 1000 / data.period) !== codeStep) return;
    try { await navigator.clipboard.writeText(data.code); setCopyStatus('copied'); }
    catch { setCopyStatus('error'); }
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyStatus(null), 2400);
  };
  return <main className={styles.scene}>
    <div className={styles.grid} aria-hidden="true" />
    <div className={`${styles.orb} ${styles.orbOne}`} aria-hidden="true" />
    <div className={`${styles.orb} ${styles.orbTwo}`} aria-hidden="true" />
    <div className={`${styles.orb} ${styles.orbThree}`} aria-hidden="true" />
    <div className={styles.rings} aria-hidden="true"><span /><span /><span /></div>
    <section className={`${styles.card} ${expired || (data && remaining <= 0) ? styles.cardExpired : ''}`} aria-labelledby="share-title">
      <div className={styles.cardGlow} aria-hidden="true" />
      <div className={styles.header}>
        <div className={styles.mark}><ShieldCheck size={27} strokeWidth={1.8} /></div>
        <div><p className={styles.eyebrow}>SECURE ACCESS · 2FA</p><h1 id="share-title">Mã 2FA được chia sẻ</h1><p className={styles.subtitle}>Truy cập an toàn trong thời gian được cấp.</p></div>
      </div>
      {error ? <div role="alert" className={styles.error}>{error}</div> : expired || (data && remaining <= 0) ? <div className={styles.expiredState} role="status"><div className={styles.expiredHalo}><Hourglass size={30} strokeWidth={1.6} /></div><p className={styles.expiredEyebrow}>PHIÊN CHIA SẺ ĐÃ KẾT THÚC</p><h2>Link không còn hiệu lực</h2><p>Mã 2FA này đã hết thời gian chia sẻ hoặc link đã được thu hồi.</p><div className={styles.expiredAdvice}>Hãy liên hệ người chia sẻ để xin link mới.</div></div> : data && remaining > 0 ? <>
        <div className={styles.account}><span className={styles.accountIcon}><LockKeyhole size={18} /></span><div><span className={styles.microLabel}>TÀI KHOẢN</span><h2>{data.title}</h2><p>{data.account}</p></div><span className={styles.live}><span />ĐANG HOẠT ĐỘNG</span></div>
        <div className={styles.codePanel}>
          <div className={styles.codeTop}><span className={styles.microLabel}>MÃ XÁC THỰC HIỆN TẠI</span><div className={`${styles.countdown} ${codeRemaining <= 5 ? styles.countdownUrgent : ''}`} role="timer" aria-label={showCode ? `Mã đổi sau ${codeRemaining} giây` : 'Đang cập nhật mã mới'}><svg viewBox="0 0 44 44" aria-hidden="true"><circle className={styles.countdownTrack} cx="22" cy="22" r="18" /><circle className={styles.countdownProgress} cx="22" cy="22" r="18" strokeDasharray={ringCircumference} strokeDashoffset={ringCircumference * (1 - (showCode ? ringProgress : 0))} /></svg><span>{showCode ? Math.ceil(codeRemaining) : '··'}</span></div></div>
          <div className={styles.codeRow}><div className={styles.codeStage}>{dispersing && <div key={`dust-${codeStep}`} className={styles.dustCloud} aria-hidden="true">{dustParticles.map(index => <i key={index} style={{ left: `${5 + index * 37 % 88}%`, top: `${12 + index * 29 % 68}%`, animationDelay: `${index % 5 * 20}ms` }} />)}</div>}<p key={showCode ? codeStep : 'waiting'} className={`${styles.code} ${data.code.length === 8 ? styles.codeWide : ''} ${showCode ? styles.codeReveal : styles.codeMasked}`}>{showCode ? data.code : '••••••'}</p></div><button type="button" disabled={!showCode} onClick={() => void copyCode()} aria-label="Sao chép mã 2FA" className={styles.copyButton}>{copyStatus === 'copied' ? <Check size={19} /> : <Clipboard size={19} />}</button></div>
          <div className={styles.progressTrack}><span style={{ width: `${showCode ? codeRemaining / data.period * 100 : 0}%` }} /></div>
          <div className={styles.codeBottom}><p className={styles.codeHint}>{showCode ? `Mã mới sau ${Math.ceil(codeRemaining)} giây.` : 'Mã cũ đã hết hạn. Đang đồng bộ mã mới...'}</p>{copyStatus && <span className={`${styles.copyFeedback} ${copyStatus === 'error' ? styles.copyFeedbackError : ''}`} role="status">{copyStatus === 'copied' ? <><Check size={13} />Đã sao chép</> : 'Không thể sao chép'}</span>}</div>
        </div>
        <div className={styles.expiry}><span>LINK HẾT HẠN SAU</span><strong>{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</strong></div>
      </> : <div className={styles.emptyState} role="status"><ShieldCheck size={28} /><p>{data ? 'Link đã hết hạn.' : 'Đang tải mã...'}</p></div>}
      <p className={styles.footer}>Chỉ người có liên kết này mới xem được mã trong thời gian còn hiệu lực.</p>
    </section>
  </main>;
}
