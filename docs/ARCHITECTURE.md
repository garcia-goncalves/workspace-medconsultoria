# ARCHITECTURE.md — Workspace MedConsultoria

Arquitetura técnica completa. Complementa `CLAUDE.md`. Cada decisão marcada com **[ADR-n]** está justificada em `DECISIONS.md`.

---

## 1. Visão macro

Aplicação **monolítica de um único processo Node**, servida no DirectAdmin. O mesmo servidor Fastify responde por três coisas na mesma porta:

```
                    ┌──────────────────────────────────────────┐
   Browser  ─────►  │  Fastify (dist/server.js)                │
   (SPA React)      │   ├─ /trpc/*      → tRPC (API tipada)     │
                    │   ├─ /socket.io/* → Socket.IO (real-time) │
                    │   └─ /*           → SPA estático (web/dist)│
                    └───────────────┬──────────────────────────┘
                                    │ Prisma
                                    ▼
                               MySQL (utf8mb4)
```

> Em **produção** o WebSocket fica **DESLIGADO** — a hospedagem (LiteSpeed/lsnode) não faz upgrade de WS. O tempo real de fato é **polling** (ADR-84); Socket.IO roda só em dev/testes, e pode ser religado em prod com `VITE_REALTIME=1`.

**Por que um processo só [ADR-2]:** DirectAdmin espera um startup file único e simplifica deploy/manutenção. Sem microserviços, sem orquestração — a complexidade não se justifica para uma equipe pequena e um app interno.

---

## 2. Monorepo

pnpm workspaces + Turborepo. Cinco pacotes:

| Pacote | Responsabilidade | Depende de |
|--------|------------------|-----------|
| `apps/web` | SPA React | `shared`, `ui` |
| `apps/api` | Fastify + tRPC + Socket.IO | `shared`, `db` |
| `packages/db` | Prisma schema + client | — |
| `packages/shared` | Zod schemas, tipos, constantes, **tipo do `AppRouter`** | — |
| `packages/ui` | Design tokens + componentes shadcn | — |

**A cola do type-safety:** `apps/api` exporta o *tipo* (não o código) do `AppRouter`. `apps/web` importa esse tipo e o cliente tRPC fica 100% tipado. Um erro de contrato vira erro de compilação. É por isso que precisamos de monorepo [ADR-1].

**Fronteira de dependência:** `web` **nunca** importa código de runtime de `api` — só o tipo do router. `db` só é importado por `api`. `shared` não importa nada de app.

---

## 3. Backend (`apps/api`)

### 3.1 Camadas (por módulo de domínio)

```
modules/clientes/
  clientes.router.ts    # procedures tRPC: authz + validação Zod + orquestração
  clientes.service.ts   # regra de negócio pura (não conhece HTTP/tRPC)
  clientes.repo.ts      # (opcional) queries Prisma mais complexas
```

Regra: **router fino, service gordo, sem regra de negócio no router**. Services são testáveis sem subir o servidor.

### 3.2 tRPC — procedures base

Em `trpc/`:

- `context.ts` — cria o contexto por request: `{ db, session (usuário autenticado|null), req, res }`.
- `trpc.ts`:
  - `publicProcedure` — sem auth.
  - `protectedProcedure` — exige sessão; injeta `ctx.user`.
  - `funcionarioProcedure` — exige papel FUNCIONARIO, ADMIN ou ROOT (acesso interno, exclui CLIENTE/Portal).
  - `adminProcedure` — exige papel ADMIN ou ROOT.
  - `rootProcedure` — exige ROOT.
  - `portalProcedure` — exige papel CLIENTE; injeta `ctx.clienteId` a partir da sessão (nunca do input) e **força** todo query a filtrar por ele.

**Checagem de posse:** não há middleware genérico de ownership — cada `*.service.ts` filtra manualmente pelo escopo correto (ex.: o Portal sempre filtra por `clienteId`, ver `portal.service.ts`).

**Authz é sempre no servidor, no procedure.** O front esconde botões por UX, mas nunca é a fonte de verdade [ADR-4].

### 3.3 Composição

`appRouter = router({ auth, dashboard, mensagens, documentos, assinaturas, propostas, portal, clientes, pipeline, servicos, origens, leads, projetos, cards, agenda, notificacoes, financeiro, usuarios, emails, emailsEnviados, busca, ia, sistema })` — 23 sub-routers, cada um no seu módulo (`apps/api/src/modules/<dominio>`).

- `servicos` — catálogo de serviços da MedConsultoria + playbooks por etapa (`ServicoPasso`); leitura `funcionario`, gestão `admin`, `publicos` para o form de captação.
- `origens` — catálogo editável de origens de lead (`admin`; `ativas` para `funcionario`).
- `assinaturas` — assinatura eletrônica de documentos: `solicitar`/`doDocumento` (`funcionario`) + `porToken`/`assinar` (**public**, fluxo por link).
- `propostas` — aceite/recusa online da proposta (ADR-47): `habilitar`/`doDocumento` (`funcionario`) + `porToken`/`responder` (**public**, link `/proposta/:token` + Portal). Token opaco + hash de integridade; aceite avança o funil + notifica a equipe, recusa grava o motivo.
- `emails` — edição dos templates de e-mail (`admin`); `emailsEnviados` — histórico (`meus` protegido, `doLead`/`doCliente` `funcionario`) + **monitor global** (`resumo`/`todos`, `admin`).
- `usuarios` — equipe interna + acessos ao Portal (`admin`), RBAC de menor privilégio (ADR-11); `equipe` (`funcionario`) alimenta os autocompletes de responsável.
- `busca` — busca global (`funcionario`) sobre clientes/leads/projetos/documentos.
- `ia` — assistente de IA de uso do sistema (`funcionario`), gated por `isAiEnabled`.
- `sistema` — painel de observabilidade do ROOT (saúde, desempenho, banco, métricas RED, sessões, atividade, erros, incidentes, uptime, migrações) — todas `rootProcedure`.

**Telemetria:** todo procedure passa por um middleware `timed` que registra métricas RED (Rate/Errors/Duration) por rota, consumidas pelo painel `sistema`.

---

## 4. Frontend (`apps/web`)

- **Roteamento:** TanStack Router (rotas tipadas). Layout com sidebar + topbar + command palette (Cmd-K) desde o shell.
- **Dados:** TanStack Query via `@trpc/react-query`. Cache, invalidação e optimistic updates centralizados por módulo.
- **Estado:** servidor = TanStack Query; estado de UI local = `useState`/`useReducer`; estado global mínimo (sessão, tema) = context leve ou Zustand se necessário. Evitar Redux.
- **Forms:** react-hook-form + `zodResolver` usando os schemas de `packages/shared`.
- **Seleção de entidades:** componente `Combobox` (`apps/web/src/components/ui/combobox.tsx`) — autocomplete com teclado, padrão para selecionar cliente em formulários (projeto, conta, evento, documento, resumir reunião, acesso de Portal). Ver ADR-10.
- **Organização:** `modules/<dominio>/` espelha o backend (components, hooks, rotas do domínio).

---

## 5. Autenticação & sessão

- Login por e-mail + senha. Senhas com **argon2id**.
- Sessão em **cookie httpOnly, Secure, SameSite=Lax**, assinado. Store de sessão no MySQL (tabela `Session`) para permitir revogação.
- Sem refresh-token dance no front — o cookie basta. Logout invalida a sessão no servidor.
- **Anti brute-force:** rate-limit global por IP (`@fastify/rate-limit`, 300/min) + throttle de tentativas de login por `IP+e-mail` em memória (`auth.service.ts`: 8 falhas em 15 min → `TOO_MANY_REQUESTS`). Zera no sucesso. Argon2id já é lento por design.
- `ActivityLog` registra logins e ações sensíveis (auditoria/LGPD).

---

## 6. Real-time (Socket.IO)

- Anexado ao mesmo servidor Fastify (mesma porta). **Em produção o WebSocket NÃO é suportado**: a infra é LiteSpeed/lsnode, que não faz upgrade de WS → o tempo real virou **polling** (ADR-84). Socket.IO fica ligado em dev/testes.
- Autenticação no **handshake** reutilizando o cookie de sessão. Conexão sem sessão válida é recusada.
- **Rooms:** cada usuário entra em `user:<id>`. O objeto `notificationService` (`realtime/socket.ts`), via `emitToUser(userId, evento, payload)`, empurra notificações e mensagens (atribuição de tarefa, lembrete, vencimento).
- **Loops no servidor** (`realtime/reminders.ts`): lembrete de agenda (eventos em ≤15 min) + **scan proativo** (~10 min) que gera alertas deduplicados — tarefas atrasadas (para o responsável), contas vencidas e documentos aguardando revisão (para admins). Notificações são **clicáveis** no front (levam à entidade por `entidadeTipo`/`entidadeId`) com leitura individual. Ver ADR-12.
- Fase 6 (chat) reutiliza a mesma infra: o envio de mensagem (`mensagens.service.ts`) chama `emitToUser` para a room `user:<id>` de cada participante da conversa — não há rooms por conversa/projeto. Rooms dedicadas (`conversa:<id>`, `projeto:<id>`) são uma evolução futura, ainda não implementada.
- Em produção o Socket.IO fica **totalmente desligado** (não é fallback): o polling é o mecanismo primário de tempo real; religa com `VITE_REALTIME=1` (ADR-84).

---

## 7. Armazenamento de arquivos (planejado — ainda não implementado)

Upload/anexos ainda não foram construídos (ver "Próximo incremento" no `ROADMAP.md`). O plano, quando for implementado:

- Arquivos em disco **fora do web root**: `storage/` no diretório do app.
- Metadados no banco (model `Attachment`: nome, mime, tamanho, dono, entidade relacionada).
- Download **sempre** por endpoint autorizado que checa posse antes de fazer stream. **Nunca** URL pública direta.
- Abstração `StorageService` (interface) — implementação local no início, S3-compatível possível depois sem tocar nos módulos.
- Validar mime/tamanho no upload; nomes sanitizados; caminho resolvido + prefix-check contra path traversal.

---

## 8. Camada de IA (construída) [ADR-6]

- `AiService` é uma **interface** com implementação real sobre **OpenAI** (`gpt-4o-mini`, `apps/api/src/lib/ai.ts`), habilitada só quando `OPENAI_API_KEY` está configurada (`isAiEnabled`).
- Modelo de dados: `ModeloDocumento` (corpo com placeholders `{{cliente.nome}}`) e `Documento` (instância, status `RASCUNHO → EM_REVISAO → APROVADO → ENVIADO`, versões com `origem MANUAL|IA`).
- **Documentos com IA:** gerar rascunho, melhorar texto e resumir reunião/ata — sempre criando uma nova `DocumentoVersao` com `origem: IA`.
- **Transcrição de áudio (Whisper):** `aiService.transcrever(buffer, filename)` (`whisper-1`, pt) exposta pela rota multipart `POST /transcrever` (fora do tRPC, só equipe, IA obrigatória) — o "Novo documento" grava/envia áudio e anexa o texto (Ata/Pauta/Gerar com IA) para revisão humana [ADR-53].
- **Busca & assistente** (módulos `busca` e `ia`, ver §3.3): `busca.global` alimenta a paleta de busca (Ctrl+K) com resultados reais; `ia.perguntar` adiciona um modo "Perguntar à IA" na mesma paleta — um assistente de uso do sistema, não um agente que executa ações.
- **Regra dura:** geração sempre produz rascunho; **envio exige aprovação humana**. A IA nunca envia.
- Provedor escolhido: **OpenAI (ChatGPT)** — decisão de custo (a recomendação original era Anthropic/Claude). Fica **atrás da interface `AiService`**, então o provedor é trocável sem tocar nos módulos.

---

## 9. Deploy [ADR-3]

TineHost tem **SSH, mas não Git no servidor**. Pipeline:

```
# local ou GitHub Actions
pnpm install && pnpm build          # gera apps/api/dist + apps/web/dist
rsync -az --delete <artefato> USER@host:/home/USER/domains/workspace.medconsultoria.com.br/app
ssh USER@host '
  cd app &&
  npm ci --omit=dev &&
  npx prisma migrate deploy &&
  touch tmp/restart.txt            # LiteSpeed/lsnode relê e reinicia
'
```

- Startup file no painel DirectAdmin = `dist/server.js`.
- `deploy.sh` encapsula tudo; chave SSH como secret no GitHub Actions.
- Migrations versionadas no repo; `prisma migrate deploy` roda no servidor (nunca `migrate dev` em produção).
- Variáveis sensíveis em `.env` no servidor (fora do git): `DATABASE_URL`, `SESSION_SECRET`, `OPENAI_API_KEY` (já em uso em produção).

**Riscos validados no deploy:** infra confirmada **LiteSpeed/lsnode** (não Passenger/Nginx Unit); pool de conexões MySQL OK; engine de PDF resolvida (Fase 7: `window.print()`/blob). Ver `CLAUDE.md §12`.

---

## 10. Configuração & observabilidade

- Config validada por Zod no boot (`config.ts`) — o app não sobe com env inválida.
- Fastify criado com `maxParamLength: 5000` — o `httpBatchLink` do tRPC junta as procedures no path (`/trpc/a,b,c,…`); com o batch cheio o path passaria de 100 chars e o find-my-way devolveria **414**.
- Logger estruturado via `{ logger: true }` do Fastify (pino nativo). Sem PII/segredos em log.
- Health check em `/health` (para smoke test pós-deploy).
- **Upload de arquivos fora do tRPC** (ADR-26) — o tRPC não lida com multipart, então `POST /upload` (`@fastify/multipart`) e `GET /arquivos/:id` (stream) são rotas Fastify diretas (`http/uploads.ts`), autenticadas pelo mesmo cookie de sessão (`getUserFromSession`) com **checagem de posse** (CLIENTE só o próprio `clienteId`). Arquivos gravados em `UPLOADS_DIR` (`lib/storage.ts`), nome em disco por UUID (anti-traversal/colisão), allowlist de tipos + 20 MB. Em dev o Vite proxia `/upload` e `/arquivos`. A mesma via multipart serve `POST /transcrever` (áudio→texto por Whisper, só equipe, IA obrigatória — ADR-53), também proxiado em dev.
- `.nvmrc` fixa a versão do Node.
- **Painel Sistema (ROOT)** — módulo `sistema` + `SistemaPage` (`/sistema`): saúde dos componentes, métricas **RED** por rota (middleware `timed`), estado do banco/migrações, sessões ativas (com revogação), atividade recente, uptime.
- **Captura automática de erros** — exceções do servidor viram `ErrorLog` agrupado por `fingerprint` (estilo "issue" do Sentry): ocorrências idênticas somam; flags `resolvido`/`regrediu`/`ignorado`. Um **motor de alertas** abre `Incidente` quando um sinal cruza um limiar (com histerese), registrando MTTR. ROOT recebe e-mail (`erro`/`incidente`). Ver ADR-18.

---

## 11. Segurança (transversal)

- **Default-deny** em toda procedure. Isolamento rígido do Portal por `clienteId`.
- Input tratado como hostil: validação Zod, queries parametrizadas (Prisma), sanitização de path.
- Cookies httpOnly/Secure; CSRF mitigado por SameSite + checagem de origem em mutações; CORS restrito ao próprio domínio (`@fastify/cors`).
- **Headers de segurança** via `@fastify/helmet` (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, etc.). **CSP está desativada** por ora (`contentSecurityPolicy: false`) para não quebrar o SPA buildado — **afinar e ligar no deploy** (o polyfill de módulos do Vite exige `script-src` ajustado). Rate-limit global por IP (ver §5).
- Segredos só via env. Least-privilege no usuário MySQL.
- Revisão obrigatória com security-reviewer nos módulos de auth, financeiro e portal.

---

## 12. Funil inteligente (mecânica) [ADR-14]

O funil de vendas é automatizado. Mecânica em `leads.service.ts`:

- **Playbook por etapa + serviços:** cada `PipelineStage` tem uma `chaveAuto` estável. Ao entrar numa etapa, o lead recebe um checklist (`LeadPasso`) semeado do playbook da etapa **mais** os `ServicoPasso` dos serviços que o lead escolheu (por `etapaChave`). Mudar os serviços sincroniza o checklist (add/remove dos passos pendentes).
- **Passos automáticos:** `LeadPasso.autoRegra` classifica o passo — **derivado** (`servicos`/`valor`: o sistema tica e destica sozinho conforme o estado do lead, checkbox travado na UI) ou **de evento** (`proposta_enviada`/`proposta_assinada`/`contrato_enviado`/`contrato_assinado`: concluem sozinhos quando o documento é enviado/assinado, mas a equipe ainda pode ticar na mão). `reconciliarPassosAuto()` roda a cada abertura do painel e após eventos.
- **Documentos a partir do funil:** passos com `acaoDoc` (proposta/contrato) geram um `Documento` do modelo com os dados do lead; assinar o documento avança o passo/etapa.
- **Avanço:** manual pelo botão "Avançar" (exige passos obrigatórios concluídos) ou por **arrastar** (override consciente, sem trava, mas registrado na timeline). `avancarLeadAuto()` move só para frente, best-effort.
- **Ganho/perda:** converter (`convertLead`) = ganho; `marcarPerdido`/`reabrirLead` = perda reversível (com motivo). `funilResumo` calcula a taxa de conversão. Leads convertidos/perdidos saem do board ativo.
- **Situação do cliente = placar do funil (ADR-22):** `reconciliarSituacaoCliente(clienteId)` roda a cada evento de funil e mantém a `Cliente.situacaoComercial` coerente (aberto→PROSPECT/NEGOCIACAO, ganho→ATIVO, perdido→PERDIDO). **Regra de ouro:** ATIVO nunca é rebaixado (um cliente nunca "vira lead"; oportunidade nova = upsell). A ficha mostra a situação **só-leitura**; `leads.novaOportunidade` abre um novo negócio para um cliente existente. O `clientes.setSituacao` manual foi removido.
- **Oportunidade inteligente + autosserviço (ADR-23):** `leads.novaOportunidade` recebe os `servicoIds` desejados e `criarOportunidadeParaCliente` conecta os serviços + semeia o checklist (`seedPassosSeVazio`/`reconciliarPassosAuto`) — o card nasce com os passos de cada serviço. No Portal, `portal.solicitarServicos` → `solicitarServicosPeloCliente` adiciona serviços ao negócio aberto (dedup) ou cria um novo, sincroniza o checklist e avisa a equipe (`servico_solicitado`). `resumo.servicosAtuais` mostra o que o cliente já pediu. Seleção de serviços reutilizável em `ServicosPicker`.
- **Conversão integra tudo:** cria o Cliente (dedup por e-mail), o Projeto de onboarding (card de briefing + 1 por serviço), provisiona uma **Conta a Receber** do `valorEstimado` e agenda a **reunião de kickoff** (próximo dia útil) — ambos best-effort — e notifica gestão + responsável.

## 13. Captação pública & Portal do prospect [ADR-15]

- **Form público** (`/comecar` → `leads.capturar`, `publicProcedure`): honeypot + rate-limit por IP. Deriva a origem/rastreio (UTM/referrer/ads via `derivarRastreioOrigem`); recaptura do mesmo e-mail atualiza o lead existente em vez de duplicar.
- **Acesso automático ao Portal:** ao captar (ou convidar), `garantirAcessoPortal()` cria uma conta Cliente **PROSPECT** + usuário CLIENTE pendente + token de convite, idempotente. O lead segue no funil (`Lead.clienteId` liga a conta sem convertê-lo). O **prospect acompanha o próprio atendimento no Portal** (etapa traduzida em linguagem amigável, documentos para assinar). Na conversão, o acesso tem continuidade (não recria).
- **Livre-arbítrio (ADR-20):** o prospect pode **desistir** pelo Portal (`portal.desistir`, motivo opcional) → o lead vira perdido e a equipe é avisada (`lead_desistiu`); e **retomar** depois (`portal.retomar` → `lead_retomou`). Ambos escopados ao `clienteId` da sessão (`desistenciaPeloCliente`/`retomarPeloCliente` em `leads.service`), nunca por id vindo do cliente.

## 14. E-mails transacionais [ADR-16]

- **Envio único:** `enviarEmailTemplate()` (`emails/enviados.service.ts`) renderiza o template branded (logo por CID), envia por SMTP (`enviarEmail`) e registra em `EmailEnviado` — inclusive o **motivo da falha** (`erro`) quando o SMTP recusa. `isEmailReal` = SMTP configurado.
- **Monitor global (ROOT/ADMIN):** página dedicada `/emails-enviados` (`EmailsEnviadosMonitorPage`) sobre `emailsEnviados.resumo` (indicadores: enviados/falhas 7d, hoje, taxa de entrega, `isEmailReal`) + `emailsEnviados.todos` (lista filtrável por status/tipo/período/busca, paginada por limite). Responde "mandou? falhou? por quê?" sem depender de APM externo (coerente com ADR-2/ADR-18).
- **Notificação = e-mail:** `notificar()` é o ponto único — cria a `Notificacao` in-app (o cliente busca por polling em produção; Socket.IO faz push só em dev/testes — ADR-84) **e** dispara o e-mail da mesma categoria se ela for "emailável" e o usuário não tiver desativado (`PreferenciaEmail`, opt-out). Suporta dedup (`unico`) para o scan proativo.
- **Templates editáveis:** `EMAIL_TEMPLATES` (registry) semeia `EmailTemplate` (assunto/título/corpo/CTA com `{{variaveis}}`), editáveis em Comunicações (`emails` router, admin). Grupos: Transacionais (sempre), Notificações (respeitam preferência), Sistema (só ROOT).

## 14-A. E-mail dentro da aplicação (IMAP/SMTP por usuário) [ADR-95]

Módulo `apps/api/src/modules/email/` — `imap.ts` (conexão), `caixas.service.ts` (plugar/remover), `pastas.service.ts`, `sync.service.ts`, `leitura.service.ts`, `enderecos.ts` (normalização + chave de conversa), `email.router.ts`. Front em `apps/web/src/features/email/`, rota `/email`.

- **A conexão IMAP é sempre CURTA — abre, faz, fecha.** O servidor tem `IDLE`, mas o lsnode derruba o Node ocioso (mesma causa do ADR-84): não dá para manter conexão viva esperando o servidor avisar. O e-mail chega por **sincronização**, não por push — coerente com o resto da app, que já é polling.
- **Índice + cache, nunca espelho.** Sincronizar traz só o cabeçalho (`EmailMensagem`); o corpo só é baixado quando alguém abre, e fica em cache. Busca dentro do texto usa o **`ESEARCH` do servidor** — acha sem baixar corpo nenhum. O banco não vira uma segunda caixa postal.
- **Sincronização incremental** pelos ponteiros por pasta (`uidValidity`/`ultimoUid`/`highestModseq`): `QRESYNC`/`CONDSTORE` estão disponíveis, então cada rodada pede só o que mudou. `uidValidity` diferente do guardado = a pasta foi recriada no servidor → ressincroniza do zero.
- **A senha da caixa fica cifrada** (`lib/cripto-caixa.ts`, AES-256-GCM com `EMAIL_CRYPTO_KEY`), nunca volta para a tela e nunca entra em log — o `logger` do `imapflow` fica **desligado de propósito**, porque ele imprime o diálogo de autenticação.
- **Testar antes de gravar:** `plugarCaixa` só grava depois de o servidor aceitar a credencial, e a mensagem de erro **distingue senha errada de servidor fora do ar** — a primeira é culpa de quem digitou, a segunda não.
- **Três camadas contra HTML hostil**, porque e-mail é conteúdo de terceiro não confiável: (1) o HTML é higienizado no servidor (script/iframe/handler/`javascript:` fora); (2) o corpo é servido pela rota `/email-corpo/:id` e renderizado num **`<iframe sandbox="">`** — sem script, sem formulário, sem navegação, sem acesso à página; (3) **imagem remota bloqueada** por padrão (allowlist: só `cid:` passa), com faixa para liberar caso a caso.
- **Por que o corpo tem rota própria e não `srcdoc`:** documento `srcdoc` **herda a CSP da página que o embute**. Com a CSP da app (`img-src 'self' data: blob:`), a imagem remota ficaria bloqueada pelo navegador mesmo depois do clique em "Mostrar imagens" — o botão seria uma promessa não cumprida em produção. A rota devolve CSP própria (`default-src 'none'`, `img-src https: data:` só com `?imagens=1`), que soma com o sandbox.
- **Privacidade (regra de negócio):** *a caixa é privada, a correspondência com o cliente é da empresa*. Todo procedure filtra por `userId` — ninguém abre a caixa de ninguém. O que aparece na ficha do cliente é a **mensagem trocada com aquele cliente**, resolvida por JOIN em `EmailEndereco`, e o dono pode marcar qualquer mensagem como `particular` para tirá-la de lá.

## 15. Assinatura eletrônica de documentos [ADR-17]

- Assinatura eletrônica **avançada** (Lei 14.063/2020). `assinaturas.solicitar` cria uma `Assinatura` por signatário (papel CLIENTE/MEDCONSULTORIA) com um `token @unique` e guarda o **hash sha256 do conteúdo** no envio (prova de integridade). O e-mail leva ao link público `/assinar/:token` (`assinaturas.porToken`/`assinar`, `publicProcedure`).
- Assinatura por **desenho** (data-URI PNG) ou **nome digitado**; grava trilha de auditoria (IP, user-agent, data/hora). Ao assinar, marca `Documento.assinadoEm` e reconcilia o passo do funil.
