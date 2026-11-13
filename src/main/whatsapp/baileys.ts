import { EventEmitter } from 'events'
import { readFile, rm } from 'fs/promises'
import { basename } from 'path'
import QRCode from 'qrcode'
import pino from 'pino'
import type { WaStatus } from '@shared/types'
import { InvalidNumberError, mimeFromPath, type SendContent, type WaProvider } from './provider'
import { randomBetween } from '../utils'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
    const version = await b
      .fetchLatestBaileysVersion()
      .then((v) => v.version)
      .catch(() => undefined)

    const sock = makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      logger: pino({ level: 'silent' }),
      browser: b.Browsers?.windows?.('Desktop'),
      markOnlineOnConnect: false,
      syncFullHistory: false
    })
    this.sock = sock

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (u) => {
      if (u.qr) {
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
        if (this.retries++ > 8) {
          this.set({ state: 'disconnected', error: 'Não foi possível reconectar. Tente novamente.' })
          return
        }
        this.set({ state: 'connecting' })
        setTimeout(
          () => this.connect().catch((e) => this.set({ state: 'disconnected', error: String(e?.message ?? e) })),
          Math.min(2000 * this.retries, 15000)
        )
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

    if (content.mediaPath) {
      const buf = await readFile(content.mediaPath)
      const { mime, kind } = mimeFromPath(content.mediaPath)
      const caption = content.text || undefined
      if (kind === 'image') await this.sock.sendMessage(jid, { image: buf, caption, mimetype: mime })
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
