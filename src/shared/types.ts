// Tipos compartilhados entre o processo principal (Node), o preload e a interface (React)

export type ProviderKind = 'baileys' | 'cloud'

export type ConnectionState = 'disconnected' | 'connecting' | 'qr' | 'connected'

export interface WaStatus {
  provider: ProviderKind
  state: ConnectionState
  qr?: string // imagem do QR Code (data URL)
  me?: string // número conectado
  name?: string
  error?: string
}

export interface Contact {
  id: string
  name: string
  phone: string // somente dígitos, com DDI (ex: 5511999998888)
  tags: string[]
  optOut: boolean
  createdAt: number
}

export type ResultStatus = 'pending' | 'sent' | 'failed' | 'invalid' | 'skipped'

export interface CampaignResult {
  contactId: string
  phone: string
  name: string
  status: ResultStatus
  error?: string
  at?: number
}

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'done' | 'cancelled'

export interface CloudTemplate {
  name: string
  language: string // ex: pt_BR
}

export interface CampaignInput {
  name: string
  message: string
  mediaPath?: string
  tag?: string // filtra contatos por etiqueta (vazio = todos)
  delayMin: number // segundos
  delayMax: number // segundos
  batchSize: number // mensagens por lote (0 = sem lotes)
  batchPause: number // minutos de pausa entre lotes
  template?: CloudTemplate // apenas API oficial
}

export interface Campaign extends CampaignInput {
  id: string
  status: CampaignStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  note?: string
  nextSendAt?: number
  results: CampaignResult[]
}

export interface CampaignSummary extends Omit<Campaign, 'results'> {
  total: number
  sent: number
  failed: number
  invalid: number
  skipped: number
  pending: number
  recent: CampaignResult[]
}

export interface Settings {
  provider: ProviderKind
  cloud: {
    token: string
    phoneNumberId: string
    apiVersion: string
  }
  dailyLimit: number
  optOutKeywords: string[]
  appendOptOut: boolean
  optOutText: string
  simulateTyping: boolean
}

export interface Stats {
  totalContacts: number
  optOuts: number
  sentToday: number
  dailyLimit: number
  totalSent: number
  history: { date: string; count: number }[] // últimos 7 dias
  runningCampaign?: string
}

export type UpdaterState =
  | 'dev'
  | 'idle'
  | 'checking'
  | 'available'
  | 'none'
  | 'downloading'
  | 'ready'
  | 'error'

export interface UpdaterStatus {
  state: UpdaterState
  version?: string
  percent?: number
  error?: string
}

export interface ImportResult {
  added: number
  duplicates: number
  invalid: number
}

export interface Api {
  appVersion(): Promise<string>
  settings: {
    get(): Promise<Settings>
    save(s: Partial<Settings>): Promise<Settings>
  }
  wa: {
    status(): Promise<WaStatus>
    connect(): Promise<void>
    disconnect(): Promise<void>
    logout(): Promise<void>
    onStatus(cb: (s: WaStatus) => void): () => void
  }
  contacts: {
    list(): Promise<Contact[]>
    add(c: { name: string; phone: string; tags: string[] }): Promise<Contact>
    remove(id: string): Promise<void>
    clear(): Promise<void>
    setOptOut(id: string, optOut: boolean): Promise<void>
    importFile(tags: string[]): Promise<ImportResult | null>
    tags(): Promise<string[]>
    onChanged(cb: () => void): () => void
  }
  campaigns: {
    list(): Promise<CampaignSummary[]>
    create(c: CampaignInput): Promise<CampaignSummary>
    start(id: string): Promise<void>
    pause(id: string): Promise<void>
    cancel(id: string): Promise<void>
    remove(id: string): Promise<void>
    exportReport(id: string): Promise<boolean>
    onProgress(cb: (c: CampaignSummary) => void): () => void
    onSent(cb: () => void): () => void
  }
  stats: {
    get(): Promise<Stats>
  }
  dialog: {
    pickMedia(): Promise<string | null>
  }
  updater: {
    status(): Promise<UpdaterStatus>
    check(): Promise<void>
    install(): Promise<void>
    onStatus(cb: (s: UpdaterStatus) => void): () => void
  }
}
