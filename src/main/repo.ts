import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import type {
  CampaignResult,
  CampaignFormat,
  CampaignStatus,
  CampaignSummary,
  CloudTemplate,
  Contact,
  Member,
  ResultStatus,
  SharedSettings,
  Stats
} from '@shared/types'
import { MEDIA_BUCKET } from './config'
import { store } from './store'
import { auth, db, dbError } from './supabase'
import { mimeFromPath } from './whatsapp/provider'

/** Acesso ao banco (Supabase). Toda a segurança fica no RLS do banco. */

type Res<T> = PromiseLike<{ data: T | null; error: { message?: string; code?: string } | null }>

async function q<T>(p: Res<T>): Promise<T> {
  const { data, error } = await p
  if (error) throw dbError(error)
  return data as T
}

/** O Supabase devolve no máximo 1000 linhas por consulta: busca em páginas. */
async function fetchAll<T>(page: (from: number, to: number) => Res<T[]>, size = 1000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += size) {
    const rows = (await q(page(from, from + size - 1))) ?? []
    out.push(...rows)
    if (rows.length < size) return out
  }
}

const ts = (v?: string | null): number | undefined => (v ? Date.parse(v) : undefined)
const timeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'

// ======================================================================
// Contatos
// ======================================================================
interface ContatoRow {
  id: string
  nome: string
  telefone: string
  tags: string[] | null
  descadastrado: boolean
  criado_em: string
}
const CONTATO = 'id,nome,telefone,tags,descadastrado,criado_em'
const toContact = (r: ContatoRow): Contact => ({
  id: r.id,
  name: r.nome,
  phone: r.telefone,
  tags: r.tags ?? [],
  optOut: r.descadastrado,
  createdAt: Date.parse(r.criado_em)
})

export const contacts = {
  async list(): Promise<Contact[]> {
    const rows = await fetchAll<ContatoRow>((a, b) =>
      db().from('contatos').select(CONTATO).order('criado_em', { ascending: false }).order('id').range(a, b)
    )
    return rows.map(toContact)
  },

  async add(c: { name: string; phone: string; tags: string[] }): Promise<Contact> {
    const { data, error } = await db()
      .from('contatos')
      .insert({ nome: c.name, telefone: c.phone, tags: c.tags })
      .select(CONTATO)
      .single()
    if (error?.code === '23505') throw new Error('Esse número já está cadastrado')
    if (error) throw dbError(error)
    return toContact(data as ContatoRow)
  },

  async remove(id: string): Promise<void> {
    await q(db().from('contatos').delete().eq('id', id))
  },

  async setOptOut(id: string, optOut: boolean): Promise<void> {
    await q(db().from('contatos').update({ descadastrado: optOut }).eq('id', id))
  },

  async clear(): Promise<void> {
    await q(db().rpc('limpar_contatos'))
  },

  async tags(): Promise<string[]> {
    const rows = (await q<unknown[]>(db().rpc('etiquetas'))) ?? []
    return rows.map((r) => (typeof r === 'string' ? r : String(Object.values(r as object)[0] ?? '')))
  },

  /** Insere em lotes e ignora telefones já cadastrados. Devolve quantos entraram. */
  async importRows(rows: { name: string; phone: string; tags: string[] }[]): Promise<number> {
    let added = 0
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({ nome: r.name, telefone: r.phone, tags: r.tags }))
      const data = await q(
        db().from('contatos').upsert(chunk, { onConflict: 'telefone', ignoreDuplicates: true }).select('id')
      )
      added += data?.length ?? 0
    }
    return added
  },

  /** Descadastro automático (resposta "SAIR"). Devolve quantos contatos foram afetados. */
  async optOutByPhone(phone: string): Promise<number> {
    return (await q<number>(db().rpc('descadastrar_telefone', { p_telefone: phone }))) ?? 0
  },

  async forCampaign(tag?: string): Promise<{ id: string; nome: string; telefone: string }[]> {
    return fetchAll((a, b) => {
      let qb = db().from('contatos').select('id,nome,telefone').eq('descadastrado', false)
      if (tag) qb = qb.contains('tags', [tag])
      return qb.order('criado_em').order('id').range(a, b)
    })
  },

  async get(id: string): Promise<{ nome: string; telefone: string; descadastrado: boolean } | null> {
    return q(db().from('contatos').select('nome,telefone,descadastrado').eq('id', id).maybeSingle())
  }
}

// ======================================================================
// Equipe
// ======================================================================
export const team = {
  async list(): Promise<Member[]> {
    const rows = await q<{ email: string; nome: string; admin: boolean; criado_em: string }[]>(
      db().from('membros').select('*').order('admin', { ascending: false }).order('nome')
    )
    return (rows ?? []).map((r) => ({ email: r.email, name: r.nome, admin: r.admin, createdAt: Date.parse(r.criado_em) }))
  },

  async add(m: { email: string; name: string; admin: boolean }): Promise<void> {
    const email = m.email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido')
    const { error } = await db().from('membros').insert({ email, nome: m.name?.trim() ?? '', admin: !!m.admin })
    if (error?.code === '23505') throw new Error('Esse e-mail já está na equipe')
    if (error) throw dbError(error)
  },

  async remove(email: string): Promise<void> {
    if (email === auth.current.email) throw new Error('Você não pode remover a si mesmo')
    await q(db().from('membros').delete().eq('email', email))
  }
}

// ======================================================================
// Configurações compartilhadas
// ======================================================================
interface ConfigRow {
  limite_diario: number
  palavras_descadastro: string[]
  adicionar_aviso: boolean
  texto_aviso: string
  simular_digitando: boolean
  link_autocontratacao: string | null
}

export const sharedSettings = {
  async get(): Promise<SharedSettings> {
    const r = await q<ConfigRow | null>(db().from('configuracoes').select('*').eq('id', 1).maybeSingle())
    if (!r) throw new Error('Configurações não encontradas no banco')
    return {
      dailyLimit: r.limite_diario,
      optOutKeywords: r.palavras_descadastro ?? [],
      appendOptOut: r.adicionar_aviso,
      optOutText: r.texto_aviso,
      simulateTyping: r.simular_digitando,
      contractLink: r.link_autocontratacao ?? ''
    }
  },

  async save(s: SharedSettings): Promise<void> {
    const rows = await q<{ id: number }[]>(
      db()
        .from('configuracoes')
        .update({
          limite_diario: s.dailyLimit,
          palavras_descadastro: s.optOutKeywords,
          adicionar_aviso: s.appendOptOut,
          texto_aviso: s.optOutText,
          simular_digitando: s.simulateTyping,
          link_autocontratacao: s.contractLink,
          atualizado_em: new Date().toISOString()
        })
        .eq('id', 1)
        .select('id')
    )
    if (!rows?.length) throw new Error('Somente administradores podem alterar essas configurações')
  }
}

// ======================================================================
// Mídias das campanhas (Storage)
// ======================================================================
const safeName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '_')
    .slice(-120) || 'arquivo'

export const media = {
  async upload(campaignId: string, localPath: string): Promise<{ key: string; name: string }> {
    const buf = await readFile(localPath)
    if (buf.length > 50 * 1024 * 1024) throw new Error('A mídia passa de 50 MB')
    const name = safeName(basename(localPath))
    const key = `${campaignId}/${name}`
    const { error } = await db()
      .storage.from(MEDIA_BUCKET)
      .upload(key, buf, { contentType: mimeFromPath(localPath).mime, upsert: true })
    if (error) throw dbError(error, 'Falha ao enviar a mídia')
    return { key, name: basename(localPath) }
  },

  /** Baixa a mídia uma vez e guarda em cache neste computador. */
  async download(key: string): Promise<string> {
    const local = join(store.mediaCacheDir, ...key.split('/'))
    if (existsSync(local)) return local
    const { data, error } = await db().storage.from(MEDIA_BUCKET).download(key)
    if (error || !data) throw dbError(error, 'Falha ao baixar a mídia da campanha')
    await mkdir(dirname(local), { recursive: true })
    await writeFile(local, Buffer.from(await data.arrayBuffer()))
    return local
  },

  async removeFolder(campaignId: string): Promise<void> {
    const { data } = await db().storage.from(MEDIA_BUCKET).list(campaignId)
    const keys = (data ?? []).map((f) => `${campaignId}/${f.name}`)
    if (keys.length) await db().storage.from(MEDIA_BUCKET).remove(keys)
  }
}

// ======================================================================
// Campanhas
// ======================================================================
interface CampanhaRow {
  id: string
  nome: string
  mensagem: string
  midia_caminho: string | null
  midia_nome: string | null
  etiqueta: string | null
  intervalo_min: number
  intervalo_max: number
  lote_tamanho: number
  lote_pausa: number | string
  template: CloudTemplate | null
  formato: CampaignFormat | null
  cartao_titulo: string | null
  cartao_descricao: string | null
  status: CampaignStatus
  observacao: string | null
  executor: string | null
  executor_nome: string | null
  proximo_envio_em: string | null
  criado_em: string
  criado_por: string | null
  iniciado_em: string | null
  finalizado_em: string | null
}

interface ResumoRow extends CampanhaRow {
  total: number | string
  enviados: number | string
  falhas: number | string
  invalidos: number | string
  ignorados: number | string
  pendentes: number | string
  sem_sinal: boolean
}

const toSummary = (r: ResumoRow): CampaignSummary => ({
  id: r.id,
  name: r.nome,
  message: r.mensagem,
  mediaName: r.midia_nome ?? undefined,
  tag: r.etiqueta ?? undefined,
  delayMin: r.intervalo_min,
  delayMax: r.intervalo_max,
  batchSize: r.lote_tamanho,
  batchPause: Number(r.lote_pausa),
  template: r.template ?? undefined,
  format: r.formato ?? 'imagem',
  cardTitle: r.cartao_titulo ?? undefined,
  cardDescription: r.cartao_descricao ?? undefined,
  status: r.status,
  createdAt: Date.parse(r.criado_em),
  createdBy: r.criado_por ?? undefined,
  startedAt: ts(r.iniciado_em),
  finishedAt: ts(r.finalizado_em),
  note: r.observacao ?? undefined,
  nextSendAt: r.status === 'running' ? ts(r.proximo_envio_em) : undefined,
  runningOn: r.status === 'running' ? (r.executor_nome ?? undefined) : undefined,
  runningHere: r.status === 'running' && r.executor === store.machineId,
  stale: !!r.sem_sinal,
  total: Number(r.total),
  sent: Number(r.enviados),
  failed: Number(r.falhas),
  invalid: Number(r.invalidos),
  skipped: Number(r.ignorados),
  pending: Number(r.pendentes)
})

export interface PendingSend {
  id: number
  contato_id: string | null
  telefone: string
  nome: string
}

export const campaigns = {
  async list(): Promise<CampaignSummary[]> {
    const rows = await q<ResumoRow[]>(
      db().from('campanhas_resumo').select('*').order('criado_em', { ascending: false }).limit(200)
    )
    return (rows ?? []).map(toSummary)
  },

  async get(id: string): Promise<CampaignSummary> {
    const r = await q<ResumoRow | null>(db().from('campanhas_resumo').select('*').eq('id', id).maybeSingle())
    if (!r) throw new Error('Campanha não encontrada')
    return toSummary(r)
  },

  async row(id: string): Promise<CampanhaRow> {
    const r = await q<CampanhaRow | null>(db().from('campanhas').select('*').eq('id', id).maybeSingle())
    if (!r) throw new Error('Campanha não encontrada')
    return r
  },

  async insert(values: Record<string, unknown>): Promise<string> {
    const r = await q<{ id: string }>(db().from('campanhas').insert(values).select('id').single())
    return r.id
  },

  async setMedia(id: string, key: string, name: string): Promise<void> {
    await q(db().from('campanhas').update({ midia_caminho: key, midia_nome: name }).eq('id', id))
  },

  async insertSends(id: string, list: { id: string; nome: string; telefone: string }[]): Promise<void> {
    for (let i = 0; i < list.length; i += 1000) {
      const chunk = list
        .slice(i, i + 1000)
        .map((c) => ({ campanha_id: id, contato_id: c.id, telefone: c.telefone, nome: c.nome }))
      await q(db().from('envios').insert(chunk))
    }
  },

  async remove(id: string): Promise<void> {
    await q(db().from('campanhas').delete().eq('id', id))
    await media.removeFolder(id).catch(() => {})
  },

  /** Trava: só um computador envia cada campanha. */
  async claim(id: string): Promise<boolean> {
    return !!(await q<boolean>(
      db().rpc('assumir_campanha', { p_id: id, p_executor: store.machineId, p_executor_nome: auth.label() })
    ))
  },

  /** "Estou vivo". Devolve '' / 'pause' / 'cancel' / 'lost'. */
  async heartbeat(id: string, nextSendAt?: number): Promise<string> {
    return (
      (await q<string>(
        db().rpc('sinal_campanha', {
          p_id: id,
          p_executor: store.machineId,
          p_proximo: nextSendAt ? new Date(nextSendAt).toISOString() : null
        })
      )) ?? ''
    )
  },

  /** Pausar/cancelar uma campanha (inclusive rodando em outro computador). */
  async control(id: string, action: 'pause' | 'cancel'): Promise<void> {
    await q(db().rpc('controlar_campanha', { p_id: id, p_acao: action }))
  },

  async finish(id: string, status: CampaignStatus, note?: string): Promise<void> {
    await q(
      db()
        .from('campanhas')
        .update({
          status,
          observacao: note ?? null,
          finalizado_em: status === 'done' || status === 'cancelled' ? new Date().toISOString() : null,
          executor: null,
          comando: null,
          proximo_envio_em: null,
          sinal_em: null
        })
        .eq('id', id)
        .eq('executor', store.machineId)
    )
  },

  /** Ao abrir o sistema: campanhas que este computador deixou "enviando" ficam pausadas. */
  async releaseMine(): Promise<void> {
    await q(
      db()
        .from('campanhas')
        .update({
          status: 'paused',
          observacao: 'Pausada porque o sistema foi fechado',
          executor: null,
          comando: null,
          proximo_envio_em: null,
          sinal_em: null
        })
        .eq('executor', store.machineId)
        .eq('status', 'running')
    )
  },

  async pending(id: string, limit: number): Promise<PendingSend[]> {
    return (
      (await q<PendingSend[]>(
        db()
          .from('envios')
          .select('id,contato_id,telefone,nome')
          .eq('campanha_id', id)
          .eq('status', 'pending')
          .order('id')
          .limit(limit)
      )) ?? []
    )
  },

  async mark(
    sendId: number,
    v: { status: ResultStatus; error?: string; sender?: string }
  ): Promise<void> {
    await q(
      db()
        .from('envios')
        .update({
          status: v.status,
          erro: v.error ?? null,
          remetente: v.sender || null,
          enviado_por: auth.current.email ?? null,
          feito_em: new Date().toISOString()
        })
        .eq('id', sendId)
    )
  },

  async log(id: string, limit = 50): Promise<CampaignResult[]> {
    const rows = await q<{ nome: string; telefone: string; status: ResultStatus; erro: string | null; feito_em: string | null }[]>(
      db()
        .from('envios')
        .select('nome,telefone,status,erro,feito_em')
        .eq('campanha_id', id)
        .neq('status', 'pending')
        .order('feito_em', { ascending: false })
        .limit(limit)
    )
    return (rows ?? []).map((r) => ({
      name: r.nome,
      phone: r.telefone,
      status: r.status,
      error: r.erro ?? undefined,
      at: ts(r.feito_em)
    }))
  },

  async allResults(id: string): Promise<CampaignResult[]> {
    const rows = await fetchAll<{ nome: string; telefone: string; status: ResultStatus; erro: string | null; feito_em: string | null }>(
      (a, b) =>
        db().from('envios').select('nome,telefone,status,erro,feito_em').eq('campanha_id', id).order('id').range(a, b)
    )
    return rows.map((r) => ({ name: r.nome, phone: r.telefone, status: r.status, error: r.erro ?? undefined, at: ts(r.feito_em) }))
  },

  /** Alguma campanha da equipe enviando agora (para o painel). */
  async runningName(): Promise<string | undefined> {
    const rows = await q<{ nome: string; executor_nome: string | null }[]>(
      db()
        .from('campanhas_resumo')
        .select('nome,executor_nome')
        .eq('status', 'running')
        .eq('sem_sinal', false)
        .limit(1)
    )
    const r = rows?.[0]
    return r ? `${r.nome}${r.executor_nome ? ` (${r.executor_nome})` : ''}` : undefined
  }
}

// ======================================================================
// Estatísticas
// ======================================================================
export const stats = {
  async get(sender?: string): Promise<Omit<Stats, 'runningCampaign'>> {
    return q(db().rpc('estatisticas', { p_remetente: sender ?? null, p_tz: timeZone() }))
  },

  async sentToday(sender: string): Promise<number> {
    return (await q<number>(db().rpc('enviados_hoje', { p_remetente: sender, p_tz: timeZone() }))) ?? 0
  }
}
