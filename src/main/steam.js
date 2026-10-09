'use strict';

// Local Steam discovery. Reads only files on this PC and the registry;
// never contacts Steam.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { parseVdf } = require('./vdf');

const MCC_APP_ID = '976730';
const MCC_FOLDER = 'Halo The Master Chief Collection';

function regQuery(key, value) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const m = stdout.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`));
      resolve(m ? m[1].trim() : null);
    });
  });
}

/** Steam install folder, from the registry or the default location. */
async function detectSteamPath() {
  const fromReg = await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  const candidates = [fromReg, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean);
  for (const c of candidates) {
    const p = path.normalize(c);
    if (fs.existsSync(path.join(p, 'steamapps'))) return p;
  }
  return null;
}

/** Every Steam library folder listed in libraryfolders.vdf: [{ path, apps: Set }] */
function readLibraries(steamPath) {
  if (!steamPath) return [];
  const file = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  try {
    const data = parseVdf(fs.readFileSync(file, 'utf8'));
    const root = data.libraryfolders || data.LibraryFolders || {};
    const libs = [];
    for (const entry of Object.values(root)) {
      if (entry && typeof entry === 'object' && entry.path) {
        libs.push({ path: path.normalize(entry.path), apps: new Set(Object.keys(entry.apps || {})) });
      } else if (typeof entry === 'string' && /^[a-z]:/i.test(entry)) {
        libs.push({ path: path.normalize(entry), apps: new Set() }); // old format: "1" "D:\\Lib"
      }
    }
    if (!libs.some((l) => l.path.toLowerCase() === steamPath.toLowerCase())) libs.unshift({ path: steamPath, apps: new Set() });
    return libs;
  } catch {
    return [{ path: steamPath, apps: new Set() }];
  }
}

/** MCC install folder, or null. */
function findMccPath(steamPath) {
  const libs = readLibraries(steamPath);
  const ordered = [...libs.filter((l) => l.apps.has(MCC_APP_ID)), ...libs.filter((l) => !l.apps.has(MCC_APP_ID))];
  for (const lib of ordered) {
    const p = path.join(lib.path, 'steamapps', 'common', MCC_FOLDER);
    if (fs.existsSync(path.join(p, 'halo3'))) return p;
  }
  return null;
}

/** Workshop content folders for MCC in every library that has them. */
function workshopRoots(steamPath) {
  return readLibraries(steamPath)
    .map((lib) => ({
      library: lib.path,
      acf: path.join(lib.path, 'steamapps', 'workshop', `appworkshop_${MCC_APP_ID}.acf`),
      content: path.join(lib.path, 'steamapps', 'workshop', 'content', MCC_APP_ID),
    }))
    .filter((r) => fs.existsSync(r.acf) || fs.existsSync(r.content));
}

module.exports = { MCC_APP_ID, detectSteamPath, readLibraries, findMccPath, workshopRoots };
