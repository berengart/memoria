'use strict';
/** Schutz vor Missbrauch ausgehender Verbindungen (SSRF): Zieladressen im Link-Local-/Metadaten-Bereich sind gesperrt. */
const dns = require('dns').promises;
const net = require('net');

function blocked(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || (a === 169 && b === 254) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::' || v.startsWith('fe80') || v.startsWith('::ffff:169.254.') || v.startsWith('ff');
}
/** Wirft einen Fehler, wenn die URL nicht erlaubt ist. */
async function guardUrl(url) {
  let u; try { u = new URL(url); } catch (e) { throw Object.assign(new Error('Ungültige Adresse'), { status: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Nur http:// und https:// sind erlaubt'), { status: 400 });
  if (u.username || u.password) throw Object.assign(new Error('Zugangsdaten bitte nicht in der Adresse angeben'), { status: 400 });
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  try { addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }); } catch (e) { return u; } // nicht auflösbar → Verbindungsfehler später
  if (addrs.some((a) => blocked(a.address))) throw Object.assign(new Error('Diese Zieladresse ist aus Sicherheitsgründen gesperrt'), { status: 400 });
  return u;
}
module.exports = { guardUrl };
