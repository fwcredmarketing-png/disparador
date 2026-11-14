import type { SmsConfig } from '@shared/types'
import { semAcentos, smsConfigurado } from '@shared/sms'

/** Telefone no formato que o provedor espera (o sistema guarda como 5511999998888). */
export function formatarTelefone(phone: string, formato: SmsConfig['phoneFormat']): string {
  const d = phone.replace(/\D/g, '')
  if (formato === 'e164') return `+${d}`
  if (formato === 'nacional') return d.startsWith('55') ? d.slice(2) : d
  return d
}

/** Troca {{variavel}} pelos valores, escapando conforme onde o texto vai (JSON, formulário, URL). */
function preencher(modelo: string, vars: Record<string, string>, escapar: (v: string) => string): string {
  return modelo.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in vars ? escapar(vars[k]) : m))
}
const emJson = (v: string) => JSON.stringify(v).slice(1, -1)
/** Para login "Basic": "usuario:senha" em base64. */
const base64 = (v: string) => Buffer.from(v ?? '', 'utf8').toString('base64')

function lerCabecalhos(texto: string, vars: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const linha of (texto ?? '').split(/\r?\n/)) {
    const i = linha.indexOf(':')
    if (i <= 0) continue
    const nome = linha.slice(0, i).trim()
    if (nome) headers[nome] = preencher(linha.slice(i + 1).trim(), vars, (v) => v)
  }
  return headers
}

/** Campos de primeiro nível vazios ("") não vão para o provedor (ex.: remetente não preenchido). */
function tirarVazios(json: string): string {
  try {
    const o = JSON.parse(json)
    if (!o || typeof o !== 'object' || Array.isArray(o)) return json
    for (const k of Object.keys(o)) if (o[k] === '') delete o[k]
    return JSON.stringify(o)
  } catch {
    return json // o modelo não é um JSON válido: envia como está
  }
}

/** Monta a requisição HTTP de envio (separado do envio para poder ser testado). */
export function montarRequisicao(
  c: SmsConfig,
  phone: string,
  texto: string,
  bearer = ''
): { url: string; init: { method: string; headers: Record<string, string>; body?: string } } {
  const vars = {
    telefone: formatarTelefone(phone, c.phoneFormat),
    mensagem: c.stripAccents ? semAcentos(texto) : texto,
    token: c.token,
    token_base64: base64(c.token),
    remetente: c.sender,
    bearer
  }
  const url = preencher(c.url.trim(), vars, encodeURIComponent)
  const headers = lerCabecalhos(c.headers, vars)
  if (c.method === 'GET') return { url, init: { method: 'GET', headers } }
  const json = c.bodyType === 'json'
  if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type'))
    headers['Content-Type'] = json ? 'application/json' : 'application/x-www-form-urlencoded'
  const preenchido = preencher(c.body, vars, json ? emJson : encodeURIComponent)
  return { url, init: { method: c.method, headers, body: json ? tirarVazios(preenchido) : preenchido } }
}

/** Mensagem de erro legível a partir da resposta do provedor (ex.: SMSGo devolve {code, message}). */
async function motivo(res: Response): Promise<string> {
  const texto = (await res.text().catch(() => '')).trim()
  try {
    const j = JSON.parse(texto)
    const msg = [j?.code, j?.message ?? j?.error?.message ?? j?.error].filter((x) => typeof x === 'string' && x)
    if (msg.length) return msg.join(': ')
  } catch {
    /* não é JSON */
  }
  return texto.replace(/\s+/g, ' ').slice(0, 200)
}

const TEMPO_LIMITE = 20_000

/**
 * Disparo de SMS por API externa: uma chamada HTTP por mensagem.
 * Se o provedor pede autenticação em 2 passos (ex.: SMSGo), o token temporário é guardado e
 * renovado sozinho (antes de vencer ou quando o provedor responde 401).
 * Resposta 2xx = enviado; qualquer outra coisa vira falha com o motivo que o provedor devolveu.
 */
export class SmsSender {
  private bearer: { valor: string; chave: string; vence: number } | null = null

  constructor(private getCfg: () => SmsConfig) {}

  configured(): boolean {
    return smsConfigurado(this.getCfg())
  }

  /** Token temporário do provedor (passo 1 da autenticação em 2 passos). */
  private async obterBearer(c: SmsConfig, renovar = false): Promise<string> {
    if (!c.authUrl?.trim()) return ''
    const chave = `${c.authUrl}|${c.token}`
    if (!renovar && this.bearer?.chave === chave && Date.now() < this.bearer.vence) return this.bearer.valor
    const vars = { token: c.token, token_base64: base64(c.token), remetente: c.sender }
    let res: Response
    try {
      res = await fetch(preencher(c.authUrl.trim(), vars, encodeURIComponent), {
        method: 'GET',
        headers: lerCabecalhos(c.authHeaders, vars),
        signal: AbortSignal.timeout(TEMPO_LIMITE)
      })
    } catch (e) {
      throw new Error(`Não foi possível falar com o provedor de SMS (${(e as Error).message})`)
    }
    if (!res.ok) throw new Error(`A chave da API de SMS foi recusada (HTTP ${res.status}): ${await motivo(res)}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = await res.json().catch(() => null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const valor = (c.authField || 'token').split('.').reduce((o: any, k) => o?.[k], j)
    if (typeof valor !== 'string' || !valor)
      throw new Error(`O provedor de SMS não devolveu o campo "${c.authField || 'token'}" na autenticação`)
    this.bearer = { valor, chave, vence: Date.now() + Math.max(0.1, Number(c.authHours) || 24) * 3_600_000 }
    return valor
  }

  /** Envia um SMS. Devolve test=true quando o provedor está em modo de teste (sandbox). */
  async send(phone: string, texto: string): Promise<{ test: boolean }> {
    const c = this.getCfg()
    if (!smsConfigurado(c)) throw new Error('O SMS não está configurado (tela Conexão → SMS).')
    for (let tentativa = 0; ; tentativa++) {
      const bearer = await this.obterBearer(c, tentativa > 0)
      const { url, init } = montarRequisicao(c, phone, texto, bearer)
      let res: Response
      try {
        res = await fetch(url, { ...init, signal: AbortSignal.timeout(TEMPO_LIMITE) })
      } catch (e) {
        throw new Error(`Não foi possível falar com o provedor de SMS (${(e as Error).message})`)
      }
      // token temporário vencido/revogado: renova uma vez e tenta de novo
      if (res.status === 401 && c.authUrl?.trim() && tentativa === 0) continue
      if (!res.ok) {
        const m = await motivo(res)
        throw new Error(`O provedor de SMS recusou (HTTP ${res.status})${m ? `: ${m}` : ''}`)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const j: any = await res.json().catch(() => null)
      return { test: j?.test === true || c.token.startsWith('test_') }
    }
  }
}
