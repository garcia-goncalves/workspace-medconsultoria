# Plano de Limpeza de Dados de Teste (Bloco 5)

> **⚠️ SUPERADO (2026-07-26).** Este documento é um registro PRÉ-DEPLOY — e este plano em
> particular já foi **totalmente executado** (Etapas 1-4, ver §6). O app já está **em
> produção** em https://workspace.medconsultoria.com.br (TineHost/LiteSpeed-lsnode; tempo real
> por polling; backup automático ativo). Estado atual e decisões: ver `/CLAUDE.md` e
> `docs/DECISIONS.md` (ADR-84..87). Mantido abaixo como histórico.

> **Status: CONCLUÍDO (Etapas 1-4 executadas).**
> ~~PLANO — NADA FOI EXECUTADO.~~ As quatro etapas do plano abaixo foram executadas, a
> destrutiva (Etapa 3) com autorização explícita do dono e dump prévio — ver §6.
>
> Levantamento: 2026-07-20 · main `38eabd2`

---

## 1. Diagnóstico (medido, não estimado)

### 1.1 Volume atual no banco de **desenvolvimento** (`medconsultoria` @ 3307)

Contagem real feita por script somente-leitura em 2026-07-20:

| Tabela | Total | Marcados como teste (`E2E`/`Guard` no nome) | % sujo (mín.) |
|---|---:|---:|---:|
| `servico` | 21 | 11 | **52%** |
| `cliente` | 25 | 12 | **48%** |
| `lead` | 61 | 14 | 23% |
| `conversa` (chamados) | 33 | 12 | 36% |
| `documento` | 35 | 13 | 37% |
| `conta` (financeiro) | 79 | 13 | 16% |
| `projeto` | 14 | — | — |
| `evento` | 50 | — | — |
| `user` | 22 | — | — |
| `arquivo` | 22 | — | — |

> Os números da coluna "marcados" são o **piso**, não o teto: só contam registros cujo
> nome/título/assunto contém literalmente `E2E` ou `Guard`. Dados criados na validação
> manual (nomes como "Teste", "Cliente Auditoria", emojis) e dados demo (Clínica Bem
> Estar, Hospital Santa Luz…) não entram nessa conta.

### 1.2 Causa-raiz (3 achados)

**Achado A — a suíte E2E local escreve no MESMO banco que você usa.**
`scripts/e2e-fixtures.mjs` lê `DATABASE_URL` do `.env` da raiz. Localmente isso aponta
para `medconsultoria` — o banco que você abre no navegador. Na CI é um container
efêmero (isolado, morre no fim do job). Ou seja: **a poluição é exclusivamente local.**

**Achado B — parte dos specs cria dados não-idempotentes.**
As *fixtures* (`scripts/e2e-fixtures.mjs`) usam ids fixos e se auto-limpam — corretas.
Mas vários **specs** criam registros com nome carimbado por timestamp, ex.:

```ts
const RUN = `SVC${Date.now().toString().slice(-6)}`;  // e2e/flows-servicos.spec.ts
const NOME = `Serviço E2E ${RUN}`;                    // nunca é apagado no fim
```

Cada execução da suíte deixa um novo resíduo. Isso explica os 11 serviços `E2E`/`Guard`.

**Achado C — parte do resíduo é VISÍVEL PARA O CLIENTE no Portal.**
Os chamados e serviços de teste aparecem na interface do Portal do cliente. Hoje isso
é inofensivo (ambiente de dev), mas é exatamente o que não pode sobrar num banco real.

### 1.3 O que está CORRETO hoje (verificado, não mexer)

- ✅ **Demo não roda em produção.** `deploy.sh` executa **só** `prisma migrate deploy`.
  `pnpm db:demo` só é invocado manualmente e no CI (banco efêmero). `docs/DEPLOY.md`
  instrui explicitamente a não rodar demo em produção.
- ✅ **Testes unitários/integração são isolados**: usam `medconsultoria_test`,
  banco separado.
- ✅ **`seed.ts` é essencial e seguro**: cria apenas o usuário ROOT a partir de
  `SEED_ROOT_*` do `.env`. Deve continuar existindo.

### 1.4 Riscos remanescentes (a corrigir no plano)

| # | Risco | Gravidade |
|---|---|---|
| R1 | `demo-seed.ts` **não tem trava de produção** — se alguém rodar `pnpm db:demo` apontando para o banco real, insere clientes fictícios e usuários com senha padrão `medconsultoria123` | 🔴 Alta |
| R2 | Os **estágios do funil** (`PipelineStage`) nascem no `demo-seed`, não no `seed.ts`. Num banco limpo "de verdade", a tela de Vendas nasce **sem colunas** | 🟠 Média |
| R3 | Specs deixam lixo acumulando no banco local a cada rodada | 🟡 Baixa (dev) |

---

## 2. Plano proposto — 4 etapas, da mais segura à destrutiva

### Etapa 1 — Blindagem ✅ **EXECUTADA** (não destrutiva)

1. **Trava de produção no `demo-seed.ts`**: aborta se `NODE_ENV=production` ou se a
   `DATABASE_URL` não for reconhecidamente local/CI, exigindo `DEMO_SEED_CONFIRMO=1`
   para prosseguir. Resolve **R1**.
2. **Mover config essencial para o `seed.ts`**: `PipelineStage` (Novo → Qualificação →
   Proposta → Negociação → Fechado) passa a ser semeado como **estrutura**, idempotente,
   junto do ROOT. O `demo-seed` deixa de ser pré-requisito para o funil funcionar.
   Resolve **R2**.
3. Teste automatizado cobrindo as duas travas.

> Impacto: **zero registro apagado**. Só código + testes.

**Resultado (verificado ao vivo):**

| Verificação | Resultado |
|---|---|
| `pnpm db:demo` com `DATABASE_URL` remota | 🚫 `demo-seed BLOQUEADO: banco remoto (…)` |
| `pnpm db:demo` com `NODE_ENV=production` | 🚫 `demo-seed BLOQUEADO: NODE_ENV=production` |
| `pnpm db:seed` local (2ª vez) | ✅ `Usuário ROOT pronto` + `Etapas do funil já existem (5) — mantidas` |
| Testes | ✅ 7 novos (`seed-guard.test.ts`); suíte da API 58/58 |

Código: `packages/db/src/seed-guard.ts` (função pura `podeRodarDemoSeed`) e
`packages/db/src/seed-config.ts` (`STAGE_DEFAULTS`), exportados por `@app/db`.

### Etapa 2 — Banco de teste próprio para o E2E local ✅ **EXECUTADA** (não destrutiva)

Novo comando **`pnpm test:e2e:isolado`** (`scripts/e2e-isolado.mjs`): sobe uma **segunda
instância** do app (web 4410 / api 4419) apontada para o banco **`medconsultoria_e2e`**,
roda o Playwright contra ela e derruba tudo no fim. O `pnpm dev` de sempre (4310/4319,
banco de desenvolvimento) continua no ar, intocado.

O script **nunca escreve no `.env`** — passa tudo por variável de ambiente aos processos
filhos (o `dotenv` do app não sobrescreve o que já está em `process.env`).

**Prova de isolamento (execução real):**

| Medida | Antes | Depois |
|---|---:|---:|
| `Servico` com `E2E`/`Guard` no **banco de dev** | 11 | **11** (inalterado) |
| `Servico` com `E2E`/`Guard` no **banco `medconsultoria_e2e`** | — | 3 |
| Resultado do Playwright | — | `passed` |

Antes desta etapa, a mesma execução teria somado +2 serviços ao banco de desenvolvimento.
Resolve **R3** na raiz — não depende de os specs se comportarem.

> Impacto: **zero registro apagado**. Banco `medconsultoria_e2e` criado do zero via
> `migrate deploy` (`CREATE DATABASE IF NOT EXISTS` — nunca dropa nada).

### Etapa 3 — `db:demo:clean` (**destrutiva, escopo fechado e reversível**)

Script novo `pnpm db:demo:clean` que remove **apenas** o que é comprovadamente resíduo,
por **lista fechada de critérios** (nunca "apagar tudo"):

- registros cujo nome/título/assunto casa com `E2E` ou `Guard` + carimbo de execução;
- os ids fixos das fixtures (`e2e*`);
- os registros exatos criados pelo `demo-seed` (clientes/leads/contas/eventos daquele
  arquivo, identificados pelos e-mails e nomes literais que ele usa).

Garantias obrigatórias do script:
- **Dry-run por padrão** (`--dry` lista o que apagaria e sai). Só apaga com `--apply`.
- **Dump automático antes** de qualquer `DELETE` (`mysqldump` para `backups/`), para
  reverter. É isso que torna a operação reversível.
- **Idempotente** — rodar duas vezes não quebra.
- **Nunca toca em**: migrations, schema, usuário ROOT, catálogos reais, ou qualquer
  registro fora da lista de critérios.

> Impacto: apaga dados de teste do banco **de desenvolvimento**. Nunca é apontado para
> produção (herda a mesma trava da Etapa 1).

### Etapa 4 — Bootstrap de banco limpo ✅ **EXECUTADA** (não destrutiva)

Comando **`pnpm verificar:bootstrap`** (`scripts/verificar-bootstrap.mjs`): cria um banco
vazio (`medconsultoria_bootstrap`), aplica **apenas** `migrate deploy` + `db:seed`
(**sem nenhum `db:demo`** — exatamente o que produção fará), sobe o app contra ele e
verifica por **HTTP real**. É o ensaio do que acontecerá quando o banco de produção existir.

**Resultado — 10/10 verificações:**

```
✓ login do ROOT funciona — HTTP 200
✓ funil de Vendas nasce com as 5 etapas — 5 etapas      ← regressão do R2
✓ página Vendas responde autenticada — HTTP 200
✓ sem dado fictício em Cliente/Lead/Projeto/Conta/Documento/Conversa — 0 registros
✓ apenas o usuário ROOT existe — 1 usuários
✓ banco limpo abre UTILIZÁVEL e VAZIO — ensaio de produção aprovado.
```

A senha do ROOT vem do `.env` e **nunca é impressa**. O `.env`, o banco de desenvolvimento
e o banco de E2E **não são tocados** — o ensaio usa banco e portas próprios (4420/4429).

---

## 3. O que eu **não** vou fazer sem sua ordem expressa (histórico — DECIDIDO/EXECUTADO, ver §6)

- Apagar qualquer coisa antes do seu "pode executar".
- Rodar a Etapa 3 sem dump prévio.
- Apontar qualquer script para banco de produção.
- Remover fixtures usadas pelos testes (elas continuam; só passam a viver em banco próprio).
- Substituir dados demo por conteúdo institucional inventado — isso é o Bloco 6 e
  depende de você fornecer o conteúdo real (ver §7.2 do `AUDITORIA_FUNCIONAL_COMPLETA.md`).

---

## 4. Decisão que eu preciso de você — **DECIDIDO: Opção B, executada (ver §6)**

As Etapas **1, 2 e 4 já foram executadas** — todas não destrutivas, nenhum registro apagado.
Faltava só a **Etapa 3** (`db:demo:clean`/`db:limpar`), a única que apaga dados:

| Opção | O que executo |
|---|---|
| A — Parar por aqui | Nada mais. O banco de dev fica sujo como está, mas **não piora mais** (Etapa 2 impede). |
| **B — Executar a Etapa 3** (recomendado) ✅ **ESCOLHIDA** | `db:limpar` com dry-run + dump automático, lista do que seria apagado, e só então aplicado — com autorização do dono. |

~~Enquanto não houver decisão, a Etapa 3 não é executada.~~ Decidido e executado em 2026-07-20
(§6).

---

## 5. Situação atual (2026-07-20)

| Risco | Status |
|---|---|
| R1 — `demo-seed` sem trava de produção | ✅ **fechado** (PR #21) |
| R2 — funil nasce sem colunas em banco limpo | ✅ **fechado** (PR #21, provado pelo ensaio da Etapa 4) |
| R3 — E2E local sujando o banco de dev | ✅ **fechado** (PR #22) |
| Resíduo já existente no banco de dev | ⏳ **aguarda sua decisão** (Etapa 3) |

---

## 6. Etapa 3 — EXECUTADA (2026-07-20), com autorização do dono

Comando **`pnpm db:limpar`** (`scripts/limpar-dados.ts`):
`pnpm db:limpar` = **dry-run** (só lista) · `pnpm db:limpar --apply` = dump + apaga.

Herda a mesma trava do `demo-seed` (`podeRodarDemoSeed`): **nunca roda contra produção**.

### Resultado real

- **Dump de segurança automático antes de apagar:** `backups/medconsultoria-antes-da-limpeza-*.sql`
  (932 KB). `backups/` entrou no `.gitignore` — dump pode conter dados reais.
- **3.282 registros apagados.**
- **2ª execução: 0 registros** → o script é **idempotente**.

| Depois da limpeza | |
|---|---:|
| clientes · leads · projetos · contas · documentos · conversas · eventos | **0** |
| usuários | **1** (só o ROOT) |
| serviços reais | 10 |
| etapas do funil | 5 |
| modelos de documento | 19 |
| operadoras · origens | 9 · 9 |
| categorias da EMPRESA | 5 |

### Verificação ao vivo no navegador (banco limpo)

Login ROOT → **10 páginas** percorridas (Início, Vendas, Clientes, Projetos, Agenda, Mensagens,
Documentos, Financeiro, Ajustes, Serviços, Modelos): **zero erro de carga, zero overflow**, e
todas com **estado vazio bem escrito** — "Tudo em dia por aqui", "Nenhuma conversa ainda.
Clique em + para começar", contadores em 0. Nenhum vestígio de dado de teste.

### Reverter, se preciso

```
docker exec -i medconsultoria-mysql mysql -uroot -proot < backups/<arquivo>.sql
```
