import { EventEmitter } from 'events'
import type { Campaign, CampaignInput, CampaignSummary } from '@shared/types'
import { store } from './store'
import { randomBetween, renderMessage, uid } from './utils'
import { InvalidNumberError } from './whatsapp/provider'
import type { WhatsAppManager } from './whatsapp/manager'

export function summarize(c: Campaign): CampaignSummary {
  const { results, ...rest } = c
  const count = (s: string) => results.filter((r) => r.status === s).length
  return {
    ...rest,
    total: results.length,
    sent: count('sent'),
    failed: count('failed'),
    invalid: count('invalid'),
    skipped: count('skipped'),
    pending: count('pending'),
    recent: results
      .filter((r) => r.status !== 'pending')
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      .slice(0, 30)
  }
}

/**
 * Motor de disparo: envia uma mensagem por vez, com intervalos aleatórios,
 * pausas entre lotes, limite diário e respeito ao descadastro (opt-out).
 */
export class CampaignEngine extends EventEmitter {
  private runningId: string | null = null
  private stopRequested: 'pause' | 'cancel' | null = null

  constructor(private wa: WhatsAppManager) {
    super()
  }

  get running(): string | null {
    return this.runningId
  }

  private find(id: string): Campaign {
    const c = store.data.campaigns.find((x) => x.id === id)
    if (!c) throw new Error('Campanha não encontrada')
    return c
  }

  private progress(c: Campaign): void {
    store.save()
    this.emit('progress', summarize(c))
  }

  create(input: CampaignInput): CampaignSummary {
    if (!input.name?.trim()) throw new Error('Dê um nome para a campanha')
    if (!input.message?.trim() && !input.mediaPath && !input.template?.name)
      throw new Error('Escreva a mensagem ou anexe uma mídia')
    const tag = input.tag?.trim()
    const contacts = store.data.contacts.filter((c) => !c.optOut && (!tag || c.tags.includes(tag)))
    if (!contacts.length) throw new Error('Nenhum contato disponível para essa campanha')

    const c: Campaign = {
      ...input,
      id: uid(),
      name: input.name.trim(),
      delayMin: Math.max(3, Number(input.delayMin) || 3),
      delayMax: Math.max(Number(input.delayMin) || 3, Number(input.delayMax) || 3),
      batchSize: Math.max(0, Math.floor(Number(input.batchSize) || 0)),
      batchPause: Math.max(0, Number(input.batchPause) || 0),
      status: 'draft',
      createdAt: Date.now(),
      results: contacts.map((ct) => ({ contactId: ct.id, phone: ct.phone, name: ct.name, status: 'pending' }))
    }
    store.data.campaigns.unshift(c)
    store.save()
    return summarize(c)
  }

  start(id: string): void {
    const c = this.find(id)
    if (this.runningId && this.runningId !== id) throw new Error('Já existe outra campanha em andamento')
    if (this.runningId === id) return
    if (c.status === 'done' || c.status === 'cancelled') throw new Error('Essa campanha já foi finalizada')
    if (!this.wa.isConnected()) throw new Error('Conecte o WhatsApp antes de iniciar')

    c.status = 'running'
    c.note = undefined
    c.startedAt ??= Date.now()
    this.runningId = id
    this.stopRequested = null
    this.progress(c)

    this.loop(c)
      .catch((e) => {
        c.status = 'paused'
        c.note = `Erro: ${(e as Error).message}`
      })
      .finally(() => {
        this.runningId = null
        c.nextSendAt = undefined
        this.progress(c)
      })
  }

  pause(id: string): void {
    const c = this.find(id)
    if (this.runningId === id) this.stopRequested = 'pause'
    else if (c.status === 'running') c.status = 'paused'
    this.progress(c)
  }

  cancel(id: string): void {
    const c = this.find(id)
    if (this.runningId === id) this.stopRequested = 'cancel'
    else {
      c.status = 'cancelled'
      c.finishedAt = Date.now()
    }
    this.progress(c)
  }

  remove(id: string): void {
    if (this.runningId === id) throw new Error('Pause a campanha antes de excluir')
    store.data.campaigns = store.data.campaigns.filter((c) => c.id !== id)
    store.save()
  }

  /** Espera interrompível (pausar/cancelar responde imediatamente). */
  private async sleep(ms: number, c: Campaign): Promise<void> {
    c.nextSendAt = Date.now() + ms
    this.progress(c)
    const end = Date.now() + ms
    while (Date.now() < end && !this.stopRequested) {
      await new Promise((r) => setTimeout(r, Math.min(250, end - Date.now())))
    }
    c.nextSendAt = undefined
  }

  private async loop(c: Campaign): Promise<void> {
    const settings = () => store.getSettings()
    let inBatch = 0

    for (const r of c.results) {
      if (this.stopRequested) break
      if (r.status !== 'pending') continue

      const contact = store.data.contacts.find((x) => x.id === r.contactId)
      if (!contact || contact.optOut) {
        r.status = 'skipped'
        r.error = contact ? 'Contato descadastrado' : 'Contato removido'
        r.at = Date.now()
        this.progress(c)
        continue
      }
      if (store.sentToday() >= settings().dailyLimit) {
        c.note = `Limite diário de ${settings().dailyLimit} envios atingido. Continue amanhã.`
        this.stopRequested = 'pause'
        break
      }
      if (!this.wa.isConnected()) {
        c.note = 'WhatsApp desconectado. Reconecte e continue a campanha.'
        this.stopRequested = 'pause'
        break
      }

      const s = settings()
      let text = renderMessage(c.message || '', contact)
      if (s.appendOptOut && s.optOutText && text) text += `\n\n_${s.optOutText}_`

      try {
        await this.wa.send(contact.phone, {
          text,
          mediaPath: c.mediaPath,
          template: c.template?.name
            ? { ...c.template, params: [contact.name.split(/\s+/)[0] || contact.name] }
            : undefined
        })
        r.status = 'sent'
        r.error = undefined
        store.incSent()
        this.emit('sent')
      } catch (e) {
        r.status = e instanceof InvalidNumberError ? 'invalid' : 'failed'
        r.error = (e as Error).message
      }
      r.at = Date.now()
      this.progress(c)

      if (!c.results.some((x) => x.status === 'pending')) break
      if (r.status === 'invalid') continue // número inválido: segue sem esperar muito

      inBatch++
      if (c.batchSize > 0 && inBatch >= c.batchSize) {
        inBatch = 0
        await this.sleep(c.batchPause * 60_000, c)
      } else {
        await this.sleep(randomBetween(c.delayMin, c.delayMax) * 1000, c)
      }
    }

    if (this.stopRequested === 'cancel') {
      c.status = 'cancelled'
      c.finishedAt = Date.now()
    } else if (!c.results.some((x) => x.status === 'pending')) {
      c.status = 'done'
      c.finishedAt = Date.now()
      c.note = undefined
    } else {
      c.status = 'paused'
    }
    this.stopRequested = null
  }
}
