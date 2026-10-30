'use strict';
/** Import: Obsidian-/Markdown-Ordner (ZIP oder einzelne .md), Day One (JSON-ZIP), vCard (.vcf), Memoria-Backup. */
const path = require('path');
const { readZip } = require('./zip');
const { parseVcf } = require('./vcard');
const { parseFM, attachmentInfo, isDate, slugify, toList } = require('./util');

const PERSON_DIR = /^(people|personen|person|kontakte|contacts|persons|menschen)$/i;
const JOURNAL_DIR = /^(journal|tagebuch|daily|dailies|daily notes|diary|diaries|days|tage)$/i;
const base = (n) => n.split('/').pop();
const stem = (n) => base(n).replace(/\.[^.]+$/, '');
const skipPath = (n) => n.split('/').some((s) => s === '__MACOSX' || s.startsWith('.') || s === 'node_modules');

function expand(files, report) {
  const out = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const z = readZip(f.data);
      for (const e of z.entries) { if (skipPath(e.name)) continue; try { out.push({ name: e.name, data: z.read(e) }); } catch (err) { report.warnings.push(`${e.name}: ${err.message}`); } }
    } else if (!skipPath(f.name)) out.push({ name: f.name.replace(/\\/g, '/'), data: f.data });
  }
  // gemeinsames Wurzelverzeichnis ("MeinVault/…") abschneiden
  const tops = new Set(out.map((f) => f.name.split('/')[0]));
  if (tops.size === 1 && out.every((f) => f.name.includes('/'))) { const t = [...tops][0]; if (!/^(people|journal|notes|attachments|templates)$/i.test(t)) out.forEach((f) => { f.name = f.name.slice(t.length + 1); }); }
  return out;
}

function fixBody(body, nameMap) {
  return String(body)
    .replace(/(!?)\[\[([^\]|#]+?)((?:#[^\]|]*)?)((?:\|[^\]]*)?)\]\]/g, (m, bang, target, heading, alias) => {
      let t = target.trim();
      if (attachmentInfo(t)) { const b = base(t); return `${bang}[[${nameMap.get(b.toLowerCase()) || b}${alias}]]`; }
      if (t.includes('/')) t = base(t);
      return `${bang}[[${t.replace(/\.md$/i, '')}${heading}${alias}]]`;
    })
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
      if (/^(https?:|data:)/i.test(src)) return m;
      let dec = src; try { dec = decodeURIComponent(src); } catch (e) { /* egal */ }
      const b = base(dec);
      return attachmentInfo(b) ? `![[${nameMap.get(b.toLowerCase()) || b}${/^\d{2,4}$/.test(alt) ? '|' + alt : ''}]]` : m;
    });
}

function classify(f, meta, mode) {
  if (mode === 'notes') return 'note';
  const segs = f.name.split('/'); const top = segs.length > 1 ? segs[0] : '';
  if (/^people$/i.test(top)) return 'person';
  if (/^journal$/i.test(top)) return 'journal';
  if (/^notes$/i.test(top)) return 'note';
  const nm = stem(f.name);
  if (meta.birthday || meta.phone || meta.phones || meta.relationship || (meta.name && (meta.email || meta.company)) || PERSON_DIR.test(top) || segs.slice(0, -1).some((s) => PERSON_DIR.test(s))) return 'person';
  if (/^\d{4}-\d{2}-\d{2}/.test(nm) && (isDate(nm) || segs.slice(0, -1).some((s) => JOURNAL_DIR.test(s)) || isDate(String(meta.date || '').slice(0, 10)))) return 'journal';
  if (segs.slice(0, -1).some((s) => JOURNAL_DIR.test(s)) && isDate(String(meta.date || '').slice(0, 10))) return 'journal';
  return 'note';
}

function importMarkdown(vault, files, mode, report, nameMap) {
  for (const f of files) {
    try {
      const raw = f.data.toString('utf8');
      const { meta, body } = parseFM(raw);
      const type = classify(f, meta, mode);
      const name = stem(f.name);
      const text = fixBody(body, nameMap);
      if (type === 'journal') {
        const date = isDate(String(meta.date || '').slice(0, 10)) ? String(meta.date).slice(0, 10) : (name.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];
        if (!date) { report.skipped.push(`${f.name} (kein Datum)`); continue; }
        delete meta.date;
        let r = vault.createItem('journal', { date, meta, body: text });
        if (r.existed) r = vault.createItem('journal', { date, title: /^\d{4}-\d{2}-\d{2}$/.test(name) ? `${date} importiert` : name.replace(/^\d{4}-\d{2}-\d{2}\s*[-_ ]*/, '') || name, meta, body: text });
        report.journal++;
      } else if (type === 'person') {
        const title = String(meta.name || name);
        if (vault.resolve(title) && vault.resolve(title).type === 'person') { report.skipped.push(`${f.name} (Person „${title}“ gibt es schon)`); continue; }
        delete meta.name;
        vault.createItem('person', { title, meta, body: text });
        report.people++;
      } else {
        delete meta.title;
        const title = String(parseFM(raw).meta.title || name);
        vault.createItem('note', { title, meta, body: text });
        report.notes++;
      }
    } catch (e) { report.warnings.push(`${f.name}: ${e.message}`); }
  }
}

/* ------------------------------------------------------------------ Day One */
const WEATHER_DE = { clear: 'Klar', sunny: 'Sonnig', cloudy: 'Bewölkt', 'mostly cloudy': 'Überwiegend bewölkt', 'partly cloudy': 'Teilweise bewölkt', rain: 'Regen', snow: 'Schnee', fog: 'Nebel', drizzle: 'Nieselregen', thunderstorm: 'Gewitter' };
function localParts(iso, tz) {
  const d = new Date(iso);
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  } catch (e) { return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) }; }
}
function importDayOne(vault, journals, files, report, nameMap) {
  const photoFile = new Map();
  for (const f of files) { const m = /(?:^|\/)(?:photos|audios|videos|pdfs)\/([^/]+)$/i.exec(f.name); if (m) photoFile.set(m[1].replace(/\.[^.]+$/, '').toLowerCase(), m[1]); }
  const perDay = new Map();
  for (const j of journals) {
    for (const e of j.entries || []) {
      const { date, time } = localParts(e.creationDate, e.timeZone);
      const ids = new Map((e.photos || []).concat(e.pdfAttachments || [], e.audios || [], e.videos || []).map((p) => [p.identifier, (p.md5 || '') + '.' + (p.type || p.fileType || '')]));
      let text = String(e.text || '').replace(/\\([.!()\-#+*_[\]{}>])/g, '$1');
      text = text.replace(/!\[[^\]]*\]\(dayone-moment:\/\/([^)]+)\)/gi, (m, id) => { const fn = ids.get(id.replace(/^(video|audio|pdf)\//, '')); if (!fn) return ''; const real = nameMap.get(fn.toLowerCase()) || photoFile.get(fn.replace(/\.[^.]+$/, '').toLowerCase()); return real ? `![[${nameMap.get(String(real).toLowerCase()) || real}]]` : ''; });
      const tags = (e.tags || []).map((t) => String(t).replace(/\s+/g, '-'));
      const meta = {};
      if (tags.length) meta.tags = tags;
      const loc = e.location && (e.location.placeName || e.location.localityName);
      if (loc) meta.location = [e.location.placeName, e.location.localityName].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ');
      if (e.weather && (e.weather.conditionsDescription || e.weather.temperatureCelsius !== undefined)) meta.weather = [WEATHER_DE[String(e.weather.conditionsDescription || '').toLowerCase()] || e.weather.conditionsDescription, e.weather.temperatureCelsius !== undefined ? `${Math.round(e.weather.temperatureCelsius)} °C` : ''].filter(Boolean).join(', ');
      if (!perDay.has(date)) perDay.set(date, []);
      perDay.get(date).push({ time, text, meta });
    }
  }
  for (const [date, list] of perDay) {
    list.sort((a, b) => a.time.localeCompare(b.time));
    const meta = {}; for (const x of list) { for (const [k, v] of Object.entries(x.meta)) { meta[k] = k === 'tags' ? [...new Set([...(meta.tags || []), ...v])] : meta[k] || v; } }
    const body = list.length === 1 ? list[0].text : list.map((x) => `### ${x.time}\n\n${x.text}`).join('\n\n');
    try {
      let r = vault.createItem('journal', { date, meta, body });
      if (r.existed) vault.createItem('journal', { date, title: 'Day One', meta, body });
      report.journal++;
    } catch (e) { report.warnings.push(`${date}: ${e.message}`); }
  }
}

/* --------------------------------------------------------------------- vCard */
function importVcards(vault, vcfTexts, report) {
  for (const t of vcfTexts) {
    for (const c of parseVcf(t)) {
      try {
        const ex = vault.resolve(c.name);
        if (ex && ex.type === 'person') { report.skipped.push(`${c.name} (gibt es schon)`); continue; }
        const meta = {};
        if (c.nickname) meta.nickname = c.nickname;
        if (c.birthday) meta.birthday = c.birthday;
        if (c.phones.length) meta.phones = c.phones;
        if (c.emails.length) meta.emails = c.emails;
        if (c.addresses.length) meta.addresses = c.addresses;
        if (c.company) meta.company = c.company;
        if (c.job) meta.job = c.job;
        if (c.website) meta.website = c.website;
        if (c.tags.length) meta.tags = c.tags;
        if (c.photo && c.photo.data.length && c.photo.data.length < 8 * 1024 * 1024) {
          try { const ext = (c.photo.mime.split('/')[1] || 'jpeg').replace('jpg', 'jpeg'); meta.photo = vault.saveAttachment(`${slugify(c.name)}.${ext}`, c.photo.data).name; } catch (e) { /* Foto weglassen */ }
        }
        vault.createItem('person', { title: c.name, meta, body: c.notes });
        report.people++;
      } catch (e) { report.warnings.push(`${c.name}: ${e.message}`); }
    }
  }
}

/** files: [{name, data}] – liefert einen Bericht. */
function runImport(vault, uploaded, { mode = 'auto' } = {}) {
  const report = { people: 0, journal: 0, notes: 0, attachments: 0, skipped: [], warnings: [], format: 'markdown' };
  const files = expand(uploaded, report);
  const nameMap = new Map();
  vault.bulk(() => {
    // Anhänge zuerst, damit Verweise aufgelöst werden können
    for (const f of files) {
      if (!attachmentInfo(f.name) || !f.data.length) continue;
      try {
        const saved = vault.saveAttachment(base(f.name), f.data, { keepName: true });
        nameMap.set(base(f.name).toLowerCase(), saved.name); report.attachments++;
      } catch (e) { report.warnings.push(`${f.name}: ${e.message}`); }
    }
    const dayone = files.filter((f) => /\.json$/i.test(f.name)).map((f) => { try { return JSON.parse(f.data.toString('utf8')); } catch (e) { return null; } }).filter((j) => j && Array.isArray(j.entries) && (j.metadata || j.entries.some((e) => e.creationDate)));
    const vcfs = files.filter((f) => /\.(vcf|vcard)$/i.test(f.name)).map((f) => f.data.toString('utf8'));
    const md = files.filter((f) => /\.(md|markdown|txt)$/i.test(f.name));
    if (dayone.length) { report.format = 'dayone'; importDayOne(vault, dayone, files, report, nameMap); }
    if (vcfs.length) { report.format = dayone.length || md.length ? 'mixed' : 'vcard'; importVcards(vault, vcfs, report); }
    if (md.length) importMarkdown(vault, md, mode, report, nameMap);
  });
  if (!report.people && !report.journal && !report.notes && !report.attachments) report.warnings.push('Es wurde nichts Importierbares gefunden (erwartet: .md, .zip, Day-One-JSON, .vcf).');
  return report;
}

module.exports = { runImport };
