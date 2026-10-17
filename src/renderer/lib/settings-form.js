// Generates form controls from catalog definitions, so every editor is driven
// by the data in src/catalog/ instead of hand-written markup.
//
// A definition looks like:
//   { key: 'player.shields', label: 'Shields', help: '…', group: 'Player',
//     type: 'enum' | 'int' | 'number' | 'bool' | 'string' | 'list' | 'lines',
//     values: [{ value: 1, label: 'No shields' }, …],   // enum
//     min, max, step, unit, slider: true,               // int / number
//     maxLength, placeholder,                           // string
//     maxLines, maxLength (per line), placeholder,       // lines: one text line, or a list of them
//     default }

import { h, deepEqual } from './dom.js';

/** Value used when a setting is first switched on. */
export function initialValue(def) {
  if (def.default !== undefined) return def.default;
  switch (def.type) {
    case 'enum': return def.values?.[0]?.value;
    case 'bool': return true;
    case 'int':
    case 'number': return def.min !== undefined && def.min > 0 ? def.min : 0;
    case 'list': return [];
    case 'const': return def.value;
    default: return '';
  }
}

/** Human-readable text for a value, for summaries like "Shields: No shields". */
export function formatValue(def, value) {
  if (!def) return String(value);
  switch (def.type) {
    case 'enum': {
      const v = def.values?.find((x) => x.value === value);
      return v ? v.label : String(value);
    }
    case 'bool': return value ? (def.onLabel || 'On') : (def.offLabel || 'Off');
    case 'list': return (value || []).join(', ') || 'none';
    case 'lines': return linesOf(value).join(' / ') || 'none';
    case 'const': return def.valueLabel || 'Yes';
    default: return def.unit ? `${value}${def.unit}` : String(value);
  }
}

/** A 'lines' value (one string, or a list of them) as a list of lines. */
export function linesOf(value) {
  if (Array.isArray(value)) return value.map(String);
  return value ? String(value).split('\n') : [];
}

/** Text area contents -> a 'lines' value: '' for none, a string for one line, else a list. */
function linesValue(def, text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean)
    .map((l) => (def.maxLength ? l.slice(0, def.maxLength) : l))
    .slice(0, def.maxLines || undefined);
  return lines.length === 0 ? '' : lines.length === 1 ? lines[0] : lines;
}

/** Clamp/convert a raw input value according to the definition. */
export function coerce(def, raw) {
  if (def.type === 'int' || def.type === 'number') {
    let n = Number(raw);
    if (!Number.isFinite(n)) n = initialValue(def);
    if (def.type === 'int') n = Math.round(n);
    if (def.min !== undefined) n = Math.max(def.min, n);
    if (def.max !== undefined) n = Math.min(def.max, n);
    return n;
  }
  if (def.type === 'bool') return !!raw;
  if (def.type === 'string') return String(raw ?? '').slice(0, def.maxLength || undefined);
  return raw;
}

/**
 * Value control only (no toggle): dropdown, number, slider, switch or text.
 * onChange(value) fires on every committed change.
 */
export function control(def, value, onChange, { disabled = false } = {}) {
  switch (def.type) {
    case 'const':
      return h('span.muted', def.valueLabel || 'Yes');
    case 'enum': {
      const sel = h('select.select', {
        disabled,
        onchange: () => { const i = sel.selectedOptions[0]?.dataset.i; if (i !== undefined) onChange(def.values[Number(i)].value); },
      }, def.values.map((v, i) => h('option', { selected: v.value === value, dataset: { i: String(i) } },
        v.verified === false ? `${v.label} *` : v.label)));
      if (value === undefined) {
        // The default isn't known: say so rather than pre-selecting a guess.
        sel.prepend(h('option', { selected: true, disabled: true }, def.unsetLabel || 'Game type default'));
      } else if (!def.values.some((v) => v.value === value)) {
        // Keep unknown values from files visible instead of silently changing them.
        sel.prepend(h('option', { selected: true, disabled: true }, `${value} (unknown)`));
      }
      return sel;
    }
    case 'bool': {
      const input = h('input', { type: 'checkbox', checked: !!value, disabled, onchange: () => onChange(input.checked) });
      return h('label.toggle', input, h('span'));
    }
    case 'int':
    case 'number': {
      const step = def.step || (def.type === 'int' ? 1 : 0.1);
      if (def.slider && def.min !== undefined && def.max !== undefined) {
        // min [=====slider=====] max  [ value ] unit
        const start = value ?? def.min;
        const num = h('input.input.slider-num', {
          type: 'number', min: def.min, max: def.max, step, value: value ?? '', disabled, placeholder: 'default',
          title: `${def.min} to ${def.max}`,
          oninput: () => {
            // Follow typing on the slider while the number is in range; commit on change.
            const n = Number(num.value);
            const ok = num.value !== '' && Number.isFinite(n) && n >= def.min && n <= def.max;
            num.classList.toggle('invalid', !ok && num.value !== '');
            if (ok) range.value = n;
          },
          onchange: () => {
            if (num.value === '') { num.classList.remove('invalid'); onChange(undefined); return; }
            const v = coerce(def, num.value);
            num.value = v;
            range.value = v;
            num.classList.remove('invalid');
            onChange(v);
          },
          onkeydown: (e) => { if (e.key === 'Enter') num.blur(); },
        });
        const range = h('input', {
          type: 'range', min: def.min, max: def.max, step, value: start, disabled, class: value === undefined ? 'unset' : '',
          oninput: () => { num.value = coerce(def, range.value); num.classList.remove('invalid'); range.classList.remove('unset'); },
          onchange: () => onChange(coerce(def, range.value)),
        });
        return h('span.slider',
          h('span.bound', { title: 'Minimum' }, String(def.min)),
          range,
          h('span.bound', { title: 'Maximum' }, String(def.max)),
          num,
          def.unit ? h('span.muted.unit', def.unit.trim()) : null);
      }
      const input = h('input.input', {
        type: 'number', min: def.min, max: def.max, step, value: value ?? '', disabled, placeholder: 'default',
        onchange: () => {
          if (input.value === '') { onChange(undefined); return; } // cleared: back to the default
          const v = coerce(def, input.value);
          input.value = v;
          onChange(v);
        },
      });
      return def.unit ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, input, h('span.muted', def.unit)) : input;
    }
    case 'lines': {
      // One line of text per row; written as a string for one line, a list for more.
      const input = h('textarea.input', {
        value: linesOf(value).join('\n'), disabled, placeholder: def.placeholder || '',
        rows: Math.min(def.maxLines || 5, Math.max(2, linesOf(value).length)),
        style: { width: '420px', resize: 'vertical', fontFamily: 'inherit' },
        onchange: () => {
          const v = linesValue(def, input.value);
          input.value = linesOf(v).join('\n');
          onChange(v);
        },
      });
      return input;
    }
    case 'list': {
      // Comma-separated list of short values (e.g. admin IDs).
      const input = h('input.input', {
        value: (value || []).join(', '), disabled, placeholder: def.placeholder || '', style: { width: '320px' },
        onchange: () => onChange(input.value.split(',').map((s) => s.trim()).filter(Boolean)),
      });
      return input;
    }
    default: {
      const input = h('input.input', {
        type: def.secret ? 'password' : 'text',
        value: value ?? '', disabled, maxLength: def.maxLength || undefined, placeholder: def.placeholder || '',
        style: { width: def.wide ? '320px' : '220px' },
        onchange: () => onChange(coerce(def, input.value)),
      });
      return input;
    }
  }
}

/**
 * One setting: [override toggle]  label  [value].
 *
 * The value is always shown and editable. While the toggle is off the row shows
 * the base value (what applies when the file doesn't set it: the game type's own
 * value, the server default, ...) and nothing is written. Changing the value turns
 * the override on; changing it back to a known base value, or switching the
 * toggle off, turns it off again.
 *
 * opts.base / opts.baseKnown: the value that applies when off, if known.
 * onChange({ enabled, value })
 */
export function settingRow(def, { enabled = false, value, onChange, base, baseKnown = false }) {
  // Unknown defaults stay empty ("Game type default") instead of showing a guess.
  const baseValue = () => (baseKnown ? base : undefined);
  let current = enabled ? value : baseValue();
  const row = h('div.setting-row', { class: enabled ? '' : 'off', dataset: { key: def.key } });
  const box = h('input', { type: 'checkbox', checked: enabled, title: 'Override: on writes this value; off uses the default' });
  const controlHost = h('div.control');
  const status = h('span.status');

  // A switch beside the override toggle would read as a second toggle: show booleans as On/Off.
  const valueDef = def.type === 'bool'
    ? { ...def, type: 'enum', values: [{ value: true, label: def.onLabel || 'On' }, { value: false, label: def.offLabel || 'Off' }] }
    : def;

  function drawStatus() {
    row.classList.toggle('off', !box.checked);
    if (def.type === 'const') { status.textContent = ''; return; }
    if (box.checked) {
      status.className = 'status changed';
      status.textContent = baseKnown ? `changed · default ${formatValue(def, base)}` : 'changed';
    } else {
      status.className = 'status';
      status.textContent = 'default';
    }
  }

  function drawControl() {
    // Constants (like "disable anti-cheat") have no value: the toggle is the setting.
    const disabled = def.type === 'const' && !box.checked;
    controlHost.replaceChildren(control(valueDef, current, (v) => {
      if (v === undefined) {
        // Field cleared: back to the default.
        current = baseValue();
        box.checked = false;
        drawControl();
        drawStatus();
        onChange({ enabled: false, value: current });
        return;
      }
      current = v;
      if (baseKnown && deepEqual(v, base)) {
        box.checked = false;
        onChange({ enabled: false, value: v });
      } else {
        box.checked = true;
        onChange({ enabled: true, value: v });
      }
      drawStatus();
    }, { disabled }));
  }

  box.addEventListener('change', () => {
    if (!box.checked) current = baseValue(); // back to the default
    else if (current === undefined) current = initialValue(def); // start from a typical value
    drawControl();
    drawStatus();
    onChange({ enabled: box.checked, value: current });
  });

  drawControl();
  drawStatus();
  row.append(
    h('label.toggle', box, h('span')),
    h('div.name', def.label, status, def.help ? h('span.help', def.help) : null),
    controlHost,
  );
  return row;
}

/**
 * Collapsible groups of setting rows.
 * state: { [key]: value } of the settings currently overridden.
 * bases: { [key]: value } known base values (shown while not overridden).
 * onChange(key, { enabled, value })
 */
export function settingGroups(defs, state, onChange, { openGroups = [], bases = {} } = {}) {
  const groups = new Map();
  for (const d of defs) {
    const g = d.group || 'Other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(d);
  }
  return [...groups].map(([name, items]) => {
    const count = h('span.count');
    const updateCount = () => {
      const n = items.filter((d) => Object.prototype.hasOwnProperty.call(state, d.key)).length;
      count.textContent = n ? `${n} changed` : '';
    };
    updateCount();
    const details = h('details.setting-group', { open: openGroups.includes(name) || items.some((d) => d.key in state) },
      h('summary', name, count),
      items.map((d) => settingRow(d, {
        enabled: Object.prototype.hasOwnProperty.call(state, d.key),
        value: state[d.key],
        base: bases[d.key],
        baseKnown: Object.prototype.hasOwnProperty.call(bases, d.key),
        onChange: (change) => {
          if (change.enabled) state[d.key] = change.value;
          else delete state[d.key];
          updateCount();
          onChange?.(d.key, change);
        },
      })),
    );
    return details;
  });
}

/** Labelled field wrapper for always-on controls (server settings, headers). */
export function field(label, controlEl, help) {
  return h('div.field', h('label', label), controlEl, help ? h('div.help', help) : null);
}
