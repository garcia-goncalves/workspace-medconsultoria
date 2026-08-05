# CLAUDE.md — Workspace MedConsultoria (contexto de entrada)

> **Este arquivo é carregado automaticamente a cada sessão.** Ele é curto de propósito:
> dá o retrato atual e aponta para a documentação canônica. Mantenha-o enxuto e atualizado.

## O que é

**Cérebro operacional interno** da MedConsultoria (não é SaaS, não é multi-tenant, não será vendido).
Existe para reduzir o caos operacional da Thaís. Pergunta-guia de todo produto:
**"Como fazer a Thaís trabalhar com muito menos estresse?"**

Stack: monorepo pnpm+Turborepo · `apps/web` (Vite/React/TS/Tailwind + TanStack Router/Query) ·
`apps/api` (Fastify + **tRPC** + Prisma/MySQL) · `packages/{shared,db,ui}`. Um único processo Node
serve API (`/trpc`) + SPA + tempo real. Auth por cookie httpOnly assinado + argon2id.

## Estado atual (2026-08-05)

- **E-mail dentro da app — Blocos 1 e 2 COMPLETOS (`main`):** cada pessoa pluga a própria caixa IMAP em **`/email`**, lê e também **escreve, responde, responde a todos, encaminha e anexa** por SMTP real, sem sair do Workspace. Regra: **a caixa é privada, a correspondência com o cliente é da empresa**. Senha cifrada por `EMAIL_CRYPTO_KEY` (gerar no `.env` do servidor — sem ela o módulo fica desligado e o resto segue normal). **⚠️ Conferido em 05/08/2026: a chave NÃO está no servidor, então TODO o módulo de e-mail está desligado em produção** — a app no ar funciona normalmente, mas `/email` não pluga caixa e as ações 2D‑2/2D‑3 não aparecem lá até o dono gerar a chave (`scripts/server/set-email-crypto-key.sh`). Rascunho grava sozinho na pasta `Drafts` do servidor. Fora de produção só é permitido enviar para os 2 e-mails de teste do dono (trava em código, não disciplina). **A 2D‑1 põe a conversa na ficha do cliente e no painel do lead** (card "E-mails" = automáticos + caixas da equipe, com selo por origem): a equipe vê remetente, assunto, data e **trecho — nunca o corpo**; o dono tira um e-mail da ficha ("particular") e só ele o devolve, pela caixa. **2D‑2/2D‑3 (ADR-99): o e-mail vira trabalho** — o anexo recebido vira documento do cliente com um clique (`EmailAnexo.arquivoId`, campo que era morto) e o remetente desconhecido vira lead do funil. Guardar anexo é 1 clique quando a mensagem tem cliente único; sem vínculo (ou com vários), a tela pergunta qual. **Colega da casa nunca vira lead** e endereço do nosso domínio nunca acha cliente (trava do ADR-97 nas duas pontas). Clique repetido devolve o documento/lead que já existe — nada duplica. ADR-95/96/97/99.
- **Menu lateral em 4 grupos** (Meu trabalho · Negócio · Comunicação · Configuração, com Início solto no topo; **nunca rola** — encolhe por altura de tela, travado por `e2e/menu-sem-scroll.spec.ts`) e **derivado de `apps/web/src/lib/paginas.ts`** — nunca crie uma segunda lista de navegação: o teste `paginas.test.ts` reprova página nova que não escolha um grupo — ADR-94.

- **NO AR em produção:** https://workspace.medconsultoria.com.br (TineHost, **LiteSpeed/lsnode** — não Passenger).
  SSH porta **1992**; startup `app.cjs`; restart = `touch tmp/restart.txt`. Deploy: **`./deploy.sh`** (build → snapshot → `tar | ssh` → deps+Prisma **dentro do virtualenv** → ensaio de boot → restart → smoke test). Chave SSH em `~/.ssh/medconsultoria_deploy`. **App Root real:** `domains/workspace.medconsultoria.com.br/public_html` (a tabela do `docs/DEPLOY.md` §9 apontava pasta inexistente até 05/08). **Nunca use `rsync --delete` aqui:** apagaria o `.htaccess`, e sem ele o site não é servido. **`npm` só existe dentro do virtualenv** — sem `source .../activate`, o `install` falha calado e o app cai no boot com `ERR_MODULE_NOT_FOUND` (foi o que derrubou a produção por ~9 min em 05/08).
- **Tempo real = POLLING** (`refetchInterval`). A hospedagem **não faz WebSocket**; Socket.IO fica desligado no build de produção (religa com `VITE_REALTIME=1`). Fases 0–9 + evolução: **completas**.
- **Backup automático** do MySQL (cron diário) + **health-check/auto-restart** + **e-mail ao ROOT** quando o app cai (`scripts/server/`). SISTEMA tem aba **Operação** (ROOT).
- **Dados da empresa editáveis** (razão social/CNPJ/endereço/foro + marca) em Ajustes → Dados da empresa (ADMIN+).
- Confirmação em **100%** das ações destrutivas; CRUD completo em toda a app + Portal.
- **Contas do servidor:** `root@medconsultoria.com.br` (ROOT primordial, imutável — ADR-89) · `thiago.garcia@` e `andre.cintra@` (ROOTs nominais) · `thais.garcia@medconsultoria.com.br` (ADMIN).
- **Senha do 1º acesso é cobrada pela app** (ADR-91): conta interna que nunca definiu a própria senha cai numa página obrigatória depois do login. Cliente do Portal fica de fora.
- **Senha de desenvolvimento fora do repositório (ADR-98):** nem spec nem `demo-seed` guardam senha embutida; a fonte única é `SEED_ROOT_PASSWORD` no `.env` e o `playwright.config.ts` lê dela a senha dos e2e. Para trocar, `pnpm senha:rotacionar` — ele troca o valor **e reescreve o hash de quem ainda usa a senha atual** (o seed preserva senha de conta existente: reexecutá-lo não rotaciona nada). **Atenção ao mexer na trava:** em produção o banco também é `localhost`, então host não separa dev de prod — quem separa é o `NODE_ENV=production` do `.env`.
- **Pendências do dono (só ele faz):** preencher dados jurídicos (Ajustes → Dados da empresa) · **rotacionar** a chave OpenAI + senha SMTP do `.env` do servidor · **conferir em produção** se as 4 contas semeadas ainda aceitam a senha de dev que vazou (ADR-98; o `root@` primordial é o candidato, ninguém o usa para entrar).

## Onde está a verdade (ler nesta ordem)

0. `docs/LINKS.md` — **todos os links e portas** (localhost 4310 web / 4319 API / 3307 MySQL, produção, páginas públicas), como ligar/desligar a app local e o que é de OUTROS projetos. Escrito para leigo.
1. `docs/CLAUDE.md` — visão geral completa, papéis (RBAC), regras de negócio, índice de decisões.
2. `docs/ARCHITECTURE.md` → `docs/DATABASE.md` → `docs/UI_GUIDELINES.md` → `docs/ROADMAP.md`.
3. `docs/DECISIONS.md` — o **porquê** de cada escolha (ADR-1 … ADR-96). Deploy: `docs/DEPLOY.md`.
4. **Memória** (carrega sozinha): `MEMORY.md` + arquivos em `…/memory/`. Diretriz de trabalho: sempre criticar/recomendar (memória `criticar-e-recomendar`), nunca piloto automático.

## Regras rápidas

- Responder **sempre em PT-BR**. Testar envio de e-mail SÓ com `tibamooca@gmail.com` ou `contato@medconsultoria.com.br`.
- **`pnpm --filter @app/api test` NÃO é só unidade — ele MANDA E-MAIL REAL.** O `include` do Vitest varre também `src/test/*.integration.test.ts` (é assim de propósito: o CI roda a suíte inteira). Para unidade pura use **`pnpm --filter @app/api test:unit`**.
- **Na 1ª tarefa do dia, SUBIR o localhost sem o dono pedir** (`node scripts/keep-alive.mjs`), conferir que 4310 e 4319 respondem e informar os links. O dono quer sempre poder ver a app ao vivo — ver `docs/LINKS.md`.
- Dev local: app SEMPRE no ar via `scripts/keep-alive.mjs`; para migrar Prisma use MODO PAUSA (`touch scripts/.keepalive-pause`). MySQL dev na porta 3307; web 4310 / API 4319.
- Fluxo: branch → commit → PR → CI verde → merge → deploy. Commit/push só quando fizer sentido; nunca na `main` direto.
