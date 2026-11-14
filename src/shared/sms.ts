// SMS: modelos de provedor e contas de tamanho (usados pela interface e pelo envio)
import type { SmsConfig } from './types'

type Modelo = Omit<SmsConfig, 'token' | 'sender' | 'stripAccents'> & { nome: string }

const SEM_AUTH = { authUrl: '', authHeaders: '', authField: 'token', authHours: 24 }

/** Modelos prontos. Confira sempre na documentação do seu provedor. */
export const SMS_PRESETS: Record<SmsConfig['preset'], Modelo> = {
  // SMSGo (https://api.smsgo.com.br): a SMSGo-key vira um token Bearer de 48 h em /v1/auth/token.
  // Chave com prefixo test_ = sandbox (não gasta crédito nem envia SMS de verdade).
  smsgo: {
    nome: 'SMSGo',
    preset: 'smsgo',
    url: 'https://api.smsgo.com.br/v1/sms/send/single',
    method: 'POST',
    headers: 'Authorization: Bearer {{bearer}}\nAccept: application/json',
    body: '{"phone": "{{telefone}}", "message": "{{mensagem}}", "from": "{{remetente}}", "sms_type_id": 4}',
    bodyType: 'json',
    phoneFormat: 'e164',
    authUrl: 'https://api.smsgo.com.br/v1/auth/token',
    authHeaders: 'SMSGo-key: {{token}}\nAccept: application/json',
    authField: 'token',
    authHours: 47 // o token vale 48 h; renova um pouco antes
  },
  // Celular Android com o app "SMS Gateway for Android" (sms-gate.app): o SMS sai pelo chip do celular,
  // usando o plano da operadora. Login Basic com o usuário e a senha que o app mostra.
  android_local: {
    nome: 'Meu celular Android — mesmo Wi-Fi (usa o plano)',
    preset: 'android_local',
    url: '',
    method: 'POST',
    headers: 'Authorization: Basic {{token_base64}}',
    body: '{"textMessage": {"text": "{{mensagem}}"}, "phoneNumbers": ["{{telefone}}"]}',
    bodyType: 'json',
    phoneFormat: 'e164',
    ...SEM_AUTH
  },
  android_nuvem: {
    nome: 'Meu celular Android — pela internet (sms-gate.app)',
    preset: 'android_nuvem',
    url: 'https://api.sms-gate.app/3rdparty/v1/messages',
    method: 'POST',
    headers: 'Authorization: Basic {{token_base64}}',
    body: '{"textMessage": {"text": "{{mensagem}}"}, "phoneNumbers": ["{{telefone}}"]}',
    bodyType: 'json',
    phoneFormat: 'e164',
    ...SEM_AUTH
  },
  zenvia: {
    nome: 'Zenvia',
    preset: 'zenvia',
    url: 'https://api.zenvia.com/v2/channels/sms/messages',
    method: 'POST',
    headers: 'X-API-TOKEN: {{token}}',
    body: '{"from": "{{remetente}}", "to": "{{telefone}}", "contents": [{"type": "text", "text": "{{mensagem}}"}]}',
    bodyType: 'json',
    phoneFormat: 'ddi',
    ...SEM_AUTH
  },
  generico: {
    nome: 'Outro provedor (genérico)',
    preset: 'generico',
    url: '',
    method: 'POST',
    headers: 'Authorization: Bearer {{token}}',
    body: '{"to": "{{telefone}}", "message": "{{mensagem}}", "from": "{{remetente}}"}',
    bodyType: 'json',
    phoneFormat: 'ddi',
    ...SEM_AUTH
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { nome: _nome, ...SMSGO } = SMS_PRESETS.smsgo
export const SMS_PADRAO: SmsConfig = { ...SMSGO, token: '', sender: '', stripAccents: true }

/** Tipos de SMS da SMSGo (sms_type_id): o preço e a prioridade mudam conforme o tipo. */
export const SMSGO_TIPOS = [
  { id: 4, nome: 'Marketing — entrega em até 15 min (padrão)' },
  { id: 2, nome: 'Token — entrega em até 2 min (avisos urgentes)' }
]
const RE_TIPO = /("sms_type_id"\s*:\s*)(\d+)/
export const lerTipoSmsGo = (body: string): number | undefined => {
  const m = body.match(RE_TIPO)
  return m ? Number(m[2]) : undefined
}
export const trocarTipoSmsGo = (body: string, id: number): string =>
  RE_TIPO.test(body) ? body.replace(RE_TIPO, `$1${id}`) : body

const usaToken = (c: SmsConfig) =>
  [c.url, c.headers, c.body, c.authUrl, c.authHeaders].some((t) => /\{\{\s*token(_base64)?\s*\}\}/.test(t ?? ''))

/** Celular Android: o envio sai pelo chip (o Android limita ~30 SMS a cada 30 min por app). */
export const ehCelular = (c?: SmsConfig): boolean => c?.preset === 'android_local' || c?.preset === 'android_nuvem'
/** Intervalo mínimo recomendado entre SMS pelo celular, em segundos (abaixo do limite do Android). */
export const INTERVALO_CELULAR = 60

/** Modo mesmo Wi-Fi: "192.168.0.15" vira "http://192.168.0.15:8080/message". */
export const urlCelular = (ip: string): string => {
  const limpo = ip.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
  if (!limpo) return ''
  return `http://${limpo.includes(':') ? limpo : `${limpo}:8080`}/message`
}
export const ipDaUrl = (url: string): string =>
  url.replace(/^https?:\/\//i, '').replace(/\/message$/, '').replace(/:8080$/, '')

/** Usuário e senha do app do celular ficam juntos na chave, como "usuario:senha" (login Basic). */
export const separarLogin = (token: string): { usuario: string; senha: string } => {
  const i = token.indexOf(':')
  return i < 0 ? { usuario: token, senha: '' } : { usuario: token.slice(0, i), senha: token.slice(i + 1) }
}

/** Configurado o suficiente para tentar enviar (endereço válido e, se os modelos usam a chave, a chave preenchida). */
export const smsConfigurado = (c?: SmsConfig): boolean =>
  !!c?.url?.trim() &&
  /^https?:\/\//i.test(c.url.trim()) &&
  (!c.authUrl?.trim() || /^https?:\/\//i.test(c.authUrl.trim())) &&
  (!usaToken(c) || !!c.token?.trim())

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
