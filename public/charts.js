'use strict';
/* Diagramme */
(() => {
  const M = window.M;
  const { esc, enc, MOODS, moodColor, fmtShort, fmtLong, addDays, diffDays, parseD } = M;
  /* ------------------------------------------------------------ Diagramme */
  function sparkline(points, w = 300, h = 64) {
    const n = points.length; if (n < 2) return '';
    const x = (i) => 4 + (i / (n - 1)) * (w - 8), y = (v) => 6 + ((5 - v) / 4) * (h - 12);
    let d = '', pen = false, dots = '';
    points.forEach((p, i) => {
      if (p.mood == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.mood).toFixed(1)}`; pen = true;
      dots += `<circle cx="${x(i).toFixed(1)}" cy="${y(p.mood).toFixed(1)}" r="3" fill="${moodColor(p.mood)}"><title>${fmtShort(p.date)}: ${MOODS[Math.round(p.mood) - 1].l}</title></circle>`;
    });
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Stimmung der letzten 30 Tage"><path class="l-mood" d="${d}" stroke-width="2"/>${dots}</svg>`;
  }
  function lineChart(days, from, to) {
    const W = 800, H = 250, L = 40, R = 12, T = 12, B = 28;
    const N = diffDays(from, to) + 1;
    const x = (date) => L + (diffDays(from, date) / Math.max(1, N - 1)) * (W - L - R);
    const y = (v) => T + ((5 - v) / 4) * (H - T - B);
    let g = '';
    for (let v = 1; v <= 5; v++) g += `<line class="grid-l" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="14">${MOODS[v - 1].e}</text>`;
    for (let i = 0; i <= 6; i++) { const d = addDays(from, Math.round((i / 6) * (N - 1))); g += `<text x="${x(d)}" y="${H - 8}" text-anchor="middle">${parseD(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</text>`; }
    const path = (key) => { let d = '', pen = false; for (const p of days) { if (p[key] == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p[key]).toFixed(1)}`; pen = true; } return d; };
    const dots = days.filter((p) => p.mood != null).map((p) => `<a href="#/journal/${enc(p.slug)}"><circle cx="${x(p.date).toFixed(1)}" cy="${y(p.mood).toFixed(1)}" r="5" fill="${moodColor(p.mood)}"><title>${fmtLong(p.date)}: ${p.mood} (${MOODS[Math.round(p.mood) - 1].l})</title></circle></a>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Stimmungsverlauf">${g}<path class="l-energy" d="${path('energy')}"/><path class="l-mood" d="${path('mood')}"/>${dots}</svg>`;
  }

  M.sparkline = sparkline; M.lineChart = lineChart;
})();
