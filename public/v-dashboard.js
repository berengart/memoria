'use strict';
/* Übersicht & Lieder */
(() => {
  const M = window.M;
  const { $, $$, esc, enc, pad, isDate, todayStr, parseD, fmtD, addDays, diffDays, fmtLong, fmtShort, monthName, ago, MOODS, moodColor, TYPE, href, feat, go, api, getItems, invalidate, toast, dispTitle, tagChips, moodChip, fileUrl, avatar, row, isDark, embedHTML, songLine, lookupSong, onLeave, sparkline, lineChart } = M;
  const app = M.$('#app');
  /* ---------------------------------------------------------- Übersicht */
  async function dashboard() {
    const d = await api('/api/dashboard');
    const t = d.todayEntry;
    const hr = new Date().getHours();
    const greet = hr < 5 ? 'Noch wach?' : hr < 11 ? 'Guten Morgen' : hr < 18 ? 'Guten Tag' : 'Guten Abend';
    const moodBtns = MOODS.map((m) => `<button class="mood-btn ${t && t.mood === m.v ? 'sel' : ''}" style="--mc:${m.c}" data-mood="${m.v}" title="${m.l}">${m.e}</button>`).join('');
    const energyBtns = [1, 2, 3, 4, 5].map((v) => `<button class="energy-btn ${t && t.energy === v ? 'sel' : ''}" data-energy="${v}">${v}</button>`).join('');
    const widgets = [];
    const todayMood = !feat('mood') ? '' : (`<section class="card"><h2>Wie geht es dir heute?</h2><div class="mood-row">${moodBtns}</div><h3 style="margin-top:14px" class="muted">Energie</h3><div class="mood-row">${energyBtns}</div></section>`);
    if (feat('mood')) widgets.push(`<section class="card"><h2>Letzte 30 Tage <a class="small-text" href="#/mood">Details →</a></h2>${sparkline(d.mood30) || '<div class="empty">Noch zu wenig Daten.</div>'}</section>`);
    if (feat('music')) widgets.push('<section class="card" id="songCard"><h2>🎵 Lied des Tages <a class="small-text" href="#/songs">Alle →</a></h2><div id="songBody"></div></section>');
    const stats = `<section class="card"><h2>Bestand</h2><div class="stats">${feat('people') ? `<div><b>${d.counts.people}</b><span>Personen</span></div>` : ''}<div><b>${d.counts.journal}</b><span>Einträge</span></div><div><b>${d.counts.notes}</b><span>Notizen</span></div></div></section>`;
    const side = [];
    if (feat('people') && feat('reminders')) {
      side.push(`<section class="card"><h2>🎂 Bald Geburtstag</h2>${d.birthdays.length ? d.birthdays.map((b) => `<a class="row" href="${href(b)}">${avatar(b)}<div class="row-main"><div class="row-title">${esc(b.title)}</div><div class="row-sub">${b.inDays === 0 ? 'Heute!' : b.inDays === 1 ? 'Morgen' : `in ${b.inDays} Tagen`}${b.turning ? ` · wird ${b.turning}` : ''}</div></div><span class="row-meta">${fmtShort(b.on).slice(0, 5)}</span></a>`).join('') : '<div class="empty">Keine Geburtstage in den nächsten 60 Tagen.</div>'}</section>`);
      if (d.reminders.length) side.push(`<section class="card"><h2>💬 Mal wieder melden</h2>${d.reminders.map((p) => `<a class="row" href="${href(p)}">${avatar(p)}<div class="row-main"><div class="row-title">${esc(p.title)}</div><div class="row-sub">Letzter Kontakt: ${p.lastContact ? ago(p.lastContact) : 'nicht erfasst'} · Ziel: alle ${p.every} Tage</div></div></a>`).join('')}</section>`);
    }
    if (feat('onThisDay') && d.onThisDay.length) side.push(`<section class="card"><h2>🕰️ An diesem Tag</h2>${d.onThisDay.map((i) => row(i)).join('')}</section>`);
    const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const weekCard = `<section class="card"><h2>Diese Woche <a class="small-text" href="#/journal">Tagebuch →</a></h2><div class="week">${d.mood30.slice(-7).map((x) => { const dt = parseD(x.date); return `<a class="wk ${x.date === d.today ? 'today' : ''}" href="#/journal/${x.date}" title="${esc(fmtLong(x.date))}"><span class="wd">${wd[dt.getDay()]}</span><span class="wn">${dt.getDate()}</span><span class="wdot" style="${x.mood ? `background:${moodColor(x.mood)}` : ''}"></span></a>`; }).join('')}</div>${feat('mood') ? '<p class="muted small-text" style="margin:12px 0 0">Der Punkt zeigt die Stimmung des Tages.</p>' : ''}</section>`;
    app.innerHTML = `
      <section class="card hero">
        <div><h1>${greet} 👋</h1><div class="muted">${fmtLong(d.today)}${d.streak ? ` · 🔥 ${d.streak} ${d.streak === 1 ? 'Tag' : 'Tage'} in Folge` : ''}</div></div>
        <span class="spacer"></span>
        <a class="btn primary" href="#/journal/${d.today}">${t ? '📓 Heutigen Eintrag öffnen' : '✍️ Heute schreiben'}</a>
        ${feat('quicklog') ? `<form class="quick" id="quick"><input type="text" id="quickText" placeholder="Kurz festhalten${feat('people') ? ' – z. B. „Kaffee mit [[Anna]]“' : ''} (landet im heutigen Tagebuch)" autocomplete="off"><button class="btn">Hinzufügen</button></form>` : ''}
      </section>
      <div class="grid ${todayMood ? 'cols-2' : ''}">${todayMood}${weekCard}</div>
      ${side.length ? `<div class="grid ${side.length > 1 ? 'cols-' + Math.min(3, side.length) : ''}">${side.join('')}</div>` : ''}
      <div class="grid ${widgets.length ? 'cols-2' : ''}">
        <section class="card"><h2>Letzte Tagebucheinträge</h2>${d.recent.length ? d.recent.map((i) => row(i)).join('') : `<div class="empty"><p>Noch keine Einträge.</p><a class="btn primary small" href="#/journal/${d.today}">✍️ Ersten Eintrag schreiben</a></div>`}</section>
        ${widgets.length ? `<div class="grid">${widgets.join('')}</div>` : ''}
      </div>
      ${stats}`;
    $$('.mood-btn', app).forEach((b) => b.addEventListener('click', async () => { await api('/api/journal/mood', { method: 'POST', body: { date: d.today, mood: t && t.mood === +b.dataset.mood ? 0 : +b.dataset.mood } }); invalidate(); toast('Stimmung gespeichert'); dashboard(); }));
    $$('.energy-btn', app).forEach((b) => b.addEventListener('click', async () => { await api('/api/journal/mood', { method: 'POST', body: { date: d.today, energy: t && t.energy === +b.dataset.energy ? 0 : +b.dataset.energy } }); invalidate(); toast('Energie gespeichert'); dashboard(); }));
    const q = $('#quick');
    if (q) q.addEventListener('submit', async (e) => {
      e.preventDefault(); const text = $('#quickText').value.trim(); if (!text) return;
      await api('/api/journal/append', { method: 'POST', body: { text, date: d.today } }); invalidate(); toast('Zum heutigen Tagebuch hinzugefügt'); dashboard();
    });
    if (feat('music')) songWidget(d);
  }

  function songWidget(d) {
    const body = $('#songBody'), t = d.todayEntry;
    const showForm = (prefill = {}) => {
      body.innerHTML = `<div class="song-form"><input type="text" id="sgTitle" placeholder="Interpret – Titel" value="${esc(prefill.song || '')}"><input type="text" id="sgUrl" placeholder="Link (YouTube, Spotify … optional)" value="${esc(prefill.url || '')}">
        <div class="row-flex"><button class="btn primary small" id="sgSave" type="button">Speichern</button><button class="btn small" id="sgLook" type="button">Titel aus Link holen</button>${prefill.song ? '<button class="btn small ghost" id="sgClear" type="button">Entfernen</button>' : ''}</div></div>
        ${!prefill.song && d.songSuggestion ? `<p class="hint" style="margin-bottom:0">Erinnerung: Am ${fmtShort(d.songSuggestion.date)} hörtest du <a href="${href(d.songSuggestion)}">${esc(d.songSuggestion.song)}</a>.</p>` : ''}`;
      const save = (clear) => api('/api/journal/song', { method: 'POST', body: { date: d.today, song: clear ? '' : $('#sgTitle').value, song_url: clear ? '' : $('#sgUrl').value } }).then(() => { invalidate(); toast('Gespeichert'); dashboard(); }).catch((e) => toast(e.message, 'err'));
      $('#sgSave').addEventListener('click', () => { if (!$('#sgTitle').value.trim() && !$('#sgUrl').value.trim()) return toast('Titel oder Link eingeben', 'err'); save(false); });
      $('#sgLook').addEventListener('click', () => lookupSong($('#sgUrl'), $('#sgTitle')));
      const c = $('#sgClear'); if (c) c.addEventListener('click', () => save(true));
    };
    if (t && t.song) {
      body.innerHTML = `${songLine(t.song, t.songUrl)}${M.state.settings.songEmbed && t.songUrl ? embedHTML(t.songUrl) : ''}<p style="margin:10px 0 0"><button class="btn small" id="sgEdit">Ändern</button></p>`;
      $('#sgEdit').addEventListener('click', () => showForm({ song: t.song, url: t.songUrl }));
    } else showForm();
  }

  async function songsView(_, q) {
    const songs = await api('/api/songs');
    const draw = () => {
      const f = ($('#sq') ? $('#sq').value : (q.q || '')).toLowerCase();
      const list = songs.filter((s) => !f || s.song.toLowerCase().includes(f));
      const groups = new Map();
      for (const s of list) { const k = s.date.slice(0, 7); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
      $('#slist').innerHTML = list.length ? [...groups].map(([k, arr]) => `<h3 style="margin-top:14px">${esc(monthName(k))}</h3>${arr.map((s) => `<div class="row"><span class="row-ic">🎵</span><div class="row-main"><div class="row-title">${s.songUrl ? `<a href="${esc(s.songUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.song)}</a>` : esc(s.song)}</div><div class="row-sub"><a href="${href(s)}">${esc(fmtLong(s.date))}</a></div></div><span class="row-meta">${moodChip(s.mood)}</span></div>`).join('')}`).join('') : '<div class="empty">Noch keine Lieder. Trage auf der Übersicht oder im Tagebuch ein „Lied des Tages“ ein.</div>';
    };
    app.innerHTML = `<div class="row-flex" style="margin-bottom:14px"><h1 style="margin:0">Lieder des Tages <span class="muted">(${songs.length})</span></h1><span class="spacer"></span><input type="search" id="sq" placeholder="Filtern…" style="max-width:240px" value="${esc(q.q || '')}"></div><div class="card" id="slist"></div>`;
    $('#sq').addEventListener('input', draw); draw();
  }

  M.routes.push([/^\/?$/, dashboard], [/^\/songs$/, songsView]);
})();
