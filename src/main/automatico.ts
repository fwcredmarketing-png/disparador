import { campaigns } from './repo'
import { auth } from './supabase'
import type { CampaignEngine } from './campaign'
import type { WhatsAppManager } from './whatsapp/manager'

/**
 * Campanhas criadas pelo FW Cred (sistema de lotes) começam sozinhas.
 * A cada 30 s, se este computador está logado, com WhatsApp conectado e sem campanha em andamento,
 * ele assume a campanha do FW Cred mais antiga que está esperando. A trava do banco (assumir_campanha)
 * garante que só um computador envia cada uma; intervalos, limite diário e descadastro continuam valendo.
 * Se uma campanha não puder começar (ex.: a mensagem usa {link} sem link cadastrado), o motivo fica
 * anotado nela e este computador não tenta de novo até o app reiniciar.
 */
export function iniciarCampanhasDoFwCred(engine: CampaignEngine, wa: WhatsAppManager): void {
  const puladas = new Set<string>()
  let verificando = false

  const verificar = async (): Promise<void> => {
    if (verificando || auth.current.state !== 'signedIn' || engine.running || !wa.isConnected()) return
    verificando = true
    try {
      const id = await campaigns.nextAutomatic(puladas)
      if (!id) return
      try {
        await engine.start(id)
      } catch (e) {
        puladas.add(id)
        await campaigns.setNote(id, `Não começou sozinha: ${(e as Error).message}`).catch(() => {})
      }
    } catch {
      /* sem conexão com o banco agora: tenta na próxima volta */
    } finally {
      verificando = false
    }
  }

  setTimeout(() => void verificar(), 10_000)
  setInterval(() => void verificar(), 30_000)
}
