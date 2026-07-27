# AUDITORIA INICIAL DO PROJETO — Workspace MedConsultoria

> **Propósito.** Registrar com precisão o estado REAL da aplicação antes da etapa final de correções, testes e preparação para produção.
> **Data da auditoria:** 14/07/2026.
> **Método.** Análise estática do código-fonte, schema Prisma, rotas, componentes, configurações + inspeção do banco de dados de desenvolvimento em execução + build de produção real + verificações ao vivo (Playwright) feitas nesta sessão. Levantamento conduzido por 6 análises paralelas de subagentes + verificações diretas.

## Legenda de confiança (usada em todo o documento)

- **[código]** — confirmado por leitura do código-fonte. NÃO significa que foi executado.
- **[executado]** — rodado/verificado nesta auditoria (build, typecheck, query no banco, teste ao vivo na UI, comando git).
- **[não testado]** — não há evidência de execução; presunção baseada só em código.

> ⚠️ Regra honesta aplicada: **a existência do código não prova o funcionamento.** Não há suíte de testes automatizados no projeto (ver §13), então a maior parte dos módulos está **"completa no código, porém não validada sistematicamente em runtime"**.

---

## 1. Visão geral da aplicação

**Objetivo.** CRM/ERP operacional interno da consultoria **MedConsultoria** (consultoria para clínicas e consultórios). NÃO é SaaS multi-tenant — é uma aplicação de uso interno de uma única empresa, com um Portal para os clientes dela. A pergunta-guia do produto é reduzir o estresse operacional da dona (Thaís, papel ADMIN). [código]

**Principais módulos** (confirmados no código e no menu):
- **Vendas / Funil de leads** (kanban, automações de etapa, captação pública, portal do prospect)
- **Clientes** (ficha completa, serviços contratados, arquivos, chamados)
- **Projetos** (kanban de cartões/tarefas, checklist, timer)
- **Agenda** (5 visões, conflitos, lembretes)
- **Mensagens** (chat interno + helpdesk de cliente unificados)
- **Documentos** (propostas/contratos/recibos inteligentes, modelos, briefings, assinatura eletrônica, aceite online)
- **Financeiro** (contas a pagar/receber por carteira Empresa×Pessoal)
- **Ajustes** (Serviços, Equipe e acessos, Modelos, Mensagens automáticas, E-mails enviados)
- **Sistema** (painel ROOT: saúde, erros, incidentes, sessões, métricas)
- **Portal do Cliente** (área do cliente)
- **IA transversal** (assistente, geração de documentos, resumos) — opcional, ligada por chave

**Perfis de acesso existentes.** Enum `Role` com hierarquia estrita: `ROOT(3) > ADMIN(2) > FUNCIONARIO(1) > CLIENTE(0)`. [código]

**Funcionamento geral.** SPA React consome uma API tRPC (Fastify). Em desenvolvimento, web (Vite) na porta 4310 e API na 4319; MySQL em Docker na 3307. Em produção, **um único processo Node** (server.js Fastify) serve a API tRPC + WebSocket (Socket.IO) + o SPA estático na mesma porta. [código/executado — build gerou os dois `dist`]

**Fluxo entre as áreas.**
- **Root/Dev** e **Administração/Funcionários** usam o MESMO app interno (roteado por TanStack Router dentro de `AppLayout`), diferenciados por `Role`: o menu e as rotas se abrem/fecham conforme o papel (Financeiro/Ajustes = ADMIN+, Sistema = ROOT). [código]
- **Portal do Cliente** NÃO passa pelo roteador interno: o gate em `App.tsx` detecta `role === "CLIENTE"` após o login e renderiza `PortalLayout` diretamente (página única). [código]
- **Público (sem login):** login, esqueci/redefinir/definir senha, captura de lead, `/assinar/{token}`, `/proposta/{token}` — roteados manualmente por `window.location.pathname`. [código]
- **Isolamento:** todo acesso do Portal é escopado pelo `clienteId` da SESSÃO (nunca vindo do input). [código — verificado no `portalProcedure`]

---

## 2. Stack e arquitetura

| Camada | Tecnologia (versões confirmadas no package.json) |
|---|---|
| **Frontend** | React 18.3.1, TanStack Router 1.95, TanStack Query 5.62, tRPC client/react-query 11, react-hook-form 7.54 + @hookform/resolvers, Zod 3.24, @dnd-kit, socket.io-client 4.8, marked, cmdk. Build: Vite 6.0.5, Tailwind 3.4.17, TypeScript 5.7.2 |
| **Backend** | Fastify 5.2, @trpc/server 11, @fastify/{cookie,cors,helmet,multipart,rate-limit,static}, @node-rs/argon2 2.0 (hash nativo), socket.io 4.8, nodemailer 9.0, openai 4.77, dotenv. Build: tsup 8.3; dev: tsx 4.19 |
| **Banco** | MySQL 8.4 (Docker em dev, porta host 3307→3306); Prisma 6.1 (client + migrate) |
| **Autenticação** | Sessão server-side persistida no banco (tabela `Session`), cookie `sid` **httpOnly + assinado (signed) + sameSite=lax**, TTL 30d. Senhas com **argon2id**. Sem JWT. [código] |
| **Gerenciamento de estado** | TanStack Query (cache de servidor via tRPC) + estado local React (useState). Preferências de UI em `localStorage`. Não há Redux/Zustand. [código] |
| **APIs** | tRPC (22 sub-routers) em `/trpc` + endpoints HTTP puros para arquivos/áudio/avatar/health + Socket.IO em `/socket.io` |
| **Integrações externas** | OpenAI (chat gpt-4o-mini + Whisper), SMTP (nodemailer), — ambas OPCIONAIS. Sem outras APIs externas, sem webhooks de entrada. [código] |

**Estrutura de pastas (monorepo pnpm + Turborepo):**
```
apps/
  web/   → SPA React (Vite)
  api/   → Fastify + tRPC + jobs (src/modules/*, src/http/*, src/realtime/*, src/lib/*, src/trpc/*)
packages/
  db/      → Prisma (schema.prisma, migrations/, seed.ts, demo-seed.ts)
  shared/  → schemas Zod compartilhados (front/back)
  ui/      → só `cn()` + preset Tailwind (NÃO é uma lib de componentes real)
scripts/   → keep-alive.mjs, bundle-deploy.mjs
docs/      → ARCHITECTURE, DATABASE, DECISIONS, DEPLOY, ROADMAP, UI_GUIDELINES, ACESSOS, CLAUDE, README
```
Gerenciador: **pnpm 10.19**; Node **>=20** (`.nvmrc = 20`). **Sem Python** em nenhum lugar do projeto. [executado — busca no repo]

**Arquitetura atual.** Monolito modular: um app front + um app back + pacotes compartilhados. Comunicação front↔back **100% via tRPC** (type-safe ponta a ponta, `httpBatchLink`), exceto uploads/downloads/avatar (multipart HTTP) e realtime (Socket.IO com o mesmo cookie de sessão). Back↔banco via **Prisma** (queries parametrizadas). Validação de entrada com **Zod** (schemas em `packages/shared`, reusados no front). [código]

**Observação arquitetural relevante [código]:** existem **dois sistemas de roteamento** — TanStack Router (app interno) e roteamento manual por `window.location.pathname` (`App.tsx`, para público + Portal). Funciona, mas é uma inconsistência estrutural (o Portal e as páginas públicas não têm as garantias do roteador declarativo).

---

## 3. Páginas, rotas e funcionalidades

> Estado "Completo" abaixo = o código tem handlers/mutations reais com tratamento de loading/erro. **Não é atestado de runtime** (ver §13). "Verificado ao vivo" = testado nesta sessão via Playwright.

### 3.1 Rotas internas (TanStack Router — exigem sessão de equipe)

| Rota | Página | Perfil (guard) | Finalidade | CRUD / ações principais | Integrações | Estado |
|---|---|---|---|---|---|---|
| `/` | DashboardPage (Início) | FUNCIONARIO | Hub de widgets por papel | Só-leitura (`dashboard.resumo`) | IA (resumoDoDia) | Completo [código] · layout verificado ao vivo |
| `/leads` | LeadsPipelinePage (Vendas) | FUNCIONARIO | Funil kanban | leads CRUD + move/convert/perder/reabrir/oportunidade/passos; origens CRUD | tRPC, IA, docs, e-mail | Completo [código] · verificado ao vivo |
| `/clientes` | ClientesListPage | FUNCIONARIO | Lista de clientes | — (lista/filtros) | — | Completo [código] · verificado ao vivo |
| `/clientes/$id` | ClienteDetailPage | FUNCIONARIO | Ficha do cliente | clientes CRUD + contatos/notas/serviços/arquivos | Socket.IO, upload, IA | Completo [código] |
| `/projetos` | ProjetosListPage | FUNCIONARIO | Kanban de projetos | projetos CRUD | — | Completo [código] |
| `/projetos/$id` | ProjetoDetailPage | FUNCIONARIO | Cartões/tarefas | cards CRUD + checklist/comentários/timer | — | Completo [código] |
| `/agenda` | AgendaPage | FUNCIONARIO | Calendário 5 visões | agenda CRUD + conflitos | IA (resumoAgenda) | Completo [código] · scroll verificado ao vivo |
| `/mensagens` | MensagensPage | FUNCIONARIO | Chat + helpdesk | mensagens CRUD amplo | Socket.IO | Completo [código] · divisor/scroll verificado ao vivo |
| `/documentos` | DocumentosPage | FUNCIONARIO | Arquivo de documentos | documentos CRUD + gerar (proposta/contrato/IA) | IA, assinaturas, propostas | Completo [código] · construtores verificados ao vivo |
| `/documentos/$id` | DocumentoDetailPage | FUNCIONARIO | Ver/editar documento | updateConteudo/setStatus/remove; assinar/aceite | PDF via print, IA | Completo [código] · verificado ao vivo |
| `/servicos` | ServicosPage | **ADMIN** | Catálogo de serviços | serviços/requisitos/passos/roteiro CRUD | IA (sugerirRequisitos) | Completo [código] |
| `/financeiro` | FinanceiroPage | **ADMIN** | Contas a pagar/receber | contas/categorias CRUD + marcarPaga | — | Completo [código] |
| `/ajustes` | AjustesPage | **ADMIN** | Hub de navegação | — (só links) | — | Completo [código] (é hub) |
| `/usuarios` | UsuariosPage (Equipe) | **ADMIN** | Gestão de equipe | usuários CRUD + convite/reenvio | e-mail | Completo [código] |
| `/emails` | EmailsAdminPage | **ADMIN** | Editar templates | list/update/resetar/preview/enviarTeste | SMTP | Completo [código] |
| `/emails-enviados` | EmailsEnviadosMonitorPage | **ADMIN** | Monitor de e-mails | Só-leitura + filtros/paginação | — | Completo [código] |
| `/modelos` + `/modelos/$id` | ModelosPage/ModeloDetailPage | **ADMIN** | Modelos + briefings | modelos CRUD + formulários CRUD | — | Completo [código] |
| `/configuracoes` | ConfiguracoesPage | qualquer sessão (sem RoleGuard) | Perfil do usuário | updateProfile/changePassword/avatar/prefs | — | Completo [código] |
| `/sistema` | SistemaPage | **ROOT** | Painel de sistema | saúde/erros/incidentes/sessões + ações | IA (diagnóstico) | Completo [código] |
| `/login` | (redirect) | — | beforeLoad → `/` | — | — | — |
| (outra) | NotFound | — | 404 | — | — | Completo [código] |

Proteção interna: componente `RoleGuard` (`hasRoleLevel`) = defesa em profundidade; o backend **reexige o papel em cada procedure** (não confia só no front). [código]

### 3.2 Portal do Cliente (role CLIENTE — página única, sem rotas próprias)

`PortalHome` dentro de `PortalLayout` renderiza todos os módulos como cards empilhados. Backend `portal.router.ts`: **16 procedures, 100% `portalProcedure`** (clienteId da sessão). [código]

| Bloco | Finalidade | CRUD/ações | Integrações | Estado |
|---|---|---|---|---|
| PortalLayout / Editar perfil | Dados cadastrais (LGPD) | meusDados/atualizarMeusDados + avatar | upload | Completo [código] · **verificado ao vivo** |
| PortalServicos | Serviços contratados + exigências | meusServicos/cancelarServico + upload/briefing | /upload REST | Completo [código] |
| PortalMeusDocumentos | Envio de documentos do cliente | arquivos/removerArquivo | /upload | Completo [código] |
| PortalSuporte | Helpdesk cliente↔equipe | suporte.listChamados/abrir/mensagens/enviar | **Socket.IO real** | Completo [código] |
| PortalHome | Funil, propostas, docs p/ assinar, reuniões, autosserviço | resumo/desistir/retomar/confirmarReuniao/solicitarServicos | .ics no navegador | Completo [código] · **fluxo de aceite verificado ao vivo** |

### 3.3 Páginas públicas (sem login)

| Rota | Página | Proteção | Estado |
|---|---|---|---|
| `/login`, `/esqueci-senha`, `/redefinir-senha`, `/definir-senha` | Auth | credencial / token no backend | Completo [código] |
| `/comecar` | CapturaLeadPage | honeypot + UTM | Completo [código] |
| `/assinar/{token}` | AssinarPage | publicProcedure token-scoped, grava IP+UA, trava se conteúdo mudou | Completo [código] |
| `/proposta/{token}` | PropostaPublicaPage | publicProcedure token-scoped, grava IP | Completo [código] · **verificado ao vivo (aceite)** |

### 3.4 Problemas / funcionalidades aparentemente ausentes (§3)

1. **Nenhum placeholder, botão sem handler, mutation comentada ou tela mockada** foi encontrado no front — o app está **funcionalmente completo no código** em todos os módulos. [código]
2. **Divergência de organização:** os "Formulários/Briefings" NÃO são uma aba de Documentos — foram consolidados dentro de `/modelos` (Ajustes). [código]
3. **Possível XSS na impressão de briefing** (ver §8): `RespostaBriefingDialog.tsx` e `BriefingDialog.tsx` usam `window.open + document.write` com valores do backend sem sanitização visível no front. **Requer verificação de escape no backend.** [código — não confirmado]
4. **"Baixar" briefing** não gera PDF real — só imprime HTML inline. [código]
5. **Nenhuma rota interna testada por suíte automatizada** — todo "estado: completo" é baseado em código + verificações manuais pontuais. [não testado, salvo os marcados "ao vivo"]

---

## 4. Perfis e permissões

Hierarquia (`roles.ts`): `CLIENTE(0) < FUNCIONARIO(1) < ADMIN(2) < ROOT(3)`. Procedure builders no backend (`trpc/trpc.ts`): `publicProcedure`, `protectedProcedure`, `funcionarioProcedure`, `adminProcedure`, `rootProcedure`, `portalProcedure`. [código]

| Perfil | Páginas acessíveis | Ações permitidas | Isolamento |
|---|---|---|---|
| **ROOT/Dev** | Tudo, incl. `/sistema` | Tudo + gerir ADMIN + IA de sistema | — |
| **ADMIN** (dona) | Tudo menos `/sistema` | Gestão completa (Financeiro, Serviços, Equipe, Modelos, E-mails) | Não gere ROOT |
| **FUNCIONARIO** | Dia a dia (Início→Documentos), Perfil | Sem Financeiro/Ajustes/Sistema | Acesso a todos os clientes (modelo de confiança) |
| **CLIENTE** | Só o Portal | Só os PRÓPRIOS dados | **Escopado por `clienteId` da sessão** |

**Proteção de rotas.** Dupla camada: (1) `RoleGuard` no front (esconde/nega UI), (2) `requireRole`/`hasRoleLevel` no backend em cada procedure. O menu é filtrado por papel. [código]

**Isolamento de dados.** [código — verificado nos endpoints do Portal]
- `portalProcedure` injeta `clienteId` da sessão; nenhum endpoint do Portal aceita clienteId do input.
- IDs vindos do cliente (getDocumento, confirmarReuniao, removerArquivo, cancelarServico, /upload, /arquivos/:id) são todos filtrados/validados por posse (`NOT_FOUND`/`FORBIDDEN`).
- Anti-escalonamento: um usuário só atribui papéis **estritamente abaixo** do seu; não pode agir sobre pares/superiores, nem se auto-desativar/rebaixar. Desativar/trocar senha/e-mail invalida as sessões do alvo.

**Possíveis falhas/inconsistências de autorização (baixo impacto) [código]:**
- **`GET /avatar/:userId`** serve a foto de QUALQUER usuário para qualquer logado (inclusive CLIENTE do Portal). Intencional ("aparece em toda a app"), mas é um pequeno vazamento cross-tenant/IDOR de baixo risco (só expõe uma foto).
- **Formulários do Portal** (`getFormularioDoRequisito`/`salvarResposta`) não checam se o `requisitoId` pertence a um serviço contratado pelo cliente — impacto baixo (template é de catálogo; respostas escopadas por clienteId), mas o vínculo cliente↔requisito não é validado.
- **`/configuracoes`** é a única rota interna sem `RoleGuard` (intencional — edita só o próprio perfil).

---

## 5. Banco de dados

**Tecnologia.** MySQL 8.4 + Prisma 6.1. Em dev via Docker (porta 3307). Em produção, banco do painel DirectAdmin (via `DATABASE_URL`). [código/executado]

**Dimensão [executado — inspeção do banco em dev]:** **45 tabelas** (incl. `_prisma_migrations` e junção `_LeadServicos`), **19 enums**, **50 migrations** aplicadas (init `20260702164122` → `20260714130226_add_documento_itens`).

**Principais entidades e relacionamentos [código]:**
- **Identidade/Acesso:** `User` (dono de quase tudo; 1-1 opcional com `Cliente` p/ Portal), `Session`, `Token` (convite/reset, só hash), `ActivityLog`, `ErrorLog`, `Incidente`, `EmailTemplate`, `PreferenciaEmail`.
- **CRM:** `Cliente` (1-N Contato/Projeto/Evento/Conta/Documento/ClienteServico/Arquivo/Conversa/SuporteMensagem), `Lead` (N-N `Servico`, 1-N `LeadPasso`, ligado a `PipelineStage`), `Origem`, `Nota`, `Operadora`, `PipelineStage`.
- **Serviços:** `Servico` (1-N `ServicoPasso`/`ServicoRequisito`/`ClienteServico`; roteiro Json), `ClienteServico` (@@unique cliente+serviço), `ServicoRequisito`, `Formulario`/`FormularioCampo`/`FormularioResposta`, `Arquivo`.
- **Projetos:** `Projeto`, `ProjetoParticipante`, `Card`, `ChecklistItem`, `TimeEntry`.
- **Agenda/Notif:** `Evento`, `EventoParticipante`, `Notificacao`, `EmailEnviado`.
- **Financeiro:** `Categoria`, `Conta` (Decimal(12,2), escopo Empresa/Pessoal).
- **Mensagens:** `Conversa`, `ConversaParticipante`, `Mensagem`, `SuporteMensagem`.
- **Documentos:** `ModeloDocumento`, `Documento` (aceite/assinatura/itens Json), `Assinatura`, `DocumentoVersao`.

**Migrations.** 50 migrations versionadas, cadência coerente com a evolução por fases (Fase 0→7). Sem squash/renome fora de padrão. [executado]

**Seeds [código]:**
- `seed.ts` (produção) — cria **apenas** o usuário ROOT (upsert, lê `SEED_ROOT_*`). Nada além disso.
- `demo-seed.ts` (`pnpm db:demo`) — **dados 100% de exemplo**, claramente rotulados: 2 usuários de equipe fictícios, 3 clientes/5 leads/5 eventos/5 contas fictícios, 1 usuário de Portal (`cliente@medconsultoria.com.br`). NÃO deve ir para produção.
- **Seeds "lazy" nos services** (populam catálogos REAIS na 1ª leitura da API, se a tabela estiver vazia): 5 `PipelineStage`, catálogo `Origem`, 9 `Operadora`, **10 serviços reais**, **17 modelos de documento reais**. ⚠️ **Fragilidade de auditoria:** o catálogo real de produção nasce implicitamente no código dos services (5 arquivos), não num seed versionado — alterar os arrays no código NÃO afeta bancos já semeados.

**Dados demonstrativos vs. reais no banco de dev [executado — contagens]:** 7 usuários (1 ROOT, 1 ADMIN, 2 FUNCIONARIO, 3 CLIENTE), 11 Cliente, 19 Lead, 10 Servico, 3 ClienteServico, 2 Projeto, 9 Card, 8 Evento, 18 Documento, 19 ModeloDocumento, 11 Conta, 5 Conversa, 13 Mensagem, 260 ActivityLog, 83 Notificacao, 57 EmailEnviado, 12 Incidente, 4 ErrorLog. **Há dados de TESTE poluindo o banco de dev** (ex.: conversas "asdasdsadsad"/"sadsa", clientes "Cliente QA Teste (editado)"/"Lead Convert QA"/"Lead Teste", "TineHost" duplicado) — precisa de limpeza antes de qualquer promoção. [executado]

**Inconsistências / regras de integridade [código]:**
- **`Cliente.situacaoComercial` é `String` livre** (default "ATIVO"), não enum — risco de valor inválido/typo não pego pelo schema.
- **`Documento.criadoPorId` usa `onDelete: Cascade`** (destoa do resto, que usa `SetNull`): **excluir um funcionário APAGA em cascata todos os documentos que ele criou** — incluindo propostas/contratos já enviados/assinados. ⚠️ Risco real de perda de dado de auditoria/jurídico — confirmar se é intencional.
- **Vários campos "FK-like" são Strings soltas sem `@relation`** (sem integridade referencial no banco): `LeadPasso.stageId/servicoId/documentoId`, `FormularioResposta.servicoId`, `Arquivo.enviadoPorId`, `Conta.recorrenteId`, `Conversa.projetoId`, `EmailEnviado.userId/clienteId/leadId`. A maioria é intencional (logs/denormalização), mas `LeadPasso.documentoId` órfão não seria pego pelo banco.
- **JSON serializado como `Text`** (inconsistente com `Json` nativo usado em outros lugares): `FormularioCampo.opcoes`, `FormularioResposta.respostas`, `Lead.rastreio` — dependem de `JSON.parse` disciplinado.
- **Excluir uma `PipelineStage` com leads vinculados falha no banco** (Restrict implícito) — não há fluxo visível de "mover leads antes de apagar etapa".
- **`Nota` (timeline do cliente) sem editar/apagar** (só create/list), diferente do comentário do card (que edita/apaga). Possivelmente intencional (log imutável), mas inconsistente.

**Entidades sem CRUD completo pela UI [código]:** `Nota` (cliente) sem update/delete; `EmailTemplate` sem create/delete (por design — são do sistema); `Operadora`/`Origem`/`PipelineStage`/`Categoria` gerenciáveis mas nascem por lazy-seed. Logs (`ActivityLog`/`ErrorLog`/`EmailEnviado`) são append-only por design.

---

## 6. CRUDs e fluxos operacionais

Avaliação por capacidade transversal (baseada no código; "ok" = existe no código, não = validado em runtime):

| Capacidade | Situação [código] |
|---|---|
| Cadastro (create) | ✅ em todos os módulos com dados (leads, clientes, projetos, cards, eventos, contas, serviços, usuários, documentos, mensagens) |
| Visualização (read) | ✅ listas + fichas de detalhe |
| Edição (update) | ✅ ampla; exceção: `Nota` do cliente (sem update) |
| Salvamento | ✅ mutations tRPC com Zod; alguns fluxos usam "staging" (salvar em lote: origens, categorias, operadoras) |
| Exclusão (delete) | ✅ maioria soft-delete (`deletedAt`) |
| Confirmação de exclusão | ✅ `useConfirm` (pop-up) em ações destrutivas — padrão consolidado (ADR-24) |
| Busca | ✅ busca por texto nas listas + busca global no header (Prisma; IA opcional) |
| Filtros | ✅ presentes (situação, responsável, tipo, período…) |
| Ordenação | ⚠️ parcial — ordenação por drag (serviços/passos/origens) e por data em listas; **ordenação por coluna de tabela não é universal** |
| Paginação | ⚠️ parcial — confirmada em `/emails-enviados`; a maioria das listas carrega tudo (volumes pequenos hoje). **Risco de escala** quando os dados crescerem |
| Validação de formulário | ✅ react-hook-form + Zod (schemas compartilhados) |
| Mensagens de sucesso | ✅ `toast(..., "success")` |
| Mensagens de erro | ✅ `toast(..., "error")` + erro inline em formulários |
| Estados de carregamento | ✅ `Skeleton`/`TableSkeleton` (padrão "sem spinner") |
| Estados vazios | ✅ `EmptyState` padronizado |
| Tratamento de falhas | ✅ `QueryError` ("Tentar de novo"); `ErrorBoundary` global |

**Incompleto/parcial a registrar:**
- **Paginação não universal** — a maioria das listas não pagina (aceitável no volume atual; vira problema com crescimento). [código]
- **Ordenação por coluna não universal.** [código]
- **Toasts só `success`/`error`** — sem `warning`/`info`, sem ação/undo. [código]
- **`Nota` do cliente sem editar/apagar.** [código]

---

## 7. Interface e experiência do usuário

**Identidade visual [código].** Sistema de tokens shadcn-style em HSL (tema claro completo). `--primary` azul `#003591`, sidebar `#002463`, acento `#2DA8E1`, sucesso `#30AD73`, warning âmbar, destructive vermelho. Radius base 0.625rem, sombras azuladas. **Tema escuro está DEFINIDO no CSS mas INERTE** — não há toggle nem `classList.dark` em lugar nenhum; é um ponto morto (pode enganar quem achar que dark mode "funciona").

**Fontes.** Montserrat **self-hosted** via `@fontsource/montserrat` (400/500/600/700) — bom p/ performance/privacidade (não usa CDN do Google). [código]

**Componentes [código].** `packages/ui` só exporta `cn()` + preset; os componentes reais estão em `apps/web/src/components/ui/`: Button (CVA, variantes/sizes), Input/Textarea/Select, Label, **Modal (prop `size` sm→2xl + `footer` fixo + pilha global de Esc)**, Combobox/Autocomplete (portal ancorado, teclado), MaskedInput, MoneyInput, Avatar/AvatarUpload, Badge, Card, Table (com overflow-x-auto), Skeleton/TableSkeleton, EmptyState/QueryError, confirm-dialog (`useConfirm`/`usePrompt`), toast, sortable (@dnd-kit), UploadArquivo, PageHeader, Breadcrumbs. **Faltam** componentes dedicados de Checkbox/Radio/Switch, Tooltip e Tabs (feitos ad-hoc).

**Padrões.** Loading = Skeleton; vazio = EmptyState; confirmação = pop-up custom (fim do `window.confirm`); breadcrumbs dinâmicos (`useDynamicCrumb`); modal com rodapé fixo. Formatação **centralizada** (`formatBRL`/`format-date` com fuso America/Sao_Paulo) — ponto forte confirmado (nenhuma reimplementação de `R$`/`toFixed` encontrada). [código]

**Responsividade [código].** Shell responsivo real (sidebar recolhível no desktop, drawer no mobile; busca vira ícone; breadcrumb→título). Kanban empilha no mobile. Porém **só ~42% dos `.tsx` (45/108) usam prefixos responsivos** — boa parte das telas **não foi auditada explicitamente para breakpoints**. Painéis densos (Dashboard, Sistema) podem não colapsar bem no mobile. **Não testado em tablet/celular reais nesta auditoria.**

**Acessibilidade — lacunas reais [código]:**
- **`Modal` não tem `role="dialog"`/`aria-modal`, nem foco automático/focus-trap/restauração de foco** — como é a base de quase todos os diálogos, é a lacuna de MAIOR impacto para leitores de tela.
- **Combobox/Autocomplete** sem `role="combobox"/"listbox"/"option"`, `aria-expanded/activedescendant` — teclado funciona visualmente, mas não é exposto semanticamente.
- **~15 arquivos com botões só-ícone sem `aria-label`** aparente (LeadsPipelinePage, ClientesListPage, CardPanel, DocumentosPage…).
- **Erros de validação sem `role="alert"`/`aria-invalid`/`aria-describedby`.**
- Bons sinais: `focus-visible:ring` quase universal, `Label htmlFor` pareado, Esc no modal, breadcrumbs com aria.

**Consistência [código].** Forte no geral. **Inconsistências:** (a) 3 telas usam `toLocaleDateString` cru em vez do módulo central de datas (Dashboard, Agenda, Sistema) — risco de fuso; (b) cores `brand-*` (hex fixo) misturadas com tokens semânticos em Avatar/Badge — quebraria a re-temização se o dark mode fosse ligado.

**Comportamento desktop/tablet/celular.** Desktop verificado ao vivo nesta sessão (1920×1080) em várias páginas. **Tablet e celular NÃO foram testados** — só há evidência estática de classes responsivas. [não testado]

---

## 8. Autenticação e segurança

> Veredito do levantamento dedicado (opus): **postura acima da média** para um app deste porte. Detalhes:

**Funcional e correto [código]:**
- **Login** com argon2id (`@node-rs/argon2`), exige `ativo && !deletedAt && passwordHash`; grava ActivityLog. **Throttle** dedicado (8 tentativas/15min por IP+email) — porém **in-memory** (reseta no restart, não compartilhado entre processos).
- **Logout** apaga a sessão do banco.
- **Sessão** server-side (tabela `Session`, TTL 30d), revalidada a cada request (rejeita se inativo/excluído).
- **Cookie** `sid`: **httpOnly + signed + sameSite=lax**, `secure` só em produção. Assinado com `SESSION_SECRET`.
- **Recuperação de senha:** **anti-enumeração** (sempre `{ok:true}`), token de 1h hasheado, redefinição **revoga todas as sessões**. `changePassword` revoga as demais.
- **Criação de usuários:** convite por token (admin nunca conhece a senha).
- **Tokens** (convite/reset): `randomBytes(32)` no link, **só o SHA-256 vai ao banco**, uso único atômico.
- **Senhas:** nunca em texto; sempre argon2id.
- **Segredos/ENV:** `config.ts` valida com Zod no boot e **aborta se inválido**. `SESSION_SECRET` obrigatório (≥16), **sem fallback hardcoded**. `configInfo()` do painel Sistema **não vaza** segredos.
- **Uploads:** nome em disco = UUID, extensão sanitizada, validação de prefixo (anti path traversal), limite 20MB/5MB, escopo por cliente.
- **CORS:** origem única (`WEB_ORIGIN`), não-wildcard, com credentials.
- **Rate-limit** global: 300 req/min por IP.
- **Integridade de documentos:** proposta/assinatura congelam `hashConteudo` e recusam se o conteúdo mudou após o envio.
- **SQL:** **sem injeção** — os `$queryRawUnsafe` interpolam só literais internos hardcoded; o resto é Prisma parametrizado. **Sem SSRF**, sem webhooks de entrada.
- **Logs:** não registram senhas/tokens/segredos; ErrorLog só INTERNAL_SERVER_ERROR (com stack truncado).

**Vulnerabilidades / riscos confirmados no código (priorizados):**
1. 🔴 **CSP desativada** — `helmet({ contentSecurityPolicy: false })` (`server.ts`). Documentos/propostas renderizam Markdown e assinaturas guardam imagem como data-URI. Sem CSP, o risco de XSS é maior. **Já é pendência conhecida** no DEPLOY.md. **Alta.**
2. 🟠 **Token de assinatura usa `cuid`** (`Assinatura.token @default(cuid())`), não gerador criptográfico — e a página pública `/assinar/{token}` expõe o conteúdo do documento sem login. `cuid` não é projetado para ser imprevisível/segredo. (Contraste: proposta usa `randomUUID()`, correto.) **Média.**
3. 🟠 **Dados de negócio enviados à OpenAI sem anonimização** (nomes de clientes/leads, compromissos, contas) — a OpenAI vira sub-processador (LGPD). Sem DPA/base legal formalizada. **Média (LGPD).**
4. 🟡 **Upload valida MIME só pelo header declarado (sem sniffing de magic bytes)** — mitigado por servir sempre como `attachment`. **Baixa/Média.**
5. 🟡 **Possível XSS na impressão de briefing** (`RespostaBriefingDialog`/`BriefingDialog`, `document.write` com valores do backend sem escape visível no front) — depende de o backend escapar. **Verificar. Média se confirmado.**
6. 🟡 **`/avatar/:userId` cross-tenant** (qualquer logado vê avatar de qualquer um). **Baixa.**
7. 🟡 **`NODE_ENV` default `development`** — se o servidor de produção esquecer de setar `NODE_ENV=production`, o cookie perde `secure` e e-mail/CSP ficam em modo dev. **Operacional — garantir no deploy.**
8. 🟡 **Duplicação da lógica de auth** — os endpoints HTTP (`uploads.ts`) reimplementam a checagem de cookie em vez de reusar o contexto tRPC (risco de divergência futura). **Baixa.**
9. 🟡 **Rate-limit único e global (300/min)** — sem limite mais restrito dedicado a `login`/`solicitarReset`/`/upload`. **Baixa.**

---

## 9. Integrações e serviços

| Integração | Onde | Variáveis | Estado | Mock? | Falta configurar | Riscos/limitações |
|---|---|---|---|---|---|---|
| **OpenAI** | `lib/ai.ts` + `modules/ia` | `OPENAI_API_KEY` (opcional) | Funcional se houver chave; **oculta se não** (`isAiEnabled`) | Não (degrada, não mocka) | Chave em produção (se quiser IA) | Custo (sem rate-limit dedicado); **LGPD** (dados reais); rede outbound do servidor |
| **E-mail (SMTP)** | `lib/email.ts` + `modules/emails` | `SMTP_HOST/PORT/USER/PASS/FROM` (opcionais) | Funcional se completo; **no-op "modo dev"** (mostra link na tela) se não | Não (fallback consciente) | SMTP real da MedConsultoria | Sem SMTP, convites/reset só aparecem na tela |
| **Banco (MySQL/Prisma)** | `packages/db` | `DATABASE_URL` (obrigatória) | Funcional | Não | Banco de produção (DirectAdmin) | Pool de conexões em hospedagem compartilhada (a validar) |
| **Armazenamento de arquivos** | `http/uploads.ts` + `lib/storage.ts` | `UPLOADS_DIR` (default `storage/uploads`) | Funcional (disco local) | Não | **Pasta persistente FORA do dir de deploy** (o rsync `--delete` sobrescreveria) | ⚠️ Persistência em produção **não resolvida** |
| **Notificações (realtime)** | `realtime/socket.ts` | — (reusa cookie) | Funcional | Não | — | Um processo; sem adaptador para múltiplos nós |
| **Webhooks / outras APIs** | — | — | **Não existem** | — | — | — |
| **Autenticação** | própria (sessão+cookie) | `SESSION_SECRET` | Funcional | Não | Segredo forte em produção | — |

Todas as integrações externas são **opcionais e degradam com elegância** (o app funciona sem OpenAI e sem SMTP). [código]

---

## 10. Configuração e ambiente

**Node/gerenciador [executado].** pnpm **10.19**, Node **>=20** (`.nvmrc = 20`, `engines.node`). **Sem Python.** Monorepo com `pnpm-workspace.yaml` (`apps/*`, `packages/*`) + Turborepo (`turbo.json`: build/dev/typecheck/lint/test).

**Scripts (root) [código]:** `dev`, `build`, `typecheck`, `lint`, `test` (via turbo); `build:deploy` (build + `bundle-deploy.mjs`); `db:generate/migrate/seed/demo/studio`; `db:up/down` (docker). apps/web: dev/build/preview/typecheck/lint (**sem test**). apps/api: dev(tsx)/build(tsup)/start(node)/typecheck (**sem test, sem lint**).

**Build [executado].** `pnpm build` → **exit 0, sucesso (15.68s)**; gera `apps/api/dist` (server.js bundlado) e `apps/web/dist` (SPA). ⚠️ **Aviso:** bundle principal do front = **823 kB (241 kB gzip)** > 500 kB — sem code-splitting de vendor (melhorável com `manualChunks`).

**Typecheck [executado].** `pnpm -r typecheck` = **5/5 pacotes OK**.

**Lint [código/executado].** `apps/web` declara `"lint": "eslint src"`, **mas o ESLint NÃO está instalado** (sem dependência, sem config, sem binário) → **`pnpm lint` falharia hoje**. **Sem Prettier.** `tsconfig.base.json` é rigoroso (strict, noUncheckedIndexedAccess, noImplicitOverride).

**Migrations/seeds.** 50 migrations; `db:seed` (ROOT) e `db:demo` (exemplo). Em produção, `deploy.sh` roda `prisma migrate deploy` automaticamente. [código]

**Docker.** `docker-compose.yml` sobe **só o MySQL 8.4** (dev, porta 3307, volume persistente, healthcheck). Sem Redis/mailhog. [código]

**`.env` [código/executado].** `.env.example` (dev) e `.env.deploy.example` (SSH) versionados; **`.env` real existe no disco mas NÃO está versionado** (gitignored). Variáveis (nomes, sem valores): `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV`, `API_PORT`, `WEB_ORIGIN`, `UPLOADS_DIR`, `OPENAI_API_KEY`, `SMTP_HOST/PORT/USER/PASS/FROM`, `SEED_ROOT_EMAIL/PASSWORD/NOME`; deploy: `DEPLOY_HOST/USER/PATH/SSH_PORT/SSH_KEY`.

**Arquivos de config presentes:** `tsconfig.base.json`, `turbo.json`, `pnpm-workspace.yaml`, `.nvmrc`, `docker-compose.yml`, `.mcp.json` (MCP Playwright), `deploy.sh`, `.gitignore`. **Ausentes:** eslint config, prettier config, CI (`.github/workflows`), playwright/vitest config.

---

## 11. Git e GitHub

[executado — comandos git read-only]

- **Branch atual:** `main`.
- **Commits:** **ZERO** ("your current branch 'main' does not have any commits yet"). **Nada foi commitado ainda.**
- **Remote:** **nenhum configurado** (`git remote -v` vazio).
- **Arquivos rastreados:** nenhum. **Tudo está como não-rastreado (`??`)** — o primeiro `git add` vai incluir todo o projeto.
- **`.gitignore`:** **existe e está correto** — ignora `.env` e `.env.*` (com exceção de `.env.example`/`.env.deploy.example`), `node_modules/`, `dist/`, `build/`, `storage/` (uploads), `.turbo/`, `*.log`, `.playwright-mcp/`, screenshots (`/*.png`). **Confirmado [executado]:** `git check-ignore .env` → ignorado; `node_modules` → ignorado.
- **Arquivos sensíveis:** o `.env` real (com chaves OpenAI/SMTP preenchidas) **NÃO seria commitado** (está protegido). Bom.
- **Arquivos "stray" a revisar antes do 1º commit [executado]:** `doc-page.md` (143 linhas, na raiz — parece rascunho solto, não é doc oficial do `docs/`). Vale conferir/remover.
- **Riscos antes do 1º push:**
  1. Fazer `git add .` sem revisar → incluir o `doc-page.md` e possíveis artefatos. Baixo (o .gitignore cobre o essencial).
  2. Repositório **novo, sem histórico** — o primeiro commit será enorme; recomendável um commit inicial limpo e coerente.
  3. Confirmar que nenhuma screenshot/`.env`/dump entrou (o `.gitignore` cobre, mas revisar `git status` após `add -n`).

> **Nada foi commitado nem enviado nesta auditoria** (conforme instruído).

---

## 12. Hospedagem e produção (TineHost / DirectAdmin — `workspace.medconsultoria.com.br`)

[código — pipeline existe e está documentado; **nunca executado em produção real**]

- **Stack no servidor:** **Node.js é NECESSÁRIO** (a app é um processo Fastify que serve API + WS + SPA). **Python NÃO é necessário.**
- **Banco:** MySQL — usar o banco do próprio painel DirectAdmin (não o Docker de dev). Definir `DATABASE_URL` no `.env` do servidor.
- **Processo de build:** local (`pnpm build:deploy`) monta um artefato **auto-contido** em `apps/api/dist/` (server.js via tsup + `public/` = SPA + `prisma/` + `package.json` de produção só com deps runtime, sem `workspace:*`). Depois `rsync -az --delete --exclude ".env"` para o servidor; via SSH: `npm ci --omit=dev`, `prisma generate`, `prisma migrate deploy`, restart.
- **Arquivo de inicialização:** `dist/server.js` (`node server.js`); restart via **Passenger** (`touch tmp/restart.txt`) — ajustável para Nginx Unit (a decidir).
- **Persistência de uploads:** ⚠️ **PENDÊNCIA NÃO RESOLVIDA** — `UPLOADS_DIR` precisa apontar para pasta **fora** do diretório de deploy (o `rsync --delete` apagaria os uploads a cada deploy).
- **Variáveis de ambiente:** no `.env` do servidor (preservado pelo `--exclude .env`): `DATABASE_URL`, `SESSION_SECRET` (forte!), `NODE_ENV=production`, `WEB_ORIGIN=https://workspace.medconsultoria.com.br`, `UPLOADS_DIR` persistente, e opcionais OpenAI/SMTP.
- **HTTPS/domínio:** subdomínio + SSL pelo painel DirectAdmin; garantir proxy → porta do Node.
- **Migrations:** automáticas no deploy (`prisma migrate deploy`).
- **Logs:** Fastify logger (stdout) + ErrorLog no banco (painel Sistema).
- **Limitações/riscos da hospedagem compartilhada [documentados em DEPLOY.md]:**
  1. **Binário nativo do `@node-rs/argon2`** pode não rodar em hospedagem compartilhada (a validar no 1º deploy — risco alto se falhar, pois quebra login).
  2. **Passenger vs Nginx Unit** — mecanismo de restart/proxy WebSocket a confirmar.
  3. **CSP do Helmet desligada** — ligar/afinar no deploy.
  4. **Pool de conexões MySQL** limitado em shared hosting.
  5. **Rede outbound** para OpenAI/SMTP pode ser bloqueada.
  6. **WebSocket (Socket.IO)** precisa de suporte a upgrade no proxy.
- **Deploy real ainda não foi feito** (confirmado no próprio `docs/CLAUDE.md`).

---

## 13. Testes existentes

[executado — busca no repo]

- **Testes unitários:** ❌ **NÃO EXISTEM** (sem Vitest/Jest, sem `*.test.ts`, sem dependência).
- **Testes de integração:** ❌ **NÃO EXISTEM.**
- **Testes end-to-end (Playwright Test):** ❌ **NÃO EXISTEM** (sem `@playwright/test`, sem `playwright.config`).
- **`.mcp.json`:** configura o **MCP do Playwright** (`npx @playwright/mcp@latest`) — é a ferramenta **interativa** usada pelo agente para navegar/inspecionar a UI durante o desenvolvimento. **NÃO é uma suíte de testes** que roda em CI/`pnpm test`.
- **CI:** ❌ **NÃO EXISTE** (`.github/workflows` ausente).
- **`pnpm test`:** roda `turbo run test`, mas **nenhum pacote tem o script `test`** → não executa nada (silenciosamente).
- **Cobertura atual:** **0% automatizada.** A "QA" mencionada nas notas do projeto = sessões manuais do agente via MCP Playwright, não uma suíte reproduzível.
- **Divergência documentada:** `docs/CLAUDE.md` prescreve "TDD por padrão, Vitest + Playwright" como norma — **isso é aspiracional; a realidade é zero testes.**
- **O que foi verificado ao vivo NESTA sessão (manual, não reproduzível):** Portal "Editar perfil", construtores de Contrato/Recibo, fluxo proposta→aceite→contrato automático, comportamento de scroll (Início/Vendas/Clientes/Agenda/Mensagens/Documentos), divisor da Mensagens. **O restante das telas não foi testado em runtime.**
- **Credenciais/dados p/ testes completos:** usuário ROOT (`SEED_ROOT_*` no `.env`); dados demo via `pnpm db:demo` (Portal `cliente@medconsultoria.com.br` / `medconsultoria123`). Para SMTP/OpenAI reais, seriam necessárias as chaves.

---

## 14. Problemas encontrados

| # | Problema | Módulo | Gravidade | Impacto | Provável causa | Correção recomendada | Testar depois? |
|---|---|---|---|---|---|---|---|
| 1 | **Zero testes automatizados + zero CI** | Projeto | 🔴 Crítica | Nenhuma rede de segurança; regressões passam despercebidas | Priorizou-se velocidade de features | Criar suíte Playwright (fluxos críticos) + Vitest (services/procedures) + CI | Sim |
| 2 | **CSP do Helmet desativada** | API/segurança | 🔴 Crítica | Superfície de XSS ampliada (render de Markdown/data-URI) | Deixada off até afinar p/ Vite | Ligar CSP afinada antes do deploy | Sim |
| 3 | **Nenhum commit / nenhum remote no Git** | Git | 🔴 Crítica | Código sem versionamento nem backup remoto | Repo recém-iniciado | Commit inicial limpo + criar remote privado | Sim (revisar git status) |
| 4 | **Persistência de uploads em produção não resolvida** | Deploy/arquivos | 🔴 Crítica | `rsync --delete` apagaria uploads a cada deploy | `UPLOADS_DIR` default dentro do dir de deploy | Apontar `UPLOADS_DIR` p/ pasta persistente externa | Sim (no 1º deploy) |
| 5 | **`@node-rs/argon2` (binário nativo) pode não rodar na TineHost** | Deploy/auth | 🔴 Crítica | Se falhar, **login não funciona** em produção | Hash nativo em shared hosting | Validar no 1º deploy; plano B (argon2 em WASM/bcrypt) | Sim (no 1º deploy) |
| 6 | **`Documento.criadoPorId` = onDelete Cascade** | Banco | 🟠 Alta | Excluir funcionário APAGA seus documentos (contratos/propostas) | Destoa do padrão SetNull do schema | Trocar p/ `SetNull` (+ migration) | Sim |
| 7 | **Token de assinatura usa `cuid` (não-cripto)** | Documentos/segurança | 🟠 Alta | Link público de assinatura previsível expõe documento | `@default(cuid())` em vez de UUID/randomBytes | Trocar gerador p/ criptográfico | Sim |
| 8 | **Dados de negócio enviados à OpenAI sem base legal formal** | IA/LGPD | 🟠 Alta | Exposição a sub-processador sem DPA/consentimento | Falta de camada de privacidade | Formalizar DPA/base legal + política; avaliar anonimização | Não (jurídico) |
| 9 | **`NODE_ENV` default `development`** | Config/segurança | 🟠 Alta | Em prod sem a var: cookie sem `secure`, e-mail/CSP em modo dev | Default permissivo | Forçar `NODE_ENV=production` no `.env` do servidor | Sim |
| 10 | **Dados de teste poluindo o banco de dev** | Banco | 🟡 Média | Ruído/confusão; risco de vazar p/ prod se copiado | Testes manuais sem limpeza | Limpar (conversas "asdasd", clientes "QA Teste", "Lead Teste") | Sim |
| 11 | **`Modal` sem semântica de diálogo/foco (a11y)** | UI | 🟡 Média | Leitores de tela não anunciam; foco escapa | Componente base incompleto | Add `role="dialog"`/`aria-modal`/focus-trap | Sim |
| 12 | **Possível XSS na impressão de briefing** | Documentos/Portal | 🟡 Média | `document.write` com dados do backend | Falta escape visível no front | Sanitizar/escapar antes de imprimir; verificar backend | Sim |
| 13 | **ESLint listado mas não instalado** | Config | 🟡 Média | `pnpm lint` falha; sem análise estática de estilo | Script placeholder | Instalar/configurar ESLint (+ Prettier) | Sim |
| 14 | **Bundle principal 823 kB sem code-splitting** | Frontend | 🟡 Média | Carregamento inicial mais lento | Vendor não separado | `manualChunks` no Vite | Sim |
| 15 | **`situacaoComercial` String livre (não enum)** | Banco | 🟡 Média | Valor inválido/typo não pego pelo schema | Escolha de modelagem | Converter p/ enum (+ migration) | Sim |
| 16 | **Catálogo real nasce por "lazy seed" no código** | Banco | 🟡 Média | Difícil auditar "o padrão de produção"; alterar arrays não afeta banco já semeado | Design de seed on-read | Documentar + considerar seed versionado idempotente | Não |
| 17 | **Paginação/ordenação não universais** | CRUDs | 🟡 Média | Risco de performance/UX com crescimento dos dados | Volumes pequenos hoje | Adicionar paginação server-side nas listas grandes | Sim (com volume) |
| 18 | **Tema escuro definido mas inerte** | UI | 🟢 Baixa | Ponto morto; pode enganar manutenção | Preparado e não ligado | Implementar toggle OU remover tokens; corrigir `brand-*` hardcoded | Não |
| 19 | **3 telas com `toLocaleDateString` fora do módulo de datas** | UI/consistência | 🟢 Baixa | Possível deslocamento de fuso | Escapou da centralização | Migrar p/ `format-date.ts` | Sim |
| 20 | **`/avatar/:userId` cross-tenant** | Segurança | 🟢 Baixa | Cliente vê avatar de qualquer usuário | Intencional | Restringir se for requisito | Não |
| 21 | **Cliente↔requisito não validado em formulários do Portal** | Segurança | 🟢 Baixa | Cliente lê template de requisito não contratado | Falta de checagem de vínculo | Validar vínculo | Sim |
| 22 | **Throttle de login in-memory** | Segurança | 🟢 Baixa | Reseta no restart; frágil se escalar | Simplicidade (1 processo) | OK p/ 1 nó; revisar se escalar | Não |
| 23 | **`Nota` do cliente sem editar/apagar** | CRUD | 🟢 Baixa | Inconsistência com o card | Design (log imutável?) | Decidir e uniformizar | Não |
| 24 | **Arquivo stray `doc-page.md` na raiz** | Repo | 🟢 Baixa | Rascunho solto entra no 1º commit | Sobra | Revisar/remover antes do commit | Não |

---

## 15. Estado real do projeto

**O que está REALMENTE pronto (código-completo + build passa + typecheck 5/5):**
- Todos os módulos de negócio estão **implementados no código** (sem placeholders/mocks): Vendas, Clientes, Projetos, Agenda, Mensagens, Documentos, Financeiro, Serviços, Equipe, Sistema, Portal. [código]
- Build de produção **compila (exit 0)** e typecheck passa. [executado]
- Autenticação/RBAC/isolamento do Portal **bem construídos**. [código + segurança auditada]
- Pipeline de deploy **existe e está documentado**. [código]

**O que PARECE pronto, mas NÃO foi validado:**
- Praticamente **toda a UI em runtime** — não há testes; só verificações manuais pontuais (as marcadas "ao vivo"). O comportamento real de cada CRUD/fluxo **não está comprovado**. [não testado]
- Responsividade em **tablet/celular**. [não testado]
- Integrações **OpenAI/SMTP com credenciais reais** (funcionam em dev conforme código; envio real não exercitado nesta auditoria).

**O que está INCOMPLETO:**
- Paginação/ordenação universais; toasts warning/info; edição/exclusão de `Nota` do cliente; acessibilidade do Modal/Combobox; ESLint/Prettier; code-splitting. [código]

**O que está QUEBRADO:**
- **`pnpm lint`** (ESLint não instalado). [executado]
- Nenhuma tela quebrada foi encontrada no código; **não afirmável em runtime** por falta de testes.

**O que usa dados de EXEMPLO:**
- `demo-seed.ts` (rotulado). Além disso, **o banco de dev tem dados de teste sujos** que precisam de limpeza. Catálogos reais (serviços/modelos/etc.) nascem por lazy-seed. [executado]

**O que depende de CONFIGURAÇÃO externa:**
- Produção: `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`, `UPLOADS_DIR` persistente, `WEB_ORIGIN`. Opcionais: OpenAI, SMTP. Deploy: SSH/DirectAdmin.

**O que IMPEDE a publicação (bloqueadores):**
1. Persistência de uploads não resolvida (item 4).
2. Validar `@node-rs/argon2` na TineHost (item 5) — risco de login não funcionar.
3. `NODE_ENV=production` + `SESSION_SECRET` forte + CSP (itens 2, 9).
4. Sem versionamento Git / backup remoto (item 3).
5. Sem qualquer teste automatizado que comprove os fluxos (item 1) — não é bloqueador técnico de subir, mas é de **confiança** para produção.

**Percentual estimado de conclusão (avaliação honesta):**
- **Desenvolvimento de features (código):** ~**90%** — o produto está denso e code-completo; faltam refinamentos (paginação, a11y, code-splitting) e correções de banco/segurança.
- **Endurecimento para produção (testes, segurança de deploy, uploads, CSP, Git, validação em runtime):** ~**45%**.
- **Conclusão geral ponderada para "pronto e confiável em produção": ~75%.**

---

## 16. Plano recomendado para finalizar

> Ordem lógica de execução. **Regra: nada de commit/push/deploy até as etapas correspondentes.**

**Etapa 1 — Correções críticas**
- [ ] Ativar/afinar **CSP** no Helmet (item 2).
- [ ] Resolver **persistência de uploads** (`UPLOADS_DIR` externo) (item 4).
- [ ] **Validar `@node-rs/argon2`** na TineHost (POC de login) ou definir plano B (item 5).
- [ ] Garantir `NODE_ENV=production` + `SESSION_SECRET` forte no servidor (item 9).
- [ ] Trocar **token de assinatura** para gerador criptográfico (item 7).

**Etapa 2 — Correções estruturais (banco)**
- [ ] `Documento.criadoPorId` → `SetNull` (item 6, + migration).
- [ ] `situacaoComercial` → enum (item 15).
- [ ] Revisar FKs soltas críticas (`LeadPasso.documentoId`) e o Restrict de `PipelineStage`.
- [ ] **Limpar dados de teste** do banco (item 10) e decidir estratégia de seed de produção (item 16).

**Etapa 3 — Finalização dos CRUDs**
- [ ] Paginação/ordenação server-side nas listas que crescem (item 17).
- [ ] Editar/apagar `Nota` do cliente (ou documentar como imutável) (item 23).
- [ ] Toasts warning/info onde fizer sentido.

**Etapa 4 — Autenticação e permissões**
- [ ] Validar vínculo cliente↔requisito no Portal (item 21).
- [ ] Revisar `/avatar/:userId` (item 20) e rate-limit dedicado em login/reset (item 9/22).
- [ ] Formalizar LGPD do envio à OpenAI (item 8).

**Etapa 5 — Padronização visual**
- [ ] Acessibilidade do **Modal** (role/aria/focus-trap) e Combobox (item 11).
- [ ] `aria-label` em botões só-ícone; `role="alert"` em erros (item 11).
- [ ] Migrar as 3 telas para `format-date.ts` (item 19); decidir dark mode + `brand-*` (item 18).

**Etapa 6 — Responsividade**
- [ ] Auditar breakpoints de todas as páginas (foco em Dashboard/Sistema/tabelas).
- [ ] Testar em tablet e celular reais.

**Etapa 7 — Integrações**
- [ ] Configurar SMTP real e testar envio (só para `tibamooca@gmail.com`/`contato@medconsultoria.com.br`).
- [ ] Configurar OpenAI em produção (se desejado) e validar rede outbound.

**Etapa 8 — Testes com MCP Playwright (+ automação)**
- [ ] Criar `.env`/dados demo dedicados de teste.
- [ ] Escrever suíte E2E (Playwright Test) dos fluxos críticos: login, funil→conversão, proposta→aceite→contrato, upload/assinatura, Portal, financeiro.
- [ ] Adicionar Vitest para services/procedures de risco (auth, RBAC, isolamento do Portal).
- [ ] Instalar/config ESLint + Prettier (item 13).

**Etapa 9 — Preparação para produção**
- [ ] `manualChunks` no Vite (item 14); revisar `configInfo`/logs.
- [ ] Checklist final de `.env` de produção; testar `pnpm build:deploy` do bundle.

**Etapa 10 — Git, commits e push**
- [ ] Revisar `git status`; remover `doc-page.md` (item 24) e artefatos.
- [ ] Commit inicial limpo; criar remote **privado**; push.

**Etapa 11 — Implantação na TineHost**
- [ ] Rodar `deploy.sh` (build → rsync → migrate → restart); configurar HTTPS/proxy/WebSocket no DirectAdmin.

**Etapa 12 — Validação final após publicação**
- [ ] Smoke test de todos os fluxos em produção (login, Portal, upload persistente após redeploy, e-mail, IA, WebSocket, assinatura).
- [ ] Conferir CSP, cookies `secure`, logs e migrations aplicadas.

---

### Anexo — o que foi CONFIRMADO EM EXECUÇÃO nesta auditoria
- `pnpm build` (produção) → **exit 0**; `pnpm -r typecheck` → **5/5 OK**.
- Inspeção do banco de dev (45 tabelas, 50 migrations, contagens, dados de teste).
- Estado do Git (0 commits, sem remote, `.gitignore` protege `.env`).
- Verificações ao vivo (Playwright) desta sessão: Portal editar-perfil, construtores de Contrato/Recibo, fluxo de aceite→contrato automático, comportamento de scroll e divisor da Mensagens.

Todo o restante é **análise estática de código** — marcado como **[código]** e explicitamente **não comprovado em runtime**.
