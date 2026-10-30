'use strict';
/**
 * Ein Vault = der Datenbereich eines Benutzers:
 *   people/ journal/ notes/ attachments/<endung>/ templates/ .trash/
 * Enthält Index, Wikilink-Auflösung, Backlinks, Rendering und alle Lese-/Schreiboperationen.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { IndexDb } = require('./indexdb');
const { History } = require('./history');
const MarkdownIt = require('markdown-it');
const U = require('./util');
const { slugify, pad, localDate, localTime, addDays, daysBetween, isDate, clampInt, toList, safeSlug, enc, parseFM, dumpFM, attachmentInfo } = U;

const TYPES = { person: 'people', journal: 'journal', note: 'notes' };
const RELATION_TYPES = ['Partner', 'Ehepartner', 'Kind', 'Elternteil', 'Geschwister', 'Großeltern', 'Enkel', 'Freund', 'Kollege', 'Chef', 'Mitarbeiter', 'Mentor', 'Mentee', 'Nachbar', 'Sonstige'];
const INVERSE = { Kind: 'Elternteil', Elternteil: 'Kind', Großeltern: 'Enkel', Enkel: 'Großeltern', Chef: 'Mitarbeiter', Mitarbeiter: 'Chef', Mentor: 'Mentee', Mentee: 'Mentor' };
const rawPlaces = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]/).map((x) => x.trim()).filter(Boolean) : []);
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

const WIKI = /(!?)\[\[([^\[\]|#]+?)(?:#([^\[\]|]*))?(?:\|([^\[\]]*))?\]\]/g;
const TAG = /(^|[\s(])#([\p{L}][\p{L}\p{N}_\/-]*)/gu;
const CODE_SPLIT = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;
const norm = (s) => String(s).trim().toLowerCase().replace(/\.md$/, '').replace(/^(people|journal|notes)\//, '');
const stripCode = (body) => body.split(CODE_SPLIT).filter((_, i) => i % 2 === 0).join(' ');

function extractLinks(text) {
  const out = [];
  for (const m of stripCode(text).matchAll(WIKI)) {
    if (m[1] && attachmentInfo(m[2])) continue; // Datei-Einbettung ist kein Link
    out.push(m[2].trim());
  }
  return out;
}
const extractTags = (text) => [...stripCode(text).matchAll(TAG)].map((m) => m[2]);

function plain(text) {
  return stripCode(text).replace(/!\[\[[^\]]*\]\]/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, a, b) => b || a)
    .replace(/^[#>\s*-]+/gm, '').replace(/[*_`~]+/g, '').replace(/\s+/g, ' ').trim();
}
const firstH1 = (body) => { const m = body.match(/^#\s+(.+)$/m); return m ? m[1].trim() : null; };

/* ----------------------------------------------------------- Markdown */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const defLinkOpen = md.renderer.rules.link_open || ((t, i, o, e, s) => s.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  const t = tokens[idx];
  const href = t.attrGet('href') || '';
  const ti = t.attrGet('title');
  if (ti && ti.startsWith('md:')) { t.attrSet('data-md', ti.slice(3)); t.attrSet('contenteditable', 'false'); t.attrs.splice(t.attrIndex('title'), 1); }
  if (href.startsWith('#/new')) t.attrJoin('class', 'wikilink broken');
  else if (href.startsWith('#/tag/')) t.attrJoin('class', 'tag');
  else if (href.startsWith('#/')) t.attrJoin('class', 'wikilink');
  else if (href.startsWith('/files/')) t.attrSet('target', '_blank');
  else { t.attrSet('target', '_blank'); t.attrSet('rel', 'noopener noreferrer'); }
  return defLinkOpen(tokens, idx, opts, env, self);
};
md.renderer.rules.image = (tokens, idx, opts, env) => {
  const t = tokens[idx];
  let src = t.attrGet('src') || '';
  const alt = t.content || '';
  if (!/^(https?:|data:image\/|\/)/i.test(src)) {
    let base = src; try { base = decodeURIComponent(src); } catch (e) { /* ignorieren */ }
    src = env && env.V ? env.V.fileUrl(path.basename(base)) : '/files/' + enc(path.basename(base));
  }
  const width = /^\d{2,4}$/.test(alt) ? ` width="${alt}"` : '';
  let dm = '';
  if (env && env.edit) { const ti = t.attrGet('title'); dm = ` data-md="${md.utils.escapeHtml(ti && ti.startsWith('md:') ? ti.slice(3) : encodeURIComponent('![' + alt + '](' + (t.attrGet('src') || '') + ')'))}" contenteditable="false"`; }
  return `<img src="${md.utils.escapeHtml(src)}" alt="${width ? '' : md.utils.escapeHtml(alt)}"${width}${dm} loading="lazy">`;
};

function parseBirthday(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(?:--)?(\d{2})-(\d{2})$/); if (m) return { y: null, m: +m[1], d: +m[2] };
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/); if (m) return { y: m[3] ? +m[3] : null, m: +m[2], d: +m[1] };
  return null;
}

/* -------------------------------------------------------------- Vault */
const ENC_RE = /^\s*-----BEGIN MEMORIA ENCRYPTED-----/;
const metaText = (meta) => { try { return Object.values(meta).map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' '); } catch (e) { return ''; } };

class Vault extends EventEmitter {
  constructor(dir, opts = {}) {
    super();
    this.dir = dir;
    this.db = new IndexDb(opts.dbFile || ':memory:');
    this.history = new History(dir);
    this.watchers = []; this.watching = false; this.dirty = true;
    this.ATT = path.join(dir, 'attachments');
    this.TRASH = path.join(dir, '.trash');
    this.index = new Map();
    this.lookup = new Map();
    this.backlinks = new Map();
    this.files = new Map(); // dateiname(klein) -> {folder, name}
    this.lastScan = 0; this.lastAttScan = 0;
  }

  init() {
    for (const d of [...Object.values(TYPES), 'attachments']) fs.mkdirSync(path.join(this.dir, d), { recursive: true });
    this.seed();
    this.loadCache();
    this.scan(true);
    if (!this.noWatch) this.startWatch();
  }

  /** Index aus dem SQLite-Zwischenspeicher laden; scan() prüft danach nur noch geänderte Dateien. */
  loadCache() {
    for (const r of this.db.rows()) {
      const it = { id: r.id, type: r.type, slug: r.slug, mtime: r.mtime, size: r.size, title: r.title, date: r.date, mood: r.mood, energy: r.energy,
        enc: !!r.enc, tags: JSON.parse(r.tags), aliases: JSON.parse(r.aliases), meta: JSON.parse(r.meta), links: JSON.parse(r.links), snippet: r.snippet };
      this.index.set(it.id, this.live(it));
    }
    if (this.index.size) this.rebuild();
  }
  live(it) {
    Object.defineProperty(it, 'body', { get: () => this.db.body(it.id), enumerable: false, configurable: true });
    return it;
  }

  /** Dateisystem beobachten: Änderungen von außen (Obsidian, Sync, Editor) erscheinen sofort. */
  startWatch() {
    const onChange = (name) => {
      if (name && (String(name).startsWith('.') || /\.tmp/.test(String(name)))) return;
      this.dirty = true;
      clearTimeout(this._wt);
      this._wt = setTimeout(() => { try { this.scan(true); } catch (e) { console.error('Scan', e.message); } this.emit('change'); }, 250);
    };
    for (const d of [...Object.values(TYPES), 'templates', 'attachments']) {
      try {
        const w = fs.watch(path.join(this.dir, d), { recursive: d === 'attachments' }, (ev, name) => onChange(name));
        w.on('error', () => {}); this.watchers.push(w);
      } catch (e) { /* nicht beobachtbar – dann greift die zeitgesteuerte Prüfung */ }
    }
    this.watching = this.watchers.length >= Object.keys(TYPES).length;
  }
  close() { clearTimeout(this._wt); this.watchers.forEach((w) => { try { w.close(); } catch (e) { /* egal */ } }); this.watchers = []; this.watching = false; this.db.close(); }

  seed() {
    const empty = Object.values(TYPES).every((d) => fs.readdirSync(path.join(this.dir, d)).filter((f) => f.endsWith('.md')).length === 0);
    if (!empty) return;
    fs.writeFileSync(path.join(this.dir, 'notes', 'willkommen.md'), dumpFM({ title: 'Willkommen bei Memoria', tags: ['memoria'] },
`# Willkommen bei Memoria

Alles, was du hier schreibst, liegt als normale Markdown-Datei in deinem Datenordner.

## So funktioniert's

- **Personen** pflegst du wie in Monica: Kontaktdaten, Geburtstag, Notizen.
- **Tagebuch**: ein Eintrag pro Tag, dazu Stimmung, Energie und optional ein Lied des Tages.
- **Verlinken** mit \`[[Name]]\` – wie in Obsidian. Tippe \`[[\`, dann erscheint die Auswahl.
- **Bilder & Dateien**: in den Editor ziehen oder einfügen (\`![[bild.png]]\`). Sie landen je nach Typ in \`attachments/jpeg\`, \`attachments/pdf\` usw.
- **Tags** schreibst du als \`#tag\`.
- Unter *Einstellungen* wählst du Design, Funktionsumfang (Minimal / Standard / Pro …) und richtest die WebDAV-Synchronisierung ein.

> Diese Notiz kannst du jederzeit löschen.
`));
  }

  fileFor(type, slug) { return path.join(this.dir, TYPES[type], slug + '.md'); }

  /* ---- Anhänge ---- */
  scanAttachments(force) {
    const now = Date.now();
    if (!force && now - this.lastAttScan < 4000) return;
    this.lastAttScan = now;
    const map = new Map();
    let entries = [];
    try { entries = fs.readdirSync(this.ATT, { withFileTypes: true }); } catch (e) { /* leer */ }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) {
        let fl = []; try { fl = fs.readdirSync(path.join(this.ATT, e.name)); } catch (x) { /* ignorieren */ }
        for (const f of fl) if (!f.startsWith('.') && attachmentInfo(f)) { const k = f.toLowerCase(); if (!map.has(k)) map.set(k, { folder: e.name, name: f }); }
      } else if (attachmentInfo(e.name)) map.set(e.name.toLowerCase(), { folder: '', name: e.name });
    }
    this.files = map;
  }
  fileUrl(name) {
    const f = this.files.get(String(name).toLowerCase());
    if (f) return '/files/' + (f.folder ? enc(f.folder) + '/' : '') + enc(f.name);
    return '/files/' + enc(name);
  }
  /** Absoluter Pfad zu einer Datei unter /files/…, oder null. */
  attachmentPath(rel) {
    const parts = rel.split('/').filter(Boolean);
    if (parts.some((p) => p.startsWith('.') || p.includes('\0'))) return null;
    if (parts.length === 1) {
      this.scanAttachments(false);
      const f = this.files.get(parts[0].toLowerCase());
      return f ? path.join(this.ATT, f.folder, f.name) : null;
    }
    const full = path.join(this.ATT, ...parts);
    if (!full.startsWith(this.ATT + path.sep)) return null;
    return full;
  }
  saveAttachment(filename, data, { keepName = false } = {}) {
    const info = attachmentInfo(filename);
    if (!info) throw Object.assign(new Error('Dateityp nicht erlaubt (Bilder, PDF, Audio, Video)'), { status: 400 });
    if (!keepName || !this._attScanned) { this.scanAttachments(true); this._attScanned = true; }
    const clean = keepName ? path.basename(filename, path.extname(filename)).replace(/[\/\\:*?"<>|\u0000-\u001f\[\]#^]/g, '_').slice(0, 100) : '';
    const base = keepName && clean ? clean : slugify(path.basename(filename, path.extname(filename))).slice(0, 40);
    let name = `${base}.${info.ext}`;
    if (this.files.has(name.toLowerCase())) {
      if (keepName) { const ex = path.join(this.ATT, this.files.get(name.toLowerCase()).folder, name); try { if (require('fs').readFileSync(ex).equals(data)) return { name, folder: info.folder, kind: info.kind, url: this.fileUrl(name), markdown: `![[${name}]]`, existed: true }; } catch (e) { /* weiter */ } }
      name = `${base}-${crypto.randomBytes(3).toString('hex')}.${info.ext}`;
    }
    const dir = path.join(this.ATT, info.folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
    this.files.set(name.toLowerCase(), { folder: info.folder, name });
    return { name, folder: info.folder, kind: info.kind, url: this.fileUrl(name), markdown: `![[${name}]]` };
  }
  listAttachments() {
    this.scanAttachments(true);
    const out = [];
    for (const f of this.files.values()) {
      const full = path.join(this.ATT, f.folder, f.name);
      let st; try { st = fs.statSync(full); } catch (e) { continue; }
      out.push({ name: f.name, folder: f.folder, kind: attachmentInfo(f.name).kind, size: st.size, mtime: st.mtimeMs, url: this.fileUrl(f.name) });
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  /* ---- Index ---- */
  parseItem(type, slug, file, mtime, size) {
    const raw = fs.readFileSync(file, 'utf8');
    const { meta, body } = parseFM(raw);
    const it = { id: `${type}/${slug}`, type, slug, mtime, size, meta, bodyText: body, date: null };
    if (type === 'journal') {
      const dm = slug.match(/^(\d{4}-\d{2}-\d{2})/);
      it.date = isDate(String(meta.date || '').slice(0, 10)) ? String(meta.date).slice(0, 10) : dm ? dm[1] : null;
      it.title = meta.title ? String(meta.title) : slug;
      it.aliases = slug === it.date ? [it.date] : [];
    } else if (type === 'person') {
      it.title = String(meta.name || slug);
      it.aliases = [...toList(meta.aliases), ...(meta.nickname ? [String(meta.nickname)] : [])];
    } else {
      it.title = String(meta.title || (ENC_RE.test(body) ? '' : firstH1(body)) || slug);
      it.aliases = toList(meta.aliases);
      const nd = String(meta.date || '').slice(0, 10); it.date = isDate(nd) ? nd : null;
    }
    it.mood = clampInt(meta.mood, 1, 5);
    it.energy = clampInt(meta.energy, 1, 5);
    it.enc = meta.encrypted === true || ENC_RE.test(body);
    it.tags = [...new Set([...toList(meta.tags), ...(it.enc ? [] : extractTags(body))])];
    it.links = it.enc ? [] : extractLinks(body);
    it.snippet = it.enc ? '🔒 Verschlüsselt' : plain(body).slice(0, 220);
    return it;
  }

  resolve(target) {
    const k = norm(target);
    return this.lookup.get(k) || this.lookup.get(slugify(k)) || null;
  }

  rebuild() {
    this.lookup = new Map();
    const add = (k, it) => { if (!k) return; k = norm(k); if (k && !this.lookup.has(k)) this.lookup.set(k, it); };
    const order = { person: 0, note: 1, journal: 2 };
    const items = [...this.index.values()].sort((a, b) => order[a.type] - order[b.type]);
    for (const it of items) { add(it.title, it); add(it.slug, it); for (const a of it.aliases) add(a, it); }
    this.backlinks = new Map();
    for (const it of this.index.values()) {
      it.out = new Set();
      for (const t of it.links) { const tgt = this.resolve(t); if (tgt && tgt !== it) it.out.add(tgt.id); }
      for (const id of it.out) { if (!this.backlinks.has(id)) this.backlinks.set(id, []); this.backlinks.get(id).push(it.id); }
    }
    for (const it of this.index.values()) {
      if (it.type !== 'person') continue;
      let last = isDate(String(it.meta.last_contact || '').slice(0, 10)) ? String(it.meta.last_contact).slice(0, 10) : null;
      for (const bid of this.backlinks.get(it.id) || []) {
        const b = this.index.get(bid);
        if (b && b.type === 'journal' && b.date && (!last || b.date > last)) last = b.date;
      }
      for (const a of arr(it.meta.activities)) { const d = String(a.date || '').slice(0, 10); if (isDate(d) && (!last || d > last) && d <= localDate()) last = d; }
      it.lastContact = last;
    }
  }

  /** Speichert ein (neu) geparstes Element im Index und im SQLite-Cache. */
  _store(it) {
    const searchable = metaText(it.meta);
    this.db.put(it, it.size, searchable);
    const { bodyText, ...rest } = it;
    this.index.set(it.id, this.live(rest));
  }

  scan(force) {
    const now = Date.now();
    if (!force) {
      if (this.watching ? (!this.dirty && now - this.lastScan < 60000) : now - this.lastScan < 1000) return;
    }
    this.lastScan = now; this.dirty = false;
    this.scanAttachments(true);
    const seen = new Set();
    let changed = false, open = false;
    try {
      for (const [type, dir] of Object.entries(TYPES)) {
        const full = path.join(this.dir, dir);
        let files = [];
        try { files = fs.readdirSync(full); } catch (e) { /* fehlt */ }
        for (const f of files) {
          if (!f.endsWith('.md') || f.startsWith('.')) continue;
          const slug = f.slice(0, -3), id = `${type}/${slug}`;
          seen.add(id);
          let st; try { st = fs.statSync(path.join(full, f)); } catch (e) { continue; }
          const cur = this.index.get(id);
          if (cur && cur.mtime === st.mtimeMs && cur.size === st.size) continue;
          try {
            if (!open) { this.db.begin(); open = true; }
            this._store(this.parseItem(type, slug, path.join(full, f), st.mtimeMs, st.size)); changed = true;
          } catch (e) { console.error('Fehler beim Lesen', f, e.message); }
        }
      }
      for (const id of [...this.index.keys()]) if (!seen.has(id)) { if (!open) { this.db.begin(); open = true; } this.db.remove(id); this.index.delete(id); changed = true; }
      if (open) this.db.commit();
    } catch (e) { if (open) this.db.rollback(); throw e; }
    if (changed) this.rebuild();
  }

  /** Eine einzelne Datei sofort neu einlesen (nach eigenem Schreiben). */
  reindex(type, slug) {
    const file = this.fileFor(type, slug);
    const st = fs.statSync(file);
    this.db.begin();
    try { this._store(this.parseItem(type, slug, file, st.mtimeMs, st.size)); this.db.commit(); } catch (e) { this.db.rollback(); throw e; }
    if (!this._defer) this.rebuild();
    else { const it = this.index.get(`${type}/${slug}`); const add = (k) => { k = norm(k || ''); if (k && !this.lookup.has(k)) this.lookup.set(k, it); }; add(it.title); add(it.slug); it.aliases.forEach(add); }
  }

  getItem(type, slug) {
    if (!TYPES[type] || !safeSlug(slug)) return null;
    return this.index.get(`${type}/${slug}`) || null;
  }

  summary(it) {
    const s = {
      id: it.id, type: it.type, slug: it.slug, title: it.title, aliases: it.aliases, tags: it.tags,
      date: it.date, mood: it.mood, energy: it.energy, mtime: it.mtime, snippet: it.snippet, enc: !!it.enc,
    };
    if (it.type === 'journal') { s.song = it.meta.song ? String(it.meta.song) : ''; s.songUrl = it.meta.song_url ? String(it.meta.song_url) : ''; }
    if (it.type === 'person') {
      const m = it.meta;
      Object.assign(s, {
        relationship: m.relationship || '', company: m.company || '', birthday: m.birthday || '', photo: m.photo || '',
        deceased: !!(m.died || m.deathplace || m.deceased === true || m.deceased === 'true'),
        lastContact: it.lastContact || null, contactEvery: clampInt(m.contact_every, 1, 3650),
        mentions: (this.backlinks.get(it.id) || []).length,
      });
    }
    return s;
  }

  lineContext(src, targetId) {
    for (const line of src.body.split('\n')) {
      if (!line.includes('[[')) continue;
      for (const t of extractLinks(line)) {
        const tgt = this.resolve(t);
        if (tgt && tgt.id === targetId) return line.replace(/^[\s>*-]+/, '').replace(/!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (m, a, b) => b || a).trim().slice(0, 240);
      }
    }
    return '';
  }

  /* ---- Rendering ---- */
  _transform(p, ctx) {
    p = p.replace(WIKI, (m, bang, target, heading, alias) => {
      target = target.trim();
      if (bang) {
        const info = attachmentInfo(target);
        if (info) {
          const url = this.fileUrl(path.basename(target));
          const E = ctx.edit ? ` "md:${encodeURIComponent(m)}"` : '';
          if (info.kind === 'image') return `![${/^\d{2,4}$/.test(alias || '') ? alias : target.replace(/[\[\]]/g, '')}](${url}${E})`;
          if (info.kind === 'audio') { ctx.media.push(`<audio controls preload="none" src="${url}"${ctx.edit ? ` data-md="${encodeURIComponent(m)}" contenteditable="false"` : ''}></audio>`); return `@@MEDIA${ctx.media.length - 1}@@`; }
          if (info.kind === 'video') { ctx.media.push(`<video controls preload="metadata" src="${url}"${ctx.edit ? ` data-md="${encodeURIComponent(m)}" contenteditable="false"` : ''}></video>`); return `@@MEDIA${ctx.media.length - 1}@@`; }
          return `[📄 ${target.replace(/[\[\]]/g, '')}](${url}${E})`;
        }
      }
      const tgt = this.resolve(target);
      let text = alias || (tgt ? tgt.title : target);
      if (!alias && heading) text += ' › ' + heading;
      text = text.replace(/[\[\]]/g, '\\$&');
      const href = tgt ? `#/${tgt.type}/${enc(tgt.slug)}` : `#/new?title=${enc(target)}`;
      return `[${text}](${href}${ctx.edit ? ` "md:${encodeURIComponent(m)}"` : ''})`;
    });
    return p.replace(TAG, (m, pre, tag) => `${pre}[#${tag}](#/tag/${enc(tag)}${ctx.edit ? ` "md:${encodeURIComponent('#' + tag)}"` : ''})`);
  }
  renderMd(body, edit = false) {
    const ctx = { media: [], edit: !!edit };
    const parts = String(body || '').split(CODE_SPLIT);
    const src = parts.map((p, i) => (i % 2 ? p : this._transform(p, ctx))).join('');
    let html = md.render(src, { V: this, edit: !!edit });
    html = html.replace(/<p>(@@MEDIA\d+@@)<\/p>/g, '$1').replace(/@@MEDIA(\d+)@@/g, (m, i) => ctx.media[+i] || '');
    return html.replace(/<li>\[( |x|X)\]\s/g, (m, c) => `<li class="task"><input type="checkbox"${edit ? '' : ' disabled'}${c === ' ' ? '' : ' checked'}> `);
  }

  /* ---- Schreiben ---- */
  writeItem(type, slug, meta, body, reason = 'save') {
    const file = this.fileFor(type, slug);
    const content = dumpFM(meta, body);
    let old = null; try { old = fs.readFileSync(file, 'utf8'); } catch (e) { /* neu */ }
    if (old !== null && old === content) return;
    if (old !== null) { try { this.history.snapshot(type, slug, old, reason, reason !== 'save'); } catch (e) { console.error('Verlauf', e.message); } }
    if (ENC_RE.test(body || '')) { try { this.history.purgePlain(type, slug); } catch (e) { /* egal */ } }
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
    this.reindex(type, slug);
  }

  /** Viele Schreibvorgänge bündeln: der Link-Index wird erst am Ende neu aufgebaut. */
  bulk(fn) {
    this._defer = true;
    try { return fn(); } finally { this._defer = false; this.rebuild(); this.emit('change'); }
  }
  uniqueSlug(type, base) {
    let slug = base, n = 2;
    while (fs.existsSync(this.fileFor(type, slug))) slug = `${base}-${n++}`;
    return slug;
  }
  journalTemplate() {
    try { return parseFM(fs.readFileSync(path.join(this.dir, 'templates', 'journal.md'), 'utf8')); } catch (e) { return { meta: {}, body: '' }; }
  }
  trash(abs, label) {
    fs.mkdirSync(this.TRASH, { recursive: true });
    fs.renameSync(abs, path.join(this.TRASH, `${Date.now()}-${label.replace(/[\/\\]/g, '_')}`));
  }
  /** Verschiebt einen Anhang in den Papierkorb. */
  trashAttachment(name) {
    this.scanAttachments(true);
    const f = this.files.get(String(name).toLowerCase());
    if (!f) throw Object.assign(new Error('Anhang nicht gefunden'), { status: 404 });
    this.trash(path.join(this.ATT, f.folder, f.name), `attachment-${f.name}`);
    this.files.delete(f.name.toLowerCase());
    return { ok: true };
  }
  ensureJournal(date) {
    date = isDate(date) ? date : localDate();
    let it = this.index.get(`journal/${date}`);
    if (!it) { const tpl = this.journalTemplate(); this.writeItem('journal', date, tpl.meta, tpl.body); it = this.index.get(`journal/${date}`); }
    return it;
  }

  createItem(type, { title, date, meta, body }) {
    meta = { ...(meta || {}) }; body = body || '';
    let slug;
    if (type === 'journal') {
      date = isDate(date) ? date : localDate();
      slug = date;
      if (fs.existsSync(this.fileFor(type, slug))) {
        if (!title) return { id: `${type}/${slug}`, slug, existed: true };
        slug = this.uniqueSlug(type, `${date}-${slugify(title)}`);
      }
      if (title) meta.title = title;
      const tpl = this.journalTemplate();
      meta = { ...tpl.meta, ...meta };
      if (!body) body = tpl.body;
    } else {
      if (!title || !String(title).trim()) throw Object.assign(new Error('Titel fehlt'), { status: 400 });
      title = String(title).trim();
      slug = this.uniqueSlug(type, slugify(title));
      if (type === 'person') meta.name = title; else meta.title = title;
    }
    this.writeItem(type, slug, meta, body);
    return { id: `${type}/${slug}`, slug };
  }

  updateItem(it, { meta, body, baseMtime, force }) {
    if (!force && baseMtime && it.mtime > Number(baseMtime) + 1) {
      throw Object.assign(new Error('Die Datei wurde zwischenzeitlich geändert (z. B. in Obsidian oder per Sync).'), { status: 409, data: { conflict: true } });
    }
    let newDate; // Datum von Tagebuch-Einträgen und Notizen (Feld „date“)
    if (meta && it.type !== 'person' && 'date' in meta) { newDate = String(meta.date || '').slice(0, 10); meta = { ...meta }; delete meta.date; }
    const newMeta = { ...it.meta, ...(meta || {}) };
    for (const [k, v] of Object.entries(meta || {})) if (v === null || v === '') delete newMeta[k];
    if (it.type === 'person' && meta && Array.isArray(meta.addresses)) newMeta.addresses = meta.addresses.map((a) => { if (!a || typeof a !== 'object') return a; const o = { ...a }; const la = Number(o.lat), lo = Number(o.lon); if (o.lat === undefined || o.lat === '' || !Number.isFinite(la) || Math.abs(la) > 90 || !Number.isFinite(lo) || Math.abs(lo) > 180) { delete o.lat; delete o.lon; } else { o.lat = Math.round(la * 1e6) / 1e6; o.lon = Math.round(lo * 1e6) / 1e6; } return o; });
    if (it.type === 'person' && meta && Array.isArray(newMeta.addresses)) { let seen = false; newMeta.addresses = newMeta.addresses.map((a) => { if (!a || typeof a !== 'object') return a; const o = { ...a }; if (o.home && !seen) seen = true; else delete o.home; return o; }); }
    if (it.type === 'person' && meta && 'places' in meta) {
      const seen = new Set(), out = [];
      for (const x of rawPlaces(meta.places)) {
        const o = typeof x === 'string' ? { name: x } : x; const name = o && String(o.name || '').trim().slice(0, 120);
        if (!name) continue;
        const la = Number(o.lat), lo = Number(o.lon), good = o.lat !== undefined && o.lat !== '' && Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
        const yr = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 1000 && n <= 2200 ? n : undefined; };
        const e = good ? { name, lat: Math.round(la * 1e6) / 1e6, lon: Math.round(lo * 1e6) / 1e6 } : { name };
        const f = yr(o.from), t = yr(o.to); if (f) e.from = f; if (t) e.to = t;
        if (good && o.region) e.region = String(o.region).slice(0, 120);
        const dk = `${name.toLowerCase()}|${e.from || ''}|${e.to || ''}`; if (seen.has(dk)) continue; seen.add(dk);
        out.push(e);
      }
      if (out.length) newMeta.places = out; else delete newMeta.places;
    }
    if (it.type === 'person' && meta && Array.isArray(meta.relations)) { const bad = require('./family').validate(this, it.slug, newMeta.relations); if (bad) throw Object.assign(new Error(bad), { status: 400 }); }
    const key = it.type === 'person' ? 'name' : it.type === 'note' ? 'title' : null;
    if (key && it.meta[key] && newMeta[key] && it.meta[key] !== newMeta[key]) {
      const al = toList(newMeta.aliases);
      if (!al.includes(it.meta[key])) al.push(String(it.meta[key]));
      newMeta.aliases = al;
    }
    if (it.type === 'note' && newDate !== undefined) { if (isDate(newDate)) newMeta.date = newDate; else delete newMeta.date; }
    const moveTo = it.type === 'journal' && isDate(newDate) && newDate !== it.date ? newDate : null;
    if (it.type === 'journal' && !moveTo && isDate(newDate) && newMeta.date) newMeta.date = newDate;
    this.writeItem(it.type, it.slug, newMeta, typeof body === 'string' ? body : it.body);
    if (moveTo) { const slug = this.changeJournalDate(this.index.get(it.id), moveTo); return { ok: true, slug, mtime: this.index.get(`journal/${slug}`).mtime }; }
    return { ok: true, slug: it.slug, mtime: this.index.get(it.id).mtime };
  }

  /** Verschiebt ein Element (neuer Typ und/oder Name), nimmt Verlauf mit und biegt Verweise per Dateiname/Datum um. */
  relocate(it, newType, newSlug, newMeta) {
    const body = it.body, oldFile = this.fileFor(it.type, it.slug);
    const keys = [it.slug]; if (it.type === 'journal' && it.date && it.slug === it.date) keys.push(it.date);
    if (newType !== it.type || newSlug !== it.slug) {
      try { this.history.move(it.type, it.slug, newType, newSlug); } catch (e) { console.error('Verlauf', e.message); }
    }
    this.writeItem(newType, newSlug, newMeta, body, 'move');
    if (newType !== it.type || newSlug !== it.slug) { try { fs.unlinkSync(oldFile); } catch (e) { /* weg */ } }
    this.scan(true);
    if (newSlug !== it.slug) this.relink(keys, newSlug);
    return { type: newType, slug: newSlug };
  }
  /** [[alt]] → [[neu]] in allen (unverschlüsselten) Texten. */
  relink(oldKeys, newKey) {
    const set = new Set(oldKeys.map(norm));
    this.bulk(() => {
      for (const o of [...this.index.values()]) {
        if (o.enc || !(o.links || []).some((l) => set.has(norm(l)))) continue;
        let changed = false;
        const nb = String(o.body).split(CODE_SPLIT).map((part, i) => (i % 2 ? part : part.replace(WIKI, (m, bang, target, heading, alias) => {
          if (bang && attachmentInfo(target.trim())) return m;
          if (!set.has(norm(target))) return m;
          changed = true;
          return `${bang}[[${newKey}${heading !== undefined ? '#' + heading : ''}${alias !== undefined ? '|' + alias : ''}]]`;
        }))).join('');
        if (changed) this.writeItem(o.type, o.slug, o.meta, nb, 'relink');
      }
    });
  }
  changeJournalDate(it, date) {
    const title = it.meta.title ? String(it.meta.title) : '';
    const m = it.slug.match(/^(\d{4}-\d{2}-\d{2})(.*)$/);
    const meta = { ...it.meta };
    if (!m) { meta.date = date; this.writeItem('journal', it.slug, meta, it.body); return it.slug; }
    let slug = date + m[2];
    if (this.index.has(`journal/${slug}`)) slug = this.uniqueSlug('journal', `${date}-${slugify(title) || 'eintrag'}`);
    delete meta.date;
    return this.relocate(it, 'journal', slug, meta).slug;
  }
  /** Notiz ⇄ Tagebucheintrag. */
  convertItem(it, to, date) {
    if (!['journal', 'note'].includes(it.type) || !['journal', 'note'].includes(to) || it.type === to) throw Object.assign(new Error('Umwandeln geht nur zwischen Notiz und Tagebucheintrag'), { status: 400 });
    const meta = { ...it.meta };
    if (to === 'journal') {
      const md = String(meta.date || '').slice(0, 10);
      const d = isDate(date) ? date : isDate(md) ? md : localDate(new Date(it.mtime));
      const title = it.title && it.title !== it.slug ? String(it.title) : '';
      let slug = d;
      if (this.index.has(`journal/${slug}`)) slug = this.uniqueSlug('journal', `${d}-${slugify(title) || 'eintrag'}`);
      delete meta.date; if (title) meta.title = title;
      return this.relocate(it, 'journal', slug, meta);
    }
    const title = meta.title ? String(meta.title) : `Tagebuch ${it.date ? it.date.split('-').reverse().join('.') : it.slug}`;
    meta.title = title; if (it.date) meta.date = it.date;
    return this.relocate(it, 'note', this.uniqueSlug('note', slugify(title) || 'notiz'), meta);
  }

  /** Frühere Version wiederherstellen (der aktuelle Stand wird vorher selbst als Version gesichert). */
  restoreVersion(it, id) {
    const raw = this.history.read(it.type, it.slug, id);
    if (raw === null) throw Object.assign(new Error('Version nicht gefunden'), { status: 404 });
    const { meta, body } = parseFM(raw);
    this.writeItem(it.type, it.slug, meta, body, 'restore');
    return { ok: true };
  }

  deleteItem(it) {
    this.trash(this.fileFor(it.type, it.slug), `${it.type}-${it.slug}.md`);
    this.scan(true);
  }

  appendJournal(text, date) {
    const it = this.ensureJournal(date);
    if (it.enc) throw Object.assign(new Error('Dieser Tagebucheintrag ist verschlüsselt – Schnellnotizen können nicht angehängt werden.'), { status: 409 });
    const line = `- ${it.date === localDate() ? localTime() + ' ' : ''}${String(text).trim()}`;
    const body = it.body.replace(/\s+$/, '') + (it.body.trim() ? '\n' : '') + line + '\n';
    this.writeItem('journal', it.slug, it.meta, body);
    return it.slug;
  }
  patchJournalMeta(date, patch) {
    const it = this.ensureJournal(date);
    const meta = { ...it.meta };
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '' || v === undefined) delete meta[k]; else meta[k] = v; }
    this.writeItem('journal', it.slug, meta, it.body);
    return it.slug;
  }

  /* ---- Abfragen ---- */
  itemDetail(it) {
    const bl = (this.backlinks.get(it.id) || []).map((id) => this.index.get(id)).filter(Boolean)
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.mtime - a.mtime)
      .map((b) => ({ ...this.summary(b), context: this.lineContext(b, it.id) }));
    const out = [...it.out].map((id) => this.index.get(id)).filter(Boolean).map((o) => this.summary(o));
    const unlinked = [];
    if (it.type !== 'journal' && it.title.length >= 3) {
      const needles = [it.title, ...it.aliases].filter((n) => n.length >= 3).map((n) => n.toLowerCase());
      const linked = new Set(this.backlinks.get(it.id) || []);
      const seen = new Set();
      for (const n of needles) {
        for (const h of this.db.search(n, 80)) {
          if (h.id === it.id || linked.has(h.id) || seen.has(h.id)) continue;
          const o = this.index.get(h.id); if (!o || o.enc) continue;
          const hay = stripCode(this.db.body(h.id)).replace(WIKI, ' ').toLowerCase();
          if (needles.some((x) => hay.includes(x))) { seen.add(h.id); unlinked.push(this.summary(o)); }
          if (unlinked.length >= 20) break;
        }
        if (unlinked.length >= 20) break;
      }
    }
    return { ...this.summary(it), extras: it.type === 'person' ? this.personExtras(it) : null, meta: it.meta, body: it.body, encrypted: !!it.enc, html: it.enc ? '' : this.renderMd(it.body), backlinks: bl, outgoing: out, unlinked };
  }

  /** Monica-artige Zusatzdaten einer Person: Zeitleiste, Beziehungen, Geschenke, Schulden. */
  personExtras(it) {
    const m = it.meta;
    const tl = [];
    for (const a of arr(m.activities)) {
      const d = String(a.date || '').slice(0, 10);
      if (isDate(d)) tl.push({ kind: 'activity', date: d, title: String(a.title || 'Aktivität'), note: a.note ? String(a.note) : '', place: a.place ? String(a.place) : '' });
    }
    for (const bid of this.backlinks.get(it.id) || []) {
      const b = this.index.get(bid); if (!b) continue;
      const date = b.date || localDate(new Date(b.mtime));
      tl.push({ kind: b.type, date, title: b.type === 'journal' && b.date ? b.title : b.title, slug: b.slug, type: b.type, context: this.lineContext(b, it.id), mood: b.mood, enc: !!b.enc });
    }
    tl.sort((a, b) => b.date.localeCompare(a.date));
    const byYear = {};
    for (const e of tl) byYear[e.date.slice(0, 4)] = (byYear[e.date.slice(0, 4)] || 0) + 1;
    const past = tl.filter((e) => e.date <= localDate());
    const stats = { total: tl.length, first: past.length ? past[past.length - 1].date : null, last: past.length ? past[0].date : null, byYear };

    const relations = [];
    for (const r of arr(m.relations)) {
      const tgt = r.person ? this.resolve(String(r.person)) : null;
      relations.push({ label: String(r.type || 'Sonstige'), title: tgt ? tgt.title : String(r.person || ''), slug: tgt && tgt.type === 'person' ? tgt.slug : null, photo: tgt && tgt.meta.photo ? tgt.meta.photo : '' });
    }
    for (const o of this.index.values()) {
      if (o.type !== 'person' || o === it) continue;
      for (const r of arr(o.meta.relations)) {
        const tgt = r.person ? this.resolve(String(r.person)) : null;
        if (tgt === it) {
          const t = String(r.type || 'Sonstige');
          if (!relations.some((x) => x.slug === o.slug && x.label === (INVERSE[t] || t))) relations.push({ label: INVERSE[t] || t, title: o.title, slug: o.slug, photo: o.meta.photo || '', inferred: true });
        }
      }
    }
    const gifts = arr(m.gifts).map((g) => ({ idea: String(g.idea || ''), status: ['idee', 'gekauft', 'verschenkt'].includes(g.status) ? g.status : 'idee', url: g.url ? String(g.url) : '', note: g.note ? String(g.note) : '', date: g.date ? String(g.date).slice(0, 10) : '' })).filter((g) => g.idea);
    const debts = arr(m.debts).map((d) => ({ amount: Number(d.amount) || 0, currency: String(d.currency || 'EUR').slice(0, 4), direction: d.direction === 'mir_geschuldet' ? 'mir_geschuldet' : 'ich_schulde', note: d.note ? String(d.note) : '', date: d.date ? String(d.date).slice(0, 10) : '', settled: !!d.settled })).filter((d) => d.amount);
    const balance = {};
    for (const d of debts) if (!d.settled) balance[d.currency] = Math.round(((balance[d.currency] || 0) + (d.direction === 'mir_geschuldet' ? d.amount : -d.amount)) * 100) / 100;
    return { timeline: tl, stats, relations, gifts, debts, balance };
  }

  /** Orte der Personen für die Karte: Adressen mit Koordinaten, Adressen ohne Koordinaten, Personen ohne Adresse. */
  mapPoints() {
    const ok = (a) => a && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon)) && a.lat !== '' && a.lon !== '' && Math.abs(Number(a.lat)) <= 90 && Math.abs(Number(a.lon)) <= 180;
    const points = [], missing = [], none = [];
    for (const p of this.index.values()) {
      if (p.type !== 'person') continue;
      const list = [...(p.meta.address ? [{ value: p.meta.address }] : []), ...arr(p.meta.addresses)].filter((a) => a && typeof a === 'object' && String(a.value || '').trim());
      const base = { slug: p.slug, title: p.title, photo: p.meta.photo || '', tags: p.tags || [], lastContact: p.lastContact || null, contactEvery: clampInt(p.meta.contact_every, 1, 3650) };
      const orte = rawPlaces(p.meta.places).map((o) => (typeof o === 'string' ? { name: o } : o)).filter((o) => o && String(o.name || '').trim());
      if (!list.length && !orte.length) { none.push({ slug: p.slug, title: p.title }); continue; }
      // aktueller Wohnort = angekreuzte Adresse; ohne Markierung die erste Adresse mit Koordinaten
      const flagged = list.find((a) => a.home), home = flagged || list.find(ok);
      const places = list.filter(ok).map((a) => ({ label: String(a.label || ''), value: String(a.value), lat: Number(a.lat), lon: Number(a.lon), home: a === home }));
      for (const o of orte) if (ok(o)) places.push({ label: String(o.name), value: '', lat: Number(o.lat), lon: Number(o.lon), home: false, kind: 'ort', ...(o.from ? { from: +o.from } : {}), ...(o.to ? { to: +o.to } : {}), ...(o.region ? { region: String(o.region) } : {}) });
      if (places.length) points.push({ ...base, places });
      const open = list.filter((a) => !ok(a)).length + orte.filter((o) => !ok(o)).length;
      if (open) missing.push({ ...base, count: open });
    }
    const by = (a, b) => a.title.localeCompare(b.title, 'de');
    return { points: points.sort(by), missing: missing.sort(by), none: none.sort(by) };
  }

  /** Übersicht über alle Personen: offene Schulden, Geschenkideen. */
  peopleOverview() {
    const debts = [], gifts = [];
    for (const p of this.index.values()) {
      if (p.type !== 'person') continue;
      const x = this.personExtras(p);
      if (Object.values(x.balance).some((v) => v)) debts.push({ slug: p.slug, title: p.title, balance: x.balance, open: x.debts.filter((d) => !d.settled) });
      const open = x.gifts.filter((g) => g.status !== 'verschenkt');
      if (open.length) gifts.push({ slug: p.slug, title: p.title, gifts: open });
    }
    return { debts, gifts };
  }

  /** Volltextsuche (SQLite FTS5) mit optionalen Filtern: type, tag, person, from, to, moodMin, moodMax. */
  search(q, f = {}) {
    f = f || {};
    const personIt = f.person ? this.resolve(f.person) : null;
    if (f.person && !personIt) return [];
    const ok = (it) => {
      if (f.type && it.type !== f.type) return false;
      if (f.tag && !it.tags.some((t) => t.toLowerCase() === String(f.tag).toLowerCase().replace(/^#/, ''))) return false;
      if (personIt && !(it.out && it.out.has(personIt.id)) && it !== personIt) return false;
      if (f.from && !(it.date && it.date >= f.from)) return false;
      if (f.to && !(it.date && it.date <= f.to)) return false;
      if (f.moodMin && !(it.mood && it.mood >= +f.moodMin)) return false;
      if (f.moodMax && !(it.mood && it.mood <= +f.moodMax)) return false;
      return true;
    };
    const text = String(q || '').trim();
    const out = new Map();
    const mark = (s) => plain(String(s || '').replace(/\[\[mark\]\]/g, '⟦').replace(/\[\[\/mark\]\]/g, '⟧').replace(/⟦/g, ' ⟦').replace(/⟧/g, '⟧ ')).replace(/\s+([⟧.,;:!?])/g, '$1');
    if (text) {
      for (const h of this.db.search(text, 300)) {
        const it = this.index.get(h.id);
        if (!it || !ok(it)) continue;
        out.set(it.id, { ...this.summary(it), snippet: it.enc ? it.snippet : mark(h.sn) || it.snippet, score: -h.rank });
      }
      // Teilwörter in Titeln (z. B. „ondon“ → London), die der Wortindex nicht trifft
      const low = text.toLowerCase();
      for (const it of this.index.values()) {
        if (out.has(it.id) || !ok(it)) continue;
        if ([it.title, ...it.aliases].some((t) => t.toLowerCase().includes(low))) out.set(it.id, { ...this.summary(it), score: 0.1 });
      }
    } else if (Object.keys(f).some((k) => f[k])) {
      for (const it of this.index.values()) if (ok(it)) out.set(it.id, { ...this.summary(it), score: 0 });
    }
    return [...out.values()].sort((a, b) => b.score - a.score || (b.date || '').localeCompare(a.date || '') || b.mtime - a.mtime).slice(0, 80);
  }

  dashboard() {
    const today = localDate();
    const journals = [...this.index.values()].filter((i) => i.type === 'journal' && i.date);
    const byDate = new Map();
    for (const j of journals) if (!byDate.has(j.date) || j.slug === j.date) byDate.set(j.date, j);
    const t = byDate.get(today);
    let streak = 0, d = byDate.has(today) ? today : addDays(today, -1);
    while (byDate.has(d)) { streak++; d = addDays(d, -1); }

    const cy = +today.slice(0, 4);
    const [ty, tm, td] = today.split('-').map(Number);
    const todayUTC = Date.UTC(ty, tm - 1, td);
    const birthdays = [], reminders = [];
    for (const p of this.index.values()) {
      if (p.type !== 'person') continue;
      const b = parseBirthday(p.meta.birthday);
      if (b) {
        for (const yr of [cy, cy + 1]) {
          const diff = Math.round((Date.UTC(yr, b.m - 1, b.d) - todayUTC) / 86400000);
          if (diff >= 0) { if (diff <= 60) birthdays.push({ ...this.summary(p), gifts: arr(p.meta.gifts).filter((g) => g.idea && g.status !== 'verschenkt').length, inDays: diff, turning: b.y ? yr - b.y : null, on: `${yr}-${pad(b.m)}-${pad(b.d)}` }); break; }
        }
      }
      const every = clampInt(p.meta.contact_every, 1, 3650);
      if (every) {
        const since = p.lastContact ? daysBetween(p.lastContact, today) : null;
        if (since === null || since >= every) reminders.push({ ...this.summary(p), sinceDays: since, every });
      }
    }
    birthdays.sort((a, b) => a.inDays - b.inDays);
    reminders.sort((a, b) => (b.sinceDays ?? 1e9) - (a.sinceDays ?? 1e9));
    const md5 = today.slice(5);
    const onThisDay = journals.filter((j) => j.date.slice(5) === md5 && j.date < today).sort((a, b) => b.date.localeCompare(a.date)).map((j) => this.summary(j));
    const recent = [...journals].sort((a, b) => b.date.localeCompare(a.date) || b.mtime - a.mtime).slice(0, 6).map((j) => this.summary(j));
    const mood30 = [];
    for (let i = 29; i >= 0; i--) { const dd = addDays(today, -i); const j = byDate.get(dd); mood30.push({ date: dd, mood: j ? j.mood : null }); }
    const count = (ty2) => [...this.index.values()].filter((i) => i.type === ty2).length;
    let songSuggestion = null;
    const withSong = journals.filter((j) => j.meta.song && j.date < today);
    if (!(t && t.meta.song) && withSong.length) songSuggestion = this.summary(withSong[Math.floor(Math.random() * withSong.length)]);
    return {
      today, todayEntry: t ? this.summary(t) : null, streak,
      counts: { people: count('person'), journal: count('journal'), notes: count('note') },
      recent, birthdays, reminders: reminders.slice(0, 8), onThisDay, mood30, songSuggestion,
    };
  }

  songs() {
    return [...this.index.values()].filter((i) => i.type === 'journal' && i.date && i.meta.song)
      .sort((a, b) => b.date.localeCompare(a.date)).map((j) => this.summary(j));
  }

  moodRange(from, to) {
    const today = localDate();
    to = isDate(to) ? to : today;
    from = isDate(from) ? from : addDays(to, -89);
    const acc = new Map();
    for (const j of this.index.values()) {
      if (j.type !== 'journal' || !j.date || j.date < from || j.date > to) continue;
      if (j.mood == null && j.energy == null) continue;
      const a = acc.get(j.date) || { date: j.date, m: [], e: [], slug: j.slug };
      if (j.mood != null) a.m.push(j.mood);
      if (j.energy != null) a.e.push(j.energy);
      if (j.slug === j.date) a.slug = j.slug;
      acc.set(j.date, a);
    }
    const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : null);
    const days = [...acc.values()].sort((a, b) => a.date.localeCompare(b.date)).map((a) => ({ date: a.date, mood: avg(a.m), energy: avg(a.e), slug: a.slug }));
    return { from, to, days };
  }

  insights() {
    const withMood = [...this.index.values()].filter((j) => j.type === 'journal' && j.mood != null);
    const overall = withMood.length ? withMood.reduce((s, j) => s + j.mood, 0) / withMood.length : null;
    const people = new Map(), tags = new Map();
    const bump = (map, key, label, extra, mood) => { const a = map.get(key) || { ...extra, title: label, sum: 0, count: 0 }; a.sum += mood; a.count++; map.set(key, a); };
    for (const j of withMood) {
      for (const id of j.out) { const p = this.index.get(id); if (p && p.type === 'person') bump(people, id, p.title, { slug: p.slug }, j.mood); }
      for (const tg of j.tags) bump(tags, tg, '#' + tg, { tag: tg }, j.mood);
    }
    const fin = (map) => [...map.values()].filter((a) => a.count >= 2).map((a) => ({ ...a, avg: Math.round((a.sum / a.count) * 100) / 100 }));
    return { overall, entries: withMood.length, people: fin(people), tags: fin(tags) };
  }

  graph() {
    const nodes = [...this.index.values()].map((it) => ({ id: it.id, type: it.type, slug: it.slug, title: it.title, degree: 0 }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = [];
    for (const it of this.index.values()) for (const t of it.out) { edges.push({ s: it.id, t }); byId.get(it.id).degree++; byId.get(t).degree++; }
    return { nodes, edges };
  }
}

module.exports = { Vault, TYPES, plain, RELATION_TYPES, INVERSE };
