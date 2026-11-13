import { useEffect, useState } from 'react'
import type { Settings, UpdaterStatus } from '@shared/types'
import { useAction } from '../lib'

const UPD: Record<UpdaterStatus['state'], string> = {
  dev: 'Modo desenvolvimento (atualização automática só funciona no app instalado)',
  idle: 'Aguardando verificação',
  checking: 'Verificando atualizações…',
  available: 'Nova versão encontrada, baixando…',
  none: 'Você está na versão mais recente',
  downloading: 'Baixando atualização…',
  ready: 'Atualização pronta para instalar',
  error: 'Erro ao verificar atualização'
}

export default function Configuracoes({ upd, version }: { upd: UpdaterStatus; version: string }) {
  const run = useAction()
  const [s, setS] = useState<Settings | null>(null)
  const [kw, setKw] = useState('')

  useEffect(() => {
    window.api.settings.get().then((x) => {
      setS(x)
      setKw(x.optOutKeywords.join(', '))
    })
  }, [])

  if (!s) return null

  const save = async () => {
    const r = await run(
      () =>
        window.api.settings.save({
          dailyLimit: s.dailyLimit,
          appendOptOut: s.appendOptOut,
          optOutText: s.optOutText,
          simulateTyping: s.simulateTyping,
          optOutKeywords: kw.split(',').map((k) => k.trim()).filter(Boolean)
        }),
      'Configurações salvas'
    )
    if (r) setS(r)
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Configurações</h1>
          <p>Limites de segurança, descadastro e atualizações.</p>
        </div>
        <button className="btn primary" onClick={save}>
          Salvar
        </button>
      </header>

      <div className="grid-2">
        <section className="card glass">
          <h3>Segurança de envio</h3>
          <label>
            Limite de mensagens por dia
            <input type="number" min={1} value={s.dailyLimit} onChange={(e) => setS({ ...s, dailyLimit: +e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={s.simulateTyping} onChange={(e) => setS({ ...s, simulateTyping: e.target.checked })} />
            Simular "digitando…" antes de cada mensagem (QR Code)
          </label>
          <div className="tip">
            Números novos: comece com 30–50 mensagens/dia e aumente gradualmente ao longo de semanas.
          </div>
        </section>

        <section className="card glass">
          <h3>Descadastro (opt-out)</h3>
          <label className="check">
            <input type="checkbox" checked={s.appendOptOut} onChange={(e) => setS({ ...s, appendOptOut: e.target.checked })} />
            Adicionar aviso de descadastro no fim das mensagens
          </label>
          <label>
            Texto do aviso
            <input value={s.optOutText} onChange={(e) => setS({ ...s, optOutText: e.target.value })} />
          </label>
          <label>
            Palavras que descadastram automaticamente (separadas por vírgula)
            <input value={kw} onChange={(e) => setKw(e.target.value)} />
          </label>
        </section>

        <section className="card glass">
          <h3>Atualizações</h3>
          <p>
            Versão instalada: <b>v{version}</b>
          </p>
          <p className={upd.state === 'error' ? 'error' : 'muted'}>
            {UPD[upd.state]}
            {upd.version && ` — v${upd.version}`}
            {upd.state === 'downloading' && ` ${upd.percent ?? 0}%`}
          </p>
          {upd.error && <p className="error small">{upd.error}</p>}
          <div className="row">
            <button className="btn" onClick={() => run(() => window.api.updater.check())}>
              Verificar agora
            </button>
            {upd.state === 'ready' && (
              <button className="btn primary" onClick={() => window.api.updater.install()}>
                Reiniciar e atualizar
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
