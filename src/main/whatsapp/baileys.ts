import { EventEmitter } from 'events'
import { readFile, rm } from 'fs/promises'
import { basename } from 'path'
import QRCode from 'qrcode'
import { nativeImage } from 'electron'
import pino from 'pino'
import type { WaStatus } from '@shared/types'
import { InvalidNumberError, mimeFromPath, type SendContent, type WaProvider } from './provider'
import { randomBetween } from '../utils'
import { temSessao } from '../store'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Miniatura JPEG + dimensões da imagem, feitas pelo próprio Electron.
 * Sem isso o Baileys precisaria do "sharp" (módulo nativo pesado) para gerar a miniatura.
 */
function miniatura(buf: Buffer, largura: number): { jpegThumbnail?: string; width?: number; height?: number } {
  const img = nativeImage.createFromBuffer(buf)
  if (img.isEmpty()) return {}
  const { width, height } = img.getSize()
  const thumb = img.resize({ width: Math.min(largura, width), quality: 'good' }).toJPEG(60)
  return { jpegThumbnail: thumb.toString('base64'), width, height } // o Baileys espera base64
}

/**
 * Conexão via QR Code (WhatsApp Web multi-dispositivo) usando a biblioteca Baileys.
 * Sem navegador embutido: comunicação direta por WebSocket, leve e rápida.
 */
export class BaileysProvider extends EventEmitter implements WaProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sock: any = null
  private current: WaStatus
  private manualClose = false
  private retries = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private starting = false
  /** Conexão por código: número que vai receber o código (em vez de ler o QR). */
  private pairPhone: string | null = null
  private lastQr: string | undefined
  /** Imagens do botão já enviadas ao WhatsApp (reaproveitadas por 30 min, como no cartão). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private imagensBotao = new Map<string, { image: any; em: number }>()
  /** Cartões já montados (a imagem do cartão sobe uma vez e é reaproveitada por 30 min). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cartoes = new Map<string, { preview: any; em: number }>()

  constructor(
    readonly id: string,
    private authDir: string,
    private opts: { simulateTyping: () => boolean }
  ) {
    super()
    this.current = { id, provider: 'baileys', state: 'disconnected' }
  }

  status(): WaStatus {
    return this.current
  }

  private set(s: Omit<WaStatus, 'provider' | 'id'>): void {
    this.current = { id: this.id, provider: 'baileys', ...s }
    this.emit('status', this.current)
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  /**
   * Pedido de código ou QR que não foi até o fim deixa credenciais "pela metade" (o Baileys grava o número
   * ao pedir o código). Com elas o WhatsApp recusaria a conexão; começa do zero.
   */
  private async limparIncompleta(): Promise<void> {
    if (!temSessao(this.authDir)) await rm(this.authDir, { recursive: true, force: true })
  }

  /** Conecta a pedido da pessoa (botões da tela): descarta pareamento incompleto antes. */
  async start(): Promise<void> {
    if (this.sock || this.starting) return
    this.pairPhone = null
    await this.limparIncompleta()
    await this.connect()
  }

  /** Conectar por código: o celular digita um código de 8 letras em vez de ler o QR Code. */
  async pair(phone: string): Promise<void> {
    const aoVivo = this.sock && this.current.state === 'qr' && !this.current.pairingCode
    this.pairPhone = phone
    if (aoVivo) return this.pedirCodigo() // já conectado ao WhatsApp esperando o QR: pede o código agora
    // senão (ou para gerar um código novo): recomeça; o código é pedido assim que o WhatsApp responder
    await this.disconnect()
    this.pairPhone = phone
    await this.limparIncompleta()
    await this.connect()
  }

  /** Desiste do código e volta para o QR Code. */
  async useQr(): Promise<void> {
    if (!this.pairPhone && this.current.state === 'qr' && this.current.qr) return
    await this.disconnect()
    await this.limparIncompleta()
    await this.connect()
  }

  private async pedirCodigo(): Promise<void> {
    const phone = this.pairPhone
    if (!phone || !this.sock) return
    try {
      const code = String(await this.sock.requestPairingCode(phone))
      if (this.pairPhone !== phone) return // a pessoa desistiu enquanto o código era gerado
      const fmt = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
      this.set({ state: 'qr', pairingCode: fmt, pairingPhone: phone })
    } catch (e) {
      this.pairPhone = null
      this.set({
        state: 'qr',
        qr: this.lastQr,
        error: `Não foi possível gerar o código (${(e as Error)?.message ?? e}). Tente de novo ou use o QR Code.`
      })
    }
  }

  async connect(): Promise<void> {
    this.cancelReconnect()
    if (this.sock || this.starting) return
    this.manualClose = false
    this.set({ state: 'connecting' })
    this.starting = true
    try {
      await this.open()
    } finally {
      this.starting = false
    }
  }

  private async open(): Promise<void> {

    // Baileys é ESM: carregado dinamicamente
    const b = await import('@whiskeysockets/baileys')
    const makeWASocket = b.default ?? b.makeWASocket
    const { state, saveCreds } = await b.useMultiFileAuthState(this.authDir)
    // Versão do protocolo: a do WhatsApp Web atual; se falhar, a da lista do Baileys.
    const version =
      (await b.fetchLatestWaWebVersion?.().then((v) => v.version).catch(() => undefined)) ??
      (await b.fetchLatestBaileysVersion().then((v) => v.version).catch(() => undefined))
    // desconectado/removido enquanto preparava a conexão
    if (this.manualClose) return

    const sock = makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      logger: pino({ level: 'silent' }),
      // Desde 13/11/2026 o WhatsApp recusa (erro 428) conexões que se apresentam como o app
      // "Desktop" oficial. Como "Chrome" no Windows o QR funciona (aparece como "Chrome (Windows)").
      browser: b.Browsers.windows('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false
    })
    this.sock = sock

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (u) => {
      // eventos de uma conexão antiga (já trocada por outra): não mexem na atual
      if (this.sock !== sock) return
      if (u.qr) {
        this.retries = 0 // o servidor respondeu: QR novo não é falha de conexão
        this.lastQr = await QRCode.toDataURL(u.qr, { margin: 1, width: 360 })
        // Conexão por código: o código é pedido assim que o WhatsApp responde e continua na tela
        // (os QR Codes novos que chegam a cada ~20 s são ignorados)
        if (this.pairPhone) {
          if (!this.current.pairingCode) await this.pedirCodigo()
          return
        }
        this.set({ state: 'qr', qr: this.lastQr })
      }
      if (u.connection === 'open') {
        this.retries = 0
        this.pairPhone = null
        const id: string = sock.user?.id ?? ''
        this.set({
          state: 'connected',
          me: id.split(':')[0].split('@')[0] || undefined,
          name: sock.user?.name ?? undefined
        })
      }
      if (u.connection === 'close') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const code = (u.lastDisconnect?.error as any)?.output?.statusCode
        this.sock = null
        if (code === b.DisconnectReason.loggedOut) {
          await rm(this.authDir, { recursive: true, force: true })
          if (this.manualClose) return // saída pedida pelo sistema: quem pediu define a mensagem
          this.set({
            state: 'disconnected',
            error:
              'O WhatsApp encerrou a sessão deste número (saiu pelo celular ou o número foi restringido). Leia o QR Code de novo ou remova.'
          })
          return
        }
        if (this.manualClose) {
          this.set({ state: 'disconnected' })
          return
        }
        // Número banido/restrito: não adianta insistir
        if (code === b.DisconnectReason.forbidden) {
          this.set({
            state: 'disconnected',
            error: 'O WhatsApp recusou este número (pode ter sido banido ou restringido). Os envios seguem pelos outros números.'
          })
          return
        }
        // A mesma sessão foi aberta em outro lugar: reconectar faria as duas se derrubarem sem parar
        if (code === b.DisconnectReason.connectionReplaced) {
          this.set({
            state: 'disconnected',
            error: 'Esta sessão foi aberta em outro computador ou programa. Clique em "Reconectar" para trazê-la de volta.'
          })
          return
        }
        const reconectar = (ms: number) => {
          this.cancelReconnect()
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            if (this.manualClose) return
            this.connect().catch((e) => this.set({ state: 'disconnected', error: String(e?.message ?? e) }))
          }, ms)
        }
        // Depois de ler o QR, o WhatsApp pede para reconectar: faz na hora
        if (code === b.DisconnectReason.restartRequired) {
          this.set({ state: 'connecting' })
          reconectar(300)
          return
        }
        // Ninguém escaneou a tempo: para de gerar QR até a pessoa pedir de novo
        if (code === b.DisconnectReason.timedOut && (this.current.state === 'qr' || this.pairPhone)) {
          const porCodigo = !!this.pairPhone
          this.pairPhone = null
          this.set({
            state: 'disconnected',
            error: porCodigo
              ? 'O código expirou antes de ser digitado no celular. Gere outro.'
              : 'O QR Code expirou. Gere outro (ou conecte por código).'
          })
          return
        }
        if (this.retries++ > 6) {
          const motivo = (u.lastDisconnect?.error as Error | undefined)?.message
          this.set({
            state: 'disconnected',
            error: `Não foi possível conectar ao WhatsApp${motivo ? ` (${motivo})` : ''}. Tente novamente em alguns minutos.`
          })
          return
        }
        this.set({ state: 'connecting' })
        reconectar(Math.min(2000 * this.retries, 15000))
      }
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return
      for (const m of messages) {
        if (m.key.fromMe) continue
        const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? ''
        if (!text) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const k = m.key as any
        const jid = [k.remoteJid, k.remoteJidAlt, k.senderPn].find(
          (j: string | undefined) => j && j.endsWith('@s.whatsapp.net')
        )
        if (!jid) continue
        this.emit('incoming', { phone: jid.split('@')[0], text })
      }
    })
  }

  async disconnect(): Promise<void> {
    this.manualClose = true
    this.pairPhone = null
    this.cancelReconnect()
    try {
      this.sock?.end(undefined)
    } catch {
      /* ignora */
    }
    this.sock = null
    this.set({ state: 'disconnected' })
  }

  /** Sai da conta (o aparelho some do celular) e apaga a sessão salva. */
  async logout(error?: string): Promise<void> {
    this.manualClose = true
    this.pairPhone = null
    this.cancelReconnect()
    try {
      await this.sock?.logout()
    } catch {
      /* ignora */
    }
    try {
      this.sock?.end(undefined)
    } catch {
      /* ignora */
    }
    this.sock = null
    await rm(this.authDir, { recursive: true, force: true })
    this.set({ state: 'disconnected', error })
  }

  /**
   * Monta a "prévia de link" do WhatsApp com a imagem da campanha em alta qualidade.
   * O WhatsApp mostra um cartão grande (imagem + título + descrição + site); tocar abre o link.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async cartao(card: NonNullable<SendContent['card']>): Promise<any> {
    const chave = [card.url, card.title, card.description, card.imagePath ?? ''].join('|')
    const pronto = this.cartoes.get(chave)
    if (pronto && Date.now() - pronto.em < 30 * 60_000) return pronto.preview

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const preview: any = {
      'canonical-url': card.url,
      'matched-text': card.url,
      title: card.title,
      description: card.description
    }
    if (card.imagePath) {
      const img = nativeImage.createFromBuffer(await readFile(card.imagePath))
      if (!img.isEmpty()) {
        // imagem do cartão: JPEG de até 1200 px de largura (nítido no celular e leve para enviar)
        const grande = img.getSize().width > 1200 ? img.resize({ width: 1200, quality: 'good' }) : img
        const jpeg = grande.toJPEG(85)
        const pequena = miniatura(jpeg, 192)
        const b = await import('@whiskeysockets/baileys')
        const { imageMessage } = await b.prepareWAMessageMedia(
          { image: jpeg, ...pequena },
          { upload: this.sock.waUploadToServer, mediaTypeOverride: 'thumbnail-link' }
        )
        // na prévia de link o Baileys espera os bytes (Buffer), não base64
        preview.jpegThumbnail = pequena.jpegThumbnail ? Buffer.from(pequena.jpegThumbnail, 'base64') : undefined
        preview.highQualityThumbnail = imageMessage
      }
    }
    this.cartoes.set(chave, { preview, em: Date.now() })
    return preview
  }

  /**
   * EXPERIMENTAL — botão de verdade pelo QR Code ("mensagem interativa" com botão de link).
   * O WhatsApp só libera esse tipo de mensagem oficialmente para a API da Meta; aqui ela é montada
   * como o app oficial de empresas monta (nós "biz" + "bot"). Pode não aparecer em alguns aparelhos,
   * pode parar de funcionar numa atualização do WhatsApp e aumenta o risco de bloqueio do número.
   */
  static montarBotao(
    text: string,
    btn: NonNullable<SendContent['button']>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    imageMessage?: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): { content: any; nodes: any[] } {
    return {
      content: {
        interactiveMessage: {
          header: imageMessage
            ? { title: '', hasMediaAttachment: true, imageMessage }
            : { title: '', hasMediaAttachment: false },
          body: { text },
          footer: { text: '' },
          nativeFlowMessage: {
            buttons: [
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({ display_text: btn.text, url: btn.url, merchant_url: btn.url })
              }
            ],
            messageParamsJson: ''
          }
        }
      },
      nodes: [
        {
          tag: 'biz',
          attrs: {},
          content: [
            {
              tag: 'interactive',
              attrs: { type: 'native_flow', v: '1' },
              content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
            }
          ]
        },
        { tag: 'bot', attrs: { biz_bot: '1' } } // conversa individual
      ]
    }
  }

  private async enviarBotao(jid: string, text: string, btn: NonNullable<SendContent['button']>): Promise<void> {
    const b = await import('@whiskeysockets/baileys')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let image: any
    if (btn.imagePath) {
      const pronta = this.imagensBotao.get(btn.imagePath)
      if (pronta && Date.now() - pronta.em < 30 * 60_000) image = pronta.image
      else {
        const buf = await readFile(btn.imagePath)
        const { mime } = mimeFromPath(btn.imagePath)
        const r = await b.prepareWAMessageMedia(
          { image: buf, mimetype: mime, ...miniatura(buf, 32) },
          { upload: this.sock.waUploadToServer }
        )
        image = r.imageMessage
        this.imagensBotao.set(btn.imagePath, { image, em: Date.now() })
      }
    }
    const { content, nodes } = BaileysProvider.montarBotao(text, btn, image)
    const msg = b.generateWAMessageFromContent(jid, content, { userJid: this.sock.user?.id })
    await this.sock.relayMessage(jid, msg.message, { messageId: msg.key.id, additionalNodes: nodes })
  }

  async send(phone: string, content: SendContent): Promise<void> {
    if (!this.sock || this.current.state !== 'connected') throw new Error('WhatsApp não está conectado')

    const [res] = (await this.sock.onWhatsApp(`${phone}@s.whatsapp.net`)) ?? []
    if (!res?.exists) throw new InvalidNumberError(phone)
    const jid: string = res.jid

    if (this.opts.simulateTyping()) {
      try {
        await this.sock.presenceSubscribe(jid)
        await this.sock.sendPresenceUpdate('composing', jid)
        await wait(randomBetween(1200, Math.min(6000, 600 + content.text.length * 35)))
        await this.sock.sendPresenceUpdate('paused', jid)
      } catch {
        /* presença é opcional */
      }
    }

    if (content.button) {
      await this.enviarBotao(jid, content.text, content.button)
      return
    }

    if (content.card) {
      // Cartão clicável: texto com o link + prévia montada por nós (imagem, título, descrição)
      const linkPreview = await this.cartao(content.card)
      await this.sock.sendMessage(jid, { text: content.text, linkPreview })
      return
    }

    if (content.mediaPath) {
      const buf = await readFile(content.mediaPath)
      const { mime, kind } = mimeFromPath(content.mediaPath)
      const caption = content.text || undefined
      if (kind === 'image')
        await this.sock.sendMessage(jid, { image: buf, caption, mimetype: mime, ...miniatura(buf, 32) })
      else if (kind === 'video') await this.sock.sendMessage(jid, { video: buf, caption, mimetype: mime })
      else if (kind === 'audio') {
        await this.sock.sendMessage(jid, { audio: buf, mimetype: mime })
        if (caption) await this.sock.sendMessage(jid, { text: caption })
      } else
        await this.sock.sendMessage(jid, {
          document: buf,
          mimetype: mime,
          fileName: basename(content.mediaPath),
          caption
        })
      return
    }

    await this.sock.sendMessage(jid, { text: content.text })
  }
}
