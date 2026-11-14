// SMS: modelos de provedor e contas de tamanho (usados pela interface e pelo envio)
import type { SmsConfig } from './types'

/** Modelos prontos. Confira sempre na documentação do seu provedor. */
export const SMS_PRESETS: Record<SmsConfig['preset'], Omit<SmsConfig, 'token' | 'sender' | 'stripAccents'> & { nome: string }> = {
  zenvia: {
    nome: 'Zenvia',
    preset: 'zenvia',
    url: 'https://api.zenvia.com/v2/channels/sms/messages',
    method: 'POST',
    headers: 'X-API-TOKEN: {{token}}',
    body: '{"from": "{{remetente}}", "to": "{{telefone}}", "contents": [{"type": "text", "text": "{{mensagem}}"}]}',
    bodyType: 'json',
    phoneFormat: 'ddi'
  },
  generico: {
    nome: 'Outro provedor (genérico)',
    preset: 'generico',
    url: '',
    method: 'POST',
    headers: 'Authorization: Bearer {{token}}',
    body: '{"to": "{{telefone}}", "message": "{{mensagem}}", "from": "{{remetente}}"}',
    bodyType: 'json',
    phoneFormat: 'ddi'
  }
}

export const SMS_PADRAO: SmsConfig = { ...SMS_PRESETS.zenvia, token: '', sender: '', stripAccents: true }

/** Configurado o suficiente para tentar enviar. */
export const smsConfigurado = (c?: SmsConfig): boolean => !!c?.url?.trim() && /^https?:\/\//i.test(c.url.trim())

export const semAcentos = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '')

// Alfabeto padrão do SMS (GSM 03.38): fora dele, cada SMS cabe só 70 caracteres
const GSM = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
)
const GSM_EXT = new Set('^{}\\[~]|€') // contam como 2

/** Quantos caracteres e quantos SMS a mensagem ocupa (mensagens longas são divididas em partes). */
export function contarSms(texto: string): { caracteres: number; partes: number; porParte: number; especial: boolean } {
  let unidades = 0
  let especial = false
  for (const ch of texto) {
    if (GSM.has(ch)) unidades += 1
    else if (GSM_EXT.has(ch)) unidades += 2
    else especial = true
  }
  if (especial) {
    const n = [...texto].length
    return { caracteres: n, partes: n <= 70 ? 1 : Math.ceil(n / 67), porParte: n <= 70 ? 70 : 67, especial }
  }
  return { caracteres: unidades, partes: unidades <= 160 ? 1 : Math.ceil(unidades / 153), porParte: unidades <= 160 ? 160 : 153, especial }
}
