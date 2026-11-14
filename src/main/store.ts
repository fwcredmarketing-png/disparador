import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { hostname } from 'os'
import { join } from 'path'
import type { LocalSettings, SmsConfig, WaRotation } from '@shared/types'
import { SMS_PADRAO } from '@shared/sms'
import { uid } from './utils'

/**
 * Dados que pertencem a ESTE computador e não vão para o banco:
 * conexão do WhatsApp, token da API da Meta e a sessão de login.
 * Valores sensíveis são criptografados com o Windows (DPAPI).
 */
/** Um número de WhatsApp conectado por QR Code neste computador. */
export interface ConexaoQr {
  id: string
  pasta: string // pasta da sessão, relativa aos dados do app
  numero?: string // último número conectado nesta conexão
  nome?: string
  criadoEm: number
}

interface LocalData {
  machineId: string
  provider: LocalSettings['provider']
  rotation: WaRotation
  cloud: LocalSettings['cloud']
  sms: SmsConfig
  conexoes: ConexaoQr[]
  session: Record<string, string>
}

const defaults: Omit<LocalData, 'machineId' | 'conexoes'> = {
  provider: 'baileys',
  rotation: 'revezar',
  cloud: { token: '', phoneNumberId: '', apiVersion: 'v21.0' },
  sms: SMS_PADRAO,
  session: {}
}

/** Configurações de SMS salvas pela 1.0.7 não tinham autenticação em 2 passos: continuam sem. */
const SEM_AUTH_ANTIGO: Partial<SmsConfig> = { authUrl: '', authHeaders: '', authField: 'token', authHours: 24 }

/**
 * A pasta tem uma sessão do WhatsApp já pareada (QR Code lido ou código digitado no celular)?
 * "account" só existe depois do pareamento: ao pedir o código, o Baileys já grava "me", mas ainda não está pareado.
 */
export function temSessao(pasta: string): boolean {
  try {
    const creds = JSON.parse(readFileSync(join(pasta, 'creds.json'), 'utf8'))
    return !!creds?.me?.id && !!creds?.account
  } catch {
    return false
  }
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
  /** Pasta da sessão única das versões até a 1.0.6 (vira a primeira conexão da lista). */
  private legacyAuthDir = join(this.dir, 'wa-auth')
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
    let conexoes = Array.isArray(raw.conexoes) ? raw.conexoes.filter((c) => c?.id && c?.pasta) : null
    if (!conexoes) {
      // atualização da 1.0.6: a sessão que já existia continua funcionando, sem ler o QR de novo
      conexoes = temSessao(this.legacyAuthDir) ? [{ id: uid(), pasta: 'wa-auth', criadoEm: Date.now() }] : []
    }
    // conexão que nunca chegou a ser pareada (QR Code não lido) não precisa continuar na lista
    conexoes = conexoes.filter((c) => c.numero || temSessao(this.pastaConexao(c)))
    this.data = {
      machineId: raw.machineId || uid(),
      provider: raw.provider ?? defaults.provider,
      rotation: raw.rotation === 'reserva' ? 'reserva' : 'revezar',
      cloud: { ...defaults.cloud, ...(raw.cloud ?? {}) },
      // sem chave salva = nunca configurado: usa o modelo padrão atual (SMSGo)
      sms: raw.sms?.token ? { ...defaults.sms, ...SEM_AUTH_ANTIGO, ...raw.sms } : defaults.sms,
      conexoes,
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
      rotation: this.data.rotation,
      cloud: { ...this.data.cloud, token: decrypt(this.data.cloud.token) },
      sms: { ...this.data.sms, token: decrypt(this.data.sms.token) }
    }
  }

  saveLocal(patch: Partial<LocalSettings>): LocalSettings {
    const cur = this.getLocal()
    const next: LocalSettings = {
      provider: patch.provider ?? cur.provider,
      rotation: patch.rotation === 'reserva' || patch.rotation === 'revezar' ? patch.rotation : cur.rotation,
      cloud: { ...cur.cloud, ...(patch.cloud ?? {}) },
      sms: { ...cur.sms, ...(patch.sms ?? {}) }
    }
    this.data.provider = next.provider
    this.data.rotation = next.rotation
    this.data.cloud = { ...next.cloud, token: encrypt(next.cloud.token) }
    this.data.sms = { ...next.sms, token: encrypt(next.sms.token) }
    this.save()
    return next
  }

  // ---------- Números conectados por QR Code (sem limite de quantidade) ----------
  get conexoes(): ConexaoQr[] {
    return this.data.conexoes.map((c) => ({ ...c }))
  }

  pastaConexao(c: ConexaoQr): string {
    return join(this.dir, c.pasta)
  }

  addConexao(): ConexaoQr {
    const id = uid()
    const c: ConexaoQr = { id, pasta: join('wa-sessoes', id), criadoEm: Date.now() }
    this.data.conexoes.push(c)
    this.flush()
    return { ...c }
  }

  updateConexao(id: string, patch: Partial<Pick<ConexaoQr, 'numero' | 'nome'>>): void {
    const c = this.data.conexoes.find((x) => x.id === id)
    if (!c) return
    const numero = patch.numero || c.numero
    const nome = patch.nome || c.nome
    if (c.numero === numero && c.nome === nome) return
    Object.assign(c, { numero, nome })
    this.save()
  }

  removeConexao(id: string): void {
    this.data.conexoes = this.data.conexoes.filter((x) => x.id !== id)
    this.flush()
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
