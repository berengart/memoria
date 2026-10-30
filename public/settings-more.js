'use strict';
/* Einstellungen: Sync & Konflikte, Erinnerungen, Wetter & Ort, Daten (Import/Backup), Sicherheit, Verwaltung */
(() => {
  const M = window.M;
  const { $, $$, esc, enc, api, toast } = M;
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 'err'); } };
  const save = (patch) => M.saveSettings(patch);
  const fmtTime = (t) => (t ? new Date(t).toLocaleString('de-DE') : '–');
  const sw = (id, on, title, small) => `<label class="sw-row"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span><b>${title}</b>${small ? `<small>${small}</small>` : ''}</span></label>`;
  const T = M.settingsTabs;

  /* ============================================================== Sync */
  function tabSync(el) {
    const s = M.state.settings.sync;
    el.innerHTML = `
      <section class="card"><h2>WebDAV-Synchronisierung</h2>
        <p class="muted">Gleicht Personen, Tagebuch, Notizen, Vorlagen und Anhänge mit einem WebDAV-Ordner ab (z. B. Nextcloud, ownCloud, Synology). Das Passwort wird verschlüsselt gespeichert. Tipp: bei Nextcloud ein App-Passwort verwenden.</p>
        <div class="form-grid">
          <div class="field wide"><label for="sUrl">WebDAV-Adresse</label><input id="sUrl" value="${esc(s.url)}" placeholder="https://cloud.example.org/remote.php/dav/files/name/"></div>
          <div class="field"><label for="sUser">Benutzername</label><input id="sUser" value="${esc(s.username)}" autocomplete="off"></div>
          <div class="field"><label for="sPw">Passwort</label><input id="sPw" type="password" autocomplete="new-password" placeholder="${s.hasPassword ? '•••••••• (gespeichert)' : ''}"></div>
          <div class="field"><label for="sPath">Zielordner</label><input id="sPath" value="${esc(s.remotePath)}"></div>
          <div class="field"><label for="sMode">Richtung</label><select id="sMode">
            <option value="bidirectional" ${s.mode === 'bidirectional' ? 'selected' : ''}>Beidseitig abgleichen</option>
            <option value="push" ${s.mode === 'push' ? 'selected' : ''}>Lokal ist Quelle → WebDAV (Ziel)</option>
            <option value="pull" ${s.mode === 'pull' ? 'selected' : ''}>WebDAV ist Quelle → lokal (Ziel)</option></select></div>
          <div class="field"><label for="sPolicy">Bei Konflikten (beidseitig geändert)</label><select id="sPolicy">
            <option value="newer" ${s.conflictPolicy === 'newer' ? 'selected' : ''}>Neuere Datei gewinnt</option>
            <option value="local" ${s.conflictPolicy === 'local' ? 'selected' : ''}>Lokale Fassung gewinnt</option>
            <option value="remote" ${s.conflictPolicy === 'remote' ? 'selected' : ''}>WebDAV-Fassung gewinnt</option></select><small>Die unterlegene Fassung geht nie verloren – du findest sie unten unter „Konflikte“.</small></div>
          <div class="field"><label for="sAuto">Automatisch alle … Minuten (0 = aus)</label><input id="sAuto" type="number" min="0" max="1440" value="${s.autoMinutes}"></div>
          ${sw('sOn', s.enabled, 'Automatische Synchronisierung aktiv', 'Läuft im Hintergrund im eingestellten Intervall.')}
        </div>
        <div class="row-flex"><button class="btn primary" id="sSave">Speichern</button><button class="btn" id="sTest">Verbindung testen</button><button class="btn" id="sRun">Jetzt synchronisieren</button><button class="btn ghost" id="sForce" hidden>Trotzdem ausführen</button><span class="spacer"></span><button class="btn small ghost" id="sReset" title="Merkt sich nicht mehr, was synchron war">Zustand zurücksetzen</button></div>
        <div id="sStatus"></div></section>
      <section class="card"><h2>Konflikte <span class="muted small-text" id="cCount"></span></h2><div id="cBody">Lade …</div></section>`;
    const collect = () => ({ sync: { url: $('#sUrl').value, username: $('#sUser').value, password: $('#sPw').value, remotePath: $('#sPath').value, mode: $('#sMode').value, conflictPolicy: $('#sPolicy').value, autoMinutes: +$('#sAuto').value || 0, enabled: $('#sOn').checked } });
    const saveCfg = async () => { await save(collect()); $('#sPw').value = ''; $('#sPw').placeholder = '•••••••• (gespeichert)'; };
    const show = (st) => {
      const box = $('#sStatus');
      if (st && st.running) { box.innerHTML = '<div class="status">⏳ Synchronisierung läuft …</div>'; return; }
      const l = st && st.last; if (!l) { box.innerHTML = '<p class="muted">Noch nicht synchronisiert.</p>'; return; }
      $('#sForce').hidden = !l.needsForce;
      const sum = l.error ? esc(l.error) : `↑ ${l.uploaded} hochgeladen · ↓ ${l.downloaded} geladen · ✕ ${l.deletedLocal + l.deletedRemote} gelöscht · ⚠ ${l.conflicts} Konflikte${l.errors.length ? ` · ${l.errors.length} Fehler` : ''}`;
      box.innerHTML = `<div class="status ${l.ok ? '' : 'bad'}"><b>${l.ok ? '✓' : '✗'} ${fmtTime(l.at)}</b><br>${sum}</div>${l.log && l.log.length ? `<details style="margin-top:10px"><summary>Protokoll</summary><div class="log">${esc(l.log.join('\n'))}</div></details>` : ''}`;
    };
    let poll;
    const refresh = async () => {
      try { const st = await api('/api/sync/status'); show(st); if (st.running) poll = setTimeout(refresh, 1200); else loadConflicts(); } catch (e) { /* egal */ }
    };
    M.onLeave(() => clearTimeout(poll));
    $('#sSave').addEventListener('click', guard(async () => { await saveCfg(); toast('Gespeichert ✓'); }));
    $('#sTest').addEventListener('click', guard(async () => {
      const c = collect().sync; const r = await api('/api/sync/test', { method: 'POST', body: { url: c.url, username: c.username, password: c.password, remotePath: c.remotePath } });
      $('#sStatus').innerHTML = `<div class="status">✓ ${esc(r.message)}</div>`;
    }));
    const run = (force) => guard(async () => { await saveCfg(); $('#sForce').hidden = true; await api('/api/sync/run', { method: 'POST', body: { force } }); show({ running: true }); clearTimeout(poll); poll = setTimeout(refresh, 800); M.invalidate(); });
    $('#sRun').addEventListener('click', run(false));
    $('#sForce').addEventListener('click', run(true));
    $('#sReset').addEventListener('click', guard(async () => { if (!confirm('Synchronisierungszustand zurücksetzen? Beim nächsten Lauf werden alle Dateien neu verglichen.')) return; await api('/api/sync/reset', { method: 'POST' }); toast('Zurückgesetzt'); refresh(); }));

    /* ---- Konflikte ---- */
    async function loadConflicts() {
      const list = await api('/api/sync/conflicts');
      $('#cCount').textContent = list.length ? `(${list.length})` : '';
      $('#cBody').innerHTML = list.length ? list.map((c) => `<div class="row" data-c="${c.id}"><span class="row-ic">⚠️</span><div class="row-main"><div class="row-title">${esc(c.path)}</div><div class="row-sub">${esc(fmtTime(c.at))} · ${c.winner === 'remote' ? 'WebDAV-Fassung wurde übernommen, deine lokale ist hier gesichert' : 'Lokale Fassung wurde übernommen, die WebDAV-Fassung ist hier gesichert'}</div></div><button class="btn small" data-cmp="${c.id}">Vergleichen</button></div><div id="cd-${c.id}"></div>`).join('') : '<div class="empty">Keine Konflikte. 🎉</div>';
      $$('[data-cmp]').forEach((b) => b.addEventListener('click', guard(async () => {
        const id = b.dataset.cmp, box = $('#cd-' + id);
        if (box.innerHTML) { box.innerHTML = ''; return; }
        const d = await api('/api/sync/conflicts/' + id);
        box.innerHTML = `<div class="card" style="margin:8px 0">${d.binary ? `<p class="muted">Binärdatei: aktuell ${d.currentSize} Byte, gesicherte Fassung ${d.otherSize} Byte.</p>` : `<p class="small-text muted">− aktuelle Fassung · + gesicherte (unterlegene) Fassung</p>${M.diffHTML(M.diffLines(d.current || '', d.other || ''))}`}
          <div class="row-flex" style="margin-top:10px"><button class="btn primary small" data-use="${id}">Gesicherte Fassung übernehmen</button><button class="btn small" data-drop="${id}">Verwerfen</button></div></div>`;
        const act = (a) => guard(async () => { await api(`/api/sync/conflicts/${id}/resolve`, { method: 'POST', body: { action: a } }); M.invalidate(); toast(a === 'dismiss' ? 'Verworfen' : 'Übernommen ✓ – wird beim nächsten Sync abgeglichen'); loadConflicts(); });
        box.querySelector('[data-use]').addEventListener('click', act('use-other')); box.querySelector('[data-drop]').addEventListener('click', act('dismiss'));
      })));
    }
    refresh(); loadConflicts().catch(() => {});
  }

  /* ======================================================= Erinnerungen */
  function tabNotify(el) {
    const n = M.state.settings.notify;
    el.innerHTML = `
      <section class="card"><h2>Erinnerungen</h2>
        <p class="muted">Täglich eine Zusammenfassung (Geburtstage, „Mal wieder melden“) und optional ein Hinweis, wenn du heute noch nichts ins Tagebuch geschrieben hast. Zustellung per E-Mail, Push (<a href="https://ntfy.sh" target="_blank" rel="noopener noreferrer">ntfy</a>-App fürs Handy) oder Webhook.</p>
        <div class="form-grid">
          ${sw('nOn', n.enabled, 'Erinnerungen aktiv')}
          <div class="field"><label for="nTime">Tägliche Zusammenfassung um</label><input type="text" id="nTime" value="${esc(n.time)}" inputmode="numeric" placeholder="HH:MM" pattern="[0-2]?[0-9][:.][0-5][0-9]" maxlength="5" style="max-width:110px"> <span class="muted small-text">24-Stunden-Format</span></div>
          <div class="field"><label for="nDays">Geburtstage ankündigen ab … Tagen vorher</label><input type="number" id="nDays" min="0" max="30" value="${n.daysBefore}"></div>
          ${sw('nBd', n.birthdays, 'Geburtstage')}${sw('nCo', n.contacts, '„Mal wieder melden“')}${sw('nOt', n.onThisDay, 'An diesem Tag (frühere Jahre)')}
          ${sw('nJo', n.journal, 'Tagebuch-Erinnerung', 'Nur, wenn für heute noch kein Eintrag geschrieben wurde.')}
          <div class="field"><label for="nJt">Tagebuch-Erinnerung um</label><input type="text" id="nJt" value="${esc(n.journalTime)}" inputmode="numeric" placeholder="HH:MM" pattern="[0-2]?[0-9][:.][0-5][0-9]" maxlength="5" style="max-width:110px"> <span class="muted small-text">24-Stunden-Format</span></div>
        </div></section>
      <section class="card"><h2>Kanäle</h2><div class="form-grid">
        <div class="field wide"><label for="nMail">E-Mail-Adresse</label><input type="email" id="nMail" value="${esc(n.email)}" placeholder="du@example.org"><small>${M.state.smtp ? '✓ Der Mailserver ist eingerichtet.' : '⚠ Kein Mailserver eingerichtet – in der docker-compose.yml SMTP_HOST, SMTP_USER, SMTP_PASSWORD und SMTP_FROM setzen.'}</small></div>
        <div class="field wide"><label for="nNtfy">ntfy-Adresse inkl. Thema</label><input id="nNtfy" value="${esc(n.ntfyUrl)}" placeholder="https://ntfy.sh/mein-geheimes-thema"><small>Ein schwer zu erratendes Thema wählen; in der ntfy-App abonnieren.</small></div>
        <div class="field"><label for="nTok">ntfy-Zugriffstoken (optional)</label><input id="nTok" type="password" autocomplete="new-password" placeholder="${n.hasToken ? '•••••••• (gespeichert)' : ''}"></div>
        <div class="field"><label for="nHook">Webhook (JSON per POST)</label><input id="nHook" value="${esc(n.webhookUrl)}" placeholder="https://…"></div>
        <div class="field wide"><label for="nBase">Adresse dieser Memoria-Installation (für Links in Nachrichten)</label><input id="nBase" value="${esc(n.baseUrl)}" placeholder="https://memoria.example.org"></div>
      </div>
      <div class="row-flex"><button class="btn primary" id="nSave">Speichern</button><button class="btn" id="nTest">Testnachricht senden</button><button class="btn" id="nDigest">Zusammenfassung jetzt senden</button></div>
      <div id="nRes"></div></section>`;
    const tm = (id) => { const v = M.parseTime($(id).value); if (v === null) throw Object.assign(new Error('Bitte die Uhrzeit als HH:MM (24 Stunden) eingeben.'), { status: 400 }); return v; };
    const collect = () => ({ notify: { enabled: $('#nOn').checked, time: tm('#nTime'), daysBefore: +$('#nDays').value || 0, birthdays: $('#nBd').checked, contacts: $('#nCo').checked, onThisDay: $('#nOt').checked, journal: $('#nJo').checked, journalTime: tm('#nJt'), email: $('#nMail').value, ntfyUrl: $('#nNtfy').value, ntfyToken: $('#nTok').value, webhookUrl: $('#nHook').value, baseUrl: $('#nBase').value } });
    const showRes = (r) => { $('#nRes').innerHTML = (r || []).map((x) => `<div class="status ${x.ok ? '' : 'bad'}">${x.ok ? '✓' : '✗'} ${esc(x.kind)}${x.error ? ': ' + esc(x.error) : ' – gesendet'}</div>`).join('') || '<div class="status">Nichts zu senden.</div>'; };
    $('#nSave').addEventListener('click', guard(async () => { await save(collect()); $('#nTok').value = ''; toast('Gespeichert ✓'); }));
    $('#nTest').addEventListener('click', guard(async () => { await save(collect()); showRes((await api('/api/notify/test', { method: 'POST', body: {} })).results); }));
    $('#nDigest').addEventListener('click', guard(async () => { await save(collect()); const r = await api('/api/notify/digest', { method: 'POST', body: {} }); showRes(r.results); }));
  }

  /* ========================================================= Wetter & Ort */
  function tabWeather(el) {
    const w = M.state.settings.weather;
    el.innerHTML = `
      <section class="card"><h2>Wetter & Ort</h2>
        <p class="muted">Trägt im Tagebuch auf Wunsch Wetter und Ort automatisch ein. Dafür werden Koordinaten an <b>Open-Meteo</b> (Wetter, Ortssuche) und für „Standort bestimmen“ an <b>OpenStreetMap/Nominatim</b> übertragen. Standardmäßig ist das aus.</p>
        ${sw('wOn', w.enabled, 'Wetter & Ort aktivieren')}
        ${sw('wAuto', w.auto, 'Neue Tagebucheinträge automatisch ausfüllen', 'Wetter und Wohnort werden beim Anlegen eines Eintrags vorbelegt (auch für vergangene Tage).')}
        <div class="field" style="margin-top:12px"><label for="wCity">Wohnort</label>
          <div class="row-flex"><input id="wCity" value="${esc(w.city)}" placeholder="Stadt suchen …" style="max-width:280px"><button class="btn" id="wSearch">Suchen</button></div>
          <small id="wCur">${w.lat != null ? `Gewählt: ${esc(w.city)} (${(+w.lat).toFixed(2)}, ${(+w.lon).toFixed(2)})` : 'Noch kein Ort gewählt.'}</small></div>
        <div id="wRes"></div>
        <div class="row-flex" style="margin-top:8px"><button class="btn primary" id="wSave">Speichern</button><button class="btn" id="wTest">Wetter jetzt abrufen</button></div><div id="wOut"></div></section>
      <section class="card"><h2>🗺️ Karte & Adress-Suche</h2>
        <p class="muted">Zeigt Wohnort und Orte deiner Personen auf einer Karte (Menüpunkt „Karte“). Koordinaten kannst du auch selbst eintragen – das funktioniert immer, ohne dass etwas übertragen wird.</p>
        <p class="muted">Wenn du die <b>Online-Karte</b> einschaltest, werden (1) <b>Adressen</b> deiner Personen zum Suchen der Koordinaten an <b>OpenStreetMap/Nominatim</b> gesendet – nur wenn du 📍 klickst oder „Fehlende Orte suchen“ wählst – und (2) <b>Kartenkacheln</b> von <b>${esc((M.state.mapConfig && M.state.mapConfig.tileUrl || '').replace(/^(https?:\/\/[^/]+).*$/, '$1'))}</b> geladen, wobei dein Browser seine IP-Adresse, den angezeigten Kartenausschnitt und diese App-Adresse preisgibt. Der Kartenserver ist per <code>TILE_URL</code> in der docker-compose.yml änderbar (z. B. eigener Tile-Server).</p>
        ${sw('mOn', M.state.settings.map && M.state.settings.map.enabled, 'Online-Karte und Adress-Suche aktivieren')}
        <div class="row-flex" style="margin-top:8px"><button class="btn primary" id="mSave">Speichern</button></div></section>`;
    $('#mSave').addEventListener('click', guard(async () => { await save({ map: { enabled: $('#mOn').checked } }); toast('Gespeichert ✓'); }));

    let pick = { city: w.city, lat: w.lat, lon: w.lon };
    $('#wSearch').addEventListener('click', guard(async () => {
      await save({ weather: { enabled: true } }); $('#wOn').checked = true;
      const list = await api('/api/geocode?q=' + enc($('#wCity').value));
      $('#wRes').innerHTML = list.length ? list.map((r, i) => `<button type="button" class="preset" data-i="${i}" style="margin:4px 0;width:100%"><b>${esc(r.name)}</b><span>${esc(r.region)}</span></button>`).join('') : '<p class="muted">Nichts gefunden.</p>';
      $$('#wRes [data-i]').forEach((b) => b.addEventListener('click', () => { const r = list[+b.dataset.i]; pick = { city: r.name, lat: r.lat, lon: r.lon }; $('#wCity').value = r.name; $('#wCur').textContent = `Gewählt: ${r.name} (${r.lat.toFixed(2)}, ${r.lon.toFixed(2)})`; $('#wRes').innerHTML = ''; }));
    }));
    $('#wSave').addEventListener('click', guard(async () => { await save({ weather: { enabled: $('#wOn').checked, auto: $('#wAuto').checked, city: pick.city, lat: pick.lat, lon: pick.lon } }); toast('Gespeichert ✓'); }));
    $('#wTest').addEventListener('click', guard(async () => { await save({ weather: { enabled: $('#wOn').checked, auto: $('#wAuto').checked, city: pick.city, lat: pick.lat, lon: pick.lon } }); const r = await api('/api/weather'); $('#wOut').innerHTML = `<div class="status">${esc(r.text)}</div>`; }));
  }

  /* ===================================================== Daten (Import…) */
  function tabData(el) {
    el.innerHTML = `
      <section class="card"><h2>📥 Import</h2>
        <p class="muted">Unterstützt: <b>Obsidian-Vault</b> oder Markdown-Ordner (als ZIP oder einzelne .md-Dateien), <b>Day One</b> (Export als JSON-ZIP), <b>vCard</b> (.vcf, z. B. aus Handy, Google, Monica), sowie ein <b>Memoria-Backup</b>. Vorhandenes wird nicht überschrieben.</p>
        <div class="field"><input type="file" id="impFile" multiple accept=".zip,.md,.markdown,.txt,.json,.vcf"></div>
        <div class="field"><label>Zuordnung der Markdown-Dateien</label>
          <label class="sw-row" style="border:0;padding:4px 0"><input type="radio" name="impMode" value="auto" checked><span><b>Automatisch</b><small>Tagebuch (Dateien mit Datum / Ordner „Daily“), Personen (Ordner „Kontakte“, Felder wie Geburtstag) und Notizen werden erkannt.</small></span></label>
          <label class="sw-row" style="border:0;padding:4px 0"><input type="radio" name="impMode" value="notes"><span><b>Alles als Notizen</b></span></label></div>
        <button class="btn primary" id="impGo">Importieren</button><div id="impRes"></div></section>
      <section class="card"><h2>📤 Export & Backup</h2>
        <p class="muted">Das Backup enthält alle Markdown-Dateien und Anhänge – ohne Konten und Einstellungen. Zum Wiederherstellen entpackst du es in den Datenordner oder importierst es hier.</p>
        <div class="row-flex"><a class="btn primary" id="bkLink" href="/api/backup" download>⬇ Backup (ZIP) herunterladen</a>${sw('bkHist', false, 'Versionsverlauf mitsichern')}</div>
        <div class="row-flex" style="margin-top:10px"><a class="btn" href="/api/export/vcards" download>⬇ Alle Personen als vCard</a>${M.feat('people') ? '<a class="btn" href="/api/export/gedcom" download>🧬 Stammbaum als GEDCOM</a>' : ''}</div></section>
      <section class="card"><h2>📅 Kalender-Abo</h2>
        <p class="muted">Geburtstage, Todestage, fällige Kontaktwünsche und geplante Treffen als Kalender-Link (.ics) für Google Kalender, Apple Kalender, Thunderbird, Nextcloud und andere. Der Link enthält ein Geheimnis: Wer ihn kennt, sieht diese Termine – du kannst ihn jederzeit ersetzen oder widerrufen. Damit der Kalenderdienst ihn abrufen kann, muss Memoria von außen erreichbar sein (Adresse unter Einstellungen → Erinnerungen bei „Adresse dieser Memoria-Installation“ eintragen); lokale Kalender-Apps im selben Netz funktionieren auch so.</p>
        <div id="calBox">Lade …</div></section>
      <section class="card"><h2>🧹 Pflege &amp; Rückblick</h2><div class="row-flex"><a class="btn" href="#/check">🧹 Datenprüfung (kaputte Links, Anhänge, Dubletten)</a><a class="btn" href="#/review">🎞️ Jahresrückblick</a></div></section>`;
    const calDraw = (info) => {
      $('#calBox').innerHTML = info.active ? `<div class="field"><label for="calUrl">Dein Kalender-Link</label><input id="calUrl" type="text" readonly value="${esc(info.url)}" onclick="this.select()"></div>
        <div class="row-flex"><button class="btn primary" id="calCopy">📋 Kopieren</button><button class="btn" id="calNew">Neuen Link erzeugen</button><button class="btn danger" id="calOff">Widerrufen</button></div>` : '<button class="btn primary" id="calOn">Link erzeugen</button>';
      const set = (revoke) => guard(async () => { if (revoke && !confirm('Link widerrufen? Kalender, die ihn verwenden, bekommen dann keine Termine mehr.')) return; calDraw(await api('/api/calendar/token', { method: 'POST', body: { revoke } })); });
      if (info.active) { $('#calCopy').addEventListener('click', guard(async () => { try { await navigator.clipboard.writeText(info.url); toast('Link kopiert ✓'); } catch (e) { $('#calUrl').select(); toast('Bitte mit Strg+C kopieren'); } })); $('#calNew').addEventListener('click', () => { if (confirm('Neuen Link erzeugen? Der bisherige funktioniert danach nicht mehr.')) set(false)(); }); $('#calOff').addEventListener('click', set(true)); } else $('#calOn').addEventListener('click', set(false));
    };
    api('/api/calendar/info').then(calDraw).catch((e) => { $('#calBox').textContent = e.message; });
    $('#bkHist').addEventListener('change', (e) => { $('#bkLink').href = '/api/backup' + (e.target.checked ? '?history=1' : ''); });
    $('#impGo').addEventListener('click', guard(async () => {
      const files = [...$('#impFile').files]; if (!files.length) return toast('Bitte Dateien auswählen', 'err');
      const fd = new FormData(); files.forEach((f) => fd.append('file', f, f.name)); fd.append('mode', $('input[name=impMode]:checked').value);
      $('#impRes').innerHTML = '<div class="status">⏳ Import läuft …</div>';
      const r = await api('/api/import', { method: 'POST', body: fd }); M.invalidate();
      $('#impRes').innerHTML = `<div class="status"><b>Fertig.</b> ${r.journal} Tagebucheinträge · ${r.people} Personen · ${r.notes} Notizen · ${r.attachments} Dateien${r.skipped.length ? `<details><summary>${r.skipped.length} übersprungen</summary><div class="log">${esc(r.skipped.join('\n'))}</div></details>` : ''}${r.warnings.length ? `<details open><summary>${r.warnings.length} Hinweise</summary><div class="log">${esc(r.warnings.join('\n'))}</div></details>` : ''}</div>`;
    }));
  }

  /* ========================================================== Sicherheit */
  async function tabSecurity(el) {
    const me = M.state.me;
    el.innerHTML = `
      <section class="card"><h2>🔑 Passwort</h2>
        <form id="pwForm" class="form-grid"><div class="field"><label for="pwC">Aktuelles Passwort</label><input id="pwC" type="password" autocomplete="current-password" required></div>
          <div class="field"><label for="pwN">Neues Passwort (mind. 10 Zeichen)</label><input id="pwN" type="password" autocomplete="new-password" required></div>
          <div class="field wide"><button class="btn primary">Passwort ändern</button> <small>Dabei werden alle anderen Sitzungen beendet.</small></div></form></section>
      <section class="card" id="tfaCard"></section>
      <section class="card" id="encCard"></section>
      <section class="card"><div class="row-flex"><h2 style="margin:0">Angemeldete Geräte</h2><span class="spacer"></span><button class="btn small" id="ssOthers">Alle anderen abmelden</button></div><div id="ssBody">Lade …</div></section>`;
    $('#pwForm').addEventListener('submit', guard(async (e) => { e.preventDefault(); await api('/api/auth/password', { method: 'POST', body: { current: $('#pwC').value, password: $('#pwN').value } }); e.target.reset(); toast('Passwort geändert ✓'); drawSessions(); }));

    /* ---- Zwei-Faktor ---- */
    const tfa = $('#tfaCard');
    const drawTfa = () => {
      if (M.state.me.totp) {
        tfa.innerHTML = '<h2>🛡️ Zwei-Faktor-Anmeldung</h2><p>✓ Aktiv. Beim Anmelden wird zusätzlich ein Code aus deiner Authenticator-App verlangt.</p><button class="btn danger" id="tfaOff">Deaktivieren</button>';
        $('#tfaOff').addEventListener('click', guard(async () => {
          const pw = prompt('Zum Deaktivieren: aktuelles Passwort'); if (!pw) return;
          const code = prompt('Aktueller Code aus der App (oder Wiederherstellungscode)'); if (!code) return;
          await api('/api/auth/2fa/disable', { method: 'POST', body: { password: pw, code } }); M.state.me.totp = false; toast('Deaktiviert'); drawTfa();
        }));
      } else {
        tfa.innerHTML = '<h2>🛡️ Zwei-Faktor-Anmeldung</h2><p class="muted">Schützt dein Konto auch dann, wenn jemand dein Passwort kennt. Funktioniert mit jeder Authenticator-App (Aegis, 2FAS, Google Authenticator, Bitwarden …).</p><button class="btn primary" id="tfaOn">Einrichten</button><div id="tfaSetup"></div>';
        $('#tfaOn').addEventListener('click', guard(async () => {
          const pw = prompt('Zur Bestätigung: aktuelles Passwort'); if (!pw) return;
          const r = await api('/api/auth/2fa/begin', { method: 'POST', body: { password: pw } });
          $('#tfaSetup').innerHTML = `<div class="status" style="margin-top:12px"><p>1. In der App einen Eintrag hinzufügen („Schlüssel eingeben“ oder den Link öffnen):</p><p><code style="user-select:all;word-break:break-all">${esc(r.secret)}</code></p><p class="small-text"><a href="${esc(r.uri)}">otpauth-Link öffnen</a> (Typ: zeitbasiert, 6 Stellen, 30 s)</p><p>2. Den angezeigten 6-stelligen Code hier eingeben:</p><form id="tfaForm" class="row-flex"><input id="tfaCode" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" style="max-width:140px" required><button class="btn primary">Bestätigen</button></form></div>`;
          $('#tfaForm').addEventListener('submit', guard(async (e) => {
            e.preventDefault(); const x = await api('/api/auth/2fa/enable', { method: 'POST', body: { code: $('#tfaCode').value } }); M.state.me.totp = true;
            tfa.innerHTML = `<h2>🛡️ Zwei-Faktor aktiv ✓</h2><div class="status"><b>Wiederherstellungscodes – jetzt sicher aufbewahren!</b><br>Jeder Code funktioniert einmal, falls du die App nicht hast.<pre style="user-select:all;margin:10px 0">${x.recovery.join('\n')}</pre></div>`;
          }));
        }));
      }
    };
    drawTfa();

    /* ---- Verschlüsselung ---- */
    const encC = $('#encCard');
    const drawEnc = async () => {
      await M.crypt.restore();
      const set = M.crypt.isSetUp(), un = M.crypt.isUnlocked();
      encC.innerHTML = `<h2>🔒 Verschlüsselte Texte</h2>
        <p class="muted">Einzelne Einträge lassen sich im Editor verschlüsseln („Text verschlüsseln“). Die Passphrase verlässt deinen Browser nie; der Server speichert nur Chiffretext (AES-256-GCM, PBKDF2 mit 600 000 Runden). Titel, Datum, Stimmung und Tags sowie Anhänge bleiben unverschlüsselt. Verschlüsselte Texte sind nicht durchsuchbar.</p>
        <p>Status: ${!set ? '<b>nicht eingerichtet</b>' : un ? '<b>🔓 entsperrt</b>' : '<b>🔒 gesperrt</b>'}</p>
        <div class="row-flex">${!set ? '<button class="btn primary" id="encSetup">Passphrase festlegen</button>' : un ? '<button class="btn" id="encLock">Jetzt sperren</button>' : '<button class="btn primary" id="encUnlock">Entsperren</button>'}${set ? '<button class="btn small ghost danger" id="encReset">Notfall: Einrichtung zurücksetzen</button>' : ''}</div>
        <p class="hint">Vergessene Passphrase = Texte unwiederbringlich verloren. Frühere Klartext-Fassungen im Verlauf werden beim Verschlüsseln gelöscht; Kopien in .trash oder auf dem WebDAV-Server bleiben aber bestehen, bis du sie selbst entfernst.</p>`;
      const b = (id, fn) => { const x = $('#' + id, encC); if (x) x.addEventListener('click', guard(async () => { await fn(); drawEnc(); })); };
      b('encSetup', () => M.crypt.prompt('setup')); b('encUnlock', () => M.crypt.prompt('unlock')); b('encLock', async () => { await M.crypt.lock(); toast('Gesperrt'); });
      b('encReset', async () => { if (!confirm('Die Einrichtung zurücksetzen? Bereits verschlüsselte Texte bleiben ohne die alte Passphrase unlesbar.')) return; await save({ crypto: { reset: true } }); await M.crypt.lock(); toast('Zurückgesetzt'); });
    };
    drawEnc();

    /* ---- Sitzungen ---- */
    const drawSessions = async () => {
      const list = await api('/api/auth/sessions');
      $('#ssBody').innerHTML = `<table class="table"><tbody>${list.map((s) => `<tr><td>${esc(shortUa(s.ua))}${s.current ? ' <span class="tag">dieses Gerät</span>' : ''}<br><span class="muted small-text">${esc(s.ip)} · seit ${esc(fmtTime(s.created))}</span></td><td style="text-align:right">${s.current ? '' : `<button class="btn small" data-end="${s.id}">Abmelden</button>`}</td></tr>`).join('')}</tbody></table>`;
      $$('[data-end]').forEach((b) => b.addEventListener('click', guard(async () => { await api('/api/auth/sessions/' + b.dataset.end, { method: 'DELETE' }); drawSessions(); })));
    };
    const shortUa = (ua) => { const b = /(Edg|Chrome|Firefox|Safari|OPR)\//.exec(ua || ''); const o = /(Windows|Android|iPhone|iPad|Mac OS X|Linux)/.exec(ua || ''); return [b ? b[1].replace('Edg', 'Edge').replace('OPR', 'Opera') : 'Browser', o ? o[1].replace('Mac OS X', 'macOS') : ''].filter(Boolean).join(' auf '); };
    $('#ssOthers').addEventListener('click', guard(async () => { await api('/api/auth/sessions/others', { method: 'POST', body: {} }); toast('Andere Geräte abgemeldet'); drawSessions(); }));
    drawSessions().catch(() => {});
  }

  /* ======================================================= Verwaltung */
  async function tabAdmin(el) {
    const me = M.state.me;
    el.innerHTML = '<section class="card"><h2>Benutzerverwaltung</h2><div id="usersBody">Lade …</div></section><section class="card"><h2>Sicherheitsprotokoll</h2><div id="auditBody">Lade …</div></section>';
    const drawUsers = async () => {
      const users = await api('/api/users');
      $('#usersBody').innerHTML = `<table class="table"><thead><tr><th>Name</th><th>Rolle</th><th></th></tr></thead><tbody>${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${u.admin ? 'Administrator' : 'Benutzer'}</td><td style="text-align:right">${u.name === me.name ? '<span class="muted">du</span>' : `<button class="btn small" data-act="admin" data-n="${esc(u.name)}" data-a="${u.admin ? 0 : 1}">${u.admin ? 'Admin entziehen' : 'Zum Admin machen'}</button> <button class="btn small" data-act="pw" data-n="${esc(u.name)}">Passwort</button> <button class="btn small" data-act="2fa" data-n="${esc(u.name)}">2FA aus</button> <button class="btn small danger" data-act="del" data-n="${esc(u.name)}">Löschen</button>`}</td></tr>`).join('')}</tbody></table>
        <h3 style="margin-top:18px">Neuen Benutzer anlegen</h3>
        <form id="newUser" class="row-flex"><input id="nuN" placeholder="Benutzername" required style="max-width:200px"><input id="nuP" type="password" placeholder="Passwort (min. 10)" required autocomplete="new-password" style="max-width:200px"><label class="row-flex"><input type="checkbox" id="nuA" style="width:auto"> Admin</label><button class="btn primary">Anlegen</button></form>
        <p class="hint">Jeder Benutzer hat ein eigenes Tagebuch, eigene Personen und eigene Einstellungen. Beim Löschen eines Kontos bleiben dessen Daten im Datenordner erhalten.</p>`;
      $('#newUser').addEventListener('submit', guard(async (e) => { e.preventDefault(); await api('/api/users', { method: 'POST', body: { username: $('#nuN').value, password: $('#nuP').value, admin: $('#nuA').checked } }); toast('Benutzer angelegt ✓'); drawUsers(); }));
      $$('[data-act]', $('#usersBody')).forEach((b) => b.addEventListener('click', guard(async () => {
        const n = b.dataset.n, u = '/api/users/' + enc(n);
        if (b.dataset.act === 'admin') await api(u, { method: 'PUT', body: { admin: b.dataset.a === '1' } });
        else if (b.dataset.act === 'pw') { const p = prompt(`Neues Passwort für ${n} (mind. 10 Zeichen):`); if (!p) return; await api(u, { method: 'PUT', body: { password: p } }); toast('Passwort gesetzt ✓'); }
        else if (b.dataset.act === '2fa') { if (!confirm(`Zwei-Faktor für ${n} ausschalten?`)) return; await api(u, { method: 'PUT', body: { disable2fa: true } }); toast('2FA ausgeschaltet'); }
        else if (b.dataset.act === 'del') { if (!confirm(`Konto „${n}“ löschen? Die Daten bleiben im Datenordner erhalten.`)) return; const r = await api(u, { method: 'DELETE' }); toast(r.note || 'Gelöscht'); }
        drawUsers();
      })));
    };
    drawUsers().catch((e) => toast(e.message, 'err'));
    const log = await api('/api/audit?limit=100').catch(() => []);
    const L = { login: 'Anmeldung', 'login-fail': 'Anmeldung fehlgeschlagen', setup: 'Einrichtung', 'password-change': 'Passwort geändert', 'password-fail': 'Passwortänderung fehlgeschlagen', 'user-create': 'Benutzer angelegt', 'user-update': 'Benutzer geändert', 'user-delete': 'Benutzer gelöscht', '2fa-enable': '2FA aktiviert', '2fa-disable': '2FA deaktiviert', 'session-end': 'Sitzung beendet', 'session-end-others': 'Andere Sitzungen beendet', 'sync-run': 'Sync gestartet', import: 'Import', backup: 'Backup geladen' };
    $('#auditBody').innerHTML = log.length ? `<table class="table"><tbody>${log.map((l) => `<tr class="${/fail/.test(l.e) ? 'bad-row' : ''}"><td class="small-text">${esc(fmtTime(l.t))}</td><td>${esc(L[l.e] || l.e)}</td><td>${esc(l.u || '')}${l.d ? ` <span class="muted">${esc(l.d)}</span>` : ''}</td><td class="muted small-text">${esc(l.ip || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Noch keine Einträge.</div>';
  }

  T.push(['sync', '🔄 Sync', tabSync], ['notify', '🔔 Erinnerungen', tabNotify], ['weather', '🌤️ Wetter & Ort', tabWeather], ['data', '💾 Daten', tabData], ['security', '🔐 Sicherheit', tabSecurity], ['admin', '👥 Verwaltung', tabAdmin, () => M.state.me && M.state.me.admin]);
})();
