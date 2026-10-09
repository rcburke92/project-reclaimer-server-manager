// Map references used by playlists and servers, and their pictures.
//   stock:  "Valhalla" or "riverworld"
//   mod:    "workshop:<item id>/<map file>"
//   forge:  "Maps/<file>.json|.mvar|.bin" (saved maps in content/Maps)

import { h } from './dom.js';
import { catalog, findStockMap } from './catalog.js';
import { modsStore } from './mods-store.js';

let stockImages = {};
let forgeMaps = [];

export async function loadMapSources() {
  [stockImages, forgeMaps] = await Promise.all([
    window.api.assets.mapImageUrls().catch(() => ({})),
    window.api.workspace.forgeMaps().catch(() => []),
  ]);
}

export function getForgeMaps() { return forgeMaps; }

/** Every map the pickers offer: [{ ref, name, kind: 'stock'|'mod'|'forge', sub, image, modId }] */
export function allMaps() {
  const out = catalog.maps.map((m) => ({ ref: m.name, name: m.name, kind: 'stock', sub: `${m.file}.map · ${m.pack}`, image: stockImages[m.file] || null }));
  for (const mod of modsStore.get().mods) {
    for (const m of mod.maps) {
      out.push({ ref: m.ref, name: m.name, kind: 'mod', sub: mod.title, image: m.thumbnail, modId: mod.id, missing: !mod.downloaded });
    }
  }
  for (const f of forgeMaps) out.push({ ref: `Maps/${f.file}`, name: f.name, kind: 'forge', sub: `content/Maps/${f.file}`, image: null });
  return out;
}

/** Describe a map reference from a file: { name, kind, sub, image, modId, known } */
export function describeMap(ref) {
  const stock = findStockMap(ref);
  if (stock) return { name: stock.name, kind: 'stock', sub: stock.file, image: stockImages[stock.file] || null, known: true, key: `stock:${stock.file}` };
  const mod = modsStore.findMap(ref);
  if (mod) {
    return {
      name: mod.map?.name || mod.file,
      kind: 'mod',
      sub: mod.mod ? mod.mod.title : `Workshop item ${mod.modId} (not installed here)`,
      image: mod.map?.thumbnail || null,
      modId: mod.modId,
      known: !!mod.map,
      key: `workshop:${mod.modId}/${mod.file.toLowerCase()}`,
    };
  }
  const m = /^maps\/(.+)$/i.exec(String(ref || ''));
  if (m) {
    const f = forgeMaps.find((x) => x.file.toLowerCase() === m[1].toLowerCase());
    return { name: f ? f.name : m[1], kind: 'forge', sub: `content/Maps/${m[1]}`, image: null, known: !!f, key: `forge:${m[1].toLowerCase()}` };
  }
  return { name: String(ref || '?'), kind: 'other', sub: 'Saved map or mod map by name', image: null, known: false, key: `name:${String(ref || '').toLowerCase()}` };
}

/** Picture tile, or a styled placeholder with the map's initials. */
export function mapThumb(map, cls = '') {
  if (map.image) return h('div.map-thumb', { class: cls }, h('img', { src: map.image, alt: '', loading: 'lazy', draggable: false }));
  const initials = String(map.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return h('div.map-thumb.placeholder', { class: `${cls} kind-${map.kind || 'stock'}` }, h('span', initials));
}
