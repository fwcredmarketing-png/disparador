import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdaterStatus } from '@shared/types'

let current: UpdaterStatus = { state: 'idle' }

/**
 * Atualização automática via GitHub Releases.
 * Toda vez que uma nova versão é publicada (tag vX.Y.Z), o app baixa sozinho
 * e oferece "Reiniciar e atualizar".
 */
export function setupUpdater(getWin: () => BrowserWindow | null): {
  status: () => UpdaterStatus
  check: () => Promise<void>
  install: () => void
} {
  const set = (s: UpdaterStatus) => {
    current = s
    getWin()?.webContents.send('updater:status', s)
  }

  if (!app.isPackaged) {
    current = { state: 'dev' }
    return { status: () => current, check: async () => set({ state: 'dev' }), install: () => {} }
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-available', (i) => set({ state: 'available', version: i.version }))
  autoUpdater.on('update-not-available', () => set({ state: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    set({ state: 'downloading', percent: Math.round(p.percent), version: current.version })
  )
  autoUpdater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version }))
  const onError = (e: unknown) => {
    const msg = (e as Error)?.message ?? String(e)
    // repositório ainda sem nenhuma release publicada: não é erro
    if (/No published versions/i.test(msg)) set({ state: 'none' })
    else set({ state: 'error', error: msg.split('\n')[0] })
  }
  autoUpdater.on('error', onError)

  const check = async () => {
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      onError(e)
    }
  }

  setTimeout(check, 5_000)
  setInterval(check, 30 * 60_000)

  return {
    status: () => current,
    check,
    install: () => autoUpdater.quitAndInstall(false, true)
  }
}
