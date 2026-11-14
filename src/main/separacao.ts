import type { SepCriterios, SepLinha, SepMapa, SepResultado } from '@shared/types'
import type { Celula, Tabela } from './planilha'

/**
 * Separação de números para o disparo de WhatsApp.
 * Para cada linha da planilha: escolhe um celular válido, descarta repetidos e aplica os critérios
 * (tempo mínimo de empresa, faixa de idade, valor acima de R$ X). Tudo acontece neste computador; só os aprovados vão para Contatos.
 */

const sem = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const texto = (v: Celula | undefined): string => (v === null || v === undefined ? '' : String(v).trim())

// ---------------------------------------------------------------------------
// Datas e tempos
// ---------------------------------------------------------------------------

const valida = (a: number, m: number, d: number) => {
  if (a < 1900 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(a, m - 1, d)
  return dt.getMonth() === m - 1 ? dt : null
}

/**
 * Data em qualquer formato comum de planilha: 15/03/2020, 15-03-2020, 15.03.20, 2020-03-15,
 * 15032020, 20200315 e o número de série do Excel (ex.: 43905 = 15/03/2020).
 */
export function lerData(v: Celula | undefined, hoje = new Date()): Date | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') {
    if (v > 1000 && v < 80000) {
      // série do Excel: dias desde 30/12/1899
      const base = Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000
      const d = new Date(base)
      return valida(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    }
    if (v >= 10_000_000 && v < 100_000_000) return lerData(String(Math.floor(v)).padStart(8, '0'), hoje)
    return null
  }
  const s = v.trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return valida(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/)
  if (m) {
    let a = +m[3]
    if (m[3].length === 2) a += a > hoje.getFullYear() % 100 ? 1900 : 2000
    return valida(a, +m[2], +m[1])
  }
  m = s.match(/^(\d{8})$/)
  if (m) {
    const d = m[1]
    return +d.slice(0, 4) > 1900 ? valida(+d.slice(0, 4), +d.slice(4, 6), +d.slice(6, 8)) : valida(+d.slice(4), +d.slice(2, 4), +d.slice(0, 2))
  }
  if (/^\d{4,5}$/.test(s)) return lerData(Number(s), hoje) // série do Excel exportada como texto
  return null
}

/** Meses completos entre duas datas. */
export function mesesEntre(inicio: Date, fim: Date): number {
  let m = (fim.getFullYear() - inicio.getFullYear()) * 12 + (fim.getMonth() - inicio.getMonth())
  if (fim.getDate() < inicio.getDate()) m--
  return m
}

/** Tempo de empresa em meses: "3 anos e 2 meses", "38 meses", "3,5" (na unidade da coluna). */
export function lerTempo(v: Celula | undefined, unidade: 'anos' | 'meses'): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v < 0 ? null : Math.floor(unidade === 'anos' ? v * 12 : v)
  // mantém o decimal ("2,5" = 2.5); o resto vira espaço
  const s = v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim()
  const anos = s.match(/(\d+(?:\.\d+)?)\s*(a|ano|anos)\b/)
  const meses = s.match(/(\d+)\s*(m|mes|meses)\b/)
  if (anos || meses) return Math.floor((anos ? +anos[1] * 12 : 0) + (meses ? +meses[1] : 0))
  if (/^\d+(\.\d+)?$/.test(s)) return lerTempo(Number(s), unidade)
  return null
}

/** "38 meses" → "3 anos e 2 meses". */
export function descreverMeses(m: number): string {
  const a = Math.floor(m / 12)
  const r = m % 12
  const pa = a ? `${a} ${a === 1 ? 'ano' : 'anos'}` : ''
  const pm = r ? `${r} ${r === 1 ? 'mês' : 'meses'}` : ''
  return [pa, pm].filter(Boolean).join(' e ') || '0 meses'
}

// ---------------------------------------------------------------------------
// Valores em reais
// ---------------------------------------------------------------------------

/**
 * Valor em R$ escrito de qualquer jeito comum: "R$ 1.234,56", "1234,56", "1.500", "1234.56", "(50,00)" ou
 * número do Excel. Com ponto e vírgula juntos, o último é o separador dos centavos.
 */
export function lerValor(v: Celula | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = v.trim()
  const negativo = /^-|^\(.*\)$|-$/.test(s.replace(/r\$\s*/i, '').trim())
  let d = s.replace(/[^\d.,]/g, '')
  if (!/\d/.test(d)) return null
  const ponto = d.lastIndexOf('.')
  const virgula = d.lastIndexOf(',')
  if (ponto >= 0 && virgula >= 0) {
    // 1.234,56 (Brasil) ou 1,234.56 (EUA): o que vem por último separa os centavos
    d = ponto > virgula ? d.replace(/,/g, '') : d.replace(/\./g, '').replace(',', '.')
  } else if (virgula >= 0) {
    // só vírgula: "100,50" é decimal; "1,234,567" (várias) é milhar
    d = (d.match(/,/g)!.length > 1 ? d.replace(/,/g, '') : d.replace(',', '.'))
  } else if (ponto >= 0) {
    // só ponto: "1.500" e "1.234.567" são milhar (Brasil); "100.5" e "1234.56" são decimal
    const depois = d.length - ponto - 1
    if (d.match(/\./g)!.length > 1 || depois === 3) d = d.replace(/\./g, '')
  }
  const n = Number(d)
  if (!Number.isFinite(n)) return null
  return negativo ? -n : n
}

/** 1234.5 → "R$ 1.234,50". */
export function reais(v: number): string {
  const [int, dec] = Math.abs(v).toFixed(2).split('.')
  return `${v < 0 ? '-' : ''}R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}

// ---------------------------------------------------------------------------
// Telefones
// ---------------------------------------------------------------------------

/**
 * Celular brasileiro no formato do sistema (5511999998888), ou null se não for celular.
 * Aceita com ou sem 55, com DDD em outra coluna e celular antigo de 8 dígitos (ganha o 9 na frente).
 */
export function celular(v: Celula | undefined, ddd?: Celula): string | null {
  let d = texto(v).replace(/\D/g, '').replace(/^0+/, '')
  if (!d) return null
  const dddCol = texto(ddd).replace(/\D/g, '').replace(/^0+/, '')
  if ((d.length === 8 || d.length === 9) && dddCol.length === 2) d = dddCol + d
  if (d.length === 12 || d.length === 13) {
    if (!d.startsWith('55')) return null
    d = d.slice(2)
  }
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + '9' + d.slice(2) // celular antigo sem o 9
  if (d.length !== 11) return null
  if (!/^[1-9][1-9]$/.test(d.slice(0, 2)) || d[2] !== '9') return null
  if (/^(\d)\1+$/.test(d.slice(3))) return null // 99999-9999, 00000-0000…
  return '55' + d
}

// ---------------------------------------------------------------------------
// Reconhecimento das colunas
// ---------------------------------------------------------------------------

const RE = {
  nome: /^(nome|nome completo|cliente|nome cliente|nome do cliente|funcionario|nome funcionario|colaborador|beneficiario|name)\b|^nome/,
  ddd: /^(ddd|dd)\b/,
  telefone: /\b(tel|fone|cel|whats|zap|contato|phone|movel|mobile)/, // início de palavra: "parcela" não é "cel"
  admissao: /(admiss|admis|dt adm|data adm|inicio vinculo|data inicio|entrada empresa)/,
  tempo: /(tempo.*(empresa|servico|casa|trabalho|vinculo)|meses.*empresa|anos.*empresa|tempo de casa|antiguidade)/,
  nascimento: /(nasc|nascimento|dt nasc|data nasc|aniversario|birth)/,
  idade: /^(idade|age)\b/,
  // valor em R$, do mais provável para o menos provável (base de crédito: margem primeiro)
  valor: [
    /margem/,
    /^(valor|vlr|vl|valores)\b|\bvalor\b/,
    /(salario|renda|remuneracao|vencimento|provento|liquido|bruto)/,
    /(saldo|limite|credito)/
  ],
  // parece valor mas não é (datas, quantidades, códigos, percentuais…)
  naoValor: /(data|dt|cpf|cnpj|qtd|quant|numero|num |^n |^nr|cod|prazo|taxa|percent|parcelas|meses|dias|nb\b|especie|tipo|banco|agencia|conta|matricula)/
}

/** Quanto da coluna tem cara de dinheiro ("R$ …"). */
function pareceDinheiro(linhas: Celula[][], i: number): number {
  const cheias = linhas
    .slice(0, 200)
    .map((l) => texto(l[i]))
    .filter(Boolean)
  if (!cheias.length) return 0
  return cheias.filter((v) => /r\$/i.test(v)).length / cheias.length
}

/** Quanto da coluna parece telefone (amostra). */
function pareceTelefone(linhas: Celula[][], i: number): number {
  const amostra = linhas.slice(0, 200).map((l) => texto(l[i]).replace(/\D/g, ''))
  const cheias = amostra.filter(Boolean)
  if (!cheias.length) return 0
  return cheias.filter((d) => d.length >= 10 && d.length <= 13).length / cheias.length
}

export function detectarColunas(t: Tabela): SepMapa {
  const nomes = t.colunas.map(sem)
  const acha = (re: RegExp, exceto: number[] = []) => {
    const i = nomes.findIndex((n, k) => !exceto.includes(k) && re.test(n))
    return i >= 0 ? i : null
  }
  const ddd = acha(RE.ddd)
  const admissao = acha(RE.admissao)
  const nascimento = acha(RE.nascimento)
  const usados = [ddd, admissao, nascimento].filter((x): x is number => x !== null)
  let telefones = nomes
    .map((n, i) => (!usados.includes(i) && RE.telefone.test(n) && !RE.ddd.test(n) && !/cpf|cnpj|rg\b|cep/.test(n) ? i : -1))
    .filter((i) => i >= 0)
  if (!telefones.length) {
    // sem cabeçalho de telefone: colunas cujo conteúdo parece telefone
    telefones = t.colunas.map((_, i) => i).filter((i) => !usados.includes(i) && pareceTelefone(t.linhas, i) >= 0.6)
  }
  const tempo = admissao === null ? acha(RE.tempo) : null
  const idade = nascimento === null ? acha(RE.idade) : null
  let tempoUnidade: SepMapa['tempoUnidade'] = 'anos'
  if (tempo !== null) {
    if (/mes/.test(nomes[tempo])) tempoUnidade = 'meses'
    else if (!/ano/.test(nomes[tempo])) {
      // sem unidade no nome: valores grandes indicam meses
      const nums = t.linhas.slice(0, 200).map((l) => Number(l[tempo])).filter((n) => Number.isFinite(n))
      if (nums.some((n) => n > 50)) tempoUnidade = 'meses'
    }
  }
  // nome: primeiro o cabeçalho exato ("Nome", "Nome completo"), depois qualquer "nome…" que não seja de mãe/pai/empresa
  const exato = nomes.findIndex((n) => /^(nome|nome completo|nome do cliente|nome cliente|cliente)$/.test(n))
  const nome =
    exato >= 0 ? exato : acha(new RegExp(RE.nome.source), [...usados, ...telefones, ...nomes.map((n, i) => (/mae|pai|empresa|fantasia|social|empregador/.test(n) ? i : -1)).filter((i) => i >= 0)])
  // valor: pelo cabeçalho (margem > valor > salário/renda > saldo/limite); senão, a coluna cheia de "R$"
  const ocupadas = [...usados, ...telefones, tempo, idade, nome].filter((x): x is number => x !== null)
  let valor: number | null = null
  for (const re of RE.valor) {
    const i = nomes.findIndex((n, k) => !ocupadas.includes(k) && re.test(n) && !RE.naoValor.test(n))
    if (i >= 0) {
      valor = i
      break
    }
  }
  if (valor === null) {
    const i = t.colunas.findIndex((_, k) => !ocupadas.includes(k) && pareceDinheiro(t.linhas, k) >= 0.6)
    if (i >= 0) valor = i
  }
  return {
    nome,
    telefones,
    ddd,
    admissao,
    tempo,
    tempoUnidade,
    nascimento,
    idade,
    valor
  }
}

// ---------------------------------------------------------------------------
// Separação
// ---------------------------------------------------------------------------

export interface SepAvaliada extends SepLinha {
  original: Celula[]
}

export interface Separacao {
  resultado: SepResultado
  linhas: SepAvaliada[]
}

/** Motivo geral (para a contagem) + detalhe da linha. */
type Reprova = { geral: string; detalhe: string }

export function separar(t: Tabela, mapa: SepMapa, crit: SepCriterios, hoje = new Date()): Separacao {
  const usaTempo = crit.tempoMinimoAnos !== null && crit.tempoMinimoAnos > 0
  const usaIdade = crit.idadeMin !== null || crit.idadeMax !== null
  if (!mapa.telefones.length) throw new Error('Escolha a coluna do telefone')
  if (usaTempo && mapa.admissao === null && mapa.tempo === null)
    throw new Error('Para o tempo de empresa, escolha a coluna da data de admissão (ou do tempo de empresa)')
  if (usaIdade && mapa.nascimento === null && mapa.idade === null)
    throw new Error('Para a idade, escolha a coluna da data de nascimento (ou da idade)')
  const usaValor = crit.valorMinimo !== null && crit.valorMinimo !== undefined
  if (usaValor && (mapa.valor === null || mapa.valor === undefined))
    throw new Error('Para o valor, escolha a coluna do valor (margem, salário…)')

  const minMeses = usaTempo ? Math.round(crit.tempoMinimoAnos! * 12) : 0
  const faixa =
    crit.idadeMin !== null && crit.idadeMax !== null
      ? `${crit.idadeMin} a ${crit.idadeMax} anos`
      : crit.idadeMin !== null
        ? `${crit.idadeMin} anos ou mais`
        : `até ${crit.idadeMax} anos`
  const vistos = new Set<string>()
  const linhas: SepAvaliada[] = []
  const contagem = new Map<string, number>()

  t.linhas.forEach((l, k) => {
    const nome = mapa.nome !== null ? texto(l[mapa.nome]) : ''
    const item: SepAvaliada = { linha: k + 2, nome, ok: false, original: l }
    const reprova = ((): Reprova | null => {
      // celular válido (o 1º das colunas de telefone)
      let tel: string | null = null
      for (const c of mapa.telefones) {
        tel = celular(l[c], mapa.ddd !== null ? l[mapa.ddd] : undefined)
        if (tel) break
      }
      if (!tel) {
        const algum = mapa.telefones.map((c) => texto(l[c])).find(Boolean)
        return {
          geral: 'Sem celular válido para WhatsApp',
          detalhe: algum ? `Sem celular válido (${algum})` : 'Sem telefone'
        }
      }
      item.telefone = tel
      if (vistos.has(tel)) return { geral: 'Telefone repetido na planilha', detalhe: 'Telefone repetido na planilha' }
      vistos.add(tel)

      // lê tudo antes de julgar, para o relatório mostrar tempo, idade e valor até de quem foi reprovado
      let meses: number | null = null
      if (mapa.admissao !== null) {
        const adm = lerData(l[mapa.admissao], hoje)
        if (adm && adm <= hoje) meses = mesesEntre(adm, hoje)
      } else if (mapa.tempo !== null) meses = lerTempo(l[mapa.tempo], mapa.tempoUnidade)
      if (meses !== null) item.tempo = descreverMeses(meses)

      let idade: number | null = null
      if (mapa.nascimento !== null) {
        const nasc = lerData(l[mapa.nascimento], hoje)
        if (nasc && nasc < hoje) idade = Math.floor(mesesEntre(nasc, hoje) / 12)
      } else if (mapa.idade !== null) {
        const n = Number(texto(l[mapa.idade]).replace(/[^\d]/g, ''))
        idade = texto(l[mapa.idade]) && Number.isFinite(n) && n > 0 && n < 130 ? n : null
      }
      if (idade !== null) item.idade = idade

      const valor = mapa.valor !== null ? lerValor(l[mapa.valor]) : null
      if (valor !== null) item.valor = valor

      // tempo de empresa
      if (usaTempo) {
        if (meses === null)
          return { geral: 'Sem data de admissão / tempo de empresa', detalhe: 'Sem data de admissão / tempo de empresa' }
        if (meses < minMeses)
          return {
            geral: `Menos de ${crit.tempoMinimoAnos} ${crit.tempoMinimoAnos === 1 ? 'ano' : 'anos'} de empresa`,
            detalhe: `Menos de ${crit.tempoMinimoAnos} ${crit.tempoMinimoAnos === 1 ? 'ano' : 'anos'} de empresa (${item.tempo})`
          }
      }

      // idade
      if (usaIdade) {
        if (idade === null) return { geral: 'Sem data de nascimento / idade', detalhe: 'Sem data de nascimento / idade' }
        if ((crit.idadeMin !== null && idade < crit.idadeMin) || (crit.idadeMax !== null && idade > crit.idadeMax))
          return { geral: `Idade fora de ${faixa}`, detalhe: `Idade fora de ${faixa} (${idade} anos)` }
      }

      // valor: tem de passar de R$ X (R$ X exato não passa)
      if (usaValor) {
        if (valor === null) return { geral: 'Sem valor', detalhe: 'Sem valor' }
        if (valor <= crit.valorMinimo!)
          return {
            geral: `Valor até ${reais(crit.valorMinimo!)}`,
            detalhe: `Valor até ${reais(crit.valorMinimo!)} (${reais(valor)})`
          }
      }
      return null
    })()
    if (reprova) {
      item.motivo = reprova.detalhe
      contagem.set(reprova.geral, (contagem.get(reprova.geral) ?? 0) + 1)
    } else item.ok = true
    linhas.push(item)
  })

  const aprovados = linhas.filter((x) => x.ok).length
  return {
    linhas,
    resultado: {
      total: linhas.length,
      aprovados,
      reprovados: linhas.length - aprovados,
      motivos: [...contagem.entries()].map(([motivo, quantidade]) => ({ motivo, quantidade })).sort((a, b) => b.quantidade - a.quantidade),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      amostra: linhas.slice(0, 200).map(({ original, ...resto }) => resto)
    }
  }
}

// ---------------------------------------------------------------------------
// Arquivos de saída
// ---------------------------------------------------------------------------

const csvCampo = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = (linhas: unknown[][]) => '﻿' + linhas.map((l) => l.map(csvCampo).join(';')).join('\r\n')

/** Só os aprovados: Nome;Telefone (pronto para importar em qualquer lugar). */
export function csvAprovados(s: Separacao): string {
  return csv([['Nome', 'Telefone'], ...s.linhas.filter((x) => x.ok).map((x) => [x.nome, x.telefone])])
}

/** Planilha original + resultado de cada linha (para conferir ou guardar). */
export function csvRelatorio(t: Tabela, s: Separacao): string {
  return csv([
    [...t.colunas, 'Resultado', 'Motivo', 'Celular (WhatsApp)', 'Tempo de empresa', 'Idade', 'Valor lido'],
    ...s.linhas.map((x) => [
      ...t.colunas.map((_, i) => x.original[i] ?? ''),
      x.ok ? 'APROVADO' : 'REPROVADO',
      x.motivo ?? '',
      x.telefone ?? '',
      x.tempo ?? '',
      x.idade ?? '',
      x.valor !== undefined ? reais(x.valor) : ''
    ])
  ])
}

/** Modelo de planilha com as colunas que a separação reconhece. */
export function csvModelo(): string {
  return csv([
    ['Nome', 'Telefone', 'Data de admissão', 'Data de nascimento', 'Valor'],
    ['Maria da Silva (exemplo)', '(11) 99999-0001', '10/02/2019', '25/07/1988', 'R$ 350,00'],
    ['João Souza (exemplo)', '21 98888-0002', '03/09/2024', '14/01/1995', 'R$ 80,00']
  ])
}
