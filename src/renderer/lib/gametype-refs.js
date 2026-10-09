// Game type references as playlists and dedicated.toml write them:
//   base mode:      "Slayer", "Capture the Flag", …
//   bundled mode:   "Gun Game" (the server ships these in content/Game Modes/Project Reclaimer)
//   workspace file: "Game Modes/<file>.json" (copied to content/Game Modes)

import { catalog, findBaseMode } from './catalog.js';

let mine = [];
let bundled = [];

export async function loadGametypeRefs() {
  try {
    const all = (await window.api.workspace.list('gametypes')).filter((i) => !i.error);
    mine = all.filter((i) => !i.readOnly);
    bundled = all.filter((i) => i.readOnly);
  } catch {
    mine = [];
    bundled = [];
  }
  return mine;
}

// Real defaults of the base modes, decoded from MCC's stock game variants (main/mcc-variants.js).
let baseDefaults = null;
async function loadBaseDefaults() {
  if (!baseDefaults) {
    try { baseDefaults = await window.api.baseModeDefaults(); } catch { baseDefaults = {}; }
  }
  return baseDefaults;
}

/**
 * What a game type itself sets, for showing as the defaults of a playlist entry:
 * { rules, options, source } where rules/options hold only values we actually know.
 * Options a game type file doesn't set play as its base mode has them (unknown here).
 */
export async function gametypeBase(ref) {
  const d = describeGametype(ref);
  const empty = { rules: {}, options: {}, source: null };
  const defaults = await loadBaseDefaults();
  // Defaults are keyed by playlist name ("Capture the Flag"); files say "CaptureTheFlag".
  const forMode = (mode) => defaults[findBaseMode(mode)?.value || mode] || { rules: {}, options: {} };
  try {
    if (d.kind === 'base') {
      const b = defaults[d.name];
      return b ? { rules: { ...b.rules }, options: { ...b.options }, source: b.source } : empty;
    }
    let id = null;
    if (d.kind === 'bundled') id = bundled.find((b) => b.name.toLowerCase() === d.name.toLowerCase())?.id;
    if (d.kind === 'mine' && d.known) id = `ws:${d.file}`;
    if (!id) return empty;
    const r = await window.api.workspace.read('gametypes', id);
    // What the file doesn't set plays as its base mode's defaults.
    const base = forMode(r.data.mode || 'Slayer');
    return {
      rules: { ...base.rules, ...(r.data.rules || {}) },
      options: { ...base.options, ...(r.data.options || {}) },
      source: r.data.name || d.name,
    };
  } catch {
    return empty;
  }
}

/** Choices for a dropdown: [{ value, label, group }] */
export function gametypeChoices() {
  return [
    ...catalog.baseModes.map((m) => ({ value: m.value, label: m.label, group: 'Base modes' })),
    ...catalog.bundledModes.map((n) => ({ value: n, label: n, group: 'Bundled modes' })),
    ...mine.map((g) => ({ value: `Game Modes/${g.file}`, label: g.name, group: 'My game types' })),
  ];
}

/** { name, kind: 'base'|'bundled'|'mine'|'other', known } for a reference. */
export function describeGametype(ref) {
  const r = String(ref || '');
  const lower = r.toLowerCase();
  const base = catalog.baseModes.find((m) => m.value.toLowerCase() === lower);
  if (base) return { name: base.label, kind: 'base', known: true };
  const bundled = catalog.bundledModes.find((n) => n.toLowerCase() === lower);
  if (bundled) return { name: bundled, kind: 'bundled', known: true };
  const file = /^game modes\/(.+)$/i.exec(r);
  if (file) {
    const g = mine.find((x) => x.file.toLowerCase() === file[1].toLowerCase());
    return g ? { name: g.name, kind: 'mine', known: true, file: g.file } : { name: file[1], kind: 'mine', known: false, file: file[1] };
  }
  const byName = mine.find((x) => x.name.toLowerCase() === lower);
  if (byName) return { name: byName.name, kind: 'mine', known: true, file: byName.file };
  return { name: r, kind: 'other', known: false };
}

/** Workspace game type files a set of references uses (for export). */
export function referencedFiles(refs) {
  const out = new Set();
  for (const r of refs) {
    const d = describeGametype(r);
    if (d.kind === 'mine' && d.known) out.add(d.file);
  }
  return [...out];
}
