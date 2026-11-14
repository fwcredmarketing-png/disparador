import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AuthState, CampaignInput, ImportResult, SepArquivo, SepCriterios, SepMapa, Settings, Stats } from '@shared/types'
import { store } from './store'
import { auth } from './supabase'
import { campaigns, contacts, stats, team } from './repo'
import { getSettings, refreshShared, saveSettings } from './settings'
import { CampaignEngine } from './campaign'
import { WhatsAppManager } from './whatsapp/manager'
import { SmsSender } from './sms'
import { setupUpdater } from './updater'
import { normalizePhone, normalizeText, parseContactsFile } from './utils'
import { EXTENSOES_MIDIA, mediaInfo, savePastedImage } from './media'
import { basename } from 'path'
import { lerPlanilha, type Tabela } from './planilha'
import { csvAprovados, csvModelo, csvRelatorio, detectarColunas, separar } from './separacao'

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
  // Soltar um arquivo fora da área de anexo faria a janela "abrir" o arquivo e sair do sistema
  w.webContents.on('will-navigate', (e) => e.preventDefault())
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
  const sms = new SmsSender(() => getSettings().sms)
  const engine = new CampaignEngine(wa, sms)
  win = createWindow()
  const updater = setupUpdater(() => win)

  const send = (channel: string, data?: unknown) => win?.webContents.send(channel, data)

  // ---------- Login ----------
  auth.on('change', async (s: AuthState) => {
    if (s.state === 'signedIn') {
      // carrega as configurações da equipe e libera campanhas presas deste computador
      await refreshShared().catch(() => {})
      await campaigns.releaseMine().catch(() => {})
    }
    send('auth:changed', s)
  })
  auth.init()

  // ---------- Eventos para a interface ----------
  wa.on('status', (s) => send('wa:status', s))
  engine.on('progress', (c) => send('campaign:progress', c))
  engine.on('sent', () => send('campaign:sent'))

  // Descadastro automático: contato responde "SAIR"
  wa.on('incoming', async ({ phone, text }: { phone: string; text: string }) => {
    if (auth.current.state !== 'signedIn') return
    if (!getSettings().optOutKeywords.includes(normalizeText(text))) return
    try {
      if (await contacts.optOutByPhone(phone)) send('contacts:changed')
    } catch {
      /* sem conexão com o banco: ignora */
    }
  })

  // Reconecta sozinho os números que já têm sessão salva neste computador
  // (número novo: o QR é gerado quando a pessoa clica em "Adicionar número")
  wa.connectSaved()

  // ---------- IPC ----------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Fn = (...args: any[]) => unknown
  const handle = (ch: string, fn: Fn) => ipcMain.handle(ch, (_e, ...args) => fn(...args))
  /** Canais que exigem login de um membro da equipe. */
  const authed = (ch: string, fn: Fn) =>
    handle(ch, (...args) => {
      auth.require()
      return fn(...args)
    })

  handle('app:version', () => app.getVersion())

  handle('auth:state', () => auth.current)
  handle('auth:login', (email: string, password: string) => auth.login(email, password))
  handle('auth:retry', () => auth.restore())
  handle('auth:logout', async () => {
    if (engine.running) throw new Error('Pause a campanha em andamento antes de sair')
    await auth.logout()
  })

  authed('auth:changePassword', (current: string, next: string) => auth.changePassword(current, next))

  authed('team:list', () => team.list())
  authed('team:add', (m: { email: string; name: string; admin: boolean }) => {
    auth.requireAdmin()
    return team.add(m)
  })
  authed('team:remove', (email: string) => {
    auth.requireAdmin()
    return team.remove(email)
  })

  authed('settings:get', () => refreshShared().catch(() => getSettings()))
  authed('settings:save', async (patch: Partial<Settings>) => {
    const prev = getSettings()
    if (patch.provider && patch.provider !== prev.provider && engine.running)
      throw new Error('Pause a campanha em andamento antes de trocar o tipo de conexão')
    const next = await saveSettings(patch)
    if (next.provider !== prev.provider) await wa.switchTo(prev.provider)
    return next
  })

  authed('wa:status', () => wa.overview())
  authed('wa:add', (phone?: string) => wa.add(phone))
  authed('wa:pair', (id: string, phone: string) => wa.pair(id, phone))
  authed('wa:useQr', (id: string) => wa.useQr(id))
  authed('wa:connect', (id: string) => wa.connect(id))
  authed('wa:disconnect', (id: string) => wa.disconnect(id))
  authed('wa:remove', (id: string) => wa.remove(id))

  // ---------- Separação de números (planilha com critérios) ----------
  // A planilha fica só na memória deste computador; só os aprovados vão para o banco.
  let planilha: { tabela: Tabela; nome: string } | null = null
  const abertaOuErro = () => {
    if (!planilha) throw new Error('Escolha a planilha de novo')
    return planilha
  }
  const salvarCsv = async (titulo: string, nome: string, conteudo: string) => {
    const r = await dialog.showSaveDialog(win!, { title: titulo, defaultPath: nome, filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }] })
    if (r.canceled || !r.filePath) return false
    await writeFile(r.filePath, conteudo, 'utf8')
    return true
  }
  const baseNome = () =>
    abertaOuErro()
      .nome.replace(/\.[^.]+$/, '')
      .replace(/[^\w-]+/g, '_')

  authed('sep:abrir', async (): Promise<SepArquivo | null> => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Planilha para separar os números',
      filters: [{ name: 'Planilha (Excel ou CSV)', extensions: ['xlsx', 'csv', 'txt'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const tabela = lerPlanilha(await readFile(r.filePaths[0]), r.filePaths[0])
    if (!tabela.linhas.length) throw new Error('A planilha está vazia')
    planilha = { tabela, nome: basename(r.filePaths[0]) }
    return {
      arquivo: planilha.nome,
      colunas: tabela.colunas,
      total: tabela.linhas.length,
      amostra: tabela.linhas.slice(0, 5).map((l) => tabela.colunas.map((_, i) => (l[i] === null || l[i] === undefined ? '' : String(l[i])))),
      mapa: detectarColunas(tabela)
    }
  })
  authed('sep:analisar', (mapa: SepMapa, crit: SepCriterios) => separar(abertaOuErro().tabela, mapa, crit).resultado)
  authed('sep:importar', async (mapa: SepMapa, crit: SepCriterios, etiqueta: string) => {
    const tag = (etiqueta ?? '').trim()
    if (!tag) throw new Error('Dê um nome para a etiqueta (é por ela que a campanha encontra esses contatos)')
    const s = separar(abertaOuErro().tabela, mapa, crit)
    const aprovados = s.linhas.filter((x) => x.ok && x.telefone).map((x) => ({ name: x.nome, phone: x.telefone! }))
    if (!aprovados.length) throw new Error('Nenhum número aprovado para importar')
    const r = await contacts.importWithTag(aprovados, tag)
    send('contacts:changed')
    return r
  })
  authed('sep:exportar', (mapa: SepMapa, crit: SepCriterios, tipo: 'aprovados' | 'relatorio') => {
    const { tabela } = abertaOuErro()
    const s = separar(tabela, mapa, crit)
    return tipo === 'aprovados'
      ? salvarCsv('Salvar números aprovados', `${baseNome()}-aprovados.csv`, csvAprovados(s))
      : salvarCsv('Salvar relatório da separação', `${baseNome()}-relatorio.csv`, csvRelatorio(tabela, s))
  })
  authed('sep:modelo', () => salvarCsv('Salvar modelo de planilha', 'modelo-separacao.csv', csvModelo()))

  authed('sms:test', (phone: string) => {
    const n = normalizePhone(phone ?? '')
    if (!n) throw new Error('Número inválido. Digite com DDD, por exemplo: 11 99999-8888.')
    return sms.send(n, 'Teste do Sistema de Disparo FW Cred: o SMS está configurado corretamente.')
  })

  authed('contacts:list', () => contacts.list())
  authed('contacts:tags', () => contacts.tags())
  authed('contacts:add', (input: { name: string; phone: string; tags: string[] }) => {
    const phone = normalizePhone(input.phone)
    if (!phone) throw new Error('Telefone inválido')
    return contacts.add({
      name: input.name?.trim() ?? '',
      phone,
      tags: [...new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean))]
    })
  })
  authed('contacts:remove', (id: string) => contacts.remove(id))
  authed('contacts:clear', () => {
    auth.requireAdmin()
    if (engine.running) throw new Error('Pause a campanha em andamento antes de limpar os contatos')
    return contacts.clear()
  })
  authed('contacts:optout', (id: string, optOut: boolean) => contacts.setOptOut(id, optOut))
  authed('contacts:import', async (extraTags: string[]): Promise<ImportResult | null> => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Importar contatos',
      filters: [{ name: 'Planilha CSV / Texto', extensions: ['csv', 'txt'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const parsed = parseContactsFile(await readFile(r.filePaths[0], 'utf8'))
    const tags = (extraTags ?? []).map((t) => t.trim()).filter(Boolean)
    const seen = new Set<string>()
    const rows: { name: string; phone: string; tags: string[] }[] = []
    let invalid = 0
    for (const row of parsed) {
      const phone = normalizePhone(row.phone)
      if (!phone) {
        invalid++
        continue
      }
      if (seen.has(phone)) continue
      seen.add(phone)
      rows.push({ name: row.name, phone, tags: [...new Set([...row.tags, ...tags])] })
    }
    const added = await contacts.importRows(rows)
    send('contacts:changed')
    return { added, duplicates: parsed.length - invalid - added, invalid }
  })

  authed('campaigns:list', async () => (await campaigns.list()).map((c) => engine.decorate(c)))
  authed('campaigns:log', (id: string) => campaigns.log(id))
  authed('campaigns:create', (input: CampaignInput) => engine.create(input))
  authed('campaigns:test', (input: CampaignInput, phone: string) => engine.test(input, phone))
  authed('campaigns:start', (id: string) => engine.start(id))
  authed('campaigns:pause', (id: string) => engine.pause(id))
  authed('campaigns:cancel', (id: string) => engine.cancel(id))
  authed('campaigns:remove', (id: string) => engine.remove(id))
  authed('campaigns:export', async (id: string) => {
    const c = await campaigns.get(id)
    const r = await dialog.showSaveDialog(win!, {
      title: 'Exportar relatório',
      defaultPath: `relatorio-${c.name.replace(/[^\w-]+/g, '_')}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (r.canceled || !r.filePath) return false
    const results = await campaigns.allResults(id)
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
      ...results.map((x) =>
        [esc(x.name), x.phone, label[x.status], esc(x.error ?? ''), x.at ? new Date(x.at).toLocaleString('pt-BR') : ''].join(';')
      )
    ]
    await writeFile(r.filePath, '﻿' + lines.join('\r\n'), 'utf8')
    return true
  })

  authed('stats:get', async (): Promise<Stats> => {
    // "enviadas hoje": soma dos números conectados aqui (cada um tem o seu limite diário)
    const nums = [...new Set(wa.senders().map((x) => x.me).filter(Boolean))]
    const [s, running, hoje] = await Promise.all([
      stats.get(nums.length === 1 ? nums[0] : undefined),
      engine.runningName ? Promise.resolve(engine.runningName) : campaigns.runningName().catch(() => undefined),
      nums.length > 1 ? Promise.all(nums.map((n) => stats.sentToday(n))) : Promise.resolve(null)
    ])
    return {
      ...s,
      sentToday: hoje ? hoje.reduce((a, b) => a + b, 0) : s.sentToday,
      dailyLimit: s.dailyLimit * Math.max(1, nums.length),
      numbers: nums.length,
      runningCampaign: running
    }
  })

  handle('dialog:media', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Anexar imagem ou arquivo',
      filters: [
        { name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
        { name: 'Todos os tipos aceitos', extensions: EXTENSOES_MIDIA }
      ],
      properties: ['openFile']
    })
    return r.canceled || !r.filePaths[0] ? null : mediaInfo(r.filePaths[0])
  })
  handle('media:info', (path: string) => mediaInfo(path))
  handle('media:pasteImage', (bytes: Uint8Array, mime: string) => savePastedImage(bytes, mime))

  handle('updater:status', () => updater.status())
  handle('updater:check', () => updater.check())
  handle('updater:install', () => {
    store.flush()
    updater.install()
  })

  // Ao fechar: pausa a campanha em andamento e libera a trava no banco
  let closing = false
  app.on('before-quit', (e) => {
    store.flush()
    if (closing || !engine.running) return
    e.preventDefault()
    closing = true
    engine.shutdown().finally(() => app.quit())
  })
}

app.on('window-all-closed', () => app.quit())
