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

/** Monta a requisição HTTP para o provedor (separado do envio para poder ser testado). */
export function montarRequisicao(
  c: SmsConfig,
  phone: string,
  texto: string
): { url: string; init: { method: string; headers: Record<string, string>; body?: string } } {
  const vars = {
    telefone: formatarTelefone(phone, c.phoneFormat),
    mensagem: c.stripAccents ? semAcentos(texto) : texto,
    token: c.token,
    remetente: c.sender
  }
  const url = preencher(c.url.trim(), vars, encodeURIComponent)
  const headers: Record<string, string> = {}
  for (const linha of c.headers.split(/\r?\n/)) {
    const i = linha.indexOf(':')
    if (i <= 0) continue
    const nome = linha.slice(0, i).trim()
    const valor = preencher(linha.slice(i + 1).trim(), vars, (v) => v)
    if (nome) headers[nome] = valor
  }
  if (c.method === 'GET') return { url, init: { method: 'GET', headers } }
  const json = c.bodyType === 'json'
  const temTipo = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')
  if (!temTipo) headers['Content-Type'] = json ? 'application/json' : 'application/x-www-form-urlencoded'
  const body = preencher(c.body, vars, json ? emJson : encodeURIComponent)
  return { url, init: { method: c.method, headers, body } }
}

/**
 * Disparo de SMS por API externa: uma chamada HTTP por mensagem.
 * Resposta 2xx = enviado; qualquer outra coisa vira falha com o motivo que o provedor devolveu.
 */
export class SmsSender {
  constructor(private getCfg: () => SmsConfig) {}

  configured(): boolean {
    return smsConfigurado(this.getCfg())
  }

  async send(phone: string, texto: string): Promise<void> {
    const c = this.getCfg()
    if (!smsConfigurado(c)) throw new Error('O SMS não está configurado (tela Conexão → SMS).')
    const { url, init } = montarRequisicao(c, phone, texto)
    let res: Response
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
    } catch (e) {
      throw new Error(`Não foi possível falar com o provedor de SMS (${(e as Error).message})`)
    }
    if (!res.ok) {
      const corpo = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200)
      throw new Error(`O provedor de SMS recusou (HTTP ${res.status})${corpo ? `: ${corpo}` : ''}`)
    }
  }
}
