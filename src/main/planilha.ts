import { inflateRawSync } from 'zlib'

/** Valor de uma célula: texto, número (Excel guarda datas como número) ou vazio. */
export type Celula = string | number | null

export interface Tabela {
  colunas: string[]
  linhas: Celula[][]
}

// ======================================================================
// CSV / TXT
// ======================================================================

/** Texto do arquivo: UTF-8; se não for (CSV salvo pelo Excel em português), Windows-1252. */
export function decodificar(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

/** Lê CSV respeitando aspas (separador ; , ou tab, detectado pela 1ª linha). */
export function lerCsv(texto: string): Tabela {
  const primeira = texto.slice(0, texto.search(/\r?\n|$/))
  const sep = [';', ',', '\t'].reduce((best, s) => (primeira.split(s).length > primeira.split(best).length ? s : best))
  const linhas: string[][] = []
  let campo = ''
  let linha: string[] = []
  let aspas = false
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i++
        } else aspas = false
      } else campo += ch
    } else if (ch === '"' && campo === '') aspas = true
    else if (ch === sep) {
      linha.push(campo)
      campo = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++
      linha.push(campo)
      campo = ''
      if (linha.some((c) => c.trim() !== '')) linhas.push(linha)
      linha = []
    } else campo += ch
  }
  linha.push(campo)
  if (linha.some((c) => c.trim() !== '')) linhas.push(linha)
  return separarCabecalho(linhas.map((l) => l.map((c) => c.trim())))
}

/** A 1ª linha é cabeçalho se tiver algum texto que não seja número/data; senão cria "Coluna 1, 2…". */
function separarCabecalho(linhas: Celula[][]): Tabela {
  if (!linhas.length) return { colunas: [], linhas: [] }
  const largura = Math.max(...linhas.map((l) => l.length))
  const primeira = linhas[0]
  const ehCabecalho = primeira.some((c) => typeof c === 'string' && /[a-zA-ZÀ-ú]/.test(c))
  const colunas = Array.from({ length: largura }, (_, i) =>
    ehCabecalho ? String(primeira[i] ?? '').trim() || `Coluna ${i + 1}` : `Coluna ${i + 1}`
  )
  return { colunas, linhas: ehCabecalho ? linhas.slice(1) : linhas }
}

// ======================================================================
// Excel (.xlsx): um zip de arquivos XML. Lê a 1ª aba, sem bibliotecas externas.
// ======================================================================

/** Extrai arquivos de dentro do zip. */
function unzip(buf: Buffer, quer: (nome: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  let fim = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fim = i
      break
    }
  }
  if (fim < 0) throw new Error('O arquivo não é uma planilha do Excel (.xlsx) válida')
  const total = buf.readUInt16LE(fim + 10)
  let p = buf.readUInt32LE(fim + 16)
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const metodo = buf.readUInt16LE(p + 10)
    const tamanho = buf.readUInt32LE(p + 20)
    const lenNome = buf.readUInt16LE(p + 28)
    const lenExtra = buf.readUInt16LE(p + 30)
    const lenComent = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const nome = buf.toString('utf8', p + 46, p + 46 + lenNome)
    p += 46 + lenNome + lenExtra + lenComent
    if (!quer(nome)) continue
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const dados = buf.subarray(ini, ini + tamanho)
    out.set(nome, metodo === 8 ? inflateRawSync(dados) : Buffer.from(dados))
  }
  return out
}

const entidades: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const xmlTexto = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : (entidades[e] ?? m)
  )
/** Junta todos os <t> de um trecho (texto com formatação vem em vários pedaços). */
const juntarT = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlTexto(m[1])).join('')

const colunaDaRef = (ref: string) => {
  const letras = ref.replace(/[^A-Z]/gi, '').toUpperCase()
  let n = 0
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export function lerXlsx(buf: Buffer): Tabela {
  const arquivos = unzip(buf, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n))
  // 1ª aba da pasta de trabalho
  let caminho = 'xl/worksheets/sheet1.xml'
  const wb = arquivos.get('xl/workbook.xml')?.toString('utf8') ?? ''
  const rels = arquivos.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? ''
  const rid = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]
  const alvo = rid && rels.match(new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*\\bTarget="([^"]+)"`))?.[1]
  const alvo2 = rid && rels.match(new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${rid}"`))?.[1]
  const t = alvo || alvo2
  if (t) caminho = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`
  const folha = arquivos.get(caminho) ?? [...arquivos.entries()].find(([n]) => n.startsWith('xl/worksheets/'))?.[1]
  if (!folha) throw new Error('Não encontrei nenhuma aba com dados nessa planilha')

  const compartilhados = [...(arquivos.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
    (m) => juntarT(m[1])
  )

  const linhas: Celula[][] = []
  for (const r of folha.toString('utf8').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const linha: Celula[] = []
    let proxima = 0
    for (const c of (r[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]
      const ref = attrs.match(/\br="([A-Z]+)\d*"/i)?.[1]
      const col = ref ? colunaDaRef(ref) : proxima
      proxima = col + 1
      const tipo = attrs.match(/\bt="([^"]+)"/)?.[1]
      const corpo = c[2] ?? ''
      const v = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let valor: Celula = null
      if (tipo === 's') valor = v !== undefined ? (compartilhados[Number(v)] ?? '') : null
      else if (tipo === 'inlineStr') valor = juntarT(corpo)
      else if (tipo === 'str' || tipo === 'e') valor = v !== undefined ? xmlTexto(v) : null
      else if (tipo === 'b') valor = v === '1' ? 'VERDADEIRO' : 'FALSO'
      else if (v !== undefined && v !== '') valor = Number.isFinite(Number(v)) ? Number(v) : xmlTexto(v)
      linha[col] = typeof valor === 'string' ? valor.trim() : valor
    }
    for (let i = 0; i < linha.length; i++) if (linha[i] === undefined) linha[i] = null
    if (linha.some((x) => x !== null && x !== '')) linhas.push(linha)
  }
  return separarCabecalho(linhas)
}

/** Lê CSV/TXT ou Excel (.xlsx) pelo conteúdo do arquivo. */
export function lerPlanilha(buf: Buffer, nome: string): Tabela {
  const zip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50
  if (zip) return lerXlsx(buf)
  if (/\.xls$/i.test(nome))
    throw new Error('Planilha no formato antigo do Excel (.xls). Abra no Excel e salve como .xlsx ou .csv.')
  return lerCsv(decodificar(buf))
}
