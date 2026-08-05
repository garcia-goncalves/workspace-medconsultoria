# ROADMAP.md — Workspace MedConsultoria

Planejamento de evolução. **Regra:** cada fase entrega valor real e mantém o sistema funcionando. Nada de big bang. A ordem prioriza destravar o resto e reduzir o estresse operacional o quanto antes.

Legenda de status: ⬜ pendente · 🟨 em andamento · ✅ concluída.

---

## Fase 0 — Fundação & Documentação ✅

**Objetivo:** base sólida sobre a qual todo o resto é construído.

- [x] 7 documentos (`CLAUDE`, `README`, `ARCHITECTURE`, `ROADMAP`, `DECISIONS`, `UI_GUIDELINES`, `DATABASE`).
- [x] Scaffold do monorepo (pnpm + Turborepo): `apps/web`, `apps/api`, `packages/{db,shared,ui}`.
- [x] Design system: Montserrat + paleta como tokens + tema shadcn + shell (sidebar + topbar + Command Palette).
- [x] Prisma + MySQL local; primeiras tabelas: `User`, `Session`, `ActivityLog`.
- [x] Auth completo: login, sessão por cookie httpOnly, argon2id, RBAC (middlewares tRPC), seed do 1º ROOT.
- [x] Infra Socket.IO + `NotificationService` (base, sem features ainda).
- [x] Indexar no codebase-memory MCP.
- [x] Pipeline de deploy SSH (`deploy.sh`) + deploy em produção concluído.

**Verificação (local):** ✅ `pnpm typecheck` verde nos 5 pacotes · ✅ `pnpm --filter @app/web build` OK · ✅ login/sessão/logout/401 testados end-to-end via API · ✅ `/health` OK. **Deploy em produção FEITO** ✅ — app no ar em `workspace.medconsultoria.com.br` (TineHost).

---

## Fase 1 — CRM (backbone) ✅ (núcleo)

**Objetivo:** organizar clientes e o funil — tudo depende disso.

Entregue e verificado (Clientes):
- [x] Entidades `Cliente`, `Contato`, `Nota` + relações no `User`; migration aplicada.
- [x] `clientesRouter` (list/get/create/update/remove + contatos + notas), acesso FUNCIONARIO+.
- [x] TanStack Router + telas: lista de clientes (busca), ficha do cliente (contatos, anotações, editar, remover).
- [x] Command Palette navegando entre áreas.
- [x] Verificado: typecheck verde, build OK, CRUD/nota/contato testados end-to-end + 401 sem login.

Entregue e verificado (Leads/funil):
- [x] Entidades `Lead`, `PipelineStage` (colunas auto-semeadas) + migration.
- [x] `pipelineRouter` + `leadsRouter` (list/create/update/move/convert/remove).
- [x] **Funil kanban** com drag-and-drop (dnd-kit) entre etapas + criar/editar/remover lead.
- [x] **Converter Lead → Cliente** (cria a ficha e navega até ela).
- [x] Verificado: typecheck verde, build OK, criar/mover/converter/duplo-convert testados end-to-end.

Próximo incremento:
- [ ] Anexos (`Attachment`) na ficha do cliente.
- [ ] Timeline consolidada (Nota + ActivityLog) na UI.
- [ ] Depois: Fase 2 (Projetos + Kanban + Timer).

---

## Fase 2 — Projetos + Kanban + Timer ✅ (núcleo)

**Objetivo:** organizar a execução do trabalho da equipe.

- [x] `Projeto` (por cliente) + `Card` com **colunas fixas** (Inbox · A Fazer · Em andamento · Aguardando Cliente · Aguardando Operadora · Concluído) via enum.
- [x] `projetosRouter` + `cardsRouter` (CRUD, move, checklist, comentários, timer start/stop).
- [x] Web: lista de projetos + kanban por projeto (drag-and-drop dnd-kit) + painel do cartão (descrição, prioridade, prazo, **checklist**, **timer ao vivo**, comentários).
- [x] `TimeEntry`: start/stop → registro de tempo (verificado: 2s gravados no smoke test).
- [x] Verificado: typecheck verde, build OK, criar/mover/checklist/timer testados end-to-end.

Próximo incremento: anexos em card/cliente · relatórios do timer · histórico do card.

---

> **Agenda — visualizações (2026-07-07):** além da lista, a `AgendaPage` tem calendário em **5 modos** — Lista · Dia · Semana · Mês (grade de quadrados com chips por tipo) · Ano (12 mini-meses). Navegação por período, "hoje" destacado, clique no dia/mês para drill-in, `+` para criar já na data. O backend (`agenda.list`) expande recorrências para qualquer intervalo.

## Fase 3 — Agenda + Reuniões + Notificações ✅

**Objetivo:** ninguém mais perde retorno, reunião ou compromisso.

- [x] `Evento`: compromissos, retornos, reuniões, lembretes; **recorrência** (diária/semanal/mensal, expandida no servidor); escopo pessoal vs empresa; cliente/projeto.
- [x] Reuniões por **link** (Meet/Jitsi/Zoom) — botão "Entrar" no evento.
- [x] `agendaRouter` + `notificacoesRouter`; **loop de lembretes** que empurra notificação via Socket.IO quando um evento começa em ≤15 min.
- [x] Web: **AgendaPage** (visão semanal, eventos por dia, navegação) + `EventoFormDialog` + **sino de notificações** no topo (badge + real-time via socket).
- [x] Verificado: typecheck/build verdes; e2e (recorrência expande, lembrete gerado); **verificação visual com Playwright** (login → agenda → sino com lembrete real).

---

## Fase 4 — Financeiro ✅ (núcleo)

**Objetivo:** controle de dinheiro sem planilha paralela. (Alto valor, módulo sensível.)

- [x] `Conta` (a pagar/receber, `Decimal(12,2)`), `Categoria` (receita/despesa, cores) — auto-seed de categorias.
- [x] `financeiroRouter` (**adminProcedure** — só ADMIN/ROOT): contas CRUD, marcar paga, categorias, **resumo** (a receber/pagar, saldo, resultado do mês, vencidas). Decimal→number no service (sem dor de serialização).
- [x] Web: **FinanceiroPage** com cards de resumo, **alerta de vencidas**, filtros (tipo/status), tabela com marcar-paga; `ContaFormDialog`. Nav gated por papel (some para não-admin).
- [x] Verificado: typecheck/build verdes; e2e (resumo correto); **Playwright** (resumo R$ 8.000/R$ 4.300, alerta 2 vencidas, marcar paga recalcula ao vivo).

Próximo incremento: centro de custo · recorrência de contas (gerar próxima) · comprovantes (anexos) · gráfico de fluxo de caixa.

---

## Fase 5 — Dashboard completo ✅

**Objetivo:** responder "o que precisa da minha atenção agora?".

- [x] `dashboardRouter.resumo` agrega Agenda (eventos de hoje, com recorrência), Projetos (tarefas atrasadas + minhas tarefas), CRM (leads no funil + valor, clientes), e Financeiro (só admin: a receber/pagar, a vencer 7 dias, vencidas).
- [x] **DashboardPage** real: cards clicáveis, alertas (tarefas atrasadas / contas vencidas), seção "Hoje" (agenda com link Entrar) e "Tarefas atrasadas". Refetch a cada 60s.
- [x] Verificado: typecheck/build verdes; **Playwright** (dados reais cruzados: 5 leads/R$145k, financeiro admin, reuniões de hoje).

Próximo incremento: "clientes aguardando retorno", projetos parados, documentos pendentes (quando o módulo existir).

---

## Fase 6 — Mensagens Internas (chat) ✅ (núcleo)

**Objetivo:** tirar a comunicação operacional do WhatsApp.

- [x] Models `Conversa` (individual/grupo), `ConversaParticipante`, `Mensagem`.
- [x] `mensagensRouter`: listConversas (com não-lidas), usuarios, startIndividual (dedup), createGrupo, listMensagens, send (**emite via Socket.IO** para participantes), markRead.
- [x] Web: **MensagensPage** de 2 painéis (lista + thread + composer, Enter envia, auto-scroll, balões), `NovaConversaDialog` (pessoa/grupo); listener socket `mensagem` atualiza em tempo real.
- [x] Verificado: typecheck/build; e2e (criar conversa, enviar, listar); **Playwright** (abrir conversa e enviar mensagem pela UI).

Próximo incremento: anexos, menções (@), conversas por projeto/cliente, badge de não-lidas na sidebar.

---

## Fase 7 — Documentos Inteligentes (templates, sem IA) ✅

**Objetivo:** padronizar propostas/contratos/briefings.

- [x] `ModeloDocumento` (corpo com `{{...}}`, auto-seed de Proposta/Ata/Briefing), `Documento` (status RASCUNHO→EM_REVISAO→APROVADO→ENVIADO), `DocumentoVersao` (origem MANUAL/IA).
- [x] `documentosRouter`: modelos CRUD, criar documento (render de `{{cliente.nome}}`/`{{data}}`/variáveis), editar (nova versão), **workflow com aprovação humana** (não envia sem aprovar — bloqueado 400).
- [x] `AiService` **stub** pronto (`apps/api/src/lib/ai.ts`) para a IA plugar na Fase 9 (origem=IA).
- [x] Web: DocumentosPage (docs + modelos), NovoDocumentoDialog (preenche variáveis), DocumentoDetailPage (editar, workflow, **export PDF via print + Word via blob**, versões).
- [x] Verificado: typecheck/build; e2e (render, workflow, regra de aprovação); **Playwright** (criar→abrir→enviar p/ revisão→aprovar).

**Decisão registrada:** PDF via `window.print()` (browser) e Word via blob HTML `.doc` — zero dependência de servidor (puppeteer não roda em shared hosting). Server-side .docx/PDF fica para depois se necessário.

---

## Fase 8 — Portal do Cliente ✅ (núcleo)

**Objetivo:** cliente acompanha o próprio trabalho sem pedir por WhatsApp.

- [x] `portalProcedure` (role CLIENTE, `clienteId` **derivado da sessão**, nunca do input) — o isolamento.
- [x] `portalRouter` (resumo + documento) sempre filtrado por clienteId; documento só se ENVIADO e do próprio cliente (senão 404, sem vazar).
- [x] Web: **layout próprio** do portal (App.tsx faz branch por papel) — PortalLayout + PortalHome (projetos, documentos ENVIADOS com viewer/export, próximas reuniões).
- [x] Verificado (isolamento explícito): cliente→endpoints internos **403**; interno→portal **403**; cliente→documento alheio **404**. Playwright: login como cliente vê só seus dados (portal.png).

Próximo incremento: chat cliente↔equipe, envio de arquivos pelo cliente, mais páginas (kanban read-only).

---

## Fase 9 — Camada de IA ✅ (núcleo + assistente de busca)

**Objetivo:** automação assistida, sempre com humano no comando.

- [x] `AiService` real com **OpenAI** (`gpt-4o-mini`, `apps/api/src/lib/ai.ts`), `OPENAI_API_KEY` opcional no config (`isAiEnabled`).
- [x] Endpoints: `documentos.gerarComIA` (modelo+cliente+instruções → rascunho, versão `origem: IA`), `documentos.melhorarComIA` (reescreve → versão IA), `documentos.iaDisponivel` (gating).
- [x] IA de Documentos ampliada com **resumir reunião/ata** — mesma regra (sempre gera rascunho, sem envio automático).
- [x] Web: modo **"Gerar com IA"** no novo documento + **"Melhorar com IA"** no detalhe — só aparecem se a chave estiver configurada.
- [x] **Aprovação humana obrigatória** — IA sempre gera RASCUNHO; envio continua humano.
- [x] Módulo `busca` (`funcionarioProcedure`): `busca.global(termo)` pesquisa clientes, leads, projetos e documentos (até 5 por tipo), resultados agrupados — alimenta a paleta de busca (Ctrl+K).
- [x] Módulo `ia` (`funcionarioProcedure`): `ia.disponivel` + `ia.perguntar(pergunta)` — assistente de uso do sistema em PT-BR (nunca executa ações sozinho), disponível como modo **"Perguntar à IA"** dentro da paleta de busca, gated por `isAiEnabled`.
- [x] Verificado com chamada real à OpenAI: gerou proposta profissional (origem IA, status RASCUNHO); UI com toggle IA presente.

Próximo incremento: criar tarefas via IA, responder perguntas sobre dados do cliente/projeto (hoje o assistente só orienta o uso do sistema).

---

## Polimento pós-MVP ✅

**Objetivo:** fechar lacunas de operação/gestão que apareceram no uso real, antes do deploy de produção.

- [x] **Configurações (self-service):** `auth.updateProfile` (nome) e `auth.changePassword` — verifica a senha atual (argon2) e **revoga as demais sessões** ao trocar a senha. Página `/configuracoes`, acessível pelo menu do usuário no rodapé da sidebar.
- [x] **Usuários & acessos (admin):** módulo `usuarios` (list/create/update, `adminProcedure`). Cadastra equipe interna e cria **acessos ao Portal** (papel CLIENTE vinculado a um Cliente). RBAC de **menor privilégio**: só se atribui/gerencia usuário de papel estritamente abaixo do próprio (só ROOT cria ADMIN; um ADMIN não gerencia outro ADMIN); ninguém altera o próprio papel nem se autodesativa; sessões revogadas ao desativar/trocar senha. Página `/usuarios` com guarda de rota.
- [x] **Categorias financeiras:** CRUD completo (`financeiro.categorias.update/remove` + UI de gestão no Financeiro, antes só havia seed).
- [x] **Guarda de rota por papel no front** (`RoleGuard`) envolvendo `/financeiro` e `/usuarios` — mostra "Acesso restrito" em vez de renderizar e falhar (defesa em profundidade; o backend já exige o papel).
- [x] **Autocomplete (`Combobox`)** reutilizável (`apps/web/src/components/ui/combobox.tsx`), aplicado aos seletores de cliente nos formulários de projeto, conta (financeiro), evento (agenda), documento, resumir reunião e criação de acesso de Portal.
- [x] **Shell refinado:** sidebar mais larga com navegação agrupada (Principal/Comercial/Operação/Gestão) e menu do usuário no rodapé (Configurações, Sair); header com título da página, busca global proeminente (com dica de IA quando disponível) e notificações; conteúdo até 1600px.
- [x] **Paleta de busca em duas abas** (Buscar / **Assistente IA**): a IA virou uma aba explícita com **chat** (balões, sugestões, input próprio) — não mais escondida atrás de digitar.
- [x] **Notificações inteligentes** (ver ADR-12): sino com alertas **clicáveis** (levam à entidade) e leitura individual; **scan proativo** no servidor gera tarefas atrasadas, contas vencidas e documentos aguardando revisão, deduplicados — para o usuário não esquecer nada.
- [x] **Atribuição de responsável nos cartões** (com **autocomplete** da equipe): agora é possível reatribuir uma tarefa; quando atribuída a outra pessoa, ela recebe uma **notificação em tempo real** ("Nova tarefa: …"). Endpoint `usuarios.equipe` (interno) alimenta o seletor.
- [x] **Central "Precisa da sua atenção" no Dashboard**: bloco intitulado com os alertas acionáveis (suas tarefas atrasadas, contas vencidas, documentos em revisão), integrado aos mesmos sinais das notificações.

- [x] **Reatribuir responsável** em Cliente, Lead e Projeto (antes só o Card) — com autocomplete da equipe (`usuarios.equipe`).
- [x] **Projeto editar/remover/mudar status** na UI (backend já suportava) — ações na lista + botão no detalhe.
- [x] **Segurança (ADR-13):** `@fastify/helmet` (headers), `@fastify/rate-limit` (300/min por IP) e throttle de login por IP+e-mail. CSP pendente p/ o deploy.
- [x] **Ficha do cliente virou hub:** projetos, documentos, próximas reuniões e (p/ admin) financeiro do cliente, com atalho "Novo projeto" já vinculado (`clientes.relacionados`).

**Deploy em produção FEITO** ✅ — app no ar em https://workspace.medconsultoria.com.br (TineHost). Tempo real por polling (ADR-84; a hospedagem não faz WebSocket). Pendências do dono: rotacionar chave OpenAI/senha SMTP e preencher os dados jurídicos em Ajustes → Dados da empresa (ADR-85).

> **Ondas de auditoria (2026-07):** Onda 1 (responsável reatribuível, projeto CRUD, autocomplete) ✅ · Onda 2 (segurança + ficha-hub) ✅ · Onda 3 (robustez/UX: erro de query, 404, unificar componentes) e Onda 4 (limpeza de código morto + doc-drift) — em andamento.

---

## Evolução pós-MVP (entregue, 2026-07) ✅

Além do polimento acima, o produto ganhou blocos inteiros depois do MVP. Todos testados ao vivo (Playwright) e com `pnpm typecheck` verde.

- **E-mail dentro da aplicação — Bloco 1: plugar e ler (ADR-95, 2026-08):** cada pessoa pluga a própria caixa IMAP em **`/email`** (senha do webmail, testada antes de gravar e guardada cifrada por `EMAIL_CRYPTO_KEY`) e lê sem sair do Workspace — 3 colunas, corpo em `iframe sandbox=""`, imagem remota bloqueada. **Índice + cache** (corpo só ao abrir; busca por `ESEARCH` no servidor); sincronização incremental por `QRESYNC`/`CONDSTORE`; **sem `IDLE`** (o lsnode derruba o Node ocioso — mesma causa do ADR-84). Regra: **a caixa é privada, a correspondência com o cliente é da empresa**. Só `@medconsultoria.com.br` nesta fase.
- **E-mail dentro da aplicação — Bloco 2, fase 2A: escrever, responder, encaminhar, anexar, rascunho (ADR-96, 2026-08):** `/email` passou a **enviar** por SMTP real da caixa da pessoa — escrever do zero, responder, responder a todos, encaminhar (preenche `References`, não marca `\Answered` — encaminhar não é responder) e anexar (subir até 20 MB por arquivo/25 MB somados por envio, anexos novos e do original no mesmo teto; **o anexo recebido é um link que baixa** em stream com `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`, nunca renderiza — a rota existia desde o começo, mas só em 05/08 a tela passou a chamá-la). **Encaminhar leva os anexos do e-mail original** (o navegador manda só os ids; quem rebaixa do IMAP é o servidor). **Rascunho grava sozinho na pasta `Drafts` do servidor** a cada 5 s (reverte o ADR-95 §2: agora aparece no webmail e em qualquer outro cliente de e-mail), regravando por cima do anterior e apagando depois do envio. Assinatura entra só no servidor (nunca duplicada); a citação tem **duas versões**: a da **tela** sempre bloqueia imagem remota (para não disparar pixel de rastreio enquanto a pessoa ainda escreve) e a de **envio** só restaura imagem em **resposta** — quem recebe de volta é a mesma pessoa que mandou o original; **encaminhamento sai bloqueado**, porque quem recebe é um terceiro que nunca escolheu abrir aquele e-mail (ADR-96 §5). Nota honesta: como o corpo é gravado no banco já sanitizado com a imagem bloqueada, hoje nem na resposta há `src` para restaurar — o contrato existe para o dia em que o corpo chegar cru por outro caminho. Trava de destinatário fora de produção (`conferirDestinoPermitido`) recusa qualquer e-mail que não seja um dos dois de teste do dono, porque o SMTP é real em qualquer ambiente. **Falta o resto do Bloco 2:** e-mails na ficha do cliente.

- **Funil de vendas inteligente (ADR-14):** catálogo de `Servico` + `ServicoPasso` (playbook por etapa); checklist do lead (`LeadPasso`) semeado por etapa + serviços, com passos **automáticos** (derivados servicos/valor e de evento proposta/contrato enviado/assinado); geração de proposta/contrato do modelo a partir do passo; avanço por botão (obrigatórios) ou arrastar (registrado). `PipelineStage.chaveAuto` dá estabilidade à automação. Origens de lead viram catálogo editável (`Origem`).
- **Captação pública + Portal do prospect (ADR-15):** form `/comecar` (honeypot + rate-limit) com **detecção de origem** (UTM/referrer/ads e cadastro manual rastreado); recaptura deduplica. Acesso automático ao Portal (`garantirAcessoPortal`) — o prospect acompanha o atendimento (etapa traduzida, documentos para assinar) desde o 1º contato; continuidade na conversão.
- **Sistema de e-mails (ADR-16):** SMTP real + 14+ templates branded (logo por CID) **editáveis** em Comunicações (`EmailTemplate`); `notificar()` unifica notificação in-app + e-mail; **preferências por usuário** (opt-out, `PreferenciaEmail`); **histórico** de todo envio (`EmailEnviado`) na ficha do lead/cliente, no Portal e em Configurações.
- **Monitor de e-mails enviados (ADR-21):** página dedicada `/emails-enviados` (ROOT/ADMIN) — indicadores de entrega (enviados/falhas/taxa), aviso de SMTP desligado, filtros (status/tipo/período/busca) e o **motivo de cada falha** (`EmailEnviado.erro`) **sempre visível** (sem precisar expandir; fallback quando a falha é anterior ao registro do detalhe). Responde "mandou? falhou? por quê?".
- **Lista de Clientes reformulada:** de tabela crua para um CRM de verdade — KPIs da base (total/ativos/prospecção/Portais ativos), busca instantânea, **filtros por situação** (chips com contagem) e por responsável, **alternância cards ↔ tabela**, e cards ricos (situação, contato com ações rápidas e-mail/WhatsApp, nº de projetos, próxima reunião, selo de Portal ativo, responsável). Backend: `clientes.resumo` + `clientes.list` enriquecido (contagens filtradas + próxima reunião agregada, sem N+1).
- **Assinatura eletrônica (ADR-17):** assinatura avançada (Lei 14.063/2020) por link `/assinar/:token`, por desenho ou nome digitado, com hash de integridade e trilha de auditoria (`Assinatura`); assinar avança o funil.
- **Painel Sistema / observabilidade (ADR-18):** módulo `sistema` (ROOT) com saúde, métricas RED por rota, banco/migrações, sessões (revogáveis), atividade, uptime; captura automática de erros (`ErrorLog` por fingerprint) e `Incidente` com histerese/MTTR; e-mail ao ROOT.
- **Dashboard por papel:** 3 camadas (pessoal/gestão/sistema) — FUNCIONARIO vê o pessoal, ADMIN a gestão, ROOT tudo.
- **Funil ganho/perda + integrações (ADR-19):** **lead perdido** reversível (`perdidoEm`/`motivoPerda`, com motivo) → sai do board, entra no relatório; **taxa de conversão** (`funilResumo`); modal "Perdidos" com reabrir; conversão provisiona **Conta a Receber** (do valor estimado) e agenda **reunião de kickoff**; **origem comercial** (lead de origem) na ficha do cliente; selo de status de e-mail oculto no Portal.
- **Desistência/retomada pelo Portal (ADR-20):** o prospect pode **desistir** do atendimento pelo Portal (motivo opcional → vira lead perdido, avisa a equipe por notificação + e-mail `lead_desistiu`) e **retomar** depois (`lead_retomou`). Escopado ao `clienteId` da sessão.
- **Situação do cliente automática (ADR-22):** a situação comercial virou o **placar do funil** (`reconciliarSituacaoCliente` a cada evento; ATIVO nunca rebaixa — cliente nunca vira lead). Ficha mostra a situação só-leitura ("definida pelo funil" + "Ver no funil") + botão **"Nova oportunidade"** (`leads.novaOportunidade`) para upsell. `clientes.setSituacao` removido. Fix: `maxParamLength: 5000` no Fastify (batch tRPC da ficha dava 414).
- **Oportunidade inteligente + autosserviço no Portal (ADR-23):** a "Nova oportunidade" pergunta os **serviços** (o card e o checklist nascem com os passos de cada serviço); o cliente pode **escolher serviços no Portal** ("O que você precisa?") → vira/atualiza oportunidade no funil + avisa a equipe (`servico_solicitado`). `ServicosPicker` reutilizável. **+ Auditoria de integração das 3 páginas** (Dashboard/Funil/Clientes): Dashboard parou de contar leads perdidos; KPIs de Clientes invalidam ao criar; erros com fallback; `removeLead`/`removeCliente` reconciliam/evitam órfãos; selo "Portal" do funil fiel ao acesso real; invalidação cruzada Funil↔Clientes; link Lead→ficha.
- **Separar Funil × Clientes + Ativar/Desativar + confirmações (ADR-24):** a página **Clientes** passou a listar só clientes de verdade (**Ativo/Inativo**); prospects/perdidos ficam no **Funil** (filtros da página viram Todos/Ativos/Inativos, KPIs Total/Ativos/Inativos/Portal). Novo toggle **Ativar/Desativar** na ficha (`clientes.setAtivo`, `situacaoComercial` ganhou `INATIVO` — sem migração; ganhar no funil reativa). **Confirmação em todas as exclusões** (varredura: faltavam contato/passo do lead/item de checklist/passo de serviço).
- **Ficha "Negócios & serviços" + selo "No funil":** a ficha do cliente mostra o que ele **já tem** (serviços contratados, valor contratado, **cliente desde** via novo `Lead.convertidoEm`) e um destaque **"🎯 No funil agora — quer mais"** quando há oportunidade aberta (etapa + serviços + valor + Ver no funil). Os **cards/linhas de Clientes** ganharam um selo **"No funil"** (`listClientes.emFunil`) para bater o olho e saber quem tem negócio aberto.
- **Enviar acesso ao Portal pela página Clientes + upsell no Dashboard:** os cards/linhas/ficha de Clientes ganharam o botão **"Enviar acesso"** (`clientes.convidarPortal` → reusa `convidarUsuario`/`reenviarConvite`; mesmo `ConviteLinkDialog` do Funil) quando o cliente ainda não tem Portal ativo; a ficha mostra "Portal ativo" quando já tem (`getCliente.portalAtivo`). O **Dashboard (gestão)** ganhou o indicador **"Querendo mais (upsell)"** (`dashboard.clientes.querendoMais` = clientes com oportunidade aberta no funil).
- **Confirmação com escolha de e-mail — opt-in (ADR-25):** o diálogo `useConfirm` ganhou a variante `confirmar()` com **checkbox** (devolve `{ confirmado, marcado }`). Toda ação da equipe que mandaria e-mail ao cliente/lead vira um pop-up "Confirmar? ☑ enviar e-mail" e o back-end só envia se marcado: **criar cliente** (`createCliente(enviarAcessoPortal)`), **converter lead** (`convertLead(enviarEmail)` — com **aviso ⚠️ se o lead não tem serviço**), **solicitar assinatura** (`solicitar(avisarPorEmail)` — senão o link fica no painel "Abrir link"), **evento com cliente** (`createEvento(avisarCliente)` → template novo **`reuniao_agendada`**). Captação pública e o botão "Enviar acesso" seguem enviando direto. **Nudge de cliente sem serviço** na ficha (Acme): "Nenhum serviço registrado ainda" + "Registrar serviço →". Sem migração.
- **Refino das páginas (na ordem do menu) — em andamento:**
  - **Dashboard:** ações rápidas + "Seu dia com a IA" (ver ADR-30).
  - **Funil de vendas:** **busca** (nome/empresa/e-mail) + **filtro por responsável** (o board filtra; os KPIs seguem no total) + **estado vazio de onboarding** (funil sem leads → "Cadastre o primeiro lead ou compartilhe o link de captação"). A IA já estava no painel do lead (próximo passo / escrever e-mail). Testado ao vivo (busca "Hospital" → "1 de 2 leads").
  - **Clientes:** os cards e a tabela passaram a mostrar **quantos serviços contratados** cada cliente tem (`listClientes._count.servicosContratados` ATIVO), com um selo **"sem serviço"** (âmbar) para o cliente sem nenhum — sinal comercial acionável, integrado ao ClienteServico. **Ficha do cliente reestruturada** (`ClienteDetailPage`): saiu do `max-w-4xl` (~896px, espremida) para a largura padrão e ganhou um **layout profissional de 2 colunas** — cabeçalho em card (identidade + ações) e, abaixo, **coluna principal (2/3): Serviços contratados · Projetos · Documentos · Anotações · Suporte** + **barra lateral (1/3): Ficha (contato/observações) · Resumo comercial · Contatos · Compromissos · Financeiro · E-mails**. "Trabalho" à esquerda, "referência" à direita — organizado e fácil de operar no dia a dia. Testado (colunas 1005/491px, 11 cards, sem scroll horizontal). **Dois tipos de documento, agora separados e explicados:** card **"Documentos MedConsultoria"** (`Documento` — propostas/contratos/atas/briefings gerados pela equipe) × card **"Documentos do cliente"** (`Arquivo` — RG/CRM/comprovantes que o cliente envia pelo Portal **ou** a equipe anexa manualmente, com selo Cliente/Equipe, contexto do serviço, download e remoção). `listarArquivos` passou a trazer o nome do serviço/requisito. Testado ao vivo (upload manual → "Equipe · Geral"). A página já tinha KPIs, busca, filtros situação/responsável, cards↔tabela, "No funil", Portal e a ficha com IA ("Resumir"). Testado ao vivo (contagem bate com o banco; ficha agora com 1520px).
  - **Serviços (ADR-31):** a página estava confusa (5 ícones crípticos por card, ~60 botões). Agora cada card mostra nome + valor + descrição + **contadores clicáveis** ("N exigências · N passos", que abrem a aba certa) + **um** botão **"Configurar"** → diálogo de **abas Detalhes · Exigências · Passos** (`ServicoConfigDialog`, consolidando os 3 diálogos; Ativar/Desativar e Remover foram para a aba Detalhes). `listServicos` devolve `_count { requisitos, passos }`. **Novo 3º tipo de exigência — `INFORMACAO`** ("o cliente escreve na tela"): seletor de tipo em 3 botões explicados (📎 Documento · ✍️ Informação · 📝 Formulário); a Informação reaproveita o fluxo de briefing gerando um **`Formulario.interno`** de pergunta única (`TEXTO_LONGO`) — migração `formulario_interno`. Portal e ficha atendem `INFORMACAO` pela resposta enviada (como o briefing). Testado ao vivo: typecheck 5/5; criar/remover Informação cria/apaga o formulário interno (verificado no banco); catálogo de Formulários sem os internos; ficha mostra a Informação com selo próprio + "Aguardando o cliente preencher". **Conteúdo completo:** os **10 serviços** foram totalmente preenchidos com descrição comercial, **exigências** reais (mix Documento/Informação/Formulário) e **passos** distribuídos nas 4 etapas do funil (Qualificação→Proposta→Negociação→Fechado) — ~55 exigências e ~59 passos. O conteúdo virou fonte dos seeds (`CONTEUDO_SERVICOS`) e foi aplicado ao banco vivo por backfill idempotente. Testado ao vivo (10/10 serviços com contadores preenchidos; ex.: Tráfego pago 5 exig · 5 passos; abas Exigências/Passos renderizam com ícones por tipo e agrupamento por etapa). **Precificação flexível (ADR-33):** cada serviço tem valor fixo (avulso/mensal) e — só o **Faturamento** — % do faturamento do cliente (avulso/mensal); pode ser fixo, %, ou os dois juntos. Enum `PrecoRecorrencia` + migração `servico_precificacao`; `formatPreco` no card ("R$ 1.800,00/mês", "5% do faturamento/mês", "R$ 500,00 + 5% do faturamento/mês"); `PrecoFields` com `MoneyInput` + seletor Avulso/Mensal (o % só aparece p/ Faturamento, via `useWatch` da categoria). Recorrências semeadas por realidade (retainers mensais; projetos avulsos; Faturamento 5% mensal). Testado ao vivo (card, aparição condicional do %, persistência salvar/zerar). **Precificação em 3 camadas (ADR-33, etapas 1–3):** o serviço guarda só uma **cobrança padrão (sugestão)**; a cobrança de verdade (editável) vive na **ficha** (`ClienteServico` ganhou valor+recorrência+% herdados ao contratar, editáveis no card "Serviços contratados"), na **Proposta** (por item: valor+avulso/mensal+% e **total inteligente** separando 1x/mensal/%) e no **Financeiro** (a conversão provisiona conta única para avulsos + conta **recorrente** para mensais; selo "Mensal").
  - **Projetos:** a lista era uma tabela crua. Agora tem **KPIs** (Ativos/Pausados/Concluídos/Com atraso), **busca** (projeto/cliente), **filtros** (status em chips + responsável) e **cards↔tabela**. Cada projeto mostra **progresso** (cartões concluídos/total + barra), **atrasos** (cartões com prazo vencido), **entrega** (previsaoFim, vermelha se vencida), **próxima reunião** (integração Agenda via `Projeto.eventos`) e **link para a ficha do cliente**. `listProjetos` passou a incluir `cards {status,prazo}`, `cliente.id` e a próxima reunião. A **página de detalhe** ganhou uma barra de resumo (ficha do cliente + progresso + atrasos + entrega) acima do kanban. Testado ao vivo (KPIs, card com progresso/entrega/responsável, detalhe com resumo; typecheck 5/5, sem erros de console).
  - **SISTEMA com IA + RBAC + fix de erro oculto (ADR-43):** o painel **SISTEMA** (só ROOT/devs) ganhou **IA para detectar e corrigir** — botão **"Diagnóstico com IA"** (avaliação + causa-raiz + correções do sistema todo) e **"análise da IA"** em cada erro/incidente; mais **ações de correção** (resolver todos os erros/incidentes, rodar varredura sob demanda). **RBAC** confirmado e seguro: só ROOT vê SISTEMA; Admin faz o resto; hierarquia estrita na gestão de usuários (só ROOT gere ADMIN/ROOT; UI filtra papéis). **Fix:** erro "ocultado" com o olhinho não some mais para sempre — a aba Erros tem **Ativos ↔ Ocultos** e botão **Reexibir**. Testado ao vivo (Playwright): recuperar erro oculto, IA por erro e diagnóstico geral (OpenAI real), resolver todos. typecheck 5/5 + build OK.
  - **Foto de perfil / avatar (ADR-42):** cada usuário pode enviar uma **foto de perfil** nas Configurações (equipe = foto da pessoa) e no **Portal** (cliente/lead = foto **ou** logotipo da empresa/clínica). Só imagens (JPG/PNG/WebP, até 5 MB), gravadas em `avatars/{userId}/…` e servidas por `GET /avatar/:userId`. Componente reutilizável **`Avatar`** (foto com fallback para iniciais) usado **em toda a app** — sidebar, Usuários, Mensagens (avatar da conversa/autor; nos chamados aparece a foto/logo do cliente), pickers e Portal. Testado ao vivo (Playwright): upload → aparece em toda a plataforma; remover → volta às iniciais. typecheck 5/5 + build OK.
  - **Helpdesk de chamados + CRUD completo (ADR-41):** o suporte virou um **helpdesk de verdade** — cada chamado é um **ticket** com **protocolo #**, **assunto**, **status** (Aberto/Em andamento/Resolvido, com **reabrir** e **histórico**), **prioridade** e responsável; o cliente/lead pode ter **vários** ao longo do tempo, **abre chamados pelo Portal** (e reabre um resolvido só respondendo). A página Mensagens ganhou o que faltava: **apagar/editar** a própria mensagem (lápide + "editada"), **fixar/silenciar/arquivar/apagar** conversa (menu ⋮), **aba Arquivadas** e filtro **Histórico**. Ficha do cliente lista os chamados e leva ao Mensagens. Migração `chamado_helpdesk` (protocolo/prioridade/resolvido + flags por participante + edição de mensagem). typecheck 5/5; **self-test 17/17** + build do web OK.
  - **Mensagens unificadas + "sempre no ar" (ADR-40):** a página Mensagens virou um **WhatsApp interno** e o **Suporte do Cliente** deixou de ser um sistema à parte — agora é **a mesma conversa** (chamado `tipo=CLIENTE` com **assunto + status Aberto/Em andamento/Resolvido + responsável**), vista pela equipe (Mensagens e ficha) e pelo cliente/lead (Portal, mesma thread). Barra lateral com **busca** e **categorias** (Diretas · Grupos · Clientes · Leads), **grupos editáveis** (renomear, adicionar/remover membros, sair), diálogo de nova conversa com 3 modos (Pessoa/Grupo/Cliente-Lead) e painel de detalhes/configurações. Novo enum `ChamadoStatus` + campos em `Conversa` (migração `conversa_chamado`); histórico de `SuporteMensagem` migrado para `Mensagem`. **Infra:** `scripts/keep-alive.mjs` mantém a app no ar (auto-restart em caso de queda; modo pausa para migrações). typecheck 5/5; **self-test 16/16** + build do web OK.
  - **Agenda (ADR-39):** virou um calendário de verdade. **Dia e Semana** ganharam **grade de horários** (24h roláveis, eventos posicionados pelo horário e proporcionais à duração, colunas para sobreposição, faixa de dia inteiro, **linha vermelha do "agora"**) com **arrastar-para-reagendar** (vertical = hora, horizontal = dia; snap 15 min; só eventos não recorrentes). Acima: **KPIs** (Hoje · Próximos 7 dias · Próxima reunião · Aguardando confirmação), **filtros** (busca, escopo Empresa/Pessoal, tipo, responsável) e **Resumo por IA** (`ia.resumoAgenda`). O evento agora liga a **projeto** e a **participantes da equipe** (novo `EventoParticipante`), avisa **conflito de horário** ao agendar, mostra duração/recorrência/participantes e **link para a ficha do cliente**. **Lembretes:** o de 15 min alcança dono + participantes; novo lembrete por **e-mail ao cliente** na véspera (24h). Ao **remarcar**, re-avisa o cliente e zera a confirmação. **Portal:** cada reunião ganhou **"Adicionar à minha agenda" (.ics)** e **"Confirmar presença"** (avisa a equipe). Migração `evento_participantes_confirmacao` (+ `Evento.clienteConfirmadoEm`/`lembreteClienteEnviado`). typecheck 5/5; self-test de serviço 14/14 + build do web OK.
  - **Projetos — integração + automação (ADR-34/35/36/37/38):** kanban em **5 colunas** (A fazer · Em andamento · Aguardando cliente · Aguardando terceiros · Concluído), cartão **100% clicável/arrastável**, integração com o **Portal** ("O que depende de você" + "Seus projetos"). **Cartões automáticos por serviço:** contratar/converter um serviço cria o **projeto do serviço** com um cartão **"Entregas do cliente"** (checklist = exigências obrigatórias, marcam-se sozinhas quando o cliente entrega) **+ um cartão por tarefa do roteiro** (`Servico.roteiro`, editável na aba Roteiro do serviço); o **status anda sozinho** e concluir todos os cartões conclui o projeto. **Um projeto por serviço (ADR-38):** `Projeto.servicoId` (migração `projeto_servico`); os projetos passam a se chamar **`"<Serviço> — <Cliente>"`** (sem serviços → `"Projeto — <Cliente>"`), a conversão cria um projeto por serviço do lead (fim do "Onboarding" genérico + cartão de briefing órfão), e a lista ordena por **urgência** (atraso/entrega vencida primeiro). Testado ao vivo (converter lead com 2 serviços → 2 projetos nomeados, cada um com entregas + cartões do roteiro; typecheck 5/5).
- **Dashboard refinado — "entre e já saiba o que fazer" (ADR-30):** o Dashboard (já por papel: pessoal → gestão → sistema) ganhou **Ações rápidas** (atalhos de criação: lead/cliente/proposta/evento/projeto) logo no topo e o card **"Seu dia com a IA"** (`ia.resumoDoDia`) — um plano do dia priorizado gerado sob demanda a partir das pendências reais (tarefas atrasadas/hoje, agenda, e — p/ gestão — docs em revisão + contas vencidas). Somado à "Central de atenção" já existente. Testado ao vivo (plano gerado com base nas pendências).
- **IA em toda a aplicação — a IA sugere, você aprova (ADR-30):** novos pontos de IA (`ia.service`/`ia.router`, OpenAI): **Serviços** → "Sugerir com IA" (exigências), **Formulários** → "Sugerir perguntas", **Ficha** → "Resumir com IA" (resumo + próximos passos, dados reais), **Funil/lead** → "Próximo passo" e "Escrever e-mail". Componente reutilizável `AssistenteIADialog` (Copiar/Refazer) + painéis inline "+ Adicionar" para sugestões estruturadas (parsing tolerante de JSON). Botões só com `ia.disponivel`. Testado ao vivo: os 5 endpoints retornaram conteúdo coerente com a OpenAI real. Somado ao que já existia (documentos gerar/melhorar, resumir reunião, apresentação da proposta, busca Ctrl+K).
- **Documentos mais claro + Proposta inteligente (ADR-29):** cada aba (Documentos/Modelos/Formulários) ganhou uma linha explicando o que é; ações explícitas (**Nova proposta** em destaque, Novo documento, Resumir reunião). **`Servico.valor`** = preço de referência editável. **Proposta inteligente** (`documentos.criarProposta` + `PropostaBuilderDialog`): escolhe cliente + marca serviços (preço do catálogo, editável + quantidade) → **total automático** + tabela de serviços/preços no documento (RASCUNHO editável, tipo PROPOSTA). A **IA escreve a apresentação** (opcional). Testado ao vivo: proposta gerada com total R$ 7.500 + apresentação da IA (chave OpenAI funcionando).
- **Formulários/briefings online — Fase 1B (ADR-28):** `Formulario`+`FormularioCampo`+`FormularioResposta` (migração `formularios_online`). O cliente **preenche na tela** pelo Portal (`BriefingDialog`, rascunho/enviar) **ou baixa** (imprime/PDF). Construtor sem código na **aba Formulários da página Documentos** (`FormulariosPanel` — criar formulário + campos de 7 tipos, arrastáveis). O requisito `BRIEFING` de um serviço liga a um formulário (aba Exigências); atendido quando enviado. Equipe vê as respostas na ficha (`RespostaBriefingDialog`, + baixar). 3 briefings prontos (site, identidade visual, redes sociais). **Regra:** qualquer coisa sem upload é preenchível na tela, com download opcional. **Falta:** IA em mais pontos da app.
- **Catálogo real + biblioteca de documentos (ADR-27):** `Servico` ganhou `categoria`/`valor`; o catálogo foi reorganizado nos 5 pilares da Med (Gestão/Faturamento/Networking/Desenvolvimento/Marketing), **granular** e com **Dev×Marketing separados** (reconciliação preserva ids/vínculos; página Serviços agrupa por categoria). **13 modelos de documento reais** (proposta, contrato, escopo, ata, onboarding, checklist de credenciamento, briefings de site/identidade/redes, relatórios de faturamento/gerencial) — seed por nome (vários por tipo). Base: `brand/` (Apresentação) + medconsultoria.com.br.
- **Arraste-e-solte para ordenar (dnd-kit):** componente reutilizável `components/ui/sortable.tsx` (`SortableList`/`SortableItem`/`DragHandle`, otimista + persistência via `reordenar`). Aplicado onde há `ordem`: **catálogo de Serviços**, **Exigências** por serviço, **Passos** por etapa (reordena dentro do grupo) — além das **Origens** (que já tinham). Kanbans (Funil, Projetos) já moviam por arraste. Mutations novas: `servicos.reordenar/reordenarPassos/reordenarRequisitos`.
- **Serviços contratados + exigências + upload de documentos — Fase 1A (ADR-26):** `ClienteServico` (novo) vira a fonte da verdade dos serviços contratados — a equipe liga/desliga na **ficha** (card "Serviços contratados", com opt-in de e-mail), a conversão do funil gera (origem FUNIL + backfill), o **cliente cancela pelo Portal**. Cada serviço tem **exigências** (`ServicoRequisito`, checklist de documentos, com exemplos-semente editáveis na página Serviços). **Upload de arquivos** (novo): `@fastify/multipart` + pasta (`UPLOADS_DIR`), endpoints `POST /upload` e `GET /arquivos/:id` autenticados com **checagem de posse** (cliente só o próprio), allowlist de tipos + 20 MB + nome em disco por UUID. Portal: card **"Seus serviços"** (o que falta enviar + upload + cancelar). Avisos: `documento_cliente_enviado`, `servico_cancelado` (à equipe) e `servico_ativado` (ao cliente, opt-in). O antigo "Negócios & serviços" virou "Resumo comercial". **Falta (Fase 1B/2):** construtor de **briefings online** (o cliente responde na tela) + redesign da página Serviços (categorias, valores, separar Desenvolvimento × Marketing).

---

## Além do MVP (não agora)

Relatórios avançados do timer, dark mode, app mobile dedicado, integrações externas, storage S3, anexos/upload, menções no chat. Só depois que o núcleo estiver sólido e em uso.
