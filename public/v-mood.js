'use strict';
/* Stimmung */
(() => {
  const M = window.M;
  const { $, $$, esc, enc, pad, isDate, todayStr, parseD, fmtD, addDays, diffDays, fmtLong, fmtShort, monthName, ago, MOODS, moodColor, TYPE, href, feat, go, api, getItems, invalidate, toast, dispTitle, tagChips, moodChip, fileUrl, avatar, row, isDark, embedHTML, songLine, lookupSong, onLeave, sparkline, lineChart } = M;
  const app = M.$('#app');
  /* ------------------------------------------------------- Mood-Tracker */
  async function moodView(_, q) {
    const days = [30, 90, 180, 365].includes(+q.days) ? +q.days : 90;
    const year = /^\d{4}$/.test(q.year || '') ? +q.year : new Date().getFullYear();
    const to = todayStr(), from = addDays(to, -(days - 1));
    const [range, yr, ins] = await Promise.all([api(`/api/mood?from=${from}&to=${to}`), api(`/api/mood?from=${year}-01-01&to=${year}-12-31`), feat('insights') ? api('/api/mood/insights') : Promise.resolve(null)]);
    const withMood = range.days.filter((d) => d.mood != null), withEn = range.days.filter((d) => d.energy != null);
    const avg = (a, k) => (a.length ? a.reduce((s, x) => s + x[k], 0) / a.length : null);
    const am = avg(withMood, 'mood'), ae = avg(withEn, 'energy');
    const best = withMood.length ? withMood.reduce((a, b) => (b.mood > a.mood ? b : a)) : null;
    const f1 = (n) => (n == null ? '–' : n.toFixed(1).replace('.', ','));
    const wd = Array.from({ length: 7 }, () => []);
    withMood.forEach((d) => wd[(parseD(d.date).getDay() + 6) % 7].push(d.mood));
    const wdHTML = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((n, i) => { const a = wd[i].length ? wd[i].reduce((s, x) => s + x, 0) / wd[i].length : null; return `<div class="ybar"><span>${n}</span><div class="tr"><div class="fl" style="width:${a ? (a / 5) * 100 : 0}%;${a ? `background:${moodColor(a)}` : ''}"></div></div><span>${f1(a)}</span></div>`; }).join('');
    const yMap = new Map(yr.days.map((d) => [d.date, d]));
    let px = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'].map((n) => `<div class="mh">${n}</div>`).join('');
    for (let d = 1; d <= 31; d++) for (let m = 1; m <= 12; m++) {
      if (d > new Date(year, m, 0).getDate()) { px += '<span class="px off"></span>'; continue; }
      const ds = `${year}-${pad(m)}-${pad(d)}`, e = yMap.get(ds);
      px += `<a class="px ${e ? 'has' : ''}" ${e && e.mood ? `style="background:${moodColor(e.mood)}"` : ''} href="#/journal/${ds}" title="${esc(fmtLong(ds))}${e && e.mood ? ' – ' + MOODS[Math.round(e.mood) - 1].l : ''}"></a>`;
    }
    const insList = (arr, label, dir) => {
      const s = arr.filter((x) => (dir > 0 ? x.avg >= ins.overall : x.avg < ins.overall)).sort((a, b) => dir * (b.avg - a.avg)).slice(0, 5);
      if (!s.length) return '';
      return `<div><h3>${label}</h3>${s.map((x) => `<div class="dist"><span style="min-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x.tag ? `<a href="#/tag/${enc(x.tag)}">${esc(x.title)}</a>` : `<a href="#/person/${enc(x.slug)}">${esc(x.title)}</a>`}</span><div class="tr"><div class="fl" style="width:${(x.avg / 5) * 100}%;background:${moodColor(x.avg)}"></div></div><span class="muted small-text" style="min-width:70px;text-align:right">Ø ${f1(x.avg)} · ${x.count}×</span></div>`).join('')}</div>`;
    };
    const insCard = ins ? `<section class="card"><h2>Was beeinflusst deine Stimmung?</h2>${ins.entries >= 4 ? [feat('people') ? insList(ins.people, '👤 Personen, mit denen es dir besser geht', 1) : '', feat('people') ? insList(ins.people, 'Personen, nach denen es dir schlechter geht', -1) : '', insList(ins.tags, '#️⃣ Tags: bessere Tage', 1), insList(ins.tags, 'Tags: schwierigere Tage', -1)].join('') || '<div class="empty">Zu wenig Daten – ab 2 Einträgen je Person/Tag.</div>' : '<div class="empty">Sammle ein paar Einträge mit Stimmung und verlinke Personen oder nutze #tags – dann zeigt sich hier, was dir guttut.</div>'}
          ${ins.overall ? `<p class="muted small-text">Gesamtschnitt: ${f1(ins.overall)} aus ${ins.entries} Einträgen.</p>` : ''}</section>` : '';
    app.innerHTML = `
      <div class="row-flex" style="margin-bottom:14px"><h1 style="margin:0">Stimmung</h1><span class="spacer"></span>
        ${[30, 90, 180, 365].map((n) => `<a class="pill ${n === days ? 'on' : ''}" href="#/mood?days=${n}&year=${year}">${n} Tage</a>`).join('')}</div>
      <div class="card stats" style="grid-template-columns:repeat(4,1fr)"><div><b>${f1(am)}</b><span>Ø Stimmung</span></div><div><b>${f1(ae)}</b><span>Ø Energie</span></div><div><b>${withMood.length}</b><span>Tage mit Stimmung</span></div><div><b>${best ? MOODS[Math.round(best.mood) - 1].e : '–'}</b><span>${best ? 'Bester Tag: ' + fmtShort(best.date) : 'Bester Tag'}</span></div></div>
      <div class="card"><h2>Verlauf</h2>${withMood.length ? lineChart(range.days, from, to) : '<div class="empty">Noch keine Stimmungsdaten in diesem Zeitraum. <p>Trage auf der Übersicht oder im Tagebuch deine Stimmung ein.</p><a class="btn primary small" href="#/">🙂 Zur Übersicht</a></div>'}
        <div class="legend"><span><b style="color:var(--accent)">━</b> Stimmung</span><span>╌ Energie</span></div></div>
      <div class="grid ${insCard ? 'cols-2' : ''}"><section class="card"><h2>Nach Wochentag</h2><div class="ybars">${wdHTML}</div></section>${insCard}</div>
      <div class="card"><div class="row-flex"><h2 style="margin:0">Jahr in Pixeln – ${year}</h2><span class="spacer"></span><a class="btn small" href="#/mood?days=${days}&year=${year - 1}">←</a><a class="btn small" href="#/mood?days=${days}&year=${year + 1}">→</a></div>
        <div class="pixels" style="margin-top:12px">${px}</div><div class="legend">${MOODS.map((m) => `<span><b style="color:${m.c}">■</b> ${m.l}</span>`).join('')}<span><b style="color:var(--accent-soft)">■</b> Eintrag ohne Stimmung</span></div></div>`;
  }

  M.routes.push([/^\/mood$/, moodView]);
})();
