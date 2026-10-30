'use strict';
/** Minimaler WebDAV-Client (PROPFIND / GET / PUT / MKCOL / DELETE) ohne Abhängigkeiten. */

const PROPFIND_XML = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/><d:getetag/><d:resourcetype/></d:prop></d:propfind>';
const decodeXml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const err = (msg) => Object.assign(new Error(msg), { status: 502 });

class DavClient {
  constructor({ url, username, password, remotePath }, timeoutMs = 60000) {
    const u = new URL(url);
    this.origin = u.origin;
    const seg = (p) => decodeURIComponent(p).split('/').filter(Boolean);
    this.baseSegs = seg(u.pathname);
    this.segs = [...this.baseSegs, ...String(remotePath || '').split('/').filter(Boolean)];
    this.root = '/' + this.segs.join('/');
    this.auth = 'Basic ' + Buffer.from(`${username || ''}:${password || ''}`).toString('base64');
    this.timeoutMs = timeoutMs;
    this.made = new Set();
  }

  urlFor(rel, dir) {
    const segs = [...this.segs, ...String(rel || '').split('/').filter(Boolean)].map(encodeURIComponent);
    return this.origin + '/' + segs.join('/') + (dir && segs.length ? '/' : '');
  }

  async req(method, rel, { headers = {}, body, dir } = {}) {
    let res;
    try {
      res = await fetch(this.urlFor(rel, dir), { method, headers: { Authorization: this.auth, ...headers }, body, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      const c = e.cause && (e.cause.code || e.cause.message);
      throw err(`Server nicht erreichbar: ${c || e.message}`);
    }
    if (res.status >= 300 && res.status < 400) throw err(`Der Server leitet um (HTTP ${res.status}). Bitte die exakte Adresse (z. B. mit https://) verwenden.`);
    if (res.status === 401 || res.status === 403) throw err(`Anmeldung/Berechtigung abgelehnt (HTTP ${res.status}). Benutzername/Passwort bzw. App-Passwort prüfen.`);
    return res;
  }

  parse(xml) {
    const out = [];
    for (const block of xml.match(/<(?:[\w-]+:)?response[\s>][\s\S]*?<\/(?:[\w-]+:)?response>/gi) || []) {
      const g = (name) => { const m = new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, 'i').exec(block); return m ? m[1].trim() : ''; };
      let p;
      try { p = decodeURIComponent(new URL(decodeXml(g('href')), this.origin).pathname); } catch (e) { continue; }
      out.push({
        path: p.replace(/\/+$/, ''), isDir: /<(?:[\w-]+:)?collection\b/i.test(block),
        size: +g('getcontentlength') || 0, mtime: Date.parse(g('getlastmodified')) || 0, etag: decodeXml(g('getetag')),
      });
    }
    return out;
  }

  async propfind(rel, depth = 1) {
    const res = await this.req('PROPFIND', rel, { headers: { Depth: String(depth), 'Content-Type': 'application/xml' }, body: PROPFIND_XML, dir: true });
    if (res.status === 404) return null;
    if (res.status !== 207) throw err(`WebDAV-Server antwortet unerwartet (PROPFIND: HTTP ${res.status}). Ist das wirklich eine WebDAV-Adresse?`);
    return this.parse(await res.text());
  }

  /** Liest rekursiv alle Dateien unter dem Wurzelordner; nur erlaubte Top-Level-Ordner. */
  async walk(topAllowed) {
    const files = new Map();
    const rec = async (rel) => {
      const list = await this.propfind(rel, 1);
      if (list === null) return false;
      for (const e of list) {
        if (e.path !== this.root && !e.path.startsWith(this.root + '/')) continue;
        const r = e.path.slice(this.root.length).replace(/^\//, '');
        if (!r || r === rel) continue;
        if (!rel && !topAllowed.includes(r.split('/')[0])) continue;
        if (e.isDir) await rec(r); else files.set(r, { size: e.size, mtime: e.mtime, etag: e.etag });
      }
      return true;
    };
    const exists = await rec('');
    return { files, exists };
  }

  async ensureDir(rel) {
    const parts = [...this.segs.slice(this.baseSegs.length), ...String(rel || '').split('/').filter(Boolean)];
    let cur = [...this.baseSegs];
    for (const p of parts) {
      cur = [...cur, p];
      const key = cur.join('/');
      if (this.made.has(key)) continue;
      const url = this.origin + '/' + cur.map(encodeURIComponent).join('/') + '/';
      let res;
      try { res = await fetch(url, { method: 'MKCOL', headers: { Authorization: this.auth }, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) }); } catch (e) { throw err(`Ordner anlegen fehlgeschlagen: ${e.message}`); }
      if (![200, 201, 301, 302, 405].includes(res.status)) throw err(`Ordner „${p}“ konnte nicht angelegt werden (HTTP ${res.status})`);
      this.made.add(key);
    }
  }

  async get(rel) {
    const res = await this.req('GET', rel);
    if (res.status !== 200) throw err(`Download von ${rel} fehlgeschlagen (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async put(rel, buf) {
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    await this.ensureDir(dir);
    let res = await this.req('PUT', rel, { body: buf, headers: { 'Content-Type': 'application/octet-stream' } });
    if (res.status === 409) { this.made.clear(); await this.ensureDir(dir); res = await this.req('PUT', rel, { body: buf, headers: { 'Content-Type': 'application/octet-stream' } }); }
    if (![200, 201, 204].includes(res.status)) throw err(`Upload von ${rel} fehlgeschlagen (HTTP ${res.status})`);
  }

  async del(rel) {
    const res = await this.req('DELETE', rel);
    if (![200, 202, 204, 404].includes(res.status)) throw err(`Löschen von ${rel} fehlgeschlagen (HTTP ${res.status})`);
  }

  /** Verbindungstest: liefert Anzahl Einträge im Zielordner (oder null, wenn er noch nicht existiert). */
  async test() {
    const list = await this.propfind('', 0);
    if (list === null) {
      const parent = await this.req('PROPFIND', '', { headers: { Depth: '0' }, dir: true }).then((r) => r.status);
      return { exists: false, parent };
    }
    return { exists: true };
  }
}

module.exports = { DavClient };
