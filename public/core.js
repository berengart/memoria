'use strict';
/* Memoria – Haupt-App. Auth, Einstellungen und Start liegen in extras.js. */
(() => {
  /* ------------------------------------------------------------ Helfer */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const app = $('#app');
  const pad = (n) => String(n).padStart(2, '0');
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return fmtD(d); };
  const utc = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
  const fmtLong = (s) => parseD(s).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtShort = (s) => parseD(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }); };
  function ago(s) {
    if (!s) return 'nie';
    const n = diffDays(s, todayStr());
    if (n <= 0) return 'heute'; if (n === 1) return 'gestern'; if (n < 31) return `vor ${n} Tagen`;
    if (n < 365) return `vor ${Math.round(n / 30)} Monaten`; return `vor ${(n / 365).toFixed(1).replace('.', ',')} Jahren`;
  }
  const MOODS = [
    { v: 1, e: '😞', l: 'Sehr schlecht', c: '#d96c6c' }, { v: 2, e: '🙁', l: 'Schlecht', c: '#e39a5c' },
    { v: 3, e: '😐', l: 'Okay', c: '#d9c85c' }, { v: 4, e: '🙂', l: 'Gut', c: '#8cc46a' }, { v: 5, e: '😄', l: 'Sehr gut', c: '#4caf7a' },
  ];
  const moodColor = (v) => MOODS[Math.min(4, Math.max(0, Math.round(v) - 1))].c;
  const TYPE = { person: { ic: '👤', label: 'Person', list: 'people' }, journal: { ic: '📓', label: 'Tagebuch', list: 'journal' }, note: { ic: '📝', label: 'Notiz', list: 'notes' } };
  const href = (it) => `#/${it.type}/${enc(it.slug)}`;

  const M = window.M = { $, $$, esc, enc, pad, todayStr, parseD, fmtLong, fmtShort, ago, MOODS, TYPE, state: { me: null, settings: null, presets: null }, routes: [], onUnauth: null };
  const feat = (k) => !!(M.state.settings && M.state.settings.features[k]);
  M.feat = feat;
  const go = (h) => { if (location.hash === h) route(); else location.hash = h; };
  M.go = go;

  async function api(url, { method = 'GET', body } = {}) {
    const opts = { method, headers: {} };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await fetch(url, opts);
    let data = null;
    try { data = await r.json(); } catch (e) { /* leer */ }
    if (!r.ok) {
      if (r.status === 401 && data && data.auth && M.onUnauth) M.onUnauth();
      const err = new Error((data && data.error) || r.statusText); err.status = r.status; err.data = data; throw err;
    }
    return data;
  }
  M.api = api;
  let itemsCache = null;
  const getItems = async (force) => { if (!itemsCache || force) itemsCache = await api('/api/items'); return itemsCache; };
  const invalidate = () => { itemsCache = null; };
  M.invalidate = invalidate;

  function toast(msg, kind) {
    const t = $('#toast'); t.textContent = msg; t.className = 'show ' + (kind || '');
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = ''; }, 3000);
  }
  M.toast = toast;

  const dispTitle = (it) => {
    if (it.type === 'journal' && it.date) return fmtLong(it.date) + (it.title && it.title !== it.slug ? ' – ' + it.title : '');
    return it.title;
  };
  const tagChips = (tags) => (tags || []).map((t) => `<a class="tag" href="#/tag/${enc(t)}">#${esc(t)}</a>`).join('');
  const moodChip = (m) => (m ? `<span class="mood-chip" title="${MOODS[m - 1].l}">${MOODS[m - 1].e}</span>` : '');
  const fileUrl = (name) => '/files/' + enc(name); // Der Server findet die Datei im passenden Unterordner
  function avatar(it, big) {
    const cls = 'avatar' + (big ? ' big' : '');
    let h = 0; for (const c of it.title) h = (h * 31 + c.charCodeAt(0)) % 360;
    const ini = it.title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    const el = it.photo ? `<img class="${cls}" src="${fileUrl(it.photo)}" alt="">` : `<span class="${cls}" style="background:hsl(${h} 45% 48%)">${esc(ini)}</span>`;
    return it.deceased ? `<span class="av-dead" title="verstorben">${el}</span>` : el; // schwarz-weiß mit schwarzem Trauerband
  }
  function row(it, ctx) {
    const meta = it.type === 'journal' ? `${it.song ? '🎵 ' : ''}${moodChip(it.mood)}` : tagChips((it.tags || []).slice(0, 2));
    return `<a class="row" href="${href(it)}"><span class="row-ic">${TYPE[it.type].ic}</span><div class="row-main"><div class="row-title">${esc(dispTitle(it))}</div><div class="row-sub">${esc(ctx || it.snippet || '')}</div></div><span class="row-meta">${meta}</span></a>`;
  }
  const isDark = () => {
    const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [255, 255, 255];
    return (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) < 140;
  };

  /* ----------------------------------------------- Lied des Tages (Hilfen) */
  function embedHTML(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '');
      let id = null;
      if (host === 'youtu.be') id = u.pathname.slice(1);
      else if (/(^|\.)youtube\.com$/.test(host)) id = u.searchParams.get('v');
      if (id && /^[\w-]{6,15}$/.test(id)) return `<iframe class="embed" height="220" src="https://www.youtube-nocookie.com/embed/${id}" allow="encrypted-media; picture-in-picture" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
      const sp = host === 'open.spotify.com' && u.pathname.match(/\/(track|album|playlist|episode)\/([A-Za-z0-9]+)/);
      if (sp) return `<iframe class="embed" height="152" src="https://open.spotify.com/embed/${sp[1]}/${sp[2]}" allow="encrypted-media" loading="lazy"></iframe>`;
    } catch (e) { /* kein Link */ }
    return '';
  }
  const songLine = (song, url) => `<span class="song"><span class="note">🎵</span><span class="t">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(song)}</a>` : esc(song)}</span></span>`;
  M.embedHTML = embedHTML;

  async function lookupSong(urlInput, titleInput) {
    const url = urlInput.value.trim();
    if (!url) { toast('Erst einen Link einfügen', 'err'); return; }
    try {
      const r = await api('/api/song/lookup?url=' + enc(url));
      titleInput.value = r.author && !r.title.toLowerCase().includes(r.author.toLowerCase()) ? `${r.author} – ${r.title}` : r.title;
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      toast('Titel übernommen');
    } catch (e) { toast(e.message, 'err'); }
  }

  /* -------------------------------------------------- Router & Aufräumen */
  let cleanups = [];
  const onLeave = (fn) => cleanups.push(fn);
  M.onLeave = onLeave;
  let dirty = false, lastHash = location.hash;
  M.dirty = (v) => { dirty = !!v; };
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  const routes = M.routes;

  function updateNav() { $$('#nav [data-feat]').forEach((a) => { a.hidden = !feat(a.dataset.feat); }); }
  M.updateNav = updateNav;

  const GATE = { '/people': 'people', '/family': 'people', '/map': 'map', '/mood': 'mood', '/songs': 'music', '/graph': 'graph' };
  async function route() {
    if (!M.state.me) return;
    cleanups.forEach((f) => { try { f(); } catch (e) { /* ignorieren */ } });
    cleanups = []; dirty = false; lastHash = location.hash;
    const h = location.hash.replace(/^#/, '') || '/';
    const qi = h.indexOf('?');
    const pathPart = qi < 0 ? h : h.slice(0, qi);
    const query = Object.fromEntries(new URLSearchParams(qi < 0 ? '' : h.slice(qi + 1)));
    $$('#nav a, #nav button[data-nav]').forEach((a) => { const on = a.dataset.nav.split(',').some((p) => (p === '/' ? pathPart === '/' : pathPart === p || pathPart.startsWith(p + '/'))); a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const sub = $('#subnav'), inSub = ['/people', '/family', '/map'].includes(pathPart) || pathPart.startsWith('/person/');
    sub.hidden = !inSub || !M.state.me;
    if (inSub) sub.innerHTML = [['/people', '👤 Personen', 'people'], ['/family', '🌳 Stammbaum', 'people'], ['/map', '🗺️ Karte', 'map']].filter((x) => feat(x[2])).map(([p, l]) => { const on = pathPart === p || (p === '/people' && pathPart.startsWith('/person/')); return `<a href="#${p}" class="${on ? 'on' : ''}" ${on ? 'aria-current="page"' : ''}>${l}</a>`; }).join('');
    $('#todayBtn').href = '#/journal/' + todayStr();
    if (pathPart === '/search') $('#searchInput').value = query.q || '';
    if (GATE[pathPart] && !feat(GATE[pathPart])) {
      app.innerHTML = '<div class="card"><h2>Diese Funktion ist ausgeschaltet</h2><p class="muted">Sie ist in deinem aktuellen Funktionsumfang nicht aktiv. Du kannst sie unter <a href="#/settings?tab=features">Einstellungen → Funktionsumfang</a> einschalten.</p></div>';
      return;
    }
    for (const [re, fn] of routes) {
      const m = pathPart.match(re);
      if (!m) continue;
      app.classList.add('enter'); clearTimeout(window.__enT); window.__enT = setTimeout(() => app.classList.remove('enter'), 900);
      const skT = setTimeout(() => { if (!document.getElementById('edForm')) app.innerHTML = '<div class="card sk" aria-busy="true"><div class="sk-l w40"></div><div class="sk-l"></div><div class="sk-l w80"></div></div><div class="card sk"><div class="sk-l w60"></div><div class="sk-l"></div></div>'; }, 220);
      try { await fn(m.slice(1).map((x) => decodeURIComponent(x)), query); clearTimeout(skT); } catch (e) { clearTimeout(skT); if (e.status !== 401) app.innerHTML = `<div class="card error">⚠️ ${esc(e.message)}</div>`; }
      window.scrollTo(0, 0);
      return;
    }
    app.innerHTML = '<div class="card">Seite nicht gefunden.</div>';
  }
  M.route = route;
  window.addEventListener('hashchange', () => {
    if (dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) { history.replaceState(null, '', lastHash || '#/'); return; }
    route();
  });
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#searchInput').value.trim(); if (q) go('#/search?q=' + enc(q)); });

  getItemsExport();
  function getItemsExport() {
    Object.assign(M, { isDate, fmtD, addDays, diffDays, monthName, moodColor, href, getItems, dispTitle, tagChips, moodChip, fileUrl, avatar, row, isDark, songLine, lookupSong, embedHTML });
  }
})();

/* Schließbare Dialoge (Verlauf, Anhänge): Escape oder Seitenwechsel schließt sie */
(function () {
  const closeAll = () => document.querySelectorAll('.modal-bg[data-closable]').forEach((n) => n.remove());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  window.addEventListener('hashchange', closeAll);
})();

/* ===== Deutsche Datums- und Zeiteingabe (TT.MM.JJJJ, 24 Stunden) ===== */
(function () {
  const M = window.M, esc = M.esc;
  const p2 = (n) => String(n).padStart(2, '0');
  const real = (y, m, d) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; };
  /** ISO / MM-TT / JJJJ → Anzeige (TT.MM.JJJJ, TT.MM., JJJJ) */
  M.deDate = (v) => {
    v = String(v == null ? '' : v).trim(); let m;
    if ((m = v.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[3]}.${m[2]}.${m[1]}`;
    if ((m = v.match(/^(?:--)?(\d{2})-(\d{2})$/))) return `${m[2]}.${m[1]}.`;
    return v;
  };
  /** Eingabe → ISO ('' = leer, null = ungültig). opts.partial: „TT.MM.“ → MM-TT, opts.year: „JJJJ“ erlaubt */
  M.parseDate = (txt, opts = {}) => {
    txt = String(txt || '').trim(); if (!txt) return ''; let m;
    if ((m = txt.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return real(+m[1], +m[2], +m[3]) ? `${m[1]}-${p2(m[2])}-${p2(m[3])}` : null;
    if ((m = txt.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/))) { let y = +m[3]; if (m[3].length === 2) y += y <= 69 ? 2000 : 1900; return real(y, +m[2], +m[1]) ? `${y}-${p2(m[2])}-${p2(m[1])}` : null; }
    if (opts.partial) {
      if ((m = txt.match(/^(\d{1,2})[./-](\d{1,2})\.?$/))) return real(2000, +m[2], +m[1]) ? `${p2(m[2])}-${p2(m[1])}` : null;
      if ((m = txt.match(/^(?:--)?(\d{2})-(\d{2})$/))) return real(2000, +m[1], +m[2]) ? `${m[1]}-${m[2]}` : null;
    }
    if (opts.year && /^\d{4}$/.test(txt)) return txt;
    return null;
  };
  /** Eingabefeld für Datum mit Kalender-Knopf. attrs: zusätzliche Attribute für das Textfeld, wrapStyle: Stil des Umschlags */
  M.dateHTML = ({ id, value, partial, year, ph, attrs, wrapStyle, aria }) => `<span class="dwrap" style="${wrapStyle || ''}"><input type="text" ${id ? `id="${id}"` : ''} inputmode="numeric" autocomplete="off" data-date="1" ${partial ? 'data-partial="1"' : ''} ${year ? 'data-year="1"' : ''} value="${esc(M.deDate(value))}" placeholder="${esc(ph || (partial ? 'TT.MM.JJJJ oder TT.MM.' : year ? 'TT.MM.JJJJ oder JJJJ' : 'TT.MM.JJJJ'))}" ${aria ? `aria-label="${esc(aria)}"` : ''} ${attrs || ''}><button type="button" class="dpick" tabindex="-1" aria-label="Kalender öffnen" title="Kalender">📅</button><input type="date" class="dnative" tabindex="-1" aria-hidden="true"></span>`;
  /** Wert eines Datumsfeldes lesen; wirft bei ungültiger Eingabe einen verständlichen Fehler. */
  M.readDate = (el) => {
    const v = M.parseDate(el.value, { partial: !!el.dataset.partial, year: !!el.dataset.year });
    if (v === null) { el.classList.add('bad'); throw Object.assign(new Error(`Ungültiges Datum „${el.value}“ – bitte als TT.MM.JJJJ eingeben.`), { status: 400 }); }
    el.classList.remove('bad'); return v;
  };
  /** 24-Stunden-Zeit prüfen („8:5“ → „08:05“); null = ungültig */
  M.parseTime = (t) => { const m = String(t || '').trim().match(/^(\d{1,2})[:.](\d{2})$/); return m && +m[1] < 24 && +m[2] < 60 ? `${p2(m[1])}:${m[2]}` : null; };

  document.addEventListener('focusout', (e) => {
    const el = e.target; if (!el.matches || !el.matches('input[data-date]')) return;
    const v = M.parseDate(el.value, { partial: !!el.dataset.partial, year: !!el.dataset.year });
    if (v === null) el.classList.add('bad'); else { el.classList.remove('bad'); if (el.value.trim()) el.value = M.deDate(v); }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.dpick'); if (!b) return;
    const w = b.closest('.dwrap'), txt = w.querySelector('input[data-date]'), nat = w.querySelector('.dnative');
    const iso = M.parseDate(txt.value); nat.value = /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso : '';
    try { nat.showPicker(); } catch (err) { nat.focus(); nat.click(); }
  });
  document.addEventListener('change', (e) => {
    const n = e.target; if (!n.classList || !n.classList.contains('dnative')) return;
    const txt = n.closest('.dwrap').querySelector('input[data-date]'); txt.value = M.deDate(n.value); txt.classList.remove('bad');
    txt.dispatchEvent(new Event('input', { bubbles: true }));
  });
})();
