import { EventEmitter } from 'events'
import { readFile, rm } from 'fs/promises'
import { basename } from 'path'
import QRCode from 'qrcode'
import { nativeImage } from 'electron'
import pino from 'pino'
import type { WaStatus } from '@shared/types'
import { InvalidNumberError, mimeFromPath, type SendContent, type WaProvider } from './provider'
import { randomBetween } from '../utils'

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
  private current: WaStatus = { provider: 'baileys', state: 'disconnected' }
  private manualClose = false
  private retries = 0
  /** Cartões já montados (a imagem do cartão sobe uma vez e é reaproveitada por 30 min). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cartoes = new Map<string, { preview: any; em: number }>()

  constructor(
    private authDir: string,
    private opts: { simulateTyping: () => boolean }
  ) {
    super()
  }

  status(): WaStatus {
    return this.current
  }

  private set(s: Omit<WaStatus, 'provider'>): void {
    this.current = { provider: 'baileys', ...s }
    this.emit('status', this.current)
  }

  async connect(): Promise<void> {
    if (this.sock) return
    this.manualClose = false
    this.set({ state: 'connecting' })

    // Baileys é ESM: carregado dinamicamente
    const b = await import('@whiskeysockets/baileys')
    const makeWASocket = b.default ?? b.makeWASocket
    const { state, saveCreds } = await b.useMultiFileAuthState(this.authDir)
    // Versão do protocolo: a do WhatsApp Web atual; se falhar, a da lista do Baileys.
    const version =
      (await b.fetchLatestWaWebVersion?.().then((v) => v.version).catch(() => undefined)) ??
      (await b.fetchLatestBaileysVersion().then((v) => v.version).catch(() => undefined))

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
      if (u.qr) {
        this.retries = 0 // o servidor respondeu: QR novo não é falha de conexão
        const qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 360 })
        this.set({ state: 'qr', qr })
      }
      if (u.connection === 'open') {
        this.retries = 0
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
          this.set({ state: 'disconnected', error: 'Sessão encerrada pelo celular. Conecte novamente.' })
          return
        }
        if (this.manualClose) {
          this.set({ state: 'disconnected' })
          return
        }
        const reconectar = (ms: number) =>
          setTimeout(
            () => this.connect().catch((e) => this.set({ state: 'disconnected', error: String(e?.message ?? e) })),
            ms
          )
        // Depois de ler o QR, o WhatsApp pede para reconectar: faz na hora
        if (code === b.DisconnectReason.restartRequired) {
          this.set({ state: 'connecting' })
          reconectar(300)
          return
        }
        // Ninguém escaneou a tempo: para de gerar QR até a pessoa pedir de novo
        if (code === b.DisconnectReason.timedOut && this.current.state === 'qr') {
          this.set({ state: 'disconnected', error: 'O QR Code expirou. Clique em "Conectar" para gerar outro.' })
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
    try {
      this.sock?.end(undefined)
    } catch {
      /* ignora */
    }
    this.sock = null
    this.set({ state: 'disconnected' })
  }

  async logout(): Promise<void> {
    this.manualClose = true
    try {
      await this.sock?.logout()
    } catch {
      /* ignora */
    }
    this.sock = null
    await rm(this.authDir, { recursive: true, force: true })
    this.set({ state: 'disconnected' })
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
