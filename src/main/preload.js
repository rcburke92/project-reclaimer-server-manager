'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

// The only bridge between the UI and the main process. Each feature adds its
// channels here explicitly; the renderer never gets raw ipcRenderer access.
contextBridge.exposeInMainWorld('api', {
  appInfo: invoke('app:info'),
  openExternal: invoke('shell:openExternal'),
  openPath: invoke('shell:openPath'),
  showItem: invoke('shell:showItem'),
  copyText: invoke('clipboard:write'),
  exists: invoke('fs:exists'),
  clearSteamLogin: invoke('steam:clearLogin'),
  pickFolder: invoke('dialog:pickFolder'),
  pickFile: invoke('dialog:pickFile'),

  settings: {
    get: invoke('settings:get'),
    update: invoke('settings:update'),
    detect: invoke('settings:detect'),
  },

  onCloseRequested: (fn) => ipcRenderer.on('app:close-requested', () => fn()),
  confirmClose: invoke('app:confirmClose'),

  workspace: {
    list: invoke('workspace:list'),
    read: invoke('workspace:read'),
    write: invoke('workspace:write'),
    remove: invoke('workspace:remove'),
    import: invoke('workspace:import'),
    root: invoke('workspace:root'),
    forgeMaps: invoke('workspace:forgeMaps'),
    disabledMods: invoke('workspace:disabledMods'),
    setModDisabled: invoke('workspace:setModDisabled'),
  },

  server: {
    read: invoke('server:read'),
    write: invoke('server:write'),
    createDefault: invoke('server:createDefault'),
    import: invoke('server:import'),
  },

  reservedSlots: {
    read: invoke('reserved:read'),
    write: invoke('reserved:write'),
  },

  nextVote: {
    read: invoke('nextvote:read'),
    write: invoke('nextvote:write'),
  },

  export: {
    plan: invoke('export:plan'),
    markUploaded: invoke('export:markUploaded'),
    forgetMod: invoke('export:forgetMod'),
    stageMod: invoke('export:stageMod'),
    cancelStaging: invoke('export:cancelStaging'),
    unstageMod: invoke('export:unstageMod'),
    runCheck: invoke('export:runCheck'),
    onProgress: (fn) => ipcRenderer.on('export:progress', (_e, p) => fn(p)),
  },

  mods: {
    scan: invoke('mods:scan'),
    cached: invoke('mods:cached'),
    setSubscriptions: invoke('mods:setSubscriptions'),
    watch: invoke('mods:watch'),
    isWatching: invoke('mods:isWatching'),
    onChanged: (fn) => ipcRenderer.on('mods:changed', () => fn()),
  },

  baseModeDefaults: invoke('mcc:baseModeDefaults'),

  assets: {
    backdropUrl: invoke('assets:backdropUrl'),
    mapImageUrls: invoke('assets:mapImageUrls'),
    mapImagesDir: invoke('assets:mapImagesDir'),
  },
});
