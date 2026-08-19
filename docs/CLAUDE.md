# CLAUDE.md — Workspace MedConsultoria

> **Fonte de verdade viva do projeto.** Sempre que uma decisão arquitetural, de UX ou de negócio for tomada, atualize este arquivo. Se o código e este documento discordarem, um dos dois está errado — investigue e reconcilie.
>
> Ordem de leitura para entrar no projeto: este arquivo → `ARCHITECTURE.md` → `DATABASE.md` → `UI_GUIDELINES.md` → `ROADMAP.md`. `DECISIONS.md` explica o *porquê* de cada escolha.

---

## 1. Visão geral

O Workspace MedConsultoria é o **cérebro operacional interno** da empresa MedConsultoria. **Não é um SaaS**, não será vendido, não é multi-tenant. Existe para **acabar com o caos operacional** — hoje a informação vive espalhada em WhatsApp, e-mails, agenda, cadernos, planilhas e na memória das pessoas.

Hospedado em **https://workspace.medconsultoria.com.br** (o site institucional é separado).

**Pergunta-guia de todo o produto:**

> **"Como fazer a Thaís trabalhar com muito menos estresse?"**

Toda feature é avaliada contra essa pergunta. Se não reduz estresse/caos ou não aumenta produtividade, provavelmente não deve existir agora.

**Princípios inegociáveis:** simplicidade > esperteza; poucos cliques; interface limpa (nada de telas com informação inútil); um funcionário novo aprende praticamente sozinho.

---

## 2. Usuários e papéis (RBAC)

| Papel                  | Quem              | Acesso                                                                         |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------ |
| **ROOT**         | Thiago, André    | Controle total + acesso técnico                                               |
| **ADMIN**        | Thaís (dona)     | Controle completo da empresa, sem funções técnicas                          |
| **FUNCIONÁRIO** | Equipe            | Somente o necessário para seu trabalho                                        |
| **CLIENTE**      | Leads convertidos | Portal do Cliente — vê **apenas** o que é dele, nunca dados internos |

Regra de ouro de segurança: **default-deny**. Nenhum endpoint/mutação sem checagem de autenticação **e** autorização (papel + posse do recurso). Nunca confiar em ID, papel ou escopo vindo do cliente.

---

## 3. Stack

| Camada       | Tecnologia                             | Motivo (resumo — detalhe em DECISIONS.md)     |
| ------------ | -------------------------------------- | ---------------------------------------------- |
| Monorepo     | pnpm workspaces + Turborepo            | Compartilhar tipos/schemas front↔back         |
| Frontend     | Vite + React + TypeScript              | SPA interno (SEO não é requisito)            |
| UI           | TailwindCSS + shadcn/ui                | Design system consistente, baixa manutenção  |
| Data (front) | TanStack Query + TanStack Router       | Type-safe, integra com tRPC                    |
| Forms        | react-hook-form + Zod                  | Reusa schemas de`packages/shared`            |
| API          | **tRPC** sobre **Fastify** | Type-safety ponta-a-ponta, mínimo boilerplate |
| Real-time    | **Polling** (`refetchInterval`) em prod; Socket.IO em dev | Hospedagem não faz upgrade de WebSocket (ADR-84); socket desligado no build de prod, religa com `VITE_REALTIME=1` |
| ORM          | Prisma                                 | DX excelente, tipos gerados                    |
| Banco        | MySQL (utf8mb4)                        | Requisito da hospedagem                        |
| Auth         | Cookie httpOnly assinado + argon2id    | Sem token em localStorage (anti-XSS)           |
| Hospedagem   | TineHost / DirectAdmin (Node + MySQL)  | Requisito                                      |

**Proibido:** .NET. **IA:** `AiService` real, provedor **OpenAI (gpt-4o-mini)** — usada em Documentos (gerar/melhorar/resumir), **transcrição de áudio** (`whisper-1`, em Ata/Pauta/Gerar com IA) e no assistente de busca; aprovação humana sempre obrigatória (a IA nunca envia documento).

---

## 4. Arquitetura (resumo)

**Um único app Node deployável.** O Fastify serve, no mesmo processo e porta: (a) a API tRPC em `/trpc`, (b) o SPA buildado (`apps/web/dist`) como estático, (c) o WebSocket (Socket.IO). Isso encaixa no DirectAdmin, que espera **um startup file** (`apps/api/dist/server.js`).

```
apps/
  web/     SPA: Vite + React + TS + Tailwind + shadcn
  api/     Fastify + tRPC + Socket.IO → compila para dist/server.js (o deployável)
packages/
  db/      Prisma schema + client (MySQL)
  shared/  Zod schemas + tipos + constantes (validação única front+back)
  ui/      design tokens + componentes shadcn temáticos
```

Detalhes completos em `ARCHITECTURE.md`.

---

## 5. Padrões e convenções

**Código** (ver global CLAUDE.md também): SOLID, Clean Code, tipagem forte, baixo acoplamento, alta coesão, componentização, reutilização. Mudanças cirúrgicas — cada linha alterada rastreia até um requisito.

**Camadas do backend** (por módulo): `router` (tRPC, validação Zod + authz) → `service` (regra de negócio, sem saber de HTTP) → `db` (Prisma). Serviços são testáveis isoladamente.

**Nomenclatura:**

- Arquivos/pastas: `kebab-case`. Componentes React: `PascalCase`. Variáveis/funções: `camelCase`.
- Tabelas/colunas: seguem a convenção do Prisma (models `PascalCase`, campos `camelCase`; mapear para `snake_case` no banco via `@map` se necessário — decidir em DATABASE.md).
- Routers tRPC por domínio: `clientesRouter`, `projetosRouter`, etc., compostos no `appRouter`.

**Validação:** todo input de procedure passa por um schema Zod de `packages/shared`. O mesmo schema alimenta o formulário no front. Uma fonte de verdade.

**Erros:** usar `TRPCError` com códigos semânticos (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`). Nunca vazar detalhes internos/stack para o cliente.

**Datas/fuso:** armazenar em UTC; exibir em `America/Sao_Paulo`. Datas relativas no código são proibidas em dados persistidos — sempre absolutas.

**Rótulos de formulário (convenção):** marque só os **obrigatórios** com `*` (ex.: "Nome *"); os opcionais **não** levam sufixo — nada de "(opcional)" em `<Label>` (além de poluir, quebra o layout em grids de meia largura). Em **placeholders** (dentro do campo) "(opcional)" é permitido como dica inline, pois orienta sem desalinhar.

**Formatação na UI (pt-BR) — use SEMPRE os helpers centrais, nunca reimplemente:** dinheiro → `formatBRL`/`formatBRLCompact` (exibir) e `MoneyInput` (entrar), de `lib/masks`; data/hora → `dataHora`/`data`/`dataCurta`/`hora`/`dataUTC`/`haQuanto` de `lib/format-date` (fuso fixo `America/Sao_Paulo`; `dataUTC` para campos date-only como vencimento/prazo); telefone/CPF/CNPJ → `maskTelefone`/`maskCpfCnpj` (exibir) e `MaskedInput` (entrar). Ver ADR-32.

**Commits:** `feat/fix/refactor/docs/test(escopo): descrição`. Atômicos. Branch antes de commitar na `main`. Commit/push só quando pedido.

**Testes:** TDD por padrão. Vitest para serviços/procedures; Playwright para E2E dos fluxos críticos.

---

## 6. Decisões técnicas (índice)

As decisões abaixo estão registradas com contexto completo em `DECISIONS.md`:

1. tRPC + Fastify (em vez de NestJS ou REST puro) — velocidade e type-safety.
2. Monolito de 1 processo servindo API + SPA + WS — encaixe no DirectAdmin.
3. Deploy por SSH + rsync (TineHost não tem Git no servidor).
4. Sessão por cookie httpOnly (não JWT em localStorage).
5. IDs `cuid` não-sequenciais.
6. IA (`AiService`) real sobre **OpenAI** — decisão de custo (Claude/Anthropic era a recomendação original); aprovação humana sempre.
7. Chat adiado (na origem); notificações real-time cedo — chat entregue na Fase 6.
8. Busca global interna (módulo `busca`) + assistente de IA (`ia.perguntar`) dentro da paleta de busca (Ctrl+K).
9. Autocomplete (`Combobox`) como padrão de seleção de entidades (cliente em projeto/conta/evento/documento/portal).
10. RBAC de gestão de usuários por **menor privilégio**: só se gerencia papel estritamente abaixo do próprio (só ROOT cria ADMIN); ninguém altera o próprio papel.
11. Notificações proativas e clicáveis (scan no servidor, dedup por entidade) — ADR-12.
12. Endurecimento de segurança: Helmet + rate-limit + throttle de login — ADR-13.
13. **Funil inteligente:** playbook por etapa + passos por serviço + passos automáticos (derivados/evento) + geração de documentos — ADR-14.
14. **Captação pública + acesso automático ao Portal do prospect** (lead acompanha desde o 1º contato) — ADR-15.
15. **E-mails transacionais** unificados com as notificações (`notificar()`), templates branded editáveis + histórico + opt-out — ADR-16.
16. **Assinatura eletrônica avançada** (Lei 14.063/2020) própria, por link + hash de integridade — ADR-17.
17. **Observabilidade embutida** (ErrorLog/Incidentes/RED) no painel Sistema do ROOT — ADR-18.
18. **Lead perdido + relatório de ganho/perda**; conversão integra Financeiro (conta a receber) e Agenda (kickoff) — ADR-19.
19. **Livre-arbítrio do prospect:** desistir/retomar o atendimento pelo Portal (vira lead perdido/reaberto, avisa a equipe) — ADR-20.
20. **Monitor de e-mails enviados** (ROOT/ADMIN): entregas, falhas e o motivo de cada falha em `/emails-enviados` — ADR-21.
21. **Situação do cliente = placar do funil** (automática, só-leitura; cliente ATIVO nunca vira lead; botão "Nova oportunidade" para upsell) — ADR-22.
22. **Nova Oportunidade Inteligente + Autosserviço no Portal**: a oportunidade nasce com os serviços que o cliente quer (card + checklist prontos); o cliente escolhe serviços no Portal → vira oportunidade no funil e avisa a equipe — ADR-23.
23. **Separar Leads (Funil) de Clientes**: Funil = leads/prospects; Clientes = só clientes (Ativo/Inativo, com toggle manual); confirmação em todas as exclusões — ADR-24.
24. **Confirmação com escolha de e-mail (opt-in)**: toda ação da equipe que mandaria e-mail ao cliente/lead abre um pop-up com checkbox "enviar e-mail?" (criar cliente, converter, solicitar assinatura, evento com cliente); cliente sem serviço recebe um *nudge* na ficha — ADR-25.
25. **Serviços contratados + exigências + upload (Fase 1A)**: `ClienteServico` (fonte da verdade dos contratados; equipe liga/desliga na ficha, cliente cancela pelo Portal, funil gera na conversão); `ServicoRequisito` (checklist de documentos por serviço, com exemplos-semente editáveis); upload de arquivos em pasta (`@fastify/multipart`, `/upload` + `/arquivos/:id` autenticados com posse) — ADR-26.
26. **Catálogo real (categorias + valor) + biblioteca de documentos**: `Servico` ganhou `categoria`/`valor`; catálogo granular nos 5 pilares (Gestão/Faturamento/Networking/Desenvolvimento/Marketing, com Dev×Marketing separados); 13 modelos de documento reais (`{{variáveis}}`), seed por nome — ADR-27.
27. **Formulários/briefings online (Fase 1B)**: `Formulario`+`FormularioCampo`+`FormularioResposta`; o cliente preenche na tela pelo Portal (rascunho/enviar) OU baixa; construtor sem código na aba **Formulários** da página Documentos; requisito BRIEFING liga a um formulário — ADR-28.
28. **Documentos mais claro + Proposta inteligente**: `Servico.valor` (preço de referência); "Nova proposta" monta o documento a partir dos serviços escolhidos (preços do catálogo, editáveis, total automático, apresentação por IA); abas com descrição — ADR-29.
29. **IA em toda a app (a IA sugere, você aprova)**: Serviços (sugerir exigências), Formulários (sugerir perguntas), Ficha (resumir cliente + próximos passos), Funil (próximo passo + escrever e-mail) — além do que já existia (documentos, ata, proposta, busca). `AssistenteIADialog` reutilizável — ADR-30.
30. **Página Serviços reformulada + 3º tipo de exigência**: card limpo (contadores clicáveis + **um** botão "Configurar") com diálogo de abas **Detalhes · Exigências · Passos**; novo tipo **`INFORMACAO`** (o cliente escreve na tela) que reaproveita o fluxo de briefing via um `Formulario.interno` de pergunta única — ADR-31.
31. **Formatação pt-BR centralizada**: helpers únicos — dinheiro `formatBRL`/`formatBRLCompact` + `MoneyInput` (`lib/masks`); data/hora `dataHora`/`data`/`dataCurta`/`hora`/`dataUTC`/`haQuanto` (`lib/format-date`, fuso fixo `America/Sao_Paulo`); telefone/CPF/CNPJ `maskTelefone`/`maskCpfCnpj`. Toda a app importa desses pontos (fim dos formatadores locais duplicados) — ADR-32.
32. **Precificação flexível de serviços**: `Servico` ganhou valor fixo + `valorRecorrencia` e `percentual` + `percentualRecorrencia` (enum `PrecoRecorrencia { AVULSO, MENSAL }`); um serviço pode ter valor fixo e/ou % do faturamento, cada um avulso ou mensal. A % só aparece na UI para o **Faturamento**. Rótulo `formatPreco` ("R$ 1.800,00/mês", "5% do faturamento/mês", "R$ 500,00 + 5% do faturamento/mês") — ADR-33.
33. **Documentos bonitos + proposta digital**: moldura branded única (`DocumentoBranded`, folha A4, Markdown via `marked`) serve tela/Portal/impressão → **PDF WYSIWYG sem servidor**; 13 tipos + 18 modelos-semente em Markdown; **proposta com aceite/recusa online** (link público `/proposta/{token}` + Portal, hash de integridade, avança o funil, notifica) — ADR-47.
34. **Padronização visual**: **largura única** (toda página preenche o container global `max-w-[1600px]`, nenhuma impõe a própria); documento em **folha A4** (proporção `aspect-[210/297]`, escala de tela ~640px; impressão A4 real) **sem scroll interno**; **breadcrumbs** no cabeçalho (derivados da rota + `useDynamicCrumb` nas fichas); **matriz de interação** (`DOC_INTERACAO`: assinatura=**só contrato** · aceite=proposta · nenhum=escopo/demais/briefing) — ADR-48.
35. **Página Documentos = arquivo × configuração**: `/documentos` vira o **arquivo** (busca + filtros) e volta ao menu "Dia a dia"; **Modelos** (`/modelos`) e **Briefings** (`/formularios`) vão para **Ajustes**. **Editar** de documento lapidado (`DocumentoEditor`: barra de formatação + atalhos + preview A4 ao vivo sem scroll, tudo sticky) — ADR-49.
36. **"Novo documento" inteligente + página proativa**: um só ponto de criação type-aware (`NovoDocumentoDialog`) — Proposta=construtor de serviços, Ata=IA resume anotações, Pauta=IA gera pauta com contexto do cliente (`gerarPautaReuniao`), demais=preencher/IA; absorve "Nova proposta" e "Resumir reunião" (a **reunião vira documento**: Pauta antes, Ata depois) — ADR-50.
37. **Situação COERENTE do documento + página definitiva + automação**: `situacaoDocumento()` funde fluxo+aceite+assinatura numa situação única usada em toda a app (arquivo/detalhe/ficha/funil/Portal); página com 5 colunas + filtros + faixa "Precisa de atenção" **persistente**; **geração automática** de proposta (etapa "Proposta") e contrato (etapa "Negociação"/conversão) → nascem **EM_REVISÃO** + notificam — ADR-51.
38. **Modelos finalizados + Briefing = formulário interativo unificado em Modelos**: cada modelo edita numa página própria (`ModeloDetailPage`) com editor+preview A4 ao vivo; página Modelos por finalidade. **Briefings = formulários interativos** (campos texto/listbox/checkbox/etc. que o cliente responde na tela) geridos **dentro de Modelos** (construtor `CamposDialog`); removidos os briefings de texto e a página/card "Briefings e formulários" do Ajustes — ADR-49/52.
39. **Áudio → texto (Whisper)**: gravar pelo microfone **ou** enviar arquivo de áudio e a IA transcreve (rota `POST /transcrever` só-equipe; `aiService.transcrever` com `whisper-1`/pt). Componente `AudioTranscricao` ligado no "Novo documento" nos modos **Ata**, **Pauta** e **Gerar com IA** (anexa a transcrição ao campo, para revisão humana) — ADR-53.
40. **Cada documento espelha o seu modelo**: a apresentação genérica da proposta só entra quando o modelo tem `{{apresentacao}}` — **Proposta de credenciamento** traz abertura própria + **operadoras reais** (≠ comercial desde a 1ª linha); `gerarParaLead(proposta)` usa o construtor real (sem `{{servicos}}` cru); `gerarParaLead(contrato)` pré-preenche objeto/valor/prazo/foro; fallback do `render` = `*(a preencher)*` (fim dos `[campo]`); Contrato com reajuste (IPCA) + multa. Portal/ficha/funil refletem o `conteudo` corrigido — ADR-54.
41. **Preview A4 de verdade + prévia no "Novo documento"**: o `DocumentoBranded` deixou o `aspect-ratio` forçado (que vazava/esticava) → **largura A4 (620px) + altura natural + linhas-guia de página** (multipágina), com estilos de tela (`PREVIEW_STYLES`) separados da **impressão A4 real** (`@page A4`, sem vazamento). O diálogo **Novo documento** (modal `2xl`) mostra o **preview A4 ao vivo do modelo** ao lado do formulário — comercial × credenciamento ficam visivelmente diferentes ao criar (`previewModelo` exportado do `DocumentoBranded`) — ADR-55.
42. **Formulário próprio da Proposta de credenciamento**: cada modelo de proposta declara o que precisa — o corpo do credenciamento tem `{{operadoras}}`, então o diálogo troca o catálogo de serviços pelo **`CredenciamentoPicker`** (selecionar **operadoras** reais de `OPERADORAS_COMUNS` + adicionar outras + **investimento por operadora** com total ao vivo). `criarProposta` tem 2 trilhas (serviços × operadoras); `criarPropostaSchema` ganhou `operadoras`/`valorPorOperadora` (e `itens` opcional). Credenciamento **não** tem "Serviços da proposta" — ADR-56.
43. **Preview paginado + Recibo/Plano com formulário próprio + operadoras editáveis**: o `DocumentoBranded` faz **paginação real** (folhas A4 SEPARADAS com espaço entre elas, mede e distribui os blocos; `zoom` para caber sem espremer) — fim de "páginas coladas"/"conteúdo espremido"; impressão segue A4 real. **Recibo** = formulário próprio (valor + forma + referente + **valor por extenso automático** `valorPorExtenso`). **Plano de ação** = objetivo + **ações dinâmicas** (adicionar/excluir → tabela `{{acoes}}`). **Operadoras** agora **editáveis e excluíveis** (`CredenciamentoPicker`) — ADR-57.
44. **Catálogo de operadoras + TODOS os documentos inteligentes**: model **`Operadora`** (catálogo persistente, semeado com `OPERADORAS_COMUNS`) — o `CredenciamentoPicker` **renomeia e exclui permanentemente** (router `documentos.operadoras`). **`SmartCampos`**: o "Preencher campos" (Escopo/Diagnóstico/Relatórios/Onboarding/Checklist…) virou form **type-aware** (rótulo legível + dinheiro `MoneyInput`/percentual/`Textarea` inferidos pelo nome do campo) com preview ao vivo — ADR-58.
45. **"Cabe na tela" global + Pauta de postagem dinâmica + Lista da Agenda inteligente**: no `AppLayout`, **`<main>` = viewport** (`overflow-hidden`) e o **container interno = scroll** — páginas `flex h-full flex-col` fecham na tela (scroll só por dentro), demais rolam pelo container. Camada de medição do `DocumentoBranded` virou **`position:fixed`** (fim do "scroll gigante" no modal/preview). **Agenda Lista**: dropdowns mês/ano + cabeçalhos de dia fixos + auto-scroll para hoje. **Pauta de postagem**: linhas de post dinâmicas (`PautaPostagemFields` → tabela `{{postagens}}`). Regra: página de visão/lista usa `flex h-full flex-col` + `flex-1 min-h-0` no conteúdo (ADR-44) — NUNCA voltar `<main>` a `overflow-y-auto` — ADR-59.
46. **Data dd/mm/aaaa em toda a app + auditoria de CRUD**: `lib/format-date` sem `dataCurta` (sem ano) → só `data` (**dd/mm/aaaa**) + `dataExtenso`/`diaSemana` (por extenso). Aplicado em Agenda/Dashboard/Projetos/Clientes/Portal/Mensagens/Ficha. Auditoria de CRUD (3 subagentes): confirmação ao remover foto do Portal / participante de grupo / desativar serviço; **renomear origem** na UI; Cancelar no briefing do Portal; rodapé "Concluído" nos gerenciadores (Categorias/ServicoConfig/Campos); `CardPanel.remove` invalida projetos. Regra: **toda ação destrutiva confirma (`useConfirm`) e todo popup tem Salvar/Cancelar (`footer`)** — ADR-60.
47. **Funil auto-avança pelo checklist + salvamento explícito**: `avancarSeChecklistCompleto` (leads.service) move o card sozinho quando **todos os passos obrigatórios da etapa** estão feitos — só-para-frente, cascata, ao entrar semeia checklist/gera docs; gatilhos: `togglePasso` (equipe, devolve `{avancou}` → toast no `LeadDetailPanel`) e `assinaturas` (sistema/cliente ao assinar). **CategoriasDialog** com **staging**: adicionar/editar/excluir só no rascunho local; grava tudo só no "Salvar alterações" — ADR-61.
48. **Staging em Origens/Operadoras + Esc do modal-sobre-modal**: `OrigensDialog` e o novo `OperadorasDialog` ganharam **salvamento explícito** (rascunho local + "Salvar alterações"; Origens inclui reordenar por arraste). O `CredenciamentoPicker` virou **só seleção** + botão "Gerenciar operadoras" (abre o diálogo dedicado). O `Modal` usa **um listener global de Esc + pilha de onClose** → Esc fecha só o modal do TOPO (resolve modal-sobre-modal) — ADR-62.
49. **Refino Header/Menu (revisão página a página, 1ª etapa)**: menu "Ajustes" acende nas páginas-filhas (`itemAtivo`+`AJUSTES_FILHOS`, destaque manual); header mobile mostra o **título da página** + busca vira ícone (breadcrumb some no celular); atalho da busca ciente do SO (⌘K/Ctrl K), `aria-keyshortcuts`, foco visível e `aria-label`. Próximo: revisar todas as páginas com o mesmo rigor — ADR-63.
50. **Início personalizável (revisão página a página, 2ª etapa)**: cada bloco do Dashboard virou **widget** (`WidgetCard`) com **recolher/expandir** (chevron) e cabeçalho padronizado; botão **"Personalizar"** (dropdown com checkboxes agrupados "Meu dia"×"Gestão" + "Padrão") liga/desliga widgets; **layout reflui sozinho** (grid responsivo). Preferências **por usuário** em `localStorage` (`dashboard-prefs:v1:<userId>`, hook `useDashboardPrefs`). Mantém role-awareness (Gestão só ADMIN/ROOT; Sistema/IA condicionais). Próximo: Vendas — ADR-64.
51. **Vendas — clareza na busca vazia (revisão página a página, 3ª etapa)**: coluna vazia diz "Sem resultados nesta etapa" quando há busca/filtro (antes: sempre "Arraste um lead para cá"); botão "Limpar" zera busca + filtro de responsável juntos. Funil já era maduro — só microajustes de clareza. Próximo: Clientes — ADR-65.
52. **Clientes — "Limpar" busca/filtros (revisão página a página, 4ª etapa)**: botão "Limpar" na barra (some quando não há filtro) + "Limpar filtros" no estado vazio filtrado. Lista e ficha já eram excelentes — ficha intocada. Próximo: Projetos — ADR-66.
53. **Projetos — "Limpar" busca/filtros (revisão página a página, 5ª etapa)**: mesmo padrão — botão "Limpar" na barra + "Limpar filtros" no estado vazio filtrado. Lista (com ordenação por urgência) e ficha kanban já eram excelentes — ficha intocada. Próximo: Agenda — ADR-67.
54. **Agenda — consistência de busca/limpar (revisão página a página, 6ª etapa)**: lupa no campo de busca + "Limpar filtros" virou botão com borda+X (antes link de texto). Sem mudança funcional — 5 visões + TimeGrid + arraste já eram excelentes. Próximo: Mensagens — ADR-68.
55. **Sistema de alertas — Fase 1: conflito de horário visível**: `verificarConflitos` passou a checar a agenda dos PARTICIPANTES (retorna de-quem-é o conflito); conflito agora aparece na GRADE do calendário (anel âmbar+⚠ em TimeGrid/Mês/Lista) + banner-contador "N eventos com conflito neste período". Só avisa, nunca bloqueia. Fase 2 (lacunas: projetos parados/sem responsável, contas a vencer, upsell, ícones do sino) pendente — ADR-69.
56. **Sistema de alertas — Fase 2 + blindagem**: chips novos no "Precisa da sua atenção" (conflito de agenda, contas a vencer 7d, projetos parados +14d, documento parado aguardando o cliente); `scanProativo` estendido (sino) com `conflito_agenda`/`projeto_parado`/`projeto_sem_responsavel`/`upsell_oportunidade`/`documento_parado`/`lead_parado` (deduplicados, `.catch` por item, templates no `emails.registry`; janela de contas alinhada a 7d); ícones do sino completos. **Blindagem:** refine `fim > início` no schema do evento (server+form, extraído `eventoBase`, router usa `.and()`) + `ErrorBoundary` de render em volta do `<App>` (complementa MutationCache→toast e QueryError) — ADR-70.
57. **Início — fix do recolhimento dos widgets**: grids do Dashboard ganharam `items-start` (antes `align-items: stretch` esticava o widget recolhido até a altura do vizinho → card alto e vazio). Agora recolher encolhe ao cabeçalho — ADR-71.
58. **Mensagens — acabamento de chat (revisão página a página, 7ª etapa)**: balões recebidos legíveis (borda + fundo da thread `bg-muted/30`; antes branco-no-branco invisível), separadores de dia (Hoje/Ontem/data), agrupamento de mensagens do mesmo autor, estado vazio acolhedor (+ "Nova conversa"), e **responsivo mobile** (1 coluna: lista OU thread + botão voltar). Página já era funcional; faltava polish visual — ADR-72.
59. **Documentos — "Limpar" busca/filtros (revisão página a página, 8ª etapa)**: botão "Limpar" na barra + "Limpar filtros" no estado vazio filtrado. Lista (faixa de atenção + situação coerente) e ficha (A4/aceite/assinatura) já eram maduras — ficha intocada. Modelos/Briefings ficam sob Ajustes. Próximo: Financeiro — ADR-73.
60. **Financeiro — fix de rótulo enganoso (revisão página a página, 9ª etapa)**: "Para onde FOI o dinheiro este mês" (dava a entender realizado) contava contas pagas E pendentes do mês → renomeado para "Contas do mês por categoria" + subtítulo "Tudo com vencimento neste mês — pago ou a pagar" (não contradiz mais o "Resultado do mês" = realizado). Página já excelente; sem outras mudanças. Próximo: Ajustes — ADR-74.
61. **Ajustes e filhas — nomes + "Limpar" (revisão página a página, 10ª etapa)**: H1 desatualizados de renames corrigidos (Usuários "Usuários & acessos"→"Equipe e acessos"; E-mails admin "Comunicações"→"Mensagens automáticas"); "Limpar" na página E-mails enviados (4 filtros). Serviços/Modelos/Mensagens-automáticas/Configurações já ótimas — intactas. Próximo: Sistema — ADR-75.
62. **Sistema (painel ROOT) — auditoria, sem mudanças (revisão página a página, 11ª etapa)**: painel só-ROOT já excelente (8 abas, saúde, "Precisa de atenção", diagnóstico IA). Verifiquei no MySQL que não há drift schema×banco (colunas `Documento.proposta*` existem; erro de `propostaToken` na aba Erros é histórico). Nenhuma mudança de código. Próximo: Portal — ADR-76.
63. **Portal do Cliente — auditoria ao vivo, sem mudanças (revisão página a página, 12ª e ÚLTIMA etapa)**: produto cliente-facing revisado logando como cliente de teste (round-trip seguro via `SEED_ROOT_PASSWORD`). Excelente e responsivo (desktop+mobile) — nenhuma mudança. **🏁 Revisão página a página COMPLETA** (Início→…→Portal) — ADR-77.
64. **Contrato automático ao aceitar + integrações + Suporte em evidência**: aceite de proposta agora gera o CONTRATO em revisão (`gerarContratoAutoParaLead` chamado em `responder`) com os serviços + as **cláusulas de cada serviço** (novo campo `Servico.clausulasContrato`, semeado+backfill, editável na aba Detalhes; entram no `{{objeto}}`). Cancelar serviço pausa o projeto do serviço; contratar serviço na ficha gera a conta a receber. Card "Chamados de suporte" subiu para 2º na ficha e ao topo no Portal, destacado — ADR-78.
65. **Portal do Cliente — redesign**: foto do usuário saiu do topo → **menu de perfil no header** (`PortalLayout`/`ProfileMenu`: Alterar foto/Sair); nova seção **"Seus documentos"** (`PortalMeusDocumentos`: upload geral do cliente + lista, selo Você/MedConsultoria) separada de **"Documentos da MedConsultoria"** (rotulados p/ não confundir); header sticky+blur, boas-vindas refinadas. Backend já suportava (upload do portal grava no próprio clienteId; `portal.arquivos`) — ADR-79.
66. **Portal "Editar perfil"**: o cliente edita os próprios dados cadastrais (nome/tipo/CPF-CNPJ/e-mail/telefone) dentro da LGPD — ADR-80.
67. **Documentos inteligentes**: motor de contexto do cliente + Contrato construtor + auto-preenchimento + aceite vira serviço contratado — ADR-81.
68. **Scroll NATIVO da janela** (reverte o "cabe na tela" dos ADR-44/59): `AppLayout` com `min-h-screen`, sidebar/cabeçalho sticky — ADR-82.
69. **Exceção "tela cheia"** (Mensagens/Agenda) ao scroll de janela + divisor arrastável nas Mensagens — ADR-83.
70. **Tempo real por POLLING** (`refetchInterval`), sem WebSocket nem VPS: a hospedagem não faz upgrade de WS; Socket.IO desligado no build de produção (religa com `VITE_REALTIME=1`) — ADR-84.
71. **Identidade institucional editável** (Dados da empresa: marca/contato/CNPJ/razão/endereço/foro) em Ajustes, lida pelos contratos — ADR-85.
72. **Backup automático + health-check no servidor** (cron diário do MySQL, auto-restart, e-mail ao ROOT quando cai) — ADR-86.
73. **SISTEMA ganhou a aba "Operação"** + alerta de app-fora ao ROOT — ADR-87.
74. **Seção "Tarefas"** (delegação interna entre a equipe): model `Tarefa` novo, abas Comigo/Deleguei/Da equipe, multi-responsável — ADR-88.
75. **Múltiplos ROOTs + root primordial imutável**: ROOT cria/gerencia outros ROOTs, mas `ROOT_PROTEGIDO_EMAIL` nunca pode ser rebaixado, desativado nem excluído (garante que nunca falte super-admin) — ADR-89.
76. **Endurecimento**: nome do seed por pessoa (um `SEED_ROOT_NOME` batizou de "Administrador" os 2 roots nominais criados em 28/07; o `root@`, mais antigo, sempre se chamou "Root"), âncora da recorrência MENSAL na 1ª conta da série (não degrada mais para o dia 28), e tipo de aviso validado pelo compilador (`satisfies` + `notificar(tipo: EmailTemplateChave)`) — ADR-90.
77. **"Defina sua senha" no 1º acesso**: `User.senhaTrocadaEm` (nulo = nunca definiu a própria); conta INTERNA cai numa página obrigatória antes de usar a app (cliente do Portal fica de fora, já escolhe no convite); `precisaTrocarSenha()` no `shared` é a fonte única — ADR-91.
78. **Reversão de recorrência ressuscita a ocorrência**: desmarcar pago faz soft-delete da sucessora; a geração agora procura INCLUSIVE as apagadas e revive a linha, em vez de criar outra para a mesma data (marcar→desmarcar→marcar deixava 3 linhas e uma órfã). Pré-requisito do índice único — ADR-92.
79. **Índice único `(recorrenteId, vencimento)` em Conta**: uma série não tem duas parcelas no mesmo vencimento (vale para linhas apagadas também); `updateConta` traduz o P2002 em mensagem explicável, citando que a irmã pode estar excluída e invisível — ADR-93.
80. **Menu em 4 grupos, derivado do catálogo**: `lib/paginas.ts` (campo `grupo`) é a fonte única do menu **e** da busca — o `AppLayout` só filtra por papel e desenha; `paginas.test.ts` obriga toda rota nova a entrar num grupo ou a se declarar exceção. Grupos, de dentro para fora: **Meu trabalho** (Tarefas · Agenda · Projetos) · **Negócio** (Vendas · Clientes · Documentos · Financeiro) · **Comunicação** (E-mail · Mensagens) · **Configuração** (Ajustes · Sistema), com **Início solto no topo**. O menu **nunca rola**: encolhe por degraus de altura de tela (`alt`/`alt-sm`/`alt-xs` no tailwind.config), travado por `e2e/menu-sem-scroll.spec.ts` — ADR-94 (revisa o ADR-46).
81. **E-mail dentro da aplicação** (Bloco 1 — plugar e ler): caixa **IMAP por usuário** em `/email`, senha cifrada (`EMAIL_CRYPTO_KEY`), **índice + cache** (corpo só ao abrir; busca por `ESEARCH`), vínculo com cliente **por JOIN em `EmailEndereco`**, e três camadas contra HTML hostil (higienizar → `iframe sandbox=""` → imagem remota bloqueada). Regra: **a caixa é privada, a correspondência com o cliente é da empresa** — ADR-95.
82. **E-mail — Bloco 2, fase 2A (escrever, responder, encaminhar, anexar, rascunho)**: `/email` agora **envia** por SMTP real da caixa da pessoa — escrever, responder, responder a todos, encaminhar (preenche `References`, não marca `\Answered` — não é responder) e anexar (subir com teto de 20 MB por arquivo/25 MB por envio somados; **o anexo recebido é um link que baixa** em stream com `Content-Disposition: attachment`+`nosniff` — até 05/08 a rota existia e a tela não a chamava, ninguém baixava anexo pela app). **Encaminhar leva os anexos do original** (só os ids trafegam; o servidor rebaixa do IMAP). **Rascunho grava na pasta `Drafts` do servidor** (reverte o ADR-95 §2 — aparece no webmail e em qualquer cliente), regravando por cima a cada 5 s e apagando após enviar. Trava de destinatário (`conferirDestinoPermitido`) fora de produção — só `tibamooca@gmail.com`/`contato@medconsultoria.com.br`, porque o SMTP é real em qualquer ambiente. O resto do Bloco 2 veio nas fases 2D‑1 (ficha, ADR-97) e 2D‑2/2D‑3 (ADR-99) — ADR-96.
83. **E-mail — Bloco 2, fase 2D‑1 (a conversa com o cliente na ficha)**: a ficha do cliente e o painel do lead deixaram de mostrar só o log de e-mails automáticos — o card **"E-mails"** (`EmailsDoClienteCard`) junta esse log ao que a equipe trocou pela **própria caixa**, com **selo por origem** ("Enviado pelo sistema" × "Caixa de \<pessoa\>"). A equipe vê **remetente, destinatários, assunto, data e trecho — nunca o corpo**, para papel nenhum; o corpo continua só para o dono, em `/email` (ampliar depois é um `select` a mais, estreitar depois que alguém leu é impossível). O vínculo é **resolvido por JOIN no endereço, nunca gravado**, e **endereço da casa nunca vira chave** — sem isso, quem edita o cadastro do cliente (qualquer FUNCIONARIO) escolheria a chave da consulta e leria a caixa de um colega. Ficam de fora sempre: `particular`, Lixeira/Spam/**Rascunhos** e as cópias duplicadas (dedup por `messageId`; marcar uma cópia esconde todas). A **válvula** `email.marcarParticular` é só do dono (posse dentro do próprio `UPDATE`) e **tem volta**: a ficha só tira, devolver é na caixa. Falha ao ler a caixa não derruba o card (`caixaIndisponivel`) e erro de consulta vira estado visível — ADR-97.

84. **A senha de desenvolvimento sai do repositório e passa a ser rotacionável**: nenhum spec e2e nem o `demo-seed.ts` guardam senha embutida (o fallback `?? "…"` e os dois `hash("…")` saíram); a fonte única é `SEED_ROOT_PASSWORD` no `.env`, de onde o `playwright.config.ts` lê a senha dos testes. `pnpm senha:rotacionar` troca o valor **e reescreve o hash de quem ainda usa a senha atual** — o seed não faz isso (preserva senha de conta existente de propósito), então "trocar o `.env` e reexecutar o seed" não trocava nada. Nunca imprime o valor; a trava de ambiente é a do `demo-seed` (`podeRodarDemoSeed` com o `NODE_ENV` do arquivo), porque **em produção o banco também é `localhost`** e checar o host não separa os ambientes — ADR-98.
85. **E-mail — fases 2D‑2 e 2D‑3 (o e-mail vira trabalho)**: o anexo recebido vira **documento do cliente** com um clique (`EmailAnexo.arquivoId`, campo que existia morto desde o Bloco 1) e o **remetente desconhecido vira lead** do funil. Posse no `where` das duas ações; a **trava da casa vale nas duas pontas** (endereço nosso não acha cliente e colega não vira lead); **nada duplica** — clique repetido devolve o documento/lead existente, e o elo só vale se o documento ainda existe. A allowlist de tipo vale aqui (o acervo do cliente é servido pelo Portal) mesmo não valendo no anexo de saída, o arquivo é gravado **dentro do `comCaixa`** (a conexão IMAP fecha no retorno) e o teto de 20 MB é conferido pelo que foi ao disco, não pelo metadado do servidor — ADR-99.
86. **O Portal não escolhe mais a chave da própria consulta**: o endereço do cadastro é chave de busca do histórico de e-mail (ADR-97), e o Portal deixava o cliente gravá-lo — bastava pôr no perfil o e-mail de OUTRO cliente para enxergar o que a empresa mandou para ele. `email` saiu do `portalMeusDadosSchema` (é o schema que derruba, não a tela); a retificação passa pela equipe. Junto, freio de 3/hora no "esqueci minha senha", contado **por caixa** e não por IP (quem sofre é o dono da caixa, e o endpoint dispara e-mail real) — ADR-100.
87. **Ambiente local é de mentira e diz que é**: `pnpm contas:teste` cria `root@`/`admin@`/`funcionario@`/`cliente@teste.local` com a senha pública `teste1234` (senha de teste **não é segredo**), recusando rodar quando `NODE_ENV=production`; e um selo **"AMBIENTE LOCAL — dados de teste"** aparece em toda tela rodando localmente, apagado do pacote de produção em tempo de build — ADR-101.
89. **Credenciamento por PESSOA (Bloco A)**: model **`Profissional`** (filho de `Cliente`), a **lista real de 14 documentos** do PDF da Thaís em 4 escopos (`ServicoRequisito.escopo`), exigência **frente e verso** (`frenteVerso` = duas vagas de envio) e `Arquivo.profissionalId`/`lado`. O **progresso conta PARES** (documento × médico × lado) — a única conta que não mente numa clínica com dois médicos. A **triagem** (`triarCredenciamento`, puro em `@app/shared`) separa **INAPTO** (PF; menos de 5 anos de formado, com o ano em que fica apto) de **PENDENTE** (falta papel) e **avisa sem bloquear**. O Portal ganhou seção agrupada por médico e **nunca mostra o veredito comercial** (`motivosParaOCliente` é a fronteira). A reconciliação da lista **não apaga exigência** (`Arquivo.requisitoId` é `SetNull`: apagar orfana o arquivo do cliente) — só rebaixa; a trava mora na **chave** (`travaElegibilidade`), não no título, para renomear na tela não quebrar a regra — ADR-103.
90. **A grade médico × operadora, a proposta fiel e o honorário no sucesso (Blocos B e C)**: cada cruzamento médico × operadora é uma linha **`Credenciamento`** com valor, situação, datas e tentativa — a operadora credencia PESSOAS, e "valor × quantidade" somava certo sem dizer quem estava sendo credenciado onde. **`NEGADO` não vira `APROVADO` por edição** (a negativa sustenta cobrar de novo; retentar é linha nova com o acordo gravado), e editar a grade **não apaga o que já foi protocolado**. O modelo da proposta virou a **transcrição do papel real** da Thaís (5 seções, 6 passos, cláusulas palavra por palavra), com um teste que guarda a **redação** — "somente no sucesso" e "após 1 (uma) tentativa" definem quando a empresa recebe. `Documento.numero` **continua a contagem manual dela** (estava em 224; a primeira do sistema é a **0225**). E **a conta a receber nasce quando a operadora APROVA** — nem no aceite, nem ao contratar o serviço, nem na conversão do lead (`ehServicoDeCredenciamento` faz as duas provisões automáticas pularem este serviço). Criar a conta **não é best-effort**: se falhar, a aprovação falha junto — aprovado sem conta é receita que ninguém cobra e ninguém descobre — ADR-104.
91. **A auditoria de TELA do credenciamento**: cinco defeitos que os 338 testes não pegavam, todos na costura entre telas. O maior: **médico desativado sumia da grade e levava junto os credenciamentos dele** — inclusive um **APROVADO** cuja conta a receber continuava viva no Financeiro, com o cabeçalho do card anunciando "1 de 5 aprovado(s)" que não existia em lugar nenhum da tela. `removerProfissional` desativa justamente para PRESERVAR (ADR-104 §4), e a listagem por `ativo: true` fazia o contrário. Agora ele vem com `ativo: false`: o card de andamento mostra, o construtor da proposta não oferece. Também: aprovar não invalidava o card Financeiro **da ficha** (`clientes.relacionados`, outra query que a página Financeiro); o acervo mostrava seis "Diploma" idênticos sem dizer **de qual médico e qual lado**; aprovação e negativa **não avisavam ninguém**; e a tabela de assinatura da proposta saía com **tarja azul vazia** no PDF (Markdown não tem tabela sem cabeçalho) — ADR-105.
92. **O Painel de Credenciamentos** (`/credenciamentos`, menu em Negócio): uma linha por cruzamento médico × operadora de **todos** os clientes, respondendo a pergunta que a Thaís faz de manhã — *o que travou?*. O andamento só existia dentro da ficha de cada cliente, um por vez, e ela mantinha planilha paralela. A tela **abre pelo que está parado há mais tempo**, ao contrário do padrão de listagem daqui: a ordenação **é** a resposta. Marca o que passou de **60 dias** sem andar — número que veio da Thaís, não da engenharia (a sugestão era 30), editável em Ajustes → Dados da empresa. O tempo conta do **carimbo da situação atual**, não da criação (criado há 100 dias e protocolado ontem está parado há 1). `A_PROTOCOLAR` conta como atraso — ali a culpa é nossa e é o mais barato de resolver; estado final **nunca** é marcado e mostra a **data** do desfecho, porque "parado há 3 dias" num aprovado seria mentir com uma palavra. Mudar a situação pelo painel reusa a **mesma** `mudarStatusCredenciamento` da ficha (regra de dinheiro em dois lugares são dois relógios). Negócio passou a ter 5 itens, contra a diretriz de 4 do ADR-94: o limite que continua lei é **o menu não rolar** — ADR-106.
88. **A página de e-mail para de mentir quando algo falha**: erro da consulta de caixas renderizava a tela de boas-vindas "Conecte a sua caixa" para quem já tinha caixa (a pessoa redigitava a senha do webmail e ouvia "você já plugou esta caixa"); a lista dizia "pasta vazia" numa falha de rede; a mensagem que não abre ficava em branco. Todos ganharam texto próprio. Junto: **desplugar caixa** (a rota existia sem tela), **"carregar mais antigos"** (só os 50 mais recentes eram alcançáveis), aviso do estado `ERRO`, "Reconectar" sem F5, e remoção de `email.doCliente`/`doLead` (órfãs e sem filtro por dono da caixa) — ADR-102.

---

## 7. Regras de negócio (núcleo)

- **Funil inteligente (Lead → Cliente):** um Lead percorre o pipeline. Cada etapa tem um **checklist** (playbook + passos dos serviços escolhidos); passos automáticos (servicos/valor, e proposta/contrato enviado/assinado) concluem-se sozinhos. Passos geram propostas/contratos do modelo. **Ganho** = converter; **perda** = marcar como perdido (com motivo, reversível) — ambos saem do board e alimentam a taxa de conversão. Ver ADR-14 e ADR-19.
- **Captação & Portal do prospect:** o lead pode chegar pelo form público `/comecar` (origem detectada automaticamente) ou cadastro manual (também rastreado). Ao chegar/ser convidado, já ganha **acesso ao Portal** para acompanhar o atendimento; na conversão o acesso continua. Pelo Portal, o prospect tem **livre-arbítrio**: pode **desistir** (vira lead perdido, avisa a equipe) e **retomar** depois. Ver ADR-15 e ADR-20.
- **Conversão integra tudo:** cria o **Cliente** (dedup por e-mail), **um projeto por serviço contratado** (nome `"<Serviço> — <Cliente>"`, com os cartões do roteiro — ADR-38; sem serviços → projeto geral `"Projeto — <Cliente>"`), provisiona uma **Conta a Receber** (do valor estimado, revisável) e agenda a **reunião de kickoff**; notifica gestão e responsável. **Pessoa × empresa (ADR/fix):** se o lead tem **empresa**, a *conta* (Cliente) é a **empresa** (PJ) e a **pessoa do lead vira o CONTATO PRINCIPAL** (não se perde); sem empresa, o Cliente é a própria pessoa (PF).
- **Oportunidade inteligente (ADR-23):** toda oportunidade sabe **quais serviços** o cliente quer — o card do funil e o checklist nascem com os passos de cada serviço. A "Nova oportunidade" (ficha) pergunta os serviços; e o cliente pode **escolher serviços no próprio Portal** ("O que você precisa?"), que viram/atualizam uma oportunidade no funil e avisam a equipe.
- **Lead = oportunidade; Cliente = cadastro permanente (ADR-22):** um Cliente **nunca vira lead**. O que existe é abrir uma **nova oportunidade** para um cliente existente (upsell) — ele segue cliente. **Cliente ATIVO nunca é rebaixado** pelo funil.
- **Funil ≠ Clientes (ADR-24):** o **Funil** tem todos os leads/prospects/oportunidades (Prospecção/Negociação/Perdidos são etapas do funil). A página **Clientes** lista só quem já é cliente — estados **Ativo/Inativo** (toggle manual na ficha). Ganhar no funil → vira Cliente Ativo. Prospect com conta de Portal **não** aparece em Clientes (é gerido no Funil).
- **Credenciamento (ADR-103/104) — o serviço que se cobra diferente de todos os outros.** É **por pessoa**: cada médico (`Profissional`) tem a própria papelada, e cada cruzamento **médico × operadora** é uma linha `Credenciamento` com preço, situação e tentativa próprios. A **triagem** avisa antes de vender (INAPTO = fato que papelada nenhuma resolve hoje; PENDENTE = falta documento) e **nunca bloqueia**; o cliente só lê as pendências, redigidas como pedido. A proposta é a **transcrição do papel real da Thaís** e continua a **numeração manual dela** (0225 em diante). E o dinheiro: **o honorário é no sucesso** — a conta a receber nasce quando a **operadora aprova**, nunca no aceite da proposta, ao contratar o serviço na ficha ou na conversão do lead. Uma negativa encerra aquele cruzamento; retentar exige acordo expresso e vira uma tentativa nova, com a negativa preservada.
- **Serviços contratados (ADR-26):** `ClienteServico` é a fonte da verdade do que o cliente contratou (ATIVO/CANCELADO). A equipe liga/desliga na ficha; a conversão do funil gera as contratações; o cliente cancela pelo Portal. Cada serviço tem **exigências** (`ServicoRequisito`, checklist) que o cliente cumpre de **três** formas (ADR-31): **documento** (upload de arquivo), **informação** (escreve uma resposta na tela) ou **formulário/briefing online** (várias perguntas — ADR-28). Informação e formulário são atendidos por uma **resposta enviada**; documento, por um **arquivo**. A equipe recebe na ficha (notificação + e-mail). A gestão dos serviços é feita num diálogo único de abas (Detalhes · Exigências · Passos), aberto pelo botão "Configurar" do card. Arquivos em pasta no servidor (`UPLOADS_DIR`), servidos por endpoint autenticado com checagem de posse.
- **Formulários online (ADR-28):** `Formulario`/`FormularioCampo` (reutilizáveis, construtor em `/formulários`) + `FormularioResposta` (por cliente). Um requisito `BRIEFING` aponta para um formulário; o cliente **preenche online** no Portal (rascunho/enviar) **ou baixa**; a equipe vê as respostas na ficha. Regra: qualquer coisa que não exija upload deve ser preenchível na tela, com download opcional.
- **Cliente → Projetos (ADR-38):** **um projeto = um serviço contratado** do cliente (`Projeto.servicoId`), nomeado `"<Serviço> — <Cliente>"`; um cliente com vários serviços tem vários projetos (projetos gerais/manuais ficam sem serviço). Cada projeto tem tarefas, checklist, timer, comentários, documentos, reuniões e histórico. A ficha do cliente é o hub (inclui a origem comercial e o suporte). A **lista de Projetos** ordena por urgência (atraso/entrega vencida primeiro) e busca por projeto **ou** cliente.
- **Kanban (colunas — fluxo em etapas, ADR-35):** A fazer · Em andamento · Aguardando cliente · Aguardando terceiros · Concluído. O cartão inteiro é clicável (abre) e arrastável. **Cartões automáticos do serviço (ADR-36/37/38):** contratar/converter um serviço cria o **projeto do serviço** já com **um cartão "Entregas do cliente"** (checklist = exigências obrigatórias, marcam-se sozinhas quando o cliente entrega pelo Portal) **+ um cartão por tarefa do roteiro** do serviço (checklist da tarefa, a equipe marca — `Servico.roteiro`); o **status de cada cartão anda sozinho** (Aguardando cliente → Em andamento → Concluído), e concluir todos os cartões conclui o projeto. **A auto-movimentação avisa** (toast "Cartão movido para 'X'" / "Concluído 🎉" ao marcar tarefas — `reconciliarStatusCard` devolve a coluna nova; nunca mexe em "Aguardando terceiros" nem impede arrastar manualmente). **Comentários do cartão (`CardPanel`): editar/apagar** — o autor edita/apaga o próprio; ROOT/ADMIN podem apagar qualquer um (moderação). Detalhe do cartão em **2 colunas** (Checklist | Timer+Comentários), quadro fixo com scroll só nas listas (ver ADR-44).
- **Timer:** funcionário inicia/finaliza; cada sessão vira um registro de tempo.
- **Documentos:** modelo → preenchimento (variáveis; IA opcional) → **revisão humana obrigatória** → **assinatura eletrônica** (link + hash de integridade) → envio. **A IA nunca envia documento automaticamente.** Ver ADR-17.
- **E-mail dentro da aplicação (ADR-95/96/97):** cada pessoa **pluga a própria caixa** `@medconsultoria.com.br` em `/email` (a mesma senha do webmail, testada antes de gravar e guardada cifrada) e lê/**escreve/responde/encaminha/anexa** sem sair do Workspace. **A caixa é privada, a correspondência com o cliente é da empresa:** ninguém abre a caixa de ninguém (todo procedure filtra por `userId`), mas e-mail trocado com cliente/lead cadastrado aparece na ficha dele — resolvido por JOIN no endereço, nunca gravado fixo — e o dono pode **marcar como particular** para tirá-lo de lá. Na ficha a equipe vê **remetente, destinatários, assunto, data e trecho; nunca o corpo** (o corpo é só do dono, em `/email`), e o card distingue por selo o e-mail automático do que saiu de uma caixa. **Tirar da ficha é da ficha; devolver é da caixa** — ADR-97. Responder marca a original como respondida (`\Answered` no servidor); encaminhar não (não é resposta a quem escreveu). Enquanto escreve, o rascunho grava sozinho na pasta **`Drafts` do servidor** (aparece no webmail). Fora de produção, só é permitido enviar para os dois e-mails de teste do dono (`conferirDestinoPermitido`) — o SMTP é real em qualquer ambiente. **Não existe caixa compartilhada gerida pela app:** quem manda no acesso é o servidor de e-mail (cortar = trocar a senha na hospedagem). Fase 1 só o domínio da Med; Gmail/Outlook exigem OAuth e ficaram para depois. O e-mail também **vira trabalho** (ADR-99): o anexo recebido vira **documento do cliente** com um clique (um só quando a mensagem tem cliente único; sem vínculo, a tela pergunta qual) e o **remetente desconhecido vira lead** do funil, com o rastro de onde veio. Colega da casa nunca vira lead, e clicar duas vezes devolve o documento/lead que já existe. Não confundir `/email` (a caixa) com `/emails` (mensagens automáticas) nem `/emails-enviados` (monitor de envios).
- **E-mails & notificações:** um ponto único (`notificar()`) cria a notificação in-app e dispara o e-mail branded correspondente, respeitando o opt-out do usuário; tudo fica no histórico. Ver ADR-16.
- **E-mail ao cliente/lead = opt-in (ADR-25):** ação da equipe que enviaria e-mail ao cliente/lead abre um pop-up de confirmação com **checkbox "enviar e-mail?"** (criar cliente → acesso ao Portal; converter → boas-vindas; solicitar assinatura → link; evento com cliente → aviso da reunião). Só a **captação pública** e o botão explícito **"Enviar acesso"** enviam direto (o envio é o objetivo). Testes de envio real: apenas `tibamooca@gmail.com` ou `contato@medconsultoria.com.br`.
- **Agenda (ADR-39):** 5 visões (Lista/Dia/Semana/Mês/Ano); **Dia/Semana são grade de horários** (24h roláveis, blocos por horário/duração, faixa de dia inteiro, linha do "agora") com **arrastar-para-reagendar** (só eventos não recorrentes). Evento tem tipo/escopo (Pessoal×Empresa), cliente, **projeto**, **participantes da equipe**, recorrência e link de reunião. **KPIs + filtros + Resumo por IA** no topo. Lembrete interno 15 min antes (dono + participantes) e **lembrete por e-mail ao cliente** nas 24h anteriores; **conflito de horário** avisado no formulário. Integra Clientes/Projetos (link à ficha) e o Portal.
- **Reuniões:** sem videoconferência própria — apenas links (Meet/Jitsi/Zoom/Whereby). No **Portal**, o cliente pode **confirmar presença** e **adicionar a reunião à própria agenda (.ics)**.
- **Mensagens + Helpdesk (ADR-40/41):** um só sistema de conversas (`Conversa`/`Mensagem`) estilo WhatsApp, separado por categorias **Diretas · Grupos · Clientes · Leads** + aba **Arquivadas** e filtro **Histórico**. O **Suporte do Cliente é um helpdesk**: cada chamado é um **ticket próprio** (`tipo=CLIENTE`) com **protocolo #, assunto, status (Aberto/Em andamento/Resolvido = fechado/histórico, reabrível), prioridade e responsável**; um cliente/lead pode ter **vários** ao longo do tempo. Cliente/equipe compartilham a mesma thread (Mensagens, ficha do cliente e Portal); cliente que responde um resolvido **reabre**. Recursos: **apagar/editar** a própria mensagem (lápide + "editada"), **fixar/silenciar/arquivar/apagar** conversa, grupos editáveis (renomear, add/remover, sair — só criador/admin). A categoria "Leads" sai de o cliente ter lead ativo no funil (o lead tem acesso ao Portal desde a captação). `SuporteMensagem` é legado (migrado para `Mensagem`).
- **Portal do Cliente:** isolamento rígido por `clienteId`. O cliente/prospect nunca vê dados internos nem de outros clientes.
- **Financeiro — carteiras Empresa × Pessoal (ADR-45):** duas carteiras via `Conta.escopo`/`Categoria.escopo` (enum `Escopo`). **EMPRESA** = livros da Med (compartilhada ADMIN/ROOT); **PESSOAL** = privada por usuário (`donoId`; só o dono vê — devs não veem a vida particular da Thaís). Seletor **Empresa · Pessoal · Tudo**; toda leitura/mutação escopa e re-checa posse (`whereCarteira`/`contaComPosse`). **"Precisa de você"** (`agendaFinanceira`) mostra Vencidas/Hoje/Esta semana (a pagar × a receber, marcar-paga 1-clique). **Recorrência de verdade:** marcar paga cria a próxima ocorrência sozinha (`gerarProximaOcorrencia`, âncora `recorrenteId`) + rede de segurança `garantirProximasRecorrencias()` no loop de lembretes (sem cron). **Lembretes** scope-aware (PESSOAL só o dono) para "vencida" e "a vencer ≤3 dias" (`conta_a_vencer`, notif+e-mail opt-out). "Para onde vai o dinheiro" (`porCategoria`) + KPIs por carteira. `adminProcedure` (ADMIN/ROOT).
- **Layout "cabe na tela" (ADR-44):** o shell é full-height; páginas de **visão/lista** usam **raiz `flex h-full flex-col`** com cabeçalho/KPIs/filtros `shrink-0` e conteúdo `flex-1 min-h-0` (preenche = calendário; ou rola por dentro = listas). Evita scroll de página inteira. Dashboard fica rolável (resumo longo). **Modais:** componente `Modal` tem prop `size` (sm/md/lg/xl; padrão **md=576px**) e prop **`footer`** — cabeçalho e rodapé (botões de ação) ficam **FIXOS**, só o corpo rola por dentro ("card fixo + scroll interno"). Botões de ação vão em `footer=`; para forms, dê `id` ao `<form>` e use `form="<id>"` no botão submit (submete de fora do form). Confirmações usam `size="sm"`. **Meta: o card do formulário NÃO deve rolar — deve caber inteiro.** Compacte para caber: `space-y-2.5/3` + campos `space-y-1`, sem textos de ajuda verbosos (o rótulo basta), `Textarea rows={2}`, pareie campos em 2 colunas; **listas que crescem com dados** (pills de serviços/participantes) viram caixa com borda + scroll interno (`max-h-[…] overflow-y-auto rounded-lg border`), nunca o card inteiro. Valide overflow=0 do corpo (Playwright) a 768px. Ao criar/editar um diálogo, **nunca** deixe botões dentro do corpo que rola — use o `footer`. **Dropdowns (`Combobox`/`Autocomplete`) renderizam em PORTAL flutuante** (`useAnchoredStyle` + `createPortal`) — nunca `absolute` dentro do modal (empurra/rola o card). **Responsividade:** pares de campos usam `grid grid-cols-1 sm:grid-cols-2` (empilham no celular); popups devem caber em qualquer tela (`w-full max-w-* max-h-[9x]vh` + scroll interno). O guia do "?" (`GuiaTour`) é quadro fixo com texto rolável. Siga esse padrão.
- **Foto de perfil / avatar (ADR-42):** `User.avatarUrl` (imagem em `avatars/{userId}/…`). Upload em **Configurações** (equipe = foto da pessoa) e no **Portal** (cliente/lead = foto **ou** logotipo). Rotas `POST /avatar` (troca) e `GET /avatar/:userId` (serve); remoção via `auth.removerAvatar`. No front use o componente **`Avatar`** (`components/ui/avatar.tsx`) — foto com fallback para iniciais — em qualquer lugar que mostre uma pessoa (endpoints de pessoas devem retornar `avatarUrl`).
- **Sempre no ar (ADR-40):** `scripts/keep-alive.mjs` supervisiona o `pnpm dev` e o re-sobe se cair (roda destacado). Para migrações do Prisma, use o **modo pausa**: `touch scripts/.keepalive-pause` (para o dev) → migrar → `rm scripts/.keepalive-pause` (volta). NÃO use `Stop-Process node` cru para migrar.
- **Observabilidade:** erros e incidentes são capturados automaticamente e o ROOT os acompanha no painel Sistema. Ver ADR-18.
- **SISTEMA = painel dos devs (ROOT), com IA (ADR-43):** `/sistema` é **root-only** (rota + `rootProcedure` + menu); Admin faz todo o resto. Tem monitores (saúde/desempenho/banco/métricas/uptime), ações (resolver/ignorar erro, **reexibir** erro oculto, resolver incidente, revogar/limpar sessões, **resolver todos**, **rodar varredura**) e **IA** (`ia.diagnosticoSistema` no cabeçalho + "análise da IA" por erro/incidente). RBAC de usuários: **hierarquia estrita** — `assertPodeAtribuir` só atribui papel abaixo do próprio (só ROOT gere ADMIN/ROOT); a UI filtra papéis e esconde ações sobre pares/superiores. Erro ocultado NÃO se perde — fica na aba **Ocultos** e pode ser **Reexibido**.

---

## 8. Identidade visual (resumo)

- **Tipografia:** Montserrat.
- **Paleta:** Verde `#30AD73` · Azul claro `#2DA8E1` · Azul escuro `#002463` · Azul textos `#003591`.
- **Sensação:** confiança, organização, profissionalismo, tecnologia, simplicidade. Interfaces **limpas**, nunca poluídas.
- **Inspiração** (sem copiar): Linear, Notion, Slack, ClickUp, Perfex CRM, Stripe Dashboard.

Especificação completa (tokens, espaçamento, componentes, animações, acessibilidade) em `UI_GUIDELINES.md`.

---

## 9. Estrutura de pastas (alvo)

```
workspace-medconsultoria/
├── apps/
│   ├── web/                  # SPA
│   │   └── src/
│   │       ├── modules/      # 1 pasta por domínio (crm, projetos, agenda, ...)
│   │       ├── components/   # componentes compartilhados de app
│   │       ├── lib/          # trpc client, utils, hooks
│   │       └── routes/       # TanStack Router
│   └── api/
│       └── src/
│           ├── modules/      # 1 pasta por domínio: router + service
│           ├── trpc/         # context, procedures base (authz)
│           ├── realtime/     # Socket.IO gateway + notificationService
│           ├── lib/          # ai, password, session
│           ├── config.ts     # config validada por Zod
│           └── server.ts     # bootstrap Fastify (API + estático + WS)
├── packages/
│   ├── db/                   # prisma/schema.prisma + client exportado
│   ├── shared/               # zod schemas, tipos, constantes, AppRouter type
│   └── ui/                   # design tokens + componentes shadcn
├── docs/                     # esta documentação
├── deploy.sh                 # pipeline SSH
└── turbo.json / pnpm-workspace.yaml
```

---

## 10. Fluxo de desenvolvimento

> **Princípio (o dev/IA é o cérebro, não o executor):** todo pedido do dono é **avaliado e criticado** antes de executado — se há risco, redundância ou um caminho melhor, isso é dito no terminal, com uma **recomendação explícita ("RECOMENDO: X")**. "Não precisa fazer tudo o que peço" — obedecer em silêncio desperdiça a expertise. Sempre verificar a realidade no código (a doc/auditoria pode estar desatualizada) antes de agir. Ver memória `criticar-e-recomendar`.

1. **Antes de codar:** confirmar o estado real via codebase-memory MCP (`index_status`, `get_architecture`, `search_graph`) — o kick-prompt é hipótese, não verdade.
2. **TDD:** escreva o teste que falha, depois implemente.
3. **Reuse primeiro:** procure função/utilitário existente antes de criar.
4. **Revisão por especialista antes do merge** (agentes em `~/.claude/agents/`): react-reviewer, typescript-reviewer, database-reviewer (migrations), security-reviewer (auth/financeiro/portal), healthcare-reviewer (PII/portal).
5. **Verifique de verdade:** rode build/typecheck/testes e exercite o fluxo real (`/run`, `/verify`) antes de dizer "pronto".
6. **Reindexe** no codebase-memory MCP após scaffold/mudança estrutural.
7. **Atualize esta documentação** quando uma decisão mudar.

---

## 11. Backlog / Roadmap (resumo)

Detalhe e critérios de verificação em `ROADMAP.md`.

- **Fase 0 — Fundação & Docs** ✅ (**deploy em produção FEITO** — app no ar em https://workspace.medconsultoria.com.br)
- **Fase 1 — CRM** ✅
- **Fase 2 — Projetos + Kanban + Timer** ✅
- **Fase 3 — Agenda + Reuniões + Notificações** ✅
- **Fase 4 — Financeiro** ✅
- **Fase 5 — Dashboard completo** ✅
- **Fase 6 — Mensagens Internas (chat)** ✅
- **Fase 7 — Documentos Inteligentes (templates)** ✅
- **Fase 8 — Portal do Cliente** ✅
- **Fase 9 — Camada de IA** ✅ (núcleo: Documentos com IA + busca/assistente via OpenAI)

**Evolução pós-MVP (entregue):** **e-mail dentro da aplicação** — Bloco 1 (plugar e ler, ADR-95), Bloco 2 fase 2A (escrever/responder/encaminhar/anexar, ADR-96) fase 2D‑1 (a conversa com o cliente na ficha, ADR-97) e fases 2D‑2/2D‑3 (anexo vira documento do cliente; remetente desconhecido vira lead — ADR-99) — **Blocos 1 e 2 completos**, funil inteligente (playbook + serviços + passos automáticos + geração de documentos), captação pública + Portal do prospect + acesso automático, sistema de e-mails branded (SMTP + templates editáveis + histórico + preferências), assinatura eletrônica de documentos, painel Sistema/observabilidade (ROOT), dashboard por papel, e o pacote de funil ganho/perda (lead perdido reversível + taxa de conversão + conversão→Financeiro/Agenda + origem comercial na ficha).

MVP + evolução completos, **no ar em produção** (TineHost, https://workspace.medconsultoria.com.br) ← *estamos aqui*, em **fase de polimento**. Tempo real por polling (ADR-84; a hospedagem não faz WebSocket). Pendências do dono: rotacionar chave OpenAI/senha SMTP, preencher os dados jurídicos em Ajustes → Dados da empresa (ADR-85) e **conferir a senha das contas semeadas em produção** — a senha de desenvolvimento vazou no histórico de outro repositório, foi rotacionada aqui (ADR-98), mas as mesmas 4 contas existem no servidor e quem nunca definiu senha própria (o `root@` primordial é o candidato) ainda aceita a antiga.

---

## 12. Pendências (a confirmar; não bloqueiam a Fase 0)

- Versão do Node disponível na TineHost.
- ~~Passenger vs Nginx Unit (muda o mecanismo de restart e o proxy de WebSocket).~~ **RESOLVIDO:** LiteSpeed/lsnode; restart = `touch tmp/restart.txt`; WebSocket não é suportado → tempo real por **polling** (ADR-84).
- Limites de conexão do MySQL (afeta o pool do Prisma).
- ~~Rede outbound liberada (necessária para a API de IA na Fase 9).~~ **RESOLVIDO:** IA (OpenAI) em uso em produção.
- ~~Engine de PDF em hospedagem compartilhada (puppeteer normalmente não roda — avaliar `@react-pdf/renderer` ou DOCX+conversão) — decidir na Fase 7.~~ **RESOLVIDO (Fase 7):** PDF via `window.print()`, Word via blob.
- ~~Política de backup do MySQL.~~ **RESOLVIDO (26/07):** `scripts/server/backup-db.sh` via cron diário (03:00 BRT, `mysqldump --single-transaction` + gzip, retém 14) + `healthcheck.sh` a cada 5 min (auto-restart). Ver DEPLOY.md.
- **Pasta de uploads persistente na TineHost** (`UPLOADS_DIR`): apontar para uma pasta FORA do diretório do deploy (o rsync sobrescreve) e incluí-la no backup — ADR-26.

> Ao resolver qualquer item acima, registre a resposta em `DECISIONS.md` e remova daqui.

---

## 12.4. Dinheiro no banco (ADR-118)

Todo campo de dinheiro é `Decimal @db.Decimal(12,2)` — não sobrou nenhum `Float`. **E o `Decimal`
para no servidor:** a função de serviço converte para `number` com `emReais()`/`emReaisOu()`
(`apps/api/src/lib/dinheiro.ts`) antes de devolver ao tRPC. `Decimal` que chega ao navegador vira
objeto no JSON e a tela mostra "R$ NaN", **sem erro nenhum no console** — pior que o centavo que o
`Float` errava. O typecheck não pega o vazamento quando o retorno não tem tipo declarado; a prova é
`typeof` em runtime (`dinheiro-decimal.integration.test.ts`).

---

## 12.5. Publicação e segurança de dependências (ADR-107 … ADR-117)

Série que este índice não cobria — o detalhe vive em `docs/DECISIONS.md` e `docs/DEPLOY.md`.
O essencial para não repetir os erros:

- **Publicar é um botão** (Actions → Deploy → digitar `PUBLICAR`), nunca `./deploy.sh` do laptop — ADR-111/113.
- **A árvore da CI não é a do servidor.** O npm não lê `pnpm.overrides`: o artefato leva `package-lock.json`
  e overrides **traduzidos** (`nome@faixa` → `nome`, que no npm é seletor de pai), e o servidor usa `npm ci` — ADR-116/117.
- **Verde tem de provar algo.** `npm audit` sai 0 em árvore vazia, e `npm install` verde não prova que o
  `npm ci` do servidor aceita o lock. O conferidor (`scripts/conferir-artefato.mjs`) faz as duas asserções — ADR-114/117.
- **Rollback que não foi exercitado não é rollback:** um `|| true` num socorro apagou o `node_modules` de
  produção em 18/08/2026 — ADR-117.

---

## 13. O que NÃO fazer agora

Não transformar em SaaS · não multi-tenant · não cobrança · não marketplace · não rede social · não EAD · não ERP gigante · não integrações complexas · não integrar WhatsApp agora · não videoconferência própria. **Primeiro resolver o problema da MedConsultoria.**
