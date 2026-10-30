'use strict';
/** Sicherheit des eigenen Kontos: Sitzungen, Zwei-Faktor, Protokoll. */
module.exports = ({ r, auth, audit, fail, ip }) => {
  r.get('/api/auth/sessions', (req, res) => res.json(auth.listSessions(req.user.name, auth.tokenFromReq(req))));
  r.delete('/api/auth/sessions/:id', (req, res) => {
    if (!auth.endSession(req.user.name, req.params.id)) throw fail('Sitzung nicht gefunden', 404);
    audit.log('session-end', req.user.name, ip(req));
    res.json({ ok: true });
  });
  r.post('/api/auth/sessions/others', (req, res) => {
    auth.destroyUserSessions(req.user.name, auth.tokenFromReq(req));
    audit.log('session-end-others', req.user.name, ip(req));
    res.json({ ok: true });
  });

  r.post('/api/auth/2fa/begin', async (req, res) => {
    if (!(await auth.verify(req.user.name, (req.body || {}).password))) throw fail('Passwort stimmt nicht', 403);
    res.json(auth.beginTotp(req.user.name));
  });
  r.post('/api/auth/2fa/enable', (req, res) => {
    const codes = auth.enableTotp(req.user.name, (req.body || {}).code);
    audit.log('2fa-enable', req.user.name, ip(req));
    res.json({ ok: true, recovery: codes });
  });
  r.post('/api/auth/2fa/disable', async (req, res) => {
    if (!(await auth.verify(req.user.name, (req.body || {}).password))) throw fail('Passwort stimmt nicht', 403);
    const u = req.user;
    if (u.totp && u.totp.enabled && !auth.checkSecondFactor(u, (req.body || {}).code)) throw fail('Der Code ist ungültig', 403);
    auth.disableTotp(u.name);
    audit.log('2fa-disable', u.name, ip(req));
    res.json({ ok: true });
  });

  r.get('/api/audit', (req, res) => {
    if (!req.user.admin) throw fail('Nur für Administratoren', 403);
    res.json(audit.tail(Math.min(500, parseInt(req.query.limit, 10) || 200)));
  });
};
