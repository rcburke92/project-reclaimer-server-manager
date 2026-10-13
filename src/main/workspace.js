'use strict';

// The workspace folder mirrors the server folder:
//   dedicated.toml
//   reserved-slots.toml (the Pterodactyl egg's reserved slots)
//   playlists/*.playlist.json
//   content/Game Modes/*.json
//   content/Maps/, content/Mods/, content/disabled-mods.json
// Bundled modes are read (never written) from the Reclaimer documents folder.

const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const KINDS = {
  gametypes: { dir: ['content', 'Game Modes'], ext: '.json' },
  playlists: { dir: ['playlists'], ext: '.playlist.json' },
};

function root() {
  const dir = settings.get().workspaceDir;
  if (!dir) throw new Error('No workspace folder set (Settings tab).');
  return dir;
}

function kindDir(kind) {
  const k = KINDS[kind];
  if (!k) throw new Error(`Unknown kind: ${kind}`);
  return path.join(root(), ...k.dir);
}

function bundledDir() {
  const docs = settings.get().reclaimerDocsDir;
  return docs ? path.join(docs, 'Game Modes', 'Project Reclaimer') : null;
}

/** Ids are "ws:<file name>" for workspace files and "bundled:<file name>" for read-only templates. */
function resolveId(kind, id) {
  const [scope, ...rest] = String(id).split(':');
  const name = rest.join(':');
  if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) throw new Error(`Bad id: ${id}`);
  if (scope === 'ws') return { file: path.join(kindDir(kind), name), readOnly: false };
  if (scope === 'bundled' && kind === 'gametypes' && bundledDir()) return { file: path.join(bundledDir(), name), readOnly: true };
  throw new Error(`Bad id: ${id}`);
}

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  return JSON.parse(text);
}

function listDir(dir, ext, scope, readOnly) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => n.toLowerCase().endsWith(ext))
    .map((n) => {
      const file = path.join(dir, n);
      const item = { id: `${scope}:${n}`, file: n, readOnly, mtime: fs.statSync(file).mtimeMs };
      try {
        const data = readJson(file);
        item.name = typeof data.name === 'string' && data.name ? data.name : n;
        if (Array.isArray(data.games)) item.count = data.games.length;
        if (data.mode) item.mode = data.mode;
        if (data.script) item.scripted = true;
      } catch (err) {
        item.name = n;
        item.error = `Can't read: ${err.message}`;
      }
      return item;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function list(kind) {
  const k = KINDS[kind];
  const items = listDir(kindDir(kind), k.ext, 'ws', false);
  if (kind === 'gametypes' && bundledDir()) items.push(...listDir(bundledDir(), '.json', 'bundled', true));
  return items;
}

function read(kind, id) {
  const { file, readOnly } = resolveId(kind, id);
  return { id, data: readJson(file), readOnly, file };
}

function slug(name) {
  return String(name || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
}

function uniqueFile(kind, base) {
  const dir = kindDir(kind);
  const ext = KINDS[kind].ext;
  let n = `${base}${ext}`;
  for (let i = 2; fs.existsSync(path.join(dir, n)); i++) n = `${base}-${i}${ext}`;
  return n;
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Save data. id null creates a new file named after data.name. Returns the id. */
function write(kind, id, data) {
  let file;
  if (id) {
    const r = resolveId(kind, id);
    if (r.readOnly) throw new Error('Bundled modes are read-only. Duplicate it to make your own copy.');
    file = r.file;
  } else {
    const name = uniqueFile(kind, slug(data.name));
    file = path.join(kindDir(kind), name);
    id = `ws:${name}`;
  }
  writeAtomic(file, `${JSON.stringify(data, null, 2)}\n`);
  return id;
}

function remove(kind, ids) {
  for (const id of ids) {
    const { file, readOnly } = resolveId(kind, id);
    if (readOnly) continue;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

/** Import external .json files into the workspace. Returns the new ids. */
function importFiles(kind, files) {
  const ids = [];
  for (const f of files) {
    const data = readJson(f);
    ids.push(write(kind, null, data));
  }
  return ids;
}

/** Saved maps in content/Maps: [{ file, name, kind: 'json'|'mvar'|'bin' }] */
function listForgeMaps() {
  const dir = path.join(root(), 'content', 'Maps');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => /\.(json|mvar|bin)$/i.test(n))
    .map((n) => {
      const kind = path.extname(n).slice(1).toLowerCase();
      let name = path.basename(n, path.extname(n));
      if (kind === 'json') {
        try { const d = readJson(path.join(dir, n)); if (typeof d.name === 'string' && d.name) name = d.name; } catch { /* keep file name */ }
      }
      return { file: n, name, kind };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// content/disabled-mods.json: {"packages": ["Mods/<folder>"]}
function disabledModsFile() {
  return path.join(root(), 'content', 'disabled-mods.json');
}

function readDisabledMods() {
  try {
    const d = readJson(disabledModsFile());
    return Array.isArray(d.packages) ? d.packages : [];
  } catch {
    return [];
  }
}

function setModDisabled(folder, disabled) {
  const pkg = `Mods/${folder}`;
  const list = readDisabledMods().filter((p) => p.toLowerCase() !== pkg.toLowerCase());
  if (disabled) list.push(pkg);
  if (list.length === 0 && fs.existsSync(disabledModsFile())) fs.unlinkSync(disabledModsFile());
  else if (list.length) writeAtomic(disabledModsFile(), `${JSON.stringify({ packages: list }, null, 2)}\n`);
  return list;
}

module.exports = { readDisabledMods, setModDisabled, listForgeMaps, list, read, write, remove, importFiles, root, kindDir, bundledDir, readJson, writeAtomic };
