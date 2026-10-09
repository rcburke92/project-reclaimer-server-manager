'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { readIndex, readTexture, decode, packPaths, encodePng } = require('../src/main/mcc-textures');
const maps = require('../src/catalog/maps.json');

const MCC = require('./mcc-path');

test('decodes a BC1 block', () => {
  // c0 = pure red (0xF800), c1 = pure blue (0x001F), every pixel index 0 -> red.
  const block = Buffer.from([0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0]);
  const rgba = decode(block, 4, 4);
  assert.deepStrictEqual([...rgba.subarray(0, 4)], [255, 0, 0, 255]);
});

test('encodes a valid PNG signature and size', () => {
  const png = encodePng(2, 1, Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]));
  assert.strictEqual(png.subarray(1, 4).toString(), 'PNG');
  assert.strictEqual(png.readUInt32BE(16), 2);
});

test('every stock map has a preview in the MCC pack', { skip: !MCC || !fs.existsSync(packPaths(MCC).perm) }, () => {
  const index = readIndex(packPaths(MCC).perm);
  for (const m of maps.maps) {
    assert.ok(index.has(`${m.preview}_LARGE`), m.preview);
    const tex = readTexture(MCC, `${m.preview}_LARGE`);
    assert.strictEqual(tex.rgba.length, tex.width * tex.height * 4);
  }
});
