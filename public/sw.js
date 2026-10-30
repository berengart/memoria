/* Memoria Service Worker: App-Hülle offline, Lesezugriff auf zuletzt geladene Inhalte. */
const VERSION = 'v12';
const SHELL = `memoria-shell-${VERSION}`, DATA = `memoria-data-${VERSION}`;
const SHELL_FILES = ['/', '/index.html', '/style.css', '/theme-init.js', '/core.js', '/charts.js', '/crypto.js', '/v-forms.js', '/v-dashboard.js', '/v-people.js', '/v-journal.js', '/v-family.js', '/v-map.js', '/v-review.js', '/v-quick.js', '/nav.js', '/v-item.js', '/v-live.js', '/v-editor.js', '/v-mood.js', '/v-graph.js', '/v-tools.js', '/settings-ui.js', '/settings-more.js', '/main.js', '/manifest.webmanifest', '/icon-192.png', '/icon.svg', '/fonts/inter-Regular.woff', '/fonts/inter-Medium.woff', '/fonts/inter-SemiBold.woff', '/fonts/inter-Bold.woff', '/icons.js'];
const NO_CACHE_API = /^\/api\/(auth|audit|events|backup|sync|notify|export|vcard|geocode|reverse|weather|calendar|integrity|duplicates)/;

self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'clear-data') caches.delete(DATA); });

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (NO_CACHE_API.test(url.pathname)) return;
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req).then((r) => r || new Response(JSON.stringify({ error: 'Offline – dieser Inhalt wurde noch nicht geladen.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  if (url.pathname.startsWith('/files/')) {
    e.respondWith(caches.open(DATA).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok && res.status === 200) c.put(req, res.clone()); return res; }))));
    return;
  }
  // App-Hülle: zuerst Netz (damit Updates sofort wirken), sonst Cache
  e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); } return res; }).catch(() => caches.match(req).then((r) => r || caches.match('/index.html'))));
});
