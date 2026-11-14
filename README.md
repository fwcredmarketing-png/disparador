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
| Banco de dados | **Supabase** (Postgres + login + Storage), protegido por RLS |
| Atualizações | **electron-updater** + **GitHub Releases** + **GitHub Actions** |

## Funcionalidades

- **Painel 3D**: um globo interativo que reage a cada envio, KPIs e um gráfico de barras 3D dos últimos 7 dias.
- **Conexão**: por QR Code (WhatsApp comum ou Business) ou pela API oficial da Meta. A sessão fica salva e reconecta sozinha.
- **Contatos**: importação de CSV/TXT (`nome;telefone;tags`), cadastro manual, etiquetas, busca, e o +55 é adicionado automaticamente.
- **Campanhas**:
  - variáveis `{nome}`, `{primeiro_nome}` e `{link}` (link de autocontratação da equipe, cadastrado pelo
    administrador em Configurações), mais spintax `{Olá|Oi|E aí}`;
  - anexo de imagem, vídeo, áudio ou PDF: botão, arrastar o arquivo ou colar com Ctrl+V, com prévia no
    balão do WhatsApp (o texto vai como legenda);
  - intervalo aleatório entre envios, lotes com pausa e limite diário;
  - pausar, continuar e cancelar, com log em tempo real e relatório em CSV.
- **Descadastro automático**: quem responder "SAIR" ou "PARAR" deixa de receber (as palavras são configuráveis).
- **Equipe**: login por e-mail e senha; contatos, campanhas e relatórios são compartilhados entre todos os computadores.
  Uma trava garante que cada campanha seja enviada por um computador só; se ele parar de responder, outro pode assumir.
- **Segurança**: só quem está logado **e** foi liberado na equipe acessa o banco (RLS). A sessão do WhatsApp e o
  token da API da Meta ficam em cada computador, criptografados (Windows DPAPI). Nada disso vai para o GitHub.

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
    config.ts          endereço e chave PÚBLICA do Supabase
    supabase.ts        conexão com o banco e login da equipe
    repo.ts            consultas ao banco (contatos, campanhas, equipe, mídias)
    settings.ts        configurações (equipe no banco + deste computador)
    store.ts           dados deste computador (conexão do WhatsApp, sessão de login)
    campaign.ts        motor de disparo (fila, intervalos, lotes, limites, trava)
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
supabase/migrations/ Estrutura do banco (SQL), aplicada uma vez no Supabase
.github/workflows/   CI e publicação automática
```

## Banco de dados (Supabase)

A estrutura está em [supabase/migrations/](supabase/migrations/). Para mudar o banco no futuro,
crie um novo arquivo `003_...sql` e rode no **SQL Editor** do Supabase.

**Liberar uma pessoa na equipe** (são dois passos):

1. No Supabase: **Authentication → Users → Add user → Create new user**, com o e-mail e uma senha
   (marque **Auto Confirm User**).
2. No sistema, logado como administrador: **Configurações → Equipe → Liberar acesso** com o mesmo e-mail.

Quem tem usuário mas não foi liberado na equipe não consegue ver nada.
Recomendado: em **Authentication → Sign In / Providers**, desligue **Allow new users to sign up**.

> Em [src/main/config.ts](src/main/config.ts) vai somente a chave **pública** (anon/publishable).
> **Nunca** coloque no código a senha do banco nem a chave secreta (`service_role` / `sb_secret_...`).

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
3. Acompanhe a aba **Actions** no GitHub. Em cerca de 5 minutos a Release aparece com o instalador `SistemaDeDisparo-Setup-X.Y.Z.exe`, e o link `/baixar` da Vercel já passa a entregar a versão nova.
4. **Primeira instalação** em cada computador: abra https://disparador-fwcred.vercel.app/baixar e instale. Depois disso as atualizações são automáticas: o app verifica ao abrir e a cada 30 minutos.

### Página de download e atualizações (Vercel)

- **Link para instalar:** https://disparador-fwcred.vercel.app/baixar (sempre a versão mais recente)
- **Página:** https://disparador-fwcred.vercel.app

A pasta [site/](site/) roda na Vercel (projeto `disparador-fwcred`). Ela entrega o instalador e os
arquivos de atualização (`/atualizacoes/latest.yml`) lendo o GitHub Releases pela **API do GitHub**.
O app instalado procura atualizações nesse endereço (`UPDATE_URL` em [src/main/config.ts](src/main/config.ts)).

Novas versões não exigem mexer na Vercel. Só se você alterar a pasta `site/`, publique de novo:

```bash
cd site
npx vercel deploy --prod
```

Opcional: em vercel.com → projeto → **Settings → Environment Variables**, crie `GITHUB_TOKEN` com um token
do GitHub **somente leitura** para aumentar o limite de consultas à API.

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

- **No Supabase** (compartilhado pela equipe): contatos, campanhas, envios, configurações de envio, equipe e mídias.
- **Em cada computador** (`%APPDATA%\Sistema de Disparo\`):
  - `local.json`: tipo de conexão, token da API da Meta (criptografado) e sessão de login (criptografada)
  - `wa-auth\`: sessão do WhatsApp (para desconectar, use "Sair da conta" na tela Conexão)
  - `midias-cache\`: cópia local das mídias das campanhas
