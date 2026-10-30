'use strict';
/* Werkzeuge: Versionsverlauf, Schnellzugriffe */
(() => {
  const M = window.M;
  const { $, $$, esc, enc, api, toast, go, fmtLong, todayStr, invalidate } = M;

  /* ---- Zeilen-Diff (LCS) ---- */
  function diffLines(a, b) {
    const A = a.split('\n'), B = b.split('\n');
    if (A.length * B.length > 4e6) return [{ t: '-', s: '(Text zu lang für Vergleich)' }];
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { if (A[i] === B[j]) { out.push({ t: '=', s: A[i] }); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: '-', s: A[i++] }); else out.push({ t: '+', s: B[j++] }); }
    while (i < n) out.push({ t: '-', s: A[i++] });
    while (j < m) out.push({ t: '+', s: B[j++] });
    return out;
  }
  function diffHTML(ops) {
    if (!ops.some((o) => o.t !== '=')) return '<div class="empty">Kein Unterschied im Text.</div>';
    const keep = new Set();
    ops.forEach((o, i) => { if (o.t !== '=') for (let k = i - 2; k <= i + 2; k++) keep.add(k); });
    let out = '', skipped = false;
    ops.forEach((o, i) => {
      if (!keep.has(i)) { skipped = true; return; }
      if (skipped) { out += '<div class="df gap">⋯</div>'; skipped = false; }
      out += `<div class="df ${o.t === '+' ? 'add' : o.t === '-' ? 'del' : ''}"><span class="mk">${o.t === '=' ? '' : o.t}</span>${esc(o.s) || '&nbsp;'}</div>`;
    });
    return `<div class="diff">${out}</div>`;
  }
  M.diffLines = diffLines; M.diffHTML = diffHTML;

  const REASON = { save: 'Vor dem Speichern', sync: 'Vor Synchronisierung', restore: 'Vor Wiederherstellung', conflict: 'Vor Konflikt-Auflösung', import: 'Vor Import' };
  const plainOf = async (text) => {
    if (!M.crypt.isBlock(text)) return text;
    try { return await M.crypt.decrypt(text); } catch (e) { return null; }
  };

  M.openHistory = async function openHistory(it) {
    let list;
    try { list = await api(`/api/history/${it.type}/${enc(it.slug)}`); } catch (e) { return toast(e.message, 'err'); }
    const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.dataset.closable = '1';
    bg.innerHTML = `<div class="modal" style="max-width:920px"><div class="row-flex"><h2 style="margin:0">🕘 Verlauf: ${esc(it.title)}</h2><span class="spacer"></span><button type="button" class="btn small" id="hx">Schließen</button></div>
      ${list.length ? `<div class="hist"><div class="hist-list">${list.map((v) => `<button type="button" class="hist-item" data-id="${v.id}"><b>${esc(new Date(v.at).toLocaleString('de-DE'))}</b><span class="muted small-text">${esc(REASON[v.reason] || v.reason)}</span></button>`).join('')}</div><div class="hist-view" id="hv"><div class="empty">Wähle links eine frühere Fassung. Gezeigt wird, was sich gegenüber dem aktuellen Stand geändert hat.</div></div></div>` : '<div class="empty">Noch keine früheren Fassungen. Sie entstehen automatisch, sobald du etwas änderst.</div>'}
      <p class="hint">Bis zu 60 Fassungen je Datei, höchstens alle 3 Minuten. Verschlüsselte Texte werden nur im Vergleich lesbar, wenn sie entsperrt sind.</p></div>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    $('#hx', bg).addEventListener('click', close); bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    bg.addEventListener('click', async (e) => {
      const b = e.target.closest('.hist-item'); if (!b) return;
      $$('.hist-item', bg).forEach((x) => x.classList.toggle('on', x === b));
      const hv = $('#hv', bg); hv.innerHTML = '<p class="muted">Lade …</p>';
      try {
        const v = await api(`/api/history/${it.type}/${enc(it.slug)}/${b.dataset.id}`);
        let old = await plainOf(v.body), cur = await plainOf(v.current.body);
        if (old === null || cur === null) { old = '(verschlüsselt – bitte erst entsperren)'; cur = ''; if (await M.crypt.ensure(false)) { old = await plainOf(v.body) ?? old; cur = await plainOf(v.current.body) ?? cur; } }
        const keys = [...new Set([...Object.keys(v.meta), ...Object.keys(v.current.meta)])].filter((k) => JSON.stringify(v.meta[k]) !== JSON.stringify(v.current.meta[k]));
        hv.innerHTML = `${keys.length ? `<p class="small-text muted">Geänderte Eigenschaften: ${keys.map(esc).join(', ')}</p>` : ''}
          <div class="row-flex" style="margin-bottom:8px"><span class="small-text"><span class="tag" style="background:#d9534f22">− so war es</span> <span class="tag" style="background:#4caf7a33">+ so ist es jetzt</span></span><span class="spacer"></span><button type="button" class="btn primary small" id="restore">Diesen Stand wiederherstellen</button></div>${diffHTML(diffLines(old, cur))}`;
        $('#restore', hv).addEventListener('click', async () => {
          if (!confirm('Diesen Stand wiederherstellen? Der aktuelle Stand bleibt im Verlauf erhalten.')) return;
          try { await api(`/api/history/${it.type}/${enc(it.slug)}/${b.dataset.id}/restore`, { method: 'POST', body: {} }); invalidate(); close(); toast('Wiederhergestellt ✓'); go(`#/${it.type}/${enc(it.slug)}`); M.route(); } catch (err) { toast(err.message, 'err'); }
        });
      } catch (err) { hv.innerHTML = `<div class="card error">${esc(err.message)}</div>`; }
    });
  };

  /* ---- Schnellzugriffe (für App-Verknüpfungen) ---- */
  M.routes.push(
    [/^\/today$/, async () => { location.replace('#/journal/' + todayStr()); }],
    [/^\/new-note$/, async () => { location.replace('#/notes'); }],
  );
})();
