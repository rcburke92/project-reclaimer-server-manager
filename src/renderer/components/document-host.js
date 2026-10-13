// Editor side of an object-browser layout: one tab per open item, a dirty
// marker per tab, and a SAVE / DISCARD bar that only lights up when the active
// item has changes.
//
// createDocumentHost({
//   emptyText,
//   createEditor(doc, host) -> HTMLElement   // editor mutates doc.current, then calls host.changed(doc)
//   validate(data, doc) -> [{ level: 'error'|'warning', text }]
//   save(doc) -> Promise<newId>              // writes doc.current
//   onSaved(doc), onClosed(doc), onChange()
// })
// doc: { key, id, title, saved, current, readOnly, isNew }

import { h, render, clone, deepEqual } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { unsavedDialog } from '../lib/dialog.js';
import { toast } from '../lib/toast.js';

let keySeq = 0;

export function createDocumentHost({ emptyText = 'Double-click an item to open it.', createEditor, validate, save, onSaved, onClosed, onChange }) {
  const docs = [];
  let active = null;

  const tabsEl = h('div.doc-tabs');
  const bodyEl = h('div.doc-body');
  const issuesEl = h('div.doc-issues');
  const btnDiscard = h('button.btn', { onclick: () => active && discard(active) }, icon('undo'), 'Discard');
  const btnSave = h('button.btn.primary', { onclick: () => active && saveDoc(active) }, icon('save'), 'Save');
  const footer = h('div.dialog-footer.doc-footer', issuesEl, h('span.spacer'), btnDiscard, btnSave);
  const el = h('div.panel.document-host', tabsEl, bodyEl, footer);

  const isDirty = (doc) => doc.isNew || !deepEqual(doc.saved, doc.current);
  const issuesOf = (doc) => (validate && !doc.readOnly ? validate(doc.current, doc) : []);

  function drawTabs() {
    render(tabsEl, docs.map((doc) => h('div.doc-tab', {
      class: doc === active ? 'active' : '',
      title: doc.title,
      onclick: () => activate(doc),
      onauxclick: (e) => { if (e.button === 1) close(doc); },
    },
    doc.readOnly ? h('span.dim', '🔒') : null,
    h('span', doc.current?.name || doc.title),
    isDirty(doc) ? h('span.dirty', '•') : null,
    h('button.close', { title: 'Close', onclick: (e) => { e.stopPropagation(); close(doc); } }, icon('close')))));
  }

  function drawFooter() {
    footer.classList.toggle('hidden', !active);
    if (!active) return;
    const dirty = isDirty(active);
    const issues = issuesOf(active);
    const errors = issues.filter((i) => i.level === 'error');
    btnSave.disabled = active.readOnly || !dirty || errors.length > 0;
    btnDiscard.disabled = active.readOnly || !dirty;
    render(issuesEl, issues.slice(0, 3).map((i) => h('span.pill', { class: i.level === 'error' ? 'danger' : 'warning', title: i.text }, i.text)),
      issues.length > 3 ? h('span.dim', ` +${issues.length - 3} more`) : null,
      !issues.length && active.readOnly ? h('span.muted', 'Read-only. Duplicate it to make your own copy.') : null,
      !issues.length && !active.readOnly && dirty ? h('span.muted', 'Unsaved changes') : null);
  }

  function drawBody() {
    if (!active) {
      render(bodyEl, h('div.empty-state', emptyText));
      return;
    }
    if (!active.editorEl) active.editorEl = createEditor(active, api);
    render(bodyEl, active.editorEl);
  }

  function refresh() {
    drawTabs();
    drawBody();
    drawFooter();
    onChange?.();
  }

  function activate(doc) {
    active = doc;
    refresh();
  }

  /** Open a document (or focus it if already open). data is the saved content; isNew for unsaved new items. */
  function open({ id, title, data, readOnly = false, isNew = false }) {
    let doc = id ? docs.find((d) => d.id === id) : null;
    if (!doc) {
      doc = { key: ++keySeq, id, title, saved: isNew ? null : clone(data), current: clone(data), readOnly, isNew };
      docs.push(doc);
    }
    activate(doc);
    return doc;
  }

  async function saveDoc(doc) {
    if (doc.readOnly) return false;
    const errors = issuesOf(doc).filter((i) => i.level === 'error');
    if (errors.length) {
      toast.error(`Can't save "${doc.current.name}": ${errors[0].text}`);
      activate(doc);
      return false;
    }
    try {
      const newId = await save(doc);
      doc.id = newId || doc.id;
      doc.saved = clone(doc.current);
      doc.isNew = false;
      doc.title = doc.current.name || doc.title;
      onSaved?.(doc);
      refresh();
      toast.success(`Saved "${doc.title}"`);
      return true;
    } catch (err) {
      toast.error(`Save failed: ${err.message}`);
      return false;
    }
  }

  function discard(doc) {
    if (doc.isNew) { remove(doc); return; }
    doc.current = clone(doc.saved);
    doc.editorEl = null;
    refresh();
  }

  function remove(doc) {
    const i = docs.indexOf(doc);
    if (i < 0) return;
    docs.splice(i, 1);
    doc.editorEl = null;
    if (active === doc) active = docs[i] || docs[i - 1] || null;
    onClosed?.(doc);
    refresh();
  }

  async function close(doc) {
    if (!doc.readOnly && isDirty(doc)) {
      activate(doc);
      const choice = await unsavedDialog(doc.current.name || doc.title);
      if (choice === 'cancel') return false;
      if (choice === 'save' && !(await saveDoc(doc))) return false;
    }
    remove(doc);
    return true;
  }

  const api = {
    el,
    open,
    close,
    /** Editors call this after changing doc.current. */
    changed(doc) {
      if (doc === active) { drawTabs(); drawFooter(); }
      onChange?.();
    },
    /** Rebuild the editor for a doc (after outside changes). */
    rebuild(doc) { doc.editorEl = null; if (doc === active) drawBody(); },
    find: (id) => docs.find((d) => d.id === id),
    docs: () => docs.slice(),
    dirtyDocs: () => docs.filter((d) => !d.readOnly && isDirty(d)),
    active: () => active,
    save: saveDoc,
    discard,
    /** Close without prompting (after delete). */
    forceClose: remove,
  };

  refresh();
  return api;
}
