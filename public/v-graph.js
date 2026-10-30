'use strict';
/* Graph */
(() => {
  const M = window.M;
  const { $, $$, esc, enc, pad, isDate, todayStr, parseD, fmtD, addDays, diffDays, fmtLong, fmtShort, monthName, ago, MOODS, moodColor, TYPE, href, feat, go, api, getItems, invalidate, toast, dispTitle, tagChips, moodChip, fileUrl, avatar, row, isDark, embedHTML, songLine, lookupSong, onLeave, sparkline, lineChart } = M;
  const app = M.$('#app');
  /* ---------------------------------------------------------------- Graph */
  async function graphView() {
    const g = await api('/api/graph');
    app.innerHTML = `<div class="card graph-card"><div class="graph-tools">
      ${feat('people') ? '<label><input type="checkbox" data-t="person" checked> 👤 Personen</label>' : ''}<label><input type="checkbox" data-t="journal" checked> 📓 Tagebuch</label><label><input type="checkbox" data-t="note" checked> 📝 Notizen</label>
      <label><input type="checkbox" id="hideIso" checked> Unverbundene ausblenden</label><span class="muted">Mausrad = Zoom · Ziehen = Verschieben · Klick = Öffnen</span></div>
      <canvas id="gcanvas"></canvas><div id="gtip"></div></div>`;
    const cv = $('#gcanvas'), ctx = cv.getContext('2d'), tip = $('#gtip');
    const col = { person: '#e0709b', journal: '#6b8cff', note: '#4caf7a' };
    let nodes = [], edges = [], raf = 0, alpha = 1, view = { k: 1, x: 0, y: 0 }, hover = null, W = 0, H = 0, dragging = false, moved = false, last = null;
    function build() {
      const on = new Set($$('.graph-tools [data-t]').filter((c) => c.checked).map((c) => c.dataset.t));
      let ns = g.nodes.filter((n) => on.has(n.type));
      const ids = new Set(ns.map((n) => n.id));
      const es = g.edges.filter((e) => ids.has(e.s) && ids.has(e.t));
      if ($('#hideIso').checked) { const used = new Set(es.flatMap((e) => [e.s, e.t])); ns = ns.filter((n) => used.has(n.id)); }
      const map = new Map();
      nodes = ns.map((n, i) => { const a = (i / Math.max(1, ns.length)) * Math.PI * 2; const o = { ...n, x: Math.cos(a) * 160 + Math.random() * 20, y: Math.sin(a) * 160 + Math.random() * 20, vx: 0, vy: 0, deg: 0 }; map.set(n.id, o); return o; });
      edges = es.map((e) => ({ a: map.get(e.s), b: map.get(e.t) })).filter((e) => e.a && e.b);
      edges.forEach((e) => { e.a.deg++; e.b.deg++; });
      alpha = 1; kick();
    }
    function size() { const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function tick() {
      const n = nodes.length;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = nodes[i], b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 90000) continue; const d = Math.sqrt(d2), f = (1400 / d2) * alpha; dx /= d; dy /= d; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      for (const e of edges) { const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01, f = (d - 70) * 0.012 * alpha; e.a.vx += (dx / d) * f; e.a.vy += (dy / d) * f; e.b.vx -= (dx / d) * f; e.b.vy -= (dy / d) * f; }
      for (const o of nodes) { o.vx -= o.x * 0.004 * alpha; o.vy -= o.y * 0.004 * alpha; o.vx *= 0.82; o.vy *= 0.82; o.x += o.vx; o.y += o.vy; }
      alpha *= 0.985;
    }
    const rad = (o) => 4 + Math.min(10, Math.sqrt(o.deg) * 2.2);
    function draw() {
      ctx.clearRect(0, 0, W, H); ctx.save(); ctx.translate(W / 2 + view.x, H / 2 + view.y); ctx.scale(view.k, view.k);
      const dark = isDark();
      ctx.lineWidth = 1 / view.k; ctx.strokeStyle = dark ? 'rgba(160,170,200,.28)' : 'rgba(80,90,120,.28)';
      ctx.beginPath(); for (const e of edges) { ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); } ctx.stroke();
      for (const o of nodes) { ctx.beginPath(); ctx.arc(o.x, o.y, rad(o), 0, 7); ctx.fillStyle = col[o.type]; ctx.globalAlpha = hover && hover !== o ? 0.75 : 1; ctx.fill(); if (hover === o) { ctx.lineWidth = 2 / view.k; ctx.strokeStyle = dark ? '#fff' : '#000'; ctx.stroke(); } }
      ctx.globalAlpha = 1; ctx.font = `${12 / view.k}px system-ui`; ctx.fillStyle = dark ? '#d8dbe8' : '#333'; ctx.textAlign = 'center';
      for (const o of nodes) if (o.type !== 'journal' && (o.deg > 1 || view.k > 1.2)) ctx.fillText(o.title, o.x, o.y + rad(o) + 12 / view.k);
      ctx.restore();
    }
    function loop() { if (alpha > 0.01) tick(); draw(); raf = alpha > 0.01 ? requestAnimationFrame(loop) : 0; }
    function kick() { if (!raf) raf = requestAnimationFrame(loop); }
    const toWorld = (ev) => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left - W / 2 - view.x) / view.k, y: (ev.clientY - r.top - H / 2 - view.y) / view.k }; };
    const pick = (ev) => { const p = toWorld(ev); let best = null, bd = 1e9; for (const o of nodes) { const d = Math.hypot(o.x - p.x, o.y - p.y); if (d < rad(o) + 4 / view.k && d < bd) { best = o; bd = d; } } return best; };
    cv.addEventListener('mousedown', (e) => { dragging = true; moved = false; last = { x: e.clientX, y: e.clientY }; cv.style.cursor = 'grabbing'; });
    const onMove = (e) => {
      if (dragging && last) { const dx = e.clientX - last.x, dy = e.clientY - last.y; if (Math.abs(dx) + Math.abs(dy) > 2) moved = true; view.x += dx; view.y += dy; last = { x: e.clientX, y: e.clientY }; draw(); return; }
      if (e.target !== cv) return; const h = pick(e);
      if (h !== hover) { hover = h; draw(); }
      cv.style.cursor = h ? 'pointer' : 'grab';
      if (h) { const r = cv.getBoundingClientRect(); tip.style.display = 'block'; tip.style.left = e.clientX - r.left + 12 + 'px'; tip.style.top = e.clientY - r.top + 12 + 'px'; tip.textContent = `${TYPE[h.type].ic} ${h.title}`; } else tip.style.display = 'none';
    };
    const onUp = (e) => { if (dragging && !moved && e.target === cv) { const h = pick(e); if (h) location.hash = `#/${h.type}/${enc(h.slug)}`; } dragging = false; last = null; cv.style.cursor = 'grab'; };
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const k = Math.min(4, Math.max(0.25, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); const p = toWorld(e); view.k = k; const r = cv.getBoundingClientRect(); view.x = e.clientX - r.left - W / 2 - p.x * k; view.y = e.clientY - r.top - H / 2 - p.y * k; draw(); }, { passive: false });
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    const onResize = () => { size(); draw(); }; window.addEventListener('resize', onResize);
    onLeave(() => { cancelAnimationFrame(raf); raf = 0; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); window.removeEventListener('resize', onResize); });
    $$('.graph-tools input').forEach((c) => c.addEventListener('change', build));
    size(); build();
  }
  M.routes.push([/^\/graph$/, graphView]);
})();
