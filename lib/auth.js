'use strict';
/** Benutzerkonten, Passwörter (scrypt) und Sitzungen (Cookie). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const { Secrets } = require('./secrets');
const totp = require('./totp');
const { Audit } = require('./audit');

const MIN_PW = 10;
const WEAK = new Set(['passwort123', 'password123', '1234567890', 'qwertzuiop', 'qwertyuiop', 'passwort1234', 'password1234', 'willkommen1', 'changeme123', 'administrator', 'iloveyou123', '0123456789', 'memoria1234']);
function checkPassword(pw, name) {
  pw = String(pw || '');
  if (pw.length < MIN_PW) throw fail(`Das Passwort muss mindestens ${MIN_PW} Zeichen haben`);
  const low = pw.toLowerCase();
  if (WEAK.has(low) || /^(.)\1+$/.test(pw) || (name && low.includes(String(name).toLowerCase()) && pw.length < 14)) throw fail('Dieses Passwort ist zu leicht zu erraten. Bitte ein anderes wählen (am besten ein langer Satz).');
}

const SESSION_MS = 30 * 24 * 3600 * 1000;
const NAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const COOKIE = 'memoria_session';

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }
function writeJson(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

class Auth {
  constructor(dataDir) {
    this.sys = path.join(dataDir, '.system');
    fs.mkdirSync(this.sys, { recursive: true, mode: 0o700 });
    this.usersFile = path.join(this.sys, 'users.json');
    this.sessFile = path.join(this.sys, 'sessions.json');
    this.users = readJson(this.usersFile, []);
    this.sessions = readJson(this.sessFile, {});
    this.attempts = new Map();
    this.locks = new Map();
    this.secrets = new Secrets(this.sys);
    this.audit = new Audit(this.sys);
    this.prune();
  }

  prune() {
    const now = Date.now();
    let ch = false;
    for (const [k, s] of Object.entries(this.sessions)) if (s.exp < now || !this.get(s.user)) { delete this.sessions[k]; ch = true; }
    if (ch) this.saveSessions();
  }
  saveUsers() { writeJson(this.usersFile, this.users); }
  saveSessions() { writeJson(this.sessFile, this.sessions); }

  hasUsers() { return this.users.length > 0; }
  get(name) { return this.users.find((u) => u.name === String(name).toLowerCase()) || null; }
  list() { return this.users.map((u) => ({ name: u.name, admin: !!u.admin, created: u.created })); }
  publicUser(u) { return u ? { name: u.name, admin: !!u.admin, totp: !!(u.totp && u.totp.enabled) } : null; }

  async hash(pw, salt = crypto.randomBytes(16).toString('hex')) {
    const key = await scrypt(pw, salt, 64);
    return { salt, hash: key.toString('hex') };
  }

  async createUser(name, password, admin = false) {
    name = String(name || '').trim().toLowerCase();
    if (!NAME_RE.test(name)) throw fail('Benutzername: 2–32 Zeichen, nur a–z, 0–9, Punkt, Minus, Unterstrich');
    checkPassword(password, name);
    if (this.get(name)) throw fail('Diesen Benutzernamen gibt es schon', 409);
    const first = this.users.length === 0;
    const { salt, hash } = await this.hash(password);
    const u = { name, salt, hash, admin: first ? true : !!admin, vault: first ? '.' : `users/${name}`, created: new Date().toISOString() };
    this.users.push(u);
    this.saveUsers();
    return u;
  }

  async verify(name, password) {
    const u = this.get(String(name || ''));
    const { hash } = await this.hash(String(password || ''), u ? u.salt : 'x'.repeat(32));
    if (!u) return null;
    const a = Buffer.from(hash, 'hex'), b = Buffer.from(u.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? u : null;
  }

  async setPassword(name, password) {
    const u = this.get(name);
    if (!u) throw fail('Benutzer nicht gefunden', 404);
    checkPassword(password, u.name);
    Object.assign(u, await this.hash(password));
    this.saveUsers();
    this.destroyUserSessions(u.name);
  }

  deleteUser(name) {
    const u = this.get(name);
    if (!u) throw fail('Benutzer nicht gefunden', 404);
    if (u.admin && this.users.filter((x) => x.admin).length <= 1) throw fail('Der letzte Administrator kann nicht gelöscht werden');
    this.users = this.users.filter((x) => x !== u);
    this.saveUsers();
    this.destroyUserSessions(u.name);
    return u;
  }

  setAdmin(name, admin) {
    const u = this.get(name);
    if (!u) throw fail('Benutzer nicht gefunden', 404);
    if (!admin && u.admin && this.users.filter((x) => x.admin).length <= 1) throw fail('Es muss mindestens ein Administrator bleiben');
    u.admin = !!admin;
    this.saveUsers();
  }

  /* ---- Sitzungen ---- */
  createSession(user, req) {
    const token = crypto.randomBytes(32).toString('hex');
    const ua = req ? String(req.headers['user-agent'] || '').slice(0, 160) : '';
    this.sessions[sha(token)] = { user: user.name, exp: Date.now() + SESSION_MS, created: Date.now(), ua, ip: req ? this.ipOf(req) : '' };
    this.saveSessions();
    return token;
  }
  listSessions(name, currentToken) {
    const cur = currentToken ? sha(currentToken) : null;
    return Object.entries(this.sessions).filter(([, s]) => s.user === name)
      .map(([k, s]) => ({ id: k.slice(0, 16), created: s.created || null, ua: s.ua || '', ip: s.ip || '', current: k === cur }))
      .sort((a, b) => (b.created || 0) - (a.created || 0));
  }
  endSession(name, id) {
    for (const k of Object.keys(this.sessions)) if (k.startsWith(id) && id.length >= 16 && this.sessions[k].user === name) { delete this.sessions[k]; this.saveSessions(); return true; }
    return false;
  }
  destroySession(token) { if (token && this.sessions[sha(token)]) { delete this.sessions[sha(token)]; this.saveSessions(); } }
  destroyUserSessions(name, exceptToken) {
    const keep = exceptToken ? sha(exceptToken) : null;
    for (const [k, s] of Object.entries(this.sessions)) if (s.user === name && k !== keep) delete this.sessions[k];
    this.saveSessions();
  }
  tokenFromReq(req) {
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`).exec(req.headers.cookie || '');
    return m ? m[1] : null;
  }
  userFromReq(req) {
    const token = this.tokenFromReq(req);
    if (!token) return null;
    const s = this.sessions[sha(token)];
    if (!s || s.exp < Date.now()) return null;
    return this.get(s.user);
  }
  cookie(token, req, clear) {
    const secure = (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https' || req.socket.encrypted;
    return `${COOKIE}=${clear ? '' : token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${clear ? 0 : SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
  }

  /* ---- Schutz vor Passwort-Raten ---- */
  ipOf(req) {
    if (process.env.TRUST_PROXY === '1') { const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (x) return x; }
    return req.socket.remoteAddress || 'x';
  }
  rateLimited(ip) {
    const a = this.attempts.get(ip);
    if (!a) return false;
    if (Date.now() - a.first > 10 * 60 * 1000) { this.attempts.delete(ip); return false; }
    return a.n >= 10;
  }
  failed(ip) { const a = this.attempts.get(ip) || { n: 0, first: Date.now() }; a.n++; this.attempts.set(ip, a); }
  succeeded(ip) { this.attempts.delete(ip); }

  /** Pro Konto: nach 5 Fehlversuchen wächst die Sperrzeit (30 s, 1 min, 2 min … bis 15 min). */
  lockedFor(name) { const l = this.locks.get(name); return l && l.until > Date.now() ? Math.ceil((l.until - Date.now()) / 1000) : 0; }
  noteFail(name) {
    const l = this.locks.get(name) || { n: 0, until: 0 };
    l.n++;
    if (l.n >= 5) l.until = Date.now() + Math.min(30000 * 2 ** (l.n - 5), 15 * 60 * 1000);
    this.locks.set(name, l);
  }

  /** Anmeldung inkl. optionalem zweiten Faktor. Liefert {user}, {need2fa:true} oder wirft. */
  async login(name, password, code) {
    name = String(name || '').trim().toLowerCase();
    const wait = this.lockedFor(name);
    if (wait) throw fail(`Zu viele Fehlversuche für dieses Konto. Bitte in ${wait} Sekunden erneut versuchen.`, 429);
    const u = await this.verify(name, password);
    if (!u) { this.noteFail(name); throw fail('Benutzername oder Passwort falsch', 401); }
    if (u.totp && u.totp.enabled) {
      if (!code) return { need2fa: true };
      if (!this.checkSecondFactor(u, code)) { this.noteFail(name); throw fail('Der Code ist ungültig oder abgelaufen', 401); }
    }
    this.locks.delete(name);
    return { user: u };
  }

  /* ---- Zwei-Faktor (TOTP + Wiederherstellungscodes) ---- */
  checkSecondFactor(u, code) {
    const clean = String(code || '').trim();
    const secret = this.secrets.decrypt(u.totp.secret);
    const step = secret ? totp.verify(secret, clean) : null;
    if (step !== null) {
      if (step <= (u.totp.last || 0)) return false; // derselbe Code darf nicht zweimal verwendet werden
      u.totp.last = step; this.saveUsers(); return true;
    }
    const h = sha('rc:' + clean.toLowerCase().replace(/[\s-]/g, ''));
    const i = (u.totp.recovery || []).indexOf(h);
    if (i >= 0) { u.totp.recovery.splice(i, 1); this.saveUsers(); return true; }
    return false;
  }
  beginTotp(name) {
    const u = this.get(name); if (!u) throw fail('Benutzer nicht gefunden', 404);
    if (u.totp && u.totp.enabled) throw fail('Zwei-Faktor ist bereits aktiv');
    const secret = totp.newSecret();
    u.totp = { enabled: false, secret: this.secrets.encrypt(secret), recovery: [], last: 0 };
    this.saveUsers();
    return { secret, uri: totp.uri(secret, u.name) };
  }
  enableTotp(name, code) {
    const u = this.get(name);
    if (!u || !u.totp || u.totp.enabled) throw fail('Bitte die Einrichtung neu starten');
    const step = totp.verify(this.secrets.decrypt(u.totp.secret), code);
    if (step === null) throw fail('Der Code stimmt nicht. Bitte erneut versuchen.');
    const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').replace(/(.{5})(.{5})/, '$1-$2'));
    u.totp.enabled = true; u.totp.last = step; u.totp.recovery = codes.map((c) => sha('rc:' + c.replace('-', '')));
    this.saveUsers();
    return codes;
  }
  disableTotp(name) { const u = this.get(name); if (u) { delete u.totp; this.saveUsers(); } }
}

module.exports = { Auth, NAME_RE, checkPassword };
