'use strict';
/* Karte: eigene, abhängigkeitsfreie Kartenansicht (Kacheln, Ziehen, Zoomen, Gruppieren) und die Ansicht „Karte“ */
(() => {
  const M = window.M;
  const { $, $$, esc, enc, api, toast, getItems, feat } = M;
  const TS = 256, MINZ = 2, MAXZ = 18;
  const clampLat = (l) => Math.max(-85.0511, Math.min(85.0511, l));
  const project = (lat, lon, z) => { const s = TS * 2 ** z, sin = Math.sin(clampLat(lat) * Math.PI / 180); return { x: (lon + 180) / 360 * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s }; };
  const unproject = (x, y, z) => { const s = TS * 2 ** z, n = Math.PI - 2 * Math.PI * y / s; return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon: x / s * 360 - 180 }; };
  const cfg = () => M.state.mapConfig || { tileUrl: '', attribution: '' };
  const online = () => !!(M.state.settings && M.state.settings.map && M.state.settings.map.enabled && cfg().tileUrl);

  /**
   * Erzeugt eine Karte in `el`. markers: [{ id, lat, lon, title, sub, href, avatar }]
   * opts: { height, tiles (true = Kacheln laden), onPop }
   */
  function create(el, markers, opts = {}) {
    el.innerHTML = `<div class="map" tabindex="0" role="application" aria-label="Karte – Pfeiltasten verschieben, Plus und Minus zoomen" style="height:${opts.height || 420}px">
      <div class="map-tiles"></div><svg class="map-over" aria-hidden="true"></svg><div class="map-marks"></div><div class="map-pop" hidden></div>
      <div class="map-ctl"><button type="button" data-z="in" aria-label="Vergrößern">＋</button><button type="button" data-z="out" aria-label="Verkleinern">−</button><button type="button" data-z="fit" aria-label="Alle zeigen" title="Alle zeigen">⤢</button></div>
      <div class="map-attr"></div></div>`;
    const root = $('.map', el), tilesEl = $('.map-tiles', el), marksEl = $('.map-marks', el), pop = $('.map-pop', el), over = $('.map-over', el);
    const useTiles = opts.tiles !== undefined ? opts.tiles : online();
    $('.map-attr', el).textContent = useTiles ? cfg().attribution : 'Ohne Kartenhintergrund';
    let z = 4, c = { lat: 50.5, lon: 10 }, w = 0, h = 0, pts = markers || [], raf = 0, openId = null, lines = [], circle = null;
    const tiles = new Map();

    const origin = () => { const p = project(c.lat, c.lon, z); return { x: p.x - w / 2, y: p.y - h / 2 }; };
    function renderTiles(o) {
      if (!useTiles) { tilesEl.style.setProperty('--ox', -o.x % 64 + 'px'); tilesEl.style.setProperty('--oy', -o.y % 64 + 'px'); return; }
      const n = 2 ** z, need = new Set();
      for (let ty = Math.floor(o.y / TS); ty <= Math.floor((o.y + h) / TS); ty++) {
        if (ty < 0 || ty >= n) continue;
        for (let tx = Math.floor(o.x / TS); tx <= Math.floor((o.x + w) / TS); tx++) {
          const wx = ((tx % n) + n) % n, key = `${z}/${wx}/${ty}/${tx}`; need.add(key);
          let img = tiles.get(key);
          if (!img) {
            img = new Image(TS, TS); img.alt = ''; img.draggable = false; img.decoding = 'async'; img.referrerPolicy = 'origin'; img.className = 'map-tile';
            img.onerror = () => { img.style.visibility = 'hidden'; }; img.src = cfg().tileUrl.replace('{z}', z).replace('{x}', wx).replace('{y}', ty);
            tilesEl.appendChild(img); tiles.set(key, img);
          }
          img.style.transform = `translate(${Math.round(tx * TS - o.x)}px,${Math.round(ty * TS - o.y)}px)`;
        }
      }
      for (const [k, img] of tiles) if (!need.has(k)) { img.remove(); tiles.delete(k); }
    }
    function clusters(o) {
      const out = [];
      for (const m of pts) {
        const p = project(m.lat, m.lon, z), x = p.x - o.x, y = p.y - o.y;
        if (x < -50 || y < -50 || x > w + 50 || y > h + 50) continue;
        const hit = out.find((q) => Math.hypot(q.x - x, q.y - y) < 36);
        if (hit) { hit.items.push(m); hit.x = (hit.x * (hit.items.length - 1) + x) / hit.items.length; hit.y = (hit.y * (hit.items.length - 1) + y) / hit.items.length; } else out.push({ x, y, items: [m] });
      }
      return out;
    }
    let current = [];
    function render() {
      raf = 0; if (!w || !h) return;
      const o = origin(); renderTiles(o);
      let svg = '';
      if (circle) { const p = project(circle.lat, circle.lon, z), mpp = 156543.03392 * Math.cos(circle.lat * Math.PI / 180) / 2 ** z; svg += `<circle class="map-circle" cx="${(p.x - o.x).toFixed(1)}" cy="${(p.y - o.y).toFixed(1)}" r="${(circle.km * 1000 / mpp).toFixed(1)}"/><circle class="map-circle-c" cx="${(p.x - o.x).toFixed(1)}" cy="${(p.y - o.y).toFixed(1)}" r="4"/>`; }
      for (const l of lines) { const a = project(l.a.lat, l.a.lon, z), b = project(l.b.lat, l.b.lon, z); svg += `<line class="map-line${l.kind === 'partner' ? ' dash' : ''}" x1="${(a.x - o.x).toFixed(1)}" y1="${(a.y - o.y).toFixed(1)}" x2="${(b.x - o.x).toFixed(1)}" y2="${(b.y - o.y).toFixed(1)}"/>`; }
      over.innerHTML = svg;
      current = clusters(o);
      marksEl.innerHTML = current.map((cl, i) => cl.items.length === 1
        ? `<button type="button" class="map-pin${cl.items[0].faint ? ' map-faint' : ''}${cl.items[0].home ? ' map-home' : ''}" data-i="${i}" style="left:${cl.x}px;top:${cl.y}px" aria-label="${esc(cl.items[0].title)}${cl.items[0].home ? ', Wohnort' : cl.items[0].faint ? ', weiterer Ort' : ''}" aria-haspopup="dialog">${cl.items[0].avatar || esc(cl.items[0].title.slice(0, 1))}</button>`
        : `<button type="button" class="map-pin map-cl" data-i="${i}" style="left:${cl.x}px;top:${cl.y}px" aria-label="${cl.items.length} Personen">${cl.items.length}</button>`).join('');
      marksEl.querySelectorAll('.map-faint').forEach((b) => marksEl.prepend(b)); // blasse Orte unter die Wohnorte
      if (openId !== null && current[openId]) place(openId); else if (openId !== null) closePop();
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };
    const setView = (lat, lon, zoom) => { c = { lat: clampLat(lat), lon: ((lon + 540) % 360) - 180 }; if (zoom !== undefined) z = Math.max(MINZ, Math.min(MAXZ, zoom)); schedule(); };
    function fit(list) {
      list = list || pts;
      if (!list.length) { setView(50.5, 10, w < 500 ? 4 : 5); return; }
      if (list.length === 1) { setView(list[0].lat, list[0].lon, 12); return; }
      const lats = list.map((m) => m.lat), lons = list.map((m) => m.lon);
      const la0 = Math.min(...lats), la1 = Math.max(...lats), lo0 = Math.min(...lons), lo1 = Math.max(...lons);
      let best = MINZ;
      for (let k = 15; k >= MINZ; k--) { const a = project(la1, lo0, k), b = project(la0, lo1, k); if (b.x - a.x <= w - 90 && b.y - a.y <= h - 90) { best = k; break; } }
      setView((la0 + la1) / 2, (lo0 + lo1) / 2, best);
    }
    const zoomBy = (d, cx = w / 2, cy = h / 2) => {
      const nz = Math.max(MINZ, Math.min(MAXZ, z + d)); if (nz === z) return;
      const o = origin(), g = unproject(o.x + cx, o.y + cy, z); z = nz;
      const p = project(g.lat, g.lon, z); const nc = unproject(p.x - cx + w / 2, p.y - cy + h / 2, z); c = { lat: clampLat(nc.lat), lon: nc.lon }; schedule();
    };
    const panBy = (dx, dy) => { const p = project(c.lat, c.lon, z); const n = unproject(p.x + dx, p.y + dy, z); c = { lat: clampLat(n.lat), lon: ((n.lon + 540) % 360) - 180 }; schedule(); };

    /* Popup */
    function closePop() { openId = null; pop.hidden = true; }
    function place(i) {
      const cl = current[i]; if (!cl) return;
      pop.style.left = Math.min(Math.max(cl.x, 130), Math.max(130, w - 130)) + 'px'; pop.style.top = Math.max(cl.y - 30, 70) + 'px';
    }
    function showPop(i) {
      const cl = current[i]; openId = i;
      pop.innerHTML = `<button type="button" class="map-x" aria-label="Schließen">✕</button>` + cl.items.map((m) => `<div class="map-pi"><a href="${esc(m.href || '#')}"><b>${esc(m.title)}</b></a>${m.sub ? `<div class="muted small-text">${esc(m.sub).replace(/\n/g, ', ')}</div>` : ''}${m.links && m.links.length ? `<div class="small-text" style="margin-top:4px">${m.links.map((l) => `<a href="${esc(l.href)}">${esc(l.t)}</a>`).join(' · ')}</div>` : ''}</div>`).join('');
      pop.hidden = false; place(i);
    }
    marksEl.addEventListener('click', (e) => {
      const b = e.target.closest('.map-pin'); if (!b) return; e.stopPropagation();
      const cl = current[+b.dataset.i]; if (!cl) return;
      if (cl.items.length === 1 || z >= MAXZ - 1) { showPop(+b.dataset.i); return; }
      closePop(); fit(cl.items); if (z < 3) zoomBy(1); else zoomBy(0);
    });
    pop.addEventListener('click', (e) => { if (e.target.closest('.map-x')) closePop(); });
    $('.map-ctl', el).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.z === 'in') zoomBy(1); else if (b.dataset.z === 'out') zoomBy(-1); else fit(); });
    $('.map-ctl', el).addEventListener('pointerdown', (e) => e.stopPropagation());
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    marksEl.addEventListener('pointerdown', (e) => { if (e.target.closest('.map-pin')) e.stopPropagation(); });

    /* Ziehen, Zoomen (Mausrad, Doppelklick, zwei Finger), Tastatur */
    const ptr = new Map(); let pinch = 0, moved = false;
    root.addEventListener('pointerdown', (e) => { root.setPointerCapture(e.pointerId); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false; if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } });
    root.addEventListener('pointermove', (e) => {
      const p = ptr.get(e.pointerId); if (!p) return;
      if (ptr.size === 2) { ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); const [a, b] = [...ptr.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch && d / pinch > 1.45) { zoomBy(1); pinch = d; } else if (pinch && d / pinch < 0.69) { zoomBy(-1); pinch = d; } return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y; if (Math.abs(dx) + Math.abs(dy) > 0) moved = true;
      p.x = e.clientX; p.y = e.clientY; panBy(-dx, -dy);
    });
    const up = (e) => { ptr.delete(e.pointerId); pinch = 0; };
    root.addEventListener('pointerup', (e) => { up(e); if (!moved && !e.target.closest('.map-pop,.map-pin,.map-ctl')) closePop(); });
    root.addEventListener('pointercancel', up);
    let wheelAt = 0;
    root.addEventListener('wheel', (e) => { e.preventDefault(); const t = Date.now(); if (t - wheelAt < 140) return; wheelAt = t; const r = root.getBoundingClientRect(); zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    root.addEventListener('dblclick', (e) => { if (e.target.closest('.map-pop,.map-pin,.map-ctl')) return; const r = root.getBoundingClientRect(); zoomBy(1, e.clientX - r.left, e.clientY - r.top); });
    root.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowLeft') panBy(-80, 0); else if (k === 'ArrowRight') panBy(80, 0); else if (k === 'ArrowUp') panBy(0, -80); else if (k === 'ArrowDown') panBy(0, 80);
      else if (k === '+' || k === '=') zoomBy(1); else if (k === '-') zoomBy(-1); else if (k === 'Escape') closePop(); else return;
      e.preventDefault();
    });

    let first = true;
    const ro = new ResizeObserver(() => { w = root.clientWidth; h = root.clientHeight; if (first && w) { first = false; fit(); } schedule(); });
    ro.observe(root);
    return {
      fit: (list) => fit(list), setMarkers(list) { pts = list; closePop(); schedule(); },
      setLines(l) { lines = l || []; schedule(); },
      setCircle(cc, doFit) {
        circle = cc || null;
        if (circle && doFit) { const dLat = circle.km / 111.32, dLon = circle.km / (111.32 * Math.max(0.1, Math.cos(circle.lat * Math.PI / 180))); fit([{ lat: circle.lat + dLat, lon: circle.lon - dLon }, { lat: circle.lat - dLat, lon: circle.lon + dLon }]); }
        schedule();
      },
      focus(id) { const m = pts.find((x) => x.id === id); if (!m) return; setView(m.lat, m.lon, 14); setTimeout(() => { const i = current.findIndex((cl) => cl.items.some((x) => x.id === id)); if (i >= 0) showPop(i); }, 60); },
      destroy() { ro.disconnect(); },
    };
  }

  /* -------------------------------------------------- Adresse → Koordinaten */
  const oneLine = (t) => String(t).split('\n').map((x) => x.trim()).filter(Boolean).join(', ');
  async function search(text) {
    if (!online()) throw Object.assign(new Error('Für die Adress-Suche die Online-Karte unter Einstellungen → Karte aktivieren – oder Koordinaten selbst eintragen.'), { status: 400 });
    return api('/api/geocode/address?q=' + enc(oneLine(text)));
  }
  /** „1990–2004“, „ab 2010“, „bis 1985“, „1999“ → { from, to } (Jahre) oder null */
  function parseRange(t) {
    t = String(t).trim().toLowerCase(); let m;
    if ((m = t.match(/^(\d{4})\s*(?:[-–—]|bis)\s*(\d{4})$/))) return { from: +m[1], to: +m[2] };
    if ((m = t.match(/^(?:bis|[-–—])\s*(\d{4})$/))) return { to: +m[1] };
    if ((m = t.match(/^(?:ab|seit|von)?\s*(\d{4})\s*(?:[-–—]|bis)?$/)) && /ab|seit|von|[-–—]|bis/.test(t)) return { from: +m[1] };
    if ((m = t.match(/^(\d{4})$/))) return { from: +m[1], to: +m[1] };
    return null;
  }
  const rangeText = (o) => (o.from && o.to ? (o.from === o.to ? String(o.from) : `${o.from}–${o.to}`) : o.from ? `ab ${o.from}` : o.to ? `bis ${o.to}` : '');
  const placeLabel = (o) => (typeof o === 'string' ? o : o.name + (rangeText(o) ? ` (${rangeText(o)})` : ''));
  /** Kommaliste „Muggendorf, Forchheim (1990–2004)“ → [{name,lat?,lon?,from?,to?}]; bekannte Koordinaten bleiben erhalten */
  function placesFrom(text, old) {
    const prev = new Map();
    for (const o of Array.isArray(old) ? old : []) { const x = typeof o === 'string' ? { name: o } : o; if (x && x.name && Number.isFinite(+x.lat) && x.lat !== '' && x.lat !== undefined) prev.set(String(x.name).trim().toLowerCase(), x); }
    const seen = new Set(), out = [];
    for (let n of String(text || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)) {
      let r = null; const m = n.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
      if (m && m[1] && (r = parseRange(m[2]))) n = m[1].trim(); else r = null;
      const k = n.toLowerCase() + '|' + (r ? r.from || '' : '') + '|' + (r ? r.to || '' : ''); if (seen.has(k)) continue; seen.add(k);
      const o = prev.get(n.toLowerCase()), e = o ? { name: n, lat: +o.lat, lon: +o.lon, ...(o.region ? { region: o.region } : {}) } : { name: n };
      if (r && r.from) e.from = r.from; if (r && r.to) e.to = r.to;
      out.push(e);
    }
    return out.length ? out : null;
  }
  /** Treffer, die weniger als 3 km auseinander liegen, gelten als derselbe Ort */
  const distinct = (list) => { const out = []; for (const r of list) if (!out.some((q) => km(q, r) < 3)) out.push(r); return out; };
  const regionOf = (name) => { const p = String(name).split(',').map((x) => x.trim()).filter(Boolean); if (p.length < 2) return ''; return [...new Set([p[1], p.length > 3 ? p[p.length - 2] : '', p[p.length - 1]].filter(Boolean))].join(', ').slice(0, 120); };
  /** Orte ohne Koordinaten suchen; bei mehreren möglichen Orten wählt die Person den richtigen. Stumm, wenn die Online-Karte aus ist. */
  async function fillPlaces(list) {
    if (!list || !online() || !list.some((p) => p.lat === undefined)) return;
    toast('Orte werden gesucht …'); const got = new Map();
    for (const p of list) if (p.lat !== undefined) got.set(p.name.toLowerCase(), p);
    for (const p of list) {
      if (p.lat !== undefined) continue;
      const k = p.name.toLowerCase();
      if (!got.has(k)) {
        try {
          const found = distinct(await search(p.name));
          const r = found.length > 1 ? await choose(found, p.name) : found[0];
          got.set(k, r ? { lat: r.lat, lon: r.lon, region: regionOf(r.name) } : null);
        } catch (e) { return; }
      }
      const g = got.get(k); if (g) { p.lat = g.lat; p.lon = g.lon; if (g.region) p.region = g.region; }
    }
  }
  /** Zeile im Adress-Repeater: Adresse suchen und Koordinaten eintragen (bei mehreren Treffern Auswahl). */
  async function geocodeRow(row) {
    const text = (row.querySelector('[data-k=value]') || {}).value || '';
    if (!text.trim()) { toast('Bitte zuerst die Adresse eintragen', 'err'); return; }
    const btn = row.querySelector('.geo-find'); btn.disabled = true;
    try {
      const list = await search(text);
      if (!list.length) { toast('Adresse nicht gefunden – bitte vereinfachen (z. B. nur Straße und Ort) oder Koordinaten selbst eintragen', 'err'); return; }
      let r = list[0];
      if (list.length > 1) r = await choose(list, text.split("\n")[0].slice(0, 60));
      if (!r) return;
      const geo = row.querySelector('[data-k=geo]'); geo.value = `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}`; geo.title = r.name;
      geo.dispatchEvent(new Event('input', { bubbles: true })); toast('Ort gefunden: ' + r.name.split(',').slice(0, 3).join(','));
    } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; }
  }
  function choose(list, what) {
    return new Promise((resolve) => {
      const bg = document.createElement('div'); bg.className = 'modal-bg';
      const title = what ? `Welcher Ort ist mit „${esc(what)}“ gemeint?` : 'Welcher Ort ist richtig?';
      bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Ort auswählen" style="max-width:540px"><h2 style="margin-top:0">${title}</h2><p class="muted small-text" style="margin-top:0">Es gibt mehrere Orte mit diesem Namen – bitte den richtigen auswählen.</p>${list.map((r, i) => { const p = r.name.split(',').map((x) => x.trim()); return `<button type="button" class="hist-item" data-i="${i}" style="width:100%;margin:4px 0;text-align:left"><b>${esc(p[0])}</b> <span class="muted">${esc(p.slice(1, 3).join(', '))}</span><br><span class="muted small-text">${esc(p.slice(3).join(', ') || p[p.length - 1])}</span></button>`; }).join('')}<div class="row-flex" style="margin-top:8px"><button type="button" class="btn" id="chNone">Keiner davon (ohne Standort)</button><span class="spacer"></span><button type="button" class="btn ghost" id="chX">Abbrechen</button></div></div>`;
      document.body.appendChild(bg);
      const done = (v) => { document.removeEventListener('keydown', esc2, true); bg.remove(); resolve(v); };
      const esc2 = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
      document.addEventListener('keydown', esc2, true);
      bg.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) done(list[+b.dataset.i]); else if (e.target === bg || e.target.id === 'chX' || e.target.id === 'chNone') done(null); });
      const f = bg.querySelector('[data-i]'); if (f) f.focus();
    });
  }

  /* ------------------------------------------------------------ Ansicht „Karte“ */
  const pinOf = (p) => M.avatar({ title: p.title, photo: p.photo });
  const subOf = (pl) => (pl.home ? '🏠 Wohnort' + (pl.value ? ': ' + pl.value : '') : pl.kind === 'ort' ? 'Früher: ' + pl.label + (pl.region ? ` – ${pl.region}` : '') + (rangeText(pl) ? ` (${rangeText(pl)})` : '') : [pl.label, pl.value].filter(Boolean).join(': '));
  const markersOf = (points) => points.flatMap((p) => p.places.map((pl, i) => ({ id: `${p.slug}#${i}`, lat: pl.lat, lon: pl.lon, faint: !pl.home, home: !!pl.home, from: pl.from, to: pl.to, ranged: !!(pl.from || pl.to), title: p.title, sub: subOf(pl), href: `#/person/${enc(p.slug)}`, avatar: pinOf(p), tags: p.tags, slug: p.slug, lastContact: p.lastContact, every: p.contactEvery })));
  const km = (a, b) => { const R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const overdue = (m) => m.every && (!m.lastContact || (Date.now() - new Date(m.lastContact + 'T12:00:00').getTime()) / 864e5 >= m.every);
  const fmtKm = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)).toString().replace('.', ',') + ' km';

  async function mapView() {
    const app = $('#app');
    if (!feat('people')) { app.innerHTML = '<div class="card"><h1>🗺️ Karte</h1><p class="muted">Die Karte zeigt Wohnorte und Orte deiner Personen – dafür muss „Personen“ aktiv sein.</p></div>'; return; }
    const [data, forest] = await Promise.all([api('/api/map'), api('/api/family').catch(() => ({ components: [], families: [] }))]);
    const on = online(), cy = new Date().getFullYear();
    const total = data.points.reduce((s, p) => s + p.places.length, 0);
    const all = markersOf(data.points);
    const homes = all.filter((m) => m.home);
    const comps = (forest.families || forest.components).map((c) => ({ ...c, here: c.nodes.filter((n) => data.points.some((p) => p.slug === n.slug)).length })).filter((c) => c.here);
    const peopleWithHome = [...new Map(homes.map((m) => [m.slug, m.title])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'de'));
    const allYears = () => [...all.filter((m) => m.ranged).flatMap((m) => [m.from, m.to]), ...jm.flatMap((j) => j.items.map((i) => +i.date.slice(0, 4)))].filter(Boolean);
    const st = { text: '', fam: '', famSet: null, time: false, year: cy, journal: false, circle: null, centerLabel: '' };
    let jm = []; // Tagebuch-Orte

    app.innerHTML = `<div class="card"><div class="row-flex"><h1 style="margin:0">🗺️ Karte</h1><span class="spacer"></span>
        <input type="search" id="mapFind" placeholder="Person, Tag oder Ort filtern …" style="max-width:260px" autocomplete="off"><button type="button" class="btn" id="mapSideBtn" aria-controls="mapSide" aria-expanded="true">⚙️ Filter</button></div>
        <p class="muted small-text" style="margin:8px 0 0">${total ? `${total} Ort${total === 1 ? '' : 'e'} von ${data.points.length} Person${data.points.length === 1 ? '' : 'en'}.` : 'Noch keine Orte mit Koordinaten.'} Das Bild in voller Deckkraft zeigt den aktuellen Wohnort, blasse Bilder zeigen frühere Wohnorte (nur Ortsnamen). Beides trägst du im Bearbeiten-Modus einer Person ein.</p>
        ${total ? '' : '<p style="margin:10px 0 0"><a class="btn primary small" href="#/people">📍 Ersten Wohnort eintragen</a> <span class="muted small-text">Person öffnen → Bearbeiten → Adresse mit „Aktueller Wohnort“.</span></p>'}
        ${on ? '' : '<div class="status" style="margin-top:10px">Ohne Online-Karte wird kein Kartenhintergrund geladen und es werden keine Adressen an Dritte gesendet. <a href="#/settings?tab=weather">Online-Karte aktivieren</a> (Einstellungen → Wetter &amp; Ort).</div>'}
</div>
      <div class="map-layout" id="mapLayout">
        <aside class="map-side" id="mapSide" aria-label="Kartenfilter">
        <div class="map-tools">
          <label class="map-tool"><span>👪 Familie</span><select id="mapFam"><option value="">Alle Personen</option>
            ${comps.length ? `<optgroup label="Familien">${comps.map((c, i) => `<option value="c:${i}">${esc(c.name)} (${c.here})</option>`).join('')}</optgroup>` : ''}
            <optgroup label="Verwandte von …">${peopleWithHome.map(([sl, t]) => `<option value="r:${esc(sl)}">${esc(t)}</option>`).join('')}</optgroup></select></label>
          <label class="map-tool"><span class="sw"><input type="checkbox" id="mapJournal"> 📓 Tagebuch-Orte</span></label>
          <span class="map-tool" id="timeBox" ${allYears().length ? '' : 'hidden'}><label class="sw"><input type="checkbox" id="mapTime"> ⏳ Zeitverlauf</label>
            <input type="range" id="mapYear" min="${cy - 10}" max="${cy}" value="${cy}" disabled aria-label="Jahr"><b id="yearOut">${cy}</b><button type="button" class="btn small" id="tPlay" disabled title="Abspielen">▶</button></span>
        </div>
        <details id="mapRad" style="margin-top:8px"><summary>📏 Umkreissuche – wer wohnt in der Nähe?</summary><div class="map-tools" style="margin-top:8px">
          <label class="map-tool"><span>Mittelpunkt</span><select id="radPerson"><option value="">Person wählen …</option>${peopleWithHome.map(([sl, t]) => `<option value="${esc(sl)}">${esc(t)}</option>`).join('')}</select></label>
          <button type="button" class="btn small" id="radGeo">📍 Mein Standort</button>
          <span class="map-tool"><input type="text" id="radAddr" placeholder="Ort oder Adresse" autocomplete="off" ${on ? '' : 'disabled title="Dafür die Online-Karte aktivieren"'}><button type="button" class="btn small" id="radFind" ${on ? '' : 'disabled'}>Suchen</button></span>
          <label class="map-tool"><span>Radius</span><input type="number" id="radKm" value="25" min="1" max="3000" step="5" style="width:80px"> km</label>
          <button type="button" class="btn small" id="radOff">Zurücksetzen</button></div></details>
        </aside>
        <section class="card map-card" style="padding:0;overflow:hidden"><div id="mapBox"></div></section>
      </div>
      <section class="card" id="mapList"></section>`;
    const side = $('#mapSide'), sideBtn = $('#mapSideBtn'), lay = $('#mapLayout');
    const setSide = (open) => { lay.classList.toggle('side-off', !open); side.classList.toggle('open', open); sideBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    setSide(!window.matchMedia('(max-width: 760px)').matches);
    sideBtn.addEventListener('click', () => setSide(sideBtn.getAttribute('aria-expanded') !== 'true'));
    side.addEventListener('keydown', (e) => { if (e.key === 'Escape' && window.matchMedia('(max-width: 760px)').matches) { setSide(false); sideBtn.focus(); } });
    const map = create($('#mapBox'), all, { height: Math.max(380, Math.round(window.innerHeight * 0.6)) });
    const list = $('#mapList'), famF = { edges: [], couples: [] };
    let shown = all;

    const jmarkers = () => jm.filter((j) => j.lat !== undefined).map((j) => {
      const items = st.time ? j.items.filter((i) => i.date.startsWith(String(st.year))) : j.items; if (!items.length) return null;
      const count = st.time ? items.length : j.count;
      return { id: 'j#' + j.name, lat: j.lat, lon: j.lon, journal: true, faint: false, title: j.name, sub: `📓 ${count} Tagebuch${count === 1 ? 'eintrag' : 'einträge'}`, tags: [], slug: '', avatar: '<span class="jpin">📓</span>', href: '#/journal', links: items.slice(0, 6).map((i) => ({ t: M.fmtShort(i.date), href: '#/journal/' + enc(i.slug) })) };
    }).filter(Boolean);

    const compute = () => {
      let l = all;
      if (st.famSet) l = l.filter((m) => st.famSet.has(m.slug));
      const t = st.text.toLowerCase();
      if (t) l = l.filter((m) => m.title.toLowerCase().includes(t) || (m.tags || []).some((x) => String(x).toLowerCase().includes(t)) || m.sub.toLowerCase().includes(t));
      if (st.time) l = l.filter((m) => (m.home ? st.year >= cy : m.ranged && (!m.from || st.year >= m.from) && (!m.to || st.year <= m.to))).map((m) => ({ ...m, faint: false }));
      let dist = null;
      if (st.circle) {
        dist = new Map();
        l = l.filter((m) => { if (!m.home || m.slug === st.circle.slug) return false; const d = km(st.circle, m); if (d <= st.circle.km) { dist.set(m.id, d); return true; } return false; }).sort((a, b) => dist.get(a.id) - dist.get(b.id));
      }
      if (st.journal && !st.circle && !st.famSet) l = l.concat(jmarkers().filter((m) => !t || m.title.toLowerCase().includes(t)));
      return { l, dist };
    };
    const lines = () => {
      if (!st.famSet || st.time || st.circle) return [];
      const pos = new Map();
      for (const m of all) if (st.famSet.has(m.slug) && (m.home || !pos.has(m.slug))) pos.set(m.slug, m);
      const out = [];
      for (const [pa, ch] of famF.edges) if (pos.has(pa) && pos.has(ch)) out.push({ a: pos.get(pa), b: pos.get(ch), kind: 'child' });
      for (const c of famF.couples) if (pos.has(c.a) && pos.has(c.b)) out.push({ a: pos.get(c.a), b: pos.get(c.b), kind: 'partner' });
      return out;
    };
    const apply = (refit) => {
      const { l, dist } = compute(); shown = l;
      map.setMarkers(l); map.setLines(lines());
      map.setCircle(st.circle ? { lat: st.circle.lat, lon: st.circle.lon, km: st.circle.km } : null, refit === 'circle');
      if (refit === true || (refit === 'text' && st.text)) map.fit(l.length ? l : undefined);
      draw(l, dist);
    };

    function draw(items, dist) {
      const jn = jm.filter((j) => j.lat === undefined && !j.searched).length;
      list.innerHTML = (st.circle ? `<div class="status">📏 Im Umkreis von <b>${st.circle.km} km</b> um <b>${esc(st.centerLabel)}</b>: <b>${items.length}</b> ${items.length === 1 ? 'Person' : 'Personen'} (nach Entfernung, nur aktuelle Wohnorte).</div>` : '')
        + `<h2>Orte <span class="muted small-text">${items.length}</span></h2>` + (items.length ? items.map((m) => `<button type="button" class="row maprow" data-id="${esc(m.id)}"><span class="row-ic">${m.journal ? '📓' : '📍'}</span><div class="row-main"><div class="row-title">${esc(m.title)}${dist && dist.has(m.id) && overdue(m) ? ' <span class="tag" title="Kontaktwunsch überfällig">📞 überfällig</span>' : ''}</div><div class="row-sub">${esc(m.sub).replace(/\n/g, ', ')}</div></div>${dist && dist.has(m.id) ? `<span class="muted">${fmtKm(dist.get(m.id))}</span>` : ''}</button>`).join('') : '<p class="muted">Keine Treffer.</p>')
        + (st.journal && jn ? `<hr class="thin"><h3>Tagebuch-Orte ohne Koordinaten <span class="muted small-text">${jn}</span></h3>${on ? '<button type="button" class="btn" id="jGeo">📍 Tagebuch-Orte jetzt suchen</button> <span class="muted small-text" id="jStat"></span>' : '<p class="muted small-text">Zum Suchen die Online-Karte aktivieren.</p>'}` : '')
        + (data.missing.length ? `<hr class="thin"><h3>Ort ohne Koordinaten <span class="muted small-text">${data.missing.length}</span></h3><div class="chips">${data.missing.map((p) => `<a class="tag" href="#/person/${enc(p.slug)}?edit=1">${esc(p.title)}${p.count > 1 ? ' (' + p.count + ')' : ''}</a>`).join('')}</div>${on ? '<div style="margin-top:10px"><button type="button" class="btn" id="geoAll">📍 Fehlende Orte jetzt suchen</button> <span class="muted small-text" id="geoStat"></span></div>' : ''}` : '')
        + (data.none.length ? `<hr class="thin"><details><summary>Personen ohne Ort (${data.none.length})</summary><div class="chips" style="margin-top:8px">${data.none.map((p) => `<a class="tag" href="#/person/${enc(p.slug)}">${esc(p.title)}</a>`).join('')}</div></details>` : '');
      const ga = $('#geoAll', list); if (ga) ga.addEventListener('click', () => fillMissing(ga));
      const jg = $('#jGeo', list); if (jg) jg.addEventListener('click', () => fillJournal(jg));
    }
    apply(false);
    list.addEventListener('click', (e) => { const r = e.target.closest('.maprow'); if (r) { map.focus(r.dataset.id); $('#mapBox').scrollIntoView({ block: 'center', behavior: 'smooth' }); } });
    $('#mapFind').addEventListener('input', (e) => { st.text = e.target.value.trim(); apply('text'); });

    /* Familie / Verwandte */
    $('#mapFam').addEventListener('change', async (e) => {
      const v = e.target.value;
      if (!v) { st.fam = ''; st.famSet = null; famF.edges = []; famF.couples = []; return apply(true); }
      try {
        if (v[0] === 'c') { const c = comps[+v.slice(2)]; st.famSet = new Set(c.nodes.map((n) => n.slug)); famF.edges = c.edges; famF.couples = c.couples; }
        else {
          const slug = v.slice(2), d = await api('/api/family/' + enc(slug) + '?up=4&down=4&wide=1');
          st.famSet = new Set([slug, ...(d.relatives || []).map((r) => r.slug)]);
          famF.edges = forest.components.flatMap((c) => c.edges); famF.couples = forest.components.flatMap((c) => c.couples);
        }
        st.fam = v; apply(true);
      } catch (err) { toast(err.message, 'err'); }
    });

    /* Tagebuch-Orte */
    async function loadJournal() { jm = (await api('/api/map/journal')).places; $('#timeBox').hidden = !allYears().length; }
    $('#mapJournal').addEventListener('change', async (e) => { st.journal = e.target.checked; if (st.journal && !jm.length) { try { await loadJournal(); } catch (err) { toast(err.message, 'err'); } } apply(st.journal); });
    async function fillJournal(btn) {
      btn.disabled = true; const stat = $('#jStat'); const todo = jm.filter((j) => j.lat === undefined && !j.searched); let n = 0;
      for (const j of todo) { stat.textContent = `Suche ${++n}/${todo.length}: ${j.name} …`; try { const found = distinct(await api('/api/geocode/address?q=' + enc(j.name))); if (found.length > 1) { const r = await choose(found, j.name); if (r) await api('/api/geocode/choose', { method: 'POST', body: { q: j.name, lat: r.lat, lon: r.lon } }); } } catch (e) { stat.textContent = e.message; btn.disabled = false; return; } }
      await loadJournal(); toast('Tagebuch-Orte aktualisiert'); apply(true);
    }

    /* Zeitverlauf */
    let timer = 0; const yr = $('#mapYear'), tp = $('#tPlay');
    const setYear = (y) => { st.year = y; yr.value = y; $('#yearOut').textContent = y; apply(false); };
    const bounds = () => { const ys = allYears(); const lo = Math.min(...ys, cy - 1); yr.min = lo; yr.max = cy; };
    $('#mapTime').addEventListener('change', (e) => {
      st.time = e.target.checked; yr.disabled = tp.disabled = !st.time; bounds(); clearInterval(timer); tp.textContent = '▶';
      if (st.time) { st.year = Math.min(cy, Math.max(+yr.min, +yr.value)); yr.value = st.year; $('#yearOut').textContent = st.year; }
      apply(true);
    });
    yr.addEventListener('input', () => setYear(+yr.value));
    tp.addEventListener('click', () => {
      if (timer) { clearInterval(timer); timer = 0; tp.textContent = '▶'; return; }
      if (+yr.value >= cy) setYear(+yr.min);
      tp.textContent = '⏸'; timer = setInterval(() => { if (!document.body.contains(yr)) { clearInterval(timer); return; } if (st.year >= cy) { clearInterval(timer); timer = 0; tp.textContent = '▶'; return; } setYear(st.year + 1); }, 900);
    });

    /* Umkreis */
    const setCircle = (lat, lon, label, slug) => { st.circle = { lat, lon, slug: slug || '', km: Math.max(1, +$('#radKm').value || 25) }; st.centerLabel = label; apply('circle'); };
    $('#radPerson').addEventListener('change', (e) => { const sl = e.target.value; if (!sl) return; const m = homes.find((x) => x.slug === sl); if (m) setCircle(m.lat, m.lon, m.title, sl); });
    $('#radGeo').addEventListener('click', () => {
      if (!navigator.geolocation) return toast('Standortbestimmung wird von diesem Browser nicht unterstützt', 'err');
      navigator.geolocation.getCurrentPosition((pos) => { $('#radPerson').value = ''; setCircle(pos.coords.latitude, pos.coords.longitude, 'deinem Standort'); }, () => toast('Standort nicht verfügbar – bitte Berechtigung prüfen oder Ort eingeben', 'err'), { timeout: 10000 });
    });
    const findAddr = async () => {
      const q = $('#radAddr').value.trim(); if (!q) return;
      try { const r = await search(q); if (!r.length) return toast('Ort nicht gefunden', 'err'); const x = r.length > 1 ? await choose(r) : r[0]; if (!x) return; $('#radPerson').value = ''; setCircle(x.lat, x.lon, x.name.split(',').slice(0, 2).join(',')); } catch (e) { toast(e.message, 'err'); }
    };
    $('#radFind').addEventListener('click', findAddr);
    $('#radAddr').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findAddr(); } });
    $('#radKm').addEventListener('input', () => { if (st.circle) { st.circle.km = Math.max(1, +$('#radKm').value || 1); apply('circle'); } });
    $('#radOff').addEventListener('click', () => { st.circle = null; $('#radPerson').value = ''; apply(true); });

    async function fillMissing(btn) {
      btn.disabled = true; const stat = $('#geoStat'); let done = 0, found = 0; const total = data.missing.reduce((s, p) => s + p.count, 0);
      for (const p of data.missing) {
        const d = await api(`/api/item/person/${enc(p.slug)}`); const adr = Array.isArray(d.meta.addresses) ? d.meta.addresses.map((a) => ({ ...a })) : []; let changed = false;
        const orte = Array.isArray(d.meta.places) ? d.meta.places.map((o) => (typeof o === 'string' ? { name: o } : { ...o })) : [];
        const got = new Map(); for (const o of orte) if (o.name && o.lat !== undefined) got.set(o.name.toLowerCase(), o);
        for (const o of orte) {
          if (!o.name || o.lat !== undefined) continue;
          const k = o.name.toLowerCase();
          if (!got.has(k)) {
            stat.textContent = `Suche ${++done}/${total}: ${p.title} – ${o.name} …`;
            try { const r = (await search(o.name))[0]; got.set(k, r ? { lat: r.lat, lon: r.lon } : null); } catch (e) { stat.textContent = e.message; btn.disabled = false; return; }
          }
          const g = got.get(k); if (g) { o.lat = g.lat; o.lon = g.lon; changed = true; found++; }
        }
        for (const a of adr) {
          if (!a || a.lat !== undefined || !String(a.value || '').trim()) continue;
          stat.textContent = `Suche ${++done}/${total}: ${p.title} …`;
          try { const r = (await search(a.value))[0]; if (r) { a.lat = r.lat; a.lon = r.lon; changed = true; found++; } } catch (e) { stat.textContent = e.message; btn.disabled = false; return; }
        }
        if (changed) await api(`/api/item/person/${enc(p.slug)}`, { method: 'PUT', body: { meta: { addresses: adr, ...(orte.length ? { places: orte } : {}) } } });
      }
      M.invalidate(); toast(`${found} von ${total} Orten gefunden`); mapView();
    }
  }

  /** Kleine Karte auf der Personenseite (Orte aus den Adressen mit Koordinaten) */
  function miniMap(box, it) {
    const okc = (a) => a && Number.isFinite(+a.lat) && Number.isFinite(+a.lon) && a.lat !== '' && a.lon !== '';
    const adr = (Array.isArray(it.meta.addresses) ? it.meta.addresses : []).filter((a) => a && typeof a === 'object');
    const flagged = adr.some((a) => a.home), homeA = flagged ? adr.find((a) => a.home) : adr.find(okc);
    const pl = adr.filter(okc).map((a) => ({ home: a === homeA, label: a.label, value: a.value, lat: +a.lat, lon: +a.lon }));
    for (const o of Array.isArray(it.meta.places) ? it.meta.places : []) if (o && typeof o === 'object' && okc(o)) pl.push({ home: false, kind: 'ort', label: o.name, lat: +o.lat, lon: +o.lon });
    if (!pl.length) { box.remove(); return; }
    const pin = pinOf({ title: it.title, photo: it.meta.photo });
    const mk = pl.map((a, i) => ({ id: it.slug + '#' + i, lat: a.lat, lon: a.lon, faint: !a.home, title: it.title, sub: subOf(a), href: '#/map', avatar: pin }));
    const holder = document.createElement('div'); box.appendChild(holder);
    create(holder, mk, { height: 220 });
  }

  M.map = { create, geocodeRow, miniMap, online, placesFrom, fillPlaces, placeLabel };
  M.routes.push([/^\/map$/, mapView]);
})();
