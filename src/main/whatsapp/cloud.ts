import { EventEmitter } from 'events'
import { readFile } from 'fs/promises'
import { basename } from 'path'
import type { Settings, WaStatus } from '@shared/types'
import { InvalidNumberError, mimeFromPath, type SendContent, type WaProvider } from './provider'

/**
 * API Oficial do WhatsApp (Meta Cloud API).
 * Requer conta no Meta for Developers, token e Phone Number ID.
 * Fora da janela de 24h, a Meta só permite mensagens de TEMPLATE aprovado.
 */
export class CloudProvider extends EventEmitter implements WaProvider {
  private current: WaStatus = { provider: 'cloud', state: 'disconnected' }

  constructor(private getCfg: () => Settings['cloud']) {
    super()
  }

  status(): WaStatus {
    return this.current
  }

  private set(s: Omit<WaStatus, 'provider'>): void {
    this.current = { provider: 'cloud', ...s }
    this.emit('status', this.current)
  }

  private get base(): string {
    const c = this.getCfg()
    return `https://graph.facebook.com/${c.apiVersion || 'v21.0'}/${c.phoneNumberId}`
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async call(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(this.base + path, {
      ...init,
      headers: { Authorization: `Bearer ${this.getCfg().token}`, ...(init.headers ?? {}) }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = json?.error?.message ?? `HTTP ${res.status}`
      const code = json?.error?.code
      // 131026 = destinatário sem WhatsApp / não alcançável
      if (code === 131026 || code === 131030) throw new InvalidNumberError(msg)
      throw new Error(msg)
    }
    return json
  }

  async connect(): Promise<void> {
    const c = this.getCfg()
    if (!c.token || !c.phoneNumberId) {
      this.set({ state: 'disconnected', error: 'Informe o Token e o Phone Number ID nas configurações.' })
      return
    }
    this.set({ state: 'connecting' })
    try {
      const info = await this.call('?fields=display_phone_number,verified_name')
      this.set({
        state: 'connected',
        me: String(info.display_phone_number ?? '').replace(/\D/g, ''),
        name: info.verified_name
      })
    } catch (e) {
      this.set({ state: 'disconnected', error: (e as Error).message })
    }
  }

  async disconnect(): Promise<void> {
    this.set({ state: 'disconnected' })
  }

  async logout(): Promise<void> {
    this.set({ state: 'disconnected' })
  }

  private async uploadMedia(path: string): Promise<{ id: string; kind: string }> {
    const buf = await readFile(path)
    const { mime, kind } = mimeFromPath(path)
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', mime)
    form.append('file', new Blob([buf], { type: mime }), basename(path))
    const json = await this.call('/media', { method: 'POST', body: form })
    return { id: json.id, kind }
  }

  async send(phone: string, content: SendContent): Promise<void> {
    if (this.current.state !== 'connected') throw new Error('API oficial não conectada')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payload: any

    if (content.template?.name) {
      payload = {
        type: 'template',
        template: {
          name: content.template.name,
          language: { code: content.template.language || 'pt_BR' },
          components: content.template.params.length
            ? [{ type: 'body', parameters: content.template.params.map((t) => ({ type: 'text', text: t })) }]
            : undefined
        }
      }
    } else if (content.mediaPath) {
      const { id, kind } = await this.uploadMedia(content.mediaPath)
      const media: Record<string, string> = { id }
      if (kind !== 'audio' && content.text) media.caption = content.text
      if (kind === 'document') media.filename = basename(content.mediaPath)
      payload = { type: kind, [kind]: media }
    } else {
      payload = { type: 'text', text: { body: content.text, preview_url: true } }
    }

    await this.call('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, ...payload })
    })
  }
}
