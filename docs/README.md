# Workspace MedConsultoria

Aplicação web **interna** da MedConsultoria — o cérebro operacional da empresa. Centraliza **CRM com funil inteligente**, projetos/kanban, agenda, financeiro, documentos (com **assinatura eletrônica** e IA), **e-mails transacionais**, comunicação interna, **Portal do Cliente/prospect** e observabilidade num só lugar, para acabar com a informação espalhada em WhatsApp/e-mail/planilhas.

> **Não é um SaaS.** Uso interno, hospedado em `https://workspace.medconsultoria.com.br`.

Este README é o ponto de entrada para desenvolvedores. Para entender o projeto a fundo, leia nesta ordem:

1. [`CLAUDE.md`](./CLAUDE.md) — fonte de verdade (visão, padrões, regras de negócio).
2. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — como o sistema é montado.
3. [`DATABASE.md`](./DATABASE.md) — modelagem de dados.
4. [`UI_GUIDELINES.md`](./UI_GUIDELINES.md) — design system.
5. [`ROADMAP.md`](./ROADMAP.md) — o que vem por fase.
6. [`DECISIONS.md`](./DECISIONS.md) — o porquê de cada escolha (ADRs).

---

## Stack

Monorepo (pnpm + Turborepo) · React + Vite + TS · TailwindCSS + shadcn/ui · tRPC + Fastify · Prisma + MySQL · Socket.IO. Detalhes em `CLAUDE.md §3`.

## Estrutura

```
apps/web       SPA React
apps/api       Fastify + tRPC + Socket.IO (o app deployável)
packages/db    Prisma schema + client
packages/shared  Zod schemas + tipos (compartilhados front/back)
packages/ui    Design system (tokens + shadcn temático)
docs/          Documentação do projeto
```

---

## Rodando localmente

> Pré-requisitos: Node (versão em `.nvmrc`), pnpm, MySQL local (ou Docker).

```bash
pnpm install                       # instala tudo no monorepo

cp .env.example .env               # configure DATABASE_URL, SESSION_SECRET
pnpm --filter @app/db prisma migrate dev   # cria o schema local
pnpm --filter @app/db prisma db seed       # cria o 1º usuário ROOT

pnpm dev                           # sobe web (Vite) + api (Fastify) em paralelo
```

- Web (dev): `http://localhost:4310`
- API/tRPC: `http://localhost:4319/trpc`

> Portas escolhidas (4310/4319 + MySQL 3307) para não colidir com outros projetos locais.

## Scripts principais

| Comando | O que faz |
|---------|-----------|
| `pnpm dev` | Web + API em modo desenvolvimento |
| `pnpm build` | Build de produção (gera `apps/api/dist` + `apps/web/dist`) |
| `pnpm typecheck` | TypeScript em todo o monorepo |
| `./deploy.sh` | Deploy por SSH para produção (ver `ARCHITECTURE.md §9`) |

> **Testes automatizados e lint estão configurados:** Vitest (serviços/procedures), Playwright para E2E (`pnpm test:e2e:isolado`, banco separado) e ESLint, com CI verde. Cada bug do `BUG_TRACKER.md` tem teste de regressão. A verificação de uma mudança é `pnpm typecheck` + `pnpm build` + a suíte de testes verdes, além de exercitar o fluxo real no navegador (manual ou via Playwright MCP).

---

## Convenções rápidas

- Idioma da UI: **PT-BR**. Código/identificadores em inglês/PT conforme o domínio, consistente.
- Commits: `feat/fix/refactor/docs/test(escopo): descrição`. Branch antes de commitar na `main`.
- TDD por padrão; verifique de verdade antes de dizer "pronto".
- Antes de codar, confirme o estado real via codebase-memory MCP (`get_architecture`, `search_graph`).

## Segurança

Dados sensíveis (PII de clientes, financeiro). **Default-deny**, isolamento rígido do Portal do Cliente, segredos só via `.env` (nunca commitados). Ver `ARCHITECTURE.md §11`. Módulos de auth/financeiro/portal passam por security-reviewer antes do merge.
