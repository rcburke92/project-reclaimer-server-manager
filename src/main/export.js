'use strict';

// Export: the workspace already mirrors the server folder, so exporting means
// working out what to upload (new / changed / deleted since the last upload),
// which Workshop mods the playlists and servers need, optionally copying those
// mod folders into the workspace, and optionally running `dedicated check`.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app } = require('electron');
const settings = require('./settings');
const workspace = require('./workspace');
const mods = require('./mods');
const { parseToml } = require('./toml-patch');

const UPLOAD_DIRS = ['playlists', path.join('content', 'Game Modes'), path.join('content', 'Maps')];
const UPLOAD_FILES = ['dedicated.toml', 'reserved-slots.toml', path.join('content', 'disabled-mods.json')];
const WORKSHOP_RE = /^workshop:(\d+)\//i;
// A game type name or file for the bundled Flood Infection mode or a copy of it.
const FLOOD_RE = /flood[-_ ]?infection/i;

function manifestFile() {
  return path.join(app.getPath('userData'), 'export-manifest.json');
}

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(manifestFile(), 'utf8')); } catch { return { files: {}, mods: {}, at: null }; }
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function rel(p) {
  return p.split(path.sep).join('/');
}

/** Workspace files that belong on the server (not staged mods, which are tracked per mod). */
function workspaceFiles() {
  const root = workspace.root();
  const out = [];
  for (const f of UPLOAD_FILES) {
    const full = path.join(root, f);
    if (fs.existsSync(full)) out.push(f);
  }
  for (const d of UPLOAD_DIRS) {
    const dir = path.join(root, d);
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const n of names) if (n.isFile() && !n.name.endsWith('.tmp')) out.push(path.join(d, n.name));
  }
  return out.map((f) => {
    const full = path.join(root, f);
    return { rel: rel(f), full, size: fs.statSync(full).size, hash: hashFile(full) };
  });
}

/** Workshop item ids the playlists and dedicated.toml use, with what uses them. */
function referencedMods() {
  const root = workspace.root();
  const refs = new Map(); // id -> Set of "used by" labels
  const add = (ref, by) => {
    const m = WORKSHOP_RE.exec(String(ref || ''));
    if (!m) return;
    if (!refs.has(m[1])) refs.set(m[1], new Set());
    refs.get(m[1]).add(by);
  };
  const warnings = [];
  const flood = new Set(); // what plays Flood Infection
  const addFlood = (game, by) => { if (FLOOD_RE.test(String(game || ''))) flood.add(by); };

  for (const item of workspace.list('playlists')) {
    if (item.error) { warnings.push(`Playlist ${item.file}: ${item.error}`); continue; }
    const data = workspace.readJson(path.join(root, 'playlists', item.file));
    for (const g of data.games || []) {
      add(g.map, `Playlist "${item.name}"`); add(g.base_map, `Playlist "${item.name}"`);
      addFlood(g.game, `Playlist "${item.name}"`);
    }
  }
  const tomlFile = path.join(root, 'dedicated.toml');
  if (fs.existsSync(tomlFile)) {
    try {
      const t = parseToml(fs.readFileSync(tomlFile, 'utf8'));
      for (const s of t.server || []) {
        add(s.map, `Server "${s.name}"`); add(s.base_map, `Server "${s.name}"`);
        addFlood(s.game, `Server "${s.name}"`);
      }
      for (const id of t.workshop?.items || []) add(`workshop:${id}/`, '[workshop] items');
    } catch (err) {
      warnings.push(`dedicated.toml: ${err.message}`);
    }
  }
  // Flood Infection loads its Flood bodies from a campaign map that dedicated init
  // doesn't copy and dedicated check doesn't ask for. Without it the game fails to
  // load and the vote starts over.
  if (flood.size) warnings.push(`${[...flood].join(', ')} ${flood.size > 1 ? 'play' : 'plays'} Flood Infection, which needs 050_floodvoi.map in the server's game/halo3/maps (copy it from MCC's halo3\\maps). dedicated init doesn't copy it and dedicated check doesn't ask for it: without it, the game fails to load and the vote starts over.`);
  return { refs, warnings };
}

function folderSize(dir) {
  let total = 0;
  let count = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { total += fs.statSync(p).size; count++; }
    }
  };
  try { walk(dir); } catch { /* missing */ }
  return { total, count };
}

/** Everything the Export tab shows. */
function plan() {
  const manifest = loadManifest();
  const root = workspace.root();
  const files = workspaceFiles().map((f) => {
    const prev = manifest.files[f.rel];
    return { rel: f.rel, full: f.full, size: f.size, status: !prev ? 'new' : prev === f.hash ? 'unchanged' : 'changed' };
  });
  const present = new Set(files.map((f) => f.rel));
  const deleted = Object.keys(manifest.files).filter((r) => !present.has(r));

  const { refs, warnings } = referencedMods();
  const scan = mods.cached();
  const byId = new Map(scan.mods.map((m) => [String(m.id), m]));
  const otherById = new Map((scan.other || []).map((m) => [String(m.id), m]));
  const stagedSet = new Set(settings.get().stagedMods || []);
  const modRows = [];
  const seen = new Set();
  const addMod = (id, usedBy) => {
    if (seen.has(id)) return;
    seen.add(id);
    const m = byId.get(id);
    const stagedDir = path.join(root, 'content', 'Mods', id);
    const staged = fs.existsSync(stagedDir);
    const prev = manifest.mods[id];
    const row = {
      id,
      title: m?.title || otherById.get(id)?.title || `Workshop item ${id}`,
      installed: !!m?.downloaded,
      folder: m?.folder || null,
      size: m?.size || null,
      timeUpdated: m?.timeUpdated || null,
      usedBy,
      referenced: usedBy.length > 0,
      staged,
      stageWanted: stagedSet.has(id),
      status: prev === undefined ? 'new' : (m?.timeUpdated && m.timeUpdated > prev ? 'changed' : 'unchanged'),
    };
    if (!m) warnings.push(`${row.title} (${id}) is used by ${usedBy.join(', ')} but isn't installed on this PC. Subscribe to it in the Workshop and let Steam download it.`);
    else if (otherById.has(id)) warnings.push(`${row.title} (${id}) isn't a Halo 3 mod.`);
    modRows.push(row);
  };
  for (const [id, by] of refs) addMod(id, [...by]);
  // Mods already on the server (by manifest) or staged stay listed even when no playlist uses them now.
  for (const id of new Set([...Object.keys(manifest.mods), ...stagedSet])) addMod(id, []);

  return {
    workspace: root,
    files,
    deleted,
    mods: modRows,
    warnings,
    lastUpload: manifest.at,
    modsScannedAt: scan.scannedAt,
  };
}

/** Record the current workspace (and the given mods) as uploaded. */
function markUploaded(modIds) {
  const manifest = loadManifest();
  manifest.files = {};
  for (const f of workspaceFiles()) manifest.files[f.rel] = f.hash;
  const scan = mods.cached();
  for (const id of modIds || []) {
    const m = scan.mods.find((x) => String(x.id) === String(id));
    manifest.mods[id] = m?.timeUpdated || Date.now();
  }
  manifest.at = Date.now();
  fs.mkdirSync(path.dirname(manifestFile()), { recursive: true });
  fs.writeFileSync(manifestFile(), JSON.stringify(manifest, null, 2));
  settings.update({ exportedMods: manifest.mods, lastExport: manifest.at });
  return manifest;
}

/** Forget a mod as uploaded (it was removed from the server). */
function forgetMod(id) {
  const manifest = loadManifest();
  delete manifest.mods[id];
  fs.writeFileSync(manifestFile(), JSON.stringify(manifest, null, 2));
  settings.update({ exportedMods: manifest.mods });
}

// ---------------------------------------------------------------- staging

let staging = null;

/** Copy a mod folder into workspace/content/Mods/<id>, reporting progress. */
async function stageMod(id, onProgress) {
  if (staging) throw new Error('A copy is already running');
  const m = mods.cached().mods.find((x) => String(x.id) === String(id));
  if (!m?.downloaded) throw new Error('That mod isn\'t downloaded on this PC');
  const dest = path.join(workspace.root(), 'content', 'Mods', String(id));
  const tmp = `${dest}.partial`;
  const { total } = folderSize(m.folder);
  let done = 0;
  staging = { id, cancelled: false };
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
    const copyDir = async (from, to) => {
      fs.mkdirSync(to, { recursive: true });
      for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        if (staging.cancelled) throw new Error('Cancelled');
        const a = path.join(from, e.name);
        const b = path.join(to, e.name);
        if (e.isDirectory()) await copyDir(a, b);
        else {
          await fs.promises.copyFile(a, b);
          done += fs.statSync(a).size;
          onProgress({ id, done, total });
        }
      }
    };
    await copyDir(m.folder, tmp);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
    const s = new Set(settings.get().stagedMods || []);
    s.add(String(id));
    settings.update({ stagedMods: [...s] });
    return { id, dest };
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  } finally {
    staging = null;
  }
}

function cancelStaging() {
  if (staging) staging.cancelled = true;
}

function unstageMod(id) {
  fs.rmSync(path.join(workspace.root(), 'content', 'Mods', String(id)), { recursive: true, force: true });
  settings.update({ stagedMods: (settings.get().stagedMods || []).filter((x) => x !== String(id)) });
}

// ---------------------------------------------------------------- dedicated check

/** Runs `project-reclaimer.exe dedicated check` in the workspace, with the game folder pointed at the MCC install. */
function runCheck() {
  const s = settings.get();
  if (!s.reclaimerExe || !fs.existsSync(s.reclaimerExe)) return Promise.reject(new Error('Set project-reclaimer.exe in the Settings tab first'));
  return new Promise((resolve) => {
    const env = { ...process.env };
    // The workspace has no game files; use the PC's MCC install (dedicated.toml's own "game" is untouched).
    if (s.mccPath) env.RECLAIMER_DEDICATED_GAME = s.mccPath;
    const child = spawn(s.reclaimerExe, ['dedicated', 'check'], { cwd: workspace.root(), env, windowsHide: true });
    let out = '';
    const timer = setTimeout(() => { out += '\n[Stopped after 3 minutes]'; child.kill(); }, 180000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, output: `Couldn't start it: ${err.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, output: out.trim() }); });
  });
}

module.exports = { plan, markUploaded, forgetMod, stageMod, cancelStaging, unstageMod, runCheck };
