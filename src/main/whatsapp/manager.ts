import { EventEmitter } from 'events'
import type { ProviderKind, WaStatus } from '@shared/types'
import { store } from '../store'
import { BaileysProvider } from './baileys'
import { CloudProvider } from './cloud'
import type { IncomingMessage, SendContent, WaProvider } from './provider'

/** Gerencia o provedor ativo (QR Code ou API oficial) e repassa seus eventos. */
export class WhatsAppManager extends EventEmitter {
  private providers: Record<ProviderKind, WaProvider>

  constructor() {
    super()
    this.providers = {
      baileys: new BaileysProvider(store.authDir, { simulateTyping: () => store.getSettings().simulateTyping }),
      cloud: new CloudProvider(() => store.getSettings().cloud)
    }
    for (const [kind, p] of Object.entries(this.providers)) {
      p.on('status', (s: WaStatus) => {
        if (kind === this.kind) this.emit('status', s)
      })
      p.on('incoming', (m: IncomingMessage) => this.emit('incoming', m))
    }
  }

  get kind(): ProviderKind {
    return store.getSettings().provider
  }

  get active(): WaProvider {
    return this.providers[this.kind]
  }

  status(): WaStatus {
    return this.active.status()
  }

  isConnected(): boolean {
    return this.status().state === 'connected'
  }

  connect(): Promise<void> {
    return this.active.connect()
  }

  disconnect(): Promise<void> {
    return this.active.disconnect()
  }

  logout(): Promise<void> {
    return this.active.logout()
  }

  send(phone: string, content: SendContent): Promise<void> {
    return this.active.send(phone, content)
  }

  /** Chamado quando o usuário troca de provedor nas configurações. */
  async switchTo(prev: ProviderKind): Promise<void> {
    if (prev !== this.kind) await this.providers[prev].disconnect()
    this.emit('status', this.status())
  }
}
