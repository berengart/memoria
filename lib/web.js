'use strict';
/** Kleine HTTP-Hilfen: Router, Fehler, Body-Parser (JSON/Multipart), Dateiauslieferung, Sicherheits-Header. */
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.heic': 'image/heic',
  '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.weba': 'audio/webm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};

const fail = (msg, status = 400, data) => Object.assign(new Error(msg), { status, data });

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z]+)/gi, (m, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler, public: !!opts.public, raw: !!opts.raw });
  }
  get(p, h, o) { this.add('GET', p, h, o); }
  post(p, h, o) { this.add('POST', p, h, o); }
  put(p, h, o) { this.add('PUT', p, h, o); }
  delete(p, h, o) { this.add('DELETE', p, h, o); }
  match(method, pathname) { return this.routes.find((x) => x.method === method && x.re.test(pathname)); }
}

async function readRaw(req, limit) {
  const chunks = []; let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw fail('Daten zu groß', 413);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/** multipart/form-data → { files: [{filename, data}], fields: {name: value} } */
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const out = { files: [], fields: {} };
  if (!m) return out;
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const hdrEnd = buf.indexOf('\r\n\r\n', start);
    if (hdrEnd === -1) break;
    const header = buf.slice(start, hdrEnd).toString('utf8');
    const next = buf.indexOf(boundary, hdrEnd + 4);
    if (next === -1) break;
    const data = buf.slice(hdrEnd + 4, next - 2);
    const fn = /filename="([^"]*)"/i.exec(header), nm = /name="([^"]*)"/i.exec(header);
    if (fn) out.files.push({ filename: fn[1], data }); else if (nm) out.fields[nm[1]] = data.toString('utf8');
    pos = next;
  }
  return out;
}

function sendFile(full, req, res, cache, extra = {}) {
  let st;
  try { st = fs.statSync(full); } catch (e) { return false; }
  if (!st.isFile()) return false;
  const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
  const headers = {
    'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff', ETag: etag, 'Cache-Control': cache, 'Accept-Ranges': 'bytes', ...extra,
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
  let start = 0, end = st.size - 1, code = 200;
  const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (rg && st.size > 0 && (rg[1] || rg[2])) {
    if (rg[1] === '') { start = Math.max(0, st.size - +rg[2]); } else { start = +rg[1]; if (rg[2]) end = Math.min(end, +rg[2]); }
    if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return true; }
    code = 206; headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  }
  headers['Content-Length'] = st.size ? end - start + 1 : 0;
  res.writeHead(code, headers);
  if (req.method === 'HEAD' || !st.size) res.end(); else fs.createReadStream(full, { start, end }).pipe(res);
  return true;
}

const mapOrigin = require('./mapcfg').origin();
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", `img-src 'self' data: blob:${mapOrigin ? ' ' + mapOrigin : ''}`, "media-src 'self' blob:",
  "font-src 'self'", "connect-src 'self'", "frame-src https://www.youtube-nocookie.com https://open.spotify.com", "worker-src 'self'", "manifest-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

function securityHeaders(res, req) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(self), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if ((req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https' || req.socket.encrypted) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}

module.exports = { MIME, fail, Router, readRaw, parseMultipart, sendFile, securityHeaders, CSP };
