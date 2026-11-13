import { useEffect, useState } from 'react'
import type { Settings, WaStatus } from '@shared/types'
import { useAction } from '../lib'

export default function Conexao({ wa }: { wa: WaStatus }) {
  const run = useAction()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [cloud, setCloud] = useState({ token: '', phoneNumberId: '', apiVersion: 'v21.0' })

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setSettings(s)
      setCloud(s.cloud)
    })
  }, [])

  if (!settings) return null
  const provider = settings.provider

  const switchProvider = async (p: Settings['provider']) => {
    const s = await run(() => window.api.settings.save({ provider: p }))
    if (s) setSettings(s)
  }

  const saveCloud = async () => {
    const s = await run(() => window.api.settings.save({ cloud }))
    if (s) {
      setSettings(s)
      await run(() => window.api.wa.connect())
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Conexão</h1>
          <p>Escolha como o sistema vai se conectar ao WhatsApp.</p>
        </div>
      </header>

      <div className="tabs">
        <button className={provider === 'baileys' ? 'active' : ''} onClick={() => switchProvider('baileys')}>
          QR Code (WhatsApp / Business)
        </button>
        <button className={provider === 'cloud' ? 'active' : ''} onClick={() => switchProvider('cloud')}>
          API Oficial (Meta Cloud)
        </button>
      </div>

      {provider === 'baileys' ? (
        <div className="grid-2">
          <section className="card glass qr-card">
            <div className={`qr-frame ${wa.state}`}>
              {wa.state === 'qr' && wa.qr ? (
                <img src={wa.qr} alt="QR Code" />
              ) : wa.state === 'connected' ? (
                <div className="qr-ok">✓</div>
              ) : wa.state === 'connecting' ? (
                <div className="spinner" />
              ) : (
                <div className="qr-empty">QR</div>
              )}
              <span className="scanline" />
            </div>
            <div className="qr-info">
              {wa.state === 'connected' ? (
                <>
                  <h2>Conectado</h2>
                  <p>
                    {wa.name && <b>{wa.name} </b>}
                    {wa.me && <span>+{wa.me}</span>}
                  </p>
                  <div className="row">
                    <button className="btn" onClick={() => run(() => window.api.wa.disconnect())}>
                      Desconectar
                    </button>
                    <button
                      className="btn danger"
                      onClick={() =>
                        confirm('Encerrar a sessão? Será necessário ler o QR Code de novo.') &&
                        run(() => window.api.wa.logout(), 'Sessão encerrada')
                      }
                    >
                      Sair da conta
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2>{wa.state === 'qr' ? 'Leia o QR Code' : 'Conectar WhatsApp'}</h2>
                  <ol>
                    <li>Abra o WhatsApp no celular</li>
                    <li>
                      Toque em <b>Mais opções ⋮</b> ou <b>Configurações</b> → <b>Aparelhos conectados</b>
                    </li>
                    <li>
                      Toque em <b>Conectar um aparelho</b> e aponte para esta tela
                    </li>
                  </ol>
                  {wa.error && <p className="error">{wa.error}</p>}
                  {wa.state === 'disconnected' && (
                    <button className="btn primary" onClick={() => run(() => window.api.wa.connect())}>
                      Gerar QR Code
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
          <section className="card glass">
            <h3>Sobre esta conexão</h3>
            <p className="muted">
              Funciona com WhatsApp comum ou Business, igual ao WhatsApp Web. A sessão fica salva neste computador e
              reconecta sozinha ao abrir o sistema.
            </p>
            <div className="tip warn">
              ⚠ Conexões não oficiais podem ter o número bloqueado pelo WhatsApp se houver muitas denúncias. Use um
              número dedicado, aqueça o chip aos poucos e envie apenas para contatos que pediram para receber.
            </div>
          </section>
        </div>
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
              {wa.state === 'connected' && <span className="ok">✓ Conectado {wa.name && `— ${wa.name}`}</span>}
            </div>
            {wa.error && <p className="error">{wa.error}</p>}
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
    </div>
  )
}
