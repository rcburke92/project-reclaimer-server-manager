// Line icons as inline SVG. icon('plus') returns an <svg> element.

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  duplicate: 'M8 8h11v11H8zM5 16V5h11',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  folder: 'M3 6h6l2 2h10v11H3z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  home: 'M4 11l8-7 8 7M6 10v10h12V10',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7M8 14h8v6H8z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  warning: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  export: 'M12 3v12M7 10l5 5 5-5M4 17v4h16v-4',
  sync: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  search: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM14.5 14.5L20 20',
  script: 'M8 6l-5 6 5 6M16 6l5 6-5 6',
  play: 'M7 4l12 8-12 8z',
};

export function icon(name, cls) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (cls) svg.setAttribute('class', cls);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PATHS[name] || PATHS.info);
  svg.append(path);
  return svg;
}
