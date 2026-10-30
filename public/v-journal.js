'use strict';
/* Tagebuch, Notizen, Suche */
(() => {
  const M = window.M;
  const { $, $$, esc, enc, pad, isDate, todayStr, parseD, fmtD, addDays, diffDays, fmtLong, fmtShort, monthName, ago, MOODS, moodColor, TYPE, href, feat, go, api, getItems, invalidate, toast, dispTitle, tagChips, moodChip, fileUrl, avatar, row, isDark, embedHTML, songLine, lookupSong, onLeave, sparkline, lineChart } = M;
  const app = M.$('#app');
  /* ------------------------------------------------------------ Tagebuch */
  async function journalList(_, q) {
    const items = (await getItems()).filter((i) => i.type === 'journal' && i.date);
    const byDate = new Map();
    for (const i of items) if (!byDate.has(i.date) || i.slug === i.date) byDate.set(i.date, i);
    const ym = /^\d{4}-\d{2}$/.test(q.m || '') ? q.m : todayStr().slice(0, 7);
    const [y, m] = ym.split('-').map(Number);
    const shift = (n) => { const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
    const monthCount = new Map(), yearCount = new Map();
    for (const i of items) { const k = i.date.slice(0, 7); monthCount.set(k, (monthCount.get(k) || 0) + 1); const yy = +i.date.slice(0, 4); yearCount.set(yy, (yearCount.get(yy) || 0) + 1); }
    const nowY = new Date().getFullYear(), minY = Math.min(y, nowY - 5, ...yearCount.keys()), maxY = Math.max(y, nowY + 1);
    const years = []; for (let yy = maxY; yy >= minY; yy--) years.push(yy);
    const startOffset = (new Date(y, m - 1, 1).getDay() + 6) % 7, dim = new Date(y, m, 0).getDate(), today = todayStr();
    let cells = '<div class="cal-cell empty"></div>'.repeat(startOffset);
    for (let d = 1; d <= dim; d++) {
      const ds = `${ym}-${pad(d)}`, e = byDate.get(ds);
      const mk = e ? (feat('mood') && e.mood ? MOODS[e.mood - 1].e : '•') : '';
      cells += `<a class="cal-cell ${e ? 'has' : ''} ${ds === today ? 'today' : ''}" href="#/journal/${ds}" ${e && e.mood && feat('mood') ? `style="--mc:${moodColor(e.mood)}"` : ''} title="${esc(fmtLong(ds))}${e ? ' – Eintrag vorhanden' : ''}"><span class="n">${d}</span>${e ? `<span class="mk">${e.song && feat('music') ? '🎵' : ''}${mk}</span>` : ''}</a>`;
    }
    const monthItems = items.filter((i) => i.date.startsWith(ym)).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
    app.innerHTML = `
      <div class="row-flex" style="margin-bottom:14px"><h1 style="margin:0">Tagebuch</h1><span class="spacer"></span>
        <div class="cal-nav">
        <a class="btn" href="#/journal?m=${shift(-12)}" title="Ein Jahr zurück" aria-label="Ein Jahr zurück">«</a><a class="btn" href="#/journal?m=${shift(-1)}" title="Voriger Monat" aria-label="Voriger Monat">←</a>
        <select id="calMonth" aria-label="Monat" style="width:auto">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${esc(monthName(`${y}-${pad(i + 1)}`).split(' ')[0])}${monthCount.get(`${y}-${pad(i + 1)}`) ? ` (${monthCount.get(`${y}-${pad(i + 1)}`)})` : ''}</option>`).join('')}</select>
        <select id="calYear" aria-label="Jahr" style="width:auto">${years.map((yy) => `<option value="${yy}" ${yy === y ? 'selected' : ''}>${yy}${yearCount.get(yy) ? ` (${yearCount.get(yy)})` : ''}</option>`).join('')}</select>
        <a class="btn" href="#/journal?m=${shift(1)}" title="Nächster Monat" aria-label="Nächster Monat">→</a><a class="btn" href="#/journal?m=${shift(12)}" title="Ein Jahr vor" aria-label="Ein Jahr vor">»</a>
        <a class="btn" href="#/journal">Heute</a></div></div>
      <div class="card"><div class="cal-head"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span></div><div class="cal">${cells}</div>
        ${feat('mood') ? `<div class="legend">${MOODS.map((mm) => `<span>${mm.e} ${mm.l}</span>`).join('')}</div>` : ''}</div>
      <div class="card"><h2>Einträge im ${esc(monthName(ym))} <span class="muted small-text">${monthItems.length}</span></h2>${monthItems.length ? monthItems.map((i) => row(i)).join('') : '<div class="empty"><p>Keine Einträge in diesem Monat. Klicke einen Tag im Kalender an, um zu schreiben.</p><a class="btn primary small" href="#/journal/${todayStr()}">✍️ Heute schreiben</a></div>'}</div>`;
    const jump = () => go(`#/journal?m=${$('#calYear').value}-${pad($('#calMonth').value)}`);
    $('#calMonth').addEventListener('change', jump); $('#calYear').addEventListener('change', jump);
  }

  /* ------------------------------------------------------------- Notizen */
  async function notesList() {
    const all = await getItems();
    const notes = all.filter((i) => i.type === 'note').sort((a, b) => b.mtime - a.mtime);
    const counts = {};
    all.forEach((i) => i.tags.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    const tags = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    app.innerHTML = `
      <div class="row-flex" style="margin-bottom:14px"><h1 style="margin:0">Notizen <span class="muted">(${notes.length})</span></h1><span class="spacer"></span>
        <form id="newForm" class="row-flex"><input type="text" id="newTitle" placeholder="Neue Notiz – Titel" style="width:240px" required><button class="btn primary">＋ Anlegen</button></form></div>
      ${tags.length ? `<div class="card"><h2>Alle Tags</h2><div class="chips">${tags.map(([t, n]) => `<a class="tag" href="#/tag/${enc(t)}">#${esc(t)} <span class="muted">${n}</span></a>`).join('')}</div></div>` : ''}
      <div class="card">${notes.length ? notes.map((i) => row(i)).join('') : '<div class="empty"><p>Noch keine Notizen.</p><button type="button" class="btn primary small" data-focus="#newTitle">📝 Erste Notiz schreiben</button></div>'}</div>`;
    $('#newForm').addEventListener('submit', async (e) => { e.preventDefault(); const r = await api('/api/item/note', { method: 'POST', body: { title: $('#newTitle').value } }); invalidate(); go(`#/note/${enc(r.slug)}?edit=1`); });
  }

  async function tagView([tag]) {
    const items = (await getItems()).filter((i) => i.tags.includes(tag)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.mtime - a.mtime);
    app.innerHTML = `<h1>#${esc(tag)} <span class="muted">(${items.length})</span></h1><div class="card">${items.length ? items.map((i) => row(i)).join('') : '<div class="empty">Nichts mit diesem Tag.</div>'}</div>`;
  }

  async function searchView(_, q) {
    const keys = ['q', 'type', 'tag', 'person', 'from', 'to', 'moodMin', 'moodMax'];
    const f = Object.fromEntries(keys.map((k) => [k, (q[k] || '').trim()]));
    const items = await getItems();
    const tags = [...new Set(items.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b, 'de'));
    const people = items.filter((i) => i.type === 'person').map((i) => i.title).sort((a, b) => a.localeCompare(b, 'de'));
    const hasFilter = keys.some((k) => k !== 'q' && f[k]);
    const sel = (v, cur) => (v === cur ? 'selected' : '');
    app.innerHTML = `
      <h1>Suche</h1>
      <form id="sForm" class="card"><div class="row-flex"><input type="search" id="sq" value="${esc(f.q)}" placeholder="Suchbegriffe …" style="flex:1 1 260px" autofocus><button class="btn primary">Suchen</button><button type="button" class="btn ghost small" id="sMore">${hasFilter ? '▾' : '▸'} Filter</button></div>
        <div id="sFilters" class="form-grid" style="margin-top:12px" ${hasFilter ? '' : 'hidden'}>
          <div class="field"><label>Art</label><select id="sType"><option value="">Alle</option><option value="journal" ${sel('journal', f.type)}>Tagebuch</option>${feat('people') ? `<option value="person" ${sel('person', f.type)}>Personen</option>` : ''}<option value="note" ${sel('note', f.type)}>Notizen</option></select></div>
          <div class="field"><label>Tag</label><input id="sTag" list="sTags" value="${esc(f.tag)}" placeholder="z. B. urlaub"><datalist id="sTags">${tags.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>
          ${feat('people') ? `<div class="field"><label>Erwähnt Person</label><input id="sPerson" list="sPeople" value="${esc(f.person)}"><datalist id="sPeople">${people.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>` : ''}
          <div class="field"><label>Von</label>${M.dateHTML({ id: 'sFrom', value: f.from })}</div>
          <div class="field"><label>Bis</label>${M.dateHTML({ id: 'sTo', value: f.to })}</div>
          ${feat('mood') ? `<div class="field"><label>Stimmung von … bis</label><div class="row-flex"><select id="sMin"><option value="">–</option>${MOODS.map((m) => `<option value="${m.v}" ${sel(String(m.v), f.moodMin)}>${m.e} ${m.v}</option>`).join('')}</select><select id="sMax"><option value="">–</option>${MOODS.map((m) => `<option value="${m.v}" ${sel(String(m.v), f.moodMax)}>${m.e} ${m.v}</option>`).join('')}</select></div></div>` : ''}
        </div></form>
      <div id="sRes"></div>`;
    $('#sMore').addEventListener('click', () => { const el = $('#sFilters'); el.hidden = !el.hidden; $('#sMore').textContent = (el.hidden ? '▸' : '▾') + ' Filter'; });
    $('#sForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = { q: $('#sq').value.trim(), type: $('#sType').value, tag: $('#sTag').value.trim(), person: $('#sPerson') ? $('#sPerson').value.trim() : '', from: M.parseDate($('#sFrom').value) || '', to: M.parseDate($('#sTo').value) || '', moodMin: $('#sMin') ? $('#sMin').value : '', moodMax: $('#sMax') ? $('#sMax').value : '' };
      const qs = Object.entries(v).filter(([, x]) => x).map(([k, x]) => `${k}=${enc(x)}`).join('&');
      go('#/search' + (qs ? '?' + qs : ''));
    });
    if (!keys.some((k) => f[k])) { $('#sRes').innerHTML = '<div class="card muted">Suchbegriff eingeben oder Filter wählen. Gesucht wird in Titeln, Texten, Eigenschaften und Tags; Wortanfänge genügen („zür“ findet „Zürich“).</div>'; return; }
    const res = await api('/api/search?' + keys.filter((k) => f[k]).map((k) => `${k}=${enc(f[k])}`).join('&'));
    const hl = (t) => esc(t).replace(/⟦/g, '<mark>').replace(/⟧/g, '</mark>');
    $('#sRes').innerHTML = `<div class="card"><h2>${res.length} Treffer</h2>${res.length ? res.map((i) => `<a class="row" href="${href(i)}"><span class="row-ic">${TYPE[i.type].ic}</span><div class="row-main"><div class="row-title">${esc(dispTitle(i))}</div><div class="row-sub">${hl(i.snippet || '')}</div></div><span class="row-meta">${moodChip(i.mood)}</span></a>`).join('') : '<div class="empty">Keine Treffer.</div>'}</div>`;
  }

  async function newView(_, q) {
    const title = (q.title || '').trim();
    if (isDate(title)) { go('#/journal/' + title); return; }
    app.innerHTML = `<div class="card"><h1>„${esc(title)}“ anlegen</h1><p class="muted">Dieser Link zeigt noch auf nichts. Was soll daraus werden?</p>
      <div class="row-flex">${feat('people') ? '<button class="btn primary" data-t="person">👤 Person</button>' : ''}<button class="btn ${feat('people') ? '' : 'primary'}" data-t="note">📝 Notiz</button></div></div>`;
    $$('button[data-t]', app).forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.t === 'person') { const d = await M.family.dupDialog(title); if (!d) return; if (d.action === 'use') { go(`#/person/${enc(d.slug)}`); return; } }
      const r = await api(`/api/item/${b.dataset.t}`, { method: 'POST', body: { title } }); invalidate(); go(`#/${b.dataset.t}/${enc(r.slug)}?edit=1`);
    }));
  }

  M.routes.push([/^\/journal$/, journalList], [/^\/notes$/, notesList], [/^\/search$/, searchView], [/^\/tag\/(.+)$/, tagView], [/^\/new$/, newView]);
})();
