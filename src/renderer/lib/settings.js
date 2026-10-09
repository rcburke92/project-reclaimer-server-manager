// Renderer-side copy of the app settings. Changes are saved through the main
// process and announced with the 'settings:changed' event.

import { events } from './events.js';

let current = {};

export const settings = {
  async load() {
    current = await window.api.settings.get();
    return current;
  },
  get() {
    return current;
  },
  /** quiet: save without announcing (for bookkeeping like the last open tab). */
  async update(patch, { quiet = false } = {}) {
    current = await window.api.settings.update(patch);
    if (!quiet) events.emit('settings:changed', current);
    return current;
  },
  async detect() {
    current = await window.api.settings.detect();
    events.emit('settings:changed', current);
    return current;
  },
};
