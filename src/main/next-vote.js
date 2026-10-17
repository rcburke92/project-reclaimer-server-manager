'use strict';

// next-vote.toml in the workspace: the Pterodactyl egg's next-game vote
// (read by its reclaimer-next-vote.py, not by Project Reclaimer). Saved
// comment-preserving, like dedicated.toml.

const fs = require('fs');
const path = require('path');
const workspace = require('./workspace');
const { patchToml, parseToml } = require('./toml-patch');

const DEFAULT_TEXT = `# next-vote.toml: the next-game vote on the first [[server]]. An admin types
# !nextvote in game chat (or nextvote in the panel console), players pick a game
# from the list below, and the winner plays after the current game.
# Read by the Pterodactyl egg (reclaimer-next-vote.py), not by Project Reclaimer.
# Edited with Halo 3 Server Manager.
`;

function file() {
  return path.join(workspace.root(), 'next-vote.toml');
}

const plain = (v) => JSON.parse(JSON.stringify(v));

/** A missing file reads as empty settings: the vote is off until it's saved. */
function read() {
  const f = file();
  if (!fs.existsSync(f)) return { exists: false, file: f, data: {} };
  const text = fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
  try {
    return { exists: true, file: f, data: plain(parseToml(text)) };
  } catch (err) {
    return { exists: true, file: f, data: null, error: `next-vote.toml has a syntax error: ${err.message}` };
  }
}

function write(data) {
  const f = file();
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/^﻿/, '') : DEFAULT_TEXT;
  workspace.writeAtomic(f, patchToml(text, data));
  return read();
}

module.exports = { read, write, file };
