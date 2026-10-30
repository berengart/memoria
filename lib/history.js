'use strict';
/**
 * Versionsverlauf: vor jedem Überschreiben einer Markdown-Datei wird der alte Stand abgelegt
 * (.history/<typ>/<name>/<zeit>-<grund>.md). Der Ordner beginnt mit einem Punkt, wird also weder indexiert noch synchronisiert.
 */
const fs = require('fs');
const path = require('path');

const MAX_VERSIONS = 60;
const MIN_GAP_MS = 3 * 60 * 1000; // innerhalb weniger Minuten nicht jede Zwischenspeicherung festhalten
const REASONS = /^[a-z]{2,12}$/;

class History {
  constructor(vaultDir) { this.root = path.join(vaultDir, '.history'); }

  dir(type, slug) { return path.join(this.root, type, slug); }

  /** Verlauf beim Umbenennen/Verschieben mitnehmen. */
  move(type, slug, newType, newSlug) {
    const from = this.dir(type, slug), to = this.dir(newType, newSlug);
    if (!fs.existsSync(from) || fs.existsSync(to)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }

  list(type, slug) {
    let files = [];
    try { files = fs.readdirSync(this.dir(type, slug)); } catch (e) { return []; }
    return files.filter((f) => f.endsWith('.md')).sort().reverse().map((f) => {
      const [ts, reason] = f.slice(0, -3).split('-');
      let size = 0; try { size = fs.statSync(path.join(this.dir(type, slug), f)).size; } catch (e) { /* weg */ }
      return { id: f.slice(0, -3), at: Number(ts), reason: reason || 'save', size };
    });
  }

  read(type, slug, id) {
    if (!/^\d{10,16}-[a-z]{2,12}$/.test(id)) return null;
    try { return fs.readFileSync(path.join(this.dir(type, slug), id + '.md'), 'utf8'); } catch (e) { return null; }
  }

  /** Beim Verschlüsseln: unverschlüsselte frühere Fassungen löschen, damit kein Klartext im Verlauf zurückbleibt. */
  purgePlain(type, slug) {
    for (const v of this.list(type, slug)) {
      const raw = this.read(type, slug, v.id);
      if (raw !== null && !/-----BEGIN MEMORIA ENCRYPTED-----/.test(raw)) { try { fs.unlinkSync(path.join(this.dir(type, slug), v.id + '.md')); } catch (e) { /* egal */ } }
    }
  }

  /** Alten Stand sichern. force=true ignoriert den Mindestabstand (z. B. vor Wiederherstellung oder Sync). */
  snapshot(type, slug, content, reason = 'save', force = false) {
    if (!REASONS.test(reason)) reason = 'save';
    const dir = this.dir(type, slug);
    const existing = this.list(type, slug);
    if (existing.length) {
      const last = this.read(type, slug, existing[0].id);
      if (last === content) return null;
      if (!force && Date.now() - existing[0].at < MIN_GAP_MS) return null;
    }
    fs.mkdirSync(dir, { recursive: true });
    const id = `${Date.now()}-${reason}`;
    fs.writeFileSync(path.join(dir, id + '.md'), content);
    for (const old of existing.slice(MAX_VERSIONS - 1)) { try { fs.unlinkSync(path.join(dir, old.id + '.md')); } catch (e) { /* egal */ } }
    return id;
  }
}

module.exports = { History };
