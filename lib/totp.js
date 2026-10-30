'use strict';
/** TOTP (RFC 6238, SHA-1, 6 Stellen, 30 s) für Zwei-Faktor-Anmeldung. */
const crypto = require('crypto');
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(s) {
  let bits = 0, val = 0; const out = [];
  for (const c of String(s).toUpperCase().replace(/=+$/, '')) {
    const i = B32.indexOf(c); if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
const newSecret = () => b32encode(crypto.randomBytes(20));
function codeAt(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}
/** Liefert den passenden Zeitschritt (Zähler) oder null. Toleranz ±1 Schritt. */
function verify(secret, code, now = Date.now()) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return null;
  const c = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) {
    const a = Buffer.from(codeAt(secret, c + d)), b = Buffer.from(code);
    if (crypto.timingSafeEqual(a, b)) return c + d;
  }
  return null;
}
const uri = (secret, account, issuer = 'Memoria') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

module.exports = { newSecret, verify, uri, codeAt };
