'use strict';
/** Kartenkacheln: Adresse per Umgebungsvariable TILE_URL (z. B. eigener Tile-Server). Standard: OpenStreetMap. */
const DEFAULT = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
function tileUrl() {
  const u = String(process.env.TILE_URL || DEFAULT).trim();
  return /^https?:\/\/[^\s]+\{z\}[^\s]*\{x\}[^\s]*\{y\}[^\s]*$/i.test(u) ? u : DEFAULT;
}
const attribution = () => process.env.TILE_ATTRIBUTION || '© OpenStreetMap-Mitwirkende';
function origin() { try { return new URL(tileUrl().replace(/\{[xyz]\}/g, '0')).origin; } catch (e) { return ''; } }
module.exports = { tileUrl, attribution, origin };
