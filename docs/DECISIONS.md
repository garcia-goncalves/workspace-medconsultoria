# DECISIONS.md — Architecture Decision Records

Registro das decisões arquiteturais importantes. Cada ADR: **Contexto → Opções → Decisão → Consequências**. Ao tomar uma nova decisão relevante, adicione um ADR (não edite os antigos; se um for revertido, marque como *Substituído por ADR-n*).

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

**Contexto:** a "Situação comercial" (PROSPECT/NEGOCIACAO/ATIVO/PERDIDO) era um dropdown manual na ficha que não conversava com o funil — dois lugares dizendo o estado da relação, podendo divergir. Pior: misturava *estágio do negócio* (prospecção/negociação) com *status do relacionamento* (cliente/perdido). O dono, corretamente, apontou a confusão: **"cliente não vira lead"**.

**Modelo mental correto:** **Lead = uma OPORTUNIDADE (negócio); Cliente = o cadastro (permanente).** Um cliente pode ter várias oportunidades ao longo do tempo. Um cliente **nunca** "vira lead"; o que existe é *abrir uma nova oportunidade para um cliente existente* (upsell) — ele segue cliente.

**Decisão:** a Situação vira o **placar do funil** (fonte da verdade = funil), mantida automaticamente e **somente-leitura** na ficha:
- `reconciliarSituacaoCliente(clienteId)` recalcula a situação a partir das oportunidades do cliente e roda a cada evento de funil (mover/avançar etapa, converter, perder, reabrir, desistir/retomar pelo Portal, nova oportunidade).
- **Regra de ouro:** cliente **ATIVO nunca é rebaixado** — quem já é cliente (ganhou um negócio ou foi cadastrado direto) segue ATIVO mesmo com uma oportunidade nova aberta. Para quem ainda não é cliente: oportunidade aberta → NEGOCIACAO (se na etapa de negociação) senão PROSPECT; só perdida → PERDIDO.
- Botão **"Nova oportunidade"** na ficha (`leads.novaOportunidade`) abre um novo negócio no funil para um cliente existente, com confirmação que deixa claro: *o cliente continua cliente*.
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
- **Construtor sem código** — a página **Documentos** ganhou a aba **Formulários** (`FormulariosPanel`, junto de Documentos e Modelos): cria/edita formulários e campos (com arraste para ordenar). A aba **Exigências** de um serviço permite marcar um item como **Briefing** e escolher o formulário. A app nasce com **3 briefings prontos** (site, identidade visual, redes sociais), ligados aos serviços correspondentes, editáveis. *(Decisão do dono: os formulários ficam em Documentos, não numa página à parte.)*

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
- **Valor fixo** — `valor Float?` + `valorRecorrencia PrecoRecorrencia @default(AVULSO)` (para TODOS os serviços).
- **% do faturamento** — `percentual Float?` (ex.: 5 = 5%) + `percentualRecorrencia PrecoRecorrencia @default(MENSAL)`. No **schema** o campo existe para qualquer serviço, mas na **UI a seção de % só aparece quando a categoria é "Faturamento"** (reativo, via `useWatch` da categoria).
- Novo enum `PrecoRecorrencia { AVULSO, MENSAL }` (distinto do `Recorrencia` da Agenda). Migração `servico_precificacao`.
- **Rótulo único** `formatPreco` (em `lib/masks`): monta "R$ 1.800,00/mês", "5% do faturamento/mês" ou "R$ 500,00 + 5% do faturamento/mês" — mostrado no card. Config: componente reutilizável `PrecoFields` (valor fixo com `MoneyInput` + seletor Avulso/Mensal; e, só p/ Faturamento, o % com seletor). Corrigido: limpar o valor grava `null` (permite alternar entre "% puro" e "fixo + %").
- **Recorrências semeadas** por realidade: Gestão Operacional e os de Marketing recorrentes (redes/conteúdo/tráfego) = **mensal**; projetos (site, identidade, manual, credenciamento, negociação) = **avulso**; **Faturamento = 5% mensal** (sem valor fixo por padrão).

**Consequências:** o catálogo cobre os cenários reais de cobrança da Med sem inventar tabela nova (2 pares campo+recorrência no próprio Servico). `listServicos`/`listServicosAtivos` expõem os novos campos; a Proposta trata `valor` nulo como 0 (Faturamento entra por valor digitado). A cobrança efetiva por % (aplicar 5% sobre o faturamento real de cada cliente) não é calculada aqui — isto é a **precificação de referência do catálogo**; billing por cliente fica para depois. Testado: typecheck 5/5 + ao vivo (card "5% do faturamento/mês" e "R$ 500,00 + 5% do faturamento/mês"; % aparece só no Faturamento; salvar/zerar persiste; migração aplicada e banco vivo backfillado).

**Refinamento (arquitetura em 3 camadas — decidido com o dono):** a recorrência avulso/mensal é uma **decisão comercial**, não um atributo do catálogo. Então: no **Serviço** ela vira só uma **"cobrança padrão" (sugestão)** que pré-preenche a proposta (rótulo e texto de UI ajustados; card e defaults inalterados); a escolha *de verdade*, editável, vive na **Proposta** (por item: valor + avulso/mensal + %) e nos **Serviços Contratados** do cliente (`ClienteServico`). O **%** é tratado como **sempre mensal** (removido o seletor de recorrência do % na UI; `percentualRecorrencia` fica MENSAL).

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

**Decisão — frontend:** `MensagensPage` com **menu (⋮)** por conversa (fixar/silenciar/arquivar/apagar), **aba Arquivadas**, e **dois eixos de filtro separados**: categorias (Todas/Diretas/Grupos/Clientes/Leads = *quem*) numa linha e um segmentado **Ativas × Histórico** (*estado* — Histórico mostra SÓ os chamados resolvidos, com contador). Cabeçalho do ticket com **Resolver/Reabrir** + status + prioridade + protocolo; **editar/apagar** a própria mensagem (hover) com selo "editada" e lápide. Resolver/reabrir faz **push em tempo real** aos participantes (equipe + Portal atualizam sozinhos). `NovaConversaDialog` abre chamado em 2 passos (cliente → assunto + prioridade). `ConversaInfoDialog` com prioridade + apagar. Novo `PortalSuporte` (lista de chamados + "Abrir chamado" + thread por ticket) substitui o chat único no Portal.

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
1. **Menu em 2 grupos.** *Dia a dia:* Início · Vendas · Clientes · Projetos · Agenda · Mensagens · Financeiro. *Configuração:* **Ajustes** (ADMIN) · Sistema (ROOT). Nova página `/ajustes` (`features/ajustes/AjustesPage.tsx`) = hub que junta os painéis administrativos que saíram do menu (**Serviços, Documentos e modelos, Mensagens automáticas, Equipe e acessos, E-mails enviados**). Renomes (rótulo só; rotas iguais): Dashboard→**Início**, Funil de vendas→**Vendas**, Usuários→**Equipe e acessos**, Comunicações→**Mensagens automáticas**. `usePageTitle`/`EXTRA_TITLES` (prefixo) e `CommandPalette` alinhados.
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
1. **Matriz de interação por documento** (`DOC_INTERACAO` em `packages/shared/src/schemas/documento.ts`): **assinatura** — **só o Contrato** (único vínculo jurídico formal, Lei 14.063/2020) · **aceite** (Proposta — concordância comercial, 1 clique) · **nenhum** (Escopo, relatórios, ata, pautas, diagnóstico, plano, onboarding, checklist, recibo, e **Briefing** que o cliente **preenche** online no Portal). A `DocumentoDetailPage` renderiza `AssinaturasCard`, `PropostaAceiteCard` ou nada conforme o tipo (sem modelo = nenhum). **Lógica escolhida:** *um ato por documento* — proposta se aceita, contrato se assina, o resto se lê/entrega/preenche. O **Escopo é anexo** da proposta/contrato (o vínculo já vem pela proposta aceita + contrato assinado), então não tem assinatura própria — menos fricção/menos passos (alinha com "menos estresse pra Thaís"; se um dia precisar de um acordo avulso assinado, usa-se o tipo Contrato). Resolve também, de forma sistêmica, "Solicitar assinatura" aparecendo na proposta.
2. **Largura única:** o `AppLayout` já centraliza tudo em `max-w-[1600px]`; **nenhuma página impõe largura própria** na raiz. Removido o único fora do padrão (`mx-auto max-w-4xl` da `DocumentoDetailPage`). `max-w-*` internos (leitura, chat, folha do doc) permanecem.
3. **Folha A4 + sem scroll:** `DocumentoBranded` usa a **proporção A4** (`aspect-[210/297]`) numa **escala de tela confortável** (`max-w-[640px]`, não o A4 real de 794px — que ficava "gigante") — aparece **inteira por padrão** mesmo com pouco conteúdo e cresce quando há mais — com sombra de página, centralizada num canvas; a leitura perde o `max-h/overflow` próprio — rola a **página** (`<main>`). Editor mantém scroll independente (correto). **Impressão/PDF = A4 real** pelo `@page A4` de `imprimirDocumento` (independente da largura de tela; WYSIWYG do ADR-47).
4. **Breadcrumbs (`components/layout/Breadcrumbs.tsx`):** caminho no cabeçalho do shell (no lugar do `<h1>`), semântico/acessível (`nav[aria-label]`, `ol`, Home, chevron `aria-hidden`, `aria-current`), `hidden md:flex`. Trilha derivada da rota (`trailFor`, reaproveita os grupos do menu; páginas de Ajustes ganham o pai *Ajustes*); fichas publicam o nome do registro via `useDynamicCrumb(nome)` (contexto). `activeOptions={{ exact:true }}` nos Links evita o TanStack duplicar `aria-current`. `<title>` da aba acompanha a página.

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

> *Registrado retroativamente em 03/08/2026: a feature foi ao ar no PR #73 (28/07) sem virar ADR.*

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
2. **`updateConta` deixava o vencimento colidir em silêncio.** Puxar uma parcela para a data de uma irmã criava duas ocorrências no mesmo dia — hoje isso passa sem reclamar. Com o índice, viraria um `P2002` cru na cara do usuário. Agora o erro é traduzido: *"Já existe uma parcela desta série com este vencimento — inclusive se ela foi excluída. Escolha outra data."* A menção ao excluído não é detalhe: a irmã pode estar soft-deletada e **invisível na tela**, e sem isso a mensagem não faria sentido.
3. **O banco de DEV tinha uma duplicata real de 28/07/2026** — três linhas "Vivo", todas soft-deletadas, mesmo vencimento (05/09). É o ADR-92 documentado em dado real: cada ciclo marcar/desmarcar deixou uma órfã. Limpeza feita **só em dev**, mantendo a mais antiga (a que a geração ressuscitaria); produção não precisou de nada.

**Decisão:** `@@unique([recorrenteId, vencimento])`. A migration foi escrita à mão e aplicada com `migrate deploy` — o `migrate dev` recusa rodar não-interativo ao criar índice único (avisa que *pode* falhar, sem saber se falharia).

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

**Testes que passavam com o bug de volta: TRÊS**, todos medidos reintroduzindo o defeito fora do repo. É a lição de engenharia da fase, junto com a do §3.0: *teste que não reprova o defeito é pior que teste nenhum, porque a regressão volta com a bateria verde.*

**Verificado (05/08, HEAD `7716929`):** API 186 de unidade · web 106 · `e2e` **82/82** (inclusive `a11y-axe`, que cobre o `modal.tsx` compartilhado pela app) · `pnpm lint` 0 erros · typecheck 6/6 sem cache. **Em tela**, na app rodando: anexo baixado pela tela (200, `octet-stream`+`nosniff`+`attachment`, 75.962 bytes com assinatura PNG íntegra) · Responder com destinatário, `Re:` e citação com procedência · rascunho aparecendo **uma vez só** apesar de duas gravações · envio recusado (400) mantendo o rascunho no servidor com o texto intacto.

## ADR-97 — E-mail: a conversa com o cliente aparece na ficha (Bloco 2, fase 2D‑1) ✅

**Contexto:** o ADR‑95 prometeu *"a caixa é privada, a correspondência com o cliente é da empresa"* e entregou só a primeira metade. Quem abria a ficha do cliente via um card **"E‑mails enviados"** que mostrava exclusivamente `EmailEnviado` — o log dos disparos automáticos de template. Nada do que a equipe escreve em `/email` chegava ali, porque o módulo da caixa não chama `registrarEmailEnviado` (e isso é proposital: ADR‑96 §3.6). Plano em `docs/superpowers/plans/2026-08-05-email-2d1-ficha-do-cliente.md`, branch `feat/email-ficha-do-cliente`. O levantamento contra o código desmentiu duas premissas do plano original: **o card não era novo** (existia em `ClienteDetailPage` e em `LeadDetailPanel`) e **`EmailMensagem.particular` já existia no banco sem uma linha de código que o escrevesse** — a válvula de privacidade estava prevista desde o ADR‑95 e nunca tinha sido implementada.

**Decisões:**

1. **Metadado + trecho para a equipe; corpo só para o dono da caixa.** Levada ao pé da letra, a regra do ADR‑95 deixaria qualquer funcionário ler o corpo inteiro de um e‑mail que outra pessoa trocou. A ficha devolve remetente, destinatários, assunto, data e o `trecho` (o resumo em texto puro que o índice já guarda) — **nunca corpo**, para nenhum papel, nem para o ROOT. O corpo continua exclusivo do dono, em `/email`. O motivo é assimétrico e é o que decide: **ampliar depois é um `select` a mais; estreitar depois de alguém ter lido a correspondência alheia é impossível.**
2. **O vínculo é resolvido na consulta, nunca gravado** (`vinculo.service.ts`): JOIN em `EmailEndereco.endereco` contra `Cliente.email` + o e‑mail de cada contato (o lead só tem o próprio), normalizados por `normalizarEndereco`. Cliente que troca de e‑mail passa a refletir a verdade nova sem migração.
3. **Endereço da casa nunca vira chave do JOIN — por endereço E por domínio** (`casa.ts`). `Cliente.email` e `Contato.email` são graváveis por **qualquer** FUNCIONARIO, e o cliente do Portal edita o próprio e‑mail: sem esta trava, quem escolhe a chave da consulta é quem edita o cadastro. A primeira versão comparava só endereços exatos (`User.email` + `CaixaEmail.email`/`usuario`) e **a revisão de segurança a derrubou**: `comercial@`, `contato@`, `financeiro@`, um apelido (`thiago@` ao lado de `thiago.garcia@`) e um `fulano+algo@` não têm conta nem caixa plugada e passavam — bastava pôr um deles num cliente descartável para ler, pela ficha, metadado e trecho da correspondência da equipe. Agora **todo endereço em domínio da casa é recusado**; provedor público (gmail, outlook, uol…) **nunca** vira domínio da casa, senão plugar um Gmail um dia apagaria da ficha todo cliente com Gmail. Consequência aceita: cliente cadastrado com e‑mail `@medconsultoria.com.br` não casa com nada — cliente de verdade tem e‑mail de fora, e o preço de recusá‑lo é uma ficha vazia, não uma caixa alheia aberta. O filtro `role: { not: CLIENTE }` continua: **o cliente do Portal também é `User`** e sem ele a ficha de todo cliente com Portal ficaria vazia. Caixa desplugada e usuário desativado seguem contando (endereço que um dia foi da casa não se recicla como chave).
4. **Ficam fora da ficha, sempre:** `particular = true`; **Lixeira, Spam e Rascunhos** (`DRAFTS` importa: o rascunho grava sozinho a cada 5 s desde o ADR‑96 — sem excluí‑lo vazaria e‑mail meio escrito, inclusive o que a pessoa pensou melhor e não mandou); e as **duplicatas** por `messageId` (a mesma mensagem existe na caixa de quem mandou e na de cada colega que recebeu), mantendo a mais antiga.
5. **A válvula: `email.marcarParticular`, só o dono da caixa.** A posse vai no `where` do próprio `updateMany` — não numa leitura antes dele —, então para quem não é dono não existe caminho em que algo seja gravado; `count === 0` responde `FORBIDDEN`, indistinguível de "não existe" (responder `NOT_FOUND` para um id alheio já contaria que ele existe). Marcar **uma** cópia esconde **todas** as cópias daquele `messageId`: esconder só a cópia de quem marcou deixaria a do colega na ficha, com o mesmo assunto e o mesmo trecho — a válvula não valvularia nada.
6. **A válvula tem volta, e ela mora na caixa.** A ficha só *tira* (`Tirar da ficha`); *devolver* é em `/email`, na caixa de quem é dono — `abrirMensagem` passou a devolver `particular` e a tela ganhou o botão nos dois sentidos. Sem isso, marcar como particular seria de mão única na app inteira: desfazer exigiria mexer no banco.
7. **Falha ao ler a caixa não derruba a ficha.** `conversaDoCliente` junta as duas fontes ordenadas por data; se a parte da caixa falhar (rede IMAP indireta, índice sincronizando), o card ainda mostra o log automático e avisa por `caixaIndisponivel`. E o **erro de verdade é visível** (`QueryError` com "tentar de novo") — os cards da ficha até aqui só tratavam o vazio, e um card silenciosamente vazio faz a equipe concluir que não houve conversa nenhuma com o cliente.
8. **Um card, duas fontes, selo por origem** (`EmailsDoClienteCard`, com `EmailsDoLeadLista` para o painel do lead): *"Enviado pelo sistema"* × *"Caixa de \<pessoa\>"*. Sem o selo, e‑mail automático e correspondência de gente viram a mesma coisa na leitura. `emailsEnviados.doCliente`/`.doLead` (as procedures) **saíram** — ficaram sem consumidor; os serviços `listPorCliente`/`listPorLead` continuam vivos, chamados pelo `vinculo` e pelo Portal.

9. **O histórico automático fazia o MESMO JOIN sem trava — e o Portal lê essa metade.** Segundo bloqueante da revisão: `listPorCliente`/`listPorLead` (`enviados.service.ts`) casavam por `OR: [{ clienteId }, { para: cliente.email }]`, e `para` sai do cadastro. Pelo lado interno, um funcionário punha `root@medconsultoria.com.br` no cliente e via os transacionais do ROOT; pelo lado **externo**, que é pior, o cliente do Portal edita o próprio e‑mail (`portal.service.ts`) e `portal.emails` chama a mesma função — alguém de fora da empresa listaria assunto, tipo, data e falha dos e‑mails mandados a uma conta interna. É o mesmo defeito do `6dc7583` visto de outro ângulo: aquele fix tirou o **corpo**, este tira a **chave escolhível**. Agora o `para` só vale como chave quando o endereço **não é da casa** (`chaveDeEndereco`); o vínculo gravado pelo servidor (`clienteId`/`leadId`) continua valendo sempre. Manter o `para` para endereços de fora preserva o histórico de quem trocou de e‑mail depois de já ter recebido.
10. **`marcarParticular` é idempotente.** No MySQL o driver conta linhas *alteradas*, não *casadas*: regravar o mesmo valor (dois cliques, duas abas, o botão de `/email` fora de sincronia com a ficha) devolvia `count === 0` e o **dono da caixa** levava "só quem é dono pode marcar". A conferência extra usa o mesmo critério de posse do `UPDATE`, então para quem não é dono ela também não acha nada — o `FORBIDDEN` continua sem contar se o id existe.
11. **Tirar e devolver deixam rastro** (`ActivityLog`: `email_tirado_da_ficha` / `email_devolvido_a_ficha`). A válvula esconde a mensagem da empresa inteira a partir da cópia de uma pessoa — sem registro, ela é também alavanca de encobrimento. O log guarda **quem, qual mensagem e para qual lado**; nunca assunto nem trecho, senão o painel do ROOT viraria outra porta para o conteúdo que a fase decidiu não expor. É best‑effort: falhar ao registrar não impede alguém de proteger o que é seu.
12. **Limite conhecido, escrito de propósito:** a propagação do "particular" entre as cópias é por `messageId`. Mensagem sem `Message-ID` (servidor fora do padrão) não agrupa com ninguém, então marcar esconde só aquela cópia. É raro e o preço de agrupar por assunto+data seria esconder mensagens diferentes.

**Achado grave, corrigido antes desta fase entrar** (commit `6dc7583`): o card antigo devolvia o **corpo** do `EmailEnviado`, e o corpo dos templates de acesso carrega o **link de redefinição de senha com token**, que não expira. Qualquer funcionário abria a ficha, copiava o link e tomava a conta — inclusive a de um ROOT. Corrigido em duas camadas (o `select` da ficha parou de pedir corpo; o registro passou a redigir segredo). **Pendente e só o dono decide:** limpar as linhas antigas de `EmailEnviado` em produção — o corpo delas ainda tem token de `/assinar` e `/proposta`.

**Fora desta fatia (2D‑2 e 2D‑3):** anexo de e‑mail vira documento do cliente com um clique (`EmailAnexo.arquivoId` já existe) e e‑mail de desconhecido vira lead com um clique.

**A revisão de segurança (obrigatória nesta fase) achou dois BLOQUEANTES e os dois eram a mesma falha vista de dois lados: a chave do JOIN era um campo que o atacante escreve.** Estão nos itens 3 e 9. Vale como lição da fase: *proteger uma consulta e deixar a irmã sem trava não protege nada* — quem quer ler procura o caminho que sobrou, e aqui o caminho que sobrou era o único aberto a alguém de fora da empresa.

**Verificado:** `@app/api` 240 testes de unidade (`casa.test.ts` novo, 9) · `@app/web` 111 · typecheck 6/6 sem cache · `pnpm lint` 0 erros · `e2e` **84/84** no banco isolado, com `email-ficha-cliente.spec.ts` novo (nenhum e2e tocava a ficha do cliente até aqui) cobrindo o selo, o particular que não aparece e a ida-e-volta da válvula.

## ADR-98 — A senha de desenvolvimento sai do repositório e passa a ser rotacionável ✅

**Contexto:** um handoff da janela de configuração do agente (05/08/2026) avisou que a senha de seed de desenvolvimento (`SEED_ROOT_PASSWORD`) estava em texto puro em 8 arquivos de memória versionados em outro repositório, com o valor preso no histórico do git de lá, e pediu: *"troque o valor no `.env` e reexecute o seed"*. **Duas coisas não fechavam.** Primeira: o seed **preserva de propósito** a senha de conta existente (`prisma/seed.ts` — "só CRIA quem falta"), então reexecutá‑lo não troca hash nenhum; `pnpm acessos` confirmou as 4 contas internas ainda entrando com a senha antiga depois de qualquer reexecução. Segunda, e maior: o mesmo valor estava **neste** repositório, embutido como fallback em `e2e/auth.setup.ts`, `e2e/auth-flows.spec.ts` e nas duas ocorrências de `SEED_ROOT_PASSWORD`/`E2E_PASSWORD` do `ci.yml` — trocar só o `.env` deixaria o valor circulando aqui e, pior, **quebraria a suíte e2e local em silêncio**, porque em desenvolvimento ela dependia justamente daquele literal (o `playwright.config.ts` não carregava o `.env`).

**Decisões:**

1. **Senha nenhuma embutida no código.** Os specs leem só do ambiente e **falham com mensagem explicando o que definir** em vez de tentar um valor morto. Fallback de credencial é pior que ausência: esconde a configuração faltando até o dia em que a senha real muda. O mesmo valia para o **`demo-seed.ts`**, que criava `func@` (FUNCIONARIO), `thais.garcia@` (ADMIN) e `cliente@` (**cliente do Portal**) com o literal — essas contas eram imunes à rotação e continuariam aceitando a senha vazada depois dela; agora leem a senha do `.env` como o `seed.ts`.
2. **Uma fonte só: `SEED_ROOT_PASSWORD` no `.env`.** O `playwright.config.ts` lê essa chave (o Playwright não carrega o `.env` sozinho) e a usa como `E2E_PASSWORD` quando ela não vem explícita — no CI vem, com valor descartável. **Só a senha é copiada** para o `process.env` dos workers: levar o arquivo inteiro poria `SMTP_PASS`, `OPENAI_API_KEY` e `EMAIL_CRYPTO_KEY` dentro do processo do Playwright sem que a suíte precise de nenhum deles. O caminho do arquivo é resolvido a partir do próprio config (não do CWD), e com `__dirname`: `import.meta.url` marcaria o config como ES module e o Playwright não conseguiria carregá-lo.
3. **`pnpm senha:rotacionar`** (`scripts/rotacionar-senha-seed.ts`) faz o que o seed não faz: sorteia o valor, grava a linha do `.env` e reescreve o `passwordHash` no banco. **Nunca imprime o valor** — nem em sucesso, nem em erro: quem quiser ver abre a linha do `.env`. Imprimir jogaria o segredo no terminal, no scrollback e no transcript de quem estivesse assistindo.
4. **O critério é "quem ainda usa a senha atual", não uma lista de e-mails.** O script confere o hash de cada conta contra a senha que está saindo e troca exatamente as que casam. Isso pega de uma vez as contas semeadas **e** as de exemplo do `demo-seed` (uma lista fixa esqueceria as segundas), e **deixa intacta quem já definiu senha própria** — daí não ser preciso mexer em `senhaTrocadaEm` (ADR‑91): quem escolheu a sua não é afetado, quem não escolheu continua sendo cobrado no 1º acesso. O UPDATE é **um só** (`id: { in: [...] }`): não existe desfecho com metade das contas numa senha e metade em outra.
5. **A trava de ambiente não pode ser "o host é localhost".** Foi a primeira versão, e ela estava **errada**: em produção o banco também é local (`mysql://…@localhost:3306`, `DEPLOY.md`), então o script rodando no servidor por SSH passaria a trava e reescreveria a senha dos 3 ROOTs e da ADMIN de produção para um valor aleatório gravado num `.env` que ninguém lê — perda de acesso ROOT, recuperável só por "Esqueci minha senha". Agora a trava é a **mesma do `demo-seed`** (`podeRodarDemoSeed`, pura e testada), alimentada com o **`NODE_ENV` lido do arquivo** — é o `NODE_ENV=production` do `.env` de lá que separa os dois ambientes, não o host. O banco alvo é impresso antes de qualquer escrita.
6. **Desfazer sem deixar cópia do segredo.** O `.env` é gravado antes de tocar o banco e, se qualquer passo seguinte falhar, é **restaurado a partir do conteúdo em memória** — o estado intermediário (arquivo novo × hash antigo) é o único em que *nada* autentica. A primeira versão fazia backup em arquivo: um `.env.rotacao.bak` com a senha antiga **e** com `SMTP_PASS`/`OPENAI_API_KEY`/`SESSION_SECRET` de brinde, que um `Ctrl+C` deixaria em disco para sempre. Ele não entrava no git (`.gitignore: .env.*`) nem no pacote de deploy, mas backup de segredo esquecido é o mesmo problema com outro nome.
7. **Leitura pelo `dotenv`, não por regex própria** (nos dois arquivos novos). O parser improvisado que já se repete em 4 scripts deste repo devolve o `\r` **dentro do valor** em arquivo CRLF — e o `.env.example` é CRLF. Numa máquina Windows (esta), a suíte e2e falharia em todo login e a rotação abortaria sempre: a ferramenta escrita para este sistema operacional não funcionaria nele. Chave repetida também é recusada: o `dotenv` usa a última linha e um `replace` trocaria a primeira, deixando app e banco com senhas diferentes.

**O que isto NÃO resolve, e é do dono:** as mesmas 4 contas existem **em produção**. Se o `.env` do servidor tem o valor vazado e alguma delas nunca definiu senha própria (o `root@` primordial é o candidato: ninguém o usa para entrar), a senha vazada entra como ROOT em produção. Rotacionar aqui não alcança lá — e consultar o banco de produção é bloqueado por regra.

**A revisão de segurança (obrigatória, por tocar autenticação) derrubou a primeira versão em três pontos, e os três eram a mesma classe de erro: acreditar na própria premissa sem varrer o repositório.** O literal continuava em `demo-seed.ts` (executável) e em 4 documentos versionados — inclusive **neste arquivo**, na ADR‑77, onde a senha aparecia por extenso ao lado de uma ADR que afirmava que ela havia saído do repositório. E a trava de ambiente protegia contra o cenário imaginado (banco remoto), não contra o real (produção é localhost).

**Verificado:** bateria de 13 casos contra um banco descartável com o schema real, cobrindo o que a revisão levantou — recusa `NODE_ENV=production`, recusa chave repetida, banco fora do ar restaura o arquivo e não deixa backup, funciona em CRLF sem sujar o valor, **não imprime a senha nova em lugar nenhum**, a conta semeada passa a autenticar com a nova e não mais com a antiga, quem tinha senha própria não é tocada, e rodar sem ninguém usando a senha atual recusa em vez de fingir sucesso. Somado: `@app/api` 242 testes · `@app/web` 111 · typecheck 6/6 sem cache · `pnpm lint` 0 erros · **`e2e` 84/84** no banco isolado (a rodada anterior à correção do `demo-seed` caía por falta de senha nas contas de exemplo, exatamente como a revisão previu).

## ADR-99 — Fases 2D‑2 e 2D‑3: o e‑mail vira trabalho (anexo → documento do cliente, remetente → lead) ✅

**Contexto:** com a 2D‑1 (ADR‑97) a correspondência já *aparecia* na ficha, mas ainda não *virava* nada. Os dois buracos estavam nomeados desde o desenho: o anexo que chega por e‑mail continuava exigindo baixar no computador e subir de novo pela ficha, e quem escrevia pela primeira vez não entrava no funil sem alguém redigitar nome e e‑mail. O campo `EmailAnexo.arquivoId` já existia no schema desde o Bloco 1 — **morto, sem nenhum código que o escrevesse**.

**Decisões:**

1. **Um lugar só para as duas ações** (`modules/email/acoes.service.ts`). Ler (`leitura`), escrever (`envio`) e vincular (`vinculo`) já eram papéis separados; "o que a equipe FAZ a partir de um e‑mail" é o quarto, e as duas ações compartilham exatamente as travas que importam.
2. **A posse vai no `where`, como no resto do módulo.** As duas são de escrita e nascem de um id que veio da tela: a mensagem tem de ser da caixa de quem clicou, conferido dentro da própria consulta — nunca numa comparação depois da leitura. Dois testes cobrem isso com a caixa de outra pessoa, e um terceiro afirma o formato do `where` para que apagar a trava fique vermelho.
3. **A trava da casa (ADR‑97) vale nas duas pontas.** Endereço do nosso domínio não vira chave de nada: nem acha cliente (senão bastaria pôr `contato@medconsultoria.com.br` num cadastro descartável para que todo e‑mail interno "pertencesse" àquele cliente), **nem vira lead** — sem isso a primeira conversa entre colegas encheria o funil de leads falsos com o nome da própria equipe. Reusa `casa.ts` inteiro, sem segunda implementação.
4. **Nada duplica, e a resposta ao clique repetido é o objeto que já existe** — não um erro. Anexo já guardado devolve o mesmo documento sem tocar no IMAP; remetente com lead ativo devolve o lead dele. O elo só vale se o documento **ainda existe**: quem apagou o arquivo da ficha e clicou de novo está pedindo para guardar outra vez, não para receber o id de um registro que sumiu (`Arquivo` é soft‑delete).
5. **A allowlist de tipo vale aqui, ao contrário do anexo de SAÍDA (ADR‑96).** Parece incoerência e não é: o anexo de saída é o que a pessoa precisa mandar (`.zip`, `.dwg`, `.p7s`) e nunca é servido pelo nosso domínio; o anexo que vira **documento do cliente** entra num acervo que o Portal serve com o `Content-Type` do banco, então o que ele aceita é o que `/upload` aceita — PDF, imagem, Word e Excel. O `Content-Type` do e‑mail vem com parâmetros (`application/pdf; name="…"`), então a comparação é sobre a parte base, em minúsculas.
6. **Gravar DENTRO do `comCaixa`** — a mesma lição que a rota de download já tinha pago: a conexão IMAP fecha quando o callback retorna e `download()` resolve depois do **primeiro pedaço**, com o resto ainda vindo pelo socket. Devolver o stream para fora e gravar depois entregaria arquivo cortado. E o teto de 20 MB é conferido **pelo que foi para o disco**, não pelo `tamanho` do índice: aquele é metadado do servidor de e‑mail e pode mentir; acima do teto, a gravação é desfeita em vez de deixar arquivo órfão no acervo.
7. **`enviadoPorTipo: "EQUIPE"`, ainda que o arquivo tenha vindo do cliente.** O campo responde "por qual porta entrou", e a porta é a caixa de alguém da casa. Marcar `CLIENTE` dispararia o aviso de "cliente enviou documento" para a equipe inteira toda vez que alguém arquivasse um anexo antigo.
8. **O lead nascido de e‑mail não mente sobre a própria origem.** `createLead` ganhou um terceiro parâmetro opcional (`rastreioPronto`); sem ele, todo lead vindo de outra porta gravaria *"Cadastrado manualmente no sistema"* no campo que existe justamente para responder de onde a pessoa apareceu. A deduplicação é a mesma da captação pelo site: só lead **ativo** bloqueia (apagado ou já convertido não impede negócio novo).
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

| Achado | Por que não foi feito agora |
| ------ | --------------------------- |
| **Dinheiro em `Float`** — `Servico.valor`/`percentual`, `ClienteServico.valor`/`percentual` e `Lead.valorEstimado` são `Float` (só `Conta.valor` é `Decimal`). Eles são somados em JS e o resultado vai para o **texto do contrato** e para a conta a receber: três serviços podem somar `1621.0000000000002`. | Migration de tipo + trocar as somas em `leads.service.ts` e `documentos.service.ts`. Escopo médio, mexe em dinheiro e em documento assinado — merece branch e revisão própria, não pegar carona. |
| **Trecho do e-mail na ficha** — qualquer FUNCIONARIO pode pôr um endereço externo no cadastro de um cliente e ler, pela ficha, os 200 caracteres iniciais das mensagens que a equipe trocou com aquele endereço. | O ADR‑97 **escolheu** mostrar o trecho à equipe. Estreitar (ex.: trecho só ADMIN+) é mudança de produto, do dono. Vale junto registrar em `ActivityLog` a troca de `Cliente.email`/`Contato.email` — hoje trocar a chave da consulta não deixa rastro. |
| **Token de assinatura do cliente visível ao funcionário** (`assinaturas.doDocumento`) — permite assinar em nome do cliente, e a trilha grava o IP de quem assinou como se fosse o dele. | É o mesmo token do botão "Abrir link", funcionalidade documentada ("você escolhe se envia por e‑mail ou copia o link daqui"). Restringir muda o fluxo de trabalho e o valor probatório é assunto jurídico — decisão do dono. |
| **Índice de `Notificacao`** — a consulta do sino filtra por `userId` e ordena por `createdAt`, e o índice é `(userId, lida)`: sobra filesort. Roda em polling, para toda sessão aberta. | Volume atual é baixo e não há expurgo de notificação antiga. Vale entrar junto da próxima migration, não sozinha. |
| **`CaixaEmail.assinatura`** — lido no envio, escrito por ninguém: a assinatura por caixa está pela metade desde o ADR‑96. | Precisa de campo na tela de plugar/editar caixa; é funcionalidade nova, não conserto. |
| **`clientes.excluirDefinitivo` e `clientes.arquivarNota`** — existem no back, sem botão. | Decidir se viram tela ou saem do código. |
| **Suíte `@app/web` intermitente** — uma execução a partir da raiz deu 8/12 arquivos e 4 erros; não reproduziu nas tentativas seguintes (rodando dentro de `apps/web` sempre passou). | Precisa de repetição para pegar o padrão. Fica registrado para não ser tratado como novidade quando reaparecer na CI. |
| **`/avatar/:userId`** serve a foto de qualquer usuário para qualquer sessão, inclusive cliente do Portal. | Enumeração de fotos da equipe. Risco baixo, mas é fronteira do Portal — vale fechar quando alguém tocar o módulo. |

---

## ADR-100 — Quem escolhe o endereço escolhe o que a consulta devolve (fechando a chave envenenável) ✅

**Contexto:** auditoria de segurança de 05/08/2026, disparada pelo pedido do dono de garantir a aplicação inteira. O ADR‑97 documentou, com todas as letras, que o endereço do cadastro é **chave de consulta** do histórico de e‑mail (`chaveDeEndereco` em `emails/enviados.service.ts`; `clientesPorEnderecos` em `email/acoes.service.ts`) e que por isso *"bastava pôr `root@…` no cadastro para listar, de dentro do Portal, os transacionais mandados a uma conta interna"*. A trava criada na época — `ehDaCasa` — barra endereço **do nosso domínio**. Ela nunca barrou o endereço **de outro cliente**, e o Portal deixava o próprio cliente gravar o campo (`portalMeusDadosSchema`, ADR‑80, "direito de retificação").

**A falha, reproduzida em teste antes de qualquer correção:** o cliente A abre "Editar perfil" no Portal, grava no próprio cadastro o e‑mail do cliente B e passa a enxergar, em `portal.emails`, tudo o que a empresa mandou para B — destinatário, assunto, tipo de mensagem, data, status e motivo de falha. O corpo continua protegido; o metadado atravessa a fronteira entre clientes, que é justamente a fronteira que o Portal existe para manter. O mesmo campo é a chave que decide de quem é o cliente ao guardar um anexo recebido: pondo no cadastro o endereço de um terceiro que escreve para a empresa, o cliente A se torna o **único** candidato e o anexo daquele terceiro vira documento dele, baixável pelo Portal.

**Decisões:**

1. **O Portal não grava mais o e‑mail do cadastro.** O campo saiu do `portalMeusDadosSchema` — é o *schema* que derruba o campo, não a boa vontade da tela: quem ataca não usa a tela. Nome, tipo, CPF/CNPJ e telefone continuam editáveis; a retificação do e‑mail passa a ser pedida à equipe, que é quem tem o histórico para saber o que aquela troca significa. A tela do Portal mostra o endereço em campo desabilitado, dizendo em português onde pedir a troca — campo que some sem explicação vira chamado de suporte.
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
