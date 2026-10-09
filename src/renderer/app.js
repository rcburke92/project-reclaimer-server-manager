// Renderer entry point: builds the tab strip, mounts each tab module and
// keeps the status bar up to date.

import { h, render } from './lib/dom.js';
import { events } from './lib/events.js';
import { settings } from './lib/settings.js';
import { unsavedDialog } from './lib/dialog.js';
import { modsStore } from './lib/mods-store.js';

import serverTab from './tabs/server.js';
import gametypesTab from './tabs/gametypes.js';
import playlistsTab from './tabs/playlists.js';
import mapsTab from './tabs/maps.js';
import modsTab from './tabs/mods.js';
import exportTab from './tabs/export.js';
import settingsTab from './tabs/settings.js';

// Each tab: { id, label, fill?, mount(pane), show?(), hide?(), unsavedCount?() }
const TABS = [serverTab, gametypesTab, playlistsTab, mapsTab, modsTab, exportTab, settingsTab];

let activeTab = null;
const panes = new Map();
const buttons = new Map();
const mounted = new Set();

function activate(id) {
  if (activeTab?.id === id) return;
  const tab = TABS.find((t) => t.id === id);
  if (!tab) return;
  if (activeTab) {
    activeTab.hide?.();
    buttons.get(activeTab.id).classList.remove('active');
    panes.get(activeTab.id).classList.remove('active');
  }
  activeTab = tab;
  buttons.get(id).classList.add('active');
  const pane = panes.get(id);
  pane.classList.add('active');
  if (!mounted.has(id)) {
    mounted.add(id);
    try { tab.mount(pane); } catch (err) { console.error(`mount ${id}:`, err); }
  }
  tab.show?.();
  events.emit('tab:changed', id);
}

export function unsavedTotal() {
  return TABS.reduce((n, t) => n + (t.unsavedCount?.() || 0), 0);
}

function renderStatus() {
  const unsaved = unsavedTotal();
  const s = settings.get();
  render(document.getElementById('status-bar'),
    h('span.item', { class: unsaved ? 'accent' : '' }, unsaved ? `${unsaved} unsaved` : 'All changes saved'),
    modsStore.get().scannedAt ? h('span.item', `${modsStore.get().mods.length} Halo 3 mods`) : null,
    s.lastExport ? h('span.item', `Last export ${new Date(s.lastExport).toLocaleString()}`) : null,
  );
  for (const t of TABS) {
    const btn = buttons.get(t.id);
    const n = t.unsavedCount?.() || 0;
    btn.querySelector('.badge')?.remove();
    if (n) btn.append(h('span.badge', String(n)));
  }
}

function renderHeader() {
  const s = settings.get();
  document.getElementById('workspace-label').textContent = s.workspaceDir ? `Workspace: ${s.workspaceDir}` : 'No workspace folder set';
}

async function applyBackdrop() {
  const url = await window.api.assets.backdropUrl();
  document.documentElement.style.setProperty('--backdrop', url ? `url("${url}")` : 'none');
}

async function init() {
  await settings.load();

  const strip = document.getElementById('tab-strip');
  const content = document.getElementById('tab-content');
  for (const t of TABS) {
    const btn = h('button.tab', { onclick: () => activate(t.id) }, t.label);
    buttons.set(t.id, btn);
    strip.append(btn);
    const pane = h('section.tab-pane', { id: `tab-${t.id}`, class: t.fill ? 'fill' : '' });
    panes.set(t.id, pane);
    content.append(pane);
  }

  const info = await window.api.appInfo();
  document.getElementById('app-version').textContent = `v${info.version}`;

  events.on('status', renderStatus);
  events.on('mods:updated', renderStatus);
  modsStore.loadCached();
  events.on('settings:changed', () => { renderHeader(); renderStatus(); applyBackdrop(); });
  renderHeader();
  renderStatus();
  applyBackdrop();

  activate(settings.get().lastTab && TABS.some((t) => t.id === settings.get().lastTab) ? settings.get().lastTab : 'gametypes');
  events.on('tab:changed', (id) => settings.update({ lastTab: id }, { quiet: true }));
  console.log('app ready');
}

/** Before the window closes: offer to save every unsaved item in every tab. */
let closePrompt = false;

async function handleCloseRequest() {
  if (closePrompt) return undefined;
  closePrompt = true;
  try {
    return await promptAndClose();
  } finally {
    closePrompt = false;
  }
}

async function promptAndClose() {
  const dirty = TABS.flatMap((t) => (t.unsavedDocs?.() || []).map((doc) => ({ tab: t, doc })));
  if (!dirty.length) return window.api.confirmClose();
  const choice = await unsavedDialog(dirty.map(({ tab, doc }) => `${tab.label}: ${doc.current?.name || doc.title}`));
  if (choice === 'cancel') return undefined;
  if (choice === 'save') {
    for (const { tab, doc } of dirty) {
      if (!(await tab.saveDoc(doc))) return undefined; // a failed save keeps the window open
    }
  }
  return window.api.confirmClose();
}

window.api.onCloseRequested(() => { handleCloseRequest(); });

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (document.querySelector('.dialog-backdrop')) return;
    activeTab?.saveActive?.();
  }
});

init().catch((err) => console.error('init failed:', err));
