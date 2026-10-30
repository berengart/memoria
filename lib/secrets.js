'use strict';
/** Symmetrische Verschlüsselung (AES-256-GCM) für gespeicherte Geheimnisse; Schlüssel liegt in .system/secret.key. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Secrets {
  constructor(sysDir) {
    fs.mkdirSync(sysDir, { recursive: true, mode: 0o700 });
    const keyFile = path.join(sysDir, 'secret.key');
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    this.key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  }
  encrypt(text) {
    if (!text) return '';
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
  }
  decrypt(blob) {
    if (!blob) return '';
    try {
      const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
      const d = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
    } catch (e) { return ''; }
  }
}
module.exports = { Secrets };
