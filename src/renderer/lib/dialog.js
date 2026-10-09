// Modal dialogs. Only one is interactive at a time; dialogs can stack.
import { h } from './dom.js';

const stack = [];

document.addEventListener('keydown', (e) => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') { e.preventDefault(); top.cancel(); }
}, true);

/**
 * openDialog({ title, body, buttons, width, height, onBeforeClose })
 * buttons: [{ label, value, cls: 'primary'|'danger'|'accent', icon, disabled, left }]
 * Returns { el, close(value), setButtonDisabled(value, bool), result: Promise }.
 * Escape and backdrop clicks resolve with undefined (cancel).
 */
export function openDialog({ title, body, buttons = [{ label: 'Close', value: undefined }], width = 520, height, onBeforeClose }) {
  let resolve;
  const result = new Promise((r) => { resolve = r; });
  const buttonEls = new Map();

  const footer = h('div.dialog-footer');
  const left = buttons.filter((b) => b.left);
  const right = buttons.filter((b) => !b.left);
  for (const b of [...left, null, ...right]) {
    if (b === null) { footer.append(h('span.spacer')); continue; }
    const btn = h('button.btn', { class: b.cls || '', disabled: !!b.disabled, onclick: () => close(b.value) }, b.label);
    buttonEls.set(b.value, btn);
    footer.append(btn);
  }

  const dialog = h('div.dialog', { style: { width: `${width}px`, height: height ? `${height}px` : undefined }, role: 'dialog' },
    title ? h('div.dialog-title', title) : null,
    h('div.dialog-body', body),
    footer,
  );
  const backdrop = h('div.dialog-backdrop', dialog);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) api.cancel(); });
  document.body.append(backdrop);

  function close(value) {
    if (onBeforeClose && onBeforeClose(value) === false) return;
    const i = stack.indexOf(api);
    if (i >= 0) stack.splice(i, 1);
    backdrop.remove();
    resolve(value);
  }

  const api = {
    el: dialog,
    body: dialog.querySelector('.dialog-body'),
    close,
    cancel: () => close(undefined),
    setButtonDisabled(value, disabled) { const b = buttonEls.get(value); if (b) b.disabled = disabled; },
    result,
  };
  stack.push(api);
  setTimeout(() => (dialog.querySelector('[autofocus]') || dialog.querySelector('input, select, .btn.primary'))?.focus(), 0);
  return api;
}

/** Yes/no confirmation. Resolves true when confirmed. */
export async function confirmDialog({ title = 'Confirm', message, details, confirmLabel = 'OK', danger = false }) {
  const body = h('div', h('p', { style: { marginTop: 0 } }, message),
    details && details.length ? h('ul.muted', details.map((d) => h('li', d))) : null);
  const d = openDialog({
    title,
    body,
    buttons: [
      { label: 'Cancel', value: false },
      { label: confirmLabel, value: true, cls: danger ? 'danger' : 'primary' },
    ],
  });
  return (await d.result) === true;
}

/** Unsaved-changes prompt. Resolves 'save', 'discard' or 'cancel'. */
export async function unsavedDialog(names) {
  const list = Array.isArray(names) ? names : [names];
  const d = openDialog({
    title: 'Unsaved changes',
    body: h('div', h('p', { style: { marginTop: 0 } }, list.length === 1 ? 'Save changes to this item?' : 'Save changes to these items?'),
      h('ul', list.map((n) => h('li', n)))),
    buttons: [
      { label: 'Cancel', value: 'cancel', left: true },
      { label: 'Discard', value: 'discard', cls: 'danger' },
      { label: 'Save', value: 'save', cls: 'primary' },
    ],
  });
  return (await d.result) || 'cancel';
}

/** Text prompt, used only for names. Resolves the trimmed string or null. */
export async function promptDialog({ title, label, value = '', maxLength, validate }) {
  const input = h('input.input', { value, maxLength: maxLength || undefined, style: { width: '100%' }, autofocus: true });
  const error = h('div.help', { style: { color: 'var(--danger)', minHeight: '18px' } });
  const d = openDialog({
    title,
    body: h('div.field', h('label', label), input, error),
    buttons: [{ label: 'Cancel', value: null }, { label: 'OK', value: 'ok', cls: 'primary' }],
    onBeforeClose(v) {
      if (v !== 'ok') return true;
      const msg = validate ? validate(input.value.trim()) : (input.value.trim() ? null : 'Required');
      error.textContent = msg || '';
      return !msg;
    },
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') d.close('ok'); });
  setTimeout(() => input.select(), 0);
  return (await d.result) === 'ok' ? input.value.trim() : null;
}
