// Maps tab: reference only. Stock Halo 3 maps, mod maps from your Halo 3
// Workshop mods, and saved maps in the workspace's content/Maps folder.
import { h, render } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { events } from '../lib/events.js';
import { toast } from '../lib/toast.js';
import { catalog } from '../lib/catalog.js';
import { modsStore } from '../lib/mods-store.js';
import { loadMapSources, allMaps, mapThumb } from '../lib/maps.js';

let pane;
let filter = 'all';
let search = '';
let release = null;
const gridHost = h('div');

function card(m, extra) {
  return h('div.map-card.panel',
    mapThumb(m, 'large'),
    h('div.map-card-body',
      h('div.title', m.name),
      h('div.dim', m.sub),
      h('div.ref', h('span.mono', m.ref),
        h('button.icon-btn.small', { title: 'Copy the reference used in playlists and dedicated.toml', onclick: async () => { await window.api.copyText(m.ref); toast.success('Copied'); } }, icon('copy'))),
      extra || null));
}

function section(title, maps, empty) {
  return [
    h('div.section-title', title, h('span.dim', `(${maps.length})`)),
    maps.length ? h('div.map-grid', maps.map((m) => card(m))) : h('p.dim', empty),
  ];
}

function draw() {
  if (!pane) return;
  const maps = allMaps().filter((m) => !search || m.name.toLowerCase().includes(search) || (m.sub || '').toLowerCase().includes(search) || m.ref.toLowerCase().includes(search));
  const out = [];
  if (filter === 'all' || filter === 'stock') {
    for (const pack of [...new Set(catalog.maps.map((m) => m.pack))]) {
      const inPack = maps.filter((m) => m.kind === 'stock' && catalog.maps.find((c) => c.name === m.ref)?.pack === pack);
      if (inPack.length) out.push(section(`Stock · ${pack}`, inPack, ''));
    }
  }
  if (filter === 'all' || filter === 'mod') {
    const data = modsStore.get();
    if (!data.mods.length) out.push(section('Mod maps', [], 'No Halo 3 Workshop mods found. Subscribe in the Mods tab and let Steam download them.'));
    for (const mod of data.mods) {
      const mm = maps.filter((m) => m.kind === 'mod' && m.modId === mod.id);
      if (mm.length || !search) out.push(section(`Mod · ${mod.title}`, mm, 'No multiplayer maps in this mod.'));
    }
  }
  if (filter === 'all' || filter === 'forge') {
    out.push(section('Saved maps (content/Maps)', maps.filter((m) => m.kind === 'forge'),
      'None yet. Copy saved Forge maps (.json, .mvar) from Documents\My Games\Project Reclaimer\Maps into the workspace content/Maps folder.'));
  }
  render(gridHost, out);
}

async function refresh() {
  await loadMapSources();
  draw();
}

export default {
  id: 'maps',
  label: 'Maps',
  mount(el) {
    pane = el;
    const searchInput = h('input.input', { placeholder: 'Search maps…', style: { width: '260px' }, oninput: () => { search = searchInput.value.trim().toLowerCase(); draw(); } });
    const seg = h('div.segmented', [['all', 'All'], ['stock', 'Stock'], ['mod', 'Mods'], ['forge', 'Saved']].map(([v, l]) => h('button', {
      class: v === filter ? 'active' : '',
      onclick: (e) => { filter = v; for (const b of seg.children) b.classList.toggle('active', b === e.currentTarget); draw(); },
    }, l)));
    render(el,
      h('div.maps-header', h('h2', 'Maps'), h('span.spacer'), seg, searchInput,
        h('button.btn.small', { title: 'Reload map lists and images', onclick: () => { modsStore.rescan(); refresh(); } }, icon('refresh'), 'Refresh')),
      h('p.muted', { style: { marginTop: 0 } }, 'Reference only. Stock map pictures are read from your MCC install; mod maps use the pictures their authors ship. To use your own picture for a map, see Settings → Map images.'),
      gridHost);
    events.on('mods:updated', draw);
  },
  show() {
    release = modsStore.acquire();
    refresh();
  },
  hide() {
    release?.();
    release = null;
  },
};
