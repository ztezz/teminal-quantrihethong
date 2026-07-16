"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { Expand, Minimize, Pause, PictureInPicture, Play, RotateCcw, Volume1, Volume2, VolumeX } from "lucide-react";
import styles from "./VideoPlayer.module.css";

interface VideoPlayerProps { src: string; fileName: string }

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function VideoPlayer({ src, fileName }: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pipSupported = typeof document !== "undefined" && Boolean(document.pictureInPictureEnabled);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  const showControls = () => {
    setControlsVisible(true);
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    if (playing) hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2_500);
  };
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.ended) video.currentTime = 0;
      void video.play().catch(() => setError("Trình duyệt không thể phát video này"));
    }
    else video.pause();
  };
  const seek = (seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(video.duration, Math.max(0, seconds));
    setCurrentTime(video.currentTime);
  };
  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };
  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await containerRef.current.requestFullscreen();
  };
  const togglePip = async () => {
    const video = videoRef.current;
    if (!video || !pipSupported) return;
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  };
  const onProgress = () => {
    const video = videoRef.current;
    if (!video || !video.buffered.length || !Number.isFinite(video.duration) || !video.duration) return setBuffered(0);
    setBuffered((video.buffered.end(video.buffered.length - 1) / video.duration) * 100);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    if (event.code === "Space" || key === "k") { event.preventDefault(); togglePlay(); }
    else if (event.key === "ArrowLeft" || key === "j") { event.preventDefault(); seek(currentTime - 10); }
    else if (event.key === "ArrowRight" || key === "l") { event.preventDefault(); seek(currentTime + 10); }
    else if (event.key === "ArrowUp") { event.preventDefault(); changeVolume(Math.min(1, volume + .1)); }
    else if (event.key === "ArrowDown") { event.preventDefault(); changeVolume(Math.max(0, volume - .1)); }
    else if (key === "m") toggleMute();
    else if (key === "f") void toggleFullscreen();
    else if (key === "p") void togglePip();
  };
  const changeVolume = (next: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = next; video.muted = next === 0;
    setVolume(next); setMuted(next === 0);
  };
  const onSurfaceClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget || event.target === videoRef.current) togglePlay();
  };
  const progress = duration ? (currentTime / duration) * 100 : 0;
  const controlStyle = { "--progress": `${progress}%`, "--buffered": `${buffered}%` } as CSSProperties;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < .55 ? Volume1 : Volume2;

  return (
    <div ref={containerRef} className={`${styles.player} ${controlsVisible || !playing ? styles.controlsVisible : ""}`} tabIndex={0} onKeyDown={onKeyDown} onMouseMove={showControls} onMouseLeave={() => playing && setControlsVisible(false)} onClick={onSurfaceClick} aria-label={`Trình phát video ${fileName}`}>
      <video ref={videoRef} src={src} playsInline preload="metadata" className={styles.video} onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration || 0); setError(null); }} onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onProgress={onProgress} onPlay={() => { setPlaying(true); showControls(); }} onPause={() => { setPlaying(false); setControlsVisible(true); }} onEnded={() => { setPlaying(false); setControlsVisible(true); }} onVolumeChange={(event) => { setVolume(event.currentTarget.volume); setMuted(event.currentTarget.muted); }} onError={() => setError("Không thể phát video. Codec có thể không được trình duyệt hỗ trợ hoặc phiên xem trước đã hết hạn.")} />
      <div className={styles.shade} />
      <div className={styles.title}>{fileName}</div>
      {!playing && !error && <button type="button" className={styles.centerButton} onClick={(event) => { event.stopPropagation(); togglePlay(); }} aria-label="Phát video">{currentTime >= duration && duration ? <RotateCcw size={25} /> : <Play size={28} fill="currentColor" />}</button>}
      {error && <div className={styles.message}>{error}</div>}
      <div className={styles.controls} onClick={(event) => event.stopPropagation()}>
        <div className={styles.timelineWrap} style={controlStyle}><span className={styles.buffered} /><input type="range" className={styles.range} min={0} max={duration || 0} step="0.01" value={Math.min(currentTime, duration || 0)} onChange={(event) => seek(Number(event.target.value))} aria-label="Tiến trình video" /></div>
        <div className={styles.controlRow}>
          <button type="button" className={styles.button} onClick={togglePlay} aria-label={playing ? "Tạm dừng" : "Phát"}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
          <button type="button" className={styles.button} onClick={toggleMute} aria-label={muted ? "Bật âm thanh" : "Tắt âm thanh"}><VolumeIcon size={18} /></button>
          <input type="range" min={0} max={1} step={.05} value={muted ? 0 : volume} onChange={(event) => changeVolume(Number(event.target.value))} className={styles.volume} aria-label="Âm lượng" />
          <span className={styles.time}>{formatTime(currentTime)} / {formatTime(duration)}</span>
          <span className={styles.spacer} />
          <select className={styles.speed} defaultValue="1" onChange={(event) => { if (videoRef.current) videoRef.current.playbackRate = Number(event.target.value); }} aria-label="Tốc độ phát">{[.25,.5,.75,1,1.25,1.5,1.75,2].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}</select>
          {pipSupported && <button type="button" className={styles.button} onClick={() => void togglePip()} title="Hình trong hình"><PictureInPicture size={18} /></button>}
          <button type="button" className={styles.button} onClick={() => void toggleFullscreen()} title={fullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}>{fullscreen ? <Minimize size={18} /> : <Expand size={18} />}</button>
        </div>
      </div>
    </div>
  );
}
