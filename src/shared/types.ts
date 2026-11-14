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

// ---------- Login (Supabase Auth) ----------
export interface AuthState {
  /**
   * checking: verificando a sessão salva
   * notConfigured: falta a chave pública do Supabase no app
   * signedOut: precisa fazer login
   * signedIn: logado e liberado na equipe
   * error: sem conexão com o banco (mostra "tentar de novo")
   */
  state: 'checking' | 'notConfigured' | 'signedOut' | 'signedIn' | 'error'
  email?: string
  name?: string
  admin?: boolean
  error?: string
}

export interface Member {
  email: string
  name: string
  admin: boolean
  createdAt: number
}

// ---------- Contatos ----------
export interface Contact {
  id: string
  name: string
  phone: string // somente dígitos, com DDI (ex: 5511999998888)
  tags: string[]
  optOut: boolean
  createdAt: number
}

// ---------- Campanhas ----------
export type ResultStatus = 'pending' | 'sent' | 'failed' | 'invalid' | 'skipped'

export interface CampaignResult {
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
  mediaPath?: string // arquivo local escolhido; é enviado para o Storage ao criar a campanha
  tag?: string // filtra contatos por etiqueta (vazio = todos)
  delayMin: number // segundos
  delayMax: number // segundos
  batchSize: number // mensagens por lote (0 = sem lotes)
  batchPause: number // minutos de pausa entre lotes
  template?: CloudTemplate // apenas API oficial
}

export interface CampaignSummary {
  id: string
  name: string
  message: string
  mediaName?: string
  tag?: string
  delayMin: number
  delayMax: number
  batchSize: number
  batchPause: number
  template?: CloudTemplate
  status: CampaignStatus
  createdAt: number
  createdBy?: string
  startedAt?: number
  finishedAt?: number
  note?: string
  nextSendAt?: number
  runningOn?: string // "operador (NOME-DO-PC)" que está enviando
  runningHere: boolean // enviando neste computador
  stale: boolean // marcada como enviando, mas o computador está sem sinal
  total: number
  sent: number
  failed: number
  invalid: number
  skipped: number
  pending: number
}

// ---------- Configurações ----------
/** Configurações compartilhadas pela equipe (ficam no banco; só administradores alteram). */
export interface SharedSettings {
  dailyLimit: number // por número de WhatsApp
  optOutKeywords: string[]
  appendOptOut: boolean
  optOutText: string
  simulateTyping: boolean
  contractLink: string // link de autocontratação da equipe (variável {link} nas mensagens)
}

/** Configurações deste computador (conexão do WhatsApp; o token fica criptografado localmente). */
export interface LocalSettings {
  provider: ProviderKind
  cloud: {
    token: string
    phoneNumberId: string
    apiVersion: string
  }
}

export type Settings = SharedSettings & LocalSettings

export interface Stats {
  totalContacts: number
  optOuts: number
  sentToday: number // do número conectado neste computador (ou da equipe, se desconectado)
  dailyLimit: number
  totalSent: number // equipe toda
  history: { date: string; count: number }[] // últimos 7 dias, equipe toda
  runningCampaign?: string
}

// ---------- Atualização automática ----------
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

/** Arquivo escolhido para anexar na campanha (com miniatura, se for imagem). */
export interface MediaInfo {
  path: string
  name: string
  size: number // bytes
  kind: 'image' | 'video' | 'audio' | 'document'
  preview?: string // data URL da miniatura (só imagens)
}

export interface ImportResult {
  added: number
  duplicates: number
  invalid: number
}

export interface Api {
  appVersion(): Promise<string>
  auth: {
    state(): Promise<AuthState>
    login(email: string, password: string): Promise<AuthState>
    logout(): Promise<void>
    changePassword(current: string, next: string): Promise<void>
    retry(): Promise<AuthState>
    onChange(cb: (s: AuthState) => void): () => void
  }
  team: {
    list(): Promise<Member[]>
    add(m: { email: string; name: string; admin: boolean }): Promise<void>
    remove(email: string): Promise<void>
  }
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
    log(id: string): Promise<CampaignResult[]>
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
    pickMedia(): Promise<MediaInfo | null>
  }
  media: {
    /** Confere um arquivo (arrastado para a tela) e devolve os dados com miniatura. */
    info(path: string): Promise<MediaInfo>
    /** Salva uma imagem colada com Ctrl+V (print, imagem do navegador) para anexar. */
    pasteImage(bytes: Uint8Array, mime: string): Promise<MediaInfo>
    /** Caminho no disco de um arquivo arrastado para a janela. */
    pathForFile(file: File): string
  }
  updater: {
    status(): Promise<UpdaterStatus>
    check(): Promise<void>
    install(): Promise<void>
    onStatus(cb: (s: UpdaterStatus) => void): () => void
  }
}
