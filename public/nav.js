'use strict';
/* Navigation: Menü „Mehr“ (Aufklappmenü am Computer, Fenster von unten am Handy) */
(() => {
  const M = window.M;
  const { $, $$, esc, feat, todayStr } = M;
  const btn = $('#navMore'), menu = $('#moreMenu'), bg = $('#moreBg');
  const items = () => [
    { ic: '📝', t: 'Notizen', to: '#/notes', mob: true },
    ...(feat('mood') ? [{ ic: '☺️', t: 'Stimmung', to: '#/mood' }] : []),
    ...(feat('music') ? [{ ic: '🎵', t: 'Lieder des Tages', to: '#/songs' }] : []),
    ...(feat('graph') ? [{ ic: '🕸️', t: 'Graph', to: '#/graph' }] : []),
    { ic: '🎞️', t: 'Jahresrückblick', to: '#/review' }, { ic: '🧹', t: 'Datenprüfung', to: '#/check' },
    { ic: '⌨️', t: 'Tastenkürzel', run: () => M.quick && M.quick.help(), hint: '?' },
    { ic: '⚙️', t: 'Einstellungen', to: '#/settings', mob: true },
  ];
  const open = () => {
    menu.innerHTML = items().map((i, n) => (i.to ? `<a role="menuitem" href="${i.to}" class="${i.mob ? 'mob-only' : ''}" tabindex="-1">` : `<button type="button" role="menuitem" data-run="${n}" class="${i.mob ? 'mob-only' : ''}" tabindex="-1">`) + `<span class="mi-ic" aria-hidden="true">${i.ic}</span><span>${esc(i.t)}</span>${i.hint ? `<kbd>${esc(i.hint)}</kbd>` : ''}` + (i.to ? '</a>' : '</button>')).join('');
    menu.hidden = false; bg.hidden = false; btn.setAttribute('aria-expanded', 'true');
    if (!document.body.classList.contains('narrow')) { const r = btn.getBoundingClientRect(); menu.style.left = r.right + 10 + 'px'; menu.style.right = 'auto'; menu.style.bottom = 'auto'; menu.style.top = Math.max(8, Math.min(r.top, window.innerHeight - menu.offsetHeight - 12)) + 'px'; }
    else { menu.style.top = menu.style.right = menu.style.left = menu.style.bottom = ''; }
    const first = $('[role=menuitem]:not(.mob-only)', menu) || $('[role=menuitem]', menu); if (first && getComputedStyle(first).display !== 'none') first.focus();
    else { const v = $$('[role=menuitem]', menu).find((x) => getComputedStyle(x).display !== 'none'); if (v) v.focus(); }
  };
  const close = (refocus) => { if (menu.hidden) return; menu.hidden = true; bg.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (refocus) btn.focus(); };
  const narrow = () => document.body.classList.toggle('narrow', window.matchMedia('(max-width: 760px)').matches);
  narrow(); window.addEventListener('resize', narrow);
  btn.addEventListener('click', () => (menu.hidden ? open() : close(true)));
  bg.addEventListener('click', () => close());
  menu.addEventListener('click', (e) => { const r = e.target.closest('[data-run]'); const it = r && items()[+r.dataset.run]; close(); if (it && it.run) setTimeout(it.run, 30); });
  document.addEventListener('keydown', (e) => {
    if (menu.hidden) return;
    const vis = $$('[role=menuitem]', menu).filter((x) => getComputedStyle(x).display !== 'none'); const i = vis.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); vis[(i + 1) % vis.length].focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); vis[(i - 1 + vis.length) % vis.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); vis[0].focus(); } else if (e.key === 'End') { e.preventDefault(); vis[vis.length - 1].focus(); } else if (e.key === 'Tab') close();
  }, true);
  window.addEventListener('hashchange', () => close());
  $('#skipLink').addEventListener('click', (e) => { e.preventDefault(); $('#app').focus(); });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-focus]'); const t = b && $(b.dataset.focus); if (t) { t.scrollIntoView({ block: 'center' }); t.focus(); } });
})();

/* Seitenleiste ein-/ausklappen (merkt sich die Wahl) */
(() => {
  const b = document.getElementById('sbToggle'); if (!b) return;
  let v = null; try { v = localStorage.getItem('sbmin'); } catch (e) { /* egal */ }
  const set = (min, save) => { document.body.classList.toggle('sb-min', min); b.setAttribute('aria-expanded', min ? 'false' : 'true'); if (save) { try { localStorage.setItem('sbmin', min ? '1' : '0'); } catch (e) { /* egal */ } } };
  set(v === null ? window.innerWidth < 1100 : v === '1');
  b.addEventListener('click', () => set(!document.body.classList.contains('sb-min'), true));
})();
document.querySelectorAll('#nav a, #nav button.nav-more').forEach((e) => { const l = e.querySelector('.nl'); if (l) e.title = l.textContent.trim(); });
