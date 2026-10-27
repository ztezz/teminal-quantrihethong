"use client";

import { useEffect } from "react";

export function ShareServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/share/sw.js", { scope: "/share" }).catch((error: unknown) => {
      console.error("Share service worker registration failed", error);
    });
  }, []);

  return null;
}
