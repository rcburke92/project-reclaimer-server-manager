'use strict';

// Launches Electron with a clean environment. VS Code terminals set
// ELECTRON_RUN_AS_NODE=1, which makes Electron behave like plain Node.
// `--smoke` loads the window, prints renderer console output and exits.

const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron'); // path to the Electron binary

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (process.argv.includes('--smoke')) env.SMOKE_TEST = '1';

const child = spawn(electron, [path.join(__dirname, '..')], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
