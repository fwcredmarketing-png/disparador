import { EventEmitter } from 'events'
import { rm } from 'fs/promises'
import type { ProviderKind, WaOverview, WaStatus } from '@shared/types'
import { store, temSessao, type ConexaoQr } from '../store'
import { getSettings } from '../settings'
import { BaileysProvider } from './baileys'
import { CloudProvider } from './cloud'
import type { IncomingMessage, SendContent, WaProvider } from './provider'
import { normalizePhone } from '../utils'

/** Um número pronto para enviar. */
export interface Sender {
  id: string // conexão
  me: string // número
}

/**
 * Gerencia as conexões de WhatsApp deste computador:
 * - QR Code: quantos números a pessoa quiser, cada um com a sua sessão;
 * - API oficial: uma conexão.
 * Emite 'status' (WaOverview) sempre que alguma conexão muda e repassa 'incoming'.
 */
export class WhatsAppManager extends EventEmitter {
  private qr = new Map<string, BaileysProvider>()
  private cloud: CloudProvider

  constructor() {
    super()
    for (const c of store.conexoes) this.criar(c)
    this.cloud = new CloudProvider(() => getSettings().cloud)
    this.cloud.on('status', () => {
      if (this.kind === 'cloud') this.changed()
    })
    this.cloud.on('incoming', (m: IncomingMessage) => this.emit('incoming', m))
  }

  get kind(): ProviderKind {
    return getSettings().provider
  }

  private criar(c: ConexaoQr): BaileysProvider {
    const p = new BaileysProvider(c.id, store.pastaConexao(c), { simulateTyping: () => getSettings().simulateTyping })
    p.on('status', (s: WaStatus) => this.onQrStatus(c.id, s))
    p.on('incoming', (m: IncomingMessage) => this.emit('incoming', m))
    this.qr.set(c.id, p)
    return p
  }

  private onQrStatus(id: string, s: WaStatus): void {
    if (s.state === 'connected' && s.me) {
      // O mesmo número lido em duas conexões: mantém a primeira e desfaz a repetida
      const outro = [...this.qr.values()].find(
        (p) => p.id !== id && p.status().state === 'connected' && p.status().me === s.me
      )
      if (outro) {
        void this.qr.get(id)?.logout(`O número +${s.me} já está conectado nesta lista. Use outro número ou remova esta conexão.`)
        return
      }
      store.updateConexao(id, { numero: s.me, nome: s.name })
    }
    if (this.kind === 'baileys') this.changed()
  }

  private changed(): void {
    this.emit('status', this.overview())
  }

  private provider(id: string): WaProvider {
    const p = id === this.cloud.id ? this.cloud : this.qr.get(id)
    if (!p) throw new Error('Essa conexão não existe mais. Atualize a tela.')
    return p
  }

  private qrProvider(id: string): BaileysProvider {
    const p = this.qr.get(id)
    if (!p) throw new Error('Essa conexão não existe mais. Atualize a tela.')
    return p
  }

  /** Número digitado para a conexão por código: formato internacional e sem repetir um já conectado. */
  private validarNumero(phone: string, id?: string): string {
    const n = normalizePhone(phone)
    if (!n) throw new Error('Número inválido. Digite com DDD, por exemplo: 11 99999-8888.')
    const outro = [...this.qr.values()].find(
      (p) => p.id !== id && p.status().state === 'connected' && p.status().me === n
    )
    if (outro) throw new Error(`O número +${n} já está conectado nesta lista.`)
    return n
  }

  overview(): WaOverview {
    if (this.kind === 'cloud') {
      const s = this.cloud.status()
      return { provider: 'cloud', connections: [s], online: s.state === 'connected' ? 1 : 0 }
    }
    const connections = store.conexoes.map((c): WaStatus => {
      const s = this.qr.get(c.id)?.status() ?? { id: c.id, provider: 'baileys', state: 'disconnected' }
      // desconectado, continua mostrando qual número era
      return { ...s, me: s.me ?? c.numero, name: s.name ?? c.nome, linked: temSessao(store.pastaConexao(c)) }
    })
    return { provider: 'baileys', connections, online: this.senders().length }
  }

  /**
   * Números prontos para enviar, na ordem da lista (a ordem vale como prioridade no modo "reserva").
   * Um número aparece uma vez só, mesmo que esteja em duas conexões.
   */
  senders(): Sender[] {
    if (this.kind === 'cloud') {
      const s = this.cloud.status()
      return s.state === 'connected' ? [{ id: this.cloud.id, me: s.me ?? '' }] : []
    }
    const vistos = new Set<string>()
    const out: Sender[] = []
    for (const c of store.conexoes) {
      const s = this.qr.get(c.id)?.status()
      if (s?.state !== 'connected' || !s.me || vistos.has(s.me)) continue
      vistos.add(s.me)
      out.push({ id: c.id, me: s.me })
    }
    return out
  }

  isConnected(): boolean {
    return this.senders().length > 0
  }

  /** Ao abrir o sistema (ou trocar o tipo de conexão): reconecta o que já tem sessão salva. */
  connectSaved(): void {
    if (this.kind === 'cloud') {
      const c = getSettings().cloud
      if (c.token && c.phoneNumberId) this.cloud.connect().catch(() => {})
      return
    }
    let atraso = 0
    for (const c of store.conexoes) {
      const p = this.qr.get(c.id)
      if (!p || !temSessao(store.pastaConexao(c))) continue
      // um de cada vez, para não abrir várias conexões no mesmo instante
      setTimeout(() => p.connect().catch(() => {}), atraso)
      atraso += 1500
    }
  }

  /**
   * Mais um número. Com telefone: gera o código para digitar no celular (sem QR Code).
   * Sem telefone: gera o QR Code.
   */
  async add(phone?: string): Promise<void> {
    if (this.kind !== 'baileys') throw new Error('Para conectar vários números, use a conexão por QR Code/código')
    const numero = phone !== undefined ? this.validarNumero(phone) : undefined
    // Já tem uma conexão nova esperando o pareamento: usa ela em vez de abrir outra
    const nova = store.conexoes.find((c) => !c.numero && !temSessao(store.pastaConexao(c)))
    let p = nova ? this.qr.get(nova.id) : undefined
    if (!p) {
      p = this.criar(store.addConexao())
      this.changed()
    }
    if (numero) await p.pair(numero)
    else if (p.status().state === 'disconnected') await p.start()
  }

  /** Conectar por código um número da lista (por exemplo, um que caiu). */
  async pair(id: string, phone: string): Promise<void> {
    await this.qrProvider(id).pair(this.validarNumero(phone, id))
  }

  /** Volta a mostrar o QR Code em vez do código. */
  async useQr(id: string): Promise<void> {
    await this.qrProvider(id).useQr()
  }

  connect(id: string): Promise<void> {
    return id === this.cloud.id ? this.cloud.connect() : this.qrProvider(id).start()
  }

  disconnect(id: string): Promise<void> {
    return this.provider(id).disconnect()
  }

  /** Sai da conta e apaga a sessão do número (QR Code) ou desconecta a API oficial. */
  async remove(id: string): Promise<void> {
    if (id === this.cloud.id) return this.cloud.logout()
    const p = this.qr.get(id)
    const c = store.conexoes.find((x) => x.id === id)
    if (p) {
      p.removeAllListeners()
      this.qr.delete(id)
      // o aviso de saída ao WhatsApp não pode travar a remoção
      await Promise.race([p.logout(), new Promise((r) => setTimeout(r, 5000))]).catch(() => {})
    }
    if (c) {
      store.removeConexao(id)
      await rm(store.pastaConexao(c), { recursive: true, force: true }).catch(() => {})
    }
    this.changed()
  }

  send(id: string, phone: string, content: SendContent): Promise<void> {
    return this.provider(id).send(phone, content)
  }

  /** Chamado quando o usuário troca o tipo de conexão nas configurações. */
  async switchTo(prev: ProviderKind): Promise<void> {
    if (prev !== this.kind) {
      if (prev === 'cloud') await this.cloud.disconnect()
      else await Promise.all([...this.qr.values()].map((p) => p.disconnect()))
      this.connectSaved()
    }
    this.changed()
  }
}
