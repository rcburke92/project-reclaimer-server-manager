// Mods tab: "My Halo 3 Mods" (local scan + copy instructions) and "Workshop"
// (embedded Steam Workshop browser). The app never calls the Steam Web API:
// mods are read from Steam's local files, and the optional subscription sync is
// one ordinary page view in the signed-in browser, run only when clicked.

import { h, render, formatBytes, formatDate } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { events } from '../lib/events.js';
import { settings } from '../lib/settings.js';
import { toast } from '../lib/toast.js';
import { modsStore } from '../lib/mods-store.js';

export const WORKSHOP_HOME = 'https://steamcommunity.com/workshop/browse/?appid=976730&requiredtags[]=Halo3&browsesort=trend';
const SUBSCRIPTIONS_URL = (page) => `https://steamcommunity.com/my/myworkshopfiles/?appid=976730&browsefilter=mysubscriptions&numperpage=30&p=${page}`;
const itemUrl = (id) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

let pane;
let sub = 'mine';
let visible = false;
let release = null;
let disabled = [];
let scanning = false;
let syncing = false;

const mineEl = h('div.mods-mine');
const workshopEl = h('div.mods-workshop');
let webview = null;

// ---------------------------------------------------------------- my mods

function serverPath(mod) {
  return `content/Mods/${mod.id}/`;
}

function copyButton(text, title = 'Copy') {
  return h('button.icon-btn.small', {
    title,
    onclick: async () => { await window.api.copyText(text); toast.success('Copied'); },
  }, icon('copy'));
}

function statusPills(mod) {
  const s = settings.get();
  const pills = [];
  pills.push(mod.downloaded ? h('span.pill.success', 'Downloaded') : h('span.pill.warning', 'Not downloaded'));
  if (mod.needsUpdate) pills.push(h('span.pill.warning', { title: 'Steam has a newer version it hasn\'t downloaded yet' }, 'Steam update pending'));
  if (disabled.some((p) => p.toLowerCase() === `mods/${mod.id}`)) pills.push(h('span.pill.danger', 'Disabled'));
  const exported = s.exportedMods?.[mod.id];
  if (exported === undefined) pills.push(h('span.pill.info', { title: 'Not marked as copied to the server yet (Export tab)' }, 'Not on server yet'));
  else if (mod.timeUpdated && mod.timeUpdated > exported) pills.push(h('span.pill.accent', { title: 'Steam updated this mod after you last marked it as copied' }, 'Updated since last export'));
  return pills;
}

function modCard(mod) {
  const thumb = mod.maps.find((m) => m.thumbnail)?.thumbnail;
  const isDisabled = disabled.some((p) => p.toLowerCase() === `mods/${mod.id}`);
  const disableBox = h('input', {
    type: 'checkbox',
    checked: isDisabled,
    onchange: async () => {
      disabled = await window.api.workspace.setModDisabled(String(mod.id), disableBox.checked);
      toast.success(disableBox.checked ? `"${mod.title}" will be disabled on the server` : `"${mod.title}" enabled`);
      draw();
    },
  });

  return h('div.panel.card.mod-card',
    h('div.mod-head',
      thumb ? h('div.map-thumb.mod-thumb', h('img', { src: thumb, alt: '' })) : h('div.map-thumb.placeholder.kind-mod.mod-thumb', h('span', mod.title.slice(0, 2).toUpperCase())),
      h('div.mod-title',
        h('div.name', mod.title),
        h('div.dim', `Workshop item ${mod.id}`, mod.version ? ` · v${mod.version}` : '', mod.size ? ` · ${formatBytes(mod.size)}` : '', mod.timeUpdated ? ` · updated ${formatDate(mod.timeUpdated)}` : ''),
        h('div.pills', statusPills(mod))),
      h('div.mod-actions',
        h('button.btn.small', { onclick: () => openInWorkshop(itemUrl(mod.id)), title: 'Open this item in the Workshop tab' }, icon('external'), 'Workshop page'),
        mod.downloaded ? h('button.btn.small', { onclick: () => window.api.openPath(mod.folder) }, icon('folder'), 'Open folder') : null)),
    h('div.panel-body',
      mod.description ? h('p.muted.mod-desc', mod.description) : null,

      h('div.section-title', 'Copy to the server'),
      mod.downloaded
        ? h('ol.steps',
          h('li', h('div', 'Copy this whole folder from your PC:'),
            h('div.path-box', h('span', { style: { flex: '1' } }, mod.folder), copyButton(mod.folder, 'Copy path'),
              h('button.icon-btn.small', { title: 'Open folder', onclick: () => window.api.openPath(mod.folder) }, icon('folder')))),
          h('li', h('div', 'Upload it into the server folder (Pterodactyl File Manager or SFTP) as:'),
            h('div.path-box', h('span', { style: { flex: '1' } }, serverPath(mod)), copyButton(serverPath(mod), 'Copy server path'))),
          h('li', 'Keep the folder exactly as it is, including ', h('code', 'ModInfo.json'),
            mod.ownSharedMap ? ' and its own shared.map' : '', mod.soundBanks ? ' and its sound banks (halo3/fmod)' : '',
            '. The server finds the mod by its files; the folder name doesn\'t matter.'),
          h('li', 'Restart the server after adding or updating mods.'))
        : h('p.muted', 'Steam hasn\'t downloaded this item yet. Make sure you\'re subscribed and let the Steam client finish downloading; it shows up here automatically.'),

      mod.maps.length ? [
        h('div.section-title', `Maps (${mod.maps.length})`),
        h('div.mod-maps', mod.maps.map((m) => h('div.mod-map',
          m.thumbnail ? h('div.map-thumb', h('img', { src: m.thumbnail, alt: '' })) : h('div.map-thumb.placeholder.kind-mod', h('span', m.name.slice(0, 2).toUpperCase())),
          h('div.names', h('span', m.name), h('span.mono.dim', m.ref), m.hasMapFile === false ? h('span.pill.warning', 'no .map file') : null),
          copyButton(m.ref, 'Copy playlist reference')))),
      ] : h('p.dim', 'This mod has no multiplayer maps (it may change other content).'),

      h('div.mod-footer',
        h('label.field.inline', h('label.toggle', disableBox, h('span')), h('span', 'Disabled on the server ', h('span.dim', '(listed in content/disabled-mods.json)'))))),
  );
}

function subscriptionsSection(data) {
  const subs = data.subscriptions;
  if (!subs) return null;
  const local = new Set([...data.mods.map((m) => String(m.id)), ...(data.other || []).map((m) => String(m.id))]);
  const missing = subs.items.filter((i) => !local.has(String(i.id)));
  return h('div.panel.card',
    h('div.panel-header', 'Subscribed on Steam, not downloaded here', h('span.spacer'), h('span.dim', `synced ${formatDate(subs.syncedAt)}`)),
    h('div.panel-body', missing.length === 0
      ? h('p.muted', { style: { margin: 0 } }, `All ${subs.items.length} subscriptions are downloaded.`)
      : [
        h('p.muted', { style: { marginTop: 0 } }, 'Steam hasn\'t downloaded these yet, so the app can\'t tell which game they\'re for. Open Steam and let it finish; Halo 3 ones then appear above.'),
        h('ul.list', missing.map((i) => h('li.list-item', { onclick: () => openInWorkshop(itemUrl(i.id)) },
          h('span', i.title || `Item ${i.id}`), h('span.meta', i.id)))),
      ]));
}

function draw() {
  if (!pane) return;
  const data = modsStore.get();
  const s = settings.get();
  render(mineEl,
    h('div.mods-toolbar',
      h('button.btn', { disabled: scanning, onclick: () => modsStore.rescan(), title: 'Read Steam\'s local Workshop folders again (no network)' }, icon('refresh'), scanning ? 'Scanning…' : 'Rescan'),
      h('button.btn', { disabled: syncing, onclick: syncSubscriptions, title: 'Open your Steam subscriptions page once in the signed-in browser and read the list' }, icon('sync'), syncing ? 'Syncing…' : 'Sync subscriptions from Steam'),
      h('span.spacer'),
      h('span.muted', data.scannedAt ? `${data.mods.length} Halo 3 mod${data.mods.length === 1 ? '' : 's'}${data.other?.length ? ` · ${data.other.length} other MCC mod${data.other.length === 1 ? '' : 's'} hidden` : ''} · scanned ${formatDate(data.scannedAt)}` : 'Not scanned yet')),
    h('div.panel.card.note',
      h('div.panel-body',
        h('strong', 'Your server runs in a Pterodactyl container with no Steam, '),
        'so it can\'t download Workshop items itself. Copy each mod\'s folder into the server\'s ', h('code', 'content/Mods'),
        ' folder as shown below. Players still get mods through Steam Workshop when they join. ',
        s.steamPath ? null : h('span.pill.danger', 'Steam folder not set (Settings tab)'))),
    data.scannedAt && data.mods.length === 0
      ? h('div.panel.card', h('div.empty-state', 'No Halo 3 Workshop mods found on this PC. Subscribe to some in the Workshop tab; once Steam downloads them they appear here.'))
      : data.mods.map(modCard),
    subscriptionsSection(data));
}

// ---------------------------------------------------------------- subscription sync

/** Runs inside the Steam page: item ids + titles, the next-page flag and whether we're signed in. */
const EXTRACT = `(() => {
  const signedOut = /\\/login/i.test(location.href) || !!document.querySelector('a[href*="/login/home"]') && !document.querySelector('#account_pulldown, [data-miniprofile]');
  const items = new Map();
  for (const a of document.querySelectorAll('a[href*="filedetails/?id="]')) {
    const m = /[?&]id=(\\d+)/.exec(a.href);
    if (!m) continue;
    const box = a.closest('.workshopItemSubscription, .workshopItem, [id^="Subscription"], div') || a;
    const titleEl = box.querySelector('.workshopItemTitle') || a.querySelector('.workshopItemTitle');
    const title = (titleEl ? titleEl.textContent : a.textContent || '').trim();
    const prev = items.get(m[1]);
    if (!prev || (!prev.title && title)) items.set(m[1], { id: m[1], title: title.slice(0, 120) });
  }
  const next = [...document.querySelectorAll('a.pagebtn, .workshopBrowsePagingControls a')].some((a) => /›|&gt;|next/i.test(a.textContent) && !a.classList.contains('disabled'));
  return { url: location.href, signedOut, items: [...items.values()], next };
})()`;

function loadInHidden(view, url) {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = (e) => { if (e.errorCode === -3) return; cleanup(); reject(new Error(e.errorDescription || 'load failed')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out loading Steam')); }, 30000);
    function cleanup() { clearTimeout(timer); view.removeEventListener('did-finish-load', done); view.removeEventListener('did-fail-load', fail); }
    view.addEventListener('did-finish-load', done);
    view.addEventListener('did-fail-load', fail);
    view.loadURL(url);
  });
}

async function extractWhenReady(view) {
  // The page renders client-side: wait for item links (or a clear signed-out/empty state).
  let last = null;
  for (let i = 0; i < 20; i++) {
    last = await view.executeJavaScript(EXTRACT);
    if (last.signedOut || last.items.length) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

async function syncSubscriptions() {
  if (syncing) return;
  syncing = true;
  draw();
  const view = h('webview', { partition: 'persist:steam', src: 'about:blank', style: { position: 'fixed', width: '1024px', height: '768px', left: '-5000px', top: '0' } });
  document.body.append(view);
  try {
    await new Promise((r) => view.addEventListener('dom-ready', r, { once: true }));
    const all = new Map();
    for (let page = 1; page <= 20; page++) {
      await loadInHidden(view, SUBSCRIPTIONS_URL(page));
      const r = await extractWhenReady(view);
      if (r.signedOut) {
        toast.warning('Sign in to Steam in the Workshop tab first, then sync again.');
        showSub('workshop');
        return;
      }
      const before = all.size;
      for (const it of r.items) if (!all.has(it.id)) all.set(it.id, it);
      if (!r.next || all.size === before) break;
    }
    await modsStore.setSubscriptions([...all.values()]);
    toast.success(`Found ${all.size} subscription${all.size === 1 ? '' : 's'} to MCC Workshop items`);
  } catch (err) {
    toast.error(`Sync failed: ${err.message}`);
  } finally {
    view.remove();
    syncing = false;
    draw();
  }
}

// ---------------------------------------------------------------- workshop browser

function buildWorkshop() {
  const address = h('input.input.address', { readOnly: true });
  const back = h('button.icon-btn', { title: 'Back', onclick: () => webview.canGoBack() && webview.goBack() }, icon('back'));
  const fwd = h('button.icon-btn', { title: 'Forward', onclick: () => webview.canGoForward() && webview.goForward() }, icon('forward'));
  const progress = h('div.progress.webview-progress.hidden', h('div', { style: { width: '100%' } }));

  webview = h('webview', { partition: 'persist:steam', src: WORKSHOP_HOME, allowpopups: true });
  const update = () => {
    try {
      address.value = webview.getURL();
      back.disabled = !webview.canGoBack();
      fwd.disabled = !webview.canGoForward();
    } catch { /* not ready yet */ }
  };
  webview.addEventListener('did-navigate', update);
  webview.addEventListener('did-navigate-in-page', update);
  webview.addEventListener('did-start-loading', () => progress.classList.remove('hidden'));
  webview.addEventListener('did-stop-loading', () => { progress.classList.add('hidden'); update(); });

  render(workshopEl,
    h('div.browser-bar',
      back, fwd,
      h('button.icon-btn', { title: 'Reload', onclick: () => webview.reload() }, icon('refresh')),
      h('button.icon-btn', { title: 'Halo 3 Workshop', onclick: () => webview.loadURL(WORKSHOP_HOME) }, icon('home')),
      address,
      h('button.icon-btn', { title: 'Open in your web browser', onclick: () => window.api.openExternal(webview.getURL()) }, icon('external'))),
    progress,
    h('div.browser-hint.muted', 'Sign in with Steam (top right of the page) to subscribe. Subscribing tells the Steam client to download the mod; it then appears under My Halo 3 Mods.'),
    webview);
}

function openInWorkshop(url) {
  showSub('workshop');
  if (webview) webview.loadURL(url);
}

// ---------------------------------------------------------------- sub-tabs + lifecycle

const subButtons = {};

function updateWatching() {
  const want = visible && sub === 'mine';
  if (want && !release) {
    release = modsStore.acquire();
    window.api.workspace.disabledMods().then((d) => { disabled = d; draw(); }).catch(() => {});
  } else if (!want && release) {
    release();
    release = null;
  }
}

function showSub(name) {
  sub = name;
  for (const [k, b] of Object.entries(subButtons)) b.classList.toggle('active', k === name);
  mineEl.classList.toggle('hidden', name !== 'mine');
  workshopEl.classList.toggle('hidden', name !== 'workshop');
  if (name === 'workshop' && !webview) buildWorkshop();
  updateWatching();
}

export default {
  id: 'mods',
  label: 'Mods',
  fill: true,
  mount(el) {
    pane = el;
    subButtons.mine = h('button', { onclick: () => showSub('mine') }, 'My Halo 3 Mods');
    subButtons.workshop = h('button', { onclick: () => showSub('workshop') }, 'Workshop');
    el.append(h('div.mods-layout',
      h('div.sub-tabs', h('div.segmented', subButtons.mine, subButtons.workshop)),
      h('div.mods-body', mineEl, workshopEl)));
    events.on('mods:updated', draw);
    events.on('mods:scanning', (v) => { scanning = v; draw(); });
    events.on('settings:changed', draw);
    showSub('mine');
    draw();
  },
  show() { visible = true; updateWatching(); },
  hide() { visible = false; updateWatching(); },
};
