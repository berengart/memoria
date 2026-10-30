'use strict';
/**
 * SQLite-Zwischenspeicher für einen Vault (reiner Cache – die Markdown-Dateien bleiben die Quelle der Wahrheit).
 * Speichert geparste Metadaten, Links und den Text samt Volltextindex (FTS5).
 * Geht der Cache verloren, wird er beim Start aus den Dateien neu aufgebaut.
 */
const fs = require('fs');
const path = require('path');

const VERSION = 3;
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) {
  throw new Error('node:sqlite fehlt – bitte Node.js 22.13 oder neuer verwenden.');
}

class IndexDb {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.file = file;
    this.db = new DatabaseSync(file);
    try { this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;'); } catch (e) { /* egal */ }
    const v = this.db.prepare('PRAGMA user_version').get().user_version;
    if (v !== VERSION) {
      this.db.exec('DROP TABLE IF EXISTS items; DROP TABLE IF EXISTS fts;');
      this.db.exec(`PRAGMA user_version=${VERSION}`);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, slug TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL,
        title TEXT, date TEXT, mood INTEGER, energy INTEGER, enc INTEGER DEFAULT 0,
        tags TEXT, aliases TEXT, meta TEXT, links TEXT, snippet TEXT, body TEXT
      );
      CREATE INDEX IF NOT EXISTS items_date ON items(date);
      CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(id UNINDEXED, title, tags, meta, body, tokenize='unicode61 remove_diacritics 2');
    `);
    this.q = {
      all: this.db.prepare('SELECT id,type,slug,mtime,size,title,date,mood,energy,enc,tags,aliases,meta,links,snippet FROM items'),
      body: this.db.prepare('SELECT body FROM items WHERE id=?'),
      bodies: this.db.prepare('SELECT id,body FROM items WHERE enc=0'),
      put: this.db.prepare('INSERT OR REPLACE INTO items (id,type,slug,mtime,size,title,date,mood,energy,enc,tags,aliases,meta,links,snippet,body) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
      del: this.db.prepare('DELETE FROM items WHERE id=?'),
      fdel: this.db.prepare('DELETE FROM fts WHERE id=?'),
      fput: this.db.prepare('INSERT INTO fts (id,title,tags,meta,body) VALUES (?,?,?,?,?)'),
    };
  }

  begin() { this.db.exec('BEGIN'); }
  commit() { this.db.exec('COMMIT'); }
  rollback() { try { this.db.exec('ROLLBACK'); } catch (e) { /* egal */ } }

  rows() { return this.q.all.all(); }
  body(id) { const r = this.q.body.get(id); return r ? r.body || '' : ''; }
  bodies() { return this.q.bodies.all(); }

  put(it, size, searchable) {
    this.q.put.run(it.id, it.type, it.slug, it.mtime, size, it.title, it.date || null, it.mood ?? null, it.energy ?? null, it.enc ? 1 : 0,
      JSON.stringify(it.tags), JSON.stringify(it.aliases), JSON.stringify(it.meta), JSON.stringify(it.links), it.snippet, it.bodyText);
    this.q.fdel.run(it.id);
    this.q.fput.run(it.id, [it.title, ...it.aliases].join(' '), it.tags.join(' '), searchable, it.enc ? '' : it.bodyText);
  }
  remove(id) { this.q.del.run(id); this.q.fdel.run(id); }

  /** Volltextsuche: alle Wörter müssen vorkommen (Präfix erlaubt). Liefert [{id, snippet, rank}] */
  search(text, limit = 200) {
    const toks = String(text || '').normalize('NFKC').match(/[\p{L}\p{N}_]+/gu) || [];
    if (!toks.length) return [];
    const match = toks.map((t) => `"${t.replace(/"/g, '')}"*`).join(' AND ');
    try {
      return this.db.prepare(`SELECT id, snippet(fts, 4, '[[mark]]', '[[/mark]]', ' … ', 18) AS sn, bm25(fts, 0, 10, 4, 2, 1) AS rank
        FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT ?`).all(match, limit);
    } catch (e) { return []; }
  }

  close() { try { this.db.close(); } catch (e) { /* egal */ } }
}

module.exports = { IndexDb };
