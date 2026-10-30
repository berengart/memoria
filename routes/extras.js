'use strict';
/** Rückblick, Prüfung, Dubletten, Tagebuch-Orte, GEDCOM-Export und Kalender-Abo. */
const crypto = require('crypto');
const insights = require('../lib/insights');
const geocache = require('../lib/geocache');

module.exports = ({ r, auth, settings, vaultFor, audit, fail, ip }) => {
  r.get('/api/map/journal', (req, res) => {
    const places = insights.journalPlaces(req.vault).map((p) => {
      const hit = geocache.get(auth.sys, req.user.name, p.name);
      const first = Array.isArray(hit) && hit[0];
      return { ...p, searched: Array.isArray(hit), ...(first ? { lat: first.lat, lon: first.lon } : {}) };
    });
    res.json({ places });
  });

  r.get('/api/review', (req, res) => res.json(insights.review(req.vault, req.query.year)));

  r.get('/api/duplicates', (req, res) => {
    const name = String(req.query.name || '').trim();
    res.json(name.length < 3 ? [] : insights.duplicatesOf(req.vault, name, String(req.query.except || '')));
  });

  r.get('/api/integrity', (req, res) => res.json(insights.integrity(req.vault)));
  r.post('/api/integrity/fix', (req, res) => {
    const b = req.body || {};
    const out = insights.fixIssue(req.vault, b);
    audit.log('integrity-fix', req.user.name, ip(req), String(b.action));
    res.json(out || { ok: true });
  });

  r.get('/api/export/gedcom', (req, res) => {
    const body = Buffer.from(require('../lib/gedcom').gedcom(req.vault), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="stammbaum.ged"', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    res.end(body);
  });

  /* ---- Kalender-Abo (.ics) mit geheimem Link ---- */
  const base = (req) => {
    const s = settings.get(req.user.name).notify.baseUrl;
    if (s) return s.replace(/\/+$/, '');
    const proto = process.env.TRUST_PROXY ? (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() : 'http';
    return `${/^https?$/.test(proto) ? proto : 'http'}://${req.headers.host}`;
  };
  r.get('/api/calendar/info', (req, res) => {
    const t = settings.get(req.user.name).calendarToken || '';
    res.json({ active: !!t, url: t ? `${base(req)}/api/calendar/${t}.ics` : '' });
  });
  r.post('/api/calendar/token', (req, res) => {
    const s = settings.get(req.user.name);
    s.calendarToken = (req.body || {}).revoke ? '' : crypto.randomBytes(24).toString('hex');
    settings.save(req.user.name, s);
    audit.log(s.calendarToken ? 'calendar-token-new' : 'calendar-token-revoked', req.user.name, ip(req));
    res.json({ active: !!s.calendarToken, url: s.calendarToken ? `${base(req)}/api/calendar/${s.calendarToken}.ics` : '' });
  });
  r.get('/api/calendar/:token', (req, res) => {
    const token = String(req.params.token || '').replace(/\.ics$/i, '');
    let user = null;
    if (/^[a-f0-9]{48}$/.test(token)) {
      for (const u of auth.users) {
        const t = settings.get(u.name).calendarToken || '';
        if (t.length === token.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token))) { user = u; break; }
      }
    }
    if (!user) throw fail('Nicht gefunden', 404);
    const v = vaultFor(user); v.scan(false);
    const body = Buffer.from(insights.ics(v, { name: 'Memoria' }), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    res.end(body);
  }, { public: true });
};
