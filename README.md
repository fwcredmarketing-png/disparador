# Sistema de Disparo — WhatsApp

Aplicativo desktop (Windows) para disparo de mensagens no WhatsApp, com interface 3D e
atualização automática pelo GitHub.

## Tecnologias

| Camada | Tecnologia |
|---|---|
| App desktop | **Electron** |
| Linguagem | **TypeScript** (todo o projeto) |
| Interface | **React** + **Three.js** (`@react-three/fiber`, `drei`) para o 3D |
| WhatsApp (QR Code) | **Baileys**: conexão direta por WebSocket, sem navegador embutido |
| WhatsApp (oficial) | **Meta WhatsApp Cloud API** |
| Build | **electron-vite** (Vite) + **electron-builder** (instalador NSIS) |
| Atualizações | **electron-updater** + **GitHub Releases** + **GitHub Actions** |

## Funcionalidades

- **Painel 3D**: um globo interativo que reage a cada envio, KPIs e um gráfico de barras 3D dos últimos 7 dias.
- **Conexão**: por QR Code (WhatsApp comum ou Business) ou pela API oficial da Meta. A sessão fica salva e reconecta sozinha.
- **Contatos**: importação de CSV/TXT (`nome;telefone;tags`), cadastro manual, etiquetas, busca, e o +55 é adicionado automaticamente.
- **Campanhas**:
  - variáveis `{nome}` e `{primeiro_nome}`, mais spintax `{Olá|Oi|E aí}`;
  - envio de mídia (imagem, vídeo, áudio, PDF);
  - intervalo aleatório entre envios, lotes com pausa e limite diário;
  - pausar, continuar e cancelar, com log em tempo real e relatório em CSV.
- **Descadastro automático**: quem responder "SAIR" ou "PARAR" deixa de receber (as palavras são configuráveis).
- **Segurança**: o token da API é criptografado (Windows DPAPI), e a sessão e os dados ficam só no computador. Nada disso vai para o GitHub.

## Desenvolvimento (VS Code)

Pré-requisitos: [Node.js 22+](https://nodejs.org) e [Git](https://git-scm.com).

```bash
npm install          # instala as dependências (apenas na primeira vez)
npm run dev          # abre o sistema em modo desenvolvimento, com hot reload
npm run typecheck    # verifica erros de TypeScript
npm run dist         # gera o instalador local em dist/ (sem publicar)
```

No VS Code também dá para apertar **F5** e escolher "Rodar Sistema (dev)".

### Estrutura

```
src/
  main/              Processo principal (Node.js)
    index.ts           janela, IPC, inicialização
    store.ts           banco local em JSON (pasta AppData)
    campaign.ts        motor de disparo (fila, intervalos, lotes, limites)
    updater.ts         atualização automática via GitHub
    utils.ts           telefone, spintax, leitura de CSV
    whatsapp/
      baileys.ts       conexão por QR Code
      cloud.ts         API oficial da Meta
      manager.ts       troca entre os provedores
  preload/           Ponte segura entre a interface e o Node
  renderer/          Interface React
    src/three/         cenas 3D (globo e barras)
    src/pages/         Painel, Conexão, Contatos, Campanhas, Configurações
  shared/types.ts    Tipos compartilhados
.github/workflows/   CI e publicação automática
```

## Repositório

- Código: https://github.com/fwcredmarketing-png/disparador (público, para a atualização automática funcionar sem token)
- Instaladores: https://github.com/fwcredmarketing-png/disparador/releases

> **Nunca** coloque senhas, tokens ou chaves secretas no código: o repositório e os instaladores são públicos.
> O workflow de Release já declara a permissão de escrita de que precisa (`permissions: contents: write`).

## Fluxo de atualização (o dia a dia)

```
Editar no VS Code  →  commit + push  →  npm run lancar-versao
                                          │
                     GitHub Actions gera o instalador e publica a Release
                                          │
         Os computadores com o sistema baixam a atualização sozinhos
         e mostram o botão "Atualizar para vX.Y.Z"
```

1. Faça as alterações e envie normalmente (`git add . && git commit -m "..." && git push`).
2. Quando quiser liberar para os usuários:

```bash
npm run lancar-versao          # 1.0.0 → 1.0.1 (correções)
npm run lancar-versao:minor    # 1.0.1 → 1.1.0 (novidades)
```

   O comando aumenta a versão, cria a tag `vX.Y.Z` e envia para o GitHub.
3. Acompanhe a aba **Actions** no GitHub. Em cerca de 5 minutos a Release aparece com o instalador `SistemaDeDisparo-Setup-X.Y.Z.exe`.
4. **Primeira instalação** em cada computador: baixe o `.exe` na página de Releases e instale. Depois disso as atualizações são automáticas: o app verifica ao abrir e a cada 30 minutos.

> O Windows pode mostrar "O Windows protegeu o computador" porque o instalador não tem
> assinatura digital. Clique em **Mais informações → Executar assim mesmo**. Para remover
> esse aviso, é preciso comprar um certificado de assinatura de código.

### Repositório privado

O electron-updater consegue ler Releases privadas, mas para isso o token do GitHub
precisaria ir dentro do instalador, e qualquer pessoa com o `.exe` poderia extraí-lo.
A alternativa recomendada é usar **dois repositórios**: o código no privado e as Releases
em um público (com `owner`/`repo` desse repositório público em `electron-builder.yml`
e um token pessoal no secret `GH_TOKEN` do workflow).

## Boas práticas de envio

- Envie apenas para contatos que **autorizaram** receber mensagens (LGPD).
- A conexão por QR Code não é oficial. Muitas denúncias ou volume alto num número novo levam a **bloqueio**.
  Use um número dedicado, aqueça o chip aos poucos (30 a 50 mensagens por dia no começo) e use intervalos longos e variações de texto.
- Para alto volume e sem risco de bloqueio, use a **API oficial** com templates aprovados pela Meta.

## Onde ficam os dados

`%APPDATA%\Sistema de Disparo\`
- `dados.json`: contatos, campanhas e configurações
- `wa-auth\`: sessão do WhatsApp (para desconectar, apague essa pasta ou use "Sair da conta")
