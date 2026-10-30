'use strict';
/** Einfaches Protokoll sicherheitsrelevanter Ereignisse (JSON-Zeilen, wird bei 1 MB rotiert). */
const fs = require('fs');
const path = require('path');

class Audit {
  constructor(sysDir) { this.file = path.join(sysDir, 'audit.log'); }
  log(event, user, ip, detail) {
    try {
      const line = JSON.stringify({ t: new Date().toISOString(), e: event, u: user || null, ip: ip || null, d: detail || undefined }) + '\n';
      try { if (fs.statSync(this.file).size > 1024 * 1024) fs.renameSync(this.file, this.file + '.1'); } catch (e) { /* neu */ }
      fs.appendFileSync(this.file, line, { mode: 0o600 });
    } catch (e) { console.error('Audit', e.message); }
  }
  tail(n = 200) {
    let txt = ''; try { txt = fs.readFileSync(this.file, 'utf8'); } catch (e) { return []; }
    return txt.trim().split('\n').slice(-n).reverse().map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  }
}
module.exports = { Audit };
