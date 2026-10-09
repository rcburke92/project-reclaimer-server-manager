// Export & Instructions: what to upload to the Pterodactyl server, step by step.
import { h, render, formatBytes, formatDate } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { events } from '../lib/events.js';
import { toast } from '../lib/toast.js';
import { settings } from '../lib/settings.js';
import { modsStore } from '../lib/mods-store.js';
import { confirmDialog } from '../lib/dialog.js';
import { unsavedTotal } from '../app.js';

let pane;
let current = null;
let checkResult = null;
let checking = false;
let progress = null; // { id, done, total }
const ticked = new Set(); // checklist ticks for this session

const STATUS = {
  new: ['info', 'New'],
  changed: ['accent', 'Changed'],
  unchanged: ['', 'Already uploaded'],
};

function pill(status) {
  const [cls, text] = STATUS[status] || ['', status];
  return h('span.pill', { class: cls }, text);
}

function copyBtn(text) {
  return h('button.icon-btn.small', { title: 'Copy', onclick: async () => { await window.api.copyText(text); toast.success('Copied'); } }, icon('copy'));
}

function tick(key) {
  const box = h('input', { type: 'checkbox', checked: ticked.has(key), onchange: () => { if (box.checked) ticked.add(key); else ticked.delete(key); } });
  return box;
}

function filesSection(p) {
  const pending = p.files.filter((f) => f.status !== 'unchanged');
  const rows = p.files.map((f) => h('div.export-row', { class: f.status === 'unchanged' ? 'done' : '' },
    tick(`file:${f.rel}`),
    h('span.mono', f.rel),
    pill(f.status),
    h('span.dim', formatBytes(f.size)),
    h('span.actions', copyBtn(f.rel), h('button.icon-btn.small', { title: 'Show in folder', onclick: () => window.api.showItem(f.full) }, icon('folder')))));
  const deleted = p.deleted.map((r) => h('div.export-row',
    tick(`del:${r}`), h('span.mono', r), h('span.pill.danger', 'Delete on server'), h('span'), h('span.actions', copyBtn(r))));
  return h('div.panel.card',
    h('div.panel-header', '1 · Upload these files', h('span.spacer'),
      h('span.dim', { style: { textTransform: 'none', letterSpacing: '0' } }, pending.length ? `${pending.length} to upload` : 'Nothing new to upload')),
    h('div.panel-body',
      h('p.muted', { style: { marginTop: 0 } },
        'In the Pterodactyl panel, open the server\'s File Manager (or connect with SFTP, details under Settings). Upload each file into the same path in the server folder, replacing what\'s there. Files marked "Already uploaded" haven\'t changed since you last marked an upload.'),
      p.files.length || p.deleted.length ? h('div.export-list', rows, deleted) : h('div.empty-state', 'The workspace is empty. Make a game type, playlist or server config first.')));
}

function modsSection(p) {
  const used = p.mods.filter((m) => m.referenced);
  const other = p.mods.filter((m) => !m.referenced);
  const row = (m) => {
    const prog = progress && progress.id === m.id ? progress : null;
    const src = m.staged ? `${p.workspace}\\content\\Mods\\${m.id}` : m.folder;
    return h('div.export-mod', { class: m.status === 'unchanged' && m.staged === false ? '' : '' },
      h('div.export-mod-head',
        tick(`mod:${m.id}`),
        h('div', { style: { flex: '1', minWidth: '0' } },
          h('div', h('strong', m.title), h('span.dim', ` · ${m.id}`, m.size ? ` · ${formatBytes(m.size)}` : '')),
          h('div.dim', m.usedBy.length ? `Used by ${m.usedBy.join(', ')}` : 'Not used by any playlist or server right now')),
        !m.installed ? h('span.pill.danger', 'Not on this PC') : pill(m.status === 'unchanged' ? 'unchanged' : m.status),
        m.staged ? h('span.pill.success', 'Copied to workspace') : null),
      m.installed ? h('div.export-mod-body',
        h('div.path-pair',
          h('span.dim', 'From'), h('div.path-box', h('span', { style: { flex: '1' } }, src), copyBtn(src),
            h('button.icon-btn.small', { title: 'Open folder', onclick: () => window.api.openPath(src) }, icon('folder'))),
          h('span.dim', 'To'), h('div.path-box', h('span', { style: { flex: '1' } }, `content/Mods/${m.id}/`), copyBtn(`content/Mods/${m.id}/`))),
        h('div.export-mod-actions',
          prog ? [
            h('div.progress', { style: { flex: '1' } }, h('div', { style: { width: `${prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%` } })),
            h('span.dim', `${formatBytes(prog.done)} / ${formatBytes(prog.total)}`),
            h('button.btn.small', { onclick: () => window.api.export.cancelStaging() }, 'Cancel'),
          ] : [
            m.staged
              ? h('button.btn.small', { onclick: () => unstage(m) }, icon('trash'), 'Remove workspace copy')
              : h('button.btn.small', { disabled: !!progress, title: 'Copy the mod folder into workspace/content/Mods so the whole content folder can be uploaded in one go', onclick: () => stage(m) }, icon('copy'), 'Copy into workspace'),
            m.status !== 'new' ? h('button.btn.small', { title: 'You removed it from the server', onclick: () => forget(m) }, 'Mark as removed from server') : null,
          ])) : null);
  };
  return h('div.panel.card',
    h('div.panel-header', '2 · Copy these mods'),
    h('div.panel-body',
      h('p.muted', { style: { marginTop: 0 } },
        'Each mod is a whole folder. Upload it into the server\'s content/Mods folder, keeping its files as they are (ModInfo.json included). The server has no Steam, so it can\'t download them itself. Large mods upload faster as a zip: compress the folder, upload the zip into content/Mods, then use the File Manager\'s Unarchive.'),
      used.length ? used.map(row) : h('p.dim', 'No playlist or server uses a mod map.'),
      other.length ? [h('div.section-title', 'Also tracked'), other.map(row)] : null));
}

function warningsSection(p) {
  if (!p.warnings.length) return null;
  return h('div.panel.card.warn-card',
    h('div.panel-header', icon('warning'), 'Check these first'),
    h('div.panel-body', h('ul', p.warnings.map((w) => h('li', w)))));
}

function checkSection() {
  const s = settings.get();
  return h('div.panel.card',
    h('div.panel-header', '3 · Check (optional)'),
    h('div.panel-body',
      h('p.muted', { style: { marginTop: 0 } }, 'Runs "dedicated check" on the workspace with your PC\'s MCC install as the game folder. It reports anything a playlist or server names that can\'t be found, and unknown option keys or labels.'),
      s.reclaimerExe
        ? h('button.btn', { disabled: checking, onclick: runCheck }, icon('play'), checking ? 'Checking…' : 'Run dedicated check')
        : h('p', h('span.pill.warning', 'Not set up'), ' Set project-reclaimer.exe in the Settings tab to use this.'),
      checkResult ? h('pre.check-output', { class: checkResult.code === 0 ? 'ok' : 'fail' }, checkResult.output || `(exit code ${checkResult.code})`) : null));
}

function finishSection(p) {
  const modIds = p.mods.filter((m) => m.installed && m.referenced).map((m) => m.id);
  return h('div.panel.card',
    h('div.panel-header', '4 · Restart and record'),
    h('div.panel-body',
      h('ol.steps',
        h('li', 'Restart the server from the Pterodactyl panel: servers read playlists, game types and mods when they start.'),
        h('li', 'Watch the console for "dedicated check passed: starting Project Reclaimer". Anything missing is named just above that line.'),
        h('li', 'Then record this upload, so next time only what changed is marked.')),
      h('div', { style: { display: 'flex', gap: '10px', marginTop: '12px' } },
        h('button.btn.primary', {
          onclick: async () => {
            if (unsavedTotal() && !(await confirmDialog({ title: 'Unsaved changes', message: 'Some items have unsaved changes, which aren\'t in the workspace yet. Record the upload anyway?', confirmLabel: 'Record' }))) return;
            await window.api.export.markUploaded(modIds);
            await settings.load();
            ticked.clear();
            events.emit('settings:changed', settings.get());
            toast.success('Upload recorded');
            refresh();
          },
        }, icon('check'), 'Mark everything as uploaded'),
        p.lastUpload ? h('span.dim', { style: { alignSelf: 'center' } }, `Last recorded upload: ${formatDate(p.lastUpload)}`) : null)));
}

function draw() {
  if (!pane || !current) return;
  const p = current;
  const unsaved = unsavedTotal();
  render(pane,
    h('div.export-header',
      h('h2', 'Export & Instructions'),
      h('span.spacer'),
      h('button.btn.small', { onclick: refresh }, icon('refresh'), 'Refresh'),
      h('button.btn.small', { onclick: () => window.api.openPath(p.workspace) }, icon('folder'), 'Open workspace folder')),
    h('p.muted', { style: { marginTop: 0 } }, 'Your workspace folder is laid out like the server folder: ', h('span.mono', p.workspace)),
    unsaved ? h('div.readonly-banner', icon('warning'), h('span', `${unsaved} item${unsaved === 1 ? ' has' : 's have'} unsaved changes. Save them first; only saved files are in the workspace.`)) : null,
    warningsSection(p),
    filesSection(p),
    modsSection(p),
    checkSection(),
    finishSection(p));
}

async function refresh() {
  try {
    if (!modsStore.get().scannedAt || Date.now() - modsStore.get().scannedAt > 60000) await modsStore.rescan();
    current = await window.api.export.plan();
  } catch (err) {
    render(pane, h('h2', 'Export & Instructions'), h('div.panel.card', h('div.empty-state', err.message)));
    return;
  }
  draw();
}

async function stage(m) {
  progress = { id: m.id, done: 0, total: m.size || 0 };
  draw();
  try {
    await window.api.export.stageMod(m.id);
    toast.success(`Copied "${m.title}" into the workspace`);
  } catch (err) {
    const msg = err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    if (msg === 'Cancelled') toast('Copy cancelled'); else toast.error(`Copy failed: ${msg}`);
  } finally {
    progress = null;
    refresh();
  }
}

async function unstage(m) {
  if (!(await confirmDialog({ title: 'Remove workspace copy', message: `Delete the copy of "${m.title}" from workspace/content/Mods? The Steam download isn't touched.`, confirmLabel: 'Remove', danger: true }))) return;
  await window.api.export.unstageMod(m.id);
  await settings.load();
  refresh();
}

async function forget(m) {
  await window.api.export.forgetMod(m.id);
  await settings.load();
  events.emit('settings:changed', settings.get());
  refresh();
}

async function runCheck() {
  checking = true;
  checkResult = null;
  draw();
  try {
    checkResult = await window.api.export.runCheck();
  } catch (err) {
    checkResult = { code: -1, output: err.message };
  } finally {
    checking = false;
    draw();
  }
}

let lastDraw = 0;
window.api.export.onProgress((p) => {
  progress = p;
  const now = Date.now();
  if (now - lastDraw > 150) { lastDraw = now; draw(); }
});

export default {
  id: 'export',
  label: 'Export',
  mount(el) { pane = el; },
  show() { refresh(); },
};
