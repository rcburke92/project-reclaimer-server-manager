'use strict';

// reserved-slots.toml in the workspace: the Pterodactyl egg's reserved slots
// settings (read by its reclaimer-reserved-slots.py, not by Project Reclaimer).
// Saved comment-preserving, like dedicated.toml.

const fs = require('fs');
const path = require('path');
const workspace = require('./workspace');
const { patchToml, parseToml } = require('./toml-patch');

const DEFAULT_TEXT = `# reserved-slots.toml: reserved slots for whitelisted players on the first [[server]].
# Read by the Pterodactyl egg (reclaimer-reserved-slots.py), not by Project Reclaimer.
# Edited with Halo 3 Server Manager. The egg's Reserved … variables override these when set.
`;

function file() {
  return path.join(workspace.root(), 'reserved-slots.toml');
}

const plain = (v) => JSON.parse(JSON.stringify(v));

/** A missing file reads as empty settings: reserved slots off. */
function read() {
  const f = file();
  if (!fs.existsSync(f)) return { exists: false, file: f, data: {} };
  const text = fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
  try {
    return { exists: true, file: f, data: plain(parseToml(text)) };
  } catch (err) {
    return { exists: true, file: f, data: null, error: `reserved-slots.toml has a syntax error: ${err.message}` };
  }
}

function write(data) {
  const f = file();
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/^﻿/, '') : DEFAULT_TEXT;
  workspace.writeAtomic(f, patchToml(text, data));
  return read();
}

module.exports = { read, write, file };
