import { app, nativeImage } from 'electron'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import type { MediaInfo } from '@shared/types'
import { mimeFromPath } from './whatsapp/provider'

/** Tipos aceitos nas campanhas (os mesmos que o WhatsApp envia). */
export const EXTENSOES_MIDIA = ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mp3', 'ogg', 'pdf', 'docx', 'xlsx']

/** Limites do WhatsApp (e do bucket de mídias, 50 MB). */
const LIMITE_MB: Record<MediaInfo['kind'], number> = { image: 16, video: 16, audio: 16, document: 50 }
const NOME: Record<MediaInfo['kind'], string> = { image: 'imagens', video: 'vídeos', audio: 'áudios', document: 'documentos' }

/** Confere o arquivo e devolve nome, tamanho, tipo e miniatura (se for imagem). */
export async function mediaInfo(path: string): Promise<MediaInfo> {
  const ext = extname(path).slice(1).toLowerCase()
  if (!EXTENSOES_MIDIA.includes(ext))
    throw new Error(
      `Tipo de arquivo não aceito (.${ext || '?'}). Use imagem JPG, PNG ou WEBP, vídeo MP4, áudio MP3/OGG ou PDF, DOCX, XLSX.`
    )
  const st = await stat(path).catch(() => null)
  if (!st?.isFile()) throw new Error('Arquivo não encontrado')
  const { kind, mime } = mimeFromPath(path)
  const limite = LIMITE_MB[kind]
  if (st.size > limite * 1024 * 1024)
    throw new Error(`Arquivo grande demais (${(st.size / 1048576).toFixed(1)} MB). O limite para ${NOME[kind]} é ${limite} MB.`)

  let preview: string | undefined
  if (kind === 'image') {
    const img = nativeImage.createFromPath(path)
    if (!img.isEmpty()) {
      const menor = img.getSize().width > 560 ? img.resize({ width: 560, quality: 'good' }) : img
      preview = menor.toDataURL()
    } else if (st.size <= 4 * 1024 * 1024) {
      // formatos que o Windows não decodifica aqui (ex.: alguns WEBP): mostra o original
      preview = `data:${mime};base64,${(await readFile(path)).toString('base64')}`
    }
  }
  return { path, name: basename(path), size: st.size, kind, preview }
}

const EXT_IMAGEM: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/**
 * Ctrl+V de uma imagem copiada (print da tela, imagem do navegador, do WhatsApp...):
 * a tela manda os bytes e o sistema salva como arquivo para anexar na campanha.
 */
export async function savePastedImage(bytes: Uint8Array, mime: string): Promise<MediaInfo> {
  const ext = EXT_IMAGEM[mime]
  if (!ext) throw new Error('O que foi colado não é uma imagem. Use PNG, JPG ou WEBP.')
  if (bytes.length > LIMITE_MB.image * 1024 * 1024) throw new Error(`Imagem grande demais (limite de ${LIMITE_MB.image} MB).`)
  const dir = join(app.getPath('userData'), 'midias-coladas')
  await mkdir(dir, { recursive: true })
  const arquivo = join(dir, `imagem-colada-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`)
  await writeFile(arquivo, Buffer.from(bytes))
  return mediaInfo(arquivo)
}
