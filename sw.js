// App shell cached for fast, offline-capable loads. Video data is network-first so new videos appear as soon as they are published.
const SHELL = "darkmind-shell-v1";
const FILES = ["./", "index.html", "app.css", "app.js", "i18n.js", "manifest.webmanifest", "icons/icon.svg"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL && k !== "darkmind-data").map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (u.origin === location.origin && u.pathname.includes("/data/")) {
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open("darkmind-data").then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  if (u.origin === location.origin) { e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(SHELL).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match("index.html")))); return; }
  if (u.hostname === "i.ytimg.com") { e.respondWith(caches.open("darkmind-thumbs").then(async (c) => { const m = await c.match(e.request); if (m) return m; const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r; })); }
});
