// Toast notifications in the bottom-right corner.
import { h } from './dom.js';

export function toast(message, type = 'info', ms = 3500) {
  const host = document.getElementById('toast-host');
  const el = h('div.toast', { class: type }, message);
  host.append(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

toast.success = (m) => toast(m, 'success');
toast.error = (m) => toast(m, 'error', 6000);
toast.warning = (m) => toast(m, 'warning', 5000);
