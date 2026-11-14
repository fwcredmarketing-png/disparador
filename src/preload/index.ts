import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api } from '@shared/types'

const invoke = <T = unknown>(ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args) as Promise<T>

const on = <T>(ch: string, cb: (d: T) => void) => {
  const h = (_e: unknown, d: T) => cb(d)
  ipcRenderer.on(ch, h)
  return () => {
    ipcRenderer.removeListener(ch, h)
  }
}

const api: Api = {
  appVersion: () => invoke('app:version'),
  auth: {
    state: () => invoke('auth:state'),
    login: (email, password) => invoke('auth:login', email, password),
    logout: () => invoke('auth:logout'),
    changePassword: (current, next) => invoke('auth:changePassword', current, next),
    retry: () => invoke('auth:retry'),
    onChange: (cb) => on('auth:changed', cb)
  },
  team: {
    list: () => invoke('team:list'),
    add: (m) => invoke('team:add', m),
    remove: (email) => invoke('team:remove', email)
  },
  settings: {
    get: () => invoke('settings:get'),
    save: (s) => invoke('settings:save', s)
  },
  wa: {
    status: () => invoke('wa:status'),
    connect: () => invoke('wa:connect'),
    disconnect: () => invoke('wa:disconnect'),
    logout: () => invoke('wa:logout'),
    onStatus: (cb) => on('wa:status', cb)
  },
  contacts: {
    list: () => invoke('contacts:list'),
    add: (c) => invoke('contacts:add', c),
    remove: (id) => invoke('contacts:remove', id),
    clear: () => invoke('contacts:clear'),
    setOptOut: (id, v) => invoke('contacts:optout', id, v),
    importFile: (tags) => invoke('contacts:import', tags),
    tags: () => invoke('contacts:tags'),
    onChanged: (cb) => on('contacts:changed', cb)
  },
  campaigns: {
    list: () => invoke('campaigns:list'),
    log: (id) => invoke('campaigns:log', id),
    create: (c) => invoke('campaigns:create', c),
    start: (id) => invoke('campaigns:start', id),
    pause: (id) => invoke('campaigns:pause', id),
    cancel: (id) => invoke('campaigns:cancel', id),
    remove: (id) => invoke('campaigns:remove', id),
    exportReport: (id) => invoke('campaigns:export', id),
    onProgress: (cb) => on('campaign:progress', cb),
    onSent: (cb) => on('campaign:sent', cb)
  },
  stats: {
    get: () => invoke('stats:get')
  },
  dialog: {
    pickMedia: () => invoke('dialog:media')
  },
  media: {
    info: (path) => invoke('media:info', path),
    pasteImage: (bytes, mime) => invoke('media:pasteImage', bytes, mime),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  updater: {
    status: () => invoke('updater:status'),
    check: () => invoke('updater:check'),
    install: () => invoke('updater:install'),
    onStatus: (cb) => on('updater:status', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
