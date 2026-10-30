'use strict';
/* Personenliste */
(() => {
  const M = window.M;
  const { $, $$, esc, enc, pad, isDate, todayStr, parseD, fmtD, addDays, diffDays, fmtLong, fmtShort, monthName, ago, MOODS, moodColor, TYPE, href, feat, go, api, getItems, invalidate, toast, dispTitle, tagChips, moodChip, fileUrl, avatar, row, isDark, embedHTML, songLine, lookupSong, onLeave, sparkline, lineChart } = M;
  const app = M.$('#app');
  /* ------------------------------------------------------------ Personen */
  async function peopleList() {
    const people = (await getItems()).filter((i) => i.type === 'person');
    const tags = [...new Set(people.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b, 'de'));
    app.innerHTML = `
      <div class="row-flex" style="margin-bottom:14px"><h1 style="margin:0">Personen <span class="muted">(${people.length})</span></h1><span class="spacer"></span>
        <form id="newForm" class="row-flex"><input type="text" id="newName" placeholder="Neue Person – Name" style="width:220px" required><button class="btn primary">＋ Anlegen</button><a class="btn" href="/api/export/vcards" download title="Alle Personen als vCard exportieren">⬇ vCard</a></form></div>
      <div class="card row-flex"><input type="search" id="pq" placeholder="Filtern nach Name, Firma, Tag…" style="max-width:320px">
        <select id="ptag" style="max-width:180px"><option value="">Alle Tags</option>${tags.map((t) => `<option>${esc(t)}</option>`).join('')}</select>
        <span class="seg-mini" role="group" aria-label="Ansicht"><button type="button" id="pvGrid" aria-pressed="true" title="Kacheln"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg></button><button type="button" id="pvList" aria-pressed="false" title="Liste"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></button></span><select id="psort" style="max-width:220px"><option value="name">Sortierung: Name</option><option value="contact">Längster Kontakt zuerst</option><option value="recent">Zuletzt im Kontakt</option><option value="bday">Nächster Geburtstag</option><option value="mentions">Meist erwähnt</option></select></div>
      <div id="pover"></div>
      <div id="plist" class="people-grid"></div>`;
    api('/api/people/overview').then((o) => {
      const parts = [];
      if (o.debts.length) parts.push(`<section class="card"><h2>💶 Offene Schulden</h2>${o.debts.map((d) => `<a class="row" href="#/person/${enc(d.slug)}"><span class="row-ic">👤</span><div class="row-main"><div class="row-title">${esc(d.title)}</div></div><span class="row-meta">${Object.entries(d.balance).filter(([, v]) => v).map(([c, v]) => `${v > 0 ? 'schuldet dir' : 'du schuldest'} ${Math.abs(v).toLocaleString('de-DE', { minimumFractionDigits: 2 })} ${esc(c)}`).join(', ')}</span></a>`).join('')}</section>`);
      if (o.gifts.length) parts.push(`<section class="card"><h2>🎁 Geschenkideen</h2>${o.gifts.map((d) => `<a class="row" href="#/person/${enc(d.slug)}"><span class="row-ic">👤</span><div class="row-main"><div class="row-title">${esc(d.title)}</div><div class="row-sub">${d.gifts.map((g) => esc(g.idea)).join(' · ')}</div></div></a>`).join('')}</section>`);
      if (parts.length) $('#pover').innerHTML = `<div class="grid ${parts.length > 1 ? 'cols-2' : ''}">${parts.join('')}</div>`;
    }).catch(() => {});
    const nextBday = (p) => {
      const b = String(p.birthday || '');
      const m = b.match(/(?:^|-)(\d{2})-(\d{2})$/) || b.match(/^(\d{1,2})\.(\d{1,2})\./);
      if (!m) return 1e9;
      const [mm, dd] = /\./.test(b) ? [+m[2], +m[1]] : [+m[1], +m[2]];
      const t = todayStr(), y = +t.slice(0, 4); let c = `${y}-${pad(mm)}-${pad(dd)}`; if (c < t) c = `${y + 1}-${pad(mm)}-${pad(dd)}`;
      return diffDays(t, c);
    };
    const cState = (d) => { if (!d) return 'none'; const n = diffDays(d, todayStr()); return n <= 30 ? 'ok' : n <= 90 ? 'mid' : 'late'; };
    const draw = () => {
      const q = $('#pq').value.toLowerCase(), tg = $('#ptag').value, s = $('#psort').value;
      const cmp = { name: (a, b) => a.title.localeCompare(b.title, 'de'), contact: (a, b) => (a.lastContact || '').localeCompare(b.lastContact || ''), recent: (a, b) => (b.lastContact || '').localeCompare(a.lastContact || ''), bday: (a, b) => nextBday(a) - nextBday(b), mentions: (a, b) => b.mentions - a.mentions }[s];
      const list = people.filter((p) => (!q || [p.title, p.company, p.relationship, ...(p.aliases || []), ...p.tags].join(' ').toLowerCase().includes(q)) && (!tg || p.tags.includes(tg))).sort(cmp);
      $('#plist').innerHTML = list.length ? list.map((p) => `<a class="pcard" href="${href(p)}">${avatar(p)}<div><div class="t">${esc(p.title)}</div><div class="s">${esc([p.relationship, p.company].filter(Boolean).join(' · ') || '—')}</div><div class="s"><span class="cdot ${cState(p.lastContact)}" aria-hidden="true"></span>Kontakt: ${ago(p.lastContact)} · ${p.mentions}× erwähnt</div></div></a>`).join('') : (people.length ? '<div class="empty"><p>Keine Personen gefunden.</p></div>' : '<div class="empty"><p>Noch keine Personen.</p><button type="button" class="btn primary small" data-focus="#newName">👤 Erste Person anlegen</button></div>');
    };
    ['input', 'change'].forEach((ev) => { $('#pq').addEventListener(ev, draw); $('#ptag').addEventListener(ev, draw); $('#psort').addEventListener(ev, draw); });
    const setView = (list, save) => { $('#plist').classList.toggle('plist-list', list); $('#pvGrid').setAttribute('aria-pressed', list ? 'false' : 'true'); $('#pvList').setAttribute('aria-pressed', list ? 'true' : 'false'); if (save) { try { localStorage.setItem('pview', list ? 'list' : 'grid'); } catch (e) { /* egal */ } } };
    let pv = 'grid'; try { pv = localStorage.getItem('pview') || 'grid'; } catch (e) { /* egal */ }
    setView(pv === 'list'); $('#pvGrid').addEventListener('click', () => setView(false, true)); $('#pvList').addEventListener('click', () => setView(true, true));
    $('#newForm').addEventListener('submit', async (e) => { e.preventDefault(); const d = await M.family.dupDialog($('#newName').value.trim()); if (!d) return; if (d.action === 'use') { go(`#/person/${enc(d.slug)}`); return; } const r = await api('/api/item/person', { method: 'POST', body: { title: $('#newName').value } }); invalidate(); go(`#/person/${enc(r.slug)}?edit=1`); });
    draw();
  }

  M.routes.push([/^\/people$/, peopleList]);
})();
