import { useCallback, useEffect, useState } from 'react'
import type { AuthState, Member, Settings, UpdaterStatus } from '@shared/types'
import { fmtDate, useAction } from '../lib'

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

export default function Configuracoes({ upd, version, auth }: { upd: UpdaterStatus; version: string; auth: AuthState }) {
  const run = useAction()
  const admin = !!auth.admin
  const [s, setS] = useState<Settings | null>(null)
  const [kw, setKw] = useState('')

  useEffect(() => {
    run(() => window.api.settings.get()).then((x) => {
      if (!x) return
      setS(x)
      setKw(x.optOutKeywords.join(', '))
    })
  }, [run])

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
      'Configurações salvas para toda a equipe'
    )
    if (r) setS(r)
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Configurações</h1>
          <p>Limites de segurança, descadastro, equipe e atualizações.</p>
        </div>
        {admin && (
          <button className="btn primary" onClick={save}>
            Salvar
          </button>
        )}
      </header>

      {!admin && (
        <div className="tip">
          As regras de envio valem para toda a equipe e só podem ser alteradas por um administrador.
        </div>
      )}

      <div className="grid-2">
        <section className="card glass">
          <h3>Segurança de envio</h3>
          <fieldset disabled={!admin}>
            <label>
              Limite de mensagens por dia (por número de WhatsApp)
              <input type="number" min={1} value={s.dailyLimit} onChange={(e) => setS({ ...s, dailyLimit: +e.target.value })} />
            </label>
            <label className="check">
              <input type="checkbox" checked={s.simulateTyping} onChange={(e) => setS({ ...s, simulateTyping: e.target.checked })} />
              Simular "digitando…" antes de cada mensagem (QR Code)
            </label>
          </fieldset>
          <div className="tip">
            Números novos: comece com 30–50 mensagens/dia e aumente gradualmente ao longo de semanas.
          </div>
        </section>

        <section className="card glass">
          <h3>Descadastro (opt-out)</h3>
          <fieldset disabled={!admin}>
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
          </fieldset>
        </section>

        <Equipe auth={auth} />

        <section className="card glass">
          <h3>Conta e atualizações</h3>
          <p>
            Conectado como <b>{auth.email}</b> {admin ? '(administrador)' : '(operador)'}
          </p>
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
              Verificar atualização
            </button>
            {upd.state === 'ready' && (
              <button className="btn primary" onClick={() => window.api.updater.install()}>
                Reiniciar e atualizar
              </button>
            )}
            <button className="btn ghost danger" onClick={() => run(() => window.api.auth.logout())}>
              Sair da conta
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

/** Quem pode entrar no sistema. Só administradores incluem ou removem pessoas. */
function Equipe({ auth }: { auth: AuthState }) {
  const run = useAction()
  const admin = !!auth.admin
  const [list, setList] = useState<Member[]>([])
  const [form, setForm] = useState({ email: '', name: '', admin: false })

  const load = useCallback(() => run(() => window.api.team.list()).then((l) => l && setList(l)), [run])
  useEffect(() => {
    load()
  }, [load])

  const add = async () => {
    const ok = await run(async () => {
      await window.api.team.add(form)
      return true
    }, 'Acesso liberado')
    if (ok) {
      setForm({ email: '', name: '', admin: false })
      load()
    }
  }

  return (
    <section className="card glass">
      <h3>Equipe</h3>
      <div className="members">
        {list.map((m) => (
          <div key={m.email} className="member">
            <div>
              <b>{m.name || m.email}</b>
              <small className="muted">
                {m.email} • desde {fmtDate(m.createdAt).split(' ')[0]}
              </small>
            </div>
            <span className={`badge ${m.admin ? 'running' : ''}`}>{m.admin ? 'Admin' : 'Operador'}</span>
            {admin && m.email !== auth.email && (
              <button
                className="icon-btn"
                title="Remover da equipe"
                onClick={() => confirm(`Remover ${m.email} da equipe?`) && run(() => window.api.team.remove(m.email)).then(load)}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {admin && (
        <>
          <div className="form-row">
            <input placeholder="e-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={form.admin} onChange={(e) => setForm({ ...form, admin: e.target.checked })} />
              Administrador
            </label>
            <button className="btn" onClick={add} disabled={!form.email.trim()}>
              + Liberar acesso
            </button>
          </div>
          <div className="tip small">
            A pessoa também precisa de um usuário no Supabase: <b>Authentication → Users → Add user</b> (marque
            &quot;Auto Confirm User&quot;) com o mesmo e-mail e uma senha.
          </div>
        </>
      )}
    </section>
  )
}
