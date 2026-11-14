import type { Fx } from './three/Scene3D'

/** Preferência de efeitos visuais deste computador (cada máquina escolhe a sua). */
const CHAVE = 'efeitos-visuais'

export function lerFx(): Fx {
  try {
    const v = localStorage.getItem(CHAVE)
    if (v === 'completo' || v === 'leve' || v === 'desligado') return v
  } catch {
    /* sem acesso ao armazenamento: usa o padrão */
  }
  return 'leve'
}

export function salvarFx(v: Fx): void {
  try {
    localStorage.setItem(CHAVE, v)
  } catch {
    /* ignora: vale só até fechar o app */
  }
}
