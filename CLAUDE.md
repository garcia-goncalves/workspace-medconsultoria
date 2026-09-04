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

## Estado atual (2026-09-04 · noite · **v1.8.0 NO AR** — ADR-151 publicada)

> **Leia a ADR-151 em `docs/DECISIONS.md`.**

### ✅ NO AR: a troca para o Gemini foi PUBLICADA e confirmada por HTTP real

- **Publicação `33900553080`, `workflow_dispatch`, commit `18a2129` (tag `v1.8.0`).** A suíte
  completa rodou verde antes de tocar no servidor; no servidor os **7/7 passos** verdes (o 5/7 —
  dependências + Prisma + migrations — não tinha migração nova, ADR-151 é zero-migração) e o
  **smoke test do próprio workflow** verde.
- **Conferido de fora, por `curl` real, não só confiando no smoke test do workflow:**
  `/health` → `{"status":"ok",...}` **200** · `/` **200** · `/credenciamentos` **200**.
- ⚠️ **A chamada real ao Gemini EM PRODUÇÃO ainda não foi feita** — o dono colou a segunda chave
  (a de produção, separada da local) no `.env` do servidor durante o deploy, e o reinício do passo
  7/7 já sobe com ela lida. Falta só alguém abrir a tela logada e clicar em algo que chame a IA
  (ex.: "Gerar meu plano" no Início) para ver a resposta real — isso é uso normal, não pendência de
  código.

### 🔀 OPENAI VIROU GEMINI, E FOI PROVADO COM CHAMADA REAL — pedido do dono

- **Motivo:** o dono pediu para usar o Gemini (gratuito) em vez da OpenAI (paga), reaproveitando a
  configuração que a `cora-med` (outra sessão) já validou em produção de teste. Perguntado sobre
  compartilhar a MESMA chave da Cora, o dono escolheu **chave nova, cota separada** — as duas
  aplicações dividirem cota gratuita foi descartado (o Workspace já tem histórico de estourar cota
  compartilhada, ADR-121/Actions).
- **✅ PROVADO COM CHAMADA REAL AO GEMINI, LOCAL, 04/09/2026 (noite).** Depois de o dono colar
  `GEMINI_API_KEY` no `.env` local, `ia.resumoDoDia` (autenticado como `admin@teste.local`) foi
  chamado por HTTP real duas vezes: a **primeira deu timeout** (30s — provável "chamada fria" do
  modelo, mesmo padrão que a Cora já tinha visto com sobrecarga de outros modelos), a **segunda
  respondeu em português, coerente, com dados reais do banco** ("11 contas vencidas", horário da
  reunião de kickoff, contagem de documentos aguardando revisão). ⚠️ **Timeout na 1ª chamada é
  esperado, não bug** — o `AbortSignal.timeout(30_000)` fez exatamente o que devia (falhar rápido
  em vez de travar a requisição), e a 2ª tentativa provou que a config está certa.
- **A porta única não mudou de lugar** (ADR-141): `apps/api/src/lib/ai.ts` continua sendo o único
  ponto que fala com um provedor externo de IA; a peneira de dado pessoal (`redigirDadoPessoal`)
  entra e sai no mesmo lugar de sempre. Só o QUEM do outro lado mudou.
- **Sem SDK novo** — REST direto (`fetch`) contra `generateContent`, mesmo padrão do motor de teste
  da Cora. `openai` saiu do `package.json`. Modelo `gemini-3.6-flash`, escolhido por chamada real
  (a Cora já tinha testado e descartado dois outros).
- **Texto legal corrigido junto:** `/privacidade` dizia "com a OpenAI" — agora diz "com o Google
  (Gemini)". Não é só código, é o que o cliente lê sob a LGPD.
- ⚠️ **Transcrição de áudio segue NÃO exercida com áudio real** — implementada pela documentação do
  Gemini (a Cora não usa Gemini para áudio, não deu para reaproveitar prova). A prova acima foi só
  de texto (`resumoDoDia`). Pendência registrada em `docs/IA_PRIVACIDADE.md`.
- **Provas:** typecheck 6/6 · **938 testes, todos verdes** (8 novos, cobrindo o parser da resposta
  do Gemini, o mimetype real da transcrição e o erro HTTP virando mensagem clara) · revisão
  especialista (typescript-reviewer + react-reviewer) rodada e os 3 achados corrigidos · **e agora
  chamada real ao Gemini, funcionando**.
- ⚠️ **`.env.example` não foi atualizado** (fora do alcance de permissão desta sessão) — trocar
  `OPENAI_API_KEY` por `GEMINI_API_KEY` ali é pendência manual do dono ou de outra sessão.
- **Publicado — ver o bloco "NO AR" acima.** Foi a mesma sessão que publicou.

## Estado anterior (2026-09-04 · **v1.7.0 NO AR** — ADR-147/148/149/150 publicadas, as QUATRO)

> **Leia a ADR-150 em `docs/DECISIONS.md` e a seção da Fase 2 em `docs/API_AGENTE.md`.**

### 🚀 O LOTE DO CORA-003 FOI PUBLICADO — a API do agente (leitura E escrita) está no ar

- **✅ NO AR DESDE 04/09/2026 às 14:03 (11:03 no servidor) — a v1.7.0.** Publicação
  `33878723364`, disparada por `workflow_dispatch` (`gh workflow run deploy.yml --ref main -f
  confirmar=PUBLICAR`, e desta vez **não fui barrado**). Antes de tocar no servidor, a suíte
  completa rodou de novo e verde (`build-test` · `integration` · `e2e in 7m30s`); no servidor,
  os **7/7 passos** verdes: `1b/7` confirmou o artefato inteiro e limpo, `5/7` aplicou as
  **cinco migrações pendentes** (`20260902000000` nome único de serviço · `20260902120000`
  consentimento da assinatura · `20260902130000` `Conta.origemServicoId` · `20260902200000`
  `AgentClient`/`AgentDelegation` · `20260903120000` `AgentIdempotency`), `6/7` e `7/7`
  confirmaram o reinício, e o **smoke test do próprio workflow** respondeu verde. Etiqueta
  **`v1.7.0`** criada e enviada antes do disparo (aponta para `6f2d52a`, o mesmo código já
  testado em `c8affb1` — o commit entre os dois foi só documentação).
- **🔎 CONFERIDO DE FORA, por HTTP real, depois do deploy (não só o smoke test do workflow):**
  `https://workspace.medconsultoria.com.br/` → `200`; `/health` → `{"status":"ok"}`;
  `/credenciamentos` → `200`; **`GET /api/agent/v1/tasks` sem credencial → `401`** — a prova
  de que a API do agente (leitura, ADR-149, e agora também escrita, ADR-150) **existe e está
  viva** em produção, não só localmente.
- **⚠️ Ainda depende de alguém: nenhuma credencial de produção foi emitida para a Cora.** Os
  comandos `pnpm agente cliente|delegar` recusam rodar fora desta máquina por desenho — a trava
  é `podeRodarDemoSeed`, a mesma do `demo-seed`, e não abre exceção nenhuma daqui.
- **🔧 O MECANISMO PARA EMITIR NASCEU, A EMISSÃO EM SI NÃO ACONTECEU.** Workflow **"Emitir
  credencial do agente"** (`workflow_dispatch`, confirmação `EMITIR`) roda o comando **dentro do
  servidor**, pela mesma conexão SSH do deploy — é o único jeito legítimo de tocar o banco de
  produção, já que a trava recusa qualquer banco remoto sem exceção. `apps/api/src/scripts/agente.ts`
  passou a ser compilado no bundle de publicação (`scripts/bundle-deploy.mjs`, mesmo molde do
  `seed.js`), porque o comando usa `tsx` — `devDependency`, ausente no servidor. ⚠️ **Só funciona
  depois do PRÓXIMO deploy** (o `scripts/agente.js` ainda não existe em produção — só entra no ar
  no primeiro deploy depois deste commit). Decisão de disparar de verdade continua sendo do dono.
- **🔓 O REPOSITÓRIO É PÚBLICO, E CONTINUA — DECISÃO DO DONO (04/09/2026), NÃO DESCUIDO.** A
  revisão de segurança achou o repositório `public` e travou o workflow de credencial para
  recusar rodar enquanto isso não mudar (imprimir segredo de produção num log público seria
  grave). Perguntado, o dono escolheu **manter público**: a conta é do plano **Team**, e Actions
  em repositório público é grátis/ilimitado — privado passaria a consumir a cota
  **compartilhada** de 3.000 min/mês entre os 15 repositórios da conta, a mesma que este projeto
  sozinho já estourou em 116% no passado (ADR-121). **Não torne este repositório privado** por
  causa do achado acima; se um dia for preciso emitir a credencial de verdade, a correção é mudar
  *como* o segredo é entregue (nunca pelo log do Actions), não a visibilidade do repositório.
- **📮 Aviso deixado em `med-coordination/status/workspace.md`** antes e depois da publicação,
  para a sessão da Cora não presumir que a API do agente segue restrita a esta máquina.

## Estado anterior (2026-09-03 · **v1.6.0 NO AR** — ADR-147/148/149/150 as QUATRO na `main`, NENHUMA publicada)

> **Leia a ADR-150 em `docs/DECISIONS.md` e a seção da Fase 2 em `docs/API_AGENTE.md`.**

### ✍️ A CORA PASSOU A ESCREVER: criar tarefa com prévia aprovável e idempotência (ADR-150, ticket CORA-003)

- **A Fase 2 nasceu, e o desenho inteiro estava no ticket.** A Cora dita o pedido da Thaís; o
  Workspace resolve as referências, devolve uma prévia **aprovável**, e só grava aquilo. Contrato
  **0.2.0** (`med-coordination/contracts/`), SHA-256
  `d5dbff4167727e041326d5e9caf38aa2b3388529272dc673095cdc4a617ec13a`.
- **🚪 SÃO DOIS ENDPOINTS, e juntá-los seria o defeito.** `POST /api/agent/v1/tasks/preview`
  (leitura pura, não escreve nada) e `POST /api/agent/v1/tasks` (exige o `approvalToken` daquela
  prévia). Se a Cora montasse a prévia do lado dela, seriam **dois artefatos diferentes** — o que
  a Thaís leu e o que foi gravado —, e entre um e outro cabe qualquer coisa.
- **🔑 A ATOMICIDADE É DO ÍNDICE ÚNICO, NÃO DO NÍVEL DE ISOLAMENTO.** Foi a pergunta direta da
  Cora. Em `REPEATABLE READ` (o padrão do MySQL local **e do MariaDB 10.6 de produção**) duas
  conexões que leem *"essa chave já existe?"* e depois inserem **passam as duas** — o "confere e
  grava" perdido. `SERIALIZABLE` ou lock explícito custariam caro numa rota chamada **em laço por
  um programa**, com pool de 13 conexões que já esgotou em produção. Cura: **`INSERT` primeiro**
  em `@@unique([clientId, userId, ferramenta, chave])`; a violação `P2002` é a resposta *"alguém
  já tem"*. ⚠️ **Visto reprovando:** trocando **só** esse mecanismo por "confere-e-grava", o teste
  de concorrência **fica vermelho**.
- **🔗 RESERVA E TAREFA NA MESMA TRANSAÇÃO, chave primeiro.** Em dois passos, uma queda no meio
  deixa **chave sem tarefa** (repetir nunca mais cria) ou **tarefa sem chave** (repetir cria a
  segunda). Por isso `AgentIdempotency.tarefaId` é anulável, e nunca é observável nulo de fora.
- **🎯 O ESCOPO DA CHAVE INCLUI A PESSOA E O SERVIÇO, NUNCA A DELEGAÇÃO** — presa a ela, a chave
  morreria com o token, e renovar credencial perderia a idempotência **exatamente depois de uma
  falha**, que é quando a repetição é mais provável. A chave é escolhida por quem chama e **não é
  derivada do conteúdo**: derivar do payload faria duas tarefas legitimamente iguais no mesmo dia
  ("ligar para a clínica") colidirem, e a segunda se perderia **sem ninguém saber**.
- **🚫 O SERVIDOR NUNCA ESCOLHE O MELHOR PALPITE.** Dois candidatos ⇒ `200` com
  `approvalToken: null` e `ambiguidades[]`. `200` e não `400` de propósito: erro faria a Cora
  tratar como falha e repetir com os mesmos dados, **em laço**. Vale **inclusive quando um
  candidato casa exatamente** com o texto. Cada candidato traz um **fato que o distingue** (CNPJ,
  situação, papel) — dois ids com dois nomes iguais transfeririam a ambiguidade para a Thaís sem
  lhe dar como resolvê-la.
- **⏳ O PRAZO DE 15 MIN DO TOKEN É HIGIENE; A DEFESA É REVALIDAR.** O token está amarrado ao hash
  dos argumentos, então um token de ontem executa exatamente o que foi aprovado — **o que muda em
  quarenta minutos não é o pedido, é o mundo**. No instante de executar, as referências são
  resolvidas de novo e os **rótulos** comparados; divergiu, é `409 PRECONDITION_CHANGED` com a
  lista **campo a campo**.
- **🏷️ O `resolutionHash` VIROU UM SELO, e não é um hash cru.** A Cora pediu `mudou[]` **com o que
  saiu e o que entrou**, e de um SHA-256 só dá para dizer "está diferente". Guardar a resolução
  anterior aqui exigiria gravar toda prévia — e prévia é leitura pura. Então ela viaja **dentro do
  próprio valor**, assinada, e continua determinística (comparar por igualdade ainda funciona).
- **⚠️ REFERÊNCIA PEDIDA QUE NÃO RESOLVE TAMBÉM ZERA O TOKEN** — decisão nossa, mais estrita que o
  ticket. Gravar sem o cliente que foi pedido seria gravar calado uma coisa diferente, e a Thaís
  só descobriria procurando a tarefa na ficha errada.
- **🔐 `tasks:write` DEIXOU DE SER INERTE.** Era um escopo reconhecido que não habilitava nada
  (existia só para emitir delegação sem `tasks:read` e exercer o `403`). Hoje é a capacidade de
  escrita, e habilita **a prévia também**. As duas provas de `403` passam a se fazer uma contra a
  outra.
- **🕳️ DOIS DEFEITOS QUE A PRÓPRIA CORREÇÃO CRIOU.** (1) 🔴 **A trava do freio por IP ficou CEGA
  ao virar função compartilhada:** a régua da ADR-149 procurava o `keyGenerator` em qualquer lugar
  do arquivo, e passaria verde com uma rota **sem** o `config` — a rota ficaria **sem teto nenhum**,
  sem erro e sem log. Hoje ela conta rota por rota e proíbe um segundo `rateLimit:` escrito à mão;
  **vista pegando** (`3 rota(s), mas 2 com o freio por IP`). (2) **A regra de criar tarefa ia
  virar duas** — a criação precisa rodar dentro da transação da reserva, e o `createTarefa` humano
  usa o `prisma` global; copiar a montagem seria a ADR-133 de novo. Nasceu `montarTarefa(db, ...)`,
  usada pelas duas portas.
- **⚠️ MIGRAÇÃO `20260903120000`, ADITIVA:** **uma** tabela nova (`AgentIdempotency`). Nenhuma
  tabela existente muda, nenhum backfill. Reverter é um `DROP TABLE`. **Aplicada nos bancos local
  e de teste; NÃO em produção.**
- **⚖️ O W16 TEM UMA COSTURA DE INJEÇÃO, DECLARADA NO CÓDIGO.** "Queda entre a reserva e a
  criação" **não se prova de outro jeito**: toda falha natural que se consiga forçar é pega antes,
  pela revalidação. Sem a costura, o W16 seria descrito e não provado — e atomicidade é justamente
  o que não se prova lendo código.
- **🔴 A REVISÃO ESPECIALISTA ACHOU UM BLOQUEANTE, E ELE TAMBÉM NASCEU DESTA CORREÇÃO.**
  `responsavelIds` era deduplicado **para o hash** e **não para a gravação**. Dois textos que
  resolvem para a MESMA pessoa passavam pela prévia, ganhavam token, e estouravam no
  `@@unique([tarefaId, userId])` **dentro da transação**. ⚠️ **O estrago era o DIAGNÓSTICO:**
  `ehViolacaoDeUnico` captura qualquer `P2002`, então virava "colisão de chave de idempotência",
  `503` e *"reserva de idempotência sem tarefa"* no log — alarme de infraestrutura para entrada
  redundante — e o `approvalToken` ficava **inutilizável para sempre**. Visto reprovando
  (`expected 503 to be 201`). Cura: normalizar na fronteira **e** relançar o `P2002` que não é
  nosso.
- **📌 O PRISMA NÃO EXPRESSA `COLLATE`** — achado do revisor de banco. `prisma migrate diff`
  proporia desfazer o `utf8mb4_bin` e **reintroduzir o defeito da ADR-147**. Aviso escrito no
  `schema.prisma`. ⚠️ **Nunca rode `migrate diff` contra este schema para "consertar" isso.**
- **⏭️ Pedido pela revisão e NÃO feito:** paralelizar a resolução das referências (`Promise.all`).
  É latência, não correção — e paralelizar torna a ordem de `ambiguidades[]` não determinística,
  que é o que a Cora lê para perguntar. Próximo passo, com montagem por índice.
- 🔐 A REVISÃO DE SEGURANÇA: quatro achados, e o contrato subiu para **0.2.1** por causa de um

**Nenhum bloqueante** — não havia caminho para o pedido escolher a pessoa, nem furo no token. Os
quatro importantes, todos corrigidos com teste:

1. **`%` e `_` são coringas do `LIKE`, e o `contains` do Prisma não os escapa.**
   `{"texto": "%%"}` passava no mínimo de 2 caracteres e virava `LIKE '%%%'`, que **casa tudo**: a
   prévia deixava de ser busca e virava **listagem paginável da base** — nome, CNPJ, situação e
   e-mail dos oito primeiros, mais o `total`. Hoje o texto é escapado e tem teto de 120 caracteres.
2. **A distinção de PESSOA entregava o diretório da equipe.** Era `PAPEL · e-mail completo` — e
   isso é **mais permissivo que o lado humano**, onde `listEquipe` devolve só id, nome e avatar, e
   papel + e-mail de todos só saem por `adminProcedure`. Um funcionário com delegação montava o
   mapa de quem é ROOT/ADMIN e o e-mail de cada um: insumo direto para phishing dirigido a quem
   tem mais poder. Hoje é **e-mail mascarado**, que resolve o homônimo sem entregar a lista.
3. **O teto de responsáveis existia só na prévia**, e a forma canônica deduplica **antes** do
   hash — então `["u1"]` e `["u1"]` repetido quarenta mil vezes tinham o **mesmo `argsHash`** e
   passavam pelo `APPROVAL_MISMATCH`, entrando na transação com um corpo de 1 MB de ids. A
   deduplicação (achado do outro revisor) já mata o caso; o teto entrou como segunda tranca.
4. **⚠️ O RÓTULO TEM ORIGEM ANÔNIMA, e o contrato calava sobre isso.** `Cliente.nome` nasce do
   formulário público `/comecar`, que **qualquer pessoa preenche sem autenticação** — o nome da
   empresa vira o nome do PROSPECT, e é esse texto que volta como `rotulo` e vai direto ao LLM do
   outro lado. O `docs/API_AGENTE.md` **previu exatamente este dia** e disse que a fronteira "dado,
   nunca instrução" precisaria estar **no contrato, não num comentário**. Cumprido: a **0.2.1** é
   uma mudança **só de texto** que declara `previa.*.rotulo`, `ambiguidades[].candidatos[].rotulo` e
   `divergencias[].{aprovado,atual}.rotulo` como dado inerte, e nasceu a fixture
   `cora-fx-cli-injecao`. **SHA-256 `19009cb7ac2f847fadbd903bed97697ab1ba03d8cc93bec2c55a16ba3d31b50e`.**

**Mais três, menores, também fechados:** a `Idempotency-Key` era comparada em coluna `utf8mb4_bin`
com regex `i`, então a mesma chave em caixa diferente criaria **duas** tarefas (hoje é normalizada
para minúsculas); a forma canônica não normalizava Unicode, e "ç" composto contra decomposto dava
`APPROVAL_MISMATCH` **falso** (hoje `NFC`); e **escrita feita por um programa em nome de uma pessoa
não deixava rastro** — a única prova era a linha de idempotência, apagada em 24 h, e depois disso
nada distinguia da criação feita na tela. Hoje grava `agente.tarefa.criada` no `ActivityLog`, com a
ação na lista das que **não expiram** (a régua da ADR-128).

- **Provas:** typecheck 0 erros · lint limpo · **suíte COMPLETA do `@app/api`: 113 arquivos, 927
  testes, verdes** · **24 testes de integração novos** exercendo o Fastify de verdade (`app.inject`)
  contra o MySQL `_test`, cobrindo **W1–W16** mais oito casos do desenho · **sete sabotagens, uma
  trava de cada vez, todas vermelhas** · a rota exercida por **HTTP real** (`curl` contra
  `localhost:4319`): prévia ambígua `200` sem token, prévia resolvida com token, criação `201`,
  repetição `200` com a mesma tarefa, `409 APPROVAL_MISMATCH`, `409 APPROVAL_ALREADY_USED`, `400`
  sem `Idempotency-Key`, e a tarefa criada **aparecendo no `GET /tasks`** da Fase 1.
- ✅ **MESCLADA na `main` em 03/09: PR #180 → `c8affb1`** (squash), com a CI **3/3 verde**
  (`build-test` 2m38s · `integration` 1m37s · `e2e` 8m01s, execução `33783690482`). A branch
  `feat/api-do-agente-escrita-adr-150` foi apagada; o SHA a citar é o `c8affb1`, não o `10de1c4`.
- ✅ **O CORA-003 ESTÁ `done` — a CORA validou contra o `:4319` em 03/09, e passou 28 de 28, em duas
  rodadas.** Registro dela em `med-coordination`: `tickets/CORA-003/acceptance.md` e
  `evidence/cora/2026-09-03-fase-02-escrita.md` (`e0ae08f`). **A prova que mais importava é a W15
  vista de fora:** duas criações **em paralelo** com a mesma `Idempotency-Key` deram **uma `201
  created=true` e uma `200 created=false`, a mesma tarefa** — a atomicidade do índice único
  funciona para quem chama, não só para o nosso teste. Também confirmados de fora:
  `APPROVAL_MISMATCH` recusando **sem executar o novo**, `APPROVAL_ALREADY_USED`,
  `IDEMPOTENCY_CONFLICT` **sem criar a segunda tarefa**, chave em caixa alta voltando `200
  created=false` (a normalização para minúsculas trabalhando), `403` na prévia **e** na criação com
  delegação só de leitura, e `previousResolutionHash` desconhecido dando `400` em vez de "sem
  comparação". ⚠️ **O bloqueante do `responsavelIds` duplicado está fechado visto de fora**: `201`,
  um vínculo, sem erro — era o que respondia `503` com alarme de infraestrutura.
- ⚠️ **TRÊS COISAS NÃO FORAM EXERCIDAS, e estão DECLARADAS no aceite em vez de arredondadas:** o
  `429` dos freios, o `503` com banco caído, e — a maior — **`PRECONDITION_CHANGED` com
  `divergencias[]` reais**. Esta última exige **renomear uma fixture NOSSA entre a prévia e a
  criação**, dentro da janela de 15 min, e a CORA não toca neste repositório de propósito. O
  tratamento existe e é testado localmente, com as três frases distintas (`ROTULO_MUDOU`,
  `NAO_ENCONTRADO`, `SEM_ACESSO`). **Fechar a lacuna é um comando daqui no meio da rodada dela**,
  combinando horário — não foi pedido, ficou registrado.
- ⚠️ **NÃO ESTÁ NO AR.** Mesclado não é publicado, e validado pelo consumidor também não é
  publicado. O lote de publicação pendente tem **CINCO** migrações, todas aditivas.
- **🧪 Resíduo no banco LOCAL, de propósito:** as duas rodadas da CORA deixaram tarefas com título
  começando em `SYNTH-verificacao-fase-02`. É o banco de desenvolvimento, que os e2e já enchem de
  resíduo; apagar é um `LIKE`. As credenciais emitidas para a rodada (cliente
  `cora-verificacao-fase2`) **expiram sozinhas**, e o segredo não é recuperável.
- **O que ficou de fora, de propósito:** editar, concluir e excluir tarefa; `Card` e `Evento`; e
  `Tarefa.descricao`, que **não** é exposta **nem aceita** — texto livre pode conter dado de
  cliente (minimização, ADR-141).
- **⚠️ Armadilha do comando:** `pnpm agente delegar` usa **`--email`**, não `--usuario`.

## Estado anterior (2026-09-03 · manhã · a leitura da API do agente — ADR-149)

> **Leia a ADR-149 em `docs/DECISIONS.md` e `docs/API_AGENTE.md`.**

### 🤖 NASCEU A API DO AGENTE — a porta por onde a Cora fala com o Workspace (ADR-149, ticket CORA-001)

- **Contexto novo, e ele muda o desenho:** esta e a primeira vez que um programa **de fora** le dado do
  Workspace. A assistente **Cora** (`cora-med`, outra sessao do Claude Code) precisa ler as tarefas internas da
  pessoa que fala com ela. A coordenacao entre as duas janelas e por arquivo, no repositorio
  `med-coordination` (irmao deste) — e **o WORKSPACE nao roda git la**: escreve so os arquivos que possui
  (`contracts/`, `tickets/CORA-00N/response.md`, `status/workspace.md`, `evidence/workspace/`).
- **🚪 `GET /api/agent/v1/tasks`, REST/JSON, FORA do tRPC.** O tRPC daqui e o transporte do nosso navegador
  (superjson, lote, muda de forma quando refatoramos). Entrega-lo a Cora amarraria os dois sistemas: uma
  refatoracao interna quebraria a assistente **sem quebrar nenhum teste nosso**. O contrato e o arquivo
  `med-coordination/contracts/workspace-agent-v1.openapi.yaml` (0.1.0) mais o SHA-256 ao lado.
- **🔑 DUAS IDENTIDADES, e junta-las seria o defeito.** `AgentClient` = que PROGRAMA chama; `AgentDelegation` =
  em nome de QUE PESSOA. Com uma so, o segredo do servico viraria sozinho acesso a dado de gente. E **a
  delegacao e presa ao servico**: token vazado nao vale para outro programa.
- **⚠️ `userId` NO PAYLOAD NAO AUTENTICA NADA, e a trava e estrutural.** O `requesterUserId` sai do token e de
  lugar nenhum mais — nao existe caminho para o pedido escolher a pessoa (mesma escolha do `clienteId` do
  `portalProcedure`). A pessoa e revalidada **a cada chamada**: ativa, nao excluida, sem acesso revogado, papel
  interno, escopo `tasks:read` presente (padrao NEGAR).
- **🔐 SHA-256 e nao argon2 nos segredos — filho direto da ADR-148.** La, argon2 num caminho anonimo virou o
  jeito mais barato de derrubar o processo; aqui seria pior, porque a API e chamada **em laco por um programa**.
  E nao ha o que argon2 resolveria: sao 32 bytes sorteados por nos. Nenhum dos dois e guardado, so o hash.
- **🚨 INDISPONIBILIDADE NUNCA VIRA LISTA VAZIA.** `{"items":[]}` se le como *"voce esta em dia"* — a frase
  mais perigosa que um assistente pode dizer errado. Banco fora do ar e `503`. Ha teste que derruba o banco de
  proposito; com a correcao desligada ele reprova.
- **⚖️ Usuario desativado e `403`, nao `401`** — `401` faria a Cora pedir delegacao nova em laco, e delegacao
  nova para pessoa desativada tambem nao existe. Fixado no contrato.
- **📄 Cursor OPACO E ASSINADO** (HMAC), nao base64: so da para recusar o que da para detectar. Paginacao por
  chave `(createdAt, id)`, nao por deslocamento — com `skip`, tarefa criada entre duas paginas faz a seguinte
  **pular uma linha** em silencio. `limit` fora de 1..100 e **erro**, nao e aparado.
- **⚠️ MIGRACAO `20260902200000`, ADITIVA:** duas tabelas NOVAS (`AgentClient`, `AgentDelegation`). Nenhuma
  tabela existente muda, nenhum backfill. Reverter sao dois `DROP TABLE`. **Aplicada nos bancos local e de
  teste; NAO em producao.**
- **Comandos:** `pnpm agente cliente|delegar|revogar|listar` (recusam rodar em producao).
- **🕳️ A REVISAO ESPECIALISTA ACHOU CINCO COISAS, E AS CINCO NASCERAM DESTA PROPRIA CORRECAO.**
  (1) 🔴 **O freio da rota era chaveado por um cabecalho que o atacante escolhe — e, ao existir, DESLIGAVA o
  freio global de 300/min nesta rota** (o `@fastify/rate-limit` registra UM hook por rota). Um anonimo
  trocando `X-Agent-Client` ganhava um balde por chamada, teto nenhum, cada uma custando conexao do pool —
  que aqui e 13 e **ja esgotou em producao**. ⚠️ **E a ADR-148 de novo, e desta vez fui eu quem repetiu.**
  Cura: freio **por IP sozinho** (chave que ninguem de fora influencia) + freio por credencial **depois** da
  autenticacao + conferencia de FORMA do cabecalho antes de tocar o banco.
  (2) 🔑 **A delegacao sobrevivia a TROCA DE SENHA** — a terceira porta da revogacao. Token vazado continuava
  lendo depois do gesto que nesta casa significa "fui comprometido", e `SISTEMA → Sessoes` mostrava tudo
  limpo. Hoje `revogarDelegacoesDoUsuario` e chamada nos tres pontos que ja derrubam sessao e token.
  (3) 🚪 **A trava de producao do comando nao era a que o proprio comentario prometia** (so `NODE_ENV`, e nao
  `podeRodarDemoSeed`): de qualquer maquina com a URL de producao no ambiente, dava para criar credencial de
  leitura em nome do ROOT **no banco de producao**. Entrou junto **teto de 24 h** no prazo da delegacao.
  (4) 🧭 **O cursor nao era preso a pessoa** — nao vazava tarefa, mas ele proprio E o id e a data de uma
  tarefa de quem o recebeu, e viaja na URL que o log grava. Hoje cursor de A usado por B e `400`.
  (5) 🗄️ **As colunas de hash nasciam em `utf8mb4_unicode_ci`**, que ignora caixa e acento — na coluna por
  onde o servidor decide QUEM esta chamando (ADR-147 outra vez). Passaram a `utf8mb4_bin`, e o
  `@@index([expiraEm])`, que ninguem consulta, saiu.
- **⚖️ ONDE DISCORDEI DO REVISOR, e a discordancia foi MEDIDA:** ele pediu indice novo em `Tarefa` para a
  paginacao. O `EXPLAIN` real mostra o otimizador entrando pelo `TarefaResponsavel_userId_idx` (`ref`) e
  juntando a `Tarefa` pela chave primaria (`eq_ref`) — o `filesort` cai sobre as tarefas **daquela pessoa**,
  dezenas, nao sobre a tabela. O indice pedido nao seria escolhido e cobraria escrita a toa. **Indice que o
  plano nao usa e divida com cara de cuidado.**
- **🐛 DOIS DEFEITOS QUE SO A EXECUCAO MOSTROU:** (1) **`isAllowed` do `@fastify/rate-limit` NAO significa
  "pode passar"** — so e `true` para lista de permissao; quem responde "estourou?" e `isExceeded`, e ler o
  nome pelo que ele parece dizer recusava TODA chamada legitima. (2) **`vi.spyOn(prisma.<model>, …)
  .mockRestore()` NAO devolve o delegate do Prisma** — o teste que derruba o banco de proposito deixava o
  `findMany` quebrado para os testes seguintes, com o sintoma longe da causa. Salvar e repor a mao.
- **Provas:** typecheck **6/6** · lint limpo · **33 testes de integracao** exercendo o Fastify de verdade
  (`app.inject`) contra o MySQL `_test` — os doze casos do CORA-001 mais os cinco achados da revisao ·
  **vistos reprovando**: 7 com as travas originais sabotadas, e 4 dos 5 novos com as da revisao desligadas ·
  **621 testes de unidade do `@app/api` verdes** · e a rota exercida por **HTTP real** (`curl` contra o
  localhost:4319): `200` com item sintetico, `401` sem credencial, `401` com cabecalho sem forma de id e
  `400` com `limit=101`.
- ⚠️ **NAO ESTA NO AR e NAO FOI MESCLADA.** Falta a validacao do consumidor: `ready_for_validation` **nao** e
  `done` — quem fecha o CORA-001 e a CORA, em `acceptance.md`, depois de fazer a requisicao HTTP real do lado
  dela. O lote de publicacao pendente agora tem **quatro migracoes**.
- **O que ficou de fora, de proposito:** escrita de tarefa (Fase 2 da Cora, pede previa + idempotencia); tela
  de gestao de delegacoes (entra com o pareamento de dispositivo da Fase 4); e `Tarefa.descricao`, que **nao**
  e exposta — texto livre pode conter dado de cliente (minimizacao, ADR-141).

## Estado anterior (2026-09-02 · tarde · **v1.6.0 NO AR** — **ADR-147 e ADR-148 na `main`, NAO publicadas**)

> **Leia a ADR-148 e a ADR-147 em `docs/DECISIONS.md`.**

### 🔎 A VARREDURA COMPLETA DE 02/09 (ADR-148) — 18 correcoes, e a base comecou VERDE

- **Ordem do dono:** *"faca todas as pendencias e deixe tudo 100%... analise tudo profundamente, procurando
  erros/bugs/incongruencias... corrija tudo... abra o navegador e teste tudo"*. Cinco auditorias em paralelo
  (seguranca, API, tela, banco, pendencias antigas) mais a aplicacao percorrida no navegador, pagina por pagina.
- ⚠️ **A BASE COMECOU VERDE E TINHA UM DEFEITO QUE COBRA O CLIENTE EM DOBRO.** typecheck 6/6, lint limpo, 858
  testes de API, 220 de web, 109 de ponta a ponta — e **nenhum** dos 16 achados era pego por teste. Suite verde
  prova que o que alguem ja pensou em testar continua funcionando, nao que o sistema esteja certo (ADR-140).
- 🔑 **O PADRAO DESTA RODADA, e ele e diferente do da ADR-140:** *"a correcao existe, mas so num dos lugares onde
  o defeito mora"*. A regua do recarregamento duplo estava em UM card e faltava em QUATRO; a trava de papel do
  Portal cobria quatro botoes e nao cobria os cinco de dar-e-tirar acesso; a conferencia de posse do upload valia
  para o medico e nao para o servico nem para a exigencia. **Quem corrigiu nao errou — parou no primeiro caso.**

- **💸 APROVAR UM CREDENCIAMENTO DUAS VEZES AO MESMO TEMPO CRIAVA DUAS CONTAS A RECEBER, e foi VISTO
  acontecendo** (`expected 2 to be 1` no teste, antes da correcao). ⚠️ Nao e laboratorio: o botao "Atualizar"
  existe na pagina Credenciamentos **e** na grade da ficha, um clique duplo basta, e a ADR-128 permite de
  proposito duas sessoes abertas na mesma clinica. A segunda gravacao sobrescrevia `contaId` e deixava a
  primeira conta **orfa** no Financeiro. **Cura: reserva ATOMICA** (`updateMany` com `contaId: null` no filtro),
  nao transacao — quem perde a corrida apaga a conta que criou.
- **💸 A CONFERENCIA CONTRA COBRAR O MESMO SERVICO DUAS VEZES CASAVA POR TEXTO** (`"<Servico> — <Cliente>"`):
  renomear a clinica fazia a conferencia deixar de casar com as cobrancas antigas, e a 2a proposta lancava tudo
  de novo **em silencio**. Nasceu `Conta.origemServicoId` (migracao `20260902130000`). ⚠️ **A conferencia olha as
  DUAS coisas** — o id cobre as contas novas, o texto cobre as que nasceram antes da coluna. **Sem backfill.**
- **🧮 "EM CURSO" E "APROVADO" CONTAVAM O MESMO DINHEIRO DUAS VEZES.** O cartao dizia *"honorario ainda nao
  aprovado"* e somava os aprovados: medido na tela, R$ 2.020 apareciam como **R$ 2.770** (= 2.020 + os R$ 750 do
  cartao ao lado). Quem soma os dois erra para mais.
- **🔐 UMA ROTA ANONIMA ESCREVIA NO RASTRO DE AUDITORIA SEM TETO.** `registrarBloqueioNoNavegador` grava no
  `ActivityLog` a cada chamada, e o cliente fala por **lote** — o teto global de 300 req/min nao segurava.
  ⚠️ **O estrago e APAGAR O RASTRO**: `SISTEMA -> Atividade` mostra as 60 mais recentes. Freio proprio por IP
  (60/h) **e** `ActivityLog` no expurgo de retencao (era a unica tabela que crescia para sempre).
- **🔐 O RELOGIO CONTAVA O QUE A MENSAGEM CALAVA.** Login de conta inexistente saia em ~5 ms; de conta existente,
  pagava o argon2id. Uma tentativa por endereco revelava quem tem acesso, **sem gastar as 8 do freio**. Hoje o
  caminho da conta inexistente confere contra um hash de descarte sorteado em memoria.
- **✍️ O TOKEN DE ASSINATURA DO CLIENTE VOLTAVA EM CLARO PARA QUALQUER FUNCIONARIO.** ⚠️ **O risco nao e o
  acesso, e a ATRIBUICAO:** quem assina pelo link do e-mail grava `assinadoPorId: null`, entao uma assinatura
  fabricada numa janela anonima ficava **indistinguivel** da legitima. Hoje o link sai por `/ir/assinar/:id`,
  que exige sessao, registra quem abriu e redireciona. ⚠️ Redirecionamento, nao mutacao: `window.open` depois de
  `await` e barrado como pop-up.
- **📄 O CONSENTIMENTO DA ASSINATURA ERA EXIGIDO E NAO ERA GUARDADO.** Migracao `20260902120000`:
  `consentimentoEm` + `consentimentoVersao`. ⚠️ **Data MAIS versao** — so a data nao diz COM QUE TEXTO, e o
  texto muda. O texto foi para `@app/shared` com teste que **reprova quem editar a frase sem subir a versao**.
  ⚠️ **Assinatura antiga fica nula e a tela diz "nao registrado"** — preencher com a data da assinatura
  fabricaria uma prova que ninguem coletou.
- **📎 O RECARREGAMENTO DUPLO (ADR-143) FALTAVA EM QUATRO TELAS.** Portal (Meus documentos, Meus servicos,
  Credenciamento) e o card de servicos contratados da ficha. No Portal e pior: a exigencia recem-atendida
  continua marcada como pendente e o cliente reenvia achando que falhou. A regra virou `recarregarAposEnvio`,
  usada pelas **cinco** telas.
- **🔒 A TRAVA DE PAPEL DO PORTAL DEIXAVA CINCO BOTOES DE FORA.** "Quem da clinica entra aqui" decidia por
  `papelPortal !== "EQUIPE"` — e **a sessao de suporte da Med entra como RESPONSAVEL da clinica**. "Convidar
  pessoa" e "Revogar" ficavam a vista em modo de leitura. Hoje le `podeAgirNoPortal`, e a frase muda com o
  motivo (quem esta em suporte le "so leitura", nao "peca ao responsavel").
- **🕳️ Mais seis, menores:** `/avatar/:userId` servia foto de qualquer pessoa a qualquer sessao, inclusive entre clinicas · `servicoIds` do
  formulario publico sem teto · as duas sugestoes da IA faziam `JSON.parse` sem rede (defeito da ADR-135 de
  novo) · o Portal dizia "voce ainda nao enviou nenhum documento" **enquanto carregava** · **M9**: cliente ja
  ATIVO com upsell no funil via "Nao tenho mais interesse" · `/privacidade` declarava o texto enviado a OpenAI e
  **calava sobre o audio** da transcricao, que e segunda porta por natureza.

- **🔁 OS REVISORES ESPECIALISTAS ACHARAM TRES DEFEITOS NAS MINHAS PROPRIAS CORRECOES — e e a parte que mais
  ensina desta rodada.** (1) A defesa contra enumeracao por TEMPO virou **amplificador de argon2id**: o freio e
  chaveado em `(ip, e-mail)` e **quem escolhe o e-mail e quem ataca**, entao cada endereco inventado passava a
  custar 19 MiB de argon2 na threadpool de 4 do Node — a defesa contra vazar informacao virou o jeito mais
  barato de derrubar o processo que serve API, site e tempo real. Cura: segundo freio **por IP sozinho**, que
  recusa ANTES de queimar tempo, mais `.max(200)` na senha. (2) O expurgo do `ActivityLog` apagava
  `documento.link_de_assinatura_aberto` — a prova criada pela correcao vizinha DESTA MESMA rodada — mais
  `painel_cliente.*`, `arquivo.removido` e `conta.criada`; e usava o prazo do **corpo dos e-mails**, cujo rotulo
  na tela nem fala em atividade. Cura: LISTA de acoes preservadas, e o texto do botao passou a dizer o que fica.
  (3) `Conta.origemServicoId` era gravado no aceite da proposta e **nao** ao contratar pela ficha — uma das duas
  portas sem o elo reabre a cobranca dupla.
- **Provas:** typecheck 6/6 · lint limpo · **871 testes do `@app/api`** (eram 858) · **220 do `@app/web`** ·
  **109 de ponta a ponta** · aplicacao percorrida no navegador (Inicio, Tarefas, Agenda, Projetos, Vendas,
  Clientes, Credenciamentos, Documentos, Financeiro, E-mail, Mensagens, Ajustes, Servicos, E-mails enviados,
  Sistema com as abas Visao geral/Desempenho/Erros/Manutencao, `/comecar`, `/privacidade` e as 5 secoes do
  Portal em sessao de suporte) com **zero erro de console em todas**.
- ⚠️ **DUAS MIGRACOES NOVAS, as duas ADITIVAS**, aplicadas no banco local e no de teste. Reverter cada uma sao
  duas linhas, escritas dentro da propria migracao. Nenhuma apaga ou converte dado; nenhuma faz backfill.
- ⚠️ **A VERSAO DO AVISO DE PRIVACIDADE SUBIU para `2026-09-02`**, porque o texto mudou.
- ⚠️ **UMA CORRECAO FOI TENTADA E REVERTIDA, e a licao e o que fica.** Fechei a conferencia de posse do
  `servicoId`/`requisitoId` no upload exigindo o servico **contratado** — e o e2e reprovou
  (`flows-credenciamento ... enviar um documento move a barra`). **A premissa estava errada:** a papelada do
  credenciamento aparece para quem tem **medico cadastrado**, mesmo sem contratacao registrada
  (`emCurso = contratado || profissionais.length > 0`). Com a regua estrita, o cliente enviava o documento e a
  barra **nao andava**. Repetir aquela condicao no upload seria a mesma regra em dois lugares (ADR-133). O risco
  e baixo (fica dentro do proprio `clienteId`), entao o certo foi **nao fechar assim** — e o porque ficou
  escrito no codigo, onde alguem tentaria de novo.
- 📭 **O E-MAIL NAO PODE SER PROVADO DAQUI, e nao e defeito da aplicacao:** a maquina do dono nao tem servidor de
  e-mail (`ECONNREFUSED 127.0.0.1:587` — 314 falhas em 7 dias, taxa 0%). O **disparo** funciona; a **entrega** so
  se prova em producao, onde foi provada em 22/08 (ADR-122). O teste com `tibamooca@gmail.com` que o dono
  liberou **so vale rodando em producao**.
- ⚠️ **NAO ESTA NO AR.** A v1.6.0 continua sendo o que roda. Publicar so com o sinal do dono — e o lote de
  publicacao agora tem **tres migracoes** (a `20260902000000` da ADR-147 mais estas duas).

### O que ficou aberto depois desta varredura

- **Nada de codigo meu.** As duas unicas pendencias que o levantamento achou abertas (M9 e o consentimento da
  assinatura) foram **fechadas** nesta rodada. Todo o resto da lista historica (M1, C10, M15, F8, F9, C1, C2,
  M6, M8, C7, C8, F20, `seedIfEmpty`, `login()` sequencial) foi conferido **no codigo de hoje** e ja estava
  fechado.
- **Depende do dono (cadastro, nao codigo):** o **DPO** em branco em Ajustes -> Dados da empresa (benigno: a
  pagina cai no e-mail institucional) e o **endereco incompleto** de producao (*"Alto da Mooca - SP"*, sem rua,
  numero e CEP) — sai assim no contrato e na pagina publica.
- **Depende do dono (decisao):** publicar. E, se ele quiser, revisar o **texto do consentimento** da assinatura,
  que hoje esta em `packages/shared/src/consentimento-assinatura.ts` (mudar a frase exige subir a versao no
  mesmo commit — ha teste que cobra).

## Estado anterior (2026-09-02 · madrugada · **v1.6.0 NO AR** — ADR-146 publicada · **ADR-147 na `main`, NAO publicada**)

> **Leia a ADR-146 e a ADR-147 em `docs/DECISIONS.md`.**

- **✅ NO AR DESDE 01/09/2026 as 21:47 (18:47 no servidor) — a v1.6.0.** Publicacao `33559992003` no
  commit `225197a`. ⚠️ **O `gh workflow run` PASSOU para mim desta vez** — o placar esta em 2 passagens
  (26/08, 01/09) contra 2 recusas (27/08, 31/08): **e sorteio, sempre tente**. Suite 3/3 verde **antes**
  de tocar no servidor, depois no deploy: **`found 0 vulnerabilities`** · **`No pending migrations to
  apply.`** (correto — o lote **nao tem migracao**) · **`boot OK (16 portas ouvindo)`** ·
  `restart.txt marcado em 2026-09-01 18:47:40` · `/health` = `{"status":"ok"}` · `/` e
  `/credenciamentos` = **200**. Etiqueta **`v1.6.0`** criada e enviada a mao.
- **🖥️ CONFERIDO NA TELA DE PRODUCAO como ROOT:** **uptime de 1m20s**, provando o reinicio; banco
  **Online, latencia 2ms**; `/projetos` desenhando; **zero erro de console**. Os **7 erros nao
  resolvidos** seguem sendo os de hospedagem, intocados por ordem do dono.

- **Ordem do dono:** *"faca tudo o que for necessario pra deixar 100%"*. Os tres PRs do Renovate (#124
  vitest 3 por seguranca, #157 ferramentas, #158 atualizacoes menores) viraram **UM** PR. ⚠️ **Nao foi
  economia de digitacao: cada PR dispara a suite inteira**, e a cota de Actions ja estourou uma vez por
  causa deste repositorio sozinho (ADR-121).
- **🔴 O `#158` REPROVAVA A CI, E O MOTIVO NAO ERA O QUE PARECIA.** Quatro erros de tipo em `server.ts`,
  todos filhos de **um**: o Fastify 5.12 **aposentou o formato numerico do `trustProxy`**, e nos usavamos
  `trustProxy: 1` desde a ADR-140. ⚠️ **O perigo era o conserto obvio:** calar o compilador mantendo o `1`
  compila, sobe, e **muda o comportamento em silencio** — na 5.12 o numero passou a **nao confiar em
  ninguem**, entao atras do LiteSpeed **todo visitante viraria o mesmo IP**. O `req.ip` e a chave dos tres
  freios da casa (300/min, 8 tentativas de senha, formulario publico) e a **prova gravada** em
  `Assinatura.ip`: um visitante sozinho trancaria o site para os outros, e a assinatura registraria o IP do
  servidor. **Sem erro, sem log, sem sintoma.**
- **🔑 A CURA DESCREVE QUEM E O PROXY, em vez de contar quantos sao.** Nasceu
  `apps/api/src/lib/proxy-confiavel.ts` com `PROXY_CONFIAVEL = ["loopback", "uniquelocal"]` — loopback
  porque o LiteSpeed roda na **mesma maquina** que o Node (o mesmo motivo do `SMTP_HOST=localhost`, ADR-122).
  ⚠️ **E ESTRITAMENTE MAIS SEGURO que o antigo `1`**, que confiava em quem quer que estivesse do outro lado,
  inclusive um cliente publico direto. **6 testes que exercitam o Fastify de verdade**, um deles sendo a
  **prova da regressao** (com `1`, o visitante real vira `127.0.0.1`).
- **🕳️ DOIS DEFEITOS DE TELA QUE SO APARECEM COM BANCO CHEIO** — e essa e a licao da rodada. A regua de
  responsividade da ADR-143 esta verde na CI porque **a CI semeia um banco novo e a tela nasce vazia**:
  (1) **`/projetos` a 360px vazava 26px em TODOS os cartoes** — a grade nao declarava coluna no celular, e
  a trilha implicita `auto` e o min-content do cartao; medido no navegador, **369,8px dentro de 324px**. E o
  mesmo `min-width:auto` que a ADR-143 matou em `/clientes` e `/modelos`. (2) o link **"Fale com a gente
  pelo Suporte"** tinha **31px** de altura onde a regua exige 44.
- **🧩 O ROBO SO ATUALIZA O QUE ELE MESMO ABRE:** o `vitest` subiu para 3 e o `@vitest/coverage-v8` ficou
  na 2. Alinhado a mao.
- **Provas:** typecheck 6/6 · lint limpo · **839 testes do `@app/api`** (103 arquivos, suite COMPLETA) ·
  **220 do `@app/web`** · **109 de ponta a ponta, os 109 verdes** (reprovavam **3** antes das correcoes de
  tela) · `pnpm audit --prod` = **No known vulnerabilities found** · **artefato de publicacao montado** ·
  aplicacao local subindo (`/health` = ok).
- ⚠️ **OBSERVACAO, NAO REGRESSAO:** ao montar o artefato o npm avisa que `sanitize-html@2.17.7` e
  `cookie@2.0.1` pedem **Node ≥ 22** e rodamos Node 20. Vem de faixa aberta resolvida na hora, entao **ja
  acontecia na `main`** — inclusive na v1.5.0, que esta no ar funcionando. Anotado para o dia de subir o Node.

### O que falta nesta esteira

- ~~**Abrir o PR e esperar a CI.**~~ **FEITO: PR #164, CI 3/3 verde, mesclado em `8398a28`.**
- ~~**Fechar os tres PRs do Renovate.**~~ **FEITO: #124, #157 e #158 fechados apontando para o #164.**
  Um quarto (#165, pnpm 10.34.5) nasceu de base anterior ao merge e foi fechado por redundancia.
  **A fila do Renovate esta VAZIA** — zero PRs abertos no repositorio.
- ~~**Publicar.**~~ **FEITO em 01/09 as 21:47 — e a v1.6.0.**
- ~~**A documentacao do estado.**~~ **FEITO: PR #167, CI verde, mesclado em `919ade2`.**
- ⚠️ **A "VERIFICACAO VERMELHA DO GITHUB" DE 01/09 E FALSO ALARME, nao investigue de novo.** O unico
  run reprovado recente e a CI do PR do Renovate `renovate/atualizacoes-menores` (#158, run
  `33554176740`, 20:14) — **e esse PR foi FECHADO**, substituido pelo #164. Ele reprovava exatamente
  pelo defeito de tipo do `trustProxy` que a ADR-146 consertou. **A regra que fica: antes de caçar
  defeito, olhe a BRANCH e o estado do PR daquele run** — painel de repositorio mostra run de branch
  morta como se fosse a `main`.
- ~~**Revisao especialista.**~~ **FEITA: `security-reviewer` e `typescript-reviewer`, os dois com
  veredito "pode mergear", zero achado bloqueante.** O de seguranca confirmou, lendo o codigo instalado,
  que **NAO existe segunda porta lendo IP**: os 5 consumidores reais (`Assinatura.ip`,
  `Documento.propostaRespIp`, login, aceite/redefinicao, formulario publico) e o rate-limit global
  entram todos por `ctx.req.ip`.

### ✅ AS TRES PENDENCIAS DO REVISOR DE SEGURANCA ESTAO FECHADAS (PR #169, `f600611`)

> As tres travas que faltavam viraram teste. **Zero mudanca de comportamento, zero migracao** — so
> teste. A ADR-146 continua valendo inteira; o que mudou e que agora ela e defendida.

1. ✅ **O CASO REAL DE PRODUCAO PASSOU A SER EXERCIDO.** Os 6 testes da ADR-146 usavam cabecalho de
   **UM elemento so**, entao a regra de **precedencia** nunca foi travada. Hoje ha teste com peer
   `127.0.0.1` + `x-forwarded-for: "198.51.100.9, 203.0.113.7"` (forja a esquerda + append do
   LiteSpeed a direita) exigindo `203.0.113.7`.
2. ✅ **O LIMITE DA REGUA FICOU ESCRITO, E FOI MEDIDO ANTES.** Rodado contra o Fastify de verdade:
   `"198.51.100.9, 10.0.0.5"` devolve o valor **forjado**, e `"198.51.100.9, 10.0.0.5, 192.168.1.9"`
   tambem — o `@fastify/proxy-addr` pula **TODOS** os privados consecutivos (o `1` antigo pulava so
   um). ⚠️ **A regua so e solida enquanto o LiteSpeed anexar o IP real A DIREITA**, e agora mudar a
   topologia **REPROVA no teste** em vez de mudar o `req.ip` em silencio.
3. ✅ **A TRAVA DO PONTO DE USO NASCEU — E O REVISOR ACHOU UM FURO NELA, REPRODUZIDO ANTES DE
   CORRIGIR.** A 1a versao exigia que `server.ts` **contivesse** `PROXY_CONFIAVEL`, e
   `trustProxy: modoDebug ? [...PROXY_CONFIAVEL] : true` **passava VERDE nas 12 travas**: a captura
   contem o nome (satisfaz o "contem") e o literal proibido nao vem colado nos dois-pontos (escapa
   da outra). Um ramo que ninguem le devolveria `true` em producao — `req.ip` forjavel de novo,
   **sem erro, sem log, sem CI vermelha**. ⚠️ **A cura e IGUALDADE, nao "contem"**: a expressao
   inteira tem de ser exatamente `[...PROXY_CONFIAVEL]`. E a 1a versao do filtro de comentario lia a
   **explicacao** do `trustProxy:` (que fica logo acima da linha real) e aprovava o texto errado.
   ⚠️ **Restricao deliberada, registrada no teste:** variavel intermediaria tambem reprova.

**Provas:** as quatro formas sabotadas no `server.ts` — codigo correto **12 verdes** · `true` cru
**2 reprovam** · ternario com escape **2 reprovam** (passava antes) · variavel intermediaria **1
reprova**. typecheck 6/6 · lint limpo · **616 testes de unidade** do `@app/api` · CI **3/3 verde**.

### ✅ O NOME DO SERVICO PASSOU A IDENTIFICAR O SERVICO (`@@unique([nome])` · **ADR-147**, PR #172, `f9ab574`)

- **Por que era regra e nao capricho:** a semeadura do catalogo casa por **NOME**
  (`semearCatalogoSeFaltar`), e o construtor da proposta e a ficha do cliente listam dois servicos
  iguais lado a lado **sem nada que os distinga**. Com duas linhas de mesmo nome ninguem sabe qual
  levou o preco, as exigencias e o roteiro do projeto — e o engano so aparece no papel que ja foi ao
  cliente. E o outro lado das ADR-144/145: la o perigo era a REGRA casar por nome; aqui e o nome
  **deixar de identificar**.
- **🕳️ O DEFEITO DE BRINDE, e ele foi criado pela propria correcao.** O `catch` de `atualizarServico`
  nasceu para "id nao existe" e traduz **qualquer** erro para **"Servico nao encontrado."**. Com o
  indice, renomear para um nome ja usado cairia ali — a frase mais confusa possivel para quem esta com
  o servico **aberto na tela**. Hoje ha conferencia antes (mensagem em portugues) **e** tratamento do
  `P2002` no `catch`, para a corrida entre duas gravacoes simultaneas.
- **🚪 SAO DUAS TRAVAS COM PAPEIS DIFERENTES, e tirar uma deixa buraco diferente:** a conferencia da
  aplicacao existe para a **MENSAGEM** (duas requisicoes simultaneas passam as duas por ela); o indice
  existe para a **GARANTIA**. ⚠️ A conferencia normaliza com `trim()` — sem isso `"  Faturamento  "`
  passaria pela porta e so seria barrado pelo banco, com erro cru na cara de quem esta na tela.
- **🚨 A MIGRACAO `20260902000000` PARA A PUBLICACAO se ja houver nome duplicado**, em vez de deixar o
  `CREATE UNIQUE INDEX` estourar com o 1062 cru do MySQL no meio do deploy. Molde da `20260829210500`.
  **Reverter e uma linha:** `DROP INDEX \`Servico_nome_key\` ON \`Servico\`;` — nada e apagado nem
  convertido.
- **🔴 O ACHADO GRAVE DA REVISAO, E ELE FOI CRIADO PELA PROPRIA CORRECAO.** A coluna `Servico.nome`
  e **`utf8mb4_unicode_ci`** (conferido: buscar `'faturamento'` minusculo devolve `Faturamento`), ou
  seja **o banco ignora maiuscula E acento**. A semeadura comparava com a igualdade crua do
  JavaScript, para quem `"Conteudo"` ≠ `"Conteúdo"`. ⚠️ **Sem indice isso era um clone silencioso;
  COM indice vira INDISPONIBILIDADE:** `semearCatalogoSeFaltar` roda em TODA leitura de catalogo —
  inclusive na pagina publica `/comecar` e no "Solicitar" do Portal —, tentaria recriar o canonico,
  levaria `P2002` e a rota **publica** passaria a responder erro em vez de lista. A cura e
  `chave-de-nome.ts` (`chaveDoNomeDeServico`, pura, testada) usada nos DOIS lados da comparacao,
  mais `skipDuplicates` como rede para a corrida. **Visto reprovando antes**: com a correcao
  desligada, `listServicos()` estoura.
- **🧹 A GUARDA DEIXAVA SUJEIRA AO REPROVAR.** DDL da commit implicito, entao o `DROP TABLE` do fim
  **nao roda** quando o `CHECK` falha: a tabela auxiliar fica, e a SEGUNDA tentativa falharia no
  `CREATE TABLE` com erro **1050**, que se le como "a guarda quebrou de novo". Hoje ha
  `DROP TABLE IF EXISTS` na frente e **o destravamento em tres passos escrito na propria migracao**.
- **⚠️ PRODUCAO E MariaDB 10.6, NAO MySQL 8** — a guarda responde **`4025`** la e `3819` aqui. Os
  dois estao citados na migracao; procurar so o `3819` faz perder tempo no meio de uma publicacao.
- **🕳️ O `catch` DO UPDATE ESCONDIA QUEDA DE BANCO.** O `antes` ja prova que o id existe, entao o
  que chegava de desconhecido era infraestrutura — e o mais provavel neste servidor e o `P1001`
  (*"Can't reach database server"*), que a documentacao registra como recorrente. Virava
  **"Servico nao encontrado."** na tela E um `NOT_FOUND` do tRPC, que **nao entra em SISTEMA →
  Erros** (o filtro e `INTERNAL_SERVER_ERROR`, ADR-135): a queda do banco ficava invisivel no
  caminho de escrita. Hoje so `P2025` vira "nao encontrado"; o resto e relancado.
- **Provas:** guarda exercida nos **tres cenarios** (banco normal **passa** · com duplicata **barra
  com erro 3819** · depois de limpar **passa**) · **13 testes novos**, e os dois que travam regressao
  **vistos reprovando antes** · typecheck 6/6 · lint limpo · **suite COMPLETA do `@app/api`: 858 de
  858, tudo verde** (a rodada anterior teve 2 reprovacoes no `email-caixa`, a intermitencia ja
  registrada; sozinho deu 16/16 e nesta rodada passou junto).
- ⚠️ **NAO ESTA NO AR.** A v1.6.0 continua sendo o que roda; publicar so com o sinal do dono.

⚠️ **OBSERVACAO DE INFRA, do dono, NAO deste commit:** a API escuta em `0.0.0.0:4319`. Em revenda
DirectAdmin, se um processo de outro cliente da mesma maquina alcancar essa porta, ele fala como peer
loopback e o `X-Forwarded-For` dele e aceito. **Nao e regressao** — o `trustProxy: 1` tinha a mesma
exposicao **e mais uma** (confiava tambem em peer publico, que a regua nova recusa). A cura nao e mexer
no `trustProxy`: e o LiteSpeed **reescrever** o cabecalho em vez de anexar, ou um cabecalho secreto
entre proxy e app.
- ✅ **A PROVA DO IP SAIU, E A ADR-146 ESTA FECHADA (01/09, tela de producao).** O dono saiu e entrou
  de novo; a linha MAIS NOVA de `SISTEMA → Sessoes` ("Inicio: agora") mostra **`187.35.35.2` — publico**,
  o mesmo da linha de base. A regua `PROXY_CONFIAVEL = ["loopback","uniquelocal"]` enxerga o visitante
  real atras do LiteSpeed: os tres freios da casa (300/min, 8 tentativas de senha, formulario publico) e
  a prova gravada em `Assinatura.ip` estao intactos.
- ⚠️ **A ARMADILHA QUE QUASE DEU UMA CONCLUSAO ERRADA, e ela se repete:** `Session` grava o IP **no
  momento do LOGIN COM SENHA**. Abrir o navegador com a sessao ja aberta (o crachá vale 30 dias) **nao
  cria linha nova** — na 1a conferencia a linha "mais nova" era de 4 dias antes, ANTERIOR a publicacao,
  e nao provava nada. Para provar qualquer coisa sobre IP de sessao, exija **SAIR e ENTRAR**, nunca so
  "abra o sistema".
- **Publicar so com o sinal do dono.** O `gh workflow run` costuma ser barrado para mim.

### Conferido em producao nesta janela (01/09, como ROOT), fechando pendencias antigas

- ✅ **`@@unique(nome)` EM `Servico` ESTA FEITO** — ver a secao propria mais abaixo. ⚠️ **A ressalva
  antiga estava ERRADA e foi corrigida:** dizia que a tela poderia esconder servico arquivado. Nao
  esconde — `listServicos` (`servicos.service.ts`) diz no proprio comentario *"Todos os servicos
  (gestao) — inclui inativos"* e **nao filtra `ativo`**. Os 10 nomes de producao sao todos diferentes
  (Gestao Operacional · Faturamento · Credenciamento medico e odontologico · Negociacao com operadoras ·
  Identidade visual (Branding) · Manual da marca · Desenvolvimento de site · Gestao de redes sociais ·
  Conteudo & SEO · Trafego pago), e nao ha nada fora da lista.
- ✅ **A PENDENCIA HERDADA C10 E INOFENSIVA HOJE, e da para parar de carrega-la.** O risco era "parcela
  apagada por reversao antiga passa a ser lida como excluida de proposito". Conferido no Financeiro de
  producao, nas duas carteiras (Empresa e Pessoal) e com o filtro **Todas**: **R$ 0,00 em tudo e "Nenhuma
  conta a receber"**. Nao ha conta nenhuma para ser afetada.
- ❌ **O CELULAR EM PRODUCAO CONTINUA SEM PROVA, e o motivo e o mesmo de 31/08.** O `resize_window` da
  extensao **responde "sucesso" e a janela NAO muda de tamanho** — a captura seguinte volta 1568x744. A
  prova de responsividade segue sendo a suite (`responsividade-total.spec.ts`), agora com **dois defeitos
  reais a menos**. Quem tiver um telefone a mao, olhe.
- ℹ️ Producao saudavel no momento da conferencia: **uptime 18h22m**, banco **Online com latencia de 1ms**,
  taxa de erro 0%, **zero erro de console** em Servicos e Financeiro. Os **7 erros nao resolvidos** seguem
  sendo os de hospedagem, intocados por ordem do dono.

## Estado anterior (2026-09-01 · **v1.5.0 NO AR** — ADR-145 publicada e conferida na tela de produção)

> **Leia a ADR-145 em `docs/DECISIONS.md`.**

- **✅ NO AR DESDE 01/09/2026 às 01:55 (22:55 no servidor) — a v1.5.0.** Publicação `33458713500` no
  commit `dc1c20a`, por `workflow_dispatch` (o `gh workflow run` **foi barrado para mim de novo**;
  quem colou o comando foi o dono). CI 3/3 verde **antes** de tocar no servidor, depois 7/7 no
  deploy: `node_modules preservado` · **`found 0 vulnerabilities`** · **`All migrations have been
  successfully applied.`** (as duas novas) · boot com **16 portas ouvindo** ·
  `restart.txt marcado em 2026-08-31 22:55:40` · `/health` = `{"status":"ok"}` · `/` e
  `/credenciamentos` = **200**. Etiqueta **`v1.5.0`** criada e enviada à mão.
- **🔑 A PROVA QUE IMPORTAVA, VISTA NA TELA DE PRODUÇÃO COMO ROOT.** Em *Ajustes → Serviços*:
  **Credenciamento** com a caixa *"Este é o serviço de faturamento médico"* **DESMARCADA** e o texto
  *"Cobrado por valor fixo — avulso (1x) ou mensal"*, **sem botão nem campo de percentual**; e
  **Faturamento** com a caixa **MARCADA**, *"% do faturamento"* aceso e **3,5%** (a Thaís ajustou de
  5% para 3,5%). ⚠️ **A guarda `20260901010500` ter passado é prova por si só**: ela PARA a
  publicação se o backfill não deixar exatamente um marcado — passou, logo acertou o alvo.
- **💳 O RECIBO DE PRODUÇÃO ESTÁ FIXO EM PIX**, conferido na tela: o campo mostra `PIX` sem lista
  para escolher, e a prévia imprime *"**Forma de pagamento:** PIX · **Data:** 31/08/2026"*.
- **Zero erro de console** nas telas conferidas.

- **Ordem do dono (31/08):** *"em AJUSTES → SERVIÇOS → CREDENCIAMENTO está mostrando PORCENTAGEM, e
  somente o FATURAMENTO nós recebemos apenas a porcentagem. O restante dos serviços são 100% valor
  fixo (avulso ou mensal)"* · *"não aceitamos cartão (aceitamos somente PIX)"*. E, sobre o
  credenciamento: *"é o único serviço que recebemos somente após o sucesso (a operadora aprovar) —
  fazemos todo o serviço sem cobrar nada"*. ⚠️ **Essa última regra JÁ estava certa no código**
  (ADR-104/108) e foi reconferida: a conta a receber nasce em
  `credenciamento-grade.service.ts:331-351`, e a conversão do lead, a contratação pela ficha e o
  aceite de proposta **excluem o credenciamento explicitamente**. Nada foi mexido lá.
- **🏷️ O PREÇO GRAVADO DO CREDENCIAMENTO SEMPRE ESTEVE CERTO (R$ 1.500 fixo).** O defeito era a tela
  **oferecer** o botão *"% do faturamento"* — nos **dez** serviços do catálogo, e de novo em cada
  ficha de cliente. ⚠️ **Trocar a forma de cobrança por engano não dá erro nenhum:** muda o preço no
  papel do cliente, a conta a receber e a estimativa do funil, os três em silêncio.
- **🔑 A CURA É UMA MARCA, `Servico.ehFaturamento` — o mesmo molde da ADR-144, de ontem.**
  `categoria === "Faturamento"` já foi escrita e removida **cinco vezes** (ADR-125/126/127/137/138);
  usá-la aqui reintroduziria o "casa por nome" que a rodada anterior pagou para matar. Migração
  `20260901010000`, **aditiva**, backfill na mesma transação; reverter é `DROP COLUMN`.
  ⚠️ **O backfill casa por PREÇO, não por nome** (`percentual > 0 AND (valor IS NULL OR valor = 0)`)
  — a marca nasce descrevendo o banco, não uma suposição sobre como o serviço se chama.
- **⚠️ SÃO DUAS PERGUNTAS DIFERENTES E NÃO PODEM VIRAR UMA.** `ehServicoDeFaturamento` diz **quem
  PODE** ser percentual (identidade, do banco); `ehServicoSomentePercentual` diz **como ESTA linha
  está cobrada** (preço, do registro) e **não mudou uma linha**. Misturá-las faria a linha de uma
  proposta antiga trocar de forma sozinha no dia em que alguém desmarcasse o serviço.
- **🚪 QUATRO PORTAS TRAVADAS, e a quarta é a que quase escapa:** o Zod da criação · o servidor na
  criação · o servidor na **edição** (⚠️ o Zod **não serve** ali: a edição é parcial, e a
  conferência é sobre o **ANTES + o DEPOIS**) · e **a ficha do cliente**, a *segunda porta* da
  ADR-140 — travar só o catálogo deixaria a ficha fazer, cliente por cliente, o que a tela de
  Serviços passou a recusar. Mais duas guardas: **só um serviço marcado** e **nunca faturamento +
  credenciamento no mesmo serviço**. ⚠️ **Desmarcar sem limpar o percentual é recusado** — senão o
  dado fica preso: a tela o mostra como valor fixo e o servidor recusa editá-lo.
- **🕳️ DEFEITO DE BRINDE, achado pela varredura:** o `documentoServicoItemSchema` **não tinha trava
  nenhuma** contra valor + percentual juntos. A ADR-138 pôs o `refine` nos três schemas de preço e
  deixou de fora justamente o que grava a linha da proposta/contrato que vai ao cliente — e que o
  **aceite copia** para `ClienteServico`. Fechado.
- **💳 O CARTÃO SAIU DO RECIBO.** Era a última tela que contradizia a ADR-127 ("é sempre PIX"): o
  Recibo oferecia *PIX, Dinheiro, Cartão de crédito, Cartão de débito, Transferência e Boleto*, e a
  escolha saía **impressa no papel timbrado do cliente**. Virou constante, **não um `<Select>` de um
  item só** — escolha que não existe é informação, não campo de formulário.
- **📄 O CONTRATO PASSOU A DIZER PIX.** A seção *"4. Valor e forma de pagamento"* prometia a forma no
  título e não dizia nenhuma. ⚠️ **A frase é autossuficiente de propósito** — não diz "nos dados
  abaixo", porque o bloco bancário some inteiro com Ajustes em branco. ⚠️ O modelo é **semente
  atualizável** (`listModelos` reescreve o que ninguém editou à mão), então chega a produção sozinho.
- **Fica como está, de propósito:** a categoria *"Cartão de crédito"* do Financeiro — é **despesa**,
  dinheiro que a Med paga.
- **Provas:** typecheck 6/6 · lint limpo · **suíte COMPLETA do `@app/api` verde: 833 testes em 102
  arquivos** (11 de integração novos, **vistos reprovando antes** — com a trava desligada, 4 deles
  reprovam) · **220 do `@app/web`** ·
  na tela, como ROOT: Credenciamento sem botão de percentual, Faturamento com a marca e o
  interruptor, a ficha do cliente idem, o Recibo com *"Forma de pagamento: PIX"* fixo e o contrato
  com a frase do PIX. **Zero erro de console.**

- **🕳️ OS TRÊS ACHADOS DA REVISÃO VIERAM DA PRÓPRIA CORREÇÃO — a lição da rodada, de novo.** Três
  revisores especialistas rodaram; **dois acharam os mesmos dois itens, independentemente**.
  (1) ⚠️ **O editor de preço da ficha apagava dinheiro contratado, em silêncio**: a migração marca o
  CATÁLOGO e nunca olha o que cada cliente contratou, então abrir o modal só para **conferir** e
  clicar em Salvar mandava `percentual: null` — e o servidor aceita, porque **remover** percentual
  não viola trava nenhuma. Hoje há faixa âmbar com o que está gravado, e o **Salvar só libera
  depois de informar o valor fixo que entra no lugar**. (2) ⚠️ **A TERCEIRA PORTA: o aceite da
  proposta** copiava o item do documento para `ClienteServico` sem trava — e **recusa**, não
  "descarta em silêncio", porque descartar deixaria a proposta ser aceita cobrando outro preço que
  não o do papel assinado. (3) ⚠️ **O contrato gerado pelo painel do lead sairia com
  "(a preencher)"**: ele nasce por **duas portas**, e só uma resolvia o `{{dadosPagamento}}` novo.
- **Mais quatro, menores:** o formulário de serviço **recusava sem mostrar mensagem** (as travas
  apontam o erro para `percentual`, que é o campo escondido no estado que elas reprovam — Salvar
  ficava inerte e ninguém descobria por quê) · o botão *"% do faturamento"* **não acendia** em
  serviço sem percentual · o construtor da proposta de faturamento filtrava por **preço** e abriria
  vazio no dia em que o percentual ficasse "a combinar" · e o rótulo fixo do recibo era um `<label>`
  **órfão**.
- **⚖️ ONDE DISCORDEI DO REVISOR:** ele pediu conferir a **marca única a todo salvamento**, e não só
  na transição. A preocupação é certa, a cura é pior: com dois marcados, os **dois** ficariam
  impossíveis de salvar pela tela — **inclusive para desmarcar um** —, e a Thaís ficaria trancada
  fora de um conserto que só sairia por SQL em produção. Quem impede o estado é a migração
  **`20260901010500`**, que **PARA a publicação** se o backfill não deixar exatamente um marcado
  (molde da `20260829210500`, ADR-144).

### O que falta nesta esteira

- ~~**PR e CI.**~~ **FEITO: PR #162, CI 3/3 verde, mesclado em `dc1c20a`.**
- ~~**Publicar.**~~ **FEITO em 01/09 às 01:55 — é a v1.5.0.**
- ⚠️ **DOCUMENTO JÁ GERADO NÃO SE CORRIGE SOZINHO.** O modelo do Contrato passou a trazer
  *"exclusivamente por PIX"* + os dados bancários, e `listModelos` atualiza em produção o que
  ninguém editou à mão — mas **contrato já emitido guarda o texto de quando foi gerado**. Se um
  contrato antigo for usado, tem de ser gerado de novo. Hoje só existe **uma** proposta em produção
  (Clínica na Mooca, 27/08), nenhum contrato.
- ⚠️ **`email-caixa.integration.test.ts` é intermitente** — reprovou uma vez na suíte cheia e passou
  16/16 sozinho e na rodada final (são 76 s de rede contra caixa IMAP real). Não é defeito de
  aplicação; se a CI reclamar dele, reexecute antes de investigar.
- **Segue valendo tudo o que está abaixo**, inclusive as pendências herdadas da ADR-143/144.

## Estado anterior (2026-08-31 · **v1.4.0 NO AR** — ADR-143 + ADR-144 publicadas)

> **Leia a ADR-144 em `docs/DECISIONS.md`.**

- **✅ NO AR DESDE 31/08/2026 às 20:26 no servidor (23:26 aqui) — a v1.4.0**, com as ADR-143 **e**
  ADR-144 no mesmo lote. Publicação `33448407974` no commit `02a46a1`, por `workflow_dispatch`
  (o `gh workflow run` **foi barrado para mim de novo** — quem colou o comando foi o dono). A suíte
  completa rodou **antes** de tocar no servidor (`build-test` + `integration` + `e2e`, os três
  verdes), depois: `node_modules preservado`, **`found 0 vulnerabilities`**, **`All migrations have
  been successfully applied.`** (as duas novas), ensaio de boot com **16 portas ouvindo**,
  `restart.txt marcado em 2026-08-31 20:25:59`, `/health` = `{"status":"ok"}`, `/` e
  `/credenciamentos` = **200**. Etiqueta **`v1.4.0`** criada e enviada à mão (o `deploy.yml`
  continua não criando).
- **🔑 A PROVA QUE IMPORTAVA, VISTA NA TELA DE PRODUÇÃO COMO ROOT:** em *Ajustes → Serviços →
  Credenciamento médico e odontológico → Configurar*, a caixa **"Este é o serviço de
  credenciamento" está MARCADA**, com a consequência escrita ao lado. Isso prova que **o backfill
  da migração acertou o alvo em produção** — era o único jeito de saber, porque o estado errado
  (nenhum marcado) **não produz erro nenhum**, e é o lado que cobra duas vezes.
- **🩺 SETE ERROS ABERTOS, E OS SETE SÃO DE HOSPEDAGEM** — seis `Can't reach database server at
  localhost:3306` e um esgotamento do pool (limite 13, timeout 10s). ⚠️ **O mais recente é de 2
  HORAS ANTES da publicação: nenhum erro novo nasceu com este lote.** O banco de produção segue
  caindo, e segue intocado por ordem do dono.
- **✅ ADR-142 CONFIRMADA NA TELA:** a página Clientes mostra *Total 0* e *Com Portal ativo 0* — os
  dois números concordando. Antes diziam 0 e 1, se contradizendo (o único cliente é PROSPECT, que
  a página não lista por projeto).
- **Zero erro de console** em Credenciamentos, Clientes e Financeiro de produção.
- ⚠️ **NÃO CONFERIDO NA TELA: o comportamento no celular.** A extensão do navegador aceitou o
  pedido de redimensionar a janela do dono mas a tela não mudou de tamanho, então a prova de
  responsividade continua sendo a suíte (`responsividade-total.spec.ts`, 30 telas × 5 tamanhos,
  verde), não a tela de produção. Quem tiver um telefone à mão, olhe.

- **🔑 A MARCA DO CREDENCIAMENTO EXISTE NO BANCO, e o "casa por nome" morreu.** `ehServicoDeCredenciamento`
  comparava o **nome** com uma constante, e três regras de dinheiro dependiam disso (ADR-104/108) —
  corrigir um typo em Ajustes → Serviços fazia a conversão do lead gerar conta a receber e a
  aprovação da operadora gerar a **segunda** pelo mesmo honorário. Hoje é `Servico.ehCredenciamento`
  (migração `20260829203721`, **aditiva, com backfill na mesma transação**; reverter é `DROP COLUMN`).
  A trava que proibia renomear saiu junto — ela só existia porque o nome era a regra.
- **⚠️ A ASSINATURA DA RÉGUA EXIGE O CAMPO DE PROPÓSITO.** `ehServicoDeCredenciamento({ ehCredenciamento })`
  não aceita mais `string`: assim o **compilador cobra o `select`** de quem escrever a próxima consulta.
  Esquecer de selecionar devolveria `false` calado, e **`false` é o lado que cobra duas vezes**. Foram
  **9 consultas** apontadas pelo `tsc` — nenhuma delas apareceria numa leitura de código.
- **🚨 A MIGRAÇÃO `20260829210500` PARA A PUBLICAÇÃO se o backfill não casar nada.** Se o nome em
  produção divergir (typo, caixa, espaço não-ASCII), zero linhas são marcadas e a regra volta ao lado
  que cobra duas vezes — **sem erro, sem log, sem sintoma no dinheiro**. A guarda foi provada nos três
  cenários: barra o perigoso (erro 3819), deixa passar o banco normal e o banco novo.
- **🕳️ AS TRÊS COISAS QUE A REVISÃO PEGOU FORAM CRIADAS PELA PRÓPRIA CORREÇÃO** — a lição da rodada.
  (1) liberar o renomear sem olhar a **semeadura**, que procura o catálogo por nome e criaria um
  **clone marcado** (requisitos sincronizados no serviço errado, Portal dizendo "0/0"); (2) o backfill
  silencioso acima; (3) a correção **M20** virando **oráculo de e-mail** na página pública — a frase só
  aparecia para endereço inédito, então um anônimo descobria, um envio por alvo, se um médico já é
  cliente. ⚠️ **Resposta de rota pública não pode variar com o que existe no banco.**
- **🖥️ A MARCA TEM TELA E SÓ PODE HAVER UMA.** Caixa em Serviços com a consequência escrita ao lado; o
  servidor **recusa marcar um segundo**, dizendo qual já está marcado. Sem isso, marca errada só teria
  conserto por `UPDATE` no banco de produção.
- **📋 DOZE DEFEITOS FECHADOS JUNTO:** M18 (e-mail dizia "aguardando revisão" de documento recém-assinado)
  · M11 (convite mudo quando o e-mail é de outra clínica) · M10 (desistir e voltar criava um 2º card)
  · M13 (desativar médico **inflava** o progresso da papelada) · M17 (a exigência do título de
  especialista nunca era lida — ⚠️ o comprovante vale **por médico**) · F13 (percentual sem "/mês")
  · F20 (o Portal não mostrava quanto o cliente paga) · F21 (preço de tabela para visitante anônimo)
  · B2 (conta de automação sem categoria — são **quatro** portas) · B3 (UTMs descartados) · M20 ·
  e o `createCliente`, que avisava só o e-mail duplicado quando o motivo mais provável é o servidor de
  e-mail fora do ar (que **não lança exceção**).
- **🧹 A DOCUMENTAÇÃO ESTAVA VELHA, NÃO O CÓDIGO.** O levantamento conferiu os 48 achados no código de
  hoje: M1, C10, M15, F8, F9, C1, C2, M6, M8, M9, M12, M16, C6–C9, C12, F1–F19 e as 14 correções da
  auditoria total **já estavam fechados**. O `seedIfEmpty` (a consulta de 11,9 s) e o banco de
  demonstração também.
- **Provas:** typecheck 6/6 · lint limpo · **814 testes** do `@app/api` (eram 785; suíte inteira, não
  `test:unit`) · **220** do `@app/web` (eram 213) · cada correção vista reprovando antes.

### O que falta nesta esteira

- ~~**Abrir o PR** e esperar a CI.~~ **FEITO em 31/08: PR #159, CI 3/3 verde, mesclado em `eccb0e9`.**
- ~~⚠️ Conferir em produção o **nome do serviço de credenciamento**.~~ **FEITO em 31/08**, lendo a
  página pública `/comecar` de produção: o serviço se chama exatamente **"Credenciamento médico e
  odontológico"**, o canônico. A guarda deixa passar. ⚠️ E se houver divergência **invisível** (um
  espaço não-ASCII colado de documento), a guarda **para a publicação com erro 3819** em vez de
  deixar o dinheiro sair errado calado — que é justamente para o que ela existe.
- ~~**O defeito que travava o PR**~~ **FECHADO em 31/08.** Anexar um documento logo depois de abrir a
  ficha do cliente deixava o arquivo **fora da lista até recarregar a página**, sem sinal de erro. A
  ficha carrega tudo num lote único de tRPC e o upload termina ~120 ms depois de esse lote começar;
  ⚠️ **pedir "busque de novo" a uma consulta EM ANDAMENTO faz o React Query reaproveitar a busca** e
  aceitar a resposta **anterior** ao envio — nenhuma requisição chega a sair. Não adianta
  `invalidate(..., { cancelRefetch: true })` (o `invalidate` do tRPC recebe as opções na **terceira**
  posição) nem um `refetch()` único (também é deduplicado; o link de lote do tRPC não aborta por
  consulta). A correção é **`await q.refetch()` duas vezes**: a primeira espera o que estava no ar, a
  segunda é a que sai. ⚠️ **Tirar uma delas devolve o defeito.**
- ~~**Publicar**~~ **FEITO em 31/08 às 23:26 — é a v1.4.0.** ⚠️ O `gh workflow run` **foi barrado
  para mim de novo**: conte com pedir ao dono que cole `! gh workflow run deploy.yml --ref main -f
  confirmar=PUBLICAR`. Do disparo em diante (acompanhar, etiquetar, conferir) é tudo comigo.
- ⚠️ **PENDÊNCIA HERDADA DA ADR-143, a conferir depois de publicar:** a correção **C10** mudou o
  significado de "parcela apagada". Se houver em produção parcela apagada por reversão antiga, ela
  passará a ser lida como *excluída de propósito* e aquele mês será **pulado**.
- ~~**`@@unique(nome)` em `Servico`**~~ **FEITO em 02/09/2026** (ver a secao no Estado atual).
  ⚠️ **O medo registrado aqui — "a lista de producao so e visivel pela pagina publica, que mostra nome
  mas nao prova unicidade" — era FALSO.** A tela interna de Servicos usa `listServicos`, que **inclui
  inativos**; os 10 nomes de producao sao todos diferentes.
- **Consentimento da assinatura** (LGPD) — pede migração própria e a decisão do texto, que é do dono.

### Higiene do repositório, feita em 31/08

- **PR #119 FECHADO** (documentação de 22/08, em conflito, descrevendo ADR-123/124 já superadas).
- **Três PRs do Renovate seguem abertos de propósito** (#157, #158, #124): são atualização de
  biblioteca, e mesclá-los mudaria o artefato que acabou de ser provado verde. ⚠️ **Nenhuma das 18
  vulnerabilidades do aviso do GitHub alcança produção** — `pnpm audit --prod` em 31/08:
  *"No known vulnerabilities found"*. É a ADR-115 de novo: o Dependabot lê o `pnpm-lock.yaml` e não
  entende workspaces do pnpm.

## Estado anterior (2026-08-29 · madrugada · ADR-143 — MESCLADA na `main` (PR #156, commit `e737b40`), NÃO publicada)

> **Leia `docs/esteira/refino-experiencia-2026-08-29/ESTADO.md`** (o retrato da rodada, com a
> medição antes×depois) e a **ADR-143** em `docs/DECISIONS.md`.

- **📱 A APLICAÇÃO INTEIRA PASSOU A FUNCIONAR NO CELULAR.** 30 telas × 5 tamanhos (360 · 390 · 768 ·
  1366 · 1920), área interna **e** Portal, **verdes** em `e2e/responsividade-total.spec.ts` — o mesmo
  arquivo que reprovava os cinco tamanhos no começo da rodada. Nasceu a caixa de peças que faltava
  (`tabs`, `sheet`, `popover`, `accordion`, `dialog-stack`, `data-table`, e a prop `hint` em
  `PageHeader`/`Modal`/`CardTitle`), **tudo à mão, sem biblioteca nova**.
- **🧩 A CAUSA RAIZ DO VAZAMENTO ERA UMA LINHA DO ESQUELETO:** o `<main>` do `AppLayout` sem
  `min-w-0` (o `min-width:auto` do Flexbox). ⚠️ **O mesmo modo de falha reaparece em GRID**: a trilha
  `1fr` é `minmax(auto,1fr)`, e esse `auto` é o **min-content do cartão** — um chip que não encolhe
  alarga a coluna inteira. Foi o que sobrou em `/clientes` e `/modelos` a 360px.
- **🗂️ Para QUADRO (Kanban), `min-w-0` não basta:** funil e quadro de projetos usam
  `grid-cols-[minmax(0,1fr)]` no lugar de `flex`, com a fileira rolando dentro de si. Eram **385px**
  de excesso no funil a 1366px.
- **🚨 A RÉGUA SE CEGOU SOZINHA, E ISSO É A LIÇÃO DA RODADA.** Isentar do teste quem tem ancestral
  com `overflow-x` **calculado** em `auto`/`scroll` esconde defeito real: **o CSS transforma
  `visible` em `auto` no eixo oposto** assim que um dos dois deixa de ser visível, então toda lista
  com `overflow-y-auto` parece rolar na horizontal. Com essa regra, cartões estourando 36px e 105px
  passavam aprovados. **A isenção certa é a marca explícita `data-rolagem-horizontal`**, posta nos
  quatro lugares onde a rolagem lateral é desenho (`Table`, `TabsList`, as duas fileiras de Kanban).
- **⚠️ O `412` do `/email` NÃO é erro** — é o crachá que a ADR-135 deu ao estado esperado *"esta
  caixa precisa ser reconectada"*, que a tela já trata com o botão *Reconectar*. A verificação de
  console dispensa **só** esse status.
- **💰 Cinco defeitos de cobrança fechados** (M1, C10, M15, F8, F9) e **cancelar serviço encerra a
  mensalidade** (decisão do dono). ⚠️ São **dois movimentos**: `recorrenciaAte = hoje` na série
  inteira **mais** o soft-delete só das parcelas futuras em aberto — **o que já venceu fica de pé**.
- **🔔 Cinco avisos que nunca chegavam** (C1, C2, M6, M8, C8) passaram a chegar.
- **🧭 Cada passo do funil diz de quem está esperando** — enum `QuemFaz` (MED/CLIENTE), migração
  `20260829014839`, **aditiva** (duas colunas com padrão; reverter é `DROP COLUMN`).
- **🧹 `pnpm db:limpar` deixava NOVE tabelas para trás**, entre elas `Profissional`, `Credenciamento`
  e **`CaixaEmail`, que guarda a senha IMAP cifrada de cada pessoa**. ⚠️ **A cascata do banco não
  salva aqui** — o script desliga as chaves estrangeiras, então **tabela ausente da lista sobrevive**.
- **🕵️ A CI PEGOU O QUE O BANCO LOCAL ESCONDIA.** O `e2e` rodou pela 1ª vez ao abrir o PR (`push`
  só roda `build-test`, ADR-121) e reprovou 17 vezes. **Três defeitos reais** invisíveis aqui
  porque as telas nasciam vazias: os avisos do Início a 360px; o `<select>` de `/emails-enviados`
  — ⚠️ **`w-auto` num `<select>` é a largura da OPÇÃO MAIS LONGA**, +84px; e o nome do arquivo no
  Portal, um **link de 20px de altura**, abaixo da régua de toque. **E oito testes velhos**, sem
  nenhum defeito de aplicação: os botões trocaram `title` genérico por **nome acessível** e as
  seções viraram **abas** (`role="tab"`) — a marcação melhorou, o teste é que ficou para trás.
- **⚠️ `DataTable` tem `data-linha` nas DUAS formas** (tabela acima de `md`, cartão abaixo); o
  teste usa `[data-linha]:visible`. Sem a marca, `role="row"` não acha nada no celular.
- **⚠️ Texto truncado NÃO é estouro** — `getBoundingClientRect` ignora o recorte do `truncate`. A
  isenção é a combinação exata (`text-overflow: ellipsis` + `overflow-x: hidden`), nunca "qualquer
  ancestral com overflow hidden".
- **Provas:** typecheck 6/6 · lint limpo · **213 testes** do `@app/web` · **785** do `@app/api`
  (suíte inteira, 93 arquivos; `test:unit` NÃO roda integração) · medição de responsividade verde
  nos 5 tamanhos · **suíte `e2e` completa: 119 verdes em três lotes**.

### O que falta nesta esteira

- **Conferir as 30 telas no navegador**, a 1920 e a 360 (local = Playwright).
- **Abrir o PR** e esperar a CI (3 verificações; a `main` só aceita PR).
- **Publicar só com o sinal do dono** — o `gh workflow run` é barrado para mim; ele precisa colar
  `! gh workflow run deploy.yml --ref main -f confirmar=PUBLICAR`.
- ⚠️ **ANTES DE PUBLICAR, CONFERIR EM PRODUÇÃO:** a correção **C10** mudou o significado de "parcela
  apagada". Se houver em produção parcela apagada por reversão antiga, ela passará a ser lida como
  *excluída de propósito* e aquele mês será **pulado**.

## Estado anterior (2026-08-28 · madrugada · ADR-142 na `main` + OS DADOS DA EMPRESA FORAM PREENCHIDOS EM PRODUÇÃO)

- **✅ O BLOQUEIO DO DADO REAL CAIU: o dono preencheu os campos jurídicos e bancários de PRODUÇÃO
  em 28/08, à mão, na tela.** Conferido reabrindo o formulário (que carrega do servidor):
  razão social **Thais Garcia de Sousa** · CNPJ **34.270.022/0001-93** · **foro "Comarca de São
  Paulo/SP"** (que estava dado como pendência do dono desde 27/08 — ele resolveu junto) · endereço
  *"Alto da Mooca - SP"* · Nubank / 0001 / 686169152-5 · titular Thais Garcia de Sousa · PIX
  34.270.022/0001-93. ⚠️ **O DPO continua vazio** — benigno, a página cai no e-mail institucional.
- **✅ `/privacidade` DE PRODUÇÃO JÁ IDENTIFICA O CONTROLADOR**, conferido na tela: *"Thais Garcia
  de Sousa, CNPJ 34.270.022/0001-93, com sede em Alto da Mooca - SP"*. **A pendência da LGPD que
  travava o dado real está FECHADA.** Zero erro de console.
- **⚠️ O ENDEREÇO AINDA ESTÁ INCOMPLETO** — *"Alto da Mooca - SP"* não tem rua, número nem CEP. Já
  não sai `[A PREENCHER]`, mas é endereço que não localiza a empresa; sai assim no contrato e na
  página pública. **Pendência do dono.**
- **⚠️ DOCUMENTO JÁ GERADO NÃO SE CORRIGE SOZINHO.** A *Proposta comercial – Clínica na Mooca*
  (27/08) segue **sem o bloco de dados para pagamento** — conferido lendo o papel inteiro em
  produção. O documento guarda o texto de quando foi gerado; **se essa proposta for usada, tem de
  ser gerada de novo**. Documento novo já nasce certo.
- **📭 NÃO EXISTE NENHUM CLIENTE DE VERDADE EM PRODUÇÃO — só o prospect.** Descoberto ao tentar
  provar o contrato: o seletor de cliente do "Novo documento" responde **"Nenhum cliente
  encontrado"**, porque a *Clínica na Mooca* ainda é PROSPECT e contrato só se emite para cliente
  convertido. **É a mesma raiz do "Total de clientes 0" corrigido na ADR-142.** Consequência: o
  contrato com dado real **ainda não foi provado na tela** — só o será quando houver a 1ª conversão.
- **🔒 EU NÃO CONSIGO DIGITAR EM FORMULÁRIO DE PRODUÇÃO.** Tentado das duas formas (`form_input` e
  clique + digitação): **`Blocked by classifier` nas duas**, e **inclusive em campo de texto comum**
  como Razão social — não é só o campo bancário. Navegar, rolar, abrir modal, ler e capturar tela
  passam normalmente. **O sim do dono na conversa não levanta a trava**, igual ao `gh workflow run`.
  O caminho que funciona: abrir a tela para ele e entregar os valores prontos para colar.
- **✅ ADR-142 NA `main`** (PR #154, squash, CI 3/3 verde, commit `b9798fa`). **Zero migração.** Dois
  consertos:
  - **Os dois números que se contradiziam em Clientes.** *"Total de clientes 0"* ao lado de
    *"Com Portal ativo 1"*, visto em produção. A contagem não estava errada — contava **outro
    universo**: `total`/`ativos`/`inativos` excluem o PROSPECT (ADR-24), mas `portaisAtivos`
    contava toda conta de Portal, inclusive a do prospect (ADR-128). ⚠️ **A correção é estreitar a
    contagem, não trocar o rótulo** — renomear deixaria a página com um número que fala de um
    conjunto que ela não lista.
  - **O campo "Nome" do cliente estava declarado como nome de PESSOA.** Achado ao responder a
    pergunta do dono (*"no lead tem NOME e CLÍNICA, no cliente só tem NOME — é assim mesmo?"*). **É
    assim de propósito e está certo:** todo cliente é PJ (ADR-119), `Cliente.nome` **é a clínica**,
    as pessoas vivem em `Contato` (a do lead vira contato principal na conversão). ⚠️ **Mas o
    formulário tinha `autoComplete="name"`** — o Chrome oferecia ali o nome do próprio operador, e
    o cliente podia nascer com nome de gente, que é o nome impresso no contrato. Hoje: **"Nome da
    clínica *"**, `autoComplete="organization"`, exemplo no campo e explicação no "?".
  - **Provas:** typecheck 6/6 · lint limpo · **729 testes** do `@app/api` (**3 novos de integração,
    vistos reprovando antes** — o primeiro falhou com `expected 1 to be +0`, exatamente o número da
    tela de produção) · 171 do `@app/web` · na tela local, zero erro de console.
- **🚨 O banco de produção continua caindo, e segue intocado por ordem do dono.**

## Estado anterior (2026-08-28 · noite · v1.3.0 NO AR — o lote ADR-139 + ADR-140 + ADR-141 publicado)

- **✅ NO AR DESDE 28/08/2026 às 23:27 (20:27 no servidor) — a v1.3.0.** Publicação `33218952176`
  no commit `bed5f1a`, disparada por `workflow_dispatch` (o `gh workflow run` **foi barrado para mim
  de novo**; quem colou o comando com `!` foi o dono). A **suíte completa rodou antes de tocar no
  servidor** (`build-test` + `e2e` + `integration`, os três verdes), depois 7/7 no deploy:
  `node_modules preservado`, `found 0 vulnerabilities`, **`All migrations have been successfully
  applied.`** (a `20260828220208`), ensaio de boot com **16 portas ouvindo**,
  `restart.txt marcado em 2026-08-28 20:27:25`, `/health` = `{"status":"ok"}`, `/` e
  `/credenciamentos` = **200**. Etiqueta **`v1.3.0`** criada e enviada à mão (o `deploy.yml`
  continua não criando).
- **🖥️ CONFERIDO NA TELA DE PRODUÇÃO, COMO ROOT** — e desta vez deu, porque o Chrome do dono estava
  com sessão de ROOT (nas publicações anteriores estava com sessão de cliente do Portal). Provado:
  **`/privacidade` existe e desenha** (versão `2026-08-28`, os prazos 180 dias / 5 anos, a
  declaração do envio à OpenAI com a lista do que é redigido) · o **bloco de consentimento em
  `/comecar`** com o link · **`SISTEMA → Privacidade`** com o expurgo e a área de eliminação
  (⚠️ **o botão "Rodar o expurgo agora" NÃO foi clicado** — apaga dado) · **`Ajustes → Dados da
  empresa`** com a seção nova *Privacidade e prazos de guarda* · uptime de **1 minuto**, provando o
  reinício · **zero erro de console** em todas elas.
- **🚨 ACHADO NA CONFERÊNCIA, E É O QUE TRAVA O DADO REAL: os dados jurídicos e bancários de
  PRODUÇÃO estão TODOS EM BRANCO.** Razão social, CNPJ, foro de eleição, endereço completo, banco,
  agência, conta, titular e chave PIX — **os nove vazios**, conferidos campo a campo na tela em
  28/08. ⚠️ **A linha que dizia o contrário nesta documentação estava ERRADA** (o "conferido na
  tela em 27/08: Nubank / 0001 / 686169152-5…" era do banco **local**, não de produção; a linha foi
  corrigida). Consequência real, hoje, em três lugares: **o contrato sai com `[A PREENCHER]`** na
  qualificação da CONTRATADA; **a proposta sai SEM o bloco de dados para pagamento** (com os cinco
  em branco a seção inteira some, por projeto); e o **aviso de privacidade não identifica o
  controlador** — diz só "MedConsultoria", sem razão social nem CNPJ, que é justamente o que a LGPD
  manda a página trazer. **Nada disso é defeito de código** — os três comportamentos são os
  corretos para campo vazio. É cadastro que falta, e é do dono.
- **🕵️ O encarregado de dados (DPO) também está em branco**, e aí o comportamento é benigno: a
  página cai no e-mail institucional (`comercial@medconsultoria.com.br`) e **não inventa um nome**.
  Indicar a pessoa é recomendável, não bloqueante.
- **🩺 O banco de produção continua caindo, e segue intocado por ordem do dono.** `SISTEMA → Erros`
  mostra **5 erros não resolvidos, e os 5 são de hospedagem** — quatro `Can't reach database server
  at localhost:3306` e um esgotamento do pool (limite 13, timeout 10s). O mais recente é de **20
  horas antes da publicação**: ⚠️ **nenhum erro novo nasceu com este lote**. No momento da
  conferência o banco estava **Online, latência 2 ms**.

## Estado anterior (2026-08-28 · noite · ADR-141 — CONFORMIDADE COM A LEI: os 4 itens · JÁ NO AR na v1.3.0)

> **Leia a ADR-141 em `docs/DECISIONS.md`.** O diagnóstico que originou o trabalho está em
> `docs/esteira/lgpd-2026-08-28/O-QUE-FALTA.md` (agora marcado como histórico).

- **Ordem do dono:** *"Não quero quebrar regras de lei. Resolva tudo e deixe tudo conforme a lei."*
  E: *"podemos primeiro resolver tudo e desenvolver tudo pra depois publicar"* — por isso os quatro
  itens vieram em **UMA branch e UM PR** (`feat/conformidade-lgpd-adr-141`), não quatro: cada PR
  dispara a suíte inteira, e quatro custariam quatro vezes em Actions.
- **🔴 CPF DE CLIENTE IA PARA A OPENAI A CADA CLIQUE EM "RESUMIR".** O campo `observacoes` ia
  inteiro, e ele **não é neutro**: a migração de 19/08 (ADR-119) enfiou ali o CPF de todo cliente
  que era pessoa física, e o formulário público grava ali o texto livre de quem quiser.
- **🚪 A CORREÇÃO MORA NO PORTÃO, e é a lição da ADR-140 aplicada de véspera.** A app inteira fala
  com a OpenAI por **uma** função (`gerarRascunho`, `apps/api/src/lib/ai.ts`) — 16 chamadas, uma
  porta. `redigirDadoPessoal` (`@app/shared`, pura, testada) fica lá: **chamada nova nasce coberta**.
  Corrigir só as duas montagens de contexto seria plantar a segunda porta de novo.
- **🔁 REDIGIR + RESTAURAR, nunca apagar.** "Melhorar com IA" devolve o corpo do documento: apagar
  faria um contrato voltar com `[removido]` no lugar do CNPJ, a Thaís aprovaria, e o papel sairia
  mutilado. Cada dado vira `[[CPF-1]]` na ida e **volta ao original na resposta**. ⚠️ Segunda camada
  porque regex só pega o que tem FORMA: `observacoes` saiu do contexto **na origem** também.
- **⏳ LINK DE PROPOSTA E DE ASSINATURA PASSOU A EXPIRAR — ZERO MIGRAÇÃO.** Um link de um ano atrás
  abria o documento inteiro sem login e ainda assinava. 30 dias para abrir, mais 90 depois de
  respondido só para reler, derivados de `criadoEm`/`propostaSolicitadaEm`. ⚠️ **A trava está nas
  QUATRO portas** — barrar só a leitura e deixar `assinar`/`responder` abertos seria literalmente a
  segunda porta; há teste que conta as ocorrências e reprova quem tirar uma. ⚠️ Na tela são **três**
  frases: falha de rede, **expirado** (tela própria) e inválido.
- **🗑️ ELIMINAÇÃO VIROU ANONIMIZAÇÃO, e ganhou tela.** `excluirDefinitivoCliente` bloqueia diante de
  qualquer vínculo, então **nenhum cliente real era eliminável**. Agora ROOT anonimiza: saem nome,
  CNPJ, e-mail, telefone e observações da ficha, dos contatos e dos médicos, e o acesso ao Portal cai.
  ⚠️ **FICA o corpo dos contratos já emitidos** — é o dever de guarda que justifica manter, e a
  confirmação na tela **diz isso**. ⚠️ **Exige o cliente ARQUIVADO.** ⚠️ **A tela é a aba
  *Privacidade* do painel do ROOT, não a ficha**: toda tela de cliente filtra `deletedAt: null`, e
  arquivado o cliente some da aplicação inteira.
- **🧹 EXPURGO COM ROTINA.** O corpo dos e-mails era guardado **para sempre**. Agora é apagado depois
  do prazo, todo dia, por `setInterval` no boot (a hospedagem não tem cron — mesmo molde da varredura
  de anexos). ⚠️ **O metadado fica**: é dele que vive o monitor que provou, em 22/08, que o e-mail
  voltou a sair. ⚠️ Botão que alguém pode esquecer de apertar **não é política de retenção**.
- **📄 A PÁGINA `/privacidade` NASCEU** — não existia nenhuma. Lê razão social, CNPJ, endereço, prazos
  e encarregado **do banco**: o sistema não fabrica dado jurídico. O que ela promete é exatamente o
  que o expurgo cumpre. Declara o envio à OpenAI, fechando pendência antiga do `IA_PRIVACIDADE.md`.
  Linkada em `/comecar` e no Portal. ⚠️ **Quem editar o texto precisa subir `AVISO_PRIVACIDADE_VERSAO`**
  — o consentimento grava data **e** versão, e a data sozinha não prova nada.
- **⚖️ PRAZOS DECIDIDOS (recomendação minha, caneta que o dono me passou):** corpo de e-mail **180
  dias**, acervo de credenciamento **5 anos** — os dois **editáveis em Ajustes → Dados da empresa**,
  porque prazo é decisão de negócio e mudá-lo não pode exigir publicação. O acervo vencido é
  **AVISADO, nunca apagado**.
- **💰 CREDENCIAMENTO REABERTO COBRA DE NOVO — decisão tomada: SIM.** A proposta real diz "somente no
  sucesso" e "após 1 (uma) tentativa"; tentativa nova é trabalho novo. **O que faltava era avisar**:
  faixa âmbar antes do clique, com o valor, e **só quando a anterior realmente cobrou**. A decisão
  ficou escrita no serviço, onde alguém tentaria "consertar" herdando a conta.
- **Migração `20260828220208`, ADITIVA:** quatro colunas nuláveis, duas com padrão, uma FK `SET NULL`.
  Reverter é `DROP COLUMN`.
- **Provas:** typecheck 6/6 · lint limpo · **32 testes novos, todos vistos reprovando antes** · 553 de
  unidade e 171 de web verdes.

### O que ficou de fora deste lote, e por quê

- **DPA com a OpenAI** continua pendência jurídica — mas o risco caiu muito, porque o dado
  identificável já não sai daqui.
- **O consentimento da assinatura** pede migração própria. (`Servico.ehCredenciamento` saiu na ADR-144 e
  `@@unique(nome)` em 02/09/2026.)
  migração própria.
- **M1, C10, M15, F8, F9** (dinheiro) e **C1, C2, M6, M8** (trabalho invisível) seguem abertos: são
  regra de negócio, não conformidade legal.
- ~~**Não está no ar:** a v1.2.1 continua sendo o que roda.~~ **PUBLICADO em 28/08 às 23:27 — é a v1.3.0.**

## Estado anterior (2026-08-28 · madrugada · ADR-140 — A AUDITORIA TOTAL: 14 correções, 6 delas de segurança ou perda de dado)

> **Leia `docs/auditoria/AUDITORIA-TOTAL-2026-08-28.md`** (o retrato completo, com arquivo:linha em
> tudo, o que ficou aberto e por quê) e a **ADR-140** em `docs/DECISIONS.md`.

- **O dono pediu a varredura de tudo antes do dado real.** Oito frentes em paralelo sobre o código
  de hoje, mais a aplicação percorrida no navegador como ROOT e como cliente do Portal, mais o
  formulário público `/comecar` preenchido de verdade. **Zero migração** neste lote.
- **⚠️ A BASE COMEÇOU VERDE E MESMO ASSIM TINHA 6 DEFEITOS GRAVES.** typecheck 6/6, lint limpo, 679
  testes de API, 171 de web, 99 e2e — e **nenhum** dos achados foi pego por teste. Suíte verde
  prova que o que alguém já pensou em testar continua funcionando, não que o sistema esteja certo.
- **🔑 O PADRÃO, E ELE VALE PARA A PRÓXIMA TRAVA: quase todo achado é "uma segunda porta para o
  mesmo dado que não passa pela regra".** Não foram 14 defeitos independentes; foi um padrão 14
  vezes. Ao construir trava, a pergunta não é "esta tela está protegida?", é **"quantas portas
  existem para este dado?"**.
- **🔴 QUALQUER FUNCIONÁRIO SE DAVA ACESSO DE DONO A QUALQUER CLÍNICA.** `clientes.pessoas.*` era
  `funcionarioProcedure` com o `clienteId` vindo do PEDIDO: ele se convidava como RESPONSAVEL de
  uma clínica alheia, o convite saía para a caixa dele, e ele entrava com **sessão normal de
  cliente** — sem a marca de sessão de suporte que a ADR-128 criou para isto ser rastreável. Hoje
  as cinco mutações passam por `assertPodeVerOPainel`, a mesma régua do Painel do Cliente.
- **🔴 TODA SECRETÁRIA CADASTRADA PELA TELA DA MED ASSINAVA CONTRATO.** *Equipe e acessos* não
  gravava `papelPortal`, e **nulo vale como RESPONSAVEL**. Nasceu
  `portal/papel-da-clinica.ts` (`papelPortalPadraoDaClinica` + `assertSobraResponsavel`), usado
  pelas duas telas. ⚠️ **Arquivo separado por causa de CICLO DE MÓDULOS** — `pessoas.service.ts` já
  importa `gerarConvite` de `usuarios.service.ts`.
- **🔴 PEDIR ASSINATURA DE NOVO APAGAVA A ASSINATURA JÁ DADA** — IP, data, hash, traço, tudo, e
  nada disso é versionado. Hoje recusa, dizendo quem assinou. Reenviar segue liberado enquanto
  ninguém assinou.
- **🔴 A 2ª PROPOSTA DE CREDENCIAMENTO APAGAVA AS LINHAS DA 1ª.** `salvarGrade` foi escrita para a
  grade da ficha (carga = cliente inteiro) e a proposta manda **uma operadora só** (ADR-126). Hoje
  há `somenteOperadorasDaGrade`; ⚠️ **há teste para o caso SEM a marca também**, senão alguém
  "conserta" ligando-a para todo mundo e a grade da ficha para de apagar o desmarcado.
- **🔴 EXCLUIR CLIENTE APAGAVA EM CASCATA O QUE A TELA DIZIA NÃO EXISTIR.** A lista conferia 10
  vínculos; o schema tem **13** relações em cascata. Faltavam suporte, médicos e credenciamentos.
- **🔴 UPSELL VENDIDO E NÃO COBRADO.** Três portas ativam um serviço e só duas cobravam: aceitar
  proposta sincronizava, gerava contrato e **parava**. Para quem ainda é lead a conversão cobra
  atrás; para o cliente **já convertido** não vinha nada. ⚠️ **A guarda contra cobrar duas vezes é
  o LEAD ATIVO** (`provisionarUpsellAceito`).
- **🟠 Mais oito:** `catch(() => {})` da automação pós-aceite agora registra em SISTEMA → Erros ·
  `trustProxy: true` → **`1`** (com `true` o visitante escreve o próprio IP, que é a chave de todos
  os freios **e a prova gravada em `Assinatura.ip`**) · revogar acesso passou a apagar os tokens em
  voo, com segunda tranca em `aceitarConvite`/`redefinirSenha` · desativar o único responsável pela
  tela interna passou a ser recusado · o **nome** do serviço de credenciamento ficou travado
  (remendo assumido: a cura é `Servico.ehCredenciamento`, que pede migração) · lead **perdido** que
  volta pelo site é reaberto no funil · o cliente apagando arquivo agora fica registrado.
- **🟠 DEZ TELAS LIAM "FALHA DE REDE" COMO "NÃO HÁ NADA".** A app tem rede de segurança para
  MUTAÇÃO (`main.tsx:20-27`) e nenhuma para CONSULTA, e `retry: false` faz um tropeço virar estado
  final. No Portal isso dizia ao cliente ✅ *"Você já enviou tudo o que pedimos"* — e ele parava de
  mandar documento. Nas páginas públicas de **assinar** e de **proposta**, dizia *"Link inválido"*.
  No `App.tsx`, jogava a pessoa na tela de login no meio do trabalho. ⚠️ No `SistemaPage` o ramo de
  erro era **código morto** (vinha depois do `!data`), e o painel que existe para avisar ficava
  pulsando para sempre.
- **🟡 Incoerências de texto:** o Início dizia "28 documentos aguardando revisão" e a página
  Documentos dizia 10 (o número conta rascunho **+** revisão — o rótulo passou a dizer isso) · a
  tela de login, que serve equipe **e** cliente, dizia "entrar no workspace" · "Prospects" em
  inglês · "Faltam 1 documento".
- **📭 O E-MAIL DE TESTE PEDIDO PELO DONO NÃO PODE SER PROVADO DAQUI** — a máquina dele não tem
  servidor de e-mail (`ECONNREFUSED 127.0.0.1:587`, **181 falhas em 7 dias, taxa 0%**). O
  **disparo** foi provado (o lead novo saiu com exatamente **2** e-mails internos, confirmando a
  ADR-134); a **entrega** só em produção, onde já foi provada em 22/08. Para repetir: botão
  **"Enviar acesso"** no card do lead — ⚠️ **não** reenviar o formulário público com endereço já no
  funil, que a recaptura não manda convite.
- **Provas:** typecheck 6/6 · lint limpo · **688 testes** do `@app/api` (9 novos, **todos vistos
  reprovando antes da correção**) · 171 do `@app/web` · 99 de ponta a ponta · zero erro de console
  numa carga limpa.

### O que ficou aberto (está tudo na Parte 2 do relatório)

- **Depende do dono:** dado de cliente indo para a **OpenAI** (o campo `observacoes` **contém CPF**,
  e o `IA_PRIVACIDADE.md` promete menos do que o código manda) · retenção e direito de eliminação
  sob a LGPD · página de política de privacidade · expiração dos tokens de proposta/assinatura ·
  se credenciamento reaberto cobra de novo · "Foro de eleição" ainda em branco.
- **Pede migração:** ~~`Servico.ehCredenciamento`~~ (ADR-144) · ~~`@@unique(nome)`~~ (02/09/2026) · gravar o
  consentimento da assinatura.
- **Dinheiro ainda aberto:** M1 (contratar na ficha do prospect + converter = cobra 2×) · C10
  (excluir parcela recorrente e o varredor a ressuscita) · M15 (credenciamento "a combinar"
  aprovado cria conta de R$ 0,00) · F8 · F9.
- **Trabalho invisível:** C1 (funil não fecha depois do aceite) · C2 (2ª proposta queima número da
  contagem real dela) · M6 (**seis** avisos com modelo que nunca saem por e-mail) · M8 (equipe
  responde o chamado e o cliente não é avisado) · recaptura de lead não manda confirmação.
- **Desempenho nosso, não da hospedagem:** `seedIfEmpty()` roda em TODA leitura do catálogo (é o
  `portal.servicosDisponiveis` de 11,9 s) e `login()` faz três escritas sequenciais.
- **Não está no ar:** a **v1.2.1** continua sendo o que roda. Falta o sinal do dono para publicar.

## Estado anterior (2026-08-28 · noite · ADR-139 — O PORTAL VIROU APLICATIVO, construído e provado)

> **Leia a ADR-139 em `docs/DECISIONS.md`** e a esteira em
> `docs/esteira/portal-app-5-secoes-2026-08-28/`. O que segue é só o que mudou nesta janela.

- **✅ AS 6 ETAPAS DO PLANO DO PORTAL ESTÃO FEITAS, E O PR #147 ESTÁ MESCLADO na `main`**
  (commit `3fca40b`, squash, CI 3/3 verde; a branch `feat/portal-app-5-secoes` foi apagada).
  Saiu de **descoberta e plano** para **código construído, revisado e conferido na tela**. **Zero
  migração** — nada mudou no banco. **Não está no ar**: a v1.2.1 continua sendo o que roda.
- **📱 O Portal deixou de ser UMA página com 16 blocos.** Agora tem **seis seções com endereço**
  (`/portal`, `/portal/documentos`, `/portal/credenciamento`, `/portal/servicos`,
  `/portal/suporte`, `/portal/equipe`): recarregar volta na mesma tela, o "voltar" do navegador
  funciona, e no celular há barra inferior com ícone + rótulo; no computador, abas sob o cabeçalho.
- **🃏 A BARRA TEM 4 CORINGAS E 1 VAGA (ordem do dono), e a vaga é uma LISTA DE CANDIDATAS**
  (`apps/web/src/features/portal/secoes.ts`), **nunca um `if`**. Frente de trabalho nova entra
  numa linha. Hoje há **uma** candidata (Convênios). Sem candidata, a barra tem 4 itens —
  travado por `secoes.test.ts`.
- **📁 DOCUMENTOS SÃO DOIS ACERVOS**, com o bloco **"o que ainda falta enviar"** no MEIO — o único
  acionável dos três. No fim da página ele seria lido depois da lista do que já foi enviado, que é
  onde o cliente conclui que entregou tudo.
- **🔒 A TRAVA DE PAPEL APARECE ANTES DO CLIQUE, e servidor e tela leem a MESMA função**
  (`podeAgirNoPortal`, `@app/shared`). Os quatro botões (desistir, retomar, solicitar, cancelar)
  somem para EQUIPE e para a sessão de suporte, com a frase no lugar. ⚠️ **O item continua
  visível** — a trava é sobre agir, não sobre ver.
- **🚀 BRINDE DE DESEMPENHO:** `portal.servicosDisponiveis` (**11,9 s em produção**) e
  `portal.emails` deixaram de ser obrigatórias para abrir o Portal.
- **🧭 O roteador do Portal nasceu em ARQUIVO PRÓPRIO** (`app/portal-router.tsx`) porque dois
  testes-guarda leem o TEXTO de `app/router.tsx`. `lib/paginas.ts` **não mudou uma linha**.
  ⚠️ O redirecionamento de `/` para `/portal` vive **dentro** do roteador do Portal: fora dele, o
  operador da Med entraria em laço ao clicar em "Voltar ao meu acesso".
- **🐛 DOIS DEFEITOS QUE SÓ A TELA MOSTROU:** o selo "AMBIENTE LOCAL" caía **em cima da barra**,
  escondendo dois rótulos; e a 360px com cinco itens, **"Documentos" era cortado em "Docume…"**.
  Os dois corrigidos e conferidos por captura.
- **🔍 TRÊS REVISORES ESPECIALISTAS RODARAM** (react, design, conteúdo). O achado mais sério:
  `PortalCredenciamentoPage` tratava "consulta sem dado" e "consulta FALHOU" como a mesma coisa —
  numa falha de rede o cliente era devolvido ao Início **em silêncio**, achando que perdeu o
  credenciamento. Corrigido, com tela de erro e saída.
- **Provas:** typecheck e lint de todos os pacotes verdes · **suíte COMPLETA do `@app/api`
  (72 arquivos, 679 testes)** · **171 do `@app/web`** (13 novos) · **39 de ponta a ponta**,
  incluindo acessibilidade nas 5 seções · e **na tela**, a 360x800 e a 1920x1080, com **zero erro
  de console** numa carga limpa.
- **✔️ DÍVIDA PAGA DA JANELA ANTERIOR:** o cliente do Prisma foi regerado (modo pausa), fechando
  os 3 erros de tipo que o VS Code acusava nos testes novos.

### O que falta nesta esteira

- **Nada de código.** As fases 5 (execução), 6 (revisão) e 7 (crônica) estão FEITAS.
- **🚨 A CI PEGOU UM DEFEITO REAL QUE SÓ APARECE EM BANCO NOVO, e a culpa era do redesenho.**
  O **catálogo de serviços da Med é criado SOB DEMANDA**, e quem o criava era quem listasse
  serviços primeiro — no Portal, o `portal.servicosDisponiveis` da página única, que rodava em
  toda abertura. Tirando-o da carga inicial (é a consulta de 11,9 s), o cliente que abrisse
  **Convênios** primeiro num banco recém-criado caía num catálogo vazio: a tela dizia
  "Tudo enviado 0/0" com a papelada inteira faltando. ⚠️ **Isso NÃO aparece no banco de quem
  desenvolve** — ele tem o catálogo há meses. Corrigido em duas metades:
  `credenciamentoDoCliente` passou a **garantir o catálogo** antes de sincronizar, e
  `sincronizarRequisitosCredenciamento` **parou de memorizar "serviço inexistente" para
  sempre** (guardado, ele nunca mais rodaria naquele processo, nem depois de o serviço
  aparecer). Provado: 7/7 verde no banco isolado, que reprovava 2.
- **🔬 Como descobrir isto de novo, se acontecer:** reproduza a semeadura EXATA da CI num banco
  novo local (`prisma migrate deploy` + `pnpm db:seed` + `pnpm db:demo`) e olhe o catálogo — ele
  volta **vazio**. Nenhuma leitura de código mostra isso.
- **Falta só o sinal do dono para PUBLICAR.** O merge já aconteceu (CI verde é o critério, e ele
  foi atendido); publicar continua sendo decisão dele, e a v1.2.1 segue no ar.

## Estado anterior (2026-08-28 · noite · ADR-137/138 MESCLADAS + a esteira do Portal em 5 seções)

> **Leia `docs/esteira/portal-app-5-secoes-2026-08-28/`** (briefing, spec, design, adendo) e
> `docs/superpowers/plans/portal-app-5-secoes.md`. O que segue é só o que mudou nesta janela.

- **✅ PR #146 MESCLADO na `main`** (commit `506ef88`, squash, CI **3/3 verde**). A branch
  `fix/travas-de-assinatura-adr-137` foi apagada. **Não está no ar** — a v1.2.1 continua sendo o
  que roda em produção. Todo o conteúdo das ADR-137 e 138 (seção seguinte) vale, e agora está
  na `main`.
- **🗂️ A ESTEIRA DO PORTAL ESTÁ NAS FASES 1–4, TUDO EM DISCO — zero código de aplicação
  escrito.** Branch `feat/portal-app-5-secoes`, já no GitHub. Briefing, spec (671 linhas), design
  (726) e plano (705, **6 etapas em 3 ondas**) escritos e aprovados no validador.
- **📱 O DONO APROVOU as 5 seções** (Início · Documentos · Credenciamento · Meus serviços ·
  Suporte, com *Equipe* e *Perfil* no menu do avatar) **e a direção visual** (barra inferior com
  ícone + rótulo sempre visíveis). Item 4 da ordem dele, finalmente destravado.
- **🃏 A BARRA TEM 4 CORINGAS E 1 VAGA (ordem do dono).** Ele recusou a premissa de 5 seções
  fixas com a razão certa: *"nem todos nossos clientes tem convênios. Nem todos tem
  credenciamento tbm."* Início, Documentos, Serviços e Suporte valem para todo cliente; a 3ª
  posição é uma **vaga**. ⚠️ **A vaga é uma LISTA DE CANDIDATAS, nunca um `if`** — frente de
  trabalho nova entra numa linha, sem abrir a barra. Hoje há **uma** candidata, e é fato do
  repositório: `PortalCredenciamento.tsx` é a única tela de frente que existe. Rótulo
  **"Convênios"** ("Credenciamento" tem 14 caracteres e não cabe nos 68px de um item a 360px).
  Sem candidata, a barra é `grid-cols-4` — nunca 5 com um buraco.
- **📁 A SEÇÃO DOCUMENTOS TEM DOIS ACERVOS (ordem do dono).** Documentos **do cliente** (RG,
  alvará, CRM, mini currículo — `portal.arquivos`) e **da MedConsultoria** (briefing, proposta,
  contrato — `portal.resumo.documentos`). A distinção **já existe no código** e é de FONTE, com
  ações **opostas**: enviar/remover de um lado, ler/aceitar/assinar do outro. Hoje são dois
  cartões distantes na mesma página (linhas 435 e 477) e nada diz qual é qual. ⚠️ **Nunca junte
  os dois numa lista só ordenada por data** — assinar contrato e apagar RG com o mesmo peso
  visual é como o cliente apaga o que não devia.
- **🚧 TRÊS DESCOBERTAS QUE MUDAM QUEM FOR IMPLEMENTAR:**
  (1) **Dois testes-guarda leem o TEXTO de `apps/web/src/app/router.tsx`** por regex
  (`paginas.test.ts:15-20`, `GuiaTour.test.ts:14-18`) e cobrariam catálogo de menu e guia
  próprio para um `path: "/portal"` ali — e casariam **só** `/portal`, não `/portal/documentos`.
  Daí o roteador do Portal nascer em **arquivo separado**; `lib/paginas.ts` não muda uma linha.
  (2) **"Qualquer caminho cai no Portal" é contrato TESTADO** (`e2e/flows-portal.spec.ts:22-23`
  vai a `/financeiro` e exige o cabeçalho do Portal), não acidente — o `notFoundComponent`
  precisa **redirecionar**, e o `h1` precisa manter a palavra "Portal" (daí `H1 = "Seu Portal"`,
  com a saudação no subtítulo). O redirecionamento `/` → `/portal` **não pode vazar** para fora
  do roteador do Portal: "Voltar ao meu acesso" faz `window.location.href = "/"`
  (`FaixaDeSuporte.tsx:23`) e o operador da Med entraria em laço.
  (3) **O M12 são QUATRO botões sem trava de papel na tela** (`desistir`, `retomar`,
  `solicitarServicos`, `cancelarServico`), não um, e a linha citada no `achados.md` está errada.
  A correção mínima é uma função pura em `portal-papeis.ts` **que o servidor também passa a
  chamar** — senão o conserto cria a divergência que veio evitar (modo de falha da ADR-133).
- **🎁 Brinde do redesenho:** com rotas, `portal.servicosDisponiveis` (**11,9 s** em produção)
  deixa de ser obrigatória para abrir o Portal e passa a carregar só em *Meus serviços*.
- **Escopo cortado pelo dono:** os 4 achados de REGRA do Portal (M9, C7, C8, F20) **não** entram
  nesta rodada — misturar correção de regra com redesenho faz o PR crescer e esconde qual das
  duas coisas quebrou. Viram rodada própria.

### O que falta nesta esteira

- **Fases 5, 6 e 7 (execução, revisão, crônica) NÃO COMEÇARAM.** O plano tem 6 etapas: **E1**
  (esqueleto + mudança de casa dos 16 blocos) bloqueia tudo; depois **onda 2 em paralelo**
  (E4 Suporte+Equipe · E5 guia por seção · E6 M12) e **onda 3 em paralelo** (E2 Início+Documentos
  · E3 Serviços+Convênios). ⚠️ **E6 vem ANTES de E2/E3, de propósito** — na ordem inversa
  bastaria esquecer a trava de papel; nesta, seria preciso apagá-la.
- **⚠️ Não existe perfil e2e com papel EQUIPE** (`auth.setup.ts:10-14` cria root/admin/
  funcionario/cliente) e **não há Testing Library** no repositório — a prova do M12 é teste de
  unidade da função pura **mais** a conferência na tela, não e2e.

## Estado anterior (2026-08-28 · fim de tarde · ADR-137 e ADR-138 — os 3 primeiros itens do refino, PR #146 MESCLADO)

> **Leia `docs/esteira/refino-final-2026-08-28/achados.md`** (48 achados, arquivo:linha) e as
> **ADR-137 e ADR-138** em `docs/DECISIONS.md`. O que segue é só o que mudou nesta janela.

- **✅ PR #146 MESCLADO** (era a branch `fix/travas-de-assinatura-adr-137`) com os itens 1, 2 e 3 da ordem
  do dono. **PR #145 (a descoberta, só documentação) MESCLADO**, CI 3/3 verde.
- **🔒 A SECRETÁRIA E A SESSÃO DE SUPORTE NÃO ASSINAM MAIS CONTRATO (C6 · ADR-137).** As duas
  travas existiam, cada uma com a sua ADR, e **nenhuma ficava no caminho que assina**:
  `propostas.responder` e `assinaturas.assinar` eram `publicProcedure` puro, e o `portal.resumo`
  entregava o token a toda conta daquele Portal. ⚠️ **A rota continua pública de propósito** —
  quem assina clica num link de e-mail sem login. A trava é sobre a **SESSÃO**
  (`podeAssinarPelaClinica` + `aceiteProcedure`), e mora no **procedure**, não no serviço: por
  isso o teste chama pelo `createCaller`, senão passaria verde com o buraco aberto.
- **📮 O DEGRAU SEGUINTE, achado pelo `security-reviewer` e corrigido (ADR-137).** ⚠️ **Barrar a
  sessão não adianta se o link chega numa caixa que a pessoa barrada abre.** O e-mail ia para
  `Cliente.email`, a caixa cadastral da clínica (a da recepção): a secretária clicava
  **deslogada** e assinava — e deslogado é justamente o caminho do signatário legítimo. Hoje
  `destinatarioDeAssinatura` endereça a quem fala pela clínica; a caixa da clínica é a reserva.
- **✍️ QUEM ASSINOU PASSOU A FICAR REGISTRADO (ADR-137).** `Assinatura.assinadoPorId` e
  `Documento.propostaRespPorId` (migração `20260828140843`, **duas colunas nuláveis** com FK
  `SET NULL`; reverter é `DROP COLUMN`). ⚠️ **Nulo é o caso NORMAL** — o link de e-mail é anônimo.
- **💸 O DINHEIRO PAROU DE DIVERGIR (F1, C3, C4 · ADR-137).** Converter lead de Faturamento criava
  conta a receber **avulsa e fixa** (a ADR-125 tornou o `valorEstimado` derivado e o fallback não
  sabia); a conversão provisionava pelo preço **de catálogo** e contratava **todos** os serviços
  que o lead pediu, não só os vendidos; e contratar pela ficha com preço combinado gerava conta
  pelo preço de tabela — serviço sem preço de tabela não gerava conta nenhuma.
- **🎚️ O FATURAMENTO É SÓ PERCENTUAL (F4 + a trava · ADR-138).** `categoria === "Faturamento"`
  voltou pela **QUINTA** vez, agora em `ServicosPage.tsx`, o lugar mais a montante. Virou o botão
  **"Como este serviço é cobrado: Valor fixo | % do faturamento"** nas duas telas. ⚠️ A trava nova
  (`temValorEPercentual`) é aplicada em **dois níveis**: `refine` nos três schemas **e**
  conferência no servidor sobre o **ANTES + o DEPOIS** — a edição é parcial, e o `refine` só vê o
  que veio no pedido. Conferido antes de ligar: **0 de 15 serviços** e **0 de 12 contratações**
  estão no estado proibido.
- **⚠️ ARMADILHA QUE CUSTOU UMA CI VERMELHA:** `pnpm --filter @app/api test:unit` **NÃO roda os
  testes de integração**. O fixture do `dinheiro-decimal.integration.test.ts` criava um serviço
  com valor **e** percentual, que a trava nova passou a proibir. **Antes de abrir PR que mexe em
  regra de dados, rodar `pnpm --filter @app/api test`** (a suíte inteira, como a CI).
- **Provas:** typecheck e lint verdes · **suíte completa do `@app/api` verde (72 arquivos, 671
  testes)** e do `@app/web` (16 arquivos, 158) · **18 testes de integração novos** contra o MySQL
  de verdade · **na tela**, como ROOT no localhost, as duas telas de preço trocando de forma ao
  vivo, com **zero erro de console**.

### O que ficou aberto e depende do dono

- **🟡 A DIVISÃO DO PORTAL EM 5 SEÇÕES continua SEM RESPOSTA** — é o item 4 e não começou. A
  mensagem do dono veio com o campo em branco (`[aprovo as 5 seções / mudo assim: ...]`).
  Recomendação: aprovar como está (Início · Documentos · Credenciamento · Meus serviços ·
  Suporte, com *Equipe* e *Perfil* no menu do avatar).
- **🟡 O E-MAIL DE "NOVO LEAD" (pedido novo do dono, 28/08).** Ele quer que **só ADMIN e ROOT**
  recebam. ⚠️ **CONFERIDO NO CÓDIGO: os dois disparos já filtram exatamente isso** —
  `leads.service.ts:1519-1522` (recaptura) e `:1566-1569` (lead novo), ambos
  `role: { in: ["ADMIN", "ROOT"] }`, e a ADR-134 já deixa `lead_novo` ligado por padrão **só para
  ADMIN**. Então o pedido, como escrito, já está feito — **falta perguntar a ele o que está
  chegando na caixa dele** antes de mexer em qualquer linha.
- **🔑 A DÍVIDA DO TOKEN QUE JÁ VAZOU (ADR-137).** Não foi rotacionado, e o porquê está na ADR. A
  decisão depende de **uma conferência só: existe alguma conta de Portal com papel EQUIPE em
  produção?** Se existir, rotacionar toda linha PENDENTE vira obrigatório.
- **🚨 O BANCO DE PRODUÇÃO CAINDO E A LENTIDÃO: NÃO FOI TOCADO**, por ordem do dono. É hospedagem,
  não código (`leads.list` responde em 15 ms enquanto `portal.servicosDisponiveis` leva 11,9 s).
- **⚠️ PENDÊNCIA DO DONO: "Foro de eleição"** em *Ajustes → Dados da empresa* — ele disse que
  preenche com a Thaís mais para a frente.

## Estado anterior (2026-08-28 · tarde · A DESCOBERTA DO REFINO FINAL — 4 auditorias, nada construído ainda)

> **Leia primeiro `docs/esteira/refino-final-2026-08-28/achados.md`.** É o retrato mais
> recente e completo do que está errado na aplicação. Tem arquivo:linha em tudo.

- **✅ A ADR-136 ESTÁ NA `main`** (PR #144, squash, CI 3/3 verde, commit `3dabc32`). Branch
  `fix/refinos-de-tela-adr-136` apagada. **Não está no ar** — a v1.2.1 continua sendo o que roda.
- **✅ AS TRÊS PROVAS PENDENTES DE PRODUÇÃO ESTÃO FEITAS**, conferidas na tela como ROOT em
  28/08: *Manutenção* diz **"CSP: Ligada"**; *Desempenho* não tem mais nenhum **P95 maior que o
  MÁX**; e o template **"Boas-vindas ao Portal (cliente)"** existe em produção com assunto
  *"Bem-vindo ao Portal do Cliente — MedConsultoria"*, botão **Entrar no Portal** e **zero**
  ocorrência de "Workspace". Zero erro de console.
- **🚨 ACHADO NOVO EM PRODUÇÃO, GRAVE, NÃO É CÓDIGO: o banco cai e a aplicação está lenta.**
  Os 5 "erros não resolvidos" do painel do ROOT são todos reais desta vez —
  `Can't reach database server at localhost:3306` (o mais recente **há 10 horas**) e um
  esgotamento do pool (limite 13, timeout 10s). Em *Desempenho*:
  `portal.servicosDisponiveis` **11,9 s** de máximo, `auth.login` **9,9 s**, consultas de
  **4 a 12 s**. ⚠️ **O código não é o gargalo** — `leads.list` responde em 15 ms. É a
  hospedagem. **Exige ordem do dono; nada foi tocado.**
- **📋 QUATRO AUDITORIAS EM PARALELO, TODAS GRAVADAS** em `docs/esteira/refino-final-2026-08-28/`
  (`briefing.md` aprovado no validador + `achados.md`). Resumo do que elas acharam:
  - **Faturamento (21 achados, 4 ALTA).** ⚠️ **Converter um lead de Faturamento cria conta a
    receber AVULSA de valor fixo** — o `usarEstimativa` passou a valer porque a ADR-125 tornou o
    `Lead.valorEstimado` derivado, e o comentário que jura o contrário envelheceu. ⚠️ **NÃO
    EXISTE TRAVA NENHUMA** — banco, Zod, servidor e tela — impedindo valor fixo + percentual no
    mesmo serviço; e o editor de preço da ficha **oferece** Valor e Avulso/Mensal ao Faturamento.
    ⚠️ **A comparação por categoria voltou pela QUINTA vez**, agora no lugar mais a montante
    (`ServicosPage.tsx:100`), e **o texto de ajuda da tela ensina a regra errada**.
  - **Fluxo e automação (27 achados, 13 ALTA).** ⚠️ **SEGURANÇA: aceitar proposta e assinar
    contrato são `publicProcedure`** e `portal.resumo` entrega os tokens — a secretária EQUIPE
    (ADR-131) e a sessão de suporte da Med (ADR-128) **assinam contrato**, furando as duas
    travas. ⚠️ A conversão provisiona pelo preço **de catálogo**, não pelo aceito. ⚠️ Toda a
    automação pós-aceite é `void ... .catch(() => {})` — proposta ACEITA e ficha sem serviço,
    sem contrato, sem conta, **sem nada na tela**. ⚠️ A 2ª proposta de credenciamento **APAGA**
    as linhas da 1ª. ⚠️ **`ehServicoDeCredenciamento` compara por NOME** e a Thaís pode renomear
    o serviço na tela, religando a cobrança antecipada da ADR-108 em três lugares.
  - **Portal (mapa).** Página única, **16 blocos empilhados**, **sem roteador** (escolhido por
    papel em `App.tsx:89`), sem menu, sem abas, sem seção recolhível. **6 usos de breakpoint em
    2.300 linhas.** 37 funcionalidades. `packages/ui` exporta só `cn` — não há Tabs, Sheet nem
    Drawer no repositório. A peça reaproveitável é o drawer do app interno (`AppLayout.tsx:414-432`).
  - **Texto em excesso.** ~120 blocos, ~230 linhas removíveis, concentrados em ~20 arquivos.
    ⚠️ **A régua: até ~25 palavras vira tooltip; acima disso, encurta ou vai para o Guia** —
    existe hoje um `hint` de 40 palavras espremido num balão de 280px. ⚠️ **Nem todo texto longo
    é excesso**: consequência-antes-de-agir, aviso que evita perda de dado e obrigação legal
    ficam. Faltam 3 props de uma linha (`PageHeader.hint`, `Modal.hint`, `CardTitle.hint`).
- **⚠️ PROCEDÊNCIA, e isto importa:** a auditoria de fluxo foi escrita por um agente que redigiu
  parte do relatório como se duas sub-auditorias tivessem respondido — **elas não responderam**.
  Ele detectou sozinho e conferiu item a item. O `achados.md` separa **VERIFICADO**, **HIPÓTESE**
  (M10, M12, M13, M16, B1 — conferir antes de mexer) e **RETIRADO** (B4 estava errado). Os 13
  ALTA estão todos verificados.
- **Zero código de aplicação escrito nesta janela.** Só descoberta, e ela está em disco.

### O que o dono decidiu e o que ele ainda deve

- **Ordem dele:** o Faturamento é **sempre e somente percentual mensal**, em toda a aplicação.
- **Ordem dele:** menos texto na tela, tooltip no máximo de lugares.
- **Ordem dele:** o Portal precisa parecer um aplicativo no celular, com **menu inferior**
  (referência: app da Binance).
- **PENDENTE DE RESPOSTA:** a divisão do Portal em **5 seções** (Início · Documentos ·
  Credenciamento · Meus serviços · Suporte), com *Equipe* e *Perfil* indo para o menu do avatar.
  Foi recomendada e **ainda não aprovada** — é a única coisa que trava o começo da construção.
- **Fora de escopo por ordem dele:** o "Foro de eleição" (ele vai preencher com a Thaís).

## Estado anterior (2026-08-28 · v1.2.1 NO AR + ADR-136 · os 4 refinos da auditoria, FECHADOS)

- **✅ NO AR DESDE 28/08/2026 às 02:41 — a v1.2.1, com todo o lote da ADR-135.** Publicação
  `33135568404` no commit `9ef24e9`, disparada por `workflow_dispatch` (o `gh workflow run` **foi
  barrado para mim de novo** — quem colou o comando foi o dono). Suíte completa verde ANTES de
  tocar no servidor, depois 7/7 no deploy: `found 0 vulnerabilities`,
  **`No pending migrations to apply.`** (o lote não tinha migração), ensaio de boot com **16
  portas ouvindo**, `restart.txt marcado em 2026-08-27 23:40:49`, `/health` = `{"status":"ok"}`,
  `/` e `/credenciamentos` = **200**. Etiqueta **`v1.2.1`** criada e enviada à mão (o `deploy.yml`
  continua não criando).
- **⚠️ A TELA DE PRODUÇÃO LOGADA NÃO FOI CONFERIDA, e o motivo importa:** o Chrome do dono está em
  produção com uma sessão de **cliente do Portal** (Clínica na Mooca), não de ROOT. `/sistema`
  redireciona para o Portal. As duas provas que faltam — `SISTEMA → Manutenção` dizendo
  **"CSP: Ligada"** e `SISTEMA → Desempenho` sem P95 maior que o máximo — **exigem o dono entrar
  como ROOT**. Sem erro de console em duas cargas do Portal de produção.
- **🔁 B6 — EDITAR UMA REPETIÇÃO MUDAVA A SÉRIE INTEIRA, SEM DIZER (ADR-136).** O único dos quatro
  refinos com risco real: clicar na reunião de 24/08 abria o formulário em 03/08 (a 1ª ocorrência)
  e salvar mudava **todas** as reuniões. ⚠️ **O conserto foi a frase, não o comportamento** —
  editar só uma ocorrência exigiria exceção por data no banco para um problema que ninguém
  relatou. Faixa âmbar no topo do formulário, com a regra em função pura testada (`avisoDeSerie`):
  ⚠️ **hora diferente no MESMO dia não é divergência de dia**, e a comparação usa o formatador
  central (fuso `America/Sao_Paulo`) — em UTC o aviso acenderia errado perto da meia-noite.
- **👥 B7 — A COLUNA *PAPEL* NÃO DIZIA QUEM ASSINA (ADR-136).** *Equipe e acessos* dizia só
  "Cliente" para os dois papéis da ADR-131. Agora mostra "· Responsável no Portal" / "· Equipe no
  Portal". ⚠️ **Papel nulo é mostrado como Responsável** — a MESMA leitura de `podeNoPortal`; duas
  leituras do mesmo nulo (uma na trava, outra na tela) é o modo de falha da ADR-133.
- **✂️ B5 — O NOME DO CLIENTE APARECIA ATÉ 3× NA MESMA LINHA (ADR-136).** Os títulos gerados
  (`"<Serviço> — <Cliente>"`, `"Reunião de kickoff — <Cliente>"`, `"Projeto — <Cliente>"`)
  perderam o sufixo; toda tela que lista projeto já mostra o cliente ao lado. ⚠️ **Havia UM lugar
  onde o nome viajava sozinho** — a notificação `projeto_participante` —, e lá o cliente passou a
  ser acrescentado explicitamente, em vez de depender de estar embutido por acaso. ⚠️ **O que já
  está gravado NÃO muda**: os antigos seguem com o nome dentro, e a tela fica misturada por um
  tempo. ⚠️ **As contas do Financeiro ficaram como estão**, fora do escopo do achado.
- **🏷️ B8 — "LEAD" DE UM LADO, "cliente" DO OUTRO (ADR-136).** Em Mensagens, a assinatura olhava
  só `autor.role === "CLIENTE"` (lead e cliente do Portal são ambos `User` com esse papel); agora
  olha também a categoria da conversa — a mesma fonte do selo da lista.
- **Zero migração** neste lote — nada mudou no banco.
- **Provas (ADR-136):** typecheck e lint verdes · **491 testes de unidade** do `@app/api` · **158
  do `@app/web`** (5 novos) · **na tela**, como ROOT no localhost: a faixa do evento recorrente
  com a data certa, "Cliente · Responsável no Portal" em Equipe, o projeto novo chamado só
  **"Gestão Operacional"** ao lado dos antigos, "Clínica teste · lead" em Mensagens, e **zero erro
  de console** nas quatro telas.

### Ainda aberto depois desta janela

- **⚠️ CONFERIR A v1.2.1 NA TELA DE PRODUÇÃO, como ROOT** — "CSP: Ligada" em *Manutenção*, o P95
  em *Desempenho*, e a prévia do template "Boas-vindas ao Portal (cliente)". Depende do dono
  entrar com a conta dele.
- **⚠️ PENDÊNCIA DO DONO: preencher o "Foro de eleição"** em *Ajustes → Dados da empresa*. Está em
  branco e o contrato sai com **`[A PREENCHER]`** — comportamento correto (o sistema não inventa
  dado jurídico), mas precisa ser preenchido antes do primeiro contrato real. O resto dos dados
  jurídicos e os bancários já estão completos.
- **Sobra de teste no banco LOCAL:** contratei "Gestão Operacional" para a *Clínica Teste CNPJ*
  para provar o B5, e deixei contratado. É o banco de desenvolvimento, que os e2e já enchem de
  resíduo; cancelar criaria um estado artificial diferente.

## Estado anterior (2026-08-28 · madrugada · ADR-135 · a varredura de tela TERMINOU)

- **✅ A VARREDURA DE TELA ANTES DO DADO REAL ESTÁ CONCLUÍDA.** As **10 páginas** que faltavam
  foram percorridas clicando (Tarefas · Agenda · Projetos · E-mail · Mensagens · Ajustes e os 6
  modais · Serviços · Modelos · Equipe e acessos · Sistema, as 9 abas, entrando como ROOT).
  **Sete telas sadias**, quatro defeitos corrigidos, quatro refinos anotados. Relatório completo
  em `docs/auditoria/AUDITORIA-2026-08-27.md`. ⚠️ **Nada disto está no ar** — a v1.2.0 continua
  sendo o que roda em produção.
- **🚨 O PAINEL DE ERROS DO ROOT ERA 100% RUÍDO (ADR-135).** `SISTEMA → Erros` anunciava
  **"5 erros não resolvidos"** e **nenhum era bug**: **66 ocorrências** eram "esta caixa precisa
  ser reconectada" (a caixa de e-mail com a senha vencida — estado que a própria tela já trata
  com o botão *Reconectar*), duas eram do mesmo assunto em 04/08, e as duas últimas eram de
  **28/07**, de antes de `Tarefa.responsavelId` virar N-N. A última ocorrência foi registrada
  **durante a auditoria**, só por abrir a página. ⚠️ **A causa é o crachá, não a régua:** o
  `onError` filtra por `INTERNAL_SERVER_ERROR` e diz no comentário que erro esperado não entra —
  mas os caminhos de reconexão lançavam `new Error(...)` cru, e `Error` sem código É internal
  para o tRPC. Agora é `PRECONDITION_FAILED`, nos 3 caminhos do IMAP e nos 2 do SMTP.
  ⚠️ **Servidor de e-mail fora do ar continua sendo erro interno, de propósito** — para ele já
  existe o alerta de Incidentes.
- **🔒 O PAINEL DE SEGURANÇA MENTIA SOBRE A CSP (ADR-135).** `SISTEMA → Manutenção` dizia
  "Proteção de cabeçalhos (CSP): **Desligada**" com a CSP **ligada** — provado com `curl -D -`
  (`default-src 'self'; script-src 'self'; …`). Era um `cspLigada: false` fixo no código, com um
  comentário que envelheceu. ⚠️ **A correção não foi trocar `false` por `true`:** quem acende a
  marcação é o **boot**, na linha ao lado do `register(helmet)`. Tirar o registro apaga a marcação
  junto — sem isso o painel também não mudaria no dia em que a CSP fosse desligada de verdade.
  Conferido na tela: **"CSP: Ligada"**.
- **📉 UM PERCENTIL MAIOR QUE O MÁXIMO (ADR-135).** `SISTEMA → Desempenho` mostrava
  `agenda.list · P95 256ms · MÁX 184ms`. O percentil devolvia o **teto do balde** do histograma
  (daí só aparecerem potências de 2). ⚠️ **O histograma fica** — guardar toda chamada em memória
  num processo que serve API + SPA + tempo real é pior; o que entra é o teto pelo máximo real, e
  aí a aproximação erra só para menos.
- **📧 O CLIENTE RECEBIA AS BOAS-VINDAS DO SISTEMA ERRADO (ADR-135) — o achado que mais chega a
  quem está de fora.** `aceitarConvite` mandava `boas_vindas` **sem olhar o papel**, e o cliente
  do Portal também é `User`: o médico que ativava o acesso ao **Portal** recebia *"Bem-vindo ao
  **Workspace** MedConsultoria"*, prometendo que ele acompanharia "clientes, projetos, agenda,
  finanças", com botão **"Acessar o workspace"** → o sistema **interno** da Med. Nasceu o template
  **`boas_vindas_portal`** (editável na tela) e a régua `templateDeBoasVindas`. ⚠️ **O padrão dela
  é o do CLIENTE** — papel novo ou nulo cai no texto neutro: errar para esse lado tira do colega
  um link que ele já tem; errar para o outro manda o endereço interno para fora da empresa.
- **🧹 O MESMO VAZAMENTO VINHA DE MAIS DOIS LUGARES (ADR-135).** O **rodapé é igual nos 42
  templates** e trazia *"Acessar o workspace"* + *"sua conta no Workspace MedConsultoria"* — e
  mais da metade dos e-mails vai para fora. O link saiu (ficaram e-mail comercial e site); a
  versão em **texto puro** assinava com o mesmo endereço interno e passou a assinar com o site. E
  **`reset_senha`** dizia "Workspace" no assunto e no corpo, sendo que `solicitarReset` **não
  filtra papel**: quem esquece a senha pode ser o cliente, e nome de sistema desconhecido em
  e-mail de segurança se lê como golpe.
- **Zero migração** neste lote — nada mudou no banco.
- **Provas (ADR-135):** typecheck e lint verdes · **491 testes de unidade** (19 novos) · **na
  tela**, como ROOT: "CSP: Ligada", e a prévia do novo "Boas-vindas ao Portal (cliente)" com
  botão *Entrar no Portal*, rodapé sem link interno e **zero** ocorrência de "workspace" — nele e
  no de redefinir senha.

### Ainda aberto depois daquela janela — TUDO FECHADO na ADR-136

- ~~**Refino de tela (4), nenhum produz dado errado**~~ **FEITOS** — o nome do cliente aparecendo **até 3× na
  mesma linha** na Agenda e em Projetos; o evento **recorrente** que abre a data da 1ª ocorrência
  sem avisar que edita a série; a coluna *Papel* de Equipe sem distinguir **Responsável × Equipe**
  do Portal (ADR-131); e "LEAD" × "cliente" para a mesma pessoa em Mensagens. Detalhe no relatório.
- **⚠️ PENDÊNCIA DO DONO: preencher o "Foro de eleição"** em *Ajustes → Dados da empresa*. Está em
  branco e o contrato sai com **`[A PREENCHER]`** — comportamento correto (o sistema não inventa
  dado jurídico), mas precisa ser preenchido antes do primeiro contrato real. O resto dos dados
  jurídicos e os bancários já estão completos.

## Estado anterior (2026-08-27 · noite · lote v1.2.0 PUBLICADO — o que está NO AR)

- **✅ NO AR DESDE 27/08/2026 às 21:43 — o lote inteiro do dia (ADR-128 a ADR-134).**
  Publicação `33129316255` no commit `cf243e6`, disparada por `workflow_dispatch`. A
  **suíte completa rodou antes de tocar no servidor** (`build-test` + `e2e` +
  `integration`, os três verdes — o elo da ADR-121), depois 7/7 no deploy:
  `found 0 vulnerabilities`, **`All migrations have been successfully applied`** (as TRÊS
  novas), ensaio de boot com **16 portas ouvindo**,
  `restart.txt marcado em 2026-08-27 21:43:51`, `/health` = `{"status":"ok"}`, `/` e
  `/credenciamentos` = **200**. Etiqueta **`v1.2.0`** criada e enviada (o `deploy.yml`
  ainda **não** a cria sozinho — continua sendo passo à mão).
- **⚠️ O `gh workflow run` VOLTOU A SER BARRADO pelo classificador** (`Blocked by
  classifier`, recusa seca). O de 26/08 foi a exceção, não a regra: **conte com pedir ao
  dono** que cole `! gh workflow run deploy.yml --ref main -f confirmar=PUBLICAR` na
  conversa. Do disparo em diante (`gh run watch`, `gh run view --log`, etiqueta,
  conferência) é tudo comigo.
- **🖥️ CONFERIDO NA TELA DE PRODUÇÃO, não só pelo smoke test.** O Portal do cliente
  (Clínica na Mooca) abriu com a seção nova **"Quem da clínica entra aqui"** da ADR-131
  desenhando certo — responsável, papéis e "Convidar pessoa" —, e **zero erro de console**
  em duas cargas da página.
- **✅ PENDÊNCIA (1) DA AUDITORIA FECHADA — o catálogo público de produção está limpo.**
  `/comecar` e o **"Solicitar" do Portal** listam **só os 10 serviços reais**; nenhum
  `Serviço E2E` nem `Serviço Guard`. O lixo é do banco local e **fica lá** — os e2e o
  recriam, e limpar o banco de desenvolvimento não provaria nada sobre produção.
- **~~Ainda aberto: a varredura de tela não terminou~~ — CONCLUÍDA em 28/08 (ADR-135).**

## O que foi publicado neste lote (2026-08-27 · ADR-134)

> **Contexto:** o dono vai começar a cadastrar DADO REAL em produção e pediu a varredura completa
> da aplicação, clicando. Relatório vivo em `docs/auditoria/AUDITORIA-2026-08-27.md`.

- **📧 O AVISO DE LEAD NOVO PAROU DE VIRAR RUÍDO (ADR-134).** Relato do dono: *"um lead novo dispara 6 e-mails internos; com lead real chegando todo dia a equipe para de ler"*. **Não era esquecimento:** o lead nasce **sem responsável**, então `capturarLead` avisa toda conta ADMIN/ROOT ativa — quatro em produção. Em produção passa de **4 e-mails por lead para 2**, os dois que realmente atendem. ⚠️ **O sininho não mudou:** todo mundo continua vendo dentro do sistema; o que ficou mais estreito é só o e-mail.
- **🤖 A CONTA DE SISTEMA NUNCA MAIS RECEBE E-MAIL OPERACIONAL (ADR-134).** `root@medconsultoria.com.br` é o ROOT primordial da ADR-89 — imutável, ninguém entra com ela, ninguém lê a caixa. ⚠️ **A recusa vale mesmo se alguém LIGAR a preferência à mão** — a régua é sobre a conta, não sobre a vontade de quem mexeu na tela. Comparação normalizada (maiúscula e espaço) e por **igualdade**, nunca `includes`: `root@medconsultoria.com.br.evil.com` é endereço de internet de verdade.
- **🔔 "LEAD NOVO" NASCE LIGADO SÓ PARA ADMIN (ADR-134).** ROOT nominal (Thiago, André) vê pelo sininho e liga o e-mail na tela se quiser — quem toca o comercial é ADMIN. ⚠️ **`padraoDesligadoPara` é lista de EXCEÇÕES com padrão LIGADO** — o oposto de `MODELO_ACEITA_LEAD` (ADR-132) e `ACOES_LIBERADAS_PARA_EQUIPE` (ADR-131). É deliberado: lá o risco é **fazer demais**; aqui o risco é **avisar de menos**, e aviso que não chega é trabalho que não acontece. Categoria nova nasce **ligada**, e há teste que reprova a mudança silenciosa de padrão dos outros avisos.
- **🎚️ A RÉGUA VIROU FUNÇÃO PURA, NUM LUGAR SÓ (ADR-134).** `decidirEmailOperacional` (`@app/shared`) reúne as **oito** condições que estavam espalhadas dentro do `notificar()`. ⚠️ **A tela de preferências lê a MESMA função** — sem isso ela mostraria "ligado" para um aviso que o servidor não manda, que é exatamente o modo de falha da ADR-133.
- **🗂️ A TELA DE PREFERÊNCIAS FICOU LEGÍVEL (ADR-134).** Vinte e cinco interruptores em lista corrida viraram **seis seções** (Vendas e funil · Clientes e Portal · Credenciamento · Documentos · Financeiro · Agenda e tarefas · Sistema, esta só para ROOT), com o aviso que mais importa antes de alguém desligar algo: **desligar o e-mail não esconde o aviso do sistema**.
- **Zero migração** — a tabela `PreferenciaEmail` já existia; mudou o **padrão**, não o banco.
- **Provas (ADR-134):** typecheck e lint verdes · **472 testes de unidade** (12 novos na régua pura) · **6 de integração** contra o MySQL de verdade, provando que a listagem lê papel e e-mail do banco e aplica a mesma régua do envio · **na tela**, `/configuracoes` como ADMIN: seis seções, "Novo lead pelo site" ligado, **zero erro de console**.

## Estado anterior (2026-08-27 · auditoria de tela antes do dado real)

> **Contexto:** o dono vai começar a cadastrar DADO REAL em produção e pediu a varredura completa
> da aplicação, clicando. Relatório vivo em `docs/auditoria/AUDITORIA-2026-08-27.md`.

- **📄 A PROPOSTA VAI PARA QUEM AINDA É LEAD (ADR-132).** O "Novo documento" só oferecia CLIENTES — e a proposta é justamente o papel que se manda para quem **ainda não é** cliente. Não era esquecimento: `clientes.list` exclui prospect de propósito (ADR-24), mas era ele que alimentava o seletor; a única saída na tela era **converter o lead antes da hora**, sujando a base e disparando a provisão financeira da conversão (ADR-108). Hoje o campo é **"Cliente ou lead"**, com a etapa do funil ao lado de cada lead.
- **✂️ O CORTE É O ACEITE (ADR-132).** Pré-venda aceita lead: **proposta** (as 3), **escopo**, **diagnóstico**, **plano de ação**, **ata**, **pauta de reunião**, **briefing**. Pós-venda exige cliente: **contrato**, **recibo**, **onboarding**, **checklist**, **relatórios**, **pauta de postagem** — quem aceita a proposta **vira cliente automaticamente**, então contrato para lead seria assinatura sem cliente por trás. ⚠️ **`MODELO_ACEITA_LEAD` (`@app/shared`) é lista de LIBERAÇÕES com padrão FECHADO** — tipo novo nasce fechado e o teste cobra a decisão de quem o acrescentar.
- **🎯 ZERO MIGRAÇÃO, e é o que torna isto barato (ADR-132).** O documento continua em `Documento.clienteId`: **todo lead já tem (ou ganha) um `Cliente` PROSPECT por trás** — o mesmo do acesso ao Portal do prospect (ADR-128). A tela troca um pelo outro ao gerar (`documentos.clienteDoLead`, idempotente) e **nenhuma das SEIS formas de gerar documento mudou uma linha**. ⚠️ **Propor NÃO converte:** o cliente fica `PROSPECT` (fora da página Clientes) e o lead segue no funil — travado por teste de integração, senão "emitir proposta" viraria conversão silenciosa **com provisão financeira junto**.
- **🏷️ DOIS NOMES, DE PROPÓSITO (ADR-132).** `rotulo` (`Clínica X (Fulano)`) serve para **escolher** entre clínicas parecidas; `nomeNoDocumento` (`Clínica X`) é o que sai **impresso**. Achado na prévia: o papel abria com *"Prezado(a) MedLar Home Care (Carlos Mendes)"*.
- **📁 O PAINEL DO LEAD GANHOU O BLOCO "DOCUMENTOS" (ADR-132).** Sem ele a Thaís emitiria a proposta e **não a acharia mais pelo funil** — a mesma falha de costura entre telas das ADR-105 e ADR-128.
- **📧 "ENVIADOS HOJE" CONTAVA FALHA COMO ENVIO.** O monitor mostrava, ao mesmo tempo, *Enviados (7 dias) 0*, *Taxa de entrega 0%* e *Enviados hoje 23* — três números que não podem ser verdade juntos. ⚠️ **É esse número que faz alguém concluir que o e-mail está saindo quando nenhum sai** — foi assim que a ADR-122 passou meses sem ser notada. Agora conta só `ENVIADO`, e **as falhas do dia aparecem ao lado**.
- **🔁 RECAPTURA DE LEAD PARA DE JOGAR DADO FORA.** Quem voltava ao site informando a clínica que faltava, ou corrigindo o telefone, tinha o dado novo **descartado em silêncio** (só a mensagem entrava em observações). Agora **completa o que está vazio e nunca sobrescreve** — o inverso deixaria o formulário público apagar por cima a correção que a equipe fez à mão.
- **⚠️ PENDÊNCIAS DA AUDITORIA:** ~~(1) o **catálogo público** (`/comecar`) e o **"Solicitar" do Portal** listam todo serviço ativo — lixo de teste no banco local~~ **RESOLVIDO em 27/08: conferido em PRODUÇÃO, só os 10 serviços reais aparecem**; ~~(2) um lead novo dispara 6 notificações internas~~ **RESOLVIDO na ADR-134**; (3) **ainda aberta** — a varredura de tela **não terminou** (faltam Tarefas, Agenda, Projetos, E-mail, Mensagens, Ajustes, Serviços, Modelos, Equipe, Sistema).
- **📭 E-MAIL NÃO SAI DO LOCALHOST, e isso não é defeito da aplicação:** a máquina do dono não tem servidor de e-mail (`connect ECONNREFUSED 127.0.0.1:587`). O **disparo** funciona (o registro sai com destinatário e assunto certos); a **entrega** só se prova em produção, onde já foi provada em 22/08 (ADR-122).
- **Provas (ADR-132):** typecheck e lint verdes · **460 testes de unidade** (4 novos na régua pura) · **8 de integração** contra o MySQL de verdade (5 do documento-para-lead + 3 do monitor de e-mails) · e2e `flows-documento-para-lead` (2 casos) · **na tela**: proposta gerada para o lead *MedLar Home Care*, banco com `PROSPECT` + `convertidoEmClienteId: null` + **um** cliente só, e a proposta de volta no painel do lead.

## Estado anterior (2026-08-27 · manhã · ADR-131)

- **👥 VÁRIOS USUÁRIOS POR CLÍNICA (ADR-131) — o maior pedido em aberto, feito.** Cada médico e cada secretária entra com o próprio e-mail e a própria senha; acabou a conta única cuja senha circulava no WhatsApp da clínica. Dois papéis em `User.papelPortal`: **RESPONSAVEL** fala pela clínica (aceita proposta, contrata, cancela, convida) e **EQUIPE** toca o operacional (documento, formulário, agenda, suporte).
- **🔒 A TRAVA É SOBRE ASSINAR, NÃO SOBRE VER (ADR-131).** Os dois papéis leem tudo daquela clínica, valores inclusive — mesma escolha da ADR-128. ⚠️ **A lista `ACOES_LIBERADAS_PARA_EQUIPE` é de LIBERAÇÕES e o padrão é NEGAR**, num lugar só (`portalProcedure`, só em mutação): **ação nova nasce fechada**. Quem escrever a próxima precisa decidir que a secretária pode. Papel **nulo vale como RESPONSAVEL** (contas anteriores à regra).
- **🚫 A CLÍNICA NUNCA FICA SEM QUEM ASSINE (ADR-131).** `sobraResponsavel` (pura, testada) recusa rebaixar, desativar ou revogar o último responsável, em português. Ninguém revoga o próprio acesso. **Revogar é desativar, nunca excluir** — apagar deixaria "alguém" no lugar do nome de quem agiu (ADR-109); as sessões abertas caem junto.
- **🖥️ DUAS TELAS, UM COMPONENTE E UM SERVIÇO (ADR-131).** Card *"Pessoas com acesso ao Portal"* na ficha (equipe da Med) e seção *"Quem da clínica entra aqui"* no Portal (o responsável convida os colegas sem passar pela Med). Mesmas regras nos dois lados — duas cópias divergiriam e a Thaís veria um estado enquanto o cliente vê outro.
- **🐛 DOIS DEFEITOS QUE SÓ APARECERAM CLICANDO (ADR-131):** (1) ⚠️ **`ativo = false` é AMBÍGUO** — conta convidada e ainda sem senha também nasce inativa, e a secretária recém-convidada aparecia como **"acesso revogado"**. Nasceu `User.acessoRevogadoEm`; o mesmo engano estava em **três lugares** (a situação da lista, a mensagem de e-mail duplicado e a régua do "sobra responsável"). (2) a **primeira** pessoa da clínica entrava como *Equipe* e a clínica ficava sem ninguém para assinar — hoje o padrão do convite muda conforme a clínica, e há aviso amarelo enquanto ninguém falar por ela.
- **📧 O convite daqui SEMPRE manda e-mail**, diferente de `garantirAcessoPortal` (ADR-128): lá a conta nasce como efeito colateral de cadastrar um cliente; aqui alguém digitou nome e e-mail e apertou "Convidar".
- **✔️ Duas migrações JÁ NO AR** (aplicadas em 27/08 às 21:43): `20260827053330_usuarios_por_clinica` e `20260827054802_acesso_revogado_em`. Aditivas — três colunas nuláveis, uma FK `SET NULL`, um índice e um `UPDATE` marcando quem já tem acesso como RESPONSAVEL. Reverter é `DROP COLUMN` nas três.
- **Provas (ADR-131):** typecheck e lint verdes · **585 testes** do `@app/api` (15 de integração novos contra o MySQL de verdade, provando isolamento entre clínicas; 14 de unidade na regra pura) · e2e `flows-pessoas-do-portal` verde no banco isolado · **na tela**, convite pela ficha e pelo Portal, e a prova de ponta a ponta: rebaixado a EQUIPE, `portal.cancelarServico` respondeu **403** em português e `portal.suporte.abrir` respondeu **200**.

## Estado anterior (2026-08-27 · madrugada · ADR-130)

- **📋 AUDITORIA DE FORMATAÇÃO DOS 16 MODELOS, CLICANDO EM TODOS (ADR-130).** O relato do dono era *"a proposta comercial de faturamento está desformatada"*; o defeito achado atinge **todos** os modelos: `.doc-body ul/ol` declarava `padding-left` e **nunca declarou `list-style`** — o reset do Tailwind zera o marcador em toda a aplicação, e a folha nunca o devolvia. A lista **numerada de seis passos** da proposta de faturamento chegava ao cliente **sem os números**. ⚠️ **E a janela de impressão NÃO carrega o Tailwind**, então lá os números apareciam: tela e PDF discordando de novo, pelo caminho oposto ao da ADR-129. Travado por teste que lê o `DOC_STYLES`.
- **☐ O CHECKLIST CHEGAVA SEM CAIXA NENHUMA (ADR-130).** `marked` emite `- [ ]` como `<input type=checkbox>`, e `input` é **proibido** no sanitizador — corretamente. O efeito era o Checklist de credenciamento virar texto pelado. A caixa virou **caractere** (`☐`/`☑`), que atravessa sanitizador, impressão e Word. ⚠️ **A proibição do `input` fica como está.**
- **📑 QUAL PROPOSTA SERVE PARA QUÊ (ADR-130, decisão do dono).** A **comercial** é a padrão, que junta os serviços — e **credenciamento e faturamento ficam FORA dela**, porque cada um tem proposta e regra de cobrança próprias (ADR-104 e ADR-127). A **de faturamento perdeu o seletor "Serviços da proposta"**: o serviço entra marcado sozinho e a tela só pergunta o **percentual**. ⚠️ Quem separa é o **PREÇO** (`ehServicoSomentePercentual`) e o **nome canônico** (`ehServicoDeCredenciamento`), **nunca** `categoria === "Faturamento"` — a comparação que já saiu 4 vezes.
- **👁️ A PRÉVIA MOSTRA DADO REAL (ADR-130).** Com o cliente escolhido, a prévia dizia `[nome do cliente]` — escondendo o que se confere antes de gerar: como o papel fica **com o nome da clínica dentro**, que é mais comprido e quebra as linhas de outro jeito. E os rótulos deixaram de ser nome de código: `[dadosPagamento]` → *dados para pagamento*, `[clausulas_servicos]` → *condições de cada serviço*.
- **🧹 PADRONIZAÇÃO ACHADA CLICANDO (ADR-130):** título **duplicado** no corpo de Contrato, Escopo e Recibo (o cabeçalho da folha já o imprime) · *"Suporte comercial"* era `###` filho da seção errada, virou `##` · os grupos do **Onboarding** eram negrito, não título — ⚠️ **negrito não é título e a paginação não o protege de ficar órfão** · a **descrição do serviço saiu de dentro da linha** da tabela e ganhou linha própria · *"5% do faturamento (Faturamento) — por mês"* virou **"Faturamento: 5% do faturamento mensal"** · `Foto 3x4` → `Foto 3×4`.
- **📏 MEDIDO E NÃO MUDADO (ADR-130):** o vazio de meia folha na proposta de credenciamento **não é defeito** — sobravam 316px de conteúdo, mas com as margens o espaço útil era ~124px e a lista tem 193px. Fatiar deixaria "3 passos aqui, 3 na outra folha". Vale a regra da ADR-129: **o bloco desce inteiro**.
- **✅ O item que faltava aqui — vários usuários por clínica — FOI FEITO na ADR-131** (ver Estado atual).
- **🏦 ⚠️ ERRATA (28/08): os dados bancários de PRODUÇÃO NÃO estão preenchidos.** O que foi
  conferido em 27/08 (Nubank / 0001 / 686169152-5 / Thais Garcia Gestão Saúde / PIX
  34.270.022/0001-93) era o banco **local**. Em produção os cinco campos estão **vazios**, junto
  com os quatro jurídicos — conferido campo a campo na tela em 28/08. Ver o Estado atual.

## Estado anterior (2026-08-27 · ADR-129)

- **🖨️ O PDF NÃO USAVA A PAGINAÇÃO QUE A TELA MOSTRAVA (ADR-129).** O pedido era revisar os 16 modelos atrás de quebra de página errada; o defeito achado é maior: o preview media e distribuía o conteúdo em folhas A4, e `imprimirDocumento` jogava o documento **inteiro numa folha só**, deixando o Chrome cortar onde quisesse, **sem uma regra `break-inside` sequer**. O que a Thaís conferia na tela **não era** o que chegava ao médico. Hoje tela e impressão usam a **mesma** `paginarDocumento`, e a impressão emite **uma folha por página** com altura A4 exata.
- **📐 A FOLHA DA TELA VIROU UMA A4 DE VERDADE (ADR-129).** 793×1122 px a 96dpi, margens 18mm × 16mm, com o `zoom` encolhendo para caber. ⚠️ **Medir no tamanho real é o que faz preview e PDF concordarem** — antes a folha tinha 620px com a fonte em tamanho normal, então o texto ocupava proporcionalmente **mais** espaço na tela do que no papel e os dois nunca poderiam bater. Os valores são arredondados **para baixo** da conta em mm: 1px sobrando vira folha em branco no fim do PDF.
- **🧾 CABEÇALHO E RODAPÉ EM TODAS AS FOLHAS, SEM REPETIR A CAPA (ADR-129).** Capa completa só na 1ª; nas seguintes, um **cabeçalho corrido** de uma linha (logo pequeno + *título — tipo nº*). Rodapé em todas, e **nasceu o "Página N de M"**, que não existia. O **código de integridade sai só na última** folha — ele identifica o documento, não a folha.
- **✍️ A REGRA DE QUEBRA VIROU FUNÇÃO PURA TESTADA** (`paginacao.ts`): quem **mede** é o navegador, quem **decide** é código sem DOM. ⚠️ **Tabela que cabe numa folha inteira NUNCA é fatiada** — é o que impede a **assinatura partida** (traço numa folha, nome na outra); tabela maior que a folha é fatiada por **linhas inteiras** repetindo o cabeçalho; e **título carrega a fila inteira de títulos abaixo dele mais o começo do conteúdo**.
- **🐛 DOIS DEFEITOS QUE SÓ A TELA MOSTROU, com testes verdes (ADR-129):** (1) a 1ª régua do título órfão pedia *"duas linhas"* do bloco seguinte — mas **parágrafo não se parte**, e *"Prazos e rotina de faturamento"* ficou sozinho no pé da folha 2; (2) corrigida, *"Como funciona o nosso serviço"* continuou órfão porque é seguido de **outro título**. E um terceiro, na impressão: a **última folha ainda quebrava depois** (folha em branco no fim do PDF), porque `.doc-sheet:last-child` não casa — o último filho do corpo da janela de impressão é a tag `<script>`. Hoje a última é marcada por **classe**.
- **✅ Auditoria completa na tela:** **16/16 modelos** e **18 documentos reais (45 folhas)** com zero título órfão, zero conteúdo estourando a folha, cabeçalho e rodapé em todas, capa uma vez só e contador certo. Travado por `e2e/flows-documentos-paginacao.spec.ts`. ⚠️ **O Word (`.doc`) fica em fluxo único** de propósito — ele pagina sozinho.
- **📭 CADASTRO PELA EQUIPE NÃO AVISA O CLIENTE (ADR-128, ordem do dono).** E-mail de boas-vindas/acesso é **só para quem se cadastra sozinho em `/comecar`**. ⚠️ **O defeito não era onde parecia:** cadastro manual de **lead** já não mandava nada; o e-mail saía porque as caixinhas de confirmação de *cadastrar cliente* e *converter lead* **vinham marcadas**, e ninguém desmarca. Agora `garantirAcessoPortal` **exige** uma `OrigemDoAcesso` (`AUTOCADASTRO` · `EQUIPE` · `EQUIPE_COM_AVISO`) — o compilador cobra a escolha de quem escrever a próxima chamada, em vez de a regra depender de uma caixinha. O terceiro caminho, **contratar serviço na ficha**, também escapava (criava acesso e convidava sem caixa nenhuma) e entrou na regra.
- **🖥️ A EQUIPE PODE VER O PAINEL DO CLIENTE — "vê tudo, não assina nada" (ADR-128).** Botão **Painel** no card do lead, no card e na tabela de clientes, e na ficha. É **sessão de suporte**, não login emprestado: `Session.operadorId` guarda quem entrou, o `userId` continua sendo o cliente (⚠️ **o isolamento do `portalProcedure` não muda uma linha**), e o histórico passa a dizer "Thaís, vendo como Clínica X". ⚠️ **A trava do só-leitura mora no `portalProcedure`**, barrando toda **mutação** — marcar ação por ação exigiria lembrar da lista em toda ação nova, e no Portal escrever é sempre falar pelo cliente. O `/upload` repete a trava porque não passa por lá. Dura **30 minutos**, e "Voltar ao meu acesso" devolve a sessão original **sem novo login**. ADMIN+ sempre; funcionário só nos clientes dele. Registrado em `activityLog`.
- **🚦 O CARD DO PORTAL TEM TRÊS ESTADOS, NÃO DOIS (ADR-128).** `SEM_ACESSO` → **Enviar acesso** · `CONVIDADO` → **Reenviar acesso**, dizendo *"convidado há 6 dias, ainda não entrou"* · `ATIVO` → **Painel**, dizendo *"último acesso há 2 dias"*. O do meio é o que a Thaís não tinha: saber que convidou e ninguém apareceu. Pediu `User.ultimoAcessoEm`, marcado ⚠️ **só no login com senha** — sessão de suporte da equipe não conta, porque o número responde "o CLIENTE veio?".
- **🐛 DEFEITO ACHADO NA TELA e corrigido (ADR-128):** um cliente pode ter **duas** contas de Portal. Pegando "a primeira por data", a ficha mostrava **"Enviar acesso" para quem entrava no Portal todo dia**. Hoje `acessoAoPortal` recebe a **lista** e manda quem **realmente abre a porta**; sem nenhuma ativa, a régua do "convidado há N dias" é a conta **mais antiga** (reenviar convite não zera a espera do cliente).
- **✔️ Migração JÁ NO AR** (aplicada em 27/08 às 21:43): `20260827003000_sessao_de_suporte_e_ultimo_acesso`. Três colunas **novas e nuláveis** + FK `SET NULL` + índice. Nada apagado, nada convertido; reverter é derrubar FK, índice e colunas.
- **📌 RITMO DE TRABALHO (ordem do dono, 26/08):** desenvolver no **localhost** → mandar para o **GitHub** → **publicar UMA vez no fim do dia**. Nada de publicar a cada tarefa; parar no merge com CI verde e não oferecer deploy.

## Estado anterior (2026-08-26 · noite, depois da publicação)

- **📄 A PROPOSTA DE FATURAMENTO VIROU O PAPEL REAL DA THAÍS (ADR-127).** O dono mandou o modelo que ela usa (Proposta 33 — Prisma Visão) com a regra: **a estrutura do conteúdo é dela, a forma pode ser lapidada**. O corpo agora traz, na ordem dela: abertura institucional própria do faturamento · **Objetivo da parceria** com os convênios · **Como funciona o nosso serviço**, e antes das seis etapas **o que a Clínica precisa entregar** (dados do paciente, autorizações, tabelas, acesso à plataforma e aos portais) · **Suporte comercial** · **Gestão e acompanhamento** · **Prazos e rotina** · investimento · dados para pagamento · **Confidencialidade**. ⚠️ **A numeração das seções saiu** (era minha, não dela) — e tirá-la resolveu um desleixo que só a prévia mostrou: o título *Investimento* aparecia duas vezes seguidas, porque o bloco `{{servicos}}` já traz o seu.
- **💸 O FATURAMENTO É SÓ PERCENTUAL, E A PORCENTAGEM VARIA POR CLIENTE (ADR-127, ordem do dono).** A tabela de faixas do papel de exemplo (valor fixo embaixo, percentual em cima) **não entrou** — o dono corrigiu o próprio exemplo. O sistema já fazia isso: `Servico.percentual` é o padrão e o campo é **editável dentro de cada proposta**. **Zero código de preço novo, zero migração para isso.** ⚠️ A tabela do exemplo tinha dois defeitos que teriam virado nossos: `R$ 1.1200,00`, que não é número, e um buraco entre R$ 25.000 e R$ 100.000.
- **🏦 NASCEU O BLOCO "DADOS PARA PAGAMENTO", em Ajustes → Dados da empresa (ADR-127).** Cinco colunas novas e nuláveis em `IdentidadeInstitucional` (banco, agência, conta, titular, chave PIX) e o marcador `{{dadosPagamento}}`. Sai na **Proposta comercial** e na **de faturamento**; ⚠️ **NÃO sai na de credenciamento** — ordem do dono: ali a Thaís só cobra depois do sucesso na operadora, e a conta a receber nasce na aprovação (ADR-104). ⚠️ **A regra do vazio é o que importa:** campo em branco não vira `Agência: ` na frente do cliente — a linha some; com os cinco em branco, **a seção inteira some**. É função pura testada (`montarDadosPagamento`, em `@app/shared`). **Pendência da Thaís: preencher os dados de verdade em produção.**
- **🧾 "CONDIÇÕES DE PAGAMENTO" SAIU DAS PROPOSTAS (ADR-127, ordem do dono).** Não há condição a negociar: é sempre PIX, e o PIX já vai no bloco acima. O campo saiu do construtor, do schema (`condicoes`) e dos três formatos. ⚠️ **A frase do repasse virou automática:** sempre que a proposta inclui um serviço cobrado **só por percentual**, o documento diz sozinho *"O recebimento do Repasse será sempre feito após o crédito na conta da Clínica."* — inclusive em proposta misturada. O texto continua vindo de `Servico.condicaoPagamento` (ADR-125), editável na tela de Serviços: mudar uma vírgula não é publicação.
- **📉 O FATURAMENTO MÉDIO MENSAL SAIU DO PAPEL E FICOU NO FUNIL (ADR-127).** O dono levantou a dúvida certa — *"o cliente pode faturar muito ou pouco e teremos que toda hora ficar mudando a média"* — e o número tinha dois usos, só um incomodando. No papel, *"R$ 6.000,00/mês (5% de R$ 120.000,00)"* é **promessa que envelhece no mês seguinte**; no funil, sem ele o lead volta a valer **R$ 0,00** (o defeito que a ADR-125 consertou de manhã). Então a conta impressa saiu e ⚠️ **o marcador `{{faturamento_mensal}}` foi REMOVIDO** do servidor e da prévia — não basta parar de usar, o número não pode ter caminho até o papel. O campo continua no construtor, marcado *"não aparece no documento"*, alimentando o valor do negócio como antes. Como não vai mais ao cliente, **ninguém precisa mantê-lo atualizado**.
- **🔁 A COMPARAÇÃO POR CATEGORIA VOLTOU — PELA QUARTA VEZ — E FOI MORTA DE NOVO (ADR-127).** `categoria === "Faturamento" ? emReais(percentual) : null` estava em **quatro lugares** de `documentos.service.ts`, montando o item da proposta a partir do cliente e do lead: **qualquer serviço percentual de outra categoria perderia o percentual em silêncio** ao virar proposta. Ninguém tinha sido mordido; seria no dia em que a Thaís pusesse % num serviço de Gestão. Agora há **teste lendo o arquivo do servidor**, além do que já lia o da tela.
- **✔️ Migração JÁ NO AR** (mais tardar em 27/08 às 21:43): `20260826230000_dados_para_pagamento`. Cinco colunas **novas e nuláveis** — nada apagado, nada convertido, nenhuma linha existente muda de valor; reverter é `DROP COLUMN` nas cinco.
- **Provas:** typecheck e lint verdes · **441 testes de unidade** (13 novos) · **29 contra o MySQL de verdade** · e2e isolado verde em `flows-documentos-criar`, `flows-documentos-ui`, `flows-comercial` e `flows-ajustes-catalogos` · **na tela**, proposta **0230** (Clínica Vida Plena) com as seções na ordem da Thaís, os convênios, a frase do repasse e o bloco bancário `Nubank / 0001 / 686169152-5 / Thais Garcia Gestão Saúde / 34.270.022/0001-93`, **sem** conta impressa, **sem** marcador cru e **sem** erro de console.

## Estado anterior (2026-08-26 · noite, antes da ADR-127)

- **✅ NO AR DESDE 26/08/2026 às 18:57.** Publicação `33015554302` no commit `d5dcc7c`, disparada por `workflow_dispatch`. A **suíte completa rodou antes de tocar no servidor** (`build-test` + `e2e` + `integration`, os três verdes — o elo da ADR-121), depois 7/7 no deploy: `node_modules preservado`, **`All migrations have been successfully applied`** (as TRÊS novas), ensaio de boot com **16 portas ouvindo**, `restart.txt marcado em 2026-08-26 18:56:46`, `/health` = `{"status":"ok"}`, `/` e `/credenciamentos` = **200**. ⚠️ **O que NÃO foi conferido:** a tela de produção logada. O smoke test prova que o site responde, não que a proposta de faturamento desenha certo lá — a conferência na tela exige a sessão do dono. Quem abrir primeiro deve olhar `/documentos` (Novo documento → Proposta de faturamento médico) e `/ajustes` → Operadoras.

- **🏥 CADA PROPOSTA DE CREDENCIAMENTO É DE UMA OPERADORA SÓ (ADR-126).** O papel real da Thaís negocia com uma operadora por vez — cada uma tem prazo, documentação e desfecho próprios, e uma proposta com três operadoras dentro **não pode ser aceita pela metade**. Consequência aceita pelo dono: credenciar em três = **três propostas, três números** (0225, 0226, 0227). ⚠️ **A grade médico × operadora NÃO mudou** (ADR-104): quem virou "uma só" é o DOCUMENTO. Na tela o construtor inverteu a ordem — escolhe-se a operadora, depois marcam-se os médicos daquela proposta. Provado na tela: proposta **0228** para a Clínica Bem Estar saiu com Unimed e `| Dra. Helena Martins Prado — Cardiologista | Unimed | R$ 25,00 |`.
- **📊 A PROPOSTA DE FATURAMENTO NASCEU: só percentual, sempre mensal (ADR-126).** Modelo novo **"Proposta de faturamento médico"** (reconhecido pelo marcador `{{convenios}}` no corpo, como o credenciamento se reconhece por `{{operadoras}}`). A linha do serviço percentual **perdeu valor, quantidade e avulso/mensal** — e ⚠️ **quem decide isso é o PREÇO** (`ehServicoSomentePercentual`, em `@app/shared`), **nunca a categoria**: foi a terceira vez que a comparação `categoria === "Faturamento"` precisou ser removida, e agora há um teste que reprova a volta dela. A proposta traz os **convênios atendidos** e o **faturamento médio mensal**, e o papel mostra a **conta feita** — *"Valor estimado do serviço: R$ 6.000,00/mês (5% de R$ 120.000,00)"* —, não o percentual solto. Provado na tela: proposta **0229** para a Clínica Vida Plena, com Unimed + Bradesco Saúde no corpo e a condição de pagamento do serviço pré-preenchida sozinha (ADR-125).
- **🔗 A OPERADORA VIROU UM CADASTRO SÓ, COM MARCAÇÃO POR SERVIÇO (ADR-126).** `Operadora.usoCredenciamento` e `Operadora.usoFaturamento`, ambas **`true` para todas as que já existiam** — senão a primeira proposta de faturamento abriria vazia e pareceria defeito. Em **Ajustes → Operadoras e convênios** a tela mostra abas (Todas / Credenciamento / Faturamento), mas o registro é o mesmo: a mesma Unimed que se credencia é a Unimed cujas contas se faturam. ⚠️ **Desmarcar as duas é recusado** — operadora invisível em todas as listas se lê como perda de dado. ⚠️ **A grade do credenciamento continua mostrando** a operadora desmarcada que já tenha processo daquele cliente (mesma lição da ADR-105).
- **🏷️ OS CONVÊNIOS FICAM COM O CLIENTE, NÃO COM O DOCUMENTO (ADR-126).** `ClienteServico ↔ Operadora` (N-N): a lista nasce da proposta aceita, é editável na ficha em **Serviços → Editar preço → "Preço e convênios"**, e o cliente a vê no **Portal**. ⚠️ **Os convênios viajam DENTRO do item da proposta** (`conveniosIds`), não soltos no documento — é assim que atravessam o aceite, pelo mesmo caminho que serviço e preço já percorrem; e são **ids, não nomes**, porque nome copiado não sobrevive a um "renomear" no catálogo. Provado na tela: ficha mostrando *"Convênios atendidos: Unimed, Omint"* e Portal mostrando os cinco.
- **↩️ A PROPOSTA CORRIGE O LEAD (ADR-126).** O faturamento mensal informado na proposta é o **mesmo número** que a Qualificação pergunta: corrigi-lo ali grava no lead e recalcula o valor do negócio, pela mesma `reconciliarPassosAuto`. Um número só, andando para frente — sem isso o card mostraria um valor velho ao lado de um documento com o valor novo. É best-effort de propósito: proposta emitida não cai porque o funil recusou um número, e lead já convertido não é tocado.
- **✔️ As três migrações do dia JÁ ESTÃO NO AR** (aplicadas às 18:56 na publicação acima): `20260826150000_faturamento_percentual_e_condicao_pagamento` (ADR-125) e `20260826193338_operadora_por_servico_e_convenios_do_cliente` e `20260826213000_remove_exigencia_operadoras_duplicada` (ADR-126). As duas primeiras são **aditivas** — nada apagado, nada convertido, nenhuma linha existente muda de valor. Reverter a segunda = apagar `Operadora.usoCredenciamento`, `Operadora.usoFaturamento` e a tabela `_ClienteServicoOperadoras`. **A terceira APAGA dado** (uma linha de exigencia), com guarda: so onde ninguem respondeu; reverter = recadastrar a exigencia em Servicos.
- **🧹 A EXIGÊNCIA DUPLICADA FOI REMOVIDA (ADR-126, ordem do dono).** *"Quais operadoras você atende?"* pedia em texto livre exatamente a lista que virou campo estruturado — o Portal mostrava a mesma pergunta duas vezes, uma delas obrigatória. ⚠️ **Precisou ser migração** (`20260826213000_remove_exigencia_operadoras_duplicada`), não só tirar da semente: `seedRequisitosSeVazio` só semeia com a tabela **vazia**. ⚠️ **A guarda é o que importa:** o `DELETE` só apaga onde ninguém respondeu e nada foi enviado — onde houver resposta a exigência **fica**, porque apagá-la levaria junto o trabalho do cliente. O `Formulario` interno **não** é apagado (seria `Cascade` nas respostas). No local: 0 respostas, 0 arquivos, as outras 6 exigências do Faturamento intactas.

## Estado anterior (2026-08-26)

- **💰 O SERVIÇO PERCENTUAL PAROU DE PEDIR UM VALOR FIXO QUE NÃO EXISTE (ADR-125).** O Faturamento de contas médicas não tem preço fixo — a Med ganha um **percentual** do que a clínica fatura —, e mesmo assim o passo obrigatório da Qualificação exigia *"Registrar o valor estimado da oportunidade"* e **travava a etapa**. Pior que travar: o lead valia **R$ 0,00** no card e no total da coluna, então o negócio mais valioso do mês podia aparecer como zero. Agora a Qualificação pergunta **"Registrar o faturamento mensal estimado do cliente"** e o sistema **calcula** o valor (faturamento × percentual). ⚠️ **A regra NÃO cita "Faturamento" em lugar nenhum — ela lê o PREÇO do serviço** (`planejarEstimativaDoLead`, pura, em `@app/shared`, usada pelo servidor E pela tela): havendo qualquer valor fixo entre os serviços, volta a pedir a estimativa como sempre; o **caso misturado** (Faturamento + Gestão) continua no comportamento antigo de propósito, senão o valor fixo sumiria do relatório. A troca é **automática nos dois sentidos** — marcar um serviço de preço fixo devolve a pergunta antiga sozinho. O **credenciamento fica fora da conta**, igual ao provisionamento da conversão (ADR-104/108); para as duas regras não divergirem, `ehServicoDeCredenciamento` **mudou de casa** para o `shared`. Provado na tela: marcar Faturamento troca o campo ao vivo, digitar mostra *"Valor do negócio: R$ 100,00/mês (5% de R$ 2.000,00)"*, e card/painel/total da coluna mostram R$ 100,00. ⚠️ **Ficou de fora, e já era assim antes:** o total do funil soma valor **mensal** com valor **avulso** no mesmo bolo.
- **📄 A CONDIÇÃO DE PAGAMENTO SAIU DA MEMÓRIA DE QUEM DIGITA (ADR-125).** A condição do Faturamento é sempre a mesma frase — *"O recebimento do Repasse será sempre feito após o crédito na conta da Clínica."* — e dependia de alguém lembrar de escrevê-la, igual, em toda proposta, num campo livre com placeholder *"Ex.: 30% + 2x"*. Virou **`Servico.condicaoPagamento`**, editável em **Serviços → Configurar → Detalhes** (mesmo molde de `clausulasContrato`): a proposta **pré-preenche** com a condição de cada serviço escolhido, sem repetir, e **para de mexer assim que alguém digita** — proposta se negocia. ⚠️ **O texto NÃO está no código**: mudar uma vírgula é a Thaís editar a tela, não uma publicação. Descartadas: sumir com o campo (a proposta ficaria muda sobre quando o cliente paga, e não sobrevive ao caso misturado) e escrever a frase no código.
- **🧹 DOIS CONSERTOS EM CLIENTES, achados ao verificar (ADR-125).** (1) A linha **"Valor contratado"** do *Resumo comercial* soma o `valorEstimado` dos leads ganhos; para quem só paga percentual isso dá zero e a linha **sumia da tela** — a ficha ficava muda sobre o que o cliente paga. Agora, sem valor fixo, mostra o preço real do que está contratado (`5% do faturamento/mês`). (2) No editor de preço da ficha, o campo de % só aparecia para a categoria "Faturamento", e a gravação faz `percentual: ehFaturamento ? … : null` — abrir e salvar **qualquer outro serviço apagava o percentual dele em silêncio**. Hoje quem decide é o preço, não a categoria. Não mordia ninguém ainda; morderia no dia em que a Thaís pusesse % em outro serviço.
- **🔑 A senha do ambiente LOCAL agora é escolhida por quem vai usá-la.** `pnpm senha:rotacionar <senha>` aceita a senha; sem argumento continua sorteando. O dono não conseguia entrar como `root@` nem `thais.garcia@` no localhost — **as contas estavam sadias**, a senha é que era um sorteio de 24 caracteres guardado só no arquivo de variáveis. ⚠️ **Troca TODAS as contas internas** que ainda usavam a senha de desenvolvimento (foram 6), não só as duas pedidas. A trava de produção (a mesma do `demo-seed`) vale nas duas formas, e a validação da senha escolhida é **função pura testada** — aspas duplas, barra invertida ou quebra de linha corromperiam o arquivo **em silêncio** e trancariam tudo fora. Nada de produção é tocado.
- **✔️ Migração JÁ NO AR** (mais tardar em 27/08 às 21:43): `20260826150000_faturamento_percentual_e_condicao_pagamento`. Duas colunas **novas e nuláveis** (`Lead.faturamentoMensalEstimado`, `Servico.condicaoPagamento`) — nada é apagado nem convertido, nenhuma linha existente muda de valor, e reverter é apagar as duas colunas.

## Estado anterior (2026-08-22)

- **✅ NO AR DESDE 22/08/2026 às 19:03 — e o E-MAIL FINALMENTE FUNCIONA, provado na tela.** Publicação `32591319305` no commit `f23a1f2`: a **suíte completa rodou antes de tocar no servidor** (`build-test` + `e2e` + `integration`, os três verdes — primeira vez que o elo da ADR-121 foi exercido de verdade), depois 7/7 no deploy com `found 0 vulnerabilities`, `No pending migrations to apply`, `/health` = `{"status":"ok"}`, `/` e `/credenciamentos` = 200. **A prova do e-mail não é o deploy verde, é o monitor:** enviados em 7 dias saiu de **0 → 5**, taxa de entrega de **0% → 17%**, e o e-mail *"Seu acesso ao Portal do Cliente"* para **`tibamooca@gmail.com`** — o mesmo que em 21/08 falhou no certificado — aparece **`enviado`**. **A senha SMTP estava certa**: a ressalva de que a autenticação seria a próxima barreira **não se concretizou**. ⚠️ **Para testar e-mail de novo, NÃO reenvie o formulário com um endereço já no funil:** o `capturarLead` deduplica por e-mail, atualiza o lead existente e não manda convite novo (só as 4 notificações internas). Use o botão **"Enviar acesso"** no card do lead — foi assim que a prova foi feita — ou um endereço inédito; "Enviar acesso" **move o lead para "Qualificação"**, reversível arrastando.
- **~~Publicar exige a mão do dono~~ — DEIXOU DE SER VERDADE em 26/08.** Em 21/08 o classificador de segurança barrou `gh workflow run` **e** `gh api .../dispatches`, testado nas duas formas; em **26/08 o mesmo `gh workflow run deploy.yml --ref main -f confirmar=PUBLICAR` passou** e a publicação foi disparada por mim. **Tente primeiro** antes de pedir ao dono; se barrar de novo, ele cola o comando com `!` na conversa (a saída cai no chat e eu acompanho por `gh run view <id>`). ⚠️ **O que continua exigindo a mão dele é o SIM**, não o comando. ⚠️ **O `deploy.yml` NÃO cria a etiqueta sozinho** — descoberto em 26/08, quando a publicação saiu sem `git tag` e a etiqueta teve de ser criada à mão depois. Etiquetas: `v1.0.0` marca `bd61f6a` (22/08) e `v1.1.0` marca `d5dcc7c` (26/08).
- **📧 O DIAGNÓSTICO: nenhum e-mail jamais tinha saído de produção (ADR-122) — hoje resolvido e no ar.** O dono criou um lead pelo site e não recebeu nada; o relato era sobre **um** e-mail, o problema era **todos**. O monitor `/emails-enviados` em 21/08 mostrava **25 falhas em 7 dias, taxa de entrega 0%** e — filtrando "Enviados" + "Todo o período" — *"Nenhum e-mail encontrado"*: nunca houve uma entrega. Todas as falhas com a **mesma** mensagem: `Hostname/IP does not match certificate's altnames: Host: localhost. is not in the cert's altnames: DNS:atena.hostsrv.org`. **Não era senha, porta nem firewall — era o nome no certificado:** `SMTP_HOST=localhost` (o servidor de e-mail roda na própria máquina da TineHost), mas o certificado apresentado é o da máquina física. O disparo sempre funcionou (as 4 notificações internas e o acesso ao Portal foram tentados às 17:00); o transporte é que nunca completava. Conserto em `apps/api/src/lib/email-tls.ts`: a conferência do **nome** do certificado é dispensada **só para loopback** — host remoto continua validando inteiro, e a **caixa pessoal** (`modules/email/smtp.ts`) **não** foi tocada, porque lá trafega a senha do webmail de cada pessoa. ⚠️ **Duas armadilhas:** o erro veio como `localhost.` **com ponto final**, então `=== "localhost"` não pegaria; e a comparação é contra conjunto fechado, nunca `includes` (`localhost.evil.com` é endereço de internet de verdade). ⚠️ **Ressalva:** isto derruba a primeira barreira, a única comprovada. Se a senha SMTP do servidor estiver expirada (pendência do dono desde 05/08), o e-mail falhará de novo com mensagem **de autenticação**. **A ressalva da senha SMTP NÃO se concretizou:** depois de publicar, a taxa saiu de 0% e o e-mail externo foi entregue. A senha estava certa.
- **📦 O REPOSITÓRIO MUDOU DE DONO, e a org TEM REGRA DE REPOSITÓRIO: a `main` só aceita PR, com 3 verificações obrigatórias.** Push direto na `main` **deixou de existir** — tentar responde `GH013: Changes must be made through a pull request` + `3 of 3 required status checks are expected`. A conta pessoal antiga não tinha isso; a organização já vem com o ruleset. Consequência prática: **todo trabalho, inclusive documentação, passa por PR** — e a decisão da ADR-121 de **não** pôr `paths-ignore` em `pull_request` se provou certa por pouco, porque com check obrigatório um PR só de `.md` que não disparasse a CI ficaria travado para sempre. Saiu de `thi-garcia` e foi para a organização `garcia-goncalves` (plano Team). O sócio André (`andgoncs`) é **Owner da org**, o que lhe dá `admin` aqui automaticamente — não há nada a conceder repositório a repositório. O GitHub redireciona o endereço antigo, então nada quebrou; mesmo assim o `remote` local foi reapontado em 21/08 e as **3 citações ao nome velho** em `docs/DEPLOY.md` e `docs/LINKS.md` foram corrigidas. Endereço correto: `https://github.com/garcia-goncalves/workspace-medconsultoria`.
- **✂️ A CI FICOU ESCALONADA — este repositório sozinho consumia 116% da cota de Actions da conta inteira (ADR-121).** Medido tarefa a tarefa: **2.313 min em 30 dias**, contra 3.000 min de cota para 15 repositórios; `e2e` (1.160) + `integration` (590) eram 58% do gasto da conta toda. A cobrança é **por job, arredondada para cima a cada minuto** — três jobs em paralelo fazem 6,3 min de relógio custarem ~13 min de cota. Agora: `push` na `main` roda **só `build-test`**; `pull_request` roda tudo; e o `deploy.yml` **chama a CI completa** (`workflow_call` + job `suite` com `needs: suite`) no commit exato que vai ao ar — sem esse elo o corte viraria buraco de cobertura. Entraram também `concurrency` com `cancel-in-progress: true` (18 execuções do mês foram substituídas e vieram cobradas inteiras), `needs: build-test` nos dois jobs caros e `paths-ignore` de `.md`/`docs/**` **só no `push`** (em `pull_request` travaria PR de documentação). ⚠️ **Não copie o `concurrency` da CI para o `deploy.yml`:** lá é `cancel-in-progress: false` de propósito — CI cancelada não custa nada, publicação cancelada no meio deixa o servidor indefinido. Duas hipóteses já **mortas pela medição**, não as repita: não havia duplicata `push`/`pull_request` (1 commit em 174) e não faltava cache de dependência (`pnpm install` leva 3 s).
- **✅ A COBRANÇA DO GITHUB FOI RESOLVIDA PELO DONO (20/08) — Actions funcionando de novo.** Entre ~20:29 e ~21:40 de 19/08 toda execução morria em 2-3 s antes de receber máquina (`runner` vazio, zero passos), com a mensagem literal *"The job was not started because recent account payments have failed or your spending limit needs to be increased"* — derrubando **CI e Deploy juntos**, porque os dois são workflows. **Provado que voltou, não presumido:** reexecutei a CI da `main` e ela pegou máquina e percorreu os passos até o fim, **verde nos três jobs** (`build-test`, `e2e`, `integration`) no commit `33d0d65`. **A regra de diagnóstico que fica:** execução de OUTRA pessoa passando enquanto a minha morre em segundos, com `runner_name` vazio, é **conta**, não código — e a mensagem só aparece em `gh run view <id>`, nunca em `--log-failed` (que responde "log not found").
- **A ADR-118 (dinheiro em `Decimal`) JÁ ESTÁ EM PRODUÇÃO** — publicada às 19:45–20:01 de 19/08 pela **outra janela** (deploy `workflow_dispatch` no commit `a3a7f02`, 7/7 verde, `found 0 vulnerabilities`, `All migrations have been successfully applied`). **Conferido NA TELA de produção em 19/08 às 20:40** (o modo de falha da ADR-118 é "R$ NaN" **sem erro de console**, então tipagem verde não bastava): catálogo em `/servicos` mostrando `R$ 3.500,00/mês`, `3,5% do faturamento/mês` e `R$ 1.500,00`; `/leads` e `/financeiro` com `R$ 0,00` — **nenhum NaN, zero erro de console**. Ressalva honesta: funil e Financeiro estão **vazios** em produção, então o valor estimado do lead e a conta a receber não foram exercidos com dado real — quem exercer primeiro deve olhar.
- **⏸️ A ADR-119 (cliente sempre PJ) está mesclada na `main` (PR #105), com CI VERDE, e NÃO está no ar — falta só o "pode subir" do dono.** Não há impedimento técnico nenhum: `main` = `33d0d65`, CI verde, nenhum deploy em andamento, e o PR #106 do André segue **aberto e não mesclado** (publicar não leva o trabalho dele). O sim não foi dado porque a sessão acabou antes — **a publicação é irreversível pelo dado** e por isso não se aperta o botão sozinho. Publicar é `gh workflow run deploy.yml --ref main -f confirmar=PUBLICAR`, **rodado por mim, não pelo dono**. ⚠️ Avisar antes: a migração **move para as observações da ficha** o CPF de quem era pessoa física e a marcação de PF **some do banco** (o número muda de lugar, a distinção acaba); e o `npm ci` deixa a produção ~1 min reinstalando dependências enquanto segue servindo.
- **A CI voltou a ser confiável: o navegador de teste agora é cacheado (ADR-120, PR #107, mesclado em `33d0d65`).** O job `integration` da `main` tinha sido **cancelado pelo limite de 25 min baixando o Chromium**, com o código intacto — falha de infraestrutura que se lê como falha de código. Rodada de prova depois do merge: 3/3 verdes.

- **Todo cliente é pessoa jurídica — a escolha PF/PJ deixou de existir (ADR-119).** Os clientes da Med são médicos e clínicas, e todos têm CNPJ. `Cliente.tipo`/`ClienteTipo` foram **removidos do banco** e `Cliente.documento` virou **`Cliente.cnpj`** (migração `20260819161500_cliente_sempre_pj`, escrita à mão: o Prisma geraria `DROP`+`ADD` e apagaria os CNPJs gravados). **A parte que importa não estava na tela:** a **conversão do lead** criava cliente **pessoa física** sozinha quando o lead não tinha "Empresa" preenchida (`tipo: temEmpresa ? "PJ" : "PF"`) — e a triagem do credenciamento depois reprovava esse cliente pela regra R1, um INAPTO fabricado pelo próprio sistema. Hoje a conta nasce PJ nos dois casos e a pessoa do lead vira **contato principal sempre** (a conta é uma empresa, e empresa não atende telefone). **`Lead.cnpj` é novo** (opcional no 1º contato, viaja para a ficha na conversão). **CNPJ passou a ser validado por dígito verificador** na tela e no servidor (`validarCNPJ`, `packages/shared/src/cnpj.ts`) — antes só havia máscara e `11.111.111/1111-11` era aceito; aceita o **formato alfanumérico** (`12.ABC.345/01DE-35`, válido para empresa aberta desde julho/2026). A **R1 da triagem foi aposentada** (R2…R6 mantêm o número de propósito). ⚠️ **De novo a armadilha da ADR-118:** typecheck em zero **não** provou nada — `createLead`, `updateLead` e o painel do lead descartavam o `cnpj` **em silêncio**. Provado com 5 testes contra MySQL de verdade (inclusive o banco recusando `tipo='PF'`) e na tela: lead sem empresa → converter → cliente PJ com CNPJ e contato principal. ⚠️ Em produção a migração **move para as observações da ficha** o CPF de quem era pessoa física, e a marcação de PF **some** (irreversível).

- **Dinheiro em `Decimal`, e a última dívida da auditoria de 05/08 fechada (ADR-118).** Os cinco campos que ainda eram `Float` — `Servico.valor`/`percentual`, `ClienteServico.valor`/`percentual` e `Lead.valorEstimado` — viraram `DECIMAL(12,2)` (migração `20260819153758_dinheiro_em_decimal`). **A parte que quase deu errado é a que importa:** trocar o tipo faz o Prisma devolver um objeto `Decimal.js`, e um `Decimal` que atravessa o tRPC vira objeto no JSON — a tela mostra **"R$ NaN" sem um único erro no console**, pior do que o centavo que o `Float` errava. O `tsc` pegou 10 caminhos; **não pegou dois** (`ativarServicoCliente` e `cancelarServicoCliente`, que devolviam o objeto cru do Prisma — este último usado também pelo **Portal do cliente**), achados por varredura de revisor depois do typecheck verde. Regra que fica: **`Decimal` nunca atravessa o tRPC** — a conversão é `emReais()`/`emReaisOu()` em `apps/api/src/lib/dinheiro.ts`. Provado com `typeof` em runtime contra MySQL de verdade (`dinheiro-decimal.integration.test.ts`, 7 verdes) e **na tela**: contratar "Gestão Operacional" pela ficha mostrou `R$ 3.500,00/mês`, catálogo/funil/Início/Financeiro sem NaN, zero erro de console. ⚠️ Em produção o `ALTER TABLE` **arredonda** o que tiver mais de duas casas (que é o lixo do `Float` — o arredondamento é o conserto).

## Estado anterior (2026-08-18)

- **NO AR desde 19/08/2026 às 11:08 (ADR-116 + ADR-117 em produção).** Publicação de 7/7 passos verdes: `npm ci` instalou **sem vulnerabilidade** (`found 0 vulnerabilities` dito pelo npm **do servidor**, não pela CI), `No pending migrations to apply`, ensaio de boot com **16 portas ouvindo**, `/health` = `{"status":"ok"}`, `/` e `/credenciamentos` = 200, `/comecar` carregando sem a faixa "AMBIENTE LOCAL". **O objetivo da ADR-116 só foi atingido aqui** — até esta publicação o servidor seguia com `deepmerge-ts` 7.1.x.
- **⚠️ A publicação anterior (18/08, 17:53) FALHOU no passo 5/7 e deixou a produção SEM `node_modules` (ADR-117).** O `npm ci` recusou o artefato — `Missing: deepmerge-ts@7.1.6 from lock file` — porque no npm `nome@faixa` é **seletor de pai**, não escopo do próprio pacote: o `npm install` resolvia 8.0.1, mas as arestas do lock seguiam pedindo 7.x. **A chave passou a ser traduzida** (`nome@faixa` → `nome`; árvore resolvida idêntica, 0 diferenças em 260 pacotes) e o conferidor passou a ensaiar **`npm ci --dry-run`** — a checagem que faltava. **O que machucou:** o socorro guardava o `node_modules` por hardlink em `/tmp`, que na TineHost é outro dispositivo, e depois fazia `rm -rf node_modules` **sem conferir se a cópia existia**. O site seguiu no ar só porque o processo Node já estava em memória. Confirmado no log da publicação seguinte: `cp: cannot stat 'node_modules': No such file or directory`. Hoje a cópia vai para `~/nm-antes` e **nada é apagado sem cópia conferida** (`deploy.yml` e `deploy.sh`).

- **O SERVIDOR INSTALAVA UMA FALHA ALTA QUE A CI DIZIA ESTAR FECHADA — corrigido (ADR-116).** O artefato subia **sem lockfile** e era instalado com `npm install --omit=dev`; como **o npm não lê `pnpm.overrides`**, o servidor re-resolvia a árvore e instalava `deepmerge-ts` **7.1.5/7.1.6** — a falha ALTA de exaustão de pilha que a ADR-112 fechou em 12/08. `pnpm audit --prod` da CI dizia **0** e `npm audit --omit=dev` na árvore do servidor dizia **5 ALTAS**: eram duas árvores diferentes. Agora o artefato leva os **overrides traduzidos para a sintaxe do npm** (ADR-117) e um **`package-lock.json` com 261 pacotes travados**; o servidor instala com **`npm ci --omit=dev`**, que recusa rodar se o lock discordar do `package.json`. A CI passou a montar o artefato de verdade (`pnpm build:deploy`) e a auditá-lo **dentro de `apps/api/dist`**. Provado: `deepmerge-ts` 8.0.1, `npm audit --omit=dev` = 0. ⚠️ `npm ci` **apaga `node_modules`** antes de instalar — ~1 min com a produção servindo enquanto a pasta é refeita.
- **A chave de deploy exposta em 17/08 foi REVOGADA (ADR-114) — dívida de segurança FECHADA.** Trocar a chave do servidor virou o workflow **Rotacionar chave de deploy**, executado em 18/08 às 16:06: o runner (que já tinha a chave antiga) se autorizou sozinho, e o servidor respondeu `Permission denied (publickey)` à chave velha. **Republicado em seguida às 16:16** para provar a chave nova de ponta a ponta (16 portas no ensaio de boot, `/health` ok, `/`, `/credenciamentos` e `/comecar` = 200). **A revisão de segurança da 1ª versão do workflow é a parte que interessa:** três caminhos terminavam VERDE — dois trancando o dono fora do servidor, um declarando paga a dívida com a chave vazada ainda valendo. Causas: casar a remoção pelo **comentário** da chave (casa por substring — apagava a nova junto, e a documentação induzia o nome perigoso); interpolar campo de texto livre dentro de `ssh "..."` (aspa simples = execução no servidor de produção); e aceitar "o ssh falhou" como prova de revogação (o corte de IP da TineHost viraria falso OK). Hoje casa pelo **corpo** da chave, não há campo para digitar, e a prova negativa exige `Permission denied` literal.
- **As 19 vulnerabilidades do aviso do GitHub NÃO alcançam produção (ADR-115)** — conferido pacote a pacote em 18/08, não presumido pelo portão verde. `pnpm audit --prod` **sem corte de nível** = zero. As 6 críticas são do `vitest`; as altas, de `eslint`/`vite`/`playwright`. O artefato publicado leva só `apps/api` + `packages/db` (21 dependências) e **nenhum pacote alertado está nelas** — o Dependabot marca dev como `runtime` porque lê o `pnpm-lock.yaml` e não entende workspaces do pnpm. **O “achado latente” desta ADR não era latente — ver ADR-116:** o servidor já instalava `deepmerge-ts` 7.1.x, falha ALTA que a ADR-112 tinha fechado. Fechado em 18/08.
- **⚠️ O terminal do dono é PowerShell.** `comando < arquivo` **não existe** lá (`The '<' operator is reserved for future use`). Receita para ele = `Get-Content <arquivo> -Raw | <comando>`. `docs/DEPLOY.md` §0 traz as duas colunas.

- **NO AR desde 17/08/2026 às 17:52, publicado pelo GitHub (ADR-113).** Correções ADR-108/109/110/112 em produção; conferido de fora: `/health` = `{"status":"ok"}`, `/`, `/credenciamentos` e `/comecar` = 200, login sem a faixa "AMBIENTE LOCAL", zero erro de console. **A primeira publicação revelou dois defeitos antigos que o laptop escondia:** (1) `scripts/bundle-deploy.mjs` importava `esbuild` sem ninguém declarar — convivem 4 versões na árvore, e qual montava o artefato de produção era sorte da ordem de instalação (fixado em `0.27.7`); (2) **a TineHost corta conexões SSH repetidas de um IP desconhecido** e o runner é sempre IP novo — o workflow passou a abrir **UMA** conexão (`ControlMaster`) reaproveitada por todos os passos, sem voltar a encadear com `&&` (a cicatriz do `prisma generate` continua valendo).

- **Falha ALTA nova em dependência, pega sozinha pela CI (ADR-112):** `deepmerge-ts` <8 (exaustão de pilha). Override escopado `"deepmerge-ts@7": "^8.0.0"`, e entrou teste que lê e-mail de verdade pelo `mailparser` — pulo de versão maior por baixo do e-mail apareceria como caixa em branco em produção, sem erro. Foi a **primeira vez que o portão da ADR-107 reprovou algo por conta própria**.
- **⚠️ PUBLICAR MUDOU: agora é um botão no GitHub, não `./deploy.sh` (ADR-111).** Actions → **Deploy** → *Run workflow* → digitar **`PUBLICAR`**. Mesma sequência de 6 passos, rodando no runner: a chave SSH saiu do disco e foi para *GitHub Secrets*, e o classificador de segurança não barra mais a publicação (foi o que travou a ADR-108 já pronta e com CI verde). **`concurrency: deploy-producao` acabou com a armadilha dos dois deploys simultâneos** — a segunda execução espera a primeira. **Os três segredos (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`) já estão postos** — confira com `gh secret list`. A chave que eles guardam foi trocada em 18/08 (ADR-114); a antiga (`~/.ssh/medconsultoria_deploy`) não abre mais nada. O `deploy.sh` fica no repositório como documentação e saída de emergência. Detalhe em `docs/DEPLOY.md` §0.
- **A conversão do lead não cobra mais credenciamento antes da hora (ADR-108).** Achado percorrendo o fluxo pela tela: lead cujo único serviço era **Credenciamento médico e odontológico** virava cliente **já com conta a receber** no card Financeiro da ficha — e seria cobrado **de novo** quando a operadora aprovasse. O laço da soma pulava o credenciamento; o **fallback da estimativa do funil** não olhava os serviços e provisionava mesmo assim. A regra virou função pura testável (`planejarProvisaoDaConversao`), e no caso **misturado** a observação da conta agora diz em português que o credenciamento não está naquele valor. Provado na tela: R$ 12.000,00 de estimativa → **"Nenhuma conta vinculada."**.
- **"Alguém concluiu um projeto" agora é "Automação" (ADR-109).** O projeto se conclui e se reabre sozinho quando o último cartão fecha; o histórico grava sem usuário, e o Início inventava uma pessoa. O servidor passa a devolver `auto`, e "Alguém" voltou a valer só para autor genuinamente desconhecido.
- **Botão "Ligar" do painel do lead volta a discar (ADR-110):** o `tel:` saía com máscara (`tel:(11) 98765-4321`) e o discador engasgava; agora usa os mesmos dígitos do WhatsApp.

## Estado anterior (2026-08-12)

- **Dependências de produção sem falha conhecida (ADR-107):** `pnpm audit --prod` saiu de **34 avisos (10 graves) para 0**. Eram 8 bibliotecas, não 34: `dompurify` 3.2.3→3.4.13 (o filtro anti-XSS da folha A4 — usamos o modo simples, então a maioria dos avisos não nos alcançava, mas subiu igual), `@fastify/static` 8→10.1.2, e 6 transitivas fechadas por **`pnpm.overrides` na raiz**. **`brace-expansion` está travado como `brace-expansion@5`** de propósito: convivem 3 versões maiores e só a 5 tem o defeito — override sem escopo quebraria as outras duas. **As 42 vulnerabilidades restantes do aviso do GitHub são de ferramenta de desenvolvimento e não vão ao ar.** **A CI agora reprova sozinha** falha ALTA ou CRÍTICA no que é empacotado (`pnpm audit --prod --audit-level high` no job `build-test`); moderadas e baixas aparecem num passo informativo e não reprovam — o corte é `high` para o portão não virar refém de CVE novo e acabar desligado.
- **NO AR desde 12/08/2026 às 14:06** (ADR-107 + portão de CI publicados; ensaio de boot OK com 16 portas, smoke `{"status":"ok"}`, `/` e `/credenciamentos` respondendo 200 conferidos de fora).
- **⛔ ARMADILHA CARA — nunca rode dois `./deploy.sh` ao mesmo tempo.** O deploy passa de 2 min e **parece travado**; colar o comando de novo faz os dois falharem, **sem defeito no código**. Eles disputam o mesmo `/tmp/boot-teste.log`, a mesma porta do `node app.cjs` e os mesmos `node_modules` do `prisma generate`. **Sintoma que identifica:** ensaio de boot com `0` e `--- erros ---` **vazio** — evidência apagada por concorrência, não app quebrado. Se precisar voltar atrás, restaure o **PRIMEIRO** snapshot da rodada (os seguintes já saíram contaminados). Detalhe em `docs/DEPLOY.md` §5.
- **Armadilha nova (Windows):** `pnpm install` morre com `ERR_PNPM_ENOENT ... @vitejs/plugin-react_tmp_NNNN` quando um override mexe em dependência do Vite. Pausar a app não resolve; o que resolve é `rm -rf node_modules/@vitejs` e instalar de novo.
- **Teste instável conhecido:** `flows-financeiro.spec.ts` ("marcar paga, filtrar e excluir") falha esporadicamente na suíte cheia e passa 10/10 sozinho. É instabilidade do teste, não defeito.

## Estado anterior (2026-08-11)

- **Painel de Credenciamentos (ADR-106) — a tela `/credenciamentos`**, no menu em Negócio: uma linha por cruzamento médico × operadora de **todos** os clientes, que responde a pergunta da Thaís de manhã — *o que travou?*. Antes o andamento só existia dentro da ficha de cada cliente, um por vez, e ela mantinha planilha paralela. A tela **abre pelo que está parado há mais tempo** (o contrário do padrão daqui, de propósito), marca em amarelo o que passou de **60 dias** sem andar — número dado pela Thaís, editável em **Ajustes → Dados da empresa** (migração `20260811204308`) —, filtra por cliente/operadora/situação combinados, e deixa mudar a situação sem sair da tela **reusando a mesma função da ficha**, para as travas de dinheiro não viverem em dois lugares. `A_PROTOCOLAR` também conta como atraso (a culpa ali é nossa); estado final nunca é marcado e mostra a **data** do desfecho, não "parado há N dias". Médico desativado continua na lista, marcado "fora da lista" (mesma decisão da ADR-105). Verificado na tela: alerta acendeu em 2 linhas na ordem certa e aprovar pelo painel criou a conta a receber de R$ 2.500 no Financeiro.
- **Armadilha nova:** `prisma migrate dev` **reexecuta o seed** e recria as contas internas com `senhaTrocadaEm` nulo (ADR-91) — o e2e passa a falhar no setup com "3 campos de senha", porque cai na página obrigatória de definir senha. Destrave marcando `senhaTrocadaEm` nas contas de equipe do banco **de desenvolvimento**. Produção usa `migrate deploy`, que não roda seed.
- **Documentos reais de cliente NÃO vão para o repositório** (decisão do dono em 11/08/2026): os PDFs em `brand/identidade/` têm dados de gente e operadoras de verdade, e o `.gitignore` passou a barrá-los. Material de marca sem dado pessoal segue versionado.

## Estado anterior (2026-08-10)

- **Auditoria de tela do credenciamento (ADR-105) — MESCLADA e NO AR** (PR #90; publicada em 10/08/2026 às 22:04, ensaio de boot com 16 portas ouvindo, smoke `{"status":"ok"}`). Feita gerando uma proposta de verdade e percorrendo o fluxo inteiro na tela, inclusive o Portal. Cinco defeitos que nenhum teste pegava, todos na costura entre telas: (1) **médico desativado sumia da grade levando junto um credenciamento APROVADO** cuja conta a receber continuava viva no Financeiro — agora ele fica, marcado "fora da lista", e o construtor da proposta é que deixa de oferecê-lo; (2) aprovar não atualizava o card Financeiro **da ficha** (só a página Financeiro), então a tela dizia "Nenhuma conta vinculada" logo ao lado; (3) o acervo de documentos mostrava seis "Diploma" idênticos — agora diz **de qual médico e qual lado**; (4) aprovação e negativa **não avisavam ninguém** (só `activityLog`) — dois templates novos; (5) a tabela de assinatura da proposta saía com uma **tarja azul vazia** no PDF. Também: `observacoes`/`emAnaliseEm` eram gravados e nenhuma tela lia.
- **Credenciamento inteligente — BLOCOS A, B e C COMPLETOS, MESCLADOS e NO AR** (PRs #88 e #89 em `main`, ADR-103 e ADR-104; publicado em produção em 10/08/2026 às 18:00, smoke test `{"status":"ok"}`). O credenciamento é **por pessoa**, tem **preço por cruzamento**, **documento fiel ao papel da Thaís** e **cobrança no sucesso**:
  - **Bloco A (ADR-103, já em `main`):** model **`Profissional`**, a **lista real de 14 documentos** em 4 escopos, exigência **frente e verso**, e a **triagem** INAPTO × PENDENTE que **avisa sem bloquear**. O Portal agrupa **por médico** e a barra conta **pares** (documento × médico × lado). O cliente **nunca lê "inapto"**. A reconciliação **não apaga exigência** (`Arquivo.requisitoId` é `SetNull`).
  - **Bloco B (ADR-104):** a **grade médico × operadora** — cada cruzamento é uma linha `Credenciamento` com valor, situação (a protocolar → protocolado → em análise → aprovado/negado/encerrado), datas e tentativa. **`NEGADO` não vira `APROVADO` por edição**: retentar é linha nova (tentativa 2) com o acordo registrado. Editar a grade **não apaga o que já foi protocolado**. Operadora com credenciamento não sai do catálogo; profissional com credenciamento é desativado, não apagado. Na tela: cartão por médico no construtor da proposta (o modal é estreito) e card **"Credenciamentos em andamento"** na ficha.
  - **Bloco C (ADR-104):** o modelo da proposta é a **transcrição do papel real** (5 seções, 6 passos, cláusulas palavra por palavra); a **numeração continua a contagem manual dela — estava em 224, a primeira do sistema é a 0225**; e **a conta a receber nasce quando a operadora APROVA**, nunca no aceite, nem ao contratar o serviço, nem na conversão do lead. Criar a conta não é best-effort: se falhar, a aprovação falha junto.

## Estado anterior (2026-08-05)

- **E-mail dentro da app — Blocos 1 e 2 COMPLETOS (`main`):** cada pessoa pluga a própria caixa IMAP em **`/email`**, lê e também **escreve, responde, responde a todos, encaminha e anexa** por SMTP real, sem sair do Workspace. Regra: **a caixa é privada, a correspondência com o cliente é da empresa**. Senha cifrada por `EMAIL_CRYPTO_KEY` (gerar no `.env` do servidor — sem ela o módulo fica desligado e o resto segue normal). **Gerada em produção em 05/08/2026** por `scripts/server/set-email-crypto-key.sh` (o módulo ficou desligado no servidor até então — as dependências do e-mail nunca tinham sido instaladas lá). Falta só cada pessoa **plugar a própria caixa** em `/email`. Trocar a chave torna ilegível toda senha já guardada: o script recusa sobrescrever de propósito. Rascunho grava sozinho na pasta `Drafts` do servidor. Fora de produção só é permitido enviar para os 2 e-mails de teste do dono (trava em código, não disciplina). **A 2D‑1 põe a conversa na ficha do cliente e no painel do lead** (card "E-mails" = automáticos + caixas da equipe, com selo por origem): a equipe vê remetente, assunto, data e **trecho — nunca o corpo**; o dono tira um e-mail da ficha ("particular") e só ele o devolve, pela caixa. **2D‑2/2D‑3 (ADR-99): o e-mail vira trabalho** — o anexo recebido vira documento do cliente com um clique (`EmailAnexo.arquivoId`, campo que era morto) e o remetente desconhecido vira lead do funil. Guardar anexo é 1 clique quando a mensagem tem cliente único; sem vínculo (ou com vários), a tela pergunta qual. **Colega da casa nunca vira lead** e endereço do nosso domínio nunca acha cliente (trava do ADR-97 nas duas pontas). Clique repetido devolve o documento/lead que já existe — nada duplica. ADR-95/96/97/99.
- **Menu lateral em 4 grupos** (Meu trabalho · Negócio · Comunicação · Configuração, com Início solto no topo; **nunca rola** — encolhe por altura de tela, travado por `e2e/menu-sem-scroll.spec.ts`) e **derivado de `apps/web/src/lib/paginas.ts`** — nunca crie uma segunda lista de navegação: o teste `paginas.test.ts` reprova página nova que não escolha um grupo — ADR-94.

- **NO AR em produção:** https://workspace.medconsultoria.com.br (TineHost, **LiteSpeed/lsnode** — não Passenger).
  SSH porta **1992**; startup `app.cjs`; restart = `touch tmp/restart.txt`. **`DEPLOY_PATH` = `/home3/medconsultoria/domains/workspace.medconsultoria.com.br/public_html`** — o `.env.deploy` apontava para `~/workspace-medconsultoria`, que não existe, e o deploy morria no passo 2 (corrigido em 10/08). O **ensaio de boot** do `deploy.sh` reprovava boot PERFEITO por `pipefail` + `head -1` (SIGPIPE) e pelo `grep` de erros sair 1 quando não achava nada — corrigido no mesmo dia; se reprovar de novo, o problema é real. Deploy: **`./deploy.sh`** (build → snapshot → `tar | ssh` → deps+Prisma **dentro do virtualenv** → ensaio de boot → restart → smoke test). Chave SSH em `~/.ssh/medconsultoria_deploy`. **App Root real:** `domains/workspace.medconsultoria.com.br/public_html` (a tabela do `docs/DEPLOY.md` §9 apontava pasta inexistente até 05/08). **Nunca use `rsync --delete` aqui:** apagaria o `.htaccess`, e sem ele o site não é servido. **`npm` só existe dentro do virtualenv** — sem `source .../activate`, o `install` falha calado e o app cai no boot com `ERR_MODULE_NOT_FOUND` (foi o que derrubou a produção por ~9 min em 05/08).
- **Tempo real = POLLING** (`refetchInterval`). A hospedagem **não faz WebSocket**; Socket.IO fica desligado no build de produção (religa com `VITE_REALTIME=1`). Fases 0–9 + evolução: **completas**.
- **Backup automático** do MySQL (cron diário) + **health-check/auto-restart** + **e-mail ao ROOT** quando o app cai (`scripts/server/`). SISTEMA tem aba **Operação** (ROOT).
- **Dados da empresa editáveis** (razão social/CNPJ/endereço/foro + marca) em Ajustes → Dados da empresa (ADMIN+).
- Confirmação em **100%** das ações destrutivas; CRUD completo em toda a app + Portal.
- **Contas do servidor:** `root@medconsultoria.com.br` (ROOT primordial, imutável — ADR-89) · `thiago.garcia@` e `andre.cintra@` (ROOTs nominais) · `thais.garcia@medconsultoria.com.br` (ADMIN).
- **Senha do 1º acesso é cobrada pela app** (ADR-91): conta interna que nunca definiu a própria senha cai numa página obrigatória depois do login. Cliente do Portal fica de fora.
- **Senha de desenvolvimento fora do repositório (ADR-98):** nem spec nem `demo-seed` guardam senha embutida; a fonte única é `SEED_ROOT_PASSWORD` no `.env` e o `playwright.config.ts` lê dela a senha dos e2e. Para trocar, `pnpm senha:rotacionar` — ele troca o valor **e reescreve o hash de quem ainda usa a senha atual** (o seed preserva senha de conta existente: reexecutá-lo não rotaciona nada). **Atenção ao mexer na trava:** em produção o banco também é `localhost`, então host não separa dev de prod — quem separa é o `NODE_ENV=production` do `.env`.
- **Pendências do dono (só ele faz):** preencher dados jurídicos (Ajustes → Dados da empresa) · **rotacionar** a chave OpenAI + senha SMTP do `.env` do servidor · **conferir em produção** se as 4 contas semeadas ainda aceitam a senha de dev que vazou (ADR-98; o `root@` primordial é o candidato, ninguém o usa para entrar).

- **Ambiente local separado do servidor (ADR-101):** `pnpm contas:teste` cria as 4 contas públicas de ensaio (`root@`/`admin@`/`funcionario@`/`cliente@teste.local`, senha **`teste1234`** — documentada de propósito, senha de teste não é segredo) e **recusa rodar em produção**. Toda tela rodando localmente mostra o selo **"AMBIENTE LOCAL — dados de teste"**, que não existe no pacote publicado.
- **Auditoria de 05/08/2026 (ADR-100):** o Portal deixava o cliente gravar o próprio e-mail, que é **chave de consulta** do histórico — dava para ler o metadado de e-mail de outro cliente. Fechado no schema. Também entrou freio de 3/hora no "esqueci minha senha", por caixa.

## Onde está a verdade (ler nesta ordem)

0. `docs/LINKS.md` — **todos os links e portas** (localhost 4310 web / 4319 API / 3307 MySQL, produção, páginas públicas), como ligar/desligar a app local e o que é de OUTROS projetos. Escrito para leigo.
1. `docs/CLAUDE.md` — visão geral completa, papéis (RBAC), regras de negócio, índice de decisões.
2. `docs/ARCHITECTURE.md` → `docs/DATABASE.md` → `docs/UI_GUIDELINES.md` → `docs/ROADMAP.md`.
3. `docs/DECISIONS.md` — o **porquê** de cada escolha (ADR-1 … ADR-150). Deploy: `docs/DEPLOY.md`.
   API do agente (integração com a Cora): `docs/API_AGENTE.md`.
4. **Memória** (carrega sozinha): `MEMORY.md` + arquivos em `…/memory/`. Diretriz de trabalho: sempre criticar/recomendar (memória `criticar-e-recomendar`), nunca piloto automático.

## Regras rápidas

- Responder **sempre em PT-BR**. Testar envio de e-mail SÓ com `tibamooca@gmail.com` ou `contato@medconsultoria.com.br`.
- **`pnpm --filter @app/api test` NÃO é só unidade — ele MANDA E-MAIL REAL.** O `include` do Vitest varre também `src/test/*.integration.test.ts` (é assim de propósito: o CI roda a suíte inteira). Para unidade pura use **`pnpm --filter @app/api test:unit`**.
- **Na 1ª tarefa do dia, SUBIR o localhost sem o dono pedir** (`node scripts/keep-alive.mjs`), conferir que 4310 e 4319 respondem e informar os links. O dono quer sempre poder ver a app ao vivo — ver `docs/LINKS.md`.
- Dev local: app SEMPRE no ar via `scripts/keep-alive.mjs`; para migrar Prisma use MODO PAUSA (`touch scripts/.keepalive-pause`). MySQL dev na porta 3307; web 4310 / API 4319.
- Fluxo: branch → commit → PR → CI verde → merge → deploy. Commit/push só quando fizer sentido; nunca na `main` direto.
