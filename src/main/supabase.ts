import { EventEmitter } from 'events'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AuthState } from '@shared/types'
import { SUPABASE_KEY, SUPABASE_URL } from './config'
import { store } from './store'

let client: SupabaseClient | null = null

/** Cliente do Supabase (a sessão de login fica salva criptografada neste computador). */
export function db(): SupabaseClient {
  if (!SUPABASE_KEY) throw new Error('Chave pública do Supabase não configurada (src/main/config.ts)')
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storage: store.authStorage,
        storageKey: 'sessao',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    })
  }
  return client
}

type ErrLike = { message?: string; code?: string } | null | undefined

/** Converte erros do banco em mensagens em português. */
export function dbError(e: ErrLike, fallback = 'Erro ao acessar o banco de dados'): Error {
  if (!e) return new Error(fallback)
  const msg = e.message ?? ''
  if (e.code === '42501' || /row-level security|permission denied/i.test(msg))
    return new Error('Sem permissão para essa ação')
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(msg))
    return new Error('Sem conexão com o banco de dados. Verifique a internet.')
  return new Error(msg || fallback)
}

function authMessage(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos'
  if (/email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado no Supabase'
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Aguarde alguns minutos.'
  return dbError({ message: msg }).message
}

interface Access {
  email: string
  membro: boolean
  admin: boolean
  nome: string
}

/** Login da equipe. Só entra quem tem o e-mail cadastrado na tabela "membros". */
class Auth extends EventEmitter {
  private s: AuthState = { state: 'checking' }

  get current(): AuthState {
    return this.s
  }

  private set(s: AuthState): AuthState {
    this.s = s
    this.emit('change', s)
    return s
  }

  async init(): Promise<AuthState> {
    if (!SUPABASE_KEY) return this.set({ state: 'notConfigured' })
    db().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && this.s.state === 'signedIn')
        this.set({ state: 'signedOut', error: 'Sua sessão terminou. Entre novamente.' })
    })
    return this.restore()
  }

  /** Recupera a sessão salva (ou tenta de novo após falta de internet). */
  async restore(): Promise<AuthState> {
    if (!SUPABASE_KEY) return this.set({ state: 'notConfigured' })
    this.set({ state: 'checking' })
    try {
      const { data, error } = await db().auth.getSession()
      if (error) throw error
      if (!data.session) return this.set({ state: 'signedOut' })
      const a = await this.access()
      if (!a.membro) {
        await db().auth.signOut({ scope: 'local' })
        return this.set({ state: 'signedOut', error: 'Seu acesso foi removido pelo administrador.' })
      }
      return this.set({ state: 'signedIn', email: a.email, name: a.nome, admin: a.admin })
    } catch (e) {
      return this.set({ state: 'error', error: dbError(e as ErrLike).message })
    }
  }

  async login(email: string, password: string): Promise<AuthState> {
    const { error } = await db().auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (error) throw new Error(authMessage(error.message))
    const a = await this.access()
    if (!a.membro) {
      await db().auth.signOut({ scope: 'local' })
      throw new Error(`O e-mail ${a.email} ainda não foi liberado. Peça a um administrador para incluí-lo na equipe.`)
    }
    return this.set({ state: 'signedIn', email: a.email, name: a.nome, admin: a.admin })
  }

  async logout(): Promise<void> {
    try {
      await db().auth.signOut({ scope: 'local' })
    } finally {
      this.set({ state: 'signedOut' })
    }
  }

  private async access(): Promise<Access> {
    const { data, error } = await db().rpc('meu_acesso')
    if (error) throw dbError(error)
    return data as Access
  }

  require(): void {
    if (this.s.state !== 'signedIn') throw new Error('Faça login para continuar')
  }

  requireAdmin(): void {
    this.require()
    if (!this.s.admin) throw new Error('Somente administradores podem fazer isso')
  }

  /** Como este operador/computador aparece para a equipe. */
  label(): string {
    return `${this.s.name || this.s.email || 'operador'} (${store.machineName})`
  }
}

export const auth = new Auth()
