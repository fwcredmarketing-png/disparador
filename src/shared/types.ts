// Tipos compartilhados entre o processo principal (Node), o preload e a interface (React)

export type ProviderKind = 'baileys' | 'cloud'

export type ConnectionState = 'disconnected' | 'connecting' | 'qr' | 'connected'

/** Situação de UMA conexão de WhatsApp (cada número conectado tem a sua). */
export interface WaStatus {
  id: string // identifica a conexão ("cloud" para a API oficial)
  provider: ProviderKind
  state: ConnectionState
  qr?: string // imagem do QR Code (data URL)
  pairingCode?: string // conexão por código: código de 8 letras para digitar no celular (ex.: ABCD-1234)
  pairingPhone?: string // número para o qual o código foi gerado
  me?: string // número da conexão (fica o último conhecido mesmo desconectado)
  name?: string
  error?: string
  linked?: boolean // já existe sessão pareada salva neste computador (reconecta sem QR/código)
}

/**
 * Como a campanha usa os números conectados:
 * revezar: alterna entre todos (divide o volume e reduz o risco de bloqueio);
 * reserva: usa um por vez, na ordem da lista; os outros só entram se ele cair ou bater o limite.
 * Nos dois modos, se um número cair ou for restringido a campanha continua pelos outros.
 */
export type WaRotation = 'revezar' | 'reserva'

/** Todas as conexões de WhatsApp deste computador. */
export interface WaOverview {
  provider: ProviderKind
  connections: WaStatus[]
  online: number // números conectados e prontos para enviar
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

/** Por onde a campanha sai: WhatsApp (números conectados) ou SMS (API externa). */
export type Channel = 'whatsapp' | 'sms'

export interface CampaignInput {
  channel?: Channel // padrão: whatsapp
  name: string
  message: string
  mediaPath?: string // arquivo local escolhido; é enviado para o Storage ao criar a campanha
  tag?: string // filtra contatos por etiqueta (vazio = todos)
  delayMin: number // segundos
  delayMax: number // segundos
  batchSize: number // mensagens por lote (0 = sem lotes)
  batchPause: number // minutos de pausa entre lotes
  template?: CloudTemplate // apenas API oficial
  /**
   * imagem: imagem com o texto como legenda.
   * cartao: cartão clicável (imagem + título + descrição) que abre o link de autocontratação.
   * botao: (experimental) imagem + texto + botão que abre o link de autocontratação.
   */
  format?: CampaignFormat
  cardTitle?: string
  cardDescription?: string
  buttonText?: string // texto do botão (formato botao)
}

export type CampaignFormat = 'imagem' | 'cartao' | 'botao'

export interface CampaignSummary {
  id: string
  channel: Channel
  name: string
  message: string
  mediaName?: string
  tag?: string
  delayMin: number
  delayMax: number
  batchSize: number
  batchPause: number
  template?: CloudTemplate
  format: CampaignFormat
  cardTitle?: string
  cardDescription?: string
  buttonText?: string
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

/**
 * SMS por API externa: o sistema faz uma chamada HTTP ao provedor para cada mensagem.
 * Nos campos de texto, {{telefone}}, {{mensagem}}, {{token}}, {{token_base64}}, {{remetente}} e {{bearer}}
 * são trocados pelos valores ({{token_base64}} serve para login "Basic" com usuario:senha).
 */
export interface SmsConfig {
  /** modelo usado para preencher os campos (android_*: o próprio celular envia pelo chip, com o plano da operadora) */
  preset: 'smsgo' | 'android_local' | 'android_nuvem' | 'zenvia' | 'generico'
  token: string // chave da API do provedor (fica criptografada neste computador)
  /**
   * Autenticação em 2 passos (opcional): antes de enviar, troca a chave por um token temporário
   * (ex.: SMSGo). O token vira {{bearer}} nos cabeçalhos/corpo do envio. Vazio = não usa.
   */
  authUrl: string
  authHeaders: string // um por linha: "Nome: valor"
  authField: string // campo da resposta com o token (ex.: token)
  authHours: number // por quanto tempo reaproveitar o token
  sender: string // remetente (quando o provedor pede)
  url: string
  method: 'POST' | 'GET'
  headers: string // um por linha: "Nome: valor"
  body: string // modelo do corpo da requisição
  bodyType: 'json' | 'form'
  phoneFormat: 'ddi' | 'e164' | 'nacional' // 5511999998888 | +5511999998888 | 11999998888
  stripAccents: boolean // tira acentos: cabem 160 letras por SMS em vez de 70
}

/** Configurações deste computador (conexões; tokens ficam criptografados localmente). */
export interface LocalSettings {
  provider: ProviderKind
  rotation: WaRotation
  cloud: {
    token: string
    phoneNumberId: string
    apiVersion: string
  }
  sms: SmsConfig
}

export type Settings = SharedSettings & LocalSettings

export interface Stats {
  totalContacts: number
  optOuts: number
  sentToday: number // soma dos números conectados neste computador (ou da equipe, se nenhum conectado)
  dailyLimit: number // limite somado dos números conectados (limite por número × quantidade)
  numbers: number // quantos números entraram na conta de sentToday (0 = equipe toda)
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
    status(): Promise<WaOverview>
    /** Adiciona mais um número: com telefone, gera o código para digitar no celular; sem, gera o QR Code. */
    add(phone?: string): Promise<void>
    /** Conectar por código (sem QR): gera o código para o número informado. */
    pair(id: string, phone: string): Promise<void>
    /** Volta a mostrar o QR Code em vez do código. */
    useQr(id: string): Promise<void>
    connect(id: string): Promise<void>
    disconnect(id: string): Promise<void>
    /** Sai da conta e apaga a sessão desse número deste computador. */
    remove(id: string): Promise<void>
    onStatus(cb: (s: WaOverview) => void): () => void
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
    /** Envia a mensagem que está sendo montada para um número de teste (devolve o número que enviou). */
    test(c: CampaignInput, phone: string): Promise<string>
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
  sms: {
    /** Envia um SMS de teste com a configuração salva (test=true: provedor em modo sandbox, nada foi enviado de verdade). */
    test(phone: string): Promise<{ test: boolean }>
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
