// Catalog data from src/catalog/*.json, with shared value lists resolved.
import maps from '../../catalog/maps.json' with { type: 'json' };
import gametype from '../../catalog/gametype-schema.json' with { type: 'json' };
import playlist from '../../catalog/playlist-schema.json' with { type: 'json' };
import server from '../../catalog/server-schema.json' with { type: 'json' };
import reservedSlots from '../../catalog/reserved-slots-schema.json' with { type: 'json' };
import limits from '../../catalog/limits.json' with { type: 'json' };

function resolveValues(defs) {
  return defs.map((d) => (typeof d.values === 'string' && d.values.startsWith('$')
    ? { ...d, values: gametype[d.values.slice(1)] }
    : d));
}

const options = resolveValues(gametype.options);

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
  limits,
};

const ruleByKey = new Map(gametype.rules.map((d) => [d.key, d]));
const optionByKey = new Map(options.map((d) => [d.key, d]));

export function ruleDef(key) { return ruleByKey.get(key); }

/** Option definition; unknown keys (e.g. from imported files) get a plain number field. */
export function optionDef(key) {
  return optionByKey.get(key) || { key, label: key, group: 'Other (imported)', type: 'int', min: -1000000, max: 1000000, default: 0, unknown: true };
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
