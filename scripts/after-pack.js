'use strict';

// electron-builder afterPack hook: drops Electron files the app never uses, to shrink the exe.
// dxcompiler.dll and dxil.dll are the DirectX shader compiler for WebGPU. Nothing in the app
// or on Steam's Workshop pages uses WebGPU, and Chromium falls back to d3dcompiler_47.dll.

const fs = require('fs');
const path = require('path');

const UNUSED = ['dxcompiler.dll', 'dxil.dll'];

exports.default = async function afterPack({ appOutDir }) {
  for (const name of UNUSED) fs.rmSync(path.join(appOutDir, name), { force: true });
};
