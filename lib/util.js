'use strict';
const yaml = require('js-yaml');

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'eintrag';
}
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const clampInt = (v, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
function toList(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[,\n]/);
  return [...new Set(arr.map((x) => String(x).trim().replace(/^#/, '')).filter(Boolean))];
}
const safeSlug = (s) => typeof s === 'string' && s.length > 0 && s.length < 200 && !/[\/\\\0]/.test(s) && !s.startsWith('.');
const enc = (s) => encodeURIComponent(s).replace(/[()!'*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function parseFM(raw) {
  raw = raw.replace(/^﻿/, '');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { meta: {}, body: raw };
  let meta = {};
  try {
    const o = yaml.load(m[1], { schema: yaml.JSON_SCHEMA }); // Datumsangaben bleiben Strings
    if (o && typeof o === 'object' && !Array.isArray(o)) meta = o;
  } catch (e) { /* defektes YAML -> ohne Meta */ }
  return { meta, body: raw.slice(m[0].length) };
}
function dumpFM(meta, body) {
  const clean = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    clean[k] = v;
  }
  const y = Object.keys(clean).length ? yaml.dump(clean, { lineWidth: -1, schema: yaml.JSON_SCHEMA, noRefs: true }) : '';
  const b = String(body || '').replace(/^\s*\n/, '');
  return y ? `---\n${y}---\n\n${b}` : b;
}

/* Dateitypen für Anhänge: Endung -> Art. Der Unterordner ist die (normalisierte) Endung. */
const FILE_KINDS = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', bmp: 'image', heic: 'image',
  pdf: 'pdf', mp3: 'audio', m4a: 'audio', weba: 'audio', ogg: 'audio', wav: 'audio', flac: 'audio', mp4: 'video', webm: 'video', mov: 'video',
};
function attachmentInfo(filename) {
  const m = /\.([a-z0-9]+)$/i.exec(String(filename));
  if (!m) return null;
  const ext = m[1].toLowerCase();
  const kind = FILE_KINDS[ext];
  if (!kind) return null;
  return { ext, kind, folder: ext === 'jpg' ? 'jpeg' : ext };
}

module.exports = { slugify, pad, localDate, localTime, addDays, daysBetween, isDate, clampInt, toList, safeSlug, enc, parseFM, dumpFM, attachmentInfo, FILE_KINDS };
