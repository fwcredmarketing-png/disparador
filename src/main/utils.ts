import { randomUUID } from 'crypto'
import type { Contact } from '@shared/types'

export const uid = (): string => randomUUID()

export const today = (d = new Date()): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const randomBetween = (min: number, max: number): number => {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  return lo + Math.random() * (hi - lo)
}

/**
 * Normaliza telefone para o formato internacional só com dígitos.
 * Números brasileiros sem DDI (10 ou 11 dígitos) recebem 55 na frente.
 */
export function normalizePhone(raw: string): string | null {
  let d = String(raw ?? '').replace(/\D/g, '')
  d = d.replace(/^0+/, '')
  if (!d) return null
  if (d.length === 10 || d.length === 11) d = '55' + d
  if (d.length < 11 || d.length > 15) return null
  return d
}

/** Spintax: "{Olá|Oi|E aí}" escolhe uma opção aleatória (aceita aninhamento). */
export function spin(text: string): string {
  const re = /\{([^{}]*\|[^{}]*)\}/
  let out = text
  let guard = 0
  while (re.test(out) && guard++ < 500) {
    out = out.replace(re, (_m, group: string) => {
      const opts = group.split('|')
      return opts[Math.floor(Math.random() * opts.length)]
    })
  }
  return out
}

/** Substitui variáveis ({nome}, {primeiro_nome}, {telefone}, {link}) e aplica spintax. */
export function renderMessage(
  template: string,
  c: Pick<Contact, 'name' | 'phone'>,
  extra: { link?: string } = {}
): string {
  const nome = (c.name || '').trim()
  const primeiro = nome.split(/\s+/)[0] || ''
  const withVars = template
    .replace(/\{nome\}/gi, nome)
    .replace(/\{primeiro_nome\}/gi, primeiro)
    .replace(/\{telefone\}/gi, c.phone)
    .replace(/\{link\}/gi, extra.link ?? '')
  return spin(withVars).trim()
}

export const normalizeText = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()

/** Lê CSV/TXT simples: "nome;telefone;tags" ou "telefone" por linha. */
export function parseContactsFile(content: string): { name: string; phone: string; tags: string[] }[] {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const sep = [';', ',', '\t'].reduce((best, s) =>
    lines[0].split(s).length > lines[0].split(best).length ? s : best
  )
  const header = lines[0].toLowerCase().split(sep).map((h) => h.replace(/"/g, '').trim())
  const hasHeader = header.some((h) => /nome|name|telefone|phone|celular|whats|numero|número/.test(h))
  let iName = -1
  let iPhone = -1
  let iTags = -1
  if (hasHeader) {
    iName = header.findIndex((h) => /nome|name/.test(h))
    iPhone = header.findIndex((h) => /telefone|phone|celular|whats|numero|número|fone/.test(h))
    iTags = header.findIndex((h) => /tag|etiqueta|grupo|segmento/.test(h))
  }
  const rows = hasHeader ? lines.slice(1) : lines
  return rows.map((line) => {
    const cols = line.split(sep).map((c) => c.replace(/^"|"$/g, '').trim())
    let phone = ''
    let name = ''
    if (iPhone >= 0) {
      phone = cols[iPhone] ?? ''
      name = iName >= 0 ? cols[iName] ?? '' : ''
    } else {
      // sem cabeçalho: a coluna com mais dígitos é o telefone
      const idx = cols.reduce(
        (best, c, i) => (c.replace(/\D/g, '').length > (cols[best] ?? '').replace(/\D/g, '').length ? i : best),
        0
      )
      phone = cols[idx] ?? ''
      name = cols.find((c, i) => i !== idx && /[a-zA-ZÀ-ú]/.test(c)) ?? ''
    }
    const tags =
      iTags >= 0 && cols[iTags]
        ? cols[iTags].split(/[|/]/).map((t) => t.trim()).filter(Boolean)
        : []
    return { name, phone, tags }
  })
}
