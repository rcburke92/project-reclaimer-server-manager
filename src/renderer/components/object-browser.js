// Visual Studio–style object browser: grouped list with multi-select and a
// New / Duplicate / Edit / Delete toolbar.
//
// createObjectBrowser({
//   title,
//   onNew(), onDuplicate(items), onOpen(items), onDelete(items),
//   extraButtons: [{ icon, title, onClick }],
// })
// .setGroups([{ id, label, items: [{ id, label, meta, readOnly, warning, badge }] }])

import { h, render } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

export function createObjectBrowser({ title, onNew, onDuplicate, onOpen, onDelete, extraButtons = [], emptyText = 'Nothing here yet.' }) {
  let groups = [];
  let selected = new Set();
  let anchor = null; // last clicked id, for shift-range
  let focusId = null;
  const collapsed = new Set();
  let filterText = '';

  const listHost = h('div.ob-list', { tabIndex: 0 });
  const search = h('input.input.ob-search', {
    placeholder: 'Filter…',
    oninput: () => { filterText = search.value.trim().toLowerCase(); draw(); },
  });

  const btnNew = h('button.icon-btn', { title: 'New', onclick: () => onNew?.() }, icon('plus'));
  const btnDup = h('button.icon-btn', { title: 'Duplicate selected', onclick: () => onDuplicate?.(selectedItems()) }, icon('duplicate'));
  const btnEdit = h('button.icon-btn', { title: 'Edit selected (opens a tab for each)', onclick: () => onOpen?.(selectedItems()) }, icon('edit'));
  const btnDel = h('button.icon-btn.danger', { title: 'Delete selected', onclick: () => deleteSelected() }, icon('trash'));
  const extras = extraButtons.map((b) => h('button.icon-btn', { title: b.title, onclick: () => b.onClick(selectedItems()) }, icon(b.icon)));

  const el = h('div.panel.object-browser',
    h('div.panel-header', title, h('span.spacer'), h('span.ob-count')),
    h('div.ob-search-row', search),
    listHost,
    h('div.toolbar', btnNew, btnDup, btnEdit, h('span.spacer'), extras, btnDel),
  );

  function allItems() {
    return groups.flatMap((g) => g.items);
  }

  function visibleItems() {
    return groups.filter((g) => !collapsed.has(g.id)).flatMap((g) => g.items.filter(matches));
  }

  function matches(item) {
    return !filterText || item.label.toLowerCase().includes(filterText) || (item.meta || '').toLowerCase().includes(filterText);
  }

  function selectedItems() {
    return allItems().filter((i) => selected.has(i.id));
  }

  function deleteSelected() {
    const items = selectedItems().filter((i) => !i.readOnly);
    if (items.length) onDelete?.(items);
  }

  function updateToolbar() {
    const sel = selectedItems();
    btnDup.disabled = sel.length === 0;
    btnEdit.disabled = sel.length === 0;
    btnDel.disabled = sel.filter((i) => !i.readOnly).length === 0;
    el.querySelector('.ob-count').textContent = sel.length > 1 ? `${sel.length} selected` : '';
  }

  function clickItem(e, item) {
    const ids = visibleItems().map((i) => i.id);
    if (e.shiftKey && anchor && ids.includes(anchor)) {
      const [a, b] = [ids.indexOf(anchor), ids.indexOf(item.id)].sort((x, y) => x - y);
      if (!e.ctrlKey) selected.clear();
      ids.slice(a, b + 1).forEach((id) => selected.add(id));
    } else if (e.ctrlKey || e.metaKey) {
      if (selected.has(item.id)) selected.delete(item.id); else selected.add(item.id);
      anchor = item.id;
    } else {
      selected = new Set([item.id]);
      anchor = item.id;
    }
    focusId = item.id;
    draw();
  }

  function draw() {
    const ids = new Set(allItems().map((i) => i.id));
    selected = new Set([...selected].filter((id) => ids.has(id)));
    const total = allItems().length;

    render(listHost, total === 0
      ? h('div.empty-state', emptyText)
      : groups.map((g) => {
        const items = g.items.filter(matches);
        if (filterText && items.length === 0) return null;
        const isCollapsed = collapsed.has(g.id);
        return h('div.list-group', { class: isCollapsed ? 'collapsed' : '' },
          h('div.list-group-header', {
            onclick: () => { if (isCollapsed) collapsed.delete(g.id); else collapsed.add(g.id); draw(); },
          }, h('span.caret', '▾'), g.label, h('span.dim', `(${g.items.length})`)),
          h('ul.list', items.map((item) => h('li.list-item', {
            class: [selected.has(item.id) ? 'selected' : '', focusId === item.id ? 'focused' : '', item.readOnly ? 'read-only' : ''].join(' '),
            title: item.warning || item.tooltip || '',
            onclick: (e) => clickItem(e, item),
            ondblclick: () => onOpen?.([item]),
          },
          h('span.ob-label', item.label),
          item.warning ? h('span.pill.warning', '!') : null,
          item.badge ? h('span.pill', { class: item.badgeClass || '' }, item.badge) : null,
          item.meta ? h('span.meta', item.meta) : null))),
        );
      }));
    updateToolbar();
  }

  listHost.addEventListener('keydown', (e) => {
    const vis = visibleItems();
    if (!vis.length) return;
    const idx = vis.findIndex((i) => i.id === focusId);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = vis[Math.max(0, Math.min(vis.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))];
      clickItem({ shiftKey: e.shiftKey, ctrlKey: false }, next);
      listHost.querySelector('.list-item.focused')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selected.size) onOpen?.(selectedItems());
    } else if (e.key === 'Delete') {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === 'a' && e.ctrlKey) {
      e.preventDefault();
      selected = new Set(vis.map((i) => i.id));
      draw();
    }
  });

  return {
    el,
    setGroups(next) { groups = next; draw(); },
    select(ids) { selected = new Set(ids); focusId = ids[ids.length - 1] || null; anchor = focusId; draw(); },
    selectedItems,
  };
}
