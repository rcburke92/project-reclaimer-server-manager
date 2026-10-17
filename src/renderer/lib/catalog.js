// Catalog data from src/catalog/*.json, with shared value lists resolved.
import maps from '../../catalog/maps.json' with { type: 'json' };
import gametype from '../../catalog/gametype-schema.json' with { type: 'json' };
import playlist from '../../catalog/playlist-schema.json' with { type: 'json' };
import server from '../../catalog/server-schema.json' with { type: 'json' };
import reservedSlots from '../../catalog/reserved-slots-schema.json' with { type: 'json' };
import nextVote from '../../catalog/next-vote-schema.json' with { type: 'json' };
import limits from '../../catalog/limits.json' with { type: 'json' };

function resolveValues(defs) {
  return defs.map((d) => (typeof d.values === 'string' && d.values.startsWith('$')
    ? { ...d, values: gametype[d.values.slice(1)] }
    : d));
}

// Each trait set (flag_carrier, infected, …) takes every player.* trait under its own key.
const playerTraits = gametype.options.filter((d) => d.key.startsWith('player.'));
const traitSetOptions = gametype.traitSets.flatMap((set) => playerTraits.map((d) => {
  const o = { ...d, key: `${set.key}.${d.key.slice('player.'.length)}`, group: `Traits: ${set.label}`, modes: set.modes };
  // A set's trait starts as Unchanged, not as the player default.
  delete o.default;
  if (d.values === '$startingWeapons') o.default = -2;
  if (!set.modes) delete o.modes;
  return o;
}));

const options = resolveValues([...gametype.options, ...traitSetOptions]);

export const catalog = {
  maps: maps.maps,
  baseModes: gametype.baseModes,
  bundledModes: gametype.bundledModes,
  rules: gametype.rules,
  options,
  startingWeapons: gametype.startingWeapons,
  scriptWeapons: gametype.scriptWeapons,
  traits: gametype.traits,
  script: gametype.script,
  playlist,
  server,
  reservedSlots,
  nextVote,
  limits,
};

const ruleByKey = new Map(gametype.rules.map((d) => [d.key, d]));
const optionByKey = new Map(options.map((d) => [d.key, d]));

export function ruleDef(key) { return ruleByKey.get(key); }

/** A definition as it applies in one base mode: its own label and range there, and "Mode rules" named after the mode. */
function inMode(def, base) {
  if (!base) return def;
  const d = def.byMode?.[base.value] ? { ...def, ...def.byMode[base.value] } : def;
  return d.group === 'Mode rules' ? { ...d, group: `${base.label} rules` } : d;
}

/**
 * Option definition; unknown keys (e.g. from imported files) get a plain number field.
 * With a base mode (any name findBaseMode knows), labels and ranges are that mode's.
 */
export function optionDef(key, mode) {
  const def = optionByKey.get(key);
  if (!def) return { key, label: key, group: 'Other (imported)', type: 'int', min: -1000000, max: 1000000, default: 0, unknown: true };
  return inMode(def, findBaseMode(mode));
}

/** Whether an option applies to a base mode. Unknown modes and unknown options say yes. */
export function optionApplies(key, mode) {
  const def = optionByKey.get(key);
  const base = findBaseMode(mode);
  return !def?.modes || !base || def.modes.includes(base.value);
}

/** The options a base mode has, as they apply there. Every option when the mode isn't known. */
export function optionsForMode(mode) {
  const base = findBaseMode(mode);
  return options.filter((d) => !base || !d.modes || d.modes.includes(base.value)).map((d) => inMode(d, base));
}

/** Base mode by its playlist name, label or game-type-file id, ignoring case. */
export function findBaseMode(mode) {
  const m = String(mode || '').toLowerCase();
  return gametype.baseModes.find((b) => b.value.toLowerCase() === m || b.label.toLowerCase() === m || b.json.toLowerCase() === m) || null;
}

/** Stock map by display name or file name, ignoring case. */
export function findStockMap(ref) {
  const r = String(ref || '').toLowerCase();
  return maps.maps.find((m) => m.name.toLowerCase() === r || m.file === r) || null;
}
