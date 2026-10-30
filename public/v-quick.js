'use strict';
/* Schnell erfassen (＋-Knopf, Taste N), Befehlspalette (Strg/Cmd+K) und Tastenkürzel */
(() => {
  const M = window.M;
  const { $, $$, esc, enc, api, toast, getItems, feat, go, todayStr } = M;

  const typing = (t) => t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  const modalOpen = () => !!document.querySelector('.modal-bg');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ------------------------------------------------------------ Schnell erfassen */
  async function upload(blob, name) {
    const fd = new FormData(); fd.append('file', blob, name);
    return api('/api/upload', { method: 'POST', body: fd });
  }
  const audioExt = (mime) => (/mp4|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /webm/.test(mime) ? 'weba' : 'weba');

  async function openQuick() {
    if (modalOpen() || document.body.classList.contains('anon')) return;
    const items = (await getItems()).filter((i) => i.type === 'person');
    const names = items.map((i) => i.title);
    const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.dataset.closable = '1';
    const canRec = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    bg.innerHTML = `<form class="modal qc-modal" style="max-width:560px" autocomplete="off"><h2 style="margin-top:0">⚡ Schnell erfassen</h2>
      <p class="muted small-text" style="margin-top:-6px">Landet als Zeile im Tagebuch des gewählten Tages – mit Verlinkung der Personen.</p>
      <div class="field" style="position:relative">${feat('people') ? `<label for="qWho">Mit wem? (Komma getrennt)</label><input id="qWho" type="text" placeholder="z. B. Anna, Bernd" autocomplete="off">` : ''}</div>
      <div class="field"><label for="qText">Was war?</label><textarea id="qText" rows="3" placeholder="Kaffee getrunken, über den Umzug gesprochen …"></textarea></div>
      <div class="form-grid"><div><label for="qPlace">Ort (optional)</label><input id="qPlace" type="text" placeholder="Forchheim"></div>
        <div><label>Datum</label>${M.dateHTML({ id: 'qDate', value: todayStr() })}</div></div>
      <div class="row-flex" style="margin:12px 0 4px">
        <label class="btn" for="qPhoto" style="cursor:pointer">📷 Foto</label><input id="qPhoto" type="file" accept="image/*" multiple hidden>
        <button type="button" class="btn" id="qRec" ${canRec ? '' : 'disabled title="Aufnahme braucht HTTPS oder localhost und einen aktuellen Browser"'}>🎙️ Sprachnotiz</button><span class="muted small-text" id="qRecT"></span></div>
      <div id="qMedia" class="chips" style="margin-bottom:6px"></div>
      ${feat('people') ? '<label class="sw-row" style="border:0;padding:4px 0"><input type="checkbox" id="qAct"><span><b>Zusätzlich als Treffen bei den Personen eintragen</b><small>Erscheint in der Aktivitäten-Liste der Person.</small></span></label>' : ''}
      <div class="row-flex" style="margin-top:10px"><button class="btn primary" id="qGo">💾 Erfassen</button><button type="button" class="btn" id="qX">Abbrechen</button><span class="spacer"></span><span class="muted small-text">Strg/Cmd + Enter</span></div></form>`;
    document.body.appendChild(bg);
    const form = $('form', bg);
    if ($('#qWho', bg)) M.family.suggest($('#qWho', bg), () => names, 1);
    const files = []; let recBlob = null, rec = null, stream = null, recTimer = 0, t0 = 0;
    const media = () => { $('#qMedia', bg).innerHTML = [...files.map((f, i) => `<span class="tag">🖼️ ${esc(f.name.slice(0, 24))} <a href="#" data-rm="f${i}" aria-label="Entfernen">✕</a></span>`), recBlob ? `<span class="tag">🎙️ Sprachnotiz <a href="#" data-rm="rec" aria-label="Entfernen">✕</a></span>` : ''].join(''); };
    $('#qMedia', bg).addEventListener('click', (e) => { const a = e.target.closest('[data-rm]'); if (!a) return; e.preventDefault(); if (a.dataset.rm === 'rec') recBlob = null; else files.splice(+a.dataset.rm.slice(1), 1); media(); });
    $('#qPhoto', bg).addEventListener('change', (e) => { files.push(...e.target.files); e.target.value = ''; media(); });
    const stopStream = () => { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } clearInterval(recTimer); };
    $('#qRec', bg).addEventListener('click', async () => {
      const btn = $('#qRec', bg);
      if (rec && rec.state === 'recording') { rec.stop(); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const chunks = [];
        rec = new MediaRecorder(stream); rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        rec.onstop = () => { stopStream(); recBlob = chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) : null; btn.textContent = '🎙️ Sprachnotiz'; $('#qRecT', bg).textContent = recBlob ? '' : 'Nichts aufgenommen'; media(); };
        rec.start(); t0 = Date.now(); btn.textContent = '⏹ Stopp'; recTimer = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); $('#qRecT', bg).textContent = `● ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 500);
      } catch (e) { stopStream(); toast('Mikrofon nicht verfügbar – Berechtigung prüfen', 'err'); }
    });
    const close = () => { try { if (rec && rec.state === 'recording') { rec.onstop = null; rec.stop(); } } catch (e) { /* egal */ } stopStream(); bg.remove(); };
    $('#qX', bg).addEventListener('click', close);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    new MutationObserver(() => { if (!document.body.contains(bg)) stopStream(); }).observe(document.body, { childList: true });
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); const go1 = $('#qGo', bg);
      if (rec && rec.state === 'recording') { toast('Bitte zuerst die Aufnahme beenden', 'err'); return; }
      const text = $('#qText', bg).value.trim(), place = $('#qPlace', bg).value.trim(), date = M.readDate($('#qDate', bg)) || todayStr();
      const who = ($('#qWho', bg) ? $('#qWho', bg).value : '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
      if (!text && !who.length && !place && !files.length && !recBlob) { toast('Bitte etwas eintragen', 'err'); return; }
      go1.disabled = true;
      try {
        const titles = [];
        for (const n of who) { const p = await M.family.ensurePerson(n); titles.push(p.title); if (p.created) toast(`Neu angelegt: ${p.title}`); }
        const embeds = [];
        for (const f of files) { const r = await upload(f, f.name || 'foto.jpg'); embeds.push(`![[${r.name}|320]]`); }
        if (recBlob) { const r = await upload(recBlob, `sprachnotiz-${Date.now()}.${audioExt(recBlob.type)}`); embeds.push(`![[${r.name}]]`); }
        const links = titles.map((t) => `[[${t}]]`);
        const lead = links.length ? `Mit ${links.length > 1 ? links.slice(0, -1).join(', ') + ' und ' + links[links.length - 1] : links[0]}${place ? ' in ' + place : ''}` : place ? `In ${place}` : '';
        const line = [lead && text ? `${lead} – ${text}` : lead || text, ...embeds].filter(Boolean).join(' ');
        await api('/api/journal/append', { method: 'POST', body: { text: line, date } });
        if ($('#qAct', bg) && $('#qAct', bg).checked && titles.length) {
          const all = await getItems(true);
          for (const t of titles) {
            const it = all.find((i) => i.type === 'person' && i.title === t); if (!it) continue;
            const d = await api(`/api/item/person/${enc(it.slug)}`); const acts = Array.isArray(d.meta.activities) ? d.meta.activities.slice() : [];
            acts.push({ date, title: (text || 'Treffen').slice(0, 120), ...(place ? { place } : {}) });
            await api(`/api/item/person/${enc(it.slug)}`, { method: 'PUT', body: { meta: { activities: acts } } });
          }
        }
        M.invalidate(); close(); toast('Erfasst ✓ – im Tagebuch notiert');
        if (!document.querySelector('#edForm') && !/^#\/settings/.test(location.hash)) M.route();
      } catch (err) { toast(err.message, 'err'); go1.disabled = false; }
    });
    $('#qWho', bg) ? $('#qWho', bg).focus() : $('#qText', bg).focus();
  }

  /* ------------------------------------------------------------ Befehlspalette */
  const NAV = () => [
    { t: 'Übersicht', ic: '🏠', to: '#/', kw: 'start dashboard home' },
    { t: 'Heute schreiben', ic: '✍️', to: '#/journal/' + todayStr(), kw: 'tagebuch heute eintrag' },
    ...(feat('people') ? [{ t: 'Personen', ic: '👤', to: '#/people', kw: 'kontakte' }, { t: 'Stammbaum', ic: '🌳', to: '#/family', kw: 'familie verwandt' }, { t: 'Neue Person anlegen', ic: '➕', run: () => { go('#/people'); setTimeout(() => { const i = $('#newName'); if (i) i.focus(); }, 400); } }] : []),
    ...(feat('map') ? [{ t: 'Karte', ic: '🗺️', to: '#/map', kw: 'orte wohnorte umkreis' }] : []),
    { t: 'Tagebuch', ic: '📓', to: '#/journal' }, { t: 'Notizen', ic: '📝', to: '#/notes' },
    ...(feat('mood') ? [{ t: 'Stimmung', ic: '🙂', to: '#/mood' }] : []), ...(feat('music') ? [{ t: 'Lieder', ic: '🎵', to: '#/songs' }] : []), ...(feat('graph') ? [{ t: 'Graph', ic: '🕸️', to: '#/graph' }] : []),
    { t: 'Jahresrückblick', ic: '🎞️', to: '#/review', kw: 'rückblick statistik jahr' }, { t: 'Datenprüfung', ic: '🧹', to: '#/check', kw: 'integrität prüfen links anhänge dubletten' },
    { t: 'Schnell erfassen', ic: '⚡', run: openQuick, kw: 'neu treffen foto sprachnotiz', hint: 'N' },
    { t: 'Einstellungen', ic: '⚙️', to: '#/settings' }, { t: 'Kalender-Abo (.ics)', ic: '📅', to: '#/settings?tab=data', kw: 'geburtstage kalender' },
    { t: 'Backup herunterladen', ic: '⬇️', run: () => { location.href = '/api/backup'; } },
    { t: 'Tastenkürzel anzeigen', ic: '⌨️', run: openHelp, hint: '?' },
  ];
  async function openPalette() {
    if (document.body.classList.contains('anon')) return;
    const old = $('#cp'); if (old) { old.remove(); return; }
    const items = await getItems();
    const bg = document.createElement('div'); bg.className = 'modal-bg cp-bg'; bg.id = 'cp'; bg.dataset.closable = '1';
    bg.innerHTML = '<div class="modal cp" role="dialog" aria-label="Befehlspalette"><input id="cpIn" type="text" placeholder="Seite, Person, Notiz oder Befehl …" autocomplete="off" aria-label="Befehlspalette"><div id="cpList" role="listbox"></div><div class="muted small-text cp-foot">↑↓ wählen · Enter öffnen · Esc schließen</div></div>';
    document.body.appendChild(bg);
    const inp = $('#cpIn', bg), listEl = $('#cpList', bg); let res = [], sel = 0;
    const terms = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (txt, ts) => { const h = txt.toLowerCase(); return ts.every((t) => h.includes(t)); };
    const build = () => {
      const q = inp.value.trim(), ts = terms(q); const cmds = NAV().filter((c) => !ts.length || match(c.t + ' ' + (c.kw || ''), ts));
      const found = ts.length ? items.filter((i) => match(i.title + ' ' + (i.aliases || []).join(' '), ts)).sort((a, b) => (a.title.toLowerCase().startsWith(ts[0]) ? 0 : 1) - (b.title.toLowerCase().startsWith(ts[0]) ? 0 : 1) || a.title.localeCompare(b.title, 'de')).slice(0, 8).map((i) => ({ t: i.title, ic: M.TYPE[i.type].ic, sub: M.TYPE[i.type].label + (i.date && i.type === 'journal' ? '' : ''), to: M.href(i) })) : [];
      res = [...cmds.slice(0, ts.length ? 6 : 30), ...found, ...(q ? [{ t: `Volltextsuche nach „${q}“`, ic: '🔎', to: '#/search?q=' + enc(q) }] : [])];
      sel = 0; paint();
    };
    const paint = () => { listEl.innerHTML = res.map((r, i) => `<div class="cp-i ${i === sel ? 'on' : ''}" role="option" data-i="${i}"><span class="cp-ic">${r.ic}</span><span class="cp-t">${esc(r.t)}</span>${r.sub ? `<span class="muted small-text">${esc(r.sub)}</span>` : ''}${r.hint ? `<kbd>${esc(r.hint)}</kbd>` : ''}</div>`).join('') || '<div class="muted" style="padding:12px">Nichts gefunden.</div>'; const on = $('.cp-i.on', listEl); if (on) on.scrollIntoView({ block: 'nearest' }); };
    const pick = (i) => { const r = res[i]; if (!r) return; bg.remove(); if (r.run) setTimeout(r.run, 30); else go(r.to); };
    inp.addEventListener('input', build);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(res.length - 1, sel + 1); paint(); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); } else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    });
    listEl.addEventListener('click', (e) => { const r = e.target.closest('.cp-i'); if (r) pick(+r.dataset.i); });
    listEl.addEventListener('mousemove', (e) => { const r = e.target.closest('.cp-i'); if (r && +r.dataset.i !== sel) { sel = +r.dataset.i; $$('.cp-i', listEl).forEach((x, i) => x.classList.toggle('on', i === sel)); } });
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) bg.remove(); });
    build(); inp.focus();
  }

  /* ------------------------------------------------------------ Tastenkürzel */
  const GO = { u: '#/', h: '#/journal/' + '{today}', p: '#/people', s: '#/family', k: '#/map', t: '#/journal', n: '#/notes', m: '#/mood', l: '#/songs', g: '#/graph', r: '#/review', e: '#/settings', c: '#/check' };
  const KEYS = [['Strg/Cmd + K', 'Befehlspalette (Seiten, Personen, Notizen)'], ['N', 'Schnell erfassen'], ['/', 'Suche'], ['?', 'Diese Hilfe'], ['G dann U', 'Übersicht'], ['G dann H', 'Heute'], ['G dann P', 'Personen'], ['G dann S', 'Stammbaum'], ['G dann K', 'Karte'], ['G dann T', 'Tagebuch'], ['G dann N', 'Notizen'], ['G dann M', 'Stimmung'], ['G dann L', 'Lieder'], ['G dann G', 'Graph'], ['G dann R', 'Jahresrückblick'], ['G dann C', 'Datenprüfung'], ['G dann E', 'Einstellungen'], ['Strg/Cmd + S', 'Speichern (im Editor)'], ['Esc', 'Fenster schließen']];
  function openHelp() {
    if (modalOpen()) return;
    const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.dataset.closable = '1';
    bg.innerHTML = `<div class="modal" style="max-width:460px"><h2 style="margin-top:0">⌨️ Tastenkürzel</h2><div class="keys">${KEYS.map(([k, d]) => `<div><kbd>${esc(k)}</kbd><span>${esc(d)}</span></div>`).join('')}</div><p class="muted small-text">Die Kürzel ohne Strg gelten nur, wenn gerade kein Eingabefeld aktiv ist.</p><div class="row-flex"><button class="btn" id="kX">Schließen</button></div></div>`;
    document.body.appendChild(bg); $('#kX', bg).addEventListener('click', () => bg.remove()); bg.addEventListener('mousedown', (e) => { if (e.target === bg) bg.remove(); }); $('#kX', bg).focus();
  }
  let gAt = 0;
  document.addEventListener('keydown', (e) => {
    if (document.body.classList.contains('anon')) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      if (e.target && e.target.id === 'ed') return; // im Editor bleibt Strg+K = Link einfügen
      e.preventDefault(); openPalette(); return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || modalOpen()) return;
    const k = e.key;
    if (gAt && Date.now() - gAt < 1200) { gAt = 0; const to = GO[k.toLowerCase()]; if (to) { e.preventDefault(); go(to.replace('{today}', todayStr())); } return; }
    if (k === 'g') { gAt = Date.now(); return; }
    if (k === 'n') { e.preventDefault(); openQuick(); } else if (k === '/') { e.preventDefault(); const s = $('#searchInput'); if (s) s.focus(); } else if (k === '?') { e.preventDefault(); openHelp(); }
  });

  document.addEventListener('click', (e) => { if (e.target.closest('[data-quick]')) openQuick(); else if (e.target.closest('[data-keys]')) openHelp(); });

  M.quick = { open: openQuick, palette: openPalette, help: openHelp };
})();
