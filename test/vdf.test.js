'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseVdf } = require('../src/main/vdf');

test('parses nested objects, escapes and comments', () => {
  const v = parseVdf([
    '// comment',
    '"libraryfolders"',
    '{',
    '  "0" { "path" "C:\\\\Program Files (x86)\\\\Steam" "apps" { "976730" "123" } }',
    '  "1" { "path" "D:\\\\SteamLibrary" }',
    '}',
  ].join('\n'));
  assert.equal(v.libraryfolders['0'].path, 'C:\\Program Files (x86)\\Steam');
  assert.equal(v.libraryfolders['0'].apps['976730'], '123');
  assert.equal(v.libraryfolders['1'].path, 'D:\\SteamLibrary');
});

test('parses an appworkshop acf', () => {
  const v = parseVdf('"AppWorkshop"\n{\n\t"appid"\t\t"976730"\n\t"WorkshopItemsInstalled"\n\t{\n\t\t"2899741683"\n\t\t{\n\t\t\t"size"\t\t"6051009819"\n\t\t\t"timeupdated"\t\t"1758130638"\n\t\t}\n\t}\n}\n');
  assert.equal(v.AppWorkshop.WorkshopItemsInstalled['2899741683'].timeupdated, '1758130638');
});

test('throws on unbalanced braces', () => {
  assert.throws(() => parseVdf('"a" { "b" "c"'));
  assert.throws(() => parseVdf('"a" "b" }'));
});
