'use strict';
/* Start: Service Worker, Live-Updates, Freigabe-Ziel, dann Anmeldung/Boot */
(() => {
  const M = window.M;

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  /* Live-Updates: Dateien wurden von außen geändert (Sync, Obsidian …) */
  let es = null, timer = null;
  function live() {
    if (es || !M.state.me || !window.EventSource) return;
    es = new EventSource('/api/events');
    es.addEventListener('change', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        M.invalidate();
        if (document.querySelector('#edForm') || document.querySelector('.modal-bg')) return; // nicht beim Schreiben stören
        if (/^#\/(settings|new)/.test(location.hash)) return;
        M.route();
      }, 600);
    });
    es.onerror = () => { /* Browser verbindet automatisch neu */ };
  }
  setInterval(live, 3000);

  /* Teilen-Ziel (Android): Text/Link landet im heutigen Tagebuch */
  async function handleShare() {
    const p = new URLSearchParams(location.search);
    const text = [p.get('title'), p.get('text'), p.get('url')].filter(Boolean).join(' – ');
    if (!text) return;
    history.replaceState(null, '', '/' + location.hash);
    try { await M.api('/api/journal/append', { method: 'POST', body: { text } }); M.invalidate(); M.toast('Zum heutigen Tagebuch hinzugefügt'); M.go('#/journal/' + M.todayStr()); } catch (e) { M.toast(e.message, 'err'); }
  }

  M.boot().then(handleShare);
})();
