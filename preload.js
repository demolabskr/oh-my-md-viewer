'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, cb) => ipcRenderer.on(channel, (_e, ...args) => cb(...args));

contextBridge.exposeInMainWorld('api', {
  ready: () => ipcRenderer.invoke('app:ready'),
  onDoc: (cb) => on('doc:load', cb),
  onPrefs: (cb) => on('prefs', cb),
  onCommand: (cb) => on('cmd', cb),
  onRecent: (cb) => on('recent', cb),
  onScroll: (cb) => on('doc:scroll', cb),

  openDialog: () => ipcRenderer.invoke('file:dialog'),
  openPath: (p) => ipcRenderer.invoke('file:open', p),
  openLink: (href) => ipcRenderer.invoke('link:open', href),
  pathForFile: (f) => webUtils.getPathForFile(f),
  nav: (dir) => ipcRenderer.invoke('nav', dir),
  reveal: () => ipcRenderer.invoke('reveal'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  zoom: (dir) => ipcRenderer.invoke('zoom', dir),
  copyText: (t) => ipcRenderer.invoke('clipboard:write', String(t)),
  save: (text) => ipcRenderer.invoke('file:save', String(text)),
  saveAs: (text) => ipcRenderer.invoke('file:saveAs', String(text)),
  setDirty: (v) => ipcRenderer.invoke('doc:dirty', !!v),
  reportMode: (mode) => ipcRenderer.invoke('mode:report', mode),
});
