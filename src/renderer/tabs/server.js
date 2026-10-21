// Server tab: dedicated.toml as forms, and the Pterodactyl egg's
// reserved-slots.toml and next-vote.toml in documents of their own. Every setting is a toggle row: on
// writes the key, off leaves it out so the default (or [defaults]) applies.
import { h, render, clone } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { catalog } from '../lib/catalog.js';
import { settingRow, control, linesOf } from '../lib/settings-form.js';
import { confirmDialog } from '../lib/dialog.js';
import { toast } from '../lib/toast.js';
import { events } from '../lib/events.js';
import { createDocumentHost } from '../components/document-host.js';
import { loadMapSources, allMaps } from '../lib/maps.js';
import { loadGametypeRefs, gametypeChoices } from '../lib/gametype-refs.js';
import { validateReservedSlots, firstServerMaxPlayers } from '../lib/reserved-slots.js';
import { validateNextVote } from '../lib/next-vote.js';

const S = catalog.server;
const RS = catalog.reservedSlots;
const NV = catalog.nextVote;
const LIM = catalog.limits.server;
const SERVER_REQUIRED = ['name', 'port'];
const PLAYS = [
  { value: 'default', label: 'Default' },
  { value: 'playlist', label: 'Playlist' },
  { value: 'map', label: 'Map + game' },
  { value: 'variant', label: 'Variant' },
  { value: 'campaign', label: 'Campaign co-op' },
  { value: 'odst', label: 'Halo 3: ODST' },
];

let pane;
let host = null;
let fileInfo = null;
let reservedInfo = null;
let nextVoteInfo = null;
let updateReservedSummary = null;
let refreshNextVote = null;
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
    const plays = ['playlist', 'map', 'variant', 'campaign', 'odst'].filter((k) => s[k]);
    if (plays.length > 1) issues.push({ level: 'error', text: `${label}: choose only one of playlist, map + game, variant, campaign or ODST` });
    if (s.map && !s.game) issues.push({ level: 'error', text: `${label}: a map needs a game type` });
    // A server's own setting wins over [defaults]; the server checks the result.
    const eff = (k) => (k in s ? s[k] : data.defaults?.[k]);
    const maxPlayers = eff('max_players') ?? 16;
    if (s.campaign) {
      if (!s.campaign.mission) issues.push({ level: 'error', text: `${label}: a campaign server needs a mission` });
      if (maxPlayers > LIM.campaignMaxPlayers) issues.push({ level: 'error', text: `${label}: a campaign server takes at most ${LIM.campaignMaxPlayers} players (max players is ${maxPlayers})` });
      if (s.base_map || s.game) issues.push({ level: 'error', text: `${label}: a campaign server can't also have a game or base map` });
    }
    if (s.odst) {
      const o = s.odst;
      if (!o.mission) issues.push({ level: 'error', text: `${label}: an ODST server needs a mission or Firefight map` });
      else if (o.mode === 'firefight') {
        if (!S.odst.firefightMaps.some((m) => m.mission === o.mission && m.insertion === (o.insertion ?? 0))) issues.push({ level: 'error', text: `${label}: no Firefight map is mission ${o.mission}, insertion ${o.insertion ?? 0}` });
      } else {
        const m = S.odst.missions.find((x) => x.value === o.mission);
        if (!m) issues.push({ level: 'error', text: `${label}: ${o.mission} isn't an ODST campaign mission` });
        else if ((o.insertion ?? 0) > m.insertions) issues.push({ level: 'error', text: `${label}: ${m.label} starts from 0 to ${m.insertions}` });
      }
      // From 0.9.21 the server refuses these instead of ignoring them.
      if (o.mode === 'firefight' && o.modifiers) issues.push({ level: 'error', text: `${label}: Firefight takes no modifiers; use its options` });
      if (o.mode === 'firefight' && o.story_characters) issues.push({ level: 'error', text: `${label}: Firefight's players are their own troopers (story characters is campaign only)` });
      if (o.mode !== 'firefight' && o.options) issues.push({ level: 'error', text: `${label}: an ODST campaign has no Firefight options` });
      if (o.modifiers?.third_person !== undefined) issues.push({ level: 'error', text: `${label}: third person is Halo 3's only, not ODST's` });
      if (maxPlayers > LIM.campaignMaxPlayers) issues.push({ level: 'error', text: `${label}: an ODST server takes at most ${LIM.campaignMaxPlayers} players (max players is ${maxPlayers})` });
      if (s.base_map || s.game) issues.push({ level: 'error', text: `${label}: an ODST server can't also have a game or base map` });
    }
    if ((eff('min_players') ?? 1) > maxPlayers) issues.push({ level: 'error', text: `${label}: min players (${eff('min_players')}) is over max players (${maxPlayers})` });
    const welcome = linesOf(eff('welcome'));
    if (welcome.length && eff('text_chat') === false) issues.push({ level: 'error', text: `${label}: a welcome message needs text chat` });
    if (welcome.length > LIM.welcomeLines) issues.push({ level: 'error', text: `${label}: a welcome message has at most ${LIM.welcomeLines} lines` });
    if (welcome.some((l) => l.length > LIM.welcomeLineMax)) issues.push({ level: 'error', text: `${label}: welcome lines hold at most ${LIM.welcomeLineMax} characters` });
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
  if (s.campaign) return 'campaign';
  if (s.odst) return 'odst';
  if (s.playlist) return 'playlist';
  if (s.map || s.game) return 'map';
  if (s.variant) return 'variant';
  return 'default';
}

function playsSummary(s) {
  if (s.playlist) return `Playlist: ${playlists.find((p) => `playlists/${p.file}` === s.playlist)?.name || s.playlist}`;
  if (s.map) return `${s.map} · ${s.game || '?'}`;
  if (s.variant) return `Variant: ${s.variant.replace(/^content\/Game Modes\//i, '')}`;
  if (s.campaign) {
    const mission = S.campaign.fields[0].values.find((m) => m.value === s.campaign.mission);
    return `Campaign: ${mission?.label || s.campaign.mission || '?'}, ${s.campaign.difficulty || 'normal'}`;
  }
  if (s.odst) {
    const o = s.odst;
    if (o.mode === 'firefight') {
      const map = S.odst.firefightMaps.find((m) => m.mission === o.mission && m.insertion === (o.insertion ?? 0));
      const variant = S.odst.variants.find((v) => v.value === o.variant);
      return `ODST Firefight: ${map?.label || '?'}, ${variant?.label || o.variant || 'Firefight'}, ${o.difficulty || 'normal'}`;
    }
    const mission = S.odst.missions.find((m) => m.value === o.mission);
    return `ODST: ${mission?.label || o.mission || '?'}, ${o.difficulty || 'normal'}`;
  }
  return 'Slayer on Guardian (no playlist, map or variant set)';
}

function selectWithGroups(choices, value, onChange, { placeholder, missing = 'not in workspace' } = {}) {
  const groups = [...new Set(choices.map((c) => c.group || ''))];
  const sel = h('select.select', { style: { minWidth: '280px' }, onchange: () => onChange(sel.value) },
    placeholder ? h('option', { value: '', selected: !value, disabled: true }, placeholder) : null,
    groups.map((g) => {
      const opts = choices.filter((c) => (c.group || '') === g).map((c) => h('option', { value: c.value, selected: String(c.value).toLowerCase() === String(value || '').toLowerCase() }, c.label));
      return g ? h('optgroup', { label: g }, opts) : opts;
    }));
  if (value && !choices.some((c) => String(c.value).toLowerCase() === String(value).toLowerCase())) {
    sel.prepend(h('option', { value, selected: true }, `${value} (${missing})`));
  }
  return sel;
}

/** modifiers.skulls as checkboxes: one number, the sum of the skulls that are on (0.9.19+). */
function skullsPicker(modifiers, changed) {
  const on = (k) => ((modifiers.skulls || 0) & k.value) !== 0;
  const toggle = (k, checked) => {
    const v = checked ? (modifiers.skulls || 0) | k.value : (modifiers.skulls || 0) & ~k.value;
    if (v) modifiers.skulls = v; else delete modifiers.skulls;
    changed();
  };
  return h('div.skull-grid', S.campaign.skulls.map((k) => {
    const box = h('input', { type: 'checkbox', checked: on(k), onchange: () => toggle(k, box.checked) });
    return h('label.skull', { class: k.silver ? 'silver' : 'gold' }, box, h('span', k.label));
  }));
}

/** Campaign modifiers, Halo 3's or ODST's: rows, then the skulls. modifiers is written only while one is set. */
function modifiersSection(owner, changed) {
  const modifiers = owner.modifiers || {};
  const tidy = () => { if (Object.keys(modifiers).length) owner.modifiers = modifiers; else delete owner.modifiers; changed(); };
  return [
    h('div.section-title', 'Modifiers', h('span.dim', '(off = the game\'s own)')),
    h('div.flush', toggleRows(S.campaign.modifiers, modifiers, tidy)),
    h('div.section-title', 'Skulls', h('span.dim', '(gold, then silver)')),
    skullsPicker(modifiers, tidy),
  ];
}

/** Firefight's options = { "firefight.team_lives" = 3, "skulls.famine" = 1, "player.shields" = 2, … } (0.9.21+). */
function firefightOptions(o, changed) {
  const F = S.odst.firefightOptions;
  const options = o.options || {};
  const tidy = () => { if (Object.keys(options).length) o.options = options; else delete o.options; changed(); };
  // Off = the game type's own, which the app can't read.
  const own = () => undefined;
  const skullCell = (scope, k) => {
    const key = `${scope.prefix}.${k.key}`;
    const sel = h('select.select.small', {
      title: `${k.label}, ${scope.label.toLowerCase()}`,
      onchange: () => { if (sel.value === '') delete options[key]; else options[key] = Number(sel.value); tidy(); },
    },
    h('option', { value: '', selected: !(key in options) }, '·'),
    h('option', { value: '1', selected: options[key] === 1 }, 'On'),
    h('option', { value: '0', selected: options[key] === 0 }, 'Off'));
    return h('td', sel);
  };
  return [
    h('div.section-title', 'Firefight options', h('span.dim', '(off = the game type\'s own)')),
    h('div.flush', toggleRows(F.fields, options, tidy, own)),
    h('div.section-title', 'Skulls', h('span.dim', '(· = the game type\'s own)')),
    h('div.skull-table-wrap', h('table.skull-table',
      h('thead', h('tr', h('th', ''), F.skullScopes.map((sc) => h('th', sc.label)))),
      h('tbody', S.campaign.skulls.map((k) => h('tr', h('th', k.label), F.skullScopes.map((sc) => skullCell(sc, k))))))),
    h('div.section-title', 'Player traits', h('span.dim', '(off = the game type\'s own)')),
    h('div.flush', toggleRows(F.traits, options, tidy, own)),
    h('div.help', F.traitsHelp),
  ];
}

/** campaign = { mission, insertion, difficulty, custom_characters, modifiers = { … } } of one server. */
function campaignForm(c, changed) {
  const [mission, ...rest] = S.campaign.fields;
  return h('div.campaign-form',
    h('div.field', h('label', 'Mission'), control(mission, c.mission, (v) => { c.mission = v; changed(); })),
    h('div.flush', toggleRows(rest, c, changed)),
    modifiersSection(c, changed),
    h('div.help', 'The server needs every mission it plays: run dedicated init --from --maps campaign and upload game/. It goes on to the next mission it has, and after the last starts again from this one.'));
}

/** odst = { mode, mission, insertion, variant, difficulty, modifiers = { … } } of one server (0.9.19+). */
function odstForm(o, changed, redrawPlays) {
  const O = S.odst;
  const difficulty = S.campaign.fields.find((f) => f.key === 'difficulty');
  const firefight = o.mode === 'firefight';
  const reset = (next) => { for (const k of Object.keys(o)) delete o[k]; Object.assign(o, next); redrawPlays(); changed(); };
  const mode = h('div.segmented',
    h('button', { class: firefight ? '' : 'active', onclick: () => reset({ mission: O.missions[1].value }) }, 'Campaign'),
    h('button', { class: firefight ? 'active' : '', onclick: () => reset({ mode: 'firefight', mission: O.firefightMaps[0].mission, insertion: O.firefightMaps[0].insertion }) }, 'Firefight'));
  const fields = [];
  if (firefight) {
    // A Firefight map is a mission + insertion pair.
    const key = (m) => `${m.mission}:${m.insertion}`;
    const map = h('select.select', { style: { minWidth: '280px' }, onchange: () => { const m = O.firefightMaps.find((x) => key(x) === map.value); o.mission = m.mission; o.insertion = m.insertion; changed(); } },
      O.firefightMaps.map((m) => h('option', { value: key(m), selected: m.mission === o.mission && m.insertion === (o.insertion ?? 0) }, m.label)));
    const variant = h('select.select', { style: { minWidth: '280px' }, onchange: () => { if (variant.value) o.variant = variant.value; else delete o.variant; changed(); } },
      h('option', { value: '', selected: !o.variant }, 'Default (the game type called Firefight)'),
      O.variants.map((v) => h('option', { value: v.value, selected: v.value === o.variant }, `${v.label}  ·  ${v.value}`)));
    fields.push(h('div.field', h('label', 'Map'), map), h('div.field', h('label', 'Game type'), variant));
  } else {
    const current = O.missions.find((m) => m.value === o.mission);
    const mission = h('select.select', { style: { minWidth: '280px' }, onchange: () => { o.mission = Number(mission.value); delete o.insertion; redrawPlays(); changed(); } },
      O.missions.map((m) => h('option', { value: m.value, selected: m.value === o.mission }, m.label)));
    fields.push(h('div.field', h('label', 'Mission'), mission));
    if (current?.insertions) {
      const start = h('select.select', { onchange: () => { const v = Number(start.value); if (v) o.insertion = v; else delete o.insertion; changed(); } },
        Array.from({ length: current.insertions + 1 }, (_, i) => h('option', { value: i, selected: i === (o.insertion ?? 0) }, i ? `Rally point ${i}` : 'Start of the mission')));
      fields.push(h('div.field', h('label', 'Start from'), start));
    }
  }
  // Firefight takes options and no modifiers or story characters; a campaign the reverse.
  return h('div.campaign-form',
    h('div.field', h('label', 'Mode'), mode),
    fields,
    h('div.flush', toggleRows(firefight ? [difficulty] : [difficulty, O.storyCharacters], o, changed)),
    firefight ? firefightOptions(o, changed) : modifiersSection(o, changed),
    h('div.help', O.help));
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
    if (kind === 'campaign') {
      s.campaign = { mission: 3010 };
      // A campaign server takes at most 16 players; redraw so the row shows it.
      if ((s.max_players ?? data.defaults?.max_players ?? 16) > LIM.campaignMaxPlayers) {
        s.max_players = LIM.campaignMaxPlayers;
        redraw();
        changed();
        return;
      }
    }
    if (kind === 'odst') {
      s.odst = { mission: S.odst.missions[1].value };
      // An ODST server takes at most 16 players too.
      if ((s.max_players ?? data.defaults?.max_players ?? 16) > LIM.campaignMaxPlayers) {
        s.max_players = LIM.campaignMaxPlayers;
        redraw();
        changed();
        return;
      }
    }
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
    } else if (kind === 'campaign') {
      picker = campaignForm(s.campaign, changed);
    } else if (kind === 'odst') {
      picker = odstForm(s.odst, changed, drawPlays);
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
        h('span', 'Egg variables filled in on the Pterodactyl panel override the settings outside [[server]] blocks: the general settings, [rcon], [master] and the [defaults] below (max and min players, voice, chat, welcome, friendly fire, team changing, camera, anti-cheat, VPNs, ping, load timeout, mods sharing, …). Leave them empty in the panel to use this file.')),
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

// ---------------------------------------------------------------- next-vote.toml

/** The first server's odst = { … }, if it plays Halo 3: ODST: the vote then picks ODST games. */
function firstServerOdst() {
  return host?.find('dedicated')?.current?.server?.[0]?.odst || null;
}

// What the console's maps and modes call them (0.9.21+), which nextmap takes.
function odstMapChoices() {
  return [
    ...S.odst.missions.map((m) => ({ value: m.label, label: m.label, group: 'Campaign missions' })),
    ...S.odst.firefightMaps.map((m) => ({ value: m.label, label: m.label, group: 'Firefight maps' })),
  ];
}

function odstGameChoices() {
  return [{ value: '', label: 'None (for a mission)' }, ...S.odst.variants.map((v) => ({ value: v.value, label: v.label }))];
}

function mapChoices() {
  return allMaps().map((m) => ({ value: m.ref, label: m.kind === 'stock' ? m.name : `${m.name} (${m.sub})`, group: m.kind === 'stock' ? 'Stock maps' : m.kind === 'mod' ? 'Mod maps' : 'Saved maps' }));
}

function createNextVoteEditor(doc, docHost) {
  const data = doc.current;
  const changed = () => docHost.changed(doc);
  const listHost = h('div');

  function drawList() {
    const choices = data.choice || [];
    const odst = !!firstServerOdst();
    const label = (c) => (c.game ? `${c.game} on ${c.map}` : c.map);
    const remove = (i) => {
      choices.splice(i, 1);
      if (!choices.length) delete data.choice; // no bare "choice = []" in the file
      drawList();
      changed();
    };
    render(listHost,
      choices.length === 0
        ? h('div.summary-empty', 'No games yet. Add at least two.')
        : choices.map((c, i) => {
          const name = h('input.input', {
            value: c.name || '', maxLength: NV.choice[0].maxLength, placeholder: label(c), style: { width: '100%' },
            onchange: () => { const v = name.value.trim(); if (v) c.name = v; else delete c.name; changed(); },
          });
          return h('div.next-vote-choice',
            name,
            selectWithGroups(odst ? odstMapChoices() : mapChoices(), c.map, (v) => { c.map = v; name.placeholder = label(c); changed(); }, odst ? { missing: 'not an ODST game' } : {}),
            selectWithGroups(odst ? odstGameChoices() : gametypeChoices(), c.game || '', (v) => { if (v) c.game = v; else delete c.game; name.placeholder = label(c); changed(); }, odst ? { missing: 'not a Firefight game type' } : {}),
            h('button.icon-btn.small.danger', { title: 'Remove', onclick: () => remove(i) }, icon('trash')));
        }),
      h('div.add-row', h('button.btn', {
        onclick: () => {
          (data.choice ||= []).push(odst ? { map: S.odst.firefightMaps[0].label, game: S.odst.variants[0].value } : { map: 'Guardian', game: 'Slayer' });
          drawList();
          changed();
        },
      }, icon('plus'), 'Add game')));
  }

  drawList();
  // Redraw when the first server switches between Halo 3 and ODST (not on every edit, which would steal focus).
  let drawnOdst = !!firstServerOdst();
  refreshNextVote = () => { const odst = !!firstServerOdst(); if (odst !== drawnOdst) { drawnOdst = odst; drawList(); } };
  return h('div.editor',
    h('div.readonly-banner', icon('info'),
      h('span', 'For the Pterodactyl egg: an admin types !nextvote in game chat (or nextvote in the panel console), players answer with a number, and the winning game plays after the current one, instead of the playlist\'s ballot. Works on the first [[server]], through RCON; when it plays Halo 3: ODST (Project Reclaimer 0.9.21 or later), the games are ODST\'s missions and Firefight maps. Saved edits apply at the next vote.')),
    sectionCard('Vote', toggleRows(NV.fields, data, changed), { open: true }),
    sectionCard('Games to choose from', h('div.panel-body', h('div.next-vote-choice.head', h('span', 'Name players read'), h('span', 'Map'), h('span', 'Game type'), h('span')), listHost), { open: true, note: 'Each vote draws its games at random from these' }));
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
  [fileInfo, reservedInfo, nextVoteInfo] = await Promise.all([window.api.server.read(), window.api.reservedSlots.read(), window.api.nextVote.read()]);
  if (reservedInfo.error) toast.error(reservedInfo.error);
  if (nextVoteInfo.error) toast.error(nextVoteInfo.error);
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
      createEditor: (doc, docHost) => {
        if (doc.id === 'reserved') return createReservedEditor(doc, docHost);
        if (doc.id === 'nextvote') return createNextVoteEditor(doc, docHost);
        return createEditor(doc, docHost);
      },
      validate: (data, doc) => {
        const dedicated = host.find('dedicated')?.current;
        if (doc.id === 'reserved') return validateReservedSlots(data, dedicated);
        if (doc.id === 'nextvote') return validateNextVote(data, dedicated);
        return validateServerConfig(data);
      },
      save: async (doc) => {
        if (doc.id === 'reserved') { reservedInfo = await window.api.reservedSlots.write(doc.current); return 'reserved'; }
        if (doc.id === 'nextvote') { nextVoteInfo = await window.api.nextVote.write(doc.current); return 'nextvote'; }
        fileInfo = await window.api.server.write(doc.current);
        return 'dedicated';
      },
      onChange: () => { updateReservedSummary?.(); refreshNextVote?.(); events.emit('status'); },
    });
  } else {
    // Pick up changes made outside the app, in documents without unsaved edits.
    const dirty = host.dirtyDocs();
    for (const [id, data] of [['dedicated', fileInfo.data], ['reserved', reservedInfo?.data], ['nextvote', nextVoteInfo?.data]]) {
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
  if (!host.find('nextvote') && nextVoteInfo?.data) host.open({ id: 'nextvote', title: 'next-vote.toml', data: nextVoteInfo.data });
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
