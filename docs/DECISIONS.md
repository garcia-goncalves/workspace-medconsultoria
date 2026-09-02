# DECISIONS.md — Architecture Decision Records

Registro das decisões arquiteturais importantes. Cada ADR: **Contexto → Opções → Decisão → Consequências**. Ao tomar uma nova decisão relevante, adicione um ADR (não edite os antigos; se um for revertido, marque como _Substituído por ADR-n_).

Status: ✅ Aceito · 🔄 Substituído · 💤 Proposto.

---

## ADR-1 — Monorepo com tRPC para type-safety ponta-a-ponta ✅

**Contexto:** app interno com um único cliente web (mais o Portal, também React). Prioridade em DX, produtividade e poucos bugs de contrato, com equipe pequena.

**Opções:**

- REST + OpenAPI (contrato explícito, mais boilerplate, tipos gerados).
- GraphQL (poderoso, mas overhead para um só cliente interno).
- **tRPC** (o front importa o tipo do router do back; zero geração de código).

**Decisão:** tRPC sobre Fastify, em monorepo pnpm+Turborepo, com `packages/shared` guardando schemas Zod e o tipo do `AppRouter`.

**Consequências:** erro de contrato vira erro de compilação; menos código. Acopla front e back (aceitável — é app interno). Exige monorepo. Se um dia houver cliente externo/terceiro consumindo a API, expõe-se um REST adaptador só para ele.

---

## ADR-2 — Monolito de um único processo Node ✅

**Contexto:** hospedagem DirectAdmin/TineHost espera um startup file único; equipe pequena; não há escala que justifique microserviços.

**Decisão:** um servidor Fastify serve, na mesma porta: API tRPC, SPA estático (`web/dist`), WebSocket (Socket.IO) e downloads autorizados. Deployável = `apps/api/dist/server.js`.

**Consequências:** deploy e operação simples; um só lugar para logs e restart. Escala vertical primeiro; se algum dia precisar separar (ex.: workers de IA), a fronteira de services já permite extrair.

---

## ADR-3 — Deploy por SSH + rsync (sem Git no servidor) ✅

**Contexto:** TineHost oferece **SSH mas não Git** no servidor (confirmado pelo usuário).

**Decisão:** build no CI/local (`pnpm build`) → `rsync -az` do artefato via SSH → no servidor `npm ci --omit=dev` + `prisma migrate deploy` + restart (Passenger `touch tmp/restart.txt` ou Nginx Unit). Encapsulado em `deploy.sh`; chave SSH como secret no GitHub Actions.

**Consequências:** deploy reproduzível sem depender de git-pull remoto. Precisa gerenciar chave SSH com cuidado. Migrations sempre com `migrate deploy` (nunca `dev`) em produção.

---

## ADR-4 — Sessão por cookie httpOnly (não JWT em localStorage) ✅

**Contexto:** app com dados sensíveis (PII de clientes, financeiro). JWT em localStorage é vulnerável a XSS.

**Decisão:** sessão server-side (tabela `Session`) referenciada por cookie **httpOnly, Secure, SameSite=Lax**, assinado. Senhas com **argon2id**. Authz sempre no procedure tRPC (default-deny); o front só esconde UI.

**Consequências:** revogação de sessão trivial; superfície de XSS reduzida. Exige proteção CSRF (mitigada por SameSite + checagem de origem em mutações). Estado de sessão no banco (custo mínimo).

---

## ADR-5 — IDs `cuid` não-sequenciais ✅

**Contexto:** IDs aparecem em URLs e no Portal do Cliente; sequenciais vazam volume e permitem enumeração.

**Decisão:** PKs `String @default(cuid())`.

**Consequências:** seguros em URLs, sem enumeração. Levemente maiores que int; irrelevante nesta escala.

---

## ADR-6 — IA arquitetada desde já, construída depois ✅

**Contexto:** o briefing quer IA no futuro (preencher documentos, resumir reuniões) mas manda resolver primeiro o núcleo.

**Decisão:** modelar `DocumentTemplate`/`Document`/`DocumentVersion` e uma interface `AiService` desde já. MVP (Fase 7) preenche por variáveis, sem IA. IA (Fase 9) só substitui o passo de geração do rascunho, atrás da interface. Provedor: **OpenAI (ChatGPT)** — escolhido por custo (a API do Claude saiu cara). A interface mantém o provedor trocável. **Aprovação humana obrigatória — a IA nunca envia documento sozinha.**

**Consequências:** nenhuma migration dolorosa quando a IA entrar; provedor trocável (`OPENAI_API_KEY` no `.env`). Custo/rede de IA fica para a Fase 9 (validar rede outbound na TineHost).

---

## ADR-7 — Chat adiado; notificações real-time cedo ✅

**Contexto:** Mensagens Internas está no MVP do briefing, mas chat completo (conversas/grupos/menções) adiciona complexidade upfront.

**Decisão:** montar a infra Socket.IO cedo (Fase 0) servindo **notificações** (Fase 3 em diante). O chat completo reusa essa infra na **Fase 6**.

**Consequências:** valor rápido (notificações) com menos risco; a mesma infra serve o chat depois sem retrabalho.

---

## ADR-8 — Idioma da stack e proibições ✅

**Contexto:** preferências e restrições do briefing.

**Decisão:** TypeScript em todo lugar; **.NET proibido**. Não construir agora: SaaS, multi-tenant, cobrança, marketplace, rede social, EAD, ERP genérico, integração WhatsApp, videoconferência própria.

**Consequências:** foco no problema real da MedConsultoria; menos superfície para manter.

---

## ADR-9 — Busca global interna + assistente de IA na mesma paleta ✅

**Contexto:** a Command Palette (Ctrl+K) só navegava entre áreas fixas do menu; faltava achar cliente/lead/projeto/documento por nome rapidamente. Havia também demanda por um jeito rápido de tirar dúvidas de uso do sistema sem sair da tela.

**Decisão:** módulo `busca` (`busca.global(termo)`, `funcionarioProcedure`) pesquisa clientes, leads, projetos e documentos (até 5 por tipo) e devolve resultados agrupados. Módulo `ia` (`ia.disponivel`, `ia.perguntar`) expõe um assistente de uso do sistema. Ambos plugam na **mesma paleta de busca**: modo padrão = resultados reais; modo "Perguntar à IA" = assistente, só visível quando `isAiEnabled`.

**Consequências:** uma única superfície de UI para achar dados e tirar dúvidas — sem nova tela. O assistente responde em PT-BR e **nunca executa ações**, apenas orienta; reduz risco de a IA tomar decisões sem supervisão.

---

## ADR-10 — Autocomplete (`Combobox`) como padrão de seleção de entidades ✅

**Contexto:** seletores de cliente em formulários (projeto, conta, evento, documento, resumir reunião, criação de acesso de Portal) usavam `<select>` simples — difícil de usar com a lista de clientes crescendo.

**Decisão:** componente reutilizável `Combobox` (`apps/web/src/components/ui/combobox.tsx`), com typeahead e navegação por teclado, substituindo o `<select>` nesses formulários.

**Consequências:** um só componente para manter e para o usuário aprender; escala bem conforme o volume de clientes cresce. Novos seletores de entidade devem usar o `Combobox`, não `<select>` cru.

---

## ADR-11 — RBAC de gestão de usuários por "menor privilégio" ✅

**Contexto:** o módulo `usuarios` (admin) cadastra equipe interna e cria acessos ao Portal. Sem uma regra clara, um ADMIN poderia promover/gerenciar outro ADMIN ou a si mesmo, abrindo brecha de escalonamento de privilégio.

**Decisão:** um usuário só pode atribuir/gerenciar papéis **estritamente abaixo** do seu próprio (ex.: só ROOT cria/gerencia ADMIN; um ADMIN não gerencia outro ADMIN, só FUNCIONARIO/CLIENTE). Ninguém altera o próprio papel nem se autodesativa. Sessões são revogadas ao desativar um usuário ou ao trocar a própria senha.

**Consequências:** reduz superfície de escalonamento de privilégio por default-deny na hierarquia de papéis. Exige checagem explícita de "papel alvo < papel do ator" no `usuarios.service`, além da authz padrão do procedure.

---

## ADR-12 — Notificações proativas e clicáveis ✅

**Contexto:** o sino listava só textos que não levavam a lugar nenhum e marcava tudo como lido ao abrir; as notificações se limitavam a lembretes de agenda. Faltava um sistema que ajudasse o usuário a **não esquecer nada**.

**Decisão:** (a) cada notificação guarda `entidadeTipo`/`entidadeId` e é **clicável** no front, navegando até o item e marcando-se como lida individualmente (abrir o sino não zera mais tudo). (b) Um **scan proativo** no servidor (`realtime/reminders.ts`, ~10 min) gera alertas **deduplicados** por entidade (`notificarUnica`): tarefas atrasadas (agrupadas por projeto, para o responsável), contas vencidas e documentos aguardando revisão (para admins) — além do lembrete de agenda que já existia. Push em tempo real via Socket.IO.

**Consequências:** o usuário recebe o que precisa de atenção sem varrer as telas; a deduplicação evita spam (um alerta por entidade). Novos tipos de alerta entram no mesmo scan. O scan roda no processo único (sem worker externo) — coerente com ADR-2.

---

## ADR-13 — Endurecimento de segurança (Helmet + rate-limit + throttle de login) ✅

**Contexto:** auditoria apontou ausência de headers de segurança e de qualquer proteção contra brute-force no login — riscos reais para um app com PII/financeiro indo a produção.

**Decisão:** registrar `@fastify/helmet` (headers anti-clickjacking/MIME-sniffing/referrer) e `@fastify/rate-limit` global (300 req/min por IP, folgado para o uso normal com batching). Além disso, um **throttle de login** em memória por `IP+e-mail` (8 falhas em 15 min bloqueiam temporariamente), coerente com o monolito de 1 processo (ADR-2). **CSP fica desativada** por ora — deve ser afinada e ligada no deploy, testando o SPA buildado (o polyfill de módulos do Vite exige ajuste de `script-src`).

**Consequências:** superfície de clickjacking/MIME e brute-force reduzida sem tocar no fluxo normal. O throttle em memória zera num restart (aceitável). CSP pendente é a única lacuna de header, registrada para o deploy.

---

## ADR-14 — Funil de vendas inteligente (playbook + passos automáticos) ✅

**Contexto:** o kanban de leads era só arrastar cards. Faltava guiar a equipe pelo que fazer em cada etapa, e o funil não refletia o estado real (serviços escolhidos, valor, propostas/contratos enviados/assinados).

**Decisão:** cada etapa tem uma `chaveAuto` estável e um **playbook** de passos; os serviços do lead (`Servico`/`ServicoPasso`) injetam passos por etapa. `LeadPasso.autoRegra` distingue passos **derivados** (servicos/valor — o sistema tica/destica, travado na UI) de passos de **evento** (proposta/contrato enviado/assinado — concluem sozinhos, mas ticáveis na mão). Passos com `acaoDoc` geram documentos do modelo. Avanço por botão (exige obrigatórios) ou arrastar (override registrado).

**Consequências:** o funil vira um checklist vivo e coerente com o estado do lead; menos decisão manual, menos esquecimento. Custa complexidade em `leads.service` (reconciliação idempotente), isolada e best-effort (nunca quebra o fluxo).

---

## ADR-15 — Captação pública + acesso automático ao Portal do prospect ✅

**Contexto:** leads chegavam por WhatsApp/e-mail e eram digitados na mão; o cliente só via o trabalho depois de virar cliente. Queríamos capturar do site e dar visibilidade desde o primeiro contato.

**Decisão:** form público `/comecar` (originalmente `/captura`, renomeado — "captura" assustava o lead; `publicProcedure`, honeypot + rate-limit) que detecta a origem (UTM/referrer/ads) e deduplica recaptura. Ao captar/convidar, `garantirAcessoPortal()` cria uma conta Cliente **PROSPECT** + acesso ao Portal de forma idempotente; o lead segue no funil (`Lead.clienteId`). O prospect acompanha o próprio atendimento no Portal; na conversão o acesso tem continuidade.

**Consequências:** o cliente se sente acompanhado desde o lead; menos digitação manual. Exige cuidado de isolamento (o prospect é CLIENTE com escopo por `clienteId`) e idempotência para não duplicar contas/e-mails.

---

## ADR-16 — E-mails transacionais unificados com as notificações ✅

**Contexto:** havia notificações in-app mas nenhum e-mail; e vários pontos poderiam divergir no texto/branding se cada um montasse o seu.

**Decisão:** um caminho único de envio (`enviarEmailTemplate`) com templates branded editáveis (`EmailTemplate`, logo por CID) e histórico persistido (`EmailEnviado`). `notificar()` é o ponto único que cria a notificação in-app **e** dispara o e-mail da mesma categoria, respeitando o opt-out por usuário (`PreferenciaEmail`). Categorias em `packages/shared`.

**Consequências:** um só texto/branding para manter; o usuário controla o que recebe por e-mail; todo envio fica auditável (lead/cliente/Portal/Comunicações). Envio é best-effort — falha de SMTP não quebra o fluxo de negócio.

---

## ADR-17 — Assinatura eletrônica avançada por link + hash de integridade ✅

**Contexto:** propostas/contratos precisavam de aceite formal do cliente sem contratar uma plataforma externa de assinatura.

**Decisão:** assinatura eletrônica **avançada** (Lei 14.063/2020) própria: `Assinatura` por signatário com `token @unique`, link público `/assinar/:token`, assinatura por desenho ou nome digitado, e **hash sha256 do conteúdo no envio** como prova de integridade. Trilha de auditoria (IP, user-agent, data/hora). Assinar avança o passo/etapa do funil.

**Consequências:** aceite formal sem dependência externa e sem custo por assinatura; prova de integridade e autoria razoável para o contexto. Não é assinatura **qualificada** (ICP-Brasil) — suficiente para o uso atual; migrar se algum contrato exigir.

---

## ADR-18 — Observabilidade embutida (ErrorLog + Incidentes + painel Sistema) ✅

**Contexto:** indo a produção num monolito único, precisávamos enxergar saúde, erros e desempenho sem contratar Sentry/Datadog.

**Decisão:** middleware `timed` coleta métricas **RED** por rota; exceções viram `ErrorLog` agrupado por `fingerprint` (issue-style, com `regrediu`/`ignorado`); um motor de alertas abre `Incidente` com histerese e MTTR. Tudo exposto no painel `sistema` (`rootProcedure`), com e-mail ao ROOT. Coerente com o monolito de 1 processo (ADR-2), sem worker/serviço externo.

**Consequências:** visibilidade operacional sem dependência externa nem custo. O custo é guardar erros/métricas no próprio MySQL (volume pequeno nesta escala). Se um dia precisar, a fronteira permite exportar para um APM externo.

---

## ADR-19 — Lead perdido + relatório de ganho/perda + integração da conversão ✅

**Contexto:** só dava para converter ou remover um lead — perder era indistinguível de deletar, sem motivo nem métrica. E a conversão não alimentava Financeiro/Agenda.

**Decisão:** perda **reversível** (`Lead.perdidoEm`/`motivoPerda`, com `marcarPerdido`/`reabrir`), leads perdidos saem do board mas entram no `funilResumo` (taxa de conversão). Perder um prospect rebaixa o Cliente ligado para PERDIDO só se ainda em prospecção. A conversão provisiona uma **Conta a Receber** do `valorEstimado` e agenda a **reunião de kickoff** (best-effort). Origem comercial (lead de origem) aparece na ficha do cliente.

**Consequências:** métrica de ganho/perda e menos digitação pós-fechamento. A conta a receber é **estimativa revisável** (não paga, marcada) — o financeiro confere antes; a data do kickoff é sugestão ajustável.

---

## ADR-20 — Livre-arbítrio do prospect: desistir/retomar pelo Portal ✅

**Contexto:** só a equipe marcava um lead como perdido. O próprio prospect não tinha como sinalizar que desistiu — ficava sendo trabalhado no funil sem querer, ou avisava por fora (WhatsApp/e-mail), gerando ruído.

**Decisão:** no Portal, enquanto há atendimento ativo, o prospect vê uma ação **discreta** "Não tenho mais interesse" (motivo **opcional** — ao contrário da perda interna, onde é obrigatório). Ao confirmar, o lead ligado à conta (escopo por `clienteId` da sessão, **nunca** um id vindo do cliente) vira **perdido** (`motivoPerda` = "Desistência pelo Portal — …"), o Cliente vai a PERDIDO se ainda em prospecção, e a **equipe é avisada** (`lead_desistiu`, notificação + e-mail — possível reconquista). Se já desistiu, o Portal oferece **"Quero retomar"** (`lead_retomou`), que reabre o lead no funil e avisa a equipe. Reusa `marcarPerdido`/`reabrir` (ADR-19).

**Consequências:** o cliente tem autonomia e a equipe recebe o sinal na hora, com histórico. Perder pela mão do cliente e pela mão da equipe convergem no mesmo estado (reversível). O motivo opcional evita atrito no Portal; a origem (`dados.origem = "portal"`) fica registrada para distinguir de uma perda marcada internamente.

---

## ADR-21 — Monitor de e-mails enviados (observabilidade de entrega) ✅

**Contexto:** cada envio já era registrado (`EmailEnviado`), mas o histórico só aparecia espalhado (ficha do lead/cliente, Portal, perfil). ROOT/ADMIN não tinham como responder "o sistema mandou? falhou? por quê? está bugado?" — e-mail era caixa-preta.

**Decisão:** uma **página dedicada** `/emails-enviados` (ADMIN+; escolhida em vez de uma aba dentro de Comunicações para não misturar monitoramento com edição de textos — o que já confundira antes). Mostra indicadores (enviados/falhas 7d, hoje, taxa de entrega), aviso claro quando o SMTP está desligado no ambiente (`isEmailReal`, para não confundir "modo dev" com bug), filtros (status/tipo/período/busca) e passa a **guardar o motivo da falha** (`EmailEnviado.erro`) para diagnóstico. Coerente com a observabilidade embutida do ADR-18 (sem APM externo).

**Consequências:** visibilidade operacional total sobre e-mail, com diagnóstico do porquê da falha. O motivo da falha também aparece nas visões internas por destinatário (não no Portal — o cliente não vê detalhe técnico). Pequena migração (1 campo + índice `[status, createdAt]`).

---

## ADR-22 — Situação do cliente = placar do funil (automática; cliente nunca vira lead) ✅

**Contexto:** a "Situação comercial" (PROSPECT/NEGOCIACAO/ATIVO/PERDIDO) era um dropdown manual na ficha que não conversava com o funil — dois lugares dizendo o estado da relação, podendo divergir. Pior: misturava _estágio do negócio_ (prospecção/negociação) com _status do relacionamento_ (cliente/perdido). O dono, corretamente, apontou a confusão: **"cliente não vira lead"**.

**Modelo mental correto:** **Lead = uma OPORTUNIDADE (negócio); Cliente = o cadastro (permanente).** Um cliente pode ter várias oportunidades ao longo do tempo. Um cliente **nunca** "vira lead"; o que existe é _abrir uma nova oportunidade para um cliente existente_ (upsell) — ele segue cliente.

**Decisão:** a Situação vira o **placar do funil** (fonte da verdade = funil), mantida automaticamente e **somente-leitura** na ficha:

- `reconciliarSituacaoCliente(clienteId)` recalcula a situação a partir das oportunidades do cliente e roda a cada evento de funil (mover/avançar etapa, converter, perder, reabrir, desistir/retomar pelo Portal, nova oportunidade).
- **Regra de ouro:** cliente **ATIVO nunca é rebaixado** — quem já é cliente (ganhou um negócio ou foi cadastrado direto) segue ATIVO mesmo com uma oportunidade nova aberta. Para quem ainda não é cliente: oportunidade aberta → NEGOCIACAO (se na etapa de negociação) senão PROSPECT; só perdida → PERDIDO.
- Botão **"Nova oportunidade"** na ficha (`leads.novaOportunidade`) abre um novo negócio no funil para um cliente existente, com confirmação que deixa claro: _o cliente continua cliente_.
- Removidos o `clientes.setSituacao` e o dropdown manual (não há mais como divergir).

**Consequências:** um só estado, sempre coerente, sem o usuário mexer na mão; a confusão "cliente virou lead" desaparece. Perde-se o ajuste manual do rótulo — aceitável, pois o funil é a verdade. Churn de cliente ATIVO (inativar) é um conceito separado, futuro. (Correção de borda: `maxParamLength: 5000` no Fastify — o batch tRPC da ficha passava de 100 chars no path e o find-my-way devolvia 414.)

---

## ADR-23 — Nova Oportunidade Inteligente (serviços) + Autosserviço no Portal ✅

**Contexto:** ao abrir uma "Nova oportunidade" para um cliente existente (ADR-22), o negócio nascia vazio — o sistema não sabia o que o cliente queria, então o card do funil e o checklist saíam sem os serviços. E não havia como o próprio cliente sinalizar o que precisa.

**Decisão:** a oportunidade passa a nascer sabendo **quais serviços** o cliente quer, por dois caminhos:

- **Interno (ficha do cliente):** o botão "Nova oportunidade" abre um diálogo que escolhe os **serviços** (+ valor/observação). `leads.novaOportunidade` conecta os `Servico`, e `criarOportunidadeParaCliente` semeia o checklist (`seedPassosSeVazio` + `reconciliarPassosAuto`) — o card e as tarefas já nascem com os passos de cada serviço, e o passo automático "Confirmar os serviços" já vem concluído.
- **Autosserviço (Portal):** nova seção "O que você precisa?" no Portal lista o catálogo (`servicos.publicos`) e o cliente escolhe o que precisa. `portal.solicitarServicos` → `solicitarServicosPeloCliente`: adiciona os serviços ao negócio aberto (dedup) **ou** abre uma nova oportunidade no funil, sincroniza o checklist, reconcilia a situação e **avisa a equipe** (`servico_solicitado`, notificação + e-mail). O Portal mostra o que já foi pedido (`resumo.servicosAtuais`).

Reaproveita o motor existente (serviços → checklist por etapa → tarefas → card de projeto por serviço na conversão). Componente `ServicosPicker` extraído (antes duplicado no cadastro de lead e na captação). **Escopo do Portal sempre por `ctx.clienteId`.**

**Consequências:** a oportunidade é útil desde o nascimento; o cliente vira gerador de demanda (upsell dirigido por ele) e a equipe recebe o pedido na hora, já como card no funil. Coerente com ADR-22 (cliente ATIVO segue ATIVO). Sem migração.

**Correções de integração (auditoria das 3 páginas) entregues junto:** Dashboard deixou de contar leads perdidos no funil (batia diferente de `/leads`); KPIs de Clientes invalidam ao criar; erros passam a ter fallback (resumo de clientes, modal "Perdidos"); `removeLead`/`removeCliente` reconciliam/evitam órfãos; selo "Portal" do card do funil ficou fiel ao acesso real (`listLeads.portalAtivo`); invalidação cruzada Funil↔Clientes; link Lead→ficha; rótulos do feed do Dashboard.

---

## ADR-24 — Separar Leads (Funil) de Clientes; cliente = Ativo/Inativo ✅

**Contexto:** a página Clientes listava TODO cadastro — inclusive **prospects** (leads que ganham uma conta Cliente para acesso ao Portal ainda ficam como PROSPECT/NEGOCIACAO). Isso trazia vocabulário de funil (filtros "Prospecção/Negociação/Perdidos") para dentro de Clientes e confundia: não dava para saber onde termina o Funil e começa o Clientes. E não havia como **ativar/desativar** um cliente (churn).

**Decisão:** separar de vez.

- **Funil de vendas** = todos os leads/prospects/oportunidades. Prospecção e Negociação são **etapas do funil**.
- **Clientes** = só quem já é cliente. Dois estados: **ATIVO** e **INATIVO** (toggle manual na ficha, com confirmação). `situacaoComercial` ganhou o valor `INATIVO` (campo String — sem migração). `listClientes`/`resumoClientes` filtram para `[ATIVO, INATIVO]`; os filtros da página viram **Todos/Ativos/Inativos**.
- **Integração:** ganhar no funil (converter) → vira Cliente **ATIVO** (aparece em Clientes). Da ficha, "Nova oportunidade" abre um negócio no Funil. Perder → fica nos "Perdidos" do Funil (não polui Clientes). `reconciliarSituacaoCliente` nunca mexe em ATIVO/INATIVO (cliente é gerido na mão); uma **vitória reativa** até um cliente inativo.
- **`clientes.setAtivo`** (novo) faz o toggle; só vale para clientes de verdade (bloqueia em prospects).

**Consequências:** cada página com um propósito claro ("Funil = namoro, Clientes = casamento"); menos confusão, mais praticidade. Um prospect com conta Cliente não aparece mais em Clientes — é gerido no Funil (sua ficha ainda é acessível via "Ver ficha do cliente" do painel do lead). Churn de cliente agora existe (Inativo), sem apagar o histórico.

**Confirmações em todo lugar (entregue junto):** varredura das ações destrutivas — todas as exclusões passam por um pop-up de confirmação (as que faltavam: contato do cliente, passo do lead, item de checklist, passo de serviço; as demais já tinham). Toggles rápidos (checkbox) seguem sem confirmação, para não atrapalhar a agilidade.

---

## ADR-25 — Confirmação com escolha de e-mail (opt-in) + cliente sem serviço (nudge) ✅

**Contexto:** vários fluxos disparavam e-mail ao cliente/lead **automaticamente**, sem a equipe escolher — cadastrar um cliente já mandava o acesso ao Portal; converter um lead já mandava boas-vindas; solicitar assinatura já enviava o link. A equipe queria **controle** ("sempre perguntar se quer enviar e-mail ou não"). Além disso, notou-se que um cliente (Acme Saude) estava sem **nenhum serviço contratado** — sintoma de que "serviços contratados" é derivado só dos leads ganhos, e um lead pode ser convertido sem serviço marcado.

**Decisão — padrão único de confirmação com checkbox:** o diálogo imperativo (`useConfirm`) ganhou uma variante `confirmar()` com um **checkbox opcional**, devolvendo `{ confirmado, marcado }`. Onde uma ação da equipe mandaria e-mail ao cliente/lead, abre-se um pop-up "Confirmar? ☑ enviar e-mail" e o back-end só envia se marcado. Aplicado a:

- **Criar cliente** (`clientes.create` → `createCliente(..., enviarAcessoPortal)`): pop-up ao salvar + checkbox "Enviar dados de acesso ao Portal por e-mail" (padrão marcado quando há e-mail).
- **Converter lead** (`leads.convert` → `convertLead(..., enviarEmail)`): pop-up + checkbox "Enviar boas-vindas e acesso ao Portal"; se o lead **não tem serviço**, o pop-up **avisa** (⚠️) que o cliente nascerá sem serviço contratado (não bloqueia — decisão do dono).
- **Solicitar assinatura** (`assinaturas.solicitar(..., avisarPorEmail)`): checkbox "Enviar o link por e-mail"; se não marcar, o link fica no painel do documento ("Abrir link") para envio manual.
- **Novo evento/reunião com cliente** (`agenda.create` → `createEvento(..., avisarCliente)`): quando o evento tem cliente vinculado, pop-up + checkbox "Avisar o cliente por e-mail" → template novo **`reuniao_agendada`** (transacional) com data/hora (fuso São Paulo) e link opcional.
- Envios que **são** a própria ação de enviar (botão "Enviar acesso" em Clientes/Funil) e a **captação pública** (o próprio lead se cadastra) seguem enviando — lá o envio é o objetivo/consentido.

**Cliente sem serviço (Acme) — avisar, sem bloquear:** na ficha, o card "Negócios & serviços" mostra um **nudge** quando não há serviço contratado ("Nenhum serviço registrado ainda — é incomum um cliente sem serviço") com atalho "Registrar serviço →" (abre Nova oportunidade). A conversão sem serviço avisa no pop-up. Não se cria campo manual de serviço: a fonte segue sendo o negócio ganho (coerente com ADR-22/23).

**Consequências:** a equipe decide, caso a caso, se o cliente é avisado por e-mail — fim dos envios automáticos silenciosos. `garantirAcessoPortal` continua **idempotente** (não reenvia se já há conta), então marcar o checkbox para quem já tem acesso é inócuo. Sem migração (só um template novo no registro). Regra de teste de e-mail: envios reais só para `tibamooca@gmail.com` ou `contato@medconsultoria.com.br`.

---

## ADR-26 — Serviços contratados por cliente + exigências (checklist de documentos) + upload de arquivos ✅ (Fase 1A)

**Contexto:** os "serviços contratados" eram derivados dos leads ganhos (não havia vínculo direto cliente↔serviço, nem como ligar/desligar por cliente). Cada serviço, na prática, exige coisas diferentes (credenciamento → documentos dos médicos; site → briefing) e o cliente precisava de um jeito de **enviar arquivos** — que a app não tinha (nenhuma infraestrutura de upload).

**Decisão (Fase 1A):**

- **`ClienteServico`** (novo) é a **fonte da verdade** dos serviços contratados: cliente + serviço + status (ATIVO/CANCELADO) + origem (MANUAL/FUNIL) + valor + datas + quem cancelou. Modelo **híbrido** de contratação: a **equipe liga/desliga direto** na ficha (origem MANUAL, com confirmação e opt-in de e-mail ao cliente); ganhar no funil gera as contratações (origem FUNIL, via `convertLead` + backfill dos já convertidos); o **cliente cancela** um serviço pelo Portal (avisa a equipe). A ficha mostra o catálogo com os contratados ligados.
- **`ServicoRequisito`** (novo): exigências por serviço (checklist), tipo **DOCUMENTO** (o cliente envia um arquivo) — o tipo **BRIEFING** (formulário online) fica para a Fase 1B. Editável pela Thaís na página Serviços (ícone de prancheta). A app **nasce com exemplos inteligentes** por serviço (`seedRequisitosSeVazio`, casados por palavra-chave), editáveis — a Thaís (que sabe os detalhes) ajusta em vez de criar do zero.
- **Upload de arquivos** (novo): `@fastify/multipart` + armazenamento **em pasta no servidor** (`UPLOADS_DIR`, default `storage/uploads`), fora do tRPC. Endpoint `POST /upload` (campos antes do arquivo) e `GET /arquivos/:id` (stream) — **autenticados por cookie**, com **checagem de posse** (CLIENTE só grava/baixa no próprio `clienteId`; equipe, qualquer um). Allowlist de tipos (PDF, imagem, Word, Excel), 20 MB, nome em disco por UUID (anti-traversal/colisão). `Arquivo` (novo) guarda só metadados + caminho relativo.
- **Notificações:** cliente enviou documento → responsável + gestão (notificação + e-mail `documento_cliente_enviado`); cliente cancelou serviço → `servico_cancelado`; equipe ativou serviço → e-mail opt-in ao cliente `servico_ativado`.
- **UX:** card **"Serviços contratados"** na ficha (toggle + checklist + arquivos + upload da equipe); card **"Seus serviços"** no Portal (contratados + o que falta enviar + upload + cancelar). O antigo "Negócios & serviços" virou **"Resumo comercial"** (desde quando é cliente, valor, no funil) — os serviços saíram de lá para o card autoritativo.

**Consequências:** a ficha e o Portal passam a refletir de verdade o que o cliente tem e o que falta ele enviar; a equipe recebe os documentos na hora. A app ganhou infraestrutura de arquivos (reutilizável). **Pendência de deploy:** na TineHost o `UPLOADS_DIR` precisa apontar para uma pasta **persistente** fora do diretório do rsync + entrar no backup. **Separar Desenvolvimento × Marketing** e o **redesign da página Serviços** (com categorias e valores) ficam para a **Fase 1B/2**, junto do **construtor de briefings online**.

---

## ADR-27 — Catálogo real de serviços (categorias + split Dev×Marketing + valor) e biblioteca de documentos ✅

**Contexto:** o catálogo tinha 4 serviços genéricos ("Desenvolvimento e Marketing" juntos) e só 4 modelos de documento. O dono pediu para refletir a oferta REAL da MedConsultoria (fonte: `brand/` — Apresentação oficial — + medconsultoria.com.br) e ter "todos os documentos possíveis", fáceis de criar/editar.

**Decisão:**

- **`Servico` ganhou `categoria` e `valor`** (migração `servico_categoria_valor`). O catálogo foi reorganizado nos **5 pilares/categorias** e os serviços ficaram **granulares**, separando **Desenvolvimento × Marketing**:
  - **Gestão** → Gestão Operacional
  - **Faturamento** → Faturamento
  - **Networking** → Credenciamento médico e odontológico · Negociação com operadoras
  - **Desenvolvimento** → Identidade visual (Branding) · Manual da marca · Desenvolvimento de site
  - **Marketing** → Gestão de redes sociais · Conteúdo & SEO · Tráfego pago (normas CFM)
  - A reconciliação **renomeou** os 2 serviços genéricos preservando ids/vínculos (leads, requisitos, contratações não se perdem) e adicionou os demais. A página Serviços agrupa por categoria (com reordenação por arraste dentro da categoria) e o serviço tem valor de referência editável.
- **Biblioteca de documentos** (`ModeloDocumento`): 13 modelos reais com `{{variáveis}}` — Proposta comercial, Proposta de credenciamento, Contrato, Escopo, Ata, Onboarding, Checklist de documentos (Credenciamento), Briefings (site, identidade visual/logo, redes sociais), Relatórios (faturamento/glosas, gerencial). O seed passou a semear **por NOME** (permite vários modelos por tipo; não recria os que o usuário apagou). A criação/edição já existia: novo documento a partir do modelo (preencher campos **ou gerar com IA**), editar, **melhorar com IA**, e a aba **Modelos** gerencia os templates.

**Consequências:** o app reflete a oferta real da Med; a equipe tem uma base ampla de documentos pronta e editável. Sem perda de dados (renome preserva vínculos). **Pendente (próximas levas):** **briefings online** (o cliente responde na tela — tipo `BRIEFING` já modelado) e **IA em mais pontos** da aplicação.

---

## ADR-28 — Formulários/briefings online (o cliente preenche na tela; ou baixa) ✅ (Fase 1B)

**Contexto:** o tipo `BRIEFING` de `ServicoRequisito` existia (ADR-26) mas não era funcional. O dono ampliou o pedido: **qualquer documento que não exija upload, o cliente deve conseguir preencher ONLINE (na tela)** — e ainda ter a opção de **baixar**. "Todas as opções possíveis."

**Decisão:** um sistema de **formulários online reutilizáveis** (migração `formularios_online`):

- **`Formulario`** (título + descrição) → **`FormularioCampo`** (pergunta com `tipo`: TEXTO_CURTO/TEXTO_LONGO/ESCOLHA/MULTIPLA/NUMERO/SIM_NAO/DATA, obrigatório, opções, ajuda, ordem). Reutilizável em vários serviços. `ServicoRequisito` ganhou `formularioId` (quando `tipo=BRIEFING`).
- **`FormularioResposta`** (por cliente + requisito; `respostas` JSON; status RASCUNHO|ENVIADO). O requisito BRIEFING fica **atendido** quando há resposta ENVIADA.
- **Cliente preenche online no Portal** (`BriefingDialog`): renderiza cada campo pelo tipo, salva **rascunho** ou **envia** (avisa a equipe), e tem o botão **Baixar** (imprime/gera PDF pelo navegador) — o cliente escolhe fazer na tela ou baixar.
- **Equipe vê as respostas na ficha** (`RespostaBriefingDialog`, só-leitura + baixar).
- **Construtor sem código** — a página **Documentos** ganhou a aba **Formulários** (`FormulariosPanel`, junto de Documentos e Modelos): cria/edita formulários e campos (com arraste para ordenar). A aba **Exigências** de um serviço permite marcar um item como **Briefing** e escolher o formulário. A app nasce com **3 briefings prontos** (site, identidade visual, redes sociais), ligados aos serviços correspondentes, editáveis. _(Decisão do dono: os formulários ficam em Documentos, não numa página à parte.)_

**Consequências:** o cliente resolve tudo pela tela (upload de arquivo OU preenchimento online), com download quando quiser. O onboarding de serviços como site/branding/redes vira autoexplicativo. Reaproveita o componente de arraste (ADR/DnD) e o padrão de notificação. **Pendente:** **IA em mais pontos** da aplicação.

---

## ADR-29 — Página Documentos mais clara + Proposta inteligente (serviços + preços) ✅

**Contexto:** o dono achou a página **Documentos confusa** ("o usuário não vai entender") e pediu **documentos inteligentes** — a proposta, por exemplo, deveria puxar **todos os serviços e preços** da Med para facilitar o preenchimento, tudo editável e o mais automático possível.

**Decisão:**

- **`Servico.valor`** vira o **preço de referência** de cada serviço (editável na ficha do serviço). `listServicosAtivos` passou a retornar `valor`.
- **Proposta inteligente** (`documentos.criarProposta`): um construtor (**"Nova proposta"** em Documentos) onde você escolhe o cliente e **marca os serviços** (o preço vem do catálogo e é **editável** ali, com quantidade); o **total é calculado sozinho**; o documento nasce com uma **tabela de serviços + preços + total** formatada, como RASCUNHO editável (ligado ao tipo PROPOSTA, então empurra o funil ao ser enviado). Opcionalmente, a **IA escreve a apresentação** (a partir do cliente + serviços).
- **Clareza da página**: cada aba (Documentos / Modelos / Formulários) ganhou uma **linha explicando o que é**; as ações ficaram explícitas (**Nova proposta** em destaque, **Novo documento** a partir de modelo, **Resumir reunião** com IA).

**Consequências:** a proposta deixa de ser digitada do zero — nasce dos serviços reais com preços, some a chance de esquecer valor/serviço, e a IA redige a abertura. A página comunica melhor o que é cada coisa. Preços iniciais são placeholders editáveis. Base para a próxima leva: **IA agressiva** nos demais pontos (Serviços/Formulários/Ficha/Funil).

---

## ADR-30 — IA em toda a aplicação (a IA sugere, o usuário aprova) ✅

**Contexto:** com a `OPENAI_API_KEY` configurada, o dono pediu IA "em todos os pontos onde fizer sentido", de forma agressiva, para deixar a app inteligente e fácil.

**Decisão:** expandir a camada de IA (`aiService` OpenAI gpt-4o-mini) com sugestões em pontos-chave, **todas no padrão "a IA propõe, você aprova"** (nada é aplicado/enviado sozinho). Novos métodos em `ia.service`/`ia.router` (`funcionarioProcedure`, gated por `isAiEnabled`):

- **Serviços → "Sugerir com IA"** (`sugerirRequisitos`): propõe o checklist de documentos de um serviço; cada sugestão tem um "+ Adicionar".
- **Formulários → "Sugerir perguntas"** (`sugerirCampos`): gera os campos de um briefing a partir do título; "+ Adicionar" por pergunta.
- **Ficha do cliente → "Resumir com IA"** (`resumirCliente`): resumo do cliente (serviços, situação, projetos, reuniões, oportunidades) + próximos passos, a partir de dados REAIS (não inventa).
- **Funil/lead → "Próximo passo" e "Escrever e-mail"** (`sugerirProximoPassoLead`, `escreverMensagem`): ação recomendada e rascunho de e-mail para o lead.
- Já existiam: geração/melhoria de documentos, resumir reunião (ata), apresentação da proposta (ADR-29) e a assistente de busca (Ctrl+K).
- **UI reutilizável:** `AssistenteIADialog` (roda a IA ao abrir, mostra o texto com Copiar/Refazer) para os resultados em texto; painéis inline com "+ Adicionar" para as sugestões estruturadas. Botões só aparecem quando `ia.disponivel`.

**Consequências:** a equipe ganha um copiloto em vários fluxos (menos digitação, menos página em branco), mantendo o controle humano. Cada clique é uma chamada real à OpenAI (custo por uso). Robustez: parsing tolerante de JSON (tira cercas/markdown) para as sugestões estruturadas. Testado ao vivo: os 5 endpoints retornaram conteúdo coerente com dados reais.

---

## ADR-31 — Página Serviços reformulada (1 botão "Configurar" com abas) + 3º tipo de exigência "Informação" ✅

**Contexto:** o dono achou a página Serviços confusa ("muito botão") — cada card tinha 5 ícones crípticos (ativar, exigências, passos, editar, remover; só tooltip), ~60 botões na página. E o diálogo de Exigências só tinha 2 tipos (Documento e Briefing), mas o cliente às vezes precisa só **mandar uma informação escrita** (sem anexar arquivo nem um formulário inteiro). A página "é usada em vários lugares; precisa ser inteligente, integrada e elegante, fácil de entender e mexer".

**Decisão:**

- **Card limpo:** cada serviço mostra nome + valor + descrição + **contadores clicáveis** ("N exigências · N passos", que abrem a aba certa) + **um** botão **"Configurar"**. Fim dos 5 ícones. `listServicos` passou a devolver `_count { requisitos, passos }`.
- **Diálogo único com abas** (`ServicoConfigDialog`): **Detalhes · Exigências · Passos**, consolidando os 3 diálogos antigos. Ativar/Desativar e Remover moraram para dentro da aba **Detalhes** (não poluem o card). Novo serviço continua num diálogo enxuto de criação.
- **3º tipo de exigência — `INFORMACAO`** ("Informação: o cliente escreve uma resposta na tela"): o seletor de tipo virou 3 botões explicados (📎 Documento · ✍️ Informação · 📝 Formulário). Uma exigência `INFORMACAO` **reaproveita todo o fluxo de briefing**: ao criá-la, o back-end gera automaticamente um **formulário interno** (`Formulario.interno = true`) de **pergunta única** (`TEXTO_LONGO`) e liga o `formularioId` ao requisito. O cliente responde na tela pelo Portal (mesmo `BriefingDialog`); a equipe vê na ficha (mesmo `RespostaBriefingDialog`). Remover o requisito apaga o formulário interno junto. Formulários internos **não** aparecem no catálogo de Formulários (`listFormularios` filtra `interno: false`).
- **Atendimento (fulfillment):** DOCUMENTO exige arquivo enviado; **INFORMACAO e BRIEFING** exigem uma **resposta enviada** (`FormularioResposta.status = ENVIADO`). Regra unificada em `servicosDoCliente`.

**Consequências:** a página ficou muito mais limpa (1 ação por card em vez de 5) e o modelo de exigências cobre os 3 casos reais sem inventar tabela nova — `INFORMACAO` é "açúcar" sobre o formulário que já existia. Migração: `Formulario.interno Boolean @default(false)` (`formulario_interno`). Testado ao vivo: typecheck 5/5; criar/remover `INFORMACAO` cria/apaga o formulário interno (verificado no banco); catálogo continua sem os internos; a ficha mostra a Informação com selo próprio e "Aguardando o cliente preencher".

**Conteúdo completo dos 10 serviços (data):** os 10 serviços do catálogo foram totalmente preenchidos — descrição comercial (2 frases), **exigências** (mix real de Documento/Informação/Formulário) e **passos do funil** distribuídos nas 4 etapas (Qualificação → Proposta → Negociação → Fechado), pensados para a realidade de consultório/clínica (credenciamento, glosas, CFM, briefings etc.). O conteúdo canônico virou a fonte dos seeds (`CONTEUDO_SERVICOS` em `servicos.service.ts`, consumido por `seedIfEmpty` e `seedRequisitosSeVazio` — que agora também cria os formulários internos das exigências `INFORMACAO`); as exigências `BRIEFING` seguem semeadas junto com os formulários-modelo (`formularios.service`). O banco vivo foi preenchido por um backfill idempotente (casando por título/etapa, sem duplicar). Total: ~55 exigências e ~59 passos entre os serviços.

---

## ADR-32 — Formatação pt-BR centralizada (dinheiro, data/hora, telefone/CPF/CNPJ) ✅

**Contexto:** o dono notou que a página Serviços mostrava o valor sem formatação BRL (input `type="number"` cru, ex.: `1453.88` em vez de `R$ 1.453,88`) e pediu para revisar **toda a app** e padronizar tudo que é valor/data/telefone/documento. Auditoria (3 subagentes) revelou: (a) nenhum valor totalmente cru, mas **7 formatadores `brl` locais duplicados** + 2 `brlCompact` e **2 inputs de dinheiro em `type="number"`**; (b) **13 formatadores de data locais divergentes** (uns com ano, outros sem; risco de fuso — só o Sistema fixava `America/Sao_Paulo`) — porém já todos em pt-BR, sem ISO cru; (c) **7 exibições realmente cruas de telefone/CPF/CNPJ** (ex.: `11999990000`, `12345678000100`) em Clientes (lista + ficha).

**Decisão:** um ponto único por tipo, e todas as telas passam a importar dele.

- **Dinheiro:** `formatBRL` (já existia em `lib/masks`) para exibição + `MoneyInput` para entrada; novo `formatBRLCompact` (KPIs "R$ 1,5k"). Removidos os 7 `brl`/2 `brlCompact` locais; inputs de valor (Serviços × 2, Proposta) migrados para `MoneyInput`.
- **Data/hora:** novo `lib/format-date.ts` com `dataHora` (10/07/2026 14:39), `data` (10/07/2026), `dataCurta` (10/07), `hora` (14:39), `dataUTC` (date-only de vencimento/prazo, sem deslocar o dia) e `haQuanto` (tempo relativo) — **todas fixando o fuso `America/Sao_Paulo`** (elimina o risco de o horário depender do fuso do navegador). Os ~13 helpers locais foram removidos e substituídos; rótulos de calendário "por extenso" (dia-da-semana/mês) ficaram como estão.
- **Telefone/CPF/CNPJ:** exibições passam por `maskTelefone`/`maskCpfCnpj` (já existiam, só eram usados nos inputs). As 7 exibições cruas em `ClientesListPage`/`ClienteDetailPage` foram corrigidas.

**Consequências:** toda a app agora exibe R$ 1.234,56, dd/MM/yyyy HH:mm (em BRT), (11) 99999-0000 e 00.000.000/0000-00 de forma consistente, a partir de helpers únicos (menos duplicação, sem divergência futura). Sem migração de banco. Testado: typecheck 5/5 (monorepo) + ao vivo — Serviços (valor R$ 3.500,00 no input), ficha do cliente ((11) 99999-0000 / 12.345.678/0001-00), Financeiro/Dashboard (R$ e datas dd/MM/yyyy; tempo relativo "há 14 min"/"há 2 h"), nenhuma data ISO na tela.

---

## ADR-33 — Precificação flexível de serviços (valor fixo e/ou % do faturamento; avulso ou mensal) ✅

**Contexto:** o modelo tinha um único `Servico.valor` (fixo). O dono explicou que os serviços têm cenários variados: o **valor de referência pode ser 1x (avulso) ou recorrente (mensal)**; e o serviço de **Faturamento** pode ser cobrado como **% do faturamento do cliente** (sozinho, ou somado a um valor fixo) — a % também podendo ser avulsa ou mensal. Depois esclareceu: **só o Faturamento** tem a opção de %; os demais serviços só têm valor fixo (com recorrência).

**Decisão:** precificação em dois componentes independentes no `Servico`:

- **Valor fixo** — `valor Float?` + `valorRecorrencia PrecoRecorrencia @default(AVULSO)` (para TODOS os serviços). *(O tipo virou `Decimal(12,2)` na ADR-118.)*
- **% do faturamento** — `percentual Float?` (ex.: 5 = 5%) *(hoje `Decimal(12,2)` — ADR-118)* + `percentualRecorrencia PrecoRecorrencia @default(MENSAL)`. No **schema** o campo existe para qualquer serviço, mas na **UI a seção de % só aparece quando a categoria é "Faturamento"** (reativo, via `useWatch` da categoria).
- Novo enum `PrecoRecorrencia { AVULSO, MENSAL }` (distinto do `Recorrencia` da Agenda). Migração `servico_precificacao`.
- **Rótulo único** `formatPreco` (em `lib/masks`): monta "R$ 1.800,00/mês", "5% do faturamento/mês" ou "R$ 500,00 + 5% do faturamento/mês" — mostrado no card. Config: componente reutilizável `PrecoFields` (valor fixo com `MoneyInput` + seletor Avulso/Mensal; e, só p/ Faturamento, o % com seletor). Corrigido: limpar o valor grava `null` (permite alternar entre "% puro" e "fixo + %").
- **Recorrências semeadas** por realidade: Gestão Operacional e os de Marketing recorrentes (redes/conteúdo/tráfego) = **mensal**; projetos (site, identidade, manual, credenciamento, negociação) = **avulso**; **Faturamento = 5% mensal** (sem valor fixo por padrão).

**Consequências:** o catálogo cobre os cenários reais de cobrança da Med sem inventar tabela nova (2 pares campo+recorrência no próprio Servico). `listServicos`/`listServicosAtivos` expõem os novos campos; a Proposta trata `valor` nulo como 0 (Faturamento entra por valor digitado). A cobrança efetiva por % (aplicar 5% sobre o faturamento real de cada cliente) não é calculada aqui — isto é a **precificação de referência do catálogo**; billing por cliente fica para depois. Testado: typecheck 5/5 + ao vivo (card "5% do faturamento/mês" e "R$ 500,00 + 5% do faturamento/mês"; % aparece só no Faturamento; salvar/zerar persiste; migração aplicada e banco vivo backfillado).

**Refinamento (arquitetura em 3 camadas — decidido com o dono):** a recorrência avulso/mensal é uma **decisão comercial**, não um atributo do catálogo. Então: no **Serviço** ela vira só uma **"cobrança padrão" (sugestão)** que pré-preenche a proposta (rótulo e texto de UI ajustados; card e defaults inalterados); a escolha _de verdade_, editável, vive na **Proposta** (por item: valor + avulso/mensal + %) e nos **Serviços Contratados** do cliente (`ClienteServico`). O **%** é tratado como **sempre mensal** (removido o seletor de recorrência do % na UI; `percentualRecorrencia` fica MENSAL).

**Etapa 1 (feita) — `ClienteServico` ganhou a precificação:** `valorRecorrencia`/`percentual`/`percentualRecorrencia` (migração `cliente_servico_precificacao`), **herdados do `Servico` ao contratar** e **editáveis na ficha** (nova mutation `clientes.atualizarContratacao`; diálogo "Preço · <serviço>" no card "Serviços contratados", com % só no Faturamento). A ficha mostra o preço de cada contratado (`formatPreco` → "R$ 3.500,00/mês"). Contratações existentes backfilladas. Testado ao vivo (exibir, editar/persistir, herança ao contratar).

**Etapa 2 (feita) — Proposta com recorrência/% e total inteligente:** `criarPropostaSchema` (item) ganhou `recorrencia` (avulso/mensal) + `percentual`. No `PropostaBuilderDialog` cada serviço marcado pré-preenche valor/cobrança/% do catálogo e é editável (seletor avulso/mensal por item; campo % só no Faturamento). O **total inteligente** separa **À vista (1x)** de **Mensal (/mês)** e lista **% do faturamento** — em vez de somar tudo num número só. `criarProposta` reflete isso: cada linha mostra o preço com recorrência ("R$ 1.800,00/mês", "5% do faturamento/mês") e a seção **INVESTIMENTO** vem quebrada (À vista / Mensal / % por mês). Testado ao vivo (mix site avulso + redes mensal + Faturamento %: total e documento corretos).

**Etapa 3 (feita) — ligação com o Financeiro:** na conversão do lead (`convertLead`), (a) os serviços contratados passam a **herdar a precificação do serviço** (valor + recorrência + %) em vez de receberem o `valorEstimado` bruto; (b) o provisionamento financeiro deixou de ser uma conta única e virou **inteligente**: soma os fixos **MENSAIS** numa conta a receber **recorrente** ("Mensalidade — <cliente>", `recorrencia=MENSAL`) e os **AVULSOS** numa conta única ("Contrato (serviços avulsos) — <cliente>"); o **%** (Faturamento) não vira valor fixo (varia com o faturado) — fica registrado nas observações. Fallback ao `valorEstimado` quando os serviços não têm preço. `Conta.recorrencia` (que já existia) agora aparece como selo **"Mensal"** no Financeiro e na ficha (o `select` da ficha ganhou `recorrencia`). Testado ao vivo: converter um lead com Credenciamento (avulso R$1.500) + Redes (mensal R$1.800) gerou exatamente 2 contas (única + recorrente), com herança correta na ficha.

---

## ADR-34 — Projetos integrado ao Portal do cliente + automação de status ✅

**Contexto:** auditoria profunda (3 subagentes) mostrou o módulo Projetos maduro internamente (kanban, timer, checklist, comentários, participantes, onboarding automático, notificações, dashboard, busca, IA), mas com duas lacunas para "100% + inteligente": o **Portal do cliente** só mostrava nome/status/nº de tarefas dos projetos (sem progresso e sem o mais importante — o que o cliente precisa fazer), e o **status do projeto nunca mudava sozinho**.

**Decisão:**

- **Portal (projeção segura, nunca reusa `listProjetos`/`getProjeto` internos):** `portal.resumo` passou a devolver `projetos` com **progresso** (concluídos/total/%) + **previsão** + **próxima reunião**, e uma nova lista **`aguardandoVoce`** = cartões em `AGUARDANDO_CLIENTE` dos projetos do cliente (só `titulo`, `prazo`, nome do projeto). O `PortalHome` ganhou o card **"O que depende de você"** (destaque âmbar, com CTA para o Suporte) e a seção "Seus projetos" com barra de progresso. Nada interno vaza (sem responsável, participantes, timer, valores) — mesmo padrão de `servicosDoClientePortal`.
- **Automação (`cards.service.moveCard`):** ao mover um cartão, `reconciliarStatusProjeto` **auto-conclui** o projeto quando todos os cartões ficam em Concluído e **reabre** (volta a ATIVO) se algum sair de Concluído — registrado no histórico (`projeto.concluido`/`projeto.reaberto`). Concluir um cartão também **encerra as sessões de tempo (timer) abertas** dele. O `move` no front invalida `projetos.get/list` + `clientes.relacionados` para refletir na hora; o detalhe do projeto mostra a pílula de status.
- **Ficha do cliente:** a lista de projetos ganhou **barra de progresso** (concluídos/total), via `relacionadosCliente` expondo o status dos cartões.

**Consequências:** o cliente passa a acompanhar o andamento dos projetos e vê claramente o que depende dele (reduz idas e vindas); a equipe não precisa mudar o status do projeto na mão. Sem migração. **Deliberadamente fora do escopo de lançamento (melhorias futuras):** anexos em cartões, faturamento por horas/relatório de tempo, @menções em comentários, `Documento.projetoId` (campo órfão), templates/dependências de cartões, SLA das colunas "Aguardando". Testado ao vivo: automação de auto-conclusão/reabertura + parada de timer (via `moveCard` real); Portal do cliente (login real) mostrando "O que depende de você" + progresso; barra de progresso na ficha; typecheck 5/5.

---

## ADR-35 — Kanban mais claro (colunas/fluxo) + card 100% clicável/arrastável + auto-card por serviço contratado ✅

**Contexto:** feedback do dono na página Projetos: (1) o cartão só arrastava/abria pela alcinha de bolinhas (`GripVertical`); ele quer pegar/clicar em **qualquer lugar** do cartão; (2) os títulos das colunas eram confusos (`Inbox`, `A Fazer`, `Em andamento`, `Aguardando Cliente`, `Aguardando Operadora`) — "Aguardando Operadora" o mais confuso; pediu para eu **estudar e decidir** os melhores títulos e a lógica; (3) quer que, **ao contratar um serviço na ficha**, o sistema **crie automaticamente os cartões** do(s) serviço(s) no projeto.

**Decisão:**

- **Cartão inteiro = alça + clique:** o `KanbanCard` aplica `attributes`/`listeners` do dnd-kit e o `onClick` no **contêiner do card** (removida a alça). Como o `PointerSensor` usa `activationConstraint: { distance: 6 }`, um clique curto **abre** o cartão e um movimento **arrasta** — padrão Trello.
- **Colunas reformuladas (fluxo em etapas):** de 6 para **5** colunas claras — **A fazer** (uniu `Inbox`+`A Fazer`) · **Em andamento** · **Aguardando cliente** · **Aguardando terceiros** (renomeado de `Aguardando Operadora` — cobre operadora/órgão/externo, sem jargão) · **Concluído**. Enum `CardStatus` reduzido/renomeado (`A_FAZER, EM_ANDAMENTO, AGUARDANDO_CLIENTE, AGUARDANDO_TERCEIROS, CONCLUIDO`), default `A_FAZER`. Migração `card_status_workflow` (dados: `INBOX`→`A_FAZER`; sem linhas em `AGUARDANDO_OPERADORA`). `AGUARDANDO_CLIENTE` foi mantido (alimenta o Portal — ADR-34).
- **Automação (auto-card por serviço):** `garantirCardDoServicoContratado(clienteId, servicoNome, ator)` (projetos.service) é chamado por `ativarServicoCliente` — ao **contratar um serviço na ficha**, garante um projeto do cliente e cria um cartão "A fazer" com o nome do serviço (idempotente por título; reabre o projeto se estava concluído; cria o projeto se não existir). Complementa a automação de onboarding da conversão (que já cria um cartão por serviço).

**Consequências:** kanban muito mais fácil de operar e entender; o trabalho do cliente flui sozinho do "serviço contratado" para "cartão no projeto". Sem quebra: `Portal`/`Dashboard` seguem usando `AGUARDANDO_CLIENTE`. Testado ao vivo: 5 colunas novas renderizando; clique no corpo do cartão abre o painel; contratar "Faturamento" para um cliente criou o cartão "Faturamento" (A fazer) no projeto (idempotente); typecheck 5/5. Dados de teste restaurados.

---

## ADR-36 — Cartão de serviço com checklist automático (entregas do cliente + passos) e status que anda sozinho ✅

**Contexto:** o dono quer que, ao fechar o negócio/contratar um serviço, os cartões do projeto nasçam prontos **com o checklist do serviço**, e que **ações do cliente ou da equipe movam os cartões e marquem o checklist sozinhos** — automático e manual, "bem inteligente e integrado".

**Decisão:**

- **Modelo:** `Card.servicoId` (liga o cartão ao serviço de origem) e `ChecklistItem.requisitoId` (marca um item como **entrega do cliente**). Migração `card_servico_checklist_requisito`.
- **Checklist do cartão de serviço = entregas do cliente + passos:** ao gerar o cartão (na contratação `ativarServicoCliente` e na conversão `convertLead` — ambos via `garantirCardDoServicoContratado`→`criarCardDoServico`), o checklist recebe **as exigências obrigatórias do serviço** (itens do cliente, `requisitoId`, marcados conforme o que já foi entregue) **+ os passos configurados do serviço** (itens da equipe). No painel do cartão os itens do cliente aparecem com o selo **"cliente"** e são só-leitura.
- **Status automático (`reconciliarStatusCard`):** entrega de cliente pendente → **Aguardando cliente**; tudo feito → **Concluído**; algo feito → **Em andamento**; nada → **A fazer**. Nunca mexe em "Aguardando terceiros" (coluna manual). Concluir todos os cartões auto-conclui o projeto (`reconciliarStatusProjeto`, ADR-34, agora centralizado em `projetos.service`).
- **Gatilhos (automação):** o **cliente** entregar/desfazer uma exigência (upload de documento `registrarUpload`, resposta de informação/briefing `salvarResposta`, remoção `removerArquivo`) dispara `reconciliarCardsDoServico` → marca/desmarca os itens do cliente e move o cartão; a **equipe** marcar um item de passo (`toggleChecklist`) dispara `reconciliarStatusCard` → move o cartão. Itens ligados a exigência não são editáveis manualmente pela equipe (marcam-se sozinhos).

**Consequências:** o trabalho flui sozinho — contratou → cartões prontos com tudo que o serviço exige; o cliente entrega pelo Portal → itens marcam e o cartão sai de "Aguardando cliente"; a equipe executa os passos → o cartão fecha e o projeto conclui. Sem duplicação (idempotente por `servicoId`/título). Testado ao vivo ponta-a-ponta: contratar "Credenciamento" gerou o cartão com 13 itens (5 do cliente + 8 da equipe) em **Aguardando cliente**; cliente respondeu 1 exigência → item marcou sozinho; entregou o resto → cartão foi para **Em andamento**; equipe marcou os 8 passos → cartão **Concluído**. typecheck 5/5; dados de teste restaurados.

---

## ADR-37 — Roteiro do serviço: vários cartões por serviço, cada um com seu checklist ✅

**Contexto:** o dono (leigo) quer a página Projetos "a mais inteligente da atualidade": um serviço contratado pode virar **vários cartões** (tarefas) em etapas diferentes, e **cada cartão deve ter o checklist que faz sentido para aquela tarefa** — não um cartão único com tudo junto (como no ADR-36). Escolheu, entre as opções, "vários cartões + eu (assistente) monto os roteiros + editor para ajustar".

**Decisão:**

- **Modelo:** `Servico.roteiro Json?` — o roteiro de execução do serviço = lista de **tarefas**, cada uma com um **checklist**: `[{ titulo, itens: string[] }]`. Migração `servico_roteiro`. (Simples e sem tabelas novas; a config é um template, não precisa ser relacional.)
- **Roteiros dos 10 serviços** escritos (defaults inteligentes por serviço — ex.: Site = Planejamento · Design · Desenvolvimento · Publicação), aplicados ao banco vivo e ao seed do código (`ROTEIROS_SERVICO` em `servicos.service`).
- **Automação (`criarCardsDoServico`, substitui o card único do ADR-36):** ao contratar/converter um serviço, cria **1 cartão "Do cliente — <serviço>"** (checklist = exigências obrigatórias, marcam-se sozinhas — ADR-36) **+ 1 cartão por tarefa do roteiro** (checklist = itens da tarefa, a equipe marca). Fallback: sem roteiro e sem exigências → 1 cartão com o nome do serviço. Cada cartão tem `servicoId`; idempotente por serviço. Todo o restante da automação do ADR-36 continua (auto-check das entregas do cliente, auto-move por checklist, auto-conclusão do projeto).
- **UI:** o cartão do kanban mostra o **serviço** como subtítulo (desambigua tarefas de serviços diferentes com o mesmo nome).

**Consequências:** um serviço vira um mini-fluxo de trabalho (vários cartões, várias etapas, vários checklists), tudo automático ao contratar. Testado ao vivo: contratar "Desenvolvimento de site" criou **5 cartões** (Do cliente [Aguardando cliente] + Planejamento/Design/Desenvolvimento/Publicação [A fazer]), cada um com o checklist certo. typecheck 5/5; dados de teste restaurados.

**Parte 2 (feita) — editor de Roteiro:** nova aba **"Roteiro"** no `ServicoConfigDialog` (Detalhes · Roteiro · Exigências · Passos) — o admin cria/edita as **tarefas** (cada uma vira cartão) e o **checklist** de cada, com "+ Adicionar tarefa"/"+ Adicionar item" e remoção; salva o JSON via `servicos.setRoteiro` (adminProcedure, `setRoteiroSchema`). O card do serviço mostra o contador **"N tarefas"** (abre a aba Roteiro). A aba "Passos" continua sendo o checklist do **funil** (fase de venda); o "Roteiro" é a execução do **projeto** — conceitos distintos, com textos que explicam. Testado ao vivo (editar item + salvar persistiu no banco).

---

## ADR-38 — Um projeto por serviço contratado ("&lt;Serviço&gt; — &lt;Cliente&gt;") + lista de Projetos por urgência ✅

**Contexto:** ao contratar o serviço "Faturamento" do cliente TineHost, o projeto nasceu chamado **"Onboarding — TineHost"** (genérico) e a conversão do lead ainda criava um cartão "Briefing inicial e alinhamento" **sem checklist**. O dono pediu para **padronizar os nomes** dos projetos, entender qual projeto é de qual cliente/serviço, ver o que está **atrasado/prioritário** e eliminar cartões órfãos. Escolheu, entre as opções, **"Um projeto por serviço — '&lt;Serviço&gt; — &lt;Cliente&gt;'"**.

**Decisão:**

- **Modelo:** `Projeto.servicoId String?` + relação `Servico.projetos` (migração `projeto_servico`, `onDelete: SetNull`). Um projeto = **um serviço contratado** do cliente; nulo em projetos gerais/manuais.
- **`garantirCardDoServicoContratado` (projetos.service)** agora é **projeto-por-serviço**: procura o projeto por `clienteId + servicoId`; se não existe, cria **"&lt;Serviço&gt; — &lt;Cliente&gt;"** (com `servicoId`, herda o responsável do cliente), registra `projeto.criado` e semeia os cartões do roteiro (ADR-37). Idempotente. Retorna o `projetoId`.
- **Conversão de lead (`convertLead`)** deixou de criar o projeto "Onboarding" + o cartão "Briefing": agora faz um **loop pelos serviços do lead** criando um projeto por serviço; sem serviços → fallback **"Projeto — &lt;Cliente&gt;"** (geral, sem cartões prontos).
- **Ativar serviço na ficha (`ativarServicoCliente`)** usa a mesma função → cada serviço contratado avulso também ganha seu projeto nomeado.
- **Cartões mais limpos** (o serviço já está no nome do projeto): o cartão de entregas passou de "Do cliente — &lt;serviço&gt;" para **"Entregas do cliente"**; removido o subtítulo de serviço do `KanbanCard` (redundante — todo o quadro é o mesmo serviço).
- **Lista de Projetos por urgência:** `filtrados` (ProjetosListPage) ordena os projetos por **atraso/entrega vencida primeiro** (concluídos por último), somado à busca por projeto **ou cliente** e ao chip de status já existentes — para o usuário achar na hora o que é prioridade.

**Consequências:** os nomes ficam previsíveis e autoexplicativos ("Faturamento — TineHost"), sem cartões órfãos, e a lista destaca o que está atrasado. Corrigido o registro real do TineHost ("Onboarding — TineHost" → **"Faturamento — TineHost"** + `servicoId`, cartão de briefing órfão removido). Testado ao vivo: converter um lead com 2 serviços gerou **2 projetos** ("Gestão Operacional — …" e "Faturamento — …"), cada um com "Entregas do cliente" [Aguardando cliente] + um cartão por tarefa do roteiro (cada com seu checklist), pessoa preservada como contato principal (ADR do bug pessoa×empresa). typecheck 5/5; dados de teste removidos.

---

## ADR-39 — Agenda completa: grade de horários, arraste-reagenda, participantes, IA e Portal (.ics + confirmar) ✅

**Contexto:** o dono já gostava da Agenda (5 visões) e pediu "a melhor página possível — completa, inteligente e integrada, inclusive ao Portal". Auditoria (2 subagentes) achou lacunas: Dia/Semana eram listas (sem grade de horas nem noção de duração), sem arrastar, sem filtros, sem KPIs, sem IA; o form não expunha **projeto** (o banco já tinha `projetoId`) nem **participantes**; reagendar não re-avisava o cliente; o lembrete não cobria participantes; o Portal só listava reuniões. Escolha do dono: **grade de horários** + **"tudo que fizer sentido"**.

**Decisão (modelo):** `EventoParticipante` (join Evento×User, `@@unique([eventoId,userId])`) — membros da equipe além do dono; `Evento.clienteConfirmadoEm` (confirmação de presença pelo Portal) e `Evento.lembreteClienteEnviado` (lembrete por e-mail ao cliente). Migração `evento_participantes_confirmacao`.

**Backend:**

- `listEventos` — escopo agora **EMPRESA + dono + participante**; a ocorrência traz `projeto{id,nome}`, `cliente{id,nome}`, `dono{id,nome}`, `participantes[]`, `projetoId`, `clienteConfirmadoEm`.
- `createEvento`/`updateEvento` — aceitam `participanteIds` (substitui o conjunto); ao **reagendar** (mudou o início) zera `clienteConfirmadoEm` + rearma os dois lembretes e, com `avisarCliente`, reenvia o e-mail `reuniao_agendada` com o novo horário.
- `verificarConflitos` — sobreposição na agenda do usuário (usa a expansão de recorrência); alimenta o aviso do formulário.
- `confirmarPresencaCliente(eventoId, clienteId)` — escopado ao cliente da sessão; marca a confirmação e notifica o dono (`presenca_confirmada`).
- **Lembretes (`reminders.ts`):** o lembrete de 15 min agora avisa **dono + participantes**; novo loop `lembrarClientes` (30/30 min) envia `lembrete_reuniao_cliente` ao cliente nas reuniões das próximas 24h (não recorrentes, com e-mail). Recorrentes ficam de fora dos lembretes (flag booleana só serve a evento único) — documentado.
- **IA:** `ia.resumoAgenda(inicio, fim)` — resumo/preparo do dia ou da semana (mesmo padrão do "plano do dia").
- **Portal:** `portal.resumo.reunioes` passou a trazer `fim/local/descricao/clienteConfirmadoEm`; nova procedure `portal.confirmarReuniao`.
- **E-mails:** novos templates `lembrete_reuniao_cliente` (transacional) e `presenca_confirmada` (notificação, categoria em `EMAIL_CATEGORIAS`).

**Frontend:**

- **Grade de horários (Dia/Semana)** — `TimeGrid` com 24h roláveis (auto-rola às 7h), colunas por dia, blocos posicionados por horário e altura pela duração, layout de **colunas para sobreposição**, **faixa de dia inteiro**, **linha vermelha do "agora"**, clicar em faixa vazia cria evento no horário, e **arrastar o bloco reagenda** (vertical = hora, horizontal = dia na Semana; snap 15 min; só eventos não recorrentes; trava anti-clique-fantasma).
- **KPIs** (Hoje · Próximos 7 dias · Próxima reunião · Aguardando confirmação) + **filtros** (busca, escopo Empresa/Pessoal, tipo, responsável) + botão **Resumo IA**.
- **Form** ganhou **Projeto** (Combobox, prioriza os do cliente) e **Participantes** (pills da equipe), **aviso de conflito** em tempo real, e re-aviso ao cliente ao remarcar. Linha/chips mostram duração, projeto, **link à ficha do cliente**, ícone de recorrência, selo de confirmação e nº de participantes.
- **Portal:** cada reunião ganhou **"Adicionar à minha agenda"** (arquivo **.ics** gerado no navegador, Google/Apple/Outlook), **"Confirmar presença"** (→ "Presença confirmada") e o local.

**Consequências:** a Agenda vira um calendário de verdade (grade + arraste + agora), integrada a Clientes/Projetos/Portal e com IA. typecheck 5/5; **self-test** de serviço (14/14: escopo de participante, isolamento do pessoal, conflito, reset ao remarcar, confirmação com isolamento por cliente) e build do web OK; dados de teste (registros `*.local.test`) removidos. Observação de teste: o MCP do navegador caiu no meio (ao regenerar o Prisma), então a validação visual da grade/arraste ficou pendente de conferência ao vivo pelo dono.

---

## ADR-40 — Mensagens unificadas (chat + Suporte como chamado) + supervisor "sempre no ar" ✅

**Contexto:** o dono quis a página Mensagens completa e estilo WhatsApp — **as mesmas mensagens do Suporte do Cliente** (ticket/chamado), grupos editáveis, busca de pessoas, e tudo **separado por categorias** (chats, grupos, equipe, clientes, leads). Havia dois sistemas: chat interno (`Conversa`/`Mensagem`, só equipe) e suporte (`SuporteMensagem`, isolado por cliente). Também pediu que a app **nunca caia**.

**Decisão — dados:** o suporte deixou de ser um sistema à parte e virou uma **conversa `tipo=CLIENTE`** (uma por cliente), com os usuários do Portal do cliente + responsável + admins como participantes. `Conversa` ganhou **`assunto`**, **`status` (enum `ChamadoStatus`: ABERTO/EM_ANDAMENTO/RESOLVIDO)**, **`responsavelId`** e **`criadoPorId`** (admin do grupo); relações `cliente`/`responsavel`/`criadoPor`. Migração `conversa_chamado`. O histórico de `SuporteMensagem` foi migrado para `Mensagem` (a tabela antiga fica como backup). **Categoria** exibida (Diretas/Grupos/Clientes/Leads) é derivada: conversa CLIENTE cujo cliente tem **lead ativo no funil** → "Leads"; senão "Clientes" (o lead tem acesso ao Portal desde a captação — ADR-13/portal — então conversa de verdade, não thread interno).

**Decisão — backend (`mensagens.service`):** `getOrCreateChamadoDoCliente` (idempotente, garante participantes), `chamadoDoCliente`/`enviarNoChamado` (usados pelo **Portal e pela ficha da equipe** — mesma thread), gestão de grupo (`renomearGrupo`, `addParticipantes`, `removerParticipante`, `sairDaConversa` — só criador/admin gere), chamado (`iniciarChamado`, `setChamadoStatus/Responsavel/Assunto`), `getConversaInfo`, e `listConversas` enriquecido (categoria, status, assunto, não-lidas). `sendMensagem` faz push em tempo real para todos os participantes e, quando o **cliente** escreve num chamado, dispara a notificação `suporte` à equipe. Portal (`portal.suporte`) e ficha (`clientes.suporteList/Responder`) foram religados ao chamado unificado.

**Decisão — frontend:** `MensagensPage` reescrita (barra lateral com **busca** + **abas de categoria** com contagem, avatares por tipo, selo de status do chamado, não-lidas; thread com cabeçalho de status e botão de detalhes). `NovaConversaDialog` com 3 modos (**Pessoa · Grupo · Cliente/Lead**, com busca). `ConversaInfoDialog` novo (grupo: renomear/adicionar/remover/sair; chamado: assunto/status/responsável + link à ficha). `SuporteChat` (Portal e ficha) migrado para o novo formato.

**Decisão — "sempre no ar":** `scripts/keep-alive.mjs` — supervisor que sobe `pnpm dev` e o **re-sobe automaticamente** se cair (backoff anti-flap), roda destacado e sobrevive entre sessões; **modo pausa** (`scripts/.keepalive-pause`) para liberar o lock do Prisma em migrações. Persistência no reboot fica por conta de uma tarefa agendada no logon (comando pronto; exige o dono autorizar, pois o classificador bloqueia persistência não nomeada).

**Consequências:** um só sistema de conversas para equipe **e** clientes/leads; o suporte virou helpdesk com status/responsável; grupos gerenciáveis; e a app se auto-recupera. typecheck 5/5; **self-test 16/16** (gestão de grupo, categorização lead×cliente, Portal e equipe na mesma thread, isolamento do Portal contra grupos internos, status/responsável) + build do web OK; histórico de suporte migrado (Acme, 3 msgs); dados de teste removidos. **Obs.:** o MCP do navegador seguiu indisponível, então a validação visual da nova página ficou pendente de conferência ao vivo.

---

## ADR-41 — Mensagens: helpdesk de chamados (múltiplos tickets + histórico) + CRUD completo (apagar/editar) + recursos WhatsApp ✅

**Contexto:** a página Mensagens (ADR-40) unificou chat + suporte, mas faltava muita coisa: não dava para **apagar/editar** conversas ou mensagens, renomear grupo era pouco descoberto, e o suporte era **uma conversa por cliente** (não um helpdesk). O dono pediu a "melhor lógica de chamado/ticket": assunto, fechar após atendimento, histórico. Escolheu **helpdesk com histórico** + "tudo que fizer sentido".

**Decisão — modelo de ticket:** cada **chamado é um ticket próprio** (Conversa `tipo=CLIENTE`), e um cliente/lead pode ter **vários ao longo do tempo**. `Conversa` ganhou `numero` (protocolo sequencial global, começa em #1003), `prioridade` (enum `ChamadoPrioridade` BAIXA/NORMAL/ALTA), `resolvidoEm` e `deletedAt`. **Ciclo:** Aberto → Em andamento → **Resolvido** (= fechado/histórico, `resolvidoEm` setado; **reabrível**). Cliente que **responde um chamado resolvido pelo Portal reabre** automaticamente. Migração `chamado_helpdesk` + backfill de `numero` nos chamados existentes.

**Decisão — CRUD de conversa/mensagem:** `Mensagem` ganhou `editadoEm`; **editar** (só autor) e **apagar** (autor ou admin → vira lápide "mensagem apagada", conteúdo não vaza). `ConversaParticipante` ganhou `fixadoEm`/`silenciadoEm`/`arquivadoEm`/`ocultoEm` — **fixar** (topo), **silenciar**, **arquivar** (aba própria) e **apagar conversa** (grupo/chamado por admin = soft-delete p/ todos; direta = oculta só p/ você, reaparece se chegar mensagem). Renomear grupo + gerir membros continuam (só criador/admin).

**Decisão — backend:** `mensagens.service` reescrito: `criarChamado` (protocolo), `listChamadosDoCliente` (abertos + histórico), `resolverChamado`/`reabrirChamado`/`setChamadoPrioridade`, `editarMensagem`/`apagarMensagem`, `fixar`/`silenciar`/`arquivar`/`apagarConversa`, `listConversas` (fixadas no topo, arquivadas à parte, flags por usuário). **Portal** (`portal.suporte`) virou helpdesk: `listChamados`, `abrir` (assunto + 1ª mensagem, avisa a equipe), `mensagens(conversaId)` e `enviar(conversaId)` — todos escopados ao `clienteId` da sessão (isolamento testado). A **ficha** (`clientes.chamados`) lista os tickets do cliente e leva ao Mensagens (deep-link via `sessionStorage`).

**Decisão — frontend:** `MensagensPage` com **menu (⋮)** por conversa (fixar/silenciar/arquivar/apagar), **aba Arquivadas**, e **dois eixos de filtro separados**: categorias (Todas/Diretas/Grupos/Clientes/Leads = _quem_) numa linha e um segmentado **Ativas × Histórico** (_estado_ — Histórico mostra SÓ os chamados resolvidos, com contador). Cabeçalho do ticket com **Resolver/Reabrir** + status + prioridade + protocolo; **editar/apagar** a própria mensagem (hover) com selo "editada" e lápide. Resolver/reabrir faz **push em tempo real** aos participantes (equipe + Portal atualizam sozinhos). `NovaConversaDialog` abre chamado em 2 passos (cliente → assunto + prioridade). `ConversaInfoDialog` com prioridade + apagar. Novo `PortalSuporte` (lista de chamados + "Abrir chamado" + thread por ticket) substitui o chat único no Portal.

**Consequências:** um helpdesk de verdade (protocolo, prioridade, resolver/reabrir, histórico) integrado ao chat interno; e todas as ações que faltavam (apagar/editar/fixar/silenciar/arquivar). typecheck 5/5; **self-test 17/17** (protocolo sequencial, histórico, resolver/reabrir + reabertura automática pelo Portal, isolamento entre clientes, editar/apagar mensagem com lápide, fixar/silenciar/arquivar, apagar grupo) + build do web OK. **Obs.:** o MCP do navegador continuou indisponível (precisa `/mcp` para reconectar) — a validação **visual** ficou pendente; a lógica está toda coberta por self-test.

---

## ADR-42 — Foto de perfil (avatar) do usuário, exibida em toda a app ✅

**Contexto:** o dono quis que cada usuário tenha uma **foto de perfil** editável nas Configurações — para a **equipe da Med** é a foto da pessoa; para **cliente/lead** (Portal) pode ser a foto da pessoa **ou o logotipo** da empresa/clínica. A imagem deve aparecer em **todo lugar que fizer sentido**. O campo `User.avatarUrl` já existia no schema, mas não era usado.

**Decisão — armazenamento/serviço:** reaproveita o disco de uploads (`UPLOADS_DIR`). `salvarAvatar` grava em `avatars/{userId}/{uuid}{ext}` (só imagens JPG/PNG/WebP, até 5 MB) e `User.avatarUrl` guarda o caminho relativo. Duas rotas fora do tRPC (multipart): **`POST /avatar`** (troca a foto do usuário logado — equipe **ou** Portal — e apaga a anterior) e **`GET /avatar/:userId`** (serve a imagem, requer login, cache 5 min). Remoção via tRPC `auth.removerAvatar`. Sem migração (campo já existia).

**Decisão — front:** componente reutilizável **`Avatar`** (`components/ui/avatar.tsx`) — mostra a foto (`/avatar/:id?v=<hash>` p/ cache-bust) ou as **iniciais** como fallback; e **`AvatarUpload`** (prévia + enviar/trocar/remover). `avatarUrl` foi exposto nos endpoints que renderizam pessoas (`mensagens.listConversas`/`listMensagens`/`info`/`usuarios`, `usuarios.equipe`/lista). Exibido em: **Configurações** (upload, dica por papel), **sidebar/header**, **Usuários**, **Mensagens** (avatar da conversa — nas diretas a pessoa, nos chamados a foto/logo do cliente — e avatar do autor nos balões de grupo/chamado), **pickers/detalhes de conversa** e **Portal** (header + card "foto/logo" com dica própria). O Portal usa o mesmo `SessionUser.avatarUrl` (via `useAuth`).

**Consequências:** identidade visual em toda a plataforma, com fallback elegante para iniciais. Proxy do Vite ganhou `/avatar`. typecheck 5/5 + build OK; **testado ao vivo (Playwright):** upload nas Configurações → foto aparece no card, na sidebar e na lista de Usuários; "Remover" volta às iniciais.

---

## ADR-43 — IA no painel SISTEMA (dev/root) + RBAC alinhado + erros ocultáveis reversíveis ✅

**Contexto:** o dono pediu que os **devs (ROOT)** tenham tudo para manter o sistema 100% saudável — monitores + botões para analisar/corrigir qualquer problema + **IA para detectar e resolver**. Também: "Root e Admin fazem tudo; só ROOT vê SISTEMA" e gestão de usuários "inteligente e segura". Decisões: **hierarquia segura** (só ROOT gere ADMIN/ROOT) + **IA em tudo no SISTEMA**.

**RBAC (já estava alinhado — confirmado/polido):** `/sistema` é **root-only** de ponta a ponta (rota `minRole=ROOT` + `rootProcedure` + item de menu ROOT); demais páginas de gestão são **ADMIN+** (Admin e Root fazem tudo). Gestão de usuários já enforce a **hierarquia**: `assertPodeAtribuir` (backend) só permite atribuir papel **estritamente abaixo** do próprio; a UI (`UsuarioFormDialog`) já filtra os papéis oferecidos e desabilita papel/status do próprio usuário; `podeEditar`/`podeExcluir` escondem ações sobre pares/superiores. Ajuste: o texto do perfil em Configurações virou **role-aware** (admin/root veem link "gerencie em Usuários").

**IA do SISTEMA (novo):** `ia.diagnosticoSistema` (lê saúde+erros+incidentes+métricas+banco → avaliação, causa-raiz e correções passo a passo), `ia.explicarErro(id)` e `ia.explicarIncidente(id)` — todos **rootProcedure**, prompt técnico (`SYSTEM_TECNICO`). No front: botão **"Diagnóstico com IA"** no cabeçalho e **"análise da IA"** em cada erro/incidente (via `AssistenteIADialog`), só quando `ia.disponivel`.

**Ações de correção (novo):** `sistema.resolverTodosErros`/`resolverTodosIncidentes` (massa) + `rodarVarredura` (dispara `scanProativo` sob demanda) — botões no painel.

**Fix — erro ocultado "sumia para sempre":** o "ocultar" (olhinho) marcava `ignorado=true` e a lista filtrava `ignorado:false`, sem como rever/restaurar. Agora `sistema.erros({ocultos})` lista os ocultos e `sistema.reexibirErro` restaura (volta como ABERTO); a aba Erros ganhou o alternador **Ativos ↔ Ocultos** e o botão **Reexibir**; o tooltip do olhinho virou "Ocultar (fica em 'Ocultos', reversível)".

**Consequências:** os devs têm IA + ações para diagnosticar e corrigir qualquer problema, e nenhum erro se perde ao ocultar. typecheck 5/5 + build OK; **testado ao vivo (Playwright, ROOT):** ocultar→Ocultos→Reexibir recuperou o erro do dono; "análise da IA" e "Diagnóstico com IA" retornaram causa-raiz + correções reais (OpenAI); "Resolver todos" limpou o painel. **Nota:** os 3 erros que apareciam eram **obsoletos** (Prisma dessincronizado antes de uma regeneração — os campos `Lead.convertidoEm`/`PipelineStage.chaveAuto` já existem); resolvidos.

---

## ADR-44 — Padrão de layout "cabe na tela" (sem scroll de página) + modais mais largos ✅

**Contexto:** o dono quer que as páginas **caibam no viewport sem scroll de página** (ex.: Agenda em Mês/Ano rolava), independentemente do tamanho da tela, e que os **modais** parem de rolar tanto e sejam **menos estreitos**.

**Padrão adotado (frame-fits + scroll interno):** o shell já é full-height (`AppLayout`: `h-screen` → `main.flex-1`). As páginas que são "visão" ou "lista" passam a: **raiz `flex h-full flex-col`**, com cabeçalho/KPIs/filtros `shrink-0` e a **área de conteúdo `flex-1 min-h-0`** — que **preenche** (calendário) ou **rola por dentro** (listas longas). Isso elimina o scroll da página inteira e mantém filtros/KPIs sempre visíveis (padrão Gmail/Notion). O **Dashboard** segue rolável de propósito (é um resumo longo — "onde fizer sentido").

**Modais (`Modal`):** ganhou prop **`size`** (sm 448 / **md 576 = padrão** / lg 672 / xl 896) — o padrão subiu de `max-w-lg` (512) para `max-w-xl` (576), menos estreito; confirmações/prompts usam `size="sm"`. Mantém `max-h-[90vh]` com scroll interno só quando necessário. Formulários muito altos serão passados a **2 colunas** no rollout (reduz a altura → menos/zero scroll).

**Feito e testado ao vivo (Playwright, `mainScroll:0` em todas):** **Agenda** (Mês/Ano cabem 100%; grade do mês distribui as 6 semanas; ano em 6×2; Dia/Semana rolando por dentro), **Projetos**, **Clientes**, **Funil/Leads** (kanban: colunas preenchem a altura e rolam os cards por dentro no desktop), **Financeiro**, **Documentos** e **Usuários** — **7+ páginas sem scroll de página**. Modal global mais largo (576px). **Formulários altos → 2 colunas:** `EventoFormDialog` passou a `size="lg"` (672px) + link/local lado a lado → scroll interno caiu de 271px para 147px. Antes de tudo: **Prisma regenerado + reinício limpo**. typecheck 5/5 + build OK.

**2ª leva (testada ao vivo):** formulários altos mais largos/2-col — **LeadFormDialog** `lg` (672px, scroll interno 71px), **PropostaBuilderDialog** `xl` (896px, construtor), **ServicoConfigDialog** `lg` (abas), **NovoDocumentoDialog** (modelo+cliente 2-col), **FormulariosPanel/Perguntas** `lg`; `ClienteFormDialog` já era compacto (mantido). **Páginas de detalhe:** o **detalhe do projeto** (kanban) agora cabe (`mainScroll:0`; colunas preenchem a altura e rolam os cards por dentro); a **ficha do cliente** fica rolável de propósito (registro profundo com ~11 cards — como o Dashboard, "onde faz sentido"). typecheck 5/5 + build OK.

**5ª leva — DROPDOWNS flutuantes + responsividade mobile de todos os popups:** (a) **`Combobox` e `Autocomplete`** abriam o dropdown como filho `absolute` DENTRO do corpo do modal (`overflow-y-auto`) — ele expandia a área rolável e **fazia o card rolar** (ex.: "Responsável" em Novo cartão/Editar projeto). Agora o dropdown é renderizado em **portal (`createPortal` → `document.body`) com posição FIXA ancorada ao campo** via novo hook **`useAnchoredStyle`** (`components/ui/use-anchored-style.ts`): flutua por cima, escolhe abrir p/ cima ou baixo conforme o espaço, limita a altura ao espaço livre, reposiciona em scroll/resize, e o click-outside considera o painel do portal. Resultado: abrir o seletor **não empurra nem rola o modal** (verificado overflow=0 em desktop e mobile). (b) **Grids de pares de campos** dos diálogos: `grid grid-cols-2` → **`grid grid-cols-1 sm:grid-cols-2`** (14 diálogos) — **empilham no celular** (<640px) e pareiam em telas maiores; zero overflow horizontal a 390px. (c) **`GuiaTour` (o "?" do header):** virou **quadro de altura fixa** (`max-h-[92vh] flex flex-col`, header `shrink-0` `py-6 sm:py-8`, texto do passo `flex-1 overflow-y-auto`, dots+ações `shrink-0`) — cabe e rola por dentro em qualquer tela (testado a 380px). Modal do kit já era `w-full max-w-* max-h-[95vh]` (responsivo). typecheck 5/5 + build OK.

**4ª leva — ZERO scroll do card (compactar até caber):** o rodapé fixo resolveu o acesso aos botões, mas o dono quer que os cards de formulário **não rolem** — o form deve **caber inteiro**. Recipe de compactação aplicada e **medida ao vivo (Playwright, overflow do corpo = 0)**: (a) espaçamentos menores (`space-y-4`→`space-y-2.5/3`, campos `space-y-1.5`→`space-y-1`); (b) remoção de textos de ajuda verbosos (o rótulo já basta); (c) `Textarea` com `rows={2}`; (d) pareamento de campos em 2 colunas (ex.: no Evento, **Participantes | Descrição** lado a lado economiza uma linha inteira); (e) as **listas que crescem com dados** (pills de serviços do `ServicosPicker`, participantes) viram **caixa com borda + scroll interno próprio** (`max-h-[…] overflow-y-auto rounded-lg border` — o "scroll interno numa seção" que o dono elogiou, nunca o card inteiro). Globais: corpo do Modal `py-5`→`py-4` e `max-h` `90vh`→**`95vh`** (mais área útil em todos; zera o resíduo do Evento). **Verificado overflow=0 @768px** em: Novo/Editar lead, Novo evento, Novo cliente, Nova conta, Novo projeto, Novo documento, Nova proposta, Novo modelo, Convidar usuário, Nova oportunidade. **Popup de detalhe do cartão (`CardPanel`, não usa o `Modal`) — REDESENHADO em 2 colunas (Trello-style):** o card virou **quadro de altura fixa** (`flex max-h-[90vh] flex-col`, `max-w-4xl`) com cabeçalho fixo e **corpo em 2 colunas no desktop** (`lg:grid lg:grid-cols-[1.55fr_1fr] lg:grid-rows-1 lg:overflow-hidden` — o **`grid-rows-1`=`minmax(0,1fr)` é essencial** para a linha preencher a altura e as colunas esticarem). **Esquerda:** Descrição + Checklist (a LISTA de tarefas `flex-1 min-h-0 overflow-y-auto` rola por dentro; o campo "Novo item" fica fixo abaixo). **Direita:** Timer (fixo) + Comentários (campo de escrever fixo; o HISTÓRICO `flex-1 min-h-0 overflow-y-auto` rola por dentro). No mobile empilha e o corpo rola (`max-lg:max-h-[46vh]/[40vh]` nas listas). Resultado: **o card NUNCA rola** — só as listas, cada uma no seu espaço. Verificado ao vivo (cartão descartável com 37 tarefas reais + tela 768/600/450/380): card overflow=0 sempre, checklist e comentários rolando por dentro, "Novo item" e o timer/campo de comentar fixos. typecheck 5/5 + build OK.

**3ª leva — RODAPÉ FIXO nos modais (o que o dono realmente pediu):** apenas alargar/2-col não bastou — o incômodo era que os **botões de ação rolavam junto** com os campos (em tela baixa, era preciso rolar para achar "Salvar"). O `Modal` ganhou a prop **`footer?: ReactNode`**: agora renderiza **cabeçalho FIXO · corpo que rola por dentro (`min-h-0 flex-1 overflow-y-auto`) · rodapé FIXO (`shrink-0 border-t`)**. Os botões vão para `footer=` e ficam **sempre visíveis**; só os campos rolam — o mesmo "card fixo + scroll interno" dos roteiros de Serviços (elogiado pelo dono). Para forms, o `<form>` ganha um `id` e o botão de submit no rodapé usa o atributo HTML nativo **`form="<id>"`** (submete de fora do form). Diálogos sem `<form>` movem os botões `onClick` como estão. **Aplicado em ~20 diálogos** (Lead, Evento, Cliente, Conta, NovoDocumento, Proposta, ResumirReunião, Modelo, Formulário, NovaOportunidade, Projeto, Card, Participantes, Usuário, ExcluirUsuário, ConversaInfo, NovaConversa, Briefing, ServicosContratados/EditarPreço, PortalSuporte, ConviteLink, Novo serviço). **Deixados intactos** (já eram "frame fixo + scroll interno" próprio ou não têm barra de ação de rodapé): `ServicoConfigDialog` (abas), `CamposDialog`, `RespostaBriefingDialog`, `CategoriasDialog`, `OrigensDialog`, "Leads perdidos" (lista com `max-h-60vh`). **Testado ao vivo (Playwright, viewport 1280×680):** Lead/Evento/NovoDocumento com rodapé colado no fundo do card e sempre visível; o submit do rodapé dispara a validação do form (`form=` funciona). typecheck 5/5 + build OK.

---

## ADR-45 — Financeiro reformulado: carteiras Empresa × Pessoal + clareza + recorrência + lembretes ✅

**Contexto:** o Financeiro era só uma lista crua de contas. A principal usuária (Thaís, ADMIN/dona) é leiga, bagunçada e **mistura empresa com vida pessoal** — "nunca sabe o que precisa pagar ou receber". Objetivo: a página mais clara e automática do app.

**Decisões:**

1. **Carteiras (Empresa × Pessoal).** Novo enum Prisma `Escopo { EMPRESA PESSOAL }`; `Conta`/`Categoria` ganharam `escopo` + `donoId`. **EMPRESA** = livros da Med, compartilhada entre ADMIN/ROOT. **PESSOAL** = **privada por usuário** (`donoId`; só o dono vê — os devs NÃO veem a vida particular da Thaís). Seletor no topo **Empresa · Pessoal · Tudo**. `whereCarteira()` filtra (TUDO = empresa + a pessoal do próprio); toda mutação **re-checa posse** (`contaComPosse`/`categoriaComPosse` → FORBIDDEN se pessoal de outro). Categorias-semente separadas: empresa (Honorários/Aluguel/…) e pessoal (Casa/Mercado/Cartão/Saúde/… — semeadas por usuário no 1º acesso).
2. **"Precisa de você" (herói da página).** `contas.agendaFinanceira(carteira)` agrupa as pendentes em **Vencidas · Vence hoje · Esta semana**, a pagar (vermelho) e a receber (verde), com marcar-paga 1-clique; vazio = "Tudo em dia 🎉". Resolve o "nunca sei o que pagar/receber".
3. **Recorrência DE VERDADE.** O campo `Conta.recorrencia` existia mas nada o materializava. Agora: novo `recorrenteId` (âncora da série) + `recorrenciaAte`. Ao **marcar paga** uma recorrente, a **próxima ocorrência é criada sozinha** (`gerarProximaOcorrencia`, dedup por série+vencimento); + rede de segurança `garantirProximasRecorrencias()` no loop de lembretes (só materializa a partir da última QUITADA — não empilha pendentes). Sem cron (mesmo padrão `setInterval` do `reminders.ts`).
4. **Lembretes proativos.** `scanProativo()` (`reminders.ts`) ficou **scope-aware** (conta PESSOAL notifica **só o dono**; EMPRESA todos os admins) e ganhou alerta **"a vencer em ≤3 dias"** (novo tipo `conta_a_vencer` + categoria de e-mail com opt-out) além do "vencida".
5. **"Para onde vai o dinheiro" + KPIs por carteira.** `porCategoria()` (barras CSS de despesas/receitas do mês); KPIs (a receber/a pagar/saldo previsto/resultado) por carteira (em "Tudo", Empresa e Pessoal lado a lado — nunca somando bolsos diferentes). Dashboard passou a expor `aVencer7Receber` além de `aVencer7Pagar`.

**Segurança:** `adminProcedure` (ADMIN/ROOT). Carteira PESSOAL estritamente por `donoId` (default-deny; nunca confia em escopo/id do cliente). **Verificado ao vivo (Playwright):** recorrência gera a próxima ao marcar paga (11/07→11/08); conta pessoal aparece em Pessoal e **não** em Empresa; categorias por carteira; campo Cor do diálogo corrigido. Migração `conta_escopo_recorrencia_carteiras` (colunas nullable, não-destrutiva) via MODO PAUSA. typecheck 5/5 + build OK.

## ADR-46 — Reorganização do menu/IA para leigo (Dia a dia × Configuração) ✅

**Contexto:** o app cresceu e a principal usuária (Thaís, leiga) se perdia — menu grande com páginas parecidas, jargão e "não sei por onde começar". Alinhado com o dono por conversa + mockup clicável. Princípio: **separar "o que uso todo dia" de "o que configuro uma vez e o sistema usa sozinho".**

**Decisões (3 fases, feitas):**

1. **Menu em 2 grupos.** _Dia a dia:_ Início · Vendas · Clientes · Projetos · Agenda · Mensagens · Financeiro. _Configuração:_ **Ajustes** (ADMIN) · Sistema (ROOT). Nova página `/ajustes` (`features/ajustes/AjustesPage.tsx`) = hub que junta os painéis administrativos que saíram do menu (**Serviços, Documentos e modelos, Mensagens automáticas, Equipe e acessos, E-mails enviados**). Renomes (rótulo só; rotas iguais): Dashboard→**Início**, Funil de vendas→**Vendas**, Usuários→**Equipe e acessos**, Comunicações→**Mensagens automáticas**. `usePageTitle`/`EXTRA_TITLES` (prefixo) e `CommandPalette` alinhados.
2. **Documentos deixa de ser página do dia a dia.** A geração de **proposta/documento passa a acontecer na ficha do cliente** (`ClienteDetailPage`, card "Documentos MedConsultoria" com botões que abrem `PropostaBuilderDialog`/`NovoDocumentoDialog` com nova prop **`clienteFixo`** — cliente pré-escolhido, campo escondido). Modelos ficam em Ajustes. `/documentos` continua vivo (FUNCIONARIO, via Ajustes/busca).
3. **Fim do jargão em Serviços + bússola no Início.** Abas do `ServicoConfigDialog` reenquadradas por linha do tempo (mantendo as `chave`): **Detalhes · Para vender** (passos do funil) **· O cliente envia** (exigências) **· A equipe faz** (roteiro/tarefas); contadores idem. O **Início** ganhou uma **frase-resumo do dia** no cabeçalho ("{data} · N compromissos · N tarefas suas · N contas vencendo") somando-se ao "Precisa da sua atenção" e "Plano do dia com IA" que já eram a bússola.

**Verificado ao vivo (Playwright) em cada fase; typecheck+build OK.** A visão do dono de **documentos como formulários inteligentes/editáveis na tela** (proposta/contrato/briefing/ata, 1 modelo cada, IA, download/papel) fica registrada como projeto próprio futuro — a Fase 2 já deixou a base (documentos nascem no cliente).

## ADR-47 — Documentos bonitos: moldura da marca + Markdown + PDF WYSIWYG + catálogo + proposta digital ✅ (Fases A–C)

**Contexto:** os documentos da Med (proposta, contrato, briefing, ata, relatórios…) eram **texto puro** (`Documento.conteudo @db.Text`) exibido num `<pre>` cinza, e o "PDF/Word" era um stub que imprimia esse `<pre>`. O dono quer documentos **bonitos como os e-mails** (logo/cabeçalho/rodapé/cores da marca), **bem formatados** (títulos, tabelas de preço/calendário), com **preview**, **digitais + download**, e a proposta com **aceite/recusa online**. Decisões travadas: **moldura + texto rico (Markdown)**; aceite **Portal + link público**; **fundação bonita primeiro**.

**Insight-chave:** como o PDF já é impressão do navegador, uma **moldura branded única que serve tela E impressão** dá **PDF idêntico ao preview (WYSIWYG)**, sem engine de PDF no servidor — **resolve a pendência de exportação de PDF em hospedagem compartilhada**.

**Fase A — Fundação bonita (feita):**

1. **`DocumentoBranded`** (`apps/web/src/features/documentos/DocumentoBranded.tsx`): folha **A4 branded** — logo `/logo.png` + faixa verde + selo do tipo + nº/data/cliente + rodapé da marca; corpo **Markdown→HTML via `marked`** (nova dep no web; GFM p/ tabelas e checklists; **HTML bruto desligado + `sanitize()`** remove `script/style/iframe/on*/javascript:`). Tokens espelham `email-template.ts` (verde #30AD73, azuis #002463/#003591, Montserrat). Exporta `DocumentoBranded` (tela), `documentoBrandedHtml()`, `DOC_STYLES`, `renderMarkdown()`, **`imprimirDocumento()`** (janela `@page A4` + print = PDF WYSIWYG) e **`baixarWordDocumento()`** (.doc do mesmo HTML).
2. **`DocumentoDetailPage`**: `<pre>` → `DocumentoBranded` (leitura); **edição = Textarea Markdown + preview branded ao vivo lado a lado**; PDF/Word usam as funções branded. **`PortalDocumentoModal`** idem (o cliente vê bonito). Órfão `apps/web/src/lib/exportar.ts` **removido**.
3. **`documentos.service.ts`**: `criarProposta` emite **Markdown com tabela** (Serviços × Investimento); `render()` **escapa HTML nos valores** das `{{var}}` (dados do cliente nunca injetam HTML).

**Fase B — Catálogo completo (feita):**

- **5 novos `TipoModelo`** (enum Prisma + `documento.ts` + labels, migração `documentos_tipos_novos` via MODO PAUSA): **PAUTA_REUNIAO** (antes da reunião, ≠ ATA depois), **PAUTA_POSTAGEM** (calendário editorial em tabela), **RECIBO**, **DIAGNOSTICO**, **PLANO_ACAO** (13 tipos no total).
- **`modelos.service.ts:DEFAULTS` reescrito** com **18 modelos-semente em Markdown rico** (títulos, listas, tabelas): Proposta comercial, Proposta de credenciamento, Contrato, Escopo, Ata, Pauta de reunião, Onboarding, Checklist de credenciamento, Briefings (site/identidade/redes), Pauta de postagem (calendário), Relatórios (faturamento/glosas, gerencial mensal, desempenho de marketing), Diagnóstico, Plano de ação, Recibo — ancorados nos serviços reais da Med e nas normas do CFM.
- **Semeadura inteligente** (`listModelos`): cria os que faltam e **atualiza para Markdown os modelos-semente nunca editados** (`updatedAt ≈ createdAt`, janela 1,5 s) — **preserva edições da equipe**. Os novos tipos aparecem sozinhos no seletor (itera `TIPO_MODELO_LABEL`), sem precisar de atalhos por tipo na ficha.

**Segurança:** Markdown sem HTML bruto + `sanitize()` (XSS por construção); valores de `{{var}}` escapados. **Verificado ao vivo (Playwright):** 19 modelos listados com os 6 novos tipos; gerada uma **Pauta de postagem** → moldura linda com o calendário em tabela (cabeçalho azul-escuro) → doc de teste removido. typecheck 5/5 + build OK.

**Fase C — Proposta digital: aceite/recusa online (feita):**

- **Campos no `Documento`** (migração `proposta_aceite_online`, colunas nullable): `propostaToken @unique`, `propostaStatus` (PENDENTE|ACEITA|RECUSADA), `propostaHash` (sha256 no envio), `propostaSolicitadaEm/RespondidaEm/RespIp/MotivoRecusa`. Optou-se por **campos próprios** (não reusar `Assinatura`) — aceite é ação única, não multi-signatário.
- **Módulo `propostas`** (`apps/api/src/modules/propostas/*`, montado como `propostas`): `habilitar` (`funcionarioProcedure` — congela o hash, gera token, avança o funil p/ "proposta", opcionalmente e-mail ao cliente), `doDocumento` (status p/ o painel), `porToken`/`responder` (**`publicProcedure`** — link público). `responder` valida integridade (hash), é **idempotente**, grava IP/quando: **aceite** avança o funil p/ "negociação" + notifica a equipe (`proposta_aceita`); **recusa** grava o motivo + notifica (`proposta_recusada`). 3 templates novos (1 transacional ao cliente + 2 notificações) + 2 categorias opt-out.
- **Web:** página pública **`/proposta/{token}`** (`PropostaPublicaPage`, roteada no `App.tsx` antes do gate, como `/assinar/`) = moldura branded + botões grandes **Aceitar/Recusar** (recusa exige motivo); **`PropostaAceiteCard`** na `DocumentoDetailPage` (só p/ tipo PROPOSTA — habilitar/reenviar, copiar link, estado aceita/recusada+motivo, aviso de conteúdo alterado); **Portal** (`PortalHome`) mostra "Propostas para você" com link ao mesmo `/proposta/{token}` (resumo ganhou `propostas` pendentes por cliente).
- **Segurança:** token opaco (uuid) único; hash rejeita proposta alterada após o envio; `publicProcedure` só lê/age por token; auditoria ip/quando. **Verificado ao vivo (Playwright):** aceite → tela de sucesso + card "Aceita" + funil + **2 notificações** à equipe + IP `127.0.0.1`; recusa → botão bloqueado sem motivo + status RECUSADA + motivo salvo + 2 notificações. Dados de teste limpos. typecheck 5/5 + build OK.
- **Refino (feedback do dono):** (a) a **proposta não mostra mais "Solicitar assinatura"** — assinatura eletrônica é do contrato (e demais tipos); a proposta usa só aceite/recusa (`DocumentoDetailPage` renderiza `PropostaAceiteCard` **ou** `AssinaturasCard`, nunca os dois). (b) **Aceite em 2 passos** (evita clique acidental): "Aceitar proposta" abre uma confirmação ("Confirmar o aceite" → "Sim, aceitar proposta"); só o 2º clique registra. A recusa já tinha o passo do motivo.

## ADR-48 — Padronização visual: largura única · folha A4 · sem scroll · breadcrumbs · matriz de interação ✅

**Contexto:** o dono, testando, notou inconsistências e pediu que eu **decidisse como especialista** e refatorasse: (1) onde cada documento tem assinatura × aceite × nada; (2) páginas com larguras diferentes (a de documento abria estreita); (3) documentos em A4; (4) scroll desnecessário dentro do documento; (5) breadcrumbs em toda a app.

**Decisões:**

1. **Matriz de interação por documento** (`DOC_INTERACAO` em `packages/shared/src/schemas/documento.ts`): **assinatura** — **só o Contrato** (único vínculo jurídico formal, Lei 14.063/2020) · **aceite** (Proposta — concordância comercial, 1 clique) · **nenhum** (Escopo, relatórios, ata, pautas, diagnóstico, plano, onboarding, checklist, recibo, e **Briefing** que o cliente **preenche** online no Portal). A `DocumentoDetailPage` renderiza `AssinaturasCard`, `PropostaAceiteCard` ou nada conforme o tipo (sem modelo = nenhum). **Lógica escolhida:** _um ato por documento_ — proposta se aceita, contrato se assina, o resto se lê/entrega/preenche. O **Escopo é anexo** da proposta/contrato (o vínculo já vem pela proposta aceita + contrato assinado), então não tem assinatura própria — menos fricção/menos passos (alinha com "menos estresse pra Thaís"; se um dia precisar de um acordo avulso assinado, usa-se o tipo Contrato). Resolve também, de forma sistêmica, "Solicitar assinatura" aparecendo na proposta.
2. **Largura única:** o `AppLayout` já centraliza tudo em `max-w-[1600px]`; **nenhuma página impõe largura própria** na raiz. Removido o único fora do padrão (`mx-auto max-w-4xl` da `DocumentoDetailPage`). `max-w-*` internos (leitura, chat, folha do doc) permanecem.
3. **Folha A4 + sem scroll:** `DocumentoBranded` usa a **proporção A4** (`aspect-[210/297]`) numa **escala de tela confortável** (`max-w-[640px]`, não o A4 real de 794px — que ficava "gigante") — aparece **inteira por padrão** mesmo com pouco conteúdo e cresce quando há mais — com sombra de página, centralizada num canvas; a leitura perde o `max-h/overflow` próprio — rola a **página** (`<main>`). Editor mantém scroll independente (correto). **Impressão/PDF = A4 real** pelo `@page A4` de `imprimirDocumento` (independente da largura de tela; WYSIWYG do ADR-47).
4. **Breadcrumbs (`components/layout/Breadcrumbs.tsx`):** caminho no cabeçalho do shell (no lugar do `<h1>`), semântico/acessível (`nav[aria-label]`, `ol`, Home, chevron `aria-hidden`, `aria-current`), `hidden md:flex`. Trilha derivada da rota (`trailFor`, reaproveita os grupos do menu; páginas de Ajustes ganham o pai _Ajustes_); fichas publicam o nome do registro via `useDynamicCrumb(nome)` (contexto). `activeOptions={{ exact:true }}` nos Links evita o TanStack duplicar `aria-current`. `<title>` da aba acompanha a página.

**Verificado ao vivo (Playwright):** breadcrumb `Início / Clientes / Acme Saúde` e `Início / Ajustes / Documentos / {título}` (um só `aria-current`); doc em largura cheia com folha A4 (794px) centralizada e **sem scroll interno** (só o `<main>` rola); matriz — Proposta→aceite, Contrato→assinatura, Ata→nenhum. Dados de teste limpos. typecheck 5/5 + build OK.

## ADR-49 — Página Documentos: arquivo (dia a dia) × configuração (Ajustes) + Editar lapidado ✅

**Contexto:** o dono achou a página **Documentos** confusa — 3 abas de jargão parecido (**Documentos** = os já criados · **Modelos** = textos-base · **Formulários** = briefings) misturavam operacional com configuração. E o **Editar** de um documento estava cru (só um textarea + dica de Markdown).

**Decisões (alinhadas com o dono via mockup de opções):**

1. **Separar arquivo × configuração** (mesma lógica do menu, ADR-46 "dia a dia × configuração"):
   - **`/documentos` = o ARQUIVO** de todos os documentos gerados — **busca** (título/cliente) + **filtros** (cliente · tipo · status), tabela única. **Volta ao menu "Dia a dia"** (é consulta operacional — "cadê aquele contrato?"). A geração por cliente continua na ficha; os botões Novo documento/Nova proposta/Resumir reunião seguem aqui por conveniência.
   - **Modelos** → nova página **`/modelos`** (`ModelosPage`) e **Briefings/Formulários** → nova página **`/formularios`** (`FormulariosPage`), ambas **em Ajustes** (config, `RoleGuard ADMIN`). O card único "Documentos e modelos" do Ajustes virou **dois**: "Modelos de documento" e "Briefings e formulários". `AppLayout` (item Documentos no dia a dia + `EXTRA_TITLES`), `Breadcrumbs` (Documentos = seção; modelos/formularios = filhos de Ajustes) e `CommandPalette` alinhados.
2. **Editar lapidado** (`DocumentoEditor.tsx`, novo): editor 2 colunas — **barra de formatação** (negrito/itálico/título/listas/citação/link/tabela/divisória agindo sobre a seleção; atalhos Ctrl+B/I) + textarea à esquerda; **preview A4 ao vivo sem scroll próprio** à direita (rola a página). Barra Cancelar/Salvar e editor **`sticky`**; contador de palavras. Dá para formatar **sem saber Markdown**.

**Verificado ao vivo (Playwright):** Documentos no menu; busca + filtros (tipo=Proposta → só propostas); abas antigas removidas; `/modelos` (19 modelos) e `/formularios` abrindo por Ajustes com breadcrumb certo; Editar com barra aplicando negrito em 1 clique e preview sem scroll. typecheck 5/5 + build OK.

**Finalização dos modelos (a base, o dono pediu):** a página **Modelos** foi reorganizada por **finalidade** (Vender · Fechar · O cliente envia · Reunião · Entregar & relatar · Operacional), com um chip por card dizendo **o que o modelo faz** (Cliente assina/aceita/preenche · Leitura/entrega, derivado de `DOC_INTERACAO`). Cada modelo vira uma **página de detalhe** `/modelos/$id` (`ModeloDetailPage`, rota ADMIN) que **edita com a MESMA experiência do documento** — `DocumentoEditor` (barra de formatação + atalhos) + **preview A4 ao vivo**, com Nome/Tipo editáveis; no preview os `{{campos}}` viram rótulos legíveis (`[nome do cliente]`, "(aqui entram os serviços)"). Editar marca `editadoManualmente`. `modelos.get` novo; criar um modelo leva direto ao detalhe. Verificado ao vivo (grupos, chips, breadcrumb, barra+preview). Próximo: revisar o conteúdo dos 18 modelos com o dono → então fechar a página Documentos.

## ADR-50 — "Novo documento" inteligente (unifica proposta + reunião) + página proativa ✅

**Contexto:** três botões competiam ("Novo documento" genérico/cru, "Nova proposta" inteligente, "Resumir reunião" que só fazia o "depois" e confundia). O dono pediu **um** ponto de criação inteligente e ajuda de reunião **antes e depois** — e reforçou que eu devo **criticar e propor o melhor**, não só acatar.

**Decisões (alinhadas via perguntas):**

1. **"Novo documento" único e type-aware** (`NovoDocumentoDialog` reescrito; botão sem "+"): ao escolher o modelo, o formulário se adapta ao **tipo** —
   - **Proposta** → o construtor de serviços (catálogo com preço/qtd/recorrência/%, prazo, condições, total automático + IA na apresentação) — extraído em `PropostaServicosPicker`; absorve a antiga "Nova proposta".
   - **Ata** → colar anotações → IA resume em ata (absorve o "Resumir reunião"; áudio fica para a fase seguinte).
   - **Pauta de reunião** → IA gera a pauta + pontos a não esquecer usando o **contexto do cliente** (serviços contratados + etapa no funil) — novo `gerarPautaReuniao`.
   - **Demais** → preencher os campos do modelo **ou** gerar com IA.
   - **A reunião VIRA documento** (Pauta antes, Ata depois — tipos que já existem), então o "assistente de reunião" não é botão à parte: é escolher Pauta/Ata no Novo documento. Ata/Pauta passam a ser **categorizadas** (ligadas ao modelo do tipo). Removidos `PropostaBuilderDialog`/`ResumirReuniaoDialog`; a ficha do cliente também unificou em um "Novo documento".
2. **Página Documentos proativa:** faixa **"Precisa de atenção"** = **resumo compacto de contadores clicáveis** por motivo (aguardando aceite · aguardando assinatura · rascunhos parados) — **não vira lista** (tamanho fixo, não cresce com o volume); clicar filtra a tabela. **Estável:** o "rascunho parado" usa **`createdAt`** (>7 dias), não `updatedAt` — antes sumia ao trocar o status (updatedAt reseta). Chips por tipo (Todos · Propostas · Contratos) + busca + cliente. `listDocumentos` (select) traz `createdAt`/`propostaStatus`/`assinaturaSolicitadaEm`/`assinadoEm`.

3. **Modelos = a base (editáveis, sem engessar):** o dono pediu para alinhar o conteúdo de todos os modelos (ele corrige o que precisar). Fundações: (a) **`ModeloDocumento.editadoManualmente`** (migração) — a semente (`listModelos`) mantém os modelos-semente atualizados com a referência, mas **nunca** sobrescreve o que a equipe editou (`updateModelo` marca a flag); (b) o **construtor de proposta usa o CORPO do modelo escolhido como moldura** — `{{apresentacao}}` recebe a abertura e `{{servicos}}` a tabela+investimento (`criarProposta` recebe `modeloId`), então **Proposta comercial ≠ Proposta de credenciamento**. Método combinado: eu rascunho, o dono corrige. **Os 18 modelos foram revisados/reescritos** (todos prontos, editáveis): as 2 propostas (comercial + credenciamento c/ passo a passo e documentos), Contrato (Objeto/Obrigações/Confidencialidade-LGPD/Rescisão/Foro + assinatura) e Escopo; Ata e Pauta; Onboarding e Checklist de credenciamento (Portal); 3 Briefings; Pauta de postagem; 3 Relatórios; Diagnóstico; Plano de ação; Recibo. Campos `{{...}}` preenchíveis ou por IA; ao editar, `editadoManualmente` protege o modelo.

**Verificado ao vivo (Playwright):** Novo documento troca de modo por tipo (Proposta/Ata/Pauta/genérico) com o botão certo; **gerada uma Pauta real pela IA** (categorizada "Pauta de reunião", com OBJETIVO/TÓPICOS/pontos, sem card de assinatura); página com faixa de atenção (rascunho parado) + chips filtrando (Propostas 4, Rascunhos 3). Dados de teste limpos. typecheck 5/5 + build OK.

## ADR-51 — Situação COERENTE do documento + página Documentos definitiva + geração automática ✅

**Contexto:** o status dos documentos vivia em eixos separados e incoerentes — `StatusDocumento` (rascunho/revisão/aprovado/enviado) × `propostaStatus` (aceite) × assinatura — e cada tela mostrava um diferente (página/ficha = `d.status`; funil = assinado/aguardando; Portal = nada). A faixa de atenção era frágil (baseada em `updatedAt`) e a página estava crua. O dono pediu tudo coerente, integrado e automatizado.

**Decisões:**

1. **Situação única e coerente** (`situacaoDocumento()` em `packages/shared`): funde fluxo interno + aceite da proposta + assinatura numa só situação — **Rascunho · Em revisão · Aprovado · Enviado · Aguardando aceite · Aceita · Recusada · Aguardando assinatura · Assinado** (o desfecho com o cliente prevalece). Cada situação traz `variant` (cor) e `atencao` (REVISAR | AGUARDANDO_CLIENTE). **Fonte única usada em toda a app:** arquivo, detalhe do documento, e **ficha do cliente** (a query `relacionados` passou a trazer `propostaStatus/assinatura/tipo`). Removidos os `statusVar`/`docStatusVar` locais.
2. **Página Documentos definitiva:** tabela com 5 colunas (**Documento · Cliente · Tipo · Situação · Atualizado**); busca + filtros de **cliente, tipo e situação**; faixa **"Precisa de atenção" persistente** = contadores clicáveis por motivo (**para revisar** = Em revisão; **aguardando o cliente** = aceite/assinatura; **rascunhos parados** = `createdAt` > 7d). Persistente porque baseada em estados **estáveis** (não em `updatedAt`).
3. **Geração automática por evento → REVISÃO** (tudo integrado): ao mover um lead para **"Proposta"** gera uma **proposta** dos serviços do lead (`gerarPropostaAutoParaLead`); ao mover para **"Negociação"** OU **na conversão** gera um **contrato** (`gerarContratoAutoParaLead`, reusa `gerarParaLead`). Ambos **nascem EM_REVISÃO** (a equipe valida antes de enviar), ligam ao passo do funil e **notificam o responsável** (`documento_revisao`). Não duplicam (guard por `leadPasso`). Gancho `docsAoEntrarEtapa` em `moveLead`/`avancarEtapa` + `convertLead`, por **import dinâmico** (evita circular leads↔documentos); best-effort.
4. **Situação coerente integrada em TUDO:** além do arquivo/detalhe/ficha, o **funil** (painel do lead: o passo do documento mostra a situação coerente via `docSituacao` no `detalhe`) e o **Portal** (o cliente vê "Aceita"/"Assinado" nos seus documentos) usam a mesma `situacaoDocumento`.

**Verificado ao vivo (Playwright):** 5 colunas + situação coerente ("Aceita" no lugar de "Enviado"); faixa persistente (Em revisão → pill "1 para revisar" → filtra); **automação proposta** (mover lead p/ Proposta → "Proposta comercial" EM_REVISÃO com a tabela do serviço + notif); **automação contrato** (mover p/ Negociação → "Contrato de prestação" EM_REVISÃO com cláusulas + notif); **funil** mostra o passo do contrato como "Em revisão". typecheck 5/5 + build OK. Dados de teste limpos.

## ADR-52 — Briefing = formulário interativo, unificado dentro de Modelos ✅

**Contexto:** havia **dois sistemas paralelos** chamados "briefing": modelos de documento **tipo BRIEFING** (texto com `{{campos}}`, geram um documento) e o sistema de **formulários interativos** (`Formulario`/`FormularioCampo`, o cliente responde na tela) — este último numa página/rota separada (`/formularios`, card "Briefings e formulários" no Ajustes). O dono: **Briefing = o formulário interativo**, tudo **dentro de Modelos**, sem card separado.

**Decisões:**

1. **Briefing = formulário interativo.** Removidos os 3 modelos de texto tipo BRIEFING das `DEFAULTS` (`modelos.service`) e **desativados** os existentes na semente (`updateMany BRIEFING ativo=false` para os não-editados). Os briefings passam a ser os `Formulario` já semeados (site/identidade/redes, com campos TEXTO/ESCOLHA/MÚLTIPLA/SIM_NÃO/NÚMERO/DATA).
2. **Construtor dentro de Modelos.** `CamposDialog`/`FormularioDialog` (o construtor sem código: adiciona/edita perguntas por tipo — input/listbox/checkbox —, opções, obrigatório, arrastar p/ ordenar, "Sugerir perguntas" por IA) **exportados** de `FormulariosPanel.tsx` e usados na `ModelosPage`. O grupo **"O cliente envia"** mostra os briefings interativos (card abre o construtor) + o checklist de documentos; botão **"Novo briefing"**.
3. **Rota/página/card separados removidos:** apagada `FormulariosPage` + rota `/formularios`; card "Briefings e formulários" fora do Ajustes; breadcrumb/`EXTRA_TITLES` limpos; BRIEFING tirado do seletor de "Novo modelo". O cliente continua preenchendo pelo Portal (`BriefingDialog`) e a ligação `ServicoRequisito(BRIEFING)→Formulario` segue igual.

**Verificado ao vivo (Playwright):** Modelos em 6 finalidades; "O cliente envia" com 3 briefings interativos ("N perguntas · cliente preenche") + "Novo briefing"; abrir um briefing abre o construtor com os 7 tipos de campo + IA + as perguntas existentes; Ajustes sem o card separado. typecheck 5/5 + build OK.

## ADR-53 — Áudio → texto (transcrição Whisper) em Ata, Pauta e Gerar com IA ✅

**Contexto:** o "Novo documento" (ADR-50) já resumia reunião a partir de **texto** colado. O dono pediu para fechar a fase seguinte: **falar/gravar o áudio da reunião** e a IA transcrever, "em todos os documentos que fizer sentido (Ata, Pauta, etc.)".

**Decisões:**

1. **Transcrição por Whisper** (`whisper-1`, `language: "pt"`) no mesmo provedor OpenAI já usado (ADR-6). `aiService.transcrever(buffer, filename)` em `apps/api/src/lib/ai.ts` (usa `toFile` do SDK). Custo baixo (~US$ 0,006/min); aprovação humana permanece (a transcrição vira **rascunho editável**, nunca envio automático).
2. **Rota fora do tRPC** (multipart não passa pelo tRPC): `POST /transcrever` em `apps/api/src/http/uploads.ts` — **só equipe** (CLIENTE bloqueado), exige IA configurada (412 se não), aceita `audio/*`|`video/*`, limite 20 MB herdado do `@fastify/multipart`, devolve `{ texto }`. Proxy `/transcrever` no `vite.config.ts` (dev).
3. **Componente reutilizável** `AudioTranscricao.tsx` (features/documentos): **Gravar** (microfone via `MediaRecorder`) **ou Enviar áudio** (arquivo); mostra estados gravando/transcrevendo/erro; devolve o texto por `onTexto(texto)`. Ligado no `NovoDocumentoDialog` nos 3 modos que fazem sentido — **Ata** (anexa às anotações), **Pauta** (anexa aos tópicos) e **Gerar com IA** (anexa às instruções) —, sempre com o helper `anexar()` (concatena preservando o que já havia). Só aparece com IA disponível.

**Verificado ao vivo (Playwright):** modo Ata mostra "Gravar áudio"/"Enviar áudio"; upload de um WAV real (fala em pt-BR) → **transcrição correta com acentos e pontuação** anexada ao campo de anotações; sem erros. typecheck (web+api) + build OK. Dados de teste limpos.

## ADR-54 — Cada documento gerado espelha o seu modelo (proposta comercial ≠ credenciamento; fim dos marcadores crus) ✅

**Contexto:** o dono notou na página **Documentos** que a **Proposta de credenciamento** saía **igual à Proposta comercial**. Análise profunda das duas páginas revelou 3 causas + 2 bugs de geração:

1. **Apresentação genérica compartilhada:** `criarProposta` injetava a MESMA abertura ("A MedConsultoria cuida de todos os processos…") em toda proposta — a primeira coisa que se lê era idêntica, e o **formulário** também (mesmo seletor de serviços). O corpo do credenciamento até tinha seções extras, mas o "bater o olho" dizia "igual".
2. **`gerarParaLead(tipo="proposta")`** (botão "Gerar proposta" no painel do lead) fazia `render(corpo,{})` sem preencher `{{servicos}}`/`{{apresentacao}}` → documento nascia com os **literais crus `[servicos]`/`[apresentacao]`**.
3. **`gerarContratoAutoParaLead`** (contrato automático) caía no mesmo `render(corpo,{})` → contrato com **`[objeto]`/`[valor]`/`[prazo]`/`[foro]` crus**.

**Decisões:**

1. **Apresentação type-aware:** a abertura genérica só é montada quando o **modelo tem `{{apresentacao}}`**. O modelo **Proposta de credenciamento** passou a trazer a **própria abertura** no corpo (sem `{{apresentacao}}`) — específica de credenciamento ("Sabemos que se credenciar junto às operadoras…") — então as duas propostas são diferentes desde a 1ª linha. O checkbox "IA escreve a apresentação" (NovoDocumentoDialog) só aparece para modelos que têm `{{apresentacao}}`.
2. **`gerarParaLead(proposta)`** agora delega ao **mesmo construtor** (`criarProposta`) usando os serviços do lead (tabela + investimento reais) — nunca deixa `{{servicos}}` cru.
3. **`gerarParaLead(contrato)`** **pré-preenche** as variáveis com o que já se sabe: `objeto` = lista dos serviços do lead; `valor`/`prazo`/`foro` com padrões editáveis (referem a proposta aprovada; vigência 12 meses; foro do domicílio da CONTRATANTE).
4. **Fallback do `render`:** campo sem valor vira **`*(a preencher)*`** (placeholder claro), nunca mais `[campo]` com cara de bug.
5. **Revisão de conteúdo (task combinada):** **Credenciamento** com **operadoras reais** (Unimed, Bradesco Saúde, SulAmérica, Amil, Hapvida NotreDame Intermédica, Porto Seguro Saúde + convênios locais, "definidos conforme o perfil"). **Contrato** ganhou cláusula de **reajuste anual (IPCA)** e **multa compensatória** na rescisão antecipada (sugerida revisão do advogado do dono; valores específicos ficam com a proposta/edição).

**Integração:** o **Portal do Cliente** (`PortalDocumentoModal`) renderiza o `conteudo` armazenado via `DocumentoBranded` — corrigir a geração corrige a exibição no Portal, na ficha e no funil de uma vez.

**Verificado ao vivo:** re-seed dos modelos confirmado no banco (credenciamento com abertura nova + Unimed, sem `{{apresentacao}}`; contrato com reajuste+multa). Geração fresca: credenciamento abre "Sabemos que se credenciar…" (≠ comercial "A MedConsultoria cuida…"), com operadoras + tabela de investimento, **zero marcadores crus**; checkbox de IA some no credenciamento. Script de serviço (Playwright + tsx) exercitou `gerarParaLead` **proposta** (tabela real, sem `[servicos]`) e **contrato** (objeto pré-preenchido, sem `[objeto]`). typecheck (web+api) + build OK. Dados de teste limpos.

## ADR-55 — Preview A4 de verdade (multipágina) + "Novo documento" com prévia do modelo ✅

**Contexto:** o dono apontou que (a) no **Novo documento**, escolher "Proposta comercial" vs "Proposta de credenciamento" mostrava um **formulário idêntico** (mesmo seletor de serviços) — nada dizia que os documentos eram diferentes; e (b) os **previews estavam "muito grandes"**, fora da proporção A4. Análise: o `DocumentoBranded` usava `aspect-[210/297]`, que **força a folha a UMA página A4** — conteúdo longo (credenciamento) **vazava** para fora da folha branca (parecia gigante/quebrado); conteúdo curto virava folha alta e vazia.

**Decisões:**

1. **Preview A4 com altura natural + multipágina** (`DocumentoBranded`): removido o `aspect-ratio` forçado. Novos **`PREVIEW_STYLES`** (só-tela, **separados do `DOC_STYLES`** que a impressão usa): folha com **largura A4** confortável (`--doc-w: 620px`), **altura natural** (curto = folha curta; longo = cresce, nunca corta), **margens proporcionais** (8.5% × 7.6% ≈ 18mm × 16mm) e **linhas-guia de página** a cada altura A4 (`repeating-linear-gradient` em `--doc-h = --doc-w × 297/210`) → mostra "**mais de uma folha**". **Impressão inalterada e A4 real:** `imprimirDocumento` usa só `DOC_STYLES` + `@page { size:A4; margin:18mm 16mm }` + `.doc-sheet{padding:0}` (os estilos de tela NÃO vazam para o PDF/Word).
2. **"Novo documento" com PRÉVIA do modelo** (`NovoDocumentoDialog`, agora modal `2xl`): ao escolher o modelo, o diálogo abre em **2 colunas** — formulário à esquerda e **preview A4 ao vivo do modelo à direita** (via `previewModelo`, com chip do que o documento faz por `DOC_INTERACAO`). Assim **comercial × credenciamento ficam visivelmente diferentes na hora de criar** (o de credenciamento mostra "Sabemos que se credenciar…", "O que é o credenciamento", operadoras…). `previewModelo` (antigo `previewCorpo` local da `ModeloDetailPage`) foi **exportado do `DocumentoBranded`** e reusado nas duas telas. Novo tamanho de modal **`2xl` (max-w-6xl)**.

Refina o "A4 na tela" do ADR-48 (que forçava `aspect-[210/297]` a uma folha) — agora é largura A4 + páginas que crescem.

**Verificado ao vivo (Playwright + screenshots):** Novo documento mostra prévias **diferentes** para comercial e credenciamento; folha do credenciamento = 1918px de altura (≈2,7 páginas A4) **sem overflow**, com gradiente de quebra e padding proporcional; leitura do documento com folha A4 620px compacta (não "gigante"); demais usos (Portal, proposta pública, modelos) intactos. typecheck (web) + build OK.

## ADR-56 — Formulário PRÓPRIO da Proposta de credenciamento (operadoras, não serviços) ✅

**Contexto:** mesmo com o conteúdo já distinto (ADR-54/55), o **formulário de criação** da Proposta de credenciamento ainda era o **mesmo** da comercial — "Serviços da proposta" (catálogo). O dono: credenciamento **não** tem "serviços da proposta"; precisa de coisas que façam sentido — **selecionar as operadoras** a credenciar, o investimento etc.

**Decisões:**

1. **O modelo declara o que precisa (data-driven):** a Proposta de credenciamento passou a ter o marcador **`{{operadoras}}`** no corpo (substituiu a lista fixa de operadoras). O diálogo detecta `modelo.corpo.includes("{{operadoras}}")` → é credenciamento → mostra o **formulário de operadoras** (`CredenciamentoPicker`); senão, o catálogo de serviços (`PropostaServicosPicker`). Extensível: qualquer modelo futuro com `{{operadoras}}` ganha o formulário.
2. **`CredenciamentoPicker` (novo):** multisseleção de **operadoras** (lista real `OPERADORAS_COMUNS` em `@app/shared`: Unimed, Bradesco Saúde, SulAmérica, Amil, Hapvida NotreDame, Porto Seguro… + **adicionar outras** como chips) + **investimento por operadora** (`MoneyInput`) com **total ao vivo** (valor × nº operadoras).
3. **Schema/geração:** `criarPropostaSchema` — `itens` virou opcional (`.default([])`) + novos `operadoras?: string[]` e `valorPorOperadora?`; refine exige **serviços OU operadoras**. `criarProposta` tem **duas trilhas**: credenciamento → `{{operadoras}}` recebe a lista e `{{servicos}}` recebe um bloco **## Investimento** por operadora (sem tabela de "Serviços propostos"); comercial → catálogo como antes. **Prévia ao vivo** injeta as operadoras já marcadas no preview.

**Verificado ao vivo (Playwright + screenshot + DB):** escolher "Proposta de credenciamento" mostra **"Operadoras a credenciar"** (checkboxes) + "Investimento por operadora" + contador — **sem** "Serviços da proposta"; gerar com Unimed+Bradesco produziu operadoras em lista + "## Investimento … por operadora" e **`tem_tabela_servicos=0`**. Comercial segue com o catálogo. typecheck (shared+api+web) + build OK. Dados de teste limpos.

## ADR-57 — Preview paginado (folhas A4 separadas) + formulários próprios de Recibo/Plano + operadoras editáveis ✅

**Contexto:** o dono apontou (a) previews **bugados** — "páginas coladas" e "conteúdo espremido"; (b) na Proposta de credenciamento, só dava para **incluir** operadoras (não editar/excluir); (c) pediu formulários próprios para **Recibo** e **Plano de ação** (como o do credenciamento). Diagnóstico do preview (medição ao vivo): o `DocumentoBranded` desenhava a quebra de página com `repeating-linear-gradient` numa altura fixa de 620px, mas a folha renderizava a ~485px em colunas estreitas → linha na posição errada + conteúdo espremido; e a "quebra" era só uma linha (páginas coladas).

**Decisões:**

1. **Preview com PAGINAÇÃO REAL** (`DocumentoBranded` reescrito): mede (camada oculta `.doc-measure`) o cabeçalho/título/blocos/rodapé e **distribui em folhas A4 separadas** (`useLayoutEffect`), cada uma com altura A4 e **espaço entre elas** (não mais "coladas"); cabeçalho só na 1ª folha, rodapé na última (ou folha própria). Um **`zoom`** (via `ResizeObserver`, máx. 1) encolhe o conjunto para caber na largura **sem espremer** (o texto quebra igual em qualquer largura). Impressão **inalterada** (A4 real: `@page A4` + só `DOC_STYLES`). Substitui o `aspect-ratio`/gradiente do ADR-55.
2. **Recibo — formulário próprio** (modo `RECIBO`): valor (`MoneyInput`) + forma de pagamento (select) + "referente a"; **valor por extenso automático** (`valorPorExtenso` em `lib/masks` — regras pt-BR do "e"/"de reais", validado). Gera via `createDocumento` (variáveis `valor`/`valor_extenso`/`referente`/`forma_pagamento`).
3. **Plano de ação — formulário próprio** (`PlanoAcaoFields`, modo `PLANO`): objetivo + **linhas de ação dinâmicas** (ação·responsável·prazo, adicionar/excluir) + indicadores. As linhas viram a tabela Markdown `{{acoes}}` (o modelo trocou a tabela fixa de 3 linhas por `{{acoes}}`).
4. **Operadoras editáveis/excluíveis** (`CredenciamentoPicker` reescrito): cada operadora selecionada é um campo **editável** com botão **excluir**; atalhos das comuns (`OPERADORAS_COMUNS`) + adicionar outras.
5. `criarPropostaSchema.itens` já era opcional; nada novo no schema. Preview injeta os valores digitados ao vivo (operadoras, recibo, plano).

**Verificado ao vivo (Playwright + screenshots + DB):** preview do credenciamento em **2 folhas A4 separadas** (877px cada, gap entre elas), conteúdo não espremido; modo edição com zoom proporcional; Recibo mostra "Por extenso: mil e quinhentos reais" e preview correto; Plano com 2 ações dinâmicas → tabela `{{acoes}}` no doc gerado (0 marcador cru). `valorPorExtenso` validado (100→"cem reais"; 1234,56→"mil duzentos e trinta e quatro reais e cinquenta e seis centavos"; 1.000.000→"um milhão de reais"). typecheck (shared+api+web) + build OK. Dados de teste limpos.

## ADR-58 — Catálogo de operadoras editável/excluível + TODOS os documentos inteligentes ✅

**Contexto:** o dono queria **editar o nome** e **excluir permanentemente** as operadoras da Proposta de credenciamento (a lista era uma constante fixa `OPERADORAS_COMUNS` — só dava para incluir) e pediu que **todos** os documentos ficassem inteligentes (não só Proposta/Recibo/Plano).

**Decisões:**

1. **Catálogo de operadoras persistente** (igual ao de Origens): novo model **`Operadora`** (id/nome/ordem), **semeado** com `OPERADORAS_COMUNS` na 1ª leitura; sub-router **`documentos.operadoras`** (`list`/`criar`/`renomear`/`remover`) e `operadoras.service`. **Exclusão é permanente** (hard delete — o nome só é copiado para o texto do documento, sem FK). O `CredenciamentoPicker` foi reescrito: cada operadora é uma linha com **checkbox** (selecionar p/ a proposta), **lápis** (renomear), **lixeira** (excluir permanente, com confirmação) + adicionar nova ao catálogo. A seleção da proposta (nomes) acompanha renomeações/exclusões.
2. **Todos os documentos inteligentes** — **`SmartCampos`**: o modo "Preencher campos" (usado por Escopo, Diagnóstico, Onboarding, Checklist, Relatórios, Pauta de postagem…) deixou de ser inputs sem rótulo e virou um formulário **type-aware**: rótulo legível (`total_faturado`→"Total faturado") + tipo inferido pelo nome — **dinheiro** (`MoneyInput`: valor/total/faturado/glosado…), **percentual** (placeholder "3,5%"), **texto longo** (`Textarea`: objetivo/motivos/ações/observações…) ou texto. O **preview injeta os campos preenchidos ao vivo**.

**Verificado ao vivo (Playwright + DB):** catálogo carrega do banco; **renomear** "Amil"→"Amil Saúde" e **excluir** "SulAmérica" **persistiram** (total 14→13, confirmado no banco), com confirmação na exclusão; Relatório de faturamento mostra campos rotulados com `MoneyInput`/`Textarea`/percentual e o preview injeta "Julho/2026" + "R$ 45.000,00" (sem `[campo]`). Migração `add_operadora` aplicada em MODO PAUSA. typecheck (shared+api+web) + build OK. Catálogo de teste restaurado (re-seed).

## ADR-59 — "Cabe na tela" global (fix da cadeia de scroll) + Pauta de postagem dinâmica + Agenda Lista inteligente ✅

**Contexto:** o dono relatou (a) o modal "Novo documento" com **scroll gigante**; (b) **Agenda Dia/Semana** com scroll de página (regressão — antes só rolava por dentro); (c) o modo **Lista** da Agenda vira um scrollão quando há muitos eventos; (d) **Pauta de postagem** deveria ter linhas dinâmicas; (e) uma varredura geral de scroll.

**Decisões:**

1. **Cadeia de scroll do shell (raiz de vários problemas):** no `AppLayout`, o `<main>` era `overflow-y-auto` **e** o container flex crescia com o conteúdo (`min-height:auto`), então páginas com `h-full` não eram limitadas → rolava a página inteira. Agora **`<main>` é o VIEWPORT** (`flex min-h-0 flex-1 overflow-hidden`) e o **container interno é o scroll** (`flex-1 min-h-0 overflow-y-auto`). Efeito: páginas "cabe na tela" (`flex h-full flex-col` — Agenda, Clientes, Projetos, Documentos, Financeiro…) **fecham na tela com scroll só por dentro**; páginas naturais (Início) rolam pelo container. Verificado nas 6 páginas.
2. **Scroll gigante do modal = camada de medição:** a `.doc-measure` do `DocumentoBranded` (paginação, ADR-57) era `position:absolute` com a altura do documento inteiro (~1400px) — e o `scrollHeight` conta filhos absolutos que transbordam, inflando o corpo do modal/preview. Mudou para **`position:fixed`** (desacopla do scroll de qualquer ancestral). Modal do credenciamento: scroll caiu de ~824px para ~81px.
3. **Agenda — modo Lista inteligente:** navegação rápida por **mês + ano** (dropdowns) que troca o período, **cabeçalhos de dia FIXOS** (sticky) com nº do dia/semana/contagem, **auto-scroll até hoje** ao abrir, contadores, e tudo dentro de um scroll interno (cabe na tela). Substitui a lista de cards soltos que exigia rolar muito.
4. **Agenda Dia/Semana:** o `TimeGrid` já rolava por dentro; o fix do shell (item 1) devolveu o "sem scroll de página" (igual Mês/Ano).
5. **Pauta de postagem — linhas dinâmicas** (`PautaPostagemFields`, modo `PAUTA_POST`): período + **posts dinâmicos** (data · rede · formato via selects · tema, adicionar/excluir) + observações → tabela `{{postagens}}` (o modelo trocou a tabela fixa de 4 linhas por `{{postagens}}`). Fecha o "todos os documentos inteligentes".

**Verificado ao vivo (Playwright + medições):** `main.scrollHeight===clientHeight` em Clientes/Vendas/Projetos/Documentos/Financeiro/Agenda (cabe na tela); Início rola pelo container; Agenda Semana fecha na tela (grade rola por dentro); Lista com dropdowns mês/ano + sticky + auto-scroll hoje; modal do credenciamento sem scroll gigante (81px); Pauta de postagem monta a tabela ao vivo (05/08 · Instagram · Post · tema). typecheck (shared+api+web) + build OK. Dados de teste limpos.

## ADR-60 — Data dd/mm/aaaa em toda a app + auditoria de CRUD/confirmações ✅

**Contexto:** o dono pediu (a) **dia/mês/ANO em tudo** (ex.: 26/03/2026 — havia lugares só com dia/mês) + nomes por extenso onde couber; (b) verificar **todos os CRUDs** da app e garantir **confirmações + Salvar/Cancelar** ("à prova de falhas"); (c) melhor Agenda.

**Decisões:**

1. **Datas centralizadas com ano:** em `lib/format-date`, **removido `dataCurta`** (era "10/07" sem ano) → todo mundo usa **`data` = dd/mm/aaaa**; adicionados **`dataExtenso`** ("10 de julho de 2026") e **`diaSemana`** ("sexta-feira, 10 de julho de 2026") para os pontos amigáveis. Substituído em Projetos, Clientes, Ficha, Portal, Mensagens (troca `dataCurta`→`data`, coluna estreita alargada). **Agenda**: título do Dia por extenso com ano, Semana = "dd/mm/aaaa – dd/mm/aaaa", KPI e cabeçalho da Lista com ano. **Dashboard**: "hoje" por extenso + labels com ano. Backend (e-mails/IA) já usava dd/mm/aaaa.
2. **Auditoria de CRUD (3 subagentes em paralelo, read-only)** cobrindo CRM/Portal · Projetos/Agenda/Financeiro · Documentos/Serviços/Mensagens/Config. Resultado: a esmagadora maioria já correta (rotas completas, sem mutation morta relevante, destrutivas com `useConfirm`, diálogos com footer Salvar/Cancelar, `MutationCache.onError` global cobre erros). **Lacunas corrigidas:**
   - Remover **foto do Portal** (`PortalHome`) agora **confirma**.
   - Remover **participante de grupo** (`ConversaInfoDialog`) agora **confirma**.
   - **Desativar serviço** (`ServicosPage`) agora **confirma** (ativar não precisa).
   - **Renomear origem** de lead (`OrigensDialog`) agora tem UI (lápis→editar→salvar; o backend já suportava — era só-backend).
   - **Cancelar** no briefing do Portal (`BriefingDialog`); rodapé **Concluído** nos gerenciadores em popup (`CategoriasDialog`, `ServicoConfigDialog`, `CamposDialog`) — Salvar/Cancelar consistentes.
   - `CardPanel.removeCard` agora invalida `projetos.get/list` (progresso do projeto atualiza ao remover cartão).
   - **Não-bugs** (deixados): `usuarios.create` e `mensagens.chamadosDoCliente` são rotas sem chamada na UI (o fluxo real é `convidar`); categorias de serviço são lista fixa (só seria gap se catálogo gerenciável fosse esperado).

**Verificado ao vivo:** datas com ano em Agenda/Projetos ("Reunião 15/07/2026", "Entrega 29/08/2026"); nada mais em dd/mm sem ano; OrigensDialog com 9 botões "Editar nome". typecheck (shared+api+web) + build OK.

## ADR-61 — Funil auto-avança pelo checklist + salvamento explícito (staging) ✅

**Contexto:** o dono viu que (a) na **Vendas**, os cards **não andavam sozinhos** ao concluir as tarefas — só o botão manual "Avançar" movia; (b) no **Financeiro → Categorias**, clicar "Adicionar" **já gravava** sem precisar confirmar — ele quer que tudo só salve ao clicar em Salvar/Concluir.

**Decisões:**

1. **Card do funil trabalha sozinho** — `avancarSeChecklistCompleto(leadId, userId)` (leads.service): quando **todos os passos obrigatórios da etapa** estão concluídos, o lead avança para a próxima etapa — **só para frente**, nunca em lead perdido/convertido, e em **cascata** (segue avançando se a próxima já estiver cumprida; ao entrar em cada etapa semeia o checklist, gera Proposta/Contrato e reconcilia os passos derivados). Gatilhos:
   - **Usuário/equipe:** `togglePasso` chama o auto-avanço ao CONCLUIR um passo e devolve `{ avancou }` → o front (`LeadDetailPanel`) invalida o board e mostra **toast** "Card movido para 'X' 🎉".
   - **Sistema/cliente:** ao **assinar** um documento (`assinaturas.service.reconciliarLeadDoDocumento`), reconcilia + auto-avança (o `userId` é opcional; ações do sistema não geram documento no salto). Continua o auto-avanço por evento já existente (proposta/contrato **enviado** → etapa; proposta **aceita** → Negociação).
2. **Salvamento explícito (staging) no gerenciador de Categorias** (`CategoriasDialog` reescrito): adicionar/editar/excluir só mexem numa **lista LOCAL** (rascunho); **nada vai ao banco** até **"Salvar alterações"** (que aplica exclusões + criações + edições de uma vez e fecha). "Cancelar" descarta. Item novo mostra selo "novo"; nota "as mudanças só são gravadas ao clicar em Salvar alterações". Padrão de "sempre confirmar antes de gravar" para gerenciadores.

**Verificado ao vivo (Playwright + DB):** completar as 2 tarefas obrigatórias de "Lead Teste" (com serviço) → o lead **avançou Novo → Qualificação** (log `lead.auto_avancou_checklist`), parando lá porque falta o "valor" (obrigatório de Qualificação). Categorias: "Adicionar à lista" → **0 no banco** (rascunho); "Salvar alterações" → **1 no banco**. typecheck (shared+api+web) + build OK. Dados de teste restaurados/limpos. Obs.: exigiu **reinício limpo do dev** (MODO PAUSA) para o tsx-watch carregar o novo código do service.

## ADR-62 — Staging em Origens e Operadoras + Esc do modal-sobre-modal ✅

**Contexto:** o dono pediu para **replicar o salvamento explícito (staging)** do CategoriasDialog (ADR-61) nos outros gerenciadores — **Origens de lead** e **Operadoras** — e "CRUD completo e profissional em tudo".

**Decisões:**

1. **OrigensDialog com staging:** criar/renomear/ativar-desativar/remover/**reordenar (arraste)** só mexem numa lista LOCAL; nada persiste até **"Salvar alterações"** (que aplica exclusões → cria as novas [mapeando id provisório → id real] → renomeia/ativa as alteradas → grava a ordem final com `reordenar`). "Cancelar" descarta. Selo "novo" nas não-salvas.
2. **Operadoras — separação de responsabilidades:** a gestão do catálogo saiu de dentro do `CredenciamentoPicker` para um diálogo dedicado **`OperadorasDialog`** (staging: adicionar/renomear/excluir + Salvar). O `CredenciamentoPicker` virou **só seleção** (checkboxes das operadoras) + botão **"Gerenciar operadoras"** que abre o diálogo. Assim a seleção da proposta e a edição permanente do catálogo não se misturam.
3. **Modal-sobre-modal (Esc):** "Gerenciar operadoras" abre por cima do "Novo documento". Um **único listener global de Esc** + uma **pilha de `onClose`** no `Modal` fazem o Esc fechar **só o modal do topo** (o último aberto), sem perder o de baixo. (O `onClose` via ref evita re-registrar a cada render.)

**Verificado ao vivo (Playwright + DB + screenshots):** Operadoras — "Adicionar" fica em rascunho (**0 no banco**); modal aninhado renderiza centralizado; **Esc fecha só o de cima** (Novo documento permanece), 2º Esc fecha o de baixo; Origens abre com "Salvar alterações" + aviso + 9 botões "Editar nome". typecheck (shared+api+web) + build OK. Dados de teste limpos.

## ADR-63 — Refino do Header e do Menu (1ª etapa da revisão página a página) ✅

**Contexto:** o dono pediu uma revisão profunda de toda a app (UX/UI/DX, responsivo), começando pelo Header e Menu, com autonomia para implementar o melhor. Base já sólida; foram refinamentos.

**Decisões (`AppLayout` + `Breadcrumbs`):**

1. **Menu "Ajustes" acende nas páginas-filhas:** `itemAtivo(pathname, to)` (destaque manual, substitui `activeProps` do TanStack) — "Ajustes" fica ativo em `/servicos`, `/usuarios`, `/emails`, `/emails-enviados`, `/modelos`, `/configuracoes` (via `AJUSTES_FILHOS`). Antes nenhum item acendia nessas rotas (sensação de "me perdi"). `aria-current="page"` no item ativo.
2. **Header mobile mostra o título da página:** o breadcrumb é `hidden md:flex` (some no celular) → no mobile o header agora exibe o **nome da página** (`pageTitle`) + a busca vira **ícone** (abre a command palette). No desktop, a busca proeminente centralizada segue igual.
3. **A11y/polish:** atalho da busca **ciente do SO** (⌘K no Mac, Ctrl K no resto — `ATALHO_BUSCA`); `aria-keyshortcuts` na busca; **foco visível** (`focus-visible:ring`) nos links do menu e botões do header; `aria-label` nos botões de ícone.

**Verificado ao vivo (Playwright, desktop 1440 + mobile 390):** em `/modelos` o item ativo da sidebar é "Ajustes"; no mobile o header mostra "Clientes"/título + ícone de busca; drawer e rail recolhido intactos. typecheck (web) + build OK. **Próximas etapas:** revisar as páginas uma a uma (Início, Vendas, Clientes, Projetos, Agenda, Mensagens, Documentos, Financeiro, Ajustes e filhas, Sistema, Portal) com o mesmo rigor.

## ADR-64 — Início (Dashboard) personalizável: widgets recolhíveis + mostrar/ocultar por usuário ✅

**Contexto:** 2ª etapa da revisão página a página (após Header/Menu). O dono pediu que o **Início** deixe o usuário **escolher o que mostra**, **recolher/expandir cada componente**, com **layout automático** e a página **se adaptando a cada usuário** — "profissional, completa, inteligente e integrada", com autonomia total.

**Decisões (`DashboardPage.tsx`):**

1. **Cada bloco vira um _widget_** com identidade estável (`WidgetId`), título, ícone, grupo (`dia` × `gestao`), largura (`span` 1/2) e `render()`. A ordem/disponibilidade continua **role-aware** (a Gestão só existe para ADMIN/ROOT; "Saúde do sistema" e Atividade só entram quando os dados vêm; "Seu dia com a IA" só quando `ia.disponivel`). Blocos: Ações rápidas, Precisa da atenção, Seu dia com a IA, Indicadores do dia, Minhas tarefas, Sua agenda, Saúde do sistema, Financeiro, Funil, Projetos, Carga da equipe, Clientes, Documentos, Atividade recente.
2. **Contêiner único `WidgetCard`** com cabeçalho padronizado (ícone + título + link "Ver tudo" opcional + botão **recolher/expandir** com chevron `aria-label`/`title`). Quando recolhido, o corpo some — o header permanece (e o link continua clicável).
3. **Menu "Personalizar"** (botão no `PageHeader`, dropdown com _click-outside_ igual ao NotificationBell): checkboxes por widget **agrupados** em "Meu dia" e "Gestão da empresa" + **"Padrão"** (aparece só quando há personalização) para restaurar tudo. Widget desmarcado é ocultado.
4. **Layout automático:** grid responsivo (`lg:grid-cols-2`, widgets largos com `lg:col-span-2`). Ocultar/recolher **reflui** o grid sozinho — sem "buracos". A faixa-divisória "Gestão da empresa" só aparece se houver ao menos um widget de gestão visível; estado "tudo oculto" mostra um vazio amigável com "Restaurar o padrão".
5. **Preferências por usuário, persistidas** via `localStorage` (`dashboard-prefs:v1:<userId>`) no hook `useDashboardPrefs` — `{ ocultos[], recolhidos[] }`. Escolha per-device (sem migração/endpoint); arquitetura pronta para sincronizar no back futuramente.

**Verificado ao vivo (Playwright, 1920×1080, ROOT):** ocultei "Seu dia com a IA" e recolhi "Indicadores do dia" → grid refluiu; **persistiu após reload**; "Padrão" restaurou tudo (e o botão some quando não há personalização). typecheck (web) OK. Navegador devolvido a 1920×1080; sem dados de teste. **Próxima etapa:** Vendas (funil), na ordem do menu.

## ADR-65 — Vendas (funil): clareza na busca vazia (revisão página a página, 3ª etapa) ✅

**Contexto:** 3ª etapa da revisão página a página. O **Funil de vendas** (`LeadsPipelinePage`) já é uma das telas mais maduras (funil inteligente, auto-avanço por checklist, staging de Origens, conversão, perdidos, KPIs, busca+filtro). Avaliação: sólida — só faltavam microajustes de **clareza para leigo**, não refatoração.

**Decisões (`LeadsPipelinePage.tsx`):**

1. **Placeholder de coluna ciente do contexto:** quando há **busca/filtro ativo**, a coluna vazia diz **"Sem resultados nesta etapa"** (antes dizia sempre "Arraste um lead para cá" — confuso ao filtrar, pois arrastar não é o ponto). Sem filtro, mantém "Arraste um lead para cá". `Column` recebe `filtrando`.
2. **Botão "Limpar" de um clique** ao lado do contador "X de Y leads" — zera busca **e** filtro de responsável juntos (ícone `X`). Some quando não há filtro ativo.

**Verificado ao vivo (Playwright, 1920×1080):** busca sem resultado → 5 colunas com "Sem resultados nesta etapa" + "0 de 1 lead · Limpar"; clicar em Limpar restaura busca/filtro e o board volta ao normal. typecheck (web) OK. **Próxima etapa:** Clientes.

## ADR-66 — Clientes: "Limpar" busca/filtros (revisão página a página, 4ª etapa) ✅

**Contexto:** 4ª etapa da revisão. **Clientes** — a **lista** (`ClientesListPage`) já é excelente (KPIs, busca, filtros-chip com contagem, filtro por responsável, cards↔tabela, contato rápido, convite Portal, empty states) e a **ficha** (`ClienteDetailPage`) idem (2 colunas trabalho×referência, serviços/projetos/documentos Med×cliente/anotações/suporte/contatos/agenda/financeiro/e-mails, datas dd/mm/aaaa, confirmações em toda ação destrutiva, IA "Resumir", breadcrumb dinâmico). Avaliação: **ficha não precisa de nada**; lista só faltava a mesma affordance de "Limpar" que padronizei no funil (ADR-65).

**Decisões (`ClientesListPage.tsx`):**

1. **Botão "Limpar"** na barra de filtros — aparece quando há busca **ou** situação **ou** responsável ativos (`filtrando`); zera os três de uma vez (`limpar`).
2. **"Limpar filtros" no estado vazio filtrado** — quando existem clientes mas os filtros escondem todos, o `EmptyState` agora oferece um botão para limpar (antes só oferecia "Novo cliente" no caso de base realmente vazia).

**Verificado ao vivo (Playwright, 1920×1080):** buscar termo inexistente → "Nenhum cliente com esses filtros" + "Limpar filtros" e "Limpar" na barra (chips zeram); clicar em Limpar restaura os 4 clientes. typecheck (web) OK. **Ficha intocada.** **Próxima etapa:** Projetos.

## ADR-67 — Projetos: "Limpar" busca/filtros (revisão página a página, 5ª etapa) ✅

**Contexto:** 5ª etapa. **Projetos** — a **lista** (`ProjetosListPage`) já é excelente (KPIs Ativos/Pausados/Concluídos/Com atraso, busca, filtros-chip com contagem, filtro por responsável, cards↔tabela, **ordenação por urgência** — atrasados/entrega vencida primeiro, empty states) e a **ficha** (`ProjetoDetailPage`) idem (equipe/participantes, resumo status+cliente+progresso+atrasos+entrega, kanban dnd 5 colunas, painel do cartão, breadcrumb dinâmico). Avaliação: **ficha não precisa de nada**; lista só faltava a affordance "Limpar" (padrão dos ADR-65/66).

**Decisões (`ProjetosListPage.tsx`):**

1. **Botão "Limpar"** na barra — aparece quando há busca/status/responsável ativos (`filtrando`); zera os três (`limpar`).
2. **"Limpar filtros" no estado vazio filtrado** — o antes-só-texto "Nenhum projeto para os filtros escolhidos." ganhou o botão para limpar.

**Verificado ao vivo (Playwright, 1920×1080):** buscar termo inexistente → estado vazio com "Limpar filtros" + "Limpar" na barra (chips zeram); clicar restaura os 2 projetos. typecheck (web) OK. **Ficha intocada.** **Próxima etapa:** Agenda.

## ADR-68 — Agenda: consistência do campo de busca/limpar (revisão página a página, 6ª etapa) ✅

**Contexto:** 6ª etapa. **Agenda** — a mais complexa (5 visões Lista/Dia/Semana/Mês/Ano; `TimeGrid` com linha do "agora" + arraste-para-reagendar; KPIs Hoje/7 dias/Próxima reunião/Aguardando confirmação; filtros busca+escopo+tipo+responsável; Resumo IA; navegação Hoje/‹/›). Já era excelente (ADR-39 + ADR-59 Lista redefinida). Avaliação: **nenhuma mudança funcional**; só duas inconsistências visuais com o resto do CRM.

**Decisões (`AgendaPage.tsx`):**

1. **Ícone de lupa no campo de busca** — o input era um `<input>` cru sem ícone; agora tem a lupa à esquerda (`pl-9`), igual a Vendas/Clientes/Projetos.
2. **"Limpar filtros" padronizado** — era um link de texto puro; virou botão com borda + ícone `X` (mesmo padrão do "Limpar" das outras telas). A Agenda **já limpava** todos os filtros (busca+escopo+tipo+responsável) num clique — só faltava a affordance visual.

**Verificado ao vivo (Playwright, 1920×1080):** Semana/Lista renderizam certo; ativar chip "Empresa" mostra o botão "✕ Limpar filtros"; a lupa aparece no campo; clicar em Limpar zera. typecheck (web) OK. **Visões/TimeGrid intocados.** **Próxima etapa:** Mensagens.

## ADR-69 — Sistema de alertas, Fase 1: conflito de horário VISÍVEL na Agenda ✅

**Contexto:** o dono viu um conflito de horário na Agenda sem ter sido avisado de forma visível e pediu uma **lógica de ALERTA** para conflitos "e outras coisas", revisando o app inteiro para "não esquecer de avisar nada". Duas explorações mapearam o estado atual: a base de avisos é boa mas **fragmentada** (sino `notificar()` + varredura proativa a cada 10 min + chips "Precisa da sua atenção" recalculados no Início), e o **conflito de horário só existia como aviso no formulário** de evento — não aparecia na grade, não checava a agenda dos participantes, não tinha contador. **Decisão de escopo (com o dono):** fazer **conflito primeiro** (tornar visível na tela + checar participantes + contador), **só avisando, nunca bloqueando**; as demais lacunas viram Fase 2. Reaproveitar a base existente — **sem** criar modelo `Alerta` novo (complexidade especulativa).

**Decisões:**

1. **`verificarConflitos` agora checa a agenda dos PARTICIPANTES** (`agenda.service.ts`) — antes o `participanteIds` era aceito mas ignorado. Faz loop por `[organizador, ...participantes]`, dedup por ocorrência (eventos compartilhados atribuídos a "você", pessoais ao participante), e retorna `participante` (nome de quem conflita, `null` = você). O form (`EventoFormDialog`) passa `participanteIds` e o banner mostra "{Fulano} já tem …" ou "Você já tem …". **Continua só AVISO** — botão Salvar nunca desabilita.
2. **Conflito VISÍVEL na grade do calendário** (`AgendaPage.tsx`): helper `conflitosNoDia` (sobreposição real par-a-par de eventos com hora no mesmo dia) → `conflitoIds` (Set) sobre o período visível. Marca com **anel âmbar + ⚠**: nos blocos do `TimeGrid` (Dia/Semana), nos chips do `MesView` (via `EventoChip conflito`) e num badge "⚠ conflito" nas linhas do `ListaView`. **Banner-contador** acima do calendário: "N eventos com conflito de horário neste período" (todas as visões menos Ano).

**Verificado ao vivo (Playwright, 1920×1080):** as duas "Reunião de kickoff" às 10:00 do dia 15 aparecem com anel âmbar+⚠ na Semana e badge "⚠ conflito" na Lista; banner "2 eventos com conflito"; abrir uma delas mostra no form "Você já tem "…TesteCorp…" (10:00–11:00)" com Salvar habilitado. typecheck web+api OK.

**Fase 2 (pendente, quando o dono quiser) — fechar as demais lacunas de aviso** (ver [[sistema-de-alertas-2026-07-14]]): projetos parados+14d/sem responsável/aguardando cliente sem aviso; contas "a vencer" sem chip (janela 3d job × 7d dashboard); upsell "querendo mais" não notifica ninguém; assinatura/proposta parada sem lembrete de aging; ícones do sino (vários tipos caem no genérico). Provável caminho: estender `scanProativo` + os chips de atenção do Início.

## ADR-70 — Sistema de alertas, Fase 2: fechar as lacunas + blindagem ✅

**Contexto:** o dono pediu a Fase 2, disse que **não confiou muito** no aviso de conflito (só via calendário/form) e quis a app **blindada contra erro do usuário e de sistema**. Decisão: reaproveitar a base (scanProativo + chips do Início + sino) — **sem** modelo `Alerta` novo — e reforçar o conflito tornando-o **proativo** (não depende de abrir a Agenda).

**Decisões:**

1. **Chips no "Precisa da sua atenção" (Início)** — 3 novos, imediatamente visíveis (`dashboard.service.ts` + `DashboardPage.tsx`): **conflito de horário na agenda** (todos os papéis; `contarConflitos` sobre hoje+7d da agenda visível), **contas a vencer (7 dias)** e **projetos parados +14d** (gestão). Antes só existiam como número solto.
2. **Varredura proativa (sino) estendida** (`reminders.ts` `scanProativo`) — 4 alertas novos, deduplicados por entidade (`unico`), cada `notificar` protegido com `.catch` (uma falha não derruba o scan): **`conflito_agenda`** (dono + participantes dos eventos concretos dos próximos 7 dias → o conflito chega no sino, não depende de olhar o calendário), **`projeto_parado`** (responsável ou admins), **`projeto_sem_responsavel`** (admins), **`upsell_oportunidade`** (responsável ou admins). Removido o `return` antecipado quando não há admins (os alertas por responsável/dono rodam mesmo assim; contas/docs já toleram lista vazia). Templates registrados em `emails.registry.ts` (in-app; fora de `EMAIL_TIPOS` = sem e-mail).
3. **Ícones do sino** (`NotificationBell.tsx`) — mapa `META` completo: cada tipo (lead_convertido, proposta_aceita, servico_solicitado, presenca_confirmada, conta_a_vencer, etc.) + os novos ganharam ícone/cor próprios (antes caíam no sino genérico).
4. **Blindagem contra erro do USUÁRIO** — `createEventoSchema`/`updateEventoSchema` (shared) agora exigem **fim > início** (refine; extraído `eventoBase` porque refine vira ZodEffects sem `.partial()`/`.extend()` → o router usa `.and()`). Server-side (autoritativo) **e** o form mostra a mensagem "O horário de término deve ser depois do início." (bloqueia salvar).
5. **Blindagem contra erro de SISTEMA** — novo `ErrorBoundary` (`components/ErrorBoundary.tsx`) em volta de `<App>` (`main.tsx`): erro de RENDER vira tela amigável com "Recarregar/Ir para o Início" em vez de tela branca. Complementa as redes já existentes: MutationCache→toast (erros de mutação) e `<QueryError>` (erros de query).
6. **Fechamento — nada pendente** (o dono pediu "não deixe nada em aberto"): (a) **`documento_parado`** — proposta sem aceite / assinatura pendente há +5 dias → sino p/ quem criou + admins, e **chip no Início** "documento(s) parado(s) aguardando o cliente" (`dashboard.service` `docsAguardandoClienteCount`, mesmo limiar de 5 dias). (b) **`lead_parado`** — lead ativo +14d no funil → sino p/ responsável/admins (o chip já existia; agora tem também o aviso ativo). (c) **Janela de contas alinhada**: o scan de "a vencer" passou de ≤3d para **≤7d**, igual ao chip do Início (fim da assimetria 3d×7d).

**Verificado ao vivo (Playwright, 1920×1080):** Início mostra chip vermelho "2 conflito(s) de horário na agenda"; sino com ícones diferenciados (Proposta aceita = check verde, Conta vencida = carteira); editar evento com fim antes do início → bloqueia e mostra a mensagem. typecheck 5/5 pacotes OK. (Alertas de scan = job em background, deduplicados; verificados por implementação + typecheck contra o Prisma Client + `.catch` defensivo.) **Sem dados de teste; navegador em 1920×1080.**

## ADR-71 — Início: fix do recolhimento dos widgets (altura esticada no grid) ✅

**Contexto:** o dono notou que "nem todos os widgets do Início recolhem corretamente". Diagnóstico ao vivo: um widget de meia-largura (ex.: "Minhas tarefas") ao ser recolhido continuava **alto e vazio**, porque o CSS grid (`grid lg:grid-cols-2`) usa `align-items: stretch` por padrão → o card recolhido esticava até a altura do vizinho mais alto da linha ("Sua agenda"). O corpo sumia (`{!recolhido && children}`), mas o `<section>` mantinha a altura da linha.

**Decisão (`DashboardPage.tsx`):** adicionar **`items-start`** aos dois grids de widgets (o de "Meu dia" e o de "Gestão"). Assim cada widget tem **altura natural** — recolhido = só o cabeçalho; expandido = conteúdo completo — sem esticar para acompanhar o vizinho. (Trade-off aceito: widgets expandidos lado a lado não alinham mais o rodapé; é o comportamento correto para blocos recolhíveis.)

**Verificado ao vivo (Playwright, 1920×1080):** recolher "Minhas tarefas" agora encolhe o card ao cabeçalho, com "Sua agenda" ao lado em altura cheia. typecheck (web) OK.

## ADR-72 — Mensagens: passe de acabamento visual/UX (chat "menos cru") + responsivo ✅

**Contexto:** 7ª etapa da revisão página a página. O dono disse que Mensagens estava "muito crua". A página é **funcionalmente rica** (busca, abas de categoria, arquivadas, histórico de chamados resolvidos, fixar/silenciar/arquivar/apagar, editar/apagar mensagem, resolver/reabrir chamado, tempo real por Socket.IO, deep-link da ficha) — o que faltava era **acabamento de chat**.

**Decisões (`MensagensPage.tsx`):**

1. **Balões recebidos legíveis** — antes eram `bg-card` (branco) sobre `bg-muted/10` (quase branco) → praticamente invisíveis. Agora: fundo da thread mais presente (`bg-muted/30`) + balões da equipe com **borda** (`border-border/60 bg-card`), balões do cliente com tom próprio (`bg-brand-blueText/10 + borda`), enviados em `bg-primary`.
2. **Separadores de dia** — chip central "Hoje/Ontem/dd-mm-aaaa" (`diaLabel`) quando muda o dia entre mensagens.
3. **Agrupamento** — mensagens consecutivas do mesmo autor (<5 min, mesmo dia): nome só na 1ª, avatar só na última (com _spacer_ p/ alinhar), espaçamento menor (`mt-0.5` vs `mt-2`) e **cauda** no balão (`rounded-br-md`/`rounded-bl-md`) só na última.
4. **Estado vazio acolhedor** — o painel direito sem conversa saiu de um cartãozinho stark num vazião para: ícone grande, "Suas conversas", descrição e botão **"Nova conversa"** (fundo `bg-muted/20`).
5. **Responsivo (mobile)** — o layout de 2 colunas vira **1 coluna** no celular: `w-full md:w-80` na lista (escondida quando há conversa aberta: `selId ? hidden md:flex`) e a thread escondida quando não há seleção; **botão "‹ voltar"** (`md:hidden`) no cabeçalho da thread.

**Verificado ao vivo (Playwright):** desktop 1920×1080 (2 colunas, separadores, balões com borda, agrupamento) + mobile 390 (lista cheia → abrir vira thread cheia com "voltar"). Navegador devolvido a 1920×1080; sem dados de teste. typecheck (web) OK. **Próxima etapa:** Documentos.

## ADR-73 — Documentos: "Limpar" busca/filtros (revisão página a página, 8ª etapa) ✅

**Contexto:** 8ª etapa. **Documentos** é uma área muito madura (faixa "Precisa de atenção" persistente com pills clicáveis, busca + filtros cliente/tipo/situação, `situacaoDocumento` coerente na tabela; a **ficha** tem folha A4 branded, card de aceite com trilha de auditoria, exportar PDF/Word, editor). Avaliação: **lista e ficha polidas** — só faltava a affordance "Limpar" (padrão dos ADR-65/66/67/73). Modelos e Formulários/Briefings ficam sob **Ajustes** no menu → revisados na etapa de Ajustes.

**Decisões (`DocumentosPage.tsx`):**

1. **Botão "Limpar"** na barra — aparece quando há busca/cliente/tipo/situação ativos (`filtrando`); zera os quatro (`limpar`).
2. **"Limpar filtros" no estado vazio filtrado** — o `EmptyState` "Nenhum documento encontrado" ganhou o botão.

**Verificado ao vivo (Playwright, 1920×1080):** buscar termo inexistente → "Nenhum documento encontrado" + "Limpar filtros" e "Limpar" na barra; clicar restaura os 4 documentos. **Ficha intocada.** typecheck (web) OK. **Próxima etapa:** Financeiro.

## ADR-74 — Financeiro: correção de rótulo enganoso "Para onde foi o dinheiro" (revisão página a página, 9ª etapa) ✅

**Contexto:** 9ª etapa. O **Financeiro** é uma das telas mais bem-feitas (carteiras Empresa/Pessoal/Tudo, herói "Precisa de você" com vencidas/hoje/semana + marcar pago, KPIs por carteira, lista com abas A receber/A pagar + status Pendentes/Pagas/Todas, recorrência, categorias com staging). Avaliação: **não precisa de refino** — só tinha **uma inconsistência semântica** real que confundia. Não é lista com busca (abas/status/carteira = navegação primária), então o padrão "Limpar" não se aplica.

**Bug de clareza:** o card "Resultado do mês" mostra o **realizado** (só contas pagas no mês) → R$ 0 quando nada foi pago. Já o bloco **"Para onde FOI o dinheiro este mês"** contava `porCategoria` = **todas** as contas com vencimento no mês (pagas **e** pendentes). Ou seja, o título dizia "dinheiro que já saiu" (passado) mas mostrava o **comprometido** — contradizendo o "Resultado do mês R$ 0" e confundindo o leigo.

**Decisão (`FinanceiroPage.tsx`, componente `ParaOndeVai`):** manter o **dado** (ver o comprometido do mês por categoria é útil para planejar) e **corrigir o rótulo** — de "Para onde foi o dinheiro este mês" para **"Contas do mês por categoria"** + subtítulo **"Tudo com vencimento neste mês — pago ou a pagar."**. Agora "Resultado do mês" (realizado) e "Contas do mês por categoria" (comprometido) coexistem sem contradição.

**Verificado ao vivo (Playwright, 1920×1080):** o bloco mostra o novo rótulo + subtítulo; KPIs, herói e lista intactos. typecheck (web) OK. **Próxima etapa:** Ajustes (e as filhas: Serviços, Equipe e acessos, E-mails, Modelos, Briefings, Configurações).

## ADR-75 — Ajustes e filhas: consistência de nomes (renames) + "Limpar" (revisão página a página, 10ª etapa) ✅

**Contexto:** 10ª etapa. O **hub Ajustes** (`AjustesPage`) e as filhas foram revisados um a um. Quase tudo já é **maduro e excelente** — Serviços (catálogo agrupado por categoria + Configurar + arrastar), Modelos de documento (agrupado por ciclo VENDER/FECHAR/O CLIENTE ENVIA/REUNIÃO/ENTREGAR, briefings integrados), Mensagens automáticas (lista + editor + prévia ao vivo brandada, abas), Configurações (perfil/senha/notificações por e-mail). Só havia **rótulos desatualizados** de renames antigos + falta do "Limpar" numa tela com filtros.

**Decisões:**

1. **`UsuariosPage`** — o H1 ainda dizia "**Usuários & acessos**", mas menu/hub/breadcrumb já eram "**Equipe e acessos**". Alinhado (+ botão do estado vazio "Novo usuário" → "Convidar usuário").
2. **`EmailsAdminPage`** — o H1 ainda dizia "**Comunicações**" (nome antigo); menu/hub/breadcrumb já eram "**Mensagens automáticas**". Alinhado.
3. **`EmailsEnviadosMonitorPage`** — tem 4 filtros (status/tipo/período/busca) mas não tinha reset; adicionado **botão "Limpar"** (aparece quando algo difere do padrão: status≠todos, tipo, busca, ou período≠7d).

**Verificado ao vivo (Playwright, 1920×1080):** hub + 6 filhas conferidas; a aba/H1 de Usuários mostra "Equipe e acessos"; o filtro "Falhas" em E-mails enviados revela o "Limpar" (e reseta). typecheck (web) OK. Serviços/Modelos/Mensagens-automáticas/Configurações **intactas** (já ótimas). **Próxima etapa:** Sistema (ROOT).

## ADR-76 — Sistema (painel ROOT): auditoria, sem mudanças + verificação de drift schema×banco ✅

**Contexto:** 11ª etapa. O painel **Sistema** (`SistemaPage`, só-ROOT — Thaís nem vê) é um dos mais completos: status geral + chips de saúde (banco/event-loop/jobs/erros/tempo-real), 8 abas (Visão geral, Incidentes, Desempenho, Banco, Erros, Sessões, Atividade, Manutenção), "Saúde do servidor" (uptime/heap/loop/tráfego/conexões/IA/jobs), "Precisa de atenção" (erros/contas/docs/projetos/leads/usuários/sessões), Diagnóstico com IA + Rodar varredura + Copiar diagnóstico. Avaliação: **já excelente — nenhuma mudança de código.** Sem lista com busca (Erros usa Ativos/Ocultos; não há filtro a "limpar").

**Verificação (não deixar nada latente):** a aba Erros mostrava um erro **Aberto** de 2 dias atrás — `prisma.documento.findMany` reclamando que a coluna `Documento.propostaToken` "não existe". Verifiquei **direto no MySQL** (`information_schema.COLUMNS`): **todas as colunas `proposta*` existem** (propostaToken/Status/Hash/SolicitadaEm/RespondidaEm/RespIp/MotivoRecusa) e a migração `20260711220000_proposta_aceite_online` está aplicada. Ou seja: **sem drift schema×banco** — o erro é histórico (1 ocorrência, antes da migração ser aplicada neste banco), a página Documentos funciona. O ROOT pode só marcar "Resolver". O rastreamento de erros está **funcionando como projetado**.

**Conclusão:** Sistema **intacto** (já ótimo) + consistência do banco confirmada. **Próxima etapa:** Portal do Cliente (a última da revisão).

## ADR-77 — Portal do Cliente: auditoria ao vivo (revisão página a página, 12ª e última etapa) ✅

**Contexto:** última etapa da revisão. O **Portal do Cliente** (`PortalHome`/`PortalLayout` + PortalServicos/PortalSuporte/SuporteChat/BriefingDialog/PortalDocumentoModal) é o produto cliente-facing (role CLIENTE, login separado). Revisado **ao vivo** logando como o cliente de teste (Acme) e depois restaurando o Root.

**Avaliação — excelente, sem mudanças.** Cobre: boas-vindas + foto/logo (upload), "Seu atendimento" (progresso do funil em linguagem amigável) / retomar se encerrado, serviços contratados + o que o cliente precisa enviar (PortalServicos), autosserviço "O que você precisa?" (vira oportunidade no funil), Propostas para aceite, Documentos para assinar, Suporte (chat), "O que depende de você", Seus projetos (progresso), Documentos (com selo Aceita/Assinado), Seus e-mails, Próximas reuniões (confirmar presença + .ics + entrar). Estados vazios amigáveis, ações claras, confirmações nas destrutivas. **Responsivo:** layout `max-w-4xl` centrado funciona em desktop e empilha bem no mobile (390px) — verificado.

**Método de revisão (round-trip seguro):** logar como CLIENTE troca o cookie do Root na sessão do navegador de teste; como os clientes de teste usam a mesma senha de seed do `.env`, fiz login como `cliente@medconsultoria.com.br`, revisei, e voltei como `root@medconsultoria.com.br` — sessão restaurada, navegador em 1920×1080. **Nada alterado no código.**

**🏁 Revisão página a página COMPLETA** (Início→Vendas→Clientes→Projetos→Agenda→Mensagens→Documentos→Financeiro→Ajustes+filhas→Sistema→Portal). Padrão geral: app **madura e consistente**; os refinos foram microajustes de clareza (affordance "Limpar", rótulos/nomes) + 2 telas com trabalho de verdade (Início personalizável ADR-64, Mensagens acabamento de chat ADR-72) + o sistema de alertas (ADR-69/70).

## ADR-78 — Auditoria de integrações + contrato automático ao aceitar a proposta + Suporte em evidência ✅

**Contexto:** o dono pediu para **auditar todo o app** (garantir tudo funcionando/integrado/automatizado) — com o exemplo: **proposta aceita → gerar contrato automático** com os serviços contratados e as **cláusulas de cada serviço**, em REVISÃO para a equipe enviar para assinar. E deixar o **Ticket de Suporte em evidência** (estava no fim da ficha e do Portal). Duas auditorias (subagentes) mapearam as cadeias comercial/operacional e de documentos.

**Auditoria — o que já FUNCIONA (sólido):** conversão lead→cliente (cliente + ClienteServico + 1 projeto/serviço com roteiro + conta a receber + kickoff na Agenda + Portal + contrato em revisão); cadeia de fulfillment (upload/briefing → checklist → card → projeto, bidirecional); auto-avanço do funil por checklist; recorrência do Financeiro sem cron; situação do cliente = reflexo do funil. **Lacunas encontradas:** (1) aceite de proposta NÃO gerava contrato; (2) cancelar serviço não propagava (projeto/cobrança seguiam); (3) contratar serviço na ficha não gerava cobrança; (4) % do faturamento nunca vira conta (mantido).

**Decisões implementadas:**

1. **Contrato automático ao aceitar** — `responder` (aceite, `propostas.service`) passou a chamar `gerarContratoAutoParaLead` (resolve o lead pelo `clienteId`; autor = `criadoPorId` da proposta; import dinâmico p/ evitar ciclo). O contrato **nasce EM_REVISÃO** e notifica o responsável (`documento_revisao`) — reaproveita a máquina que já existia (só não era chamada no aceite). Idempotência reforçada: não duplica se já houver contrato do cliente.
2. **Cláusulas por serviço** — novo campo **`Servico.clausulasContrato`** (migração `20260714114941_add_servico_clausulas`), semeado com textos profissionais dos 10 serviços (`CLAUSULAS_SERVICOS` em `servicos.service`), **backfill idempotente** em `seedIfEmpty` (só onde NULL). O construtor do contrato (`gerarParaLead`, ramo contrato) monta o `{{objeto}}` = cada serviço contratado **+ suas cláusulas** (robusto: usa `{{objeto}}` que existe em todo contrato, sem depender de re-seed do modelo). UI: aba **Detalhes** dos Serviços ganhou o campo "Cláusulas do contrato" (schema `updateServicoSchema`/`createServicoSchema` + `atualizarServico`).
3. **Gap 2 — cancelar serviço propaga:** `cancelarServicoCliente` **pausa o projeto** daquele serviço (`clienteId+servicoId` → PAUSADO). A cobrança NÃO é apagada automaticamente porque a "Mensalidade" **agrega vários serviços** (Conta não tem `servicoId`) — apagar tiraria a dos outros; a equipe revisa.
4. **Gap 3 — contratar na ficha gera cobrança:** `ativarServicoCliente` (origem MANUAL, contratação NOVA, valor de referência > 0) **cria a conta a receber** no Financeiro (avulso/mensal conforme o serviço) — antes só a conversão fazia isso.
5. **Suporte em evidência:** o card "Chamados de suporte" subiu para o **2º da coluna** na ficha do cliente (logo após Serviços contratados), com destaque (borda/anel primário + ícone azul + subtítulo). No Portal, `<PortalSuporte>` subiu para o **topo** (antes de "Serviços") e ganhou destaque (borda primária + subtítulo "Fale direto com a nossa equipe").

**Verificado:** typecheck 5/5; migração aplicada (MODO PAUSA) e coluna conferida no MySQL; backfill preencheu os 10 serviços; a aba Detalhes mostra as cláusulas; o card de Suporte aparece em 2º na ficha. **O fluxo ponta-a-ponta (aceitar proposta → contrato gerado com cláusulas) fica para o teste-de-usuário do dono** (a lógica segue o padrão auditado de `gerarPropostaAutoParaLead`, que já funciona).

## ADR-79 — Portal do Cliente: redesign (upload de documentos do cliente + separação Med×cliente + foto no header + polish) ✅

**Contexto:** o dono achou o Portal "cru e sem design" e pediu: (a) lugar para o cliente **fazer upload dos seus documentos** (RG, CPF, CRM… que os serviços exigem); (b) **diferenciar** "Documentos da MedConsultoria" (proposta/contrato/briefing) × "Documentos do cliente" (RG/CPF…) sem confundir; (c) **tirar a foto do topo** e pôr no **header** (config de perfil); (d) refinar todo o Portal — profissional, elegante, inteligente. **Descoberta:** o backend já suportava tudo — `/upload` grava no cadastro do próprio cliente do Portal (seguro, `user.clienteId`), aceita upload **geral** (sem serviço/requisito → contexto "Geral"), e `portal.arquivos`/`portal.removerArquivo` já existiam. Faltava só a UI.

**Decisões:**

1. **Header profissional** (`PortalLayout` reescrito): header sticky com blur; a foto saiu do corpo e virou um **menu de perfil** (`ProfileMenu`) no canto — avatar+nome → dropdown (nome/e-mail, **"Alterar foto"** abre modal com `AvatarUpload`, **"Sair"**). Fundo da página `bg-muted/30`.
2. **"Seus documentos"** (novo `PortalMeusDocumentos`): card com **"Enviar um documento"** (upload geral, `campos={{}}`) + lista de tudo que o cliente enviou (`portal.arquivos`), com selo Você/MedConsultoria e remover (só os do cliente). Espelha o `DocumentosClienteCard` do lado-equipe.
3. **Separação clara:** o card antigo "Documentos" virou **"Documentos da MedConsultoria"** + subtítulo "Propostas, contratos e atas que preparamos para você"; logo abaixo, **"Seus documentos"** + subtítulo "Os documentos que você envia para nós — RG, CPF, CRM…". Selo dos arquivos do cliente = "Você" / "MedConsultoria".
4. **Polish** (`PortalHome`): removido o card de avatar do topo (+ imports órfãos `useAuth`/`AvatarUpload`/`removerAvatar`); boas-vindas refinadas; Suporte segue em destaque no topo (ADR-78).

**Verificado ao vivo (Playwright, login como cliente Acme → restaurado Root):** desktop 1920×1080 + mobile 390 — header com menu de perfil (foto/sair), "Seus documentos" com envio + vazio amigável, "Documentos da MedConsultoria" rotulado. typecheck (web) OK; sem dados de teste. **A seguir (pedido do dono):** lapidar as páginas **Modelos de documento** e **Documentos** (Ajustes).

## ADR-80 — Portal: "Editar perfil" com dados cadastrais autoeditáveis pelo cliente (LGPD) ✅

**Contexto:** após o redesign (ADR-79), o dono relatou que o modal de perfil **buga ao "Alterar foto"** (não fechava) e pediu que o botão do header abrisse um **"Editar perfil"** de verdade, onde o cliente edita **os próprios dados cadastrais** (nome, empresa, telefone, e-mail, CPF/CNPJ…), **dentro da LGPD** (acesso + retificação dos próprios dados; nada de campos internos).

**Causa do bug (corrigida antes):** o `Modal` (position:fixed) estava sendo renderizado **dentro do `<header>`**, que tem `backdrop-blur` — um ancestral com `backdrop-filter`/`filter`/`transform` reposiciona descendentes `position:fixed` para dentro da sua caixa, prendendo o modal. **Fix:** o `EditarPerfilModal` passou a ser renderizado no **corpo do `PortalLayout`**, fora do header. O menu do header virou `ProfileMenu` (avatar+nome → **Editar perfil** / **Sair**).

**Decisões:**

1. **Escopo LGPD no backend** (`portal.service.ts`): `meusDados(clienteId)` retorna só o subconjunto seguro (`nome`, `tipo`, `documento`, `email`, `telefone`) e `atualizarMeusDados(clienteId, userId, dados)` grava **apenas esses campos** — sempre escopado ao `ctx.clienteId` da sessão (o cliente nunca alcança outro cadastro). Sincroniza `User.nome` (nome de exibição do Portal) com o cadastro e registra `ActivityLog` `cliente.dados_atualizados_portal` (trilha de retificação). Nunca expõe responsável, situação comercial nem observações da equipe.
2. **Schema dedicado** (`packages/shared/schemas/cliente.ts`): `portalMeusDadosSchema` (subconjunto do cadastro; reaproveita `clienteTipoEnum`/`emailOpcional`/`textoOpcional`). Endpoints `portal.meusDados` (query) e `portal.atualizarMeusDados` (mutation) com `portalProcedure`.
3. **UI** (`EditarPerfilModal` expandido, `size="lg"`): foto/logotipo (`AvatarUpload`) + seção **"Seus dados cadastrais"** com Nome (rótulo muda "Nome da empresa/clínica"×"Nome completo" pelo tipo), Tipo (PJ/PF), CPF/CNPJ (`MaskedInput` `maskCpfCnpj`, rótulo e placeholder pelo tipo), E-mail e Telefone (`MaskedInput` `maskTelefone`) + **nota LGPD** (Lei nº 13.709/2018) com ícone de cadeado. Salvar invalida `auth.me`/`portal.meusDados`/`portal.resumo`.

**Verificado ao vivo (Playwright, login cliente Acme → restaurado Root):** modal abre carregando os dados reais (Acme Saude, PJ, CNPJ, joao@acme.com), edição do telefone persiste no MySQL como valor mascarado `(11) 98765-4321` e o `ActivityLog` é gravado; modal fecha ao salvar. typecheck 5/5; dado de teste revertido; navegador em 1920×1080.

## ADR-81 — Documentos inteligentes: motor de contexto do cliente + Contrato construtor + auto-preenchimento + aceite→contratado ✅

**Contexto:** o dono pediu que o "Novo documento" fique inteligente para **todos** os tipos (não só a Proposta), com destaque para o **Contrato** (construtor de serviços/valores/prazos + cláusulas, como a proposta) e uma visão maior: **ao escolher o cliente, o sistema entende o que ele precisa e pré-preenche tudo** (ex.: "Contrato + Acme" → lê o que o Acme aceitou na proposta e preenche). Editável. Decisões do dono (AskUserQuestion): **sincronizar** aceite→serviços contratados; construir **tudo em fases**.

**Diagnóstico:** só a Proposta era inteligente; o resto caía em campos genéricos. Ao escolher o cliente, só nome/e-mail/CPF-CNPJ/telefone eram aproveitados — os **serviços contratados com preços reais** (`ClienteServico`), as **cláusulas** e a **proposta aceita** eram ignorados. O contrato automático usava textos genéricos ("Conforme os valores da proposta…").

**Decisões (4 fases, todas FEITAS):**

1. **Persistência estruturada** — nova coluna **`Documento.itens Json?`** (migração `20260714130226_add_documento_itens`): os itens (serviço + valor + recorrência + %) por trás do Markdown. `criarProposta` (comercial) e `criarContrato` gravam. É o que permite o aceite saber o que sincronizar.
2. **Motor de contexto** (`documentos.service.ts`): `itensDoCliente(clienteId)` resolve os serviços do cliente por prioridade **ClienteServico ATIVO (valores reais) → serviços do lead ativo (catálogo) → vazio**; `contextoClienteDoc({clienteId,tipo})` (query tRPC `documentos.contextoCliente`) devolve itens + investimento agregado + proposta aceita + **sugestões** (valor mensal, lista de serviços, "referente"). Reaproveita o helper único `montarServicos(itens, servicos)` (extraído da proposta) para tabela + investimento.
3. **Contrato inteligente** — `criarContrato` (schema `criarContratoSchema`; router `documentos.criarContrato`): monta `{{objeto}}` (cada serviço + preço + **cláusula** `Servico.clausulasContrato`), tabela real de `{{valor}}`, `{{prazo}}` a partir de **Vigência** (6/12/24/36 meses) e `{{foro}}`. No dialog, o modo **CONTRATO** reusa o `PropostaServicosPicker` (prop `titulo="Serviços do contrato"`) **pré-marcado** pelo contexto do cliente; prévia A4 ao vivo.
4. **Auto-preenchimento por cliente** (dialog `NovoDocumentoDialog`): ao escolher cliente+modelo, `contextoCliente` pré-preenche **uma vez por (cliente×modelo)** sem sobrescrever edições — Contrato (serviços marcados com valores reais), **Recibo** (valor + "referente a" + por extenso automático), e **genéricos** (Escopo, etc.) por inferência do nome do campo (`objeto/escopo/servi/atividade`→lista de serviços; `valor/mensal`→investimento; `referente`→nomes).
5. **Aceite → serviços contratados** (`propostas.service.ts responder`): ao ACEITAR, `sincronizarServicosContratados(clienteId, doc.itens)` faz **upsert** de `ClienteServico` (origem FUNIL) com os valores aceitos — **sem criar cobrança** (a conversão cria a conta agregada; evita duplicar). Assim contrato/recibo/ficha refletem **exatamente o aceito**. O contrato automático (`gerarContratoAutoParaLead`) agora usa `itensDoCliente` → `criarContrato` (valores reais + cláusulas + vigência), com fallback ao gerador genérico.

**Verificado ao vivo (Playwright, Root):** (a) Contrato + Clinica Vida Plena → pré-marcou "Gestão Operacional" R$ 3.500/mês; gerado com `{{objeto}}`=serviço+cláusula real, `## Valor` = "Mensal R$ 3.500,00/mês", `## Prazo` = "12 (doze) meses…", dados do cliente reais (CNPJ/e-mail). (b) Fluxo ponta-a-ponta: criei proposta p/ Acme (Gestão de redes sociais R$ 1.800/mês) → habilitei aceite → aceitei no link público → **ClienteServico criado** (ATIVO, FUNIL, 1.800, MENSAL) → Contrato+Acme já puxou o serviço aceito com o valor real. (c) Recibo + Clinica Vida Plena → valor/refente/por-extenso auto. **Modelos:** os 15 modelos de texto auditados — todos coerentes e ligados ao seu handler; nenhum conteúdo precisou mudar (o ganho foi no motor). typecheck 5/5; dados de teste removidos; navegador 1920×1080.

**Refinamentos (follow-up do dono):**

1. **Cláusulas dos serviços em seção própria** — o dono não via as cláusulas (ficavam concatenadas no Objeto). Agora o `{{objeto}}` é só a **lista** enxuta (serviço + preço) e as cláusulas viram a **Cláusula 9 "Condições específicas dos serviços"** via novo marcador **`{{clausulas_servicos}}`** — cada serviço contratado como `### Nome` + sua cláusula (`Servico.clausulasContrato`, editável em Ajustes → Serviços; serviço sem cláusula recebe texto neutro). **Personalizado automaticamente pelo que o cliente contratou** (só os serviços dele entram — não polui com cláusulas de serviços não contratados). `criarContrato` + `gerarParaLead` (fallback) + a prévia do dialog montam a seção; o template CONTRATO ganhou a seção 9 (re-seed automático, `editadoManualmente=false`). **GOTCHA:** o re-seed só roda quando `documentos.modelos.list` é consultado; se o tsx-watch não recarregou o `modelos.service.ts`, reiniciar via MODO PAUSA.
2. **Contrato automático para cliente já convertido** — no aceite do Acme o contrato não gerava porque `gerarContratoAutoParaLead` **exigia lead ativo** (`convertidoEmClienteId: null`), e o Acme já é convertido. Novo **`gerarContratoAutoParaCliente(clienteId, userId, {leadId?})`** gera **a partir do cliente** (não do lead); `gerarContratoAutoParaLead` virou atalho que delega. O aceite (`propostas.service`) chama o gerador por cliente direto. **Recibo NÃO é gerado no aceite** (recibo = valor recebido; seria falso antes do pagamento) — fica a 1 clique com valor auto-preenchido; alternativa oferecida ao dono: gerar uma cobrança no Financeiro no aceite (não implementado, aguardando decisão). **Verificado:** aceite de proposta do Acme (Gestão Operacional + Faturamento) → **contrato gerado automaticamente EM_REVISÃO** com Objeto=lista e **Cláusula 9 com `### Gestão Operacional` e `### Faturamento`** (cada uma com sua cláusula) + 2 ClienteServico sincronizados. typecheck 5/5; dados de teste removidos.

## ADR-82 — Scroll nativo da janela (reverte o "cabe na tela" dos ADR-44/59) ✅

**Contexto:** o dono não gostou do scroll acontecer **dentro de um container interno** (o `<main>` era o viewport e o conteúdo rolava por dentro) — quis o **scroll normal do navegador** (a janela rola, barra na borda direita).

**Decisão (só no `AppLayout.tsx`):** a cadeia de scroll foi trocada por scroll de janela:

- Raiz `flex h-screen` → **`flex min-h-screen`** (cresce com o conteúdo).
- **Sidebar** e **cabeçalho** ficam fixos via **`sticky`** (aside: `sticky top-0 h-screen self-start`; header: `sticky top-0 z-30`) — acompanham a rolagem.
- Coluna de conteúdo perdeu o `overflow-hidden`; o `<main>` perdeu `min-h-0/flex-col/overflow-hidden` (virou `flex-1`); o **container interno** perdeu `flex-1/min-h-0/overflow-y-auto` (virou só `mx-auto max-w-[1600px] p-…`, altura natural). Sem nenhum `overflow` na cadeia → **a janela (documentElement) rola**.

**Efeito nas páginas:** as que usavam `h-full flex flex-col` + `flex-1 min-h-0 overflow-y-auto` degradam com elegância — o `h-full` resolve para altura automática e o conteúdo flui (a janela rola em vez do container). **Trade-offs aceitos** (inerentes ao scroll de janela): Mensagens (chat) fica com painéis de altura de conteúdo (não mais tela cheia) e Agenda semana/dia rola a grade de 24h inteira (o cabeçalho dos dias sai de vista ao rolar). Nenhuma página quebrou.

**Verificado ao vivo (Playwright, 1920×1080, Root):** Início/Vendas/Clientes/Agenda/Mensagens — `documentElement` rolável, **sem scrollers internos grandes**, sidebar+cabeçalho fixos ao rolar, conteúdo completo visível. typecheck web OK. **Obs.:** revoga o "NUNCA `<main>` overflow-y-auto / sem scroll de página" dos ADR-44/59 — agora o padrão é **scroll de janela**; páginas novas NÃO devem prender o scroll num container.

## ADR-83 — Exceção "tela cheia" (Mensagens/Agenda) ao scroll de janela + divisor arrastável nas Mensagens ✅

**Contexto:** após o ADR-82 (scroll de janela global), o dono viu que **Mensagens** e **Agenda** ficaram ruins: o chat/agenda deve ter **painéis de altura fixa com scroll INTERNO** (a página não pode rolar), como era antes. Além disso, pediu na Mensagens um **divisor vertical arrastável** entre a lista de conversas e as mensagens (estilo WhatsApp).

**Decisões:**

1. **Exceção por rota no `AppLayout`** (`telaCheia = pathname.startsWith("/mensagens") || pathname.startsWith("/agenda")`): para essas rotas o `<main>` volta a ser o viewport — **`h-[calc(100dvh-4rem)] overflow-hidden`** (altura = tela − cabeçalho h-16; necessário porque a raiz é `min-h-screen` e sem altura fixa a coluna cresceria e a janela rolaria) + container `flex-1 min-h-0 overflow-hidden`. A própria página (`h-full`) preenche e rola por dentro. Todas as outras rotas seguem no scroll de janela (ADR-82).
2. **Divisor arrastável** (`MensagensPage`): a lista de conversas ganhou largura ajustável via CSS var `--lista-w` (`md:w-[var(--lista-w)]`); novo elemento divisor (`cursor-col-resize`, só desktop) com handler `iniciarRedimensionar` (pointerdown → pointermove na window, clamp **240–560px**, `userSelect/cursor` travados durante o arraste). Largura **persistida** em `localStorage` (`mensagens:larguraLista`); **duplo-clique** reseta para 320px. Thread ganhou `min-w-0` para encolher direito.

**Verificado ao vivo (Playwright, 1920×1080, Root):** Mensagens — janela NÃO rola (1080=1080), lista e thread rolam por dentro, divisor arrasta 320→470px e persiste, duplo-clique volta a 320. Agenda Semana — janela não rola, a grade (`min-h-0 flex-1 overflow-y-auto`) rola por dentro com o cabeçalho dos dias fixo (idem Dia/Lista). Documentos/Início seguem no scroll de janela (`main=flex-1`). typecheck web OK.

## ADR-84 — Tempo real por polling (Opção A), sem WebSocket nem VPS ✅

**Contexto:** a hospedagem (TineHost, LiteSpeed/lsnode) **não faz upgrade de WebSocket** — o suporte confirmou que só numa VPS — e ainda bufferiza o long-polling do Socket.IO, então o tempo real do Socket.IO não chegava em produção. O tempo real do app é pequeno (chat de Mensagens, Suporte e sininho); o resto (Início/Sistema/Vendas) já era por polling.

**Decisão:** entregar o tempo real por **POLLING** (`refetchInterval`), o mesmo caminho HTTP curto que o proxy já entrega sem bufferizar. **Não contratamos VPS.**

- `apps/web/src/lib/socket.ts`: `POLL` (intervalos num lugar só) + `REALTIME_SOCKET_ENABLED = !import.meta.env.PROD || VITE_REALTIME === "1"`.
- Socket.IO fica **desligado no build de produção** (ligado só em dev/testes, onde funciona) — senão abriria conexões long-poll penduradas no LiteSpeed. Cada `useEffect` de socket respeita o gate.
- Intervalos: Mensagens 4s (conversa aberta) / 8s (lista); Suporte 6–15s; sininho 20s.
- Guarda `apps/web/src/lib/socket.test.ts`. Servidor Socket.IO intacto; religa via `VITE_REALTIME=1` (se um dia vier VPS ou serviço externo tipo Pusher/Ably).

**Verificado:** typecheck+testes verdes; deploy 24/07 no ar servindo o build novo. Revoga a necessidade do "proxy WS" citada nas pendências.

## ADR-85 — Identidade institucional editável (Dados da empresa) ✅

**Contexto:** os dados jurídicos da empresa (razão social, CNPJ, endereço, foro) estavam engessados/nulos no código (`institucional.ts`) — só a Thaís pode fornecê-los. O dono pediu tudo **configurável pela tela, nada engessado**.

**Decisões:**

1. Modelo `IdentidadeInstitucional` (linha única, `id: "default"`), migração aditiva. A **fonte da verdade vira o banco**; as constantes de `institucional.ts` viram padrão/fallback.
2. Módulo `apps/api/src/modules/identidade/`: `get` (funcionarioProcedure) + `atualizar` (adminProcedure). `getIdentidade()` semeia a linha na 1ª leitura (upsert) com os dados de contato reais; jurídicos começam **null** — ninguém inventa CNPJ.
3. `qualificacaoContratada(d?)`/`rodapeInstitucional(d?)` (shared) aceitam os dados do banco; marcador `**[A PREENCHER]**` só quando vazio. `documentos.service.ts` (contrato manual e auto do lead) lê CONTRATADA e foro do banco.
4. UI: `IdentidadeDialog` em **Ajustes → Administração**, card visível só p/ ADMIN+ (`minRole` na AjustesPage). Guia "?" de Ajustes menciona.

**Verificado:** typecheck api+web; API 79/79; web 32/32; migração `CREATE TABLE`. **No servidor (24/07):** migrate deploy 53/53, client regenerado (conhece o modelo), query e upsert OK, linha semeada (jurídicos null). **PENDENTE (Thaís):** preencher os dados jurídicos pela tela.

## ADR-86 — Backup automático + health-check no servidor (ops de produção) ✅

**Contexto:** app no ar em produção, mas sem backup automático nem monitoramento — a única pendência de infra do CLAUDE.md §12 ainda aberta. Hospedagem compartilhada (TineHost, sem painel de backup gerenciado para o banco da app).

**Decisões** (scripts versionados em `scripts/server/`, instalados em `~/domains/.../ops/`, agendados no cron do usuário — preservando o cron pré-existente de outro domínio):

1. **Backup diário** (`backup-db.sh`, 03:00 BRT): `mysqldump --single-transaction --quick` + gzip, **rotação de 14 dias**. Parse do `DATABASE_URL` via Node (lida com URL-encoding na senha); `set +u` ao redor do `activate` do CloudLinux (não é nounset-safe). Testado (gerou dump de 20K).
2. **Health-check + auto-restart** (`healthcheck.sh`, a cada 5 min): `curl /health`; 2 falhas → `touch tmp/restart.txt` (lsnode respawna). Cobre app **travado**, não queda do host.
3. **Instalador idempotente** (`install-cron.sh`): só anexa o que falta ao crontab.

**Limites reconhecidos (ação do dono):** backups ficam **no mesmo servidor** (protegem contra erro lógico, não contra perda do host) e `uploads/` ainda não é copiado; o health-check **não alerta** se o servidor inteiro cair. **RECOMENDO:** monitor de uptime **externo** (UptimeRobot grátis) + cópia periódica dos dumps para fora do servidor. Ver DEPLOY.md § Passo 10.

## ADR-87 — SISTEMA aba "Operação" + alerta de app-fora ao ROOT ✅

**Contexto:** o dono quer a SISTEMA como cockpit completo do ROOT e ser avisado quando o sistema cair. **Verificação antes de construir:** o ROOT **já recebe e-mail** de incidentes (`notificarRoot`) e de erros novos/regressões (`notificarRootErro`) — tipos `incidente`/`erro` são emailáveis (`minRole: ROOT`, templates no `emails.registry`). Só faltava (a) visibilidade dos backups/reinícios e (b) o aviso quando o app está **totalmente fora** (aí o próprio app não envia e-mail).

**Decisões:**

1. **Aba "Operação"** (`SistemaPage`, `sistema.operacao` — rootProcedure): backups automáticos (último/quantidade/espaço + **"Fazer backup agora"** que executa `OPS_DIR/backup-db.sh`), reinícios do health-check (tail do `health.log`) e estado dos alertas (e-mail real? quais tipos vão ao ROOT). Caminhos por `BACKUPS_DIR`/`OPS_DIR` (env do servidor); no dev degrada para "disponível no servidor".
2. **Alerta de app-fora** no `healthcheck.sh` (cron): ao detectar queda + restart, envia e-mail ao ROOT via **sendmail local** — funciona MESMO com o app fora (o ponto cego de qualquer monitor interno). Cooldown de 30 min (não spamma).
3. **Não** adicionamos monitor externo pago (UptimeRobot) nem APM — desnecessário para ferramenta interna; o combo health-check-que-reinicia-e-avisa + monitores do host cobrem o caso real. Monitor externo fica como recomendação opcional ao dono (queda total do host).

**Verificado:** typecheck api+web; API 79/79; web 32/32; rota carregada (401 = protegida). Deploy: `BACKUPS_DIR`/`OPS_DIR` no `.env` do servidor + `healthcheck.sh` atualizado.

## ADR-88 — Seção "Tarefas" (delegação interna entre a equipe) ✅

**Contexto:** o dono quer um lugar para a equipe **delegar/pedir coisas entre si** ("me resolve isso"), no estilo Projetos mas para pedidos interpessoais. Requisito nº 1: **não confundir** o usuário. **Verificação antes de construir:** o app já tinha "tarefa" parcial no model `Card` (preso a um `Projeto`, com `responsavel/prazo/prioridade/status` e `notificar("tarefa_atribuida")`). A decisão de arquitetura: **reusar `Card` vs criar `Tarefa` novo**.

**Decisões:**

1. **Model `Tarefa` NOVO** (não estender `Card`). Reusar `Card` exigiria tornar `projetoId` opcional, adicionar "quem pediu" e mexer no kanban (colunas, auto-conclusão do projeto, links `/projetos/$id`, scan) — **borraria a fronteira Projetos×Tarefas** que o próprio requisito pede manter clara. Campos: `criadoPor`/`responsavel` (obrigatórios), `prazo?`, `prioridade` (BAIXA/NORMAL/ALTA), `status` (PENDENTE/FAZENDO/CONCLUIDA), `cliente?`/`projeto?` (contexto opcional). Fronteira: **Projetos** = entrega do cliente · **Tarefas** = pedido entre pessoas · **Agenda** = hora marcada · **Mensagens** = conversa.
2. **UI a prova de leigo:** abas **Comigo** (sou responsável) / **Deleguei** (eu pedi) / **Da equipe** (só ADMIN+) + filtro Abertas/Concluídas/Todas. Módulo tRPC `tarefas` em `funcionarioProcedure` (exclui o Portal). Notificações próprias `tarefa_delegada`/`tarefa_concluida` (emailáveis, no `emails.registry`); rota da entidade `tarefa` → `/tarefas`. Botão **"Delegar tarefa"** na ficha do cliente e no projeto (nasce com contexto).
3. **Início unifica o "o que tenho hoje":** widget **"Pedidos comigo"** (→ /tarefas) + chip de atenção "pedido(s) atrasado(s) comigo". O widget/KPI de cards de projeto foi renomeado "Minhas tarefas" → **"Meus cartões"** (desfaz o choque de nome com a nova seção).
4. **Agenda NÃO recebeu as tarefas (de propósito):** a Agenda é um componente de **5 visões sobre `Occ`** (sem modelo de item compartilhado); injetar tarefas ali seria invasivo/frágil e confuso ("por que aparece na Lista mas não no Mês?"). A unificação ficou no Início, com risco muito menor. Reavaliar num PR próprio se o dono quiser tarefas literalmente no calendário.

**Verificado:** typecheck api+web limpo; lint 0 erros; teste de cobertura do guia OK; ao vivo (local) criar→status→excluir e Início com os widgets novos.

## ADR-89 — Múltiplos ROOTs + root primordial imutável ✅

> _Registrado retroativamente em 03/08/2026: a feature foi ao ar no PR #73 (28/07) sem virar ADR._

**Contexto:** o dono precisa que Thiago e André tenham acesso ROOT nominal (auditoria: saber **quem** fez o quê), mas o RBAC anterior (ADR-43) proibia atribuir papel igual ou acima do próprio — nenhum ROOT conseguia criar outro ROOT. O risco oposto é pior: se todos os roots forem rebaixados/excluídos, **a aplicação fica sem super-admin e sem como voltar** (não há console de recuperação numa hospedagem compartilhada).

**Decisões:**

1. **ROOT pode atribuir qualquer papel, inclusive ROOT** — `assertPodeAtribuir` ganhou `if (atorRole === "ROOT") return;`. A hierarquia estrita do ADR-43 continua valendo para ADMIN e abaixo.
2. **Um root primordial imutável** (`config.ROOT_PROTEGIDO_EMAIL`, padrão `root@medconsultoria.com.br`): não pode ser rebaixado, desativado nem excluído — nem por outro ROOT, nem por si mesmo. É a garantia de que sempre existe uma porta de entrada. Os **demais** roots são livremente alteráveis entre si.
3. **Escolhido e-mail de config, não uma flag no banco.** Uma coluna `protegido` seria editável por quem tivesse acesso ao banco (e um `UPDATE` errado destrava a proteção sem deixar rastro); a config vive no `.env` do servidor, fora do alcance da aplicação.
4. **A trava é do servidor; a UI só reflete.** `updateUsuario`/`deleteUsuario` lançam `FORBIDDEN`; a tela desabilita papel/situação e mostra o selo **"principal"** (`listUsuarios` devolve `protegido`). Nunca confiar só no front.

**Verificado:** 3 roots em produção, login dos dois nominais conferido, selo "principal" na tela `/usuarios`.

## ADR-90 — Endurecimento: nome do seed por pessoa, âncora da recorrência e tipo de aviso no compilador ✅

**Contexto:** varredura de 03/08/2026 procurando o que ainda faltava para a aplicação estar realmente sólida. Três defeitos reais, dois deles invisíveis até alguém se machucar.

**Decisões:**

1. **Chave de nome do seed é POR PESSOA, não por papel.** O seed lia `process.env["SEED_" + role + "_NOME"]`, então o único `SEED_ROOT_NOME` do servidor batizou de **"Administrador"** os dois roots nominais criados em 28/07 (Thiago e André) — duas contas com o mesmo nome, e uma auditoria "quem aprovou isso?" não distingue ninguém. Agora cada membro tem `chaveNome` própria (`SEED_ROOT2_NOME`, `SEED_ROOT3_NOME`…), espelhando o `chaveEmail` que já era por pessoa. Compatível: `root@` e Thaís mantêm as chaves antigas.

   > **Correção de 03/08 (registro anterior estava errado):** afirmei aqui que os **três** roots tinham virado "Administrador". Eram **dois**. O `root@` foi criado bem antes, quando essa variável ainda não valia para ele, e sempre se chamou **"Root"** — conferido na tela `/usuarios` em produção. Confundi o **papel** "Administrador" (que aparece na coluna Papel da Thaís, cargo ADMIN) com o **nome** de conta. Consequência prática: nenhuma — a variável no `.env` do servidor é hoje **letra morta**, porque o seed só cria quem não existe, o `root@` existe, e ele **não pode ser excluído** (ADR-89), logo nunca será recriado.

2. **A recorrência MENSAL ancora no dia da PRIMEIRA conta da série.** O ADR anterior clampava a partir da ocorrência **anterior**, então uma série do dia 31 virava 28/02 e ficava **presa no dia 28 para sempre** (aluguel/salário do fim do mês adiantava 3 dias, todo mês, em silêncio). `proximo()` recebe `diaAncora`; gerar e reverter usam a mesma âncora, senão a reversão não acha a linha. Fevereiro voltou a ser exceção pontual.
   **Duas consequências, ambas desejadas e sem migration:** (a) séries que já degradaram em produção **se curam sozinhas** na próxima geração (a âncora vem da conta origem, que nunca mudou); (b) mover **uma** ocorrência de dia ("esse mês pago dia 15") deixou de redefinir a série inteira — o ajuste pontual é pontual, e o mês seguinte volta ao dia combinado. Antes, cada adiamento manual virava a nova regra em silêncio.
3. **Tipo de aviso é validado pelo compilador.** `EMAIL_TEMPLATES` era anotado `: Record<string, TemplateMeta>` — a anotação **alargava as chaves para `string`**, o que fazia `EmailTemplateChave` (o mecanismo de segurança que já existia) resolver para `string` e não proteger nada; era tipo morto, usado em lugar nenhum. Trocado por `satisfies`, que valida o objeto **e** preserva as chaves literais. `notificar(tipo)` passou a exigir `EmailTemplateChave`: um tipo sem template agora **não compila**, em vez de explodir em runtime e derrubar o scan proativo. Lookups por chave externa (CRUD de templates do admin, coluna do banco) usam o helper `templateDe(chave: string)`, que continua validando em runtime.
4. **Os 5 bugs do Financeiro do PR #72 ganharam teste.** Tinham sido corrigidos sem cobertura nenhuma — qualquer refactor os traria de volta. `financeiro-recorrencia.test.ts` trava o clamp de fim de mês, o ano bissexto, a virada de ano e a âncora.

**Sobre a constraint `@@unique([recorrenteId, vencimento])`:** ver ADR-92 — a investigação encontrou um impedimento real, e a correção dele veio antes.

**Verificado:** lint 0 erros · typecheck 6/6 · vitest 124 (92 api + 32 web) · e2e isolado.

## ADR-91 — "Defina sua senha" no primeiro acesso ✅

**Contexto:** as contas nascem com uma senha que **outra pessoa** escolheu — o seed usa a mesma `SEED_ROOT_PASSWORD` para todo mundo, e o ADMIN digita a senha ao criar um usuário pela tela. Combinava-se "troque no primeiro login" e ninguém trocava: em 03/08/2026 confirmei que os dois ROOTs provisionados em 28/07 **ainda estavam com a senha inicial**, seis dias depois. Combinado que depende de memória humana não é controle.

**Decisões:**

1. **`User.senhaTrocadaEm DateTime?`** — nulo significa "a pessoa nunca definiu a própria senha". Preenchido pelas **três** funções em que quem escolhe a senha é o dono da conta: `changePassword`, `aceitarConvite` e `redefinirSenha`.
2. **Escolhido `senhaTrocadaEm` (data) e não uma marca booleana `senhaProvisoria`.** Com booleana eu teria que **adivinhar** quais contas já existentes estão provisórias — ou cravar e-mails numa migration, que envelhece mal. Com a data nula por padrão, toda conta interna que nunca trocou é convidada **uma vez** e o problema se extingue sozinho, sem backfill e sem lista hardcoded. De brinde, fica o registro de **quando** cada pessoa definiu a senha.
3. **Só papéis internos.** `precisaTrocarSenha()` (em `packages/shared`, uma fonte de verdade para front e back) exige `role !== "CLIENTE"`: o cliente do Portal já escolhe a senha dele ao aceitar o convite — incomodá-lo seria ruído puro.
4. **Página, não modal**, no gate do `App.tsx` **antes** do `AuthProvider`: a pessoa acabou de entrar e tem uma tarefa só. Modal por cima da app sugeriria que dá para adiar — e daria, fechando no X. Tem saída de emergência ("Sair") para quem entrou na conta errada.
5. **Reusa `auth.changePassword`, sem endpoint novo.** Continua exigindo a senha atual: sem isso, uma sessão roubada trocaria a senha e trancaria o dono para fora. São ~3 segundos a mais para quem acabou de digitá-la.
6. **E2E:** `scripts/e2e-senha-ja-trocada.mjs` marca as contas de teste logo após o seed (senão o `auth.setup` quebra — ele valida o login checando que o campo de senha some, e a página nova tem campos de senha). O fluxo em si tem spec própria, que cria a conta **dentro** do teste.

**Efeito colateral desejado:** conta criada pelo ADMIN na tela Equipe & acessos também cai na regra — o ADMIN escolhe uma senha para entregar, e a pessoa troca ao entrar. Saiu de graça, sem código extra.

## ADR-92 — Reversão de recorrência ressuscita a ocorrência, em vez de duplicar a data ✅

**Contexto:** investigando se dava para adicionar `@@unique([recorrenteId, vencimento])` em `Conta` (pendência aberta desde o PR #72), a consulta em produção deu **0 grupos duplicados entre as linhas vivas** — o que parecia liberar a migration. Não liberava: o índice único vale para **todas** as linhas da tabela, inclusive as apagadas por soft-delete, e a primeira consulta filtrava `deletedAt: null`.

**O impedimento real (comprovado por teste):** desmarcar uma conta paga faz `reverterSucessora` apagar a sucessora por **soft-delete** — a linha continua na tabela. O dedup de `gerarProximaOcorrencia` procurava com `deletedAt: null`, não enxergava essa linha, e **criava outra** para a mesma data. Resultado do ciclo marcar → desmarcar → marcar: 3 linhas onde deviam existir 2, sendo duas com o mesmo `(recorrenteId, vencimento)`. Exatamente a duplicata que o índice único recusaria — o banco explodiria num fluxo trivial de UI.

Verificado empiricamente: revertendo a correção, o teste de integração acusa `expected [...3 itens] to have a length of 2` e o `groupBy` devolve um grupo com `_count: 2`.

**Decisões:**

1. **A geração procura INCLUSIVE as apagadas.** Achando uma sucessora soft-deletada para a data alvo, **ressuscita** (`deletedAt: null, pago: false, pagoEm: null`) em vez de criar outra linha. Vale por si só, independente da constraint: antes, cada ciclo desmarcar/marcar deixava uma órfã apagada acumulando na tabela.
2. **A correção vai ao ar ANTES da constraint**, em PR separado. Invertendo a ordem, o próprio ciclo marcar/desmarcar continuaria gerando duplicatas entre um deploy e outro — e a migration falharia no meio do `migrate deploy`.
3. **A constraint só entra depois de contar as duplicatas SEM filtrar `deletedAt`.** O `0` da primeira consulta não vale como aval; a pergunta certa é outra.

**Lição:** a pendência estava classificada como "só falta rodar a migration". Não estava — faltava um bug. Constraint de banco não é enfeite: ela obriga o código a ser coerente com o que se afirma sobre os dados, e foi tentando adicioná-la que o defeito apareceu.

## ADR-93 — Índice único `(recorrenteId, vencimento)` em Conta ✅

**Contexto:** a pendência aberta desde o PR #72, agora com o caminho livre — o ADR-92 tirou o impedimento (a geração ressuscita a apagada em vez de duplicar a data) e a contagem em produção, **sem** filtrar `deletedAt`, deu **0 grupos duplicados**.

**O que a investigação revelou antes de aplicar:**

1. **A origem da série NÃO tem `recorrenteId` nulo** — `createConta` grava `recorrenteId = próprio id` (linha "a 1ª conta da série é a âncora"). Logo toda a série compartilha o mesmo `recorrenteId` e o índice cobre a série inteira, origem incluída. Conta não-recorrente fica com nulo e **fora** do índice (o MySQL trata NULL como distinto).
2. **`updateConta` deixava o vencimento colidir em silêncio.** Puxar uma parcela para a data de uma irmã criava duas ocorrências no mesmo dia — hoje isso passa sem reclamar. Com o índice, viraria um `P2002` cru na cara do usuário. Agora o erro é traduzido: _"Já existe uma parcela desta série com este vencimento — inclusive se ela foi excluída. Escolha outra data."_ A menção ao excluído não é detalhe: a irmã pode estar soft-deletada e **invisível na tela**, e sem isso a mensagem não faria sentido.
3. **O banco de DEV tinha uma duplicata real de 28/07/2026** — três linhas "Vivo", todas soft-deletadas, mesmo vencimento (05/09). É o ADR-92 documentado em dado real: cada ciclo marcar/desmarcar deixou uma órfã. Limpeza feita **só em dev**, mantendo a mais antiga (a que a geração ressuscitaria); produção não precisou de nada.

**Decisão:** `@@unique([recorrenteId, vencimento])`. A migration foi escrita à mão e aplicada com `migrate deploy` — o `migrate dev` recusa rodar não-interativo ao criar índice único (avisa que _pode_ falhar, sem saber se falharia).

**Por que valeu a pena mesmo com a causa-raiz já corrigida:** a constraint não conserta bug, ela **impede que a próxima versão do código reintroduza um**. Foi tentando aplicá-la que apareceram os itens 2 e 3 acima — nenhum deles estava no radar.

## ADR-94 — Menu em 4 grupos + menu derivado do catálogo de páginas ✅ (revisa o ADR-46)

**Contexto:** o gatilho foi um bug. A página **E-mail** foi registrada em `lib/paginas.ts` e **não apareceu no menu** — porque o `AppLayout` mantinha um `NAV_GROUPS` **à mão, paralelo** ao catálogo, e o `paginas.test.ts` só guardava o catálogo da busca. Nenhum teste cruzava menu × rotas. Revisando o menu para consertar, ficou claro o segundo problema: o grupo "Dia a dia" do ADR-46 tinha chegado a **10 itens** — um grupo com 10 itens não separa nada, o cabeçalho só diz "tudo" — e a ordem era **histórica** (a ordem em que as fases foram construídas), não a ordem de uso.

**Decisões:**

1. **Uma fonte só.** `lib/paginas.ts` ganhou o campo `grupo` e exporta `MENU_GRUPOS`; o `AppLayout` apenas filtra por papel e desenha. Sem `grupo` = página fora do menu (abre por Ajustes, pela ficha ou pelo menu do usuário).
2. **Guarda no `paginas.test.ts`:** toda rota do router **ou** está num grupo do menu **ou** está declarada em `FORA_DO_MENU` com o caminho por onde se chega. Página nova é obrigada a **tomar uma decisão** — não some mais em silêncio. Há guarda também contra exceção obsoleta (rota morta ou já no menu).
3. **Quatro grupos, cada cabeçalho respondendo a uma pergunta real, na ordem de dentro para fora:** **Meu trabalho** (Tarefas · Agenda · Projetos — "o que é meu hoje?") → **Negócio** (Vendas · Clientes · Documentos · Financeiro — "como está o negócio?") → **Comunicação** (E-mail · Mensagens — "alguém me chamou?") → **Configuração** (Ajustes · Sistema). **Início fica solto no topo, sem cabeçalho** — é o resumo de todos, não pertence a tema nenhum, e título sobre um item só é ruído. Nenhum grupo passa de 4 itens: dá para varrer sem ler. Meu trabalho vem primeiro porque o Início **já é pessoal** ("o que precisa da sua atenção hoje") e é essa a frase que ele continua; pôr Negócio no meio quebra o raciocínio. **E-mail antes de Mensagens** porque o e-mail é o canal do cliente e da operadora; Mensagens é interno.
4. **O menu NUNCA rola.** Rolar esconde item de navegação — e esconde justamente os de baixo, que a pessoa nem sabe que existem. Em vez de barra de rolagem, a barra **encolhe sozinha em três degraus de altura de viewport** (940 / 820 / 740px). Antes disto o menu exigia **912px de viewport**: no 1080 passava raspando e num notebook 1366×768 rolava. `e2e/menu-sem-scroll.spec.ts` mede em 1366×768, 1280×720 e 1920×1080 e reprova se o menu precisar de mais espaço do que tem — inclusive verificando que o **último item continua clicável**, porque "não tem barra de rolagem" não prova que o item cabe na janela.
   - **Armadilha achada aqui:** escrever `[@media(max-height:…)]` direto na classe **não funciona** para degraus sobrepostos. O Tailwind emite essas regras em ordem **crescente** de `max-height`, todas com a mesma especificidade — então a de 940px vinha por último e atropelava as de 820 e 740. Só o teste pegou (o número medido não mudava entre as rodadas). Os degraus viraram `screens` nomeadas (`alt`/`alt-sm`/`alt-xs`) no `tailwind.config.js`, declaradas **do maior para o menor**, onde a ordem é determinística.

**Três defeitos irmãos apareceram na mesma revisão** — todos por listas paralelas de rótulo, e `/email` ser **prefixo** de `/emails` e `/emails-enviados`:

- `usePageTitle` casava por **prefixo cru**: com `/email` no menu, a página `/emails-enviados` passaria a se chamar "E-mail" no cabeçalho. Agora casa por **segmento** (`/x` ou `/x/…`).
- `Breadcrumbs.SECTION_LABEL` é uma **terceira** lista à mão; sem entrada, capitaliza o segmento — a trilha dizia **"Email"**, sem hífen. Corrigido, e há teste exigindo que trilha e menu usem o mesmo rótulo.
- No modo recolhido, o divisor entre grupos usava `first:border-0`, mas o divisor é o **primeiro filho do próprio grupo** — a regra casava em todos e **nenhum traço aparecia**. Agora o divisor sai do índice do grupo.

**Verificado:** guarda **provada falhando** (removido o `grupo` do E-mail, o teste reprova com `rotas sem lugar no menu: /email`); web 38/38; typecheck 6/6; lint 0 erros; conferido em tela (expandido e recolhido) com o DOM lido — 5 grupos, 4 divisores, nenhum acima do Início.

**Lição:** o teste que faltava não era do menu, era do **cruzamento**. Toda vez que duas listas descrevem a mesma verdade, ou se derivam uma da outra, ou existe um teste que as cruza — senão elas divergem, e a divergência é silenciosa.

## ADR-95 — E-mail dentro da aplicação: caixa IMAP/SMTP por usuário (Bloco 1: plugar e ler) ✅

**Contexto:** a correspondência com cliente e operadora vivia no webmail, fora do Workspace — a equipe saía da app para ler, e o que foi combinado por e-mail não aparecia na ficha de ninguém. Desenho em `docs/superpowers/specs/2026-08-03-email-na-aplicacao-design.md`; plano em `docs/superpowers/plans/2026-08-03-email-bloco1-plugar-e-ler.md`.

**A regra que resolve o conflito privacidade × CRM** (escolhida pelo dono): **a caixa é privada, a correspondência com o cliente é da empresa.** Ninguém abre a caixa de ninguém — todo procedure filtra por `userId`. Mas e-mail trocado com cliente/lead **cadastrado** aparece na ficha dele, para quem já pode abrir aquela ficha. Sustentam a regra o **"marcar como particular"** (um clique tira da ficha) e a importação de histórico **opt-in**, com aviso de visibilidade.

**Não existe caixa compartilhada gerida pela app.** Cada pessoa pluga as caixas cuja senha tem (André e Thaís plugam cada um o `contato@`). Quem manda no acesso é o servidor de e-mail: cortar alguém = trocar a senha no painel da hospedagem. Isso evita construir — e ter de auditar — um segundo sistema de permissão sobre a caixa alheia.

**Fatos do servidor, sondados ao vivo (não presumir outra coisa):** MX = `mail.medconsultoria.com.br` (TineHost, **não** é Google/Microsoft) · Dovecot · separador de pasta é **ponto** (`INBOX.spam`) · `SPECIAL-USE`, `QRESYNC`, `CONDSTORE`, `MOVE`, `UIDPLUS`, `ESEARCH`, `PREVIEW`, `THREAD` disponíveis · SMTP 465, `SIZE` 75 MB, `RCPTMAX=200`. **Sem `IDLE` utilizável:** o lsnode derruba o Node ocioso (mesma causa do ADR-84), então conexão IMAP é sempre curta e o e-mail chega por sincronização, não por push.

**Decisões:**

1. **Índice + cache, nunca espelho.** `EmailMensagem` guarda cabeçalho; o corpo só é baixado quando alguém abre. Busca dentro do texto usa o **`ESEARCH` do servidor** — acha sem baixar corpo nenhum. O banco não vira uma segunda caixa postal (custo, backup e, principalmente, superfície de vazamento).
2. **Vínculo com cliente/lead por JOIN em `EmailEndereco`, resolvido na consulta** — nunca gravado fixo na mensagem. Cliente que troca de e-mail, ou e-mail que chega antes de o cadastro existir, passam a aparecer sozinhos, sem migração nem reprocessamento.
3. **Senha da caixa cifrada** (AES-256-GCM, `EMAIL_CRYPTO_KEY`), nunca de volta à tela, nunca em log — o `logger` do `imapflow` fica **desligado de propósito**, porque ele imprime o diálogo de autenticação. Sem a chave, o módulo fica desligado e o resto da app segue normal (mesma degradação do SMTP).
4. **Testar antes de gravar.** `plugarCaixa` só grava depois de o servidor aceitar a credencial, e a mensagem **distingue senha errada de servidor fora do ar** — a primeira é culpa de quem digitou, a segunda não. Caixa quebrada gravada no banco falharia depois, em silêncio, longe da tela onde deu para consertar.
5. **Três camadas contra HTML hostil** (e-mail é conteúdo de terceiro, hostil até prova em contrário): higienização no servidor (`sanitizar-html.ts`) → corpo renderizado em **`<iframe sandbox="">`** → **imagem remota bloqueada** por padrão, com faixa para liberar caso a caso (imagem remota é rastreador de leitura). Uma camada só seria aposta; três é defesa em profundidade.
   - **O bloqueio é ALLOWLIST (`cid:`), não lista negra.** A revisão de segurança executou os payloads e provou dois furos no `/^https?:/` original: `//host/x.gif` (protocolo-relativo, que o navegador resolve normalmente) e `" HTTPS://…"` com espaço na frente. Nos dois casos o pixel carregava sozinho **e o contador ficava em 0** — a faixa afirmava que nada tinha sido bloqueado. Promessa de privacidade quebrada em silêncio é pior do que não ter a proteção.
   - **O corpo é servido por rota própria (`/email-corpo/:id`), não por `srcdoc`.** Documento `srcdoc` **herda a CSP da página que o embute**, e a CSP da app (`img-src 'self' data: blob:`) bloquearia a imagem remota mesmo depois do clique em "Mostrar imagens" — em produção o botão nunca funcionaria. Pela rota, o documento tem CSP própria (`default-src 'none'`; `https:` em `img-src` só quando `?imagens=1`), que **soma** com o `sandbox=""`.
6. **Teto de 10 MB para baixar o corpo.** O `download` traz a mensagem RFC822 inteira, anexos inclusive, para a memória do **único** processo que serve API + SPA + tempo real (ADR-2), e o servidor aceita até 75 MB. Sem teto, um estranho — sem conta nenhuma — derrubava o Workspace inteiro mandando um e-mail grande.
7. **Freio de tentativa de senha por usuário** (5 a cada 15 min, em memória): `plugarCaixa` testa credencial contra o servidor de e-mail da empresa e distingue "senha recusada" de "servidor fora", então sem freio era um **oráculo de senha** a 300 req/min contra a caixa de qualquer colega — e a rajada, mesmo sem acertar, faz a hospedagem bloquear o IP e ninguém mais recebe e-mail.
8. **A trava "só @medconsultoria.com.br" virou código.** Ela só existia no texto da tela; como o servidor IMAP é **deduzido do domínio digitado** (`mail.<domínio>`), dava para registrar um domínio próprio apontando para IP interno e usar a API como sonda de porta. Agora é `refine` no schema Zod compartilhado — mesma regra no formulário e na procedure.
9. **Fase 1 é SÓ `@medconsultoria.com.br`**, de propósito: Gmail exige Senha de app com 2FA e o Outlook.com desligou senha em IMAP em set/2024 (só OAuth2). Cada provedor externo é uma integração à parte — entra depois, se valer a pena.

**O que as três revisões (segurança, banco, TypeScript) acharam além do acima** — todos corrigidos antes do merge, e vale registrar porque nenhum apareceria em teste de tela feliz:

- **As pastas nunca eram descobertas.** `sincronizarPastas` existia e não era chamada de lugar nenhum do fluxo real: a caixa aparecia conectada e **sem Caixa de entrada**. Agora roda ao plugar e se auto-cura em `listarPastas` (que conserta também as caixas já plugadas). Confirmado na tela: a caixa que estava vazia passou a mostrar as 6 pastas e 117 mensagens.
- **O polling não sincronizava.** Só as queries reliam o cache do banco; quem busca e-mail novo é a mutation `sincronizar`, e ela rodava **uma vez**, ao abrir a pasta. Com a tela aberta, e-mail novo não chegava até trocar de pasta ou recarregar. Agora roda no intervalo e pausa com a aba em segundo plano.
- **Remover e plugar de novo a mesma caixa travava a pessoa:** soft-delete + `@@unique([userId, email])` (que não enxerga `deletedAt`) davam `P2002` cru, e `reconectarCaixa` não acha caixa removida. Ressuscita a linha — mesmo remédio do ADR-92 — e a senha **some** ao remover (retenção sem finalidade).
- **Faltava o índice `(pastaId, dataEm)`** para a consulta que a tela faz o tempo todo (`(pastaId, uid)` não ordena por data; `(caixaId, dataEm)` não filtra por pasta): era filesort a cada abertura e a cada polling.
- **`logout()` estava dentro do `try`:** socket que cai depois do último comando marcava a caixa como ERRO **com a sincronização inteira já gravada**, e recusava senha CERTA no teste de credencial.
- **A trava de sincronização era ler-decidir-gravar:** duas chamadas quase simultâneas passavam as duas, abriam duas conexões na mesma pasta e podiam **regredir** os ponteiros de sync. Virou compare-and-set atômico (`updateMany` condicional).

**Verificado:** API 122 testes (6 de integração contra o servidor real — sem `EMAIL_TESTE_USER`/`PASS` eles **pulam**, e pular não é passar); web 38/38; `e2e/email.spec.ts` 3/3; typecheck 6/6; lint 0 erros. Confirmado em tela com a caixa real do dono.

**Pendências do dono:** gerar `EMAIL_CRYPTO_KEY` no `.env` do servidor no deploy (ver DEPLOY.md) e trocar a senha da caixa `teste@medconsultoria.com.br` ao fim do desenvolvimento — ela trafegou por conversa em 03/08/2026 (não está em arquivo nenhum do repositório).

## ADR-96 — E-mail dentro da aplicação: Bloco 2, fase 2A (escrever, responder, encaminhar, anexar, rascunho) ✅

**Contexto:** o Bloco 1 (ADR-95) só lia. A correspondência com cliente/operadora continuava precisando do webmail para responder — metade do problema original seguia de pé. Plano em `docs/superpowers/plans/2026-08-04-email-bloco2a-escrever.md`, execução em 9 tarefas (`.superpowers/sdd/2026-08-04-email-bloco2a-escrever/`), branch `feat/email-na-aplicacao`.

**Decisões:**

1. **Reverte o ADR-95 §2 — o rascunho vive no servidor, não só na app.** O desenho original guardava o rascunho como estado local da tela. Na prática isso isolava o rascunho: sumia se a pessoa trocasse de máquina, e não aparecia no webmail nem em nenhum outro cliente de e-mail. A Tarefa 8 passou a **gravar o rascunho na pasta `Drafts` do próprio servidor IMAP** (`rascunhos.service.ts`), regravando por cima do UID anterior a cada novo salvamento (debounce de 5 s) e apagando por UID depois de um envio bem-sucedido (`descartarRascunho`, procedure que **não deixa o cliente escolher a pasta** — o input Zod é só `{ caixaId, uid }`, o caminho sai de `papel: "DRAFTS"` resolvido no servidor). Reversão deliberada, não desvio: a reversão de ADR anterior já tem precedente nesta base (ADR-82/83 revertem o ADR-44/59). O preço aceito é a corrida entre debounce/gravação/envio (~5–6 s cada) — resolvida com uma máquina de estados explícita em `useRascunhoAutomatico.ts` depois de duas rodadas de revisão abrindo buraco ao lado do que fechavam.
2. **Trava de destinatário fora de produção (`conferirDestinoPermitido`, `envio.service.ts:29`).** O spec do plano não previa. Acrescentada porque o SMTP usado no envio é o **real** da caixa da pessoa, em qualquer ambiente — sem a trava, rodar um teste local ou um `pnpm --filter @app/api test` distraído manda e-mail de verdade para um cliente de verdade, e não existe desfazer. Fora de produção (`isProd` de `config.ts`), todo destino de `para`/`cc`/`cco` tem de estar em `DESTINOS_TESTE_PERMITIDOS` (`packages/shared/src/schemas/email.ts`: `tibamooca@gmail.com` e `contato@medconsultoria.com.br`) — qualquer outro destino lança `BAD_REQUEST` **antes** de abrir a conexão SMTP (`enviarMensagem` chama a trava logo após resolver a caixa, `envio.service.ts:105`, bem antes do `comSmtp` em `:160`). Em produção a função é um no-op (`if (isProd) return`).
3. **Encaminhar preenche `References`, mas não `In-Reply-To` nem `\Answered`.** Decisão tomada na Tarefa 3 (delegada pelo dono, "melhores práticas") e mantida: encaminhar **não é responder** a quem escreveu a mensagem original — é mandar o conteúdo para um terceiro. Por isso o campo `encaminhando` (que já existia no schema, sem uso) passou a alimentar só o cabeçalho `References` (para a conversa não se partir do lado de quem recebe), enquanto `inReplyTo` e a marca `\Answered` no servidor continuam exclusivos do modo `resposta` (`envio.service.ts:111,141,196`). É o comportamento do Thunderbird.
4. **A assinatura entra só no servidor, nunca na tela.** `envio.service.ts:125` concatena `caixa.assinatura` a **todo** envio antes de compor o MIME. Se `Escrever.tsx` também a inserisse, a assinatura sairia duplicada — proibição explícita levada ao brief da Tarefa 7 (§0.5) depois de um achado de revisão na Tarefa 3.
5. **A citação tem duas versões, não uma — e a de envio restaura imagem SÓ em resposta, nunca em encaminhamento.** `montarCitacao` (`citacao.ts`) devolve `{ preview, envio }`: a `preview` (mostrada na tela, dentro do `iframe sandbox=""`) **sempre bloqueia imagem remota** (`data-src-bloqueada`), para não disparar pixel de rastreio enquanto a pessoa ainda está escrevendo e pode nem enviar — o `sandbox=""` sozinho não bloqueia imagem, quem bloqueia é isto. A `envio` (a que de fato sai no MIME) recebe um segundo parâmetro explícito, `{ restaurarImagensNoEnvio }`, que `prepararResposta`/`prepararEncaminhamento` (`envio.service.ts`) decidem de forma OPOSTA: **resposta = `true`** (quem recebe de volta é a MESMA pessoa que mandou o e-mail original — se há pixel, é dela, não descobre nada que já não soubesse) · **encaminhamento = `false`**, igual à `preview` (quem recebe é um TERCEIRO — o cliente — que nunca escolheu abrir aquele e-mail; restaurar a imagem repassaria o pixel de rastreio a ele, com o NOSSO domínio no remetente dando credibilidade ao golpe seguinte). Achado 1 da revisão de segurança da fase 2A — a primeira versão restaurava em qualquer um dos dois modos. Em nenhum dos casos a sanitização é reaberta: `allowedTags`/`allowedAttributes`/`allowedSchemes` valem para as duas versões, e o filtro de esquema roda **depois** do `transform`, então um `src="javascript:"` restaurado ainda é removido. Não é "parar de sanitizar" — é parar de bloquear só a origem remota, e só quando é seguro fazê-lo. **Nota honesta, achada na revisão do próprio achado 1:** `EmailMensagem.corpoHtml` só é gravado por `abrirMensagem` (`leitura.service.ts`), que SEMPRE sanitiza com imagem bloqueada antes de salvar — então, no fluxo real de hoje, `restaurarImagensNoEnvio: true` (resposta) não tem `src` nenhum para restaurar; o `corpoHtml` que chega em `montarCitacao` já é `data-src-bloqueada`. O contrato existe mesmo assim, de propósito: garante o comportamento certo se `corpoHtml` um dia passar a chegar cru por outro caminho, e é a razão de a decisão morar em `montarCitacao`, não em quem grava o corpo. Por isso mesmo, **nunca** "conserte" a imagem quebrada da citação de resposta copiando o `replace(/data-src-bloqueada=/g, "src=")` de `http/email-corpo.ts` (que existe para a TELA) para dentro deste fluxo — reabriria o vazamento para o encaminhamento também, já que os dois partem do mesmo `corpoHtml` pré-bloqueado. Regressão travada em `citacao.test.ts` alimentando o formato real do banco.
6. **Varredura de anexos temporários órfãos, por data de modificação (24 h).** Quem anexa um arquivo e desiste, cancela ou fecha o navegador sem enviar deixava até 20 MB por arquivo (`TAMANHO_MAX`, `lib/storage.ts`) para sempre em `uploads/email-tmp/<userId>` — crescimento ilimitado disparável pelo próprio usuário, em hospedagem compartilhada. `limparAnexosTempOrfaos` (`http/email-anexo.ts`) roda ao subir o servidor e depois a cada hora, apaga o que passou de `PRAZO_ANEXO_TEMP_MS` (24 h) medido pelo `mtime`, confinado a `BASE/email-tmp` (travessia de caminho fechada pela mesma validação de `caminhoTemp` usada no download). 24 h é generoso de propósito: a pessoa pode deixar a tela de escrever aberta um bom tempo antes de enviar.

**Achados de segurança e engenharia que não apareceriam num teste de tela feliz** (revisão por tarefa, `Opus` nas de maior risco — envio real, anexo, apagar rascunho):

- O snippet do plano tinha **3 defeitos reais**, todos pegos antes do merge: duplo-escape no cabeçalho da citação (`&amp;lt;` visível para o destinatário); PASSO 3 do envio marcando `\Answered` pela caixa de **envio** em vez da caixa **dona** da mensagem original (falharia calado com 2+ caixas plugadas); e o stream de download de anexo devolvido **para fora** do `comCaixa` — anexo acima de ~64 KB chegaria cortado, em silêncio, porque a conexão IMAP fecha quando o callback retorna.
- Download de anexo cancelado no meio pendurava a conexão IMAP (a promessa só escutava `end`/`error`; abortar emite `close`) até reiniciar o processo — corrigido com `finished()` filtrando `ERR_STREAM_PREMATURE_CLOSE`.
- Teto agregado de 25 MB por envio (`LIMITE_ANEXOS_BYTES`, `envio.service.ts:20`) — sem ele, 20 anexos de 20 MB virariam ~530 MB de base64 num Buffer só, no mesmo processo que serve a tela (ADR-2).

**Registrado, não resolvido — a triagem final decide:** `Bcc` não sobrevive na cópia em Enviados (nodemailer descarta o cabeçalho no build); e-mail sai só como `text/html`, sem alternativa `text/plain`; assinatura entra abaixo da citação (Gmail/Thunderbird põem acima); imagem embutida por `cid:` na citação continua quebrando no e-mail que sai (as partes MIME do original não são reanexadas); colar `Nome <email@x.com>` no campo Para quebra o parse (split por espaço); erros dos passos 2 e 3 do envio (cópia em Enviados / marcar respondida) são engolidos sem rastro — convenção herdada do Bloco 1 inteiro.

**Verificado (Tarefa 9, HEAD `99d4108`):** API 187 testes / web 75 testes, **0 pulados** nos dois (inclusive os de integração contra o servidor real de `EMAIL_TESTE_USER`); typecheck do monorepo limpo (`@app/api` e `@app/web`); `pnpm lint` 0 erros (47 warnings pré-existentes, nenhum novo); `e2e/email.spec.ts` 8/8. A suíte de integração manda e-mail real, marca `\Answered` e grava/apaga rascunho numa caixa real a cada execução — esperado e autorizado, rodado uma vez.

**Adendo de 05/08/2026 — o que a verificação em tela e três revisões Opus acharam depois do "pronto".** Vale como registro do tipo de defeito que sobrevive a uma bateria verde: nenhum destes falhava um teste, e quase todos eram **dois elos certos produzindo um resultado errado**.

7. **A "fatia 3" do spec (anexos: enviar e baixar) estava metade entregue.** A rota `GET /email-anexo/:mensagemId/:anexoId` era segura, testada e **código morto na app inteira, produção inclusive**: a tela renderizava cada anexo como `<span>`. Baixar anexo pela tela era impossível desde o primeiro dia. **É a repetição exata do buraco que fez o botão de anexar entrar na Tarefa 7** — o lado de baixar ficou de fora. O link entrou **sem** o atributo `download`, de propósito: com ele o navegador salva o corpo da resposta seja qual for o status, e um cookie expirado viraria um `contrato.pdf` com `{"error":...}` dentro, que o leitor de PDF abre como "arquivo corrompido"; o `Content-Disposition` do servidor já baixa com o nome certo.
8. **Corpo vazio colapsava o MIME e o ANEXO virava o corpo.** `html: ""` é falsy para o `MailComposer`, que então não monta `multipart/mixed`. Quem recebia não ganhava anexo nenhum, e com anexo `.html` o cliente de e-mail de quem recebe podia renderizar HTML de terceiro **com o nosso domínio no remetente** — o mesmo risco que a rota de download fecha do nosso lado, entregue pelo lado de fora. Mandar um arquivo sem escrever nada é caso de uso normal, e uma caixa **com assinatura configurada mascarava o defeito** (a assinatura preenchia o corpo). Segundo rosto do mesmo bug: com 2+ anexos saía `multipart/mixed` **sem parte de corpo nenhuma**.
9. **Encaminhar não levava os anexos do original.** Encaminhar o e-mail cujo ponto inteiro É o PDF é o caso normal, não a exceção. Corrigido rebaixando do IMAP **dentro** do `comCaixa` (devolver o stream para fora corta o anexo em silêncio acima de ~64 KB). O contrato manda só **ids** de volta: o conteúdo nunca passa pelo navegador e o nome sai do banco. Anexo **embutido** por `cid` (a logo da assinatura do remetente) é filtrado — sem isso, todo encaminhamento anexaria `image001.png`.
10. **A guarda de "mensagem sem corpo" proibia o e-mail que é só anexo.** Ela perguntava "esta mensagem tem texto?" quando a pergunta é "o texto já foi buscado?" — quem responde isso é `corpoEm`. O ramo `grandeDemais` de `leitura.service.ts` não grava `corpoEm`; o ramo normal grava **mesmo com os dois corpos nulos**. Resultado: encaminhar o contrato em PDF ficou proibido, com a tarja mentindo "mensagens muito grandes não são abertas aqui". A citação de mensagem legitimamente vazia passou a levar a **procedência** (de quem, quando) com o `blockquote` vazio — sem isso, encaminhar era encaminhamento cego.
11. **Falha em operação ACESSÓRIA não declara a caixa quebrada.** Regra aplicada agora nos quatro pontos: descarte de rascunho, gravação de rascunho, download de anexo e o próprio `comCaixa`, que ganhou `marcarErro: false`. O detalhe que fez a correção anterior ser cosmética: o `catch` do `comCaixa` **grava `estado: "ERRO"` antes de relançar**, então envolver a chamada por fora não bastava. Cenário real: o envio dá certo, o descarte abre conexão NOVA, o Dovecot recusa por conexões simultâneas — e a caixa aparecia com erro na tela depois de um envio bem-sucedido. Senha recusada continua marcando sempre: ali a informação é verdadeira.
12. **`messageDelete` do imapflow falha em silêncio** (devolve `false`, não lança; e o `STORE` prévio devolve `false` quando `\Deleted` não é permanente na pasta). Meia hora digitando deixaria ~360 cópias em Rascunhos sem uma linha de log. E o critério de "na dúvida, não grava" — que existia para servidor sem UIDPLUS — não valia para o gêmeo: servidor que **anuncia** UIDPLUS e não devolve `APPENDUID` gravava assim mesmo e acumulava uma cópia a cada 5 s, sem teto. Agora `salvarRascunho` devolve `gravacaoDesligada`, e o front para de reagendar.
13. **Colar `Nome <email@x.com>` no campo Para** funciona (é o gesto de quem vem de outro cliente de e-mail). A primeira versão desta melhoria **engolia destinatário em silêncio**: "cliente@x.com Fulano \<f@y.com\>" saía só para o segundo. Trocar um erro visível por perda silenciosa, num e-mail sem desfazer, é pior que o problema original — pego na revisão.
14. **O envio que conclui depois de a tela fechar** não fecha mais a composição seguinte: os callbacks da mutação rodam desmontados. Sem a guarda, um envio lento fechava o e-mail que a pessoa já tinha começado e levava junto o texto ainda não salvo.
15. **Cota de disco por pessoa (~200 MB) nos anexos temporários**, guarda de **UIDPLUS antes de apagar rascunho** (sem a extensão o imapflow degrada para `EXPUNGE` cego, que apaga TODA mensagem `\Deleted` da pasta — era o único item da fase com perda de e-mail) e `requireTLS` no SMTP. A ausência de allowlist de MIME no anexo é **deliberada e está escrita no código**: anexo de e-mail aceita qualquer tipo, e a execução já está fechada no download.

**Testes que passavam com o bug de volta: TRÊS**, todos medidos reintroduzindo o defeito fora do repo. É a lição de engenharia da fase, junto com a do §3.0: _teste que não reprova o defeito é pior que teste nenhum, porque a regressão volta com a bateria verde._

**Verificado (05/08, HEAD `7716929`):** API 186 de unidade · web 106 · `e2e` **82/82** (inclusive `a11y-axe`, que cobre o `modal.tsx` compartilhado pela app) · `pnpm lint` 0 erros · typecheck 6/6 sem cache. **Em tela**, na app rodando: anexo baixado pela tela (200, `octet-stream`+`nosniff`+`attachment`, 75.962 bytes com assinatura PNG íntegra) · Responder com destinatário, `Re:` e citação com procedência · rascunho aparecendo **uma vez só** apesar de duas gravações · envio recusado (400) mantendo o rascunho no servidor com o texto intacto.

## ADR-97 — E-mail: a conversa com o cliente aparece na ficha (Bloco 2, fase 2D‑1) ✅

**Contexto:** o ADR‑95 prometeu _"a caixa é privada, a correspondência com o cliente é da empresa"_ e entregou só a primeira metade. Quem abria a ficha do cliente via um card **"E‑mails enviados"** que mostrava exclusivamente `EmailEnviado` — o log dos disparos automáticos de template. Nada do que a equipe escreve em `/email` chegava ali, porque o módulo da caixa não chama `registrarEmailEnviado` (e isso é proposital: ADR‑96 §3.6). Plano em `docs/superpowers/plans/2026-08-05-email-2d1-ficha-do-cliente.md`, branch `feat/email-ficha-do-cliente`. O levantamento contra o código desmentiu duas premissas do plano original: **o card não era novo** (existia em `ClienteDetailPage` e em `LeadDetailPanel`) e **`EmailMensagem.particular` já existia no banco sem uma linha de código que o escrevesse** — a válvula de privacidade estava prevista desde o ADR‑95 e nunca tinha sido implementada.

**Decisões:**

1. **Metadado + trecho para a equipe; corpo só para o dono da caixa.** Levada ao pé da letra, a regra do ADR‑95 deixaria qualquer funcionário ler o corpo inteiro de um e‑mail que outra pessoa trocou. A ficha devolve remetente, destinatários, assunto, data e o `trecho` (o resumo em texto puro que o índice já guarda) — **nunca corpo**, para nenhum papel, nem para o ROOT. O corpo continua exclusivo do dono, em `/email`. O motivo é assimétrico e é o que decide: **ampliar depois é um `select` a mais; estreitar depois de alguém ter lido a correspondência alheia é impossível.**
2. **O vínculo é resolvido na consulta, nunca gravado** (`vinculo.service.ts`): JOIN em `EmailEndereco.endereco` contra `Cliente.email` + o e‑mail de cada contato (o lead só tem o próprio), normalizados por `normalizarEndereco`. Cliente que troca de e‑mail passa a refletir a verdade nova sem migração.
3. **Endereço da casa nunca vira chave do JOIN — por endereço E por domínio** (`casa.ts`). `Cliente.email` e `Contato.email` são graváveis por **qualquer** FUNCIONARIO, e o cliente do Portal edita o próprio e‑mail: sem esta trava, quem escolhe a chave da consulta é quem edita o cadastro. A primeira versão comparava só endereços exatos (`User.email` + `CaixaEmail.email`/`usuario`) e **a revisão de segurança a derrubou**: `comercial@`, `contato@`, `financeiro@`, um apelido (`thiago@` ao lado de `thiago.garcia@`) e um `fulano+algo@` não têm conta nem caixa plugada e passavam — bastava pôr um deles num cliente descartável para ler, pela ficha, metadado e trecho da correspondência da equipe. Agora **todo endereço em domínio da casa é recusado**; provedor público (gmail, outlook, uol…) **nunca** vira domínio da casa, senão plugar um Gmail um dia apagaria da ficha todo cliente com Gmail. Consequência aceita: cliente cadastrado com e‑mail `@medconsultoria.com.br` não casa com nada — cliente de verdade tem e‑mail de fora, e o preço de recusá‑lo é uma ficha vazia, não uma caixa alheia aberta. O filtro `role: { not: CLIENTE }` continua: **o cliente do Portal também é `User`** e sem ele a ficha de todo cliente com Portal ficaria vazia. Caixa desplugada e usuário desativado seguem contando (endereço que um dia foi da casa não se recicla como chave).
4. **Ficam fora da ficha, sempre:** `particular = true`; **Lixeira, Spam e Rascunhos** (`DRAFTS` importa: o rascunho grava sozinho a cada 5 s desde o ADR‑96 — sem excluí‑lo vazaria e‑mail meio escrito, inclusive o que a pessoa pensou melhor e não mandou); e as **duplicatas** por `messageId` (a mesma mensagem existe na caixa de quem mandou e na de cada colega que recebeu), mantendo a mais antiga.
5. **A válvula: `email.marcarParticular`, só o dono da caixa.** A posse vai no `where` do próprio `updateMany` — não numa leitura antes dele —, então para quem não é dono não existe caminho em que algo seja gravado; `count === 0` responde `FORBIDDEN`, indistinguível de "não existe" (responder `NOT_FOUND` para um id alheio já contaria que ele existe). Marcar **uma** cópia esconde **todas** as cópias daquele `messageId`: esconder só a cópia de quem marcou deixaria a do colega na ficha, com o mesmo assunto e o mesmo trecho — a válvula não valvularia nada.
6. **A válvula tem volta, e ela mora na caixa.** A ficha só _tira_ (`Tirar da ficha`); _devolver_ é em `/email`, na caixa de quem é dono — `abrirMensagem` passou a devolver `particular` e a tela ganhou o botão nos dois sentidos. Sem isso, marcar como particular seria de mão única na app inteira: desfazer exigiria mexer no banco.
7. **Falha ao ler a caixa não derruba a ficha.** `conversaDoCliente` junta as duas fontes ordenadas por data; se a parte da caixa falhar (rede IMAP indireta, índice sincronizando), o card ainda mostra o log automático e avisa por `caixaIndisponivel`. E o **erro de verdade é visível** (`QueryError` com "tentar de novo") — os cards da ficha até aqui só tratavam o vazio, e um card silenciosamente vazio faz a equipe concluir que não houve conversa nenhuma com o cliente.
8. **Um card, duas fontes, selo por origem** (`EmailsDoClienteCard`, com `EmailsDoLeadLista` para o painel do lead): _"Enviado pelo sistema"_ × _"Caixa de \<pessoa\>"_. Sem o selo, e‑mail automático e correspondência de gente viram a mesma coisa na leitura. `emailsEnviados.doCliente`/`.doLead` (as procedures) **saíram** — ficaram sem consumidor; os serviços `listPorCliente`/`listPorLead` continuam vivos, chamados pelo `vinculo` e pelo Portal.

9. **O histórico automático fazia o MESMO JOIN sem trava — e o Portal lê essa metade.** Segundo bloqueante da revisão: `listPorCliente`/`listPorLead` (`enviados.service.ts`) casavam por `OR: [{ clienteId }, { para: cliente.email }]`, e `para` sai do cadastro. Pelo lado interno, um funcionário punha `root@medconsultoria.com.br` no cliente e via os transacionais do ROOT; pelo lado **externo**, que é pior, o cliente do Portal edita o próprio e‑mail (`portal.service.ts`) e `portal.emails` chama a mesma função — alguém de fora da empresa listaria assunto, tipo, data e falha dos e‑mails mandados a uma conta interna. É o mesmo defeito do `6dc7583` visto de outro ângulo: aquele fix tirou o **corpo**, este tira a **chave escolhível**. Agora o `para` só vale como chave quando o endereço **não é da casa** (`chaveDeEndereco`); o vínculo gravado pelo servidor (`clienteId`/`leadId`) continua valendo sempre. Manter o `para` para endereços de fora preserva o histórico de quem trocou de e‑mail depois de já ter recebido.
10. **`marcarParticular` é idempotente.** No MySQL o driver conta linhas _alteradas_, não _casadas_: regravar o mesmo valor (dois cliques, duas abas, o botão de `/email` fora de sincronia com a ficha) devolvia `count === 0` e o **dono da caixa** levava "só quem é dono pode marcar". A conferência extra usa o mesmo critério de posse do `UPDATE`, então para quem não é dono ela também não acha nada — o `FORBIDDEN` continua sem contar se o id existe.
11. **Tirar e devolver deixam rastro** (`ActivityLog`: `email_tirado_da_ficha` / `email_devolvido_a_ficha`). A válvula esconde a mensagem da empresa inteira a partir da cópia de uma pessoa — sem registro, ela é também alavanca de encobrimento. O log guarda **quem, qual mensagem e para qual lado**; nunca assunto nem trecho, senão o painel do ROOT viraria outra porta para o conteúdo que a fase decidiu não expor. É best‑effort: falhar ao registrar não impede alguém de proteger o que é seu.
12. **Limite conhecido, escrito de propósito:** a propagação do "particular" entre as cópias é por `messageId`. Mensagem sem `Message-ID` (servidor fora do padrão) não agrupa com ninguém, então marcar esconde só aquela cópia. É raro e o preço de agrupar por assunto+data seria esconder mensagens diferentes.

**Achado grave, corrigido antes desta fase entrar** (commit `6dc7583`): o card antigo devolvia o **corpo** do `EmailEnviado`, e o corpo dos templates de acesso carrega o **link de redefinição de senha com token**, que não expira. Qualquer funcionário abria a ficha, copiava o link e tomava a conta — inclusive a de um ROOT. Corrigido em duas camadas (o `select` da ficha parou de pedir corpo; o registro passou a redigir segredo). **Pendente e só o dono decide:** limpar as linhas antigas de `EmailEnviado` em produção — o corpo delas ainda tem token de `/assinar` e `/proposta`.

**Fora desta fatia (2D‑2 e 2D‑3):** anexo de e‑mail vira documento do cliente com um clique (`EmailAnexo.arquivoId` já existe) e e‑mail de desconhecido vira lead com um clique.

**A revisão de segurança (obrigatória nesta fase) achou dois BLOQUEANTES e os dois eram a mesma falha vista de dois lados: a chave do JOIN era um campo que o atacante escreve.** Estão nos itens 3 e 9. Vale como lição da fase: _proteger uma consulta e deixar a irmã sem trava não protege nada_ — quem quer ler procura o caminho que sobrou, e aqui o caminho que sobrou era o único aberto a alguém de fora da empresa.

**Verificado:** `@app/api` 240 testes de unidade (`casa.test.ts` novo, 9) · `@app/web` 111 · typecheck 6/6 sem cache · `pnpm lint` 0 erros · `e2e` **84/84** no banco isolado, com `email-ficha-cliente.spec.ts` novo (nenhum e2e tocava a ficha do cliente até aqui) cobrindo o selo, o particular que não aparece e a ida-e-volta da válvula.

## ADR-98 — A senha de desenvolvimento sai do repositório e passa a ser rotacionável ✅

**Contexto:** um handoff da janela de configuração do agente (05/08/2026) avisou que a senha de seed de desenvolvimento (`SEED_ROOT_PASSWORD`) estava em texto puro em 8 arquivos de memória versionados em outro repositório, com o valor preso no histórico do git de lá, e pediu: _"troque o valor no `.env` e reexecute o seed"_. **Duas coisas não fechavam.** Primeira: o seed **preserva de propósito** a senha de conta existente (`prisma/seed.ts` — "só CRIA quem falta"), então reexecutá‑lo não troca hash nenhum; `pnpm acessos` confirmou as 4 contas internas ainda entrando com a senha antiga depois de qualquer reexecução. Segunda, e maior: o mesmo valor estava **neste** repositório, embutido como fallback em `e2e/auth.setup.ts`, `e2e/auth-flows.spec.ts` e nas duas ocorrências de `SEED_ROOT_PASSWORD`/`E2E_PASSWORD` do `ci.yml` — trocar só o `.env` deixaria o valor circulando aqui e, pior, **quebraria a suíte e2e local em silêncio**, porque em desenvolvimento ela dependia justamente daquele literal (o `playwright.config.ts` não carregava o `.env`).

**Decisões:**

1. **Senha nenhuma embutida no código.** Os specs leem só do ambiente e **falham com mensagem explicando o que definir** em vez de tentar um valor morto. Fallback de credencial é pior que ausência: esconde a configuração faltando até o dia em que a senha real muda. O mesmo valia para o **`demo-seed.ts`**, que criava `func@` (FUNCIONARIO), `thais.garcia@` (ADMIN) e `cliente@` (**cliente do Portal**) com o literal — essas contas eram imunes à rotação e continuariam aceitando a senha vazada depois dela; agora leem a senha do `.env` como o `seed.ts`.
2. **Uma fonte só: `SEED_ROOT_PASSWORD` no `.env`.** O `playwright.config.ts` lê essa chave (o Playwright não carrega o `.env` sozinho) e a usa como `E2E_PASSWORD` quando ela não vem explícita — no CI vem, com valor descartável. **Só a senha é copiada** para o `process.env` dos workers: levar o arquivo inteiro poria `SMTP_PASS`, `OPENAI_API_KEY` e `EMAIL_CRYPTO_KEY` dentro do processo do Playwright sem que a suíte precise de nenhum deles. O caminho do arquivo é resolvido a partir do próprio config (não do CWD), e com `__dirname`: `import.meta.url` marcaria o config como ES module e o Playwright não conseguiria carregá-lo.
3. **`pnpm senha:rotacionar`** (`scripts/rotacionar-senha-seed.ts`) faz o que o seed não faz: sorteia o valor, grava a linha do `.env` e reescreve o `passwordHash` no banco. **Nunca imprime o valor** — nem em sucesso, nem em erro: quem quiser ver abre a linha do `.env`. Imprimir jogaria o segredo no terminal, no scrollback e no transcript de quem estivesse assistindo.
4. **O critério é "quem ainda usa a senha atual", não uma lista de e-mails.** O script confere o hash de cada conta contra a senha que está saindo e troca exatamente as que casam. Isso pega de uma vez as contas semeadas **e** as de exemplo do `demo-seed` (uma lista fixa esqueceria as segundas), e **deixa intacta quem já definiu senha própria** — daí não ser preciso mexer em `senhaTrocadaEm` (ADR‑91): quem escolheu a sua não é afetado, quem não escolheu continua sendo cobrado no 1º acesso. O UPDATE é **um só** (`id: { in: [...] }`): não existe desfecho com metade das contas numa senha e metade em outra.
5. **A trava de ambiente não pode ser "o host é localhost".** Foi a primeira versão, e ela estava **errada**: em produção o banco também é local (`mysql://…@localhost:3306`, `DEPLOY.md`), então o script rodando no servidor por SSH passaria a trava e reescreveria a senha dos 3 ROOTs e da ADMIN de produção para um valor aleatório gravado num `.env` que ninguém lê — perda de acesso ROOT, recuperável só por "Esqueci minha senha". Agora a trava é a **mesma do `demo-seed`** (`podeRodarDemoSeed`, pura e testada), alimentada com o **`NODE_ENV` lido do arquivo** — é o `NODE_ENV=production` do `.env` de lá que separa os dois ambientes, não o host. O banco alvo é impresso antes de qualquer escrita.
6. **Desfazer sem deixar cópia do segredo.** O `.env` é gravado antes de tocar o banco e, se qualquer passo seguinte falhar, é **restaurado a partir do conteúdo em memória** — o estado intermediário (arquivo novo × hash antigo) é o único em que _nada_ autentica. A primeira versão fazia backup em arquivo: um `.env.rotacao.bak` com a senha antiga **e** com `SMTP_PASS`/`OPENAI_API_KEY`/`SESSION_SECRET` de brinde, que um `Ctrl+C` deixaria em disco para sempre. Ele não entrava no git (`.gitignore: .env.*`) nem no pacote de deploy, mas backup de segredo esquecido é o mesmo problema com outro nome.
7. **Leitura pelo `dotenv`, não por regex própria** (nos dois arquivos novos). O parser improvisado que já se repete em 4 scripts deste repo devolve o `\r` **dentro do valor** em arquivo CRLF — e o `.env.example` é CRLF. Numa máquina Windows (esta), a suíte e2e falharia em todo login e a rotação abortaria sempre: a ferramenta escrita para este sistema operacional não funcionaria nele. Chave repetida também é recusada: o `dotenv` usa a última linha e um `replace` trocaria a primeira, deixando app e banco com senhas diferentes.

**O que isto NÃO resolve, e é do dono:** as mesmas 4 contas existem **em produção**. Se o `.env` do servidor tem o valor vazado e alguma delas nunca definiu senha própria (o `root@` primordial é o candidato: ninguém o usa para entrar), a senha vazada entra como ROOT em produção. Rotacionar aqui não alcança lá — e consultar o banco de produção é bloqueado por regra.

**A revisão de segurança (obrigatória, por tocar autenticação) derrubou a primeira versão em três pontos, e os três eram a mesma classe de erro: acreditar na própria premissa sem varrer o repositório.** O literal continuava em `demo-seed.ts` (executável) e em 4 documentos versionados — inclusive **neste arquivo**, na ADR‑77, onde a senha aparecia por extenso ao lado de uma ADR que afirmava que ela havia saído do repositório. E a trava de ambiente protegia contra o cenário imaginado (banco remoto), não contra o real (produção é localhost).

**Verificado:** bateria de 13 casos contra um banco descartável com o schema real, cobrindo o que a revisão levantou — recusa `NODE_ENV=production`, recusa chave repetida, banco fora do ar restaura o arquivo e não deixa backup, funciona em CRLF sem sujar o valor, **não imprime a senha nova em lugar nenhum**, a conta semeada passa a autenticar com a nova e não mais com a antiga, quem tinha senha própria não é tocada, e rodar sem ninguém usando a senha atual recusa em vez de fingir sucesso. Somado: `@app/api` 242 testes · `@app/web` 111 · typecheck 6/6 sem cache · `pnpm lint` 0 erros · **`e2e` 84/84** no banco isolado (a rodada anterior à correção do `demo-seed` caía por falta de senha nas contas de exemplo, exatamente como a revisão previu).

## ADR-99 — Fases 2D‑2 e 2D‑3: o e‑mail vira trabalho (anexo → documento do cliente, remetente → lead) ✅

**Contexto:** com a 2D‑1 (ADR‑97) a correspondência já _aparecia_ na ficha, mas ainda não _virava_ nada. Os dois buracos estavam nomeados desde o desenho: o anexo que chega por e‑mail continuava exigindo baixar no computador e subir de novo pela ficha, e quem escrevia pela primeira vez não entrava no funil sem alguém redigitar nome e e‑mail. O campo `EmailAnexo.arquivoId` já existia no schema desde o Bloco 1 — **morto, sem nenhum código que o escrevesse**.

**Decisões:**

1. **Um lugar só para as duas ações** (`modules/email/acoes.service.ts`). Ler (`leitura`), escrever (`envio`) e vincular (`vinculo`) já eram papéis separados; "o que a equipe FAZ a partir de um e‑mail" é o quarto, e as duas ações compartilham exatamente as travas que importam.
2. **A posse vai no `where`, como no resto do módulo.** As duas são de escrita e nascem de um id que veio da tela: a mensagem tem de ser da caixa de quem clicou, conferido dentro da própria consulta — nunca numa comparação depois da leitura. Dois testes cobrem isso com a caixa de outra pessoa, e um terceiro afirma o formato do `where` para que apagar a trava fique vermelho.
3. **A trava da casa (ADR‑97) vale nas duas pontas.** Endereço do nosso domínio não vira chave de nada: nem acha cliente (senão bastaria pôr `contato@medconsultoria.com.br` num cadastro descartável para que todo e‑mail interno "pertencesse" àquele cliente), **nem vira lead** — sem isso a primeira conversa entre colegas encheria o funil de leads falsos com o nome da própria equipe. Reusa `casa.ts` inteiro, sem segunda implementação.
4. **Nada duplica, e a resposta ao clique repetido é o objeto que já existe** — não um erro. Anexo já guardado devolve o mesmo documento sem tocar no IMAP; remetente com lead ativo devolve o lead dele. O elo só vale se o documento **ainda existe**: quem apagou o arquivo da ficha e clicou de novo está pedindo para guardar outra vez, não para receber o id de um registro que sumiu (`Arquivo` é soft‑delete).
5. **A allowlist de tipo vale aqui, ao contrário do anexo de SAÍDA (ADR‑96).** Parece incoerência e não é: o anexo de saída é o que a pessoa precisa mandar (`.zip`, `.dwg`, `.p7s`) e nunca é servido pelo nosso domínio; o anexo que vira **documento do cliente** entra num acervo que o Portal serve com o `Content-Type` do banco, então o que ele aceita é o que `/upload` aceita — PDF, imagem, Word e Excel. O `Content-Type` do e‑mail vem com parâmetros (`application/pdf; name="…"`), então a comparação é sobre a parte base, em minúsculas.
6. **Gravar DENTRO do `comCaixa`** — a mesma lição que a rota de download já tinha pago: a conexão IMAP fecha quando o callback retorna e `download()` resolve depois do **primeiro pedaço**, com o resto ainda vindo pelo socket. Devolver o stream para fora e gravar depois entregaria arquivo cortado. E o teto de 20 MB é conferido **pelo que foi para o disco**, não pelo `tamanho` do índice: aquele é metadado do servidor de e‑mail e pode mentir; acima do teto, a gravação é desfeita em vez de deixar arquivo órfão no acervo.
7. **`enviadoPorTipo: "EQUIPE"`, ainda que o arquivo tenha vindo do cliente.** O campo responde "por qual porta entrou", e a porta é a caixa de alguém da casa. Marcar `CLIENTE` dispararia o aviso de "cliente enviou documento" para a equipe inteira toda vez que alguém arquivasse um anexo antigo.
8. **O lead nascido de e‑mail não mente sobre a própria origem.** `createLead` ganhou um terceiro parâmetro opcional (`rastreioPronto`); sem ele, todo lead vindo de outra porta gravaria _"Cadastrado manualmente no sistema"_ no campo que existe justamente para responder de onde a pessoa apareceu. A deduplicação é a mesma da captação pelo site: só lead **ativo** bloqueia (apagado ou já convertido não impede negócio novo).
9. **A chave do vínculo é o que a pessoa VÊ ou o que NÓS escrevemos — nunca um cabeçalho de terceiro.** Foi o **BLOQUEANTE** achado pela revisão de segurança, e é a mesma classe de erro do ADR‑97 (a chave da consulta escolhida por quem não deveria), agora vinda de fora da empresa: `EmailEndereco` guarda também `CC`, `CCO` e `RESPONDER_A`, escritos por **quem manda** e **invisíveis na tela**. Enquanto todos eles eram chave, qualquer estranho sem conta nenhuma escolhia em qual cliente o arquivo dele ia parar — bastava mandar um anexo com `Reply-To: financeiro@clientealvo.com.br` para o documento entrar naquela ficha marcado `enviadoPorTipo: "EQUIPE"`, ou seja, **com a procedência da MedConsultoria**, num canal que o cliente confia (fatura falsa com outro PIX é o roteiro óbvio). Agora: mensagem na pasta **`SENT`** (fato do servidor, não cabeçalho) usa os destinatários, porque quem os escreveu foi alguém da equipe; **qualquer outra usa só o remetente**, que é o que a tela mostra ao lado do botão. Forjar o `From` continua possível em e‑mail, mas aí a decisão do humano é **informada** — com `Cc`/`Reply-To` não havia nada para ler.
10. **O teto de tamanho corta o stream no meio do caminho**, não depois de o arquivo estar no disco (`Transform` com contador), e o `tamanho` do índice serve só para **recusar rápido**, nunca para autorizar. Quem manda o e‑mail escolhe o tamanho, e um único processo Node serve API + SPA num plano compartilhado: disco cheio derruba a app inteira. `salvarArquivo` passou a **apagar o parcial** quando a origem morre no meio (vale para todos os chamadores, não só para este).
11. **Assunto de e‑mail marcado como particular não reaparece pelo rastreio do lead.** A válvula do ADR‑97 não pode ser esvaziada por uma porta lateral: o rastreio é lido pela equipe inteira, e o assunto foi justamente o que o dono da caixa escondeu. O lead ainda pode ser criado — quem clica é o dono, e nome e e‑mail são o negócio.
12. **O contexto da mensagem é consulta à parte** (`email.contextoDaMensagem`), não um campo a mais no `abrir`. Aquilo já é a operação cara (baixa e higieniza o corpo); este contexto é barato e reaparece sozinho depois de criar o lead. É ele que decide o que a tela oferece: cliente único → guardar é um clique; nenhum ou vários → caixa de escolha; colega da casa → o botão de virar lead **não existe**, em vez de existir e recusar.

**O que a corrida perdida ensina, e por que ela não vira exceção:** dois cliques simultâneos no mesmo anexo passam os dois pela conferência de "já arquivado" — entre ler e gravar não há trava. Quem decide o vencedor é o `updateMany` condicionado a `arquivoId: null`; o perdedor **desfaz o próprio documento** (registro e arquivo em disco) e devolve o do vencedor. No **lead** essa garantia não existe: a dedup é ler‑e‑então‑criar, e fechá‑la exigiria um índice único que o soft delete não permite (`Lead.email` se repete de propósito entre um lead apagado e um novo). É o mesmo risco que a captação pelo site (`capturarLead`) já corre; fica **escrito no topo do serviço** para não virar surpresa, em vez de prometido no comentário e não cumprido no código.

**Verificado:** `@app/api` **276** testes de unidade (34 novos em `acoes.test.ts`) · `@app/web` **116** (5 novos de tela) · typecheck 6/6 sem cache · `pnpm lint` 0 erros. Os testes das duas fases passaram por **teste de mutação** antes de serem aceitos — desligar a trava da casa, tirar a posse do `where`, afrouxar a condição do botão e **devolver `Cc`/`Reply-To` à chave do vínculo** deixaram 1, 1, 3 e 1 testes vermelhos, respectivamente. Foi resposta direta à lição da fase anterior (três testes que passavam com o defeito de volta).

**As três revisões (segurança, TypeScript, React) foram feitas antes do merge e mudaram o código.** Além do BLOQUEANTE do item 9, entraram: limpeza do arquivo em disco quando o banco recusa o registro (antes ficava órfão), a corrida do `updateMany` acima, o fechamento da caixa de escolha ao trocar de mensagem (ela continuava aberta mostrando o anexo do e‑mail anterior enquanto o `mensagemId` enviado já era o do novo) e o `nosniff` escrito na própria rota `GET /arquivos/:id` — que hoje está seguro por **defesa emprestada** do helmet global e da allowlist, e passou a não depender de quem amanhã afrouxar qualquer uma das duas.

**Resíduo conhecido, aceito nesta fase:** um FUNCIONARIO pode escolher manualmente qualquer cliente ao guardar um anexo, e o documento entra no acervo sem marca de procedência — o Portal do cliente não distingue "a equipe produziu" de "chegou por e‑mail de terceiro". É o mesmo poder que `POST /upload` já dá, mas ali o conteúdo vem de um funcionário. Fechar isso pede um campo de origem em `Arquivo` (migration), e ficou fora deste PR de propósito.

## Pendências (viram ADR quando decididas)

- ~~Passenger vs Nginx Unit na TineHost (mecanismo de restart / proxy WS).~~ **Restart** = `touch tmp/restart.txt` (LiteSpeed/lsnode). **WS resolvido no ADR-84** (tempo real por polling; não precisa de proxy WS).
- ~~Engine de exportação de PDF em hospedagem compartilhada.~~ **Resolvido no ADR-47** (PDF = `window.print()` da moldura branded = WYSIWYG, sem servidor).
- Estratégia de polimorfismo (`entidadeTipo+entidadeId` vs tabelas de junção) se a performance exigir.
- ~~**Caixa de e-mail dentro do app** (ver/enviar/receber sem sair, estilo Mensagens).~~ **Resolvido no ADR-95** (Bloco 1: plugar e ler — IMAP por usuário, índice+cache, caixa privada) **e no ADR-96** (Bloco 2, fase 2A: escrever/responder/encaminhar/anexar/rascunho por SMTP real). O alerta se confirmou: Gmail/Hotmail exigem OAuth próprio e ficaram **fora da fase 1**. **Bloco 2 concluído:** ficha do cliente na **ADR-97** (fase 2D‑1) e as ações da **ADR-99** (2D‑2 anexo → documento, 2D‑3 remetente → lead).
- Zustand vs Context para o estado global mínimo do front.
- Política de backup do MySQL.

### Achados da auditoria de 05/08/2026 que NÃO foram corrigidos (e por quê)

Levantados na varredura que gerou as ADR‑100/101/102. Ficaram de fora por serem decisão de produto
ou obra de escopo médio — nenhum é desconhecido, e nenhum deve ser redescoberto do zero.

| Achado                                                                                                                                                                                                                                                                                                         | Por que não foi feito agora                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~~**Dinheiro em `Float`**~~ — **RESOLVIDO na ADR-118 (19/08/2026):** os cinco campos viraram `Decimal(12,2)`. Era: `Servico.valor`/`percentual`, `ClienteServico.valor`/`percentual` e `Lead.valorEstimado` em `Float` (só `Conta.valor` era `Decimal`). Eles são somados em JS e o resultado vai para o **texto do contrato** e para a conta a receber: três serviços podem somar `1621.0000000000002`. | Migration de tipo + trocar as somas em `leads.service.ts` e `documentos.service.ts`. Escopo médio, mexe em dinheiro e em documento assinado — merece branch e revisão própria, não pegar carona.                                                       |
| **Trecho do e-mail na ficha** — qualquer FUNCIONARIO pode pôr um endereço externo no cadastro de um cliente e ler, pela ficha, os 200 caracteres iniciais das mensagens que a equipe trocou com aquele endereço.                                                                                               | O ADR‑97 **escolheu** mostrar o trecho à equipe. Estreitar (ex.: trecho só ADMIN+) é mudança de produto, do dono. Vale junto registrar em `ActivityLog` a troca de `Cliente.email`/`Contato.email` — hoje trocar a chave da consulta não deixa rastro. |
| **Token de assinatura do cliente visível ao funcionário** (`assinaturas.doDocumento`) — permite assinar em nome do cliente, e a trilha grava o IP de quem assinou como se fosse o dele.                                                                                                                        | É o mesmo token do botão "Abrir link", funcionalidade documentada ("você escolhe se envia por e‑mail ou copia o link daqui"). Restringir muda o fluxo de trabalho e o valor probatório é assunto jurídico — decisão do dono.                           |
| **Índice de `Notificacao`** — a consulta do sino filtra por `userId` e ordena por `createdAt`, e o índice é `(userId, lida)`: sobra filesort. Roda em polling, para toda sessão aberta.                                                                                                                        | Volume atual é baixo e não há expurgo de notificação antiga. Vale entrar junto da próxima migration, não sozinha.                                                                                                                                      |
| **`CaixaEmail.assinatura`** — lido no envio, escrito por ninguém: a assinatura por caixa está pela metade desde o ADR‑96.                                                                                                                                                                                      | Precisa de campo na tela de plugar/editar caixa; é funcionalidade nova, não conserto.                                                                                                                                                                  |
| **`clientes.excluirDefinitivo` e `clientes.arquivarNota`** — existem no back, sem botão.                                                                                                                                                                                                                       | Decidir se viram tela ou saem do código.                                                                                                                                                                                                               |
| **Suíte `@app/web` intermitente** — uma execução a partir da raiz deu 8/12 arquivos e 4 erros; não reproduziu nas tentativas seguintes (rodando dentro de `apps/web` sempre passou).                                                                                                                           | Precisa de repetição para pegar o padrão. Fica registrado para não ser tratado como novidade quando reaparecer na CI.                                                                                                                                  |
| **`/avatar/:userId`** serve a foto de qualquer usuário para qualquer sessão, inclusive cliente do Portal.                                                                                                                                                                                                      | Enumeração de fotos da equipe. Risco baixo, mas é fronteira do Portal — vale fechar quando alguém tocar o módulo.                                                                                                                                      |

---

## ADR-100 — Quem escolhe o endereço escolhe o que a consulta devolve (fechando a chave envenenável) ✅

**Contexto:** auditoria de segurança de 05/08/2026, disparada pelo pedido do dono de garantir a aplicação inteira. O ADR‑97 documentou, com todas as letras, que o endereço do cadastro é **chave de consulta** do histórico de e‑mail (`chaveDeEndereco` em `emails/enviados.service.ts`; `clientesPorEnderecos` em `email/acoes.service.ts`) e que por isso _"bastava pôr `root@…` no cadastro para listar, de dentro do Portal, os transacionais mandados a uma conta interna"_. A trava criada na época — `ehDaCasa` — barra endereço **do nosso domínio**. Ela nunca barrou o endereço **de outro cliente**, e o Portal deixava o próprio cliente gravar o campo (`portalMeusDadosSchema`, ADR‑80, "direito de retificação").

**A falha, reproduzida em teste antes de qualquer correção:** o cliente A abre "Editar perfil" no Portal, grava no próprio cadastro o e‑mail do cliente B e passa a enxergar, em `portal.emails`, tudo o que a empresa mandou para B — destinatário, assunto, tipo de mensagem, data, status e motivo de falha. O corpo continua protegido; o metadado atravessa a fronteira entre clientes, que é justamente a fronteira que o Portal existe para manter. O mesmo campo é a chave que decide de quem é o cliente ao guardar um anexo recebido: pondo no cadastro o endereço de um terceiro que escreve para a empresa, o cliente A se torna o **único** candidato e o anexo daquele terceiro vira documento dele, baixável pelo Portal.

**Decisões:**

1. **O Portal não grava mais o e‑mail do cadastro.** O campo saiu do `portalMeusDadosSchema` — é o _schema_ que derruba o campo, não a boa vontade da tela: quem ataca não usa a tela. Nome, tipo, CPF/CNPJ e telefone continuam editáveis; a retificação do e‑mail passa a ser pedida à equipe, que é quem tem o histórico para saber o que aquela troca significa. A tela do Portal mostra o endereço em campo desabilitado, dizendo em português onde pedir a troca — campo que some sem explicação vira chamado de suporte.
2. **A trava fica no servidor, não na tela.** O serviço `atualizarMeusDados` deixou de aceitar `email` na assinatura, e o teste chama o **schema** com um payload hostil antes de chamar o serviço, exatamente como um atacante faria.
3. **Freio no "esqueci minha senha", contado por CAIXA e não por IP.** O endpoint é anônimo, dispara e‑mail real e só tinha o rate‑limit global de 300/min por IP — e quem sofre não é quem pede, é o dono da caixa. Teto de 3 por hora por endereço. Contar por IP não protegeria nada (trocar de IP é trivial e o alvo é a caixa). Ao estourar, a resposta continua `{ ok: true }`: qualquer outra resposta viraria um detector de "esta conta existe", derrubando a anti‑enumeração que o endpoint já tinha.

**O que ficou de fora, de propósito, por ser decisão do dono e não defeito:** (a) qualquer FUNCIONARIO ainda pode pôr no cadastro de um cliente um endereço externo e, pela ficha, ler o **trecho** (200 caracteres do corpo) das mensagens trocadas com aquele endereço por toda a equipe — o ADR‑97 escolheu conscientemente mostrar o trecho à equipe, e estreitar isso é mudança de produto; (b) `assinaturas.doDocumento` devolve o token de assinatura do cliente a qualquer funcionário, o que permitiria assinar em nome dele — mas é o mesmo token do botão "Abrir link", uma funcionalidade documentada ("você escolhe se envia por e‑mail ou copia o link daqui"), então restringir muda o fluxo de trabalho.

**Verificado:** o teste de exploração falha antes e passa depois (`isolation.integration.test.ts`); 5 casos novos para o freio do reset, incluindo caixa alta/espaço em volta (senão o teto é contornável) e a virada da janela.

## ADR-101 — No computador é de mentira, no servidor é de verdade (contas de teste públicas + selo na tela) ✅

**Contexto:** regra nova do `CLAUDE.md` global (§0.8), e este projeto é o que mais precisava dela — foi aqui que tratar a senha de teste como segredo, com **a mesma senha valendo nos dois mundos**, custou a rotação de emergência do ADR‑98. O dono não sabe (nem deveria precisar saber) o que é seed ou variável de ambiente para conseguir abrir a própria aplicação.

**Decisões:**

1. **Quatro contas de teste, iguais às dos outros projetos dele**, criadas por `pnpm contas:teste`: `root@teste.local`, `admin@teste.local`, `funcionario@teste.local` e `cliente@teste.local` (esta ligada a um cliente real do banco, para o Portal ter o que mostrar). Senha `teste1234`, **escrita na documentação de propósito**: senha de teste não é segredo, é dado de teste. O que é segredo — a senha de seed, as chaves, o SMTP — continua fora do repositório.
2. **A trava é a do `demo-seed` (`podeRodarDemoSeed`), não uma nova.** Ela já é pura, testada e cobre a armadilha que derrubou a primeira versão do ADR‑98: em produção o banco **também** é `localhost`, então quem separa os ambientes é o `NODE_ENV=production`, nunca o host.
3. **Diferente do `pnpm db:seed`, este script REESCREVE a senha toda vez.** O seed preserva senha de conta existente de propósito; reconfigurar o ambiente de ensaio é exatamente o que se espera deste. Também preenche `senhaTrocadaEm` — sem isso o ADR‑91 manda a conta para a página obrigatória de "defina sua senha" e o ambiente de ensaio não serve para ensaiar nada.
4. **Selo "AMBIENTE LOCAL — dados de teste" na tela**, sempre visível, inclusive no login e no Portal. Aviso em documentação não serve: quem está prestes a apagar um cliente não está lendo o README. Fica `fixed` e `pointer-events-none` porque a barra lateral tem teste que proíbe rolagem (ADR‑94) e as telas de altura fixa calculam `100dvh − 4rem` — uma faixa no fluxo da página quebraria as duas contas. Some do pacote publicado por `import.meta.env.DEV`, que o Vite resolve em tempo de build: não há configuração errada capaz de fazê‑lo aparecer no ar.

## ADR-102 — A página de e-mail para de mentir quando algo falha (e ganha o que faltava chegar à tela) ✅

**Contexto:** o dono pediu, em 05/08/2026, garantia de que "o sistema de e-mails está completo, sem faltar nada". A auditoria confirmou que **as funcionalidades existem** — plugar, ler, escrever, responder, responder a todos, encaminhar com anexos, anexar, baixar anexo, rascunho no servidor, `\Answered` só em resposta, card na ficha, particular com volta, anexo → documento, remetente → lead, e as travas da casa nas duas pontas. O que estava quebrado não era o que a página faz, e sim **o que ela diz quando algo dá errado** — mais três peças que existiam no servidor e nunca chegaram à tela. É a terceira vez que este módulo é mordido pelo mesmo padrão (o download de anexo ficou morto do Bloco 1 até 05/08; `EmailAnexo.arquivoId` nasceu sem escritor).

**O defeito bloqueante:** a consulta de caixas só tratava "carregando". Com `retry: false` global, qualquer falha (API fora do ar, sessão expirada) deixava o dado `undefined` e a página caía no caminho de "lista vazia" — renderizando a **tela de boas-vindas "Conecte a sua caixa"** para quem já tinha caixa plugada. A pessoa conclui que a caixa sumiu, clica em "Adicionar caixa", redigita a senha do webmail e recebe "Você já plugou esta caixa". **Erro travestido de estado vazio é pior que erro**: ele não convida a esperar, convide a agir errado.

**Decisões:**

1. **Todo estado de falha da página tem texto próprio**, antes do teste de vazio: caixas, lista de mensagens e mensagem aberta. A lista deixou de poder dizer "Nenhum e-mail nesta pasta" quando o que houve foi falha de rede — mentir sobre uma pasta cheia é pior do que admitir o erro. Na mensagem aberta, o texto explica o caso **provável e normal**: o link "Abrir na minha caixa" da ficha do cliente aponta para mensagens que podem ser da caixa de outra pessoa, e só o dono abre — antes, o painel simplesmente ficava em branco.
2. **A caixa que quebra no meio da sessão volta a oferecer "Reconectar"** sem F5: o erro do `sincronizar` invalida a consulta de caixas. Efeito colateral desejado e documentado: como o `MutationCache` global só dispara o toast genérico quando a mutação **não** trata o próprio erro, tratar aqui também cala o toast técnico que aparecia a cada 30 segundos.
3. **O estado `ERRO` da caixa passa a ser visível**, como aviso discreto (não erro vermelho de página inteira), dizendo desde quando o que está na tela é do último acesso. `ultimoErro` continua fora da tela de propósito: é texto cru de IMAP (`ECONNREFUSED` e afins), e a regra deste projeto é falar a língua de quem lê.
4. **Dá para DESPLUGAR uma caixa.** `email.removerCaixa` existia com serviço e teste de integração, e nenhuma tela chamava — caixa plugada por engano ficava para sempre, com a senha cifrada no banco. Passa por confirmação, e o texto diz as três coisas que a pessoa precisa saber: sai do Workspace, os e-mails continuam no servidor, e para voltar é só plugar de novo.
5. **"Carregar mais antigos".** `limite`/`antesDe` existiam no servidor e o front nunca os enviava: a tela era fixa nos 50 mais recentes e o resto da janela importada era inalcançável — numa caixa real de 3 meses, a maior parte. Resolvido com acumulador ao lado da consulta viva, sem `useInfiniteQuery`: a primeira página **precisa** continuar sendo a consulta com `refetchInterval`, que é quem traz e-mail novo. Dedup por `id`, porque duas mensagens com a mesma data na virada de página duplicariam a chave do React.
6. **`email.doCliente` e `email.doLead` foram removidas.** Substituídas pelas `conversaDo*` (ADR-97) e sem nenhum chamador. Procedure sem consumidor não é neutra: estas duas estavam entre as poucas do módulo que **não filtram por dono da caixa** — superfície exposta que ninguém exercitava e que, portanto, ninguém veria quebrar.

**O que continua fora, por escopo e não por defeito** (nenhuma ADR afirmou que existiam): mover/excluir mensagem e marcar como não lida; escolher a caixa remetente ao responder com duas caixas plugadas; autocomplete de destinatário; IA para redigir resposta; selo de cliente/lead na lista; corpo com formatação. Some-se o campo `CaixaEmail.assinatura`, **lido no envio e escrito por ninguém** — a assinatura por caixa está pela metade desde o ADR-96 e segue inalcançável.

**Verificado:** `@app/web` 121 testes (eram 116) — 5 novos são de regressão exatamente dos defeitos acima, inclusive "erro não pode virar tela de boas-vindas"; typecheck limpo; `pnpm lint` sem erro novo.

## ADR-103 — Credenciamento por PESSOA: a lista real de documentos, a triagem e o Portal por médico (Bloco A) ✅

**Contexto:** o modelo "Proposta de credenciamento" e a lista de exigências do Portal não eram os da Thaís. A lista do sistema **pedia um documento que ela não pede** ("RG e CPF do médico") e **deixava de pedir a maior parte dos que ela pede**. Pior: a papelada do credenciamento **repete por médico**, e a lista era plana — uma clínica com dois profissionais entregava o diploma de um só e a tela dizia "tudo enviado". Fonte desta ADR: `brand/identidade/Lista de documentos credenciamento médico.pdf` e a spec `docs/superpowers/specs/2026-08-10-proposta-credenciamento-design.md`, aprovada pelo dono.

**Decisões:**

1. **`Profissional` é um model novo, filho de `Cliente`.** O credenciamento é por pessoa: a proposta nomeia cada médico com a especialidade, e três documentos (conselho, diploma, especializações) repetem por profissional. Sem a entidade, não há como contar o que falta de quem.
2. **A lista real tem 14 documentos, em 4 escopos** (`EMPRESA` · `CLINICA` · `PROFISSIONAL` · `RESPONSAVEL_TECNICO`), **uma só para todas as operadoras** (confirmado pelo dono). A spec dizia "18" no cabeçalho e listava 14; conferido no PDF, são 14 — a spec foi corrigida. Três deles são **frente e verso**, o que dá 17 vagas de envio (16 obrigatórias) para um médico.
3. **O progresso conta VAGAS (documento × médico × lado), não exigências.** É a única contagem que não mente numa clínica com mais de um profissional. `vagasCredenciamento`/`progressoCredenciamento` são funções puras em `@app/shared`, para a ficha, o painel do lead e o Portal darem sempre a mesma resposta.
4. **A triagem separa INAPTO de PENDENTE, e AVISA sem bloquear.** `INAPTO` = fato que papelada nenhuma resolve hoje (cliente PF; menos de 5 anos de formado — com o **ano em que fica apto**, que transforma um "não" em oportunidade agendada). `PENDENTE` = falta documento ou informação. Bloqueio duro erraria toda vez que a realidade estivesse na frente do cadastro (o alvará existe, só não foi enviado) e o sistema seria contornado por fora — que é onde o caos mora.
5. **O cliente nunca lê o veredito comercial.** `motivosParaOCliente` é a fronteira: o Portal recebe só as pendências, redigidas como pedido ("falta enviar o alvará da Vigilância Sanitária"). Ele não lê "inapto" nem o motivo de uma recusa. Ampliar depois é uma linha; desfazer o que alguém já leu, não.
6. **A trava de elegibilidade é gravada por CHAVE, não por título** (`ServicoRequisito.travaElegibilidade`). A Thaís pode renomear o documento na tela sem quebrar a regra.
7. **A reconciliação da lista NUNCA apaga exigência.** `Arquivo.requisitoId` é `SetNull`: apagar a exigência solta o arquivo que o cliente já enviou e ele some da tela sem ninguém perceber. Documento antigo fora da lista dela (o "RG e CPF") só perde a obrigatoriedade e continua visível, para ela decidir. Pergunta ao cliente (`INFORMACAO`/`BRIEFING`) não é tocada — a lista do PDF é de papel. A única exceção é lixo NOSSO: linha repetida do mesmo documento é apagada **se não houver arquivo preso nela**.
8. **A sincronização compartilha a promessa em curso, não um booleano de "já rodou".** Duas telas abrindo ao mesmo tempo chamavam a semeadura em paralelo, as duas liam o banco vazio antes de qualquer `create` e as duas criavam a lista inteira — 28 exigências onde deviam existir 14, e uma barra dizendo "0 de 32". Encontrado na verificação em tela, não nos testes.
9. **O credenciamento só aparece para quem o contratou** (ou já tem médico cadastrado). Sem essa amarração, a ficha e o Portal de todo cliente da casa passariam a pedir alvará sanitário a quem só faz marketing.
10. **`profissionalId` do upload é conferido contra o dono do arquivo.** O campo viaja no formulário — inclusive no Portal, onde quem envia é o cliente. Id que não seja de um profissional daquele cliente é descartado, e não recusado, para o endpoint não virar oráculo de "este id existe?".

**Fora deste bloco (vão para B e C):** a grade médico × operadora, o construtor da proposta, o documento fiel ao PDF, a numeração sequencial (**a contagem da Thaís está em 224 — a próxima é a 0225**) e o gatilho da conta a receber na aprovação da operadora.

**Verificado:** 28 testes novos de unidade (triagem, contagem por par, lista dos 14, reconciliação e corrida da semeadura) — suíte de unidade da API em 311/311; 2 testes de tela novos (`e2e/flows-credenciamento-portal.spec.ts`) rodados em **banco isolado**, 7/7 verdes; `pnpm typecheck` limpo nos 6 pacotes; `pnpm lint` sem erro novo. Migração puramente aditiva (só `ADD COLUMN`, `CREATE TABLE`, índice e chave estrangeira) — nada do que existe quebra.

---

## ADR-104 — A grade médico × operadora, a proposta fiel ao papel e o honorário no sucesso (Blocos B e C) ✅

**Contexto:** o Bloco A (ADR-103) fez o credenciamento ser por pessoa na papelada. Faltavam as três coisas que fazem dele um trabalho acompanhável e cobrável: **o preço por cruzamento**, **o documento que a Thaís realmente manda** e **quando a empresa recebe**. A proposta cobrava "valor por operadora × quantidade"; o modelo era uma proposta comercial genérica com o assunto trocado; e a cobrança nascia em três lugares, todos errados. Fonte: `brand/identidade/Proposta Credenciamento…pdf` e a spec `docs/superpowers/specs/2026-08-10-proposta-credenciamento-design.md` (§5.4, §5.5, §6.3, §6.4).

**Decisões:**

1. **Cada cruzamento médico × operadora é uma linha `Credenciamento`.** A operadora credencia PESSOAS: dois médicos da mesma clínica são aprovados em operadoras diferentes, em datas diferentes, e uma negativa vale só para aquele par. "Valor × quantidade" somava certo e não dizia nada disso. Chave única `(profissionalId, operadoraId, tentativa)`.
2. **`NEGADO` não vira `APROVADO` por edição.** A negativa é o fato que sustenta o §3.4 e que justifica cobrar de novo; reverter por edição a apagaria. Voltar a tentar é **linha nova**, `tentativa` 2, com o acordo registrado. `APROVADO` → `ENCERRADO` existe (contrato com operadora se desfaz); `APROVADO` → `NEGADO` não, porque reescreveria a história e a cobrança já emitida.
3. **Editar a grade não apaga o que já saiu do papel.** Desmarcar um cruzamento já protocolado o preserva — aquele processo existe no mundo, correndo na operadora. Só some quem nunca foi protocolado; o serviço devolve quantos preservou, para a tela avisar.
4. **Operadora com credenciamento não sai do catálogo** (FK `Restrict`, com recado explicável em vez de erro de banco) e **profissional com credenciamento é desativado, não apagado** (a FK é `Cascade` e levaria o andamento junto).
5. **Os nomes que entram no documento vêm do banco.** A tela manda ids; o servidor resolve nome e especialidade. Nome de médico num papel que vai ao cliente não pode depender do estado de uma tela.
6. **O modelo da proposta é a transcrição do papel dela** — cinco seções, seis passos do plano de trabalho, e as cláusulas de honorários, observações e confidencialidade palavra por palavra. O sistema escreve só os marcadores: `{{numero}}`, `{{data}}`, `{{cliente.nome}}`, `{{profissionais}}`, `{{profissionais_nomes}}`, `{{operadoras}}`, `{{servicos}}` e `{{consultora}}` — que sai do cadastro de quem emite, porque a Thaís não é a única pessoa da casa que emite proposta.
7. **Um teste guarda a REDAÇÃO, não o código.** "Somente no sucesso", "não haverá adiantamento" e "após 1 (uma) tentativa e negativa" definem quando a empresa recebe e até onde vai o trabalho: reescrever isso ao "melhorar" o texto mudaria o contrato com o cliente, calado. O mesmo teste barra nome de médico real e valor do PDF de referência entrando no repositório.
8. **A numeração continua a contagem MANUAL da Thaís** (§5.5): ela estava em **224** em 10/08/2026, então a primeira emitida pelo sistema é a **0225**. Recomeçar do 1 faria conviverem duas "0034" no arquivo dela. **O maior número já emitido É o estado** — contador em tabela à parte divergiria dos documentos. Duas emissões simultâneas disputam o número: o índice único derruba a segunda, que tenta o seguinte **e reescreve o número no corpo** (trocar só a coluna deixaria o papel mentindo). O número entra no título, porque é por ele que ela procura. Só a proposta que declara `{{numero}}` entra na sequência.
9. **A conta a receber nasce quando a operadora APROVA — e só ali.** É o que a proposta promete: honorário no sucesso, sem adiantamento. Três portas cobravam antes: contratar o serviço na ficha, converter o lead, e o aceite da proposta (que já não cobrava, mas por acidente — credenciamento não grava `itens` —, não por regra). `ehServicoDeCredenciamento` marca o serviço que se cobra diferente e as duas primeiras o pulam; a terceira ganhou teste.
10. **Criar a conta NÃO é best-effort.** Se ela falhar, a aprovação falha junto. Credenciamento aprovado sem conta é dinheiro que ninguém cobra e ninguém descobre — o erro visível na hora custa menos que a receita perdida em silêncio.
11. **Na tela, a grade é por médico, não uma matriz.** O construtor da proposta mora na coluna estreita de um modal: uma matriz médico × operadora não caberia. Cada médico é um cartão com as operadoras dentro, valor padrão que preenche a célula marcada e total ao vivo. **Cliente sem médico cadastrado mantém o formato antigo** (operadoras + valor por operadora): travar a venda por ordem de cadastro seria pior que a imprecisão.
12. **`valorPorExtenso` mudou de casa** (`apps/web/src/lib/masks` → `@app/shared`, reexportado no endereço antigo). O servidor também escreve valor por extenso agora, e o mesmo número escrito de duas formas no mesmo papel é erro de documento, não detalhe de código (ADR-32).

**Verificado:** 27 testes novos — 19 de unidade das regras puras (total da grade com células vazias, transições permitidas e recusadas, nova tentativa, numeração, valor por extenso), 8 do modelo da proposta, e **5 de integração** com banco real que provam o que a spec §8 pede nominalmente: **o aceite NÃO cria conta; a aprovação cria, no valor da célula**; contratar na ficha não cobra; aprovar duas vezes não cobra duas vezes; negado não cobra. Suíte de unidade em **338/338**; `pnpm typecheck` limpo nos 6 pacotes; `pnpm lint` sem erro novo. Migração puramente aditiva (`CREATE TABLE Credenciamento`, `ADD COLUMN Documento.numero`, índices e chaves estrangeiras).

---

## ADR-105 — A auditoria de tela do credenciamento: o que estava em curso não pode sumir ✅

**Contexto:** os Blocos A, B e C entraram em produção em 10/08/2026 com 338 testes verdes. A verificação seguinte foi feita **pela tela**, gerando uma proposta de verdade e percorrendo o fluxo inteiro — cadastro do médico, grade, protocolo, aprovação, cobrança, e o Portal do lado do cliente. Cinco defeitos apareceram ali que nenhum teste pegava, porque todos moram na costura entre as telas, não dentro de uma função.

**Decisões:**

1. **A grade mostra o médico DESATIVADO que ainda tem cruzamento registrado.** `removerProfissional` desativa em vez de apagar justamente para preservar o andamento e o elo com a cobrança (ADR-104 §4) — mas a grade lia só `ativo: true`, e o efeito real era o oposto do pretendido: o médico saía da tela levando junto os processos dele. Reproduzido: um credenciamento **APROVADO**, com conta a receber de R$ 2.500 viva no Financeiro, ficou invisível na ficha, enquanto o cabeçalho do card seguia anunciando "1 de 5 aprovado(s)" — um aprovado que não existia em lugar nenhum da tela. Agora ele vem com `ativo: false`: o card de andamento **mostra** (é trabalho em curso, e é onde se age sobre ele) e o construtor da proposta **não oferece** (não se vende credenciamento novo de quem saiu da lista).
2. **A aprovação invalida as DUAS telas de dinheiro.** A conta nascia certa, mas o card "Financeiro" da ficha lê de `clientes.relacionados`, e só a página Financeiro era invalidada. A Thaís aprovava e via, ao lado, "Nenhuma conta vinculada" — concluindo que a cobrança não tinha nascido. O defeito era de atualização de tela, e a conclusão errada era sobre dinheiro.
3. **O acervo de documentos diz de qual médico e de qual lado é cada arquivo.** A papelada do credenciamento repete por pessoa: uma clínica com dois médicos tem seis linhas "Diploma", "Registro no Conselho" e "Especializações", frente e verso. "Seus documentos" no Portal — e o card equivalente na ficha — mostravam seis itens de nome idêntico, sem como saber qual era qual nem qual estava sendo removido. `listarArquivos` passou a trazer `lado` e o profissional.
4. **Aprovação e negativa avisam a equipe.** Eram os dois únicos desfechos que mudam dinheiro e conduta e não geravam aviso nenhum — existiam só no `activityLog`, que ninguém abre, e no toast de quem clicou. Quem cuida do Financeiro, ou o responsável que não estava com a tela aberta, não ficava sabendo. Dois templates novos (`credenciamento_aprovado`, `credenciamento_negado`), pelo mesmo caminho de qualquer outro aviso do sistema — notificação interna e, para quem deixou ligado, e-mail.
5. **Tabela de Markdown usada como layout não ganha faixa azul.** O Markdown não tem tabela sem cabeçalho; o par de assinaturas no pé da proposta é obrigado a deixar a primeira linha vazia, e o estilo da folha pinta todo `th` de azul escuro. O PDF que vai para o médico saía com uma tarja azul sólida flutuando sobre as linhas de assinatura. Cabeçalho inteiramente vazio deixa de ser renderizado; cabeçalho com texto continua cabeçalho (a tabela de investimento não muda).

**Também:** `observacoes` e `emAnaliseEm` eram gravados no banco e nenhuma tela lia — o diálogo de andamento ganhou o campo de anotação e o card passou a mostrar as duas coisas. A confirmação de remover um profissional agora diz que o credenciamento também é preservado, e não só os documentos.

**Verificado:** 4 testes de integração novos (`credenciamento-grade-visibilidade`) que provam que nenhuma célula fica sem linha de médico para ser desenhada, e 3 de unidade da folha do documento (`tabela-sem-cabecalho`). Suíte: **338/338** unidade da API, **124/124** do web, **9/9** integração do credenciamento, **8/8** e2e (grade + Portal, banco isolado); `pnpm typecheck` limpo nos 6 pacotes; `pnpm lint` sem erro. Sem migração — nenhuma mudança de schema.

---

## ADR-106 — O Painel de Credenciamentos: a visão que tirava a Thaís da planilha ✅

**Contexto:** os Blocos A, B e C entregaram o credenciamento por pessoa, com preço por cruzamento, documento fiel ao papel e cobrança no sucesso — e a ADR-105 costurou as telas. Faltava, ainda assim, a pergunta que ela faz **de manhã**: _o que travou?_ O andamento só existia dentro da ficha de cada cliente, um por vez. Para saber o que estava parado, era abrir cliente por cliente e somar de cabeça — ou seja, manter a planilha paralela. Um sistema que obriga a planilha ao lado não substituiu o caos: virou mais um lugar para olhar.

**Decisões:**

1. **Uma tela transversal, `/credenciamentos`, no menu em Negócio.** Uma linha por cruzamento médico × operadora, de **todos** os clientes. O ADR-94 pedia no máximo 4 itens por grupo e Negócio passou a ter 5: credenciamento é o principal serviço da casa e é uso diário — deixá-lo fora do menu, só no Ctrl+K, seria cumprir a regra e falhar no motivo dela. O limite que continua sendo lei, e testado, é **o menu não rolar** (`e2e/menu-sem-scroll.spec.ts`, verde nos três tamanhos com o item novo).

2. **A tela abre pelo que está travado, não pelo mais recente.** Ordenação: quem precisa de atenção primeiro e, dentro de cada grupo, o parado há mais tempo. É o contrário do padrão de quase toda listagem daqui, e é deliberado — a ordenação _é_ a resposta à pergunta dela.

3. **O prazo é 60 dias, e veio da Thaís.** A proposta inicial de engenharia era 30; ela corrigiu em 11/08/2026 ("a partir de 60 dias precisamos ficar de olho"). É o prazo real de resposta das operadoras. Fica **editável em Ajustes → Dados da empresa** (`IdentidadeInstitucional.credenciamentoPrazoDias`, migração `20260811204308`), porque operadora muda de ritmo e ela não deve precisar de alteração de código para ajustar.

4. **O tempo conta a partir do carimbo da situação ATUAL, não da criação.** Um processo criado há cem dias e protocolado ontem está parado há um dia; dizer "cem" faria cobrar uma operadora que acabou de receber o papel. Sem carimbo (o caso normal de `A_PROTOCOLAR`, e o de dado anterior ao Bloco B), volta para `createdAt`. Nunca negativo.

5. **`A_PROTOCOLAR` também conta como atraso — e é o mais barato de resolver**, porque a culpa ali é nossa, não da operadora. Já os estados finais (aprovado, negado, encerrado) **nunca** são marcados: eles não esperam ninguém, e alarme que toca sempre é alarme que ninguém mais olha. Pelo mesmo motivo, a coluna mostra a **data** do desfecho para quem terminou e "há N dias" só para quem corre: "parado há 3 dias" num aprovado seria mentir com uma palavra.

6. **Mudar a situação pelo painel usa a MESMA `mudarStatusCredenciamento` da ficha.** O diálogo (`MudarStatusDialog`) foi exportado e passou a pedir o mínimo de que precisa, em vez de a célula inteira da grade. Um segundo caminho faria as travas de dinheiro — negado não vira aprovado, aprovar cria a conta a receber e falha junto se a conta falhar — viverem em dois lugares. Regra de dinheiro escrita duas vezes são dois relógios: nunca se sabe qual está certo.

7. **Médico desativado continua na lista, marcado "fora da lista"** — a mesma decisão da ADR-105, aplicada de novo aqui: filtrar por `ativo: true` no painel apagaria exatamente quem foi desativado _para_ preservar o processo e a cobrança que ele sustenta. Verificado na tela.

8. **Os totais descrevem o que está na tela, não o banco.** Um resumo que ignora o filtro ativo faz somar peras com maçãs sem perceber.

**Verificado:** 14 testes novos escritos **antes** da implementação (`credenciamento-painel.test.ts`: carimbo da situação atual, prazo configurável, estados finais nunca marcados, ordenação estável e sem mutar o array). Suíte: **352/352** unidade da API, **124/124** do web, **87/87** e2e em banco isolado, `pnpm typecheck --force` limpo nos 6 pacotes. Verificado também **pela tela**, com dados envelhecidos de propósito no banco local: o alerta acendeu em 2 linhas ("há 90 dias", "há 75 dias") na ordem certa, o filtro "só os parados" recortou para 2, aprovar pelo painel **criou a conta a receber** de R$ 2.500 no Financeiro (conferida no banco), e em 360px a página não rola de lado — a tabela rola dentro do próprio quadro.

**Armadilha registrada:** `prisma migrate dev` reexecuta o seed, que recria as contas internas com `senhaTrocadaEm` nulo (ADR-91). O e2e então loga e cai na página obrigatória de definir senha, e o setup falha com "3 campos de senha". Não é defeito do código: é efeito de migrar em ambiente local. Destravar é marcar `senhaTrocadaEm` nas contas de equipe do banco de desenvolvimento. Em produção o deploy usa `migrate deploy`, que **não** roda seed.

---

## ADR-107 — As 34 falhas de dependência que chegavam ao servidor ✅

**Data:** 2026-08-12 · **Contexto:** o aviso do GitHub apontava 76 vulnerabilidades no repositório. `pnpm audit --prod` — que olha só o que é **empacotado e enviado ao servidor** — mostrou **34**, sendo **10 graves**. As outras 42 são ferramentas de desenvolvimento e não vão ao ar; corrigi-las teria custo e nenhum ganho de segurança em produção.

**Decisões:**

1. **34 avisos eram 8 bibliotecas.** O número assusta porque cada biblioteca acumula um aviso por CVE. O trabalho real foi: `dompurify` (17 avisos), `@fastify/static` (4), `postcss` (2), `fast-uri` (2), `brace-expansion` (2), `nanoid` (2), `find-my-way` (1), `socket.io-parser` (1). Contar pacotes, não avisos, é o que dimensiona a tarefa honestamente.

2. **O `dompurify` era o mais assustador e o menos exposto — e foi atualizado assim mesmo.** Ele é o filtro que barra HTML malicioso no `renderMarkdown` da folha A4, e o Portal recebe texto de cliente. Mas `sanitize()` (`DocumentoBranded.tsx`) o usa no **modo mais simples**: só `FORBID_TAGS`/`FORBID_ATTR`, sem `IN_PLACE`, sem ganchos, sem `ADD_TAGS`, sem `CUSTOM_ELEMENT_HANDLING`, sem `SAFE_FOR_TEMPLATES` — que é o alvo de 13 dos 17 avisos. Os que **sim** nos alcançavam eram os genéricos de mutation-XSS. 3.2.3 → **3.4.13**. Registrar isto importa: se um dia alguém ligar `IN_PLACE` ou um gancho, a conta de risco muda, e a razão desta análise deixa de valer.

3. **Transitivas foram fechadas por `pnpm.overrides` na raiz, não esperando os pacotes-pai.** `fast-uri`, `find-my-way`, `nanoid`, `postcss`, `socket.io-parser` e `brace-expansion` entram por dentro do Fastify e do Vite; aguardar o release de cada pai deixaria a falha viva por semanas.

4. **`brace-expansion` foi travado como `brace-expansion@5`, não solto.** Convivem três versões maiores na árvore (1.1.16, 2.1.2, 5.0.7) e **só a 5 tem o defeito**. Um override sem escopo forçaria a 5 sobre quem pede a 1 ou a 2 e quebraria por consertar. Escopo por major é a diferença entre corrigir e derrubar.

5. **`@fastify/static` pulou duas versões maiores (8 → 10.1.2), e isso foi verificado, não presumido.** A v10 depende de `fastify-plugin ^6`, compatível com o Fastify 5 que já rodamos — nenhum bump de servidor foi necessário. Nosso uso é mínimo (`{ root, wildcard: false }` + `reply.sendFile` no fallback da SPA), e é justamente essa rota que os 87 testes de ponta a ponta exercitam a cada tela aberta.

**Verificado:** `pnpm audit --prod` de **34 avisos (10 graves) para 0**. Suíte completa depois da troca: **352/352** unidade da API, **124/124** do web (inclusive os **12 testes de XSS** que exercitam o DOMPurify trocado), **87/87** e2e em banco isolado, `pnpm typecheck` 6/6, `pnpm build` 2/2.

6. **A CI passou a reprovar falha ALTA ou CRÍTICA no que é empacotado** (`ci.yml`, job `build-test`, logo após o `install`). São dois passos: um informativo, que mostra tudo inclusive as moderadas sem reprovar, e o portão, `pnpm audit --prod --audit-level high`. **O corte é `high` de propósito.** CVE novo aparece toda semana; portão que reprova em qualquer gravidade transforma PR alheio em refém e, em duas semanas, alguém o desliga. Portão que reprova no que é grave é portão que se cumpre. `--prod` mantém ferramenta de desenvolvimento fora da conta — ela não vai ao ar, e reprovar por ela ensinaria a ignorar o alarme.

**O que ficou de fora, de propósito:** as 42 vulnerabilidades de ferramenta de desenvolvimento (não são empacotadas, não chegam ao servidor). E as **moderadas/baixas em produção não reprovam** — aparecem no passo informativo e dependem de alguém ler.

**Publicado em produção em 12/08/2026 às 14:06** — ensaio de boot OK (16 portas ouvindo), `restart.txt` marcado, smoke `{"status":"ok"}`; `/` e `/credenciamentos` conferidos de fora, HTTP 200. Sem migração nova (`No pending migrations to apply`), o que fez deste o deploy de menor risco possível.

**Armadilhas registradas:**

- **⛔ Dois `./deploy.sh` simultâneos se sabotam — e o sintoma parece defeito de código.** O deploy passa de 2 minutos e **parece travado**; o comando foi colado duas vezes e **os dois falharam**, sem nada de errado no artefato. Disputam o **mesmo `/tmp/boot-teste.log`** do servidor, a **mesma porta** do `node app.cjs` e os **mesmos `node_modules`** do `prisma generate` (o segundo travou o Node ali). Uma execução limpa em seguida passou de primeira. **O sintoma que identifica:** ensaio reportando `0` com `--- erros ---` e **nada embaixo** — lista de erros vazia é evidência apagada por concorrência, não app quebrado. **Rollback correto é o PRIMEIRO snapshot da rodada**: do segundo em diante ele já foi tirado depois de outro deploy sobrescrever arquivos, e restauraria um estado misturado. E resolva no mesmo dia: o passo 3 grava os arquivos novos **antes** do ensaio, então um deploy reprovado deixa a produção rodando o código velho de memória com o disco já trocado — e o healthcheck reiniciaria com ele.
- **A instalação falha no Windows com `ERR_PNPM_ENOENT ... plugin-react_tmp_NNNN`** quando o override mexe numa dependência do Vite e a pasta do pacote fica meio-desmontada. Pausar a app **não** basta. O que destrava: `rm -rf node_modules/@vitejs` e `pnpm install` de novo.
- **`flows-financeiro.spec.ts` ("marcar paga, filtrar e excluir") é instável na suíte cheia** e passa 10/10 sozinho. Falhou uma vez, passou nas duas rodadas seguintes — instabilidade do teste, não defeito do código. Se voltar a falhar, é ali que se deve olhar antes de culpar a mudança.

---

## ADR-108 — A conversão do lead cobrava credenciamento antes de a operadora dizer sim ✅

**Data:** 2026-08-17 · **Contexto:** varredura pela tela, do jeito da ADR-105 — percorrer um fluxo de negócio inteiro em vez de clicar solto. Criei um lead com o único serviço que é o carro-chefe da casa (Credenciamento médico e odontológico), converti em cliente, e o card **Financeiro** da ficha nasceu com uma conta a receber. Nenhuma operadora tinha dito nada.

**O defeito:** o laço que soma os serviços já pulava o credenciamento (`ehServicoDeCredenciamento(s.nome) → continue`), honrando a ADR-104. Mas logo abaixo havia um **fallback**: se nenhum serviço tinha preço, provisionava uma conta única com a **estimativa do funil**. Esse `else` não olhava os serviços. Lead só de credenciamento cai nele **sempre** — o serviço não tem preço de conversão justamente porque não se cobra ali. A guarda existia e era contornada pelo caminho de baixo.

**Por que dói:** o honorário do credenciamento é **no sucesso** (spec §3.3, ADR-104) — a conta nasce quando a operadora **aprova**, uma por médico × operadora. Com o defeito, o cliente aparecia devendo no dia da conversão e, quando a operadora aprovasse, era cobrado **de novo**. Dinheiro duplicado, e no serviço que mais roda aqui.

**Decisões:**

1. **A regra virou função pura, testável, ao lado da que já dizia o que é credenciamento** — `planejarProvisaoDaConversao` em `credenciamento.service.ts`. Ela devolve `avulso`, `mensal`, `percentuais`, `temCredenciamento` e `usarEstimativa`. O serviço de conversão passou a só obedecer. A decisão de cobrar não deve morar dentro de um `try/catch` de 40 linhas com três caminhos: ali ela é invisível para teste e foi assim que o `else` escapou.

2. **A estimativa do funil só provisiona se sobrou algo além do credenciamento** — ou se o lead nem escolheu serviço. Lead **só** de credenciamento não gera conta nenhuma na conversão.

3. **No caso misturado, a conta avisa em vez de calar.** Lead com credenciamento **e** outro serviço continua provisionando o outro serviço, e a observação da conta passa a dizer: _"O credenciamento NÃO está neste valor: o honorário dele só vira conta quando a operadora aprova."_ A estimativa do funil normalmente embute o credenciamento; sem essa frase a Thaís revisaria um número contaminado achando que estava conferido.

**Verificado na tela, não só no teste:** lead "Dr. Só Credenciamento / Clínica Prova ADR-104", único serviço credenciamento, **R$ 12.000,00** de estimativa. Depois de converter: cliente criado, projeto criado, reunião de kickoff criada, e o card Financeiro da ficha diz **"Nenhuma conta vinculada."**. Antes desta correção o mesmo caminho criava R$ 12.000,00 a receber. Testes: 8 casos novos em `conversao-provisao-financeira.test.ts` (inclusive o misturado e o comparador de nome insensível a caixa/espaço).

**O que ficou de fora, de propósito:** no caso misturado sem preço em nenhum serviço, a estimativa ainda é usada inteira — ela pode conter o credenciamento por dentro. Separar isso exigiria a Thaís informar dois números no funil, o que é pedir trabalho para resolver ambiguidade dela. A frase na observação é a saída honesta: o número é revisável e agora diz o que não inclui.

---

## ADR-109 — "Alguém concluiu um projeto" era ninguém ✅

**Data:** 2026-08-17 · **Contexto:** o widget **Atividade recente** do Início mostrava linhas como _"Alguém concluiu um projeto"_ e _"Alguém reabriu um projeto"_, com avatar de gente. Não havia gente: `reconciliarStatusProjeto` conclui e reabre o projeto **sozinho** quando o último cartão fecha ou sai de "Concluído", e grava o histórico com `userId: null`.

**Decisões:**

1. **Quem sabe que foi automático é o servidor, e agora ele conta.** Os dois eventos já eram gravados com `dados: { auto: true }`, mas o `dashboard.service` descartava `dados` ao montar a resposta. Passou a devolver `auto: boolean`. A tela não deve inferir intenção do servidor pelo nome da ação.

2. **A tela obedece à marca, e "Alguém" voltou a significar o que a palavra diz.** `atorDaAtividade` (função exportada, testada) devolve **Automação** quando `auto` é verdadeiro — ou quando a ação começa com `lead.auto`, que é o avanço automático do funil e não carrega a marca. "Alguém" ficou só para o autor **genuinamente desconhecido**, que é o caso raro para o qual o rótulo foi criado. Antes ele mandava o dono procurar um responsável que não existia.

**Verificado:** 5 casos novos em `atividade-label.test.ts` (10 no arquivo). Na tela: as linhas de projeto concluído/reaberto passam a aparecer como **Automação**, com o ícone de automação que o widget já tinha e não usava para elas.

---

## ADR-110 — `tel:` com parêntese não disca ✅

**Data:** 2026-08-17 · **Contexto:** no painel do lead, o botão **Ligar** montava `tel:(11) 98765-4321` — o telefone como está na tela, com máscara. O botão do **WhatsApp** ao lado já normalizava para `5511987654321`. Discador de celular e softphone engasgam com parêntese e espaço, e a ligação simplesmente não sai; o defeito é silencioso.

**Decisão:** o `tel:` passou a usar os mesmos dígitos que o WhatsApp já usava (`telDigits`), com `+55` na frente quando falta. Um número, duas portas de saída, a mesma normalização.

**Verificado:** o `href` sai `tel:+5511987654321` no painel do lead — o único lugar da app que monta `tel:`.

---

## ADR-111 — O deploy saiu do laptop e virou um botão no GitHub ✅

**Data:** 2026-08-17 · **Contexto:** com a correção da ADR-108 mesclada e a CI verde nos três jobs, a publicação foi **barrada pelo classificador de segurança do assistente** — não pelo `settings.json`, que não tem uma regra sequer sobre `ssh`. O `./deploy.sh` faz `tar | ssh` a partir da máquina do dono, e esse formato de comando é bloqueado de forma imprevisível. Resultado prático: uma correção de dinheiro, pronta e testada, ficou parada por um motivo que não tinha nada a ver com o código.

**Decisões:**

1. **O deploy passou a rodar no runner do GitHub** (`.github/workflows/deploy.yml`), com a **mesma sequência de 6 passos** do `deploy.sh` — inclusive as quatro cicatrizes: `tar | ssh` em vez de `rsync` (que apagaria o `.htaccess`), `source` do virtualenv antes de qualquer `npm`, uma **conexão SSH por passo** (encadear com `&&` faz o `prisma generate` derrubar o resto e o deploy mentir que concluiu), e o ensaio de boot avaliado **sem cano e sem herdar o código do `grep`**.

2. **O gatilho é `workflow_dispatch` e só ele**, com um campo que exige digitar `PUBLICAR`. Nada de `on: push` — cada envio ao GitHub indo direto ao ar, num sistema com dado de cliente, é o oposto do portão do §0.9.

3. **A chave SSH saiu do disco do dono e foi para GitHub Secrets.** Três segredos, postos por ele uma vez (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`); o valor nunca passa pela conversa. Caminho do app e porta 1992 ficam no workflow — não são segredo, já estão na documentação.

4. **`concurrency: deploy-producao` matou a armadilha mais cara do projeto.** Dois `./deploy.sh` ao mesmo tempo se sabotavam disputando `/tmp/boot-teste.log`, a porta do `node app.cjs` e os `node_modules` do `prisma generate` — e o sintoma (ensaio com `0` e lista de erros **vazia**) parecia defeito do código. Acontecia porque o deploy passa de 2 minutos, parece travado, e o comando era colado de novo. Agora a segunda execução **espera**. O problema deixou de depender de alguém lembrar de um aviso.

5. **O smoke test virou portão, não enfeite.** O workflow só termina verde se `/health` responder `{"status":"ok"}` **e** `/` e `/credenciamentos` devolverem 200, lidos de fora com `--compressed` (sem ele o LiteSpeed devolve corpo comprimido e o teste lê lixo binário). Workflow verde com site fora do ar é pior que workflow vermelho.

6. **O `deploy.sh` foi mantido**, com os comentários de cicatriz intactos: é a documentação executável da sequência e a saída de emergência se o GitHub estiver fora do ar. Apagá-lo trocaria uma dependência (o laptop) por outra (o GitHub) sem deixar rota alternativa.

**Verificado:** YAML validado (`js-yaml`, 12 passos, gatilho `workflow_dispatch`). **A primeira execução real depende dos três segredos, que só o dono pode pôr** — até lá o workflow existe e não publica, que é o comportamento correto.

---

## ADR-112 — O portão de dependências pegou a primeira falha nova sozinho ✅

**Data:** 2026-08-17 · **Contexto:** o PR do workflow de deploy (ADR-111) teve a CI reprovada — não por nada que o PR mudou, mas porque **apareceu uma falha ALTA nova** numa dependência: `deepmerge-ts` <8.0.0 (GHSA-ggr8-5vv4-36mx, exaustão de pilha ao mesclar grafos recursivos de objeto). Foi a **primeira vez que o portão criado na ADR-107 reprovou algo por conta própria**, cinco dias depois de existir. É o comportamento que se queria comprar.

**Decisões:**

1. **Override escopado por versão maior, como manda a ADR-107** — `"deepmerge-ts@7": "^8.0.0"`. Só a 7.1.5 existia na árvore, então um override solto daria no mesmo hoje; o escopo é o que impede a correção de virar quebra amanhã, quando outra dependência trouxer uma 6 ou uma 9.

2. **Dois pais, um só resultado.** A biblioteca entra por `@prisma/client → prisma → @prisma/config` (tempo de build) **e** por `mailparser → html-to-text` (tempo de execução, a cada e-mail lido). O segundo é que importa: é o caminho que extrai o texto da mensagem.

3. **Pulo de versão maior por baixo do e-mail não se verifica com `typecheck`** — o defeito apareceria como **caixa de entrada em branco**, em produção, sem erro nenhum. Entrou um teste (`email-texto-html.test.ts`) que lê três mensagens de verdade pelo `mailparser`: só-HTML, HTML aninhado com tabela/lista/link (a estrutura recursiva que o CVE atacava) e uma com anexo — porque o anexo vira documento do cliente com um clique (ADR-99) e some sem aviso se o parser parar de enxergá-lo.

4. **O teste entra pelo `mailparser`, não pelo `html-to-text`.** O `html-to-text` é transitivo e não tem tipos; importá-lo direto no teste criaria dependência nova só para testar, e testaria um caminho que a aplicação não usa. Testa-se pela porta que a API realmente abre.

**Verificado:** `pnpm audit --prod --audit-level high` → **"No known vulnerabilities found"**. `deepmerge-ts 8.0.1`, versão única na árvore. Depois da troca: **363/363** unidade da API (3 novos), 129/129 web, `pnpm typecheck` 6/6, `pnpm build` 2/2.

**O que isto ensina sobre o portão:** ele reprovou um PR que não tinha nada a ver com o problema. Isso é ruído — e é o preço certo. A alternativa (descobrir a falha quando alguém for olhar o painel do GitHub) foi exatamente o que produziu as 34 vulnerabilidades da ADR-107.

---

## ADR-113 — A primeira publicação pelo GitHub revelou dois defeitos que o laptop escondia ✅

**Data:** 2026-08-17 · **Contexto:** com os três segredos postos, o workflow da ADR-111 rodou pela primeira vez. Falhou duas vezes antes de passar — e **as duas falhas eram defeitos reais que existiam havia meses**, escondidos porque o deploy sempre saía da mesma máquina. Nenhuma delas tocou a produção: as duas morreram antes do passo 7, o único que reinicia.

### Falha 1 — o `esbuild` que ninguém declarou (passo 1, build)

`ERR_MODULE_NOT_FOUND: 'esbuild' imported from scripts/bundle-deploy.mjs`. O script sempre importou `esbuild`; a raiz nunca o declarou. No laptop funcionava porque **alguma dependência do Vite deixava uma cópia solta na raiz do `node_modules`**. Num ambiente limpo o pacote não existe.

O detalhe que dói: convivem **quatro** versões de esbuild na árvore (0.21.5, 0.25.12, 0.27.7, 0.28.1). Sem declaração, **qual delas montava o artefato que vai para produção era sorte da ordem de instalação** — e podia mudar de um `pnpm install` para o outro sem ninguém perceber. Fixado em **0.27.7**, a que a raiz vinha usando de fato e a que gerou os deploys bons até aqui.

### Falha 2 — a hospedagem corta conexões SSH repetidas (passo 4, envio)

Passos 2 e 3 conectaram e o snapshot de rollback foi criado no servidor; o passo 4 morreu com `connect to host ... port 1992: Connection timed out` — **sem sequer abrir a porta**. A TineHost corta conexões SSH repetidas vindas de um IP desconhecido, e o runner do GitHub é sempre um IP novo. Uma conexão por passo — o que o `deploy.sh` sempre fez, e que no laptop nunca incomodou porque o IP era o de ontem — esbarra nisso na terceira ou quarta.

**A saída não foi voltar a encadear com `&&`:** a terceira cicatriz continua valendo (o `prisma generate` derruba a cadeia e o deploy mente que concluiu). A saída foi **multiplexação** — `ControlMaster` abre **uma** conexão TCP no passo 2 e todos os passos seguintes a reaproveitam. Cada comando segue na própria **sessão**, com o próprio código de saída; o que deixa de se repetir é o aperto de mão na porta. A abertura tem 4 tentativas com espera crescente (30s, 60s, 90s): se a hospedagem está punindo o IP, **esperar** é o que resolve e insistir rápido é o que prolonga o castigo.

Junto veio um ganho de segurança: um apelido `deploy` na configuração de SSH do runner carrega host, usuário, porta e chave, e **só o passo 2 encosta nos segredos** — os outros seis diziam `${{ secrets.* }}` sem precisar.

### O que isto ensina

**Tirar o deploy do laptop pagou-se na primeira execução.** Os dois defeitos eram reais e antigos; o `deploy.sh` "funcionava" havia meses apoiado em dois acidentes da máquina de uma pessoa só — uma cópia de pacote que por sorte estava lá, e um IP que o servidor já conhecia. Ambiente limpo não é burocracia: é o que transforma sorte em erro visível.

**Verificado — a publicação passou e foi conferida de fora, não pelo relatório do workflow:** `No pending migrations to apply` · ensaio de boot **16 portas ouvindo** · `restart.txt marcado em 2026-08-17 17:52:33` · `/health` → `{"status":"ok"}` · `/`, `/credenciamentos` e `/comecar` → **200**, medidos por `curl` daqui. Na tela: página de login renderiza **sem a faixa "AMBIENTE LOCAL"** (a prova de que o pacote publicado é o de produção) e **zero erros de console**.

**No ar desde 17/08/2026 às 17:52** — ADR-108, ADR-109, ADR-110 e ADR-112 publicados.

---

## ADR-114 — A troca da chave do servidor virou workflow, porque o passo que revoga é o que se esquece ✅

**Data:** 18/08/2026 · **Estado:** EXECUTADA em 18/08/2026 às 16:06 (BRT). A chave vazada em 17/08 não abre mais o servidor.

### O problema

Em 17/08/2026 a chave **privada** de deploy foi parar numa conversa — uma seleção de arquivo no editor, que joga o conteúdo no contexto do mesmo jeito que colar. Ninguém a usou. Mas chave privada é a senha do servidor, e a premissa de que só o dono a tinha deixou de valer. A dívida ficou aberta por um dia.

### A parte que quase todo mundo erra

**Gerar uma chave nova não revoga a antiga.** As duas passam a valer ao mesmo tempo. O que revoga é apagar a linha da velha do arquivo de chaves autorizadas do servidor — um passo manual, invisível, sem retorno visual, e por isso o mais esquecido de toda a rotação. Uma rotação "concluída" sem ele é teatro: o vazamento continua exatamente tão explorável quanto era.

Foi para tornar **esse** passo obrigatório e verificável que a troca virou arquivo em vez de receita.

### A decisão

`.github/workflows/rotacionar-chave-deploy.yml`, gatilho `workflow_dispatch` com confirmação digitada, `concurrency: deploy-producao` **compartilhado com o deploy** — rotacionar a chave no meio de uma publicação deixaria o passo seguinte dela sem acesso.

Roda no GitHub pela regra do §0.9 (nenhuma janela administra servidor a partir do laptop) e por uma razão específica desta tarefa: **o runner já tem a chave antiga funcionando, então ele se autoriza sozinho.** Ninguém precisa abrir SSH à mão, nem colar chave em painel, nem pedir que o dono edite arquivo de servidor — que era o ponto onde a receita anterior morria.

### A ordem, que é metade do projeto

autoriza a nova → **prova que a nova entra** → só então remove a velha → **prova que a nova continua entrando e que a velha é recusada**.

Falhar antes da remoção não custa nada: o acesso antigo continua intacto e é só rodar de novo. O caminho contrário — remover primeiro — tranca todo mundo do lado de fora se a chave nova tiver um dedo trocado, e aí a saída é o suporte da hospedagem. O arquivo de chaves é copiado antes da edição (`authorized_keys.bak-<carimbo>`).

### A outra metade: quatro coisas que a revisão de segurança pegou antes da primeira execução

O desenho acima estava certo e mesmo assim a implementação tinha **três desfechos ruins**, todos terminando em workflow **verde**. Vale registrar, porque a lição não é sobre SSH — é sobre o que "verde" prova.

**1. Remover pelo comentário da chave apagava a chave nova junto.** Comentário é apelido: texto livre, casado por substring. A guarda comparava igualdade exata, o que não impede prefixo. E o pior é que a **própria documentação induzia o erro** — quando o workflow recusava por comentário repetido, ela mandava "refaça com um `-C` diferente", e a reação natural é sufixar. `claude-deploy-homolog` + `claude-deploy-homolog-2` → as duas linhas somem; sobra a chave pessoal do dono, então o arquivo não fica vazio, a guarda `[ -s ]` passa e o `mv` executa. O rollback anunciado mora **dentro do servidor, alcançável só pelo SSH que acabou de sumir**. Reproduzido com chaves de verdade antes de corrigir: casar por comentário deixou **1** chave de 3; casar pelo corpo deixou **2**, as certas.

A correção foi trocar a identidade usada: casa-se pelo **corpo** da chave (o base64), derivado da própria privada antiga dentro do workflow. Corpo de chave não se repete, não é apelido e ninguém digita.

**2. O campo de texto livre era execução de comando no servidor de produção.** Ele era interpolado dentro de um `ssh "... grep -vF '$COMENTARIO' ..."`; uma aspa simples fechava a moldura e o resto virava comando, rodando como o usuário de deploy, ao lado do arquivo de variáveis com chave OpenAI, senha de SMTP e credencial do MySQL. Repositório privado limita quem dispara — mas o `environment: producao` tem aprovação humana, e o revisor aprova **um campo de texto**, não um diff. A injeção passaria exatamente pelo portão que existe para barrá-la. **O campo deixou de existir**; a única entrada é a palavra de confirmação.

**3. A prova negativa falhava aberto.** `if ssh antiga; then falhou; fi` lê _qualquer_ erro como "revogada" — inclusive timeout. E este projeto **sabe** que a TineHost corta o IP do runner (quinta cicatriz da ADR-113); essa era a sétima conexão da execução, e o `2>/dev/null` jogava fora justamente a mensagem que distinguiria recusa de queda. Desfecho: comentário errado → nada removido → hospedagem corta o IP → o workflow imprime "REVOGADA", fecha verde, o dono apaga o segredo antigo, e **a chave vazada continua valendo com a dívida marcada como paga**. Agora exige-se `Permission denied` no texto do erro; qualquer outra falha é **INCONCLUSIVO** e reprova.

**4. Nada testava o estado final.** A chave nova era exercitada só _antes_ da reescrita do arquivo. Um passo 7 a testa depois — é o que transforma um lockout silencioso em falha ruidosa com o backup ainda alcançável.

Sumiu também o segredo `DEPLOY_PUBKEY_NOVA`: a pública é derivada da privada (`ssh-keygen -y`), o que elimina de uma vez um segredo a administrar, a classe de erro "mandei a privada no lugar da pública", e um comentário de chave com `$(…)` sendo expandido pelo runner.

### O que isto ensina, e é o mesmo da ADR-113

**Verde só prova que nenhum comando deu erro.** Os três desfechos acima produziam verde — dois deixando o dono sem servidor, o terceiro declarando paga uma dívida intacta. O que separa "rodou" de "funcionou" é uma verificação escrita ao contrário: o passo 7 falha **se conseguir entrar**. Ferramenta de segurança sem pelo menos uma asserção negativa vira teatro exatamente no dia em que for necessária.

E, específico desta: **ferramenta de segurança sem revisão adversarial não é ferramenta de segurança.** Esta foi escrita com cuidado, comentada, com backup e ordem defensiva — e ainda assim tinha um caminho para lockout que nascia da própria documentação que a acompanhava.

### A execução, com a evidência lida — não o "verde"

Rodada em **18/08/2026 às 16:06 (BRT)**, execução `32174706059`. O que o servidor respondeu, passo a passo:

- chave a revogar: `SHA256:PmxUPsJcWmU+9ng5Ec0BP/pRgcvxE6RxWoXGNcsBoYU` (`claude-deploy-homolog`, a de 17/08)
- chave instalada: `SHA256:9MO02c3F90xqhxjZWlhV+klqVfQu9DueV6TZsN51iE8` (`deploy-workspace-med-2026-08-18`)
- cópia de rollback: `~/.ssh/authorized_keys.bak-20260818-190605` · **4 chaves antes**
- depois de autorizar a nova: 5 · **linhas casando com a antiga: 1** (a aritmética que a versão revisada exige) · **restaram 4**
- prova positiva depois da reescrita: `a chave nova continua entrando depois da reescrita`
- prova negativa: **`Permission denied (publickey,gssapi-keyex,gssapi-with-mic,password)`**

As outras 3 chaves da conta ficaram intactas — era exatamente o que o casamento por corpo, e não por apelido, existia para garantir.

**Prova de ponta a ponta:** o segredo `DEPLOY_SSH_KEY` foi promovido para a chave nova e o **Deploy** rodou em seguida (execução `32174834781`): ensaio de boot com **16 portas ouvindo**, `restart.txt marcado em 2026-08-18 16:16:26`, `/health` → `{"status":"ok"}`, `/` e `/credenciamentos` → **200**. Conferido de fora depois, por `curl` daqui: `/health` ok e `/`, `/credenciamentos`, `/comecar` → 200.

**A dívida de 17/08 está fechada.** O que sobrou de trabalho é higiene, não risco: apagar as cópias `authorized_keys.bak-*` do servidor quando alguém for lá por outro motivo.

**Passo a passo do dono em `docs/DEPLOY.md` §0** — e agora com os comandos em **PowerShell**, que é o terminal que ele usa de fato. A primeira tentativa falhou com `The '<' operator is reserved for future use` porque a receita estava escrita em sintaxe de Linux: o `<` não existe no PowerShell. Documentação que assume o terminal errado é documentação que não funciona.

---

## ADR-115 — As 19 vulnerabilidades do aviso do GitHub, conferidas pacote a pacote (e uma divergência dev↔produção que ninguém tinha visto) ✅

**Data:** 18/08/2026 · **Estado:** auditado; nada a corrigir em produção. Duas dívidas de higiene registradas.

### Por que reauditar se o portão da CI estava verde

O aviso do GitHub caiu de **42 para 19** entre 12 e 18/08 sem que ninguém tivesse mexido nas dependências. A conclusão da ADR-107 — "são todas de ferramenta de desenvolvimento e não vão ao ar" — continuava sendo repetida, mas ela tinha sido tirada de um portão verde, não de uma conferência pacote a pacote. Número que muda sozinho é motivo para reconferir, não para reafirmar.

### O resultado: nenhuma das 19 alcança produção

| Severidade | Total | Produção | Desenvolvimento |
| ---------- | ----- | -------- | --------------- |
| Crítica    | 6     | **0**    | 6               |
| Alta       | 7     | **0**    | 7               |
| Moderada   | 3     | **0**    | 3               |
| Baixa      | 3     | **0**    | 3               |

`pnpm audit --prod` **sem corte de nível** (não só `--audit-level high`, que é o da CI) devolve `No known vulnerabilities found`. As 6 críticas são todas do `vitest`; as altas são `brace-expansion`, `js-yaml`, `vite` e `playwright` — nenhum deles resolvido por `pnpm why --prod`.

### A prova que vale mais que o `pnpm why`: o que o artefato carrega

`scripts/bundle-deploy.mjs` monta o pacote de produção com **`apps/api` + `packages/db` e nada mais** — do SPA vai só o build estático já compilado. O artefato publicado declara 21 dependências (`fastify`, `@trpc/server`, `prisma`, `openai`, `imapflow`, `nodemailer`, `sanitize-html`, `zod`…), e **nenhum pacote alertado está nessa lista**.

Isso também explica o ruído: o Dependabot lê o `pnpm-lock.yaml`, **não entende workspaces do pnpm**, e por isso marca `vite`/`vitest`/`esbuild` como `runtime`. Lendo os arquivos de manifesto certos, ele mesmo os classifica como desenvolvimento. O alarme de "6 críticas em produção" é um artefato da ferramenta, não do nosso código.

### O caso `brace-expansion`, que era o candidato de verdade

Quatro dos sete alertas altos são dele, e ele **está** na árvore de produção — o que faria qualquer um concluir que passou. Não passou, e a razão é a decisão da ADR-107: convivem **1.1.16, 2.1.2 e 5.0.9**, as faixas vulneráveis param em `<2.1.4`, e a que vai ao ar é a **5.0.9** (via `@fastify/static → glob → minimatch`). As duas vulneráveis vêm exclusivamente do `eslint` e do `typescript-eslint`. O override **escopado por major** (`brace-expansion@5`) fez exatamente o que existia para fazer — um override sem escopo teria arrastado as três.

### O achado novo: os overrides do pnpm não valem no servidor

O bundle sobe **sem lockfile** e é instalado lá com `npm install --omit=dev` (`deploy.yml`, passo 5). **O npm não lê `pnpm.overrides`.** Ou seja, os overrides da raiz que protegem dependências de produção (`fast-uri`, `find-my-way`, `socket.io-parser`, `postcss`) **não se aplicam ao que roda em produção**, e o `pnpm audit --prod` da CI audita uma árvore que não é exatamente a instalada no servidor.

**Hoje isto não abre buraco nenhum** — nenhum desses pacotes tem alerta aberto, e no caso do `brace-expansion` a proteção nem depende do override: o `minimatch@10.2.5` já declara a major 5 por conta própria, então o npm chegaria nela sozinho. O risco é **futuro e silencioso**: no dia em que um override escopado for a única coisa segurando uma versão segura numa dependência de produção, a CI ficará verde e o servidor instalará a vulnerável. É o mesmo formato de armadilha do `esbuild` da ADR-113 — o ambiente que monta e o ambiente que roda discordando sem avisar.

**Como se fecha, quando for a hora:** gerar um `package-lock.json` junto do bundle e trocar o passo 5 para `npm ci --omit=dev`. Não foi feito hoje de propósito: mexe no caminho de publicação que acabou de estabilizar depois de três tentativas em 17/08, e merece uma rodada própria com ensaio de boot olhado de perto.

### O que fica pendente, e é higiene, não risco

- **`vitest` 2.1.8 → 3.x** limpa as 6 críticas e leva junto `vite`/`esbuild` transitivos. É bump de **major** do executor de testes, com 352 testes de unidade e 87 e2e atrás — não é chore, é tarefa.
- **`eslint` / `typescript-eslint`** limpam os 4 alertas de `brace-expansion`.
- **Ruído que não nos alcança:** `playwright`, `js-yaml`, `@eslint/plugin-kit` e os `esbuild` de dev server.

### O que isto ensina

**O portão da CI responde "passa ou não passa", não "por quê".** Ele estava certo e continuou certo — mas quem lê "0 vulnerabilidades" não sabe se é porque não há, ou porque a pergunta foi mal feita. A diferença entre as duas só aparece abrindo pacote por pacote, e vale fazer isso quando o número se mexe sozinho.

---

## ADR-116 — O servidor instalava uma falha ALTA que a CI dizia estar fechada ✅

**Data:** 18/08/2026 · **Fecha:** a dívida latente que a ADR-115 deixou anotada · **Corrige:** uma conclusão da própria ADR-115

### O que se descobriu

A ADR-115 anotou, no fim, que o bundle subia **sem lockfile** e era instalado com `npm install --omit=dev`, e que **o npm não lê `pnpm.overrides`**. Ela classificou isso como risco _futuro e silencioso_: "hoje isto não abre buraco nenhum — nenhum desses pacotes tem alerta aberto".

**Essa parte estava errada, e a medição mostra o quanto.** Montando o `package.json` do artefato exatamente como o bundle o monta e mandando o npm resolver a árvore:

```
npm audit --omit=dev
5 high severity vulnerabilities
  deepmerge-ts  7.1.5, 7.1.6   ← GHSA-ggr8-5vv4-36mx (exaustão de pilha)
```

`deepmerge-ts` é o pacote da **ADR-112** — a primeira falha que o portão da CI pegou sozinho, fechada em 12/08 com o override escopado `"deepmerge-ts@7": "^8.0.0"`. Ele **está** na árvore de produção por dois caminhos independentes (`mailparser → html-to-text` e `prisma → @prisma/config`), e o override que o protegia **nunca chegou ao servidor**. A ADR-115 conferiu os quatro overrides que olhou (`fast-uri`, `find-my-way`, `socket.io-parser`, `postcss`) e não olhou este.

Ou seja: entre 12/08 e hoje, a CI dizia `pnpm audit --prod` = **0** e a produção rodava com a falha **ALTA** aberta. As duas afirmações eram sobre **árvores diferentes**, e ninguém tinha percebido que a distância entre elas já era real.

### O que mudou

1. **O artefato leva os overrides.** `scripts/lib/pacote-de-producao.mjs` (módulo novo, com teste) monta o `package.json` de produção e copia `pnpm.overrides` da raiz **verbatim** para `overrides` do npm. A sintaxe de chave escopada por major (`nome@faixa`) é entendida **igual** pelos dois — conferido na mão: com `"deepmerge-ts@7": "^8.0.0"` o npm resolve `8.0.1`. Copiar verbatim é decisão: nada de traduzir, nada de escolher quais valem. Override que existe na raiz existe no servidor, inclusive os que hoje não mudam nada.
2. **O artefato leva `package-lock.json`.** Gerado no build (`npm install --package-lock-only --omit=dev`), 261 pacotes travados. Sem rede, o bundle **falha** — de propósito: artefato sem lockfile é artefato cujo conteúdo ninguém conferiu.
3. **O servidor instala com `npm ci --omit=dev`**, não `npm install`. O `ci` não re-resolve nada e **recusa rodar** se o lock discordar do `package.json`. Preço conhecido e aceito: o `npm ci` apaga `node_modules` antes de instalar, então há ~1 minuto com a produção servindo enquanto a pasta é refeita. O processo em execução já tem seus módulos carregados; o snapshot (passo 3/7) e o ensaio de boot (passo 6/7) cobrem o resto.
4. **A CI monta o artefato de verdade e o audita.** `pnpm -w build` virou `pnpm build:deploy`, e entrou um portão novo rodando **dentro de `apps/api/dist`**: `npm audit --omit=dev --audit-level high`. O portão antigo (`pnpm audit --prod`) fica: ele responde pelo monorepo. O novo responde pelo servidor. Eram justamente os dois que discordavam.

### A prova

|                                              | antes              | depois    |
| -------------------------------------------- | ------------------ | --------- |
| `deepmerge-ts` que o servidor instala        | **7.1.5 / 7.1.6**  | **8.0.1** |
| `npm audit --omit=dev` na árvore do servidor | **5 falhas ALTAS** | **0**     |
| Pacotes com versão travada no artefato       | 0 (sem lockfile)   | **261**   |

### O que isto ensina

**Auditar o ambiente que monta não é auditar o ambiente que roda.** É a terceira vez esta semana que os dois discordam em silêncio — o `esbuild` que só existia no laptop (ADR-113), os overrides que só valiam no monorepo (aqui), e a chave de deploy que o runner já tinha (ADR-114). O padrão é sempre o mesmo: uma verificação verde feita no lugar errado.

E, de novo, a lição da ADR-114 na forma dela: **a ADR-115 concluiu "inofensivo" a partir de uma lista que ela mesma tinha montado, sem medir.** Bastava rodar o `npm` uma vez com o `package.json` do artefato. O verde só prova que nada deu erro; a medição é o que prova que a coisa é o que se diz.

### A revisão adversarial, e o que ela mudou

Antes de mesclar, a mudança passou por revisão adversarial — a mesma disciplina que a ADR-114 estabeleceu depois do workflow de rotação que terminava verde por três caminhos errados. Ela encontrou **três defeitos reais** que a implementação original tinha, e **um alarme falso**. Os dois merecem registro.

**Real, e o mais grave: o código de saída estava sendo mascarado.** Os comandos do passo 5/7 eram `ssh deploy "npm install ... 2>&1 | tail -3"`. O `| tail` roda no shell **remoto**, que não tem `pipefail` — o código que volta é o do `tail`, **sempre 0**. O `set -euo pipefail` do passo é do shell do runner e não alcança lá dentro. Com `npm install` isso já escondia falha; com `npm ci` fica **destrutivo**, porque ele apaga o `node_modules` antes de instalar: um `npm ci` que morresse deixaria o servidor sem `node_modules`, sem Prisma Client e sem migration, com o deploy **seguindo em frente** e só o ensaio de boot reclamando no fim. Provado: `sh -c 'false | tail -3'` sai **0**; `sh -c '{ false; } || { exit 1; }'` sai **1**. Todos os comandos remotos passaram a redirecionar para arquivo e a devolver `exit 1` de verdade — no `deploy.yml` **e** no `deploy.sh`.

**Real: não havia rollback para o `node_modules`.** O snapshot do passo 3/7 é `tar --exclude=node_modules` — restaurá-lo não devolve a pasta. Agora, antes do `npm ci`, a pasta é copiada por **hardlink** (`cp -al`, custo perto de zero em disco e em tempo) e restaurada se o `npm ci` falhar.

**Real: o pnpm aceita uma sintaxe de chave que o npm ignora em silêncio.** `"pai>filho": "^x"` é a forma que a documentação do pnpm recomenda para escopar um override a um caminho; no npm ela não casa com pacote nenhum e vira **no-op**. Seria a mesma armadilha desta ADR entrando pela porta dos fundos. O módulo passou a **falhar o build** ao encontrar `>` ou `<` numa chave, com teste que prova a recusa.

**Real, e já corrigido antes da revisão chegar:** o portão da CI audita um lockfile e o deploy publica **outro** — o passo 1/7 monta o artefato de novo, re-resolvendo contra o registro num outro momento. Por isso o conferidor e o audit rodam **também dentro do `deploy.yml`**, sobre o mesmo lock que vai ser enviado.

**Alarme falso, e vale dizer por quê:** a revisão afirmou que o override `deepmerge-ts@7` só alcançava a instância hoisted, e que `html-to-text/node_modules/deepmerge-ts` continuava em 7.1.6. **Não se reproduz.** O lockfile do artefato tem **uma única** entrada de `deepmerge-ts`, em **8.0.1**, sem cópia aninhada; `npm audit --omit=dev` sai 0; e o portão novo passou no runner limpo do GitHub, que é um terceiro medidor, independente do laptop. A reprodução da revisão provavelmente montou o `package.json` sem os overrides. **Revisão adversarial se confere como qualquer outra afirmação** — inclusive quando ela é a que está dizendo "não mescle".

### A prova de que o portão prova alguma coisa

`npm audit` responde `found 0 vulnerabilities` e sai **0** também quando a árvore está **vazia** — o verde-falso da lição da ADR-114, na forma exata. Por isso o audit foi para dentro do `scripts/conferir-artefato.mjs`, que lê o número da própria saída dele (`metadata.dependencies.prod`) e **reprova se forem menos de 150** dependências auditadas. Hoje são **227**. E o conferidor foi testado pelo lado que interessa: removendo os overrides do artefato à mão, ele sai **1** listando os sete que sumiram.

### A dívida que fica anotada

`sanitize-html@2.17.7` e `cookie@2.0.1` declaram `engines: node >=22`, e o servidor roda **Node 20**. Hoje é só aviso (o npm não recusa por engine sem `engine-strict=true`), e esses pacotes já estão instalados em produção. Cogitou-se mandar um arquivo de configuração do npm com `engine-strict=false` dentro do artefato, e a ideia foi **descartada**: o envio é `tar`, que sobrepõe por nome, e um arquivo nosso apagaria um homônimo com credencial que porventura exista no servidor — seria trocar um risco teórico por um concreto. Fica como higiene: ou subir o Node do servidor, ou fixar essas duas dependências.

---

## ADR-117 — A ADR-116 estava certa no diagnóstico e errada na sintaxe: o `npm ci` recusou o artefato ✅

**Data:** 18/08/2026 · **Corrige:** a tradução de overrides da ADR-116 e o rollback destrutivo do passo 5/7 · **Custo:** uma publicação falha e ~20h com a produção sem `node_modules` (18/08 17:56 → 19/08 11:08)

### O que aconteceu

A publicação disparada às **17:53** falhou no **passo 5/7**. A mensagem do servidor:

```
npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.
npm error Missing: deepmerge-ts@7.1.6 from lock file
```

Reproduzido no laptop com o **mesmo npm 10.8.2** do servidor: é determinístico, não foi azar do runner.

### Por que o artefato da ADR-116 não servia

A ADR-116 afirmou que "a sintaxe `nome@faixa` do pnpm é entendida igual pelo npm", apoiada em duas medições verdadeiras: com `"deepmerge-ts@7": "^8.0.0"` o `npm install` resolve **8.0.1** e o `npm audit --omit=dev` sai **0**. As duas passam. **Nenhuma das duas exercita o `npm ci`** — que é o único comando que roda no servidor.

No npm, `nome@faixa` é **seletor de pai** ("dentro de `deepmerge-ts@7`, troque tal dependência"), não "substitua `deepmerge-ts` 7 por 8". A resolução hoistava a 8.0.1 assim mesmo, mas as arestas gravadas no lock continuavam pedindo 7.x (`@prisma/config` fixa `7.1.5`; `html-to-text` pede `^7.1.5`). O `npm install` tolera; o `npm ci`, que confere lock contra `package.json` **antes** de instalar, recusa.

**A revisão adversarial da ADR-116 tinha apontado exatamente isto** — `html-to-text` continuando em 7.x — e foi descartada como "alarme falso" porque a conferência olhou o **lockfile** (onde a 8.0.1 aparece sozinha) em vez de **rodar o `npm ci`**. A lição não é "confie na revisão": é que a refutação também precisa do comando certo. Olhar o artefato não prova o que o servidor faz com ele.

### A correção

**1. A chave é traduzida, não copiada.** `scripts/lib/pacote-de-producao.mjs` converte `nome@faixa` → `nome` ao montar o artefato. Medido: com a chave traduzida o `npm ci` aceita (**260 pacotes**) e a árvore resolvida é **idêntica — 0 diferenças em 260 pacotes**. A tradução muda o que o lock *declara*, não o que é *instalado*. A tradução perde o escopo por major, então **duas faixas do mesmo pacote com valores diferentes passam a falhar o build** em vez de virar uma escolha silenciosa.

**2. O conferidor passou a ensaiar o `npm ci` a seco.** Ele provava três coisas verdadeiras — lock com árvore, overrides presentes, audit em 0 — e nenhuma tocava o comando do servidor. Agora roda `npm ci --omit=dev --dry-run` dentro de `apps/api/dist`: não escreve nada, custa ~1s, e é a asserção que faltava.

### O defeito que transformou uma falha limpa em incidente

O passo 5/7 preservava o `node_modules` por hardlink **em `/tmp`** — que na TineHost é **outro dispositivo**. O `cp -al` respondeu `Invalid cross-device link` e o deploy imprimiu *"sem node_modules previo - nada a preservar"*, **que era falso**: a pasta existia. Em seguida, o socorro do `npm ci` fazia `rm -rf node_modules` **antes** de conferir se havia cópia, e o `|| true` engolia a restauração que não aconteceu.

Resultado: a produção ficou **sem `node_modules`**. O site continuou respondendo porque o processo Node já estava carregado em memória — teria morrido no primeiro restart. Duas correções, no `deploy.yml` **e** no `deploy.sh`:

- a cópia vai para `~/nm-antes`, no mesmo sistema de arquivos do app (onde os snapshots já moram), com queda para cópia real (`cp -a`) se o hardlink falhar;
- **sem cópia conferida, não se apaga nada** — o socorro deixa o `node_modules` velho no lugar e diz isso em voz alta.

### O padrão que se repete nesta série

ADR-114: verde que não provava nada. ADR-116: audit numa árvore que não era a de produção. ADR-117: portão que checava tudo, menos o comando que roda lá. **Toda vez, a ferramenta media algo verdadeiro e adjacente.** A pergunta que fecha o buraco é sempre a mesma: *o que exatamente o servidor executa, e eu executei isso?*

### Desfecho

Publicado em **19/08/2026 às 11:08**, 7 de 7 passos verdes. O passo 5/7 abriu com `cp: cannot stat 'node_modules': No such file or directory` — **a confirmação, pelo próprio servidor, de que a pasta estava mesmo faltando desde a véspera**. Depois: `npm ci` com `found 0 vulnerabilities` dito pelo npm **do servidor** (não pela CI), `No pending migrations to apply`, ensaio de boot com **16 portas ouvindo**, `/health` = `{"status":"ok"}`, `/` e `/credenciamentos` = 200, `/comecar` sem a faixa "AMBIENTE LOCAL". **O objetivo da ADR-116 — fechar a falha ALTA na árvore que roda em produção — só se completou aqui.**

---

## ADR-118 — Dinheiro em `Decimal`: o `Float` perdia centavo, e o conserto quase colocou "R$ NaN" na tela ✅

**Data:** 19/08/2026 · **Status:** implementado, na `main` · **Escopo:** `Servico.valor`/`percentual`, `ClienteServico.valor`/`percentual`, `Lead.valorEstimado`

### O problema

Cinco campos de dinheiro eram `Float` — apontado como dívida na auditoria de 05/08 e adiado de propósito (ADR-100..102). `Float` é ponto flutuante **binário**: R$ 0,10 não existe exatamente ali. Somar três serviços podia dar `1621.0000000000002`, e esse número ia para **o texto do contrato** e para **a conta a receber**. `Conta.valor` e `Credenciamento.valor` já eram `Decimal`; estes cinco tinham ficado para trás.

Migration `20260819153758_dinheiro_em_decimal`: os cinco viram `DECIMAL(12, 2)`, o mesmo tipo do resto do dinheiro do sistema. Teto de R$ 99.999.999.999,99 — folga de sobra, e ainda dentro do inteiro seguro do JavaScript depois de convertido.

### O que quase deu errado — e é a parte que importa

Trocar o tipo no banco **não é** o trabalho; é o começo dele. O Prisma passa a devolver um objeto `Decimal.js` no lugar de um número, e um `Decimal` que atravessa o tRPC até o navegador vira **objeto no JSON**: a tela mostra "R$ NaN", sem um único erro no console. Isso é pior do que o defeito que estávamos consertando — o `Float` errava no centavo, o `Decimal` vazado apaga o valor inteiro.

O `tsc` pegou **10** desses caminhos. Não pegou outros dois, porque o valor saía por retorno sem tipo declarado:

- `ativarServicoCliente` — o `return cs` cru do `upsert`, exposto como mutation `clientes.ativarServico`. Contratar um serviço com preço devolveria o `Decimal` para a tela.
- `cancelarServicoCliente` — mesmo `return` cru, e este tem **dois** consumidores: a equipe e o **Portal do cliente**.

Os dois foram achados por uma varredura de revisor **depois** do typecheck verde. A lição é a mesma da série ADR-114/116/117: *o portão verde mediu algo verdadeiro e adjacente*. Typecheck verde prova que os tipos casam, não que o `Decimal` ficou no servidor.

### A regra que fica

**`Decimal` nunca atravessa o tRPC.** A conversão acontece na função de serviço, com `emReais()` / `emReaisOu()` (`apps/api/src/lib/dinheiro.ts`) — o mesmo padrão que `mapConta` já usava no Financeiro. Todo caminho que devolve um `Servico` passa por `mapServico`; quem devolve `ClienteServico` ou `Lead` converte no retorno.

### Como foi provado

Não pela tipagem, que já foi enganada uma vez. `dinheiro-decimal.integration.test.ts` roda contra MySQL de verdade e checa com **`typeof` em runtime** que cada função de serviço devolve `number`, e que R$ 1.234,56 volta ao centavo depois de ida e volta pelo banco (7 testes, verdes). Na tela, com o app local: catálogo em `/servicos` (R$ 3.500,00/mês, 5% do faturamento), funil em `/leads` (somas por coluna), Início, Financeiro e a ficha do cliente — e o caminho que vazava, exercido de verdade: **contratar "Gestão Operacional" pela ficha mostrou "R$ 3.500,00/mês"**, cancelar voltou ao estado anterior, zero erro de console.

### Armadilha da migration em produção

`ALTER TABLE ... MODIFY ... DECIMAL(12,2)` **arredonda** o que estiver gravado com mais de duas casas — que é exatamente o lixo que o `Float` produzia, então o arredondamento é o conserto, não um efeito colateral. Mas é **irreversível pelo dado**: valor acima do teto faria a migration falhar. Conferido antes de publicar; em produção o comando é `migrate deploy`, que não roda seed.

---

## ADR-119 — Todo cliente é pessoa jurídica: o cadastro perde a escolha PF/PJ e ganha CNPJ validado

**Data:** 19/08/2026 · **Status:** aceito, em `main` · **Decisão do dono**, dita com todas as letras: *"todos os clientes da MedConsultoria são PJ (CNPJ)… os clientes são MÉDICOS e CLÍNICAS, e todos são PJ"*.

### O problema

O cadastro perguntava "pessoa física ou jurídica?" em três lugares — formulário do cliente, Portal (o próprio cliente podia se marcar como PF) e, sem perguntar a ninguém, na **conversão do lead**. A pergunta nunca teve resposta senão "jurídica": a Med atende médico e clínica, e ambos são PJ.

Pergunta que não tem duas respostas possíveis não é campo: é ruído que produz dado errado.

### O caminho por onde o PF entrava não era a tela

Este é o ponto que interessa, e não teria aparecido lendo só o formulário. `garantirClienteDoLead` fazia:

```ts
nome: temEmpresa ? lead.empresa!.trim() : lead.nome.trim(),
tipo: temEmpresa ? "PJ" : "PF",   // ← ninguém escolheu isto
```

Lead sem o campo "Empresa" preenchido — o caso comum de quem anota o nome do médico e o telefone — virava um cliente **pessoa física**. E aí a triagem do credenciamento (regra R1, ADR-103) reprovava esse cliente por ser PF: um INAPTO fabricado pelo próprio sistema, três telas depois. Fechar só o formulário deixaria o portão dos fundos aberto.

**Consequência de produto:** o contato principal passou a ser criado **sempre**, e não só quando havia empresa. A conta é uma empresa, e empresa não atende telefone — sem isso, o lead sem razão social perdia o nome de quem se fala assim que virava cliente.

### O que mudou no banco (migração `20260819161500_cliente_sempre_pj`)

1. `Cliente.documento` → **`Cliente.cnpj`**, por `RENAME COLUMN`. O Prisma queria gerar `DROP` + `ADD` e avisou: *"about to drop the column `documento`, which still contains 2 non-null values"*. A migração foi escrita à mão por isso.
2. `Cliente.tipo` e o enum `ClienteTipo` **deixam de existir**. Depois disto **o banco recusa gravar PF** — a regra parou de depender de alguém lembrar dela na tela. Há um teste que prova a recusa (`UPDATE ... SET tipo='PF'` → `Unknown column 'tipo'`).
3. `Lead.cnpj` **novo**, opcional: o CNPJ entra no primeiro contato e viaja para a ficha na conversão, sem ninguém redigitar.
4. Cliente que era PF e guardava **CPF** no campo `documento` tem esse número movido para as **observações da ficha** (`[ADR-119] CPF do cadastro antigo…`) e o campo zerado. Nada é apagado; o que não pode é um CPF seguir num campo agora chamado CNPJ — sairia impresso em contrato como "inscrita sob o CNPJ 529.982.247-25".

⚠️ **Irreversível pelo dado:** a marcação de quem era pessoa física some.

**Cada passo é condicional, e isso não é preciosismo.** O MySQL faz *commit* implícito a cada DDL — não existe transação cobrindo o arquivo inteiro. Se o `DROP COLUMN` falhasse (lock, conexão caída) depois de o `RENAME` já ter commitado, o Prisma marcaria a migração como falha, e **rodá-la de novo quebraria no passo 1**, que procura a coluna `documento` que o passo 2 acabou de renomear — restaria cirurgia manual no banco de produção. Com guardas de `information_schema`, cada passo já aplicado vira `SELECT 1` e **o arquivo inteiro é repetível**: retomar de uma falha é reexecutar. Provado rodando a migração num banco **já migrado**, sem erro e sem alterar dado.

O passo 1 também não olha o tamanho do documento: documento de cadastro pessoa física não é o CNPJ da clínica, tenha 11 ou 14 caracteres.

### CNPJ passou a ser validado — e aceita o formato alfanumérico

Até aqui só havia **máscara**: `11.111.111/1111-11` era aceito sem reclamação, e um número errado só apareceria meses depois, num contrato ou numa nota. Agora `validarCNPJ` (em `packages/shared/src/cnpj.ts`) confere o dígito verificador, na tela **e** no servidor — entrada de fora é hostil.

O validador aceita o **CNPJ alfanumérico** (Receita Federal, IN 2.229/2024, em vigor desde julho/2026): os 12 primeiros caracteres podem ser letra ou número, só os 2 verificadores são numéricos, e o cálculo é o mesmo módulo 11 sobre o código ASCII menos 48 de cada caractere. Um validador só-numérico recusaria a clínica aberta depois de julho — exatamente o cliente novo que a Med quer cadastrar. A máscara da tela também passou a aceitar letra.

O campo é **opcional**: no primeiro contato nem sempre se tem o número em mãos, e exigir CNPJ para salvar um lead trava a captação.

### O que foi aposentado

- **Regra R1 da triagem** ("cliente pessoa física é INAPTO"): nunca mais dispararia. A numeração R2…R6 **não foi corrida** — a ADR-103 e o material da Thaís citam as regras por esse nome, e renumerar faria a documentação antiga apontar para a regra errada. O teste da R1 virou a lápide dela: garante que nada volte a reprovar por tipo de pessoa.
- **Filtro de escopo EMPRESA** no credenciamento: os documentos de empresa valem sempre, porque todo cliente é empresa.
- `maskCPF` e `maskCpfCnpj` na tela — sem uso, saíram.

O campo inteligente `{{cliente.documento}}` **continua funcionando** como apelido de `{{cliente.cnpj}}`: modelos de documento salvos no banco antes desta ADR usam o nome antigo, e renomear em silêncio deixaria o campo vazio no papel. O valor agora sai **formatado** (`11.222.333/0001-81`), que é como vai impresso.

### Como foi provado

- **Typecheck do monorepo em zero** — e, como na ADR-118, isso não prova nada sozinho: `createLead`, `updateLead` e o painel do lead montam os campos um a um e **descartavam o `cnpj` em silêncio**, sem um erro sequer. Achado relendo o código depois do verde.
- **Três achados dos revisores especialistas depois do verde**, todos reais: a migração não repetível (acima); "Nova oportunidade" pela ficha e o pedido de serviços pelo Portal criando lead **sem** o CNPJ que a ficha já tinha (mais um descarte silencioso); e o aviso de CNPJ inválido do Portal saindo num parágrafo solto no fim do modal, longe do campo — hoje fica junto do campo, com `aria-invalid`/`aria-describedby`, e o Salvar trava enquanto o número não fecha.
- `conversao-lead-pj.integration.test.ts` (5 casos) contra MySQL de verdade: conta com razão social, conta **sem** razão social (nasce PJ mesmo assim), contato principal criado nos dois casos, CNPJ viajando do lead para a ficha, e o banco recusando `tipo='PF'`.
- `cnpj-validacao.test.ts` (9 casos), incluindo o exemplo alfanumérico oficial `12.ABC.345/01DE-35`.
- **Na tela, com o app local:** o formulário do cliente sem seletor de tipo; `11.111.111/1111-11` recusado com "CNPJ inválido — confira os números"; `12ABC34501DE35` aceito, mascarado como `12.ABC.345/01DE-35` e gravado; a ficha mostrando "CNPJ" sem selo de tipo de pessoa; e o percurso completo lead **sem empresa** → converter → cliente PJ com o CNPJ na ficha e a pessoa como contato principal. Zero erro de console.
- Suítes: 444 testes do servidor e 129 da tela, verdes. Build de produção verde.
## ADR-120 — A CI foi cancelada por baixar o navegador de teste duas vezes do zero ✅

**Data:** 19/08/2026 · **Corrige:** `.github/workflows/ci.yml` · *(nasceu numerada como ADR-118 numa sessão anterior; renumerada ao entrar na `main`, onde 118 e 119 já existiam)* · **Custo:** uma execução de CI cancelada, sem impacto em produção

### O que aconteceu

A CI do commit `0326d1a` (só documentação) ficou `cancelled`. Os jobs `build-test` (3min28) e `e2e` (9min21) passaram; o `integration` foi cortado em **25min17** pelo `timeout-minutes: 25`, parado no passo `pnpm exec playwright install --with-deps chromium`.

Não houve defeito no código. A prova está na mesma execução: o job `e2e` roda **exatamente o mesmo comando** e completou o job inteiro em 9 minutos. Mesmo commit, mesma hora, o download demorou >16 minutos num runner e ~1 minuto no outro. Re-executando só o `integration`, ele terminou em **3min11** — verde.

### A decisão

Os dois jobs baixavam o Chromium do zero em toda execução, sem cache. Um download de terceiro no caminho crítico de um portão de qualidade é uma dependência de rede que ninguém controla: quando ele fica lento, a CI reprova código que está correto — e "CI vermelha por motivo nenhum" é exatamente como um portão de qualidade acaba sendo ignorado (a mesma preocupação que fixou o corte em `high` na ADR-107).

`actions/cache@v4` guarda `~/.cache/ms-playwright`, com chave pela versão do `pnpm-lock.yaml`. O passo `playwright install --with-deps` **continua rodando**: ele detecta o navegador já presente e pula o download, mas segue instalando as bibliotecas de sistema, que não moram nessa pasta e não são cacheáveis.

### O que NÃO foi feito, de propósito

Não aumentamos o `timeout-minutes`. O timeout fez o trabalho dele — cortar um job travado. Aumentá-lo trataria o sintoma e deixaria a próxima ocorrência custar 40 minutos em vez de 25.

---

## ADR-121 — A CI escalonada: este repositório sozinho consumiu 116% da cota de Actions da conta

**Data:** 21/08/2026 · **Situação:** aceita

### O problema, com número

Medido pela API do GitHub em 20/08 e conferido de novo em 21/08/2026, tarefa a tarefa,
em 30 dias — **só neste repositório: 2.313 minutos cobrados**, contra uma cota mensal de
**3.000 minutos para a conta inteira** (15 repositórios). Foi o que fez o dono estourar o
plano gratuito e passar a pagar.

| Tarefa (`job`) | Vezes | Minutos cobrados |
|---|---:|---:|
| `e2e` | 176 | **1.160** |
| `integration` | 176 | 590 |
| `build-test` | 176 | 500 |
| `deploy` | 8 | 62 |

`e2e` + `integration` sozinhos = **58% de tudo o que a conta gastou no mês**, somando
todos os repositórios.

**A cobrança é por job, arredondada para cima a cada minuto.** Os três jobs da CI rodam em
paralelo: uma execução de "6,3 minutos no relógio" custa ~13 minutos de cota. Tempo de
parede engana; o que se paga é a soma dos jobs.

### Duas hipóteses que a medição MATOU

Registradas aqui para ninguém gastar tempo com elas de novo:

- **Não havia duplicata `push`/`pull_request`.** Dos 174 commits distintos do mês,
  exatamente **1** rodou CI mais de uma vez. O gatilho estava correto nesse aspecto.
- **Não faltava cache de dependência.** `pnpm install --frozen-lockfile` leva **3 segundos**
  aqui. (O cache que faltava era outro, o do navegador de teste — ADR-120.)

O que sobrou foi o momento em que o teste caro roda.

### A decisão

O erro nunca foi o teste caro existir. Foi ele rodar cedo demais: houve **90 envios diretos
à `main`** no mês, e cada um arrastou `e2e` + `integration` junto, num momento em que não há
decisão nenhuma a tomar. O modelo passa a ser **escalonado**:

| Momento | O que roda |
|---|---|
| `push` na `main` | só `build-test` (~3 min): lint, typecheck, Vitest, auditoria, artefato |
| `pull_request` | tudo — é onde se decide mesclar |
| antes de publicar | tudo, no commit **exato** que vai ao ar (o `deploy.yml` chama a CI) |

Quatro mudanças no `ci.yml`:

1. **`if: github.event_name != 'push'`** nos jobs `e2e` e `integration`. Vale ~990 min/mês.
2. **`needs: build-test`** nos mesmos dois. Sem isso o job caro começa junto com o barato e
   paga o minuto inteiro mesmo quando o `typecheck` já reprovou no primeiro minuto.
3. **`concurrency` com `cancel-in-progress: true`.** 18 execuções do mês foram substituídas
   por um commit seguinte antes de terminar, e a conta veio inteira. Vale ~340 min/mês.
4. **`paths-ignore: ['**.md', 'docs/**']` só no `push`.** Em `pull_request` é armadilha: com
   check obrigatório, um PR só de documentação trava esperando um check que nunca roda.

Entrou também `permissions: contents: read` no topo — ler o código basta, e sem a declaração
o runner herda um token com permissão de escrita.

### O elo sem o qual isto seria um buraco de cobertura

Com o item 1, um commit que chega à `main` por push direto passa a ter só o teste barato. Se
a publicação também não rodasse o caro, o corte teria trocado dinheiro por qualidade — o pior
negócio possível.

Por isso o `ci.yml` ganhou `workflow_call` e o `deploy.yml` ganhou um job `suite` que o
invoca, com `needs: suite` no job que toca o servidor. A suíte completa roda **no commit que
vai a produção**, e o passo de publicação só começa se ela terminar verde.

### O que NÃO foi mexido, de propósito

O `concurrency` do `deploy.yml` continua com **`cancel-in-progress: false`**. É o oposto do
da CI e está certo assim: execução de CI substituída não custa nada; publicação cancelada no
meio deixa o servidor em estado indefinido (ADR-107, a armadilha dos dois `deploy.sh`
simultâneos). Não copie o bloco de um para o outro.

O gatilho do `deploy.yml` segue `workflow_dispatch` **e só ele**, com confirmação digitada.

### Ressalva honesta

Este repositório **não tem branch protection** (conferido em 21/08/2026). Se alguém ligar
check obrigatório depois, o item 3 precisa de revisão: uma execução cancelada pelo
`cancel-in-progress` pode deixar o botão de mesclar travado esperando um check que não volta.

### Como conferir se funcionou

Medir de novo em ~7 dias e comparar com os 2.313 min:

```bash
python "$HOME/.claude/scripts/orcamento-actions.py" --detalhe 4
```

**Não confie no `billable.total_ms`** do endpoint `/runs/{id}/timing`: nesta conta ele
devolve zero (um run de 39 s reportou 0). O script soma `started_at`/`completed_at` por job,
arredondando para cima — que é como o GitHub cobra de verdade.

### Quem faz cumprir

O hook `~/.claude/hooks/actions-budget-guard.py` (desde 21/08/2026) lê todo arquivo de
`.github/workflows/` **como vai ficar** e bloqueia a gravação se um job de e2e/integração
disparar em `push` sem o `if:`, ou se um workflow de publicação tiver gatilho `push`. Ele
existe porque estas regras já estavam escritas desde 20/08 e foram violadas por três
repositórios depois disso — inclusive este, que recebeu o mesmo recado duas vezes sem que
nada fosse aplicado. Ao escrever esta ADR, o hook **bloqueou de fato** uma primeira tentativa
que mexia no cabeçalho e ainda não tinha posto o `if:` nos dois jobs.

### Um detalhe que a revisão de segurança pegou

O grupo de `concurrency` **não** usa `${{ github.workflow }}`. Sob `workflow_call`, o contexto
`github` inteiro é o do **chamador** — `event_name`, `sha`, `ref` e `workflow` inclusive; é
justamente por isso que o GitHub criou os campos separados `workflow_ref`/`workflow_sha` para
identificar o workflow chamado. Com `github.workflow` o grupo daria `Deploy-main`, distinto de
`CI-main`, e funcionaria hoje. Mas bastaria alguém renomear o `deploy.yml` para "CI" um dia e um
push na `main` passaria a **cancelar a suíte que valida uma publicação em andamento**. O grupo usa
`github.event_name`, que não depende de nome de arquivo nenhum.

Essa mesma regra é o que faz o corte funcionar: dentro do `ci.yml` chamado pelo `deploy.yml`,
`github.event_name` vale **`workflow_dispatch`**, não `push` — então `e2e` e `integration`
**rodam** no caminho da publicação. Era a hipótese mais grave possível aqui (publicar sem teste
caro) e foi **derrubada na revisão**, não presumida.

A revisão registrou também um custo aceito de propósito: a publicação paga `build-test` duas
vezes (~3-4 min extras), porque o job `deploy` reconstrói e reaudita o artefato em vez de
reaproveitar o da suíte. É o que garante que o binário efetivamente enviado foi auditado.

### A ressalva do branch protection saiu do "e se" — e a decisão do `paths-ignore` se provou

Escrito em 21/08/2026 este ADR registrou, como ressalva, que o repositório **não** tinha branch
protection e que ligá-la exigiria revisar o `concurrency`. Horas depois, ao tentar enviar um
commit de documentação direto para a `main`, o GitHub recusou:

```
GH013: Repository rule violations found for refs/heads/main.
- Changes must be made through a pull request.
- 3 of 3 required status checks are expected.
```

A organização `garcia-goncalves` **já vem com regra de repositório** — coisa que a conta pessoal
`thi-garcia` não tinha. O que isso muda, na prática:

- **Push direto na `main` deixou de existir.** Todo trabalho passa por PR, inclusive documentação.
  Os 90 envios diretos que motivaram o item 1 deste ADR não podem mais acontecer — o corte de
  custo continua valendo, mas agora com o reforço do próprio GitHub.
- **A decisão de NÃO pôr `paths-ignore` em `pull_request` se provou correta, e por pouco.** Com
  três checks obrigatórios, um PR só de `.md` que não disparasse a CI ficaria travado para sempre,
  esperando um check que nunca viria. É exatamente a armadilha que o ADR descreveu em teoria e que
  o repositório passou a ter na prática no mesmo dia.
- **O `cancel-in-progress` segue correto.** Uma execução cancelada por commit novo no PR é
  substituída pela execução do commit seguinte, que produz os três checks pedidos. O que não pode
  acontecer é uma execução ser cancelada e **nada** tomar o lugar — e isso não ocorre, porque o
  grupo é por ramo e todo commit novo dispara a sua.

---

## ADR-122 — Nenhum e-mail jamais saiu de produção: o certificado do SMTP local não se chama "localhost" ✅

**Data:** 21/08/2026 · **Situação:** aceita

### Como apareceu

O dono criou um lead pela captação pública em produção e não recebeu o e-mail. O relato era
sobre **um** e-mail; o problema era **todos**.

### A evidência, antes de qualquer hipótese

O monitor `/emails-enviados` (ADR-21) existe exatamente para isto — ele guarda o **motivo** de
cada falha em `EmailEnviado.erro`. Em produção, em 21/08/2026:

- **Falhas nos últimos 7 dias: 25. Taxa de entrega: 0%.**
- Filtrando **"Enviados" + "Todo o período"**: *"Nenhum e-mail encontrado com esses filtros."*
  **Nunca, nem uma única vez, um e-mail transacional foi entregue por este servidor.**
- As 25 falhas traziam todas a mesma mensagem, literal:

```
Hostname/IP does not match certificate's altnames:
Host: localhost. is not in the cert's altnames: DNS:atena.hostsrv.org
```

O disparo funcionava: às 17:00 daquele dia saíram as quatro notificações internas "Novo lead
pelo site" **e** o "Acesso ao Portal do Cliente" para o e-mail de teste do dono. A regra de
negócio estava certa; o transporte é que nunca completou uma conexão.

### A causa raiz

`SMTP_HOST=localhost` na configuração do servidor — correto, porque na TineHost o servidor de
e-mail roda na **mesma máquina** da aplicação. Só que o certificado apresentado no STARTTLS é o
da máquina física, **`atena.hostsrv.org`**. O nodemailer confere se o nome do certificado bate
com o host pedido, não bate, e recusa antes mesmo de autenticar.

Não era senha, não era porta, não era firewall, não era o módulo desligado: era o **nome no
certificado**. E a mensagem dizia isso desde o primeiro dia, gravada no banco — bastava abrir a
tela que o próprio sistema tem para isso.

### A decisão

A conferência do nome do certificado é **dispensada apenas quando o host é loopback**
(`localhost`, `127.0.0.1`, `::1`, e as variações com ponto final e maiúsculas). Para qualquer
host remoto, a validação continua inteira.

O raciocínio de segurança: para interceptar uma conexão a `127.0.0.1` já é preciso estar
**dentro** da máquina — e quem está dentro da máquina lê a configuração direto, senha inclusive.
A validação de certificado não protege nada nesse trecho. Já baixar a guarda para host remoto
trocaria "e-mail que não sai" por "e-mail que pode sair para o servidor errado", que é pior
justamente por ser silencioso.

A decisão mora em `apps/api/src/lib/email-tls.ts`, separada do `email.ts` para poder ser
testada **sem abrir socket**: `ehHostLocal()` e `opcoesTls()`.

### As duas armadilhas do conserto

1. **O erro real veio como `localhost.` — com ponto final** (a forma absoluta de um nome DNS).
   Um `host === "localhost"` ingênuo não pegaria o caso que motivou o conserto. A normalização
   corta o ponto, apara espaços e baixa a caixa antes de comparar.
2. **A comparação é contra um conjunto fechado, nunca por `includes`.** `localhost.evil.com` e
   `smtp.localhost.com` são endereços de internet de verdade; um `includes("localhost")` os
   trataria como a própria máquina e abriria exatamente o buraco que este ADR recusa. Há teste
   com asserção **negativa** para os dois (lição da ADR-114: verde só prova que nada deu erro).

### O que NÃO foi mexido, de propósito

O transporte de `apps/api/src/modules/email/smtp.ts` — a **caixa pessoal** de cada pessoa
(ADR-95/96) — continua validando o certificado por inteiro. Lá o host é um servidor de e-mail
de verdade e a **senha do webmail da pessoa** atravessa a rede; a validação é justamente o que
protege aquela senha. A dispensa é do e-mail transacional, e só dele.

Também não se mexeu na configuração do servidor. Apontar `SMTP_HOST` para `atena.hostsrv.org`
seria a outra correção possível e igualmente válida — mas depende de editar arquivo no servidor
a cada vez que a hospedagem trocar a máquina de lugar, e o app passaria a depender de um nome
que não é dele. Tratar loopback resolve na origem e sobrevive à troca.

### Ressalva honesta — o que este ADR ainda NÃO prova

Este conserto derruba a **primeira** barreira, que é a única comprovada. Se a senha SMTP da
configuração de produção estiver errada ou expirada (é uma pendência conhecida do dono desde
05/08, "rotacionar a senha SMTP do servidor"), o e-mail voltará a falhar — com uma mensagem
**diferente**, de autenticação. Só a próxima publicação, seguida de um lead de teste e de uma
olhada no monitor, prova o caminho inteiro. Enquanto a taxa de entrega do monitor não sair de
0%, não se pode dizer que o e-mail funciona.

### O que a revisão de segurança acrescentou

A revisão não achou bloqueante, mas trouxe duas travas que entraram no mesmo PR:

1. **A dispensa vale só em porta privilegiada (<1024).** O que sustenta a segurança dela é que
   ninguém mais na máquina consegue se passar pelo servidor de e-mail — e em porta privilegiada
   quem garante isso é o sistema operacional, porque só root abre. Numa porta alta, em
   hospedagem **compartilhada** como esta, um vizinho de máquina poderia ocupar a porta primeiro,
   apresentar certificado autoassinado (que passaríamos a aceitar) e colher `SMTP_USER` e
   `SMTP_PASS` no AUTH. Fora da faixa privilegiada a validação volta inteira: o e-mail falha de
   forma visível em vez de vazar a senha em silêncio. Há aviso próprio no log para esse caso —
   sem ele, a mensagem no monitor seria idêntica à do defeito original e a caçada recomeçaria.
2. **`requireTLS: true` no transporte transacional.** Sem isso, na 587 o STARTTLS é oportunista:
   servidor que não o anuncia faz o nodemailer seguir em **texto claro, com o AUTH junto**. A
   caixa pessoal já se protegia assim desde a ADR-96; o transacional não. Seguro aplicar aqui
   porque o servidor de produção comprovadamente anuncia STARTTLS — a falha original acontecia
   **depois** dele, na conferência do certificado.

A revisão também testou 25 formas de enganar a detecção (`localhost.evil.com`, `127.0.0.1.evil.com`,
`localhost%00.evil.com`, homoglifos Unicode como `ⅼocalhost` e `ｌocalhost`, fullwidth, `localhost..`,
`localhost:25`). Nenhuma vira loopback. Os casos que a detecção **não** pega — `127.1`,
`2130706433`, `0x7f.0.0.1`, `::ffff:127.0.0.1` — são loopback tratado como **remoto**, ou seja,
falham fechado. A única direção que importa (remoto virar local) está fechada.

Uma alternativa considerada e recusada com motivo: `tls.checkServerIdentity` manteria a validação
da **cadeia** e afrouxaria só o nome — melhor no papel. Recusada porque certificado de hostname em
cPanel costuma ser autoassinado, e nesse caso a cadeia reprova e a entrega volta a 0% — trocaríamos
o conserto pelo próprio defeito. Em loopback a cadeia não defende de nada: o ataque que ela impede
é MITM de rede, que não existe num socket que não sai da máquina.

### A CI reprovou o primeiro `requireTLS`, e o conserto ficou melhor por isso

A primeira versão exigia STARTTLS **sempre**. O job `integration` reprovou com
`Nenhum e-mail para ... em 15000ms`: o **Mailpit** — o servidor de e-mail de mentira usado nos
testes — não oferece STARTTLS, e o envio morria calado. Exigir sempre teria trocado um defeito de
produção por um defeito em todo ambiente de teste.

O critério certo é o mesmo do resto desta ADR: **exigir TLS quando o host não é loopback**. O que
o `requireTLS` protege é a senha atravessando a rede — e em loopback não há rede. Assim o Mailpit
volta a receber, e o dia em que `SMTP_HOST` apontar para fora, o downgrade para texto claro está
fechado. Há teste guardando as duas pontas, inclusive a regressão do Mailpit.

Vale registrar o método: esse defeito **não** foi encontrado por leitura. Foi a CI que o mostrou,
porque a suíte cara roda em `pull_request` — exatamente o que a ADR-121 preservou ao escalonar.

### A CI reprovou o primeiro `requireTLS`, e o conserto ficou melhor por isso

A primeira versão exigia STARTTLS **sempre**. O job `integration` reprovou com
`Nenhum e-mail para ... em 15000ms`: o **Mailpit** — o servidor de e-mail de mentira usado nos
testes — não oferece STARTTLS, e o envio morria calado. Exigir sempre teria trocado um defeito de
produção por um defeito em todo ambiente de teste.

O critério certo é o mesmo do resto desta ADR: **exigir TLS quando o host não é loopback**. O que
o `requireTLS` protege é a senha atravessando a rede — e em loopback não há rede. Assim o Mailpit
volta a receber, e no dia em que `SMTP_HOST` apontar para fora, o downgrade para texto claro está
fechado. Há teste guardando as duas pontas, inclusive a regressão do Mailpit.

Vale registrar o método: esse defeito **não** foi encontrado por leitura. Foi a CI que o mostrou,
porque a suíte cara roda em `pull_request` — exatamente o que a ADR-121 preservou ao escalonar.

### ✅ PROVADO EM PRODUÇÃO, NA TELA — 22/08/2026

Publicado às 18:38–19:03 (execução `32591319305`, commit `f23a1f2`). A suíte completa rodou
antes de tocar no servidor — `build-test`, `e2e` e `integration` **os três verdes**, que é a
primeira vez que o elo da ADR-121 foi exercido de verdade. Depois, 7/7 no deploy:
`found 0 vulnerabilities`, `No pending migrations to apply`, `/health` = `{"status":"ok"}`,
`/` e `/credenciamentos` = 200.

A prova do e-mail não é o deploy verde — é a tela:

| | Antes (21/08) | Depois (22/08) |
|---|---|---|
| Enviados em 7 dias | **0** | **5** |
| Taxa de entrega | **0%** | **17%** e subindo |
| "Seu acesso ao Portal" → `tibamooca@gmail.com` | **falhou** (erro de certificado) | **enviado** |

O último item é o que fecha o caso: **o mesmo e-mail, para o mesmo destinatário externo, que
ontem morria no certificado, hoje sai.** A taxa ainda não é 100% porque as 25 falhas antigas
continuam na janela de 7 dias — elas são histórico, não sintoma.

**A senha SMTP estava certa.** A ressalva acima (de que a autenticação poderia ser a próxima
barreira) **não se concretizou**: a conexão passou do certificado direto para a entrega. A
pendência de rotacionar a senha continua valendo por higiene, mas não é bloqueio.

### Um comportamento que confundiu o diagnóstico e não é defeito

Ao repetir a captação com um e-mail **que já está no funil**, o sistema **não** dispara novo
e-mail ao lead: o `capturarLead` deduplica por e-mail, atualiza o lead existente e, como o acesso
ao Portal já fora criado antes, não há convite novo a mandar. Só as quatro notificações internas
("Novo lead pelo site") saem.

Consequência prática para quem for testar e-mail de novo: **não adianta reenviar o formulário com
o mesmo endereço.** Use o botão **"Enviar acesso"** no card do lead (que foi como esta prova foi
feita) ou um endereço ainda não cadastrado. ⚠️ "Enviar acesso" **move o lead para
"Qualificação"** — efeito de negócio, reversível arrastando o card de volta.

---

## ADR-123 — O e-mail parou por semanas e nada avisou: alerta por falhas SEGUIDAS, não por taxa

**Data:** 22/08/2026 · **Situação:** aceita

### Como apareceu

Achado da auditoria de 22/08. A ADR-122 consertou o transporte de e-mail, mas deixou a pergunta
mais incômoda em aberto: **por que ninguém soube durante semanas?** Foram 25 falhas seguidas e
taxa de entrega 0% desde sempre. Quem descobriu foi o dono, criando um lead pelo site e não
recebendo nada — não o motor de alertas, que roda a cada 30 s desde a ADR-84.

O monitor `/emails-enviados` mostrava tudo. Só que painel não avisa: painel espera ser aberto.

### A decisão

Entra uma regra nova no motor de alertas (`observability/alertas.ts`), chave `entrega_email`:
**falhas registradas depois do último envio bem-sucedido**. Dispara em 3, recupera em 0,
`critico` a partir de 10. Abre incidente com MTTR e notifica o ROOT, como as outras seis regras.

### Por que NÃO é "taxa de entrega"

Taxa exige volume. Esta app manda poucos e-mails por dia; uma regra do tipo *"menos de X%
entregue na última hora"* jamais teria disparado — **foi exatamente por falta de volume que o
defeito durou semanas**. A regra das outras métricas confirma o padrão: `taxa_erro` só avalia
com `reqUltimoMin >= 5`, porque sem tráfego mínimo a porcentagem mente.

Falha seguida não depende de volume: na **terceira** tentativa morta o alerta sobe, mande a app
3 e-mails por dia ou 300. E o contador ser *"desde o último sucesso"* dá a recuperação de graça —
**um único e-mail que sai zera a conta e resolve o incidente**, sem regra de recuperação separada.

### As duas armadilhas, e como cada uma foi fechada

**1) Em desenvolvimento, 100% dos e-mails falham por projeto.** Sem SMTP configurado,
`enviarEmail` devolve `enviado: false` com o motivo *"modo dev"* — e isso é gravado como
`FALHOU` na mesma tabela. Uma regra ingênua gritaria em toda máquina de desenvolvedor e em toda
rodada de e2e. Por isso a primeira linha do `ler()` é `if (!isEmailReal) return null`. Alarme
falso ensina a ignorar alarme, e este é o alarme que não pode ser ignorado.

**2) Endereço errado não é transporte quebrado.** Caixa cheia, domínio inexistente ou e-mail
digitado errado produzem falha real — de **uma** mensagem. Enquanto as falhas seguidas forem
todas para o **mesmo** destinatário, a regra devolve `null` (não avalia) até 10 tentativas;
a partir daí o benefício da dúvida acaba. Falha em destinatários **diferentes** é sintoma de
transporte desde a primeira.

### Como foi verificado

A decisão de contagem virou função pura (`observability/entrega-email.ts`) com **8 testes de
unidade**, entre eles o caso real da ADR-122 (25 falhas, vários destinatários, nenhum sucesso),
a recuperação com zero falhas, o mesmo destinatário insistente e maiúscula/espaço não inventando
um segundo endereço. A suíte da API foi de 391 para 399.

### O que esta ADR NÃO resolve

Se o **servidor inteiro** cair, este motor cai junto — ele roda dentro do processo que vigia.
O vigia externo continua sendo pendência do dono (item do plano da auditoria), e é outro problema.

---

## ADR-124 — A régua de cobertura media metade do que existe (e o plano de testes apontava para o lugar errado)

**Data:** 22/08/2026 · **Situação:** aceita

### Como apareceu

Item do plano da própria auditoria de 22/08: *"cobrir de unidade os módulos que mexem em
dinheiro"*, com `servicos` a 7,0% e `leads` a 2,5%. Antes de escrever teste, medi o que estava
descoberto — e o número não fechava com a quantidade de teste de integração que existe para
essas exatas funções (`conversao-lead-pj`, `credenciamento-cobranca`, `dinheiro-decimal`).

### A causa

`pnpm cobertura` roda `vitest --exclude "**/*.integration.test.ts"`. **A régua excluía
justamente os testes que exercitam o caminho do dinheiro.** O relatório não estava errado
sobre o que media; estava sendo lido como se medisse tudo.

### Os dois retratos, lado a lado

| | Régua velha (só unidade) | Régua corrigida (com integração) |
|---|---|---|
| API, total | 19,3% | **45,3%** |
| Módulos a 0,0% | 15 | **nenhum** |
| `servicos` | 7,0% | **58,8%** |
| `financeiro` | 4,2% | **59,1%** |
| `leads` | 2,5% | **20,3%** |

Ou seja: os dois módulos que o plano mandava salvar primeiro **já estavam perto de 60%**, e o
esforço iria para onde não era mais necessário. O ponto cego real é `leads.service.ts`, a 16,8%
— 1.545 linhas onde moram a conversão em cliente, a captação pública e a provisão financeira.

### A decisão

Entra `pnpm cobertura:tudo` (raiz e `@app/api`), sem o `--exclude`. A régua rápida continua
existindo com o nome de sempre, porque tem uso legítimo: roda em segundos e **não precisa de
banco**. A completa precisa do MySQL de teste no ar:

```
pnpm db:up
docker exec medconsultoria-mysql mysql -uroot -proot   -e "CREATE DATABASE IF NOT EXISTS medconsultoria_test CHARACTER SET utf8mb4;
      GRANT ALL PRIVILEGES ON medconsultoria_test.* TO medconsultoria@%; FLUSH PRIVILEGES;"
cd packages/db && DATABASE_URL="mysql://medconsultoria:medconsultoria@127.0.0.1:3307/medconsultoria_test" npx prisma migrate deploy
```

> ⚠️ `npx prisma`, não `pnpm --filter @app/db exec prisma` — este último falha no Windows mesmo
> com o binário presente (pendência conhecida do ambiente de desenvolvimento).

### O que isso corrige na auditoria

A aba **Sistema → Auditoria** foi publicada de manhã com os números da régua velha e corrigida
no mesmo dia: cobertura da API 19,3% → **45,3%**, a lacuna *"15 módulos sem um único teste"*
substituída por *"o funil é o ponto cego real"*, e o plano repontado para `leads.service.ts`.
A nota de Testes subiu de 86 para 89 — não porque algo foi feito, mas porque **passou a ser
medido direito**. A nota geral segue 89.

### A lição

Número de cobertura sem a definição do que ele mede é pior que não ter número: ele *parece*
evidência. Foi por isso que o plano de testes apontava para o lugar errado — e teria custado
dias de trabalho no módulo que menos precisava.

### O que continua valendo

Segue **sem piso de cobertura na CI**, pela mesma razão da ADR original: piso vira refém, e não
há o que defender enquanto o número não estabilizar. E ambas as réguas continuam cegas ao que
só o e2e exercita.

---

## ADR-125 — O serviço percentual pedia um valor fixo que não existe (e a condição de pagamento dependia da memória de quem digita) ✅

**Data:** 26/08/2026 · **Status:** implementado, provado na tela

### O sintoma

O dono abriu o painel de um lead cujo único serviço era **Faturamento de contas médicas** e
encontrou a Qualificação travada:

```
Próximos passos · Qualificação        1 obrigatório(s) restante(s)
Geral
  ☐ Entender a necessidade e os requisitos
  ☐ Registrar o valor estimado da oportunidade   obrigatório  automático
```

**Só que esse serviço não tem valor fixo.** A Med é remunerada por um **percentual** sobre o que
a clínica fatura — é o único serviço do catálogo assim (`valor: null`, `percentual: 5`,
`percentualRecorrencia: MENSAL`). O passo obrigatório pedia um número que não existe, e travava
a etapa até alguém inventar um. Quem inventa suja o relatório; quem não inventa não avança.

### O que estava por trás

O passo vinha de uma lista fixa no código (`PLAYBOOK.qualificacao`, em `leads.service.ts`),
igual para todo lead, **sem olhar quais serviços a pessoa escolheu**. E o funil não tinha como
avaliar um negócio percentual: `Lead.valorEstimado` era o único número, digitado à mão, então o
lead de Faturamento valia **R$ 0,00** no card, no total da coluna e no relatório — ao lado de um
lead de R$ 12.000. O negócio mais valioso do mês podia ser o que aparecia como zero.

### A decisão

**1. A regra lê o PREÇO, nunca o nome do serviço.** `planejarEstimativaDoLead`, função pura em
`@app/shared`, responde qual pergunta faz sentido:

| Serviços escolhidos | Modo | O que se pergunta |
|---|---|---|
| algum com valor fixo | `VALOR_FIXO` | "quanto você espera fechar?" (como sempre) |
| todos percentuais | `PERCENTUAL` | "quanto a clínica fatura por mês?" |
| nenhum, ou só credenciamento | `VALOR_FIXO` | como sempre |

Hoje isso só alcança o Faturamento — o dono confirmou que é o único serviço 100% percentual —
e continua correto se a Thaís criar outro amanhã. **Casar por nome é a fragilidade que já
existe** em `ehServicoDeCredenciamento`; repeti-la teria sido barato agora e caro depois.

**2. O credenciamento fica fora da conta**, exatamente como já fica fora do provisionamento da
conversão (ADR-104/108): o honorário dele nasce quando a operadora aprova. Para as duas regras
não divergirem, `NOME_SERVICO_CREDENCIAMENTO`/`ehServicoDeCredenciamento` **mudaram de casa** para
`@app/shared` (reexportados do módulo antigo). Duas cópias da mesma pergunta sobre o mesmo
dinheiro são o começo de duas respostas diferentes.

**3. A função é pura e vive no `shared` porque os DOIS lados precisam da mesma resposta:** o
servidor decide o passo obrigatório, a tela decide qual campo mostrar. Duas implementações
discordariam no primeiro caso de borda.

**4. O passo troca de pergunta, e tem volta.** A reconciliação (`reconciliarPassosAuto`) já
concluía e reabria passos automáticos; passou a reescrever também o **título** da linha com
`autoRegra: "valor"`. Marcar Gestão Operacional junto do Faturamento devolve
`"Registrar o valor estimado da oportunidade"` sozinho. Passo digitado pela equipe nunca é
tocado (não tem `autoRegra`).

**5. `valorEstimado` passa a ser DERIVADO no modo percentual:** `faturamentoMensalEstimado ×
percentualTotal`, gravado pelo servidor. Quem digita é a base, não o resultado. Gravar (em vez de
só calcular na tela) mantém card, totais e relatório lendo **um número só**.

**6. A condição de pagamento sai da memória e entra no cadastro.** A Thaís informou que a
condição do Faturamento é sempre a mesma frase: *"O recebimento do Repasse será sempre feito após
o crédito na conta da Clínica."* Ela era digitada à mão em toda proposta, num campo livre
(`NovoDocumentoDialog`, placeholder "Ex.: 30% + 2x"). Virou **`Servico.condicaoPagamento`**,
editável em Serviços → Configurar → Detalhes, no mesmo molde de `clausulasContrato`; a proposta
**pré-preenche** com a condição dos serviços escolhidos, sem repetir, e **para de mexer assim que
alguém digita** (proposta se negocia).

**Alternativas descartadas:** *sumir com o campo* (a proposta ficaria muda sobre quando o cliente
paga — exatamente o termo que evita discussão depois — e não sobrevive ao caso misturado, em que
as duas condições precisam sair no papel) e *escrever a frase no código* (mudar uma vírgula
exigiria uma publicação; a Thaís é quem escreve texto comercial).

### Consertos que vieram junto (lado Clientes)

- **A ficha ficava muda sobre o que o cliente paga.** A linha "Valor contratado" do *Resumo
  comercial* soma o `valorEstimado` dos leads ganhos; para quem só paga percentual isso dá zero e
  a linha **sumia da tela**. Não era conta errada, era ausência. Agora, quando não há valor fixo,
  mostra o preço real do que está contratado (`5% do faturamento/mês`), que a ficha já sabia.
- **O percentual podia ser apagado em silêncio.** No editor de preço da ficha
  (`ServicosContratadosCard`), o campo de % só aparecia para a categoria "Faturamento", e a
  gravação faz `percentual: ehFaturamento ? … : null` — abrir e salvar qualquer outro serviço
  **zerava** o percentual dele, sem aviso. Hoje quem decide é o preço, não a categoria. Não mordia
  ninguém ainda; morderia no dia em que a Thaís pusesse % em outro serviço, que é justamente o dia
  em que ninguém lembraria dessa linha.

### O banco

Migração `20260826150000_faturamento_percentual_e_condicao_pagamento`, escrita à mão. Duas colunas
**novas e nuláveis** — nada é apagado nem convertido, nenhuma linha existente muda de valor:

- `Lead.faturamentoMensalEstimado DECIMAL(12,2) NULL`
- `Servico.condicaoPagamento TEXT NULL`

### A prova

Typecheck verde **não prova nada aqui** — foi o que deixou passar o "R$ NaN" da ADR-118 e o
`cnpj` descartado em silêncio da ADR-119, os dois no mesmo `createLead`/`updateLead` que monta os
campos um a um. Então:

- **11 testes de unidade** da regra pura (`estimativa-lead.test.ts`), incluindo o caso misturado,
  o só-credenciamento, o percentual zerado e o arredondamento em centavos.
- **6 testes contra o MySQL de verdade** (`faturamento-percentual.integration.test.ts`): o campo
  sobrevive ao criar e ao editar, chega à tela como **número** (`typeof`, não tipagem), o passo
  troca de pergunta, o `valorEstimado` sai `10000.00` de 200.000 × 5%, e volta atrás quando entra
  um serviço fixo.
- **Na tela**, no localhost: marcar Faturamento troca o campo ao vivo para "Faturamento mensal do
  cliente"; digitar mostra *"Valor do negócio: R$ 100,00/mês (5% de R$ 2.000,00)"*; salvar leva o
  lead à Qualificação com o passo lendo **"Registrar o faturamento mensal estimado do cliente"**,
  já concluído; e card, painel e total da coluna mostram **R$ 100,00**.

### O que ficou de fora, de propósito

O total do funil **soma valor mensal com valor de cobrança única** — R$ 100,00/mês do Faturamento
entra no mesmo bolo de um serviço avulso. **Isso já era assim** (Gestão Operacional é R$ 3.500/mês
e sempre entrou igual); não foi criado aqui e arrumar exige decidir como o funil deve ser lido.
Registrado para não parecer resolvido.

---

## ADR-126 — Uma proposta por operadora, uma lista de convênios por cliente, e um cadastro só de operadora ✅

**Data:** 26/08/2026 · **Situação:** implementada, provada na tela, **ainda não publicada**

### O pedido, em uma frase

A proposta de Faturamento não podia ter valor, quantidade nem "avulso ou mensal" — e precisava
listar os convênios que a clínica atende e quanto ela fatura por mês. Junto veio outra coisa: cada
proposta de credenciamento é de **uma** operadora, nunca de várias.

### As cinco decisões, e o porquê de cada uma

**1. A operadora é UM cadastro, com marcação por serviço.**
A mesma Unimed que se credencia é a Unimed cujas contas se faturam. Duas listas separadas fariam a
Thaís cadastrar o mesmo nome duas vezes e — o que é pior — deixariam as duas divergirem com o
tempo: a do credenciamento atualizada, a do faturamento esquecida. O que muda de um serviço para o
outro é só *para qual deles* a operadora serve, e isso são duas marcações:
`Operadora.usoCredenciamento` e `Operadora.usoFaturamento`. Em Ajustes a tela mostra abas
separadas, mas o registro é o mesmo. **As operadoras existentes nascem marcadas nas duas** — senão
a primeira proposta de faturamento abriria vazia e pareceria defeito.

*Recusado:* operadora marcada para nenhum dos dois. Ela sumiria de todas as listas sem aviso, e
isso se lê como perda de dado. A tela recusa antes de o servidor recusar.

**2. Proposta de credenciamento = UMA operadora.**
O papel real da Thaís negocia com uma operadora de cada vez: cada uma tem o próprio prazo, a
própria documentação e o próprio desfecho. Uma proposta com três operadoras dentro **não pode ser
aceita pela metade** — e é exatamente isso que acontece na vida real quando uma aprova e outra
nega. Consequência avisada ao dono e aceita por ele: **credenciar em três operadoras = três
propostas = três números** na sequência dela (0225, 0226, 0227).

⚠️ **A grade médico × operadora NÃO mudou.** Quem virou "uma só" é o DOCUMENTO. O credenciamento
continua sendo por pessoa, cada cruzamento com preço próprio e acompanhamento até a aprovação
(ADR-104). Na tela, o construtor inverteu a ordem: escolhe-se a operadora, depois marcam-se os
médicos que entram naquela proposta.

**3. Proposta de faturamento: só o percentual, sempre mensal.**
Não existe valor fixo no Faturamento de contas médicas, não existe quantidade, e não existe
"avulso". A linha da proposta perde os três campos — e **quem decide isso é o PREÇO do serviço**
(`ehServicoSomentePercentual`, em `@app/shared`), nunca o nome da categoria. Esta é a terceira vez
que a mesma comparação `categoria === "Faturamento"` é removida (a ADR-125 tirou de três lugares e
deixou dois passarem). Casar por nome quebra em dois dias previsíveis: quando a categoria é
renomeada na tela de Serviços, e quando nasce um segundo serviço percentual. Há um teste que
reprova a volta da comparação, com os comentários removidos antes de conferir — guardar a regra e
proibir a explicação dela seria trocar uma armadilha por outra.

O modelo novo, **"Proposta de faturamento médico"**, é reconhecido pelo marcador `{{convenios}}`
no corpo — mesma lógica do credenciamento, que se reconhece por `{{operadoras}}`. E o papel mostra
a **conta feita**, não o percentual solto: *"Valor estimado do serviço: R$ 6.000,00/mês (5% de
R$ 120.000,00)"*. "5% do faturamento" não diz nada a quem vai assinar.

**4. O valor estimado continua no LEAD, e a proposta escreve de volta.**
O lead existe antes da proposta, e o passo obrigatório da Qualificação pergunta esse mesmo número
(ADR-125). Sem a escrita de volta, quem descobrisse o valor certo montando a proposta teria de ir
digitar de novo no funil — e, esquecendo, o card mostraria um valor velho ao lado de um documento
com o valor novo. **Um número só, andando para frente.** A proposta nasce preenchida com o que o
funil já sabe; corrigir ali corrige o lead e recalcula o valor do negócio, pela mesma
`reconciliarPassosAuto` que a edição do lead chama.

*É best-effort de propósito:* a proposta já foi emitida e existe. Derrubá-la porque o funil não
aceitou um número seria trocar um documento pronto por um erro. Só mexe em lead **ainda em
negociação** — lead fechado é histórico.

**5. Os convênios ficam com o CLIENTE, não com o documento.**
`ClienteServico ↔ Operadora` (N-N). A lista nasce da proposta aceita e continua editável na ficha,
em **Serviços → Editar preço → Preço e convênios**: a lista de convênios muda com o tempo e é dado
do cliente, não do papel que a originou. O cliente também a vê no Portal — é sobre ela que a
apuração do mês acontece.

⚠️ **Os convênios viajam DENTRO do item da proposta** (`conveniosIds` em
`documentoServicoItemSchema`), e não soltos no documento. É assim que eles atravessam o aceite:
pelo mesmo caminho que serviço e preço já percorrem até `sincronizarServicosContratados`. Uma
segunda costura ficaria para trás no primeiro caso de borda. E são **ids, não nomes** — nome
copiado não sobrevive a um "renomear" no catálogo.

*Recusado, e o dono decidiu isso explicitamente:* um campo de "automação" por operadora. Campo
criado por precaução nasce vazio e morre vazio.

### O banco

Migração `20260826193338_operadora_por_servico_e_convenios_do_cliente`, **puramente aditiva**.
Nada é apagado, nada é convertido, nenhuma linha existente muda de valor:

- `Operadora.usoCredenciamento BOOLEAN NOT NULL DEFAULT true`
- `Operadora.usoFaturamento BOOLEAN NOT NULL DEFAULT true`
- `_ClienteServicoOperadoras` — a tabela de ligação N-N, nasce vazia.

Reverter em produção = apagar as duas colunas e a tabela de ligação.

### A prova

Typecheck verde não prova nada aqui — relação N-N é o caso mais fácil de escrever e nunca gravar.
Então:

- **8 testes de unidade** da regra de preço (`preco-do-servico.test.ts`), incluindo o misturado, o
  zero, o negativo e o `undefined` — mais a conferência de que a tela não voltou a comparar
  categoria.
- **11 testes contra o MySQL de verdade** (`operadora-convenios.integration.test.ts`): a marcação
  nasce nas duas listas, o filtro recorta, desmarcar as duas é recusado sem gravar pela metade,
  duas operadoras são recusadas nos dois formatos, o papel traz a conta, os convênios chegam ao
  `ClienteServico`, a ficha os devolve como **nomes**, e operadora presa a um serviço contratado
  não é excluída em silêncio.
- **Na tela**, no localhost, com zero erro de console:
  - Ajustes → Operadoras: 5 operadoras, abas Todas 5 / Credenciamento 5 / Faturamento 5.
  - Proposta de credenciamento **0228** (Clínica Bem Estar): uma operadora (Unimed), grade por
    médico intacta — `| Dra. Helena Martins Prado — Cardiologista | Unimed | R$ 25,00 |`.
  - Proposta de faturamento **0229** (Clínica Vida Plena): serviço percentual sem valor, sem
    quantidade e sem avulso/mensal; convênios Unimed + Bradesco Saúde no corpo; *"Valor estimado
    do serviço: R$ 6.000,00/mês (5% de R$ 120.000,00)"*; e a condição de pagamento do serviço
    pré-preenchida sozinha (ADR-125).
  - Ficha do cliente: *"Convênios atendidos: Unimed, Omint"*, gravado pelo editor.
  - Portal do cliente: *"Convênios atendidos: Unimed, Bradesco Saúde, Amil One, Care Plus,
    Omint"*.

### O degrau seguinte, achado na revisão de segurança: para QUEM ia o link

Barrar a sessão não adianta se o link chega numa caixa que a pessoa barrada abre. O e-mail de
aceite e o de assinatura iam para **`Cliente.email`** — a caixa cadastral da clínica, que na
prática é a da recepção. A secretária EQUIPE abria essa caixa, clicava no link **deslogada**, e
assinava: deslogado é justamente o caminho do signatário legítimo. Pior, esse é o único caminho
que **não** deixa nome na trilha (`assinadoPorId` nulo) — a trava, sozinha, teria só tirado o
botão da tela.

`destinatarioDeAssinatura` (`apps/api/src/modules/documentos/`) passou a escolher **quem fala
pela clínica**: a conta de Portal daquele cliente que não é EQUIPE, sem acesso revogado,
preferindo quem já entrou. ⚠️ **A caixa da clínica continua sendo a reserva** — o cliente que
ainda não tem ninguém no Portal (a maioria hoje) não muda em nada. ⚠️ **Conta convidada e ainda
sem senha VALE**: `ativo = false` é ambíguo (ADR-131) e quem manda é o `acessoRevogadoEm` —
senão a clínica cujo dono acabou de ser convidado não receberia a proposta.

### O token que já vazou NÃO foi rotacionado — e por quê

A revisão levantou a dívida certa (é a lição da ADR-114: fechar o vazamento não paga a dívida
enquanto a chave vazada abre a porta). Aqui ela **não foi cobrada**, por uma leitura de exposição
real, e não por conveniência:

- para o caminho EQUIPE existir, **precisa existir uma conta EQUIPE** — e a migração da ADR-131
  (27/08, 21:43) marcou **todas** as contas de Portal existentes como RESPONSAVEL. Conta EQUIPE
  só nasce quando alguém convida uma pessoa nova, o que ainda não aconteceu;
- o caminho da sessão de suporte é a equipe da Med, que **já alcança o token** pelo painel do
  documento, legitimamente.

Rotacionar todo token PENDENTE derrubaria links que já estão na caixa de clientes reais, para
fechar uma porta que provavelmente ninguém atravessou. ⚠️ **A conferência que decide isso é uma
só:** existe alguma conta de Portal com papel EQUIPE em produção? **Se existir, rotacionar passa
a ser obrigatório** — e a rotação é regerar `Assinatura.token` e `Documento.propostaToken` de
toda linha PENDENTE e reemitir os links.

### O que ficou de fora, e por quê

- ~~A exigência "Quais operadoras você atende?" continua no checklist do Faturamento~~ —
  **REMOVIDA no mesmo lote, por ordem do dono.** Ela pedia em texto livre exatamente a lista que
  virou campo estruturado, e o Portal mostrava a mesma pergunta duas vezes, uma delas obrigatória.
  Precisou ser **migração** (`20260826213000_remove_exigencia_operadoras_duplicada`), não só a
  remoção da semente: `seedRequisitosSeVazio` só semeia com a tabela **vazia**, então apagar da
  semente não removeria nada de um banco que já roda. ⚠️ **A guarda é o que importa:** o `DELETE`
  só apaga onde **ninguém respondeu e nada foi enviado** — apagar exigência respondida levaria
  junto o trabalho do cliente, e onde houver resposta a exigência **fica** (duplicidade é menos
  grave que perda; a Thaís decide caso a caso na tela). O `Formulario` interno **não** é apagado
  de propósito: `FormularioResposta.formularioId` é `Cascade`, então apagá-lo apagaria as
  respostas. Conferido no banco local antes e depois: 0 respostas, 0 arquivos, e as outras **seis**
  exigências do Faturamento intactas.
- **O total do funil segue somando valor mensal com valor avulso no mesmo bolo** — já registrado
  na ADR-125, não foi criado nem resolvido aqui.
- **As propostas de credenciamento já emitidas com várias operadoras continuam como estão.** A
  regra vale para as novas; documento emitido é histórico e não se reescreve.
- **A escrita de volta no lead não foi exercida na tela** — o cliente usado na prova já tinha sido
  convertido, então não havia lead em negociação para corrigir (o comportamento correto é não
  mexer). Quem prova esse caminho é o teste de integração, contra o MySQL de verdade.

---

## ADR-127 — A proposta de faturamento passa a ser o papel real da Thaís, e o dinheiro sai de dois lugares novos

**Data:** 26/08/2026 (noite) · **Situação:** implementada, testada na tela, **não publicada**

### O problema

A "Proposta de faturamento médico" nascida na ADR-126 era uma versão **genérica escrita por mim**.
O dono mandou o papel que a Thaís realmente usa (Proposta 33 — Prisma Visão / Dr. Luis Paves) e
disse a regra: **a estrutura do conteúdo dela é intocável; a forma pode ser lapidada.**

Comparando os dois, o papel dela tem sete coisas que o sistema não guardava em lugar nenhum:

1. Uma abertura institucional própria do faturamento (foco em glosa e fluxo financeiro);
2. **Objetivo da parceria**, com a lista de operadoras;
3. **Como funciona o nosso serviço** — e, antes das seis etapas, **o que a Clínica precisa
   entregar** (dados do paciente, autorizações, tabelas, acesso à plataforma e aos portais);
4. **Suporte comercial** nominal, à frente das negociações com as operadoras;
5. **Gestão e acompanhamento** — quem coordena e que relatórios entrega;
6. **Prazos e rotina de faturamento**;
7. **Dados bancários e chave PIX**, e quem paga o portador do envio físico.

E uma contradição direta com o que estava no ar: o modelo publicado dizia, com todas as letras,
*"Não há valor fixo, taxa de adesão nem cobrança mínima"*, enquanto o papel de exemplo cobrava
valor fixo na faixa mais baixa.

### As decisões

**1. O Faturamento é SÓ percentual, e a porcentagem varia por cliente.** Ordem do dono, que
corrige o próprio papel de exemplo: a tabela de faixas (fixo embaixo, percentual em cima) **não
entra**. O sistema já sabia fazer isto — `Servico.percentual` é o padrão e o campo é editável
dentro de cada proposta (`PropostaServicosPicker.tsx`). **Zero código de preço novo, zero
migração.** A tabela do exemplo tinha, aliás, dois defeitos que teriam virado defeito nosso: o
valor `R$ 1.1200,00`, que não é um número, e um buraco entre R$ 25.000 e R$ 100.000.

**2. "Condições de pagamento" sai das propostas.** Não há condição a negociar: é sempre PIX. O
campo livre foi removido do construtor, do schema (`condicoes`) e dos três formatos de proposta.

**3. Nasce o bloco "Dados para pagamento", em Ajustes → Dados da empresa.** Cinco colunas novas e
nuláveis em `IdentidadeInstitucional` (`bancoNome`, `bancoAgencia`, `bancoConta`, `bancoTitular`,
`pixChave`), migração `20260826230000_dados_para_pagamento`, e o marcador `{{dadosPagamento}}`.
Sai na **Proposta comercial** e na **Proposta de faturamento médico**; **não sai na de
credenciamento** — ordem do dono: ali a Thaís só cobra depois do sucesso do credenciamento na
operadora, e a conta a receber nasce na aprovação, não no aceite (ADR-104).

⚠️ **A regra do vazio é a parte que importa.** Campo em branco não vira `Agência: ` na frente do
cliente — a linha some. Com os cinco em branco, **a seção inteira some**. Melhor faltar do que
sair pela metade. É função pura testada (`montarDadosPagamento`, em `@app/shared`).

**4. A frase do repasse deixa de ser campo e passa a ser automática.** Sempre que a proposta
inclui um serviço cobrado **só por percentual**, o documento diz sozinho quando o repasse cai —
inclusive em proposta misturada com serviços de valor fixo. O texto continua vindo de
`Servico.condicaoPagamento` (ADR-125), editável pela Thaís na tela de Serviços: mudar uma vírgula
não é publicação. `FRASE_REPASSE_FATURAMENTO` é só o valor de partida, para a proposta nunca sair
muda sobre quando se paga.

**5. O faturamento médio mensal SAI do papel do cliente e FICA no funil.** Recomendação minha,
aceita pelo dono, depois de ele levantar a dúvida certa: *"às vezes o cliente pode faturar muito
ou pouco e teremos que toda hora ficar mudando a média"*.

O número tinha dois usos e só um deles incomodava. No **papel**, imprimir *"Valor estimado do
serviço: R$ 6.000,00/mês (5% de R$ 120.000,00)"* é uma promessa que envelhece no mês seguinte — o
faturamento da clínica sobe e desce, e a proposta assinada não acompanha. No **funil**, sem ele o
lead de faturamento volta a valer **R$ 0,00** no card e no total da coluna, que foi exatamente o
defeito que a ADR-125 consertou pela manhã.

Então: a conta impressa saiu, e **o marcador `{{faturamento_mensal}}` foi removido do servidor e
da prévia** — não basta parar de usar, o número não pode nem ter caminho até o papel. O campo
continua no construtor, marcado *"não aparece no documento"*, alimentando `reconciliarPassosAuto`
como antes. Como não vai mais ao cliente, **ninguém precisa mantê-lo atualizado**: virou chute de
trabalho, não compromisso.

**6. A numeração das seções saiu.** Era minha, não dela — o papel da Thaís não numera. Tirá-la
resolveu de quebra um desleixo que a prévia mostrou: o título **Investimento** aparecia duas
vezes seguidas, porque o bloco `{{servicos}}` já traz o seu.

### O que ficou fora, e por quê

- **A plataforma de gestão da clínica** (o "Feegow Clinic" do exemplo) sai como texto genérico —
  *"a plataforma de gestão utilizada pela Clínica"*. Criar campo no cadastro do cliente para uma
  palavra não se paga; quem monta a proposta escreve o nome no documento, que é editável.
- **Os nomes de quem coordena e de quem dá suporte comercial** moram no **corpo do modelo**, não
  em campo do banco. A Thaís os troca em Ajustes → Modelos, sem publicação nenhuma.
- **`Servico.condicaoPagamento` não foi apagada.** Migração destrutiva por um campo de um dia não
  se paga; ela continua viva, com outro papel — a frase do repasse daquele serviço.
- **`{{percentual}}` continua existindo** como marcador, para quem quiser citar a porcentagem no
  corpo. O nosso modelo não usa: quem mostra o preço é a tabela do `{{servicos}}`.

### O achado de passagem: a comparação por categoria, pela quarta vez

Auditando o arquivo, `categoria === "Faturamento" ? emReais(percentual) : null` estava de volta em
**quatro lugares** de `documentos.service.ts`, montando o item da proposta a partir do cliente e
do lead. O efeito: **qualquer serviço percentual de outra categoria perderia o percentual em
silêncio** ao virar proposta. Ninguém tinha sido mordido; seria mordido no dia em que a Thaís
pusesse % num serviço de Gestão, ou renomeasse a categoria na tela. Corrigido — quem decide é o
preço — e **agora há teste lendo o arquivo do servidor**, além do que já lia o da tela.

### As provas

- `pnpm -r typecheck` e `pnpm lint` verdes; **441 testes de unidade** (13 novos em
  `pagamento-da-proposta.test.ts` e na trava anti-regressão) e **29 contra o MySQL de verdade**.
- E2E isolado verde em `flows-documentos-criar`, `flows-documentos-ui`, `flows-comercial` e
  `flows-ajustes-catalogos`.
- **Na tela:** Ajustes → Dados da empresa gravou e devolveu os cinco campos; o construtor da
  proposta **não tem mais** o campo "Condições de pagamento"; e a **proposta 0230** (Clínica Vida
  Plena) saiu com as seções do papel da Thaís na ordem dela, os convênios, a frase do repasse, o
  bloco bancário com `Nubank / 0001 / 686169152-5 / Thais Garcia Gestão Saúde /
  34.270.022/0001-93`, **sem** a conta impressa, **sem** marcador cru e **sem** um único erro de
  console.

⚠️ **Falta a Thaís preencher os dados bancários de verdade em produção.** Enquanto não preencher,
a seção simplesmente não aparece — que é o comportamento desejado, mas é ausência, não conserto.

---

## ADR-128 — Quem avisa o cliente é a Thaís, e a equipe pode ver o Painel dele sem assinar por ele

**Data:** 26/08/2026 (noite) · **Situação:** implementada, testada na tela, **não publicada**

### Parte 1 — o e-mail automático

**O problema, e não era onde parecia.** O dono pediu que cadastro **manual** de lead ou cliente
parasse de disparar o e-mail de acesso, e que só o autocadastro em `/comecar` avisasse sozinho.
Ao investigar, o cadastro manual de **lead** já não mandava nada ao cliente (só notificava a
equipe). O e-mail saía por três outros caminhos:

| Caminho | Antes |
|---|---|
| Cadastrar cliente manualmente | caixinha de confirmação **marcada por padrão** |
| Converter lead em cliente | caixinha de confirmação **marcada por padrão** |
| Contratar serviço na ficha | **sem caixinha nenhuma** — criava acesso e convidava |

Ou seja: o e-mail saía porque **ninguém desmarcava**. Quem cadastra clica em "Confirmar" no
automático — caixa marcada por padrão é regra que depende de alguém lembrar de desligá-la.

**A decisão: a origem virou parâmetro obrigatório.** `garantirAcessoPortal` passou a exigir uma
`OrigemDoAcesso`, e o compilador cobra a escolha de quem escrever a próxima chamada:

- `AUTOCADASTRO` — o cliente se inscreveu em `/comecar`. Está esperando o e-mail naquele
  instante; não mandar seria deixá-lo sem porta de entrada.
- `EQUIPE` — alguém da casa cadastrou, converteu ou contratou por ele. **A conta nasce e o e-mail
  não sai.**
- `EQUIPE_COM_AVISO` — alguém da casa cadastrou **e marcou, naquele momento, "avisar o cliente
  agora"**. A caixa nasce **desmarcada**: marcar é um ato, não um descuido.

Descartado: só desmarcar a caixinha. Daqui a três meses alguém a remarca "por praticidade" e o
comportamento volta calado, sem nada no código para impedir.

### Parte 2 — o botão "Painel", e a sessão de suporte

O dono pediu, com a analogia certa: *"como se fosse uma revenda de cPanel — temos liberdade de
ver o painel do cliente"*. O cPanel de revenda faz três coisas que a versão ingênua ("logar como
o cliente") não faz, e são elas que separam suporte de problema.

**1. A sessão é identificada, não emprestada.** `Session.operadorId` guarda quem da equipe abriu.
O `userId` continua sendo o dono do Portal — então **o isolamento do `portalProcedure` não muda
uma linha**, ele segue filtrando tudo pelo `clienteId` da sessão. O que muda é o histórico saber
dizer *"Thaís, vendo como Clínica X"*. Sem isso, tudo o que a equipe fizesse lá dentro ficaria
registrado no nome do cliente — e ele reclamaria de algo que não fez, com o próprio sistema dando
razão a ele.

**2. Vê tudo, não assina nada.** Decisão do dono, entre três opções apresentadas. Aceitar uma
proposta no Portal cria contrato e conta a receber (ADR-104); um clique errado da equipe viraria
dívida no nome do cliente, sem prova de quem clicou.

⚠️ **A trava mora no `portalProcedure`, não em cada ação.** Marcar ação por ação exigiria acertar
a lista hoje e lembrar dela em toda ação nova — e a esquecida seria justamente a que morde, porque
**no Portal escrever é sempre falar pelo cliente**: desistir do atendimento, cancelar serviço,
pedir serviço novo, enviar briefing, apagar documento, abrir chamado. Barrando toda **mutação**
num lugar só, ação nova nasce protegida. O `/upload`, que não passa pelo `portalProcedure`,
repete a trava — senão sobraria justamente a porta por onde um arquivo entraria no nome do
cliente.

**3. Dura 30 minutos e tem volta em um clique.** A sessão do operador continua viva
(`voltarParaSessionId`); voltar é trocar o cookie, não fazer login de novo. Prazo curto impede
uma aba esquecida de virar acesso permanente ao dado de outra pessoa.

**Quem pode:** ADMIN e acima, sempre; FUNCIONÁRIO só nos clientes sob a responsabilidade dele.
Negando por padrão. O acesso fica em `activityLog` (`painel_cliente.entrou`/`.saiu`) — acesso a
dado pessoal de terceiro precisa ser auditável, e isso não é capricho.

**Sem aninhamento:** quem está em suporte volta ao próprio acesso antes de abrir outro painel.
Aninhar faria a corrente de "voltar" mentir sobre onde a pessoa aterrissa.

### Parte 3 — três estados no card, não dois

O dono pediu o "Painel" para quem já tinha entrado. Ao desenhar, apareceu uma informação que a
Thaís **não tinha e mais precisa**: saber que ela convidou e **ninguém apareceu**. Antes, um
cliente que nunca entrou e um que entrou ontem tinham exatamente a mesma aparência no card.

| Estado | O card mostra | O que ele diz |
|---|---|---|
| `SEM_ACESSO` | **Enviar acesso** | ninguém foi convidado ainda |
| `CONVIDADO` | **Reenviar acesso** | *convidado há 6 dias, ainda não entrou* |
| `ATIVO` | **Painel** | *último acesso há 2 dias* |

Isso pediu `User.ultimoAcessoEm`, marcado **só no login com senha**. ⚠️ **Sessão de suporte da
equipe NÃO atualiza o campo**: ele responde *"o CLIENTE veio?"*, e nós entrarmos no painel dele
não é ele vindo.

O "Painel" só aparece no estado `ATIVO` porque a sessão de suporte precisa de conta com senha
definida — conta pendente seria recusada na primeira validação de sessão de qualquer jeito.

### O defeito que só a tela mostrou

Na primeira versão, `acessoAoPortal` recebia **a primeira conta de Portal por data**. A "Clínica
teste" do banco local tinha **duas**: uma pendente antiga e uma ativa mais nova — e a ficha
mostrava **"Enviar acesso" para um cliente que entrava no Portal normalmente**. Hoje a função
recebe a **lista** e manda quem **realmente abre a porta**; a pendente só conta quando não há
nenhuma ativa. E quando não há nenhuma ativa, a régua do *"convidado há N dias"* é a conta **mais
antiga**: reenviar o convite não zera a espera do cliente.

### Migração

`20260827003000_sessao_de_suporte_e_ultimo_acesso` — três colunas **novas e nuláveis**
(`Session.operadorId`, `Session.voltarParaSessionId`, `User.ultimoAcessoEm`), mais uma FK e um
índice. Nada é apagado, nada é convertido, nenhuma linha existente muda de valor: toda sessão que
já existe continua sendo sessão normal. `ON DELETE SET NULL` na FK de propósito — apagar quem deu
suporte não pode sumir com o rastro do acesso.

### As provas

- `pnpm -r typecheck` e `pnpm lint` verdes; **441 testes de unidade**; **41 contra o MySQL de
  verdade**, dos quais **17 novos** só para a sessão de suporte.
- E2E isolado verde em `flows-portal`, `flows-comercial` e `rbac`.
- **Na tela**, o percurso inteiro: a ficha da "Clínica teste" mostrou **"Painel do cliente"**;
  clicar abriu o Portal com a faixa *"Você está vendo o Portal como Clínica teste, em modo de
  suporte — só leitura"*; uma **mutação** (`portal.desistir`) foi recusada com **403 FORBIDDEN**
  e o recado certo; uma **leitura** (`portal.resumo`) respondeu **200**; e "Voltar ao meu acesso"
  devolveu a sessão da Thaís **sem novo login**. Zero erro de console.

### O que ficou de fora

- **O cliente não é avisado de que a equipe entrou no painel dele.** O acesso fica registrado e
  é auditável, mas não há aviso ativo. Se um dia for desejado, o gancho já existe.
- **Não há tela para ler o histórico de acessos ao painel.** Está no `activityLog`; falta a
  visualização.

---

## ADR-129 — O PDF do documento não usava a paginação que a tela mostrava

**Data:** 27/08/2026 (madrugada) · **Situação:** implementada, auditada na tela, **não publicada**

### O pedido, e o que ele revelou

O dono pediu a revisão dos **16 modelos de documento**, um a um: *"garantir que as quebras de
páginas dos modelos estão 100% no padrão e sem quebras erradas… rodapé fixo… header… nada
quebrando… nada repetitivo"*.

A auditoria achou um defeito maior que qualquer quebra torta: **a impressão ignorava a paginação
por completo.** O preview (`DocumentoBranded`) media os blocos e distribuía o conteúdo em folhas
A4; a função `imprimirDocumento` jogava o documento **inteiro numa única `.doc-sheet`** e deixava
o Chrome cortar onde bem entendesse, **sem uma só regra `break-inside`**. Ou seja: o que a Thaís
conferia na tela **não era** o que chegava ao médico em PDF — e a promessa de WYSIWYG escrita no
próprio arquivo era falsa desde que a paginação do preview existiu.

### As cinco decisões

**1. A tela e a impressão passam a usar a MESMA função.** A medição saiu de dentro do componente
React e virou `paginarDocumento(props)`, exportada. A impressão emite **uma `<div class="doc-sheet">`
por folha**, com altura de A4 exata e quebra forçada depois. As regras `break-inside: avoid` e
`orphans/widows` continuam no CSS de impressão, mas como **cinto de segurança**, não como
estratégia — a decisão de onde quebrar é nossa, não do navegador.

**2. A folha da tela virou uma A4 de verdade (793×1122 px a 96dpi), não uma A4 encolhida.**
Antes a folha tinha 620px de largura com a fonte em tamanho normal: proporcionalmente, o texto
ocupava **mais** espaço na tela do que no papel, então preview e PDF nunca poderiam concordar.
Hoje mede-se no mesmo tamanho em que se imprime, e o `zoom` já existente encolhe o conjunto para
caber no container — **sem espremer o conteúdo**. Os valores são arredondados **para baixo** da
conta em mm: 1px sobrando vira folha em branco no fim do PDF.

**3. Cabeçalho e rodapé em TODAS as folhas — sem repetir a capa.** A 1ª folha leva o cabeçalho
completo (marca, tipo, número, data, cliente) e o título. As folhas 2, 3, 4… levam um **cabeçalho
corrido**: uma linha fina com o logo pequeno e *"título — tipo nº"*, para a folha se identificar
solta sobre a mesa. Repetir a capa inteira seria exatamente o *"repetitivo"* que o dono não quer.
O rodapé institucional vai em todas; o **código de integridade** (`rodapeExtra`) sai **só na
última**, porque identifica o documento inteiro, não a folha.

**4. Nasceu o "Página N de M".** Não existia. Só é possível porque a contagem é nossa: no Chrome,
`counter(page)` só funciona dentro de caixas de margem de `@page`, que ele não implementa. Sai
apenas quando há mais de uma folha — *"Página 1 de 1"* é ruído.

**5. A regra de quebra virou função pura testada** (`paginacao.ts` / `paginacao.test.ts`),
separada da medição. Quem mede é o navegador; quem **decide** é código sem DOM, e por isso
testável. As quatro regras que ela garante:

| Regra | Por quê |
|---|---|
| Bloco que não cabe desce inteiro | é o básico |
| **Tabela que cabe numa folha inteira NUNCA é fatiada** | é o que impede a **assinatura partida** — traço numa folha, nome na outra. O bloco de assinatura das propostas é uma tabela de 3 linhas sem cabeçalho, e o código antigo caía no ramo de fatiamento sempre que ela não coubesse no que restava |
| Tabela maior que a folha é fatiada por **linhas inteiras**, repetindo o cabeçalho | nunca corta no meio de uma linha |
| **Título carrega a fila inteira de títulos abaixo + o começo do conteúdo** | título órfão no pé da folha |

### ⚠️ Dois defeitos que só a tela mostrou — e a lição é a mesma nos dois

Os testes de unidade estavam **verdes** e a auditoria na tela reprovou assim mesmo:

1. **Título órfão, primeira versão da regra.** A régua pedia *"duas linhas"* do bloco seguinte
   embaixo do título. Mas **parágrafo não se parte**: ou cabe inteiro, ou o título fica sozinho.
   *"Prazos e rotina de faturamento"* ficou no pé da folha 2 da proposta 0230.
2. **Título órfão, segunda versão.** Corrigida a régua, *"Como funciona o nosso serviço"*
   continuou órfão — porque é seguido de **outro título**. Olhar só o vizinho imediato não basta;
   a fila inteira de títulos desce junto.

E um terceiro, no caminho da impressão: **a última folha ainda quebrava depois**, o que põe uma
**folha em branco no fim do PDF**. O seletor `.doc-sheet:last-child` não casava porque o último
filho do corpo da janela de impressão é a tag `<script>`, não a folha. Hoje a última folha é
marcada por **classe**, não por seletor posicional.

### As provas

- `pnpm -r typecheck` e `pnpm lint` verdes · **140 testes de unidade na web** (10 novos só da
  paginação) · e2e isolado verde em `flows-documentos-criar`, `flows-documentos-ui` e no novo
  `flows-documentos-paginacao`.
- **Na tela**, varredura automatizada: **16/16 modelos** e **18 documentos reais (45 folhas)** com
  **zero** título órfão, **zero** conteúdo estourando a folha, cabeçalho e rodapé em todas as
  folhas, capa completa uma vez só e contador certo em todas. Zero erro de console.
- **Na janela de impressão**, medido na largura real de uma A4 (672px): as 4 folhas da proposta
  0230 cabem com folga de 154, 133, 55 e 645px, e só as três primeiras quebram depois.

### O que ficou de fora, e por quê

- **O Word (`.doc`) continua em fluxo único.** Ele tem paginação própria; enfiar as nossas folhas
  lá dentro produziria um arquivo impossível de editar. Ganhou apenas as dicas de quebra
  (`page-break-inside`, `page-break-after`, `orphans/widows`), que o Word respeita.
- **Não há como forçar viúvas/órfãs DENTRO de um parágrafo** na nossa paginação: o parágrafo é
  indivisível para nós. Na prática isso empurra o parágrafo inteiro para a folha seguinte, o que
  é o comportamento conservador correto — mas pode deixar mais espaço em branco no pé.
- **A conferência do PDF final foi feita medindo a janela de impressão, não abrindo o arquivo.**
  Abrir a caixa de diálogo de impressão trava a automação; o que se mediu foi a caixa de cada
  folha na largura exata de uma A4. É prova forte, não é o PDF aberto.

---

## ADR-130 — Auditoria de formatação dos 16 modelos: a lista sem marcador, a caixa que o sanitizador comia, e a proposta comercial que oferecia serviço com proposta própria

**Data:** 27/08/2026 · **Situação:** aceita · **PR:** #135

### O pedido

O dono relatou, na tela, que *"a proposta comercial de faturamento está desformatada, está
quebrada"*, e ampliou: **todos os modelos precisam ser impecáveis, incluindo pontuação e
numeração**, com a exigência explícita de clicar em todos no navegador — varredura automatizada
não bastava.

### O defeito principal: o reset do Tailwind apagava TODO marcador de lista

`.doc-body ul, .doc-body ol` declarava `padding-left` e **nunca declarou `list-style`**. O
preflight do Tailwind zera `list-style` em todo `ul`/`ol` da aplicação, e a folha do documento
nunca o devolveu. Consequências, todas visíveis e nenhuma detectável por `tsc` ou por teste:

- A lista **numerada de seis passos** da proposta de faturamento (*"1. Análise criteriosa… 6.
  Acompanhamento contínuo"*) chegava ao cliente **sem os números** — seis frases soltas.
- Toda lista com bala perdia a bala: as obrigações do contrato, as diretrizes da pauta de
  postagem, os passos do plano de trabalho do credenciamento.
- ⚠️ **E a janela de impressão NÃO carrega o Tailwind** — lá os marcadores apareciam. Ou seja:
  **tela e PDF discordavam de novo**, pelo caminho oposto ao que a ADR-129 fechou na véspera.

Corrigido declarando `list-style` explicitamente no `DOC_STYLES`, que é compartilhado pela tela e
pela impressão. **Nunca remova essas linhas confiando no padrão do navegador** — aqui o padrão do
navegador não vale, porque o reset já passou por cima. Travado por teste que lê o `DOC_STYLES`.

### O checklist chegava ao médico sem caixa nenhuma

`marked` emite `- [ ]` como `<input type="checkbox">`, e `input` está na lista de tags
**proibidas** do sanitizador — corretamente: campo de formulário dentro de documento do cliente
não tem uso legítimo. O efeito colateral era o **Checklist de documentos — Credenciamento** e o
**Checklist de onboarding** chegarem como listas de texto pelado, sem caixa para marcar.

A caixa virou **caractere** (`☐` / `☑`), que atravessa o sanitizador, a impressão e o Word sem
depender de tag de formulário. A proibição do `input` **fica como está**.

### Regra de negócio: qual proposta serve para quê (decisão do dono, 27/08)

- **Proposta comercial** é o modelo padrão, o que junta os serviços numa proposta só — e
  **credenciamento e faturamento ficam FORA dela**. Cada um já tem proposta própria com regra de
  cobrança própria (credenciamento só é cobrado no sucesso da operadora, ADR-104; faturamento é só
  percentual, ADR-127). Oferecê-los na comercial produziria dois papéis dizendo o mesmo com
  números diferentes.
- **A proposta de faturamento não tem mais "Serviços da proposta".** O serviço dela é sempre um só:
  ele entra marcado sozinho e a tela pergunta apenas o **percentual**, que varia por cliente. Com
  mais de um serviço percentual no catálogo a lista reaparece — o sistema não adivinha em silêncio.
- ⚠️ **Quem separa é o PREÇO** (`ehServicoSomentePercentual`) **e o nome canônico do credenciamento**
  (`ehServicoDeCredenciamento`), **nunca** `categoria === "Faturamento"` — comparação que já
  precisou ser removida quatro vezes deste código.

### A prévia passou a mostrar dado real

Com o cliente já escolhido, a prévia do "Novo documento" mostrava `[nome do cliente]`. Isso esconde
exatamente o que se confere antes de gerar: **como o documento fica com o nome da clínica dentro** —
que é mais comprido que o rótulo e quebra as linhas de outro jeito. Agora `previewModelo` recebe
nome, CNPJ, e-mail, telefone, data e consultora; o rótulo entre colchetes fica só para o que ainda
não existe.

E os rótulos deixaram de ser nome de código: `[dadosPagamento]`, `[clausulas_servicos]`,
`[fora_escopo]` viraram *dados para pagamento*, *condições de cada serviço*, *o que não está
incluído*. Campo novo que a Thaís crie cai num tradutor genérico (sublinhado e camelCase viram
palavras), então nunca volta a aparecer identificador cru.

### Padronização encontrada CLICANDO nos 16 modelos

- **Título duplicado em três modelos.** Contrato, Escopo e Recibo repetiam no corpo o título que o
  cabeçalho da folha já imprime — *"Contrato de prestação de serviços"* seguido de *"CONTRATO DE
  PRESTAÇÃO DE SERVIÇOS"*. Removido. (O `# DESCRIÇÃO DA PROPOSTA` do credenciamento e o
  `# PROPOSTA — MÓDULO DE FATURAMENTO` ficam: são seções reais, com texto diferente do título.)
- **Hierarquia errada na proposta de faturamento.** *"Suporte comercial"* era `###`, filho de *"Como
  funciona o nosso serviço"* — mas ele é irmão de *"Gestão e acompanhamento"*. Virou `##`.
- **Dois checklists, dois desenhos.** No Onboarding os grupos eram parágrafo em negrito (pretos e
  miúdos); no Checklist de documentos, títulos de verdade (azuis). ⚠️ Além da estética, **negrito
  não é título e a paginação não o protege de ficar órfão** no pé da folha. Padronizados em `##`, e
  a linha *"Onboarding de {{cliente.nome}}"* saiu (o cabeçalho já traz os dois).
- **Tabela de serviços torta.** A descrição do serviço era emendada ao nome com travessão, dentro da
  célula: a coluna "Serviço" ocupava quatro linhas e a de "Investimento" ficava com duas palavras
  espremidas. A descrição foi para uma **linha própria** dentro da célula.
- **Investimento redundante.** *"5% do faturamento (Faturamento) — por mês"* punha o nome do serviço
  entre parênteses no meio do valor e repetia "por mês" logo depois de "do faturamento/mês". Virou
  **"Faturamento: 5% do faturamento mensal"**.
- **`Foto 3x4` → `Foto 3×4`** (sinal de multiplicação).

### O que foi medido e NÃO virou mudança

Na proposta de credenciamento, a lista dos seis passos desce inteira e deixa quase meia folha em
branco. **Foi medido na tela**: sobravam 316px de conteúdo, mas com as margens entre blocos o
espaço útil real era ~124px e a lista tem 193px — **a paginação está certa**. Fatiar a lista por
itens deixaria "3 passos aqui, 3 na próxima folha", que é pior para uma lista numerada de
procedimento. **Vale a mesma regra da ADR-129 para tabelas: o bloco desce inteiro.**

### Provas

- `pnpm -r typecheck` (5 pacotes) e `pnpm lint` verdes · **153 testes de unidade na web** (12 novos)
  e **441 na API** · e2e isolado `flows-documentos-paginacao` **6/6 verde**, incluindo a auditoria
  automatizada dos 16 modelos (zero título órfão, zero estouro, contador certo).
- **Na tela, clicando nos 16 modelos um a um**, conforme exigido: numeração e balas presentes,
  caixas do checklist visíveis, nenhum rótulo com nome de código, nenhum título duplicado.
- **Proposta 0231 gerada de verdade** para a Clínica Vida Plena: hierarquia `H1 → H2 → H3` correta,
  tabela de serviços equilibrada, bloco bancário com os dados reais que o dono preencheu em
  Ajustes, e a prévia mostrando *"Prezado(a) Clínica Vida Plena"* em vez do rótulo.

### O que ficou de fora

- **Vários usuários por clínica** (médicos e secretárias com acesso próprio ao Portal) — pedido do
  dono na mesma conversa. Mexe no banco e no Portal, é o maior dos itens e não entrou aqui.
- **O PDF final continua não sendo aberto** (a caixa de impressão trava a automação). O que se
  prova é que tela e impressão usam o mesmo CSS e a mesma paginação.

---

## ADR-131 — Vários usuários por clínica: cada médico e cada secretária com o próprio acesso, e a separação entre quem fala pela clínica e quem toca o operacional

**Data:** 27/08/2026 · **Situação:** aceita

### O pedido

Do dono, no fim da conversa de 27/08: *"uma clínica pode ter VÁRIOS USUÁRIOS — médicos e
secretárias com acesso PRÓPRIO ao Portal, não uma conta só"*. Era o maior item em aberto e o
único que não coube na ADR-130.

### O problema, como ele existia

Cada clínica tinha **uma** conta de Portal, e o e-mail e a senha dela circulavam entre médicos,
secretárias e o dono. Três estragos ao mesmo tempo:

1. **A senha andava pelo WhatsApp da clínica.** Quem saía da clínica continuava com ela.
2. **O histórico não sabia quem tinha agido.** Um aceite de proposta dizia "a Clínica X aceitou",
   e não havia como saber quem.
3. **Todo mundo podia tudo.** A secretária que só precisava anexar um documento tinha, sem querer,
   o poder de cancelar um serviço contratado.

O modelo de dados **já tolerava** várias contas por cliente (`User.clienteId`, e a ADR-128 já tinha
registrado que um cliente pode ter duas). O que faltava era virar recurso de produto: convidar,
nomear, dar papel e revogar por pessoa.

### O que foi decidido

**Dois papéis dentro da clínica** (`User.papelPortal`, enum `PortalPapel`):

| Papel | Quem é | O que faz |
|---|---|---|
| `RESPONSAVEL` | dono, sócio, administrador | tudo — inclusive aceitar proposta, contratar, cancelar e convidar |
| `EQUIPE` | médico, secretária, recepção | o dia a dia: documento, formulário, agenda, suporte |

⚠️ **A trava é sobre ASSINAR, não sobre VER.** Os dois papéis leem tudo daquela clínica, valores
inclusive — a mesma escolha da ADR-128 para a sessão de suporte. Esconder número da secretária
resolveria um problema que ninguém relatou e criaria um que morde toda semana: ela não conseguiria
conferir a cobrança que é justamente o trabalho dela.

⚠️ **A lista é de LIBERAÇÕES, e o padrão é NEGAR** (`ACOES_LIBERADAS_PARA_EQUIPE`, em
`@app/shared`). É o inverso do que parece natural, e é a lição da ADR-128 levada um passo adiante:
numa lista de proibições, a ação que alguém esquecer de proibir é a que vai morder. Aqui **ação
nova nasce fechada** — quem escrever a próxima precisa decidir conscientemente que a secretária
pode. A trava mora no `portalProcedure`, num lugar só, e só vale para **mutação**.

**Papel nulo vale como RESPONSAVEL.** São as contas anteriores a esta regra — a conta única da
clínica, que sempre pôde tudo. Rebaixá-las em silêncio tiraria o poder de assinar de quem já
assinava, e a clínica descobriria isso na hora de aceitar uma proposta. A migração marca as
existentes explicitamente, para a **tela** não ficar com a coluna Papel em branco justamente para
quem manda na clínica.

**A clínica nunca fica sem quem assine** (`sobraResponsavel`, pura e testada): rebaixar, desativar
ou revogar o último responsável é recusado, em português. Ninguém revoga o próprio acesso.

**Revogar é desativar, nunca excluir.** A conta assina documento, abre chamado e aparece no
histórico; apagá-la deixaria "alguém" no lugar do nome de quem agiu — o defeito que a ADR-109
consertou. As sessões abertas caem junto (o `getUserFromSession` já recusa conta inativa a cada
request; apagar as linhas é para a lista de sessões não mentir).

**Duas telas, um componente e um serviço.** A equipe da Med usa o card *"Pessoas com acesso ao
Portal"* na ficha do cliente; o responsável da clínica usa a seção *"Quem da clínica entra aqui"*
no Portal. As duas passam pelas **mesmas** regras e pela mesma lista — duas cópias divergiriam no
primeiro ajuste, e a Thaís veria um estado enquanto o cliente vê outro sobre a mesma pessoa.

**O convite daqui SEMPRE manda e-mail**, diferente de `garantirAcessoPortal` (ADR-128). Lá o
silêncio é a regra porque a conta nasce como efeito colateral de cadastrar um cliente; aqui alguém
digitou nome e e-mail e apertou "Convidar" — o convite **é** o ato pedido, e uma conta criada sem
o convite chegar seria um acesso que ninguém sabe que existe.

### Os dois defeitos que só apareceram fazendo, com o teste verde

**1. `ativo = false` é AMBÍGUO — e a secretária recém-convidada aparecia como "acesso revogado".**
Conta convidada e ainda sem senha também nasce inativa. A primeira rodada de teste pegou a lista
dizendo à clínica que tiramos um acesso que acabáramos de dar. Nasceu `User.acessoRevogadoEm`: um
marcador explícito separa *"ainda não entrou"* de *"não entra mais"*, e de quebra responde
**quando** o acesso caiu. ⚠️ O mesmo engano estava em **dois lugares** — a situação da lista e a
mensagem de e-mail duplicado ("use Devolver acesso" para quem nunca teve acesso tirado) — e
também na régua do "sobra responsável", onde a coluna crua travaria a clínica recém-criada.

**2. A primeira pessoa da clínica entrava como "Equipe" e a clínica ficava sem ninguém para
assinar.** Achado clicando: o formulário vinha com "Equipe" pré-selecionado, e nada na tela dizia
que aquele acesso não podia aceitar proposta nenhuma. Hoje o padrão do convite **muda conforme a
clínica** (sem responsável → "Responsável"), e há um aviso amarelo enquanto ninguém falar por ela.

### O que ficou de fora, e por quê

- **Ligar o usuário do Portal ao cadastro `Profissional`** (o médico credenciado). São cadastros
  diferentes; misturá-los agora estragaria a grade do credenciamento (ADR-104).
- **Permissão por tela ou por documento.** Complexidade sem caso relatado.
- **Esconder valores da secretária.** Ver o que a clínica paga é o trabalho dela.

### Provas

`pnpm -r typecheck` e `pnpm lint` verdes · **585 testes** do `@app/api` (unidade + integração
contra o MySQL de verdade), com **15 novos de integração** provando o isolamento entre clínicas e
**14 de unidade** na regra pura · e2e `flows-pessoas-do-portal` verde no banco isolado · **na
tela**: convite pela ficha e pelo Portal, promoção, recusa do último responsável em português, e a
prova de ponta a ponta da trava — rebaixado a EQUIPE, `portal.cancelarServico` respondeu **403**
com *"Só o responsável pela clínica pode fazer isso"*, enquanto `portal.suporte.abrir` respondeu
**200**.

### Migrações (ainda NÃO publicadas)

`20260827053330_usuarios_por_clinica` — `User.papelPortal` (enum nulável), `User.convidadoPorId`
(FK `SET NULL` + índice) e um `UPDATE` marcando como `RESPONSAVEL` quem já tem acesso hoje.
`20260827054802_acesso_revogado_em` — `User.acessoRevogadoEm` (nulável).

As duas são **aditivas**: nada é apagado, nada é convertido, nenhuma linha existente muda de
sentido. Reverter é `DROP COLUMN` nas três colunas (a FK e o índice caem junto).

---

## ADR-132 — Documento para quem ainda é lead: a proposta vai para quem AINDA NÃO É cliente

**27/08/2026 · ordem do dono, durante a auditoria de tela que antecede o dado real.**

### O problema, nas palavras dele

> *"Quando estou criando um documento/proposta só aparece para eu selecionar CLIENTES. Não
> aparece LEADS. Preciso que apareçam os LEADS também (em todos os documentos que fizer sentido)."*

O relato apareceu enquanto a auditoria percorria o funil de ponta a ponta e batia no mesmo muro:
um lead recém-capturado pelo site não existia no seletor de "Novo documento". Não era defeito de
implementação — era o desenho: `clientes.list` filtra `situacaoComercial in {ATIVO, INATIVO}` de
propósito (ADR-24), porque a página **Clientes** não pode virar depósito de quem talvez nunca
feche. Só que o mesmo endpoint alimentava o seletor de documentos, e **a proposta é justamente o
papel que se manda para quem ainda não é cliente**. A única saída que a tela oferecia era converter
o lead antes da hora — sujando a base e disparando a provisão financeira da conversão (ADR-108).

### A decisão

**O seletor passa a oferecer as duas listas, e o corte é o ACEITE.**

Documentos de **pré-venda** aceitam lead: **Proposta** (comercial, credenciamento e faturamento),
**Escopo**, **Diagnóstico inicial**, **Plano de ação**, **Ata de reunião**, **Pauta de reunião** e
**Briefing**. O funil confirma o desenho: *"Apresentar diagnóstico e plano de recuperação de
glosas"* já é passo da etapa **Proposta**.

Documentos de **pós-venda** continuam exigindo cliente: **Contrato**, **Recibo**, **Onboarding**,
**Checklist**, **Relatórios** e **Pauta de postagem**. O caso que fecha o argumento é o contrato:
quem aceita a proposta **vira cliente automaticamente**, então um contrato apontando para lead
significaria assinatura sem cliente por trás.

A régua mora em `MODELO_ACEITA_LEAD` (`@app/shared`), lida pelo servidor **e** pela tela. É lista
de **liberações** com padrão fechado, como a `ACOES_LIBERADAS_PARA_EQUIPE` da ADR-131: **tipo novo
nasce fechado**, e um teste reprova quem acrescentar tipo sem decidir.

### O que NÃO mudou — e é o que torna isto barato

**Zero migração.** O documento continua apontando para `Documento.clienteId`. O truque é que
**todo lead já pode ter um `Cliente` PROSPECT por trás** — é o mesmo registro que dá acesso ao
Portal do prospect desde a ADR-128 (`garantirClienteDoLead`). Ao gerar, a tela troca o lead pelo
cliente-prospect (`documentos.clienteDoLead`, idempotente) e daí para baixo o fluxo é o de sempre:
nenhuma das **seis** formas de gerar documento precisou saber que leads existem.

⚠️ **Propor NÃO converte.** O `Cliente` nasce `PROSPECT`, some da página Clientes (ADR-24) e o
lead segue no funil com `convertidoEmClienteId` nulo. Isso está travado por teste de integração —
sem ele, "emitir proposta" viraria uma conversão silenciosa com provisão financeira junto.

### Duas armadilhas pagas

**1. O rótulo da lista não pode ir para o papel.** Para *escolher* entre clínicas parecidas, o
seletor mostra `Clínica X (Fulano)` — é a pessoa que desempata. Mas a prévia saiu com *"Prezado(a)
MedLar Home Care (Carlos Mendes)"*, e papel nenhum se manda assim. Hoje o servidor devolve as duas
coisas separadas: `rotulo` (escolher) e `nomeNoDocumento` (imprimir, só a clínica).

**2. Emitir e não achar depois.** Com a proposta gerada, o painel do lead **não mostrava documento
nenhum** — a Thaís emitiria e perderia o papel de vista. É a mesma falha de costura entre telas das
ADR-105 e ADR-128. Nasceu o bloco **Documentos** no painel do lead, com a situação de cada um.

### O que ficou de fora

- **Contrato para lead**, pelo motivo acima.
- **Criar o cliente-prospect no momento de ESCOLHER** (em vez de ao gerar): abrir o seletor e
  desistir criaria registro à toa.
- **Mostrar lead perdido, removido ou já convertido.** O convertido já está na lista de clientes;
  oferecê-lo duas vezes seria a armadilha das duas contas de Portal da ADR-128.

### Provas

`pnpm -r typecheck` e `pnpm lint` verdes · **4 testes de unidade** na régua pura (inclusive o que
reprova tipo novo sem decisão) · **5 de integração** contra o MySQL de verdade (lead aparece,
perdido/convertido/removido não aparecem, tradução idempotente, lead continua lead, nome impresso
sem parêntese) · e2e `flows-documento-para-lead` (2 casos) · **na tela**: proposta comercial
gerada para o lead *MedLar Home Care*, papel abrindo com *"Prezado(a) MedLar Home Care"*, banco
mostrando `situacaoComercial: PROSPECT` com `convertidoEmClienteId: null` e **um** cliente só, e a
proposta de volta no painel do lead como *"Proposta comercial - MedLar Home Care · Rascunho"*.

---

## ADR-133 — Dois números que mentiam: "enviados hoje" contando falha, e a recaptura de lead jogando dado fora

**27/08/2026 · achados na auditoria de tela que antecede o dado real em produção.**

### 1. "Enviados hoje" contava tentativa, não entrega

O monitor de e-mails mostrava, ao mesmo tempo e na mesma tela:

| Enviados (7 dias) | Falhas (7 dias) | Enviados hoje | Taxa de entrega |
|---|---|---|---|
| 0 | 48 | **23** | 0% |

Os quatro números não podem ser verdade juntos — hoje está **dentro** dos últimos 7 dias. A causa
era uma linha: a contagem do dia não filtrava `status`, e o rótulo dizia *"Enviados hoje"*.

**Por que isso importa mais do que parece.** O modo de falha não é uma tela feia: é alguém bater o
olho no painel, ler *"40 enviados hoje"* e concluir que o e-mail está funcionando enquanto **nenhum
sai**. Foi exatamente assim que a ADR-122 passou meses despercebida — a taxa de entrega esteve em
**0% desde sempre** e ninguém notou, porque havia um número grande e tranquilizador ao lado.

**Decisão:** `hoje` conta só `ENVIADO`, e nasceu `falhasHoje`, exibido ao lado do número — em tom
de alerta quando houve falha e nenhuma entrega. Um dia inteiro de e-mail recusado precisa
**aparecer no dia em que acontece**, não uma semana depois.

⚠️ Travado por teste de integração que compara os números do resumo entre si: se `enviados7d` é
zero, `hoje` **tem** de ser zero.

### 2. A recaptura de lead descartava telefone e empresa novos

Quem já é lead e preenche o formulário do site outra vez cai em `capturarLead` → ramo de
recaptura, que atualizava **só** `observacoes` e os serviços. Telefone corrigido e a clínica que
faltava na primeira vez eram **descartados em silêncio**.

**Decisão: completa o buraco, nunca sobrescreve.** `empresa` e `telefone` são gravados apenas
quando o lead está com o campo vazio. O inverso seria pior que o defeito — deixar o formulário
público apagar por cima a correção que a equipe fez à mão na ficha.

**O que ficou de fora:** atualizar o **nome**. Nome é o campo que a equipe mais corrige à mão
("Dr. Nogueira" no lugar de "nogueira"), e o ganho não paga o risco.

### Provas

`pnpm -r typecheck` e `pnpm lint` verdes · **3 testes de integração** novos contra o MySQL de
verdade · **na tela**: o painel passou a mostrar *"Enviados hoje 0 · 24 falha(s) hoje"*, com os
quatro números concordando entre si.

---

## ADR-134 — O aviso de lead novo parava de ser lido: um e-mail para cada ADMIN/ROOT, todo dia

**Data:** 27/08/2026 · **Situação:** aceita · **Contexto:** auditoria de tela antes do dado real

### O relato do dono

*"Um lead novo dispara 6 e-mails internos. Com lead real chegando todo dia, isso vira ruído e a
equipe para de ler."*

### Por que o sistema avisava todo mundo — e por que isso não era um esquecimento

O lead capturado pelo formulário público **nasce sem responsável** (`responsavelId: null`). Não
havendo a quem endereçar, `capturarLead` avisa **toda pessoa que poderia atender**: cada conta
`ADMIN` ou `ROOT` ativa. Em produção são quatro — `root@`, `thiago.garcia@`, `andre.cintra@` e
`thais.garcia@` — e cada uma recebe **notificação no sininho + e-mail**.

Com lead de teste, quatro e-mails por lead é irrelevante. Com lead real diário, é a definição de
ruído: **equipe que aprende a ignorar o aviso ignora também o que importa.** É o mesmo mecanismo
de dano da ADR-133 — um número que ninguém mais olha porque mentiu antes.

A preferência por pessoa **já existia** (`PreferenciaEmail` + a tela em Configurações). O que
faltava era o **padrão certo**: tudo nascia ligado, e ninguém desliga o que nunca notou.

### Decisão

**1. A conta de sistema nunca recebe e-mail operacional.** O `root@medconsultoria.com.br` é o
ROOT primordial da ADR-89 — conta imutável de sistema, que ninguém usa para entrar e cuja caixa
ninguém lê. Cada aviso mandado para lá é um endereço a mais na conta de envio sem leitor do
outro lado. Corta 1 dos 4. ⚠️ **Vale mesmo se alguém ligar a preferência à mão** — a régua é
sobre a conta, não sobre a vontade de quem mexeu na tela.

**2. "Lead novo" nasce ligado só para ADMIN.** O ROOT nominal (Thiago, André) continua vendo
**pelo sininho**, que não mudou, e liga o e-mail na tela se quiser. Quem toca o comercial é
ADMIN; ROOT é papel de administração do sistema. Corta mais 1 — sobram os dois que realmente
atendem. ⚠️ **Nenhum outro aviso mudou de padrão**, e há teste que reprova a mudança silenciosa.

**3. A tela de preferências passou a ser legível.** Vinte e cinco interruptores numa lista
corrida ninguém lê: agora são **seis seções** (Vendas e funil · Clientes e Portal ·
Credenciamento · Documentos · Financeiro · Agenda e tarefas · Sistema), e o texto no topo diz o
que a pessoa mais precisa saber antes de desligar algo — **desligar o e-mail não esconde o
aviso do sistema**, o sininho continua mostrando.

### A régua mora num lugar só

Nasceu `decidirEmailOperacional` (pura, em `@app/shared`), e o `notificar()` inteiro passou a
consultá-la: categoria emailável, conta ativa, conta não excluída, e-mail presente, e-mail não
anonimizado, conta de sistema, preferência da pessoa e padrão do papel — **as oito condições num
lugar só**.

⚠️ **A mesma função alimenta a tela de preferências.** Sem isso a tela mostraria "ligado" para um
aviso que o servidor não manda — exatamente o modo de falha da ADR-133, onde um número na tela
convenceu todo mundo de que o e-mail estava saindo enquanto nenhum saía.

**`padraoDesligadoPara` é uma lista de EXCEÇÕES com padrão LIGADO** — o oposto de
`MODELO_ACEITA_LEAD` (ADR-132) e de `ACOES_LIBERADAS_PARA_EQUIPE` (ADR-131), que são liberações
com padrão fechado. A diferença é deliberada: lá o risco é **fazer demais** (assinar, propor);
aqui o risco é **avisar de menos** — aviso que não chega é trabalho que não acontece. Categoria
nova, portanto, nasce **ligada**.

### Alternativas descartadas

- **Avisar só quem tem o lead atribuído.** Não funciona: o lead nasce **sem** responsável — é a
  causa do problema, não a solução. Ninguém seria avisado e o lead morreria no funil.
- **Um resumo diário no lugar do aviso imediato.** Lead comercial tem prazo de resposta em
  minutos; trocar o imediato pelo diário resolveria o ruído destruindo o valor.
- **Rodízio entre ADMINs.** Inventa um dono onde não há, e o que não tem dono claro não é feito.

### O que ficou de fora, e por quê

O **sininho continua avisando todo mundo** — inclusive o ROOT. É de propósito: dentro do sistema
o aviso não custa atenção como o e-mail custa, e é lá que se vê que um lead chegou sem que
ninguém tenha pegado.

### Provas

`pnpm -r typecheck` e `pnpm lint` verdes · **472 testes de unidade** (12 novos na régua pura,
inclusive os dois casos que enganam: endereço do sistema com maiúscula/espaço, e endereço que
apenas *contém* o do sistema) · **6 testes de integração** novos contra o MySQL de verdade,
provando que a listagem lê papel e e-mail do banco e aplica a mesma régua do envio · **na tela**,
`/configuracoes` como ADMIN: seis seções, "Novo lead pelo site" ligado, zero erro de console.

---

## ADR-135 — A varredura das 10 telas que faltavam: um painel de erros 100% ruído, um painel de segurança que mentia, um percentil impossível e o e-mail que dava as boas-vindas ao sistema errado

**Data:** 28/08/2026 · **Contexto:** segunda janela da auditoria de tela pedida antes do cadastro
de dado real (a primeira está nas ADR-132/133/134). Percorridas, clicando, as **10 páginas que
faltavam**: Tarefas · Agenda · Projetos · E-mail · Mensagens · Ajustes (e os 6 modais dentro
dele) · Serviços · Modelos · Equipe e acessos · Sistema (as 9 abas, entrando como ROOT).

Sete telas estavam sadias. Os quatro defeitos abaixo têm uma coisa em comum com os das ADR-128 a
134: **nenhum deles quebra nada**. Tudo responde, nada dá erro de console, a suíte estava verde.
O que eles fazem é pior — dizem coisas que não são verdade, em painéis e e-mails que existem
justamente para alguém acreditar neles.

### 1. O painel de erros do ROOT era 100% ruído — e o ruído era um estado esperado

`SISTEMA → Erros` anunciava **"5 erros não resolvidos"**. Lidos no banco, os cinco eram:

| Ocorrências | Rota | O que era |
|---|---|---|
| **66×** | `email.sincronizar` | "esta caixa precisa ser reconectada" — a caixa da Thaís com a senha vencida |
| 16× | `email.sincronizar` | erro cru do Node, de 04/08, já corrigido no `decifrar` |
| 1× | `email.sincronizar` | idem, mesma data |
| 1× | `tarefas.contar` | Prisma reclamando de `responsavelId`, de **28/07**, antes de o campo virar N-N |
| 1× | `tarefas.list` | idem |

**Nenhum era um bug atual.** As 66 ocorrências são um estado que a própria tela já trata, com o
botão *Reconectar* ao lado da caixa — e a última delas foi registrada **durante esta auditoria**,
às 01:33, só por abrir a página.

A causa é de uma linha. O `onError` do tRPC diz, no comentário, exatamente o que quer fazer:
*"Só bugs de servidor (não erros esperados de validação/autz) vão para o painel de Sistema"*, e
filtra por `error.code === "INTERNAL_SERVER_ERROR"`. Só que os três caminhos de "precisa
reconectar" lançavam **`new Error(...)` cru**, e um `Error` sem código é classificado pelo tRPC
como INTERNAL. O filtro estava certo; o erro é que tinha o crachá errado.

⚠️ **O estrago não para no painel.** O primeiro registro dispara e-mail *"Novo erro no sistema"*
ao ROOT; e se o ROOT marcar como resolvido, a abertura seguinte da página reabre o registro como
**REGRESSÃO** e avisa de novo. É o mesmo mecanismo de ruído que a ADR-134 acabou de combater no
aviso de lead novo, só que num canal onde o ruído é mais caro: quem para de ler o painel de erros
para de ver o erro de verdade.

Nasceu `erroPrecisaReconectar` (`modules/email/erros-de-caixa.ts`), que devolve `TRPCError` com
**`PRECONDITION_FAILED`** — o código honesto: a operação não é inválida nem proibida, falta uma
condição prévia que a pessoa resolve sozinha. Ligada nos **três** caminhos do IMAP (caixa já
marcada, segredo que não abre, senha recusada na conexão) e nos **dois** do SMTP.

⚠️ **A tela não muda uma linha:** `EmailPage` decide o que mostrar pelo `estado` gravado no banco
(`AUTENTICACAO_FALHOU`), nunca pela mensagem nem pelo código do erro.

⚠️ **Servidor de e-mail fora do ar continua sendo INTERNAL, de propósito.** Só o que tem remédio
conhecido pelo usuário saiu do painel. Queda de servidor o ROOT deve mesmo ver — e para ela já
existe o alerta de Incidentes ("50 falhas seguidas"), que é o instrumento certo.

### 2. O painel de segurança dizia "Desligada" com a CSP ligada

`SISTEMA → Manutenção` mostrava **"Proteção de cabeçalhos (CSP): Desligada"**. Conferido no
mesmo minuto com `curl -D - /health`:

```
Content-Security-Policy: default-src 'self';base-uri 'self';object-src 'none';
  frame-ancestors 'self';form-action 'self';script-src 'self'; …
```

A CSP estava **ligada**. A linha do painel era um `cspLigada: false` **fixo no código**, com o
comentário "desativada por ora" que envelheceu no dia em que o `helmet` ganhou as diretivas.

⚠️ **Um painel de segurança que mente é pior do que não existir, mesmo mentindo para o lado
pessimista** — e o motivo não é o susto: é que ele **não mudaria de valor** no dia em que a CSP
fosse realmente desligada, porque não lia nada.

Por isso a correção não é trocar `false` por `true`. Nasceu `lib/seguranca-http.ts`, e quem
acende a marcação é o **boot**, na linha seguinte ao `register(helmet, …)`. Tirar o registro
apaga a marcação junto, e o painel volta a dizer "Desligada" — que aí seria a verdade. Travado
por teste que lê o `server.ts` e cobra as duas coisas juntas.

### 3. Um percentil maior que o máximo

`SISTEMA → Desempenho`, colunas vizinhas na mesma linha:

```
ENDPOINT     CHAMADAS  MÉDIA  P95     MÁX
agenda.list  9         33ms   256ms   184ms
cards.move   6         51ms   256ms   195ms
```

**O percentil 95 não pode passar do máximo observado** — é um valor da própria amostra. A coluna
P95 também só mostrava potências de 2, que é a assinatura do histograma: `percentilBuckets`
devolvia o **limite superior do balde**, então qualquer chamada de 129 a 256 ms virava "256 ms".

⚠️ **O histograma fica.** Trocá-lo por lista de amostras faria o monitor guardar toda chamada em
memória, num processo que já serve API + SPA + tempo real. O que entra é o **teto pelo máximo
real**: a aproximação passa a errar só para menos, que é o lado seguro de um número usado para
decidir o que otimizar. A conta saiu para `observability/percentil.ts` — testável sem carregar o
`monitor.ts`, que instala o observador de GC do processo já no import.

### 4. O cliente recebia as boas-vindas do sistema errado

O achado que mais chega a quem está de fora. `aceitarConvite` chamava `enviarBoasVindas` **sem
olhar o papel** — e o cliente do Portal também é `User`, a mesma armadilha da ADR-100 e do
vazamento de token de 05/08. O médico que acabava de ativar o acesso ao **Portal** recebia:

> **Assunto:** Bem-vindo ao **Workspace MedConsultoria**
> **Corpo:** "Sua conta no Workspace MedConsultoria foi ativada… Aqui você acompanha **clientes,
> projetos, agenda, finanças, documentos e se comunica com a equipe**"
> **Botão:** **Acessar o workspace** → o sistema **interno** da Med

Três coisas erradas de uma vez: o nome de um sistema que ele nunca viu, a promessa de gerenciar
clientes e finanças da MedConsultoria, e um botão para o lugar errado.

Nasceu o template **`boas_vindas_portal`** ("Boas-vindas ao Portal (cliente)"), editável na tela
como todos os outros, e a régua `templateDeBoasVindas`. ⚠️ **O padrão dela é o do CLIENTE**, não
o da equipe: papel novo — ou nulo, de conta antiga — cai no texto neutro. Errar para esse lado
tira de um colega um link que ele já tem no navegador; errar para o outro manda o endereço do
sistema interno para fora da empresa.

**E o problema não era só desse template.** Duas fontes espalhavam o mesmo vazamento:

- **O rodapé, igual nos 42 templates**, trazia *"Acessar o workspace"* apontando para o sistema
  interno e a frase *"sua conta no Workspace MedConsultoria"*. Mais da metade dos e-mails vai
  para fora (cliente do Portal, lead do site). O link saiu; ficaram o e-mail comercial e o site
  institucional. ⚠️ **Quem é da casa não perde nada:** o e-mail que pede uma ação já traz o
  próprio botão, e o endereço do sistema está no navegador dessa pessoa o dia inteiro. A versão
  em texto puro — a que o cliente lê em leitor sem HTML — assinava com o mesmo endereço interno e
  passou a assinar com o site.
- **`reset_senha`** dizia *"sua conta no Workspace MedConsultoria"* no assunto e no corpo. E
  `solicitarReset` procura o e-mail **sem filtrar papel**: quem esquece a senha pode ser o
  cliente. Num e-mail de segurança, o nome de um sistema desconhecido é o jeito mais rápido de a
  mensagem ser lida como golpe. O texto ficou neutro — serve aos dois públicos, sem template novo.

### O que foi achado e NÃO foi corrigido

Está tudo em `docs/auditoria/AUDITORIA-2026-08-27.md`. Em resumo: o nome do cliente aparece **até
três vezes na mesma linha** na Agenda e em Projetos (vem colado dentro do título do evento e do
nome do projeto, e a tela já mostra o cliente à parte); clicar numa ocorrência de evento
recorrente abre a **data da primeira** ocorrência sem avisar que se está editando a série toda; e
a coluna *Papel* de **Equipe e acessos** mostra só "Cliente", sem dizer se a pessoa é
**Responsável** ou **Equipe** da clínica (ADR-131). Nenhum dos três produz dado errado — os três
são refino de tela, e entram numa próxima janela para não misturar refino com correção.

⚠️ **Pendência do dono:** o **Foro de eleição** está em branco em *Ajustes → Dados da empresa*.
Enquanto ficar assim, o contrato sai com **`[A PREENCHER]`** no lugar — que é o comportamento
correto (nunca um dado inventado), mas precisa ser preenchido antes do primeiro contrato real.


### O que a revisão derrubou, e o que ela consertou

Revisores `security` e `typescript` rodaram sobre o commit. Os dois liberaram o merge, e o
`typescript` confirmou o que mais importava: **nenhum dos 8 consumidores** de `comCaixa`/`comSmtp`
inspeciona tipo, código ou mensagem do erro — todos os `catch` são genéricos —, então a troca de
`Error` por `TRPCError` não muda comportamento em lugar nenhum.

Três suspeitas minhas foram **derrubadas com evidência**, e vale registrar para ninguém as
levantar de novo: a mudança de código **não** esconde falha genuína (o caminho novo casa por
`err.authenticationFailed === true`, flag do `imapflow`, não por substring — rede fora do ar e
timeout continuam INTERNAL); a mensagem propagada do `decifrar` **não** vaza nada (são quatro
textos curados de `cripto-caixa.ts` mais metadado de formato do `node:crypto`, e como não há
`errorFormatter` no tRPC, o `throw e` anterior já entregava a mesma mensagem — mudou o status, não
a exposição); e o rodapé **não** perdeu proteção anti-phishing (a frase "se não reconhece, ignore"
e a nota de expiração ficaram; tirar um link de login de 42 e-mails **reduz** a superfície).

**Dois achados foram aceitos e corrigidos no mesmo lote:**

1. ⚠️ **`marcarCspLigada()` era uma segunda declaração, não uma leitura** — eu tinha reintroduzido
   o defeito a uma edição de distância. O comentário prometia que tirar o `register` apagaria a
   marcação, mas o jeito mais provável de desligar a CSP é trocar `contentSecurityPolicy` por
   `false`, e aí o painel voltaria a mentir **no sentido perigoso**: anunciando proteção que não
   existe. As opções viraram uma constante e a marcação passou a receber
   `Boolean(opcoesHelmet.contentSecurityPolicy)`. O teste cobra o formato da chamada.
2. ⚠️ **`ehErroPrecisaReconectar` reconhecia qualquer `PRECONDITION_FAILED`** — e há pelo menos
   **oito outros** na aplicação (IA sem chave, backup só no servidor, quatro em `acoes.service`,
   dois em `envio.service`). Quem usasse a função para decidir "ofereço o botão Reconectar"
   engoliria erro alheio. Virou a classe `ErroPrecisaReconectar`. ⚠️ **O `cause` não serve para
   marcar**: o construtor do `TRPCError` reembrulha o que recebe, e a marca não sobrevive à volta
   — o teste pegou isso na hora.

**Um achado foi recusado, com o motivo:** o `catch` em volta do `decifrar` é largo e engole
também a falha de autenticação do GCM, que significa "chave rotacionada **ou** conteúdo
adulterado". Separar os dois daria de volta o sinal de adulteração — mas o **mesmo** `catch` pega
a rotação legítima da `EMAIL_CRYPTO_KEY`, que é operação normal e documentada, e passaria a gerar
um alerta por caixa no painel do ROOT: o ruído exato que esta ADR existe para combater. O sinal
que se ganha vale pouco (quem escreve em `CaixaEmail.segredo` já tem escrita no banco e não
precisa disto), o falso positivo é garantido. Fica como está, de propósito.

⚠️ **Duas ressalvas de exatidão, para o texto acima não prometer mais que o código:** o **botão**
dos dois templates de boas-vindas continua apontando para `config.WEB_ORIGIN` — o mesmo host serve
Portal e Workspace, então o cliente cai no Portal ao entrar, mas o endereço é o mesmo. E a rota
HTTP de download de anexo (`http/email-anexo.ts`) segue respondendo **500** para caixa quebrada,
porque o Fastify não traduz código de `TRPCError`; não é regressão (antes também era 500), só não
foi beneficiada.

### Provas

`pnpm -r typecheck` e `pnpm -r lint` verdes · **491 testes de unidade** (19 novos: 4 na régua do
erro esperado + 2 no caminho real do `comCaixa` com prisma dublê + 4 no estado da CSP + 4 no
percentil + 5 na escolha do texto por público) · **na tela**, como ROOT: `SISTEMA → Manutenção`
mostrando **"CSP: Ligada"**, e em *Mensagens automáticas* a prévia do novo "Boas-vindas ao Portal
(cliente)" com botão **"Entrar no Portal"**, rodapé sem o link interno e **zero** ocorrência da
palavra "workspace" — nele e no de redefinição de senha.

---

## ADR-136 — Os quatro refinos de tela da auditoria: o aviso que faltava na série recorrente, o papel invisível no Portal, o nome do cliente três vezes na mesma linha e "LEAD" contra "cliente"

**Data:** 28/08/2026 · **Estado:** aceita · **Origem:** achados B5–B8 de `docs/auditoria/AUDITORIA-2026-08-27.md`

A ADR-135 fechou os quatro defeitos que faziam a tela **dizer coisa falsa**. Sobraram quatro
refinos que a auditoria classificou como "nenhum produz dado errado". Três realmente são de
leitura. **Um não é** — e é por ele que esta ADR começa.

### B6 — editar uma repetição mudava a série inteira, sem dizer

Clicar na reunião desenhada em **24/08** abria o formulário com **03/08**, a 1ª ocorrência. Isso
está **certo**: evento recorrente é UMA linha no banco (`Evento.recorrencia` + `recorrenciaAte`),
e o servidor já devolve `baseInicio`/`baseFim` com o comentário dizendo que editar afeta a série
toda. O defeito é que **a tela não contava isso a ninguém**. Quem corrigisse o horário de uma
reunião mudava todas as reuniões — e a única pista era a data no campo, que se lê como bug, não
como aviso.

⚠️ **O conserto NÃO foi passar a editar só a ocorrência clicada.** Isso exigiria exceção por
data no banco (migração, e a decisão de o que fazer com as ocorrências já passadas) para resolver
um problema que ainda não foi relatado. O que faltava era a frase.

A regra virou função pura testada (`avisoDeSerie`, em `features/agenda/aviso-serie.ts`), porque
**quando** avisar tem dois casos que se confundem: clicar na 1ª ocorrência avisa da série mas não
fala de data (não há divergência), e ⚠️ **hora diferente no mesmo dia não é divergência de dia** —
comparar `Date` cru acenderia o aviso errado. A comparação usa o formatador central de data
(`lib/format-date`), que fixa `America/Sao_Paulo`; comparar em UTC trocaria o dia perto da
meia-noite.

### B7 — a coluna *Papel* não distinguia quem assina

Depois da ADR-131 existem dois papéis dentro da clínica — **Responsável** (aceita proposta,
contrata, cancela, convida) e **Equipe** (só o operacional) —, e *Equipe e acessos* dizia
"Cliente" para os dois. Quem olhava não sabia se a secretária pode assinar. A informação existia
só no card *Pessoas com acesso ao Portal*, dentro da ficha de cada cliente.

`papelPortal` entrou no `publicSelect` de `usuarios.service` e a tela mostra "· Responsável no
Portal" / "· Equipe no Portal" ao lado do crachá, com o texto de ajuda de `PORTAL_PAPEL_AJUDA` no
`title`. ⚠️ **Papel nulo é mostrado como Responsável**, a mesma leitura de `podeNoPortal`: são as
contas anteriores à regra, que sempre puderam tudo. Duas leituras diferentes do mesmo nulo — uma
na trava, outra na tela — é exatamente o modo de falha da ADR-133.

### B5 — o nome do cliente aparecia até 3× na mesma linha

Na Agenda e em Projetos, o nome vinha **colado dentro do título** e a tela ainda o mostrava à
parte. Com nome real e comprido, o card ficava ilegível:

```
Credenciamento médico e odontológico — Consultório Dr. Almeida   ← título, em duas linhas
Consultório Dr. Almeida                                          ← selo do cliente, logo abaixo
```

Vinha da geração automática: `garantirCardDoServicoContratado` criava `"<Serviço> — <Cliente>"`, a
conversão do lead criava `"Reunião de kickoff — <Cliente>"` e `"Projeto — <Cliente>"`. Os títulos
gerados perderam o sufixo. Foi conferido antes que **toda** tela que lista projeto mostra o
cliente ao lado: a lista em cards, a tabela e o cabeçalho da ficha (`subtitle`).

⚠️ **Havia um lugar onde o nome do projeto viajava sozinho** — a notificação
`projeto_participante` ("você foi adicionado ao projeto X"). Sem o cliente no título, dois
clientes com o mesmo serviço produziriam avisos idênticos. Lá o nome do cliente passou a ser
**acrescentado explicitamente** (`Gestão Operacional (Clínica Teste CNPJ)`), em vez de depender de
ele estar embutido no título por acaso.

⚠️ **O que já está gravado NÃO muda.** Os projetos e eventos antigos continuam com o nome dentro
— renomeá-los em massa mexeria em dado que alguém pode ter editado à mão, para ganhar só estética.
A tela fica misturada por um tempo, e isso é aceitável.

⚠️ **As contas do Financeiro ficaram como estão** (`Contrato — <Cliente>`, `Mensalidade —
<Cliente>`), fora do escopo do achado: a página Financeiro não exibe o cliente com o mesmo
destaque, e tirar o nome de lá é decisão de outra tela.

### B8 — "LEAD" de um lado, "cliente" do outro

Em Mensagens, a lista lateral marcava a conversa com o selo **LEAD** e a assinatura da mensagem,
na mesma tela, dizia **"Clínica teste · cliente"**. A assinatura olhava só `autor.role === "CLIENTE"`
(que é o papel no sistema, e o cliente do Portal e o lead são ambos `User` com esse papel);
agora olha também a categoria da conversa, que é a mesma fonte do selo. Uma fonte só para as duas
marcas — duas fontes é como elas divergiram.

### Provas

`pnpm -r typecheck` e `pnpm -r lint` verdes · **491 testes de unidade** do `@app/api` · **158 do
`@app/web`** (5 novos em `aviso-serie.test.ts`) · **na tela**, como ROOT no localhost:

- Agenda → clicar na repetição de **24/08** de "Reunião semanal de equipe" abre com a faixa âmbar
  *"Este evento se repete — salvar altera a série inteira. A data abaixo é a da 1ª repetição
  (03/08/2026), não a de 24/08/2026 em que você clicou."*, com o campo Início mostrando 03/08.
- *Equipe e acessos* → as contas de Portal mostram **"Cliente · Responsável no Portal"**.
  ⚠️ **O caso "Equipe" não foi visto na tela** — não há conta com esse papel no banco local; o
  texto vem do mesmo `PORTAL_PAPEL_LABEL` que a ficha do cliente já usa e exibe.
- Contratar "Gestão Operacional" para a *Clínica Teste CNPJ* criou o projeto chamado
  **"Gestão Operacional"**, com "Clínica Teste CNPJ" no rodapé do card — ao lado dos antigos, que
  seguem com o nome dentro, como esperado.
- Mensagens → a conversa com selo **LEAD** agora assina **"Clínica teste · lead"**.
- **Zero erro de console** em Agenda, Equipe e acessos, Projetos e Mensagens.

**Zero migração** — nada mudou no banco.

---

## ADR-137 — Aceitar proposta e assinar contrato passam pelas travas do Portal (o buraco C6)

**Data:** 2026-08-28 · **Situação:** implementado, não publicado ·
**Origem:** achado **C6** da descoberta de 28/08 (`docs/esteira/refino-final-2026-08-28/achados.md`)

### O problema

Duas travas de permissão foram escritas com cuidado, cada uma com a sua ADR, e **nenhuma das
duas ficava no caminho que realmente assina um contrato**:

- A **sessão de suporte** (ADR-128) — alguém da Med vendo o Portal como o cliente — é barrada em
  toda **mutação** do `portalProcedure`. "Vê tudo, não assina nada."
- A conta **EQUIPE** da clínica (ADR-131) — médico, secretária — é barrada em toda mutação que
  não esteja na lista `ACOES_LIBERADAS_PARA_EQUIPE`. "A trava é sobre assinar, não sobre ver."

Só que `propostas.responder` e `assinaturas.assinar` **não são do `portalProcedure`**: são
`publicProcedure`, porque a página de aceite (`/proposta/:token`) e a de assinatura
(`/assinar/:token`) são links de e-mail que quem assina abre sem nunca ter entrado no sistema.

O caminho de volta era o `portal.resumo`: a página inicial do Portal listava as propostas
pendentes e os documentos para assinar **com o token de cada um dentro**. Qualquer pessoa logada
naquele Portal — inclusive as duas que a regra proíbe — recebia o link e clicava. A secretária
assinava o contrato pela clínica; a Med assinava em nome do cliente. O comentário do campo
`SessionUser.operador` já *dizia* que o "guarda das ações de compromisso (aceitar/recusar
proposta, assinar)" lia aquele campo. Não lia.

Agravante: a assinatura gravava **IP e user-agent**, que dizem de onde veio, nunca quem foi.
Desde a ADR-131 cada pessoa da clínica tem conta própria, e "quem aceitou" deixou de ser a
clínica e passou a ser gente.

### A decisão

**A rota continua pública. A trava é sobre a SESSÃO, não sobre o token.**

Fechar as rotas exigiria login de quem assina, e quem assina é justamente quem chega pelo
e-mail. O token — 256 bits, sorteado, com hash do conteúdo conferido — é a credencial desse
caminho e continua sendo. O que passou a existir é a leitura da sessão **quando ela existe**:

| Quem está logado ao clicar | Pode? | Por quê |
| -------------------------- | ----- | ------- |
| ninguém (link de e-mail)   | sim   | é o caminho normal de quem assina |
| sessão de suporte da Med   | não   | "vê tudo, não assina nada" (ADR-128) |
| conta EQUIPE da clínica    | não   | não fala pela clínica (ADR-131) |
| responsável, ou conta interna | sim | é quem a regra já autorizava |

Três peças:

1. **`podeAssinarPelaClinica`** (`packages/shared/src/portal-papeis.ts`) — função pura, a régua
   única. Devolve a **chave** do motivo (`SUPORTE_SO_LEITURA` / `SO_RESPONSAVEL`), não a frase:
   a frase da sessão de suporte mora no servidor, e duas cópias do mesmo texto divergem no
   primeiro ajuste.
2. **`aceiteProcedure`** (`apps/api/src/trpc/trpc.ts`) — um `publicProcedure` com essa régua no
   meio. `propostas.responder` e `assinaturas.assinar` passaram a usá-lo. ⚠️ **A trava mora no
   procedure, não no serviço**, pelo mesmo motivo do `portalProcedure`: ação nova nasce coberta.
   E é por isso que o teste chama pelo `createCaller` — chamar o serviço direto passaria verde
   com o buraco aberto, que é exatamente o engano que deixou isto escapar.
3. **O `portal.resumo` não entrega o token a quem não pode usá-lo.** ⚠️ **O item continua
   aparecendo na lista** — a trava é sobre assinar, não sobre ver, e esconder a proposta da
   secretária resolveria um problema que ninguém tem. O que some é o botão. Sem isso a tela
   mostraria um botão que o servidor recusa, que é o modo de falha da ADR-133.

### Quem assinou passou a ficar registrado

Migração `20260828140843_assinatura_e_aceite_com_autor`: `Assinatura.assinadoPorId` e
`Documento.propostaRespPorId`, **duas colunas novas e nuláveis** com FK `SET NULL`. Nada é
apagado, nada é convertido, nenhuma linha existente muda de valor; reverter é `DROP COLUMN` nas
duas. O `activityLog` do aceite e da assinatura passou a gravar o mesmo `userId`.

⚠️ **Nulo é o caso NORMAL, não uma falha:** o link de e-mail é anônimo por natureza. A coluna
responde "havia alguém logado, e quem era?", não "quem é o signatário".

### O que ficou de fora, e por quê

- **Conta interna da Med logada (ADMIN/ROOT) não é barrada.** Ela já alcança o token pelas telas
  internas, e barrá-la aqui mudaria um comportamento que ninguém relatou como problema. O achado
  nomeava a EQUIPE e a sessão de suporte. ⚠️ Consequência aceita: quem está numa sessão de suporte
  barrada pode clicar em "voltar ao meu acesso" e assinar. O que a ADR-128 barra é agir **como o
  cliente**, e isso continua barrado — e agora fica atribuído pelo `assinadoPorId`.
- **Prazo de validade no token.** Nem o de proposta (`randomUUID`, 122 bits) nem o de assinatura
  (`gerarTokenPublico`, 256 bits) expiram. Inadivinháveis os dois; validade é outra decisão.
- **Não há trava por clínica no token.** Quem tem o token pode assinar — é o desenho do link
  público. O `portal.resumo` já isola por `clienteId`, então ninguém obtém por ali o token de
  outra clínica.

### Provas

`pnpm -r typecheck` e `pnpm -r lint` verdes · **497 testes de unidade** do `@app/api` (6 novos na
régua pura) · **8 testes de integração novos** contra o MySQL de verdade e **pelo `createCaller`**
(`aceite-e-assinatura-travas.integration.test.ts`): a EQUIPE recusada nas duas ações **sem gravar
nada**, a sessão de suporte recusada nas duas, o anônimo assinando (com `assinadoPorId` nulo), o
responsável assinando **com o próprio id gravado**, e o `portal.resumo` devolvendo `token: null`
— mas a lista cheia — para os dois papéis barrados.

---

## ADR-138 — O Faturamento é só percentual: a comparação por categoria morre na raiz e nasce a trava

**Data:** 2026-08-28 · **Situação:** implementado, não publicado ·
**Origem:** achados **F1, F3, F4, F10, F12, F19** e "a trava que falta" da descoberta de 28/08

### A comparação por categoria, pela QUINTA vez

`categoria === "Faturamento"` já tinha sido removida em quatro rodadas (ADR-125, 126, 127 e o
teste de regressão que nasceu delas). A descoberta a encontrou de novo, e no lugar mais **a
montante de todos**: `ServicosPage.tsx`, a tela onde a Thaís cria e edita o serviço. Ali ela
fazia três estragos ao mesmo tempo:

1. **impedia um segundo serviço percentual de existir** — % em Gestão? o campo nem aparece;
2. **sumia com o % no dia em que alguém renomeasse a categoria** na tela ao lado, sem aviso;
3. **deixava o campo Valor visível** justamente no serviço que não tem valor.

O teste de regressão que existia guardava só o `PropostaServicosPicker.tsx` e o
`documentos.service.ts` — e a tela mais a montante, que alimenta as duas, ficava de fora. Agora
ele varre também `ServicosPage.tsx` e `ServicosContratadosCard.tsx` (o editor de preço da ficha,
onde a comparação sobrevivia como um dos ramos de um OU).

### Quem decide passou a ser um interruptor, não o nome da categoria

Nas duas telas: **"Como este serviço é cobrado" → Valor fixo | % do faturamento**. A categoria
voltou a ser só o que ela diz que é — um agrupamento no catálogo —, e os textos de ajuda que
ensinavam a regra errada ("escolher 'Faturamento' libera o campo de %") foram reescritos.

⚠️ **Trocar de forma LIMPA a outra.** Sem isso o campo escondido continuaria gravado e o serviço
ficaria com as duas cobranças — que é exatamente o estado que a trava abaixo recusa.

### A trava que nunca existiu

Não havia **nada** — banco (sem CHECK), Zod, servidor nem tela — impedindo valor fixo +
percentual no mesmo serviço. E esse estado quebra em silêncio tudo o que lê
`ehServicoSomentePercentual`: a linha da proposta volta a mostrar valor e quantidade, a
estimativa do funil troca de pergunta sozinha, a conversão passa a provisionar dinheiro fixo.
Nenhum desses caminhos avisa; eles só mudam de comportamento.

`temValorEPercentual` (`@app/shared`, junto das outras três réguas de preço) é aplicada em
**dois níveis**:

- **`refine` nos três schemas** (`createServicoSchema`, `updateServicoSchema`,
  `atualizarContratacaoClienteSchema`), com a recusa escrita em português;
- ⚠️ **e uma conferência no SERVIDOR sobre o ANTES + o DEPOIS**, porque a edição é parcial: o
  `refine` só vê o que veio no pedido, e mandar só `percentual` num serviço que já tem `valor`
  gravado passaria batido. É a mesma armadilha da ADR-136 — a régua tem de olhar o estado que
  vai ficar, não o pedaço que chegou.

⚠️ **Zero não é cobrança:** `valor: 0` com `percentual: 5` passa. Tratar zero como "tem valor"
travaria o serviço percentual criado com o campo preenchido a zero, que é o padrão de vários
formulários.

⚠️ **Conferido antes de ligar a trava:** no banco local, **0 de 15 serviços e 0 de 12
contratações** têm as duas cobranças. Ninguém fica trancado fora da própria edição.

### Provas

`pnpm -r typecheck` e `pnpm -r lint` verdes · **510 testes de unidade** (9 novos) · **na tela**,
como ROOT no localhost: em *Serviços → Faturamento → Configurar*, o botão **"% do faturamento"**
marcado, **sem** campo Valor, com os 5%; clicar em **"Valor fixo"** troca ao vivo para Valor +
Cobrança padrão. Na *ficha da Clínica Vida Plena → Faturamento → Editar preço*, o mesmo botão,
já em percentual, com os convênios. **Zero erro de console** nas duas.

---

## ADR-139 — O Portal do cliente vira aplicativo: barra de 4 coringas + 1 vaga, e seis seções com endereço

**Data:** 2026-08-28 · **Status:** aceita · **Esteira:** `docs/esteira/portal-app-5-secoes-2026-08-28/`
(briefing, spec, design, adendo) e `docs/superpowers/plans/portal-app-5-secoes.md`.

### O problema

O Portal do cliente era **uma página só, com 16 blocos empilhados**, escolhida por PAPEL em
`App.tsx` e **ignorando o caminho** — qualquer endereço caía nela. Sem roteador, sem menu, sem
abas, sem seção recolhível: 37 funcionalidades numa rolagem. Ordem do dono: *"o Portal precisa
parecer um aplicativo no celular, com menu inferior"*.

### A decisão que muda tudo: a barra tem 4 CORINGAS e 1 VAGA

A recomendação era de **5 seções fixas** (Início · Documentos · Credenciamento · Meus serviços ·
Suporte). O dono recusou, com a razão certa: *"nem todos nossos clientes tem convênios. Nem todos
tem credenciamento tbm."*

Então: **Início · Documentos · [vaga] · Serviços · Suporte**. Os quatro de fora valem para todo
cliente. A 3ª posição é uma **vaga**, preenchida pela primeira candidata aplicável àquele cliente.
Sem candidata, a barra tem **quatro** itens e fica simétrica — nunca cinco com um buraco, nunca um
item morto.

⚠️ **A vaga é uma LISTA DE CANDIDATAS (`features/portal/secoes.ts`), nunca um
`if (temCredenciamento)` dentro da barra.** A diferença aparece na próxima frente de trabalho:
quando o Faturamento ganhar tela própria, ela entra acrescentando **uma linha** — sem reabrir o
componente, sem renegociar espaço, sem risco de a barra virar seis itens por descuido.

Hoje há **uma** candidata, e isso é fato do repositório, não escolha: `PortalCredenciamento` é a
única tela de frente que existe. Rótulo **"Convênios"**, porque "Credenciamento" (14 caracteres)
não cabe num item de barra a 360px — e "Convênios" é como o médico chama isto de qualquer forma.

### A segunda ordem do dono: Documentos são DOIS ACERVOS

De um lado, o que a **MedConsultoria** preparou (briefing, proposta, contrato, ata): o cliente lê,
aceita, assina — e não apaga. Do outro, o que o **cliente** enviou (RG, alvará, CRM, mini
currículo): ele envia e remove — e não assina. A distinção **já existia no código** e é de FONTE
(`portal.resumo.documentos` × `portal.arquivos`), com ações **opostas**.

⚠️ **Nunca uma lista só ordenada por data.** Com o mesmo peso visual, assinar um contrato e apagar
o próprio RG ficam a um clique um do outro — e é assim que o cliente apaga o que não devia.

Entre os dois entrou o bloco **"o que ainda falta enviar"** (`ExigenciasPendentes`), a fila plana
do que a Med está esperando. É o **único acionável** dos três, e por isso fica no MEIO: no fim da
página, seria lido depois da lista do que já foi enviado — que é justamente onde o cliente conclui
que entregou tudo.

### Por que o roteador do Portal mora em arquivo próprio

Dois testes-guarda leem o **TEXTO** de `apps/web/src/app/router.tsx` por expressão regular:
`lib/paginas.test.ts` (toda rota precisa de lugar no menu lateral **da equipe** ou de exceção
declarada) e `components/GuiaTour.test.ts` (toda rota precisa de guia próprio no catálogo
**interno**). Uma rota do Portal ali reprovaria os dois, cobrando item de menu da equipe e guia
interno para uma tela que é do cliente. Logo: `app/portal-router.tsx`, e `lib/paginas.ts` não muda
uma linha.

⚠️ **"Qualquer caminho cai no Portal" é contrato TESTADO em dois arquivos** — `flows-portal.spec`
vai a `/financeiro` e `rbac.spec` vai a `/clientes`, e as quatro asserções procuram um cabeçalho
que case `/Portal/i`. Quem preserva isso agora é a **rota curinga**; e o H1 do Início é
**"Seu Portal"**, com a saudação no subtítulo — "Olá, Clínica X" quebraria as quatro.

⚠️ **O redirecionamento de `/` para `/portal` NÃO PODE VAZAR** para `App.tsx` nem para o roteador
interno. "Voltar ao meu acesso" recarrega para `/` (`FaixaDeSuporte.tsx`) e, a partir dali, a
pessoa é FUNCIONARIO — para quem `/` é o Dashboard interno. Fora do roteador do Portal, o operador
da Med voltaria ao Portal em laço, sem saída.

### A trava de papel passou a aparecer ANTES do clique — com UMA régua só

Quatro botões apareciam para quem o servidor ia recusar: *"Não tenho mais interesse"*,
*"Quero retomar"*, *"Solicitar"* e *"Cancelar serviço"*. A secretária (EQUIPE, ADR-131) e a sessão
de suporte da Med (ADR-128) clicavam, liam um modal, confirmavam — e só então levavam "sem
permissão".

⚠️ **Esconder só na tela seria pior que o problema:** seriam duas réguas para a mesma pergunta, e
na primeira liberação nova em `ACOES_LIBERADAS_PARA_EQUIPE` a tela passaria a esconder um botão que
o servidor aceita — o modo de falha da ADR-133. Nasceu `podeAgirNoPortal` (função pura,
`@app/shared`) e **o `portalProcedure` passou a chamá-la**, no lugar das duas condições soltas. É
refatoração **sem mudança de comportamento**, provada por um teste que percorre papel × ação ×
sessão de suporte e confere contra a conta feita à mão.

Na tela: **esconder COM EXPLICAÇÃO**, nunca desabilitar em silêncio. E **o item continua visível** —
a trava é sobre agir, não sobre ver: a secretária precisa saber o que está contratado justamente
para avisar quem cancela.

### O ganho de desempenho que saiu de graça

`portal.servicosDisponiveis` leva **11,9 s em produção** e era obrigatória para o Portal abrir,
inclusive para quem só ia assinar um contrato. Com as seções, ela carrega **só em Meus serviços**,
e `portal.emails` **só em Suporte**. Os três contadores da barra usam **as mesmas** consultas que
as seções — mesma chave de cache, uma ida só ao servidor.

### Decisões menores que valem registro

- **Contador em três seções, não em cinco.** Início nunca tem contador (a seção *é* a fila) e
  Documentos também não (não há fonte própria; a pendência já é contada nas outras duas).
- **A fila de "o que falta enviar" lista só o OBRIGATÓRIO** — é exatamente o que o campo
  `pendentes` do servidor conta e o que a pílula mostra. Incluir o "se houver" faria a barra dizer
  2 e a fila mostrar 3.
- **Um guia por seção** (`GuiaPortal.tsx`), com `/portal` **por último** na lista de prefixos: ele
  é prefixo de todos os outros e, em primeiro lugar, capturaria as cinco seções. Mesma armadilha de
  `/emails` × `/emails-enviados`.
- **A barra continua visível dentro de um chamado de suporte** — escondê-la tiraria a única saída
  de quem entrou por engano.
- **Equipe da clínica e Perfil vão para o menu do avatar**, não para a barra: são configuração, e
  um lugar na barra sairia caro para uma tela visitada uma vez por semestre.

### O que ficou de fora, de propósito

- **O preço no card do serviço contratado.** `portal.meusServicos` não devolve preço, e buscá-lo é
  mexer no servidor — onde vale a ADR-118 (`Decimal` não atravessa o tRPC, e quando atravessa a
  tela mostra "R$ NaN" sem um único erro de console).
- **CRM do médico na tela de Convênios:** `credenciamentoParaOPortal` recorta para id, nome e
  especialidade. Mostrar o CRM exigiria mexer no servidor.
- **Os 4 achados de REGRA do Portal (M9, C7, C8, F20)**, por ordem do dono: misturar correção de
  regra com redesenho faz o PR crescer e esconde qual das duas coisas quebrou.
- Manifesto web, `viewport-fit=cover` e rota por chamado de suporte.

### Dois defeitos que só a TELA mostrou

1. **O selo "AMBIENTE LOCAL" caiu em cima da barra**, escondendo dois rótulos. Só no ambiente
   local — mas justamente enquanto se testa a navegação. Ele agora sobe a altura da barra.
2. **Com cinco itens a 360px, "Documentos" era cortado em "Docume…"** — medido, não estimado. O
   rótulo encolhe para 10px abaixo de 390px; o nome completo continua no `aria-label`.

E um que só a **revisão** pegou: `PortalCredenciamentoPage` tratava "consulta sem dado" e "consulta
FALHOU" como a mesma coisa. Numa falha de rede, o cliente era devolvido ao Início **em silêncio** —
e concluiria que perdeu o processo de credenciamento.

### Provas

`pnpm -r typecheck` e `pnpm -r lint` verdes · **suíte completa do `@app/api` verde (72 arquivos,
679 testes**, 8 novos na matriz de papel × ação) · **171 testes do `@app/web`** (13 novos:
`secoes.test.ts` e `GuiaPortal.test.ts`) · **39 testes de ponta a ponta verdes**, incluindo
acessibilidade (axe) nas **cinco** seções do Portal · e **na tela**, como cliente do Portal a
360x800 e a 1920x1080: as cinco seções, a barra com a vaga preenchida, o redirecionamento de
`/financeiro` e de `/portal/xpto` para `/portal`, e **zero erro de console**.

**Zero migração** — nada mudou no banco.

### Adendo (mesma data) — o defeito que só o banco NOVO mostrou

A CI reprovou `flows-credenciamento-portal` depois desta entrega, e a causa **era do redesenho**,
não do ambiente — a rodada anterior do mesmo PR, só com documentação, passara.

⚠️ **O catálogo de serviços da Med é criado SOB DEMANDA** (`seedIfEmpty`, em
`servicos.service.ts`), e quem o criava, na prática, era quem listasse serviços primeiro. No
Portal, isso era o `portal.servicosDisponiveis` da página única — que rodava em **toda** abertura.
Tirá-lo da carga inicial (o ganho de desempenho desta ADR) tirou junto a semeadura: num banco
recém-criado, o cliente que abrisse **Convênios** primeiro caía num catálogo vazio, e a tela dizia
*"Tudo enviado 0/0"* com a papelada inteira faltando.

⚠️ **Isso não aparece no banco de quem desenvolve** — ele tem o catálogo há meses. Aparece na CI e
apareceria numa produção recém-nascida.

O conserto tem duas metades, e a segunda é a que morde de verdade:

1. `credenciamentoDoCliente` passou a **garantir o catálogo** antes de sincronizar
   (`garantirCatalogoDeServicos` — uma leitura de nomes, não a lista de 11,9 s). Depender de
   "alguém abriu outra tela antes" é acoplamento que só falha em banco novo.
2. `sincronizarRequisitosCredenciamento` **memorizava "serviço inexistente" para sempre**: a
   função guarda a promessa numa variável de módulo, e um resultado `{ ok: false, motivo:
   "servico-inexistente" }` ficava gravado no processo. A sincronização nunca mais rodaria —
   **nem depois de o serviço aparecer** — até alguém reiniciar o servidor. Agora esse resultado
   não é memorizado, e a próxima chamada tenta de novo (o mesmo tratamento que a falha já tinha).

**Como isto foi descoberto, e como descobrir de novo:** reproduzindo a semeadura EXATA da CI num
banco novo local (`prisma migrate deploy` + `pnpm db:seed` + `pnpm db:demo`) e olhando o catálogo —
ele volta **vazio**. Nenhuma leitura de código mostra isso, e nenhum revisor pegaria: o defeito é
a soma de uma consulta que saiu de uma tela com uma semeadura que ninguém sabia estar pendurada
nela.

**Prova:** `flows-credenciamento-portal` **7/7 verde no banco isolado**, que reprovava 2 antes do
conserto; suíte completa do `@app/api` verde (72 arquivos, 679 testes).

---

## ADR-140 — A auditoria total antes do dado real: a segunda porta é sempre a que fura a trava

**Data:** 28/08/2026 · **Status:** aceita · **Escopo:** segurança, dinheiro, perda de dado, telas

### Contexto

O dono pediu, com todas as letras, uma varredura de tudo — "todas as páginas e funcionalidades,
como se fosse um usuário mesmo fazendo os trabalhos de todos os dias" — porque vai começar a
cadastrar **dado real** em produção e estava com receio. Oito frentes rodaram em paralelo sobre o
código de hoje, mais a aplicação percorrida no navegador. O retrato completo, com arquivo:linha em
tudo, está em `docs/auditoria/AUDITORIA-TOTAL-2026-08-28.md`.

A base começou verde: typecheck 6/6, lint limpo, 679 testes de `@app/api`, 171 de `@app/web`, 99 de
ponta a ponta. **Nenhum dos defeitos abaixo foi pego por teste** — todos vieram de leitura dirigida
e de uso na tela.

### O padrão que explica quase todos os achados

Não foram catorze defeitos independentes. Foi **um padrão, catorze vezes**: uma regra construída
com cuidado numa tela, e uma **segunda porta** para o mesmo dado que não passava por ela.

- A ADR-131 fez a trava de "quem fala pela clínica" e a ADR-137 fechou o caminho da assinatura —
  mas *Equipe e acessos* criava conta de Portal sem gravar `papelPortal`, e **nulo vale como
  RESPONSAVEL**. Toda secretária cadastrada pela Med assinava contrato. A trava mais nova da casa,
  furada na origem pela tela mais velha.
- A ADR-128 criou a sessão de suporte justamente para a equipe ver o Portal **sem agir** e ficar
  rastreável — mas `clientes.pessoas.*` era `funcionarioProcedure` com o `clienteId` vindo do
  pedido. Qualquer funcionário se convidava como RESPONSAVEL de qualquer clínica e entrava com
  sessão **normal** de cliente, sem marca nenhuma.
- A ADR-126 fez cada proposta de credenciamento ser de uma operadora só — mas `salvarGrade` foi
  escrita para a grade da ficha, onde a carga é o cliente inteiro. Emitir a 2ª proposta apagava os
  cruzamentos da 1ª.
- Revogar acesso derrubava a sessão e não tocava nos tokens; o convite vale 72 h, e aceitá-lo grava
  `ativo: true`.
- A conversão do lead cobra e a contratação pela ficha cobra; **aceitar proposta não cobrava** — e
  para o cliente já convertido não vem conversão nenhuma atrás. Upsell vendido e não faturado.

**A regra que fica:** ao construir uma trava, a pergunta não é "esta tela está protegida?", é
**"quantas portas existem para este dado, e todas passam por aqui?"**. Uma trava com duas portas é
uma trava com zero portas.

### Decisões

1. **Régua compartilhada, nunca cópia.** `papelPortalPadraoDaClinica` e `assertSobraResponsavel`
   saíram de `pessoas.service.ts` para `portal/papel-da-clinica.ts`, e a tela interna passou a
   chamar as mesmas funções. ⚠️ **O arquivo é separado por causa de ciclo de módulos** —
   `pessoas.service.ts` já importa `gerarConvite` de `usuarios.service.ts`. As mutações de
   `clientes.pessoas.*` passaram a chamar `assertPodeVerOPainel`, que é a régua que o Painel do
   Cliente já usava.
2. **Errar para o lado de menos poder.** Conta nova de Portal nasce EQUIPE quando a clínica já tem
   quem assine. Tirar um poder se desfaz num clique; dar poder de assinar contrato a quem ia anexar
   documento, não.
3. **Prova de assinatura não se apaga.** `solicitar()` recusa quando já existe assinatura dada.
   Reenviar continua liberado enquanto ninguém assinou; quem precisa de outro documento emite outro
   documento.
4. **A lista de vínculos da exclusão definitiva tem de cobrir toda relação em cascata.** Faltavam
   três de treze — suporte, médicos e credenciamentos. O que não está na lista o banco apaga em
   silêncio, depois de a tela ter dito "seguro remover".
5. **`trustProxy: 1`, nunca `true`.** `true` deixa o visitante escrever o próprio `X-Forwarded-For`,
   e o `req.ip` é a chave de todos os freios — **e é a prova gravada em `Assinatura.ip`**.
6. **Best-effort não é silêncio.** O `catch(() => {})` da automação pós-aceite virou registro em
   SISTEMA → Erros, dizendo qual cliente conferir. O aceite do cliente continua não caindo por
   causa da nossa automação — mas a falha aparece.
7. **Erro ANTES de vazio, em toda tela.** A aplicação tem rede de segurança para mutação e nenhuma
   para consulta, e `retry: false` faz um tropeço virar estado final. Dez telas liam falha como
   "não há nada" — no Portal, isso dizia ao cliente ✅ *"Você já enviou tudo o que pedimos"*, e ele
   parava de mandar documento. ⚠️ No `SistemaPage` o ramo de erro era **código morto**: vinha
   depois do `!data`, que já o capturava.
8. **O nome do serviço de credenciamento ficou travado — e isto é remendo assumido.**
   `ehServicoDeCredenciamento` casa por nome, e três decisões de dinheiro dependem dela: bastava
   corrigir um typo em Ajustes para religar a cobrança antecipada que a ADR-104 proíbe, e cobrar o
   cliente duas vezes. A cura é `Servico.ehCredenciamento`, que pede migração e fica para a rodada
   seguinte.

### Alternativas descartadas

- **Corrigir os ~120 achados de uma vez.** Um PR assim esconde qual das mudanças quebrou o quê.
  Entrou o que causa perda de dado, cobrança errada ou acesso indevido; o resto está catalogado.
- **`Servico.ehCredenciamento` agora.** Migração no meio de um lote de correção de segurança
  mistura dois riscos diferentes.
- **Barrar o download de arquivo para funcionário sem vínculo.** É achado real (a régua diverge da
  do Painel do Cliente), mas mudar quem vê o quê no meio da operação da Thaís é decisão de produto.

### O que NÃO entrou, e por quê

Está tudo na Parte 2 do relatório: o que depende de decisão do dono (dado indo para a OpenAI,
retenção sob a LGPD, expiração de token, se credenciamento reaberto cobra de novo), o que exige
migração, e o que é trabalho invisível — funil que não fecha depois do aceite, seis avisos com
modelo que nunca saem, cliente que não sabe que o suporte respondeu.

### Prova

typecheck 6/6 · lint limpo · **688 testes** do `@app/api` (9 novos, **todos vistos reprovando antes
da correção**) · 171 do `@app/web` · 99 de ponta a ponta · e na tela, como ROOT e como cliente do
Portal, sem erro de console numa carga limpa. **Zero migração** — nada mudou no banco.

---

## ADR-141 — Conformidade com a lei antes do dado real: a peneira no portão, o link que expira e o direito que dá para exercer

**Data:** 2026-08-28 · **Situação:** aceita · **Ordem do dono:** *"Não quero quebrar regras de lei.
Resolva tudo e deixe tudo conforme a lei."*

### Contexto

A auditoria total (ADR-140) deixou quatro itens de conformidade em aberto, listados em
`docs/esteira/lgpd-2026-08-28/O-QUE-FALTA.md`. Não eram defeitos de funcionamento — a aplicação
fazia tudo o que se pedia dela. Eram obrigações da LGPD que ninguém tinha atendido, e o dado real
ia começar a entrar em produção.

### 1. Dado de cliente indo para a OpenAI

**O achado.** `resumirCliente` e `sugerirProximoPassoLead` mandavam `cliente.observacoes` e
`lead.observacoes` inteiros para a OpenAI. Esse campo **não é neutro**: a migração
`20260819161500_cliente_sempre_pj` moveu para dentro dele o CPF de todo cliente que era pessoa
física, e `leads.service` grava ali o texto livre que qualquer pessoa digita no formulário público.
Havia transferência de dado pessoal identificável a um operador estrangeiro, sem base legal
registrada — e o próprio `docs/IA_PRIVACIDADE.md` **prometia mandar menos do que o código mandava**.

**A decisão: a peneira mora no PORTÃO.** A app inteira fala com a OpenAI por uma única função,
`gerarRascunho` (`apps/api/src/lib/ai.ts`) — 16 chamadas, uma porta. `redigirDadoPessoal`
(`@app/shared`, pura e testada) esconde CPF, CNPJ, CRM, RG, telefone, e-mail, CEP e todo número de
11 ou 14 dígitos sem máscara antes do envio. ⚠️ **Corrigir só as duas montagens de contexto seria
repetir o erro da ADR-140**: a chamada de amanhã nasceria descoberta.

**⚠️ O par redigir/restaurar, e por que apagar estaria errado.** "Melhorar com IA" devolve o corpo
do documento. Apagar o dado faria um contrato voltar com `[removido]` no lugar do CNPJ, a Thaís
aprovaria, e o papel sairia mutilado — um problema trocado por outro. Então cada dado vira uma
etiqueta `[[CPF-1]]` na ida e **volta ao original na resposta**. O terceiro nunca vê o dado; o
rascunho continua inteiro.

**⚠️ Segunda camada, porque expressão regular só pega o que tem FORMA.** Texto corrido — "o filho do
Dr. João" — nenhum filtro pega. Por isso `observacoes` saiu do contexto **na origem**, nas duas
montagens: é campo livre e não é necessário para o resumo funcionar.

**O que continua saindo, de propósito:** o **nome** do cliente. Sem ele o resumo não serve para
nada. Trocá-lo por identificador segue registrado como decisão jurídica em aberto.

### 2. Retenção, eliminação e a página que não existia

**A eliminação virou anonimização.** `excluirDefinitivoCliente` bloqueia diante de **qualquer**
vínculo, e todo cliente real tem vários: na prática nenhum era eliminável, e a app não tinha
resposta nenhuma para um pedido do titular. Anonimizar é a saída que a lei aceita quando existe
dever de guarda. Sai nome, CNPJ, e-mail, telefone e observações da ficha, dos contatos e dos
médicos; o acesso ao Portal cai e as sessões em voo morrem.

⚠️ **O que FICA, de propósito:** o corpo dos contratos e propostas já emitidos, com o nome dentro.
É o próprio dever de guarda que justifica manter, e reescrever contrato assinado destruiria a prova
— pior para os dois lados. **A confirmação na tela diz isso**, senão pareceria defeito.

⚠️ **Exige o cliente ARQUIVADO.** Anonimizar quem está em contrato apagaria o CRM do médico no meio
de um credenciamento em andamento.

⚠️ **A tela mora no painel do ROOT, não na ficha**, e isso não é escolha estética: toda tela de
cliente filtra `deletedAt: null`, então depois de arquivado o cliente some da aplicação inteira. Sem
a aba *Privacidade* em SISTEMA, o direito existiria só no servidor, sem ninguém conseguir exercê-lo.

**O expurgo tem ROTINA.** `EmailEnviado` guardava o corpo completo para sempre e `ErrorLog` a pilha
inteira, que carrega o que a pessoa digitou. Agora o corpo é apagado depois do prazo, todo dia, por
`setInterval` no boot — mesmo molde da varredura de anexos temporários, já que a hospedagem não tem
cron. ⚠️ **O metadado fica** (para quem, assunto, quando, entregue ou não): é dele que vive o monitor
que provou, em 22/08, que o e-mail voltou a sair. ⚠️ **Um botão que alguém pode esquecer de apertar
não é política de retenção** — daí a rotina automática, com o botão só como atalho.

**Prazos, decididos e editáveis:** corpo de e-mail **180 dias**; acervo de credenciamento **5 anos**
após o fim do contrato, e aí o sistema **avisa**, nunca apaga — apagar sozinho o diploma de um médico
é pior que guardar demais. Os dois moram em *Ajustes → Dados da empresa*: prazo é decisão de negócio,
e mudá-lo não pode exigir publicação.

**A página `/privacidade` nasceu**, pública. Lê razão social, CNPJ, endereço, prazos e encarregado
**do banco** — mesma regra do `[A PREENCHER]` do foro: o sistema não fabrica dado jurídico. O que ela
promete é exatamente o que o expurgo cumpre. Declara também o envio à OpenAI e a peneira do item 1,
fechando uma pendência que o `IA_PRIVACIDADE.md` listava havia meses.

**Consentimento com data E VERSÃO.** A data sozinha não prova nada: o texto muda, e a prova é a data
mais o que estava escrito naquele dia. ⚠️ **Quem editar a página precisa subir
`AVISO_PRIVACIDADE_VERSAO`** — por isso a constante mora no `@app/shared`, ao lado da regra, e não
escondida dentro do componente.

### 3. O link de proposta e de assinatura passou a expirar

`Assinatura.token` e `Documento.propostaToken` são texto claro no banco e não expiravam nunca. Um
link de um ano atrás, na caixa de um ex-sócio, abria o documento **inteiro** sem login — e ainda
assinava. Um backup do banco entregava poder de **assinar**, não só de ler.

**ZERO MIGRAÇÃO:** a validade é derivada de datas que já existem (`Assinatura.criadoEm`,
`Documento.propostaSolicitadaEm`). **30 dias** para abrir; depois de respondido, mais **90** contados
da resposta, só para o signatário reler o que assinou. Pedir assinatura de novo apaga e recria as
linhas, então reenviar o convite realmente renova o prazo.

⚠️ **A trava está nas QUATRO portas.** Barrar `getPorToken` e deixar `assinar`/`responder` abertos
seria literalmente a segunda porta da ADR-140. Há teste que conta as ocorrências nos dois serviços e
reprova quem tirar uma.

⚠️ **`PRECONDITION_FAILED`, não erro cru:** link vencido é estado esperado, e `new Error` vira
INTERNAL no tRPC e enche o painel do ROOT de ruído (lição da ADR-135).

⚠️ **Na tela são TRÊS frases, não duas:** falha de rede ("seu link continua valendo"), **expirado**
(tela própria, com a data e o e-mail da equipe) e inválido ("confira se copiou o endereço inteiro").
Dizer "link inválido" a quem tem o link certo, só velho, o faz achar que foi enganado — e a saída
dele é outra. O título "Link inválido" ficou intacto porque há e2e que o exige
(`flows-erros-ux.spec.ts:45`).

**Cada abertura por token passa a ficar registrada** no `activityLog`. Antes ninguém sabia quem
tinha aberto o documento.

### 4. Credenciamento reaberto cobra de novo — decisão do dono: SIM

O honorário nasce na aprovação (ADR-104) e a tentativa nova não herda `contaId`, então o ciclo
aprovado → encerrado → reaberto → aprovado gera uma **segunda** conta pelo mesmo par médico ×
operadora. **Está certo:** a proposta real cobra "somente no sucesso" e "após 1 (uma) tentativa", e
tentativa nova é trabalho novo. **O que faltava era avisar** — faixa âmbar antes do clique, com o
valor à vista, e **só quando a tentativa anterior realmente cobrou** (`contaId`): uma tentativa
negada nunca gerou conta, e alarmar ali seria ruído. A decisão ficou escrita no serviço, no ponto
exato onde alguém tentaria "consertar" herdando a conta — e daria de graça o segundo credenciamento.

### Prova

typecheck 6/6 · lint limpo · **553 testes de unidade** do `@app/api` (**32 novos, todos vistos
reprovando antes**) · 171 do `@app/web` · migração `20260828220208` **aditiva** (quatro colunas
nuláveis, duas com padrão, uma FK `SET NULL`; reverter é `DROP COLUMN`).

### O que ficou fora, e por quê

- **DPA com a OpenAI** continua pendência jurídica — mas o risco caiu, porque o dado identificável
  já não sai daqui.
- **`Servico.ehCredenciamento`, `@@unique(nome)` em `Servico` e o consentimento da assinatura** pedem
  migração própria e não entraram neste lote.
- **M1, C10, M15, F8, F9** (dinheiro) e **C1, C2, M6, M8** (trabalho invisível) seguem abertos: são
  regra de negócio, não conformidade legal.

---

## ADR-142 — Dois números que se contradiziam e um rótulo que mentia, na mesma página

**Data:** 28/08/2026 · **Contexto:** conferência da v1.3.0 em produção, antes do dado real.

### O problema

Na página **Clientes** de produção apareciam, lado a lado, **"Total de clientes 0"** e
**"Com Portal ativo 1"**. Dois números que não podem ser verdade juntos — e que, para quem bate o
olho, se leem como sistema quebrado.

A contagem não estava errada: ela contava **outro universo**. `total`, `ativos` e `inativos`
respeitam a ADR-24 e **excluem o PROSPECT** (que vive no Funil, não aqui); `portaisAtivos` contava
**toda** conta de Portal, inclusive a do prospect, criada pelo acesso ao Portal do prospect
(ADR-128). O comentário da própria função já prometia *"só ativos/inativos"* — quem não obedecia
era o quarto indicador.

⚠️ **A correção certa era estreitar a contagem, não trocar o rótulo.** Renomear para "Portais
ativos (inclui prospects)" resolveria a contradição no texto e deixaria a página com um indicador
que fala de um conjunto que ela não lista — o leitor procuraria na tabela abaixo o cliente que o
número promete e não acharia.

### O rótulo que mentia

No mesmo trabalho, achado ao investigar a pergunta do dono *"no lead tem NOME e CLÍNICA, no cliente
só tem NOME — é assim mesmo?"*. **É assim de propósito** e está certo: todo cliente da Med é pessoa
jurídica (ADR-119), então `Cliente.nome` **é o nome da clínica**, e as pessoas vivem em `Contato`
(a do lead vira contato principal na conversão). O Lead tem os dois campos porque no primeiro
contato se fala com uma pessoa antes de saber a empresa.

⚠️ **Mas o formulário não dizia isso.** O campo se chamava só **"Nome *"** e — pior — estava
declarado como `autoComplete="name"`, ou seja, **campo de nome de PESSOA**: o preenchimento
automático do Chrome oferecia ali o nome do próprio operador. Quem cadastra com pressa digita
"Dr. Carlos" e o cliente nasce com nome de gente, quebrando a premissa da ADR-119 em silêncio —
e é esse nome que sai impresso no contrato. Hoje: **"Nome da clínica *"**, com `autoComplete="organization"`,
exemplo no campo e a explicação no "?" apontando para os Contatos.

### Prova

typecheck 6/6 · lint limpo · **729 testes** do `@app/api` (**3 novos de integração, vistos
reprovando antes** — o primeiro falhou com `expected 1 to be +0`, que é exatamente o número da
tela de produção) · 171 do `@app/web` · na tela local, "Nome da clínica" com o exemplo e os quatro
indicadores coerentes, **zero erro de console**. **Zero migração.**

## ADR-143 — O refino da experiência inteira: 30 telas que funcionam no celular, e a régua que mede isso sem mentir

**Data:** 29/08/2026 · **Contexto:** ordem do dono — *"refinar as 30 telas até dar gosto de usar,
responsivo de verdade a 360px, com conteúdo que faça sentido para uma consultoria médica, tudo
testado — Portal incluído"*. Esteira em `docs/esteira/refino-experiencia-2026-08-29/`.

### A caixa de peças veio antes das telas

`packages/ui` exportava **só `cn`**. Não havia aba, painel lateral, balão, sanfona nem tabela que
soubesse virar cartão no celular — então cada tela que precisasse de uma inventava a sua, e o
refino não se sustentaria por duas semanas. Nasceram `tabs`, `sheet`, `popover`, `accordion`,
`dialog-stack` e `data-table` (acima de `md` tabela, abaixo cartões, alvo de toque de 44px), mais a
prop `hint` em `PageHeader`, `Modal` e `CardTitle`. ⚠️ **Tudo à mão, nenhuma biblioteca nova** — o
custo de uma dependência a mais no artefato publicado é permanente, e estas seis peças somam menos
de 400 linhas.

### A causa raiz do vazamento era uma linha do esqueleto

Vinte telas empurravam a janela para os lados, e a causa não estava em nenhuma delas: era o
`<main>` do `AppLayout` **sem `min-w-0`** — o `min-width: auto` do Flexbox, que faz um item nunca
encolher abaixo do conteúdo dele. O mesmo modo de falha reapareceu duas vezes mais alto: em **grid**,
a trilha `1fr` é `minmax(auto, 1fr)`, e esse `auto` é o **min-content do cartão**; sem `min-w-0` no
cartão, um único chip que não encolhe alarga a coluna inteira. Foi o que sobrou em `/clientes` e
`/modelos` a 360px, depois de tudo o mais estar resolvido.

⚠️ **Para quadro (Kanban), `min-w-0` não basta:** o funil e o quadro de projetos usam
`grid-cols-[minmax(0,1fr)]` no lugar de `flex`, com a fileira de colunas rolando dentro de si
(`overflow-x-auto`). Foram 385px de excesso no funil a 1366px — num notebook comum.

### ⚠️ A régua não pode se enganar sozinha (e se enganou)

A medição é `e2e/responsividade-total.spec.ts`: 30 rotas × 5 tamanhos, conferindo overflow do
documento, elemento estourando, erro de console, alvo de toque e texto cortado.

Ela reprovava a barra de abas e a tabela larga, que rolam na horizontal **de propósito**. A primeira
correção foi ignorar todo elemento com ancestral cujo `overflow-x` calculado fosse `auto`/`scroll` —
e **isso cegou o teste**: o CSS transforma `visible` em `auto` no eixo oposto assim que um dos dois
deixa de ser visível, então **toda lista com `overflow-y-auto` passa a parecer que rola na
horizontal**. Medido: com essa regra, os cartões de `/clientes` estourando 36px e os de `/modelos`
estourando 105px passavam como aprovados.

A regra que ficou é uma **marca explícita no código**: `data-rolagem-horizontal`, posta nos quatro
lugares onde a rolagem lateral é desenho (`Table`, `TabsList`, e as duas fileiras de Kanban). Estilo
calculado não distingue intenção; atributo distingue — e ainda deixa escrito, ali, por que aquilo
rola. Sem isso, a saída fácil seria "consertar" tirando a rolagem, que é justamente a solução.

⚠️ **O `412 Precondition Failed` do `/email` também é comportamento certo**, não erro: é o crachá que
a ADR-135 deu ao estado esperado *"esta caixa precisa ser reconectada"*, que a tela já trata com o
botão **Reconectar**. O navegador registra qualquer resposta fora do 2xx como erro de recurso; a
verificação de console passou a dispensar **só** esse status, com o porquê escrito ao lado.

### O que mais entrou nesta esteira

- **Cada passo do funil diz de quem está esperando** — enum `QuemFaz` (MED/CLIENTE) em
  `ServicoPasso` e `LeadPasso` (migração `20260829014839`, duas colunas com padrão; reverter é
  `DROP COLUMN`), com selo âmbar *"com a clínica"* no painel do lead.
- **Cinco defeitos de cobrança** (M1, C10, M15, F8, F9) e **cancelar serviço encerra a mensalidade**
  — ⚠️ são **dois movimentos**: `recorrenciaAte = hoje` na série inteira (senão a varredura da
  madrugada cria a próxima) **mais** o soft-delete só das parcelas futuras em aberto. **O que já
  venceu fica de pé** — o serviço foi prestado naquele mês.
- **Cinco avisos que nunca chegavam** (C1, C2, M6, M8, C8).
- **`pnpm db:limpar` deixava NOVE tabelas para trás**, entre elas `Profissional`, `Credenciamento` e
  **`CaixaEmail`, que guarda a senha IMAP cifrada de cada pessoa**. ⚠️ **A cascata do banco não salva
  aqui**: o script desliga as chaves estrangeiras durante a limpeza, então **tabela ausente da lista
  é tabela que sobrevive**.
- **A carteira de demonstração nasce pelos fluxos reais** (`pnpm db:demo:rica`), não por linhas
  soltas — inclusive com três credenciamentos datados para trás, para o alerta âmbar da tela de
  Credenciamentos acender na demonstração.

### ⚠️ O que só a CI mostrou — e por que ela viu o que eu não via

O `e2e` desta branch rodou pela **primeira vez** ao abrir o PR (`push` na `main` roda só o
`build-test`, por causa da cota de Actions — ADR-121). Reprovou 17 vezes, de duas naturezas.

**Três defeitos reais, invisíveis no banco de demonstração**, porque lá as telas nasciam vazias:
os avisos do Início a 360px (`min-w-0` de novo, +21px); o `<select>` de `/emails-enviados` —
⚠️ **`w-auto` num `<select>` é a largura da OPÇÃO MAIS LONGA**, e as opções são nomes de aviso
("Conflito de horário na agenda"), o que empurrava a janela em **84px**; e o nome do arquivo no
Portal, que é um **link de download de 20px de altura**, abaixo da régua de toque.

**Oito testes velhos, e nenhum era defeito da aplicação.** Os botões de ação trocaram um `title`
genérico por **nome acessível** (*"Editar conta X"*, *"Remover cartão"*) e as seções viraram
**abas de verdade** (`role="tab"`). Um teste que procura *botão* chamado "Para vender" não acha
uma *aba*; e `name: /Lead X/` passou a casar três botões, porque o nome do lead agora está dentro
do rótulo de "Editar" e "Remover". ⚠️ **A marcação melhorou; o teste é que ficou para trás** — os
seletores foram apontados para os nomes novos, nenhum foi afrouxado.

⚠️ **`DataTable` ganhou `data-linha` nas DUAS formas** (tabela acima de `md`, cartão abaixo), e o
teste usa `[data-linha]:visible`. Sem essa marca, um teste que procura `role="row"` acha a tabela e
não acha nada no celular — e a diferença entre *"não existe"* e *"virou cartão"* é o que faz alguém
desfazer a versão de celular achando que quebrou.

**E a régua errou uma terceira vez, pelo lado oposto:** texto cortado com reticências (`truncate`)
é desenho, mas os pedaços de texto **dentro** dele continuam medindo a largura inteira —
`getBoundingClientRect` ignora o recorte. A isenção é a combinação exata do `truncate`
(`text-overflow: ellipsis` + `overflow-x: hidden`). ⚠️ Não vale afrouxar para *"qualquer ancestral
com overflow hidden"*: aí o teste pararia de ver conteúdo genuinamente cortado fora da tela.

### Prova

typecheck 6/6 · lint limpo · **213 testes** do `@app/web` · **785** do `@app/api` (suíte inteira,
93 arquivos) · a medição de responsividade **verde nos 5 tamanhos, nas 30 rotas, área interna e
Portal** — o mesmo arquivo que reprovava os cinco tamanhos no começo da rodada — e a **suíte `e2e`
completa** no runner isolado, em três lotes: **45 + 26 + 48 = 119 verdes, zero reprovação**.

---

## ADR-144 — A marca do credenciamento: matar o "casa por nome" e as portas que ele abriu

**Data:** 29/08/2026 · **Situação:** aceita · **Branch:** `fix/divida-tecnica-e-avisos`

### O problema

`ehServicoDeCredenciamento` respondia "este serviço é o credenciamento?" comparando o **nome**
com uma constante. Três decisões de dinheiro dependiam da resposta (ADR-104/108): manter o
credenciamento fora da estimativa do funil, fora do provisionamento da conversão do lead, e
deixar o honorário nascer só quando a operadora aprova.

Consequência: **corrigir um typo em Ajustes → Serviços religava a cobrança antecipada.** A
conversão do lead passava a gerar uma conta a receber, e a aprovação da operadora gerava a
segunda pelo mesmo honorário. Cliente cobrado duas vezes, sem aviso. A ADR-140 registrou o
arranjo como **remendo assumido** — uma trava que proibia renomear — e apontou a cura:
`Servico.ehCredenciamento`.

### A decisão

A marca é um campo do banco (migração `20260829203721`, aditiva, backfill na mesma transação;
reverter é `DROP COLUMN`), e o nome voltou a ser rótulo. A trava de renomear saiu junto.

**A assinatura da função pura passou a EXIGIR o campo** (`{ ehCredenciamento: boolean }`, não
`string`). Isso não é preciosismo de tipo: é o que faz o **compilador cobrar o `select`** de
quem escrever a próxima consulta. Esquecer de selecionar devolveria `false` calado — e `false`
é o lado que cobra duas vezes. Foram nove consultas que o `tsc` apontou; nenhuma teria sido
encontrada por leitura.

Os dois lados da porta estão travados por teste, vistos reprovando antes: **nome mudado não
desliga a regra, nome copiado não a liga.**

### O que a revisão pegou, e que é a parte que vale ler

Nenhum dos três achados existia antes desta mudança — os três **foram criados por ela**:

1. **Liberar o renomear sem olhar a semeadura.** `semearCatalogoSeFaltar` procura o catálogo
   canônico por nome. Renomeado o serviço, a leitura seguinte criaria um **segundo** serviço
   marcado: clone no catálogo, os 14 requisitos sincronizados no serviço errado, e o Portal do
   cliente que contratou o original voltando a dizer "0/0". A semeadura passou a reconhecer o
   credenciamento pela marca, e os `findFirst` ganharam `orderBy` — sem ele, com dois marcados,
   a escolha era arbitrária.

2. **O backfill podia não casar nada em produção, e isso não produz erro nenhum.** Nome com
   typo, caixa diferente, espaço não-ASCII colado de um documento, ou um renomear feito antes
   de a trava da ADR-140 existir — qualquer um zera o `UPDATE`, e aí a regra volta ao lado que
   cobra duas vezes. Sem log, sem tela, sem sintoma no dinheiro. Daí a migração
   `20260829210500`: **se existe serviço parecido com credenciamento e nenhum ficou marcado, a
   publicação para ali.** Provada nos três cenários antes de entrar — barra o perigoso (erro
   3819), deixa passar o banco normal e o banco novo (a CI cria o catálogo sob demanda, então
   não há o que casar no momento da migração).

3. **A correção M20 abriu um oráculo de e-mail.** Dizer "também enviamos o acesso ao seu
   Portal" só quando o e-mail era inédito fazia a página **pública** responder se um endereço
   já é conhecido pelo sistema: um envio por alvo bastava para saber se aquele médico é cliente
   da Med. A resposta de rota pública **não pode variar com o que existe no banco**.

**A lição que fica:** liberar o que uma trava proibia exige varrer quem mais dependia daquela
proibição. A trava de renomear não protegia só a cobrança — protegia a semeadura também, sem
que ninguém tivesse escrito isso em lugar nenhum.

### A marca tem tela, e só pode haver uma

Sem escritor na aplicação, uma marca errada só teria conserto por `UPDATE` no banco de
produção. Hoje é uma caixa em Serviços, com a consequência escrita ao lado; o servidor
**recusa marcar um segundo**, dizendo qual já está marcado, em vez de desmarcar o primeiro em
silêncio — trocar qual serviço rege a cobrança é decisão de negócio, não efeito colateral de
salvar um formulário. Desmarcar continua permitido: é como se corrige uma marca errada.

### Os doze defeitos que vieram no mesmo lote

Todos verificados no código antes de tocar em qualquer linha — boa parte da lista herdada das
auditorias já estava fechada, e a documentação é que estava velha.

- **M18** — o e-mail disparado quando a última assinatura entrava dizia *"aguardando sua
  revisão"* sobre um documento recém-concluído. Nasceu `documento_assinado`. ⚠️ Tipo novo sem
  entrada em `EMAIL_CATEGORIAS` é filtrado por `decidirEmailOperacional` e **nunca sai**.
- **M11** — convidar alguém cujo e-mail é de outra clínica respondia "já tinha acesso" e o
  convite não saía. A recusa continua (um e-mail não abre duas clínicas); o motivo é que passou
  a chegar. ⚠️ Separar esse caso de `jaTinhaAcesso` fez a conversão do lead parar de mandar as
  boas-vindas — foram devolvidas, e o acesso não criado agora fica no histórico.
- **M10** — cliente que desistia pelo Portal e voltava ganhava um segundo card no funil.
- **M13** — desativar um médico **inflava** o progresso da papelada: o denominador contava só
  ativos e o numerador contava os arquivos de todos.
- **M17** — a exigência do título de especialista existia e a triagem nunca a lia. ⚠️ O
  comprovante vale **por médico**; a régua genérica faria o diploma de um provar o título de outro.
- **F13** — valor percentual sem "/mês" no card do lead. Misto não leva sufixo: seria enganoso
  do mesmo jeito.
- **F20** — o Portal não mostrava ao cliente quanto ele paga.
- **F21** — o catálogo público devolvia preço de tabela a visitante anônimo.
- **B2** — conta criada por automação nascia sem categoria, e o relatório por categoria
  sub-contava a receita que o sistema gera sozinho. São **quatro** portas; todas passam agora
  pela mesma função.
- **B3** — `utm_term`, `utm_content` e a página de entrada eram aceitos e descartados. Vão para
  `Lead.rastreio`, sem coluna nova.
- **M20** — a página pública não falava do acesso ao Portal (ver o oráculo, acima).
- **`createCliente`** avisava só o e-mail duplicado, quando o motivo mais provável de o convite
  não sair é o servidor de e-mail fora do ar — que não lança exceção e já ficou meses assim em
  produção (ADR-122).

### O que NÃO entrou, e por quê

- **`@@unique(nome)` em `Servico`** — a criação do índice **falha** se produção tiver nome
  duplicado, e não consegui conferir isso: a extensão do navegador não abriu a aplicação de
  produção nesta sessão. Fica para depois da conferência.
- **Consentimento da assinatura** (LGPD) — pede migração própria e uma decisão sobre o texto do
  termo, que é do dono.
- **DPA com a OpenAI** e o **endereço da empresa** continuam pendências do dono.

### Provas

typecheck 6/6 · lint limpo · **814 testes** do `@app/api` (eram 785; suíte inteira, não
`test:unit`) · **220** do `@app/web` (eram 213) · cada correção com o teste visto reprovando
antes, e a migração-guarda provada nos três cenários.

## ADR-145 — Só o faturamento médico é percentual: a marca que decide quem pode, e o fim do cartão no recibo

**Data:** 31/08/2026 · **Origem:** o dono, olhando *Ajustes → Serviços → Credenciamento → Configurar*:
*"está mostrando PORCENTAGEM e somente o serviço de FATURAMENTO nós recebemos apenas a porcentagem.
O restante dos serviços são 100% valor fixo (pode ser pagamento avulso ou mensal)"* — e, junto:
*"não aceitamos cartão (aceitamos somente PIX e essa informação já está nas propostas)"*.

### O problema, e por que ele não dá erro

O preço gravado do credenciamento estava **certo** (R$ 1.500,00 fixo). O que estava errado é que a
tela **oferecia** o botão *"% do faturamento"* — e oferecia nos **dez** serviços do catálogo, mais
uma vez em cada ficha de cliente. Trocar a forma de cobrança de um serviço por engano **não produz
erro nenhum**: muda o preço que sai no papel do cliente, muda a conta a receber, muda a estimativa
do funil, e os três em silêncio.

O credenciamento é o caso mais caro de errar, porque ele é o único serviço **cobrado só no
sucesso**: a Med faz o processo inteiro na operadora sem cobrar nada, e o honorário — valor fixo —
só nasce quando a operadora aprova (ADR-104/108). Um credenciamento marcado como percentual seria
uma cobrança mensal sobre faturamento por um serviço que pode nunca ser aprovado.

### A decisão: uma MARCA, `Servico.ehFaturamento`

O conserto óbvio seria `categoria === "Faturamento"`. Essa comparação já foi escrita e removida
**cinco vezes** neste código (ADR-125/126/127/137/138), e a rodada anterior — a ADR-144, de ontem —
existiu justamente para matar o "casa por nome" no credenciamento. Repeti-la aqui seria reintroduzir
o defeito recém-pago: bastaria a Thaís corrigir um acento em Ajustes para o dinheiro mudar de regra.

Então é o **mesmo molde da ADR-144**: uma coluna `Servico.ehFaturamento`, com caixinha na tela, que
responde *"quem PODE ser cobrado por percentual?"*. Migração `20260901010000`, **aditiva**, com o
backfill na mesma transação; reverter é `DROP COLUMN`.

⚠️ **O backfill NÃO casa por nome — casa por PREÇO.** Marca quem hoje já é cobrado exclusivamente
por percentual (`percentual > 0 AND (valor IS NULL OR valor = 0)`), que é a mesma pergunta que
`ehServicoSomentePercentual` faz na aplicação. Assim a marca nasce descrevendo a realidade do banco,
e não uma suposição sobre como o serviço se chama — que é exatamente o erro que a coluna existe para
não repetir.

### ⚠️ Duas perguntas diferentes que não podem virar uma

- **`ehServicoDeFaturamento(servico)`** — *quem PODE ser percentual*. Identidade, vem do banco.
- **`ehServicoSomentePercentual(preço)`** — *como ESTA linha está sendo cobrada*. Vem do registro,
  e **não mudou uma linha**.

Misturá-las faria a linha de uma proposta antiga trocar de forma sozinha no dia em que alguém
desmarcasse o serviço. A separação está travada por teste.

### As portas travadas, e por que são quatro

A régua é uma função pura (`percentualForaDoFaturamento`, em `@app/shared`), lida por:

1. **O Zod da criação** — o pedido traz tudo, então o schema já basta.
2. **O servidor, na criação** — segunda camada, para quem chama a API direto.
3. **O servidor, na edição** — ⚠️ e aqui o Zod **não serve**: a edição é parcial, e um pedido com
   só `percentual` não diz se o serviço é o faturamento. A conferência é sobre o **ANTES + o
   DEPOIS**, mesma forma da trava de `temValorEPercentual` (ADR-138).
4. **⚠️ A ficha do cliente** (`atualizarContratacaoCliente`) — a **segunda porta** (ADR-140).
   Travar só o catálogo deixaria a ficha fazer, cliente por cliente, exatamente o que a tela de
   Serviços passou a recusar.

E duas guardas de estado: **só um serviço marcado** (dois marcados = dois serviços percentuais no
catálogo, que é o estado que a ordem proíbe) e **nunca faturamento + credenciamento no mesmo
serviço** (um é percentual todo mês, o outro é fixo pago só no sucesso — não há lado certo para
errar). ⚠️ **Desmarcar sem limpar o percentual é recusado**, senão o dado ficaria preso: a tela o
mostraria como valor fixo e o servidor recusaria editá-lo.

### 🕳️ O defeito de brinde: o item do documento não tinha trava nenhuma

A ADR-138 pôs o `refine` de "valor E percentual juntos" nos três schemas de **preço** e deixou de
fora justamente o `documentoServicoItemSchema` — o que grava a linha da proposta/contrato que vai
ao cliente e que o **aceite copia** para `ClienteServico`. Um item com os dois imprimiria
"R$ 3.500,00/mês" e "5% do faturamento" na mesma linha, e faria `ehServicoSomentePercentual` virar
`false` na contratação: o serviço percentual passaria a ser cobrado por valor fixo, sem erro nenhum.
Fechado nesta rodada.

### O cartão: a última tela que contradizia o PIX

A ADR-127 tirou "Condições de pagamento" das propostas com a razão de que **não há o que negociar —
é sempre PIX**. Sobrou uma tela: o **Recibo** oferecia um seletor com *PIX, Dinheiro, Cartão de
crédito, Cartão de débito, Transferência e Boleto*, e a opção escolhida saía **impressa no papel
timbrado entregue ao cliente**, dizendo que a Med aceita forma de pagamento que ela não aceita.

Virou constante (`FORMA_PAGAMENTO_RECIBO = "PIX"`), e **não um `<Select>` de um item só**: escolha
que não existe não é campo de formulário, é informação. Voltar a ter opções significa a empresa
passar a aceitar outra forma — decisão do dono, não de quem preenche o recibo.

E o **contrato** ganhou o que lhe faltava: a seção *"4. Valor e forma de pagamento"* prometia a
forma no título e não dizia nenhuma. Agora diz *"Os pagamentos serão realizados exclusivamente por
**PIX**"* e traz o bloco bancário, como as propostas. ⚠️ **A frase é autossuficiente de propósito**
— ela não diz "nos dados abaixo", porque o bloco some inteiro quando Ajustes está em branco
(`montarDadosPagamento`), e frase que aponta para um bloco inexistente é o papel do cliente saindo
com "veja abaixo" sem nada abaixo. ⚠️ O modelo é **semente atualizável**: `listModelos` reescreve os
modelos que ninguém editou à mão, então a mudança chega a produção sozinha.

**Fica como está, de propósito:** a categoria *"Cartão de crédito"* do Financeiro — é **despesa**,
dinheiro que a Med paga, e não tem relação com o que o cliente pode usar para pagar a Med.

### 🕳️ O que a REVISÃO pegou — e os três achados vieram da própria correção

Três revisores especialistas rodaram sobre o commit; dois deles acharam **independentemente** os
dois primeiros itens, o que é o sinal de que não eram estilo.

1. **O editor de preço da ficha apagava dinheiro contratado, em silêncio** — e a regressão nasceu
   deste lote. A migração marca o **catálogo**; ela nunca olha o que cada cliente já contratou.
   Existindo `ClienteServico.percentual > 0` num serviço sem a marca (gravável até ontem), abrir o
   modal só para **conferir** e clicar em Salvar mandava `percentual: null` — e o servidor aceita,
   porque **remover** percentual não viola trava nenhuma. O cliente ficava sem preço, sem aviso.
   Hoje há faixa âmbar dizendo o que está gravado, e **o Salvar só libera depois de informar o
   valor fixo que entra no lugar**.
2. **A TERCEIRA PORTA: o aceite da proposta.** `sincronizarServicosContratados` copia o item do
   documento para `ClienteServico` sem passar por trava nenhuma — travar o catálogo e o editor da
   ficha e deixar esta aberta é o modo de falha da ADR-140 mais uma vez, e por aqui o preço errado
   entra vindo do papel que o cliente assinou. ⚠️ **Recusa, e não "descarta o percentual em
   silêncio"**: descartar deixaria a proposta ser aceita cobrando outro preço que não o do papel.
3. **O contrato gerado pelo painel do lead sairia com "(a preencher)".** `gerarParaLead` monta o
   corpo por um mapa de variáveis, e `render` troca marcador desconhecido por *(a preencher)* — o
   contrato nasce por **duas portas**, e só uma resolvia o `{{dadosPagamento}}` novo. Exatamente o
   "veja abaixo com nada abaixo" que esta ADR dizia querer evitar.

Mais: **o formulário de serviço recusava sem mostrar mensagem** (as duas travas apontam o erro para
`percentual`, que é justamente o campo escondido no estado que elas reprovam — Salvar ficava inerte
e ninguém descobria por quê); o botão *"% do faturamento"* **não acendia** em serviço sem percentual
(`temPercentual` exige `> 0`); o construtor da proposta de faturamento filtrava por **preço** e
abriria vazio no dia em que o percentual ficasse "a combinar"; e o rótulo fixo do recibo era um
`<label>` **órfão**, sem campo a que se associar.

### ⚖️ Onde discordei do revisor, e por quê

Um revisor pediu que a **unicidade da marca** fosse conferida a **todo salvamento**, e não só na
transição desmarcado→marcado — o argumento sendo que dois marcados virariam estado permanente e
mudo. A preocupação é certa; a cura é pior que a doença: com dois marcados, os **dois** ficariam
impossíveis de salvar pela tela, **inclusive para desmarcar um deles**, e a Thaís ficaria trancada
do lado de fora de um conserto que só sairia por SQL no banco de produção.

Quem impede o estado de existir é a **migração `20260901010500`**, que **PARA a publicação** se o
backfill não deixar **exatamente um** marcado (molde da `20260829210500`, da ADR-144). Acontece
antes, uma vez, e no único caminho pelo qual o estado poderia nascer de verdade.

### Provas

typecheck 6/6 · lint limpo · **604 testes de unidade** e **11 de integração novos**, contra o MySQL de
verdade, **vistos reprovando antes**: com a trava desligada, 4 dos 9 reprovam. Na tela, como ROOT:
Credenciamento dizendo *"Cobrado por valor fixo — avulso (1x) ou mensal"* sem botão de percentual;
Faturamento com a marca e o interruptor; a ficha do cliente idem; o Recibo com *"Forma de pagamento:
PIX"* fixo; e o contrato com a frase do PIX. **Zero erro de console.**

---

## ADR-146 — A subida de uma dependencia mudou, em silencio, de onde vem o `req.ip` ✅

**Contexto.** Tres PRs do Renovate estavam abertos desde 25–31/08 (`#124` vitest 3 por seguranca, `#157`
ferramentas de desenvolvimento, `#158` atualizacoes menores). O `#158` reprovava a CI com quatro erros de
tipo em `apps/api/src/server.ts`, todos parecendo o mesmo aborrecimento de tipagem do Fastify. Nao era.

O `#158` sobe o **Fastify 5.9.0 → 5.12.1**, e a 5.12 **aposentou o formato numerico do `trustProxy`**.
Nos usavamos `trustProxy: 1` desde a ADR-140, que o pos no lugar de `true` justamente por seguranca.
O erro de tipo (`Type 'number' is not assignable…`) e so a ponta: quando a sobrecarga falha, o TypeScript
cai na ultima (`Http2SecureServer`) e envenena o tipo do `app` — dai os outros tres erros, que somem
sozinhos quando o primeiro e resolvido.

**⚠️ O perigo nao era o erro de tipo, era o conserto obvio dele.** Calar o compilador mantendo o `1`
compila e sobe — e muda o comportamento. Esta escrito no codigo do Fastify 5.12:

> *Hop-count-only trust cannot validate the immediate peer. Fail closed so direct clients cannot spoof
> X-Forwarded-\* values by supplying enough hops.*

Ou seja: `trustProxy: <numero>` passou a **nao confiar em ninguem**. Atras do LiteSpeed, o `X-Forwarded-For`
seria descartado e **todo visitante viraria o mesmo IP** (o da propria maquina). O `req.ip` e a chave dos
**tres freios da casa** — 300 requisicoes/min, 8 tentativas de senha por conta, e o freio do formulario
publico de leads — e e a **prova gravada** em `Assinatura.ip` e `Documento.propostaRespIp`. Um visitante
sozinho passaria a trancar o site para todos os outros, e a assinatura de contrato gravaria o IP do servidor.
**Nada disso da erro, log ou sintoma** — e o mesmo modo de falha da ADR-144: o estado errado e silencioso.

**Opcoes.**

1. *Deixar o `#158` de lado e ficar no Fastify 5.9.* Adia sem resolver: o proximo PR do robo reprova igual,
   e a equipe aprende a ignorar CI vermelha de dependencia — que e como uma falha real passa despercebida.
2. *Trocar por `true`.* Recusada com todas as letras. E exatamente o que a ADR-140 corrigiu: `true` confia
   na cadeia inteira, e quem escreve a entrada mais a esquerda do cabecalho e o proprio visitante.
3. *Uma funcao `(_addr, hop) => hop === 0`.* Reproduz o `1` letra por letra — inclusive o buraco que o
   Fastify fechou de proposito. Seria contornar a correcao de seguranca de terceiro para preservar o defeito.
4. **Descrever QUEM e o proxy, em vez de contar quantos sao.** Escolhida.

**Decisao.** Nasceu `apps/api/src/lib/proxy-confiavel.ts`, com a regua `PROXY_CONFIAVEL =
["loopback", "uniquelocal"]` e o porque inteiro escrito ao lado:

- `loopback` (127.0.0.0/8, ::1) e a topologia real da TineHost — o LiteSpeed roda na **mesma maquina** que
  o Node (o mesmo motivo pelo qual `SMTP_HOST=localhost` funciona la, ADR-122). E tambem o caso do
  desenvolvimento local.
- `uniquelocal` cobre rede privada, para o dia em que a hospedagem mudar de forma.

**⚠️ Isto e ESTRITAMENTE MAIS SEGURO que o antigo `1`.** O `1` confiava em quem quer que estivesse do outro
lado da conexao, **inclusive um cliente publico direto**; a regua nova recusa confiar em endereco publico,
entao cabecalho forjado por quem chega de fora e simplesmente ignorado.

**A regua ganhou teste, e ele exercita o Fastify de verdade** (`proxy-confiavel.test.ts`, 6 casos) — nao uma
reimplementacao da regra, porque o que mordeu foi justamente o Fastify mudar o significado do valor por
baixo. Um dos seis e a **prova da regressao**: com `trustProxy: 1` na versao atual, o IP do visitante real
e descartado. Se um dia esse teste passar a ver o visitante, o Fastify voltou atras e a regua pode ser revista.

**✅ CONFERIDO DEPOIS DE PUBLICAR — a regua funciona em producao.** A linha de base foi medida em
01/09/2026 com a v1.5.0 no ar (Fastify 5.9 + `trustProxy: 1`): `SISTEMA → Sessoes` mostrava **enderecos
publicos de gente**, `187.35.35.2` (o dono) e `153.67.105.122` (o Andre). Depois da v1.6.0 no ar, o dono
**saiu e entrou de novo**, e a linha mais nova da tabela ("Inicio: agora") veio com **`187.35.35.2` —
publico**. O `X-Forwarded-For` continua chegando e o visitante real continua sendo enxergado atras do
LiteSpeed: os tres freios da casa e a prova gravada em `Assinatura.ip` estao intactos.

**⚠️ A ARMADILHA DA CONFERENCIA, e ela se repete em qualquer prova sobre IP de sessao:** `Session` grava
o IP **no momento do LOGIN COM SENHA**. Abrir o navegador com a sessao ja aberta (o crachá vale 30 dias)
**nao cria linha nova** — na primeira conferencia a linha "mais nova" era de 4 dias antes, ANTERIOR a
publicacao, e nao provava nada. Exigir **SAIR e ENTRAR**, nunca so "abra o sistema".

**Junto no mesmo lote, porque um PR de dependencia ja dispara a suite inteira** (a cota de Actions foi o
motivo de os tres virarem um so — ADR-121): o `@vitest/coverage-v8` ficou preso na 2 enquanto o `vitest`
subiu para a 3 (o robo so bumpa o que ele mesmo abre), e **dois defeitos de tela** que a regua de
responsividade da ADR-143 pegou:

- **`/projetos` a 360px vazava 26px em TODOS os cartoes.** A grade nao declarava coluna no celular, e a
  trilha implicita `auto` e o **min-content do cartao mais largo**: medida no navegador, a coluna tinha
  **369,8px dentro de um recipiente de 324px**. E o mesmo `min-width:auto` que a ADR-143 matou em
  `/clientes` e `/modelos`; `/projetos` escapou porque **o banco da CI nao tem projeto nenhum**, e a tela
  nascia vazia. Cura: `grid-cols-[minmax(0,1fr)]` (a trilha do `md:`/`xl:` ja vinha certa do Tailwind).
- **O link "Fale com a gente pelo Suporte" tinha 31px de altura** onde a regua exige 44 — no celular era
  preciso mirar numa fita fina de texto no meio de um paragrafo. A pergunta ficou numa linha e o link virou
  linha propria.

**⚠️ A LICAO DOS DOIS: os dois so apareceram com BANCO CHEIO.** A CI semeia um banco novo, e tela que nasce
vazia nao desenha o bloco que quebra. Regua verde na CI **nao e** regua exercida.

**Consequencias.**

- Zero migracao. Reverter e `git revert` — nada foi convertido no banco.
- Provas: typecheck 6/6 · lint limpo · **839 testes do `@app/api`** (103 arquivos, suite completa) ·
  **220 do `@app/web`** · **109 de ponta a ponta, os 109 verdes** (reprovavam 3 antes das correcoes de tela)
  · `pnpm audit --prod` = *No known vulnerabilities found* · artefato de publicacao montado com sucesso.
- **Observacao, NAO regressao deste lote:** ao montar o artefato, o npm avisa que `sanitize-html@2.17.7` e
  `cookie@2.0.1` pedem **Node ≥ 22** e nos rodamos Node 20. Vem de faixa aberta (`^2.17.6`) resolvida na
  hora, entao **ja acontecia na `main`** — inclusive na publicacao da v1.5.0. E aviso, nao erro, e a v1.5.0
  esta no ar funcionando. Fica anotado para o dia de subir o Node.

---

## ADR-147 — O nome do serviço passa a identificar o serviço, e o banco não pensa como o JavaScript ✅

**Contexto.** `@@unique(nome)` em `Servico` estava na lista de pendências desde 31/08/2026, com um motivo
escrito: *"a criação do índice falha se produção tiver nome duplicado, e a lista de serviços de produção só
é visível pela página pública, que mostra nome mas não prova unicidade"*.

**Esse motivo era falso, e é o primeiro achado desta ADR.** A tela interna *Ajustes → Serviços* não usa a
rota pública: usa `servicos.list` → `listServicos()`, cujo próprio comentário diz *"Todos os serviços
(gestão) — **inclui inativos**"* e que **não filtra `ativo`**. Não existe serviço escondido. Lida em
produção como ROOT em 01/09: **10 serviços, 10 nomes todos diferentes**. A pendência estava travada por uma
ressalva que ninguém tinha ido conferir.

**Por que o nome precisa identificar.** A semeadura do catálogo casa por **NOME**
(`semearCatalogoSeFaltar`), e o construtor da proposta e a ficha do cliente listam dois serviços iguais
lado a lado **sem nada que os distinga**. Com duas linhas de mesmo nome ninguém sabe qual levou o preço,
as exigências e o roteiro do projeto — e o engano só aparece no papel que já foi ao cliente. É o outro
lado das ADR-144/145: lá o perigo era a **regra** casar por nome; aqui é o **nome deixar de identificar**.

**Decisão.** `@@unique([nome])` em `Servico` (migração `20260902000000_nome_de_servico_unico`, aditiva;
reverter é `DROP INDEX \`Servico_nome_key\``), mais **duas travas com papéis diferentes** e uma guarda de
publicação.

**⚠️ As duas travas não são redundância — tirar uma deixa um buraco diferente.**
`recusarNomeDeServicoRepetido` existe para a **MENSAGEM** em português (duas requisições simultâneas passam
as duas por ela; ela não garante nada sozinha); o **índice** existe para a **GARANTIA** (mas fala em erro
cru do MySQL). A conferência normaliza com `trim()`: sem isso, `"  Faturamento  "` passaria pela porta e só
seria barrado pelo banco.

**🔴 O ACHADO GRAVE VEIO DA PRÓPRIA CORREÇÃO, e ele derrubaria uma rota PÚBLICA.** A coluna `Servico.nome`
é **`utf8mb4_unicode_ci`** — conferido, não presumido: `SELECT nome FROM Servico WHERE nome='faturamento'`
devolve `Faturamento`. **O banco ignora maiúscula E acento.** A semeadura comparava com a igualdade crua do
JavaScript, para quem `"Conteudo"` ≠ `"Conteúdo"`. Sem índice, essa divergência produzia no máximo um clone
silencioso. **Com índice, vira indisponibilidade:** `semearCatalogoSeFaltar` roda em **toda** leitura de
catálogo — inclusive na página pública `/comecar` e no *"Solicitar"* do Portal —, tentaria recriar um
canônico que o banco já considera existente, levaria `P2002`, e a rota pública passaria a responder erro em
vez de lista. A cura é `apps/api/src/modules/servicos/chave-de-nome.ts` (`chaveDoNomeDeServico`, pura e
testada) usada nos **dois lados** da comparação, mais `skipDuplicates` como rede para a corrida.
**Visto reprovando antes:** com a correção desligada, `listServicos()` estoura.

**🕳️ O `catch` do update escondia queda de banco.** Ele nasceu para "id não existe" e traduzia **qualquer**
erro para *"Serviço não encontrado."*. Mas o `antes` já prova que o id existe, então o que chegava ali de
desconhecido era **infraestrutura** — e o mais provável neste servidor é o `P1001`
(*"Can't reach database server"*), que a documentação registra como recorrente. Isso fazia duas coisas ruins
de uma vez: a Thaís lia "não encontrado" e ia procurar um serviço que está lá; e o erro virava `NOT_FOUND`
no tRPC, que **não entra em SISTEMA → Erros** (o filtro é `INTERNAL_SERVER_ERROR`, ADR-135) — a queda do
banco ficava invisível justamente no caminho de escrita. Hoje só `P2025` vira "não encontrado"; o resto é
relançado. `criarServico` também passou a traduzir `P2002`.

**🚨 A guarda para a publicação, e agora sabe se destravar.** `GROUP BY nome HAVING COUNT(*) > 1` antes do
índice, molde da `20260829210500`. ⚠️ **DDL dá commit implícito**, então o `DROP TABLE` do fim **não roda**
quando o `CHECK` falha: a tabela auxiliar fica, e a segunda tentativa morreria no `CREATE TABLE` com erro
**1050**, que se lê como *"a guarda quebrou de novo"*. Hoje há `DROP TABLE IF EXISTS` na frente e o
destravamento em três passos escrito na própria migração. ⚠️ **Produção é MariaDB 10.6**, que responde
**`4025`** onde o MySQL 8 local responde **`3819`** — os dois estão citados, senão quem publica procura um
código que não vai aparecer.

**Alternativas descartadas.** *Índice case-sensitive* (mudar a collation da coluna) — mexeria em toda
comparação de nome já existente na aplicação, por um ganho que ninguém pediu. *Só o índice, sem mensagem* —
erro cru do MySQL na tela e ocorrência nova em SISTEMA → Erros, o ruído que a ADR-135 pagou para eliminar.
*Só a conferência da aplicação, sem índice* — não sobrevive a corrida nem a caminho novo que esqueça de
chamá-la.

**Provas.** Guarda exercida nos **três cenários** (banco normal passa · com duplicata **barra com 3819** ·
depois de limpar passa) · **13 testes novos**, e os dois que travam regressão **vistos reprovando antes** ·
typecheck 6/6 · lint limpo · **suíte completa do `@app/api`: 858/858** · CI 3/3 verde (PR #172, `f9ab574`).

**⚠️ Não está no ar.** A v1.6.0 continua sendo o que roda; publicar depende do sinal do dono.

---

## ADR-148 — A varredura de setembro: dezesseis correções, e as três piores só aparecem quando alguém repete um clique ✅

**Contexto:** o dono pediu a varredura completa antes de a operação crescer sobre o dado real — *"analise tudo,
corrija tudo, teste tudo no navegador"*. A base começou **verde**: typecheck 6/6, lint limpo, 858 testes do
`@app/api`, 220 do `@app/web`, 109 de ponta a ponta. Cinco auditorias em paralelo (segurança, API, tela, banco e
o levantamento das pendências antigas), mais a aplicação percorrida no navegador, página por página.

**⚠️ A base verde tinha um defeito que cobra o cliente em dobro.** É a lição da ADR-140 de novo, e ela merece
ser repetida: suíte verde prova que o que alguém **já pensou em testar** continua funcionando, não que o sistema
esteja certo. Nenhum dos dezesseis achados desta rodada era pego por teste.

**O padrão desta rodada é diferente do da ADR-140.** Lá era "uma segunda porta para o mesmo dado". Aqui é
**"a correção existe, mas só num dos lugares onde o defeito mora"**: a régua do recarregamento duplo estava em
um card e faltava em quatro; a trava de papel do Portal cobria quatro botões e não cobria os cinco de dar-e-tirar
acesso; a conferência de posse do upload valia para o médico e não para o serviço nem para a exigência. Quem
corrigiu não errou — parou no primeiro caso.

### Decisão

**1. 💸 APROVAR UM CREDENCIAMENTO DUAS VEZES AO MESMO TEMPO COBRAVA DUAS VEZES — e foi visto acontecendo.**
`mudarStatusCredenciamento` lia o cruzamento uma vez, no começo, e decidia criar a conta a receber com base
nesse retrato (`!atual.contaId`). Entre a leitura e a criação não havia trava: `Credenciamento.contaId` não é
único e `criarContaDoHonorario` não reconferia. ⚠️ **Não é hipótese de laboratório:** o botão "Atualizar" existe
na página Credenciamentos **e** na grade da ficha, um clique duplo basta, e a ADR-128 permite de propósito que a
mesma clínica esteja aberta em duas sessões. Reproduzido em teste antes de corrigir: **duas contas**
(`expected 2 to be 1`), com a segunda gravação sobrescrevendo `contaId` e deixando a primeira **órfã** no
Financeiro, sem nada na ficha que a explicasse. **A cura é a reserva atômica**, não uma transação: a conta é
criada e só então amarrada por `updateMany({ where: { id, contaId: null } })`, que o MySQL resolve com a linha
travada — exatamente uma das chamadas vê `count === 1`, e quem perde apaga a conta que criou, antes de ela
chegar a aparecer para alguém.

**2. 💸 A CONFERÊNCIA CONTRA COBRAR O MESMO SERVIÇO DUAS VEZES CASAVA POR TEXTO.** `provisionarUpsellAceito`
procurava conta com `descricao endsWith "<Serviço> — <Cliente>"`. Renomear a clínica na ficha muda a descrição
das cobranças seguintes: a conferência deixa de casar com as antigas e a segunda proposta lança tudo de novo —
**em silêncio, porque duas contas com descrições diferentes não se parecem com duplicata para quem olha o
Financeiro**. Nasceu `Conta.origemServicoId` (migração `20260902130000`, aditiva). ⚠️ **A conferência olha as
DUAS coisas, e não é cinto com suspensório:** o id vale das contas novas em diante, e o texto continua cobrindo
as que nasceram antes da coluna existir. **Sem backfill, de propósito** — deduzir o serviço das antigas exigiria
interpretar a descrição, que é justamente a fragilidade que a coluna veio substituir.

**3. 🧮 "EM CURSO" E "APROVADO" CONTAVAM O MESMO DINHEIRO DUAS VEZES.** A página Credenciamentos mostra os dois
cartões lado a lado, e o primeiro diz, com todas as letras, *"honorário ainda não aprovado"*. O cálculo excluía
só `NEGADO` e `ENCERRADO`. Medido na tela: R$ 2.020 de fato em andamento apareciam como **R$ 2.770** — que é
2.020 mais os R$ 750 anunciados pelo cartão vizinho. Quem soma os dois erra para mais. ⚠️ **O total do processo
continua existindo onde ele é a pergunta certa:** o cabeçalho da grade na ficha, que é o valor que vai para a
proposta.

**4. 🔐 UMA ROTA ANÔNIMA ESCREVIA NO RASTRO DE AUDITORIA SEM TETO.** `registrarBloqueioNoNavegador` é pública e
grava uma linha no `ActivityLog` a cada chamada. O teto global é de 300 requisições HTTP por minuto — mas o
cliente fala por **lote**, então uma requisição carrega dezenas de chamadas. ⚠️ **O estrago não é derrubar o
servidor, é APAGAR O RASTRO:** `SISTEMA → Atividade` mostra as 60 linhas mais recentes, e é onde a casa responde
"quem viu o quê". Agora há freio próprio por IP (60/hora, molde do formulário público) **e** o `ActivityLog`
entrou no expurgo de retenção — ele era a única tabela que crescia para sempre, num MySQL de revenda que já cai
por esgotamento de pool.

**5. 🔐 O RELÓGIO CONTAVA O QUE A MENSAGEM CALAVA.** Login de conta inexistente saía em ~5 ms; o de conta que
existe pagava o argon2id. A mensagem era a mesma, o tempo não — uma tentativa por endereço revelava quem tem
acesso ao sistema, **sem gastar as 8 tentativas do freio**. Isso derrubava, pela segunda porta, a garantia que
`solicitarReset` foi escrito para dar. Agora o caminho da conta inexistente confere a senha contra um hash de
descarte, sorteado em memória no primeiro uso — nunca escrito no repositório, porque valor fixo em código é o
que um dia alguém copia achando que é senha de exemplo.

**6. ✍️ O TOKEN DE ASSINATURA DO CLIENTE VOLTAVA EM CLARO PARA QUALQUER FUNCIONARIO.** ⚠️ **O risco não é o
acesso, é a ATRIBUIÇÃO.** Quem assina pelo link do e-mail assina deslogado e grava `assinadoPorId: null` — o
caso normal. Então uma assinatura fabricada por alguém da casa, numa janela anônima, ficava **indistinguível**
da legítima: mesmo formato, mesmo nulo. O contrato perdia valor de prova sem que nada registrasse a diferença.
Entregar o link continua sendo função da tela (é assim que a equipe reenvia por WhatsApp) — agora por
`/ir/assinar/:id`, que exige sessão, registra quem abriu e redireciona. ⚠️ **Redirecionamento, e não uma mutação
que abre janela:** `window.open` depois de `await` é barrado como pop-up.

**7. 📄 O CONSENTIMENTO DA ASSINATURA ERA EXIGIDO E NÃO ERA GUARDADO.** A caixa "li o documento e concordo"
sempre existiu e o Zod sempre recusou sem ela — e, passado o clique, não sobrava **nenhum** registro de que a
pessoa consentiu, nem com que texto. ⚠️ "A tela exigia a caixa" é afirmação sobre o código de **hoje**; não prova
nada sobre o que estava na tela naquele dia. Migração `20260902120000` (aditiva): `consentimentoEm` e
`consentimentoVersao`. ⚠️ **É data MAIS versão** — só a data diria "consentiu em 12/03" sem dizer com o quê, e o
texto muda. O texto saiu da tela e foi para `@app/shared`, com teste que **reprova quem editar a frase sem subir
a versão**. ⚠️ **Assinaturas antigas ficam nulas e a tela diz "não registrado"**: preencher com a data da
assinatura fabricaria uma prova que ninguém coletou, o que é pior que a ausência honesta.

**8. 📎 A REGRA DO RECARREGAMENTO DUPLO ESTAVA EM UM LUGAR E FALTAVA EM QUATRO.** A ADR-143 descobriu que
`invalidate()` sobre uma consulta **em andamento** é deduplicado pelo React Query, que aceita a resposta
anterior ao envio — o arquivo some da lista até alguém recarregar a página, sem sinal de erro. A correção foi
aplicada no card de documentos da ficha e **não chegou** ao Portal (Meus documentos, Meus serviços,
Credenciamento) nem ao card irmão de serviços contratados. No Portal o efeito é pior: a exigência recém-atendida
continua marcada como pendente, e o cliente reenvia achando que falhou. A regra passou a morar em
`recarregarAposEnvio`, usada pelas cinco telas — cinco cópias divergem no primeiro ajuste.

**9. 🔒 A TRAVA DE PAPEL DO PORTAL COBRIA QUATRO BOTÕES E DEIXAVA CINCO DE FORA.** "Quem da clínica entra aqui"
decidia por `papelPortal !== "EQUIPE"` — e a **sessão de suporte da Med entra como RESPONSAVEL da clínica**.
Resultado: "Convidar pessoa" e "Revogar" à vista para quem está em modo de leitura, com a recusa chegando só
depois do clique e do modal de confirmação. Agora lê `podeAgirNoPortal`, a mesma função pura que o servidor
chama, e a frase que ocupa o lugar do botão muda com o motivo — quem está em suporte precisa ler "só leitura", e
não "peça ao responsável da clínica", que mandaria a pessoa errada resolver.

**10. 🕳️ Mais seis, menores.** `/avatar/:userId`
servia a foto de qualquer pessoa a qualquer sessão autenticada, inclusive de uma clínica para outra ·
`servicoIds` do formulário público não tinha teto · as duas sugestões da IA faziam `JSON.parse` sem rede, e uma
frase a mais do modelo virava erro interno no painel do ROOT (o defeito da ADR-135 outra vez) · o Portal dizia
"você ainda não enviou nenhum documento" **enquanto a lista carregava** · cliente **já ativo** com upsell no
funil via "Não tenho mais interesse", que encerra o lead mas se lê como encerrar o atendimento inteiro (M9) · e
`/privacidade` declarava o envio de texto à OpenAI e **calava sobre o áudio** da transcrição, que é uma segunda
porta por natureza — a peneira de dado pessoal age sobre texto e não alcança o que ainda está falado.


**11. 🔁 OS REVISORES ACHARAM DOIS DEFEITOS BLOQUEANTES NAS PRÓPRIAS CORREÇÕES DESTA ADR — e é a parte
que mais ensina.** O padrão descrito no alto ("a correção existe, mas só num dos lugares onde o defeito mora")
apareceu de novo, agora comigo:

- **A defesa contra enumeração por tempo virou um amplificador de argon2id.** O freio de força bruta é chaveado
  em `(ip, e-mail)` — e **quem escolhe o e-mail é quem ataca**: variar o endereço a cada tentativa faz o freio
  nunca engatar. Isso já era ruim; virou perigoso quando o caminho da conta inexistente passou a conferir a
  senha contra um hash de descarte, porque **cada e-mail inventado passou a custar 19 MiB e duas passadas de
  argon2**, na threadpool de 4 do Node. E o cliente fala por lote, com o rate-limit global contando
  requisições, não chamadas. ⚠️ **A defesa contra vazar informação teria virado o jeito mais barato de derrubar
  o sistema inteiro** — um processo só serve API, site e tempo real. Cura: um segundo freio **por IP sozinho**,
  que recusa **antes** de queimar tempo, mais `.max(200)` na senha. De brinde, a memoização do hash de descarte
  guardava a promessa **rejeitada** para sempre: uma falha do argon2 no boot faria todo login com e-mail
  desconhecido responder erro interno (a ADR-135 de novo).
- **O expurgo do `ActivityLog` apagava a prova criada pela correção vizinha desta mesma ADR.** Pôr teto na
  tabela estava certo; apagar tudo, não. `documento.link_de_assinatura_aberto` nasceu no item 6 acima
  **justamente** para o dia em que uma assinatura for contestada — e evaporaria em 180 dias, enquanto contrato
  se guarda por anos. Junto iam `painel_cliente.*` (o único registro de quem da Med entrou no Portal de um
  cliente), `arquivo.removido` e `conta.criada`. ⚠️ **E o prazo herdado era o do corpo dos e-mails**, cujo
  rótulo na tela fala de e-mail: apertar aquele campo para 30 dias destruiria cinco meses de trilha de
  auditoria sem ninguém ler a palavra "atividade". Cura: uma **lista de ações preservadas**, não um prazo — e o
  texto do botão de expurgo passou a dizer o que fica.
- **E uma terceira, do revisor de banco:** `Conta.origemServicoId` era gravado no aceite da proposta e **não**
  ao contratar pela ficha. Com uma das duas portas sem o elo, o rename da clínica reabria a cobrança dupla por
  ali — exatamente o buraco que a coluna veio fechar. O teste novo cobre as duas portas de propósito.

### Consequências

- **Duas migrações, as duas aditivas e revertíveis em duas linhas:** `20260902120000` (consentimento da
  assinatura) e `20260902130000` (origem do serviço na conta). Nenhuma apaga ou converte dado, nenhuma faz
  backfill, nenhuma linha existente muda de valor.
- **A versão do aviso de privacidade subiu para `2026-09-02`**, porque o texto mudou — é o que a própria página
  exige de quem a edita.
- **Provas:** typecheck 6/6 · lint limpo · **866 testes do `@app/api`** (eram 858; os que travam regressão foram
  vistos reprovando antes) · **220 do `@app/web`** · **109 de ponta a ponta** · a aplicação percorrida no
  navegador, área interna e Portal, com **zero erro de console**.
- **O que ficou de fora, e por quê:**
  - **O envio de e-mail não pôde ser provado no computador do dono** — a máquina não tem servidor de e-mail
    (`ECONNREFUSED 127.0.0.1:587`, comportamento conhecido desde a ADR-122). A entrega só se prova em produção,
    onde foi provada em 22/08.
  - **⚠️ A CONFERÊNCIA DE POSSE DO `servicoId`/`requisitoId` NO UPLOAD FOI TENTADA E REVERTIDA — e a lição é a
    parte que importa.** A revisão de segurança apontou a assimetria (o `profissionalId` é conferido, os outros
    dois não). Fechei exigindo que o cliente tivesse o serviço **contratado** — e a suíte de ponta a ponta
    reprovou (`flows-credenciamento … enviar um documento move a barra`), mostrando que **a premissa estava
    errada**: a papelada do credenciamento aparece legitimamente para quem tem médico cadastrado, ainda que a
    contratação não esteja registrada (`credenciamentoDoCliente`: `emCurso = contratado || profissionais.length
    > 0`). Com a régua estrita, o cliente enviava o documento e **a barra de progresso não andava**.
    Repetir aquela condição no upload seria escrever a mesma regra em dois lugares — o modo de falha da ADR-133,
    e no dia em que a visibilidade mudasse o cliente perderia o documento em silêncio. O risco mitigado é baixo
    (o estrago fica todo dentro do próprio `clienteId`), então o certo foi **não fechar deste jeito**. Se um dia
    for fechado, a régua tem de ser **uma** função exportada por `credenciamento.service.ts`, chamada pelos dois
    lados. O porquê está escrito no código, onde alguém tentaria de novo.
  - ⚠️ **Isto é a própria lição da rodada aplicada a mim:** a suíte verde não prova que o sistema está certo,
    mas a suíte **vermelha** provou que a minha correção estava.

---

## ADR-149 — A porta por onde a Cora fala com o Workspace: contrato próprio, e delegação que se revoga

**Data:** 02/09/2026 · **Estado:** implementada na branch `feat/api-do-agente-cora-001`, **não publicada** ·
**Pedido:** ticket `CORA-001` em `med-coordination`, seção 7 do briefing `CORA-MED-START-HERE.md`.

**O contexto.** Está nascendo a **Cora**, uma assistente que a Thaís vai usar por voz e por celular. A Cora é
outro programa, em outro repositório, escrito por outra sessão. Ela precisa ler as tarefas internas da pessoa
que está falando com ela — e essa é a primeira vez que algo **de fora** lê dado do Workspace.

**A decisão que veio antes de tudo: NÃO expor o tRPC.** O tRPC daqui é o transporte do nosso próprio navegador
— fala `superjson`, agrupa chamadas em lote, muda de forma quando refatoramos e não tem contrato publicável.
Entregá-lo à Cora amarraria os dois sistemas: uma refatoração interna quebraria a assistente, e o nosso
compilador não avisaria, porque o outro lado nem compila junto. Nasceu `/api/agent/v1`, REST/JSON, com contrato
OpenAPI versionado em arquivo — e é **o arquivo** que é o contrato, não este código.

**🔑 SÃO DUAS IDENTIDADES, E JUNTÁ-LAS SERIA O DEFEITO.** `AgentClient` responde *"que programa está
chamando"*; `AgentDelegation` responde *"em nome de que pessoa"*. Com uma coisa só, o segredo do serviço
viraria, sozinho, acesso ao dado de gente. Separadas: um segredo de serviço vazado não lê a caixa de ninguém
sem a delegação, e **a delegação é presa ao serviço que a recebeu** — token da Cora não vale para outro
programa. Migração `20260902200000`, **duas tabelas novas**; reverter são dois `DROP TABLE`.

**⚠️ `userId` NO PAYLOAD NÃO AUTENTICA NADA — e a trava é estrutural, não uma conferência.** O
`requesterUserId` sai do token e de lugar nenhum mais: a função que lista tarefas recebe o id que a
autenticação devolveu, e **não existe caminho** para o pedido escolher a pessoa. É a mesma escolha do
`clienteId` do `portalProcedure` (ADR-128), pelo mesmo motivo: quem pede é a parte interessada em mentir.

**⚠️ A PESSOA É REVALIDADA A CADA CHAMADA, não só na emissão.** Delegação de duas horas emitida de manhã não
pode continuar valendo depois de o acesso da pessoa cair ao meio-dia. Conferimos, por requisição: delegação
viva, não revogada, não expirada · usuário ativo, não excluído, sem acesso revogado · papel interno (conta de
Portal não lê tarefa da equipe) · escopo `tasks:read` presente, com **padrão NEGAR** — escopo novo nasce
fechado.

**🔐 SHA-256 E NÃO argon2 NOS SEGREDOS — e a escolha é filha direta da ADR-148.** Lá, pôr argon2 no caminho de
uma conta inexistente transformou uma defesa de privacidade no jeito mais barato de derrubar o processo. Aqui o
risco seria pior: a API do agente é chamada **em laço por um programa**, não uma vez por dia por uma pessoa. E
não há o que argon2 resolveria: estes dois segredos são 32 bytes sorteados por nós (256 bits), sem dicionário a
percorrer. O que protege é a entropia, não a lentidão. **Nenhum dos dois é guardado** — só o hash; o valor
bruto existe uma vez, na saída do comando que o emitiu.

**🧭 `scope=mine` É "SOU RESPONSÁVEL", NUNCA "TUDO QUE EU POSSO VER".** É a mesma régua da aba *Comigo* da tela
humana. A diferença importa para ADMIN e ROOT: com a leitura larga, um assistente pessoal despejaria a fila da
casa inteira na cara de quem só perguntou "o que eu tenho para hoje?".

**📄 CURSOR OPACO E ASSINADO, não base64.** O contrato promete que o cursor é opaco e que adulterá-lo responde
`400` — e só dá para **recusar** o que dá para **detectar**. Base64 sozinho não detecta nada: todo palpite é
"válido". O cursor carrega `(createdAt, id)` — par **total**, porque `id` é único — assinado por HMAC com o
segredo de sessão. Paginação por chave, não por deslocamento: com `skip`, uma tarefa criada entre duas páginas
empurra a lista e a página seguinte **pula uma linha**, em silêncio.

**⚠️ `limit` FORA DA FAIXA É ERRO, NÃO É APARADO.** Aparar em silêncio faz o consumidor acreditar que recebeu
500 itens quando recebeu 100 — e a diferença aparece como "sumiu tarefa", muito longe da causa.

**🚨 INDISPONIBILIDADE NUNCA VIRA LISTA VAZIA, e este é o item de maior consequência humana.** `{"items":[]}`
se lê como *"você não tem nada pendente"* — a frase mais perigosa que um assistente pode dizer errado. Banco
fora do ar é `503 UPSTREAM_UNAVAILABLE`, e a Cora tem de dizer "não consegui consultar". Há teste que derruba o
banco de propósito e exige o `503`; com a correção desligada, ele reprova.

**⚖️ USUÁRIO DESATIVADO É `403`, NÃO `401` — e o ticket deixou a escolha comigo.** `401` significa "sua
credencial não serve, consiga outra", e é o que a Cora faria: pediria renovação, em laço. Mas delegação nova
para uma pessoa desativada também não vai existir, então o laço nunca fecha. `403` diz a coisa certa: a
credencial está boa, quem não pode mais é a **pessoa** — pare e avise gente. Fixado no contrato.

**🕳️ O QUE FICOU DE FORA, DE PROPÓSITO:** não há escrita (criar/editar tarefa) — é a Fase 2 do briefing da
Cora, e ela pede prévia com aprovação e idempotência; não há tela de gestão de delegações (o comando
`pnpm agente listar/revogar` cobre o desenvolvimento, e a tela entra com o pareamento de dispositivo da Fase
4); e `Tarefa.descricao` **não** é exposta — é texto livre que pode conter dado de cliente, e minimização de
dado é a regra da ADR-141.

**Provas:** typecheck 6/6 · lint limpo · **28 testes de integração novos** exercendo o Fastify de verdade
(`app.inject`) contra o MySQL `_test`, cobrindo os doze casos que o CORA-001 exige · **7 deles vistos
reprovando** com as travas sabotadas (isolamento e o `503`) · e a rota exercida por **HTTP real** contra a
aplicação local, com `200`, `401` e `400` conferidos por `curl`.
