'use strict';
/** Einstellungen je Benutzer (Design, Funktionsumfang, Sync …). Das WebDAV-Passwort wird verschlüsselt abgelegt. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FEATURE_KEYS = ['people', 'mood', 'details', 'music', 'graph', 'insights', 'reminders', 'onThisDay', 'quicklog', 'unlinked', 'backlinks', 'richEditor', 'map'];
const mk = (list) => Object.fromEntries(FEATURE_KEYS.map((k) => [k, list.includes(k)]));
const PRESETS = {
  minimal: mk(['backlinks']),
  standard: mk(['people', 'mood', 'reminders', 'onThisDay', 'quicklog', 'backlinks', 'richEditor', 'map']),
  journal: mk(['mood', 'details', 'music', 'insights', 'onThisDay', 'quicklog', 'backlinks', 'richEditor']),
  crm: mk(['people', 'reminders', 'quicklog', 'unlinked', 'backlinks', 'graph', 'richEditor', 'map']),
  pro: mk(FEATURE_KEYS),
};

const defaults = () => ({
  theme: 'auto', accent: '', density: 'normal', font: 'sans', editorFont: 'mono', fontSize: 16,
  preset: 'standard', features: { ...PRESETS.standard }, songEmbed: false,
  notify: { enabled: false, email: '', ntfyUrl: '', ntfyToken: '', webhookUrl: '', baseUrl: '', time: '08:00', birthdays: true, daysBefore: 3, contacts: true, onThisDay: false, journal: false, journalTime: '21:00' },
  crypto: { salt: '', check: '' },
  weather: { enabled: false, city: '', lat: null, lon: null, auto: true },
  map: { enabled: false },
  sync: { enabled: false, url: '', username: '', password: '', remotePath: '/Memoria', mode: 'bidirectional', autoMinutes: 0, conflictPolicy: 'newer' },
});

class Settings {
  constructor(sysDir) {
    this.dir = path.join(sysDir, 'settings');
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const keyFile = path.join(sysDir, 'secret.key');
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    this.key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  }

  encrypt(text) {
    if (!text) return '';
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
  }
  decrypt(blob) {
    if (!blob) return '';
    try {
      const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
      const d = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
    } catch (e) { return ''; }
  }

  file(name) { return path.join(this.dir, `${name}.json`); }
  get(name) {
    let s = {};
    try { s = JSON.parse(fs.readFileSync(this.file(name), 'utf8')); } catch (e) { /* neu */ }
    const d = defaults();
    return { ...d, ...s, features: { ...d.features, ...(s.features || {}) }, sync: { ...d.sync, ...(s.sync || {}) }, notify: { ...d.notify, ...(s.notify || {}) }, weather: { ...d.weather, ...(s.weather || {}) }, map: { ...d.map, ...(s.map || {}) }, crypto: { ...d.crypto, ...(s.crypto || {}) } };
  }
  save(name, s) {
    const f = this.file(name), tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, f);
  }
  remove(name) { try { fs.unlinkSync(this.file(name)); } catch (e) { /* egal */ } }

  /** Für den Client: Passwort nie herausgeben. */
  publicView(s) {
    const { password, ...syncRest } = s.sync;
    const { ntfyToken, ...notifyRest } = s.notify;
    return { ...s, sync: { ...syncRest, hasPassword: !!password }, notify: { ...notifyRest, hasToken: !!ntfyToken } };
  }
  syncConfig(name) {
    const s = this.get(name).sync;
    return { ...s, password: this.decrypt(s.password) };
  }

  update(name, patch) {
    const s = this.get(name);
    const p = patch || {};
    const oneOf = (v, list) => (list.includes(v) ? v : undefined);
    if (typeof p.theme === 'string' && /^[a-z0-9-]{1,24}$/.test(p.theme)) s.theme = p.theme;
    if (p.accent === '' || (typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent))) s.accent = p.accent;
    s.density = oneOf(p.density, ['compact', 'normal', 'comfy']) || s.density;
    s.font = oneOf(p.font, ['sans', 'serif', 'rounded']) || s.font;
    s.editorFont = oneOf(p.editorFont, ['mono', 'sans', 'serif']) || s.editorFont;
    if (Number.isFinite(+p.fontSize)) s.fontSize = Math.min(22, Math.max(13, Math.round(+p.fontSize)));
    s.preset = oneOf(p.preset, ['minimal', 'standard', 'pro', 'journal', 'crm', 'custom']) || s.preset;
    if (p.features && typeof p.features === 'object') for (const k of FEATURE_KEYS) if (typeof p.features[k] === 'boolean') s.features[k] = p.features[k];
    if (typeof p.songEmbed === 'boolean') s.songEmbed = p.songEmbed;
    if (p.notify && typeof p.notify === 'object') {
      const q = p.notify, t = s.notify;
      const str = (v, n) => String(v).trim().slice(0, n);
      if (typeof q.enabled === 'boolean') t.enabled = q.enabled;
      if (typeof q.email === 'string') { const e = str(q.email, 200); if (e && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e)) throw Object.assign(new Error('Ungültige E-Mail-Adresse'), { status: 400 }); t.email = e; }
      for (const k of ['ntfyUrl', 'webhookUrl', 'baseUrl']) if (typeof q[k] === 'string') { const u = str(q[k], 400); if (u && !/^https?:\/\/[^\s]+$/i.test(u)) throw Object.assign(new Error('Adressen müssen mit http:// oder https:// beginnen'), { status: 400 }); t[k] = u; }
      if (typeof q.ntfyToken === 'string' && q.ntfyToken !== '') t.ntfyToken = this.encrypt(q.ntfyToken);
      if (q.clearToken === true) t.ntfyToken = '';
      for (const k of ['time', 'journalTime']) if (typeof q[k] === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(q[k])) t[k] = q[k];
      for (const k of ['birthdays', 'contacts', 'onThisDay', 'journal']) if (typeof q[k] === 'boolean') t[k] = q[k];
      if (Number.isFinite(+q.daysBefore)) t.daysBefore = Math.min(30, Math.max(0, Math.round(+q.daysBefore)));
    }
    if (p.crypto && typeof p.crypto === 'object') {
      const q = p.crypto;
      if (q.reset === true) s.crypto = { salt: '', check: '' };
      else if (!s.crypto.salt && /^[A-Za-z0-9+/=]{16,64}$/.test(q.salt || '') && typeof q.check === 'string' && q.check.length < 400) s.crypto = { salt: q.salt, check: q.check };
    }
    if (p.map && typeof p.map === 'object' && typeof p.map.enabled === 'boolean') s.map.enabled = p.map.enabled;
    if (p.weather && typeof p.weather === 'object') {
      const q = p.weather, t = s.weather;
      if (typeof q.enabled === 'boolean') t.enabled = q.enabled;
      if (typeof q.auto === 'boolean') t.auto = q.auto;
      if (typeof q.city === 'string') t.city = q.city.trim().slice(0, 120);
      for (const [k, lim] of [['lat', 90], ['lon', 180]]) if (q[k] === null) t[k] = null; else if (Number.isFinite(+q[k]) && Math.abs(+q[k]) <= lim && q[k] !== '') t[k] = +q[k];
    }
    if (p.sync && typeof p.sync === 'object') {
      const q = p.sync, t = s.sync;
      if (typeof q.enabled === 'boolean') t.enabled = q.enabled;
      if (typeof q.url === 'string') {
        const u = q.url.trim();
        if (u && !/^https?:\/\/[^\s]+$/i.test(u)) throw Object.assign(new Error('Die WebDAV-Adresse muss mit http:// oder https:// beginnen'), { status: 400 });
        t.url = u;
      }
      if (typeof q.username === 'string') t.username = q.username.trim();
      if (typeof q.password === 'string' && q.password !== '') t.password = this.encrypt(q.password);
      if (q.clearPassword === true) t.password = '';
      if (typeof q.remotePath === 'string') t.remotePath = '/' + q.remotePath.split('/').map((x) => x.trim()).filter((x) => x && x !== '.' && x !== '..').join('/');
      t.mode = oneOf(q.mode, ['bidirectional', 'push', 'pull']) || t.mode;
      t.conflictPolicy = oneOf(q.conflictPolicy, ['newer', 'local', 'remote']) || t.conflictPolicy;
      if (Number.isFinite(+q.autoMinutes)) t.autoMinutes = Math.min(1440, Math.max(0, Math.round(+q.autoMinutes)));
    }
    this.save(name, s);
    return s;
  }
}

module.exports = { Settings, PRESETS, FEATURE_KEYS };
