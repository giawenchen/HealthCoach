// 轻量 PWA 缓存：加速二次打开，离线可看已缓存界面（AI 仍需联网）
const CACHE = "flexo-v3";
const PRECACHE = ["/manifest.webmanifest", "/icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname === "/" || url.pathname === "/index.html") {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  if (url.pathname.startsWith("/dist/") || url.pathname.startsWith("/icons/") || url.pathname.endsWith(".webmanifest")) {
    // dist/app.js 带版本 query，始终走网络优先，避免旧 bundle
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.ok && url.pathname.startsWith("/dist/")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
  }
});
