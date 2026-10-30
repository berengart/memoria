'use strict';
/* Clientseitige Verschlüsselung (AES-256-GCM, Schlüssel per PBKDF2-SHA256 aus einer Passphrase).
   Der Server sieht nur den verschlüsselten Block. Format in der Markdown-Datei:
   -----BEGIN MEMORIA ENCRYPTED-----
   v1 <iterationen> <salt-base64> <iv-base64>
   <chiffretext base64, umbrochen>
   -----END MEMORIA ENCRYPTED----- */
(() => {
  const M = window.M;
  const { $, esc } = M;
  const ITER = 600000;
  const BEGIN = '-----BEGIN MEMORIA ENCRYPTED-----', END = '-----END MEMORIA ENCRYPTED-----';
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const keys = new Map(); // salt(base64) -> CryptoKey (nicht exportierbar)
  let passphrase = null;

  /* ---- Schlüsselspeicher im Browser (IndexedDB, nur nicht exportierbare Schlüssel) ---- */
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('memoria-keys', 1); r.onupgradeneeded = () => r.result.createObjectStore('k'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const idbOp = async (mode, fn) => { try { const db = await idb(); return await new Promise((res, rej) => { const tx = db.transaction('k', mode); const out = fn(tx.objectStore('k')); tx.oncomplete = () => res(out && out.result); tx.onerror = () => rej(tx.error); }); } catch (e) { return null; } };
  const storeKey = (user, salt, key) => idbOp('readwrite', (s) => s.put(key, `${user}:${salt}`));
  const loadKey = (user, salt) => idbOp('readonly', (s) => s.get(`${user}:${salt}`));
  const wipeStore = () => idbOp('readwrite', (s) => s.clear());

  async function derive(pass, saltB64, iter = ITER) {
    const base = await crypto.subtle.importKey('raw', te.encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const cfg = () => (M.state.settings && M.state.settings.crypto) || { salt: '', check: '' };
  const user = () => (M.state.me && M.state.me.name) || '';

  async function encWith(key, saltB64, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text));
    const body = (b64(ct).match(/.{1,76}/g) || []).join('\n');
    return `${BEGIN}\nv1 ${ITER} ${saltB64} ${b64(iv)}\n${body}\n${END}\n`;
  }
  function parse(block) {
    const m = new RegExp(`${BEGIN}\\s+v1 (\\d+) (\\S+) (\\S+)\\s+([\\s\\S]*?)\\s*${END}`).exec(block || '');
    if (!m) throw new Error('Kein verschlüsselter Block');
    return { iter: +m[1], salt: m[2], iv: m[3], data: m[4].replace(/\s+/g, '') };
  }

  const C = {
    isBlock: (t) => typeof t === 'string' && t.includes(BEGIN),
    isSetUp: () => !!cfg().salt,
    isUnlocked: () => keys.has(cfg().salt),

    /** Erste Einrichtung: Salt + Prüfwert speichern. */
    async setup(pass) {
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      const key = await derive(pass, salt);
      const check = await encWith(key, salt, 'memoria-check');
      const r = await M.api('/api/settings', { method: 'PUT', body: { crypto: { salt, check } } });
      M.state.settings = r.settings; keys.set(salt, key); passphrase = pass;
    },
    /** Entsperren: Passphrase gegen den gespeicherten Prüfwert prüfen. */
    async unlock(pass, remember) {
      const c = cfg(); if (!c.salt) throw new Error('Verschlüsselung ist noch nicht eingerichtet');
      const key = await derive(pass, c.salt);
      try { const p = parse(c.check); const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv) }, key, unb64(p.data)); if (td.decode(out) !== 'memoria-check') throw new Error('x'); } catch (e) { throw new Error('Die Passphrase stimmt nicht'); }
      keys.set(c.salt, key); passphrase = pass;
      if (remember) await storeKey(user(), c.salt, key);
    },
    async restore() { // beim Start: auf diesem Gerät gemerkten Schlüssel laden
      const c = cfg(); if (!c.salt || keys.has(c.salt)) return;
      const k = await loadKey(user(), c.salt); if (k) keys.set(c.salt, k);
    },
    async lock() { keys.clear(); passphrase = null; await wipeStore(); },
    async encrypt(text) {
      const c = cfg(); const key = keys.get(c.salt);
      if (!key) throw new Error('Verschlüsselung ist gesperrt');
      return encWith(key, c.salt, text);
    },
    async decrypt(block) {
      const p = parse(block);
      let key = keys.get(p.salt);
      if (!key && passphrase) { key = await derive(passphrase, p.salt, p.iter); keys.set(p.salt, key); }
      if (!key) throw new Error('Verschlüsselung ist gesperrt');
      try { return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv) }, key, unb64(p.data))); } catch (e) { throw new Error('Entschlüsselung fehlgeschlagen (falsche Passphrase?)'); }
    },

    /** Dialog zur Passphrase-Eingabe. mode: 'unlock' | 'setup'. Gibt true zurück, wenn danach entsperrt ist. */
    prompt(mode = 'unlock') {
      return new Promise((resolve) => {
        const bg = document.createElement('div'); bg.className = 'modal-bg';
        const setup = mode === 'setup';
        bg.innerHTML = `<form class="modal" style="max-width:460px"><h2 style="margin-top:0">🔒 ${setup ? 'Verschlüsselung einrichten' : 'Entsperren'}</h2>
          ${setup ? '<p class="muted">Wähle eine Passphrase für deine verschlüsselten Texte. <b>Wenn du sie vergisst, kann niemand die Texte wiederherstellen</b> – auch ich nicht. Notiere sie dir sicher.</p>' : '<p class="muted">Gib deine Passphrase ein, um verschlüsselte Texte zu lesen.</p>'}
          <div class="field"><label for="cpp">Passphrase</label><input id="cpp" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required autofocus></div>
          ${setup ? '<div class="field"><label for="cpp2">Wiederholen</label><input id="cpp2" type="password" autocomplete="new-password" required></div>' : ''}
          <label class="sw-row" style="border:0"><input type="checkbox" id="cprem"><span><b>Auf diesem Gerät entsperrt lassen</b><small>Speichert einen nicht auslesbaren Schlüssel im Browser. Nur auf eigenen Geräten verwenden.</small></span></label>
          <div class="auth-err" id="cerr" role="alert"></div>
          <div class="row-flex"><button class="btn primary">${setup ? 'Einrichten' : 'Entsperren'}</button><button type="button" class="btn" id="cx">Abbrechen</button></div></form>`;
        document.body.appendChild(bg);
        const done = (v) => { bg.remove(); resolve(v); };
        $('#cx', bg).addEventListener('click', () => done(false));
        $('#cpp', bg).focus();
        $('form', bg).addEventListener('submit', async (e) => {
          e.preventDefault(); const err = $('#cerr', bg); err.textContent = '';
          const pw = $('#cpp', bg).value;
          try {
            if (setup) {
              if (pw.length < 12) throw new Error('Bitte mindestens 12 Zeichen (am besten ein Satz)');
              if (pw !== $('#cpp2', bg).value) throw new Error('Die Eingaben stimmen nicht überein');
              await C.setup(pw); if ($('#cprem', bg).checked) await storeKey(user(), cfg().salt, keys.get(cfg().salt));
            } else await C.unlock(pw, $('#cprem', bg).checked);
            done(true);
          } catch (ex) { err.textContent = ex.message; }
        });
      });
    },
    /** Stellt sicher, dass entsperrt ist (fragt bei Bedarf). */
    async ensure(forWriting) {
      await C.restore();
      if (!C.isSetUp()) return forWriting ? C.prompt('setup') : false;
      if (C.isUnlocked()) return true;
      return C.prompt('unlock');
    },
  };
  M.crypt = C;
})();
