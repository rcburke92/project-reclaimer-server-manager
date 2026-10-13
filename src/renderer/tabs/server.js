// Server tab: dedicated.toml as forms, and the Pterodactyl egg's
// reserved-slots.toml in a second document. Every setting is a toggle row: on
// writes the key, off leaves it out so the default (or [defaults]) applies.
import { h, render, clone } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { catalog } from '../lib/catalog.js';
import { settingRow, control } from '../lib/settings-form.js';
import { confirmDialog } from '../lib/dialog.js';
import { toast } from '../lib/toast.js';
import { events } from '../lib/events.js';
import { createDocumentHost } from '../components/document-host.js';
import { loadMapSources, allMaps } from '../lib/maps.js';
import { loadGametypeRefs, gametypeChoices } from '../lib/gametype-refs.js';
import { validateReservedSlots, firstServerMaxPlayers } from '../lib/reserved-slots.js';

const S = catalog.server;
const RS = catalog.reservedSlots;
const LIM = catalog.limits.server;
const SERVER_REQUIRED = ['name', 'port'];
const PLAYS = [
  { value: 'default', label: 'Default' },
  { value: 'playlist', label: 'Playlist' },
  { value: 'map', label: 'Map + game' },
  { value: 'variant', label: 'Variant' },
];

let pane;
let host = null;
let fileInfo = null;
let reservedInfo = null;
let updateReservedSummary = null;
let playlists = [];
let gametypes = [];
const bodyHost = h('div.server-body');

// ---------------------------------------------------------------- validation

export function validateServerConfig(data) {
  const issues = [];
  const servers = Array.isArray(data.server) ? data.server : [];
  if (!servers.length) issues.push({ level: 'warning', text: 'No [[server]] blocks: nothing will run' });
  const names = new Map();
  const ports = new Map();
  servers.forEach((s, i) => {
    const label = s.name || `Server ${i + 1}`;
    if (!s.name) issues.push({ level: 'error', text: `Server ${i + 1}: name is required` });
    else if (s.name.length > LIM.nameMax) issues.push({ level: 'error', text: `${label}: name is over ${LIM.nameMax} characters` });
    if (s.name) {
      const k = s.name.toLowerCase();
      if (names.has(k)) issues.push({ level: 'error', text: `Two servers are named "${s.name}"` });
      names.set(k, i);
    }
    if (!Number.isInteger(s.port)) issues.push({ level: 'error', text: `${label}: port is required` });
    else {
      if (s.port < LIM.portRange[0] || s.port > LIM.portRange[1]) issues.push({ level: 'error', text: `${label}: port must be ${LIM.portRange[0]}–${LIM.portRange[1]}` });
      if (ports.has(s.port)) issues.push({ level: 'error', text: `Two servers use port ${s.port}` });
      ports.set(s.port, i);
    }
    const plays = ['playlist', 'map', 'variant'].filter((k) => s[k]);
    if (plays.length > 1) issues.push({ level: 'error', text: `${label}: choose only one of playlist, map + game or variant` });
    if (s.map && !s.game) issues.push({ level: 'error', text: `${label}: a map needs a game type` });
    if (s.rcon_password && (s.rcon_password.length < LIM.rconPassword[0] || s.rcon_password.length > LIM.rconPassword[1])) {
      issues.push({ level: 'error', text: `${label}: RCON password must be ${LIM.rconPassword[0]}–${LIM.rconPassword[1]} characters` });
    }
    if (s.playlist && !playlists.some((p) => `playlists/${p.file}`.toLowerCase() === String(s.playlist).toLowerCase())) {
      issues.push({ level: 'warning', text: `${label}: playlist "${s.playlist}" isn't in the workspace` });
    }
  });
  const rp = data.rcon?.password;
  if (rp && (rp.length < LIM.rconPassword[0] || rp.length > LIM.rconPassword[1])) issues.push({ level: 'error', text: `RCON password must be ${LIM.rconPassword[0]}–${LIM.rconPassword[1]} characters` });
  const items = data.workshop?.items || [];
  if (items.length > LIM.maxWorkshopItems) issues.push({ level: 'error', text: `At most ${LIM.maxWorkshopItems} Workshop items` });
  return issues;
}

// ---------------------------------------------------------------- editor pieces

/**
 * Rows over `obj` for `fields`. Not overridden = key left out of the file, and the
 * row shows what applies instead: baseFor(def) if given, else the documented default.
 */
function toggleRows(fields, obj, onChange, baseFor = (def) => def.default) {
  return fields.map((def) => settingRow(def, {
    enabled: Object.prototype.hasOwnProperty.call(obj, def.key),
    value: obj[def.key],
    base: baseFor(def),
    baseKnown: baseFor(def) !== undefined,
    onChange: ({ enabled, value }) => {
      if (enabled) obj[def.key] = value; else delete obj[def.key];
      onChange();
    },
  }));
}

function sectionCard(title, body, { open = true, note } = {}) {
  return h('details.panel.card.server-section', { open },
    h('summary.panel-header', title, note ? h('span.dim', { style: { marginLeft: 'auto', textTransform: 'none', letterSpacing: '0' } }, note) : null),
    h('div.panel-body.flush', body));
}

function playsOf(s) {
  if (s.playlist) return 'playlist';
  if (s.map || s.game) return 'map';
  if (s.variant) return 'variant';
  return 'default';
}

function playsSummary(s) {
  if (s.playlist) return `Playlist: ${playlists.find((p) => `playlists/${p.file}` === s.playlist)?.name || s.playlist}`;
  if (s.map) return `${s.map} · ${s.game || '?'}`;
  if (s.variant) return `Variant: ${s.variant.replace(/^content\/Game Modes\//i, '')}`;
  return 'Slayer on Guardian (no playlist, map or variant set)';
}

function selectWithGroups(choices, value, onChange, { placeholder } = {}) {
  const groups = [...new Set(choices.map((c) => c.group || ''))];
  const sel = h('select.select', { style: { minWidth: '280px' }, onchange: () => onChange(sel.value) },
    placeholder ? h('option', { value: '', selected: !value, disabled: true }, placeholder) : null,
    groups.map((g) => {
      const opts = choices.filter((c) => (c.group || '') === g).map((c) => h('option', { value: c.value, selected: String(c.value).toLowerCase() === String(value || '').toLowerCase() }, c.label));
      return g ? h('optgroup', { label: g }, opts) : opts;
    }));
  if (value && !choices.some((c) => String(c.value).toLowerCase() === String(value).toLowerCase())) {
    sel.prepend(h('option', { value, selected: true }, `${value} (not in workspace)`));
  }
  return sel;
}

function serverCard(data, s, index, redraw, docChanged) {
  // Every change also refreshes the card's one-line summary.
  const changed = () => { updateHead(); docChanged(); };
  const otherFields = S.serverFields.filter((f) => !SERVER_REQUIRED.includes(f.key));
  const playsHost = h('div.plays');
  const head = h('span.server-head-text');
  const updateHead = () => render(head, h('strong', s.name || `Server ${index + 1}`), h('span.dim', ` · UDP ${s.port ?? '?'} · ${playsSummary(s)}`),
    s.enabled === false ? h('span.pill.warning', { style: { marginLeft: '8px' } }, 'Disabled') : null);

  function setPlays(kind) {
    for (const k of S.playsKeys) delete s[k];
    if (kind === 'playlist' && playlists[0]) s.playlist = `playlists/${playlists[0].file}`;
    if (kind === 'map') { s.map = 'Guardian'; s.game = 'Slayer'; }
    if (kind === 'variant' && gametypes[0]) s.variant = `content/Game Modes/${gametypes[0].file}`;
    drawPlays();
    changed();
  }

  function drawPlays() {
    const kind = playsOf(s);
    const seg = h('div.segmented', PLAYS.map((p) => h('button', { class: p.value === kind ? 'active' : '', onclick: () => setPlays(p.value) }, p.label)));
    let picker = null;
    if (kind === 'playlist') {
      picker = playlists.length
        ? selectWithGroups(playlists.map((p) => ({ value: `playlists/${p.file}`, label: p.name })), s.playlist, (v) => { s.playlist = v; changed(); })
        : h('span.muted', 'No playlists in the workspace yet (Playlists tab).');
    } else if (kind === 'map') {
      const maps = allMaps().map((m) => ({ value: m.ref, label: m.kind === 'stock' ? m.name : `${m.name} (${m.sub})`, group: m.kind === 'stock' ? 'Stock maps' : m.kind === 'mod' ? 'Mod maps' : 'Saved maps' }));
      picker = h('div.plays-pickers',
        h('div.field', h('label', 'Map'), selectWithGroups(maps, s.map, (v) => { s.map = v; changed(); })),
        h('div.field', h('label', 'Game type'), selectWithGroups(gametypeChoices(), s.game, (v) => { s.game = v; changed(); })));
    } else if (kind === 'variant') {
      picker = gametypes.length
        ? selectWithGroups(gametypes.map((g) => ({ value: `content/Game Modes/${g.file}`, label: g.name })), s.variant, (v) => { s.variant = v; changed(); })
        : h('span.muted', 'No game types in the workspace yet (Game Types tab).');
    } else {
      picker = h('span.muted', '[defaults] decides, or Slayer on Guardian.');
    }
    render(playsHost, seg, picker);
  }

  const nameInput = h('input.input', { value: s.name || '', maxLength: LIM.nameMax, oninput: () => { s.name = nameInput.value; changed(); } });
  const portDef = S.serverFields.find((f) => f.key === 'port');
  const port = control(portDef, s.port, (v) => { s.port = v; changed(); });

  drawPlays();
  updateHead();
  const onChange = changed;

  return h('details.panel.card.server-card', { open: data.server.length <= 2 },
    h('summary.panel-header', head, h('span.spacer'),
      h('button.icon-btn.small', { title: 'Duplicate server', onclick: (e) => { e.preventDefault(); duplicateServer(data, index, redraw, docChanged); } }, icon('duplicate')),
      h('button.icon-btn.small.danger', { title: 'Delete server', onclick: (e) => { e.preventDefault(); deleteServer(data, index, redraw, docChanged); } }, icon('trash'))),
    h('div.panel-body',
      index === 0 ? h('div.readonly-banner', icon('info'), h('span', 'On Pterodactyl, the egg\'s "Sync Port" setting rewrites this first server\'s port to your allocation on every start.')) : null,
      h('div.editor-header',
        h('div.field', h('label', 'Name'), nameInput),
        h('div.field', h('label', 'UDP port'), port)),
      h('div.field', h('label', 'What it plays'), playsHost),
      h('div.section-title', 'Settings for this server', h('span.dim', '(off = use [defaults])')),
      h('div.flush', toggleRows(otherFields, s, onChange, (def) => (data.defaults && def.key in data.defaults ? data.defaults[def.key] : def.default)))));
}

function duplicateServer(data, i, redraw, changed) {
  const copy = clone(data.server[i]);
  copy.name = `${copy.name || 'Server'} copy`.slice(0, LIM.nameMax);
  const used = new Set(data.server.map((x) => x.port));
  let p = (copy.port || 49176) + 1;
  while (used.has(p)) p++;
  copy.port = p;
  data.server.splice(i + 1, 0, copy);
  redraw();
  changed();
}

async function deleteServer(data, i, redraw, changed) {
  const s = data.server[i];
  if (!(await confirmDialog({ title: 'Delete server', message: `Remove "${s.name || `Server ${i + 1}`}" from dedicated.toml?`, confirmLabel: 'Delete', danger: true }))) return;
  data.server.splice(i, 1);
  redraw();
  changed();
}

function createEditor(doc, docHost) {
  const data = doc.current;
  data.server ||= [];
  const changed = () => docHost.changed(doc);
  const root = h('div.editor');

  function sectionObj(sec) {
    if (!sec.table) return data;
    data[sec.table] ||= {};
    return data[sec.table];
  }

  function tidy() {
    // Drop tables that ended up empty so they aren't written as bare headers.
    for (const sec of S.sections) if (sec.table && data[sec.table] && !Object.keys(data[sec.table]).length) delete data[sec.table];
    if (data.defaults && !Object.keys(data.defaults).length) delete data.defaults;
  }
  const onChange = () => { tidy(); changed(); };

  function draw() {
    const defaultsObj = (data.defaults ||= {});
    const defaultFields = S.serverFields.filter((f) => !f.perServerOnly);
    render(root,
      h('div.readonly-banner', icon('info'),
        h('span', 'Egg variables filled in on the Pterodactyl panel (Host Name, Server Password, Max Players, Admins, RCON, Anti-Cheat, Block VPNs, Hidden, Auto Update, Public Address) override these settings. Leave them empty in the panel to use this file.')),
      h('div.section-title', 'Servers', h('span.dim', `(${data.server.length})`)),
      data.server.map((s, i) => serverCard(data, s, i, draw, changed)),
      h('div.add-row', h('button.btn.primary', {
        onclick: () => {
          const used = new Set(data.server.map((x) => x.port));
          let port = 49176;
          while (used.has(port)) port++;
          data.server.push({ name: `Halo 3 ${data.server.length + 1}`, port });
          draw();
          changed();
        },
      }, icon('plus'), 'Add server')),
      h('div.section-title', 'Shared settings'),
      S.sections.filter((sec) => !sec.advanced).map((sec) => sectionCard(sec.title, toggleRows(sec.fields, sectionObj(sec), onChange), { open: sec.id === 'general' })),
      sectionCard('Defaults for every server [defaults]', toggleRows(defaultFields, defaultsObj, onChange), { open: true, note: 'A server\'s own setting wins' }),
      S.sections.filter((sec) => sec.advanced).map((sec) => sectionCard(sec.title, toggleRows(sec.fields, sectionObj(sec), onChange), { open: false })));
    tidy();
  }

  draw();
  return root;
}

// ---------------------------------------------------------------- reserved-slots.toml

function createReservedEditor(doc, docHost) {
  const data = doc.current;
  const summary = h('span');
  updateReservedSummary = () => {
    const dedicated = host?.find('dedicated')?.current;
    const max = firstServerMaxPlayers(dedicated);
    const slots = data.slots ?? 0;
    summary.textContent = slots > 0
      ? `${dedicated?.server?.[0]?.name || 'First server'}: ${Math.max(0, max - slots)} public + ${slots} reserved = ${max} max players`
      : 'Off';
  };
  updateReservedSummary();
  const onChange = () => { updateReservedSummary(); docHost.changed(doc); };
  return h('div.editor',
    h('div.readonly-banner', icon('info'),
      h('span', 'For the Pterodactyl egg, which keeps these slots free over RCON on the first [[server]]. Raise that server\'s max players by the number of reserved slots. Egg variables filled in on the panel (Reserved Slots, Reserved Password, Reserved Bumping, Bump Order) override this file, and Reserved Whitelist adds to it.')),
    sectionCard('Reserved slots', toggleRows(RS.fields, data, onChange), { open: true, note: summary }));
}

// ---------------------------------------------------------------- tab


async function load() {
  await Promise.all([loadMapSources(), loadGametypeRefs()]);
  try {
    [playlists, gametypes] = await Promise.all([
      window.api.workspace.list('playlists'),
      window.api.workspace.list('gametypes').then((l) => l.filter((g) => !g.readOnly)),
    ]);
  } catch { playlists = []; gametypes = []; }
  [fileInfo, reservedInfo] = await Promise.all([window.api.server.read(), window.api.reservedSlots.read()]);
  if (reservedInfo.error) toast.error(reservedInfo.error);
  draw();
}

function draw() {
  if (!fileInfo) return;
  const toolbar = h('div.server-toolbar',
    h('h2', 'Server ', h('span.dim', 'dedicated.toml')),
    h('span.spacer'),
    h('button.btn.small', { onclick: importFile, title: 'Replace the workspace dedicated.toml with one from your server (download it from the Pterodactyl File Manager first)' }, icon('export'), 'Import dedicated.toml…'),
    fileInfo.exists ? h('button.btn.small', { onclick: () => window.api.showItem(fileInfo.file) }, icon('folder'), 'Show file') : null);

  if (!fileInfo.exists || fileInfo.error) {
    host = null;
    render(bodyHost, toolbar, h('div.panel.card', h('div.empty-state',
      h('p', fileInfo.error || 'There is no dedicated.toml in the workspace yet.'),
      h('p.muted', 'Import the one your server made (Pterodactyl File Manager → download dedicated.toml), or start from a small default.'),
      h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center' } },
        h('button.btn.primary', { onclick: importFile }, icon('export'), 'Import from file…'),
        h('button.btn', { onclick: createDefault }, icon('plus'), fileInfo.error ? 'Replace with default' : 'Create default')))));
    events.emit('status');
    return;
  }

  if (!host) {
    host = createDocumentHost({
      emptyText: '',
      createEditor: (doc, docHost) => (doc.id === 'reserved' ? createReservedEditor(doc, docHost) : createEditor(doc, docHost)),
      validate: (data, doc) => (doc.id === 'reserved' ? validateReservedSlots(data, host.find('dedicated')?.current) : validateServerConfig(data)),
      save: async (doc) => {
        if (doc.id === 'reserved') { reservedInfo = await window.api.reservedSlots.write(doc.current); return 'reserved'; }
        fileInfo = await window.api.server.write(doc.current);
        return 'dedicated';
      },
      onChange: () => { updateReservedSummary?.(); events.emit('status'); },
    });
  } else {
    // Pick up changes made outside the app, in documents without unsaved edits.
    const dirty = host.dirtyDocs();
    for (const [id, data] of [['dedicated', fileInfo.data], ['reserved', reservedInfo?.data]]) {
      const doc = host.find(id);
      if (doc && data && !dirty.includes(doc)) { doc.saved = clone(data); doc.current = clone(data); host.rebuild(doc); }
    }
  }
  openDocs();
  render(bodyHost, toolbar, host.el);
}

/** Opens both documents (again, if one was closed), keeping the active one in front. */
function openDocs() {
  const activeId = host.active()?.id;
  if (!host.find('dedicated')) host.open({ id: 'dedicated', title: 'dedicated.toml', data: fileInfo.data });
  if (!host.find('reserved') && reservedInfo?.data) host.open({ id: 'reserved', title: 'reserved-slots.toml', data: reservedInfo.data });
  host.open({ id: activeId || 'dedicated' });
}

async function importFile() {
  if (host?.dirtyDocs().length && !(await confirmDialog({ title: 'Discard changes?', message: 'Importing replaces dedicated.toml and your unsaved changes.', confirmLabel: 'Import', danger: true }))) return;
  const f = await window.api.pickFile({ title: 'Import dedicated.toml', filters: [{ name: 'TOML', extensions: ['toml'] }] });
  if (!f) return;
  try {
    if (fileInfo.exists && !fileInfo.error && !(await confirmDialog({ title: 'Replace dedicated.toml', message: 'Replace the workspace dedicated.toml with this file?', confirmLabel: 'Replace', danger: true }))) return;
    fileInfo = await window.api.server.import(f);
    host = null;
    draw();
    toast.success('Imported dedicated.toml');
  } catch (err) {
    toast.error(`Import failed: ${err.message}`);
  }
}

async function createDefault() {
  fileInfo = await window.api.server.createDefault();
  host = null;
  draw();
}

export default {
  id: 'server',
  label: 'Server',
  fill: true,
  mount(el) {
    pane = el;
    el.append(bodyHost);
  },
  show() { load(); },
  unsavedCount: () => host?.dirtyDocs().length || 0,
  unsavedDocs: () => host?.dirtyDocs() || [],
  saveActive: () => { const d = host?.active(); if (d) host.save(d); },
  saveDoc: (doc) => host.save(doc),
};
