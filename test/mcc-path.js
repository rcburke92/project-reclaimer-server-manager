'use strict';

// Finds this PC's MCC install for the tests that read real game files.
// Set MCC_PATH to override. Those tests are skipped when MCC isn't found.

const { execFileSync } = require('child_process');
const { findMccPath } = require('../src/main/steam');

function steamPathFromRegistry() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true });
    return /SteamPath\s+REG_\w+\s+(.+)/.exec(out)?.[1].trim() || '';
  } catch {
    return '';
  }
}

module.exports = process.env.MCC_PATH
  || [steamPathFromRegistry(), 'C:\\Program Files (x86)\\Steam'].filter(Boolean).map(findMccPath).find(Boolean)
  || '';
