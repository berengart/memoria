'use strict';
/**
 * Memoria – persönliche Wissens-/Tagebuch-App (Markdown, [[Wikilinks]], Personen, Mood-Tracker, WebDAV-Sync).
 * Datenlayout (Vault des ersten Kontos = Datenordner selbst, weitere Konten unter users/<name>/):
 *   people/ journal/ notes/ templates/ attachments/<typ>/ .trash/ .history/
 *   .system/  (Konten, Sitzungen, Einstellungen, SQLite-Index – nicht synchronisiert)
 * Aufbau: server.js (HTTP-Kern) · routes/*.js (API) · lib/*.js (Logik)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// node:sqlite ist in Node 22 noch als „experimentell“ markiert – diese eine Warnung unterdrücken.
process.removeAllListeners('warning');
process.on('warning', (w) => { if (!(w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message))) console.warn(w); });

const { Vault } = require('./lib/vault');
const { Auth } = require('./lib/auth');
const { Settings } = require('./lib/settings');
const { SyncManager } = require('./lib/sync');
const { Notifier } = require('./lib/notify');
const { Router, fail, readRaw, sendFile, securityHeaders } = require('./lib/web');

const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PORT = parseInt(process.env.PORT, 10) || 4444;
const PUBLIC = path.join(__dirname, 'public');
fs.mkdirSync(DATA, { recursive: true });

const auth = new Auth(DATA);
const settings = new Settings(auth.sys);
const vaults = new Map();
function vaultFor(user) {
  let v = vaults.get(user.name);
  if (!v) {
    v = new Vault(path.resolve(DATA, user.vault), { dbFile: path.join(auth.sys, 'index', `${user.name}.sqlite`) });
    v.init(); vaults.set(user.name, v);
  }
  return v;
}
const sync = new SyncManager({ auth, settings, getVault: vaultFor, sysDir: auth.sys });
const notifier = new Notifier({ auth, settings, getVault: vaultFor, sysDir: auth.sys });

const router = new Router();
const ctx = { r: router, auth, settings, sync, notifier, vaultFor, vaults, audit: auth.audit, fail, readRaw, DATA, ip: (req) => auth.ipOf(req) };
for (const m of ['auth', 'account', 'settings', 'data', 'tools', 'extras']) require(`./routes/${m}`)(ctx);

/* -------------------------------------------------------------- HTTP-Kern */
function servePublic(rel, req, res) {
  let p; try { p = decodeURIComponent(rel); } catch (e) { return false; }
  if (p.split(/[\/\\]/).some((s) => s.startsWith('.') || s.includes('\0'))) return false;
  const full = path.join(PUBLIC, p);
  if (!full.startsWith(PUBLIC + path.sep)) return false;
  return sendFile(full, req, res, 'no-cache');
}

const server = http.createServer(async (req, res) => {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => {
    const b = JSON.stringify(o);
    res.writeHead(res.statusCode || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(b) });
    res.end(b);
  };
  securityHeaders(res, req);
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    req.query = Object.fromEntries(url.searchParams);
    req.user = auth.userFromReq(req);

    if (pathname.startsWith('/api/')) {
      if (req.method !== 'GET') {
        if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Anfrage von fremder Seite abgelehnt' });
        if (req.headers.origin) {
          let oh = ''; try { oh = new URL(req.headers.origin).host; } catch (e) { /* ungültig */ }
          if (oh !== req.headers.host && oh !== req.headers['x-forwarded-host']) return res.status(403).json({ error: 'Ungültiger Ursprung der Anfrage' });
        }
      }
      const r = router.match(req.method, pathname);
      if (!r) return res.status(404).json({ error: 'Unbekannte API-Route' });
      if (!r.public && !req.user) return res.status(401).json({ error: 'Nicht angemeldet', auth: true });
      const m = r.re.exec(pathname);
      req.params = {};
      try { r.keys.forEach((k, i) => { req.params[k] = decodeURIComponent(m[i + 1]); }); } catch (e) { return res.status(400).json({ error: 'Ungültiger Pfad' }); }
      req.body = {};
      if (!r.raw && (req.headers['content-type'] || '').startsWith('application/json')) {
        const raw = await readRaw(req, 5 * 1024 * 1024);
        if (raw.length) { try { req.body = JSON.parse(raw.toString('utf8')); } catch (e) { return res.status(400).json({ error: 'Ungültiges JSON' }); } }
      }
      if (req.user) { req.vault = vaultFor(req.user); req.vault.scan(false); }
      return await r.handler(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
    if (pathname.startsWith('/files/')) {
      if (!req.user) return res.status(401).end('Nicht angemeldet');
      const full = vaultFor(req.user).attachmentPath(decodeURIComponent(pathname.slice(7)));
      if (full && sendFile(full, req, res, 'private, max-age=3600')) return;
      return res.status(404).end('Nicht gefunden');
    }
    if (servePublic(pathname === '/' ? 'index.html' : pathname.slice(1), req, res)) return;
    res.status(404).end('Nicht gefunden');
  } catch (err) {
    if (!err.status) console.error(err);
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.status ? err.message : 'Serverfehler', ...(err.data || {}) }); else res.end();
  }
});

/* ------------------------------------------------------------------ Start */
(async () => {
  if (!auth.hasUsers() && process.env.ADMIN_PASSWORD) {
    try { await auth.createUser(process.env.ADMIN_USER || 'admin', process.env.ADMIN_PASSWORD, true); console.log('Administrator aus ADMIN_USER/ADMIN_PASSWORD angelegt.'); } catch (e) { console.error('ADMIN_PASSWORD:', e.message); }
  }
  for (const u of auth.users) vaultFor(u);
  sync.start(); notifier.start();
  server.listen(PORT, '0.0.0.0', () => console.log(`Memoria läuft auf Port ${PORT} – Daten: ${DATA} (${auth.users.length} Konto/Konten${auth.hasUsers() ? '' : ', Einrichtung im Browser offen'})`));
})();
const stop = () => { server.close(); for (const v of vaults.values()) v.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
