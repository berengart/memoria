'use strict';
/* Wiederholbare Formularzeilen (Telefonnummern, Geschenke, Schulden …) */
(() => {
  const M = window.M;
  const { esc } = M;

  function cell(c, v) {
    const base = `data-k="${c.k}" style="flex:${c.w || 1} 1 ${c.min || 110}px"`;
    if (c.t === 'select') return `<select ${base}>${c.opts.map(([val, l]) => `<option value="${esc(val)}" ${String(v ?? c.def ?? '') === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    if (c.t === 'check') return `<label class="rep-check" title="${esc(c.ph || '')}"><input type="checkbox" data-k="${c.k}" ${v ? 'checked' : ''}> ${esc(c.ph || '')}</label>`;
    if (c.t === 'area') return `<textarea rows="2" ${base} placeholder="${esc(c.ph || '')}">${esc(v ?? '')}</textarea>`;
    if (c.t === 'geo') { const has = v && Number.isFinite(+v.lat) && Number.isFinite(+v.lon) && v.lat !== '' && v.lon !== ''; return `<span class="geo" style="flex:${c.w || 1} 1 ${c.min || 170}px"><input type="text" data-k="geo" inputmode="decimal" autocomplete="off" placeholder="Breite, Länge" aria-label="Koordinaten (Breite, Länge)" value="${has ? esc(`${(+v.lat).toFixed(5)}, ${(+v.lon).toFixed(5)}`) : ''}"><button type="button" class="btn small geo-find" title="Adresse auf der Karte suchen" aria-label="Adresse auf der Karte suchen">📍</button></span>`; }
    if (c.t === 'date') return M.dateHTML({ value: v, wrapStyle: `flex:${c.w || 1} 1 ${c.min || 130}px`, attrs: `data-k="${c.k}"`, aria: c.ph || 'Datum' });
    const type = c.t === 'number' ? 'number' : 'text';
    return `<input type="${type}" ${base} value="${esc(v ?? (c.def ?? ''))}" placeholder="${esc(c.ph || '')}" ${c.step ? `step="${c.step}"` : ''} ${c.list ? `list="${c.list}"` : ''} aria-label="${esc(c.ph || c.k)}">`;
  }
  const rowHTML = (def, values) => `<div class="rep-row">${def.cols.map((c) => cell(c, c.t === 'geo' ? values : values && values[c.k])).join('')}${def.single ? '' : '<button type="button" class="icon-btn" data-del title="Zeile entfernen" aria-label="Zeile entfernen">✕</button>'}</div>`;

  const R = {
    html(def) {
      return `<div class="wide rep" data-rep="${def.key}"><label>${def.label}</label><div class="rep-rows">${(def.single ? [(def.rows || [])[0] || {}] : (def.rows || [])).map((r) => rowHTML(def, r)).join('')}</div>${def.single ? '' : `<button type="button" class="btn small" data-add>＋ ${def.add}</button>`}</div>`;
    },
    bind(root, defs) {
      for (const def of defs) {
        const box = root.querySelector(`[data-rep="${def.key}"]`); if (!box) continue;
        box.addEventListener('click', (e) => {
          const gf = e.target.closest('.geo-find'); if (gf) { M.map.geocodeRow(gf.closest('.rep-row')); return; }
          if (e.target.closest('[data-add]')) { box.querySelector('.rep-rows').insertAdjacentHTML('beforeend', rowHTML(def, {})); const f = box.querySelector('.rep-row:last-child input,.rep-row:last-child select'); if (f) f.focus(); root.dispatchEvent(new Event('input', { bubbles: true })); }
          const d = e.target.closest('[data-del]'); if (d) { d.closest('.rep-row').remove(); root.dispatchEvent(new Event('input', { bubbles: true })); }
        });
      }
    },
    collect(root, def) {
      const box = root.querySelector(`[data-rep="${def.key}"]`); const out = [];
      if (!box) return null;
      for (const row of box.querySelectorAll('.rep-row')) {
        const o = {};
        for (const c of def.cols) {
          const el = row.querySelector(`[data-k="${c.k}"]`); if (!el) continue;
          if (c.t === 'geo') {
            const raw = el.value.trim(); if (!raw) continue;
            const m = raw.match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/); const la = m && parseFloat(m[1].replace(',', '.')), lo = m && parseFloat(m[2].replace(',', '.'));
            if (!m || Math.abs(la) > 90 || Math.abs(lo) > 180) { el.classList.add('bad'); throw Object.assign(new Error(`Ungültige Koordinaten „${raw}“ – bitte als „Breite, Länge“ eingeben, z. B. 52.52, 13.40.`), { status: 400 }); }
            el.classList.remove('bad'); o.lat = la; o.lon = lo; continue;
          }
          let v = c.t === 'check' ? el.checked : c.t === 'date' ? M.readDate(el) : el.value.trim();
          if (c.t === 'number') v = v === '' ? undefined : Number(v);
          if (v === '' || v === false || v === undefined) continue;
          o[c.k] = v;
        }
        if (o[def.cols.find((c) => c.req).k] !== undefined) out.push(o);
      }
      return out.length ? out : null;
    },
  };
  M.repeater = R;
})();
