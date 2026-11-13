import { useEffect, useState } from 'react'
import type { UpdaterStatus, WaStatus } from '@shared/types'
import Scene3D from './three/Scene3D'
import { ToastProvider } from './lib'
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
  const [page, setPage] = useState<Page>('dashboard')
  const [wa, setWa] = useState<WaStatus>({ provider: 'baileys', state: 'disconnected' })
  const [signal, setSignal] = useState(0)
  const [version, setVersion] = useState('')
  const [upd, setUpd] = useState<UpdaterStatus>({ state: 'idle' })

  useEffect(() => {
    window.api.wa.status().then(setWa)
    window.api.appVersion().then(setVersion)
    window.api.updater.status().then(setUpd)
    const offs = [
      window.api.wa.onStatus(setWa),
      window.api.campaigns.onSent(() => setSignal((s) => s + 1)),
      window.api.updater.onStatus(setUpd)
    ]
    return () => offs.forEach((f) => f())
  }, [])

  return (
    <ToastProvider>
      <Scene3D connected={wa.state === 'connected'} signal={signal} />
      <div className="titlebar">
        <span className="brand-mini">Sistema de Disparo</span>
      </div>
      <div className="shell">
        <aside className="sidebar glass">
          <div className="logo">
            <div className="logo-orb" />
            <div>
              <strong>DISPARO</strong>
              <small>WhatsApp • v{version}</small>
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
            {upd.state === 'downloading' && (
              <div className="upd">Baixando atualização… {upd.percent ?? 0}%</div>
            )}
            <div className={`pill ${wa.state}`} onClick={() => setPage('conexao')}>
              <span className="dot" />
              {STATE_LABEL[wa.state]}
              {wa.me && <small>+{wa.me}</small>}
            </div>
          </div>
        </aside>
        <main className="content">
          {page === 'dashboard' && <Dashboard wa={wa} go={setPage} signal={signal} />}
          {page === 'conexao' && <Conexao wa={wa} />}
          {page === 'contatos' && <Contatos />}
          {page === 'campanhas' && <Campanhas wa={wa} />}
          {page === 'config' && <Configuracoes upd={upd} version={version} />}
        </main>
      </div>
    </ToastProvider>
  )
}
