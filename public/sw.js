// The app's service worker:
// - keeps the check-in screen loading when a tablet loses its internet connection (only the
//   check-in page and its files are cached; everything else goes straight to the network);
// - shows push notifications, and lets people accept a serving spot right from one.
const CACHE = 'mb-checkin-v3';
const FILES = ['/checkin', '/css/app.css', '/css/checkin.css', '/js/checkin.js', '/js/checkin-rules.js', '/js/lib.js', '/js/theme.js'];

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

// ---------------------------------------------------------------- push notifications
self.addEventListener('push', (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch { msg = { title: e.data?.text() || 'New notification' }; }
  e.waitUntil(self.registration.showNotification(msg.title || 'Notification', {
    body: msg.body || '',
    tag: msg.tag || undefined,
    renotify: Boolean(msg.tag && msg.renotify),
    icon: '/app-icon/192.png',
    badge: '/icons/badge-96.png',
    actions: msg.actions || [],
    data: { url: msg.url || '/', id: msg.id, assignment_ids: msg.data?.assignment_ids || [] },
  }));
});

const api = (method, url, body) => fetch(url, {
  method,
  credentials: 'same-origin',
  headers: { 'content-type': 'application/json', 'x-mb': '1' },
  body: body ? JSON.stringify(body) : undefined,
});

async function openApp(url) {
  const target = new URL(url, self.location.origin).href;
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
  if (win) {
    await win.focus();
    return win.navigate(target).catch(() => win.postMessage({ type: 'navigate', url: target }));
  }
  return self.clients.openWindow(target);
}

self.addEventListener('notificationclick', (e) => {
  const n = e.notification;
  const { url, id, assignment_ids: ids = [] } = n.data || {};
  n.close();
  const home = String(url || '').startsWith('/app/') ? '/app/#/serve' : '/#/my';
  e.waitUntil((async () => {
    if (id) api('POST', '/api/notifications/read', { ids: [id] }).catch(() => {});
    if (e.action === 'accept' && ids.length === 1) {
      const res = await api('PATCH', `/api/assignments/${ids[0]}`, { status: 'accepted' }).catch(() => null);
      if (res?.ok) {
        await self.registration.showNotification('Thanks for serving!', { body: 'You’re confirmed. It’s on your schedule.', tag: n.tag, icon: '/app-icon/192.png', data: { url: home } });
        return;
      }
      return openApp(home);
    }
    // Declining asks for a reason, so it opens the app.
    if (e.action === 'decline' && ids.length === 1) return openApp(String(url).startsWith('/app/') ? `/app/#/serve?decline=${ids[0]}` : `/#/my?decline=${ids[0]}`);
    return openApp(url || '/');
  })());
});
