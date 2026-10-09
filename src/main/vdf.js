'use strict';

// Parser for Valve's text KeyValues format (libraryfolders.vdf, *.acf).
// Returns nested plain objects; all leaf values are strings.

function parseVdf(text) {
  let i = 0;
  const n = text.length;

  function skip() {
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '﻿') i++;
      else if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; }
      else break;
    }
  }

  function token() {
    skip();
    if (i >= n) return null;
    const c = text[i];
    if (c === '{' || c === '}') { i++; return { brace: c }; }
    if (c === '"') {
      i++;
      let s = '';
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[++i];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        } else s += text[i];
        i++;
      }
      i++; // closing quote
      return { str: s };
    }
    let s = ''; // unquoted token
    while (i < n && !/[\s{}"]/.test(text[i])) s += text[i++];
    return { str: s };
  }

  function object(closing) {
    const obj = {};
    for (;;) {
      const key = token();
      if (key === null) {
        if (closing) throw new Error('VDF: unexpected end of input');
        return obj;
      }
      if (key.brace === '}') {
        if (!closing) throw new Error('VDF: unexpected }');
        return obj;
      }
      if (key.brace) throw new Error('VDF: unexpected {');
      const val = token();
      if (val === null) throw new Error(`VDF: missing value for "${key.str}"`);
      if (val.brace === '}') throw new Error('VDF: unexpected }');
      obj[key.str] = val.brace === '{' ? object(true) : val.str;
    }
  }

  return object(false);
}

module.exports = { parseVdf };
