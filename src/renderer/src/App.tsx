import { useEffect, useState } from 'react'
import type { AuthState, UpdaterStatus, WaStatus } from '@shared/types'
import Scene3D from './three/Scene3D'
import logo from './assets/logo.png'
import { ToastProvider, useAction } from './lib'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Conexao from './pages/Conexao'
import Contatos from './pages/Contatos'
import Campanhas from './pages/Campanhas'
import Configuracoes from './pages/Configuracoes'

export type Page = 'dashboard' | 'conexao' | 'contatos' | 'campanhas' | 'config'

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Painel', icon: '◈' },
  { id: 'conexao', label: 'Conexão', icon: '⌁' },
  { id: 'contatos', label: 'Contatos', icon: '☰' },
  { id: 'campanhas', label: 'Campanhas', icon: '➤' },
  { id: 'config', label: 'Configurações', icon: '⚙' }
]

const STATE_LABEL: Record<WaStatus['state'], string> = {
  connected: 'Conectado',
  connecting: 'Conectando…',
  qr: 'Aguardando QR Code',
  disconnected: 'Desconectado'
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ state: 'checking' })
  const [wa, setWa] = useState<WaStatus>({ provider: 'baileys', state: 'disconnected' })
  const [signal, setSignal] = useState(0)
  const [version, setVersion] = useState('')
  const [upd, setUpd] = useState<UpdaterStatus>({ state: 'idle' })
  const signedIn = auth.state === 'signedIn'

  useEffect(() => {
    window.api.appVersion().then(setVersion)
    window.api.updater.status().then(setUpd)
    window.api.auth.state().then(setAuth)
    const offs = [
      window.api.auth.onChange(setAuth),
      window.api.wa.onStatus(setWa),
      window.api.campaigns.onSent(() => setSignal((s) => s + 1)),
      window.api.updater.onStatus(setUpd)
    ]
    return () => offs.forEach((f) => f())
  }, [])

  useEffect(() => {
    if (signedIn) window.api.wa.status().then(setWa).catch(() => {})
  }, [signedIn])

  return (
    <ToastProvider>
      <Scene3D connected={signedIn && wa.state === 'connected'} signal={signal} />
      <div className="titlebar">
        <span className="brand-mini">FW Cred • Sistema de Disparo</span>
      </div>
      {signedIn ? (
        <Shell auth={auth} wa={wa} signal={signal} version={version} upd={upd} />
      ) : (
        <Login auth={auth} version={version} upd={upd} />
      )}
    </ToastProvider>
  )
}

function Shell(props: { auth: AuthState; wa: WaStatus; signal: number; version: string; upd: UpdaterStatus }) {
  const { auth, wa, signal, version, upd } = props
  const [page, setPage] = useState<Page>('dashboard')
  const run = useAction()

  return (
    <div className="shell">
      <aside className="sidebar glass">
        <div className="logo">
          <img src={logo} className="logo-badge" alt="FW Cred" />
          <div>
            <strong>DISPARO</strong>
            <small>FW Cred • v{version}</small>
          </div>
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.id} className={page === n.id ? 'active' : ''} onClick={() => setPage(n.id)}>
              <span className="ico">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          {upd.state === 'ready' && (
            <button className="btn primary block" onClick={() => window.api.updater.install()}>
              ⟳ Atualizar para v{upd.version}
            </button>
          )}
          {upd.state === 'downloading' && <div className="upd">Baixando atualização… {upd.percent ?? 0}%</div>}
          <div className={`pill ${wa.state}`} onClick={() => setPage('conexao')}>
            <span className="dot" />
            {STATE_LABEL[wa.state]}
            {wa.me && <small>+{wa.me}</small>}
          </div>
          <div className="user-chip">
            <div>
              <b>{auth.name || auth.email}</b>
              <small>{auth.admin ? 'Administrador' : 'Operador'}</small>
            </div>
            <button className="icon-btn" title="Sair" onClick={() => run(() => window.api.auth.logout())}>
              ⎋
            </button>
          </div>
        </div>
      </aside>
      <main className="content">
        {page === 'dashboard' && <Dashboard wa={wa} go={setPage} signal={signal} />}
        {page === 'conexao' && <Conexao wa={wa} />}
        {page === 'contatos' && <Contatos admin={!!auth.admin} />}
        {page === 'campanhas' && <Campanhas wa={wa} />}
        {page === 'config' && <Configuracoes upd={upd} version={version} auth={auth} />}
      </main>
    </div>
  )
}
