"use client";

import { useEffect, useRef, useState } from "react";

export function ShareServiceWorkerRegistration() {
  const [offline, setOffline] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const reloadOnUpdate = useRef(false);

  useEffect(() => {
    const syncConnection = () => setOffline(!navigator.onLine);
    syncConnection();
    window.addEventListener("online", syncConnection);
    window.addEventListener("offline", syncConnection);

    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return () => {
        window.removeEventListener("online", syncConnection);
        window.removeEventListener("offline", syncConnection);
      };
    }

    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;
    let installing: ServiceWorker | null = null;

    const checkWaiting = () => {
      if (!cancelled && registration?.active && registration.waiting) setWaiting(registration.waiting);
    };
    const onStateChange = () => {
      if (installing?.state === "installed") checkWaiting();
    };
    const onUpdateFound = () => {
      installing?.removeEventListener("statechange", onStateChange);
      installing = registration?.installing || null;
      installing?.addEventListener("statechange", onStateChange);
    };
    const onControllerChange = () => {
      if (reloadOnUpdate.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker.register("/share-sw.js", { scope: "/share", updateViaCache: "none" }).then((result) => {
      if (cancelled) return;
      registration = result;
      checkWaiting();
      registration.addEventListener("updatefound", onUpdateFound);
      const update = () => { if (navigator.onLine && document.visibilityState === "visible") void registration?.update().catch(console.error); };
      document.addEventListener("visibilitychange", update);
      const interval = window.setInterval(update, 30 * 60 * 1000);
      update();
      cleanupRegistration = () => {
        document.removeEventListener("visibilitychange", update);
        window.clearInterval(interval);
        registration?.removeEventListener("updatefound", onUpdateFound);
        installing?.removeEventListener("statechange", onStateChange);
      };
    }).catch((error: unknown) => console.error("Share service worker registration failed", error));

    let cleanupRegistration = () => {};
    return () => {
      cancelled = true;
      cleanupRegistration();
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("online", syncConnection);
      window.removeEventListener("offline", syncConnection);
    };
  }, []);

  return <div className="quick-share-pwa-status">
    {offline && <p role="status">Đang mất mạng. Bạn vẫn có thể mở Share, nhưng cần kết nối để gửi hoặc nhận file.</p>}
    {waiting && <p role="status">Đã có phiên bản Share mới. <button type="button" disabled={updating} onClick={() => {
      reloadOnUpdate.current = true;
      setUpdating(true);
      waiting.postMessage({ type: "SKIP_WAITING" });
    }}>{updating ? "Đang cập nhật..." : "Cập nhật ngay"}</button></p>}
  </div>;
}
