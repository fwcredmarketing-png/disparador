import { EventEmitter } from 'events'
import type {
  CampaignFormat,
  CampaignInput,
  CampaignStatus,
  CampaignSummary,
  Channel,
  CloudTemplate,
  ResultStatus
} from '@shared/types'
import type { SmsSender } from './sms'
import { ehCelular, INTERVALO_CELULAR } from '@shared/sms'
import { campaigns as repo, contacts, media, stats } from './repo'
import { getSettings } from './settings'
import { mediaInfo } from './media'
import { normalizePhone, randomBetween, renderMessage } from './utils'
import { InvalidNumberError, type SendContent } from './whatsapp/provider'
import type { Sender, WhatsAppManager } from './whatsapp/manager'

type Stop = 'pause' | 'cancel' | 'lost' | null
type Final = { status: CampaignStatus; note?: string } | null

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Falhas seguidas que tiram um número do revezamento (até a campanha ser retomada). */
const MAX_FALHAS_SEGUIDAS = 3
/** Números diferentes que tentam a mesma mensagem antes de marcá-la como falha. */
const MAX_TENTATIVAS_POR_CONTATO = 2
/** Quanto tempo espera algum número reconectar antes de pausar a campanha. */
const ESPERA_RECONEXAO = 90_000

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

/** O que define a mensagem: vem do banco (campanha) ou do formulário (envio de teste). */
interface Molde {
  canal: Channel
  mensagem: string
  formato: CampaignFormat
  cartaoTitulo?: string | null
  cartaoDescricao?: string | null
  botaoTexto?: string | null
  template?: CloudTemplate | null
}

/** Texto padrão do botão (o WhatsApp corta textos de botão longos: máximo de 20 letras). */
const BOTAO_PADRAO = 'Simular agora'
const BOTAO_MAX = 20

/** Formatos que levam o link de autocontratação. */
const usaLink = (m: Molde) => m.formato === 'cartao' || m.formato === 'botao' || /\{link\}/i.test(m.mensagem)

/** Texto do SMS de um contato (SMS não tem negrito/itálico: o aviso de descadastro vai sem formatação). */
function textoSms(m: Molde, contato: { nome: string; telefone: string }): string {
  const s = getSettings()
  let text = renderMessage(m.mensagem || '', { name: contato.nome, phone: contato.telefone }, { link: s.contractLink })
  if (s.appendOptOut && s.optOutText && text) text += `\n${s.optOutText}`
  return text
}

/** Remetente gravado nos envios por SMS (não conta no limite diário dos números de WhatsApp). */
const SMS_SENDER = 'sms'

/** Monta o que vai para o WhatsApp de um contato. */
function montarConteudo(m: Molde, contato: { nome: string; telefone: string }, mediaPath?: string): SendContent {
  const s = getSettings()
  const cartao = m.formato === 'cartao'
  const botao = m.formato === 'botao'
  let text = renderMessage(m.mensagem || '', { name: contato.nome, phone: contato.telefone }, { link: s.contractLink })
  // no cartão, o link precisa estar no texto para o WhatsApp montar o cartão clicável
  if (cartao && !text.includes(s.contractLink)) text = `${text}\n\n${s.contractLink}`.trim()
  if (s.appendOptOut && s.optOutText && text) text += `\n\n_${s.optOutText}_`
  return {
    text,
    mediaPath: cartao || botao ? undefined : mediaPath,
    card: cartao
      ? {
          url: s.contractLink,
          title: m.cartaoTitulo || 'Simule agora',
          description: m.cartaoDescricao || '',
          imagePath: mediaPath
        }
      : undefined,
    button: botao ? { text: m.botaoTexto || BOTAO_PADRAO, url: s.contractLink, imagePath: mediaPath } : undefined,
    template: m.template?.name ? { ...m.template, params: [contato.nome.split(/\s+/)[0] || contato.nome] } : undefined
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
 * Usa todos os números conectados neste computador: revezando entre eles (ou um por vez, no
 * modo reserva). Se um número cai, é restringido ou bate o limite do dia, segue pelos outros.
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

  constructor(
    private wa: WhatsAppManager,
    private sms: SmsSender
  ) {
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

  /** Confere a mensagem do formulário (vale para criar a campanha e para o envio de teste). */
  private async validarMensagem(input: CampaignInput): Promise<Molde> {
    const s = getSettings()
    if (input.channel === 'sms') {
      if (!input.message?.trim()) throw new Error('Escreva o texto do SMS')
      if (input.mediaPath) throw new Error('SMS não leva imagem nem arquivo. Tire o anexo ou use o WhatsApp.')
      if (/\{link\}/i.test(input.message) && !s.contractLink)
        throw new Error('A mensagem usa {link}, mas o link de autocontratação não foi cadastrado (Configurações).')
      if (!this.sms.configured())
        throw new Error('Configure o SMS na tela Conexão (endereço da API e token do provedor) antes de usar.')
      return { canal: 'sms', mensagem: input.message, formato: 'imagem', template: null }
    }
    const format: CampaignFormat = input.format === 'cartao' || input.format === 'botao' ? input.format : 'imagem'
    if (!input.message?.trim() && !input.mediaPath && !input.template?.name)
      throw new Error('Escreva a mensagem ou anexe uma mídia')
    if (/\{link\}/i.test(input.message ?? '') && !s.contractLink)
      throw new Error('A mensagem usa {link}, mas o link de autocontratação não foi cadastrado (Configurações).')
    // confere tipo e tamanho do anexo antes de enviar ao Storage
    const anexo = input.mediaPath ? await mediaInfo(input.mediaPath) : null
    if (format === 'cartao') {
      if (!s.contractLink)
        throw new Error('O cartão clicável abre o link de autocontratação, que ainda não foi cadastrado (Configurações).')
      if (anexo && anexo.kind !== 'image') throw new Error('No cartão clicável o anexo precisa ser uma imagem (JPG, PNG ou WEBP).')
      if (!input.cardTitle?.trim()) throw new Error('Escreva o título do cartão')
    }
    if (format === 'botao') {
      if (s.provider === 'cloud')
        throw new Error('Na API oficial, o botão vem de um modelo (template) aprovado pela Meta. Use o campo de template.')
      if (!s.contractLink)
        throw new Error('O botão abre o link de autocontratação, que ainda não foi cadastrado (Configurações).')
      if (anexo && anexo.kind !== 'image') throw new Error('No formato botão o anexo precisa ser uma imagem (JPG, PNG ou WEBP).')
      if (!input.message?.trim()) throw new Error('No formato botão, escreva o texto que vai acima do botão')
      if ((input.message ?? '').length > 1000) throw new Error('No formato botão, o texto pode ter no máximo 1000 letras')
      const t = input.buttonText?.trim() ?? ''
      if (!t) throw new Error('Escreva o texto do botão')
      if (t.length > BOTAO_MAX) throw new Error(`O texto do botão pode ter no máximo ${BOTAO_MAX} letras`)
    }
    return {
      canal: 'whatsapp',
      mensagem: input.message ?? '',
      formato: format,
      cartaoTitulo: format === 'cartao' ? input.cardTitle!.trim().slice(0, 100) : null,
      cartaoDescricao: format === 'cartao' ? (input.cardDescription ?? '').trim().slice(0, 200) : null,
      botaoTexto: format === 'botao' ? input.buttonText!.trim() : null,
      template: input.template?.name ? input.template : null
    }
  }

  /** Envia a mensagem do formulário para um número de teste (WhatsApp: pelo primeiro número conectado). */
  async test(input: CampaignInput, phone: string): Promise<string> {
    const numero = normalizePhone(phone ?? '')
    if (!numero) throw new Error('Número de teste inválido. Digite com DDD, por exemplo: 11 99999-8888.')
    const molde = await this.validarMensagem(input)
    if (molde.canal === 'sms') {
      const r = await this.sms.send(numero, textoSms(molde, { nome: 'Teste', telefone: numero }))
      return r.test ? `${SMS_SENDER}-sandbox` : SMS_SENDER
    }
    const x = this.wa.senders()[0]
    if (!x) throw new Error('Conecte pelo menos um WhatsApp para enviar o teste')
    await this.wa.send(x.id, numero, montarConteudo(molde, { nome: 'Teste', telefone: numero }, input.mediaPath))
    return x.me
  }

  async create(input: CampaignInput): Promise<CampaignSummary> {
    if (!input.name?.trim()) throw new Error('Dê um nome para a campanha')
    const molde = await this.validarMensagem(input)
    const format = molde.formato
    const tag = input.tag?.trim() || undefined
    const list = await contacts.forCampaign(tag)
    if (!list.length) throw new Error('Nenhum contato disponível para essa campanha')

    // SMS pelo celular Android: o Android segura o envio depois de ~30 SMS em 30 min; o mínimo fica abaixo disso
    const minimo = molde.canal === 'sms' && ehCelular(getSettings().sms) ? INTERVALO_CELULAR : 3
    const delayMin = Math.max(minimo, Math.floor(Number(input.delayMin) || minimo))
    const id = await repo
      .insert({
        nome: input.name.trim(),
        mensagem: molde.mensagem,
        etiqueta: tag ?? null,
        intervalo_min: delayMin,
        intervalo_max: Math.max(delayMin, Math.floor(Number(input.delayMax) || delayMin)),
        lote_tamanho: Math.max(0, Math.floor(Number(input.batchSize) || 0)),
        lote_pausa: Math.max(0, Number(input.batchPause) || 0),
        template: molde.template,
        formato: format,
        cartao_titulo: molde.cartaoTitulo,
        cartao_descricao: molde.cartaoDescricao,
        // colunas da migração 005: só vão quando usadas (o resto funciona mesmo sem a migração)
        ...(format === 'botao' ? { botao_texto: molde.botaoTexto } : {}),
        ...(molde.canal === 'sms' ? { canal: 'sms' } : {})
      })
      .catch((e: Error) => {
        const novo = format === 'botao' || molde.canal === 'sms'
        if (novo && /botao_texto|canal|formato_check|check constraint|schema cache/i.test(e.message))
          throw new Error(
            `O banco ainda não foi atualizado para ${molde.canal === 'sms' ? 'campanhas de SMS' : 'o formato botão'}. O administrador precisa rodar a migração 005 no Supabase (SQL Editor).`
          )
        throw e
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
    const c = await repo.get(id)
    if (c.channel === 'sms') {
      if (!this.sms.configured()) throw new Error('Configure o SMS na tela Conexão antes de iniciar')
    } else if (!this.wa.isConnected()) throw new Error('Conecte pelo menos um WhatsApp antes de iniciar')
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

  /** Espera algum número reconectar (o WhatsApp costuma voltar sozinho em segundos). */
  private async aguardarConexao(id: string): Promise<boolean> {
    const fim = Date.now() + ESPERA_RECONEXAO
    let lastBeat = Date.now()
    while (Date.now() < fim && !this.stop) {
      if (this.wa.isConnected()) return true
      await wait(1000)
      if (Date.now() - lastBeat >= 20_000) {
        lastBeat = Date.now()
        await this.beat(id)
      }
    }
    return this.wa.isConnected()
  }

  private async loop(id: string): Promise<Final> {
    const camp = await repo.row(id)
    const mediaPath = camp.midia_caminho ? await media.download(camp.midia_caminho) : undefined
    const sms = camp.canal === 'sms'
    const molde: Molde = {
      canal: sms ? 'sms' : 'whatsapp',
      mensagem: camp.mensagem,
      formato: camp.formato ?? 'imagem',
      cartaoTitulo: camp.cartao_titulo,
      cartaoDescricao: camp.cartao_descricao,
      botaoTexto: camp.botao_texto,
      template: camp.template
    }
    let inBatch = 0
    let exhausted = false

    // Controle por número (vale até a campanha ser pausada ou terminar)
    const enviadosHoje = new Map<string, number>()
    const falhasSeguidas = new Map<string, number>()
    const foraDoRevezamento = new Set<string>()
    let ultimo: string | undefined

    /** Escolhe o número que envia a próxima mensagem (ou nenhum, se nenhum puder). */
    const escolher = async (evitar: Set<string>): Promise<Sender | null> => {
      // SMS: um único "remetente" (a API do provedor), sem o limite diário dos números de WhatsApp
      if (sms)
        return this.sms.configured() && !evitar.has(SMS_SENDER) && !foraDoRevezamento.has(SMS_SENDER)
          ? { id: SMS_SENDER, me: SMS_SENDER }
          : null
      const s = getSettings()
      const todos = this.wa.senders()
      const livres: Sender[] = []
      for (const x of todos) {
        if (evitar.has(x.me) || foraDoRevezamento.has(x.me)) continue
        if (!enviadosHoje.has(x.me)) enviadosHoje.set(x.me, await retry(() => stats.sentToday(x.me)))
        if (enviadosHoje.get(x.me)! < s.dailyLimit) livres.push(x)
      }
      if (!livres.length) return null
      if (s.rotation === 'reserva') return livres[0]
      // revezar: o próximo da lista depois do último que enviou
      const ordem = todos.map((x) => x.me)
      const n = ordem.length
      const pos = ultimo ? ordem.indexOf(ultimo) : -1
      const dist = (x: Sender) => (ordem.indexOf(x.me) - pos - 1 + n) % n
      return livres.sort((a, b) => dist(a) - dist(b))[0]
    }

    /** Explica por que nenhum número pôde enviar. */
    const motivoSemNumero = (ultimoErro?: string): string => {
      if (sms)
        return this.sms.configured()
          ? `A API de SMS falhou várias vezes seguidas. Confira a configuração na tela Conexão → SMS e continue a campanha.${ultimoErro ? ` Último erro: ${ultimoErro}` : ''}`
          : 'O SMS não está configurado neste computador. Configure na tela Conexão → SMS e continue a campanha.'
      const s = getSettings()
      const todos = this.wa.senders()
      if (!todos.length) return 'Nenhum WhatsApp conectado. Reconecte (ou conecte outro número) e continue a campanha.'
      const comFalha = todos.filter((x) => foraDoRevezamento.has(x.me)).length
      const noLimite = todos.filter(
        (x) => !foraDoRevezamento.has(x.me) && (enviadosHoje.get(x.me) ?? 0) >= s.dailyLimit
      ).length
      const partes: string[] = []
      if (noLimite)
        partes.push(
          todos.length === 1
            ? `o número atingiu o limite diário de ${s.dailyLimit} envios`
            : `${noLimite} no limite diário de ${s.dailyLimit} envios`
        )
      if (comFalha)
        partes.push(
          todos.length === 1
            ? 'o número falhou várias vezes seguidas (pode estar restrito)'
            : `${comFalha} com falhas seguidas (podem estar restritos)`
        )
      const oQueFazer = comFalha
        ? 'Confira os números na tela Conexão (ou conecte outro) e continue a campanha.'
        : 'Conecte outro número na tela Conexão ou continue amanhã.'
      const erro = comFalha && ultimoErro ? ` Último erro: ${ultimoErro}` : ''
      return `Nenhum número disponível: ${partes.join(' e ')}. ${oQueFazer}${erro}`
    }

    let ultimoErro: string | undefined

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
        if (usaLink(molde) && !getSettings().contractLink) {
          this.note = 'O link de autocontratação foi apagado nas Configurações. Cadastre de novo e continue a campanha.'
          this.stop = 'pause'
          break outer
        }
        // WhatsApp: conteúdo montado uma vez (a mesma variação do texto em todas as tentativas)
        const content = sms ? undefined : montarConteudo(molde, contact, mediaPath)
        const texto = sms ? textoSms(molde, contact) : ''

        // Envia pelo número da vez; se ele falhar, tenta por outro número antes de desistir
        let status: 'sent' | 'failed' | 'invalid' | undefined
        let error: string | undefined
        let sender = ''
        const tentados = new Set<string>()
        while (!status) {
          const x = await escolher(tentados)
          if (!x) {
            if (tentados.size) {
              status = 'failed' // já tentou e nenhum outro número pode tentar de novo
              break
            }
            // nenhum número disponível: espera reconectar ou pausa explicando o motivo
            if (!sms && !this.wa.isConnected() && (await this.aguardarConexao(id))) continue
            if (this.stop) break outer
            this.note = motivoSemNumero(ultimoErro)
            this.stop = 'pause'
            break outer
          }
          sender = x.me
          try {
            if (content) await this.wa.send(x.id, contact.telefone, content)
            else await this.sms.send(contact.telefone, texto)
            status = 'sent'
            enviadosHoje.set(x.me, (enviadosHoje.get(x.me) ?? 0) + 1)
            falhasSeguidas.set(x.me, 0)
          } catch (e) {
            error = (e as Error).message
            if (e instanceof InvalidNumberError) {
              status = 'invalid'
            } else {
              ultimoErro = error
              tentados.add(x.me)
              const n = (falhasSeguidas.get(x.me) ?? 0) + 1
              falhasSeguidas.set(x.me, n)
              if (n >= MAX_FALHAS_SEGUIDAS && !foraDoRevezamento.has(x.me)) {
                foraDoRevezamento.add(x.me)
                if (this.current && !sms)
                  this.current.note = `O número +${x.me} falhou ${n} vezes seguidas e saiu do revezamento (pode estar restrito). Os envios seguem pelos outros números.`
              }
              if (tentados.size >= MAX_TENTATIVAS_POR_CONTATO) status = 'failed'
            }
          }
          ultimo = x.me
        }
        await this.mark(r.id, status, status === 'sent' ? undefined : error, sender)
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
