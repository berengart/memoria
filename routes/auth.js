'use strict';
/** Anmeldung, Einrichtung, Passwort, Benutzerverwaltung. */
module.exports = ({ r, auth, settings, sync, vaults, vaultFor, audit, fail, ip }) => {
  function startSession(req, res, user) {
    const token = auth.createSession(user, req);
    res.setHeader('Set-Cookie', auth.cookie(token, req));
    return token;
  }
  const adminOnly = (req) => { if (!req.user.admin) throw fail('Nur für Administratoren', 403); };

  r.get('/api/auth/status', (req, res) => res.json({ setup: !auth.hasUsers(), user: auth.publicUser(req.user) }), { public: true });

  r.post('/api/auth/setup', async (req, res) => {
    if (auth.hasUsers()) throw fail('Die Einrichtung ist bereits abgeschlossen', 403);
    const { username, password } = req.body || {};
    const u = await auth.createUser(username, password, true);
    startSession(req, res, u);
    audit.log('setup', u.name, ip(req));
    res.json({ user: auth.publicUser(u) });
  }, { public: true });

  r.post('/api/auth/login', async (req, res) => {
    const addr = ip(req);
    if (auth.rateLimited(addr)) throw fail('Zu viele Fehlversuche. Bitte in ein paar Minuten erneut versuchen.', 429);
    const { username, password, code } = req.body || {};
    let result;
    try { result = await auth.login(username, password, code); } catch (e) { auth.failed(addr); audit.log('login-fail', String(username || '').slice(0, 32), addr); throw e; }
    if (result.need2fa) return res.json({ need2fa: true });
    auth.succeeded(addr);
    startSession(req, res, result.user);
    audit.log('login', result.user.name, addr);
    res.json({ user: auth.publicUser(result.user) });
  }, { public: true });

  r.post('/api/auth/logout', (req, res) => {
    auth.destroySession(auth.tokenFromReq(req));
    res.setHeader('Set-Cookie', auth.cookie('', req, true));
    res.json({ ok: true });
  }, { public: true });

  r.post('/api/auth/password', async (req, res) => {
    const { current, password } = req.body || {};
    if (!(await auth.verify(req.user.name, current))) { audit.log('password-fail', req.user.name, ip(req)); throw fail('Das aktuelle Passwort stimmt nicht', 403); }
    await auth.setPassword(req.user.name, password);
    startSession(req, res, req.user);
    audit.log('password-change', req.user.name, ip(req));
    res.json({ ok: true });
  });

  r.get('/api/users', (req, res) => { adminOnly(req); res.json(auth.list()); });
  r.post('/api/users', async (req, res) => {
    adminOnly(req);
    const { username, password, admin } = req.body || {};
    const u = await auth.createUser(username, password, !!admin);
    vaultFor(u);
    audit.log('user-create', req.user.name, ip(req), u.name);
    res.json({ ok: true, user: auth.publicUser(u) });
  });
  r.put('/api/users/:name', async (req, res) => {
    adminOnly(req);
    const { password, admin, disable2fa } = req.body || {};
    if (password) await auth.setPassword(req.params.name, password);
    if (typeof admin === 'boolean') auth.setAdmin(req.params.name, admin);
    if (disable2fa) auth.disableTotp(req.params.name);
    audit.log('user-update', req.user.name, ip(req), req.params.name);
    res.json({ ok: true });
  });
  r.delete('/api/users/:name', (req, res) => {
    adminOnly(req);
    if (req.params.name === req.user.name) throw fail('Du kannst dich nicht selbst löschen');
    const u = auth.deleteUser(req.params.name);
    settings.remove(u.name); sync.reset(u.name);
    const v = vaults.get(u.name); if (v) { v.close(); vaults.delete(u.name); }
    audit.log('user-delete', req.user.name, ip(req), u.name);
    res.json({ ok: true, note: `Die Daten bleiben im Ordner „${u.vault}“ erhalten.` });
  });
};
