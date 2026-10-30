'use strict';
/** Kleiner Zwischenspeicher für Adress-Suchen (spart Anfragen an Nominatim; Tagebuch-Orte werden so nur einmal gesucht). */
const fs = require('fs');
const path = require('path');

const caches = new Map();
function load(file) {
  if (caches.has(file)) return caches.get(file);
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* neu */ }
  const c = { file, data, timer: null };
  caches.set(file, c);
  return c;
}
const key = (q) => String(q || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 300);
function save(c) {
  if (c.timer) return;
  c.timer = setTimeout(() => {
    c.timer = null;
    const keys = Object.keys(c.data);
    if (keys.length > 5000) for (const k of keys.slice(0, keys.length - 5000)) delete c.data[k];
    try { fs.writeFileSync(c.file + '.tmp', JSON.stringify(c.data), { mode: 0o600 }); fs.renameSync(c.file + '.tmp', c.file); } catch (e) { /* egal */ }
  }, 500);
  if (c.timer.unref) c.timer.unref();
}
const fileFor = (sysDir, user) => path.join(sysDir, `geocache-${String(user).replace(/[^a-z0-9_-]/gi, '_')}.json`);

/** Liefert gespeicherte Treffer (Liste) oder undefined. */
function get(sysDir, user, q) { const c = load(fileFor(sysDir, user)); return c.data[key(q)]; }
function put(sysDir, user, q, list) { const c = load(fileFor(sysDir, user)); c.data[key(q)] = list; save(c); }
/** Sucht erst im Speicher, sonst über fn(q); leere Ergebnisse werden ebenfalls gemerkt. */
async function cached(sysDir, user, q, fn) {
  const hit = get(sysDir, user, q);
  if (hit) return hit;
  const list = await fn(q);
  put(sysDir, user, q, list);
  return list;
}
module.exports = { get, put, cached };
