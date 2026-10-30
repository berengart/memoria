'use strict';
/** ZIP lesen und schreiben ohne Abhängigkeiten (nur zlib). Kein ZIP64 – einzelne Dateien bis 4 GB. */
const fs = require('fs');
const zlib = require('zlib');

const MAX_ENTRIES = 50000;
const MAX_TOTAL = 2 * 1024 * 1024 * 1024; // entpackte Gesamtgröße
const MAX_ENTRY = 400 * 1024 * 1024;

/* ----------------------------------------------------------------- Lesen */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Object.assign(new Error('Das ist keine gültige ZIP-Datei'), { status: 400 });
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || off === 0xffffffff) throw Object.assign(new Error('ZIP64-Archive werden nicht unterstützt'), { status: 400 });
  if (count > MAX_ENTRIES) throw Object.assign(new Error('Zu viele Dateien im Archiv'), { status: 400 });
  const entries = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw Object.assign(new Error('ZIP-Verzeichnis beschädigt'), { status: 400 });
    const flags = buf.readUInt16LE(off + 8), method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20), usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nlen).toString(flags & 0x800 ? 'utf8' : 'utf8');
    off += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    total += usize;
    if (usize > MAX_ENTRY || total > MAX_TOTAL) throw Object.assign(new Error('Das Archiv ist zu groß (entpackt)'), { status: 413 });
    entries.push({ name, method, csize, usize, lho, flags, encrypted: !!(flags & 1) });
  }
  const read = (e) => {
    if (e.encrypted) throw Object.assign(new Error('Passwortgeschützte ZIP-Dateien werden nicht unterstützt'), { status: 400 });
    const p = e.lho;
    if (buf.readUInt32LE(p) !== 0x04034b50) throw Object.assign(new Error('ZIP-Eintrag beschädigt'), { status: 400 });
    const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
    const raw = buf.slice(start, start + e.csize);
    if (e.method === 0) return raw;
    if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: MAX_ENTRY });
    throw Object.assign(new Error(`Nicht unterstützte Komprimierung (${e.method})`), { status: 400 });
  };
  return { entries, read };
}

/* --------------------------------------------------------------- Schreiben */
const dosTime = (d) => ({ time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() });
const STORE_EXT = /\.(jpe?g|png|gif|webp|avif|heic|mp3|m4a|weba|ogg|mp4|webm|mov|zip|pdf|flac)$/i;

function localHeader(nameBuf, method, t) {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x808, 6); // Bit 3 (Data Descriptor) + UTF-8
  h.writeUInt16LE(method, 8); h.writeUInt16LE(t.time, 10); h.writeUInt16LE(t.date, 12); h.writeUInt16LE(nameBuf.length, 26);
  return Buffer.concat([h, nameBuf]);
}

/**
 * Schreibt ein ZIP in den Stream `out`. entries: [{ name, file?: absoluterPfad, data?: Buffer, mtime?: Date }]
 * Dateien werden gestreamt (kein komplettes Laden in den Speicher).
 */
async function writeZip(entries, out) {
  const central = [];
  let offset = 0;
  const write = (b) => new Promise((resolve, reject) => { if (!b.length) return resolve(); out.write(b, (e) => (e ? reject(e) : resolve())); offset += b.length; });
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name.replace(/\\/g, '/').replace(/^\/+/, ''), 'utf8');
    const t = dosTime(e.mtime || new Date());
    const method = STORE_EXT.test(e.name) ? 0 : 8;
    const start = offset;
    await write(localHeader(nameBuf, method, t));
    let crc = 0, usize = 0, csize = 0;
    const feed = async (chunk) => { crc = zlib.crc32(chunk, crc); usize += chunk.length; };
    if (method === 8) {
      const def = zlib.createDeflateRaw({ level: 6 });
      const done = new Promise((resolve, reject) => { def.on('end', resolve); def.on('error', reject); });
      def.on('data', (c) => { csize += c.length; out.write(c); offset += c.length; });
      if (e.data) { await feed(e.data); def.end(e.data); } else {
        await new Promise((resolve, reject) => {
          const rs = fs.createReadStream(e.file);
          rs.on('data', (c) => { crc = zlib.crc32(c, crc); usize += c.length; def.write(c); });
          rs.on('end', () => { def.end(); resolve(); }); rs.on('error', reject);
        });
      }
      await done;
    } else if (e.data) { await feed(e.data); csize = e.data.length; await write(e.data); } else {
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(e.file);
        rs.on('data', (c) => { crc = zlib.crc32(c, crc); usize += c.length; csize += c.length; if (!out.write(c)) { rs.pause(); out.once('drain', () => rs.resume()); } offset += c.length; });
        rs.on('end', resolve); rs.on('error', reject);
      });
    }
    if (usize > 0xfffffffe) throw new Error('Datei zu groß für ZIP ohne ZIP64');
    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc >>> 0, 4); dd.writeUInt32LE(csize, 8); dd.writeUInt32LE(usize, 12);
    await write(dd);
    central.push({ nameBuf, method, t, crc: crc >>> 0, csize, usize, start });
  }
  const cdStart = offset;
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x808, 8);
    h.writeUInt16LE(c.method, 10); h.writeUInt16LE(c.t.time, 12); h.writeUInt16LE(c.t.date, 14);
    h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.csize, 20); h.writeUInt32LE(c.usize, 24); h.writeUInt16LE(c.nameBuf.length, 28);
    h.writeUInt32LE(c.start, 42);
    await write(Buffer.concat([h, c.nameBuf]));
  }
  const cdSize = offset - cdStart;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(cdStart, 16);
  await write(end);
  await new Promise((r) => out.end(r));
}

module.exports = { readZip, writeZip };
