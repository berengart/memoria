'use strict';
/* Editor */
(() => {
  const M = window.M;
  const { $, $$, esc, enc, pad, isDate, todayStr, parseD, fmtD, addDays, diffDays, fmtLong, fmtShort, monthName, ago, MOODS, moodColor, TYPE, href, feat, go, api, getItems, invalidate, toast, dispTitle, tagChips, moodChip, fileUrl, avatar, row, isDark, embedHTML, songLine, lookupSong, onLeave } = M;
  const app = M.$('#app');
  /* --------------------------------------------------------------- Editor */
  function fieldDefs(type) {
    if (type === 'person') return [
      { k: 'name', l: 'Name', req: 1 }, { k: 'maidenname', l: 'Mädchenname / Geburtsname (falls durch Heirat anderer Name)', ph: 'z. B. Schmidt' }, { k: 'nickname', l: 'Spitzname' }, { k: 'aliases', l: 'Weitere Namen (Komma)', t: 'list' },
      { k: 'relationship', l: 'Beziehung', ph: 'Freund, Kollegin, Familie…' }, { k: 'gender', l: 'Geschlecht (für Verwandtschaftsbezeichnungen)', t: 'select', opts: [['', 'keine Angabe'], ['w', 'weiblich'], ['m', 'männlich'], ['d', 'divers']] },
      { k: 'birthday', l: 'Geburtstag', t: 'date', partial: 1 }, { k: 'birthplace', l: 'Geburtsort' }, { k: 'died', l: 'Gestorben am (optional)', t: 'date', year: 1 }, { k: 'deathplace', l: 'Sterbeort (optional)' },
      { k: 'website', l: 'Webseite' },
      { k: 'company', l: 'Firma' }, { k: 'job', l: 'Beruf' }, { k: 'met', l: 'Kennengelernt (wo / wie)' },
      { k: 'places', l: '🕘 Frühere Wohnorte (nur Ortsnamen, Komma getrennt, optional mit Zeitraum: Forchheim (1990–2004), Muggendorf (ab 2010))', t: 'places', wide: 1, ph: 'Muggendorf, Forchheim (1990–2004), Hundsboden' },
      { k: 'last_contact', l: 'Letzter Kontakt (manuell)', t: 'date' }, { k: 'contact_every', l: 'Kontaktwunsch: alle … Tage', t: 'number' },
      { k: 'tags', l: 'Tags (Komma)', t: 'list', wide: 1 },
    ];
    if (type === 'journal') {
      const f = [{ k: 'date', l: 'Datum', t: 'date' }, { k: 'title', l: 'Titel (optional)', wide: 1 }];
      if (feat('music')) f.push({ k: 'song', l: '🎵 Lied des Tages (Interpret – Titel)', wide: 1 }, { k: 'song_url', l: 'Link zum Lied (optional)', wide: 1, song: 1 });
      if (feat('details')) f.push({ k: 'weather', l: 'Wetter' }, { k: 'location', l: 'Ort' }, { k: 'sleep', l: 'Schlaf (Stunden)', t: 'number', step: '0.5' });
      f.push({ k: 'tags', l: 'Tags (Komma)', t: 'list', wide: 1 });
      return f;
    }
    return [{ k: 'title', l: 'Titel', req: 1, wide: 1 }, { k: 'date', l: 'Datum (optional)', t: 'date' }, { k: 'aliases', l: 'Weitere Namen (Komma)', t: 'list' }, { k: 'tags', l: 'Tags (Komma)', t: 'list' }];
  }

  async function uploadFile(file) {
    const fd = new FormData(); fd.append('file', file, file.name || 'bild.png');
    return api('/api/upload', { method: 'POST', body: fd });
  }

  const BTN = {
    basic: [
      { id: 'bold', t: '<b>B</b>', title: 'Fett (Strg+B)', wrap: ['**', '**'] }, { id: 'italic', t: '<i>I</i>', title: 'Kursiv (Strg+I)', wrap: ['*', '*'] },
      { id: 'h2', t: 'H', title: 'Überschrift', line: '## ' }, { id: 'ul', t: '• Liste', title: 'Aufzählung', line: '- ' }, { id: 'task', t: '☑', title: 'Aufgabe', line: '- [ ] ' },
      { id: 'wiki', t: '[[ ]]', title: 'Link zu Person / Eintrag', wrap: ['[[', ']]'] },
    ],
    rich: [
      { id: 'strike', t: '<s>S</s>', title: 'Durchgestrichen', wrap: ['~~', '~~'] }, { id: 'h1', t: 'H1', title: 'Überschrift 1', line: '# ' }, { id: 'h2b', t: 'H2', title: 'Überschrift 2', line: '## ' }, { id: 'h3', t: 'H3', title: 'Überschrift 3', line: '### ' },
      { id: 'ol', t: '1.', title: 'Nummerierte Liste', line: '1. ' }, { id: 'quote', t: '❝', title: 'Zitat', line: '> ' }, { id: 'code', t: '<code>`</code>', title: 'Code (Strg+E)', wrap: ['`', '`'] },
      { id: 'codeblock', t: '{ }', title: 'Codeblock', wrap: ['```\n', '\n```'] }, { id: 'link', t: '🔗', title: 'Link (Strg+K)', link: 1 },
      { id: 'table', t: '▦', title: 'Tabelle', snippet: '\n| Spalte A | Spalte B |\n|----------|----------|\n|          |          |\n' }, { id: 'hr', t: '―', title: 'Trennlinie', snippet: '\n---\n' },
    ],
  };

  async function editor(it) {
    const items = await getItems();
    const type = it.type, meta = { ...(it.meta || {}) };
    let mood = meta.mood ? +meta.mood : null, energy = meta.energy ? +meta.energy : null, photo = meta.photo || '';
    if (type !== 'person') meta.date = it.date || meta.date || '';
    const defs = fieldDefs(type);
    const val = (f) => { const v = meta[f.k]; return Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? (f.t === 'places' && M.map ? M.map.placeLabel(x) : x.name) : x)).filter(Boolean).join(', ') : v ?? ''; };
    const fieldHTML = (f) => {
      const id = `f_${f.k}`, v = esc(val(f));
      const input = f.t === 'date' ? M.dateHTML({ id, value: val(f), partial: f.partial, year: f.year })
        : f.t === 'select' ? `<select id="${id}">${f.opts.map(([o, l]) => `<option value="${o}" ${String(val(f)) === o ? 'selected' : ''}>${l}</option>`).join('')}</select>`
        : f.t === 'textarea' ? `<textarea id="${id}" rows="2">${v}</textarea>`
        : `<input id="${id}" type="${f.t === 'date' ? 'date' : f.t === 'number' ? 'number' : 'text'}" value="${v}" ${f.req ? 'required' : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''} ${f.step ? `step="${f.step}"` : ''} ${f.k === 'tags' ? 'list="taglist"' : ''}>`;
      const wx = M.state.settings.weather && M.state.settings.weather.enabled;
      const extra = f.song ? '<div style="margin-top:6px"><button type="button" class="btn small" id="songLook">Titel aus Link holen</button></div>'
        : wx && f.k === 'weather' ? '<div style="margin-top:6px"><button type="button" class="btn small" id="wxBtn">☁️ Wetter eintragen</button></div>'
        : f.t === 'places' ? '<div style="margin-top:6px"><button type="button" class="btn small" id="plRepick">🔄 Orte neu auswählen</button> <span class="muted small-text" id="plHint"></span></div>'
        : wx && f.k === 'location' ? '<div style="margin-top:6px"><button type="button" class="btn small" id="locBtn">📍 Standort bestimmen</button></div>' : '';
      return `<div class="${f.wide ? 'wide' : ''}"><label for="${id}">${f.l}</label>${input}${extra}</div>`;
    };
    const allTags = [...new Set(items.flatMap((i) => i.tags))].sort();
    let encOn = !!it.encrypted;
    const draftKey = `memoria-draft:${type}/${it.slug || it.date || 'neu'}`;
    const R = M.repeater;
    const arrOf = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
    const relTypes = (M.state.relationTypes || ['Partner', 'Kind', 'Elternteil', 'Geschwister', 'Freund', 'Kollege', 'Sonstige']).map((x) => [x, x]);
    /* Familie: Eltern/Partner/Kinder/Geschwister werden im Familienblock bearbeitet, alle anderen Beziehungen in der Liste */
    const nz = M.family ? M.family.norm : (x) => String(x || '').trim().toLowerCase();
    const allRel = arrOf(meta.relations), famKeep = new Map(), rest = [];
    let motherRow = null, fatherRow = null; const partnerRows = [], kidRows = [], sibRows = [];
    for (const r of allRel) {
      const role = nz(r.role);
      if (r.type === 'Elternteil' && role === 'mutter' && !motherRow) motherRow = r;
      else if (r.type === 'Elternteil' && role === 'vater' && !fatherRow) fatherRow = r;
      else if (r.type === 'Partner' || r.type === 'Ehepartner') partnerRows.push(r);
      else if (r.type === 'Kind') kidRows.push(r);
      else if (r.type === 'Geschwister') sibRows.push(r);
      else rest.push(r);
    }
    for (const r of [motherRow, fatherRow, ...partnerRows, ...kidRows, ...sibRows]) if (r) famKeep.set(r.type + '|' + nz(r.person), r);
    const namesOf = (rows) => rows.map((r) => r.person + (r.ex ? ' (ex)' : '')).join(', ');
    const famHas = !!(motherRow || fatherRow || partnerRows.length || kidRows.length || sibRows.length);
    const allAddr = type !== 'person' ? [] : [...(meta.address ? [{ value: meta.address }] : []), ...arrOf(meta.addresses)];
    const okGeo = (a) => Number.isFinite(+a.lat) && a.lat !== '' && a.lat !== undefined && a.lat !== null;
    const homeRow = allAddr.find((a) => a.home) || allAddr.find(okGeo) || allAddr[0] || null;
    const moreAddr = allAddr.filter((a) => a !== homeRow).map((a) => { const o = { ...a }; delete o.home; return o; });
    const reps = type !== 'person' ? [] : [
      { key: 'phones', label: '📞 Telefonnummern', add: 'Nummer', cols: [{ k: 'label', ph: 'Mobil, Arbeit …' }, { k: 'value', ph: '+49 …', w: 2, req: 1 }], rows: [...(meta.phone ? [{ value: meta.phone }] : []), ...arrOf(meta.phones)] },
      { key: 'emails', label: '✉️ E-Mail-Adressen', add: 'Adresse', cols: [{ k: 'label', ph: 'Privat, Arbeit …' }, { k: 'value', ph: 'name@example.org', w: 2, req: 1 }], rows: [...(meta.email ? [{ value: meta.email }] : []), ...arrOf(meta.emails)] },
      { key: 'addr_home', single: 1, label: '🏠 Aktueller Wohnort (eine Adresse)', add: '', cols: [{ k: 'value', t: 'area', ph: 'Straße Nr.\nPLZ Ort\nLand', w: 3, req: 1 }, { k: 'geo', t: 'geo', w: 2 }], rows: [homeRow] },
      ...(moreAddr.length ? [{ key: 'addr_more', label: '📮 Weitere gespeicherte Adressen (aus früheren Versionen)', add: 'Adresse', cols: [{ k: 'label', ph: 'Arbeit …' }, { k: 'value', t: 'area', ph: 'Straße Nr.\nPLZ Ort\nLand', w: 3, req: 1 }, { k: 'geo', t: 'geo', w: 2 }], rows: moreAddr }] : []),
      { key: 'relations', label: '👥 Beziehungen zu anderen Personen', add: 'Beziehung', cols: [{ k: 'person', ph: 'Name der Person', w: 2, req: 1, list: 'personlist' }, { k: 'type', t: 'select', opts: relTypes, def: 'Freund' }], rows: rest },
      { key: 'activities', label: '📅 Aktivitäten & Treffen', add: 'Aktivität', cols: [{ k: 'date', t: 'date', min: 140 }, { k: 'title', ph: 'Was habt ihr gemacht?', w: 2, req: 1 }, { k: 'place', ph: 'Ort' }, { k: 'note', ph: 'Notiz', w: 2 }], rows: arrOf(meta.activities) },
      { key: 'gifts', label: '🎁 Geschenkideen', add: 'Idee', cols: [{ k: 'idea', ph: 'Idee', w: 2, req: 1 }, { k: 'status', t: 'select', opts: [['idee', 'Idee'], ['gekauft', 'Gekauft'], ['verschenkt', 'Verschenkt']] }, { k: 'url', ph: 'Link' }, { k: 'note', ph: 'Notiz' }], rows: arrOf(meta.gifts) },
      { key: 'debts', label: '💶 Schulden', add: 'Eintrag', cols: [{ k: 'amount', t: 'number', step: '0.01', ph: 'Betrag', min: 90, req: 1 }, { k: 'currency', ph: 'EUR', def: 'EUR', min: 60 }, { k: 'direction', t: 'select', opts: [['mir_geschuldet', 'schuldet mir'], ['ich_schulde', 'ich schulde']], min: 130 }, { k: 'note', ph: 'Wofür?', w: 2 }, { k: 'date', t: 'date', min: 140 }, { k: 'settled', t: 'check', ph: 'beglichen' }], rows: arrOf(meta.debts) },
    ];
    const personNames = items.filter((i) => i.type === 'person').map((i) => i.title);
    const title = type === 'journal' ? fmtLong(it.date) : it.title;
    const moodHTML = type === 'journal' && feat('mood') ? `<div class="wide"><label>Stimmung</label><div class="mood-row" id="moodRow">${MOODS.map((m) => `<button type="button" class="mood-btn ${mood === m.v ? 'sel' : ''}" style="--mc:${m.c}" data-mood="${m.v}" title="${m.l}">${m.e}</button>`).join('')}</div></div>
      <div class="wide"><label>Energie (1 = erschöpft … 5 = voller Tatendrang)</label><div class="mood-row" id="energyRow">${[1, 2, 3, 4, 5].map((v) => `<button type="button" class="energy-btn ${energy === v ? 'sel' : ''}" data-energy="${v}">${v}</button>`).join('')}</div></div>` : '';
    const photoHTML = type === 'person' ? `<div class="wide"><label>Foto</label><div class="photo-edit"><span id="photoPrev">${photo ? `<img class="avatar big" src="${fileUrl(photo)}" alt="">` : avatar({ title: meta.name || it.title || '?' }, true)}</span><input type="file" id="photoFile" accept="image/*" style="max-width:260px"><button type="button" class="btn small" id="photoDel" ${photo ? '' : 'hidden'}>Entfernen</button></div></div>` : '';
    const btns = (list) => list.map((b) => `<button type="button" class="btn" data-b="${b.id}" title="${b.title}">${b.t}</button>`).join('');
    const rich = feat('richEditor');
    app.innerHTML = `
      <form id="edForm" class="card">
        <div class="row-flex"><h1 style="margin:0">${it.isNew ? 'Neuer Eintrag' : 'Bearbeiten'}: ${esc(title)}</h1><span class="spacer"></span>
          ${it.isNew ? '' : '<button type="button" class="btn" id="histBtn" title="Frühere Fassungen ansehen und wiederherstellen">🕘 Verlauf</button>'}<button type="button" class="btn" id="cancelBtn">Abbrechen</button><button class="btn primary" type="submit">💾 Speichern</button></div>
        <details open style="margin-top:14px"><summary>Eigenschaften</summary><div class="form-grid" style="margin-top:10px">${moodHTML}${photoHTML}${defs.map(fieldHTML).join('')}${!it.isNew && type !== 'person' ? `<div class="wide"><label for="f_typeSwitch">Art des Eintrags</label><select id="f_typeSwitch"><option value="journal" ${type === 'journal' ? 'selected' : ''}>📓 Tagebucheintrag</option><option value="note" ${type === 'note' ? 'selected' : ''}>📝 Notiz</option></select><small class="muted">Beim Speichern wird der Eintrag umgewandelt; Text, Tags und Verlauf bleiben erhalten, Verknüpfungen werden angepasst.</small></div>` : ''}${type === 'person' ? `<div class="wide" id="famBox"><label class="sw-row" style="border:0;padding:0"><input type="checkbox" id="famOn" ${famHas ? 'checked' : ''}><span><b>👪 Verwandt?</b><small>Ja: Eltern, Partner, Kinder und Geschwister eintragen. Großeltern, Onkel, Cousins usw. werden daraus automatisch abgeleitet und im Stammbaum gezeigt.</small></span></label>
          <div class="fam-box" id="famFields" ${famHas ? '' : 'hidden'}><div class="form-grid">
            <div><label for="fam_mother">Mutter</label><input id="fam_mother" type="text" value="${esc(motherRow ? motherRow.person : '')}" autocomplete="off"></div>
            <div><label for="fam_father">Vater</label><input id="fam_father" type="text" value="${esc(fatherRow ? fatherRow.person : '')}" autocomplete="off"></div>
            <div class="wide"><label for="fam_partner">Partner:in (Komma; „Name (ex)“ für frühere)</label><input id="fam_partner" type="text" value="${esc(namesOf(partnerRows))}" autocomplete="off"></div>
            <div class="wide"><label for="fam_kids">Kinder (Komma)</label><input id="fam_kids" type="text" value="${esc(namesOf(kidRows))}" autocomplete="off"></div>
            <div class="wide"><label for="fam_sibs">Geschwister (Komma)</label><input id="fam_sibs" type="text" value="${esc(namesOf(sibRows))}" autocomplete="off"></div>
          </div><p class="muted small-text" style="margin:8px 0 0">Namen, die es noch nicht gibt, werden beim Speichern als neue Personen angelegt. Weitere Eltern (z. B. Stiefeltern) und andere Beziehungen stehen unten in der Liste.</p></div></div>` : ''}${reps.map((x) => R.html(x)).join('')}<div class="wide"><label class="sw-row" style="border:0;padding:0"><input type="checkbox" id="encOn" ${encOn ? 'checked' : ''}><span><b>🔒 Text verschlüsseln</b><small>Der Text wird im Browser mit deiner Passphrase verschlüsselt; Titel, Datum, Stimmung und Tags bleiben lesbar. Bilder und Anhänge werden nicht verschlüsselt.</small></span></label></div></div></details>
        <datalist id="personlist">${personNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <datalist id="taglist">${allTags.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        <div class="toolbar" id="tb">${btns(BTN.basic)}${rich ? `<span class="sep"></span>${btns(BTN.rich)}` : ''}<span class="sep"></span>
          <button type="button" class="btn" id="imgBtn" title="Datei hochladen">🖼️ Datei</button><button type="button" class="btn" id="attBtn" title="Vorhandene Anhänge einfügen">📎 Anhänge</button><input type="file" id="imgFile" accept="image/*,application/pdf,audio/*,video/*" multiple hidden>
          <span class="tabs"><button type="button" class="btn small" id="mdToggle" aria-pressed="false" title="Markdown-Text anzeigen">Markdown</button></span>
        </div>
        <div class="status" id="encNote" hidden></div><div class="status" id="draftNote" hidden></div>
        <div class="editor-wrap"><textarea id="ed" spellcheck="true" placeholder="Schreib los … Mit [[ verlinkst du Personen, Notizen und andere Tage. Bilder und Dateien kannst du hineinziehen oder einfügen.">${encOn ? '' : esc(it.body || '')}</textarea>
          <div class="ac" id="ac" hidden></div></div>
        <div class="row-flex" style="margin-top:14px"><span class="muted small-text">Strg/Cmd + S speichert · <code>[[Name]]</code> verlinkt · <code>#tag</code> taggt · <code>![[bild.png|300]]</code> bettet Dateien ein</span></div>
      </form>`;
    const ta = $('#ed'), ac = $('#ac');
    let bodyLocked = false;
    const live = M.liveEditor({ ta, wrap: $('.editor-wrap'), isAcOpen: () => !ac.hidden, onChange: () => M.dirty(true), onInput: () => updateAc() });
    if (encOn) { bodyLocked = true; live.setLocked(true); }
    $('#tb').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); }); // Fokus/Auswahl im Text behalten
    const touch = () => ta.dispatchEvent(new Event('input', { bubbles: true }));
    R.bind($('#edForm'), reps);
    if (type === 'person' && $('#f_name')) { // ähnliche Namen anzeigen
      const note = document.createElement('div'); note.className = 'status'; note.hidden = true; $('#f_name').parentElement.appendChild(note);
      $('#f_name').addEventListener('change', async () => {
        const v = $('#f_name').value.trim(); if (v.length < 3) { note.hidden = true; return; }
        try { const l = await api('/api/duplicates?name=' + enc(v) + (it.slug ? '&except=' + enc(it.slug) : '')); note.hidden = !l.length; note.innerHTML = l.length ? '⚠️ Ähnliche Person' + (l.length > 1 ? 'en' : '') + ' vorhanden: ' + l.slice(0, 4).map((p) => `<a href="#/person/${enc(p.slug)}" target="_blank" rel="noopener">${esc(p.title)}</a>`).join(', ') : ''; } catch (e) { note.hidden = true; }
      });
    }
    if ($('#plRepick')) {
      const hint = () => { const l = (meta.places || []).filter((p) => p && p.region); $('#plHint').textContent = l.length ? '✓ ' + l.map((p) => `${p.name} (${p.region})`).join(' · ') : ''; };
      hint();
      $('#plRepick').addEventListener('click', async () => {
        const list = M.map.placesFrom($('#f_places').value, null);
        if (!list) { toast('Noch keine Orte eingetragen'); return; }
        if (!M.map.online()) { toast('Dafür die Online-Karte in den Einstellungen aktivieren', 'err'); return; }
        await M.map.fillPlaces(list); meta.places = list; hint(); toast('Orte aktualisiert');
      });
    }
    if ($('#fam_mother')) {
      const self = () => nz($('#f_name').value);
      for (const [id, multi] of [['fam_mother', 0], ['fam_father', 0], ['fam_partner', 1], ['fam_kids', 1], ['fam_sibs', 1]]) M.family.suggest($('#' + id), () => personNames.filter((n) => nz(n) !== self()), multi);
    }
    if ($('#famOn')) $('#famOn').addEventListener('change', (e) => { $('#famFields').hidden = !e.target.checked; });
    const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const lsSet = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* egal */ } };

    /* ---- Verschlüsselung ---- */
    const encNote = $('#encNote');
    const unlockBody = async () => {
      encNote.hidden = false; encNote.innerHTML = '🔒 Dieser Text ist verschlüsselt. <button type="button" class="btn small" id="unlockBtn">Entsperren</button>';
      $('#unlockBtn').addEventListener('click', unlockBody);
      bodyLocked = true; live.setLocked(true);
      if (!(await M.crypt.ensure(false))) return;
      try { const txt = await M.crypt.decrypt(it.body); bodyLocked = false; live.setLocked(false); await live.setBody(txt); encNote.hidden = true; live.focus(); } catch (e) { toast(e.message, 'err'); }
    };
    if (encOn) unlockBody();
    $('#encOn').addEventListener('change', async (e) => {
      if (e.target.checked) { if (!(await M.crypt.ensure(true))) { e.target.checked = false; return; } encOn = true; lsSet(draftKey, null); toast('Wird beim Speichern verschlüsselt'); }
      else if (confirm('Der Text wird danach unverschlüsselt gespeichert. Fortfahren?')) encOn = false; else e.target.checked = true;
    });

    /* ---- Entwurf (geht nicht verloren, auch offline) ---- */
    const draftNote = $('#draftNote');
    if (!encOn) {
      try {
        const d = JSON.parse(lsGet(draftKey) || 'null');
        if (d && d.body !== (it.body || '') && d.t > (it.mtime || 0)) {
          draftNote.hidden = false;
          draftNote.innerHTML = `📝 Ungespeicherter Entwurf von ${new Date(d.t).toLocaleString('de-DE')} gefunden. <button type="button" class="btn small" id="dr1">Wiederherstellen</button> <button type="button" class="btn small" id="dr2">Verwerfen</button>`;
          $('#dr1').addEventListener('click', () => { live.setBody(d.body); draftNote.hidden = true; markDirty(); });
          $('#dr2').addEventListener('click', () => { lsSet(draftKey, null); draftNote.hidden = true; });
        }
      } catch (e) { /* kaputter Entwurf */ }
    }
    let draftTimer;
    $('.editor-wrap').addEventListener('input', () => { if (encOn) return; clearTimeout(draftTimer); draftTimer = setTimeout(() => lsSet(draftKey, JSON.stringify({ body: live.getBody(), t: Date.now() })), 1200); });
    M.onLeave(() => clearTimeout(draftTimer));

    /* ---- Wetter & Ort ---- */
    const wcfg = M.state.settings.weather || {};
    const fillWeather = async (coords, quiet) => {
      try {
        const date = it.date || todayStr();
        const q = coords ? `lat=${coords.lat}&lon=${coords.lon}&` : '';
        const w = await api(`/api/weather?${q}date=${date}`);
        $('#f_weather').value = w.text; markDirty();
      } catch (e) { if (!quiet) toast(e.message, 'err'); }
    };
    if ($('#wxBtn')) {
      $('#wxBtn').addEventListener('click', () => fillWeather(null, false));
      $('#locBtn').addEventListener('click', () => {
        if (!navigator.geolocation) return toast('Standortbestimmung wird von diesem Browser nicht unterstützt', 'err');
        toast('Standort wird bestimmt …');
        navigator.geolocation.getCurrentPosition(async (pos) => {
          const c = { lat: pos.coords.latitude.toFixed(4), lon: pos.coords.longitude.toFixed(4) };
          try { const r = await api(`/api/reverse?lat=${c.lat}&lon=${c.lon}`); $('#f_location').value = r.name; markDirty(); } catch (e) { toast(e.message, 'err'); }
          if (!$('#f_weather').value) fillWeather(c, true);
        }, (err) => toast(err.code === 1 ? 'Standortzugriff wurde abgelehnt' : 'Standort konnte nicht bestimmt werden', 'err'), { timeout: 10000 });
      });
      if (wcfg.auto && wcfg.lat != null && (it.isNew || !it.meta.weather)) {
        if (!$('#f_weather').value) fillWeather(null, true);
        if (!$('#f_location').value && wcfg.city) $('#f_location').value = wcfg.city;
      }
    }
    if ($('#histBtn')) $('#histBtn').addEventListener('click', () => M.openHistory(it));
    const markDirty = () => { M.dirty(true); };
    $('#edForm').addEventListener('input', markDirty);

    $$('#moodRow .mood-btn').forEach((b) => b.addEventListener('click', () => { mood = mood === +b.dataset.mood ? null : +b.dataset.mood; $$('#moodRow .mood-btn').forEach((x) => x.classList.toggle('sel', +x.dataset.mood === mood)); markDirty(); }));
    $$('#energyRow .energy-btn').forEach((b) => b.addEventListener('click', () => { energy = energy === +b.dataset.energy ? null : +b.dataset.energy; $$('#energyRow .energy-btn').forEach((x) => x.classList.toggle('sel', +x.dataset.energy === energy)); markDirty(); }));
    const sl = $('#songLook'); if (sl) sl.addEventListener('click', () => lookupSong($('#f_song_url'), $('#f_song')));

    if (type === 'person') {
      $('#photoFile').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { const r = await uploadFile(f); photo = r.name; $('#photoPrev').innerHTML = `<img class="avatar big" src="${r.url}" alt="">`; $('#photoDel').hidden = false; invalidate(); markDirty(); } catch (err) { toast(err.message, 'err'); }
      });
      $('#photoDel').addEventListener('click', () => { photo = ''; $('#photoPrev').innerHTML = avatar({ title: $('#f_name').value || '?' }, true); $('#photoDel').hidden = true; markDirty(); });
    }

    /* ---- Formatierung ---- */
    const setSel = (s, e) => ta.setSelectionRange(s, e);
    const wrapSel = (a, z) => {
      live.ensureActive();
      const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, sel = v.slice(s, e);
      ta.focus();
      if (v.slice(s - a.length, s) === a && v.slice(e, e + z.length) === z) { ta.setRangeText(sel, s - a.length, e + z.length, 'end'); setSel(s - a.length, s - a.length + sel.length); }
      else { ta.setRangeText(a + sel + z, s, e, 'end'); setSel(s + a.length, s + a.length + sel.length); }
      touch();
    };
    const prefixLines = (p) => {
      live.ensureActive();
      const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
      const ls = v.lastIndexOf('\n', s - 1) + 1; let le = v.indexOf('\n', e); if (le < 0) le = v.length;
      const lines = v.slice(ls, le).split('\n');
      const all = lines.every((l) => l.startsWith(p));
      const out = lines.map((l) => (all ? l.slice(p.length) : p.startsWith('#') ? p + l.replace(/^#{1,6} /, '') : p + l)).join('\n');
      ta.focus(); ta.setRangeText(out, ls, le, 'end'); setSel(ls, ls + out.length); touch();
    };
    const insertLink = () => {
      live.ensureActive();
      const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || 'Text';
      ta.focus(); ta.setRangeText(`[${sel}](https://)`, s, e, 'end'); const st = s + sel.length + 3; setSel(st, st + 8); touch();
    };
    const insert = (text) => { if (live.mode === 'live') { live.insertMd(text.trim()); return; } ta.focus(); ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); touch(); };
    const all = [...BTN.basic, ...(rich ? BTN.rich : [])];
    $$('#tb [data-b]').forEach((el) => el.addEventListener('click', () => {
      const b = all.find((x) => x.id === el.dataset.b); if (!b) return;
      if (live.mode === 'live') { live.exec(b.id); return; }
      if (b.wrap) wrapSel(...b.wrap); else if (b.line) prefixLines(b.line); else if (b.link) insertLink(); else if (b.snippet) insert(b.snippet);
    }));
    ta.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); wrapSel('**', '**'); } else if (k === 'i') { e.preventDefault(); wrapSel('*', '*'); }
      else if (rich && k === 'e') { e.preventDefault(); wrapSel('`', '`'); } else if (rich && k === 'k') { e.preventDefault(); insertLink(); }
    });

    /* ---- Dateien ---- */
    const insertFiles = async (files) => {
      for (const f of files) { try { const r = await uploadFile(f); insert(r.markdown + '\n'); invalidate(); toast(`Gespeichert in attachments/${r.folder}`); } catch (err) { toast(err.message, 'err'); } }
    };
    $('#imgBtn').addEventListener('click', () => $('#imgFile').click());
    $('#imgFile').addEventListener('change', (e) => { insertFiles([...e.target.files]); e.target.value = ''; });
    ta.addEventListener('paste', (e) => { const fs = [...(e.clipboardData ? e.clipboardData.files : [])].filter((f) => /^(image|audio|video)\//.test(f.type) || f.type === 'application/pdf'); if (fs.length) { e.preventDefault(); insertFiles(fs); } });
    ta.addEventListener('dragover', (e) => { e.preventDefault(); ta.classList.add('dropping'); });
    ta.addEventListener('dragleave', () => ta.classList.remove('dropping'));
    ta.addEventListener('drop', (e) => { e.preventDefault(); ta.classList.remove('dropping'); const fs = [...e.dataTransfer.files]; if (fs.length) insertFiles(fs); });
    const liveBox = $('#live');
    liveBox.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    liveBox.addEventListener('drop', (e) => { const fs = [...(e.dataTransfer ? e.dataTransfer.files : [])]; if (!fs.length) return; e.preventDefault(); insertFiles(fs); });
    liveBox.addEventListener('paste', (e) => { const fs = [...(e.clipboardData ? e.clipboardData.files : [])].filter((f) => /^(image|audio|video)\//.test(f.type) || f.type === 'application/pdf'); if (fs.length) { e.preventDefault(); insertFiles(fs); } });
    $('#attBtn').addEventListener('click', async () => {
      let list; try { list = await api('/api/attachments'); } catch (e) { return toast(e.message, 'err'); }
      const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.dataset.closable = '1';
      const render = (f = '') => {
        const rows = list.filter((a) => !f || a.name.toLowerCase().includes(f));
        const groups = new Map(); rows.forEach((a) => { const k = a.folder || '(Wurzel)'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); });
        $('.att-body', bg).innerHTML = rows.length ? [...groups].map(([k, arr]) => `<div class="att-folder">attachments/${esc(k)} <span class="muted">(${arr.length})</span></div><div class="att-grid">${arr.map((a) => `<button type="button" class="att" data-n="${esc(a.name)}">${a.kind === 'image' ? `<img src="${a.url}" alt="" loading="lazy">` : `<div class="ph">${a.kind === 'pdf' ? '📄' : a.kind === 'audio' ? '🎧' : '🎬'}</div>`}<span>${esc(a.name)}</span></button>`).join('')}</div>`).join('') : '<div class="empty">Keine Anhänge gefunden.</div>';
      };
      bg.innerHTML = '<div class="modal"><div class="row-flex"><h2 style="margin:0">Anhänge</h2><span class="spacer"></span><input type="search" placeholder="Filtern…" style="max-width:200px" id="attq"><button type="button" class="btn small" id="attX">Schließen</button></div><div class="att-body"></div></div>';
      document.body.appendChild(bg); render();
      $('#attq', bg).addEventListener('input', (e) => render(e.target.value.toLowerCase()));
      const close = () => bg.remove();
      $('#attX', bg).addEventListener('click', close); bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
      bg.addEventListener('click', (e) => { const b = e.target.closest('.att'); if (b) { insert(`![[${b.dataset.n}]]\n`); close(); } });
    });

    /* ---- Markdown-Ansicht (Standard: formatierter Text) ---- */
    const setMd = (on, keep) => {
      live.setMode(on ? 'md' : 'live'); ac.hidden = true;
      const b = $('#mdToggle'); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('primary', on);
      $('.editor-wrap').classList.toggle('is-md', on);
      if (!keep) lsSet('edmd', on ? '1' : null);
    };
    $('#mdToggle').addEventListener('click', () => setMd($('#mdToggle').getAttribute('aria-pressed') !== 'true'));
    if (lsGet('edmd') === '1') setMd(true, true);

    /* ---- [[-Autovervollständigung ---- */
    let matches = [], active = 0, start = -1;
    const closeAc = () => { ac.hidden = true; matches = []; start = -1; };
    const renderAc = () => {
      ac.innerHTML = matches.map((m, i) => `<div class="ac-item ${i === active ? 'on' : ''}" data-i="${i}"><span class="ac-type">${m.isNew ? '＋' : TYPE[m.type].ic}</span><span>${m.isNew ? 'Neu: ' : ''}${esc(m.label)}</span></div>`).join('');
      ac.hidden = !matches.length;
    };
    let wctx = null;
    const chooseAc = (i) => {
      const m = matches[i]; if (!m) return;
      if (live.mode === 'live') { const c = wctx; closeAc(); if (c) live.applyWiki(c, m.insert); return; }
      const pos = ta.selectionStart;
      const hasClose = ta.value.slice(pos, pos + 2) === ']]';
      ta.setRangeText(m.insert + (hasClose ? '' : ']]'), start, hasClose ? pos + 2 : pos, 'end'); if (hasClose) setSel(start + m.insert.length + 2, start + m.insert.length + 2);
      closeAc(); ta.focus(); markDirty();
    };
    function updateAc() {
      let q;
      if (live.mode === 'live') { wctx = live.wikiContext(); if (!wctx) { closeAc(); return; } q = wctx.q.toLowerCase().trim(); start = 0; }
      else {
        const pos = ta.selectionStart, mm = ta.value.slice(0, pos).match(/\[\[([^\[\]\n|]*)$/);
        if (!mm) { closeAc(); return; }
        start = pos - mm[1].length; q = mm[1].toLowerCase().trim(); wctx = { q: mm[1] };
      }
      const score = (i) => { const n = [i.title, ...(i.aliases || [])].map((x) => x.toLowerCase()); return (n.some((x) => x === q) ? 0 : n.some((x) => x.startsWith(q)) ? 1 : 2) * 10 + (i.type === 'person' ? 0 : i.type === 'note' ? 1 : 2); };
      matches = items.filter((i) => !q || [i.title, ...(i.aliases || [])].some((x) => x.toLowerCase().includes(q)))
        .sort((a, b) => score(a) - score(b) || (b.date || '').localeCompare(a.date || '')).slice(0, 8)
        .map((i) => ({ type: i.type, label: i.type === 'journal' ? (i.date ? fmtShort(i.date) + (i.title !== i.slug ? ' – ' + i.title : '') : i.title) : i.title, insert: i.type === 'journal' ? i.slug : i.title }));
      if (q && !matches.some((m) => m.insert.toLowerCase() === q)) matches.push({ isNew: true, label: wctx.q.trim(), insert: wctx.q.trim() });
      active = 0; renderAc();
    }
    ta.addEventListener('input', updateAc); ta.addEventListener('click', updateAc); ta.addEventListener('blur', () => setTimeout(closeAc, 150));
    liveBox.addEventListener('click', updateAc); liveBox.addEventListener('blur', () => setTimeout(closeAc, 150));
    const acKey = (e) => {
      if (ac.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % matches.length; renderAc(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + matches.length) % matches.length; renderAc(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); chooseAc(active); }
      else if (e.key === 'Escape') { e.preventDefault(); closeAc(); }
      else return;
      e.stopImmediatePropagation();
    };
    ta.addEventListener('keydown', acKey); liveBox.addEventListener('keydown', acKey, true);
    ac.addEventListener('mousedown', (e) => { e.preventDefault(); const t = e.target.closest('.ac-item'); if (t) chooseAc(+t.dataset.i); });

    /* ---- Speichern ---- */
    const collect = () => {
      const out = {};
      for (const f of defs) {
        const el = $('#f_' + f.k); let v = f.t === 'date' ? M.readDate(el) : el.value.trim();
        if (f.t === 'places') v = M.map.placesFrom(v, meta.places);
        else if (f.t === 'list') v = v ? v.split(/[,\n]/).map((x) => x.trim().replace(/^#/, '')).filter(Boolean) : null;
        else if (f.t === 'number') v = v === '' ? null : Number(v);
        else if (v === '') v = null;
        out[f.k] = v;
      }
      if (type === 'journal' && feat('mood')) { out.mood = mood; out.energy = energy; }
      if (type === 'person') {
        out.photo = photo || null;
        for (const x of reps) out[x.key] = R.collect($('#edForm'), x);
        { const h = (out.addr_home || []).map((x) => ({ ...x, home: true })), mo = (out.addr_more || []).map((x) => { const y = { ...x }; delete y.home; return y; }); delete out.addr_home; delete out.addr_more; out.addresses = [...h, ...mo].length ? [...h, ...mo] : null; }
        out.phone = null; out.email = null; out.address = null; // jetzt in den Listen
        const split = (id) => $('#' + id).value.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
        const mk = (type, name, extra) => { const o = { ...(famKeep.get(type + '|' + nz(name)) || {}), person: name, type, ...(extra || {}) }; return o; };
        const fam = [];
        const mom = $('#fam_mother').value.trim(), dad = $('#fam_father').value.trim();
        if (mom) fam.push(mk('Elternteil', mom, { role: 'Mutter' }));
        if (dad) fam.push(mk('Elternteil', dad, { role: 'Vater' }));
        for (const n of split('fam_partner')) { const ex = /\(\s*ex\s*\)\s*$/i.test(n); const name = n.replace(/\(\s*ex\s*\)\s*$/i, '').trim(); const o = mk('Partner', name); if (ex) o.ex = true; else delete o.ex; fam.push(o); }
        for (const n of split('fam_kids')) fam.push(mk('Kind', n));
        for (const n of split('fam_sibs')) fam.push(mk('Geschwister', n));
        out.relations = [...(out.relations || []), ...fam];
      }
      return out;
    };
    let saving = false;
    const save = async (force) => {
      if (saving) return; saving = true;
      try {
        const m = collect(); let slug = it.slug, outType = type;
        if (type === 'person') {
          if ((m.addresses || []).filter((a) => a.home).length > 1) { toast('Es kann nur einen aktuellen Wohnort geben – bitte nur eine Adresse ankreuzen.', 'err'); saving = false; return; }
          await M.map.fillPlaces(m.places); // neue Orte automatisch suchen (nur mit aktivierter Online-Karte)
        }
        if (type === 'person' && !m.name) { toast('Bitte einen Namen angeben', 'err'); saving = false; return; }
        if (type === 'person') { // unbekannte Familienmitglieder anlegen
          const me = nz(m.name); const made = [];
          for (const r of m.relations || []) {
            if (!['Elternteil', 'Kind', 'Partner', 'Geschwister'].includes(r.type)) continue;
            if (nz(r.person) === me) { toast('Eine Person kann nicht mit sich selbst verwandt sein.', 'err'); saving = false; return; }
            const p = await M.family.ensurePerson(r.person, r.role === 'Mutter' ? 'w' : r.role === 'Vater' ? 'm' : '');
            if (p.created) made.push(p.title); r.person = p.title;
          }
          if (made.length) toast(`Neu angelegt: ${made.join(', ')}`);
          const pm = (m.relations || []).find((r) => r.type === 'Elternteil' && r.role === 'Mutter'), pf = (m.relations || []).find((r) => r.type === 'Elternteil' && r.role === 'Vater');
          if (pm && pf) { // Mutter und Vater sind (mindestens) ein Paar – automatisch eintragen, falls noch nichts besteht
            try {
              const its = await getItems(); const A = its.find((i) => i.type === 'person' && nz(i.title) === nz(pm.person)), B = its.find((i) => i.type === 'person' && nz(i.title) === nz(pf.person));
              if (A && B && A.slug !== B.slug) {
                const da = await api(`/api/item/person/${enc(A.slug)}`), db = await api(`/api/item/person/${enc(B.slug)}`);
                const has = (d, other) => (d.meta.relations || []).some((r) => nz(r.person) === nz(other) && ['Partner', 'Ehepartner'].includes(r.type));
                if (!has(da, B.title) && !has(db, A.title)) await M.family.addRelation(A.slug, { person: B.title, type: 'Partner' });
              }
            } catch (e) { /* nicht kritisch */ }
          }
        }
        let bodyOut = live.getBody();
        if (encOn) {
          if (bodyLocked) { toast('Bitte zuerst entsperren', 'err'); saving = false; return; }
          if (!(await M.crypt.ensure(true))) { saving = false; return; }
          bodyOut = await M.crypt.encrypt(bodyOut); m.encrypted = true;
        } else m.encrypted = null;
        if (it.isNew) {
          const r = await api('/api/item/journal', { method: 'POST', body: { date: m.date || it.date, meta: m, body: bodyOut } });
          if (r.existed) { toast('Für diesen Tag existiert schon ein Eintrag – Seite neu laden.', 'err'); saving = false; return; }
          slug = r.slug;
        } else {
          const r = await api(`/api/item/${type}/${enc(it.slug)}`, { method: 'PUT', body: { meta: m, body: bodyOut, baseMtime: it.mtime, force: !!force } });
          if (r.slug) slug = r.slug;
          const to = $('#f_typeSwitch') ? $('#f_typeSwitch').value : type;
          if (to !== type) { const c = await api(`/api/item/${type}/${enc(slug)}/convert`, { method: 'POST', body: { to, date: to === 'journal' ? m.date || null : null } }); outType = c.type; slug = c.slug; }
        }
        M.dirty(false); lsSet(draftKey, null); invalidate(); toast('Gespeichert ✓'); go(`#/${outType}/${enc(slug)}`);
      } catch (err) {
        if (err.data && err.data.conflict && confirm(err.message + '\n\nTrotzdem überschreiben?')) { saving = false; return save(true); }
        toast(err.status ? err.message : 'Keine Verbindung – dein Text bleibt als Entwurf auf diesem Gerät erhalten.', 'err');
      }
      saving = false;
    };
    $('#edForm').addEventListener('submit', (e) => { e.preventDefault(); save(false); });
    $('#edForm').addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); } });
    $('#cancelBtn').addEventListener('click', () => { M.dirty(false); lsSet(draftKey, null); go(it.isNew ? '#/journal' : `#/${type}/${enc(it.slug)}`); });
    if ((it.isNew || type === 'journal') && !encOn) live.focus();
  }

  M.editor = editor;

})();
