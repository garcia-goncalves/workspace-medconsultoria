# API do agente (`/api/agent/v1`) — como a Cora fala com o Workspace

> **Decisão e porquês:** ADR-149 em `docs/DECISIONS.md`.
> **Contrato canônico:** `med-coordination/contracts/workspace-agent-v1.openapi.yaml`, versão **0.1.0**
> (experimental), com o SHA-256 ao lado. **Este arquivo explica como operar; o contrato manda.**

## O que é, em uma frase

Uma porta HTTP versionada, fora do tRPC, por onde um **serviço** externo (hoje a assistente **Cora**) lê dado
do Workspace **em nome de uma pessoa**, com credencial que expira e pode ser cortada.

## As duas credenciais, e por que são duas

| Cabeçalho | Responde | Se vazar sozinho |
|---|---|---|
| `X-Agent-Client` + `X-Agent-Secret` | **que programa** está chamando | não lê o dado de ninguém — falta a delegação |
| `Authorization: Bearer <token>` | **em nome de que pessoa** | não vale para outro programa — a delegação é presa ao `AgentClient` |

As duas são obrigatórias. Faltando qualquer uma, a resposta é `401 UNAUTHENTICATED`.

⚠️ **`userId` no corpo, na query ou num cabeçalho livre não autentica nada** — e não existe no contrato. A
identidade sai do token, e é revalidada a cada requisição.

## Emitir credenciais no ambiente local

⚠️ **Os comandos recusam rodar em produção — e a trava é a mesma do `demo-seed`** (`podeRodarDemoSeed`):
recusa por `NODE_ENV=production` **e também** quando o banco apontado não é local. A primeira versão olhava
só `NODE_ENV`, e isso deixava criar credencial de leitura em nome do ROOT no banco de produção a partir de
qualquer máquina de desenvolvimento com a URL certa no ambiente.

```bash
# 1. o serviço (uma vez por programa)
pnpm agente cliente --nome cora-dev

# 2. a delegação de uma pessoa (o e-mail é de uma conta interna do Workspace)
pnpm agente delegar --cliente <clientId> --email admin@teste.local --minutos 60

# variações úteis para teste:
pnpm agente delegar --cliente <clientId> --email admin@teste.local --minutos -1   # já nasce EXPIRADA
pnpm agente revogar --delegacao <delegationId>                                    # vale na próxima chamada
pnpm agente listar                                                                # estado de todas
```

⚠️ **O segredo e o token aparecem uma vez só, na tela.** O banco guarda só o hash. Perdeu, emite outro — é de
propósito: credencial recuperável é credencial que alguém guarda em arquivo.

## Chamar

```bash
curl -s \
  -H "x-agent-client: <clientId>" \
  -H "x-agent-secret: <segredo>" \
  -H "authorization: Bearer <token>" \
  -H "x-request-id: $(uuidgen)" \
  "http://localhost:4319/api/agent/v1/tasks?scope=mine&status=open&limit=20"
```

No PowerShell do dono, o `curl` é `curl.exe` e as aspas mudam; o caminho mais simples é rodar isto pelo Git
Bash, ou usar `Invoke-RestMethod` com `-Headers @{ ... }`.

## O que a rota devolve, e o que ela nunca devolve

- `scope=mine` = **sou responsável** (`TarefaResponsavel`). Nunca a equipe inteira, nem para ADMIN/ROOT.
- `status=open` = `PENDENTE` ou `FAZENDO`; exclui `CONCLUIDA` e o que tem `deletedAt`.
- Só `Tarefa`. **Não** `Card` (etapa de projeto), **não** `Evento` (agenda).
- `descricao` não sai — é texto livre e pode conter dado de cliente (minimização, ADR-141).
- Prazo ausente é `null`. **Nunca vira prazo inventado.**

⚠️ **O `title` sai cru, e é o certo** — o consumidor é quem trata texto como dado inerte. Hoje isso é
confortável porque `prisma.tarefa.create` só existe atrás de `funcionarioProcedure`: **não há caminho anônimo
para plantar texto num título**. A régua que fica: no dia em que alguma automação criar tarefa a partir de
e-mail recebido, formulário público ou conteúdo de cliente, o título passa a ser entrada hostil, e a fronteira
"dado, nunca instrução" precisa estar declarada no contrato OpenAPI — não só num comentário.

⚠️ **`{"items":[]}` só sai com `200`, e significa "não há tarefas abertas".** Banco fora do ar é `503
UPSTREAM_UNAVAILABLE`. Sem essa separação, a assistente diria à Thaís "você está em dia" quando na verdade não
conseguiu perguntar.

## Erros

Envelope único: `{"error":{"code":"…","message":"…","requestId":"…"}}`.

`INVALID_INPUT` (400) · `UNAUTHENTICATED` e `DELEGATION_EXPIRED` (401) · `FORBIDDEN` (403) · `RATE_LIMITED`
(429) · `UPSTREAM_UNAVAILABLE` (503).

⚠️ **Decida pelo `code`, nunca pelo texto da `message`** — o texto é para quem lê o log e pode mudar sem subir
versão de contrato. Nunca sai stack, SQL, nome de tabela ou segredo.

⚠️ **Usuário desativado é `403`, não `401`** — o motivo está na ADR-149: `401` faria o consumidor pedir
delegação nova em laço, e delegação nova para pessoa desativada também não existe.

## Freio — são dois, e o de fora é o que importa

| Freio | Chave | Teto |
|---|---|---|
| de fora | `req.ip` | 300/min |
| de dentro | credencial de serviço **já conferida** | 120/min |

⚠️ **A chave do freio de fora não pode depender de nada que quem chama escolhe.** A primeira versão chaveava
por `X-Agent-Client` — e o `@fastify/rate-limit` registra **um** hook por rota, então `config.rateLimit`
**substitui** o freio global de 300/min. Um anônimo trocando o cabeçalho a cada requisição ganhava um balde
novo por chamada, sem teto, cada uma custando uma conexão do pool (que aqui é 13, e já esgotou em produção).
É a ADR-148 de novo: **freio cuja chave o atacante escolhe não é freio.** Há teste que lê o ponto de uso e
exige **igualdade** com `req.ip` — "contém" deixaria passar `` `${req.ip}|${cabeçalho}` ``.

⚠️ **`isAllowed` do `@fastify/rate-limit` não significa "pode passar"** — só é `true` para chave na lista de
permissão. Quem responde "estourou?" é `isExceeded`.

## Prazo e revogação

- **Máximo 24 h** por delegação. Renovar é um comando; credencial de agente é para uma sessão de trabalho.
- **Revogação explícita:** `pnpm agente revogar --delegacao <id>`, com efeito na chamada seguinte.
- ⚠️ **A delegação cai junto com a senha.** `changePassword`, `redefinirSenha` e a desativação/troca de
  e-mail em `updateUser` revogam todas as delegações vivas da pessoa. Sem isso, trocar a senha — que nesta
  casa é o gesto de "fui comprometido" — deixaria de pé uma credencial que **nenhuma tela mostra**.

## Ao mudar qualquer coisa aqui

1. Mudou a **forma** da resposta, os parâmetros ou os códigos de erro? Sobe a versão em
   `med-coordination/contracts/workspace-agent-v1.openapi.yaml` **e** regera
   `workspace-agent-v1.sha256` (`sha256sum`).
2. Abre ticket para a CORA no mesmo repositório de coordenação. A Cora fixa versão e hash do lado dela; mudar
   o contrato sem avisar quebra a assistente sem quebrar nenhum teste nosso.
3. `apps/api/src/test/agente-api-tarefas.integration.test.ts` é a rede: ele exerce o Fastify de verdade contra
   o banco `_test`.

## Rodar os testes desta API

```bash
pnpm --filter @app/api exec vitest run src/test/agente-api-tarefas.integration.test.ts
```

⚠️ **Não rode `pnpm --filter @app/api test`** sem necessidade: o `include` do Vitest varre também os outros
`*.integration.test.ts`, e parte deles **manda e-mail de verdade** (ver `docs/CLAUDE.md`).
