import { useEffect, useState } from 'react'
import type { Settings, SmsConfig, WaOverview, WaRotation, WaStatus } from '@shared/types'
import { lerTipoSmsGo, SMS_PRESETS, SMSGO_TIPOS, smsConfigurado, trocarTipoSmsGo } from '@shared/sms'
import { fmtPhone, useAction, useToast } from '../lib'

const ESTADO: Record<WaStatus['state'], string> = {
  connected: 'Conectado',
  connecting: 'Conectando…',
  qr: 'Aguardando o celular',
  disconnected: 'Desconectado'
}

const MODOS: { id: WaRotation; label: string; texto: string }[] = [
  {
    id: 'revezar',
    label: 'Revezar entre os números',
    texto:
      'Cada mensagem sai por um número diferente, em sequência. O volume fica dividido (cada número tem o seu limite diário) e o risco de bloqueio diminui.'
  },
  {
    id: 'reserva',
    label: 'Um por vez (reserva)',
    texto:
      'As mensagens saem pelo primeiro número da lista. Os outros ficam de reserva e só entram se ele cair, for restringido ou atingir o limite diário.'
  }
]

export default function Conexao({ wa }: { wa: WaOverview }) {
  const run = useAction()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [cloud, setCloud] = useState({ token: '', phoneNumberId: '', apiVersion: 'v21.0' })
  const [novo, setNovo] = useState(false)

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setSettings(s)
      setCloud(s.cloud)
    })
  }, [])

  if (!settings) return null
  const provider = settings.provider

  const save = async (patch: Partial<Settings>) => {
    const s = await run(() => window.api.settings.save(patch))
    if (s) setSettings(s)
    return s
  }

  const saveCloud = async () => {
    if (await save({ cloud })) await run(() => window.api.wa.connect('cloud'))
  }

  const numeros = wa.provider === 'baileys' ? wa.connections : []
  const esperandoQr = numeros.some((c) => !c.me && (c.state === 'qr' || c.state === 'connecting'))
  const cloudSt = wa.connections.find((c) => c.id === 'cloud')
  const modo = MODOS.find((m) => m.id === settings.rotation) ?? MODOS[0]

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Conexão</h1>
          <p>Conecte quantos números quiser. Se um cair ou for restringido, as campanhas continuam pelos outros.</p>
        </div>
        {provider === 'baileys' && (
          <button className="btn primary" disabled={esperandoQr || novo} onClick={() => setNovo(true)}>
            + Adicionar número
          </button>
        )}
      </header>

      <div className="tabs">
        <button className={provider === 'baileys' ? 'active' : ''} onClick={() => save({ provider: 'baileys' })}>
          QR Code (WhatsApp / Business)
        </button>
        <button className={provider === 'cloud' ? 'active' : ''} onClick={() => save({ provider: 'cloud' })}>
          API Oficial (Meta Cloud)
        </button>
      </div>

      {provider === 'baileys' ? (
        <>
          <section className="card glass">
            <div>
              <h3>Números de WhatsApp</h3>
              <p className="muted small num-resumo">
                {wa.online} de {numeros.length} {numeros.length === 1 ? 'conectado' : 'conectados'} • sem limite de
                números
              </p>
            </div>
            {novo && <NovoNumero fechar={() => setNovo(false)} />}
            {numeros.length === 0 ? (
              !novo && (
                <div className="empty">
                  Nenhum número conectado ainda. Clique em <b>+ Adicionar número</b> e conecte por código (digitando no
                  celular) ou pelo QR Code. Depois, adicione quantos números quiser.
                </div>
              )
            ) : (
              <div className="numeros">
                {numeros.map((c, i) => (
                  <Numero key={c.id} c={c} ordem={i + 1} />
                ))}
              </div>
            )}
          </section>

          <div className="grid-2">
            <section className="card glass">
              <h3>Como as campanhas usam os números</h3>
              <div className="tabs">
                {MODOS.map((m) => (
                  <button key={m.id} className={modo.id === m.id ? 'active' : ''} onClick={() => save({ rotation: m.id })}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="muted">{modo.texto}</p>
              <div className="tip">
                Nos dois modos: se um envio falhar, a mesma mensagem é tentada por outro número. Um número que falha 3
                vezes seguidas sai da fila até a campanha ser retomada, e a campanha só pausa quando nenhum número puder
                enviar.
              </div>
            </section>
            <section className="card glass">
              <h3>Sobre esta conexão</h3>
              <p className="muted">
                Funciona com WhatsApp comum ou Business, igual ao WhatsApp Web. Conecte pelo QR Code ou por código (você
                digita no celular um código de 8 letras, sem usar a câmera). As sessões ficam salvas neste computador e
                reconectam sozinhas ao abrir o sistema.
              </p>
              <div className="tip warn">
                ⚠ Conexões não oficiais podem ter o número bloqueado pelo WhatsApp se houver muitas denúncias. Use
                números dedicados, aqueça cada chip aos poucos e envie apenas para contatos que pediram para receber.
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="grid-2">
          <section className="card glass">
            <h3>Credenciais da API oficial</h3>
            <label>
              Token de acesso (permanente)
              <input
                type="password"
                value={cloud.token}
                onChange={(e) => setCloud({ ...cloud, token: e.target.value })}
                placeholder="EAAG..."
              />
            </label>
            <label>
              Phone Number ID
              <input
                value={cloud.phoneNumberId}
                onChange={(e) => setCloud({ ...cloud, phoneNumberId: e.target.value })}
                placeholder="1234567890"
              />
            </label>
            <label>
              Versão da Graph API
              <input value={cloud.apiVersion} onChange={(e) => setCloud({ ...cloud, apiVersion: e.target.value })} />
            </label>
            <div className="row">
              <button className="btn primary" onClick={saveCloud}>
                Salvar e conectar
              </button>
              {cloudSt?.state === 'connected' && (
                <span className="ok">✓ Conectado {cloudSt.name && `— ${cloudSt.name}`}</span>
              )}
            </div>
            {cloudSt?.error && <p className="error">{cloudSt.error}</p>}
          </section>
          <section className="card glass">
            <h3>Como funciona</h3>
            <p className="muted">
              A API oficial da Meta é a forma mais segura para alto volume: sem risco de bloqueio por conexão não
              oficial. Para iniciar conversas, a Meta exige <b>templates aprovados</b> — informe o nome do template ao
              criar a campanha. A variável <code>{'{{1}}'}</code> do template recebe o primeiro nome do contato.
            </p>
            <p className="muted">
              O token fica criptografado neste computador (Windows DPAPI). Respostas "SAIR" exigem webhook e devem ser
              marcadas manualmente na lista de contatos.
            </p>
          </section>
        </div>
      )}

      <SmsCard inicial={settings.sms} salvar={(sms) => save({ sms })} />
    </div>
  )
}

/** Disparo de SMS por API externa (qualquer provedor que receba uma chamada HTTP). */
function SmsCard({ inicial, salvar }: { inicial: SmsConfig; salvar: (c: SmsConfig) => Promise<Settings | undefined> }) {
  const run = useAction()
  const toast = useToast()
  const [c, setC] = useState(inicial)
  const [tel, setTel] = useState('')
  const [salvo, setSalvo] = useState(inicial)
  const set = (patch: Partial<SmsConfig>) => setC((x) => ({ ...x, ...patch }))
  const trocarModelo = (p: SmsConfig['preset']) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { nome, ...modelo } = SMS_PRESETS[p]
    set(modelo)
  }
  const gravar = async () => {
    const s = await salvar(c)
    if (s) setSalvo(s.sms)
    return s
  }
  const testar = async () => {
    if (!(await gravar())) return
    const r = await run(() => window.api.sms.test(tel))
    if (!r) return
    toast(
      r.test
        ? 'Integração OK! O provedor aceitou o SMS em modo TESTE (chave de sandbox): nada foi enviado nem cobrado. Troque pela chave real para disparar.'
        : 'SMS de teste enviado. Confira no celular.',
      'ok'
    )
  }
  const pronto = smsConfigurado(salvo)
  const smsgo = c.preset === 'smsgo'
  const tipo = lerTipoSmsGo(c.body)
  const sandbox = c.token.trim().startsWith('test_')

  return (
    <section className="card glass sms-card">
      <div className="sms-topo">
        <h3>✉️ Disparo de SMS (API externa)</h3>
        <span className={pronto ? 'ok small' : 'muted small'}>{pronto ? '✓ Configurado' : 'Não configurado'}</span>
      </div>
      <p className="muted">
        Campanhas de SMS usam os mesmos contatos, variáveis e intervalos do WhatsApp. Para cada mensagem o sistema chama a
        API do seu provedor de SMS. Token e configuração ficam criptografados neste computador.
      </p>
      <div className="form-row">
        <label>
          Provedor
          <select value={c.preset} onChange={(e) => trocarModelo(e.target.value as SmsConfig['preset'])}>
            {Object.values(SMS_PRESETS).map((p) => (
              <option key={p.preset} value={p.preset}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          {smsgo ? 'Chave da API (SMSGo-key)' : 'Token / chave da API'}
          <input type="password" value={c.token} onChange={(e) => set({ token: e.target.value.trim() })} placeholder="cole aqui" />
        </label>
        <label>
          Remetente (se o provedor pedir)
          <input value={c.sender} onChange={(e) => set({ sender: e.target.value })} placeholder="ex.: FWCRED" />
        </label>
      </div>
      {smsgo && (
        <div className="form-row">
          <label>
            Tipo de SMS
            <select value={tipo ?? 4} onChange={(e) => set({ body: trocarTipoSmsGo(c.body, Number(e.target.value)) })}>
              {SMSGO_TIPOS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </label>
          <div className="tip small">
            Na SMSGo, a chave fica em <b>Minha conta → API</b>. Para validar sem gastar crédito, use primeiro a{' '}
            <b>chave de teste</b> (começa com <code>test_</code>) e depois troque pela chave real.
          </div>
        </div>
      )}
      {sandbox && (
        <div className="tip warn small">
          Chave de <b>teste</b> (sandbox): os envios são aceitos e registrados, mas <b>nenhum SMS chega</b> nos contatos.
          Troque pela chave real antes de disparar campanhas.
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={c.stripAccents} onChange={(e) => set({ stripAccents: e.target.checked })} />
        Tirar acentos das mensagens (cabem 160 letras por SMS em vez de 70 — o SMS sai mais barato)
      </label>
      <details className="sms-avancado" open={c.preset === 'generico'}>
        <summary>Configuração da API (endereço, cabeçalhos e corpo)</summary>
        <label>
          Endereço da API (URL)
          <input value={c.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://api.seuprovedor.com/sms" />
        </label>
        <div className="form-row">
          <label>
            Método
            <select value={c.method} onChange={(e) => set({ method: e.target.value as SmsConfig['method'] })}>
              <option value="POST">POST</option>
              <option value="GET">GET</option>
            </select>
          </label>
          <label>
            Formato do corpo
            <select value={c.bodyType} onChange={(e) => set({ bodyType: e.target.value as SmsConfig['bodyType'] })}>
              <option value="json">JSON</option>
              <option value="form">Formulário (x-www-form-urlencoded)</option>
            </select>
          </label>
          <label>
            Formato do número
            <select value={c.phoneFormat} onChange={(e) => set({ phoneFormat: e.target.value as SmsConfig['phoneFormat'] })}>
              <option value="ddi">5511999998888</option>
              <option value="e164">+5511999998888</option>
              <option value="nacional">11999998888</option>
            </select>
          </label>
        </div>
        <label>
          Cabeçalhos (um por linha, "Nome: valor")
          <textarea rows={2} className="mono" value={c.headers} onChange={(e) => set({ headers: e.target.value })} />
        </label>
        {c.method === 'POST' && (
          <label>
            Corpo da requisição
            <textarea rows={4} className="mono" value={c.body} onChange={(e) => set({ body: e.target.value })} />
          </label>
        )}
        <fieldset className="sms-auth">
          <legend>Autenticação em 2 passos (opcional)</legend>
          <p className="muted small">
            Alguns provedores (como a SMSGo) trocam a chave por um token temporário antes do envio. O token vira{' '}
            <code>{'{{bearer}}'}</code> e é renovado sozinho. Deixe o endereço vazio se o seu provedor não usa.
          </p>
          <label>
            Endereço do token (GET)
            <input value={c.authUrl} onChange={(e) => set({ authUrl: e.target.value })} placeholder="https://api.seuprovedor.com/token" />
          </label>
          <div className="form-row">
            <label>
              Campo do token na resposta
              <input value={c.authField} onChange={(e) => set({ authField: e.target.value })} placeholder="token" />
            </label>
            <label>
              Reaproveitar o token por (horas)
              <input type="number" min={0.1} step={1} value={c.authHours} onChange={(e) => set({ authHours: +e.target.value })} />
            </label>
          </div>
          <label>
            Cabeçalhos do pedido de token
            <textarea rows={2} className="mono" value={c.authHeaders} onChange={(e) => set({ authHeaders: e.target.value })} />
          </label>
        </fieldset>
        <p className="muted small">
          Variáveis: <code>{'{{telefone}}'}</code> <code>{'{{mensagem}}'}</code> <code>{'{{token}}'}</code>{' '}
          <code>{'{{remetente}}'}</code> <code>{'{{bearer}}'}</code> — o sistema troca pelos valores (com o escape certo para
          JSON, formulário ou URL); campos vazios do JSON não são enviados. Resposta 2xx do provedor conta como enviado.
        </p>
      </details>
      <div className="row">
        <button className="btn primary" onClick={async () => (await gravar()) && toast('Configuração de SMS salva', 'ok')}>
          Salvar
        </button>
        <span className="muted small">Teste:</span>
        <input
          className="sms-tel"
          value={tel}
          inputMode="tel"
          placeholder="seu celular, ex.: 11 99999-8888"
          onChange={(e) => setTel(e.target.value)}
        />
        <button className="btn" disabled={!tel.trim() || !smsConfigurado(c)} onClick={testar}>
          Salvar e enviar SMS de teste
        </button>
      </div>
    </section>
  )
}

/** Último jeito de conectar escolhido (só uma conveniência deste computador). */
const lerJeito = (): 'codigo' | 'qr' => {
  try {
    return localStorage.getItem('jeito-conectar') === 'qr' ? 'qr' : 'codigo'
  } catch {
    return 'codigo'
  }
}
const salvarJeito = (j: 'codigo' | 'qr') => {
  try {
    localStorage.setItem('jeito-conectar', j)
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

/** Campo de telefone + botão "Gerar código". */
function CampoNumero({ inicial = '', gerar, rotulo = 'Gerar código' }: { inicial?: string; gerar: (n: string) => unknown; rotulo?: string }) {
  const [n, setN] = useState(inicial)
  const enviar = () => n.trim() && gerar(n.trim())
  return (
    <div className="campo-numero">
      <input
        value={n}
        inputMode="tel"
        placeholder="DDD + número, ex.: 11 99999-8888"
        onChange={(e) => setN(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && enviar()}
        autoFocus
      />
      <button className="btn primary" disabled={!n.trim()} onClick={enviar}>
        {rotulo}
      </button>
    </div>
  )
}

const PASSOS_CODIGO = (
  <>
    <li>
      Toque em <b>Mais opções ⋮</b> ou <b>Configurações</b> → <b>Aparelhos conectados</b> →{' '}
      <b>Conectar um aparelho</b>
    </li>
    <li>
      Toque em <b>Conectar com número de telefone</b> (embaixo da câmera) e digite o código
    </li>
  </>
)

/** Novo número: por código (digitando no celular, sem câmera) ou pelo QR Code. */
function NovoNumero({ fechar }: { fechar: () => void }) {
  const run = useAction()
  const [jeito, setJeito] = useState(lerJeito)
  const escolher = (j: 'codigo' | 'qr') => {
    setJeito(j)
    salvarJeito(j)
  }
  const conectar = async (phone?: string) => {
    const ok = await run(async () => {
      await window.api.wa.add(phone)
      return true
    })
    if (ok) fechar()
  }

  return (
    <div className="num-card wide novo-numero">
      <div className="novo-topo">
        <h3>Conectar novo número</h3>
        <div className="tabs">
          <button className={jeito === 'codigo' ? 'active' : ''} onClick={() => escolher('codigo')}>
            🔢 Por código (sem QR Code)
          </button>
          <button className={jeito === 'qr' ? 'active' : ''} onClick={() => escolher('qr')}>
            ▦ Por QR Code
          </button>
        </div>
      </div>
      {jeito === 'codigo' ? (
        <>
          <p className="muted">
            Digite o número que vai conectar. O sistema mostra um código de 8 letras para você digitar no WhatsApp desse
            celular — não precisa apontar a câmera.
          </p>
          <CampoNumero gerar={conectar} />
        </>
      ) : (
        <>
          <p className="muted">O sistema mostra um QR Code para ler com a câmera do WhatsApp do celular.</p>
          <div className="row">
            <button className="btn primary" onClick={() => conectar()}>
              Gerar QR Code
            </button>
          </div>
        </>
      )}
      <div className="row">
        <button className="btn ghost" onClick={fechar}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

/** Cartão de um número: mostra o QR Code ou o código quando está esperando o celular. */
function Numero({ c, ordem }: { c: WaStatus; ordem: number }) {
  const run = useAction()
  const [pedindoNumero, setPedindoNumero] = useState(false)
  const novo = !c.me

  const remover = () => {
    const pergunta = novo
      ? 'Remover esta conexão?'
      : `Remover o número ${fmtPhone(c.me!)}? Ele sai da conta neste computador e, para usar de novo, será preciso conectar de novo (código ou QR Code).`
    if (confirm(pergunta)) run(() => window.api.wa.remove(c.id), novo ? undefined : 'Número removido')
  }
  // cancelar: conexão nova some da lista; número já conhecido só desconecta
  const cancelar = () => run(() => (novo ? window.api.wa.remove(c.id) : window.api.wa.disconnect(c.id)))
  const gerarCodigo = (phone: string) => run(() => window.api.wa.pair(c.id, phone))

  // ---------- Esperando o celular: código ----------
  if (c.state === 'qr' && c.pairingCode) {
    return (
      <div className="num-card wide qr">
        <div className="pair-code" aria-label="Código para digitar no celular">
          {c.pairingCode.split('').map((ch, i) =>
            ch === '-' ? <i key={i} /> : <span key={i}>{ch}</span>
          )}
        </div>
        <div className="qr-info">
          <h2>Digite este código no celular</h2>
          <ol>
            <li>
              Abra o WhatsApp no celular do número <b>{fmtPhone(c.pairingPhone ?? '')}</b>
            </li>
            {PASSOS_CODIGO}
          </ol>
          <p className="muted small">O código vale por poucos minutos. Se expirar, gere outro.</p>
          <div className="row">
            <button className="btn" onClick={() => gerarCodigo(c.pairingPhone ?? '')}>
              Gerar outro código
            </button>
            <button className="btn" onClick={() => run(() => window.api.wa.useQr(c.id))}>
              Usar QR Code
            </button>
            <button className="btn ghost" onClick={cancelar}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---------- Esperando o celular: QR Code ----------
  if (c.state === 'qr' && c.qr) {
    return (
      <div className="num-card wide qr">
        <div className="qr-frame qr">
          <img src={c.qr} alt="QR Code" />
          <span className="scanline" />
        </div>
        <div className="qr-info">
          <h2>{novo ? 'Leia o QR Code' : `Reconectar ${fmtPhone(c.me!)}`}</h2>
          <ol>
            <li>Abra o WhatsApp no celular{novo ? ' do número que vai conectar' : ''}</li>
            <li>
              Toque em <b>Mais opções ⋮</b> ou <b>Configurações</b> → <b>Aparelhos conectados</b>
            </li>
            <li>
              Toque em <b>Conectar um aparelho</b> e aponte para esta tela
            </li>
          </ol>
          {c.error && <p className="error small">{c.error}</p>}
          <div className="ou-codigo">
            <span className="muted small">Sem câmera? Conecte por código:</span>
            <CampoNumero inicial={c.me ?? ''} gerar={gerarCodigo} />
          </div>
          <div className="row">
            <button className="btn ghost" onClick={cancelar}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    )
  }

  const esperando = c.state === 'connecting' || c.state === 'qr'
  return (
    <div className={`num-card ${esperando ? 'connecting' : c.state}`}>
      <div className="num-top">
        <span className="dot" />
        <span>{ESTADO[esperando ? 'connecting' : c.state]}</span>
        <small className="muted">#{ordem}</small>
      </div>
      <strong className="num-fone">{c.me ? fmtPhone(c.me) : 'Número novo'}</strong>
      {c.name && <span className="muted small">{c.name}</span>}
      {c.error && <p className="error small">{c.error}</p>}
      {pedindoNumero && (
        <CampoNumero
          gerar={async (n) => {
            await gerarCodigo(n)
            setPedindoNumero(false)
          }}
        />
      )}
      <div className="row">
        {c.state === 'connected' && (
          <button className="btn" onClick={() => run(() => window.api.wa.disconnect(c.id))}>
            Desconectar
          </button>
        )}
        {c.state === 'disconnected' && c.linked && (
          <button className="btn primary" onClick={() => run(() => window.api.wa.connect(c.id))}>
            Reconectar
          </button>
        )}
        {c.state === 'disconnected' && !c.linked && (
          <>
            <button
              className="btn primary"
              onClick={() => (c.me ? gerarCodigo(c.me) : setPedindoNumero(!pedindoNumero))}
            >
              Conectar por código
            </button>
            <button className="btn" onClick={() => run(() => window.api.wa.connect(c.id))}>
              QR Code
            </button>
          </>
        )}
        {esperando && (
          <button className="btn" onClick={cancelar}>
            Cancelar
          </button>
        )}
        <button className="btn danger" onClick={remover}>
          Remover
        </button>
      </div>
    </div>
  )
}
