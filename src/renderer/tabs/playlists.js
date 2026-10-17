// Playlists tab: object browser of *.playlist.json files + form editor.
import { h, render, clone } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { catalog, optionDef, optionApplies, optionsForMode, ruleDef, findBaseMode } from '../lib/catalog.js';
import { control, formatValue, settingGroups } from '../lib/settings-form.js';
import { openDialog } from '../lib/dialog.js';
import { toast } from '../lib/toast.js';
import { events } from '../lib/events.js';
import { settings } from '../lib/settings.js';
import { createCollectionTab } from '../components/collection-tab.js';
import { modsStore } from '../lib/mods-store.js';
import { loadMapSources, allMaps, describeMap, mapThumb } from '../lib/maps.js';
import { loadGametypeRefs, gametypeChoices, describeGametype, gametypeBase } from '../lib/gametype-refs.js';

const LIMITS = catalog.limits.playlist;
let collection;

function blank(name) {
  return { version: catalog.playlist.version, name, vote_seconds: 20, games: [] };
}

// ---------------------------------------------------------------- option values

/** File value -> catalog value (labels are accepted, ignoring case). mode: the entry's base mode. */
function optionFromFile(key, raw, mode) {
  const def = optionDef(key, mode);
  if (typeof raw === 'string' && Array.isArray(def.values)) {
    const v = def.values.find((x) => x.label.toLowerCase() === raw.toLowerCase());
    return v ? v.value : raw;
  }
  return raw;
}

/** Catalog value -> what the playlist file stores (labels for weapon options). */
function optionToFile(key, value, mode) {
  const def = optionDef(key, mode);
  if (def.playlistFormat === 'label' && Array.isArray(def.values)) {
    const v = def.values.find((x) => x.value === value);
    if (v) return v.label;
  }
  return value;
}

// ---------------------------------------------------------------- analysis

function canonicalEntry(e) {
  const mode = describeGametype(e.game).mode;
  const opts = {};
  for (const [k, v] of Object.entries(e.options || {})) opts[k] = optionFromFile(k, v, mode);
  const sort = (o) => Object.keys(o || {}).sort().map((k) => [k, o[k]]);
  return JSON.stringify([
    describeMap(e.map).key,
    String(e.base_map || '').toLowerCase(),
    describeGametype(e.game).name.toLowerCase(),
    sort(e.rules),
    sort(opts),
    sort(e.world),
  ]);
}

export function analyzePlaylist(data) {
  const games = data.games || [];
  const seen = new Map();
  const duplicates = new Set();
  games.forEach((e, i) => {
    const k = canonicalEntry(e);
    if (seen.has(k)) { duplicates.add(i); duplicates.add(seen.get(k)); } else seen.set(k, i);
  });
  const modMaps = new Set();
  const modIds = new Set();
  for (const e of games) {
    for (const ref of [e.map, e.base_map]) {
      const d = describeMap(ref);
      if (d.kind === 'mod') { modMaps.add(d.key); modIds.add(d.modId); }
    }
  }
  return { count: games.length, duplicates, modMaps: modMaps.size, mods: modIds.size, modIds: [...modIds] };
}

export function validatePlaylist(data) {
  const issues = [];
  const name = (data.name || '').trim();
  if (!name) issues.push({ level: 'error', text: 'Name is required' });
  const a = analyzePlaylist(data);
  if (a.count < LIMITS.minGames) issues.push({ level: 'error', text: `Needs at least ${LIMITS.minGames} entries (has ${a.count})` });
  if (a.count > LIMITS.maxGames) issues.push({ level: 'error', text: `At most ${LIMITS.maxGames} entries (has ${a.count})` });
  if (a.duplicates.size) issues.push({ level: 'error', text: 'Duplicate entries: change one, or raise its weight instead' });
  if (a.modMaps > LIMITS.maxModMaps) issues.push({ level: 'error', text: `At most ${LIMITS.maxModMaps} mod maps (has ${a.modMaps})` });
  if (a.mods > LIMITS.maxMods) issues.push({ level: 'error', text: `Mod maps from at most ${LIMITS.maxMods} mods (has ${a.mods})` });
  (data.games || []).forEach((e, i) => {
    if (!e.map) issues.push({ level: 'error', text: `Entry ${i + 1} has no map` });
    if (!e.game) issues.push({ level: 'error', text: `Entry ${i + 1} has no game type` });
    const g = describeGametype(e.game);
    if (e.game && !g.known) issues.push({ level: 'warning', text: `Entry ${i + 1}: game type "${e.game}" isn't in the workspace` });
    const m = describeMap(e.map);
    if (e.map && !m.known) issues.push({ level: 'warning', text: `Entry ${i + 1}: map "${e.map}" isn't installed here` });
    // The server refuses options the entry's base mode doesn't have, and values it doesn't take.
    for (const [k, v] of Object.entries(e.options || {})) {
      const def = optionDef(k, g.mode);
      if (def.unknown) continue;
      if (!optionApplies(k, g.mode)) {
        issues.push({ level: 'error', text: `Entry ${i + 1}: ${def.label} (${k}) isn't a ${findBaseMode(g.mode)?.label || g.mode} option` });
        continue;
      }
      if (Array.isArray(def.values)) {
        const known = typeof v === 'string'
          ? def.values.some((x) => x.label.toLowerCase() === v.toLowerCase())
          : def.values.some((x) => x.value === v);
        if (!known) issues.push({ level: 'error', text: `Entry ${i + 1}: ${def.label} has no choice "${v}"` });
      } else if (def.type === 'int' && (typeof v !== 'number' || v < def.min || v > def.max)) {
        issues.push({ level: 'error', text: `Entry ${i + 1}: ${def.label} must be ${def.min} to ${def.max}` });
      }
    }
    if (e.preview_image && /[\\/]/.test(e.preview_image)) issues.push({ level: 'error', text: `Entry ${i + 1}: the vote image must be a file name in content/Images, not a path` });
  });
  const images = new Set((data.games || []).map((e) => String(e.preview_image || '').toLowerCase()).filter(Boolean));
  if (images.size > LIMITS.maxImages) issues.push({ level: 'error', text: `At most ${LIMITS.maxImages} different vote images (has ${images.size})` });
  return issues;
}

function entrySummary(e) {
  const mode = describeGametype(e.game).mode;
  const parts = [];
  for (const [k, v] of Object.entries(e.rules || {})) parts.push(`${ruleDef(k)?.label || k} ${v}`);
  for (const [k, v] of Object.entries(e.options || {})) {
    const def = optionDef(k, mode);
    parts.push(`${def.label}: ${formatValue(def, optionFromFile(k, v, mode))}`);
  }
  for (const [k, v] of Object.entries(e.world || {})) {
    const def = WORLD_DEFS.find((d) => d.worldKey === k);
    parts.push(def ? `${def.label}: ${formatValue(def, v)}` : `${k}: ${v}`);
  }
  if (e.anti_cheat === false) parts.push('Anti-cheat off');
  if (e.voice_team_only === true) parts.push('Team voice only');
  if (e.preview_image) parts.push(`Vote image ${e.preview_image}`);
  if (e.base_map) parts.push(`Base map ${describeMap(e.base_map).name}`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------- editor

function createEditor(doc, host) {
  const data = doc.current;
  data.games ||= [];
  const ro = doc.readOnly;
  const selected = new Set();
  const changed = () => host.changed(doc);

  const limitsHost = h('div.limits');
  const listHost = h('div.entry-list');
  const removeBtn = h('button.btn.small.danger', { onclick: removeSelected }, icon('trash'), 'Remove selected');

  const nameInput = h('input.input', {
    value: data.name || '', maxLength: 48, disabled: ro,
    oninput: () => { data.name = nameInput.value; changed(); },
  });
  if (data.vote_seconds === undefined) data.vote_seconds = 20;
  const voteDef = catalog.playlist.header.find((d) => d.key === 'vote_seconds');
  const vote = control(voteDef, data.vote_seconds, (v) => { data.vote_seconds = v; changed(); }, { disabled: ro });

  function drawLimits() {
    const a = analyzePlaylist(data);
    const badge = (ok, text, title) => h('span.pill', { class: ok ? 'success' : 'danger', title }, text);
    render(limitsHost,
      badge(a.count >= LIMITS.minGames && a.count <= LIMITS.maxGames, `${a.count} entries (${LIMITS.minGames}–${LIMITS.maxGames})`, 'Ballots draw three entries at random by weight'),
      badge(a.modMaps <= LIMITS.maxModMaps, `${a.modMaps}/${LIMITS.maxModMaps} mod maps`),
      badge(a.mods <= LIMITS.maxMods, `${a.mods}/${LIMITS.maxMods} mods`),
      badge(a.duplicates.size === 0, a.duplicates.size ? `${a.duplicates.size} duplicates` : 'No duplicates', 'A game may not repeat another; changed rules or options make a different game'));
    return a;
  }

  function drawList() {
    const a = drawLimits();
    const total = data.games.reduce((n, e) => n + (e.weight || 1), 0);
    for (const i of [...selected]) if (i >= data.games.length) selected.delete(i);
    removeBtn.disabled = ro || selected.size === 0;
    render(listHost,
      h('div.entry-row.entry-head', h('span'), h('span'), h('span', 'Map'), h('span', 'Game type'), h('span', { style: { textAlign: 'center' } }, 'Weight'), h('span', 'Settings'), h('span')),
      data.games.length === 0 ? h('div.summary-empty', 'No entries yet. Add at least three.') : data.games.map((e, i) => {
        const m = describeMap(e.map);
        const g = describeGametype(e.game);
        const share = total ? Math.round(((e.weight || 1) / total) * 100) : 0;
        const box = h('input', { type: 'checkbox', checked: selected.has(i), disabled: ro, onchange: () => { if (box.checked) selected.add(i); else selected.delete(i); drawList(); } });
        return h('div.entry-row', { class: [selected.has(i) ? 'selected' : '', a.duplicates.has(i) ? 'duplicate' : ''].join(' '), ondblclick: () => !ro && editEntry(i) },
          box,
          mapThumb(m),
          h('div', h('div.title', e.name || m.name), h('div.sub', e.name ? `${m.name} · ${m.sub}` : m.sub, m.known ? '' : ' (not found)')),
          h('div', h('div', g.name), h('div.sub', g.kind === 'mine' ? 'My game type' : g.kind === 'bundled' ? 'Bundled mode' : g.kind === 'base' ? 'Base mode' : 'Not found')),
          h('div.weight', String(e.weight || 1), h('div.sub', `${share}%`)),
          h('div.summary', entrySummary(e) || h('span.dim', 'Game type defaults')),
          h('div.actions',
            h('button.icon-btn.small', { title: 'Edit', disabled: ro, onclick: () => editEntry(i) }, icon('edit')),
            h('button.icon-btn.small', { title: 'Duplicate (then change something)', disabled: ro, onclick: () => duplicateEntry(i) }, icon('duplicate')),
            h('button.icon-btn.small.danger', { title: 'Remove', disabled: ro, onclick: () => { data.games.splice(i, 1); selected.clear(); drawList(); changed(); } }, icon('trash'))));
      }));
  }

  async function editEntry(i) {
    const next = await openEntryDialog(data.games[i], data);
    if (next) { data.games[i] = next; drawList(); changed(); }
  }

  async function addEntry() {
    const next = await openEntryDialog(null, data);
    if (next) { data.games.push(next); drawList(); changed(); }
  }

  async function duplicateEntry(i) {
    const copy = clone(data.games[i]);
    const next = await openEntryDialog(copy, data, { title: 'Duplicate entry' });
    if (next) { data.games.splice(i + 1, 0, next); drawList(); changed(); }
  }

  function removeSelected() {
    data.games = data.games.filter((_, i) => !selected.has(i));
    selected.clear();
    drawList();
    changed();
  }

  const root = h('div.editor',
    h('div.editor-content',
      h('div.editor-header',
        h('div.field', h('label', 'Playlist name'), nameInput),
        h('div.field', h('label', 'Vote time'), vote)),
      h('div.section-title', 'Entries'),
      limitsHost,
      h('div.entry-toolbar',
        ro ? null : h('button.btn.primary', { onclick: addEntry }, icon('plus'), 'Add entry'),
        h('span.spacer'),
        ro ? null : removeBtn),
      listHost));
  // Redraw when mods or game types change; stop listening once this editor is replaced or closed.
  const off = [];
  const redraw = () => {
    if (root.isConnected) drawList();
    else if (doc.editorEl !== root) off.forEach((f) => f());
  };
  off.push(events.on('mods:updated', redraw), events.on('workspace:changed', redraw));
  drawList();
  return root;
}

// ---------------------------------------------------------------- entry dialog

const ENTRY_DEFS = catalog.playlist.entry.map((d) => ({ ...d, key: `entry.${d.key}` }));
const WORLD_DEFS = catalog.playlist.world.map((d) => ({ ...d, key: `world.${d.key}`, worldKey: d.key, group: 'World' }));
const RULE_DEFS = catalog.rules.map((d) => ({ ...d, key: `rules.${d.key}`, group: 'Scoring rules' }));
// What a playlist game plays with when its entry leaves a field out.
const ENTRY_BASES = { 'entry.name': '', 'entry.weight': 1, 'entry.preview_image': '', 'world.sprint': 'off', 'world.sprint_speed_percent': 150, 'world.sprint_stamina_seconds': 5 };

/** The base mode's options, plus any the entry sets that the mode doesn't know (kept visible). */
function optionDefsFor(entry, mode) {
  const defs = optionsForMode(mode);
  const known = defs.map((d) => ({ ...d, key: `options.${d.key}`, optionKey: d.key }));
  const extra = Object.keys(entry?.options || {}).filter((k) => !defs.some((d) => d.key === k))
    .map((k) => ({ ...optionDef(k, mode), key: `options.${k}`, optionKey: k }));
  return [...known, ...extra];
}

function entryToState(e) {
  const s = {};
  if (!e) return s;
  const mode = describeGametype(e.game).mode;
  if (e.name) s['entry.name'] = e.name;
  if (e.weight !== undefined && e.weight !== 1) s['entry.weight'] = e.weight;
  if (e.preview_image) s['entry.preview_image'] = e.preview_image;
  if (e.anti_cheat === false) s['entry.anti_cheat'] = false;
  if (e.voice_team_only === true) s['entry.voice_team_only'] = true;
  for (const [k, v] of Object.entries(e.rules || {})) s[`rules.${k}`] = v;
  for (const [k, v] of Object.entries(e.options || {})) s[`options.${k}`] = optionFromFile(k, v, mode);
  for (const [k, v] of Object.entries(e.world || {})) s[`world.${k}`] = typeof v === 'string' ? v.toLowerCase() : v;
  return s;
}

function stateToEntry(original, map, game, s) {
  const mode = describeGametype(game).mode;
  const e = clone(original || {});
  for (const k of ['map', 'game', 'name', 'weight', 'preview_image', 'anti_cheat', 'voice_team_only', 'rules', 'options', 'world']) delete e[k];
  const out = { map, game };
  if (s['entry.name']) out.name = s['entry.name'];
  if (s['entry.weight'] !== undefined && s['entry.weight'] !== 1) out.weight = s['entry.weight'];
  if (s['entry.preview_image']?.trim()) out.preview_image = s['entry.preview_image'].trim();
  const rules = {};
  const options = {};
  const world = {};
  for (const [k, v] of Object.entries(s)) {
    if (k.startsWith('rules.')) rules[k.slice(6)] = v;
    if (k.startsWith('options.')) options[k.slice(8)] = optionToFile(k.slice(8), v, mode);
    if (k.startsWith('world.')) world[k.slice(6)] = v;
  }
  if (Object.keys(rules).length) out.rules = rules;
  if (Object.keys(options).length) out.options = options;
  if (Object.keys(world).length) out.world = world;
  if ('entry.anti_cheat' in s) out.anti_cheat = false;
  if ('entry.voice_team_only' in s) out.voice_team_only = true;
  return { ...out, ...e }; // keep fields the form doesn't manage (base_map, future fields)
}

/** Resolves the new entry, or null. */
async function openEntryDialog(entry, playlist, { title } = {}) {
  await Promise.all([loadMapSources(), loadGametypeRefs()]);
  const release = modsStore.acquire();

  let mapRef = entry?.map || null;
  let game = entry?.game || 'Slayer';
  let kindFilter = 'all';
  let search = '';
  const state = entryToState(entry);

  const listEl = h('ul.list.map-list');
  const previewEl = h('div.map-preview');
  const searchInput = h('input.input', { placeholder: 'Search maps…', oninput: () => { search = searchInput.value.trim().toLowerCase(); drawMaps(); } });
  const seg = h('div.segmented', [['all', 'All'], ['stock', 'Stock'], ['mod', 'Mods'], ['forge', 'Forge']].map(([v, l]) => h('button', {
    class: v === kindFilter ? 'active' : '',
    onclick: (e) => { kindFilter = v; for (const b of seg.children) b.classList.toggle('active', b === e.currentTarget); drawMaps(); },
  }, l)));

  function drawPreview() {
    const m = mapRef ? describeMap(mapRef) : null;
    render(previewEl, m
      ? [mapThumb(m, 'large'), h('div.title', m.name), h('div.dim', m.sub)]
      : [h('div.map-thumb.large.placeholder', h('span', '?')), h('div.muted', 'Pick a map')]);
  }

  function drawMaps() {
    const maps = allMaps().filter((m) => (kindFilter === 'all' || m.kind === kindFilter)
      && (!search || m.name.toLowerCase().includes(search) || (m.sub || '').toLowerCase().includes(search)));
    const currentKey = mapRef ? describeMap(mapRef).key : null;
    render(listEl, maps.length === 0
      ? h('div.empty-state', kindFilter === 'mod' ? 'No Halo 3 mods found. Subscribe in the Mods tab, let Steam download them, then come back.' : kindFilter === 'forge' ? 'No saved maps in the workspace content/Maps folder.' : 'No maps match.')
      : maps.map((m) => h('li.list-item', {
        class: [describeMap(m.ref).key === currentKey ? 'selected' : '', m.missing ? 'missing' : ''].join(' '),
        onclick: () => { mapRef = m.ref; drawMaps(); drawPreview(); updateButtons(); },
        ondblclick: () => { mapRef = m.ref; if (canAdd()) d.close('ok'); },
      }, mapThumb(m), h('div.names', h('span', m.name), h('span.sub', m.sub)))));
    listEl.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  }

  // Game type dropdown, grouped.
  const choices = gametypeChoices();
  if (game && !choices.some((c) => c.value.toLowerCase() === game.toLowerCase())) choices.push({ value: game, label: `${game} (not found)`, group: 'Other' });
  const gameSelect = h('select.select', { style: { minWidth: '260px' }, onchange: () => { game = gameSelect.value; updateButtons(); drawSettings(); } },
    [...new Set(choices.map((c) => c.group))].map((grp) => h('optgroup', { label: grp },
      choices.filter((c) => c.group === grp).map((c) => h('option', { value: c.value, selected: c.value.toLowerCase() === String(game).toLowerCase() }, c.label)))));

  // Settings show the chosen game type's own values; changing one overrides it for this entry.
  const baseNote = h('p.muted', { style: { margin: '0 0 8px' } });
  const groupsHost = h('div');
  let drawSeq = 0;
  async function drawSettings() {
    const seq = ++drawSeq;
    const gt = await gametypeBase(game);
    if (seq !== drawSeq) return; // a newer game type was picked meanwhile
    const mode = describeGametype(game).mode;
    const bases = { ...ENTRY_BASES };
    for (const [k, v] of Object.entries(gt.rules)) bases[`rules.${k}`] = v;
    for (const [k, v] of Object.entries(gt.options)) bases[`options.${k}`] = optionFromFile(k, v, mode);
    // Overrides that now equal the game type's own value aren't changes any more, and
    // options the newly picked base mode doesn't have would only be refused by the server.
    for (const [k, v] of Object.entries(state)) {
      if (k in bases && JSON.stringify(bases[k]) === JSON.stringify(v)) delete state[k];
      else if (k.startsWith('options.') && !optionApplies(k.slice(8), mode)) delete state[k];
    }
    const open = [...groupsHost.querySelectorAll('details[open] > summary')].map((x) => x.firstChild.textContent);
    const defs = [...ENTRY_DEFS, ...WORLD_DEFS, ...RULE_DEFS, ...optionDefsFor({ options: { ...(entry?.options || {}), ...gt.options } }, mode)];
    render(groupsHost, settingGroups(defs, state, null, { openGroups: open.length ? open : ['Entry'], bases }));
    baseNote.textContent = gt.source
      ? `Defaults come from ${gt.source}. Change a value to override it for this entry only; settings marked "default" are left as the game type has them, and empty ones weren't readable, so they also play as the game type has them.`
      : 'This game type\'s own values aren\'t known here, so its settings are left empty: empty means the game type plays as it normally does. Fill one in to override it for this entry.';
  }

  const settingsPane = h('div.settings-pane',
    h('div.field', { style: { marginBottom: '12px' } }, h('label', 'Game type (required)'), gameSelect),
    baseNote,
    groupsHost);
  drawSettings();

  const body = h('div.entry-dialog',
    h('div.map-pane', previewEl, h('div.map-filter-row', seg), h('div.map-filter-row', searchInput), listEl),
    settingsPane);

  const canAdd = () => !!mapRef && !!game;
  const updateButtons = () => d.setButtonDisabled('ok', !canAdd());

  const d = openDialog({
    title: title || (entry ? 'Edit playlist entry' : 'Add playlist entry'),
    width: Math.min(1180, window.innerWidth - 60),
    height: Math.min(820, window.innerHeight - 60),
    body,
    buttons: [{ label: 'Cancel', value: null }, { label: entry && !title ? 'Save' : 'Add', value: 'ok', cls: 'primary', disabled: !mapRef }],
  });
  d.el.classList.add('entry-dialog-host');
  const offMods = events.on('mods:updated', () => drawMaps());
  drawPreview();
  drawMaps();

  const result = await d.result;
  offMods();
  release();
  if (result !== 'ok') return null;
  return stateToEntry(entry, mapRef, game, state);
}

// ---------------------------------------------------------------- import

async function importPlaylists() {
  const docs = settings.get().reclaimerDocsDir;
  const files = await window.api.pickFile({
    title: 'Import playlists',
    defaultPath: docs ? `${docs}\\Playlists` : undefined,
    filters: [{ name: 'Playlists', extensions: ['json'] }],
    multi: true,
  });
  if (!files || !files.length) return;
  try {
    const ids = await window.api.workspace.import('playlists', files);
    await collection.reload();
    collection.browser.select(ids);
    toast.success(`Imported ${ids.length} playlist${ids.length === 1 ? '' : 's'}`);
  } catch (err) {
    toast.error(`Import failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------- tab

export default {
  id: 'playlists',
  label: 'Playlists',
  fill: true,
  mount(pane) {
    collection = createCollectionTab({
      kind: 'playlists',
      title: 'Playlists',
      newLabel: 'Playlist',
      group: () => ({ id: 'mine', label: 'My playlists', order: 0 }),
      describe: (item) => ({ meta: item.count !== undefined ? `${item.count} games` : '' }),
      blank,
      createEditor,
      validate: validatePlaylist,
      extraButtons: [{ icon: 'export', title: 'Import playlists (.json) from the client or elsewhere', onClick: importPlaylists }],
    });
    pane.append(collection.el);
  },
  async show() {
    // Entry rows use the last mod scan; only the Add Entry dialog (which lists mods) rescans and watches.
    await Promise.all([loadMapSources(), loadGametypeRefs()]);
    await collection.reload();
    for (const doc of collection.host.docs()) collection.host.rebuild(doc);
  },
  unsavedCount: () => collection?.unsavedCount() || 0,
  unsavedDocs: () => collection?.unsavedDocs() || [],
  saveActive: () => collection?.saveActive(),
  saveDoc: (doc) => collection.saveDoc(doc),
};
