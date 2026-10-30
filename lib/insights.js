'use strict';
/** Auswertungen über den ganzen Bestand: Tagebuch-Orte, Jahresrückblick, Integritätsprüfung, Dubletten, Kalender (.ics). */
const fs = require('fs');
const path = require('path');
const { localDate, daysBetween, isDate, clampInt, slugify, attachmentInfo } = require('./util');

const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const people = (vault) => [...vault.index.values()].filter((i) => i.type === 'person');

function parseBirthday(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(?:--)?(\d{2})-(\d{2})$/); if (m) return { y: null, m: +m[1], d: +m[2] };
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/); if (m) return { y: m[3] ? +m[3] : null, m: +m[2], d: +m[1] };
  return null;
}

/* ------------------------------------------------------------ Tagebuch-Orte */
function journalPlaces(vault) {
  const by = new Map();
  for (const it of vault.index.values()) {
    if (it.type !== 'journal') continue;
    const name = String(it.meta.location || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (!by.has(k)) by.set(k, { name, items: [] });
    by.get(k).items.push({ slug: it.slug, date: it.date || '' });
  }
  return [...by.values()].map((p) => {
    p.items.sort((a, b) => b.date.localeCompare(a.date));
    return { name: p.name, count: p.items.length, items: p.items.slice(0, 12) };
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'));
}

/* --------------------------------------------------------------- Jahresrückblick */
function review(vault, year) {
  year = clampInt(year, 1900, 2200) || new Date().getFullYear();
  const pre = String(year);
  const journals = [...vault.index.values()].filter((i) => i.type === 'journal' && i.date && i.date.startsWith(pre));
  const moods = journals.filter((j) => j.mood);
  const avg = (l) => (l.length ? l.reduce((s, x) => s + x, 0) / l.length : null);
  const months = Array.from({ length: 12 }, (_, m) => {
    const l = moods.filter((j) => +j.date.slice(5, 7) === m + 1).map((j) => j.mood);
    return { month: m + 1, avg: avg(l), n: l.length, entries: journals.filter((j) => +j.date.slice(5, 7) === m + 1).length };
  });
  const dist = [1, 2, 3, 4, 5].map((v) => moods.filter((j) => j.mood === v).length);
  const best = moods.length ? [...moods].sort((a, b) => b.mood - a.mood || a.date.localeCompare(b.date))[0] : null;
  const worst = moods.length ? [...moods].sort((a, b) => a.mood - b.mood || a.date.localeCompare(b.date))[0] : null;
  // längste Serie aufeinanderfolgender Tage mit Eintrag
  const days = [...new Set(journals.map((j) => j.date))].sort();
  let streak = 0, bestStreak = 0, bestEnd = null;
  for (let i = 0; i < days.length; i++) {
    streak = i && daysBetween(days[i - 1], days[i]) === 1 ? streak + 1 : 1;
    if (streak > bestStreak) { bestStreak = streak; bestEnd = days[i]; }
  }
  let words = 0;
  for (const j of journals) if (!j.enc) words += (String(j.body || '').match(/\S+/g) || []).length;

  // Personen: Erwähnungen in Tagebuch-Einträgen des Jahres + Aktivitäten
  const pc = new Map();
  const bump = (slug, title, photo, k) => { if (!pc.has(slug)) pc.set(slug, { slug, title, photo, mentions: 0, activities: 0 }); pc.get(slug)[k]++; };
  const jIds = new Set(journals.map((j) => j.id));
  const acts = [];
  const places = new Map(), bumpPlace = (n) => { n = String(n || '').trim(); if (!n) return; const k = n.toLowerCase(); if (!places.has(k)) places.set(k, { name: n, count: 0 }); places.get(k).count++; };
  for (const p of people(vault)) {
    for (const bid of vault.backlinks.get(p.id) || []) if (jIds.has(bid)) bump(p.slug, p.title, p.meta.photo || '', 'mentions');
    for (const a of arr(p.meta.activities)) {
      const d = String(a.date || '').slice(0, 10);
      if (!isDate(d) || !d.startsWith(pre)) continue;
      bump(p.slug, p.title, p.meta.photo || '', 'activities'); bumpPlace(a.place);
      acts.push({ date: d, title: String(a.title || 'Aktivität'), person: p.title, slug: p.slug, place: a.place ? String(a.place) : '' });
    }
  }
  for (const j of journals) bumpPlace(j.meta.location);
  const topPeople = [...pc.values()].map((x) => ({ ...x, score: x.mentions + x.activities * 2 })).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'de')).slice(0, 8);
  const songs = new Map();
  for (const j of journals) { const s = String(j.meta.song || '').trim(); if (s) songs.set(s, (songs.get(s) || 0) + 1); }
  const tags = new Map();
  for (const j of journals) for (const t of j.tags) tags.set(t, (tags.get(t) || 0) + 1);
  const top = (m, n, f) => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'de')).slice(0, n).map(f);
  const newPeople = people(vault).filter((p) => { const c = String(p.meta.created || p.meta.met_date || ''); return c.startsWith(pre); }).length;
  const years = [...new Set([...vault.index.values()].filter((i) => i.type === 'journal' && i.date).map((i) => i.date.slice(0, 4)))].sort();
  return {
    year, years,
    entries: journals.length, words, avgMood: avg(moods.map((j) => j.mood)), moodDist: dist, months, best: best && { date: best.date, mood: best.mood, slug: best.slug }, worst: worst && { date: worst.date, mood: worst.mood, slug: worst.slug },
    streak: { days: bestStreak, end: bestEnd }, avgEnergy: avg(journals.filter((j) => j.energy).map((j) => j.energy)),
    people: topPeople, activities: acts.length, activityList: acts.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 40),
    places: [...places.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de')).slice(0, 10),
    songs: top(songs, 6, ([name, n]) => ({ name, n })), tags: top(tags, 10, ([name, n]) => ({ name, n })), newPeople,
  };
}

/* ---------------------------------------------------------------------- Dubletten */
const normName = (s) => slugify(String(s || '')).split('-').filter(Boolean).sort().join(' ');
function lev(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const similar = (a, b) => {
  if (!a || !b) return false;
  if (a === b) return true;
  const d = lev(a, b), len = Math.max(a.length, b.length);
  return len >= 5 && d <= (len >= 12 ? 2 : 1);
};
/** Personen mit sehr ähnlichem Namen (auch umgestellt: „Müller Anna“, oder mit ue/ü-Unterschied). */
function duplicatesOf(vault, name, exceptSlug) {
  const n = normName(name); if (!n) return [];
  const out = [];
  for (const p of people(vault)) {
    if (p.slug === exceptSlug) continue;
    const names = [p.title, ...p.aliases];
    if (names.some((x) => similar(n, normName(x)))) out.push({ slug: p.slug, title: p.title, birthday: p.meta.birthday ? String(p.meta.birthday) : '', photo: p.meta.photo || '' });
  }
  return out;
}
function allDuplicates(vault) {
  const list = people(vault), out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if ([a.title, ...a.aliases].some((x) => [b.title, ...b.aliases].some((y) => similar(normName(x), normName(y))))) out.push([a, b]);
  }
  return out;
}

/* --------------------------------------------------------------- Integritätsprüfung */
function integrity(vault) {
  const issues = [];
  const items = [...vault.index.values()];
  // 1. kaputte [[Links]]
  const broken = new Map();
  for (const it of items) {
    if (it.enc) continue;
    for (const t of it.links) if (!vault.resolve(t)) {
      const k = t.toLowerCase();
      if (!broken.has(k)) broken.set(k, { target: t, from: [] });
      const b = broken.get(k); if (!b.from.some((f) => f.id === it.id)) b.from.push({ id: it.id, type: it.type, slug: it.slug, title: it.title });
    }
  }
  for (const b of broken.values()) issues.push({ kind: 'broken-link', title: `Link auf „${b.target}“ führt ins Leere`, detail: `Verwendet in: ${b.from.slice(0, 5).map((f) => f.title).join(', ')}${b.from.length > 5 ? ` … (+${b.from.length - 5})` : ''}`, from: b.from.slice(0, 5), fixes: [{ action: 'create-note', label: 'Notiz anlegen', title: b.target }, { action: 'create-person', label: 'Person anlegen', title: b.target }] });
  // 2. Beziehungen auf nicht vorhandene Personen
  for (const p of people(vault)) {
    for (const r of arr(p.meta.relations)) {
      const t = r.person ? vault.resolve(String(r.person)) : null;
      if (!t || t.type !== 'person') issues.push({ kind: 'relation-missing', title: `${p.title}: Beziehung zu „${r.person}“ (${r.type || 'Sonstige'}) – diese Person gibt es nicht`, slug: p.slug, fixes: [{ action: 'create-person', label: 'Person anlegen', title: String(r.person) }, { action: 'remove-relation', label: 'Beziehung entfernen', slug: p.slug, person: String(r.person) }] });
    }
    // 3. Foto fehlt
    const ph = p.meta.photo ? String(p.meta.photo) : '';
    if (ph && !vault.files.has(ph.toLowerCase())) issues.push({ kind: 'photo-missing', title: `${p.title}: Foto „${ph}“ existiert nicht mehr`, slug: p.slug, fixes: [{ action: 'clear-photo', label: 'Foto-Verweis entfernen', slug: p.slug }] });
  }
  // 4. Stammbaum-Probleme
  try {
    const fam = require('./family');
    for (const msg of fam.build(vault).issues) issues.push({ kind: 'family', title: msg, fixes: [] });
    const err = fam.validate(vault, '', []);
    if (err && !fam.build(vault).issues.includes(err)) issues.push({ kind: 'family-cycle', title: err, fixes: [] });
  } catch (e) { /* egal */ }
  // 5. verwaiste und fehlende Anhänge
  vault.scanAttachments(true);
  const missingAtt = new Map();
  for (const it of items) {
    if (it.enc) continue;
    for (const m of String(it.body || '').matchAll(/!\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      const nm = m[1].trim();
      if (attachmentInfo(nm) && !vault.files.has(nm.toLowerCase())) { if (!missingAtt.has(nm.toLowerCase())) missingAtt.set(nm.toLowerCase(), { name: nm, from: [] }); missingAtt.get(nm.toLowerCase()).from.push({ type: it.type, slug: it.slug, title: it.title }); }
    }
  }
  for (const m of missingAtt.values()) issues.push({ kind: 'missing-attachment', title: `Eingebettete Datei „${m.name}“ fehlt`, detail: `Verwendet in: ${m.from.slice(0, 4).map((f) => f.title).join(', ')}`, from: m.from.slice(0, 4), fixes: [] });
  let hay = '';
  for (const it of items) hay += '\n' + (it.enc ? '' : String(it.body || '')) + '\n' + JSON.stringify(it.meta || {});
  hay = hay.toLowerCase();
  for (const f of vault.files.values()) if (!hay.includes(f.name.toLowerCase())) {
    let size = 0; try { size = fs.statSync(path.join(vault.ATT, f.folder, f.name)).size; } catch (e) { /* egal */ }
    issues.push({ kind: 'orphan-attachment', title: `Anhang „${f.name}“ wird nirgends verwendet`, detail: `${(size / 1024).toFixed(size > 1e5 ? 0 : 1).replace('.', ',')} KB`, name: f.name, fixes: [{ action: 'trash-attachment', label: 'In den Papierkorb', name: f.name }] });
  }
  // 6. mögliche Dubletten
  for (const [a, b] of allDuplicates(vault)) issues.push({ kind: 'duplicate', title: `Mögliche Dublette: „${a.title}“ und „${b.title}“`, people: [{ slug: a.slug, title: a.title }, { slug: b.slug, title: b.title }], fixes: [] });
  const order = { 'broken-link': 0, 'relation-missing': 1, 'photo-missing': 2, 'missing-attachment': 2, family: 3, 'family-cycle': 3, 'orphan-attachment': 4, duplicate: 5 };
  issues.sort((a, b) => order[a.kind] - order[b.kind]);
  issues.forEach((x, i) => { x.id = i; });
  return { issues, checked: { items: items.length, attachments: vault.files.size }, at: new Date().toISOString() };
}

function fixIssue(vault, f) {
  const fail = (m) => Object.assign(new Error(m), { status: 400 });
  switch (f.action) {
    case 'create-note': { const t = String(f.title || '').trim(); if (!t) throw fail('Titel fehlt'); return vault.createItem('note', { title: t }); }
    case 'create-person': { const t = String(f.title || '').trim(); if (!t) throw fail('Name fehlt'); return vault.createItem('person', { title: t }); }
    case 'remove-relation': {
      const it = vault.getItem('person', f.slug); if (!it) throw fail('Person nicht gefunden');
      const rest = arr(it.meta.relations).filter((r) => String(r.person || '').toLowerCase() !== String(f.person || '').toLowerCase());
      vault.updateItem(it, { meta: { relations: rest.length ? rest : null } }); return { ok: true };
    }
    case 'clear-photo': { const it = vault.getItem('person', f.slug); if (!it) throw fail('Person nicht gefunden'); vault.updateItem(it, { meta: { photo: null } }); return { ok: true }; }
    case 'trash-attachment': return vault.trashAttachment(String(f.name || ''));
    default: throw fail('Unbekannte Aktion');
  }
}

/* ------------------------------------------------------------------ Kalender (.ics) */
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) { const b = Buffer.byteLength(ch); if (bytes + b > 73) { out.push(cur); cur = ' '; bytes = 1; } cur += ch; bytes += b; }
  out.push(cur); return out.join('\r\n');
}
const ymd = (y, m, d) => `${String(y).padStart(4, '0')}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
const plusDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10).replace(/-/g, ''); };

function ics(vault, { name = 'Memoria', today = localDate() } = {}) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Memoria//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`, 'X-WR-TIMEZONE:Europe/Berlin', 'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = (uid, startYmd, title, extra = []) => {
    const s = startYmd.replace(/-/g, '');
    const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    L.push('BEGIN:VEVENT', `UID:${uid}@memoria`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${s}`, `DTEND;VALUE=DATE:${plusDay(iso)}`, `SUMMARY:${esc(title)}`, ...extra, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  };
  const cy = +today.slice(0, 4);
  for (const p of people(vault)) {
    const b = parseBirthday(p.meta.birthday);
    if (b && b.m >= 1 && b.m <= 12 && b.d >= 1 && b.d <= 31) {
      const y0 = b.y && b.y >= 1900 ? b.y : cy;
      ev(`bday-${p.slug}`, ymd(y0, b.m, b.d), `🎂 ${p.title}${b.y ? ` (Geburtstag)` : ''}`, ['RRULE:FREQ=YEARLY', 'CATEGORIES:Geburtstag']);
    }
    const dd = String(p.meta.died || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dd) ev(`died-${p.slug}`, ymd(+dd[1], +dd[2], +dd[3]), `🕯️ Todestag ${p.title}`, ['RRULE:FREQ=YEARLY', 'CATEGORIES:Gedenktag']);
    const every = clampInt(p.meta.contact_every, 1, 3650);
    if (every) {
      const last = p.lastContact; let due = last ? new Date(Date.UTC(+last.slice(0, 4), +last.slice(5, 7) - 1, +last.slice(8, 10) + every)).toISOString().slice(0, 10) : today;
      if (due < today) due = today;
      ev(`contact-${p.slug}`, due, `📞 Mal wieder melden: ${p.title}`, [`DESCRIPTION:${esc(last ? `Letzter Kontakt: ${last}` : 'Noch kein Kontakt eingetragen')}`, 'CATEGORIES:Kontakt']);
    }
    arr(p.meta.activities).forEach((a, i) => {
      const d = String(a.date || '').slice(0, 10);
      if (isDate(d) && d >= today) ev(`act-${p.slug}-${i}`, d, `📅 ${a.title || 'Treffen'} – ${p.title}`, a.place ? [`LOCATION:${esc(a.place)}`] : []);
    });
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

module.exports = { journalPlaces, review, duplicatesOf, allDuplicates, integrity, fixIssue, ics, parseBirthday };
