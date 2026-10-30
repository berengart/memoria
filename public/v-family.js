'use strict';
/* Familie: Namensabfrage, Personen anlegen, Beziehungen ergänzen, Stammbaum (SVG) und Familienkarte */
(() => {
  const M = window.M;
  const { $, $$, esc, enc, api, toast, invalidate, getItems } = M;

  const norm = (s) => String(s || '').trim().toLowerCase();
  const GENDER = { Mutter: 'w', Vater: 'm' };

  /** Kleiner Dialog: ein Name mit Vorschlägen aus den vorhandenen Personen. Gibt den Namen oder null zurück. */
  async function askName(title, hint) {
    const items = (await getItems()).filter((i) => i.type === 'person');
    return new Promise((resolve) => {
      const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.dataset.closable = '1';
      bg.innerHTML = `<form class="modal" style="max-width:440px"><h2 style="margin-top:0">${esc(title)}</h2>
        <div class="field"><label for="fnName">Name</label><input id="fnName" type="text" list="fnList" autocomplete="off" required autofocus>
        <datalist id="fnList">${items.map((i) => `<option value="${esc(i.title)}">`).join('')}</datalist></div>
        <p class="muted small-text">${esc(hint || 'Gibt es die Person schon, wird sie verknüpft – sonst wird sie neu angelegt.')}</p>
        <div class="row-flex"><button class="btn primary">OK</button><button type="button" class="btn" id="fnX">Abbrechen</button></div></form>`;
      document.body.appendChild(bg);
      const done = (v) => { bg.remove(); resolve(v); };
      $('#fnX', bg).addEventListener('click', () => done(null));
      bg.addEventListener('mousedown', (e) => { if (e.target === bg) done(null); });
      $('form', bg).addEventListener('submit', (e) => { e.preventDefault(); done($('#fnName', bg).value.trim() || null); });
      $('#fnName', bg).focus();
    });
  }

  /** Warnt vor Dubletten: Gibt es Personen mit sehr ähnlichem Namen, fragt ein Dialog. Ergebnis: { action: 'new' } | { action: 'use', slug, title } | null (abgebrochen) */
  async function dupDialog(name, opts = {}) {
    let list = []; try { list = await api('/api/duplicates?name=' + enc(name) + (opts.except ? '&except=' + enc(opts.except) : '')); } catch (e) { return { action: 'new' }; }
    if (!list.length) return { action: 'new' };
    return new Promise((resolve) => {
      const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.dataset.closable = '1';
      bg.innerHTML = `<div class="modal" style="max-width:480px"><h2 style="margin-top:0">Gibt es diese Person schon?</h2>
        <p>„${esc(name)}“ ähnelt ${list.length === 1 ? 'einer vorhandenen Person' : 'vorhandenen Personen'}:</p>
        ${list.slice(0, 5).map((p, i) => `<button type="button" class="hist-item" data-i="${i}" style="width:100%;margin:4px 0"><b>${esc(p.title)}</b>${p.birthday ? `<span class="muted small-text"> · * ${esc(M.fmtShort && /^\d{4}-\d{2}-\d{2}$/.test(p.birthday) ? M.fmtShort(p.birthday) : p.birthday)}</span>` : ''}<span class="muted small-text"> – diese verwenden</span></button>`).join('')}
        <div class="row-flex" style="margin-top:10px"><button type="button" class="btn" id="dupNew">Trotzdem neu anlegen</button>${opts.noCancel ? '' : '<button type="button" class="btn" id="dupX">Abbrechen</button>'}</div></div>`;
      document.body.appendChild(bg);
      const done = (v) => { bg.remove(); resolve(v); };
      bg.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { const p = list[+b.dataset.i]; done({ action: 'use', slug: p.slug, title: p.title }); } else if (e.target.id === 'dupNew') done({ action: 'new' }); else if (e.target === bg || e.target.id === 'dupX') done(opts.noCancel ? { action: 'new' } : null); });
    });
  }

  /** Stellt sicher, dass es die Person gibt (sonst wird sie angelegt). Gibt { title, created } zurück. */
  async function ensurePerson(name, gender, extraMeta) {
    const items = await getItems();
    const hit = items.find((i) => i.type === 'person' && (norm(i.title) === norm(name) || (i.aliases || []).some((a) => norm(a) === norm(name))));
    if (hit) return { title: hit.title, created: false };
    const d = await dupDialog(name, { noCancel: true });
    if (d && d.action === 'use') return { title: d.title, created: false };
    await api('/api/item/person', { method: 'POST', body: { title: name, meta: { ...(gender ? { gender } : {}), ...(extraMeta || {}) } } });
    invalidate(); await getItems(true);
    return { title: name, created: true };
  }

  /** Hängt eine Beziehung an die Beziehungsliste einer Person an (doppelte werden übersprungen). */
  async function addRelation(slug, rel) {
    const d = await api(`/api/item/person/${enc(slug)}`);
    const rels = Array.isArray(d.meta.relations) ? d.meta.relations.slice() : [];
    if (!rels.some((r) => norm(r.person) === norm(rel.person) && r.type === rel.type)) rels.push(rel);
    await api(`/api/item/person/${enc(slug)}`, { method: 'PUT', body: { meta: { relations: rels } } });
  }

  /* ------------------------------------------------------------ Baumzeichnung */
  const W = 138, H = 64, GX = 18, GY = 52, PAD = 16;
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const year = (s) => { const m = String(s || '').match(/^(\d{4})/); return m ? m[1] : ''; };
  const ymd = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
  /** Alter in Jahren (genau, wenn beide Daten vollständig sind, sonst nach Jahreszahlen) */
  function ageOf(born, died) {
    const b = ymd(born), by = b ? b.y : +year(born); if (!by) return null;
    const now = new Date(), today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
    const dd = died ? ymd(died) : null, dy = died ? (dd ? dd.y : +year(died)) : null;
    if (died && !dy) return null;
    const e = died ? dd : today; let a = (died ? dy : today.y) - by;
    if (b && e && (e.m < b.m || (e.m === b.m && e.d < b.d))) a--;
    return a >= 0 && a < 130 ? a : null;
  }
  /** Zeile mit Lebensdaten: „* 1950 † 2020 (70)“ bzw. „* 1980 (46)“ */
  function lifeLine(n) {
    const a = ageOf(n.born, n.died);
    return [year(n.born) && '* ' + year(n.born), n.died && '†' + (year(n.died) ? ' ' + year(n.died) : ''), a !== null ? `(${a})` : ''].filter(Boolean).join(' ');
  }
  const placeLine = (n) => (n.bplace && n.dplace ? `${n.bplace} → ${n.dplace}` : n.bplace ? '* ' + n.bplace : n.dplace ? '† ' + n.dplace : '');
  const tipOf = (n) => [n.title + (n.maiden ? ` (geb. ${n.maiden})` : ''), [n.born && '* ' + n.born + (n.bplace ? ' in ' + n.bplace : ''), n.died && '† ' + n.died + (n.dplace ? ' in ' + n.dplace : ''), ageOf(n.born, n.died) !== null ? `Alter: ${ageOf(n.born, n.died)}` : ''].filter(Boolean).join(', ')].filter(Boolean).join('\n');

  function layout(tree) {
    const all = [...tree.nodes.map((n) => ({ ...n, id: n.slug })), ...tree.ghosts.map((g) => ({ ...g }))];
    const byId = new Map(all.map((n) => [n.id, n]));
    const childrenOf = new Map(), parentsOf = new Map();
    for (const [p, c] of tree.edges) { (childrenOf.get(p) || childrenOf.set(p, []).get(p)).push(c); (parentsOf.get(c) || parentsOf.set(c, []).get(c)).push(p); }
    for (const g of tree.ghosts) { (childrenOf.get(g.id) || childrenOf.set(g.id, []).get(g.id)).push(g.forSlug); (parentsOf.get(g.forSlug) || parentsOf.set(g.forSlug, []).get(g.forSlug)).push(g.id); }
    const rows = new Map();
    for (const n of all) (rows.get(n.gen) || rows.set(n.gen, []).get(n.gen)).push(n);
    const gens = [...rows.keys()].sort((a, b) => a - b);
    const step = W + GX;
    // Generation 0: Geschwister – Ich – Partner
    const order0 = (rows.get(0) || []).sort((a, b) => (({ relative: -1, sibling: 0, root: 1, partner: 2 }[a.kind] ?? 0) - ({ relative: -1, sibling: 0, root: 1, partner: 2 }[b.kind] ?? 0)));
    order0.forEach((n, i) => { n.x = i * step; });
    const spread = (list) => { list.sort((a, b) => a.x - b.x); for (let i = 1; i < list.length; i++) if (list[i].x < list[i - 1].x + step) list[i].x = list[i - 1].x + step; };
    const mean = (ids) => { const xs = ids.map((i) => byId.get(i)).filter((n) => n && n.x !== undefined).map((n) => n.x); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined; };
    for (const g of gens.filter((x) => x < 0).sort((a, b) => b - a)) { // von unten nach oben
      const list = rows.get(g);
      for (const n of list) n.x = mean(childrenOf.get(n.id) || []);
      for (const n of list) if (n.x === undefined) { // ohne Kinder: neben ein Geschwister setzen, sonst ans Ende
        const sib = list.find((m) => m !== n && m.x !== undefined && (parentsOf.get(m.id) || []).some((p) => (parentsOf.get(n.id) || []).includes(p)));
        const placed = list.filter((m) => m.x !== undefined);
        n.x = sib ? sib.x + 1 : (placed.length ? Math.max(...placed.map((m) => m.x)) + step : 0);
      }
      // Paare (Elternteile desselben Kindes) eng nebeneinander legen
      spread(list);
    }
    for (const g of gens.filter((x) => x > 0).sort((a, b) => a - b)) {
      const list = rows.get(g);
      for (const n of list) { const m = mean(parentsOf.get(n.id) || []); n.x = m === undefined ? 0 : m; }
      spread(list);
    }
    const minX = Math.min(...all.map((n) => n.x)), maxX = Math.max(...all.map((n) => n.x));
    const g0 = gens[0];
    for (const n of all) { n.px = PAD + n.x - minX; n.py = PAD + (n.gen - g0) * (H + GY); }
    return { all, byId, width: PAD * 2 + (maxX - minX) + W, height: PAD * 2 + (gens[gens.length - 1] - g0) * (H + GY) + H };
  }

  const nodeText = (n, sub) => {
    const L = [{ t: trunc(n.title, 17), c: 'ft-name' }];
    if (n.maiden) L.push({ t: trunc('geb. ' + n.maiden, 21), c: 'ft-sub ft-maiden' });
    if (sub) L.push({ t: sub, c: 'ft-sub' });
    const pl = placeLine(n); if (pl) L.push({ t: trunc(pl, 21), c: 'ft-sub ft-place' });
    const Y = { 1: [36], 2: [24, 42], 3: [24, 42, 56], 4: [17, 31, 45, 59] }[L.length];
    return L.map((l, i) => `<text x="${W / 2}" y="${Y[i]}" text-anchor="middle" class="${l.c}">${esc(l.t)}</text>`).join('');
  };
  const PHDEF = '<defs><clipPath id="ftc" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath></defs>';
  const phEl = (n) => (n.photo ? `<g class="ft-ph"><image href="${esc(M.fileUrl(n.photo))}" x="-12" y="-12" width="34" height="34" clip-path="url(#ftc)" preserveAspectRatio="xMidYMid slice"/><circle class="ft-phr" cx="5" cy="5" r="17"/></g>` : '');
  function treeSVG(tree, nodeHref) {
    const L = layout(tree);
    const paths = tree.edges.map(([p, c]) => [L.byId.get(p), L.byId.get(c)]).concat(tree.ghosts.map((g) => [L.byId.get(g.id), L.byId.get(g.forSlug)]))
      .filter(([a, b]) => a && b)
      .map(([a, b]) => { const x1 = a.px + W / 2, y1 = a.py + H, x2 = b.px + W / 2, y2 = b.py, my = (y1 + y2) / 2; return `<path class="ft-edge${a.kind === 'ghost' ? ' ft-edge-ghost' : ''}" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`; }).join('');
    const adj = (a, b) => a && b && a.py === b.py && Math.abs(a.px - b.px) < W + GX + 1;
    const exLines = L.all.filter((n) => n.kind === 'partner' && n.ex).map((n) => { const left = L.all.filter((m) => m.py === n.py && m.px < n.px).sort((a, b) => b.px - a.px)[0]; return left && adj(left, n) && !tree.couples.some(([x, y]) => (x === left.id && y === n.id) || (y === left.id && x === n.id)) ? `<line class="ft-couple ft-ex" x1="${left.px + W}" y1="${n.py + H / 2}" x2="${n.px}" y2="${n.py + H / 2}"/>` : ''; }).join('');
    const couples = exLines + tree.couples.map(([a, b]) => [L.byId.get(a), L.byId.get(b)]).filter(([a, b]) => adj(a, b)).map(([a, b]) => {
      const [l, r] = a.px < b.px ? [a, b] : [b, a]; const y = l.py + H / 2;
      return `<line class="ft-couple" x1="${l.px + W}" y1="${y}" x2="${r.px}" y2="${y}"/><text class="ft-heart" x="${(l.px + W + r.px) / 2}" y="${y + 4}" text-anchor="middle">♥</text>`;
    }).join('');
    const nodes = L.all.map((n) => {
      if (n.kind === 'ghost') return `<g class="ft-node ft-ghost" data-for="${esc(n.forSlug)}" data-role="${esc(n.role)}" transform="translate(${n.px},${n.py})" tabindex="0" role="button" aria-label="${esc(n.title)}"><rect width="${W}" height="${H}" rx="10"/><text x="${W / 2}" y="${H / 2 + 5}" text-anchor="middle">＋ ${esc(n.role)}</text></g>`;
      const sub = lifeLine(n) || ({ sibling: n.half ? 'Halbgeschwister' : 'Geschwister', partner: n.ex ? (n.coParent ? 'Elternteil' : 'Ex-Partner') : 'Partner', descendant: '', ancestor: '', root: 'Ich' }[n.kind] || '');
      const cls = `ft-node ft-${n.kind}${n.gender ? ' ft-' + n.gender : ''}${n.died ? ' ft-dead' : ''}`;
      return `<a href="${nodeHref ? nodeHref(n.slug) : `#/person/${enc(n.slug)}`}" class="${cls}" transform="translate(${n.px},${n.py})"><title>${esc(tipOf(n))}</title><rect width="${W}" height="${H}" rx="10"/>${phEl(n)}${nodeText(n, sub)}</a>`;
    }).join('');
    return `<svg class="ft-svg" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" role="img" aria-label="Stammbaum">${PHDEF}${paths}${couples}${nodes}</svg>`;
  }

  /* ------------------------------------------------------------ Familienkarte */
  const ORDER = ['Partner', 'Ex-Partner', 'Mutter', 'Vater', 'Elternteil'];
  async function familyCard(slug, title, box, opts = {}) {
    let data;
    try { data = await api(`/api/family/${enc(slug)}`); } catch (e) { box.innerHTML = ''; return; }
    const t = data.tree, hasTree = t && t.nodes.length > 1;
    const rel = data.relatives;
    const chips = rel.length ? `<div class="fam-list">${rel.map((r) => `<a class="fam-chip" href="${opts.nodeHref ? opts.nodeHref(r.slug) : `#/person/${enc(r.slug)}`}"><span class="fam-l">${esc(r.label)}</span><span class="fam-n">${esc(r.title)}</span></a>`).join('')}</div>` : '';
    box.innerHTML = `<div class="row-flex"><h2 style="margin:0">👪 Familie</h2><span class="spacer"></span>
        ${opts.nodeHref ? '' : `<a class="btn small" href="#/family?focus=${enc(slug)}" title="Gesamten Stammbaum öffnen">🌳 Stammbaum</a>`}
        <button type="button" class="btn small" data-add="Elternteil">＋ Elternteil</button><button type="button" class="btn small" data-add="Partner">＋ Partner:in</button><button type="button" class="btn small" data-add="Kind">＋ Kind</button><button type="button" class="btn small" data-add="Geschwister">＋ Geschwister</button></div>
      ${hasTree ? `<div class="ft-wrap" tabindex="0">${treeSVG(t, opts.nodeHref)}</div>` : `<p class="muted" style="margin:10px 0 0">Noch keine Familie erfasst. Nutze die Schaltflächen oder im Bearbeiten-Modus „Verwandt?“. Aus Eltern, Kindern und Partnern werden Großeltern, Geschwister, Onkel, Cousins usw. automatisch abgeleitet.</p>`}
      ${chips}`;
    const refresh = async () => { invalidate(); await familyCard(slug, title, box, opts); };
    const run = (fn) => async () => { try { await fn(); await refresh(); } catch (e) { toast(e.message || 'Fehler', 'err'); } };
    const parentsOfMe = () => (t ? t.edges.filter(([, c]) => c === slug).map(([p]) => t.nodes.find((n) => n.slug === p)).filter(Boolean) : []);
    for (const b of $$('[data-add]', box)) b.addEventListener('click', run(async () => {
      const kind = b.dataset.add;
      const label = { Elternteil: 'Elternteil hinzufügen', Partner: 'Partner:in hinzufügen', Kind: 'Kind hinzufügen', Geschwister: 'Bruder oder Schwester hinzufügen' }[kind];
      const name = await askName(`${label} (${title})`); if (!name) return;
      const p = await ensurePerson(name);
      if (p.title === title) throw new Error('Eine Person kann nicht mit sich selbst verwandt sein.');
      if (kind === 'Geschwister') {
        const ps = parentsOfMe();
        if (ps.length) for (const par of ps) await addRelation(await slugOf(p.title), { person: par.title, type: 'Elternteil' });
        else await addRelation(slug, { person: p.title, type: 'Geschwister' });
      } else await addRelation(slug, { person: p.title, type: kind });
      toast(p.created ? `„${p.title}“ angelegt und verknüpft` : 'Verknüpft');
    }));
    for (const g of $$('.ft-ghost', box)) {
      const act = run(async () => {
        const role = g.dataset.role, forSlug = g.dataset.for;
        const name = await askName(`${role} hinzufügen`); if (!name) return;
        const p = await ensurePerson(name, GENDER[role]);
        await addRelation(forSlug, { person: p.title, type: 'Elternteil', role });
        toast(p.created ? `„${p.title}“ angelegt und verknüpft` : 'Verknüpft');
      });
      g.addEventListener('click', act); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    }
  }
  async function slugOf(name) {
    const it = (await getItems(true)).find((i) => i.type === 'person' && (norm(i.title) === norm(name) || (i.aliases || []).some((a) => norm(a) === norm(name))));
    if (!it) throw new Error('Person nicht gefunden');
    return it.slug;
  }

  /** Namensvorschläge für ein Textfeld; multi = kommagetrennte Liste (vorgeschlagen wird der Teil nach dem letzten Komma). */
  function suggest(input, getNames, multi) {
    const host = input.parentElement; host.style.position = 'relative';
    const box = document.createElement('div'); box.className = 'sug'; box.hidden = true; box.setAttribute('role', 'listbox'); host.appendChild(box);
    input.setAttribute('autocomplete', 'off'); input.setAttribute('aria-autocomplete', 'list');
    let list = [], sel = 0;
    const split = () => { const v = input.value; const i = multi ? Math.max(v.lastIndexOf(','), v.lastIndexOf(';')) : -1; return { head: v.slice(0, i + 1), token: v.slice(i + 1).trim() }; };
    const render = () => {
      const { head, token } = split(); const t = norm(token.replace(/\(\s*ex\s*\)\s*$/i, ''));
      const used = new Set(head.split(/[,;]/).map((x) => norm(x.replace(/\(\s*ex\s*\)\s*$/i, ''))).filter(Boolean));
      list = getNames().filter((n) => !used.has(norm(n)) && (!t || norm(n).includes(t)) && norm(n) !== t)
        .sort((a, b) => (norm(a).startsWith(t) ? 0 : 1) - (norm(b).startsWith(t) ? 0 : 1) || a.localeCompare(b, 'de')).slice(0, 8);
      sel = 0; box.hidden = !list.length;
      box.innerHTML = list.map((n, i) => `<div class="sug-i ${i === sel ? 'on' : ''}" role="option" data-i="${i}">${esc(n)}</div>`).join('');
    };
    const pick = (i) => {
      const { head } = split(); const sp = head && !/\s$/.test(head) ? ' ' : '';
      input.value = head + sp + list[i] + (multi ? ', ' : ''); box.hidden = true; input.focus(); input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const mark = () => $$('.sug-i', box).forEach((e, i) => e.classList.toggle('on', i === sel));
    input.addEventListener('input', render); input.addEventListener('focus', render);
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
    input.addEventListener('keydown', (e) => {
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % list.length; mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + list.length) % list.length; mark(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { if (list.length && (e.key === 'Enter' || split().token)) { e.preventDefault(); pick(sel); } }
      else if (e.key === 'Escape') { e.stopPropagation(); box.hidden = true; }
    });
    box.addEventListener('mousedown', (e) => { e.preventDefault(); const t = e.target.closest('.sug-i'); if (t) pick(+t.dataset.i); });
  }

  /* ------------------------------------------------------------ Menüpunkt „Stammbaum“: alle Personen */
  const UW = W + GX; // Breite einer Person inkl. Abstand

  /** Anordnung einer ganzen Familie: Paare bilden Einheiten, Ebenen = Generationen, Reihenfolge per Schwerpunkt-Verfahren. */
  function layoutComp(comp) {
    const byId = new Map(comp.nodes.map((n) => [n.slug, { ...n }]));
    // Einheiten (Paare / Kombinationen) per Union-Find
    const uf = new Map([...byId.keys()].map((k) => [k, k])); const find = (a) => { while (uf.get(a) !== a) { uf.set(a, uf.get(uf.get(a))); a = uf.get(a); } return a; };
    const adjC = new Map([...byId.keys()].map((k) => [k, []]));
    for (const c of comp.couples) { uf.set(find(c.a), find(c.b)); adjC.get(c.a).push(c.b); adjC.get(c.b).push(c.a); }
    const unitsMap = new Map();
    for (const k of byId.keys()) { const r = find(k); (unitsMap.get(r) || unitsMap.set(r, []).get(r)).push(k); }
    const units = [...unitsMap.values()].map((m, i) => {
      // Mitglieder so ordnen, dass Partner nebeneinander stehen (Kette ab dem Mitglied mit den wenigsten Partnern)
      const start = m.slice().sort((x, y) => adjC.get(x).length - adjC.get(y).length || byId.get(x).title.localeCompare(byId.get(y).title, 'de'))[0];
      const order = [], seen = new Set(); const walk = (k) => { if (seen.has(k)) return; seen.add(k); order.push(k); for (const n of adjC.get(k)) walk(n); }; walk(start);
      for (const k of m) walk(k);
      return { id: i, members: order, gen: byId.get(order[0]).gen, w: order.length * UW - GX, x: 0 };
    });
    const unitOf = new Map(); for (const u of units) for (const k of u.members) unitOf.set(k, u);
    for (const u of units) { u.up = new Set(); u.down = new Set(); }
    for (const [p, c] of comp.edges) { const up = unitOf.get(p), uc = unitOf.get(c); if (up !== uc) { up.down.add(uc); uc.up.add(up); } }
    const maxGen = Math.max(...units.map((u) => u.gen));
    const layers = Array.from({ length: maxGen + 1 }, () => []); for (const u of units) layers[u.gen].push(u);
    layers[0].sort((a, b) => byId.get(a.members[0]).title.localeCompare(byId.get(b.members[0]).title, 'de'));
    const idx = new Map(); const reindex = () => layers.forEach((l) => l.forEach((u, i) => idx.set(u, i)));
    reindex();
    const bary = (u, set) => { const l = [...set]; return l.length ? l.reduce((s, x) => s + idx.get(x), 0) / l.length : null; };
    const sortLayer = (l, which) => { const keyed = l.map((u, i) => ({ u, i, k: bary(u, u[which]) })); keyed.sort((a, b) => (a.k === null || b.k === null ? a.i - b.i : a.k - b.k || a.i - b.i)); const out = keyed.map((x) => x.u); l.splice(0, l.length, ...out); };
    for (let sweep = 0; sweep < 6; sweep++) {
      for (let g = 1; g <= maxGen; g++) { sortLayer(layers[g], 'up'); reindex(); }
      for (let g = maxGen - 1; g >= 0; g--) { sortLayer(layers[g], 'down'); reindex(); }
    }
    // x-Positionen: abwechselnd nach Eltern bzw. Kindern ausrichten, dann Abstände erzwingen
    const spread = (l) => { for (let i = 0; i < l.length; i++) { const min = i ? l[i - 1].x + l[i - 1].w + GX : 0; if (l[i].x < min) l[i].x = min; } };
    layers.forEach((l) => { let x = 0; for (const u of l) { u.x = x; x += u.w + GX; } });
    const center = (u) => u.x + u.w / 2;
    for (let it = 0; it < 8; it++) {
      for (let g = 1; g <= maxGen; g++) { for (const u of layers[g]) if (u.up.size) u.x = [...u.up].reduce((s, p) => s + center(p), 0) / u.up.size - u.w / 2; spread(layers[g]); }
      for (let g = maxGen - 1; g >= 0; g--) { for (const u of layers[g]) if (u.down.size) u.x = [...u.down].reduce((s, c) => s + center(c), 0) / u.down.size - u.w / 2; spread(layers[g]); }
    }
    const minX = Math.min(...units.map((u) => u.x)); let maxX = 0;
    for (const u of units) { u.members.forEach((k, i) => { const n = byId.get(k); n.px = PAD + u.x - minX + i * UW; n.py = PAD + n.gen * (H + GY); maxX = Math.max(maxX, n.px + W); }); }
    return { byId, width: maxX + PAD, height: PAD * 2 + maxGen * (H + GY) + H };
  }

  function compSVG(comp) {
    const L = layoutComp(comp), nd = (k) => L.byId.get(k);
    const mid = new Map(); // Paar nebeneinander → Mittelpunkt, von dem aus gemeinsame Kinder abgehen
    const lines = [], hearts = [];
    for (const c of comp.couples) {
      const a = nd(c.a), b = nd(c.b); if (!a || !b || a.py !== b.py) continue;
      const [l, r] = a.px < b.px ? [a, b] : [b, a];
      if (Math.abs(r.px - l.px) > UW + 1) continue; // nicht benachbart: keine Linie
      const y = l.py + H / 2; lines.push(`<line class="ft-couple${c.ex ? ' ft-ex' : ''}" x1="${l.px + W}" y1="${y}" x2="${r.px}" y2="${y}"/>`);
      if (!c.ex && c.kind === 'partner') hearts.push(`<text class="ft-heart" x="${(l.px + W + r.px) / 2}" y="${y + 4}" text-anchor="middle">♥</text>`);
      mid.set(pairKey(c.a, c.b), { x: (l.px + W + r.px) / 2, y });
    }
    const parentsOf = new Map(); for (const [p, c] of comp.edges) (parentsOf.get(c) || parentsOf.set(c, []).get(c)).push(p);
    const paths = [];
    const curve = (x1, y1, x2, y2) => { const my = (y1 + y2) / 2; return `<path class="ft-edge" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`; };
    for (const [c, ps] of parentsOf) {
      const ch = nd(c); if (!ch) continue;
      const m = ps.length === 2 ? mid.get(pairKey(ps[0], ps[1])) : null;
      if (m) paths.push(curve(m.x, m.y, ch.px + W / 2, ch.py));
      else for (const p of ps) { const pn = nd(p); paths.push(curve(pn.px + W / 2, pn.py + H, ch.px + W / 2, ch.py)); }
    }
    const nodes = [...L.byId.values()].map((n) => {
      const sub = lifeLine(n);
      return `<a href="#/person/${enc(n.slug)}" class="ft-node ft-full${n.guest ? ' ft-guest' : ''}${n.gender ? ' ft-' + n.gender : ''}${n.died ? ' ft-dead' : ''}" data-slug="${esc(n.slug)}" data-name="${esc(n.title.toLowerCase())}" transform="translate(${n.px},${n.py})"><title>${esc(tipOf(n))}</title><rect width="${W}" height="${H}" rx="10"/>${phEl(n)}${nodeText(n, sub)}</a>`;
    }).join('');
    return { svg: `<g>${PHDEF}${paths.join('')}${lines.join('')}${hearts.join('')}${nodes}</g>`, width: L.width, height: L.height };
  }
  const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

  /* ------------------------------------------------------------ Export: PNG, PDF (ohne Bibliothek) */
  const EXPORT_CSS = '.ft-edge{fill:none;stroke:#b9c0cc;stroke-width:2}.ft-couple{stroke:#6b7280;stroke-width:2}.ft-ex{stroke-dasharray:4 3;opacity:.7}.ft-heart{fill:#d9534f;font-size:10px}.ft-node rect{fill:#fff;stroke:#b9c0cc;stroke-width:1.5}.ft-m rect{fill:#edf3fb}.ft-w rect{fill:#fbeef5}.ft-node text{fill:#1f2430;font:600 12.5px system-ui,Arial,sans-serif}.ft-node .ft-sub{font-weight:400;font-size:11px;fill:#6b7280}.ft-dead text.ft-name{font-style:italic}.ex-title{font:700 18px system-ui,Arial,sans-serif;fill:#1f2430}.ex-note{font:11px system-ui,Arial,sans-serif;fill:#6b7280}';
  function exportSvg(items) { // items: [{name, svg, width, height}] untereinander
    const T = 44; let y = 0, w = 0; const parts = [];
    for (const it of items) { parts.push(`<text class="ex-title" x="16" y="${y + 28}">${esc(it.name)}</text><g transform="translate(0,${y + T})">${it.svg.replace(/<g class="ft-ph">.*?<\/g>/gs, '')}</g>`); y += T + it.height + 12; w = Math.max(w, it.width); }
    w = Math.max(w, 320);
    return { w, h: y + 22, xml: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${y + 22}" viewBox="0 0 ${w} ${y + 22}"><style>${EXPORT_CSS}</style><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}<text class="ex-note" x="16" y="${y + 14}">Memoria · ${new Date().toLocaleDateString('de-DE')}</text></svg>` };
  }
  function rasterize(x, type = 'image/png') {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(new Blob([x.xml], { type: 'image/svg+xml;charset=utf-8' }));
      img.onload = () => {
        const sc = Math.min(2, 7000 / x.w, 7000 / x.h), cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(x.w * sc)); cv.height = Math.max(1, Math.round(x.h * sc));
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        cv.toBlob((b) => (b ? resolve({ blob: b, w: cv.width, h: cv.height }) : reject(new Error('Bild konnte nicht erzeugt werden'))), type, 0.92);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Stammbaum konnte nicht gezeichnet werden')); };
      img.src = url;
    });
  }
  function buildPdf(pages) { // pages: [{ jpeg:Uint8Array, iw, ih }]
    const te = new TextEncoder(), chunks = [], offs = []; let off = 0;
    const push = (x) => { const b = typeof x === 'string' ? te.encode(x) : x; chunks.push(b); off += b.length; };
    const obj = (id, body) => { offs[id] = off; push(`${id} 0 obj\n${body}\nendobj\n`); };
    push('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`);
    pages.forEach((pg, i) => {
      const land = pg.iw >= pg.ih, W0 = land ? 842 : 595, H0 = land ? 595 : 842, m = 24, k = Math.min((W0 - 2 * m) / pg.iw, (H0 - 2 * m) / pg.ih);
      const dw = (pg.iw * k).toFixed(2), dh = (pg.ih * k).toFixed(2), dx = ((W0 - dw) / 2).toFixed(2), dy = ((H0 - dh) / 2).toFixed(2), content = `q ${dw} 0 0 ${dh} ${dx} ${dy} cm /Im0 Do Q`;
      obj(3 + 3 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W0} ${H0}] /Resources << /XObject << /Im0 ${5 + 3 * i} 0 R >> >> /Contents ${4 + 3 * i} 0 R >>`);
      obj(4 + 3 * i, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      offs[5 + 3 * i] = off; push(`${5 + 3 * i} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.iw} /Height ${pg.ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`); push(pg.jpeg); push('\nendstream\nendobj\n');
    });
    const total = 3 * pages.length + 3, xref = off; let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let id = 1; id < total; id++) x += String(offs[id]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(chunks, { type: 'application/pdf' });
  }
  function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  async function exportTree(kind, comps) {
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'png') { const r = await rasterize(exportSvg(comps.map((c) => ({ name: `${c.c.name} (${c.c.nodes.length} Personen)`, svg: c.svg, width: c.width, height: c.height })))); saveBlob(r.blob, `stammbaum-${stamp}.png`); return; }
    const pages = [];
    for (const c of comps) { const r = await rasterize(exportSvg([{ name: `${c.c.name} (${c.c.nodes.length} Personen)`, svg: c.svg, width: c.width, height: c.height }]), 'image/jpeg'); pages.push({ jpeg: new Uint8Array(await r.blob.arrayBuffer()), iw: r.w, ih: r.h }); }
    saveBlob(buildPdf(pages), `stammbaum-${stamp}.pdf`);
  }

  async function familyView(_, q) {
    const app = $('#app');
    const data = await api('/api/family');
    if (!data.total) { app.innerHTML = '<div class="card"><h1>👪 Stammbaum</h1><p class="muted">Lege zuerst Personen an. Dann siehst du hier alle Familien auf einen Blick.</p><a class="btn primary" href="#/people">Zu den Personen</a></div>'; return; }
    const comps = data.families.flatMap((f) => f.parts.map((part, i) => { const c = { ...part, name: f.name + (f.parts.length > 1 ? ` – Teil ${i + 1}` : '') }; return { c, fam: f, ...compSVG(c) }; }));
    app.innerHTML = `<div class="card"><div class="row-flex"><h1 style="margin:0">👪 Stammbaum</h1><span class="spacer"></span>
        <input type="search" id="famFind" list="famNames" placeholder="Person suchen …" style="max-width:220px" autocomplete="off">
        <datalist id="famNames">${[...new Set([...data.components.flatMap((c) => c.nodes.map((n) => n.title)), ...data.loners.map((l) => l.title)])].sort((a, b) => a.localeCompare(b, 'de')).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <label class="sw small-text" title="Erst oben eine Person suchen"><input type="checkbox" id="famAnc"> ⬆ Vorfahren hervorheben</label>
        <span class="zoom"><button type="button" class="btn small" id="exPng" title="Alle Familien als Bild speichern">🖼️ PNG</button><button type="button" class="btn small" id="exPdf" title="Eine Seite je Familie">📄 PDF</button><a class="btn small" id="exGed" href="/api/export/gedcom" download title="Für Ahnenprogramme (Gramps, Ancestry …)">🧬 GEDCOM</a></span>
        <div class="zoom"><button type="button" class="btn small" id="zOut" aria-label="Verkleinern">−</button><button type="button" class="btn small" id="zFit" title="An Breite anpassen">Anpassen</button><button type="button" class="btn small" id="zIn" aria-label="Vergrößern">＋</button></div></div>
        <p class="muted small-text" style="margin:8px 0 0">Alle ${data.total} Personen: ${data.families.length} Familie${data.families.length === 1 ? '' : 'n'} (nach Geburtsnamen)${data.loners.length ? `, ${data.loners.length} ohne Verbindung` : ''}. Gestrichelte Kästchen sind angeheiratet oder gehören zu einer anderen Familie. Ein Klick öffnet die Person. Familien entstehen aus Eltern, Kindern, Partnern und Geschwistern – eintragen im Bearbeiten-Modus unter „Verwandt?“.</p></div>
      ${comps.length ? comps.map((x, i) => `<section class="card ft-comp"><div class="row-flex"><h2 style="margin:0">${esc(x.c.name)} <span class="muted small-text">${x.c.nodes.length} Personen</span></h2></div>
        <div class="ft-wrap ft-big" tabindex="0"><svg class="ft-svg" data-w="${x.width}" data-h="${x.height}" viewBox="0 0 ${x.width} ${x.height}" role="img" aria-label="${esc(x.c.name)}">${x.svg}</svg></div></section>`).join('') : '<div class="card"><p class="muted">Noch keine Beziehungen erfasst. Trage im Bearbeiten-Modus einer Person unter „Verwandt?“ Eltern, Kinder, Partner oder Geschwister ein.</p></div>'}
      ${data.loners.length ? `<section class="card"><h2>Ohne Familienverbindung <span class="muted small-text">${data.loners.length}</span></h2><div class="chips">${data.loners.map((l) => `<a class="tag" data-slug="${esc(l.slug)}" data-name="${esc(l.title.toLowerCase())}" href="#/person/${enc(l.slug)}">${esc(l.title)}</a>`).join('')}</div></section>` : ''}`;

    for (const [id, kind] of [['exPng', 'png'], ['exPdf', 'pdf']]) { const b = $('#' + id); if (!comps.length) { b.hidden = true; continue; } b.addEventListener('click', async () => { b.disabled = true; try { await exportTree(kind, comps); } catch (e) { toast(e.message, 'err'); } b.disabled = false; }); }
    /* Zoom: Standard = an die Breite anpassen (nicht kleiner als 45 %) */
    let scale = 1;
    const svgs = $$('.ft-svg', app);
    const apply = () => svgs.forEach((s) => { s.setAttribute('width', Math.round(+s.dataset.w * scale)); s.setAttribute('height', Math.round(+s.dataset.h * scale)); });
    const fit = () => { const avail = Math.max(280, app.clientWidth - 48); const widest = Math.max(...svgs.map((s) => +s.dataset.w)); scale = Math.max(0.45, Math.min(1, avail / widest)); apply(); };
    if (svgs.length) { fit(); $('#zFit').addEventListener('click', fit); $('#zIn').addEventListener('click', () => { scale = Math.min(2, scale * 1.2); apply(); }); $('#zOut').addEventListener('click', () => { scale = Math.max(0.3, scale / 1.2); apply(); }); }
    else $('.zoom', app).hidden = true;

    /* Suchen / Hervorheben */
    const mark = (term, scroll) => {
      const t = norm(term); let first = null;
      $$('[data-slug]', app).forEach((e) => { const hit = !!t && e.dataset.name.includes(t); e.classList.toggle('ft-hit', hit); if (hit && !first) first = e; });
      if (first && scroll) { const wrap = first.closest('.ft-wrap'); if (wrap && first.ownerSVGElement) { const bb = first.getBoundingClientRect(), wb = wrap.getBoundingClientRect(); wrap.scrollTo({ left: wrap.scrollLeft + (bb.left - wb.left) - wb.width / 2 + bb.width / 2, top: wrap.scrollTop + (bb.top - wb.top) - wb.height / 2, behavior: 'smooth' }); } first.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    };
    $('#famFind').addEventListener('input', (e) => mark(e.target.value, true));

    /* Vorfahren hervorheben (zur gesuchten Person) */
    const parentsMap = new Map();
    for (const c of data.components) for (const [p, ch] of c.edges) (parentsMap.get(ch) || parentsMap.set(ch, []).get(ch)).push(p);
    const ancMark = () => {
      const nodes = $$('a.ft-node[data-slug]', app); nodes.forEach((n) => n.classList.remove('ft-anc', 'ft-dim'));
      const hit = $('a.ft-node.ft-hit[data-slug]', app); if (!$('#famAnc').checked || !hit) return;
      const set = new Set([hit.dataset.slug]), todo = [hit.dataset.slug];
      while (todo.length) { for (const p of parentsMap.get(todo.pop()) || []) if (!set.has(p)) { set.add(p); todo.push(p); } }
      nodes.forEach((n) => n.classList.add(set.has(n.dataset.slug) ? 'ft-anc' : 'ft-dim'));
      toast(set.size > 1 ? `${set.size - 1} Vorfahren hervorgehoben` : 'Keine Vorfahren erfasst');
    };
    $('#famAnc').addEventListener('change', ancMark);
    $('#famFind').addEventListener('input', () => setTimeout(ancMark, 0));

    /* Minikarte bei großen Familien */
    $$('.ft-comp', app).forEach((sec) => {
      const svg = $('.ft-svg', sec), wrap = $('.ft-wrap', sec); if (!svg || !wrap) return;
      const w = +svg.dataset.w, h = +svg.dataset.h; if (w < 1100 && h < 700) return;
      const mw = 150, mh = Math.max(40, Math.min(130, Math.round(mw * h / w))), mini = document.createElement('div');
      mini.className = 'ft-mini'; mini.style.width = mw + 'px'; mini.style.height = mh + 'px'; mini.setAttribute('aria-hidden', 'true');
      const dots = $$('a.ft-node', sec).map((n) => { const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(n.getAttribute('transform') || ''); return m ? `<rect class="n" x="${m[1]}" y="${m[2]}" width="${W}" height="${H}" rx="8"/>` : ''; }).join('');
      mini.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${dots}<rect class="ft-vp" x="0" y="0" width="10" height="10"/></svg>`;
      sec.appendChild(mini);
      const vp = $('.ft-vp', mini);
      const upd = () => { const k = +svg.getAttribute('width') / w || 1; vp.setAttribute('x', wrap.scrollLeft / k); vp.setAttribute('y', wrap.scrollTop / k); vp.setAttribute('width', Math.min(w, wrap.clientWidth / k)); vp.setAttribute('height', Math.min(h, wrap.clientHeight / k)); mini.hidden = wrap.scrollWidth <= wrap.clientWidth + 4 && wrap.scrollHeight <= wrap.clientHeight + 4; };
      wrap.addEventListener('scroll', upd); window.addEventListener('resize', upd); setTimeout(upd, 60);
      $('#zIn', app).addEventListener('click', () => setTimeout(upd, 30)); $('#zOut', app).addEventListener('click', () => setTimeout(upd, 30)); $('#zFit', app).addEventListener('click', () => setTimeout(upd, 30));
      mini.addEventListener('click', (e) => { const r = mini.getBoundingClientRect(), k = +svg.getAttribute('width') / w || 1; wrap.scrollTo({ left: ((e.clientX - r.left) / r.width) * w * k - wrap.clientWidth / 2, top: ((e.clientY - r.top) / r.height) * h * k - wrap.clientHeight / 2, behavior: 'smooth' }); });
    });
    if (q.focus) { const it = (await getItems()).find((i) => i.slug === q.focus && i.type === 'person'); if (it) { $('#famFind').value = it.title; setTimeout(() => mark(it.title, true), 50); } }
  }
  M.routes.push([/^\/family$/, familyView]);

  M.family = { suggest, askName, ensurePerson, addRelation, familyCard, treeSVG, norm, dupDialog };
})();
