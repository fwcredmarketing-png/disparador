import { useCallback, useEffect, useMemo, useState, type ClipboardEvent } from 'react'
import type {
  CampaignInput,
  CampaignResult,
  CampaignSummary,
  MediaInfo,
  ResultStatus,
  Settings,
  WaOverview
} from '@shared/types'
import { contarSms, semAcentos, smsConfigurado } from '@shared/sms'
import { fmtDate, fmtPhone, useAction, useToast } from '../lib'

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
  batchPause: 10,
  format: 'imagem',
  cardTitle: 'Simule seu crédito agora',
  cardDescription: 'Toque aqui e faça sua simulação • FW Cred',
  buttonText: 'Simular agora'
}

/** Domínio do link, como o WhatsApp mostra no cartão (ex.: fwcred.com.br). */
const dominio = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'seu-link.com.br'
  }
}

/** Texto do balão com o link destacado em azul, como no WhatsApp. */
function ComLink({ texto, link }: { texto: string; link: string }) {
  if (!link || !texto.includes(link)) return <>{texto}</>
  const partes = texto.split(link)
  return (
    <>
      {partes.map((p, i) => (
        <span key={i}>
          {p}
          {i < partes.length - 1 && <span className="wa-link">{link}</span>}
        </span>
      ))}
    </>
  )
}

const ICONE: Record<MediaInfo['kind'], string> = { image: '🖼️', video: '🎬', audio: '🎵', document: '📄' }
const TIPO: Record<MediaInfo['kind'], string> = { image: 'Imagem', video: 'Vídeo', audio: 'Áudio', document: 'Documento' }
const tamanho = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

/** Prévia simples da mensagem (escolhe a 1ª opção do spintax). */
function preview(msg: string, link: string): string {
  return msg
    .replace(/\{link\}/gi, link || '[link de autocontratação]')
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

export default function Campanhas({ wa }: { wa: WaOverview }) {
  const run = useAction()
  const toast = useToast()
  const [list, setList] = useState<CampaignSummary[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [form, setForm] = useState<CampaignInput>(empty)
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [log, setLog] = useState<CampaignResult[]>([])
  const [saving, setSaving] = useState(false)
  const [media, setMedia] = useState<MediaInfo | null>(null)
  const [arrastando, setArrastando] = useState(false)
  const [link, setLink] = useState('')
  const [s, setS] = useState<Settings | null>(null)

  const load = useCallback(() => window.api.campaigns.list().then(setList).catch(() => {}), [])
  useEffect(() => {
    load()
    window.api.contacts.tags().then(setTags).catch(() => {})
    window.api.settings
      .get()
      .then((x) => {
        setS(x)
        setLink(x.contractLink)
      })
      .catch(() => {})
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
  const pv = useMemo(() => preview(form.message, link), [form.message, link])
  const usaLink = /\{link\}/i.test(form.message)
  const sms = form.channel === 'sms'
  const cartao = !sms && form.format === 'cartao'
  const botao = !sms && form.format === 'botao'
  const smsOk = smsConfigurado(s?.sms)
  const podeEnviar = sms ? smsOk : wa.online > 0
  // SMS: texto final (com aviso de descadastro e sem acentos, se configurado) e quantas partes ocupa
  const pvSms = useMemo(() => {
    if (!sms) return ''
    let t = pv
    if (s?.appendOptOut && s.optOutText && t) t += `\n${s.optOutText}`
    return s?.sms.stripAccents ? semAcentos(t) : t
  }, [sms, pv, s])
  const contagem = useMemo(() => contarSms(pvSms), [pvSms])
  const [telTeste, setTelTeste] = useState(() => {
    try {
      return localStorage.getItem('telefone-teste') ?? ''
    } catch {
      return ''
    }
  })
  const [testando, setTestando] = useState(false)
  const enviarTeste = async () => {
    try {
      localStorage.setItem('telefone-teste', telTeste)
    } catch {
      /* só não lembra o número */
    }
    setTestando(true)
    const por = await run(() => window.api.campaigns.test(form, telTeste)).finally(() => setTestando(false))
    if (por) toast(por === 'sms' ? 'SMS de teste enviado. Confira no celular.' : `Teste enviado por ${fmtPhone(por)}. Confira no celular de teste.`, 'ok')
  }
  // no cartão, o link vai no fim do texto se a mensagem não tiver {link}
  const textoCartao = useMemo(() => {
    const l = link || '[link de autocontratação]'
    return pv.includes(l) ? pv : `${pv}\n\n${l}`.trim()
  }, [pv, link])

  // ---------- Anexo (imagem, vídeo, áudio ou documento) ----------
  const anexar = async (fn: () => Promise<MediaInfo | null>) => {
    const m = await run(fn)
    if (!m) return
    setMedia(m)
    set('mediaPath', m.path)
  }
  const escolher = () => anexar(() => window.api.dialog.pickMedia())
  const tirarAnexo = () => {
    setMedia(null)
    set('mediaPath', undefined)
  }
  /** Ctrl+V com imagem ou arquivo copiado (texto continua colando normal na mensagem). */
  const colar = (e: ClipboardEvent<HTMLElement>) => {
    const f = e.clipboardData.files[0]
    if (!f || sms) return // SMS não leva anexo
    e.preventDefault()
    const caminho = window.api.media.pathForFile(f) // arquivo copiado no Explorador
    if (caminho) anexar(() => window.api.media.info(caminho))
    else anexar(async () => window.api.media.pasteImage(new Uint8Array(await f.arrayBuffer()), f.type)) // print/imagem
  }
  const insert = (v: string) => set('message', form.message + v)

  const create = async (start: boolean) => {
    setSaving(true)
    const c = await run(() => window.api.campaigns.create(form), 'Campanha criada').finally(() => setSaving(false))
    if (!c) return
    setForm(empty)
    setMedia(null)
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
        <section className="card glass composer" onPaste={colar}>
          <div className="grid-2 tight">
            <div>
              <div className="formato canal">
                <span>Canal</span>
                <div className="tabs">
                  <button className={!sms ? 'active' : ''} onClick={() => set('channel', 'whatsapp')}>
                    💬 WhatsApp
                  </button>
                  <button
                    className={sms ? 'active' : ''}
                    onClick={() => {
                      set('channel', 'sms')
                      tirarAnexo() // SMS não leva anexo
                    }}
                  >
                    ✉️ SMS
                  </button>
                </div>
              </div>
              {sms && !smsOk && (
                <div className="tip warn small">
                  O SMS ainda não está configurado neste computador. Configure na tela <b>Conexão → Disparo de SMS</b>.
                </div>
              )}
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
                <button
                  className="chip-link"
                  title={link ? `Insere o link de autocontratação: ${link}` : 'Cadastre o link em Configurações'}
                  onClick={() => insert('{link}')}
                >
                  🔗 link de autocontratação
                </button>
                <button onClick={() => insert('{Olá|Oi|E aí}')}>{'{variação|spintax}'}</button>
                {!sms && (
                  <>
                    <button onClick={() => insert('*negrito*')}>*negrito*</button>
                    <button onClick={() => insert('_itálico_')}>_itálico_</button>
                  </>
                )}
              </div>
              {(usaLink || cartao || botao) && !link && (
                <div className="tip warn small">
                  {cartao
                    ? 'O cartão clicável abre o link de autocontratação'
                    : botao
                      ? 'O botão abre o link de autocontratação'
                      : 'A mensagem usa {link}'}
                  , mas o link ainda não foi cadastrado. Peça ao administrador para cadastrar em Configurações.
                </div>
              )}

              {sms && (
                <p className={`sms-conta ${contagem.partes > 1 ? 'warn' : 'muted'}`}>
                  {contagem.caracteres} caracteres • {contagem.partes} {contagem.partes === 1 ? 'SMS' : 'SMS por contato'} (
                  {contagem.porParte} por parte{contagem.especial ? ', por causa de acentos/emojis' : ''})
                  {s?.appendOptOut && s.optOutText ? ' — já contando o aviso de descadastro' : ''}
                </p>
              )}
              {!sms && (
                <>
              <div className="formato">
                <span>Formato da mensagem</span>
                <div className="tabs">
                  <button className={!cartao && !botao ? 'active' : ''} onClick={() => set('format', 'imagem')}>
                    🖼️ Imagem + texto
                  </button>
                  <button className={cartao ? 'active' : ''} onClick={() => set('format', 'cartao')}>
                    🔗 Cartão clicável
                  </button>
                  {wa.provider === 'baileys' && (
                    <button className={botao ? 'active' : ''} onClick={() => set('format', 'botao')}>
                      🔘 Botão <small className="tag-exp">experimental</small>
                    </button>
                  )}
                </div>
              </div>
              {botao && (
                <>
                  <label>
                    Texto do botão (até 20 letras)
                    <input
                      value={form.buttonText ?? ''}
                      maxLength={20}
                      onChange={(e) => set('buttonText', e.target.value)}
                      placeholder="Simular agora"
                    />
                  </label>
                  <div className="tip warn small">
                    ⚠ <b>Experimental.</b> Pelo QR Code o WhatsApp não libera botões oficialmente: o sistema monta a
                    mensagem como o WhatsApp de empresas monta. Pode não aparecer em alguns aparelhos (ex.: WhatsApp Web),
                    pode parar de funcionar a qualquer atualização do WhatsApp e <b>aumenta o risco de bloqueio</b> do
                    número. Use <b>Enviar teste</b> no seu celular antes de disparar.
                  </div>
                </>
              )}
              {cartao && (
                <>
                  <div className="form-row">
                    <label>
                      Título do cartão
                      <input value={form.cardTitle ?? ''} maxLength={100} onChange={(e) => set('cardTitle', e.target.value)} />
                    </label>
                    <label>
                      Descrição do cartão
                      <input
                        value={form.cardDescription ?? ''}
                        maxLength={200}
                        onChange={(e) => set('cardDescription', e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="tip small">
                    Tocar no cartão abre o link de autocontratação. Pelo QR Code o WhatsApp não mostra botões; o cartão é a
                    forma clicável que funciona. Dica: imagem <b>horizontal</b> (ex.: 1200×628) deixa o cartão maior.
                  </div>
                </>
              )}

              <div
                className={`dropzone ${arrastando ? 'over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setArrastando(true)
                }}
                onDragLeave={() => setArrastando(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setArrastando(false)
                  const f = e.dataTransfer.files[0]
                  if (f) anexar(() => window.api.media.info(window.api.media.pathForFile(f)))
                }}
              >
                {media ? (
                  <div className="media-chip">
                    {media.preview ? <img src={media.preview} alt="" /> : <span className="media-ico">{ICONE[media.kind]}</span>}
                    <div className="media-meta">
                      <b title={media.name}>{media.name}</b>
                      <small>
                        {TIPO[media.kind]} • {tamanho(media.size)}
                      </small>
                    </div>
                    <button className="btn ghost" onClick={escolher}>
                      Trocar
                    </button>
                    <button className="icon-btn" title="Remover anexo" onClick={() => tirarAnexo()}>
                      ✕
                    </button>
                  </div>
                ) : (
                  <button className="dz-empty" onClick={escolher}>
                    <span className="dz-ico">🖼️</span>
                    <span>
                      <b>{cartao ? 'Imagem do cartão' : botao ? 'Imagem acima do botão (opcional)' : 'Anexar imagem'}</b>
                      <small>
                        {cartao || botao ? 'JPG, PNG ou WEBP' : 'ou vídeo, áudio, PDF'} • clique, arraste o arquivo para cá ou cole com
                        Ctrl+V
                      </small>
                    </span>
                  </button>
                )}
              </div>
                </>
              )}

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
            </div>
            <div>
              <div className="phone-preview">
                {sms ? (
                  <div className="bubble sms-bubble">
                    {pvSms ? <ComLink texto={pvSms} link={link} /> : <span className="muted">Seu SMS aparece aqui…</span>}
                    <small>12:00</small>
                  </div>
                ) : botao ? (
                  <div className={`bubble com-botao ${media?.preview ? 'com-imagem' : ''}`}>
                    {media?.preview && <img className="bubble-img" src={media.preview} alt="" />}
                    {pv ? <ComLink texto={pv} link={link} /> : <span className="muted">Texto acima do botão…</span>}
                    <small>12:00 ✓✓</small>
                    <div className="wa-botao">↗ {form.buttonText || 'Simular agora'}</div>
                  </div>
                ) : cartao ? (
                  <div className="bubble com-cartao">
                    <div className="wa-card">
                      {media?.preview && <img src={media.preview} alt="" />}
                      <div className="wa-card-txt">
                        <b>{form.cardTitle || 'Título do cartão'}</b>
                        {form.cardDescription && <span>{form.cardDescription}</span>}
                        <small>{dominio(link)}</small>
                      </div>
                    </div>
                    <ComLink texto={textoCartao} link={link || '[link de autocontratação]'} />
                    <small>12:00 ✓✓</small>
                  </div>
                ) : (
                  <div className={`bubble ${media?.preview ? 'com-imagem' : ''}`}>
                    {media?.preview && <img className="bubble-img" src={media.preview} alt="" />}
                    {media && !media.preview && (
                      <div className="media-ph">
                        {ICONE[media.kind]} {media.name}
                      </div>
                    )}
                    {pv ? <ComLink texto={pv} link={link} /> : !media && <span className="muted">Sua mensagem aparece aqui…</span>}
                    <small>12:00 ✓✓</small>
                  </div>
                )}
              </div>
              {sms ? (
                <p className="muted small center">
                  SMS é só texto. Links aparecem clicáveis na maioria dos celulares.
                  {s?.sms.stripAccents ? ' Os acentos são retirados no envio.' : ''}
                </p>
              ) : botao ? (
                <p className="muted small center">Tocar no botão abre o link de autocontratação.</p>
              ) : cartao ? (
                <p className="muted small center">No WhatsApp, tocar em qualquer parte do cartão abre o link.</p>
              ) : (
                media && <p className="muted small center">Com anexo, o texto vai junto como legenda.</p>
              )}
              <div className="teste-envio">
                <span>Enviar teste para</span>
                <input
                  value={telTeste}
                  inputMode="tel"
                  placeholder="seu celular, ex.: 11 99999-8888"
                  onChange={(e) => setTelTeste(e.target.value)}
                />
                <button className="btn" disabled={testando || !telTeste.trim() || !podeEnviar} onClick={enviarTeste}>
                  {testando ? 'Enviando…' : 'Enviar teste'}
                </button>
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
              {!sms && wa.provider === 'cloud' && (
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
            <span className="muted">
              Envie apenas para contatos que autorizaram receber mensagens.
              {wa.online > 1 && ` ${wa.online} números conectados: se um cair, os envios seguem pelos outros.`}
            </span>
            <button className="btn" onClick={() => create(false)} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            <button className="btn primary" onClick={() => create(true)} disabled={saving || !podeEnviar}>
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
                    {c.channel === 'sms' ? ' • ✉️ SMS' : ''}
                    {c.format === 'cartao' ? ' • 🔗 cartão clicável' : ''}
                    {c.format === 'botao' ? ` • 🔘 botão "${c.buttonText ?? 'Simular agora'}"` : ''}
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
