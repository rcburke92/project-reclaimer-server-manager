// Settings tab: folder paths and app maintenance.
import { h, render } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { settings } from '../lib/settings.js';
import { events } from '../lib/events.js';
import { toast } from '../lib/toast.js';
import { confirmDialog } from '../lib/dialog.js';

const PATHS = [
  {
    key: 'workspaceDir',
    label: 'Workspace folder',
    help: 'Your game types, playlists and server config, laid out exactly like the server folder (dedicated.toml, playlists/, content/…). This is what you upload.',
    kind: 'folder',
    required: true,
  },
  {
    key: 'steamPath',
    label: 'Steam folder',
    help: 'Found from the registry. Used to find your Steam libraries and Workshop downloads.',
    kind: 'folder',
    required: true,
  },
  {
    key: 'mccPath',
    label: 'Halo: MCC install',
    help: 'Used for the stock map list and menu art.',
    kind: 'folder',
    required: true,
  },
  {
    key: 'reclaimerDocsDir',
    label: 'Project Reclaimer documents',
    help: 'Documents\\My Games\\Project Reclaimer. Game types saved in the client ("Save as variant") are imported from here.',
    kind: 'folder',
  },
  {
    key: 'reclaimerExe',
    label: 'project-reclaimer.exe (optional)',
    help: 'The client (project-reclaimer-client-vX.exe from 0.9.18) or the server-only project-reclaimer-dedicated-vX.exe, on the same version as your server. Lets the Export tab run "dedicated check" on your workspace before you upload.',
    kind: 'file',
    filters: [{ name: 'Programs', extensions: ['exe'] }],
  },
];

let pane;

async function draw() {
  const s = settings.get();
  const exists = await window.api.exists(PATHS.map((p) => s[p.key]).filter(Boolean));

  const rows = PATHS.map((p) => {
    const value = s[p.key] || '';
    const found = value && exists[value];
    const status = !value
      ? h('span.pill', { class: p.required ? 'warning' : '' }, 'Not set')
      : found ? h('span.pill.success', 'Found') : h('span.pill.danger', 'Missing');

    async function browse() {
      const picked = p.kind === 'file'
        ? await window.api.pickFile({ title: p.label, defaultPath: value || undefined, filters: p.filters })
        : await window.api.pickFolder({ title: p.label, defaultPath: value || undefined });
      if (picked) await settings.update({ [p.key]: picked });
    }

    return h('div.field', { style: { marginBottom: '16px' } },
      h('label', p.label, ' ', status),
      h('div.path-box',
        h('span', { style: { flex: '1' } }, value || h('span.dim', 'Not set')),
        h('button.icon-btn.small', { title: 'Browse…', onclick: browse }, icon('folder')),
        value && found ? h('button.icon-btn.small', { title: 'Open in Explorer', onclick: () => (p.kind === 'file' ? window.api.showItem(value) : window.api.openPath(value)) }, icon('external')) : null,
        value && !p.required ? h('button.icon-btn.small.danger', { title: 'Clear', onclick: () => settings.update({ [p.key]: null }) }, icon('close')) : null,
      ),
      h('div.help', p.help),
    );
  });

  render(pane,
    h('h2', 'Settings'),
    h('div.panel.card',
      h('div.panel-header', 'Folders', h('span.spacer'),
        h('button.btn.small', {
          onclick: async () => { await settings.detect(); toast.success('Paths re-detected'); },
          title: 'Find Steam, MCC and the Reclaimer documents folder again',
        }, icon('refresh'), 'Re-detect')),
      h('div.panel-body', rows),
    ),
    h('div.panel.card',
      h('div.panel-header', 'Map images'),
      h('div.panel-body',
        h('p.muted', { style: { marginTop: 0 } },
          'Stock map pictures are read from your MCC install automatically. To use your own picture instead, put an image named after the map file in this folder, for example riverworld.png for Valhalla.'),
        h('button.btn', { onclick: async () => window.api.openPath(await window.api.assets.mapImagesDir()) }, icon('folder'), 'Open map images folder'),
      ),
    ),
    h('div.panel.card',
      h('div.panel-header', 'Steam login'),
      h('div.panel-body',
        h('p.muted', { style: { marginTop: 0 } }, 'The Workshop browser keeps you signed in between launches. Clearing it signs you out of the embedded browser only.'),
        h('button.btn.danger', {
          onclick: async () => {
            if (!(await confirmDialog({ title: 'Clear Steam login', message: 'Sign out of the embedded Workshop browser and delete its cookies?', confirmLabel: 'Clear', danger: true }))) return;
            await window.api.clearSteamLogin();
            toast.success('Steam login cleared');
          },
        }, icon('trash'), 'Clear Steam login'),
      ),
    ),
  );
}

export default {
  id: 'settings',
  label: 'Settings',
  mount(el) {
    pane = el;
    events.on('settings:changed', () => draw());
    draw();
  },
  show() {
    if (pane) draw();
  },
};
