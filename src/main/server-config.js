'use strict';

// dedicated.toml in the workspace: read, save (comment-preserving), import.

const fs = require('fs');
const path = require('path');
const workspace = require('./workspace');
const { patchToml, parseToml } = require('./toml-patch');

const DEFAULT_TEXT = `# dedicated.toml: Project Reclaimer dedicated server settings.
# Edited with Halo 3 Server Manager. Reference: https://projectreclaimer.dev/host
# Egg variables set in the Pterodactyl panel (RECLAIMER_DEDICATED_*) override these.
game = "game"
content = "content"
host_name = "Dedicated server"

[defaults]
max_players = 16

[[server]]
name = "Halo 3"
port = 49176   # the egg's "Sync Port" rewrites this to your allocation on every start
map = "Guardian"
game = "Slayer"
`;

function file() {
  return path.join(workspace.root(), 'dedicated.toml');
}

const plain = (v) => JSON.parse(JSON.stringify(v));

function read() {
  const f = file();
  if (!fs.existsSync(f)) return { exists: false, file: f, data: null };
  const text = fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
  try {
    return { exists: true, file: f, data: plain(parseToml(text)) };
  } catch (err) {
    return { exists: true, file: f, data: null, error: `dedicated.toml has a syntax error: ${err.message}` };
  }
}

function write(data) {
  const f = file();
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/^﻿/, '') : DEFAULT_TEXT;
  workspace.writeAtomic(f, patchToml(text, data));
  return read();
}

function createDefault() {
  workspace.writeAtomic(file(), DEFAULT_TEXT);
  return read();
}

function importFrom(src) {
  const text = fs.readFileSync(src, 'utf8').replace(/^﻿/, '');
  parseToml(text); // refuse files that don't parse
  workspace.writeAtomic(file(), text);
  return read();
}

module.exports = { read, write, createDefault, importFrom, file };
