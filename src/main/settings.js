'use strict';

// App settings, stored as JSON in %APPDATA%\Halo 3 Server Manager\settings.json.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const steam = require('./steam');

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

/** Default workspace: Documents\Halo 3 Server Manager\workspace. */
function defaultWorkspace() {
  return path.join(app.getPath('documents'), 'Halo 3 Server Manager', 'workspace');
}

function defaultReclaimerDocs() {
  const p = path.join(app.getPath('documents'), 'My Games', 'Project Reclaimer');
  return fs.existsSync(p) ? p : '';
}

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, file());
}

/** Fill any missing paths by detection. Explicit user choices are never overwritten. */
async function fillDefaults({ force = false } = {}) {
  const s = load();
  let changed = false;
  const set = (k, v) => { if (v && (force || !s[k])) { s[k] = v; changed = true; } };

  if (force || !s.steamPath || !fs.existsSync(s.steamPath)) set('steamPath', await steam.detectSteamPath());
  if (force || !s.mccPath || !fs.existsSync(s.mccPath)) set('mccPath', steam.findMccPath(s.steamPath));
  set('reclaimerDocsDir', defaultReclaimerDocs());
  if (!s.workspaceDir) set('workspaceDir', defaultWorkspace());
  if (s.workspaceDir === defaultWorkspace()) fs.mkdirSync(s.workspaceDir, { recursive: true });

  if (changed) save();
  return s;
}

function get() {
  return load();
}

function update(patch) {
  const s = load();
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined || v === null) delete s[k];
    else s[k] = v;
  }
  save();
  return s;
}

module.exports = { get, update, fillDefaults, file };
