import type { LocalSettings, Settings, SharedSettings } from '@shared/types'
import { sharedSettings } from './repo'
import { store } from './store'
import { auth } from './supabase'

/** Configurações da equipe em memória (atualizadas do banco ao logar e ao abrir a tela). */
let shared: SharedSettings = {
  dailyLimit: 300,
  optOutKeywords: ['SAIR', 'PARAR', 'STOP', 'CANCELAR', 'DESCADASTRAR'],
  appendOptOut: true,
  optOutText: 'Responda SAIR para não receber mais mensagens.',
  simulateTyping: true,
  contractLink: ''
}

/** Configurações deste computador + configurações da equipe. */
export const getSettings = (): Settings => ({ ...store.getLocal(), ...shared })

export async function refreshShared(): Promise<Settings> {
  shared = await sharedSettings.get()
  return getSettings()
}

const SHARED_KEYS: (keyof SharedSettings)[] = [
  'dailyLimit',
  'optOutKeywords',
  'appendOptOut',
  'optOutText',
  'simulateTyping',
  'contractLink'
]

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const local: Partial<LocalSettings> = {}
  if (patch.provider) local.provider = patch.provider
  if (patch.cloud) local.cloud = patch.cloud
  if (local.provider || local.cloud) store.saveLocal(local)

  if (SHARED_KEYS.some((k) => patch[k] !== undefined)) {
    auth.requireAdmin()
    const next: SharedSettings = { ...shared }
    for (const k of SHARED_KEYS) if (patch[k] !== undefined) Object.assign(next, { [k]: patch[k] })
    next.dailyLimit = Math.max(1, Math.floor(Number(next.dailyLimit) || 1))
    next.optOutKeywords = [...new Set(next.optOutKeywords.map((k) => k.trim().toUpperCase()).filter(Boolean))]
    next.contractLink = (next.contractLink ?? '').trim()
    if (next.contractLink && !/^https?:\/\/\S+$/i.test(next.contractLink))
      throw new Error('O link de autocontratação precisa começar com https:// e não pode ter espaços')
    await sharedSettings.save(next)
    shared = next
  }
  return getSettings()
}
