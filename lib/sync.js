'use strict';
/**
 * WebDAV-Synchronisierung eines Vaults.
 * Modi: bidirectional (beidseitig), push (lokal = Quelle, WebDAV = Ziel), pull (WebDAV = Quelle, lokal = Ziel).
 * Nach jedem Lauf wird gespeichert, was synchron war; daraus erkennt der nächste Lauf Änderungen und Löschungen.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DavClient } = require('./webdav');
const { attachmentInfo } = require('./util');

const FOLDER_TYPE = { people: 'person', journal: 'journal', notes: 'note' };

const TOP = ['people', 'journal', 'notes', 'templates', 'attachments'];
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const rsig = (r) => (r.etag ? `e:${r.etag}` : `m:${r.mtime}:${r.size}`);

function allowedRel(rel) {
  const parts = rel.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..' || p.startsWith('.') || p.includes('\\') || p.includes('\0'))) return false;
  if (!TOP.includes(parts[0]) || parts.length < 2) return false;
  const name = parts[parts.length - 1];
  return parts[0] === 'attachments' ? !!attachmentInfo(name) : name.endsWith('.md') && parts.length === 2;
}

function localWalk(dir) {
  const files = new Map();
  const rec = (rel) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!rel || rel.startsWith('attachments')) rec(r); } else if (allowedRel(r)) {
        const st = fs.statSync(path.join(dir, r));
        files.set(r, { abs: path.join(dir, r), size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  };
  for (const t of TOP) rec(t);
  return files;
}

async function runSync({ vault, cfg, state, force, log }) {
  const t0 = Date.now();
  const client = new DavClient(cfg);
  const mode = cfg.mode;
  const res = { uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: 0, skipped: 0, errors: [] };
  log(`Verbinde mit ${client.origin}${client.root} (${mode})`);

  const remoteInfo = await client.walk(TOP);
  const remote = new Map([...remoteInfo.files].filter(([p]) => allowedRel(p)));
  const local = localWalk(vault.dir);
  const old = state.files || {};
  log(`Lokal ${local.size} Dateien, Remote ${remote.size} Dateien, zuletzt synchron ${Object.keys(old).length}`);

  /* ---- Plan ---- */
  const hashes = new Map();
  const plan = [];
  for (const p of new Set([...local.keys(), ...remote.keys(), ...Object.keys(old)])) {
    const L = local.get(p), R = remote.get(p), S = old[p];
    let lh = null;
    if (L) { lh = S && S.size === L.size && S.mtime === Math.floor(L.mtimeMs) ? S.hash : sha1(fs.readFileSync(L.abs)); hashes.set(p, lh); }
    const rs = R ? rsig(R) : null;
    const lc = !!L && (!S || S.hash !== lh);
    const rc = !!R && (!S || S.rsig !== rs);
    let act;
    if (L && R) {
      if (!S) act = 'compare';
      else if (!lc && !rc) act = 'keep';
      else if (lc && !rc) act = mode === 'pull' ? 'skip' : 'up';
      else if (!lc && rc) act = mode === 'push' ? 'skip' : 'down';
      else act = 'conflict';
    } else if (L && !R) {
      if (S) act = mode === 'push' ? 'up' : lc ? (mode === 'pull' ? 'skip' : 'up') : 'delLocal';
      else act = mode === 'pull' ? 'skip' : 'up';
    } else if (!L && R) {
      if (S) act = mode === 'pull' ? 'down' : mode === 'push' ? 'delRemote' : rc ? 'down' : 'delRemote';
      else act = mode === 'push' ? 'skip' : 'down';
    } else act = 'forget';
    plan.push({ p, act, L, R });
  }

  /* ---- Sicherheitsstopp bei Massenlöschung ---- */
  const dels = plan.filter((x) => x.act === 'delLocal' || x.act === 'delRemote').length;
  const tracked = Object.keys(old).length;
  if (!force && dels > 10 && dels > tracked * 0.3) {
    const e = new Error(`Sicherheitsstopp: ${dels} von ${tracked} bekannten Dateien würden gelöscht. Prüfe Adresse/Ordner. Wenn das gewollt ist, „Trotzdem ausführen“ wählen.`);
    e.status = 409; e.data = { needsForce: true };
    throw e;
  }

  const touched = new Set(), failed = new Set();
  const trashCopy = (abs, rel, tag) => { try { fs.mkdirSync(vault.TRASH, { recursive: true }); fs.copyFileSync(abs, path.join(vault.TRASH, `${Date.now()}-${tag}-${rel.replace(/\//g, '_')}`)); } catch (e) { /* ignorieren */ } };
  const writeLocal = (rel, buf, mtime) => {
    const abs = path.join(vault.dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const [top, file] = rel.split('/');
    if (FOLDER_TYPE[top] && fs.existsSync(abs)) { try { vault.history.snapshot(FOLDER_TYPE[top], file.replace(/\.md$/, ''), fs.readFileSync(abs, 'utf8'), 'sync', true); } catch (e) { /* egal */ } }
    const tmp = `${abs}.tmp-sync`;
    fs.writeFileSync(tmp, buf); fs.renameSync(tmp, abs);
    if (mtime) { try { fs.utimesSync(abs, new Date(), new Date(mtime)); } catch (e) { /* ignorieren */ } }
    hashes.set(rel, sha1(buf));
  };

  state.conflicts = state.conflicts || [];
  const cdir = path.join(vault.dir, '.conflicts');
  const recordConflict = (rel, winner, loserBuf, lm, rm) => {
    fs.mkdirSync(cdir, { recursive: true });
    const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    fs.writeFileSync(path.join(cdir, id), loserBuf);
    state.conflicts.unshift({ id, path: rel, at: Date.now(), winner, localMtime: Math.floor(lm), remoteMtime: rm || 0 });
    for (const old of state.conflicts.splice(100)) { try { fs.unlinkSync(path.join(cdir, old.id)); } catch (e) { /* egal */ } }
  };

  for (const { p, act, L, R } of plan) {
    try {
      if (act === 'up') { await client.put(p, fs.readFileSync(L.abs)); res.uploaded++; touched.add(p); log(`↑ ${p}`); }
      else if (act === 'down') { const buf = await client.get(p); writeLocal(p, buf, R.mtime); res.downloaded++; touched.add(p); log(`↓ ${p}`); }
      else if (act === 'delLocal') { vault.trash(L.abs, `sync-${p.replace(/\//g, '_')}`); res.deletedLocal++; touched.add(p); log(`✕ lokal gelöscht (remote entfernt): ${p}`); }
      else if (act === 'delRemote') { await client.del(p); res.deletedRemote++; touched.add(p); log(`✕ remote gelöscht (lokal entfernt): ${p}`); }
      else if (act === 'skip') { res.skipped++; failed.add(p); }
      else if (act === 'compare' || act === 'conflict') {
        const buf = await client.get(p);
        if (sha1(buf) === hashes.get(p)) { log(`= ${p}`); continue; }
        const policy = cfg.conflictPolicy || 'newer';
        let winner = mode === 'push' ? 'local' : mode === 'pull' ? 'remote' : policy === 'local' ? 'local' : policy === 'remote' ? 'remote' : (R.mtime && R.mtime > L.mtimeMs ? 'remote' : 'local');
        res.conflicts++;
        const localBuf = fs.readFileSync(L.abs);
        if (winner === 'remote') { recordConflict(p, 'remote', localBuf, L.mtimeMs, R.mtime); writeLocal(p, buf, R.mtime); res.downloaded++; log(`⚠ Konflikt ${p}: Remote-Version übernommen (lokale Fassung unter „Konflikte“ abrufbar)`); }
        else { recordConflict(p, 'local', buf, L.mtimeMs, R.mtime); await client.put(p, localBuf); res.uploaded++; log(`⚠ Konflikt ${p}: lokale Version übernommen (Remote-Fassung unter „Konflikte“ abrufbar)`); }
        touched.add(p);
      }
    } catch (e) {
      failed.add(p); res.errors.push(`${p}: ${e.message}`); log(`! ${p}: ${e.message}`);
      if (/nicht erreichbar|Anmeldung/.test(e.message)) break;
    }
  }

  /* ---- Neuer Synchronzustand ---- */
  const remote2 = res.uploaded || res.deletedRemote || res.conflicts ? (await client.walk(TOP)).files : remote;
  const local2 = localWalk(vault.dir);
  const files = {};
  for (const [p, L] of local2) {
    const R = remote2.get(p);
    if (!R || !allowedRel(p)) continue;
    if (failed.has(p) && old[p]) { files[p] = old[p]; continue; }
    if (failed.has(p)) continue;
    const S = old[p];
    const h = hashes.get(p) || (S && S.size === L.size && S.mtime === Math.floor(L.mtimeMs) ? S.hash : sha1(fs.readFileSync(L.abs)));
    files[p] = { hash: h, size: L.size, mtime: Math.floor(L.mtimeMs), rsig: rsig(R) };
  }
  state.files = files;
  res.durationMs = Date.now() - t0;
  vault.scan(true);
  return res;
}

class SyncManager {
  constructor({ auth, settings, getVault, sysDir }) {
    this.auth = auth; this.settings = settings; this.getVault = getVault;
    this.dir = path.join(sysDir, 'sync');
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.running = new Set();
    this.timer = null;
  }
  stateFile(name) { return path.join(this.dir, `${name}.json`); }
  loadState(name) { try { return JSON.parse(fs.readFileSync(this.stateFile(name), 'utf8')); } catch (e) { return { files: {}, last: null }; } }
  saveState(name, st) { const f = this.stateFile(name); fs.writeFileSync(f + '.tmp', JSON.stringify(st), { mode: 0o600 }); fs.renameSync(f + '.tmp', f); }
  conflicts(name) { return (this.loadState(name).conflicts || []).map((c) => ({ ...c, binary: !c.path.endsWith('.md') })); }
  conflictDetail(name, id) {
    const c = (this.loadState(name).conflicts || []).find((x) => x.id === id);
    if (!c) return null;
    const vault = this.getVault(this.auth.get(name));
    let other = null, current = null;
    try { other = fs.readFileSync(path.join(vault.dir, '.conflicts', id)); } catch (e) { return null; }
    try { current = fs.readFileSync(path.join(vault.dir, c.path)); } catch (e) { /* gelöscht */ }
    const isText = c.path.endsWith('.md');
    return { ...c, binary: !isText, current: isText && current ? current.toString('utf8') : null, other: isText ? other.toString('utf8') : null, currentSize: current ? current.length : 0, otherSize: other.length };
  }
  /** action: 'use-other' (die unterlegene Fassung übernehmen) oder 'dismiss' */
  resolveConflict(name, id, action) {
    const st = this.loadState(name);
    const i = (st.conflicts || []).findIndex((x) => x.id === id);
    if (i < 0) throw Object.assign(new Error('Konflikt nicht gefunden'), { status: 404 });
    const c = st.conflicts[i];
    const vault = this.getVault(this.auth.get(name));
    const f = path.join(vault.dir, '.conflicts', id);
    if (action === 'use-other') {
      const buf = fs.readFileSync(f), abs = path.join(vault.dir, c.path);
      const [top, file] = c.path.split('/');
      if (FOLDER_TYPE[top] && fs.existsSync(abs)) vault.history.snapshot(FOLDER_TYPE[top], file.replace(/\.md$/, ''), fs.readFileSync(abs, 'utf8'), 'conflict', true);
      fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, buf);
      vault.scan(true);
    }
    try { fs.unlinkSync(f); } catch (e) { /* egal */ }
    st.conflicts.splice(i, 1);
    this.saveState(name, st);
    return { ok: true };
  }
  status(name) { const st = this.loadState(name); return { running: this.running.has(name), last: st.last || null }; }
  reset(name) { try { fs.unlinkSync(this.stateFile(name)); } catch (e) { /* egal */ } }

  async run(name, { force = false } = {}) {
    if (this.running.has(name)) throw Object.assign(new Error('Es läuft bereits eine Synchronisierung'), { status: 409 });
    const cfg = this.settings.syncConfig(name);
    if (!cfg.url) throw Object.assign(new Error('Keine WebDAV-Adresse eingestellt'), { status: 400 });
    this.running.add(name);
    const lines = [];
    const log = (l) => { if (lines.length < 400) lines.push(l); };
    const state = this.loadState(name);
    const started = new Date().toISOString();
    try {
      const r = await runSync({ vault: this.getVault(this.auth.get(name)), cfg, state, force, log });
      state.last = { at: started, ok: r.errors.length === 0, mode: cfg.mode, ...r, log: lines };
    } catch (e) {
      state.last = { at: started, ok: false, mode: cfg.mode, error: e.message, needsForce: !!(e.data && e.data.needsForce), errors: [], log: lines };
    } finally { this.running.delete(name); }
    this.saveState(name, state);
    return state.last;
  }

  async test(cfg) {
    if (!cfg.url) throw Object.assign(new Error('Keine WebDAV-Adresse angegeben'), { status: 400 });
    const c = new DavClient(cfg, 20000);
    const r = await c.test();
    return r.exists ? { ok: true, message: 'Verbindung erfolgreich – Zielordner vorhanden.' } : { ok: true, message: 'Verbindung erfolgreich – der Zielordner wird beim ersten Sync angelegt.' };
  }

  start() {
    this.timer = setInterval(() => {
      for (const u of this.auth.users) {
        const cfg = this.settings.get(u.name).sync;
        if (!cfg.enabled || !cfg.autoMinutes || !cfg.url || this.running.has(u.name)) continue;
        const last = this.loadState(u.name).last;
        if (last && Date.now() - Date.parse(last.at) < cfg.autoMinutes * 60000) continue;
        this.run(u.name).catch((e) => console.error('Auto-Sync', u.name, e.message));
      }
    }, 60000);
    this.timer.unref();
  }
}

module.exports = { SyncManager, runSync, localWalk, allowedRel };
