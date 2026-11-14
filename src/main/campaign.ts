import { EventEmitter } from 'events'
import type { CampaignInput, CampaignStatus, CampaignSummary, ResultStatus } from '@shared/types'
import { campaigns as repo, contacts, media, stats } from './repo'
import { getSettings } from './settings'
import { mediaInfo } from './media'
import { randomBetween, renderMessage } from './utils'
import { InvalidNumberError } from './whatsapp/provider'
import type { WhatsAppManager } from './whatsapp/manager'

type Stop = 'pause' | 'cancel' | 'lost' | null
type Final = { status: CampaignStatus; note?: string } | null

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Repete operações no banco quando a internet oscila. */
async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i >= tries) throw e
      await wait(1500 * i)
    }
  }
}

const COUNTER: Record<Exclude<ResultStatus, 'pending'>, 'sent' | 'failed' | 'invalid' | 'skipped'> = {
  sent: 'sent',
  failed: 'failed',
  invalid: 'invalid',
  skipped: 'skipped'
}

/**
 * Motor de disparo: envia uma mensagem por vez, com intervalos aleatórios,
 * pausas entre lotes, limite diário por número e respeito ao descadastro.
 *
 * Os dados ficam no banco compartilhado. Uma trava garante que só um computador
 * envia cada campanha; ele manda um "sinal" periódico e recebe pedidos de
 * pausa/cancelamento feitos em outros computadores.
 */
export class CampaignEngine extends EventEmitter {
  private runningId: string | null = null
  private runPromise: Promise<void> | null = null
  private stop: Stop = null
  private note: string | undefined
  private current: CampaignSummary | null = null
  private nextSendAt: number | undefined

  constructor(private wa: WhatsAppManager) {
    super()
  }

  get running(): string | null {
    return this.runningId
  }

  get runningName(): string | undefined {
    return this.current?.name
  }

  /** Para a campanha que roda aqui, o estado em memória é mais atual que o do banco. */
  decorate(c: CampaignSummary): CampaignSummary {
    if (c.id !== this.runningId || !this.current) return c
    return { ...this.current, nextSendAt: this.nextSendAt }
  }

  private emitProgress(): void {
    if (this.current) this.emit('progress', { ...this.current, nextSendAt: this.nextSendAt })
  }

  async create(input: CampaignInput): Promise<CampaignSummary> {
    if (!input.name?.trim()) throw new Error('Dê um nome para a campanha')
    if (!input.message?.trim() && !input.mediaPath && !input.template?.name)
      throw new Error('Escreva a mensagem ou anexe uma mídia')
    if (/\{link\}/i.test(input.message ?? '') && !getSettings().contractLink)
      throw new Error('A mensagem usa {link}, mas o link de autocontratação não foi cadastrado (Configurações).')
    if (input.mediaPath) await mediaInfo(input.mediaPath) // confere tipo e tamanho antes de enviar ao Storage
    const tag = input.tag?.trim() || undefined
    const list = await contacts.forCampaign(tag)
    if (!list.length) throw new Error('Nenhum contato disponível para essa campanha')

    const delayMin = Math.max(3, Math.floor(Number(input.delayMin) || 3))
    const id = await repo.insert({
      nome: input.name.trim(),
      mensagem: input.message ?? '',
      etiqueta: tag ?? null,
      intervalo_min: delayMin,
      intervalo_max: Math.max(delayMin, Math.floor(Number(input.delayMax) || delayMin)),
      lote_tamanho: Math.max(0, Math.floor(Number(input.batchSize) || 0)),
      lote_pausa: Math.max(0, Number(input.batchPause) || 0),
      template: input.template?.name ? input.template : null
    })
    try {
      if (input.mediaPath) {
        const m = await media.upload(id, input.mediaPath)
        await repo.setMedia(id, m.key, m.name)
      }
      await repo.insertSends(id, list)
    } catch (e) {
      await repo.remove(id).catch(() => {})
      throw e
    }
    return repo.get(id)
  }

  async start(id: string): Promise<void> {
    if (this.runningId === id) return
    if (this.runningId) throw new Error('Este computador já está enviando outra campanha')
    if (!this.wa.isConnected()) throw new Error('Conecte o WhatsApp antes de iniciar')
    const c = await repo.get(id)
    if (c.status === 'done' || c.status === 'cancelled') throw new Error('Essa campanha já foi finalizada')
    if (c.status === 'running' && !c.stale && !c.runningHere)
      throw new Error(`Essa campanha já está sendo enviada em ${c.runningOn}`)
    if (!(await repo.claim(id))) throw new Error('Outro computador iniciou essa campanha agora há pouco')

    this.runningId = id
    this.stop = null
    this.note = undefined
    this.nextSendAt = undefined
    this.current = await repo.get(id)
    this.emitProgress()
    this.runPromise = this.run(id)
  }

  async pause(id: string): Promise<void> {
    if (this.runningId === id) {
      this.stop ??= 'pause'
      return
    }
    await repo.control(id, 'pause')
  }

  async cancel(id: string): Promise<void> {
    if (this.runningId === id) {
      this.stop = 'cancel'
      return
    }
    await repo.control(id, 'cancel')
  }

  async remove(id: string): Promise<void> {
    if (this.runningId === id) throw new Error('Pause a campanha antes de excluir')
    const c = await repo.get(id)
    if (c.status === 'running' && !c.stale)
      throw new Error(`Essa campanha está sendo enviada em ${c.runningOn}. Pause antes de excluir.`)
    await repo.remove(id)
  }

  /** Ao fechar o sistema: pausa a campanha e libera a trava. */
  async shutdown(): Promise<void> {
    const id = this.runningId
    if (!id) return
    this.note = 'Pausada porque o sistema foi fechado'
    this.stop = 'pause'
    await Promise.race([this.runPromise, wait(4000)])
    if (this.runningId === id) await repo.finish(id, 'paused', this.note).catch(() => {})
  }

  private async run(id: string): Promise<void> {
    let final: Final
    try {
      final = await this.loop(id)
    } catch (e) {
      final = { status: 'paused', note: `Erro: ${(e as Error).message}` }
    }
    if (final) {
      const f = final
      await retry(() => repo.finish(id, f.status, f.note)).catch(() => {})
    }
    this.runningId = null
    this.nextSendAt = undefined
    this.current = null
    this.runPromise = null
    try {
      this.emit('progress', await repo.get(id))
    } catch {
      /* sem conexão: a lista atualiza na próxima consulta */
    }
  }

  /** Sinal de vida + recebe pedidos de outros computadores. */
  private async beat(id: string): Promise<void> {
    try {
      const cmd = await repo.heartbeat(id, this.nextSendAt)
      if (cmd === 'lost') this.stop = 'lost'
      else if (cmd === 'cancel') this.stop = 'cancel'
      else if (cmd === 'pause' && !this.stop) {
        this.stop = 'pause'
        this.note = 'Pausada por outro computador'
      }
    } catch {
      /* internet instável: tenta de novo no próximo sinal */
    }
  }

  /** Espera interrompível (pausar/cancelar responde na hora). */
  private async sleep(ms: number, id: string): Promise<void> {
    this.nextSendAt = Date.now() + ms
    await this.beat(id)
    this.emitProgress()
    const end = this.nextSendAt
    let lastBeat = Date.now()
    while (Date.now() < end && !this.stop) {
      await wait(Math.min(250, Math.max(0, end - Date.now())))
      if (Date.now() - lastBeat >= 20_000) {
        lastBeat = Date.now()
        await this.beat(id)
      }
    }
    this.nextSendAt = undefined
  }

  private async mark(sendId: number, status: Exclude<ResultStatus, 'pending'>, error?: string, sender?: string) {
    await retry(() => repo.mark(sendId, { status, error, sender }))
    if (this.current) {
      this.current.pending = Math.max(0, this.current.pending - 1)
      this.current[COUNTER[status]]++
    }
    this.emitProgress()
  }

  private async loop(id: string): Promise<Final> {
    const camp = await repo.row(id)
    const mediaPath = camp.midia_caminho ? await media.download(camp.midia_caminho) : undefined
    const sender = this.wa.status().me ?? ''
    let sentToday = sender ? await stats.sentToday(sender) : 0
    let inBatch = 0
    let exhausted = false

    outer: while (!this.stop) {
      const batch = await retry(() => repo.pending(id, 25))
      if (!batch.length) {
        exhausted = true
        break
      }
      for (const r of batch) {
        await this.beat(id)
        if (this.stop) break outer

        const contact = r.contato_id ? await retry(() => contacts.get(r.contato_id!)) : null
        if (!contact || contact.descadastrado) {
          await this.mark(r.id, 'skipped', contact ? 'Contato descadastrado' : 'Contato removido')
          continue
        }
        const s = getSettings()
        if (/\{link\}/i.test(camp.mensagem) && !s.contractLink) {
          this.note = 'O link de autocontratação foi apagado nas Configurações. Cadastre de novo e continue a campanha.'
          this.stop = 'pause'
          break outer
        }
        if (sentToday >= s.dailyLimit) {
          this.note = `Limite diário de ${s.dailyLimit} envios deste número atingido. Continue amanhã.`
          this.stop = 'pause'
          break outer
        }
        if (!this.wa.isConnected()) {
          this.note = 'WhatsApp desconectado. Reconecte e continue a campanha.'
          this.stop = 'pause'
          break outer
        }

        let text = renderMessage(
          camp.mensagem || '',
          { name: contact.nome, phone: contact.telefone },
          { link: s.contractLink }
        )
        if (s.appendOptOut && s.optOutText && text) text += `\n\n_${s.optOutText}_`

        let status: 'sent' | 'failed' | 'invalid' = 'sent'
        let error: string | undefined
        try {
          await this.wa.send(contact.telefone, {
            text,
            mediaPath,
            template: camp.template?.name
              ? { ...camp.template, params: [contact.nome.split(/\s+/)[0] || contact.nome] }
              : undefined
          })
          sentToday++
        } catch (e) {
          status = e instanceof InvalidNumberError ? 'invalid' : 'failed'
          error = (e as Error).message
        }
        await this.mark(r.id, status, error, sender)
        if (status === 'sent') this.emit('sent')

        if (this.current && this.current.pending === 0) {
          exhausted = true
          break outer
        }
        if (status === 'invalid') continue // número sem WhatsApp: segue sem esperar

        inBatch++
        if (camp.lote_tamanho > 0 && inBatch >= camp.lote_tamanho) {
          inBatch = 0
          await this.sleep(Number(camp.lote_pausa) * 60_000, id)
        } else {
          await this.sleep(randomBetween(camp.intervalo_min, camp.intervalo_max) * 1000, id)
        }
      }
    }

    if (this.stop === 'lost') return null // outro computador assumiu: não mexe mais
    if (this.stop === 'cancel') return { status: 'cancelled' }
    if (exhausted && !this.stop) return { status: 'done' }
    return { status: 'paused', note: this.note }
  }
}
