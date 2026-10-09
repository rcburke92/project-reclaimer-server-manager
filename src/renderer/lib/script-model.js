// Converts game type scripts between their JSON form and simple form rows.
// Only constant-valued actions become editable rows; anything else (expressions
// over player numbers, version 2 logic) is kept exactly as written.

import { catalog } from './catalog.js';
import { deepEqual, clone } from './dom.js';

const EVENTS = catalog.script.events.map((e) => e.value);
const ACTIONS = new Map(catalog.script.actions.map((a) => [a.op, a]));
const CONDITIONS = catalog.script.conditions;

/** Constant from a one-item expression like [1.5], else undefined. */
function constant(expr) {
  return Array.isArray(expr) && expr.length === 1 && typeof expr[0] === 'number' ? expr[0] : undefined;
}

function conditionOf(when) {
  if (when === undefined) return 'always';
  const c = CONDITIONS.find((x) => x.when && deepEqual(x.when, when));
  return c ? c.value : null;
}

/** One JSON action -> { simple: true, op, value, condition } or { simple: false, raw }. */
export function parseAction(raw) {
  const def = ACTIONS.get(raw.op);
  const condition = conditionOf(raw.when);
  if (!def || condition === null) return { simple: false, raw };
  let value;
  switch (def.type) {
    case 'weapon':
      if (!Array.isArray(raw.choices) || raw.choices.length !== 1 || constant(raw.index) !== 0) return { simple: false, raw };
      value = raw.choices[0];
      break;
    case 'bool':
      if (typeof raw.enabled !== 'boolean') return { simple: false, raw };
      value = raw.enabled;
      break;
    case 'traits':
      if (!raw.values || typeof raw.values !== 'object') return { simple: false, raw };
      value = clone(raw.values);
      break;
    default:
      value = constant(raw.value);
      if (value === undefined) return { simple: false, raw };
  }
  return { simple: true, op: raw.op, value, condition };
}

/** Form row -> JSON action. */
export function buildAction({ op, value, condition }) {
  const def = ACTIONS.get(op);
  const out = { op };
  const cond = CONDITIONS.find((c) => c.value === condition);
  if (cond?.when) out.when = clone(cond.when);
  switch (def.type) {
    case 'weapon': out.index = [0]; out.choices = [value]; break;
    case 'bool': out.enabled = !!value; break;
    case 'traits': out.values = clone(value || {}); break;
    default: out.value = [value];
  }
  return out;
}

/**
 * Script -> { rows: [{ event, index, action }], logic, initial, version, advanced }
 * rows keep their position so unknown actions stay where they were.
 */
export function readScript(script) {
  const rows = [];
  if (script && typeof script === 'object') {
    for (const ev of EVENTS) {
      (script[ev] || []).forEach((raw, index) => rows.push({ event: ev, index, action: parseAction(raw) }));
    }
  }
  const logic = script?.logic;
  const logicParts = logic && typeof logic === 'object' ? Object.keys(logic).filter((k) => {
    const v = logic[k];
    return Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : v !== undefined;
  }) : [];
  return {
    rows,
    version: script?.version || 1,
    initial: script?.initial || [],
    logic,
    advancedParts: logicParts,
  };
}

/** Rebuild the script object. Returns undefined when nothing is left. */
export function writeScript(previous, rows, name) {
  const hasTraits = rows.some((r) => r.action.simple && r.action.op === 'traits');
  const prevLogic = previous?.logic;
  const out = {};
  const version = (previous?.version === 2 || hasTraits || prevLogic) ? 2 : 1;
  out.version = version;
  out.name = name;
  out.initial = previous?.initial || [];
  for (const ev of EVENTS) {
    const list = rows.filter((r) => r.event === ev).map((r) => (r.action.simple ? buildAction(r.action) : r.action.raw));
    if (list.length) out[ev] = list;
  }
  if (version === 2) out.logic = prevLogic || {};
  // Keep any other fields the file had (future additions).
  for (const [k, v] of Object.entries(previous || {})) {
    if (!(k in out) && !EVENTS.includes(k)) out[k] = v;
  }
  const hasEvents = EVENTS.some((ev) => out[ev]);
  const hasLogic = out.logic && Object.keys(out.logic).length;
  return hasEvents || hasLogic ? out : undefined;
}

export function describeAction(action) {
  if (!action.simple) {
    const known = ACTIONS.get(action.raw.op);
    const cond = conditionOf(action.raw.when);
    const condLabel = cond && cond !== 'always' ? CONDITIONS.find((c) => c.value === cond)?.label : action.raw.when ? 'with a custom condition' : null;
    return {
      label: known ? known.label : `"${action.raw.op}" action`,
      value: known ? 'formula (kept as written)' : 'advanced (kept as written)',
      condition: condLabel,
      advanced: true,
    };
  }
  const def = ACTIONS.get(action.op);
  let value;
  switch (def.type) {
    case 'weapon': value = catalog.scriptWeapons.find((w) => w.value === action.value)?.label || action.value; break;
    case 'bool': value = action.value ? 'On' : 'Off'; break;
    case 'traits': {
      const parts = Object.entries(action.value || {}).map(([k, v]) => {
        const t = catalog.traits.find((x) => x.key === k);
        return t ? `${t.label} ${v === 0 ? 'unchanged' : t.values[v - 1] ?? v}` : `${k} ${v}`;
      });
      value = parts.join(', ') || 'clear all traits';
      break;
    }
    default: value = `${action.value}${def.unit || ''}`;
  }
  const cond = CONDITIONS.find((c) => c.value === action.condition);
  return { label: def.label, value, condition: cond && cond.value !== 'always' ? cond.label : null };
}

export { EVENTS, ACTIONS, CONDITIONS };
