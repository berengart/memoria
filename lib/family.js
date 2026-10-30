'use strict';
/**
 * Familie: gespeichert werden nur direkte Beziehungen (Elternteil, Kind, Partner, Geschwister) im Frontmatter
 * der Personen. Alles andere – Großeltern, Onkel, Cousins, Schwager … – wird hier abgeleitet.
 */

const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const G = (v) => { v = String(v || '').toLowerCase(); return ['w', 'f', 'weiblich'].includes(v) ? 'w' : ['m', 'männlich', 'maennlich'].includes(v) ? 'm' : ''; };
const ROLE_G = { mutter: 'w', mama: 'w', vater: 'm', papa: 'm', tochter: 'w', sohn: 'm', schwester: 'w', bruder: 'm' };
const word = (g, w, m, n) => (g === 'w' ? w : g === 'm' ? m : n);
const FAMILY_TYPES = ['Elternteil', 'Kind', 'Partner', 'Ehepartner', 'Geschwister'];

/** Graph aus allen Personen. `override`: { slug, relations } ersetzt die Beziehungen einer Person (für die Prüfung vor dem Speichern). */
function build(vault, override) {
  const nodes = new Map(), parents = new Map(), children = new Map(), partners = new Map(), sibs = new Map();
  const people = [...vault.index.values()].filter((i) => i.type === 'person');
  for (const p of people) {
    nodes.set(p.slug, { slug: p.slug, title: p.title, photo: p.meta.photo || '', gender: G(p.meta.gender), maiden: p.meta.maidenname ? String(p.meta.maidenname).trim() : '', born: p.meta.birthday ? String(p.meta.birthday) : '', bplace: p.meta.birthplace ? String(p.meta.birthplace) : '', dplace: p.meta.deathplace ? String(p.meta.deathplace) : '', died: p.meta.died ? String(p.meta.died) : '', dead: !!(p.meta.died || p.meta.deathplace || p.meta.deceased === true || p.meta.deceased === 'true'), roleGender: '' });
    parents.set(p.slug, new Set()); children.set(p.slug, new Set()); partners.set(p.slug, new Map()); sibs.set(p.slug, new Set());
  }
  const link = (a, b) => { parents.get(b).add(a); children.get(a).add(b); }; // a ist Elternteil von b
  const issues = [];
  for (const p of people) {
    const rels = override && override.slug === p.slug ? override.relations : arr(p.meta.relations);
    for (const r of arr(rels)) {
      const t = vault.resolve(String(r.person || '')); if (!t || t.type !== 'person') continue;
      const type = String(r.type || ''), role = String(r.role || '').toLowerCase();
      if (t.slug === p.slug) { if (FAMILY_TYPES.includes(type)) issues.push(`${p.title} kann nicht mit sich selbst verwandt sein.`); continue; }
      const tn = nodes.get(t.slug);
      if (type === 'Elternteil') { link(t.slug, p.slug); if (ROLE_G[role]) tn.roleGender = ROLE_G[role]; }
      else if (type === 'Kind') { link(p.slug, t.slug); if (ROLE_G[role]) tn.roleGender = ROLE_G[role]; }
      else if (type === 'Partner' || type === 'Ehepartner') { const ex = !!r.ex || role === 'ex'; partners.get(p.slug).set(t.slug, { ex: ex }); if (!partners.get(t.slug).has(p.slug)) partners.get(t.slug).set(p.slug, { ex }); }
      else if (type === 'Geschwister') { sibs.get(p.slug).add(t.slug); sibs.get(t.slug).add(p.slug); if (ROLE_G[role]) tn.roleGender = ROLE_G[role]; }
    }
  }
  for (const n of nodes.values()) n.g = n.gender || n.roleGender;
  return { nodes, parents, children, partners, sibs, issues };
}

/** Prüft vor dem Speichern: keine Selbstbeziehung, kein Zyklus (niemand ist sein eigener Vorfahre). */
function validate(vault, slug, relations) {
  const g = build(vault, { slug, relations });
  if (g.issues.length) return g.issues[0];
  const seen = new Set(), stack = new Set();
  const visit = (s) => {
    if (stack.has(s)) return true; if (seen.has(s)) return false;
    seen.add(s); stack.add(s);
    for (const c of g.children.get(s) || []) if (visit(c)) return true;
    stack.delete(s); return false;
  };
  if (g.nodes.has(slug) && visit(slug)) return 'Diese Eltern-Kind-Beziehungen ergeben einen Kreis – jemand wäre sein eigener Vorfahre.';
  for (const s of g.nodes.keys()) if (!seen.has(s) && visit(s)) return 'Diese Eltern-Kind-Beziehungen ergeben einen Kreis – jemand wäre sein eigener Vorfahre.';
  return null;
}

const siblingsOf = (g, s) => {
  const out = new Map(); // slug → 'voll' | 'halb'
  const ps = g.parents.get(s) || new Set();
  for (const p of ps) for (const c of g.children.get(p) || []) if (c !== s) out.set(c, true);
  for (const x of g.sibs.get(s) || []) if (x !== s) out.set(x, true);
  const res = new Map();
  for (const c of out.keys()) {
    const pc = g.parents.get(c) || new Set();
    const extraS = [...ps].some((p) => !pc.has(p)), extraC = [...pc].some((p) => !ps.has(p));
    res.set(c, extraS && extraC ? 'halb' : 'voll');
  }
  return res;
};

const ur = (n) => (n > 0 ? 'Ur' + 'ur'.repeat(n - 1) : '');
const ancLabel = (n, g) => {
  if (n === 1) return word(g, 'Mutter', 'Vater', 'Elternteil');
  const pre = n === 2 ? 'Groß' : ur(n - 2) + 'groß';
  return word(g, pre + 'mutter', pre + 'vater', pre + 'eltern');
};
const descLabel = (n, g) => {
  if (n === 1) return word(g, 'Tochter', 'Sohn', 'Kind');
  const pre = n === 2 ? '' : ur(n - 2);
  const base = pre ? word(g, 'enkelin', 'enkel', 'enkelkind') : word(g, 'Enkelin', 'Enkel', 'Enkelkind');
  return pre + base;
};
const sideLabel = (first) => (first && first.g === 'w' ? ' (mütterlicherseits)' : first && first.g === 'm' ? ' (väterlicherseits)' : '');

/** Alle Verwandten einer Person mit Bezeichnung. */
function relatives(vault, slug, opts = {}) {
  const g = build(vault);
  const me = g.nodes.get(slug); if (!me) return { relatives: [], tree: null, issues: [] };
  const out = new Map(); // slug → { label, rank }
  const add = (s, label, rank) => { if (s === slug || !g.nodes.has(s)) return; const o = out.get(s); if (!o || rank < o.rank) out.set(s, { label, rank }); };
  const gn = (s) => g.nodes.get(s).g;

  // Vorfahren (bis 6 Generationen) mit Seite
  const anc = new Map(); // slug → { gen, first }
  let level = [...g.parents.get(slug)].map((p) => ({ s: p, first: g.nodes.get(p) }));
  for (let n = 1; n <= 6 && level.length; n++) {
    const next = [];
    for (const { s, first } of level) {
      if (anc.has(s) || s === slug) continue;
      anc.set(s, { gen: n, first });
      add(s, ancLabel(n, gn(s)) + (n >= 2 ? sideLabel(first) : ''), 10 + n);
      for (const p of g.parents.get(s) || []) next.push({ s: p, first });
    }
    level = next;
  }
  // Nachkommen
  const desc = new Map();
  let dl = [...g.children.get(slug)];
  for (let n = 1; n <= 6 && dl.length; n++) {
    const next = [];
    for (const s of dl) { if (desc.has(s) || s === slug) continue; desc.set(s, n); add(s, descLabel(n, gn(s)), 20 + n); for (const c of g.children.get(s) || []) next.push(c); }
    dl = next;
  }
  // Geschwister, Nichten/Neffen
  const sib = siblingsOf(g, slug);
  for (const [s, kind] of sib) {
    add(s, (kind === 'halb' ? 'Halb' : '') + (kind === 'halb' ? word(gn(s), 'schwester', 'bruder', 'geschwister') : word(gn(s), 'Schwester', 'Bruder', 'Geschwister')), 5);
    for (const c of g.children.get(s) || []) add(c, word(gn(c), 'Nichte', 'Neffe', 'Nichte/Neffe'), 30);
    for (const [pt, info] of g.partners.get(s) || []) if (!info.ex) add(pt, word(gn(pt), 'Schwägerin', 'Schwager', 'Schwager/Schwägerin'), 40);
  }
  // Onkel/Tante, Großonkel …, Cousins
  for (const [a, { gen, first }] of anc) {
    if (gen > 3) continue;
    for (const [s] of siblingsOf(g, a)) {
      if (anc.has(s)) continue;
      const pre = gen === 1 ? '' : gen === 2 ? 'Groß' : 'Urgroß';
      add(s, (gen === 1 ? word(gn(s), 'Tante', 'Onkel', 'Onkel/Tante') : pre + word(gn(s), 'tante', 'onkel', 'onkel/-tante')) + sideLabel(first), 25 + gen);
      for (const [pt, info] of g.partners.get(s) || []) if (!info.ex && !anc.has(pt)) add(pt, (gen === 1 ? word(gn(pt), 'Tante', 'Onkel', 'Onkel/Tante') : pre + word(gn(pt), 'tante', 'onkel', 'onkel/-tante')) + ' (angeheiratet)' + sideLabel(first), 45 + gen);
      if (gen === 1) for (const c of g.children.get(s) || []) add(c, word(gn(c), 'Cousine', 'Cousin', 'Cousin/Cousine') + sideLabel(first), 32);
    }
  }
  // Partner und angeheiratete Verwandte
  for (const [pt, info] of g.partners.get(slug)) {
    add(pt, info.ex ? 'Ex-Partner' : 'Partner', 1);
    if (info.ex) continue;
    for (const p of g.parents.get(pt) || []) add(p, word(gn(p), 'Schwiegermutter', 'Schwiegervater', 'Schwiegereltern'), 50);
    for (const [s] of siblingsOf(g, pt)) add(s, word(gn(s), 'Schwägerin', 'Schwager', 'Schwager/Schwägerin'), 51);
    for (const c of g.children.get(pt) || []) if (!g.children.get(slug).has(c)) add(c, word(gn(c), 'Stieftochter', 'Stiefsohn', 'Stiefkind'), 52);
  }
  for (const c of g.children.get(slug)) for (const [pt, info] of g.partners.get(c) || []) if (!info.ex) add(pt, word(gn(pt), 'Schwiegertochter', 'Schwiegersohn', 'Schwiegerkind'), 53);
  for (const p of g.parents.get(slug)) for (const [pt] of g.partners.get(p) || []) if (!g.parents.get(slug).has(pt)) add(pt, word(gn(pt), 'Stiefmutter', 'Stiefvater', 'Stiefelternteil'), 54);

  const list = [...out].map(([s, o]) => { const n = g.nodes.get(s); return { slug: s, title: n.title, photo: n.photo, label: o.label, rank: o.rank }; })
    .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title, 'de'));
  return { relatives: list.map(({ rank, ...x }) => x), tree: tree(g, slug, anc, desc, sib, opts), issues: g.issues };
}

/** Datenbasis für die Baumzeichnung: Vorfahren (3 Generationen), Geschwister, Partner, Nachkommen (2 Generationen), Platzhalter. */
function tree(g, slug, anc, desc, sib, opts = {}) {
  const UP = Math.min(6, Math.max(1, +opts.up || 3)), DOWN = Math.min(5, Math.max(1, +opts.down || 2));
  const nodes = new Map(), edges = [], couples = [];
  const put = (s, gen, kind, extra) => { if (!nodes.has(s)) { const n = g.nodes.get(s); nodes.set(s, { slug: s, title: n.title, photo: n.photo, maiden: n.maiden, gender: n.g, born: n.born, died: n.died, dead: n.dead, bplace: n.bplace, dplace: n.dplace, gen, kind, ...extra }); } };
  put(slug, 0, 'root');
  const ghosts = [];
  const addParents = (s, gen) => {
    const ps = [...g.parents.get(s)];
    for (const p of ps) { if (gen - 1 >= -UP) { put(p, gen - 1, 'ancestor'); edges.push([p, s]); } }
    if (ps.length > 1) for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) couples.push([ps[i], ps[j]]);
    if (gen > -2 && ps.length < 2) { // fehlende Eltern als Platzhalter anbieten
      const have = ps.map((p) => g.nodes.get(p).g);
      const missing = ['Mutter', 'Vater'].filter((r) => !have.includes(r === 'Mutter' ? 'w' : 'm')).slice(0, 2 - ps.length);
      for (const role of missing) ghosts.push({ id: `ghost:${s}:${role}`, slug: null, title: role + ' hinzufügen', gen: gen - 1, kind: 'ghost', forSlug: s, role });
    }
    for (const p of ps) if (gen - 1 > -UP) addParents(p, gen - 1);
  };
  addParents(slug, 0);
  for (const s of sib.keys()) { put(s, 0, 'sibling', { half: sib.get(s) === 'halb' }); for (const p of g.parents.get(s)) if (nodes.has(p)) edges.push([p, s]); }
  for (const [pt, info] of g.partners.get(slug)) { put(pt, 0, 'partner', { ex: info.ex }); couples.push([slug, pt]); }
  const addKids = (s, gen) => {
    if (gen > DOWN) return;
    for (const c of g.children.get(s)) {
      put(c, gen, 'descendant'); edges.push([s, c]);
      for (const p of g.parents.get(c)) if (!nodes.has(p) && gen === 1) { put(p, 0, 'partner', { ex: true, coParent: true }); edges.push([p, c]); couples.push([slug, p]); } else if (nodes.has(p) && p !== s) edges.push([p, c]);
      addKids(c, gen + 1);
    }
  };
  addKids(slug, 1);
  if (opts.wide) { // Onkel/Tanten, Großonkel … und deren Nachkommen (Cousins) bis zur eigenen Generation
    const spread = (s, gen) => { for (const c of g.children.get(s)) { if (gen > 0) return; put(c, gen, 'relative'); for (const p of g.parents.get(c)) if (nodes.has(p)) edges.push([p, c]); spread(c, gen + 1); } };
    for (const a of [...nodes.values()].filter((n) => n.kind === 'ancestor')) {
      for (const [sb] of siblingsOf(g, a.slug)) {
        if (nodes.has(sb)) continue;
        put(sb, a.gen, 'relative'); for (const p of g.parents.get(sb)) if (nodes.has(p)) edges.push([p, sb]);
        for (const [pt, info] of g.partners.get(sb)) if (!nodes.has(pt)) { put(pt, a.gen, 'relative', { ex: info.ex }); couples.push([sb, pt]); }
        spread(sb, a.gen + 1);
      }
    }
  }
  const uniq = (list) => { const seen = new Set(); return list.filter((e) => { const k = e.slice().sort().join('|'); return seen.has(k) ? false : seen.add(k); }); };
  const eKey = new Set(); const E = edges.filter((e) => { const k = e.join('>'); return eKey.has(k) ? false : eKey.add(k); });
  return { root: slug, nodes: [...nodes.values()], ghosts, edges: E, couples: uniq(couples) };
}

/** Alle Personen, die irgendwie in einer Familie vorkommen (für die Auswahl der Stammbaum-Ansicht). */
function overview(vault) {
  const g = build(vault);
  const members = [...g.nodes.values()].filter((n) => g.parents.get(n.slug).size || g.children.get(n.slug).size || g.partners.get(n.slug).size || g.sibs.get(n.slug).size);
  const seen = new Set(), groups = [];
  for (const m of members) { // zusammenhängende Familien
    if (seen.has(m.slug)) continue;
    const comp = [], stack = [m.slug]; seen.add(m.slug);
    while (stack.length) { const c = stack.pop(); comp.push(c); for (const nb of [...g.parents.get(c), ...g.children.get(c), ...g.partners.get(c).keys(), ...g.sibs.get(c)]) if (!seen.has(nb) && g.nodes.has(nb)) { seen.add(nb); stack.push(nb); } }
    groups.push(comp);
  }
  return {
    people: members.map((n) => ({ slug: n.slug, title: n.title, born: n.born, n: g.parents.get(n.slug).size + g.children.get(n.slug).size })).sort((a, b) => a.title.localeCompare(b.title, 'de')),
    groups: groups.map((c) => { const best = c.map((s) => g.nodes.get(s)).sort((a, b) => (g.parents.get(a.slug).size === 0 ? -1 : 1) - (g.parents.get(b.slug).size === 0 ? -1 : 1) || b.title.localeCompare(a.title))[0]; return { size: c.length, root: best.slug, title: best.title }; }).sort((a, b) => b.size - a.size),
  };
}

/** Gesamter Stammbaum: alle Personen, in zusammenhängende Familien gruppiert, mit Generation je Person. */
function forest(vault) {
  const g = build(vault);
  const slugs = [...g.nodes.keys()];
  const uf = new Map(slugs.map((s) => [s, s]));
  const find = (a) => { while (uf.get(a) !== a) { uf.set(a, uf.get(uf.get(a))); a = uf.get(a); } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) uf.set(a, b); };
  const pk = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const pairs = new Map(); // Paare in derselben Generation
  const edges = [];
  for (const [p, cs] of g.children) for (const c of cs) { edges.push([p, c]); union(p, c); }
  for (const [a, m] of g.partners) for (const [b, info] of m) { if (!pairs.has(pk(a, b))) pairs.set(pk(a, b), { a, b, ex: !!info.ex, kind: 'partner' }); union(a, b); }
  for (const [, ps] of g.parents) { const l = [...ps]; for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (!pairs.has(pk(l[i], l[j]))) pairs.set(pk(l[i], l[j]), { a: l[i], b: l[j], ex: false, kind: 'coparent' }); }
  const sibPairs = [];
  for (const [a, set] of g.sibs) for (const b of set) if (a < b) { sibPairs.push([a, b]); union(a, b); }
  // Generationen: Kinder eine Ebene unter den Eltern, Paare und Geschwister auf gleicher Ebene
  const gen = new Map(slugs.map((s) => [s, 0]));
  const equal = [...pairs.values()].map((p) => [p.a, p.b]).concat(sibPairs);
  for (let it = 0; it < slugs.length * 3 + 5; it++) {
    let ch = false;
    for (const [p, c] of edges) if (gen.get(c) < gen.get(p) + 1) { gen.set(c, gen.get(p) + 1); ch = true; }
    for (const [a, b] of equal) { const m = Math.max(gen.get(a), gen.get(b)); if (gen.get(a) !== m || gen.get(b) !== m) { gen.set(a, m); gen.set(b, m); ch = true; } }
    if (!ch) break;
  }
  const groups = new Map();
  for (const s of slugs) { const r = find(s); (groups.get(r) || groups.set(r, []).get(r)).push(s); }
  const comps = [], loners = [];
  for (const members of groups.values()) {
    if (members.length === 1) { const n = g.nodes.get(members[0]); loners.push({ slug: n.slug, title: n.title, photo: n.photo }); continue; }
    const set = new Set(members), min = Math.min(...members.map((s) => gen.get(s)));
    const nodes = members.map((s) => { const n = g.nodes.get(s); return { slug: s, title: n.title, photo: n.photo, maiden: n.maiden, gender: n.g, born: n.born, died: n.died, dead: n.dead, bplace: n.bplace, dplace: n.dplace, gen: gen.get(s) - min }; })
      .sort((a, b) => a.gen - b.gen || a.title.localeCompare(b.title, 'de'));
    const surname = (t) => String(t).trim().split(/\s+/).slice(-1)[0];
    comps.push({
      name: 'Familie ' + (() => { const c = {}; for (const n of nodes) { const x = surname(n.title); c[x] = (c[x] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; })(), nodes,
      edges: edges.filter(([p, c]) => set.has(p) && set.has(c)),
      couples: [...pairs.values()].filter((p) => set.has(p.a)), sibs: sibPairs.filter(([a]) => set.has(a)),
    });
  }
  comps.sort((a, b) => b.nodes.length - a.nodes.length || a.name.localeCompare(b.name, 'de'));

  // Familien nach Geburtsnamen (Mädchenname, sonst Nachname): eigene Mitglieder + deren Partner, Eltern und Kinder.
  const surnameOf = (n) => { const t = String(n.maiden || n.title).trim(); return t.split(/\s+/).slice(-1)[0] || t; };
  const keyOf = (n) => surnameOf(n).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');
  const fam = new Map();
  for (const n of g.nodes.values()) { const k = keyOf(n); (fam.get(k) || fam.set(k, { spell: new Map(), own: new Set() }).get(k)).own.add(n.slug); const sp = surnameOf(n); const f = fam.get(k); f.spell.set(sp, (f.spell.get(sp) || 0) + 1); }
  const withRel = (s) => g.parents.get(s).size + g.children.get(s).size + g.partners.get(s).size + g.sibs.get(s).size > 0;
  const families = [];
  for (const [key, f] of fam) {
    const set = new Set();
    for (const s of f.own) { if (!withRel(s)) continue; set.add(s); for (const x of [...g.parents.get(s), ...g.children.get(s), ...g.partners.get(s).keys(), ...g.sibs.get(s)]) set.add(x); }
    if (set.size < 2) continue;
    const name = [...f.spell].sort((a, b) => b[1] - a[1])[0][0];
    // zusammenhängende Teile innerhalb der Familie
    const seen = new Set(), parts = [];
    for (const start of set) {
      if (seen.has(start)) continue;
      const comp = [], st = [start]; seen.add(start);
      while (st.length) { const c = st.pop(); comp.push(c); for (const nb of [...g.parents.get(c), ...g.children.get(c), ...g.partners.get(c).keys(), ...g.sibs.get(c)]) if (set.has(nb) && !seen.has(nb)) { seen.add(nb); st.push(nb); } }
      if (comp.length < 2) continue;
      const cs = new Set(comp), min = Math.min(...comp.map((x) => gen.get(x)));
      parts.push({
        nodes: comp.map((x) => { const n = g.nodes.get(x); return { slug: x, title: n.title, photo: n.photo, maiden: n.maiden, gender: n.g, born: n.born, died: n.died, dead: n.dead, bplace: n.bplace, dplace: n.dplace, gen: gen.get(x) - min, guest: !f.own.has(x) }; }).sort((a, b) => a.gen - b.gen || a.title.localeCompare(b.title, 'de')),
        edges: edges.filter(([p, c]) => cs.has(p) && cs.has(c)), couples: [...pairs.values()].filter((p) => cs.has(p.a) && cs.has(p.b)), sibs: sibPairs.filter(([a, b]) => cs.has(a) && cs.has(b)),
      });
    }
    if (!parts.length) continue;
    parts.sort((a, b) => b.nodes.length - a.nodes.length);
    families.push({ key, name: 'Familie ' + name, own: [...f.own].filter(withRel).length, parts, nodes: parts.flatMap((p) => p.nodes), edges: parts.flatMap((p) => p.edges), couples: parts.flatMap((p) => p.couples) });
  }
  families.sort((a, b) => b.own - a.own || a.name.localeCompare(b.name, 'de'));
  loners.sort((a, b) => a.title.localeCompare(b.title, 'de'));
  return { components: comps, families, loners, total: slugs.length, issues: g.issues };
}

module.exports = { build, validate, relatives, overview, forest, FAMILY_TYPES };
