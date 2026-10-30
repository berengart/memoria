'use strict';
/** Wetter & Ort über Open-Meteo (Wetter, Geokodierung) und OpenStreetMap Nominatim (Adresse zu Koordinaten). Nur auf Wunsch des Nutzers. */
const API = () => process.env.WEATHER_API || 'https://api.open-meteo.com';
const ARCHIVE = () => process.env.WEATHER_ARCHIVE_API || 'https://archive-api.open-meteo.com';
const GEO = () => process.env.GEOCODE_API || 'https://geocoding-api.open-meteo.com';
const REVERSE = () => process.env.REVERSE_API || 'https://nominatim.openstreetmap.org';
const UA = { 'User-Agent': 'Memoria-Journal/2 (self-hosted)', Accept: 'application/json' };

const CODES = {
  0: ['Klar', '☀️'], 1: ['Überwiegend klar', '🌤️'], 2: ['Teils bewölkt', '⛅'], 3: ['Bedeckt', '☁️'], 45: ['Nebel', '🌫️'], 48: ['Reifnebel', '🌫️'],
  51: ['Leichter Nieselregen', '🌦️'], 53: ['Nieselregen', '🌦️'], 55: ['Starker Nieselregen', '🌧️'], 56: ['Gefrierender Nieselregen', '🌧️'], 57: ['Gefrierender Nieselregen', '🌧️'],
  61: ['Leichter Regen', '🌧️'], 63: ['Regen', '🌧️'], 65: ['Starker Regen', '🌧️'], 66: ['Gefrierender Regen', '🌧️'], 67: ['Gefrierender Regen', '🌧️'],
  71: ['Leichter Schneefall', '🌨️'], 73: ['Schneefall', '🌨️'], 75: ['Starker Schneefall', '❄️'], 77: ['Schneegriesel', '🌨️'],
  80: ['Leichte Schauer', '🌦️'], 81: ['Schauer', '🌧️'], 82: ['Starke Schauer', '⛈️'], 85: ['Schneeschauer', '🌨️'], 86: ['Starke Schneeschauer', '❄️'],
  95: ['Gewitter', '⛈️'], 96: ['Gewitter mit Hagel', '⛈️'], 99: ['Gewitter mit starkem Hagel', '⛈️'],
};
const describe = (code, t) => { const c = CODES[code] || ['Wetter', '🌡️']; return `${c[1]} ${Math.round(t)} °C, ${c[0]}`; };

async function getJson(url) {
  let r;
  try { r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(9000) }); } catch (e) { throw Object.assign(new Error('Dienst nicht erreichbar (keine Internetverbindung?)'), { status: 502 }); }
  if (!r.ok) throw Object.assign(new Error(`Dienst antwortet mit Fehler (${r.status})`), { status: 502 });
  return r.json();
}
const num = (v, lo, hi) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw Object.assign(new Error('Ungültige Koordinaten'), { status: 400 }); return n; };

async function weather(lat, lon, date, today) {
  lat = num(lat, -90, 90); lon = num(lon, -180, 180);
  if (!date || date === today) {
    const j = await getJson(`${API()}/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`);
    if (!j.current) throw Object.assign(new Error('Keine Wetterdaten erhalten'), { status: 502 });
    return { text: describe(j.current.weather_code, j.current.temperature_2m), temp: j.current.temperature_2m, code: j.current.weather_code };
  }
  const j = await getJson(`${ARCHIVE()}/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&daily=weather_code,temperature_2m_mean&timezone=auto`);
  const d = j.daily;
  if (!d || !d.time || !d.time.length || d.temperature_2m_mean[0] == null) throw Object.assign(new Error('Für dieses Datum liegen keine Wetterdaten vor'), { status: 404 });
  return { text: describe(d.weather_code[0], d.temperature_2m_mean[0]), temp: d.temperature_2m_mean[0], code: d.weather_code[0] };
}
async function geocode(q) {
  q = String(q || '').trim(); if (q.length < 2) throw Object.assign(new Error('Bitte einen Ortsnamen eingeben'), { status: 400 });
  const j = await getJson(`${GEO()}/v1/search?name=${encodeURIComponent(q)}&count=6&language=de&format=json`);
  return (j.results || []).map((r) => ({ name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude }));
}
async function reverse(lat, lon) {
  lat = num(lat, -90, 90); lon = num(lon, -180, 180);
  const j = await getJson(`${REVERSE()}/reverse?format=jsonv2&zoom=14&accept-language=de&lat=${lat}&lon=${lon}`);
  const a = j.address || {};
  const name = a.city || a.town || a.village || a.municipality || a.suburb || a.county || '';
  return { name: [a.suburb && a.suburb !== name ? a.suburb : '', name].filter(Boolean).join(', ') || (j.display_name || '').split(',').slice(0, 2).join(',').trim(), country: a.country || '' };
}
/** Adresse → Koordinaten (Nominatim). Höchstens eine Anfrage pro Sekunde, wie von der Nutzungsrichtlinie verlangt. */
let chain = Promise.resolve(), lastCall = 0;
function searchAddress(q) {
  q = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (q.length < 3) return Promise.reject(Object.assign(new Error('Bitte eine Adresse oder einen Ort eingeben'), { status: 400 }));
  const run = async () => {
    const wait = lastCall + 1100 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const j = await getJson(`${REVERSE()}/search?format=jsonv2&limit=5&accept-language=de&q=${encodeURIComponent(q)}`);
    return (Array.isArray(j) ? j : []).map((r) => ({ lat: Number(r.lat), lon: Number(r.lon), name: String(r.display_name || '').slice(0, 200) })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
  };
  const p = chain.then(run, run); chain = p.catch(() => {}); return p;
}
module.exports = { weather, geocode, reverse, searchAddress, describe };
