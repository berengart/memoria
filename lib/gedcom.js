'use strict';
/** GEDCOM-5.5.1-Export des Stammbaums (lässt sich in Ahnenprogramme wie Gramps oder Ancestry importieren). */
const family = require('./family');
const { parseBirthday } = require('./insights');

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function gedDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  const y = s.match(/^(\d{4})$/); if (y) return y[1];
  const b = parseBirthday(s); if (!b || b.m < 1 || b.m > 12) return '';
  return `${b.d} ${MON[b.m - 1]}${b.y ? ' ' + b.y : ''}`;
}
const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim();

function gedcom(vault) {
  const g = family.build(vault);
  const L = ['0 HEAD', '1 SOUR Memoria', '2 NAME Memoria', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8', `1 DATE ${gedDate(new Date().toISOString().slice(0, 10))}`];
  const ids = new Map([...g.nodes.keys()].map((s, i) => [s, 'I' + (i + 1)]));
  // Familien: je Elternpaar (bzw. Einzelelternteil) eine Familie, dazu Paare ohne Kinder
  const fams = new Map(); let n = 0;
  const fam = (parents) => {
    const key = parents.slice().sort().join('|');
    if (!fams.has(key)) fams.set(key, { id: 'F' + (++n), parents: parents.slice().sort(), kids: [], ex: false });
    return fams.get(key);
  };
  for (const [child, ps] of g.parents) {
    const list = [...ps]; if (!list.length) continue;
    if (list.length === 1) fam(list).kids.push(child);
    else { fam(list.slice(0, 2)).kids.push(child); for (const extra of list.slice(2)) fam([extra]).kids.push(child); }
  }
  for (const [a, m] of g.partners) for (const [b, info] of m) { const f = fam([a, b]); if (info.ex) f.ex = true; }
  const famsOf = new Map(), famc = new Map();
  for (const f of fams.values()) { for (const p of f.parents) (famsOf.get(p) || famsOf.set(p, []).get(p)).push(f.id); for (const k of f.kids) (famc.get(k) || famc.set(k, []).get(k)).push(f.id); }
  for (const [slug, node] of g.nodes) {
    const parts = clean(node.title).split(/\s+/); const sur = parts.length > 1 ? parts.pop() : '';
    L.push(`0 @${ids.get(slug)}@ INDI`, `1 NAME ${parts.join(' ')} /${sur}/`);
    if (parts.length) L.push(`2 GIVN ${parts.join(' ')}`); if (sur) L.push(`2 SURN ${sur}`);
    if (node.maiden) L.push(`1 NAME ${parts.join(' ')} /${clean(node.maiden)}/`, '2 TYPE birth', `2 SURN ${clean(node.maiden)}`);
    if (node.g) L.push(`1 SEX ${node.g === 'w' ? 'F' : 'M'}`);
    const bd = gedDate(node.born), bp = clean(node.bplace);
    if (bd || bp) { L.push('1 BIRT'); if (bd) L.push(`2 DATE ${bd}`); if (bp) L.push(`2 PLAC ${bp}`); }
    const dd = gedDate(node.died), dp = clean(node.dplace);
    if (dd || dp || node.died || node.dead) { L.push('1 DEAT' + (dd || dp ? '' : ' Y')); if (dd) L.push(`2 DATE ${dd}`); if (dp) L.push(`2 PLAC ${dp}`); }
    for (const f of famc.get(slug) || []) L.push(`1 FAMC @${f}@`);
    for (const f of famsOf.get(slug) || []) L.push(`1 FAMS @${f}@`);
  }
  for (const f of fams.values()) {
    L.push(`0 @${f.id}@ FAM`);
    const [a, b] = f.parents; const na = g.nodes.get(a), nb = b && g.nodes.get(b);
    let husb = a, wife = b;
    if (nb && ((na.g === 'w' && nb.g !== 'w') || (nb.g === 'm' && na.g !== 'm'))) { husb = b; wife = a; }
    else if (!nb && na.g === 'w') { husb = null; wife = a; }
    if (husb) L.push(`1 HUSB @${ids.get(husb)}@`); if (wife) L.push(`1 WIFE @${ids.get(wife)}@`);
    for (const k of f.kids) L.push(`1 CHIL @${ids.get(k)}@`);
    if (f.ex) L.push('1 DIV Y');
  }
  L.push('0 TRLR');
  return L.join('\r\n') + '\r\n';
}
module.exports = { gedcom };
