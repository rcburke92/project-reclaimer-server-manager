// Dialogs for choosing settings: every setting listed with a toggle that
// starts off, grouped like the in-game menus.

import { h, clone } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { settingGroups, settingRow, formatValue } from '../lib/settings-form.js';

/**
 * All-settings picker. state: { key: value } of the settings currently on.
 * Resolves the new state, or null when cancelled.
 */
export async function openSettingsPicker({ title, defs, state, applyLabel = 'Apply', intro }) {
  const working = clone(state || {});
  const anyUnverified = defs.some((d) => d.verified === false || (Array.isArray(d.values) && d.values.some((v) => v.verified === false)));
  const d = openDialog({
    title,
    width: 760,
    height: Math.min(760, window.innerHeight - 80),
    body: h('div.settings-picker',
      intro ? h('p.muted', { style: { marginTop: 0 } }, intro) : null,
      settingGroups(defs, working, null),
      anyUnverified ? h('div.legend', '* This value is inferred, not confirmed by the docs. Run "dedicated check" before uploading.') : null),
    buttons: [
      { label: 'Cancel', value: null },
      { label: applyLabel, value: 'apply', cls: 'primary' },
    ],
  });
  return (await d.result) === 'apply' ? working : null;
}

/** Edit one setting. Resolves { value } or null when cancelled. */
export async function openSingleSetting(def, value) {
  const state = { [def.key]: value };
  const row = settingRow(def, {
    enabled: true,
    value,
    onChange: ({ enabled, value: v }) => { if (enabled) state[def.key] = v; else delete state[def.key]; },
  });
  // A single-setting edit always keeps the setting on: hide the toggle.
  row.querySelector('.toggle').style.visibility = 'hidden';
  const d = openDialog({
    title: def.label,
    width: 620,
    body: h('div', row),
    buttons: [{ label: 'Cancel', value: null }, { label: 'OK', value: 'ok', cls: 'primary' }],
  });
  return (await d.result) === 'ok' && def.key in state ? { value: state[def.key] } : null;
}

export { formatValue };
