import type { EventEmitter } from 'events'
import type { CloudTemplate, WaStatus } from '@shared/types'

export interface SendContent {
  text: string
  mediaPath?: string
  template?: CloudTemplate & { params: string[] }
}

export interface IncomingMessage {
  phone: string
  text: string
}

/** Erro para números que não possuem WhatsApp. */
export class InvalidNumberError extends Error {
  constructor(phone: string) {
    super(`O número ${phone} não possui WhatsApp`)
    this.name = 'InvalidNumberError'
  }
}

/**
 * Contrato que todo provedor de WhatsApp implementa.
 * Eventos: 'status' (WaStatus) e 'incoming' (IncomingMessage)
 */
export interface WaProvider extends EventEmitter {
  status(): WaStatus
  connect(): Promise<void>
  disconnect(): Promise<void>
  logout(): Promise<void>
  send(phone: string, content: SendContent): Promise<void>
}

export const mimeFromPath = (p: string): { mime: string; kind: 'image' | 'video' | 'audio' | 'document' } => {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, [string, 'image' | 'video' | 'audio' | 'document']> = {
    jpg: ['image/jpeg', 'image'],
    jpeg: ['image/jpeg', 'image'],
    png: ['image/png', 'image'],
    webp: ['image/webp', 'image'],
    mp4: ['video/mp4', 'video'],
    mp3: ['audio/mpeg', 'audio'],
    ogg: ['audio/ogg', 'audio'],
    pdf: ['application/pdf', 'document'],
    docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'],
    xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'document']
  }
  const [mime, kind] = map[ext] ?? ['application/octet-stream', 'document']
  return { mime, kind }
}
