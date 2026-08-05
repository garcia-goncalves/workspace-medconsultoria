# Workspace MedConsultoria

**Cérebro operacional interno da MedConsultoria.** Não é SaaS, não é multi-tenant e não será
vendido: existe para reduzir o caos operacional da empresa. No ar em
**https://workspace.medconsultoria.com.br**.

Monorepo pnpm + Turborepo: `apps/web` (Vite + React + TypeScript + Tailwind, TanStack
Router/Query) · `apps/api` (Fastify + tRPC + Prisma/MySQL) · `packages/{shared,db,ui}`. Um único
processo Node serve a API (`/trpc`), o SPA e o tempo real. Autenticação por cookie httpOnly
assinado + argon2id.

## Rodar na sua máquina

Precisa de **Node 20+**, **pnpm 10** e **Docker** (para o MySQL).

```bash
pnpm install
cp .env.example .env      # depois preencha as variáveis obrigatórias (veja abaixo)
pnpm db:up                # sobe o MySQL na porta 3307
pnpm db:migrate           # cria as tabelas
pnpm db:seed              # cria as contas da equipe e as etapas do funil
pnpm dev                  # web em 4310, API em 4319
```

Abra **http://localhost:4310**. Para conferir que o servidor subiu:
**http://localhost:4319/health** deve responder `{"status":"ok"}`.

Em desenvolvimento o normal é deixar o supervisor no ar em vez do `pnpm dev` cru — ele re-sobe a
aplicação se ela cair:

```bash
node scripts/keep-alive.mjs
```

Para mexer na estrutura do banco, **pause o supervisor** em vez de matar o processo:
`touch scripts/.keepalive-pause` → migrar → `rm scripts/.keepalive-pause`.

**Dados de exemplo** (clientes, projetos e conversas fictícios) são opcionais: `pnpm db:demo`.
Ele tem trava e recusa rodar contra banco que não seja local.

### Variáveis obrigatórias

O `.env.example` lista todas. As que impedem a aplicação de subir se faltarem:
`DATABASE_URL`, `SESSION_SECRET` e `SEED_ROOT_PASSWORD` (a senha inicial das contas semeadas).
`EMAIL_CRYPTO_KEY` só é exigida pelo módulo de e-mail — sem ela, o resto funciona e `/email`
fica desligado. **Senha e chave nunca são escritas em documento nenhum deste repositório**
(ADR-98); para trocar a senha de desenvolvimento use `pnpm senha:rotacionar`.

## Comandos do dia a dia

| Comando | O que faz |
| --- | --- |
| `pnpm dev` | sobe web + API em modo desenvolvimento |
| `pnpm test` | testes de unidade de todos os pacotes |
| `pnpm --filter @app/api test:unit` | só unidade da API — **`test` (sem `:unit`) envia e-mail real** |
| `pnpm test:e2e:isolado` | testes de tela em banco próprio, sem sujar o de desenvolvimento |
| `pnpm run typecheck` · `pnpm lint` | verificação de tipos · lint |
| `pnpm acessos` | diagnóstico "por que não consigo entrar?" |
| `pnpm senha:rotacionar` | troca a senha de seed desta máquina e reescreve o hash das contas |
| `pnpm doutor` | varredura de saúde da aplicação em navegador real |
| `pnpm build:deploy` | empacota para produção |

## Documentação

Leia nesta ordem — a documentação é a fonte da verdade, e é mantida atualizada:

1. **[`docs/LINKS.md`](docs/LINKS.md)** — todos os links e portas, escrito para quem não é técnico.
2. **[`docs/CLAUDE.md`](docs/CLAUDE.md)** — visão geral, papéis (RBAC), regras de negócio.
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) → [`docs/DATABASE.md`](docs/DATABASE.md) →
   [`docs/UI_GUIDELINES.md`](docs/UI_GUIDELINES.md) → [`docs/ROADMAP.md`](docs/ROADMAP.md).
4. **[`docs/DECISIONS.md`](docs/DECISIONS.md)** — o **porquê** de cada escolha (ADR-1 … ADR-98).
5. [`docs/DEPLOY.md`](docs/DEPLOY.md) — como sobe para produção.

`CLAUDE.md` (raiz) é o retrato curto do estado atual, carregado por quem trabalha com assistente
de IA no repositório.

## Contribuir

Fluxo: branch → commit → PR → CI verde → merge. Commits em `tipo(escopo): descrição`, mensagem em
português explicando o **porquê**. Toda regra de negócio, cálculo, validação e correção de bug
nasce com teste. Ao mudar uma decisão, registre em `docs/DECISIONS.md` e atualize a documentação
que ficou desatualizada na mesma leva.
