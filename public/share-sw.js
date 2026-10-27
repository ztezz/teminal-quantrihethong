const CACHE_NAME = "nodeshell-share-7be57cf27c45";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(["/share", "/share/icon-192.png", "/share/icon-512.png", "/share/manifest.webmanifest"]);
    const shell = await cache.match("/share");
    const html = await shell.text();
    const assets = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^\"]+)"/g)]
      .map((match) => match[1].replaceAll("&amp;", "&"));
    await cache.addAll([...new Set(assets)]);
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(
    names.filter((name) => name.startsWith("nodeshell-share-") && name !== CACHE_NAME)
      .map((name) => caches.delete(name)),
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate" && (url.pathname === "/share" || url.pathname === "/share/")) {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put("/share", copy)));
      }
      return response;
    }).catch(async () => (await caches.match("/share")) || Response.error()));
    return;
  }

  if (url.pathname.startsWith("/share/icon-") || url.pathname === "/share/manifest.webmanifest" || url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
      }
      return response;
    })));
  }
});
