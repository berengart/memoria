'use strict';
/** Import, Export/Backup, vCard, Lied-Suche. */
const fs = require('fs');
const path = require('path');
const { parseMultipart } = require('../lib/web');
const { runImport } = require('../lib/importers');
const { writeZip } = require('../lib/zip');
const { toVcf } = require('../lib/vcard');
const { localDate } = require('../lib/util');
const { guardUrl } = require('../lib/netguard');

const OEMBED = {
  'youtube.com': (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  'music.youtube.com': (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  'youtu.be': (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  'open.spotify.com': (u) => `https://open.spotify.com/oembed?url=${encodeURIComponent(u)}`,
  'soundcloud.com': (u) => `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(u)}`,
};

function walk(dir, rel = '', out = []) {
  let entries = []; try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || /\.tmp/.test(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(dir, r, out); else { const st = fs.statSync(path.join(dir, r)); out.push({ name: r, file: path.join(dir, r), mtime: st.mtime }); }
  }
  return out;
}

module.exports = ({ r, audit, fail, readRaw, ip }) => {
  r.get('/api/song/lookup', async (req, res) => {
    let u; try { u = new URL(String(req.query.url || '')); } catch (e) { throw fail('Ungültiger Link'); }
    const host = u.hostname.replace(/^www\./, '');
    if (!/^https:$/.test(u.protocol) || !OEMBED[host]) throw fail('Nur Links von YouTube, Spotify und SoundCloud werden erkannt');
    let x;
    try { x = await fetch(OEMBED[host](u.href), { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Memoria' } }); } catch (e) { throw fail('Titel konnte nicht abgerufen werden (keine Internetverbindung?)', 502); }
    if (!x.ok) throw fail('Titel konnte nicht abgerufen werden', 502);
    const j = await x.json();
    res.json({ title: String(j.title || ''), author: String(j.author_name || ''), provider: String(j.provider_name || host) });
  });

  /* ---- Import ---- */
  r.post('/api/import', async (req, res) => {
    const raw = await readRaw(req, 400 * 1024 * 1024);
    const { files, fields } = parseMultipart(raw, req.headers['content-type']);
    if (!files.length) throw fail('Keine Datei ausgewählt');
    const report = runImport(req.vault, files.map((f) => ({ name: f.filename, data: f.data })), { mode: fields.mode === 'notes' ? 'notes' : 'auto' });
    audit.log('import', req.user.name, ip(req), `${report.people}P/${report.journal}J/${report.notes}N/${report.attachments}A`);
    res.json(report);
  }, { raw: true });

  /* ---- Backup & Export ---- */
  r.get('/api/backup', async (req, res) => {
    const v = req.vault;
    const withHistory = req.query.history === '1';
    const entries = [];
    for (const top of ['people', 'journal', 'notes', 'templates', 'attachments']) for (const f of walk(v.dir, top)) entries.push(f);
    if (withHistory) for (const f of walk(path.join(v.dir, '.history'))) entries.push({ ...f, name: '.history/' + f.name });
    entries.push({ name: 'LIESMICH.txt', data: Buffer.from('Memoria-Sicherung\nInhalt: people/, journal/, notes/, templates/, attachments/ – normale Markdown-Dateien.\nWiederherstellung: ZIP in den Datenordner entpacken oder in Memoria unter Einstellungen → Daten importieren.\n'), mtime: new Date() });
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="memoria-backup-${localDate()}.zip"`, 'Cache-Control': 'no-store' });
    audit.log('backup', req.user.name, ip(req));
    try { await writeZip(entries, res); } catch (e) { console.error('Backup', e.message); res.destroy(); }
  });

  r.get('/api/vcard/:slug', (req, res) => {
    const it = req.vault.getItem('person', req.params.slug);
    if (!it) throw fail('Nicht gefunden', 404);
    res.writeHead(200, { 'Content-Type': 'text/vcard; charset=utf-8', 'Content-Disposition': `attachment; filename="${it.slug}.vcf"` });
    res.end(toVcf(it.meta, it.enc ? '' : it.body));
  });
  r.get('/api/export/vcards', (req, res) => {
    const out = [...req.vault.index.values()].filter((i) => i.type === 'person').map((p) => toVcf(p.meta, p.enc ? '' : p.body)).join('');
    res.writeHead(200, { 'Content-Type': 'text/vcard; charset=utf-8', 'Content-Disposition': 'attachment; filename="memoria-kontakte.vcf"' });
    res.end(out);
  });
};
