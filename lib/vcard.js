'use strict';
/** vCard (2.1/3.0/4.0) lesen und schreiben – für Import/Export der Personen. */

function unfold(text) { return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, ''); }
const unesc = (s) => String(s).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

function decodeQP(s) {
  const bytes = []; s = s.replace(/=\n/g, '');
  for (let i = 0; i < s.length; i++) { if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(...Buffer.from(s[i])); }
  return Buffer.from(bytes).toString('utf8');
}

function parseLine(line) {
  const idx = line.indexOf(':'); if (idx < 0) return null;
  const left = line.slice(0, idx), value = line.slice(idx + 1);
  const parts = left.split(';');
  const name = parts.shift().toUpperCase().replace(/^.*\./, ''); // Gruppenpräfix (item1.TEL) entfernen
  const params = {};
  for (const p of parts) {
    const [k, v] = p.includes('=') ? [p.slice(0, p.indexOf('=')).toUpperCase(), p.slice(p.indexOf('=') + 1)] : ['TYPE', p];
    params[k] = (params[k] ? params[k] + ',' : '') + v.replace(/"/g, '');
  }
  return { name, params, value };
}
const typeLabel = (params) => {
  const t = (params.TYPE || '').toLowerCase().split(',').filter((x) => x && !['pref', 'voice', 'internet'].includes(x));
  const map = { cell: 'Mobil', home: 'Privat', work: 'Arbeit', fax: 'Fax', other: 'Sonstige', mobile: 'Mobil' };
  return t.map((x) => map[x] || x).join(' / ');
};

/** Liefert [{ name, nickname, birthday, phones, emails, addresses, company, job, website, notes, tags, photo:{mime,data}|null, relations }] */
function parseVcf(text) {
  const out = [];
  const cards = unfold(text).split(/BEGIN:VCARD/i).slice(1);
  for (const c of cards) {
    const body = c.split(/END:VCARD/i)[0];
    const p = { phones: [], emails: [], addresses: [], tags: [], photo: null, notes: '' };
    let fn = '', n = '';
    for (const raw of body.split('\n')) {
      const l = parseLine(raw); if (!l) continue;
      let v = l.value;
      if (/QUOTED-PRINTABLE/i.test(l.params.ENCODING || '')) v = decodeQP(v);
      switch (l.name) {
        case 'FN': fn = unesc(v).trim(); break;
        case 'N': { const [fam, giv, add, pre, suf] = v.split(';').map(unesc); n = [pre, giv, add, fam, suf].filter(Boolean).join(' ').trim(); break; }
        case 'NICKNAME': p.nickname = unesc(v).split(',')[0].trim(); break;
        case 'BDAY': {
          const d = v.replace(/T.*$/, '').trim();
          let m = d.match(/^(\d{4})-?(\d{2})-?(\d{2})$/); if (m) p.birthday = m[1] === '0000' || m[1] === '1604' ? `${m[2]}-${m[3]}` : `${m[1]}-${m[2]}-${m[3]}`;
          else if ((m = d.match(/^--(\d{2})-?(\d{2})$/))) p.birthday = `${m[1]}-${m[2]}`;
          break;
        }
        case 'TEL': p.phones.push({ label: typeLabel(l.params), value: unesc(v).replace(/^tel:/i, '').trim() }); break;
        case 'EMAIL': p.emails.push({ label: typeLabel(l.params), value: unesc(v).trim() }); break;
        case 'ADR': { const f = v.split(';').map(unesc); const [, , street, city, , zip, country] = f; p.addresses.push({ label: typeLabel(l.params), value: [street, [zip, city].filter(Boolean).join(' '), country].filter(Boolean).join('\n') }); break; }
        case 'ORG': p.company = unesc(v.split(';')[0]).trim(); break;
        case 'TITLE': case 'ROLE': p.job = p.job || unesc(v).trim(); break;
        case 'URL': p.website = p.website || unesc(v).trim(); break;
        case 'NOTE': p.notes = unesc(v).trim(); break;
        case 'CATEGORIES': p.tags.push(...unesc(v).split(',').map((x) => x.trim().replace(/\s+/g, '-')).filter(Boolean)); break;
        case 'PHOTO': {
          const m = /^data:([^;]+);base64,(.+)$/i.exec(v);
          if (m) p.photo = { mime: m[1], data: Buffer.from(m[2], 'base64') };
          else if (/BASE64|^B$/i.test(l.params.ENCODING || '') || /b/i.test(l.params.ENCODING || '')) {
            const type = (l.params.TYPE || l.params.MEDIATYPE || 'jpeg').toLowerCase().replace('image/', '');
            p.photo = { mime: 'image/' + type, data: Buffer.from(v.replace(/\s/g, ''), 'base64') };
          }
          break;
        }
        default: break;
      }
    }
    p.name = fn || n;
    if (p.name) out.push(p);
  }
  return out;
}

/** Person (Item-Metadaten + Text) → vCard 3.0 */
function toVcf(meta, body) {
  const L = ['BEGIN:VCARD', 'VERSION:3.0'];
  const name = String(meta.name || '');
  const parts = name.split(/\s+/);
  const fam = parts.length > 1 ? parts.pop() : '';
  L.push(`FN:${esc(name)}`, `N:${esc(fam)};${esc(parts.join(' '))};;;`);
  if (meta.nickname) L.push(`NICKNAME:${esc(meta.nickname)}`);
  const bd = String(meta.birthday || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(bd)) L.push(`BDAY:${bd}`); else if (/^(?:--)?\d{2}-\d{2}$/.test(bd)) L.push(`BDAY:--${bd.replace(/^--/, '')}`);
  const lst = (a, f) => (Array.isArray(a) ? a : []).filter((x) => x && x.value).forEach(f);
  const tel = [...(meta.phone ? [{ label: '', value: meta.phone }] : []), ...(Array.isArray(meta.phones) ? meta.phones : [])];
  lst(tel, (x) => L.push(`TEL${x.label ? `;TYPE=${esc(x.label)}` : ''}:${esc(x.value)}`));
  const mail = [...(meta.email ? [{ label: '', value: meta.email }] : []), ...(Array.isArray(meta.emails) ? meta.emails : [])];
  lst(mail, (x) => L.push(`EMAIL${x.label ? `;TYPE=${esc(x.label)}` : ''}:${esc(x.value)}`));
  const adr = [...(meta.address ? [{ label: '', value: meta.address }] : []), ...(Array.isArray(meta.addresses) ? meta.addresses : [])];
  lst(adr, (x) => { const ls = String(x.value).split('\n'); L.push(`ADR${x.label ? `;TYPE=${esc(x.label)}` : ''}:;;${esc(ls[0] || '')};${esc((ls[1] || '').replace(/^\d+\s*/, ''))};;${esc((ls[1] || '').match(/^\d+/) || '')};${esc(ls[2] || '')}`); });
  if (meta.company) L.push(`ORG:${esc(meta.company)}`);
  if (meta.job) L.push(`TITLE:${esc(meta.job)}`);
  if (meta.website) L.push(`URL:${esc(meta.website)}`);
  if (Array.isArray(meta.tags) && meta.tags.length) L.push(`CATEGORIES:${meta.tags.map(esc).join(',')}`);
  const note = String(body || '').trim().slice(0, 2000);
  if (note) L.push(`NOTE:${esc(note)}`);
  L.push('END:VCARD');
  return L.map(fold).join('\r\n') + '\r\n';
}
function fold(line) {
  if (Buffer.byteLength(line) <= 74) return line;
  const out = []; let cur = '';
  for (const ch of line) { if (Buffer.byteLength(cur + ch) > (out.length ? 73 : 74)) { out.push(cur); cur = ''; } cur += ch; }
  out.push(cur);
  return out.join('\r\n ');
}

module.exports = { parseVcf, toVcf };
