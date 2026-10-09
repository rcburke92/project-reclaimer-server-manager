'use strict';

// Writes changes into an existing dedicated.toml without disturbing anything
// else: comments, blank lines, key order and value formatting are kept for
// every value that didn't change. Supports what dedicated.toml uses: top-level
// keys, [tables] and [[server]] array tables, with single- or multi-line values.

const TOML = require('smol-toml');

// ---------------------------------------------------------------- value formatting

function formatString(s) {
  return JSON.stringify(String(s)); // JSON escapes are valid TOML basic-string escapes
}

function formatValue(v) {
  if (typeof v === 'string') return formatString(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const items = v.map(formatValue);
    const oneLine = `[${items.join(', ')}]`;
    if (oneLine.length <= 80) return oneLine;
    return `[\n${items.map((i) => `    ${i},`).join('\n')}\n]`;
  }
  throw new Error(`Unsupported value: ${JSON.stringify(v)}`);
}

const KEY_RE = /^\s*([A-Za-z0-9_-]+)\s*=\s*/;

/** Bracket depth change of a value fragment, ignoring brackets in strings and comments. */
function bracketDelta(text) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '#') break;
    if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
  }
  return depth;
}

/** Split a single-line value from its trailing comment: "16   # note" -> ['16', '   # note'] */
function splitComment(rest) {
  let quote = null;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (quote) {
      if (quote === '"' && c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#') {
      let j = i;
      while (j > 0 && /\s/.test(rest[j - 1])) j--;
      return [rest.slice(0, j), rest.slice(j)];
    }
  }
  return [rest.replace(/\s+$/, ''), ''];
}

// ---------------------------------------------------------------- document model

/**
 * Split text into sections. Each section: { kind: 'root'|'table'|'array', name, lines: [] }
 * and each key line knows its extent (for multi-line values).
 */
function parseSections(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sections = [{ kind: 'root', name: '', lines: [] }];
  for (const line of lines) {
    const arr = /^\s*\[\[\s*([A-Za-z0-9_.-]+)\s*\]\]\s*(#.*)?$/.exec(line);
    const tbl = !arr && /^\s*\[\s*([A-Za-z0-9_.-]+)\s*\]\s*(#.*)?$/.exec(line);
    if (arr) sections.push({ kind: 'array', name: arr[1], lines: [line] });
    else if (tbl) sections.push({ kind: 'table', name: tbl[1], lines: [line] });
    else sections[sections.length - 1].lines.push(line);
  }
  return sections;
}

/** Locate key lines in a section: Map key -> { start, end } (line indexes, inclusive). */
function keyIndex(section) {
  const out = new Map();
  const { lines } = section;
  const first = section.kind === 'root' ? 0 : 1;
  for (let i = first; i < lines.length; i++) {
    const m = KEY_RE.exec(lines[i]);
    if (!m) continue;
    let depth = bracketDelta(lines[i].slice(m[0].length));
    let end = i;
    while (depth > 0 && end + 1 < lines.length) {
      end++;
      depth += bracketDelta(lines[end]);
    }
    out.set(m[1], { start: i, end });
    i = end;
  }
  return out;
}

function setKey(section, key, value) {
  const idx = keyIndex(section);
  const at = idx.get(key);
  const formatted = formatValue(value);
  if (at) {
    const line = section.lines[at.start];
    const m = KEY_RE.exec(line);
    const prefix = line.slice(0, m[0].length);
    // Keep a trailing comment on single-line values.
    const [, comment] = at.start === at.end ? splitComment(line.slice(m[0].length)) : ['', ''];
    const newLines = `${prefix}${formatted}${comment}`.split('\n');
    section.lines.splice(at.start, at.end - at.start + 1, ...newLines);
  } else {
    // Insert after the last key line, or after the header / leading comments.
    let insertAt;
    const ends = [...idx.values()].map((r) => r.end);
    if (ends.length) insertAt = Math.max(...ends) + 1;
    else {
      insertAt = section.kind === 'root' ? 0 : 1;
      if (section.kind === 'root') {
        while (insertAt < section.lines.length && /^\s*#/.test(section.lines[insertAt])) insertAt++;
      }
    }
    section.lines.splice(insertAt, 0, ...`${key} = ${formatted}`.split('\n'));
  }
}

function removeKey(section, key) {
  const at = keyIndex(section).get(key);
  if (at) section.lines.splice(at.start, at.end - at.start + 1);
}

function patchSection(section, oldObj, newObj) {
  for (const [k, v] of Object.entries(newObj || {})) {
    if (v === undefined || v === null) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) continue; // sub-tables are separate sections
    if (oldObj && k in oldObj && JSON.stringify(oldObj[k]) === JSON.stringify(v)) continue;
    setKey(section, k, v);
  }
  for (const k of Object.keys(oldObj || {})) {
    const nv = newObj ? newObj[k] : undefined;
    const ov = oldObj[k];
    if (ov && typeof ov === 'object' && !Array.isArray(ov)) continue;
    if (nv === undefined || nv === null) removeKey(section, k);
  }
}

function newTableSection(kind, name, obj) {
  const header = kind === 'array' ? `[[${name}]]` : `[${name}]`;
  const s = { kind, name, lines: [header] };
  patchSection(s, {}, obj);
  return s;
}

function scalarEntries(obj) {
  return Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => !(v && typeof v === 'object' && !Array.isArray(v))));
}

function tableEntries(obj) {
  return Object.entries(obj || {}).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
}

/**
 * Apply newData to text. oldData must be what `text` parses to.
 * Array-of-table entries (like server) are matched by position.
 */
function patchToml(text, newData) {
  const oldData = text.trim() ? TOML.parse(text) : {};
  const sections = parseSections(text);
  const root = sections[0];

  // Top-level scalars (minus arrays of tables).
  const isArrayOfTables = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && !Array.isArray(x));
  const oldTop = Object.fromEntries(Object.entries(scalarEntries(oldData)).filter(([, v]) => !isArrayOfTables(v)));
  const newTop = Object.fromEntries(Object.entries(scalarEntries(newData)).filter(([, v]) => !isArrayOfTables(v)));
  patchSection(root, oldTop, newTop);

  // [tables]
  const oldTables = new Map(tableEntries(oldData));
  const newTables = new Map(tableEntries(newData));
  for (const [name, obj] of newTables) {
    const existing = sections.find((s) => s.kind === 'table' && s.name === name);
    if (existing) patchSection(existing, oldTables.get(name) || {}, obj);
    else if (Object.keys(obj).length) {
      // New tables go before the first [[array]] so the file reads top-down.
      const firstArray = sections.findIndex((s) => s.kind === 'array');
      const sec = newTableSection('table', name, obj);
      const prev = sections[firstArray < 0 ? sections.length - 1 : firstArray - 1];
      if (prev && prev.lines.length && prev.lines[prev.lines.length - 1].trim() !== '') prev.lines.push('');
      sec.lines.push('');
      sections.splice(firstArray < 0 ? sections.length : firstArray, 0, sec);
    }
  }
  for (const [name] of oldTables) {
    if (!newTables.has(name)) {
      const i = sections.findIndex((s) => s.kind === 'table' && s.name === name);
      if (i >= 0) sections.splice(i, 1);
    }
  }

  // [[arrays of tables]], matched by position.
  const arrayNames = new Set([
    ...Object.entries(oldData).filter(([, v]) => isArrayOfTables(v)).map(([k]) => k),
    ...Object.entries(newData).filter(([, v]) => Array.isArray(v) && v.every((x) => x && typeof x === 'object')).map(([k]) => k),
  ]);
  for (const name of arrayNames) {
    const oldList = Array.isArray(oldData[name]) ? oldData[name] : [];
    const newList = Array.isArray(newData[name]) ? newData[name] : [];
    const secs = sections.filter((s) => s.kind === 'array' && s.name === name);
    newList.forEach((obj, i) => {
      if (secs[i]) patchSection(secs[i], oldList[i] || {}, obj);
      else {
        const last = sections[sections.length - 1];
        if (last.lines.length && last.lines[last.lines.length - 1].trim() !== '') last.lines.push('');
        sections.push(newTableSection('array', name, obj));
      }
    });
    for (let i = newList.length; i < secs.length; i++) {
      sections.splice(sections.indexOf(secs[i]), 1);
    }
  }

  let out = sections.map((s) => s.lines.join('\n')).join('\n');
  if (!out.endsWith('\n')) out += '\n';
  out = out.replace(/\n{3,}/g, '\n\n');
  // Safety net: the result must parse back to exactly what was asked for.
  const check = TOML.parse(out);
  if (JSON.stringify(normalize(check)) !== JSON.stringify(normalize(newData))) {
    throw new Error('Internal error: patched dedicated.toml does not match the edited settings');
  }
  return out;
}

/** Drop empty tables and sort keys, for comparison. */
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      const x = v[k];
      if (x === undefined || x === null) continue;
      if (x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 0) continue;
      out[k] = normalize(x);
    }
    return out;
  }
  return v;
}

module.exports = { patchToml, parseToml: (t) => TOML.parse(t), formatValue, normalize };
