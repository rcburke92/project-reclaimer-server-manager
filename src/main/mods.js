'use strict';

// Workshop mod scanner. Reads only local files: Steam's appworkshop_976730.acf
// and each item's ModInfo.json / multiplayer/*.json. Never contacts Steam.
// Scans run when a view that shows mods asks for them; the folder watcher runs
// only while such a view is open (see start/stopWatching).

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app } = require('electron');
const { parseVdf } = require('./vdf');
const steam = require('./steam');
const settings = require('./settings');

function cacheFile() {
  return path.join(app.getPath('userData'), 'mods-cache.json');
}

function loadCache() {
  try { return JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { return { mods: [], subscriptions: null }; }
}

function saveCache(cache) {
  fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
  fs.writeFileSync(cacheFile(), JSON.stringify(cache, null, 2));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function neutral(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v.Neutral || Object.values(v).find((x) => typeof x === 'string') || '';
}

/** Strip Steam BBCode for a short plain-text description. */
function plainText(s, max = 400) {
  const t = String(s || '').replace(/\[\/?[a-z0-9*]+(=[^\]]*)?\]/gi, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function fileUrl(base, rel) {
  if (!rel) return null;
  const p = path.join(base, rel.replace(/\\/g, path.sep));
  return fs.existsSync(p) ? pathToFileURL(p).href : null;
}

function exists(...parts) {
  return fs.existsSync(path.join(...parts));
}

function dirHasFiles(dir) {
  try { return fs.readdirSync(dir).length > 0; } catch { return false; }
}

/** Read one item folder. Returns null when it has no ModInfo.json. */
function readItem(dir, id) {
  const infoFile = path.join(dir, 'ModInfo.json');
  if (!fs.existsSync(infoFile)) return { id, folder: dir, engine: null, title: `Workshop item ${id}`, maps: [], error: 'No ModInfo.json' };
  let info;
  try { info = readJson(infoFile); } catch (err) {
    return { id, folder: dir, engine: null, title: `Workshop item ${id}`, maps: [], error: `ModInfo.json: ${err.message}` };
  }
  const gm = info.GameModContents || {};
  const maps = [];
  const seen = new Set();
  for (const rel of gm.MultiplayerMaps || []) {
    try {
      const m = readJson(path.join(dir, rel));
      const file = m.ScenarioFile || path.basename(rel, '.json');
      if (seen.has(file.toLowerCase())) continue;
      seen.add(file.toLowerCase());
      maps.push({
        file,
        name: neutral(m.Title) || file,
        description: plainText(neutral(m.Description), 200),
        thumbnail: fileUrl(dir, m.Images?.Thumbnail) || fileUrl(dir, m.Images?.Large),
        large: fileUrl(dir, m.Images?.Large) || fileUrl(dir, m.Images?.LoadingScreen),
        hasMapFile: exists(dir, 'maps', `${file}.map`) || exists(dir, 'halo3', 'maps', `${file}.map`),
        ref: `workshop:${id}/${file}`,
      });
    } catch {
      maps.push({ file: path.basename(rel, '.json'), name: path.basename(rel, '.json'), ref: `workshop:${id}/${path.basename(rel, '.json')}`, error: `Can't read ${rel}` });
    }
  }
  const version = info.ModVersion ? `${info.ModVersion.Major}.${info.ModVersion.Minor}.${info.ModVersion.Patch}` : '';
  return {
    id,
    folder: dir,
    engine: info.Engine || null,
    title: neutral(info.Title) || `Workshop item ${id}`,
    description: plainText(neutral(info.Description)),
    version,
    hasCampaign: !!gm.HasCampaign,
    ownSharedMap: !!gm.HasSharedFiles || exists(dir, 'halo3', 'maps', 'shared.map'),
    soundBanks: dirHasFiles(path.join(dir, 'halo3', 'fmod', 'pc')) || dirHasFiles(path.join(dir, 'halo3', 'fmod')),
    maps,
  };
}

/** Full scan of every library. Returns { mods, otherCount, scannedAt, roots }. */
function scan() {
  const steamPath = settings.get().steamPath;
  const roots = steam.workshopRoots(steamPath);
  const byId = new Map();

  for (const root of roots) {
    let installed = {};
    let details = {};
    try {
      const acf = parseVdf(fs.readFileSync(root.acf, 'utf8')).AppWorkshop || {};
      installed = acf.WorkshopItemsInstalled || {};
      details = acf.WorkshopItemDetails || {};
    } catch { /* no acf: fall back to folders only */ }

    let folders = [];
    try { folders = fs.readdirSync(root.content).filter((n) => /^\d+$/.test(n)); } catch { /* none */ }

    for (const id of new Set([...Object.keys(installed), ...folders])) {
      const dir = path.join(root.content, id);
      const inst = installed[id] || {};
      const det = details[id] || {};
      const downloaded = fs.existsSync(dir);
      const item = downloaded ? readItem(dir, id) : { id, folder: dir, engine: null, title: `Workshop item ${id}`, maps: [] };
      item.library = root.library;
      item.downloaded = downloaded;
      item.size = Number(inst.size) || null;
      item.timeUpdated = (Number(inst.timeupdated || det.timeupdated) || 0) * 1000 || null;
      item.needsUpdate = det.latest_timeupdated && det.timeupdated && det.latest_timeupdated !== det.timeupdated;
      byId.set(id, item);
    }
  }

  const all = [...byId.values()];
  const cache = loadCache();
  const halo3 = all.filter((m) => m.engine === 'Halo3');
  const result = {
    mods: halo3.sort((a, b) => a.title.localeCompare(b.title)),
    other: all.filter((m) => m.engine !== 'Halo3').map((m) => ({ id: m.id, title: m.title, engine: m.engine })),
    subscriptions: cache.subscriptions || null,
    scannedAt: Date.now(),
    roots: roots.map((r) => r.content),
  };
  saveCache({ ...cache, mods: result.mods, other: result.other, scannedAt: result.scannedAt });
  return result;
}

/** Last scan without touching the disk. */
function cached() {
  const c = loadCache();
  return { mods: c.mods || [], other: c.other || [], subscriptions: c.subscriptions || null, scannedAt: c.scannedAt || null };
}

/** Store the subscription list read from the Workshop page (manual sync). */
function setSubscriptions(list) {
  const cache = loadCache();
  cache.subscriptions = { items: list, syncedAt: Date.now() };
  saveCache(cache);
  return cache.subscriptions;
}

// ---------------------------------------------------------------- watcher

let watchers = [];
let watchTimer = null;

function startWatching(onChange) {
  stopWatching();
  const roots = steam.workshopRoots(settings.get().steamPath);
  const fire = () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(onChange, 1500); // Steam writes in bursts while downloading
  };
  for (const r of roots) {
    for (const target of [r.content, path.dirname(r.acf)]) {
      try { watchers.push(fs.watch(target, { persistent: false }, fire)); } catch { /* folder may not exist */ }
    }
  }
  return watchers.length;
}

function stopWatching() {
  clearTimeout(watchTimer);
  for (const w of watchers) { try { w.close(); } catch { /* already closed */ } }
  watchers = [];
}

function isWatching() {
  return watchers.length > 0;
}

module.exports = { scan, cached, setSubscriptions, startWatching, stopWatching, isWatching, readItem };
