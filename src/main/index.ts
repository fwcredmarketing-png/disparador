import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { CampaignInput, Contact, Settings, Stats } from '@shared/types'
import { store } from './store'
import { CampaignEngine, summarize } from './campaign'
import { WhatsAppManager } from './whatsapp/manager'
import { setupUpdater } from './updater'
import { normalizePhone, normalizeText, parseContactsFile, today, uid } from './utils'

let win: BrowserWindow | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.whenReady().then(bootstrap)
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#050814',
    title: 'Sistema de Disparo',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#cfe9ff', height: 38 },
    autoHideMenuBar: true,
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  w.once('ready-to-show', () => w.show())
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    w.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    w.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return w
}

function bootstrap(): void {
  store.load()
  const wa = new WhatsAppManager()
  const engine = new CampaignEngine(wa)
  win = createWindow()
  const updater = setupUpdater(() => win)

  const send = (channel: string, data?: unknown) => win?.webContents.send(channel, data)

  // ---------- Eventos para a interface ----------
  wa.on('status', (s) => send('wa:status', s))
  engine.on('progress', (c) => send('campaign:progress', c))
  engine.on('sent', () => send('campaign:sent'))

  // Descadastro automático: contato responde "SAIR"
  wa.on('incoming', ({ phone, text }: { phone: string; text: string }) => {
    const kw = store.getSettings().optOutKeywords
    if (!kw.includes(normalizeText(text))) return
    const c = store.data.contacts.find((x) => x.phone === phone || x.phone.endsWith(phone.slice(-10)))
    if (c && !c.optOut) {
      c.optOut = true
      store.save()
      send('contacts:changed')
    }
  })

  // Reconecta automaticamente se já houver sessão salva
  const s = store.getSettings()
  if (s.provider === 'cloud' ? s.cloud.token && s.cloud.phoneNumberId : true) {
    wa.connect().catch(() => {})
  }

  // ---------- IPC ----------
  const handle = (ch: string, fn: (...args: any[]) => unknown) => // eslint-disable-line @typescript-eslint/no-explicit-any
    ipcMain.handle(ch, (_e, ...args) => fn(...args))

  handle('app:version', () => app.getVersion())

  handle('settings:get', () => store.getSettings())
  handle('settings:save', async (patch: Partial<Settings>) => {
    const prev = store.getSettings()
    if (patch.provider && patch.provider !== prev.provider && engine.running)
      throw new Error('Pause a campanha em andamento antes de trocar o tipo de conexão')
    const next = store.saveSettings(patch)
    if (next.provider !== prev.provider) await wa.switchTo(prev.provider)
    return next
  })

  handle('wa:status', () => wa.status())
  handle('wa:connect', () => wa.connect())
  handle('wa:disconnect', () => wa.disconnect())
  handle('wa:logout', () => wa.logout())

  handle('contacts:list', () => store.data.contacts)
  handle('contacts:tags', () => [...new Set(store.data.contacts.flatMap((c) => c.tags))].sort())
  handle('contacts:add', (input: { name: string; phone: string; tags: string[] }) => {
    const phone = normalizePhone(input.phone)
    if (!phone) throw new Error('Telefone inválido')
    if (store.data.contacts.some((c) => c.phone === phone)) throw new Error('Esse número já está cadastrado')
    const c: Contact = {
      id: uid(),
      name: input.name?.trim() ?? '',
      phone,
      tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
      optOut: false,
      createdAt: Date.now()
    }
    store.data.contacts.unshift(c)
    store.save()
    return c
  })
  handle('contacts:remove', (id: string) => {
    store.data.contacts = store.data.contacts.filter((c) => c.id !== id)
    store.save()
  })
  handle('contacts:clear', () => {
    if (engine.running) throw new Error('Pause a campanha em andamento antes de limpar os contatos')
    store.data.contacts = []
    store.save()
  })
  handle('contacts:optout', (id: string, optOut: boolean) => {
    const c = store.data.contacts.find((x) => x.id === id)
    if (c) c.optOut = optOut
    store.save()
  })
  handle('contacts:import', async (extraTags: string[]) => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Importar contatos',
      filters: [{ name: 'Planilha CSV / Texto', extensions: ['csv', 'txt'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const rows = parseContactsFile(await readFile(r.filePaths[0], 'utf8'))
    const existing = new Set(store.data.contacts.map((c) => c.phone))
    let added = 0
    let duplicates = 0
    let invalid = 0
    const tags = (extraTags ?? []).map((t) => t.trim()).filter(Boolean)
    for (const row of rows) {
      const phone = normalizePhone(row.phone)
      if (!phone) {
        invalid++
        continue
      }
      if (existing.has(phone)) {
        duplicates++
        continue
      }
      existing.add(phone)
      store.data.contacts.push({
        id: uid(),
        name: row.name,
        phone,
        tags: [...new Set([...row.tags, ...tags])],
        optOut: false,
        createdAt: Date.now()
      })
      added++
    }
    store.save()
    return { added, duplicates, invalid }
  })

  handle('campaigns:list', () => store.data.campaigns.map(summarize))
  handle('campaigns:create', (input: CampaignInput) => engine.create(input))
  handle('campaigns:start', (id: string) => engine.start(id))
  handle('campaigns:pause', (id: string) => engine.pause(id))
  handle('campaigns:cancel', (id: string) => engine.cancel(id))
  handle('campaigns:remove', (id: string) => engine.remove(id))
  handle('campaigns:export', async (id: string) => {
    const c = store.data.campaigns.find((x) => x.id === id)
    if (!c) return false
    const r = await dialog.showSaveDialog(win!, {
      title: 'Exportar relatório',
      defaultPath: `relatorio-${c.name.replace(/[^\w-]+/g, '_')}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (r.canceled || !r.filePath) return false
    const label: Record<string, string> = {
      pending: 'Pendente',
      sent: 'Enviado',
      failed: 'Falhou',
      invalid: 'Sem WhatsApp',
      skipped: 'Ignorado'
    }
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [
      'Nome;Telefone;Status;Detalhe;Data',
      ...c.results.map((x) =>
        [esc(x.name), x.phone, label[x.status], esc(x.error ?? ''), x.at ? new Date(x.at).toLocaleString('pt-BR') : ''].join(';')
      )
    ]
    await writeFile(r.filePath, '﻿' + lines.join('\r\n'), 'utf8')
    return true
  })

  handle('stats:get', (): Stats => {
    const history = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const k = today(d)
      return { date: k, count: store.data.sent[k] ?? 0 }
    })
    return {
      totalContacts: store.data.contacts.length,
      optOuts: store.data.contacts.filter((c) => c.optOut).length,
      sentToday: store.sentToday(),
      dailyLimit: store.getSettings().dailyLimit,
      totalSent: Object.values(store.data.sent).reduce((a, b) => a + b, 0),
      history,
      runningCampaign: engine.running
        ? store.data.campaigns.find((c) => c.id === engine.running)?.name
        : undefined
    }
  })

  handle('dialog:media', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Escolher mídia',
      filters: [
        { name: 'Mídias', extensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mp3', 'ogg', 'pdf', 'docx', 'xlsx'] }
      ],
      properties: ['openFile']
    })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  handle('updater:status', () => updater.status())
  handle('updater:check', () => updater.check())
  handle('updater:install', () => {
    store.flush()
    updater.install()
  })

  app.on('before-quit', () => store.flush())
}

app.on('window-all-closed', () => {
  store.flush()
  app.quit()
})
