'use strict';

// Game art loaded at runtime from the user's own MCC install (never bundled).
// See docs/theme.md.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app } = require('electron');
const settings = require('./settings');
const textures = require('./mcc-textures');
const mapsCatalog = require('../catalog/maps.json');

const BACKDROPS = ['H3Vignette.png', 'Halo3.png', 'MainMenu.png'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

/** The user's own pictures, which win over the ones read from MCC. */
function mapImagesDir() {
  return path.join(app.getPath('userData'), 'map-images');
}

/** Map previews decoded from MCC's texture packs, cached as PNGs. */
function previewCacheDir() {
  return path.join(app.getPath('userData'), 'map-previews');
}

function backdropUrl() {
  const mcc = settings.get().mccPath;
  if (!mcc) return null;
  for (const name of BACKDROPS) {
    const p = path.join(mcc, 'Data', 'ui', 'BackgroundVideos', 'Images', name);
    if (fs.existsSync(p)) return pathToFileURL(p).href;
  }
  return null;
}

/**
 * Decode stock map previews from MCC into the cache (once, and again after an
 * MCC update changes the pack). Returns { file: absolute png path }.
 */
function ensurePreviews() {
  const mcc = settings.get().mccPath;
  const out = {};
  if (!mcc) return out;
  const { perm, temp } = textures.packPaths(mcc);
  if (!fs.existsSync(perm) || !fs.existsSync(temp)) return out;

  const dir = previewCacheDir();
  const packTime = Math.max(fs.statSync(perm).mtimeMs, fs.statSync(temp).mtimeMs);
  let index = null;
  for (const m of mapsCatalog.maps) {
    if (!m.preview) continue;
    const file = path.join(dir, `${m.file}.png`);
    if (fs.existsSync(file) && fs.statSync(file).mtimeMs >= packTime) { out[m.file] = file; continue; }
    try {
      index ||= textures.readIndex(perm);
      // The _LARGE version is sharper; fall back to the small one.
      const name = index.has(`${m.preview}_LARGE`) ? `${m.preview}_LARGE` : m.preview;
      const tex = textures.readTexture(mcc, name);
      if (!tex) continue;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, textures.encodePng(tex.width, tex.height, tex.rgba));
      out[m.file] = file;
    } catch (err) {
      console.error(`map preview ${m.file}:`, err.message);
    }
  }
  return out;
}

/** File URLs for map pictures keyed by lower-case map file name: { riverworld: 'file:///...' } */
function mapImageUrls() {
  const out = {};
  for (const [file, p] of Object.entries(ensurePreviews())) out[file] = pathToFileURL(p).href;
  let names = [];
  try { names = fs.readdirSync(mapImagesDir()); } catch { /* no user images */ }
  for (const n of names) {
    const ext = path.extname(n).toLowerCase();
    if (IMAGE_EXTS.includes(ext)) out[path.basename(n, path.extname(n)).toLowerCase()] = pathToFileURL(path.join(mapImagesDir(), n)).href;
  }
  return out;
}

module.exports = { backdropUrl, mapImageUrls, mapImagesDir };
