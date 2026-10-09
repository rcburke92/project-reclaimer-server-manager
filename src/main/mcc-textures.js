'use strict';

// Reads map preview images from MCC's UI texture packs
// (Data/ui/texturepacks/levelstexturepack.perm.bin + .temp.bin).
//
// perm.bin is an index of 480-byte entries. Relative to the 4-byte marker
// bf fa 43 8b that precedes each name:
//   +4    name (ASCII, NUL-padded, e.g. "H3MP_VALHALLA_LARGE")
//   +40   u32 format, +52 u16 width, +54 u16 height
//   +72   u32 data size, +80 u64 offset into temp.bin
// Pixel data is BC1 (DXT1) or BC3 (DXT5), told apart by its size.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MARKER = Buffer.from([0xbf, 0xfa, 0x43, 0x8b]);

function packPaths(mccPath, pack = 'levelstexturepack') {
  const dir = path.join(mccPath, 'Data', 'ui', 'texturepacks');
  return { perm: path.join(dir, `${pack}.perm.bin`), temp: path.join(dir, `${pack}.temp.bin`) };
}

/** Index of a pack: Map name -> { width, height, size, offset } */
function readIndex(permFile) {
  const b = fs.readFileSync(permFile);
  const out = new Map();
  let i = b.indexOf(MARKER);
  while (i >= 0 && i + 96 <= b.length) {
    const nameEnd = b.indexOf(0, i + 4);
    const name = b.toString('latin1', i + 4, Math.min(nameEnd, i + 4 + 64));
    const width = b.readUInt16LE(i + 52);
    const height = b.readUInt16LE(i + 54);
    const size = b.readUInt32LE(i + 72);
    const offset = Number(b.readBigUInt64LE(i + 80));
    if (/^[\x20-\x7e]+$/.test(name) && width && height && size) out.set(name, { width, height, size, offset });
    i = b.indexOf(MARKER, i + 4);
  }
  return out;
}

// ---------------------------------------------------------------- BCn decoding

function rgb565(c) {
  return [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
}

/** Decode one BC1 colour block into 16 RGBA pixels (writes into out at the block's position). */
function colorBlock(src, at, out, width, height, bx, by, forceOpaque) {
  const c0 = src.readUInt16LE(at);
  const c1 = src.readUInt16LE(at + 2);
  const bits = src.readUInt32LE(at + 4);
  const p0 = rgb565(c0);
  const p1 = rgb565(c1);
  const pal = [[...p0, 255], [...p1, 255]];
  if (c0 > c1 || forceOpaque) {
    pal.push([(2 * p0[0] + p1[0]) / 3, (2 * p0[1] + p1[1]) / 3, (2 * p0[2] + p1[2]) / 3, 255]);
    pal.push([(p0[0] + 2 * p1[0]) / 3, (p0[1] + 2 * p1[1]) / 3, (p0[2] + 2 * p1[2]) / 3, 255]);
  } else {
    pal.push([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2, 255]);
    pal.push([0, 0, 0, 0]);
  }
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const x = bx * 4 + px;
      const y = by * 4 + py;
      if (x >= width || y >= height) continue;
      const c = pal[(bits >> (2 * (py * 4 + px))) & 3];
      const o = (y * width + x) * 4;
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = c[3];
    }
  }
}

/** BC3 alpha block -> overwrite alpha of the 16 pixels. */
function alphaBlock(src, at, out, width, height, bx, by) {
  const a0 = src[at];
  const a1 = src[at + 1];
  const pal = [a0, a1];
  if (a0 > a1) for (let k = 1; k <= 6; k++) pal.push(((7 - k) * a0 + k * a1) / 7);
  else { for (let k = 1; k <= 4; k++) pal.push(((5 - k) * a0 + k * a1) / 5); pal.push(0, 255); }
  let bits = 0n;
  for (let k = 0; k < 6; k++) bits |= BigInt(src[at + 2 + k]) << BigInt(8 * k);
  for (let p = 0; p < 16; p++) {
    const x = bx * 4 + (p % 4);
    const y = by * 4 + Math.floor(p / 4);
    if (x >= width || y >= height) continue;
    out[(y * width + x) * 4 + 3] = pal[Number((bits >> BigInt(3 * p)) & 7n)];
  }
}

/** Decode BC1/BC3 data to an RGBA buffer. */
function decode(data, width, height) {
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  const out = Buffer.alloc(width * height * 4);
  if (data.length === bw * bh * 8) {
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) colorBlock(data, (by * bw + bx) * 8, out, width, height, bx, by, false);
  } else if (data.length === bw * bh * 16) {
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        const at = (by * bw + bx) * 16;
        colorBlock(data, at + 8, out, width, height, bx, by, true);
        alphaBlock(data, at, out, width, height, bx, by);
      }
    }
  } else if (data.length === width * height * 4) {
    data.copy(out);
  } else {
    throw new Error(`Unknown texture format (${width}x${height}, ${data.length} bytes)`);
  }
  return out;
}

/** RGBA pixels of one named texture from a pack. */
function readTexture(mccPath, name, pack = 'levelstexturepack') {
  const { perm, temp } = packPaths(mccPath, pack);
  const entry = readIndex(perm).get(name);
  if (!entry) return null;
  const fd = fs.openSync(temp, 'r');
  try {
    const data = Buffer.alloc(entry.size);
    fs.readSync(fd, data, 0, entry.size, entry.offset);
    return { width: entry.width, height: entry.height, rgba: decode(data, entry.width, entry.height) };
  } finally {
    fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------- PNG

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode RGBA pixels as a PNG file. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height); // filter byte 0 per row
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { readIndex, readTexture, decode, packPaths, encodePng };
