// Game Types tab: object browser of game type files + form editor.
import { h, render } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { catalog, optionDef, ruleDef, findBaseMode } from '../lib/catalog.js';
import { control, formatValue, settingGroups } from '../lib/settings-form.js';
import { openDialog, confirmDialog } from '../lib/dialog.js';
import { toast } from '../lib/toast.js';
import { settings } from '../lib/settings.js';
import { createCollectionTab } from '../components/collection-tab.js';
import { openSettingsPicker, openSingleSetting } from '../components/settings-picker.js';
import { readScript, writeScript, describeAction, ACTIONS, CONDITIONS } from '../lib/script-model.js';

const RULE_DEFAULTS = Object.fromEntries(catalog.rules.map((r) => [r.key, r.default]));
// Kill/death/suicide/betrayal points are Slayer scoring; other modes only get score to win.
const SLAYER_ONLY_RULES = catalog.rules.filter((r) => r.key !== 'score_to_win').map((r) => r.key);

/** The value a game type file's "mode" must hold (CaptureTheFlag, KingOfTheHill, ...). */
function fileMode(mode) {
  return findBaseMode(mode)?.json || mode;
}

let collection;

function blank(name) {
  return { version: 1, name, mode: 'Slayer', rules: { ...RULE_DEFAULTS }, options: {} };
}

// ---------------------------------------------------------------- validation

export function validateGametype(data) {
  const issues = [];
  const name = (data.name || '').trim();
  if (!name) issues.push({ level: 'error', text: 'Name is required' });
  else if (name.length > catalog.limits.gametype.nameMax) issues.push({ level: 'error', text: `Name is over ${catalog.limits.gametype.nameMax} characters` });
  if (!catalog.baseModes.some((m) => m.json === data.mode)) issues.push({ level: 'error', text: `Unknown base mode "${data.mode}"` });
  if (data.script && data.mode !== 'Slayer') issues.push({ level: 'error', text: 'Scripted game types must use Slayer as the base mode' });
  if (catalog.bundledModes.some((m) => m.toLowerCase() === name.toLowerCase())) issues.push({ level: 'warning', text: 'Same name as a bundled mode: playlists will pick the bundled one' });
  if (catalog.baseModes.some((m) => m.value.toLowerCase() === name.toLowerCase())) issues.push({ level: 'warning', text: 'Same name as a base mode: playlists will pick the base mode' });
  for (const [key, value] of Object.entries(data.options || {})) {
    const def = optionDef(key);
    if (def.unknown) continue;
    if (def.verified === false) issues.push({ level: 'warning', text: `${def.label}: not confirmed by the docs` });
    const v = Array.isArray(def.values) ? def.values.find((x) => x.value === value) : null;
    if (v && v.verified === false) issues.push({ level: 'warning', text: `${def.label} "${v.label}": value not confirmed by the docs` });
  }
  return issues;
}

// ---------------------------------------------------------------- editor

function summaryRow({ label, group, value, onEdit, onDelete, disabled }) {
  return h('div.summary-row',
    h('div.label', label, group ? h('span.group', group) : null),
    h('div.value', value),
    h('div.actions',
      onEdit ? h('button.icon-btn.small', { title: 'Edit', disabled, onclick: onEdit }, icon('edit')) : null,
      onDelete ? h('button.icon-btn.small.danger', { title: 'Remove', disabled, onclick: onDelete }, icon('trash')) : null));
}

function createEditor(doc, host) {
  const data = doc.current;
  data.rules ||= {};
  data.options ||= {};
  const ro = doc.readOnly;
  // Older files may name the mode as playlists do ("Capture the Flag"); the server needs "CaptureTheFlag".
  if (!ro && data.mode && fileMode(data.mode) !== data.mode) data.mode = fileMode(data.mode);
  const changed = () => host.changed(doc);

  const root = h('div.editor', { class: ro ? 'read-only' : '' });
  const optionsHost = h('div');
  const scriptHost = h('div');
  const modeHost = h('span');

  // ---- header
  const nameInput = h('input.input', {
    value: data.name || '', maxLength: catalog.limits.gametype.nameMax, disabled: ro,
    oninput: () => {
      data.name = nameInput.value;
      if (data.script) data.script.name = nameInput.value;
      changed();
    },
  });

  function drawMode() {
    const modes = catalog.baseModes.map((m) => ({ value: m.json, label: m.label }));
    const known = modes.some((m) => m.value === data.mode);
    const sel = control({ type: 'enum', values: known ? modes : [...modes, { value: data.mode, label: data.mode }] }, data.mode, (v) => {
      data.mode = v;
      drawScoring();
      changed();
    }, { disabled: ro || !!data.script });
    render(modeHost, sel, data.script ? h('span.dim', { style: { marginLeft: '8px' } }, 'Scripts need Slayer') : null);
  }

  // ---- scoring: Slayer files carry all five rules (as every known Slayer file does);
  // other modes carry score to win only, and only when set.
  const scoring = h('div.form-grid', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' } });
  function drawScoring() {
    const slayer = data.mode === 'Slayer';
    if (!slayer) for (const k of SLAYER_ONLY_RULES) delete data.rules[k];
    const defs = slayer ? catalog.rules : catalog.rules.filter((r) => r.key === 'score_to_win');
    render(scoring, defs.map((def) => {
      if (slayer && data.rules[def.key] === undefined) {
        // Filling a missing rule isn't an edit of the user's.
        data.rules[def.key] = def.default;
        if (doc.saved?.rules && doc.saved.rules[def.key] === undefined) doc.saved.rules[def.key] = def.default;
      }
      const help = slayer ? def.help : 'Points, captures or kills that win a round, in this mode\'s own units. Empty = the mode\'s default. 0 = no limit.';
      return h('div.field', h('label', def.label), control(def, data.rules[def.key], (v) => {
        if (v === undefined) delete data.rules[def.key]; else data.rules[def.key] = v;
        changed();
      }, { disabled: ro }), h('div.help', help));
    }));
  }

  // ---- options (toggle on/off)
  function optionDefs() {
    const extra = Object.keys(data.options).filter((k) => optionDef(k).unknown).map(optionDef);
    return [...catalog.options, ...extra];
  }

  function drawOptions() {
    const keys = Object.keys(data.options);
    render(optionsHost,
      h('div.summary-list', keys.length === 0
        ? h('div.summary-empty', 'No game options set: everything plays as the base mode has it.')
        : keys.map((key) => {
          const def = optionDef(key);
          return summaryRow({
            label: def.label,
            group: def.unknown ? key : def.group,
            value: formatValue(def, data.options[key]),
            disabled: ro,
            onEdit: async () => {
              const r = await openSingleSetting(def, data.options[key]);
              if (r) { data.options[key] = r.value; drawOptions(); changed(); }
            },
            onDelete: () => { delete data.options[key]; drawOptions(); changed(); },
          });
        })),
      ro ? null : h('div.add-row', h('button.btn', {
        onclick: async () => {
          const next = await openSettingsPicker({
            title: 'Game options',
            intro: 'Switch on the options this game type changes. Options left off play as the base mode has them.',
            defs: optionDefs(),
            state: data.options,
            applyLabel: 'Apply',
          });
          if (next) { data.options = next; drawOptions(); changed(); }
        },
      }, icon('plus'), 'Add / change options')));
  }

  // ---- script events
  function drawScript() {
    const model = readScript(data.script);
    const rows = model.rows;
    const commit = () => {
      const script = writeScript(data.script, rows, data.name);
      if (script) data.script = script; else delete data.script;
      if (data.script && data.mode !== 'Slayer') data.mode = 'Slayer';
      drawScript();
      drawMode();
      changed();
    };

    const byEvent = catalog.script.events.map((ev) => ({ ev, rows: rows.filter((r) => r.event === ev.value) })).filter((g) => g.rows.length);
    render(scriptHost,
      model.advancedParts.length ? h('div.readonly-banner', icon('script'),
        h('span', `Advanced script logic attached (${model.advancedParts.join(', ')}). It's kept exactly as written.`)) : null,
      h('div.summary-list', rows.length === 0
        ? h('div.summary-empty', 'No script events. Add one to change players as they spawn, kill or die.')
        : byEvent.map(({ ev, rows: evRows }) => [
          h('div.summary-row', { style: { background: 'rgba(0,0,0,0.25)' } }, h('div.label.muted', ev.label), h('div'), h('div')),
          evRows.map((row) => {
            const d = describeAction(row.action);
            return summaryRow({
              label: d.condition ? `${d.label} (${d.condition})` : d.label,
              value: d.value,
              disabled: ro,
              onEdit: row.action.simple ? async () => {
                const next = await openScriptActionDialog(row);
                if (next) { Object.assign(row, next); commit(); }
              } : null,
              onDelete: async () => {
                if (!row.action.simple && !(await confirmDialog({ title: 'Remove action', message: 'This is a custom action the form can\'t edit. Remove it anyway?', confirmLabel: 'Remove', danger: true }))) return;
                rows.splice(rows.indexOf(row), 1);
                commit();
              },
            });
          }),
        ])),
      ro ? null : h('div.add-row', h('button.btn', {
        onclick: async () => {
          const next = await openScriptActionDialog(null);
          if (next) {
            // Insert after the last row of the same event, so order within events is kept.
            let at = -1;
            rows.forEach((r, i) => { if (r.event === next.event) at = i; });
            rows.splice(at < 0 ? rows.length : at + 1, 0, next);
            commit();
          }
        },
      }, icon('plus'), 'Add script event')));
  }

  render(root,
    ro ? h('div.readonly-banner', icon('info'), h('span', 'Bundled mode (read-only). The server already has it, so playlists can use it by name.'), h('span.spacer'),
      h('button.btn.small.accent', { onclick: () => collection.duplicate([{ id: doc.id, label: data.name }]) }, icon('duplicate'), 'Duplicate to edit')) : null,
    h('div.editor-content',
      h('div.editor-header',
        h('div.field', h('label', 'Name'), nameInput),
        h('div.field', h('label', 'Base mode'), modeHost)),
      h('div.section-title', 'Scoring'),
      scoring,
      h('div.section-title', 'Game options'),
      optionsHost,
      h('div.section-title', 'Script events'),
      scriptHost));

  drawMode();
  drawScoring();
  drawOptions();
  drawScript();
  return root;
}

// ---------------------------------------------------------------- script action dialog

const TRAIT_DEFS = catalog.traits.map((t) => ({
  key: t.key, label: t.label, group: 'Traits', type: 'enum',
  values: t.values.map((label, i) => ({ value: i + 1, label })),
}));

/** Resolves { event, action: { simple, op, value, condition } } or null. */
async function openScriptActionDialog(row) {
  const state = {
    event: row?.event || 'on_spawn',
    op: row?.action.op || 'scale',
    condition: row?.action.condition || 'always',
    value: row?.action.value,
  };
  const actionDef = () => ACTIONS.get(state.op);
  if (state.value === undefined) state.value = defaultValue(actionDef());

  function defaultValue(def) {
    if (def.type === 'weapon') return 'magnum';
    if (def.type === 'traits') return {};
    return def.default;
  }

  const eventHost = h('div');
  const condHost = h('div');
  const actionHost = h('div');
  const valueHost = h('div');
  let valueField;

  function draw() {
    render(eventHost, control({ type: 'enum', values: catalog.script.events }, state.event, (v) => {
      state.event = v;
      if (!conditionsFor(v).some((c) => c.value === state.condition)) state.condition = 'always';
      draw();
    }));
    render(condHost, control({ type: 'enum', values: conditionsFor(state.event) }, state.condition, (v) => { state.condition = v; }));
    render(actionHost, control({ type: 'enum', values: catalog.script.actions.map((a) => ({ value: a.op, label: a.version === 2 ? `${a.label} (script v2)` : a.label })) }, state.op, (v) => {
      state.op = v;
      state.value = defaultValue(actionDef());
      draw();
    }));
    const def = actionDef();
    if (valueField) valueField.style.gridColumn = def.type === 'traits' ? '1 / -1' : '';
    if (def.type === 'weapon') {
      render(valueHost, control({ type: 'enum', values: catalog.scriptWeapons }, state.value, (v) => { state.value = v; }));
    } else if (def.type === 'traits') {
      const traitState = state.value;
      render(valueHost, h('div', { style: { width: '100%' } }, settingGroups(TRAIT_DEFS, traitState, null, { openGroups: ['Traits'] }),
        h('div.legend', 'Traits replace any earlier traits action and stay through death until changed. Switch none on to clear all traits.')));
    } else {
      render(valueHost, control({ ...def, slider: false }, state.value, (v) => { state.value = v; }));
    }
  }

  function conditionsFor(event) {
    return CONDITIONS.filter((c) => !c.events || c.events.includes(event));
  }

  const grid = h('div.form-grid', { style: { gridTemplateColumns: '1fr 1fr' } },
    h('div.field', h('label', 'When'), eventHost),
    h('div.field', h('label', 'Only if'), condHost),
    h('div.field', h('label', 'Do'), actionHost),
    valueField = h('div.field', h('label', 'Value'), valueHost));
  draw();

  const d = openDialog({
    title: row ? 'Edit script event' : 'Add script event',
    width: 760,
    body: h('div', grid, h('div.legend', 'Kills: "When a player kills an enemy" runs for the killer. Suicides and falls run only "When a player dies".')),
    buttons: [{ label: 'Cancel', value: null }, { label: row ? 'Save' : 'Add', value: 'ok', cls: 'primary' }],
  });
  if ((await d.result) !== 'ok') return null;
  return { event: state.event, action: { simple: true, op: state.op, value: state.value, condition: state.condition } };
}

// ---------------------------------------------------------------- import

async function importFromClient() {
  const docs = settings.get().reclaimerDocsDir;
  const files = await window.api.pickFile({
    title: 'Import game types',
    defaultPath: docs ? `${docs}\\Game Modes` : undefined,
    filters: [{ name: 'Game types', extensions: ['json'] }],
    multi: true,
  });
  if (!files || !files.length) return;
  try {
    const ids = await window.api.workspace.import('gametypes', files);
    await collection.reload();
    collection.browser.select(ids);
    toast.success(`Imported ${ids.length} game type${ids.length === 1 ? '' : 's'}`);
  } catch (err) {
    toast.error(`Import failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------- tab

export default {
  id: 'gametypes',
  label: 'Game Types',
  fill: true,
  mount(pane) {
    collection = createCollectionTab({
      kind: 'gametypes',
      title: 'Game Types',
      newLabel: 'Game type',
      group: (item) => (item.readOnly ? { id: 'bundled', label: 'Bundled (read-only)', order: 1 } : { id: 'mine', label: 'My game types', order: 0 }),
      describe: (item) => {
        const mode = findBaseMode(item.mode)?.label || item.mode || '';
        return { meta: item.scripted ? `${mode} · script` : mode };
      },
      blank,
      createEditor,
      validate: validateGametype,
      extraButtons: [{ icon: 'export', title: 'Import game types (.json) from the client or elsewhere', onClick: importFromClient }],
    });
    pane.append(collection.el);
    collection.reload();
  },
  show() { collection?.reload(); },
  unsavedCount: () => collection?.unsavedCount() || 0,
  unsavedDocs: () => collection?.unsavedDocs() || [],
  saveActive: () => collection?.saveActive(),
  saveDoc: (doc) => collection.saveDoc(doc),
};

export { ruleDef };
