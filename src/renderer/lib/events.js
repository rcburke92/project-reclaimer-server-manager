// Tiny app-wide event bus.
const listeners = new Map();

export const events = {
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name).delete(fn);
  },
  emit(name, payload) {
    for (const fn of listeners.get(name) || []) {
      try { fn(payload); } catch (err) { console.error(`event ${name}:`, err); }
    }
  },
};
