import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { hostname } from 'os'
import { join } from 'path'
import type { LocalSettings } from '@shared/types'
import { uid } from './utils'

/**
 * Dados que pertencem a ESTE computador e não vão para o banco:
 * conexão do WhatsApp, token da API da Meta e a sessão de login.
 * Valores sensíveis são criptografados com o Windows (DPAPI).
 */
interface LocalData {
  machineId: string
  provider: LocalSettings['provider']
  cloud: LocalSettings['cloud']
  session: Record<string, string>
}

const defaults: Omit<LocalData, 'machineId'> = {
  provider: 'baileys',
  cloud: { token: '', phoneNumberId: '', apiVersion: 'v21.0' },
  session: {}
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

class LocalStore {
  readonly dir = app.getPath('userData')
  readonly authDir = join(this.dir, 'wa-auth')
  readonly mediaCacheDir = join(this.dir, 'midias-cache')
  private file = join(this.dir, 'local.json')
  private timer: NodeJS.Timeout | null = null
  private data!: LocalData

  load(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
    let raw: Partial<LocalData> = {}
    if (existsSync(this.file)) {
      try {
        raw = JSON.parse(readFileSync(this.file, 'utf8'))
      } catch {
        renameSync(this.file, this.file + `.corrompido-${Date.now()}`)
      }
    }
    this.data = {
      machineId: raw.machineId || uid(),
      provider: raw.provider ?? defaults.provider,
      cloud: { ...defaults.cloud, ...(raw.cloud ?? {}) },
      session: raw.session ?? {}
    }
    this.flush()
  }

  /** Identifica este computador na trava de campanhas. */
  get machineId(): string {
    return this.data.machineId
  }

  get machineName(): string {
    return hostname()
  }

  private save(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 300)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.data))
    renameSync(tmp, this.file)
  }

  getLocal(): LocalSettings {
    return {
      provider: this.data.provider,
      cloud: { ...this.data.cloud, token: decrypt(this.data.cloud.token) }
    }
  }

  saveLocal(patch: Partial<LocalSettings>): LocalSettings {
    const cur = this.getLocal()
    const next: LocalSettings = {
      provider: patch.provider ?? cur.provider,
      cloud: { ...cur.cloud, ...(patch.cloud ?? {}) }
    }
    this.data.provider = next.provider
    this.data.cloud = { ...next.cloud, token: encrypt(next.cloud.token) }
    this.save()
    return next
  }

  /** Armazenamento da sessão de login do Supabase (criptografado). */
  readonly authStorage = {
    getItem: (k: string): string | null => {
      const v = this.data.session[k]
      return v ? decrypt(v) || null : null
    },
    setItem: (k: string, v: string): void => {
      this.data.session[k] = encrypt(v)
      this.flush()
    },
    removeItem: (k: string): void => {
      delete this.data.session[k]
      this.flush()
    }
  }
}

export const store = new LocalStore()
