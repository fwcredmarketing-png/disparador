import { useState } from 'react'
import type { SepArquivo, SepCriterios, SepLinha, SepMapa, SepResultado } from '@shared/types'
import { fmtPhone, useAction, useToast } from '../lib'
import type { Page } from '../App'

/** Critérios padrão da FW Cred: 3 anos ou mais de empresa, idade de 26 a 50 anos e valor acima de R$ 100. */
const PADRAO = { tempo: 3, idadeMin: 26, idadeMax: 50, valor: 100 }

const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const hoje = () => {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Escolha de uma coluna da planilha (ou "não tem"). */
function Coluna(props: { rotulo: string; colunas: string[]; valor: number | null; mudar: (v: number | null) => void; dica?: string }) {
  return (
    <label>
      {props.rotulo}
      <select value={props.valor ?? ''} onChange={(e) => props.mudar(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">— não tem —</option>
        {props.colunas.map((c, i) => (
          <option key={i} value={i}>
            {c}
          </option>
        ))}
      </select>
      {props.dica && <small className="muted">{props.dica}</small>}
    </label>
  )
}

export default function Separacao({ go }: { go: (p: Page) => void }) {
  const run = useAction()
  const toast = useToast()
  const [arq, setArq] = useState<SepArquivo | null>(null)
  const [mapa, setMapa] = useState<SepMapa | null>(null)
  const [usarTempo, setUsarTempo] = useState(true)
  const [usarIdade, setUsarIdade] = useState(false)
  const [tempo, setTempo] = useState(PADRAO.tempo)
  const [idadeMin, setIdadeMin] = useState(PADRAO.idadeMin)
  const [idadeMax, setIdadeMax] = useState(PADRAO.idadeMax)
  const [usarValor, setUsarValor] = useState(false)
  const [valorMin, setValorMin] = useState(PADRAO.valor)
  const [res, setRes] = useState<SepResultado | null>(null)
  const [ver, setVer] = useState<'todos' | 'aprovados' | 'reprovados'>('todos')
  const [etiqueta, setEtiqueta] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [importada, setImportada] = useState<string | null>(null)

  const crit: SepCriterios = {
    tempoMinimoAnos: usarTempo ? tempo : null,
    idadeMin: usarIdade ? idadeMin : null,
    idadeMax: usarIdade ? idadeMax : null,
    valorMinimo: usarValor ? valorMin : null
  }
  const mudouAlgo = () => {
    setRes(null)
    setImportada(null)
  }
  const setM = (patch: Partial<SepMapa>) => {
    setMapa((m) => (m ? { ...m, ...patch } : m))
    mudouAlgo()
  }

  const separarAgora = async (m = mapa, c = crit) => {
    if (!m) return
    setOcupado(true)
    const r = await run(() => window.api.separacao.analisar(m, c)).finally(() => setOcupado(false))
    if (r) setRes(r)
  }

  const abrir = async () => {
    const a = await run(() => window.api.separacao.abrir())
    if (!a) return
    setArq(a)
    setMapa(a.mapa)
    setImportada(null)
    setVer('todos')
    const temTempo = a.mapa.admissao !== null || a.mapa.tempo !== null
    const temIdade = a.mapa.nascimento !== null || a.mapa.idade !== null
    setUsarTempo(temTempo)
    setUsarIdade(temIdade)
    const temValor = a.mapa.valor !== null
    setUsarValor(temValor)
    setEtiqueta(`aptos-${tempo}anos-${hoje()}`)
    setRes(null)
    if (a.mapa.telefones.length) {
      await separarAgora(a.mapa, {
        tempoMinimoAnos: temTempo ? tempo : null,
        idadeMin: temIdade ? idadeMin : null,
        idadeMax: temIdade ? idadeMax : null,
        valorMinimo: temValor ? valorMin : null
      })
    }
  }

  const importar = async () => {
    if (!mapa) return
    setOcupado(true)
    const r = await run(() => window.api.separacao.importar(mapa, crit, etiqueta)).finally(() => setOcupado(false))
    if (!r) return
    setImportada(etiqueta.trim())
    toast(`${r.novos} contatos novos e ${r.atualizados} que já existiam receberam a etiqueta "${etiqueta.trim()}".`, 'ok')
  }

  const linhas: SepLinha[] = (res?.amostra ?? []).filter((l) => (ver === 'todos' ? true : ver === 'aprovados' ? l.ok : !l.ok))
  const semTempo = usarTempo && mapa && mapa.admissao === null && mapa.tempo === null
  const semIdade = usarIdade && mapa && mapa.nascimento === null && mapa.idade === null
  const semValor = usarValor && mapa && mapa.valor === null

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Separação de números</h1>
          <p>Importe a base, aplique os critérios e mande para o WhatsApp só quem passou.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => run(() => window.api.separacao.modelo())}>
            Baixar modelo de planilha
          </button>
          <button className="btn primary" onClick={abrir}>
            {arq ? 'Trocar planilha' : 'Escolher planilha'}
          </button>
        </div>
      </header>

      {!arq && (
        <section className="card glass">
          <h3>Como funciona</h3>
          <ol className="passos">
            <li>
              Escolha a <b>planilha da base</b> (Excel .xlsx ou .csv). Ela precisa ter o <b>telefone</b> e as colunas dos
              critérios: <b>data de admissão</b> (ou tempo de empresa), <b>data de nascimento</b> (ou idade) e o{' '}
              <b>valor</b> (margem, salário…).
            </li>
            <li>O sistema reconhece as colunas sozinho — confira e ajuste se precisar.</li>
            <li>
              Confira os critérios — padrão: <b>{PADRAO.tempo} anos ou mais de empresa</b>, <b>idade de {PADRAO.idadeMin} a{' '}
              {PADRAO.idadeMax} anos</b> e <b>valor acima de {reais(PADRAO.valor)}</b> — e veja quem foi aprovado e o motivo de
              cada reprovado.
            </li>
            <li>
              Coloque os aprovados em <b>Contatos com uma etiqueta</b> e, em Campanhas, escolha <b>Enviar para: Etiqueta</b>.
            </li>
          </ol>
          <div className="tip small">
            A planilha é lida só neste computador. Para o banco vão apenas nome e celular dos aprovados. Só entram celulares
            válidos para WhatsApp (DDD + 9 dígitos começando com 9) e cada número uma vez só.
          </div>
        </section>
      )}

      {arq && mapa && (
        <>
          <section className="card glass">
            <div className="sep-topo">
              <h3>
                📄 {arq.arquivo} <span className="muted small">• {arq.total.toLocaleString('pt-BR')} linhas</span>
              </h3>
            </div>
            <div className="table-wrap sep-amostra">
              <table>
                <thead>
                  <tr>
                    {arq.colunas.map((c, i) => (
                      <th key={i}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {arq.amostra.map((l, k) => (
                    <tr key={k}>
                      {l.map((v, i) => (
                        <td key={i}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid-2">
            <section className="card glass">
              <h3>Colunas da planilha</h3>
              <p className="muted small">Reconhecidas automaticamente — confira e ajuste se alguma estiver errada.</p>
              <div className="sep-campos">
                <Coluna rotulo="Nome" colunas={arq.colunas} valor={mapa.nome} mudar={(v) => setM({ nome: v })} />
                <div className="sep-tels">
                  <span>Telefone(s) — vale o 1º celular válido da linha</span>
                  <div className="chips">
                    {arq.colunas.map((c, i) => (
                      <button
                        key={i}
                        className={mapa.telefones.includes(i) ? 'on' : ''}
                        onClick={() =>
                          setM({
                            telefones: mapa.telefones.includes(i)
                              ? mapa.telefones.filter((x) => x !== i)
                              : [...mapa.telefones, i].sort((a, b) => a - b)
                          })
                        }
                      >
                        {mapa.telefones.includes(i) ? '✓ ' : ''}
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
                <Coluna
                  rotulo="DDD (se vier em coluna separada)"
                  colunas={arq.colunas}
                  valor={mapa.ddd}
                  mudar={(v) => setM({ ddd: v })}
                />
                <Coluna
                  rotulo="Data de admissão"
                  colunas={arq.colunas}
                  valor={mapa.admissao}
                  mudar={(v) => setM({ admissao: v, ...(v !== null ? { tempo: null } : {}) })}
                />
                {mapa.admissao === null && (
                  <div className="form-row">
                    <Coluna rotulo="ou Tempo de empresa" colunas={arq.colunas} valor={mapa.tempo} mudar={(v) => setM({ tempo: v })} />
                    {mapa.tempo !== null && (
                      <label>
                        Unidade
                        <select
                          value={mapa.tempoUnidade}
                          onChange={(e) => setM({ tempoUnidade: e.target.value as SepMapa['tempoUnidade'] })}
                        >
                          <option value="anos">anos</option>
                          <option value="meses">meses</option>
                        </select>
                      </label>
                    )}
                  </div>
                )}
                <Coluna
                  rotulo="Data de nascimento"
                  colunas={arq.colunas}
                  valor={mapa.nascimento}
                  mudar={(v) => setM({ nascimento: v, ...(v !== null ? { idade: null } : {}) })}
                />
                {mapa.nascimento === null && (
                  <Coluna rotulo="ou Idade" colunas={arq.colunas} valor={mapa.idade} mudar={(v) => setM({ idade: v })} />
                )}
                <Coluna
                  rotulo="Valor (margem, salário, renda…)"
                  colunas={arq.colunas}
                  valor={mapa.valor}
                  mudar={(v) => setM({ valor: v })}
                />
              </div>
            </section>

            <section className="card glass">
              <h3>Critérios</h3>
              <label className="check">
                <input
                  type="checkbox"
                  checked={usarTempo}
                  onChange={(e) => {
                    setUsarTempo(e.target.checked)
                    mudouAlgo()
                  }}
                />
                Tempo mínimo de empresa
              </label>
              {usarTempo && (
                <div className="sep-crit">
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={tempo}
                    onChange={(e) => {
                      setTempo(+e.target.value)
                      mudouAlgo()
                    }}
                  />
                  <span>anos ou mais de empresa</span>
                </div>
              )}
              {semTempo && <p className="error small">Escolha a coluna da data de admissão (ou do tempo de empresa).</p>}

              <label className="check">
                <input
                  type="checkbox"
                  checked={usarIdade}
                  onChange={(e) => {
                    setUsarIdade(e.target.checked)
                    mudouAlgo()
                  }}
                />
                Faixa de idade
              </label>
              {usarIdade && (
                <div className="sep-crit">
                  <span>de</span>
                  <input
                    type="number"
                    min={0}
                    value={idadeMin}
                    onChange={(e) => {
                      setIdadeMin(+e.target.value)
                      mudouAlgo()
                    }}
                  />
                  <span>a</span>
                  <input
                    type="number"
                    min={0}
                    value={idadeMax}
                    onChange={(e) => {
                      setIdadeMax(+e.target.value)
                      mudouAlgo()
                    }}
                  />
                  <span>anos</span>
                </div>
              )}
              {semIdade && <p className="error small">Escolha a coluna da data de nascimento (ou da idade).</p>}

              <label className="check">
                <input
                  type="checkbox"
                  checked={usarValor}
                  onChange={(e) => {
                    setUsarValor(e.target.checked)
                    mudouAlgo()
                  }}
                />
                Valor mínimo
              </label>
              {usarValor && (
                <div className="sep-crit">
                  <span>acima de R$</span>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={valorMin}
                    onChange={(e) => {
                      setValorMin(+e.target.value)
                      mudouAlgo()
                    }}
                  />
                  <span className="muted small">(exatamente {reais(valorMin)} não entra)</span>
                </div>
              )}
              {semValor && <p className="error small">Escolha a coluna do valor (margem, salário…).</p>}

              <ul className="checklist sep-fixos">
                <li className="done">Só celulares válidos para WhatsApp</li>
                <li className="done">Cada número uma vez só</li>
              </ul>
              <button
                className="btn primary"
                disabled={ocupado || !mapa.telefones.length || !!semTempo || !!semIdade || !!semValor}
                onClick={() => separarAgora()}
              >
                {ocupado ? 'Separando…' : res ? 'Separar de novo' : 'Separar números'}
              </button>
            </section>
          </div>

          {res && (
            <section className="card glass">
              <h3>Resultado</h3>
              <div className="sep-kpis">
                <div className="ok">
                  <strong>{res.aprovados.toLocaleString('pt-BR')}</strong>
                  <span>aprovados</span>
                </div>
                <div className="bad">
                  <strong>{res.reprovados.toLocaleString('pt-BR')}</strong>
                  <span>reprovados</span>
                </div>
                <div>
                  <strong>{res.total.toLocaleString('pt-BR')}</strong>
                  <span>linhas na planilha</span>
                </div>
              </div>
              {res.motivos.length > 0 && (
                <ul className="sep-motivos">
                  {res.motivos.map((m) => (
                    <li key={m.motivo}>
                      <b>{m.quantidade.toLocaleString('pt-BR')}</b> {m.motivo}
                    </li>
                  ))}
                </ul>
              )}

              <div className="sep-acoes">
                <label>
                  Etiqueta dos aprovados em Contatos
                  <input value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="ex.: aptos-3anos" />
                </label>
                <button className="btn primary" disabled={ocupado || !res.aprovados || !etiqueta.trim()} onClick={importar}>
                  Colocar {res.aprovados.toLocaleString('pt-BR')} aprovados em Contatos
                </button>
                <button className="btn" onClick={() => run(() => window.api.separacao.exportar(mapa, crit, 'aprovados'))}>
                  Baixar aprovados (CSV)
                </button>
                <button className="btn" onClick={() => run(() => window.api.separacao.exportar(mapa, crit, 'relatorio'))}>
                  Baixar relatório completo
                </button>
              </div>
              {importada && (
                <div className="tip">
                  ✓ Aprovados em Contatos com a etiqueta <b>{importada}</b>. Para disparar, crie a campanha e em{' '}
                  <b>Enviar para</b> escolha <b>Etiqueta: {importada}</b>.{' '}
                  <button className="btn" onClick={() => go('campanhas')}>
                    Ir para Campanhas
                  </button>
                </div>
              )}

              <div className="toolbar">
                <div className="tabs">
                  {(['todos', 'aprovados', 'reprovados'] as const).map((v) => (
                    <button key={v} className={ver === v ? 'active' : ''} onClick={() => setVer(v)}>
                      {v === 'todos' ? 'Todos' : v === 'aprovados' ? 'Aprovados' : 'Reprovados'}
                    </button>
                  ))}
                </div>
                <span className="muted small">
                  Mostrando as primeiras linhas — o relatório completo tem todas.
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Nome</th>
                      <th>Celular</th>
                      <th>Tempo de empresa</th>
                      <th>Idade</th>
                      <th>Valor</th>
                      <th>Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr key={l.linha}>
                        <td>{l.linha}</td>
                        <td>{l.nome || '—'}</td>
                        <td>{l.telefone ? fmtPhone(l.telefone) : '—'}</td>
                        <td>{l.tempo ?? '—'}</td>
                        <td>{l.idade ?? '—'}</td>
                        <td>{l.valor !== undefined ? reais(l.valor) : '—'}</td>
                        <td className={l.ok ? 'ok' : 'bad'}>{l.ok ? '✓ Aprovado' : l.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
