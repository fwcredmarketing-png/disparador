import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Campaign, Contact, Settings } from '@shared/types'
import { today } from './utils'

interface DB {
  version: number
  settings: Settings
  contacts: Contact[]
  campaigns: Campaign[]
  sent: Record<string, number> // data -> quantidade enviada
}

const defaultSettings: Settings = {
  provider: 'baileys',
  cloud: { token: '', phoneNumberId: '', apiVersion: 'v21.0' },
  dailyLimit: 300,
  optOutKeywords: ['SAIR', 'PARAR', 'STOP', 'CANCELAR', 'DESCADASTRAR'],
  appendOptOut: true,
  optOutText: 'Responda SAIR para não receber mais mensagens.',
  simulateTyping: true
}

const ENC = 'enc:'

function encrypt(v: string): string {
  if (!v || !safeStorage.isEncryptionAvailable()) return v
  return ENC + safeStorage.encryptString(v).toString('base64')
}
function decrypt(v: string): string {
  if (!v?.startsWith(ENC)) return v
  try {
    return safeStorage.decryptString(Buffer.from(v.slice(ENC.length), 'base64'))
  } catch {
    return ''
  }
}

/** Banco de dados local em JSON, salvo na pasta de dados do usuário (não vai para o GitHub). */
class Store {
  readonly dir = app.getPath('userData')
  readonly authDir = join(this.dir, 'wa-auth')
  private file = join(this.dir, 'dados.json')
  private timer: NodeJS.Timeout | null = null
  data!: DB

  load(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
    let raw: Partial<DB> = {}
    if (existsSync(this.file)) {
      try {
        raw = JSON.parse(readFileSync(this.file, 'utf8'))
      } catch {
        renameSync(this.file, this.file + `.corrompido-${Date.now()}`)
      }
    }
    this.data = {
      version: 1,
      contacts: raw.contacts ?? [],
      campaigns: raw.campaigns ?? [],
      sent: raw.sent ?? {},
      settings: {
        ...defaultSettings,
        ...(raw.settings ?? {}),
        cloud: { ...defaultSettings.cloud, ...(raw.settings?.cloud ?? {}) }
      }
    }
    // campanhas que estavam rodando quando o app fechou ficam pausadas
    for (const c of this.data.campaigns) {
      if (c.status === 'running') {
        c.status = 'paused'
        c.note = 'Pausada porque o sistema foi fechado'
        c.nextSendAt = undefined
      }
    }
    this.flush()
  }

  save(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 400)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.data))
    renameSync(tmp, this.file)
  }

  // ---------- Configurações ----------
  getSettings(): Settings {
    const s = this.data.settings
    return { ...s, cloud: { ...s.cloud, token: decrypt(s.cloud.token) } }
  }

  saveSettings(patch: Partial<Settings>): Settings {
    const cur = this.getSettings()
    const next: Settings = { ...cur, ...patch, cloud: { ...cur.cloud, ...(patch.cloud ?? {}) } }
    next.dailyLimit = Math.max(1, Math.floor(Number(next.dailyLimit) || 1))
    next.optOutKeywords = next.optOutKeywords.map((k) => k.trim().toUpperCase()).filter(Boolean)
    this.data.settings = { ...next, cloud: { ...next.cloud, token: encrypt(next.cloud.token) } }
    this.save()
    return next
  }

  // ---------- Contadores ----------
  sentToday(): number {
    return this.data.sent[today()] ?? 0
  }

  incSent(): void {
    const k = today()
    this.data.sent[k] = (this.data.sent[k] ?? 0) + 1
    this.save()
  }
}

export const store = new Store()
