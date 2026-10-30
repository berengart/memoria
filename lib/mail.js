'use strict';
/** Minimaler SMTP-Client (SSL/STARTTLS, AUTH PLAIN/LOGIN). Konfiguration über Umgebungsvariablen SMTP_*. */
const net = require('net');
const tls = require('tls');

const cfg = () => ({
  host: process.env.SMTP_HOST || '', port: parseInt(process.env.SMTP_PORT, 10) || 587,
  user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASSWORD || '',
  from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  secure: (process.env.SMTP_SECURE || '').toLowerCase() || (parseInt(process.env.SMTP_PORT, 10) === 465 ? 'ssl' : 'starttls'), // ssl | starttls | none
  rejectUnauthorized: process.env.SMTP_INSECURE_TLS !== '1',
});
/** Absender: braucht eine vollständige Adresse. Steht in SMTP_FROM nur ein Name (z. B. „Memoria“), wird SMTP_USER als Adresse genommen. */
function sender(c) {
  const raw = (c.from || '').trim();
  const m = /^(.*?)\s*<([^>]*)>\s*$/.exec(raw);
  const name = (m ? m[1] : '').replace(/^"|"$/g, '').trim(), addr = (m ? m[2] : raw).trim();
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(addr)) return { header: m && name ? `${name} <${addr}>` : addr, addr };
  const u = (c.user || '').trim();
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(u)) { const nm = name || addr; return { header: nm ? `${nm} <${u}>` : u, addr: u }; }
  throw new Error('Absenderadresse unvollständig: SMTP_FROM muss eine volle Adresse enthalten, z. B. „Memoria <memoria@deine-domain.de>“ (aktuell: „' + raw + '“).');
}
const configured = () => !!cfg().host && !!cfg().from;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const addrOf = (s) => (/<([^>]+)>/.exec(s) || [null, s])[1].trim();

function buildMessage({ from, to, subject, text }) {
  const body = (b64(text).match(/.{1,76}/g) || []).join('\r\n');
  const id = `<${Date.now()}.${Math.random().toString(36).slice(2)}@memoria>`;
  return [`From: ${from}`, `To: ${to}`, `Subject: ${encHeader(subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: ${id}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body, ''].join('\r\n');
}

function send({ to, subject, text }) {
  const c = cfg();
  if (!c.host) return Promise.reject(Object.assign(new Error('Kein SMTP-Server konfiguriert (SMTP_HOST in der docker-compose.yml)'), { status: 400 }));
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) return Promise.reject(Object.assign(new Error('Ungültige E-Mail-Adresse'), { status: 400 }));
  let snd; try { snd = sender(c); } catch (e) { return Promise.reject(Object.assign(e, { status: 400 })); }
  return new Promise((resolve, reject) => {
    let sock, buf = '', done = false, step = 'greet', starttlsDone = false, caps = '';
    const timer = setTimeout(() => finish(new Error('SMTP-Zeitüberschreitung')), 25000);
    const finish = (err) => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch (e) { /* egal */ } err ? reject(Object.assign(err, { status: err.status || 502 })) : resolve(true); };
    const w = (l) => sock.write(l + '\r\n');
    const queue = [];
    const bind = () => {
      sock.setEncoding('utf8');
      sock.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (/^\d{3}-/.test(line)) { caps += line + '\n'; continue; }
          const m = /^(\d{3}) ?(.*)$/.exec(line); if (!m) continue;
          const code = +m[1]; caps += line + '\n';
          const all = caps; caps = '';
          handle(code, all, m[2]);
        }
      });
      sock.on('error', (e) => finish(new Error(`SMTP-Verbindung fehlgeschlagen: ${e.message}`)));
      sock.on('close', () => finish(new Error('SMTP-Verbindung unerwartet beendet')));
    };
    const expect = (ok, code, msg) => { if (!ok) finish(new Error(`SMTP-Fehler (${code}): ${msg}`)); return ok; };
    const from = snd.addr;
    const msg = buildMessage({ from: snd.header, to, subject, text });
    function handle(code, all, msgText) {
      switch (step) {
        case 'greet': if (!expect(code === 220, code, msgText)) return; step = 'ehlo'; w('EHLO memoria.local'); break;
        case 'ehlo':
          if (!expect(code === 250, code, msgText)) return;
          if (c.secure === 'starttls' && !starttlsDone) {
            if (!/STARTTLS/i.test(all)) { finish(new Error('Der Mailserver bietet kein STARTTLS an – aus Sicherheitsgründen abgebrochen (SMTP_SECURE=none erlaubt unverschlüsselt)')); return; }
            step = 'starttls'; w('STARTTLS'); break;
          }
          if (c.user) { step = 'auth'; w('AUTH PLAIN ' + b64(`\0${c.user}\0${c.pass}`)); } else { step = 'mail'; w(`MAIL FROM:<${from}>`); }
          break;
        case 'starttls': {
          if (!expect(code === 220, code, msgText)) return;
          const plain = sock; plain.removeAllListeners('data'); plain.removeAllListeners('close'); plain.removeAllListeners('error');
          sock = tls.connect({ socket: plain, servername: c.host, rejectUnauthorized: c.rejectUnauthorized }, () => { starttlsDone = true; step = 'ehlo'; buf = ''; w('EHLO memoria.local'); });
          bind(); break;
        }
        case 'auth': if (!expect(code === 235, code, 'Anmeldung am Mailserver abgelehnt')) return; step = 'mail'; w(`MAIL FROM:<${from}>`); break;
        case 'mail': if (!expect(code === 250, code, msgText)) return; step = 'rcpt'; w(`RCPT TO:<${to}>`); break;
        case 'rcpt': if (!expect(code === 250 || code === 251, code, msgText)) return; step = 'data'; w('DATA'); break;
        case 'data': if (!expect(code === 354, code, msgText)) return; step = 'body'; sock.write(msg.replace(/^\./gm, '..') + '\r\n.\r\n'); break;
        case 'body': if (!expect(code === 250, code, msgText)) return; step = 'quit'; w('QUIT'); finish(); break;
        default: break;
      }
    }
    try {
      if (c.secure === 'ssl') sock = tls.connect({ host: c.host, port: c.port, servername: c.host, rejectUnauthorized: c.rejectUnauthorized });
      else sock = net.connect({ host: c.host, port: c.port });
      bind();
    } catch (e) { finish(e); }
  });
}
module.exports = { send, configured, buildMessage };
