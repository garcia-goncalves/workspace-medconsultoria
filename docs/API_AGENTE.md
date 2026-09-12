# API do agente (`/api/agent/v1`) — como a Cora fala com o Workspace

> **Decisão e porquês:** ADR-149 (leitura) e **ADR-150 (escrita)** em `docs/DECISIONS.md`.
> **Contrato canônico:** `med-coordination/contracts/workspace-agent-v1.openapi.yaml`, versão **0.2.1**
> (experimental), com o SHA-256 ao lado. **Este arquivo explica como operar; o contrato manda.**
>
> A **Fase 1** (leitura) está descrita logo abaixo; a **Fase 2** (escrita: prévia aprovável e
> criação com idempotência) está no fim deste arquivo.

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

# delegação SEM `tasks:read` — é assim que se exercita o 403 por escopo insuficiente
pnpm agente delegar --cliente <clientId> --email admin@teste.local --escopos tasks:write
```

⚠️ **`tasks:write` HOJE HABILITA ESCRITA — este exemplo mostra só o 403 por escopo, da Fase 1
(CORA-001/002).** Na época em que este trecho foi escrito, `tasks:write` era um escopo reconhecido
que não habilitava nada; ele existia de propósito, para provar o `403` por escopo insuficiente sem
precisar de `tasks:read` (achado do ticket CORA-002). A partir da Fase 2 (ADR-150), quem tem
`tasks:write` cria tarefa de verdade — ver "Emitir a delegação de escrita" mais abaixo.

⚠️ **Conta de Portal é barrada na EMISSÃO, não na chamada.** `pnpm agente delegar --email cliente@teste.local`
responde *"Conta de Portal não pode delegar leitura de tarefa interna"* — a credencial nem chega a existir. A
trava da API continua lá (papel `CLIENTE` → `403`), como segunda camada; só não dá para alcançá-la pela CLI.

## Emitir credenciais em PRODUÇÃO (04/09/2026)

**Nenhum `AgentClient`/`AgentDelegation` de produção existe ainda.** Enquanto isso não muda, a
Cora só fala com `localhost:4319`, mesmo com a API já publicada.

Os comandos acima **nunca** funcionam contra o banco de produção rodando desta máquina — a trava
é a mesma do `demo-seed` e não tem escotilha por variável de ambiente daqui (`NODE_ENV=production`
é recusa **sem exceção**, e banco remoto exige `DEMO_SEED_CONFIRMO=1`, que a hospedagem nem expõe
por fora). A única forma legítima é rodar o comando **dentro do servidor**, onde o MySQL é
`localhost` — e é isso que o workflow **"Emitir credencial do agente"** faz (Actions → Run
workflow), pela mesma conexão SSH do deploy:

1. Vá em **Actions → Emitir credencial do agente → Run workflow**.
2. Escolha a ação (`cliente` para criar o programa, `delegar` para autorizar uma pessoa,
   `revogar` ou `listar`) e preencha só os campos daquela ação.
3. Digite `EMITIR` no campo de confirmação.
4. O segredo/token aparece **uma única vez**, no log da execução — copie e feche a aba. Ele não
   fica em lugar nenhum além do hash que o banco guarda (mesmo aviso do comando local).

⚠️ **A trava continua de pé.** O workflow roda o comando com `NODE_ENV` sobrescrito **só para
aquela chamada** (`NODE_ENV=administracao-agente`) — a variável de ambiente da aplicação em si
continua `production`, intocada. Ninguém edita `podeRodarDemoSeed`; quem dispara o workflow está
escolhendo, conscientemente e uma vez, contornar a trava — exatamente o comentário que
`apps/api/src/scripts/agente.ts` já descrevia antes de este workflow existir.

⚠️ **Exige que a produção já tenha recebido pelo menos um deploy depois deste workflow ter sido
mesclado.** O comando roda o arquivo compilado `scripts/agente.js`, que nasce junto do artefato de
publicação (`scripts/bundle-deploy.mjs`, o mesmo molde do `seed.js`) — sem isso, `pnpm agente ...`
usa `tsx`, que é `devDependency` e não existe no servidor (`npm ci --omit=dev`).

## Cenário determinístico para conferir isolamento

```bash
pnpm agente:fixtures            # cria 10 tarefas com ids fixos (prefixo `cora-fx-`)
pnpm agente:fixtures --limpar   # apaga só elas
```

⚠️ **Por que existe:** a primeira validação do consumidor passou o isolamento A/B **por vacuidade** — o
usuário B não tinha tarefa nenhuma, então *"nada de B vazou para A"* era verdade sem significar nada. **Verde
que não prova nada é pior que vermelho.**

⚠️ **Confira pelos IDS, não pelo total.** O banco de desenvolvimento tem outras tarefas; o cenário acrescenta
7 abertas para A e 2 para B. As afirmações que valem são: `cora-fx-b1` **nunca** aparece para A ·
`cora-fx-ab` aparece para os dois com **dois** `assigneeIds` · `cora-fx-apagada` e `cora-fx-concluida` não
aparecem para ninguém · `cora-fx-semprazo` volta com `dueAt: null`.

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

---

# Fase 2 — a ESCRITA (contrato 0.2.1, ADR-150, ticket CORA-003)

> ✅ **VALIDADA PELO CONSUMIDOR em 03/09/2026: 28 de 28, em duas rodadas.** A CORA exerceu os dois
> endpoints contra o `:4319` com credencial própria e fechou o ticket como `done`
> (`med-coordination`, `tickets/CORA-003/acceptance.md` + `evidence/cora/2026-09-03-fase-02-escrita.md`,
> commit `e0ae08f`). **A W15 foi vista de fora**: duas criações em paralelo com a mesma
> `Idempotency-Key` deram uma `201 created=true` e uma `200 created=false`, a mesma tarefa.
>
> ⚠️ **TRÊS CAMINHOS NÃO FORAM EXERCIDOS DE FORA, e estão declarados no aceite:** o `429` dos
> freios, o `503` com banco caído, e **`PRECONDITION_CHANGED` com `divergencias[]` reais**. Este
> último exige **renomear uma fixture DESTE repositório entre a prévia e a criação**, dentro da
> janela de 15 minutos — e o consumidor não escreve aqui, de propósito. Fechar a lacuna é um
> comando **nosso** no meio da rodada dele, com horário combinado. O tratamento existe e tem teste
> local; o que falta é a prova de ponta a ponta.

## São dois endpoints, e a razão disso é a única coisa a não esquecer

| Endpoint | O que faz | Escopo | Escreve? |
|---|---|---|---|
| `POST /api/agent/v1/tasks/preview` | resolve as referências e devolve a prévia **aprovável** | `tasks:write` | **não** |
| `POST /api/agent/v1/tasks` | cria a tarefa **exatamente** como foi aprovada | `tasks:write` | sim |

Se o agente montasse a prévia do lado dele e depois mandasse a escrita, seriam **dois artefatos
diferentes** — o que a pessoa leu e o que foi gravado. Aqui quem monta a prévia é o mesmo código
que grava, e o `approvalToken` amarra os dois pelo hash dos argumentos.

⚠️ **A prévia exige o escopo de ESCRITA mesmo sem escrever nada.** Ela existe só para habilitar
uma escrita, e é ela que devolve o token.

## O caminho de uma criação, do começo ao fim

```
1. POST /tasks/preview   { titulo, cliente: {texto: "..."}, ... }
   → 200 com approvalToken            → siga para o 3
   → 200 com approvalToken: null      → há ambiguidades[] ou algo não encontrado: PERGUNTE

2. POST /tasks/preview   { ..., cliente: {id: "<o escolhido>"} }
   → 200 com approvalToken

3. POST /tasks
   cabeçalho Idempotency-Key: <UUID>
   corpo     { approvalToken, task: { titulo, prioridade, prazo, clienteId, projetoId, responsavelIds } }
   → 201 created: true    (nasceu agora)
   → 200 created: false   (repetição da mesma chave — a MESMA tarefa)
   → 409                  (ver a tabela de conflitos)
```

## Emitir a delegação de escrita, no ambiente local

```bash
pnpm agente cliente --nome "cora"
pnpm agente delegar --cliente <clientId> --email <pessoa@...> \
  --escopos "tasks:read tasks:write" --minutos 60
```

⚠️ O parâmetro da pessoa é **`--email`**, não `--usuario`.

⚠️ **`tasks:write` deixou de ser inerte na Fase 2.** Antes era um escopo reconhecido que não
habilitava nada — servia de credencial inofensiva para exercer o `403` na leitura. **Hoje quem o
tem cria tarefa.** As duas provas de `403` se fazem uma contra a outra: `tasks:read` sozinho é
recusado na escrita, `tasks:write` sozinho é recusado na leitura.

## Referência: `texto` OU `id`, nunca os dois

`{"texto": "Clínica X"}` é o que a pessoa falou. `{"id": "..."}` é a escolha depois de uma
desambiguação. Os dois juntos — ou nenhum — é `400`: *"qual deles vale?"* é uma decisão que o
servidor não pode tomar por quem chama.

## O servidor NUNCA escolhe o melhor palpite

Mais de um candidato ⇒ `200` com `approvalToken: null` e `ambiguidades[]`. **`200`, não `400`**:
um erro faria o consumidor tratar como falha e repetir com os mesmos dados, em laço.

Vale **inclusive quando um candidato casa exatamente** com o texto. "Clínica Silva" e "Clínica
Silva e Souza" são duas clínicas; preferir a exata continua sendo escolher por alguém. Homônimo é
onde isso machuca — a tarefa vai para o médico errado e ninguém descobre até o prazo vencer.

Cada candidato traz uma **`distincao`**: um fato que o separa dos outros (CNPJ, situação
comercial, cliente do projeto, papel e e-mail da pessoa). Dois ids com dois nomes iguais
transfeririam a ambiguidade para a Thaís sem lhe dar como resolvê-la.

⚠️ **Referência PEDIDA que não resolve também zera o token**, e não só a ambígua. Gravar sem o
cliente que foi pedido seria gravar calado uma coisa diferente. Campo **não informado**
(`NAO_INFORMADO`) não impede o token.

## A idempotência

`Idempotency-Key`, **obrigatória**, UUID escolhido por quem chama.

- **Escopo:** `(serviço, usuário delegado, ferramenta, chave)`. **Nunca a delegação** — presa a
  ela, a chave morreria com o token, e renovar credencial perderia a idempotência exatamente
  depois de uma falha.
- **Não é derivada do conteúdo**, de propósito: duas tarefas legitimamente iguais no mesmo dia
  ("ligar para a clínica") colidiriam e a segunda se perderia sem ninguém saber.
- **Validade: 24 h.** Depois disso a chave é esquecida e repetir cria tarefa nova.

⚠️ **QUEM GARANTE A ATOMICIDADE É O ÍNDICE ÚNICO, NÃO O NÍVEL DE ISOLAMENTO.** Em
`REPEATABLE READ` (o padrão do MySQL e do MariaDB 10.6 de produção) duas conexões que leem "essa
chave já existe?" e depois inserem **passam as duas**. O caminho é `INSERT` primeiro em
`AgentIdempotency_reserva_key`; a violação (`P2002`) é a resposta *"alguém já tem"*.

⚠️ **Reserva e tarefa entram na MESMA transação**, chave primeiro. Em dois passos, uma queda no
meio deixaria chave sem tarefa (repetir nunca mais criaria) ou tarefa sem chave (repetir criaria
a segunda).

## Os cinco conflitos, e por que cada um tem nome próprio

| `code` | O que aconteceu | O que o consumidor faz |
|---|---|---|
| `APPROVAL_EXPIRED` | o token passou dos 15 minutos | refaz a prévia |
| `APPROVAL_MISMATCH` | o `task` enviado não é o aprovado | corrige o envio; **o servidor não executa o novo** |
| `APPROVAL_ALREADY_USED` | o token já foi consumido por outra chave | refaz a prévia |
| `PRECONDITION_CHANGED` | o mundo mudou desde a prévia | lê `divergencias[]`, conta à pessoa, refaz a prévia |
| `IDEMPOTENCY_CONFLICT` | mesma chave, argumentos diferentes | **é defeito de quem chama**: usa chave nova |

Um `CONFLICT` genérico obrigaria o consumidor a decidir pelo **texto** da mensagem — que o
contrato manda nunca fazer.

Só o `PRECONDITION_CHANGED` traz `divergencias[]`, dentro de `error`, com
`{campo, aprovado:{id,rotulo}, atual:{id,rotulo}|null, motivo}`.

## O prazo de 15 minutos é higiene; a defesa é revalidar

O token está amarrado ao hash dos argumentos, então um token de ontem executaria exatamente o que
foi aprovado. **O que muda em quarenta minutos não é o pedido, é o mundo.** No instante de
executar, as referências são resolvidas de novo e os **rótulos** comparados com os que a pessoa
leu — o nome que ela leu faz parte do que ela aprovou.

## O `resolutionHash` não é um hash cru

É um **selo opaco, determinístico e assinado** sobre os ids e os rótulos. Existe assim porque de
um SHA-256 só daria para dizer *"está diferente"*, e o consumidor pediu **o que saiu e o que
entrou**. Guardar a resolução anterior aqui exigiria gravar toda prévia — e a prévia é leitura
pura. Comparar por igualdade continua funcionando (não há relógio nem aleatório dentro).

## Fixtures da Fase 2

`pnpm agente:fixtures` cria, com ids fixos:

| id | O que é |
|---|---|
| `cora-fx-cli-unica` | "Clinica Ficticia Unica CORA" — busca por `Unica CORA` casa uma |
| `cora-fx-cli-homonima-1` | "Clinica Ficticia Homonima CORA", CNPJ 22…, ativo |
| `cora-fx-cli-homonima-2` | "Clinica Ficticia Homonima CORA Norte", CNPJ 33…, prospect |
| `cora-fx-proj-unico` | "Projeto Ficticio Unico CORA", do cliente único |

Os dois homônimos existem para o teste de ambiguidade **não passar por vacuidade** — a lição do
CORA-002. **Confira por id, nunca por total.**

## Rodar os testes desta fase

```bash
pnpm --filter @app/api exec vitest run src/test/agente-api-criar-tarefa.integration.test.ts
```

24 testes, contra o Fastify de verdade e o MySQL `_test`. Cobrem W1–W16 do ticket mais oito casos
do desenho.

## Ao mudar qualquer coisa aqui

1. Suba a versão em `med-coordination/contracts/workspace-agent-v1.openapi.yaml` **e** regere o
   `workspace-agent-v1.sha256`.
2. Atualize o literal da versão em `agente-api-tarefas.integration.test.ts` — ele é a trava que
   obriga a lembrar do passo 1.
3. ⚠️ **Rota nova exige o bloco `config: { rateLimit: freioPorIp() }`.** O freio de rota
   **substitui** o global; sem o bloco, a rota fica sem teto nenhum, **sem erro e sem log**. Há
   teste que conta rota por rota e reprova quem esquecer.
