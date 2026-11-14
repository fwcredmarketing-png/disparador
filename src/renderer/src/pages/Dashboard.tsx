import { useEffect, useState } from 'react'
import type { Stats, WaStatus } from '@shared/types'
import Bars3D from '../three/Bars3D'
import type { Fx } from '../three/Scene3D'
import type { Page } from '../App'

const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export default function Dashboard({ wa, go, signal, fx }: { wa: WaStatus; go: (p: Page) => void; signal: number; fx: Fx }) {
  const [s, setS] = useState<Stats | null>(null)

  useEffect(() => {
    window.api.stats.get().then(setS).catch(() => {})
  }, [signal])

  useEffect(() => {
    const t = setInterval(() => window.api.stats.get().then(setS).catch(() => {}), 10_000)
    return () => clearInterval(t)
  }, [])

  const pct = s ? Math.min(100, Math.round((s.sentToday / s.dailyLimit) * 100)) : 0

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Painel de controle</h1>
          <p>Visão geral dos disparos e da conexão.</p>
        </div>
        <button className="btn primary" onClick={() => go('campanhas')}>
          + Nova campanha
        </button>
      </header>

      <div className="kpis">
        <div className="kpi glass">
          <span>{wa.state === 'connected' ? 'Enviadas hoje (este número)' : 'Enviadas hoje (equipe)'}</span>
          <strong>{s?.sentToday ?? '—'}</strong>
          <div className="meter">
            <i style={{ width: `${pct}%` }} />
          </div>
          <small>
            {pct}% do limite diário ({s?.dailyLimit ?? 0})
          </small>
        </div>
        <div className="kpi glass">
          <span>Contatos</span>
          <strong>{s?.totalContacts ?? '—'}</strong>
          <small>{s?.optOuts ?? 0} descadastrados</small>
        </div>
        <div className="kpi glass">
          <span>Total enviado</span>
          <strong>{s?.totalSent ?? '—'}</strong>
          <small>toda a equipe</small>
        </div>
        <div className="kpi glass">
          <span>WhatsApp</span>
          <strong className={wa.state === 'connected' ? 'ok' : 'bad'}>
            {wa.state === 'connected' ? 'Online' : 'Offline'}
          </strong>
          <small>{wa.provider === 'cloud' ? 'API oficial' : 'QR Code'}</small>
        </div>
      </div>

      <div className="grid-2">
        <section className="card glass">
          <h3>Envios — últimos 7 dias</h3>
          <div className="bars3d">{s && <Bars3D values={s.history.map((h) => h.count)} fx={fx} />}</div>
          <div className="bars-legend">
            {s?.history.map((h) => (
              <div key={h.date}>
                <b>{h.count}</b>
                <small>{DOW[new Date(h.date + 'T12:00:00').getDay()]}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="card glass">
          <h3>Status</h3>
          {s?.runningCampaign ? (
            <div className="live">
              <span className="dot pulse" /> Campanha em andamento: <b>{s.runningCampaign}</b>
            </div>
          ) : (
            <p className="muted">Nenhuma campanha rodando agora.</p>
          )}
          <ul className="checklist">
            <li className={wa.state === 'connected' ? 'done' : ''} onClick={() => go('conexao')}>
              Conectar o WhatsApp
            </li>
            <li className={(s?.totalContacts ?? 0) > 0 ? 'done' : ''} onClick={() => go('contatos')}>
              Importar contatos
            </li>
            <li className={(s?.totalSent ?? 0) > 0 ? 'done' : ''} onClick={() => go('campanhas')}>
              Criar e iniciar uma campanha
            </li>
          </ul>
          <div className="tip">
            💡 Boas práticas: envie só para quem autorizou, use intervalos longos e variações de texto (
            <code>{'{Olá|Oi}'}</code>) para reduzir o risco de bloqueio do número.
          </div>
        </section>
      </div>
    </div>
  )
}
