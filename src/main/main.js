'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, session } = require('electron');
const settings = require('./settings');
const assets = require('./assets');
const workspace = require('./workspace');
const mods = require('./mods');
const serverConfig = require('./server-config');
const exporter = require('./export');
const mccVariants = require('./mcc-variants');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const isHttpUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

let mainWindow = null;
let allowClose = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#05101c',
    title: 'Halo 3 Server Manager',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // Workshop browser (Mods tab)
    },
  });
  mainWindow = win;

  // Links that try to open a new window go to the system browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Closing asks the renderer first, so it can prompt about unsaved work.
  win.on('close', (e) => {
    if (allowClose || (process.env.SMOKE_TEST && !process.env.SMOKE_TEST_CLOSE)) return;
    e.preventDefault();
    win.webContents.send('app:close-requested');
  });

  win.loadFile(path.join(RENDERER_DIR, 'index.html'));

  // `npm run smoke`: print renderer console output, then quit once the page has settled.
  if (process.env.SMOKE_TEST) {
    win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`));
    win.webContents.on('did-finish-load', () => {
      // SMOKE_TEST_CLOSE=<ms>: press the window's close button after that delay.
      if (process.env.SMOKE_TEST_CLOSE) setTimeout(() => win.close(), Number(process.env.SMOKE_TEST_CLOSE));
      setTimeout(async () => {
        if (process.env.SMOKE_SCRIPT) {
          try {
            const out = await win.webContents.executeJavaScript(fs.readFileSync(process.env.SMOKE_SCRIPT, 'utf8'));
            console.log(`SMOKE SCRIPT: ${typeof out === 'string' ? out : JSON.stringify(out)}`);
          } catch (err) {
            console.log(`SMOKE SCRIPT ERROR: ${err.message}`);
          }
        }
        if (process.env.SMOKE_SHOT) {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.SMOKE_SHOT, img.toPNG());
        }
        const title = await win.webContents.executeJavaScript('document.title');
        console.log(`SMOKE OK: ${title}`);
        app.exit(0);
      }, Number(process.env.SMOKE_WAIT || 1500));
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      console.error(`SMOKE FAIL: ${code} ${desc}`);
      app.exit(1);
    });
  }
}

/** Register every ipcMain.handle channel. Feature modules add theirs here. */
function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args));

  handle('app:info', () => ({ version: app.getVersion(), userData: app.getPath('userData') }));

  handle('shell:openExternal', (url) => (isHttpUrl(url) ? shell.openExternal(url) : undefined));
  handle('shell:openPath', (p) => (typeof p === 'string' && fs.existsSync(p) ? shell.openPath(p) : 'Path not found'));
  handle('shell:showItem', (p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });
  handle('fs:exists', (paths) => Object.fromEntries((paths || []).map((p) => [p, typeof p === 'string' && p !== '' && fs.existsSync(p)])));
  handle('steam:clearLogin', () => session.fromPartition('persist:steam').clearStorageData());
  handle('clipboard:write', (text) => clipboard.writeText(String(text ?? '')));

  handle('dialog:pickFolder', async (opts = {}) => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: opts.title || 'Choose folder',
      defaultPath: opts.defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('dialog:pickFile', async (opts = {}) => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: opts.title || 'Choose file',
      defaultPath: opts.defaultPath || undefined,
      filters: opts.filters || undefined,
      properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile'],
    });
    if (r.canceled) return null;
    return opts.multi ? r.filePaths : r.filePaths[0];
  });

  handle('settings:get', () => settings.get());
  handle('settings:update', (patch) => settings.update(patch));
  handle('settings:detect', () => settings.fillDefaults({ force: true }));

  handle('app:confirmClose', () => { allowClose = true; mainWindow?.close(); });

  handle('workspace:list', (kind) => workspace.list(kind));
  handle('workspace:read', (kind, id) => workspace.read(kind, id));
  handle('workspace:write', (kind, id, data) => workspace.write(kind, id, data));
  handle('workspace:remove', (kind, ids) => workspace.remove(kind, ids));
  handle('workspace:import', (kind, files) => workspace.importFiles(kind, files));
  handle('workspace:root', () => workspace.root());
  handle('workspace:forgeMaps', () => workspace.listForgeMaps());
  handle('workspace:disabledMods', () => workspace.readDisabledMods());
  handle('workspace:setModDisabled', (folder, disabled) => workspace.setModDisabled(folder, disabled));

  handle('server:read', () => serverConfig.read());
  handle('server:write', (data) => serverConfig.write(data));
  handle('server:createDefault', () => serverConfig.createDefault());
  handle('server:import', (file) => serverConfig.importFrom(file));

  handle('export:plan', () => exporter.plan());
  handle('export:markUploaded', (modIds) => exporter.markUploaded(modIds));
  handle('export:forgetMod', (id) => exporter.forgetMod(id));
  handle('export:stageMod', (id) => exporter.stageMod(id, (p) => mainWindow?.webContents.send('export:progress', p)));
  handle('export:cancelStaging', () => exporter.cancelStaging());
  handle('export:unstageMod', (id) => exporter.unstageMod(id));
  handle('export:runCheck', () => exporter.runCheck());

  handle('mods:scan', () => mods.scan());
  handle('mods:cached', () => mods.cached());
  handle('mods:setSubscriptions', (list) => mods.setSubscriptions(list));
  handle('mods:watch', (on) => {
    if (on) return mods.startWatching(() => mainWindow?.webContents.send('mods:changed'));
    mods.stopWatching();
    return 0;
  });
  handle('mods:isWatching', () => mods.isWatching());

  handle('mcc:baseModeDefaults', () => mccVariants.baseModeDefaults(settings.get().mccPath));

  handle('assets:backdropUrl', () => assets.backdropUrl());
  handle('assets:mapImageUrls', () => assets.mapImageUrls());
  handle('assets:mapImagesDir', () => {
    fs.mkdirSync(assets.mapImagesDir(), { recursive: true });
    return assets.mapImagesDir();
  });
}

// The Workshop <webview>: always the persistent Steam session, never Node or a preload.
// Steam links that open new windows load in the same view; anything else goes to the system browser.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (_ev, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    params.partition = 'persist:steam';
  });
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/(steamcommunity\.com|store\.steampowered\.com|login\.steampowered\.com)\//i.test(url)) contents.loadURL(url);
      else if (isHttpUrl(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (ev, url) => {
      if (!/^https?:\/\//i.test(url)) ev.preventDefault();
    });
  }
});

app.whenReady().then(async () => {
  await settings.fillDefaults();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
