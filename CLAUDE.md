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

## Estado atual (2026-08-03)

- **NO AR em produção:** https://workspace.medconsultoria.com.br (TineHost, **LiteSpeed/lsnode** — não Passenger).
  SSH porta **1992**; startup `app.cjs`; restart = `touch tmp/restart.txt`. Deploy: `pnpm build:deploy` → `tar | ssh` → `prisma migrate deploy` + `generate` → restart. Chave SSH em `~/.ssh/medconsultoria_deploy`.
- **Tempo real = POLLING** (`refetchInterval`). A hospedagem **não faz WebSocket**; Socket.IO fica desligado no build de produção (religa com `VITE_REALTIME=1`). Fases 0–9 + evolução: **completas**.
- **Backup automático** do MySQL (cron diário) + **health-check/auto-restart** + **e-mail ao ROOT** quando o app cai (`scripts/server/`). SISTEMA tem aba **Operação** (ROOT).
- **Dados da empresa editáveis** (razão social/CNPJ/endereço/foro + marca) em Ajustes → Dados da empresa (ADMIN+).
- Confirmação em **100%** das ações destrutivas; CRUD completo em toda a app + Portal.
- **Contas do servidor:** `root@medconsultoria.com.br` (ROOT primordial, imutável — ADR-89) · `thiago.garcia@` e `andre.cintra@` (ROOTs nominais) · `thais.garcia@medconsultoria.com.br` (ADMIN).
- **Senha do 1º acesso é cobrada pela app** (ADR-91): conta interna que nunca definiu a própria senha cai numa página obrigatória depois do login. Cliente do Portal fica de fora.
- **Pendências do dono (só ele faz):** preencher dados jurídicos (Ajustes → Dados da empresa) · **rotacionar** a chave OpenAI + senha SMTP do `.env` do servidor · avaliar tirar `SEED_ROOT_NOME` do `.env` do servidor (hoje nomeia o root primordial de "Administrador").

## Onde está a verdade (ler nesta ordem)

0. `docs/LINKS.md` — **todos os links e portas** (localhost 4310 web / 4319 API / 3307 MySQL, produção, páginas públicas), como ligar/desligar a app local e o que é de OUTROS projetos. Escrito para leigo.
1. `docs/CLAUDE.md` — visão geral completa, papéis (RBAC), regras de negócio, índice de decisões.
2. `docs/ARCHITECTURE.md` → `docs/DATABASE.md` → `docs/UI_GUIDELINES.md` → `docs/ROADMAP.md`.
3. `docs/DECISIONS.md` — o **porquê** de cada escolha (ADR-1 … ADR-87). Deploy: `docs/DEPLOY.md`.
4. **Memória** (carrega sozinha): `MEMORY.md` + arquivos em `…/memory/`. Diretriz de trabalho: sempre criticar/recomendar (memória `criticar-e-recomendar`), nunca piloto automático.

## Regras rápidas

- Responder **sempre em PT-BR**. Testar envio de e-mail SÓ com `tibamooca@gmail.com` ou `contato@medconsultoria.com.br`.
- **Na 1ª tarefa do dia, SUBIR o localhost sem o dono pedir** (`node scripts/keep-alive.mjs`), conferir que 4310 e 4319 respondem e informar os links. O dono quer sempre poder ver a app ao vivo — ver `docs/LINKS.md`.
- Dev local: app SEMPRE no ar via `scripts/keep-alive.mjs`; para migrar Prisma use MODO PAUSA (`touch scripts/.keepalive-pause`). MySQL dev na porta 3307; web 4310 / API 4319.
- Fluxo: branch → commit → PR → CI verde → merge → deploy. Commit/push só quando fizer sentido; nunca na `main` direto.
