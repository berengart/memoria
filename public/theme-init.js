/* Gespeichertes Design sofort anwenden (kein Aufblitzen des falschen Themes) */
try {
  var u = JSON.parse(localStorage.getItem('memoria-ui') || '{}'), h = document.documentElement;
  Object.keys(u.attrs || {}).forEach(function (k) { h.setAttribute('data-' + k, u.attrs[k]); });
  Object.keys(u.vars || {}).forEach(function (k) { h.style.setProperty(k, u.vars[k]); });
} catch (e) {}
