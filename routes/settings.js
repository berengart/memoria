'use strict';
/** Einstellungen, WebDAV-Sync, Erinnerungen, Wetter/Ort. */
const { PRESETS } = require('../lib/settings');
const { RELATION_TYPES } = require('../lib/vault');
const mail = require('../lib/mail');
const weather = require('../lib/weather');
const { guardUrl } = require('../lib/netguard');

module.exports = ({ r, auth, settings, sync, notifier, audit, fail, ip }) => {
  const view = (name) => settings.publicView(settings.get(name));

  r.get('/api/settings', (req, res) => res.json({ settings: view(req.user.name), presets: PRESETS, me: auth.publicUser(req.user), relationTypes: RELATION_TYPES, smtp: mail.configured(), mapConfig: { tileUrl: require('../lib/mapcfg').tileUrl(), attribution: require('../lib/mapcfg').attribution() } }));
  r.put('/api/settings', async (req, res) => {
    const b = req.body || {};
    for (const [k, u] of [['sync', b.sync && b.sync.url], ['notify', null]]) if (u) await guardUrl(u);
    if (b.notify) for (const k of ['ntfyUrl', 'webhookUrl']) if (b.notify[k]) await guardUrl(b.notify[k]);
    settings.update(req.user.name, b);
    res.json({ settings: view(req.user.name) });
  });

  /* ---- WebDAV-Sync ---- */
  r.get('/api/sync/status', (req, res) => res.json(sync.status(req.user.name)));
  r.post('/api/sync/test', async (req, res) => {
    const stored = settings.syncConfig(req.user.name);
    const b = req.body || {};
    const cfg = { url: String(b.url || stored.url), username: b.username !== undefined ? String(b.username) : stored.username, password: b.password ? String(b.password) : stored.password, remotePath: b.remotePath !== undefined ? String(b.remotePath) : stored.remotePath };
    if (cfg.url && !/^https?:\/\//i.test(cfg.url)) throw fail('Die Adresse muss mit http:// oder https:// beginnen');
    await guardUrl(cfg.url);
    res.json(await sync.test(cfg));
  });
  r.post('/api/sync/run', async (req, res) => {
    const cfg = settings.syncConfig(req.user.name);
    if (!cfg.url) throw fail('Bitte zuerst eine WebDAV-Adresse speichern');
    await guardUrl(cfg.url);
    if (sync.running.has(req.user.name)) throw fail('Es läuft bereits eine Synchronisierung', 409);
    audit.log('sync-run', req.user.name, ip(req));
    sync.run(req.user.name, { force: !!(req.body && req.body.force) }).catch((e) => console.error('Sync', e));
    res.json({ started: true });
  });
  r.post('/api/sync/reset', (req, res) => { sync.reset(req.user.name); res.json({ ok: true }); });
  r.get('/api/sync/conflicts', (req, res) => res.json(sync.conflicts(req.user.name)));
  r.get('/api/sync/conflicts/:id', (req, res) => {
    const d = sync.conflictDetail(req.user.name, req.params.id);
    if (!d) throw fail('Konflikt nicht gefunden', 404);
    res.json(d);
  });
  r.post('/api/sync/conflicts/:id/resolve', (req, res) => {
    const action = (req.body || {}).action;
    if (!['use-other', 'dismiss'].includes(action)) throw fail('Unbekannte Aktion');
    res.json(sync.resolveConflict(req.user.name, req.params.id, action));
  });

  /* ---- Erinnerungen ---- */
  r.post('/api/notify/test', async (req, res) => res.json({ results: await notifier.test(req.user.name) }));
  r.post('/api/notify/digest', async (req, res) => res.json(await notifier.sendDigest(req.user.name, { force: true })));

  /* ---- Wetter & Ort (nur wenn vom Nutzer aktiviert) ---- */
  const needWeather = (req) => { if (!settings.get(req.user.name).weather.enabled) throw fail('Wetter & Ort ist in den Einstellungen ausgeschaltet', 403); };
  r.get('/api/geocode', async (req, res) => { needWeather(req); res.json(await weather.geocode(req.query.q)); });
  const needMap = (req) => { if (!settings.get(req.user.name).map.enabled) throw fail('Die Online-Karte ist in den Einstellungen ausgeschaltet', 403); };
  r.post('/api/geocode/choose', (req, res) => { // gewählten Treffer an die erste Stelle setzen (Tagebuch-Orte)
    needMap(req); const b = req.body || {}; const gc = require('../lib/geocache'); const list = gc.get(auth.sys, req.user.name, b.q);
    if (!Array.isArray(list)) throw fail('Unbekannte Suche', 400);
    const i = list.findIndex((x) => Math.abs(x.lat - Number(b.lat)) < 1e-6 && Math.abs(x.lon - Number(b.lon)) < 1e-6);
    if (i > 0) { const [x] = list.splice(i, 1); list.unshift(x); gc.put(auth.sys, req.user.name, b.q, list); }
    res.json({ ok: true });
  });
  r.get('/api/geocode/address', async (req, res) => { needMap(req); res.json(await require('../lib/geocache').cached(auth.sys, req.user.name, req.query.q, weather.searchAddress)); });
  r.get('/api/reverse', async (req, res) => { needWeather(req); res.json(await weather.reverse(req.query.lat, req.query.lon)); });
  r.get('/api/weather', async (req, res) => {
    needWeather(req);
    const w = settings.get(req.user.name).weather;
    const lat = req.query.lat ?? w.lat, lon = req.query.lon ?? w.lon;
    if (lat == null || lon == null || lat === '' ) throw fail('Bitte zuerst einen Wohnort einstellen');
    const { localDate } = require('../lib/util');
    res.json(await weather.weather(lat, lon, /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null, localDate()));
  });
};
