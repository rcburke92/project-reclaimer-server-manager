'use strict';

// Default settings of Halo 3's built-in game types, read from the stock game
// variants MCC ships in halo3/game_variants (e.g. "ctf-0_010.bin" = Multi Flag).
//
// File: BLF chunks (_blf, athr, gvar, _eof). The gvar chunk is a big-endian
// bitstream:
//   4  game engine (1 CTF, 2 Slayer, 3 Oddball, 4 KOTH, 6 VIP, 7 Juggernaut,
//      8 Territories, 9 Assault, 10 Infection)
//   64 unique id, then the name (UTF-16, NUL-terminated) and the description
//      (8-bit, NUL-terminated). Everything after is fixed-size ("tail").
// Tail offsets below were worked out against the stock variants whose file
// names state their values (hardcoreSlayer_50kills, hardcoreFlag_..._3points,
// hardcoreKing_250points, ffa_..._12min) and checked across all 49 files:
//   389 flags (4; the 2nd is "teams"), 393 time limit minutes (8, 0 = none),
//   401 rounds (4), 405 early victory wins (4), 413 lives per round (6),
//   426 respawn seconds (8); the game type's own settings start at 865.
// Only fields that could be confirmed are read; anything else stays unknown.

const fs = require('fs');
const path = require('path');

const ENGINES = {
  Slayer: { file: 'slayer-0_010.bin', engine: 2, tail: 1012 },
  'Capture the Flag': { file: 'ctf-0_010.bin', engine: 1, tail: 980 },
  Oddball: { file: 'oddball-0_010.bin', engine: 3, tail: 988 },
  'King of the Hill': { file: 'king of the hill-0_010.bin', engine: 4, tail: 980 },
  VIP: { file: 'vip-0_010.bin', engine: 6, tail: 1148 },
  Juggernaut: { file: 'juggernaut-0_010.bin', engine: 7, tail: 996 },
  Territories: { file: 'territories-0_010.bin', engine: 8, tail: 1028 },
  Assault: { file: 'assault-0_010.bin', engine: 9, tail: 1052 },
  Infection: { file: 'infection-0_010.bin', engine: 10, tail: 1196 },
};

// Score to win inside each game type's own block: [offset from 865, width]. Confirmed modes only.
const SCORE = {
  2: [0, 10], // Slayer: 25, Team Slayer 50, Elimination 5, Duel 10; 1023 = no limit
  1: [7, 6], // CTF captures: Multi Flag 3, One Flag 1, hardcore 3/5
  4: [1, 10], // KOTH: 100, Team 150, hardcore 250
  3: [3, 10], // Oddball: 50, Team 100, Lowball 25, hardcore 250
};

function gvarChunk(buf) {
  let i = 0;
  while (i + 12 <= buf.length) {
    const name = buf.toString('latin1', i, i + 4);
    const size = buf.readUInt32BE(i + 4);
    if (name === 'gvar') return buf.subarray(i + 12, i + size);
    if (size < 12) break;
    i += size;
  }
  return null;
}

/** Bit reader over a big-endian bitstream. */
function reader(data) {
  const bits = Array.from(data, (b) => b.toString(2).padStart(8, '0')).join('');
  return {
    length: bits.length,
    uint(at, width) { return parseInt(bits.slice(at, at + width), 2); },
    bit(at) { return bits[at] === '1'; },
  };
}

/** Parse one variant file: { engine, name, description, tail } where tail(offset, width) reads the fixed part. */
function parseVariant(file) {
  const data = gvarChunk(fs.readFileSync(file));
  if (!data) throw new Error('No gvar chunk');
  const r = reader(data);
  const engine = r.uint(0, 4);
  let p = 4 + 64;
  let name = '';
  for (let c; (c = r.uint(p, 16)) !== 0 && p < r.length; p += 16) name += String.fromCharCode(c);
  p += 16;
  let description = '';
  for (let c; (c = r.uint(p, 8)) !== 0 && p < r.length; p += 8) description += String.fromCharCode(c);
  p += 8;
  const start = p;
  return {
    engine,
    name,
    description,
    tailLength: r.length - start,
    uint: (off, width) => r.uint(start + off, width),
    bit: (off) => r.bit(start + off),
  };
}

function signed(v, width) {
  return v >= 1 << (width - 1) ? v - (1 << width) : v;
}

/** Decoded defaults of one stock variant in the playlist/game type vocabulary. */
function decodeDefaults(v) {
  const options = {
    'rounds.teams': v.bit(390) ? 1 : 0,
    'rounds.minutes': v.uint(393, 8),
    'rounds.limit': v.uint(401, 4),
    'rounds.early_victory': v.uint(405, 4),
    'respawn.lives': v.uint(413, 6),
  };
  const rules = {};
  const score = SCORE[v.engine];
  if (score) {
    const raw = v.uint(865 + score[0], score[1]);
    rules.score_to_win = raw === (1 << score[1]) - 1 ? 0 : raw; // all ones = no limit
  }
  if (v.engine === 2) {
    rules.kill_points = signed(v.uint(875, 5), 5);
    rules.death_points = signed(v.uint(885, 5), 5);
    rules.suicide_points = signed(v.uint(890, 5), 5);
    rules.betrayal_points = signed(v.uint(895, 5), 5);
  }
  return { rules, options, respawnSeconds: v.uint(426, 8) };
}

/**
 * Defaults for every base mode, keyed by mode name:
 * { 'Capture the Flag': { rules, options, source: 'MCC built-in "multi_flag"' }, ... }
 * Modes whose file is missing or doesn't look like the known layout are left out.
 */
function baseModeDefaults(mccPath) {
  const out = {};
  if (!mccPath) return out;
  const dir = path.join(mccPath, 'halo3', 'game_variants');
  for (const [mode, spec] of Object.entries(ENGINES)) {
    try {
      const v = parseVariant(path.join(dir, spec.file));
      if (v.engine !== spec.engine || v.tailLength !== spec.tail) continue; // unknown format: don't guess
      const d = decodeDefaults(v);
      out[mode] = { ...d, source: `MCC's built-in "${v.name.replace(/_/g, ' ')}"` };
    } catch {
      // file missing or unreadable: no defaults for this mode
    }
  }
  return out;
}

module.exports = { baseModeDefaults, parseVariant, decodeDefaults, ENGINES };
