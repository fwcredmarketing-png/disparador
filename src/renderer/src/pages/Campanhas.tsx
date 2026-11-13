import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CampaignInput, CampaignResult, CampaignSummary, ResultStatus, WaStatus } from '@shared/types'
import { fmtDate, fmtPhone, useAction } from '../lib'

const STATUS: Record<CampaignSummary['status'], string> = {
  draft: 'Pronta',
  running: 'Enviando',
  paused: 'Pausada',
  done: 'Concluída',
  cancelled: 'Cancelada'
}
const RESULT: Record<ResultStatus, string> = {
  pending: 'Pendente',
  sent: 'Enviado',
  failed: 'Falhou',
  invalid: 'Sem WhatsApp',
  skipped: 'Ignorado'
}

const empty: CampaignInput = {
  name: '',
  message: '{Olá|Oi|Olá, tudo bem}, {primeiro_nome}! ',
  tag: '',
  delayMin: 20,
  delayMax: 45,
  batchSize: 30,
  batchPause: 10
}

/** Prévia simples da mensagem (escolhe a 1ª opção do spintax). */
function preview(msg: string): string {
  return msg
    .replace(/\{nome\}/gi, 'Maria Silva')
    .replace(/\{primeiro_nome\}/gi, 'Maria')
    .replace(/\{telefone\}/gi, '5511999998888')
    .replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, g: string) => g.split('|')[0])
}

function Countdown({ at }: { at?: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])
  if (!at) return null
  const s = Math.max(0, Math.round((at - Date.now()) / 1000))
  return <span className="muted">próximo envio em {s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`}</span>
}

export default function Campanhas({ wa }: { wa: WaStatus }) {
  const run = useAction()
  const [list, setList] = useState<CampaignSummary[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [form, setForm] = useState<CampaignInput>(empty)
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [log, setLog] = useState<CampaignResult[]>([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => window.api.campaigns.list().then(setList).catch(() => {}), [])
  useEffect(() => {
    load()
    window.api.contacts.tags().then(setTags).catch(() => {})
    const timer = setInterval(load, 10_000) // mostra o que outros computadores da equipe fizeram
    const off = window.api.campaigns.onProgress((c) =>
      setList((l) => (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [c, ...l]))
    )
    return () => {
      clearInterval(timer)
      off()
    }
  }, [load])

  // Log da campanha aberta: carrega ao abrir e sempre que o progresso muda
  const opened = list.find((c) => c.id === open)
  const progressKey = opened ? opened.total - opened.pending : 0
  useEffect(() => {
    if (!open) {
      setLog([])
      return
    }
    window.api.campaigns.log(open).then(setLog).catch(() => {})
  }, [open, progressKey])

  const set = <K extends keyof CampaignInput>(k: K, v: CampaignInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const pv = useMemo(() => preview(form.message), [form.message])
  const insert = (v: string) => set('message', form.message + v)

  const create = async (start: boolean) => {
    setSaving(true)
    const c = await run(() => window.api.campaigns.create(form), 'Campanha criada').finally(() => setSaving(false))
    if (!c) return
    setForm(empty)
    setCreating(false)
    await load()
    if (start) await run(() => window.api.campaigns.start(c.id))
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Campanhas</h1>
          <p>Crie disparos com intervalos inteligentes, lotes e limite diário.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(!creating)}>
          {creating ? 'Fechar' : '+ Nova campanha'}
        </button>
      </header>

      {creating && (
        <section className="card glass composer">
          <div className="grid-2 tight">
            <div>
              <label>
                Nome da campanha
                <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Promoção de novembro" />
              </label>
              <label>
                Mensagem
                <textarea rows={7} value={form.message} onChange={(e) => set('message', e.target.value)} />
              </label>
              <div className="chips">
                <button onClick={() => insert('{nome}')}>{'{nome}'}</button>
                <button onClick={() => insert('{primeiro_nome}')}>{'{primeiro_nome}'}</button>
                <button onClick={() => insert('{Olá|Oi|E aí}')}>{'{variação|spintax}'}</button>
                <button onClick={() => insert('*negrito*')}>*negrito*</button>
                <button onClick={() => insert('_itálico_')}>_itálico_</button>
              </div>
              <div className="form-row">
                <label>
                  Enviar para
                  <select value={form.tag} onChange={(e) => set('tag', e.target.value)}>
                    <option value="">Todos os contatos</option>
                    {tags.map((t) => (
                      <option key={t} value={t}>
                        Etiqueta: {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Mídia (opcional)
                  <div className="file-pick">
                    <button
                      className="btn"
                      onClick={async () => {
                        const p = await window.api.dialog.pickMedia()
                        if (p) set('mediaPath', p)
                      }}
                    >
                      Anexar
                    </button>
                    {form.mediaPath && (
                      <span className="tag" onClick={() => set('mediaPath', undefined)} title="Remover">
                        {form.mediaPath.split(/[\\/]/).pop()} ✕
                      </span>
                    )}
                  </div>
                </label>
              </div>
            </div>
            <div>
              <div className="phone-preview">
                <div className="bubble">
                  {form.mediaPath && <div className="media-ph">📎 {form.mediaPath.split(/[\\/]/).pop()}</div>}
                  {pv || <span className="muted">Sua mensagem aparece aqui…</span>}
                  <small>12:00 ✓✓</small>
                </div>
              </div>
              <div className="form-row">
                <label>
                  Intervalo mín. (s)
                  <input type="number" min={3} value={form.delayMin} onChange={(e) => set('delayMin', +e.target.value)} />
                </label>
                <label>
                  Intervalo máx. (s)
                  <input type="number" min={3} value={form.delayMax} onChange={(e) => set('delayMax', +e.target.value)} />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Mensagens por lote
                  <input type="number" min={0} value={form.batchSize} onChange={(e) => set('batchSize', +e.target.value)} />
                </label>
                <label>
                  Pausa entre lotes (min)
                  <input type="number" min={0} value={form.batchPause} onChange={(e) => set('batchPause', +e.target.value)} />
                </label>
              </div>
              {wa.provider === 'cloud' && (
                <div className="form-row">
                  <label>
                    Template aprovado (API oficial)
                    <input
                      value={form.template?.name ?? ''}
                      placeholder="nome_do_template"
                      onChange={(e) =>
                        set('template', e.target.value ? { name: e.target.value, language: form.template?.language ?? 'pt_BR' } : undefined)
                      }
                    />
                  </label>
                  <label>
                    Idioma
                    <input
                      value={form.template?.language ?? 'pt_BR'}
                      onChange={(e) => form.template && set('template', { ...form.template, language: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
          <div className="row end">
            <span className="muted">Envie apenas para contatos que autorizaram receber mensagens.</span>
            <button className="btn" onClick={() => create(false)} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            <button className="btn primary" onClick={() => create(true)} disabled={saving || wa.state !== 'connected'}>
              Salvar e iniciar ➤
            </button>
          </div>
        </section>
      )}

      <div className="campaigns">
        {!list.length && !creating && <div className="empty card glass">Nenhuma campanha criada ainda.</div>}
        {list.map((c) => {
          const done = c.total - c.pending
          const pct = c.total ? Math.round((done / c.total) * 100) : 0
          return (
            <section key={c.id} className={`card glass campaign ${c.status}`}>
              <div className="camp-head">
                <div>
                  <h3>{c.name}</h3>
                  <small className="muted">
                    Criada {fmtDate(c.createdAt)}
                    {c.createdBy ? ` por ${c.createdBy}` : ''} {c.tag ? `• etiqueta "${c.tag}"` : '• todos os contatos'}
                    {c.mediaName ? ` • 📎 ${c.mediaName}` : ''}
                  </small>
                </div>
                <span className={`badge ${c.stale ? 'paused' : c.status}`}>{c.stale ? 'Sem sinal' : STATUS[c.status]}</span>
              </div>
              <div className="progress">
                <i style={{ width: `${pct}%` }} />
              </div>
              <div className="camp-stats">
                <span>
                  <b>{done}</b>/{c.total} ({pct}%)
                </span>
                <span className="ok">✓ {c.sent} enviados</span>
                <span className="bad">✕ {c.failed} falhas</span>
                <span className="warn">⊘ {c.invalid} sem WhatsApp</span>
                <span className="muted">↷ {c.skipped} ignorados</span>
                {c.status === 'running' && !c.stale && <Countdown at={c.nextSendAt} />}
              </div>
              {c.status === 'running' && !c.runningHere && c.runningOn && (
                <div className={`tip ${c.stale ? 'warn' : ''}`}>
                  {c.stale
                    ? `O computador ${c.runningOn} parou de responder. Você pode assumir o envio daqui.`
                    : `Enviando em ${c.runningOn}.`}
                </div>
              )}
              {c.note && <div className="tip warn">{c.note}</div>}
              <div className="row">
                {(c.status === 'draft' || c.status === 'paused' || (c.status === 'running' && c.stale)) && (
                  <button className="btn primary" onClick={() => run(() => window.api.campaigns.start(c.id))}>
                    ▶ {c.stale ? 'Assumir envio' : c.status === 'paused' ? 'Continuar' : 'Iniciar'}
                  </button>
                )}
                {c.status === 'running' && !c.stale && (
                  <button className="btn" onClick={() => run(() => window.api.campaigns.pause(c.id))}>
                    ❚❚ Pausar
                  </button>
                )}
                {(c.status === 'running' || c.status === 'paused' || c.status === 'draft') && (
                  <button
                    className="btn danger ghost"
                    onClick={() => confirm('Cancelar esta campanha?') && run(() => window.api.campaigns.cancel(c.id))}
                  >
                    Cancelar
                  </button>
                )}
                <button className="btn ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>
                  {open === c.id ? 'Ocultar log' : 'Ver log'}
                </button>
                <button className="btn ghost" onClick={() => run(() => window.api.campaigns.exportReport(c.id))}>
                  Exportar CSV
                </button>
                {(c.status !== 'running' || c.stale) && (
                  <button
                    className="btn ghost danger"
                    onClick={() => confirm('Excluir esta campanha?') && run(() => window.api.campaigns.remove(c.id)).then(load)}
                  >
                    Excluir
                  </button>
                )}
              </div>
              {open === c.id && (
                <div className="log">
                  {!log.length && <div className="muted">Nenhum envio ainda.</div>}
                  {log.map((r, i) => (
                    <div key={r.phone + i} className={`log-row ${r.status}`}>
                      <span>{r.at ? new Date(r.at).toLocaleTimeString('pt-BR') : ''}</span>
                      <span>{r.name || '—'}</span>
                      <span className="mono">{fmtPhone(r.phone)}</span>
                      <span>{RESULT[r.status]}</span>
                      <span className="muted">{r.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
