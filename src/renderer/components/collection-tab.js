// Object browser + document tabs for one kind of workspace file
// (game types or playlists). Handles listing, new, duplicate, delete, open
// and save; the caller supplies the editor and validation.
//
// createCollectionTab({
//   kind: 'gametypes' | 'playlists',
//   title, newLabel,
//   group(item) -> { id, label, order },  item -> { label, meta, badge }
//   blank(name) -> data,
//   createEditor(doc, host), validate(data),
//   extraButtons,
// })

import { h, render, clone } from '../lib/dom.js';
import { createObjectBrowser } from './object-browser.js';
import { createDocumentHost } from './document-host.js';
import { confirmDialog, promptDialog } from '../lib/dialog.js';
import { toast } from '../lib/toast.js';
import { events } from '../lib/events.js';

export function createCollectionTab({ kind, title, newLabel, group, describe, blank, createEditor, validate, extraButtons = [], nameMax = 48 }) {
  let items = [];

  const host = createDocumentHost({
    emptyText: `Double-click a ${newLabel.toLowerCase()} to open it, or press ＋ to make one.`,
    createEditor,
    validate,
    save: (doc) => window.api.workspace.write(kind, doc.isNew ? null : doc.id, doc.current),
    onSaved: () => reload(),
    onChange: () => events.emit('status'),
  });

  const browser = createObjectBrowser({
    title,
    emptyText: `No ${title.toLowerCase()} yet. Press ＋ to make one.`,
    onNew: newItem,
    onDuplicate: duplicate,
    onOpen: openItems,
    onDelete: deleteItems,
    extraButtons,
  });

  const el = h('div.collection', browser.el, host.el);

  function nameTaken(name, exceptId) {
    const n = name.toLowerCase();
    return items.some((i) => i.id !== exceptId && i.name.toLowerCase() === n)
      || host.docs().some((d) => d.isNew && d.current.name.toLowerCase() === n);
  }

  function validateName(name) {
    if (!name) return 'Enter a name';
    if (name.length > nameMax) return `At most ${nameMax} characters`;
    if (nameTaken(name)) return 'That name is already used';
    return null;
  }

  async function reload() {
    try {
      items = await window.api.workspace.list(kind);
    } catch (err) {
      toast.error(err.message);
      items = [];
    }
    const groups = new Map();
    for (const item of items) {
      const g = group(item);
      if (!groups.has(g.id)) groups.set(g.id, { ...g, items: [] });
      const d = describe ? describe(item) : {};
      groups.get(g.id).items.push({
        id: item.id,
        name: item.name,
        label: item.name,
        readOnly: item.readOnly,
        warning: item.error,
        tooltip: item.file,
        ...d,
      });
    }
    browser.setGroups([...groups.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    events.emit('workspace:changed', kind);
  }

  async function newItem() {
    const name = await promptDialog({ title: `New ${newLabel}`, label: 'Name', maxLength: nameMax, validate: validateName });
    if (!name) return;
    host.open({ id: null, title: name, data: blank(name), isNew: true });
  }

  async function openItems(list) {
    for (const item of list) {
      if (item.warning) { toast.error(`${item.label}: ${item.warning}`); continue; }
      try {
        const r = await window.api.workspace.read(kind, item.id);
        host.open({ id: item.id, title: item.label, data: r.data, readOnly: r.readOnly });
      } catch (err) {
        toast.error(`Can't open ${item.label}: ${err.message}`);
      }
    }
  }

  async function duplicate(list) {
    const newIds = [];
    for (const item of list) {
      try {
        const r = await window.api.workspace.read(kind, item.id);
        const data = clone(r.data);
        let name = `${data.name || item.label} (copy)`.slice(0, nameMax);
        for (let i = 2; nameTaken(name); i++) name = `${data.name || item.label} (copy ${i})`.slice(0, nameMax);
        data.name = name;
        if (data.script && typeof data.script === 'object' && 'name' in data.script) data.script.name = name;
        newIds.push(await window.api.workspace.write(kind, null, data));
      } catch (err) {
        toast.error(`Can't duplicate ${item.label}: ${err.message}`);
      }
    }
    await reload();
    if (newIds.length) {
      browser.select(newIds);
      toast.success(newIds.length === 1 ? 'Duplicated' : `Duplicated ${newIds.length} items`);
    }
  }

  async function deleteItems(list) {
    const ok = await confirmDialog({
      title: `Delete ${list.length === 1 ? newLabel.toLowerCase() : `${list.length} ${title.toLowerCase()}`}`,
      message: 'These files will be deleted from the workspace:',
      details: list.map((i) => i.label),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await window.api.workspace.remove(kind, list.map((i) => i.id));
      for (const i of list) {
        const doc = host.find(i.id);
        if (doc) host.forceClose(doc);
      }
      toast.success(list.length === 1 ? `Deleted "${list[0].label}"` : `Deleted ${list.length} items`);
    } catch (err) {
      toast.error(err.message);
    }
    await reload();
  }

  return {
    el,
    host,
    browser,
    reload,
    items: () => items,
    unsavedCount: () => host.dirtyDocs().length,
    unsavedDocs: () => host.dirtyDocs(),
    saveActive: () => { const d = host.active(); if (d) host.save(d); },
    saveDoc: (doc) => host.save(doc),
    duplicate,
    nameTaken,
  };
}
