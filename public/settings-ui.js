'use strict';
/* Memoria – Anmeldung, Design, Einstellungen, Start */
(() => {
  const M = window.M;
  const { $, $$, esc, api, toast } = M;
  const app = $('#app');

  /* ------------------------------------------------------------ Themes */
  const THEMES = [
    ['auto', 'Automatisch', '#f5f6f9', '#ffffff', '#4f46e5', '#1d2130'],
    ['light', 'Hell', '#f5f6f9', '#ffffff', '#4f46e5', '#1d2130'],
    ['dark', 'Dunkel', '#14161d', '#1c1f29', '#7b92ff', '#e6e8f0'],
    ['nord', 'Nord', '#2e3440', '#3b4252', '#88c0d0', '#eceff4'],
    ['nord-light', 'Nord Hell', '#e5e9f0', '#f4f6fa', '#5e81ac', '#2e3440'],
    ['dracula', 'Dracula', '#282a36', '#343746', '#bd93f9', '#f8f8f2'],
    ['solarized-light', 'Solarized Hell', '#fdf6e3', '#fffbed', '#268bd2', '#586e75'],
    ['solarized-dark', 'Solarized Dunkel', '#002b36', '#073642', '#2aa198', '#a7b5b6'],
    ['gruvbox-dark', 'Gruvbox Dunkel', '#282828', '#3c3836', '#fabd2f', '#ebdbb2'],
    ['gruvbox-light', 'Gruvbox Hell', '#fbf1c7', '#f9f5d7', '#af3a03', '#3c3836'],
    ['catppuccin-mocha', 'Catppuccin Mocha', '#1e1e2e', '#2a2b3d', '#cba6f7', '#cdd6f4'],
    ['catppuccin-latte', 'Catppuccin Latte', '#eff1f5', '#ffffff', '#8839ef', '#4c4f69'],
    ['rose-pine', 'Rosé Pine', '#191724', '#1f1d2e', '#ebbcba', '#e0def4'],
    ['rose-pine-dawn', 'Rosé Pine Dawn', '#faf4ed', '#fffaf3', '#b4637a', '#575279'],
    ['forest', 'Wald', '#14201a', '#1b2b23', '#6fcf97', '#e3efe6'],
    ['ocean', 'Ozean', '#0f1b2d', '#162640', '#4cc2ff', '#e6efff'],
    ['sepia', 'Sepia', '#f4ecd8', '#fbf5e6', '#9c5b2e', '#433422'],
    ['contrast', 'Hoher Kontrast', '#000000', '#0b0b0b', '#ffd400', '#ffffff'],
  ];
  const PRESET_INFO = {
    minimal: ['Minimal', 'Nur Tagebuch und Notizen – ohne Personen, Stimmung & Co.'],
    standard: ['Standard', 'Tagebuch, Personen, Stimmung, Erinnerungen.'],
    journal: ['Tagebuch', 'Fokus auf Schreiben: Stimmung, Details, Lied des Tages, Auswertung.'],
    crm: ['Kontakte', 'Personen-Fokus: Erinnerungen, Graph, unverlinkte Erwähnungen.'],
    pro: ['Pro', 'Alles eingeschaltet.'],
    custom: ['Eigene Auswahl', 'Du hast einzelne Funktionen selbst gewählt.'],
  };
  const FEATURES = [
    ['people', 'Personen', 'Kontaktdatenbank mit Geburtstagen und Kontakthäufigkeit'],
    ['mood', 'Stimmung & Energie', 'Mood-Tracker, Verlauf, Jahr in Pixeln'],
    ['insights', 'Stimmungs-Auswertung', 'Welche Personen und Tags beeinflussen deine Stimmung'],
    ['details', 'Tagebuch-Details', 'Wetter, Ort und Schlaf je Eintrag'],
    ['music', 'Lied des Tages', 'Ein Lied pro Tag, Liedübersicht, optionales Einbetten'],
    ['graph', 'Graph-Ansicht', 'Visuelles Netz aller Verlinkungen'],
    ['reminders', 'Erinnerungen', 'Geburtstage und „Mal wieder melden“'],
    ['onThisDay', 'An diesem Tag', 'Einträge früherer Jahre'],
    ['quicklog', 'Schnellnotiz', 'Kurznotizen direkt ins heutige Tagebuch'],
    ['backlinks', 'Rückverweise', 'Zeigt, wo ein Eintrag verlinkt ist'],
    ['unlinked', 'Unverlinkte Erwähnungen', 'Namen im Text, die noch nicht verlinkt sind'],
    ['map', 'Karte', 'Wohnort und Orte der Personen auf einer Karte (Menüpunkt „Karte“)'],
    ['richEditor', 'Erweiterte Formatierung', 'Mehr Werkzeuge im Editor: Tabellen, Code, Zitate, Überschriften'],
  ];

  /* ------------------------------------------------- Design anwenden */
  function applyTheme(s) {
    if (!s) return;
    const h = document.documentElement, attrs = {}, vars = {};
    if (s.theme && s.theme !== 'auto') attrs.theme = s.theme;
    attrs.density = s.density || 'normal'; attrs.font = s.font || 'sans'; attrs.editor = s.editorFont || 'mono';
    ['theme', 'density', 'font', 'editor'].forEach((k) => (attrs[k] ? h.setAttribute('data-' + k, attrs[k]) : h.removeAttribute('data-' + k)));
    vars['--fs'] = (s.fontSize || 16) + 'px'; h.style.setProperty('--fs', vars['--fs']);
    if (s.accent) {
      vars['--accent'] = s.accent; vars['--accent-soft'] = `color-mix(in srgb, ${s.accent} 18%, var(--card))`;
      const n = parseInt(s.accent.slice(1), 16), lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
      vars['--accent-text'] = lum > 150 ? '#111111' : '#ffffff';
    }
    ['--accent', '--accent-soft', '--accent-text'].forEach((k) => (vars[k] ? h.style.setProperty(k, vars[k]) : h.style.removeProperty(k)));
    try { localStorage.setItem('memoria-ui', JSON.stringify({ attrs, vars })); } catch (e) { /* egal */ }
  }
  M.applyTheme = applyTheme;

  /* ------------------------------------------------- Nutzerleiste */
  function setUser(me) {
    M.state.me = me;
    document.body.classList.toggle('anon', !me);
    $('#who').textContent = me ? me.name + (me.admin ? ' (Admin)' : '') : '';
  }
  M.updateNav = () => $$('#nav [data-feat]').forEach((a) => { a.hidden = !M.feat(a.dataset.feat); });
  async function loadSettings() {
    const r = await api('/api/settings');
    M.state.settings = r.settings; M.state.presets = r.presets; M.state.relationTypes = r.relationTypes; M.state.smtp = r.smtp; M.state.mapConfig = r.mapConfig; setUser(r.me);
    applyTheme(r.settings); M.updateNav();
    M.crypt.restore().catch(() => {});
  }
  async function saveSettings(patch) {
    const r = await api('/api/settings', { method: 'PUT', body: patch });
    M.state.settings = r.settings; applyTheme(r.settings); M.updateNav(); return r.settings;
  }

  /* ---------------------------------------------- Anmeldung / Setup */
  function authScreen(setup) {
    setUser(null);
    app.innerHTML = `<div class="auth-wrap"><div class="card auth-card">
      <h1>📓 Memoria</h1>
      <p class="muted" style="text-align:center">${setup ? 'Willkommen! Lege das erste Konto an – es wird Administrator.' : 'Bitte melde dich an.'}</p>
      <form id="authForm" autocomplete="on">
        <div><label for="au">Benutzername</label><input id="au" name="username" autocomplete="username" required autofocus></div>
        <div><label for="ap">Passwort${setup ? ' (mind. 10 Zeichen)' : ''}</label><input id="ap" name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required></div>
        ${setup ? '<div><label for="ap2">Passwort wiederholen</label><input id="ap2" type="password" autocomplete="new-password" required></div>' : ''}
        <div id="codeRow" hidden><label for="ac">Code aus der Authenticator-App</label><input id="ac" inputmode="numeric" autocomplete="one-time-code" placeholder="123456 oder Wiederherstellungscode"></div>
        <div class="auth-err" id="aerr" role="alert"></div>
        <button class="btn primary">${setup ? 'Konto anlegen' : 'Anmelden'}</button>
      </form></div></div>`;
    $('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#aerr'); err.textContent = '';
      if (setup && $('#ap').value !== $('#ap2').value) { err.textContent = 'Die Passwörter stimmen nicht überein.'; return; }
      try {
        const r = await api(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body: { username: $('#au').value, password: $('#ap').value, code: $('#ac').value.trim() } });
        if (r.need2fa) { $('#codeRow').hidden = false; $('#ac').focus(); err.textContent = 'Bitte den Zwei-Faktor-Code eingeben.'; return; }
        await start();
      } catch (ex) { err.textContent = ex.message; }
    });
  }
  M.onUnauth = () => { if (!$('#authForm')) { M.state.me = null; authScreen(false); } };
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* egal */ }
    try { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('clear-data'); } catch (e) { /* egal */ }
    M.invalidate(); location.hash = '#/'; authScreen(false);
  });

  /* ------------------------------------------------- Einstellungen */
  const TABS = M.settingsTabs = [['design', '🎨 Design', (el) => tabDesign(el)], ['features', '🧩 Funktionen', (el) => tabFeatures(el)]];
  M.routes.unshift([/^\/settings$/, async (_, q) => settingsView(q.tab || 'design')]);

  function settingsView(tab) {
    const vis = TABS.filter((t) => !t[3] || t[3]());
    if (!vis.some((t) => t[0] === tab)) tab = 'design';
    app.innerHTML = `<h1>Einstellungen</h1><div class="tabs-bar">${vis.map(([k, l]) => `<a class="pill ${k === tab ? 'on' : ''}" href="#/settings?tab=${k}">${l}</a>`).join('')}</div><div id="tabBody"></div>`;
    TABS.find((t) => t[0] === tab)[2]($('#tabBody'));
  }

  function tabDesign(el) {
    const s = M.state.settings;
    const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');
    el.innerHTML = `
      <section class="card"><h2>Farbschema</h2><div class="theme-grid">${THEMES.map(([id, name, bg, card, ac, tx]) => `<button type="button" class="theme-card ${s.theme === id ? 'on' : ''}" data-theme-id="${id}"><div class="theme-prev" style="background:${bg}"><i class="b1" style="background:${ac}"></i><i class="b2" style="background:${tx}"></i><i style="background:${card};width:100%;flex:1;border-radius:4px"></i></div>${name}</button>`).join('')}</div></section>
      <section class="card"><h2>Darstellung</h2>
        <div class="form-grid">
          <div class="field"><label for="dAcc">Akzentfarbe</label><div class="row-flex"><input type="color" id="dAcc" value="${s.accent || '#4f46e5'}" style="width:60px;padding:2px"><button type="button" class="btn small" id="dAccReset">Zurücksetzen</button></div><small>Überschreibt die Akzentfarbe des Themes.</small></div>
          <div class="field"><label for="dDen">Dichte</label><select id="dDen">${opt([['compact', 'Kompakt'], ['normal', 'Normal'], ['comfy', 'Luftig']], s.density)}</select></div>
          <div class="field"><label for="dFont">Schrift</label><select id="dFont">${opt([['sans', 'Sans-Serif'], ['serif', 'Serif'], ['rounded', 'Rund']], s.font)}</select></div>
          <div class="field"><label for="dEd">Editor-Schrift</label><select id="dEd">${opt([['mono', 'Monospace'], ['sans', 'Wie Oberfläche'], ['serif', 'Serif']], s.editorFont)}</select></div>
          <div class="field"><label for="dSize">Schriftgröße: <span id="dSizeV">${s.fontSize}</span> px</label><input type="range" id="dSize" min="13" max="22" value="${s.fontSize}"></div>
        </div></section>`;
    let t;
    const push = (patch) => { clearTimeout(t); Object.assign(M.state.settings, patch); applyTheme(M.state.settings); t = setTimeout(() => saveSettings(patch).catch((e) => toast(e.message, 'err')), 250); };
    $$('.theme-card', el).forEach((b) => b.addEventListener('click', () => { $$('.theme-card', el).forEach((x) => x.classList.toggle('on', x === b)); push({ theme: b.dataset.themeId }); }));
    $('#dAcc').addEventListener('input', (e) => push({ accent: e.target.value }));
    $('#dAccReset').addEventListener('click', () => { push({ accent: '' }); });
    $('#dDen').addEventListener('change', (e) => push({ density: e.target.value }));
    $('#dFont').addEventListener('change', (e) => push({ font: e.target.value }));
    $('#dEd').addEventListener('change', (e) => push({ editorFont: e.target.value }));
    $('#dSize').addEventListener('input', (e) => { $('#dSizeV').textContent = e.target.value; push({ fontSize: +e.target.value }); });
  }

  function tabFeatures(el) {
    const s = M.state.settings, presets = M.state.presets;
    const draw = () => {
      const f = M.state.settings.features;
      el.innerHTML = `
        <section class="card"><h2>Voreinstellung</h2><div class="opt-grid">${Object.keys(PRESET_INFO).filter((k) => k !== 'custom').map((k) => `<button type="button" class="preset ${M.state.settings.preset === k ? 'on' : ''}" data-p="${k}"><b>${PRESET_INFO[k][0]}</b><span>${PRESET_INFO[k][1]}</span></button>`).join('')}</div>
          ${M.state.settings.preset === 'custom' ? '<p class="hint">Aktuell: eigene Auswahl.</p>' : ''}</section>
        <section class="card"><h2>Einzelne Funktionen</h2>${FEATURES.map(([k, l, d]) => `<label class="sw-row"><input type="checkbox" data-f="${k}" ${f[k] ? 'checked' : ''}><span><b>${l}</b><small>${d}</small></span></label>`).join('')}
          <label class="sw-row"><input type="checkbox" id="songEmbed" ${M.state.settings.songEmbed ? 'checked' : ''}><span><b>Lied direkt einbetten</b><small>Zeigt YouTube/Spotify-Player auf der Seite. Dabei werden Daten an diese Dienste übertragen – darum standardmäßig aus.</small></span></label></section>`;
      $$('.preset', el).forEach((b) => b.addEventListener('click', async () => {
        try { await saveSettings({ preset: b.dataset.p, features: presets[b.dataset.p] }); draw(); toast('Funktionsumfang geändert'); } catch (e) { toast(e.message, 'err'); }
      }));
      $$('[data-f]', el).forEach((c) => c.addEventListener('change', async () => {
        try {
          const features = { ...M.state.settings.features, [c.dataset.f]: c.checked };
          const match = Object.keys(presets).find((p) => Object.keys(features).every((k) => !!presets[p][k] === !!features[k]));
          await saveSettings({ features, preset: match || 'custom' }); draw();
        } catch (e) { toast(e.message, 'err'); }
      }));
      $('#songEmbed').addEventListener('change', (e) => saveSettings({ songEmbed: e.target.checked }).catch((x) => toast(x.message, 'err')));
    };
    draw();
  }

  /* ------------------------------------------------------------ Start */
  async function start() {
    let st;
    try { st = await api('/api/auth/status'); } catch (e) { app.innerHTML = `<div class="card error">Server nicht erreichbar: ${esc(e.message)}</div>`; return; }
    if (st.setup) return authScreen(true);
    if (!st.user) return authScreen(false);
    try { await loadSettings(); } catch (e) { if (e.status === 401) return authScreen(false); throw e; }
    M.invalidate();
    M.route();
  }
  M.boot = start; M.saveSettings = saveSettings;
})();
