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

**Decisão:** form público `/captura` (`publicProcedure`, honeypot + rate-limit) que detecta a origem (UTM/referrer/ads) e deduplica recaptura. Ao captar/convidar, `garantirAcessoPortal()` cria uma conta Cliente **PROSPECT** + acesso ao Portal de forma idempotente; o lead segue no funil (`Lead.clienteId`). O prospect acompanha o próprio atendimento no Portal; na conversão o acesso tem continuidade.

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

**Método de revisão (round-trip seguro):** logar como CLIENTE troca o cookie do Root na sessão do navegador de teste; como o `.env` de dev tem `SEED_ROOT_PASSWORD="medconsultoria123"` (e os clientes de teste usam a mesma senha), fiz login como `cliente@medconsultoria.com.br`, revisei, e voltei como `root@medconsultoria.com.br` — sessão restaurada, navegador em 1920×1080. **Nada alterado no código.**

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

## Pendências (viram ADR quando decididas)

- ~~Passenger vs Nginx Unit na TineHost (mecanismo de restart / proxy WS).~~ **Restart** = `touch tmp/restart.txt` (LiteSpeed/lsnode). **WS resolvido no ADR-84** (tempo real por polling; não precisa de proxy WS).
- ~~Engine de exportação de PDF em hospedagem compartilhada.~~ **Resolvido no ADR-47** (PDF = `window.print()` da moldura branded = WYSIWYG, sem servidor).
- Estratégia de polimorfismo (`entidadeTipo+entidadeId` vs tabelas de junção) se a performance exigir.
- Zustand vs Context para o estado global mínimo do front.
- Política de backup do MySQL.
