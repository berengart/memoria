'use strict';
/* Jahresrückblick und Datenprüfung */
(() => {
  const M = window.M;
  const { $, $$, esc, enc, api, toast, MOODS, moodColor, avatar } = M;
  const app = $('#app');
  const de = (n, d = 1) => (n === null || n === undefined ? '–' : Number(n).toFixed(d).replace('.', ','));
  const MN = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const emoji = (v) => (v ? MOODS[Math.min(4, Math.max(0, Math.round(v) - 1))].e : '–');

  /* ------------------------------------------------------------ Jahresrückblick */
  async function reviewView(_, q) {
    const now = new Date().getFullYear();
    const d = await api('/api/review?year=' + enc(q.year || now));
    const years = [...new Set([...(d.years || []).map(Number), now, d.year])].sort((a, b) => b - a);
    const tile = (v, l, sub) => `<div class="rv-tile"><b>${v}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const maxEntries = Math.max(1, ...d.months.map((m) => m.entries));
    const bars = d.months.map((m, i) => {
      const x = 12 + i * 46, h = m.avg ? Math.round((m.avg / 5) * 90) : 0;
      return `<g><title>${MN[i]}: ${m.entries} Einträge${m.avg ? `, Ø Stimmung ${de(m.avg)}` : ''}</title><rect x="${x}" y="${110 - h}" width="34" height="${h}" rx="5" fill="${m.avg ? moodColor(m.avg) : 'transparent'}"/><rect x="${x}" y="116" width="34" height="${Math.round((m.entries / maxEntries) * 8) + (m.entries ? 2 : 0)}" rx="2" fill="var(--muted)" opacity=".45"/><text x="${x + 17}" y="140" text-anchor="middle" class="rv-ax">${MN[i]}</text>${m.avg ? `<text x="${x + 17}" y="${106 - h}" text-anchor="middle" class="rv-ax">${emoji(m.avg)}</text>` : ''}</g>`;
    }).join('');
    const total = d.moodDist.reduce((s, x) => s + x, 0);
    app.innerHTML = `<div class="card"><div class="row-flex"><h1 style="margin:0">🎞️ Jahresrückblick</h1><span class="spacer"></span>
        <select id="rvYear" aria-label="Jahr" style="width:auto">${years.map((y) => `<option ${y === d.year ? 'selected' : ''}>${y}</option>`).join('')}</select><button class="btn small" id="rvPrint">🖨️ Drucken</button></div>
        <p class="muted" style="margin:8px 0 0">${d.entries ? `Dein ${d.year} in Zahlen – aus Tagebuch, Treffen und Personen.` : `Für ${d.year} gibt es noch keine Tagebucheinträge.`}</p></div>
      ${d.entries || d.activities ? `<section class="card"><div class="rv-tiles">${tile(d.entries, 'Tagebuch&shy;einträge')}${tile(d.words.toLocaleString('de-DE'), 'Wörter')}${tile(d.avgMood ? emoji(d.avgMood) + ' ' + de(d.avgMood) : '–', 'Ø Stimmung', d.avgEnergy ? `Energie Ø ${de(d.avgEnergy)}` : '')}${tile(d.streak.days || '–', 'Tage am Stück', d.streak.end ? `bis ${M.fmtShort(d.streak.end)}` : '')}${tile(d.activities, 'Treffen &amp; Aktivitäten')}${d.newPeople ? tile(d.newPeople, 'Neue Personen') : ''}</div></section>
      ${total ? `<section class="card"><h2>Stimmung im Jahresverlauf</h2><svg class="rv-chart" viewBox="0 0 570 150" role="img" aria-label="Stimmung je Monat">${bars}</svg>
        <div class="rv-dist">${d.moodDist.map((n, i) => `<span title="${MOODS[i].l}">${MOODS[i].e} <b>${n}</b></span>`).join('')}</div>
        <div class="row-flex" style="margin-top:8px">${d.best ? `<a class="tag" href="#/journal/${enc(d.best.slug)}">☀️ Bester Tag: ${M.fmtShort(d.best.date)}</a>` : ''}${d.worst && d.worst.mood < 4 ? `<a class="tag" href="#/journal/${enc(d.worst.slug)}">🌧️ Schwerster Tag: ${M.fmtShort(d.worst.date)}</a>` : ''}</div></section>` : ''}
      <div class="grid2">${d.people.length ? `<section class="card"><h2>👥 Wichtigste Menschen</h2>${d.people.map((p, i) => `<a class="row" href="#/person/${enc(p.slug)}">${avatar({ title: p.title, photo: p.photo })}<div class="row-main"><div class="row-title">${i + 1}. ${esc(p.title)}</div><div class="row-sub">${p.mentions} Erwähnung${p.mentions === 1 ? '' : 'en'}${p.activities ? ` · ${p.activities} Treffen` : ''}</div></div></a>`).join('')}</section>` : ''}
        <div>${d.places.length ? `<section class="card"><h2>📍 Orte</h2><div class="chips">${d.places.map((p) => `<span class="tag">${esc(p.name)} · ${p.count}×</span>`).join('')}</div></section>` : ''}
        ${d.songs.length ? `<section class="card"><h2>🎵 Lieder des Tages</h2>${d.songs.map((s) => `<div class="row-sub" style="padding:3px 0">${esc(s.name)}${s.n > 1 ? ` <span class="muted">· ${s.n}×</span>` : ''}</div>`).join('')}</section>` : ''}
        ${d.tags.length ? `<section class="card"><h2>🏷️ Themen</h2><div class="chips">${d.tags.map((t) => `<a class="tag" href="#/tag/${enc(t.name)}">#${esc(t.name)} · ${t.n}</a>`).join('')}</div></section>` : ''}</div></div>
      ${d.activityList.length ? `<section class="card"><h2>📅 Treffen &amp; Aktivitäten</h2>${d.activityList.map((a) => `<a class="row" href="#/person/${enc(a.slug)}"><span class="row-ic">📅</span><div class="row-main"><div class="row-title">${esc(a.title)}</div><div class="row-sub">${M.fmtShort(a.date)} · ${esc(a.person)}${a.place ? ' · ' + esc(a.place) : ''}</div></div></a>`).join('')}${d.activities > d.activityList.length ? `<p class="muted small-text">… und ${d.activities - d.activityList.length} weitere</p>` : ''}</section>` : ''}` : ''}`;
    $('#rvYear').addEventListener('change', (e) => M.go('#/review?year=' + e.target.value));
    $('#rvPrint').addEventListener('click', () => window.print());
  }

  /* ------------------------------------------------------------ Datenprüfung */
  const KINDS = {
    'broken-link': ['🔗', 'Links ins Leere'], 'relation-missing': ['👥', 'Beziehungen auf fehlende Personen'], 'photo-missing': ['🖼️', 'Fehlende Fotos'], 'missing-attachment': ['📎', 'Fehlende eingebettete Dateien'],
    family: ['🌳', 'Stammbaum'], 'family-cycle': ['🌳', 'Stammbaum'], 'orphan-attachment': ['🗑️', 'Ungenutzte Anhänge'], duplicate: ['👯', 'Mögliche Dubletten'],
  };
  async function checkView() {
    app.innerHTML = '<div class="card"><h1>🧹 Datenprüfung</h1><p class="muted">Prüfe …</p></div>';
    const draw = async () => {
      const r = await api('/api/integrity');
      const groups = new Map(); for (const i of r.issues) { const k = KINDS[i.kind] ? KINDS[i.kind][1] : i.kind; if (!groups.has(k)) groups.set(k, { ic: (KINDS[i.kind] || ['•'])[0], items: [] }); groups.get(k).items.push(i); }
      app.innerHTML = `<div class="card"><div class="row-flex"><h1 style="margin:0">🧹 Datenprüfung</h1><span class="spacer"></span><button class="btn" id="ckAgain">↻ Erneut prüfen</button></div>
        <p class="muted" style="margin:8px 0 0">${r.checked.items} Einträge und ${r.checked.attachments} Anhänge geprüft: ${r.issues.length ? `<b>${r.issues.length} Hinweis${r.issues.length === 1 ? '' : 'e'}</b>` : '<b>alles in Ordnung ✓</b>'}. Es wird nichts ohne dein Zutun geändert.</p></div>
        ${[...groups].map(([name, g]) => `<section class="card"><h2>${g.ic} ${esc(name)} <span class="muted small-text">${g.items.length}</span></h2>${g.items.map((i) => `<div class="ck-row" data-id="${i.id}"><div class="ck-main"><div class="row-title">${esc(i.title)}</div>${i.detail ? `<div class="row-sub">${esc(i.detail)}</div>` : ''}
          <div class="ck-links">${(i.from || []).map((f) => `<a class="tag" href="#/${f.type}/${enc(f.slug)}">${esc(f.title)}</a>`).join('')}${i.slug ? `<a class="tag" href="#/person/${enc(i.slug)}?edit=1">Person bearbeiten</a>` : ''}${(i.people || []).map((p) => `<a class="tag" href="#/person/${enc(p.slug)}">${esc(p.title)}</a>`).join('')}</div></div>
          <div class="ck-fix">${(i.fixes || []).map((f, k) => `<button class="btn small" data-k="${k}">${esc(f.label)}</button>`).join('')}</div></div>`).join('')}</section>`).join('')}`;
      $('#ckAgain').addEventListener('click', draw);
      app.addEventListener('click', async (e) => {
        const b = e.target.closest('.ck-fix button'); if (!b) return;
        const row = b.closest('.ck-row'), issue = r.issues.find((x) => x.id === +row.dataset.id), fix = issue && issue.fixes[+b.dataset.k]; if (!fix) return;
        if (fix.action === 'trash-attachment' && !confirm(`„${fix.name}“ in den Papierkorb verschieben?`)) return;
        b.disabled = true;
        try { await api('/api/integrity/fix', { method: 'POST', body: fix }); M.invalidate(); toast('Erledigt ✓'); draw(); } catch (err) { toast(err.message, 'err'); b.disabled = false; }
      }, { once: true });
    };
    await draw();
  }

  M.routes.push([/^\/review$/, reviewView], [/^\/check$/, checkView]);
})();
