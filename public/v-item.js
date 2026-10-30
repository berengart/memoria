'use strict';
/* Detailansicht */
(() => {
  const M = window.M;
  const { $, $$, esc, enc, pad, isDate, todayStr, parseD, fmtD, addDays, diffDays, fmtLong, fmtShort, monthName, ago, MOODS, moodColor, TYPE, href, feat, go, api, getItems, invalidate, toast, dispTitle, tagChips, moodChip, fileUrl, avatar, row, isDark, embedHTML, songLine, lookupSong, onLeave } = M;
  const app = M.$('#app');
  /* ---------------------------------------------------------- Detailseite */
  async function itemView([type, slug], query) {
    let it = null;
    try { it = await api(`/api/item/${type}/${enc(slug)}`); } catch (e) { if (e.status !== 404) throw e; }
    if (!it) {
      if (type === 'journal' && isDate(slug)) return M.editor({ type, slug: null, date: slug, meta: {}, body: '', tags: [], isNew: true });
      throw new Error('Nicht gefunden.');
    }
    if (query.edit === '1') return M.editor(it);
    return renderItem(it);
  }

  const lst = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

  function factsHTML(it) {
    const m = it.meta, f = [];
    const add = (k, v, html) => { if (v) f.push(`<div class="fact"><div class="k">${k}</div><div class="v">${html || esc(v)}</div></div>`); };
    add('Geburtsname', m.maidenname); add('Spitzname', m.nickname); add('Beziehung', m.relationship);
    if (m.birthday) {
      const b = String(m.birthday); const full = b.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      let extra = '';
      if (full) { const t = todayStr(); let age = +t.slice(0, 4) - +full[1]; if (t.slice(5) < `${full[2]}-${full[3]}`) age--; extra = ` (${age} Jahre)`; }
      const md = b.match(/^(?:--)?(\d{2})-(\d{2})$/);
      add('Geburtstag', b, esc(full ? fmtShort(b) : md ? `${md[2]}.${md[1]}.` : b) + extra);
    }
    const lab = (x) => (x.label ? ` <span class="muted">(${esc(x.label)})</span>` : '');
    const phones = [...(m.phone ? [{ value: m.phone }] : []), ...lst(m.phones)];
    if (phones.length) add('Telefon', 'x', phones.map((x) => `<a href="tel:${esc(String(x.value).replace(/\s/g, ''))}">${esc(x.value)}</a>${lab(x)}`).join('<br>'));
    const mails = [...(m.email ? [{ value: m.email }] : []), ...lst(m.emails)];
    if (mails.length) add('E-Mail', 'x', mails.map((x) => `<a href="mailto:${esc(x.value)}">${esc(x.value)}</a>${lab(x)}`).join('<br>'));
    add('Webseite', m.website, m.website ? `<a href="${esc(/^https?:/.test(m.website) ? m.website : 'https://' + m.website)}" target="_blank" rel="noopener noreferrer">${esc(m.website)}</a>` : '');
    const adr = [...(m.address ? [{ value: m.address }] : []), ...lst(m.addresses)];
    if (adr.length) add('Adresse', 'x', adr.map((x) => `${x.home ? '<b title="aktueller Wohnort">🏠 Wohnort</b><br>' : ''}${esc(x.value).replace(/\n/g, '<br>')}${lab(x)}${Number.isFinite(+x.lat) && x.lat !== undefined && x.lat !== '' ? ' <span title="Auf der Karte vorhanden">📍</span>' : ''}`).join('<hr class="thin">'));
    const rp = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []);
    const orte = rp(m.places).map((o) => (typeof o === 'string' ? o : o.name)).filter(Boolean);
    if (orte.length) add('Frühere Wohnorte', 'x', orte.map((o) => esc(o)).join(', '));
    add('Firma', m.company); add('Beruf', m.job); add('Kennengelernt', m.met);
    add('Letzter Kontakt', it.lastContact, it.lastContact ? `${fmtShort(it.lastContact)} <span class="muted">(${ago(it.lastContact)})</span>` : '');
    if (m.contact_every) add('Kontaktwunsch', 'x', `alle ${esc(m.contact_every)} Tage`);
    return f.length ? `<div class="facts">${f.join('')}</div>` : '';
  }

  const KIND = { journal: ['📓', 'Tagebuch'], note: ['📝', 'Notiz'], activity: ['📅', 'Aktivität'], person: ['👤', 'Person'] };
  const money = (n, cur) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

  function timelineHTML(x, filter) {
    const list = x.timeline.filter((e) => filter === 'all' || e.kind === filter);
    if (!list.length) return '<div class="empty"><p>Noch nichts. Verlinke diese Person im Tagebuch (z. B. [[Name]]) oder trage oben eine Aktivität ein.</p></div>';
    let year = '', out = '<div class="tl">';
    for (const e of list) {
      if (e.date.slice(0, 4) !== year) { year = e.date.slice(0, 4); out += `<div class="tl-year">${year}</div>`; }
      const k = KIND[e.kind] || KIND.note;
      const title = e.kind === 'activity' ? esc(e.title) : `<a href="#/${e.type}/${enc(e.slug)}">${esc(e.kind === 'journal' ? fmtLong(e.date) + (e.title && e.title !== e.slug && e.title !== e.date ? ' – ' + e.title : '') : e.title)}</a>`;
      const sub = e.kind === 'activity' ? [e.place, e.note].filter(Boolean).map(esc).join(' · ') : esc(e.enc ? '🔒 verschlüsselt' : e.context);
      out += `<div class="tl-item"><span class="tl-dot" title="${k[1]}">${k[0]}</span><div><div class="tl-date">${esc(fmtShort(e.date))}${e.mood ? ' ' + moodChip(e.mood) : ''}</div><div class="tl-title">${title}</div>${sub ? `<div class="tl-sub">${sub}</div>` : ''}</div></div>`;
    }
    return out + '</div>';
  }

  async function renderItem(it) {
    const items = await getItems();
    let adj = '';
    if (it.type === 'journal' && it.date) {
      const js = items.filter((i) => i.type === 'journal' && i.date).sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug));
      const idx = js.findIndex((i) => i.id === it.id);
      const prev = js[idx - 1], next = js[idx + 1];
      adj = `<div class="nav-adj"><span>${prev ? `<a href="${href(prev)}">← ${esc(fmtShort(prev.date))}</a>` : ''}</span><span>${next ? `<a href="${href(next)}">${esc(fmtShort(next.date))} →</a>` : ''}</span></div>`;
    }
    let sub = '';
    if (it.type === 'journal') {
      const bits = [];
      if (it.energy) bits.push(`Energie: ${it.energy}/5`);
      if (it.meta.sleep) bits.push(`Schlaf: ${esc(it.meta.sleep)} h`);
      if (it.meta.weather) bits.push(esc(it.meta.weather));
      if (it.meta.location) bits.push('📍 ' + esc(it.meta.location));
      sub = bits.length ? `<div class="muted">${bits.join(' · ')}</div>` : '';
    }
    const x = it.extras;
    const head = it.type === 'person'
      ? `${avatar(it, true)}<div><h1>${esc(it.title)}</h1><div class="muted">${esc((it.aliases || []).join(', '))}</div></div>`
      : `<div><h1>${esc(dispTitle(it))}${it.encrypted ? ' <span title="Text verschlüsselt">🔒</span>' : ''}${moodChip(it.mood)}</h1>${sub}</div>`;
    const songBlock = it.type === 'journal' && it.meta.song ? `<div style="margin-top:12px">${songLine(String(it.meta.song), String(it.meta.song_url || ''))}${M.state.settings.songEmbed && it.meta.song_url ? embedHTML(String(it.meta.song_url)) : ''}</div>` : '';
    const blTitle = it.type === 'person' ? 'Erwähnt in' : 'Verlinkt von';

    let personBlocks = '';
    if (x) {
      const rel = x.relations.length ? `<div class="chips" style="margin-top:12px">${x.relations.map((r) => (r.slug ? `<a class="tag" href="#/person/${enc(r.slug)}">${esc(r.label)}: ${esc(r.title)}</a>` : `<span class="tag">${esc(r.label)}: ${esc(r.title)}</span>`)).join('')}</div>` : '';
      const st = x.stats;
      const stats = st.total ? `<p class="muted small-text" style="margin:12px 0 0">${st.total} Erwähnung${st.total === 1 ? '' : 'en'}/Aktivitäten${st.first ? ` · erster Eintrag ${esc(fmtShort(st.first))}` : ''}${st.last ? ` · zuletzt ${esc(fmtShort(st.last))}` : ''}</p>` : '';
      const bal = Object.entries(x.balance).filter(([, v]) => v);
      const gifts = x.gifts.length ? `<section class="card"><h2>🎁 Geschenkideen</h2>${x.gifts.map((g) => `<div class="row"><span class="row-ic">${g.status === 'verschenkt' ? '✅' : g.status === 'gekauft' ? '🛍️' : '💡'}</span><div class="row-main"><div class="row-title">${g.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">${esc(g.idea)}</a>` : esc(g.idea)}</div><div class="row-sub">${esc(g.status)}${g.note ? ' · ' + esc(g.note) : ''}</div></div></div>`).join('')}</section>` : '';
      const debts = x.debts.length ? `<section class="card"><h2>💶 Schulden ${bal.length ? bal.map(([c, v]) => `<span class="tag" style="font-size:.8em">${v > 0 ? 'schuldet dir' : 'du schuldest'} ${money(Math.abs(v), c)}</span>`).join(' ') : '<span class="muted small-text">alles beglichen</span>'}</h2>${x.debts.map((d, i) => `<div class="row"><span class="row-ic">${d.direction === 'mir_geschuldet' ? '⬅️' : '➡️'}</span><div class="row-main"><div class="row-title" style="${d.settled ? 'text-decoration:line-through;opacity:.6' : ''}">${money(d.amount, d.currency)} – ${d.direction === 'mir_geschuldet' ? 'schuldet dir' : 'du schuldest'}</div><div class="row-sub">${esc([d.note, d.date && fmtShort(d.date)].filter(Boolean).join(' · '))}</div></div><button class="btn small" data-settle="${i}">${d.settled ? 'wieder offen' : 'beglichen'}</button></div>`).join('')}</section>` : '';
      personBlocks = { rel, stats, gifts, debts };
    }
    const outBlock = it.outgoing.length ? `<section class="card"><h2>Verlinkt auf</h2><div class="chips">${it.outgoing.map((o) => `<a class="tag" href="${href(o)}">${TYPE[o.type].ic} ${esc(o.type === 'journal' && o.date ? fmtShort(o.date) : o.title)}</a>`).join('')}</div></section>` : '';
    const unlBlock = feat('unlinked') && it.unlinked.length ? `<section class="card"><details><summary>Nicht verlinkte Erwähnungen (${it.unlinked.length})</summary>${it.unlinked.map((u) => row(u)).join('')}</details></section>` : '';
    const mdBlock = `<div class="md" id="itemBody">${it.encrypted ? '<p class="muted">🔒 Dieser Text ist verschlüsselt. <button class="btn small" id="decBtn">Entsperren</button></p>' : (it.html || '<p class="muted">Noch kein Inhalt. Klicke auf „Bearbeiten“.</p>')}</div>`;
    const tabsHtml = x ? `<div class="ptabs" role="tablist" aria-label="Bereiche der Person">${[['over', 'Überblick', ''], ['time', 'Zeitleiste', x.stats.total || ''], ['fam', 'Familie & Orte', ''], ['gift', 'Geschenke & Schulden', x.gifts.length + x.debts.length || '']].map(([k, l, n], i) => `<button type="button" role="tab" id="ptb-${k}" aria-controls="pt-${k}" aria-selected="${i ? 'false' : 'true'}" tabindex="${i ? -1 : 0}" data-pt="${k}">${l}${n ? ` <span class="pt-n">${n}</span>` : ''}</button>`).join('')}</div>` : '';
    const bodyHtml = `<hr style="border:0;border-top:1px solid var(--line);margin:16px 0">${mdBlock}${adj}`;
    app.innerHTML = `
      <article class="card">
        <div class="item-head">${head}<span class="spacer"></span>
          <button class="btn" id="histBtn" title="Frühere Fassungen">🕘 Verlauf</button>
          ${it.type === 'person' ? `<a class="btn" href="/api/vcard/${enc(it.slug)}" download title="Als vCard speichern">⬇ vCard</a>` : ''}
          <a class="btn" href="#/${it.type}/${enc(it.slug)}?edit=1">✏️ Bearbeiten</a><button class="btn danger ghost" id="delBtn" title="Löschen">🗑️</button></div>
        ${it.type === 'person' ? factsHTML(it) : ''}
        ${it.type === 'note' && it.date ? `<p class="muted" style="margin:8px 0 0">📅 ${esc(fmtLong(it.date))}</p>` : ''}
        ${personBlocks ? personBlocks.rel + personBlocks.stats : ''}
        ${songBlock}
        ${it.tags.length ? `<div class="chips" style="margin-top:12px">${tagChips(it.tags)}</div>` : ''}
        ${it.type === 'person' && feat('quicklog') ? `<form id="plog" class="quick" style="margin-top:16px"><input type="text" id="plogText" placeholder="Was war mit ${esc(it.title)}? → ins heutige Tagebuch" autocomplete="off"><button class="btn">Notieren</button></form>` : ''}
        ${x ? '' : bodyHtml}
      </article>
      ${x ? tabsHtml : ''}
      ${x ? `<div id="pt-over" role="tabpanel" class="ptab"><section class="card">${mdBlock}</section>${outBlock}${unlBlock}</div>
      <div id="pt-time" role="tabpanel" class="ptab" hidden>
      <section class="card"><div class="row-flex"><h2 style="margin:0">📅 Zeitleiste</h2><span class="spacer"></span>
          <div class="chips" id="tlFilter">${[['all', 'Alle'], ['journal', 'Tagebuch'], ['note', 'Notizen'], ['activity', 'Aktivitäten']].map(([k, l], i) => `<button type="button" class="pill ${i ? '' : 'on'}" data-f="${k}">${l}</button>`).join('')}</div></div>
        <form id="actForm" class="quick" style="margin:12px 0">${M.dateHTML({ id: 'actDate', value: todayStr(), wrapStyle: 'width:170px' })}<input type="text" id="actTitle" placeholder="Aktivität oder Treffen hinzufügen – z. B. „Wandern am See“" required><button class="btn">＋ Eintragen</button></form>
        <div id="tlBody">${timelineHTML(x, 'all')}</div></section></div>
      <div id="pt-fam" role="tabpanel" class="ptab" hidden>
      ${feat('map') && [...lst(it.meta.addresses), ...lst(it.meta.places)].some((a) => Number.isFinite(+a.lat) && Number.isFinite(+a.lon) && a.lat !== '' && a.lon !== '' && a.lat !== undefined) ? '<section class="card" id="mapCard"><div class="row-flex"><h2 style="margin:0">📍 Wohnort &amp; frühere Wohnorte</h2><span class="spacer"></span><a class="btn small" href="#/map">🗺️ Alle auf der Karte</a></div></section>' : ''}
      ${feat('people') ? '<section class="card" id="famCard"></section>' : ''}
        ${feat('people') || feat('map') ? '' : '<div class="card empty">Hier erscheinen Familie und Orte.</div>'}</div>
      <div id="pt-gift" role="tabpanel" class="ptab" hidden>${personBlocks.gifts}${personBlocks.debts}${!x.gifts.length && !x.debts.length ? `<div class="card empty"><p>Noch keine Geschenkideen oder Schulden.</p><a class="btn small" href="#/person/${enc(it.slug)}?edit=1">🎁 Im Bearbeiten-Modus eintragen</a></div>` : ''}</div>` : ''}
      ${feat('backlinks') && it.backlinks.length && it.type !== 'person' ? `<section class="card"><h2>${blTitle} <span class="muted small-text">${it.backlinks.length}</span></h2>${it.backlinks.map((b) => `<div class="bl"><a href="${href(b)}"><strong>${TYPE[b.type].ic} ${esc(dispTitle(b))}</strong></a>${moodChip(b.mood)}${b.context ? `<div class="ctx">${esc(b.context)}</div>` : ''}</div>`).join('')}</section>` : ''}
      ${x ? '' : outBlock}
      ${x ? '' : unlBlock}`;

    if ($('#mapCard')) M.map.miniMap($('#mapCard'), it);
    if ($('#famCard')) M.family.familyCard(it.slug, it.title, $('#famCard'));
    const tabs = $$('.ptabs [role=tab]', app);
    if (tabs.length) {
      const pick = (k, focus) => { tabs.forEach((t) => { const on = t.dataset.pt === k; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); }); $$('.ptab', app).forEach((p) => { p.hidden = p.id !== 'pt-' + k; }); try { sessionStorage.setItem('ptab', k); } catch (e) { /* egal */ } };
      tabs.forEach((t, i) => { t.addEventListener('click', () => pick(t.dataset.pt)); t.addEventListener('keydown', (e) => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { e.preventDefault(); pick(tabs[(i + d + tabs.length) % tabs.length].dataset.pt, true); } }); });
      const qk = (location.hash.match(/[?&]tab=(\w+)/) || [])[1];
      let rk = qk; if (!rk) { try { rk = sessionStorage.getItem('ptab'); } catch (e) { /* egal */ } }
      if (rk && $('#pt-' + rk) && rk !== 'over') pick(rk);
    }
    $('#histBtn').addEventListener('click', () => M.openHistory(it));
    $('#delBtn').addEventListener('click', async () => {
      if (!confirm(`„${it.title}“ wirklich löschen? (Die Datei landet im Ordner .trash)`)) return;
      await api(`/api/item/${it.type}/${enc(it.slug)}`, { method: 'DELETE' }); invalidate(); toast('Gelöscht'); go('#/' + TYPE[it.type].list);
    });
    const plog = $('#plog');
    if (plog) plog.addEventListener('submit', async (e) => {
      e.preventDefault(); const text = $('#plogText').value.trim(); if (!text) return;
      try { await api('/api/journal/append', { method: 'POST', body: { text: `[[${it.title}]] – ${text}` } }); invalidate(); toast('Im heutigen Tagebuch notiert'); renderItem(await api(`/api/item/${it.type}/${enc(it.slug)}`)); } catch (err) { toast(err.message, 'err'); }
    });

    /* Verschlüsselter Text */
    if (it.encrypted) {
      const show = async (ask) => {
        if (ask ? !(await M.crypt.ensure(false)) : false) return;
        try {
          const plain = await M.crypt.decrypt(it.body);
          const r = await api('/api/render', { method: 'POST', body: { body: plain } });
          $('#itemBody').innerHTML = r.html || '<p class="muted">Leer.</p>';
        } catch (e) { if (ask) toast(e.message, 'err'); }
      };
      const b = $('#decBtn'); if (b) b.addEventListener('click', () => show(true));
      M.crypt.restore().then(() => { if (M.crypt.isUnlocked()) show(false); });
    }

    /* Person: Zeitleiste, Aktivitäten, Schulden */
    if (x) {
      $$('#tlFilter .pill').forEach((b) => b.addEventListener('click', () => { $$('#tlFilter .pill').forEach((o) => o.classList.toggle('on', o === b)); $('#tlBody').innerHTML = timelineHTML(x, b.dataset.f); }));
      const save = async (patch) => { await api(`/api/item/person/${enc(it.slug)}`, { method: 'PUT', body: { meta: patch, baseMtime: it.mtime } }); invalidate(); renderItem(await api(`/api/item/person/${enc(it.slug)}`)); };
      $('#actForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        let dt; try { dt = M.readDate($('#actDate')); } catch (ex) { toast(ex.message, 'err'); return; }
        const act = { date: dt || todayStr(), title: $('#actTitle').value.trim() };
        try { await save({ activities: [...lst(it.meta.activities), act] }); toast('Aktivität eingetragen'); } catch (err) { toast(err.message, 'err'); }
      });
      $$('[data-settle]').forEach((b) => b.addEventListener('click', async () => {
        const debts = lst(it.meta.debts).map((d) => ({ ...d }));
        const raw = x.debts[+b.dataset.settle];
        const i = debts.findIndex((d) => Number(d.amount) === raw.amount && (d.note || '') === raw.note && !!d.settled === raw.settled && (d.direction || 'ich_schulde') === raw.direction);
        if (i < 0) return;
        if (debts[i].settled) delete debts[i].settled; else debts[i].settled = true;
        try { await save({ debts }); } catch (err) { toast(err.message, 'err'); }
      }));
    }
  }

  M.renderItem = renderItem; M.factsHTML = factsHTML;
  M.routes.push([/^\/(person|journal|note)\/([^/]+)$/, itemView]);
})();
