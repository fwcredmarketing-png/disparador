import { useState } from 'react'
import type { AuthState, UpdaterStatus } from '@shared/types'
import logo from '../assets/logo.png'
import { errMsg } from '../lib'

export default function Login({ auth, version, upd }: { auth: AuthState; version: string; upd: UpdaterStatus }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!email.trim() || !password) return setError('Preencha o e-mail e a senha')
    setBusy(true)
    setError('')
    try {
      await window.api.auth.login(email, password)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const retry = async () => {
    setBusy(true)
    await window.api.auth.retry().finally(() => setBusy(false))
  }

  return (
    <div className="login-wrap">
      <section className="login card glass">
        <img src={logo} className="logo-badge big" alt="FW Cred" />
        <h1>Sistema de Disparo</h1>
        <p className="muted">FW Cred • v{version}</p>

        {auth.state === 'checking' && <p className="muted">Verificando acesso…</p>}

        {auth.state === 'notConfigured' && (
          <div className="tip warn">
            Falta configurar a chave pública do Supabase neste app (<code>src/main/config.ts</code>).
          </div>
        )}

        {auth.state === 'error' && (
          <>
            <div className="tip warn">{auth.error}</div>
            <button className="btn primary block" onClick={retry} disabled={busy}>
              Tentar de novo
            </button>
          </>
        )}

        {auth.state === 'signedOut' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <label>
              E-mail
              <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              Senha
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {(error || auth.error) && <div className="tip warn">{error || auth.error}</div>}
            <button className="btn primary block" type="submit" disabled={busy}>
              {busy ? 'Entrando…' : 'Entrar'}
            </button>
            <p className="muted small">O acesso é liberado pelo administrador da equipe.</p>
          </form>
        )}

        {upd.state === 'ready' && (
          <button className="btn block" onClick={() => window.api.updater.install()}>
            ⟳ Atualizar para v{upd.version}
          </button>
        )}
      </section>
    </div>
  )
}
