// Keeps the check-in screen loading when a tablet loses its internet connection.
// Only the check-in page and its files are cached; everything else goes straight to the network.
const CACHE = 'mb-checkin-v1';
const FILES = ['/checkin', '/css/app.css', '/css/checkin.css', '/js/checkin.js', '/js/checkin-rules.js', '/js/lib.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !FILES.includes(url.pathname)) return;
  // Network first, so updates arrive as soon as we're online; the cache is the fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
