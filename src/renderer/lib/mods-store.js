// Halo 3 Workshop mods, read from local Steam files by the main process.
// Views that show mods call acquire() while visible and the returned release()
// when hidden: the first acquire rescans and starts the folder watcher, the
// last release stops it. Nothing scans in the background.

import { events } from './events.js';

let data = { mods: [], other: [], subscriptions: null, scannedAt: null };
let users = 0;
let scanning = null;

export const modsStore = {
  get: () => data,

  /** Load the last scan from disk (no folder access). */
  async loadCached() {
    data = await window.api.mods.cached();
    events.emit('mods:updated', data);
    return data;
  },

  async rescan() {
    if (scanning) return scanning;
    events.emit('mods:scanning', true);
    scanning = window.api.mods.scan()
      .then((r) => { data = r; events.emit('mods:updated', data); return data; })
      .catch((err) => { console.error('mod scan failed:', err); return data; })
      .finally(() => { scanning = null; events.emit('mods:scanning', false); });
    return scanning;
  },

  /** Start using mods. Returns release(). */
  acquire() {
    users++;
    if (users === 1) {
      window.api.mods.watch(true);
      this.rescan();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      users = Math.max(0, users - 1);
      if (users === 0) window.api.mods.watch(false);
    };
  },

  async setSubscriptions(list) {
    data.subscriptions = await window.api.mods.setSubscriptions(list);
    events.emit('mods:updated', data);
  },

  /** Mod map by playlist reference "workshop:<id>/<file>". */
  findMap(ref) {
    const m = /^workshop:(\d+)\/(.+)$/i.exec(String(ref || ''));
    if (!m) return null;
    const mod = data.mods.find((x) => x.id === m[1]);
    const map = mod?.maps.find((x) => x.file.toLowerCase() === m[2].toLowerCase());
    return { modId: m[1], file: m[2], mod: mod || null, map: map || null };
  },
};

window.api.mods.onChanged(() => { if (users > 0) modsStore.rescan(); });
