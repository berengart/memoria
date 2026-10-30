'use strict';
/** Erinnerungen per E-Mail, ntfy-Push und Webhook. Ein Planer prüft minütlich, ob für ein Konto etwas fällig ist. */
const fs = require('fs');
const path = require('path');
const mail = require('./mail');
const { guardUrl } = require('./netguard');
const { localDate } = require('./util');

const pad = (n) => String(n).padStart(2, '0');

function buildDigest(vault, cfg) {
  const d = vault.dashboard();
  const lines = [];
  if (cfg.birthdays) {
    const soon = d.birthdays.filter((b) => b.inDays <= (cfg.daysBefore ?? 3));
    for (const b of soon) lines.push(`🎂 ${b.title}: ${b.inDays === 0 ? 'heute' : b.inDays === 1 ? 'morgen' : `in ${b.inDays} Tagen`} Geburtstag${b.turning ? ` (wird ${b.turning})` : ''}${b.gifts ? ` – ${b.gifts} Geschenkidee${b.gifts > 1 ? 'n' : ''}` : ''}`);
  }
  if (cfg.contacts) {
    for (const r of d.reminders.slice(0, 5)) lines.push(`💬 Mal wieder melden: ${r.title} (${r.sinceDays === null ? 'noch kein Kontakt erfasst' : `seit ${r.sinceDays} Tagen`})`);
  }
  if (cfg.onThisDay) for (const o of d.onThisDay.slice(0, 3)) lines.push(`🕰️ An diesem Tag: ${o.date.slice(0, 4)} – ${o.snippet.slice(0, 80) || o.title}`);
  return lines;
}

async function post(url, headers, body) {
  await guardUrl(url);
  const r = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(12000), redirect: 'error' }).catch((e) => { throw Object.assign(new Error(`Senden fehlgeschlagen: ${e.cause && e.cause.code ? e.cause.code : e.message}`), { status: 502 }); });
  if (!r.ok) throw Object.assign(new Error(`Der Dienst antwortet mit Fehler (HTTP ${r.status})`), { status: 502 });
}

/** Schickt eine Nachricht über alle eingestellten Kanäle. Liefert pro Kanal ok/Fehler. */
async function deliver(cfg, token, { title, text, click }) {
  const out = [];
  const run = async (kind, fn) => { try { await fn(); out.push({ kind, ok: true }); } catch (e) { out.push({ kind, ok: false, error: e.message }); } };
  if (cfg.email) await run('E-Mail', () => mail.send({ to: cfg.email, subject: title, text: text + (click ? `\n\n${click}` : '') }));
  if (cfg.ntfyUrl) await run('Push (ntfy)', () => post(cfg.ntfyUrl, { Title: encodeRfc2047(title), 'Content-Type': 'text/plain; charset=utf-8', Tags: 'notebook', ...(click ? { Click: click } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, text));
  if (cfg.webhookUrl) await run('Webhook', () => post(cfg.webhookUrl, { 'Content-Type': 'application/json' }, JSON.stringify({ title, text, click: click || null, source: 'memoria' })));
  return out;
}
const encodeRfc2047 = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

class Notifier {
  constructor({ auth, settings, getVault, sysDir }) {
    this.auth = auth; this.settings = settings; this.getVault = getVault;
    this.dir = path.join(sysDir, 'notify'); fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }
  stateFile(n) { return path.join(this.dir, `${n}.json`); }
  state(n) { try { return JSON.parse(fs.readFileSync(this.stateFile(n), 'utf8')); } catch (e) { return {}; } }
  save(n, st) { fs.writeFileSync(this.stateFile(n), JSON.stringify(st), { mode: 0o600 }); }
  cfgOf(name) { const s = this.settings.get(name); return { ...s.notify, ntfyToken: this.settings.decrypt(s.notify.ntfyToken) }; }
  channelsOn(c) { return !!(c.enabled && (c.email || c.ntfyUrl || c.webhookUrl)); }
  link(c) { return c.baseUrl ? c.baseUrl.replace(/\/+$/, '') + '/' : ''; }

  async sendDigest(name, { force = false } = {}) {
    const c = this.cfgOf(name); const vault = this.getVault(this.auth.get(name));
    const lines = buildDigest(vault, c);
    if (!lines.length && !force) return { sent: false, reason: 'nichts fällig' };
    const text = lines.length ? lines.join('\n') : 'Heute ist nichts fällig.';
    const r = await deliver(c, c.ntfyToken, { title: 'Memoria: Erinnerungen', text, click: this.link(c) });
    return { sent: true, results: r, lines };
  }
  async sendJournalReminder(name) {
    const c = this.cfgOf(name); const vault = this.getVault(this.auth.get(name));
    const today = localDate();
    const e = vault.index.get(`journal/${today}`);
    if (e && (e.body || '').trim().length > 20) return { sent: false, reason: 'heute schon geschrieben' };
    const r = await deliver(c, c.ntfyToken, { title: 'Memoria: Tagebuch', text: 'Was war heute? Nimm dir kurz Zeit für deinen Eintrag.', click: this.link(c) ? this.link(c) + '#/journal/' + today : '' });
    return { sent: true, results: r };
  }
  async test(name) {
    const c = this.cfgOf(name);
    if (!(c.email || c.ntfyUrl || c.webhookUrl)) throw Object.assign(new Error('Bitte mindestens einen Kanal eintragen (E-Mail, ntfy oder Webhook)'), { status: 400 });
    return deliver(c, c.ntfyToken, { title: 'Memoria: Testnachricht', text: 'Wenn du das liest, funktioniert die Benachrichtigung. 🎉', click: this.link(c) });
  }

  start() {
    this.timer = setInterval(() => this.tick().catch((e) => console.error('Erinnerungen', e.message)), 60000);
    this.timer.unref();
  }
  async tick(now = new Date()) {
    const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`, today = localDate(now);
    for (const u of this.auth.users) {
      const c = this.cfgOf(u.name);
      if (!this.channelsOn(c)) continue;
      const st = this.state(u.name);
      if (c.time && hm >= c.time && st.digest !== today) {
        st.digest = today; this.save(u.name, st);
        await this.sendDigest(u.name).catch((e) => console.error('Digest', u.name, e.message));
      }
      if (c.journal && c.journalTime && hm >= c.journalTime && st.journal !== today) {
        st.journal = today; this.save(u.name, st);
        await this.sendJournalReminder(u.name).catch((e) => console.error('Tagebuch-Erinnerung', u.name, e.message));
      }
    }
  }
}
module.exports = { Notifier, buildDigest, deliver };
