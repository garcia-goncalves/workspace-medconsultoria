# Spec — Refino total da experiência + conteúdo operacional real

> Fase 2 da esteira `refino-experiencia-2026-08-29`. Briefing aprovado pelo dono em 28/08/2026.

## problema

A aplicação **funciona** e está no ar (v1.3.0), mas três coisas a impedem de dar gosto de usar:

1. **Ela não foi feita para o celular, e o Portal do cliente é usado no celular.** Medido:
   `ServicosPage.tsx` tem 1.145 linhas e **1** adaptação de tela pequena; `CredenciamentosPage.tsx`
   tem 340 e **1**; `UsuariosPage.tsx` e `PortalServicosPage.tsx` têm **zero**. O teste automático
   que existe cobre 7 das 30 rotas e verifica uma coisa só (se a página vaza para o lado).
   ~201 botões só-ícone dependem do `title=` nativo do HTML, que **não existe no toque** — no
   celular, o cliente não descobre o que o botão faz.
2. **Não há caixa de peças, então cada tela reinventa a sua.** `packages/ui` exporta **só** o
   utilitário `cn` (`packages/ui/src/index.ts`). Não existem no repositório `Tabs`, `Sheet`,
   `Popover`, `Accordion` nem tabela de dados — verificado por busca. Consequência medida: 174
   tamanhos de texto fora da escala, 4 telas do Portal reinventando o `Badge`, e 2 diálogos
   (`PortalDocumentoModal`, `CardPanel`) fora do `Modal` padrão, portanto sem prender o foco do
   teclado. Refinar tela a tela sem a caixa de peças é pintar parede com infiltração.
3. **O banco de desenvolvimento é lixo de teste, então ninguém consegue julgar tela nenhuma.**
   O que está lá: `Clínica GRD352779`, `Lead RSP3606887`, `Dr. Prova ADR-119`,
   `Servico E2E Briefing`, e **2 tarefas no banco inteiro**. Tela vazia esconde defeito de layout;
   tela com três linhas esconde defeito de tabela.

E há uma quarta, que é do negócio e não da tela: **o roteiro de trabalho não diz de quem é cada
passo**. `ServicoPasso` (`schema.prisma:762-774`) e os itens do `Servico.roteiro` misturam o que a
Med faz com o que o cliente deve entregar. "Aprovação do cliente" e "Montar as páginas" aparecem
na mesma lista, com o mesmo peso. A Thaís não consegue responder a pergunta que ela faz toda
manhã: *o que está parado esperando o cliente?*

## solucao

Cinco frentes, nesta ordem, porque cada uma destrava a seguinte.

**1. O conteúdo operacional ganha dono.** Campo novo em `ServicoPasso` e nos itens de roteiro
dizendo se o passo é **da Med** ou **do cliente**. Com isso: o funil separa "minha vez" de
"esperando o cliente"; o quadro do projeto ganha filtro; e o Portal mostra ao cliente só o que é
dele. Os 10 serviços do catálogo real têm seus passos e roteiros revisados um a um — vocabulário
único entre venda e execução, checklists que hoje têm um item só ganham corpo, e cada passo diz
o que significa "feito".

**2. A caixa de peças.** `Tabs`, `Sheet` (painel lateral), `Popover`, `Accordion` e uma tabela de
dados que **vira lista de cartões abaixo de `md`** — um componente, aplicado em toda tabela da
aplicação, em vez de 12 soluções diferentes. Mais as três props de ajuda (`PageHeader.hint`,
`Modal.hint`, `CardTitle.hint`) que a auditoria pediu e que não existem. Ficam em
`apps/web/src/components/ui/`, onde as outras 33 já vivem — não em `packages/ui`, para não
inventar uma segunda casa.

**3. A base de demonstração.** `pnpm db:limpar --apply` (que já faz `mysqldump` antes e recusa
rodar contra produção) e um seed de demonstração reescrito: 8 clínicas fictícias plausíveis,
leads nas 5 etapas com os passos coerentes com a etapa, um cliente para cada um dos 10 serviços,
projetos com cartões nos 4 status, tarefas da equipe com prazo e atraso, documentos gerados dos
modelos reais com numeração contínua, credenciamentos nas 6 situações, financeiro vencido/a
vencer/pago, e um cliente do Portal com pendência. **Todo e-mail é `@medconsultoria.com.br` com
prefixo de teste** — ordem do dono, para nenhum disparo alcançar pessoa de verdade.

**4. As 30 telas, na ordem do menu**, cada uma com os três estados cuidados (vazio orientador,
esqueleto de carregamento, erro que diz o que houve) e comportamento definido em 360px.

**5. As regras que ainda mordem** — os 10 defeitos nomeados de dinheiro e de aviso —, numa onda
separada e marcada, para não misturar conserto de regra com refino de tela.

## o_que_ja_existe

**Design system, escrito e bom:** `docs/UI_GUIDELINES.md` (203 linhas) — paleta da marca
(`#30AD73`, `#2DA8E1`, `#003591`, `#002463`), escala tipográfica, escala de espaçamento base 4px,
regra de largura única de página (`AppLayout` centraliza tudo em `max-w-[1600px]`, ADR-48),
convenções de foco e sombra. ⚠️ Ele declara "MVP é desktop-first, responsivo básico não deve
quebrar" — **esta esteira revoga essa linha**, por ordem do dono ("totalmente responsivo").

**Kit de primitivas atual:** 33 arquivos em `apps/web/src/components/ui/` — `button`, `input`,
`label`, `textarea`, `select`, `combobox`, `card`, `badge`, `modal`, `table`, `skeleton`,
`empty-state`, `page-header`, `toast`, `tooltip`, `avatar`, `masked-input`, `money-input`,
`sortable`, `upload-arquivo`, `query-error`, `confirm-dialog`, `autocomplete`, `assistente-ia`.
Todos escritos à mão com Tailwind + `cva` + `cn`. **Nenhuma biblioteca de componentes instalada**
(sem Radix, sem shadcn, sem Headless UI) — conferido nos `package.json` de `apps/web` e
`packages/ui`.

**Casca da aplicação:** `apps/web/src/components/layout/AppLayout.tsx` (524 linhas, com o drawer
de navegação do celular embutido inline nas linhas 414-432 — é a peça a extrair para virar o
`Sheet`), `Breadcrumbs.tsx` (127), `NotificationBell.tsx` (193), `CommandPalette.tsx` (332).

**Catálogo real da Med, já correto no código** (`apps/api/src/modules/servicos/servicos.service.ts:65-345`):
10 serviços com preço, descrição, `requisitos` (o que se pede ao cliente), `passos` (o roteiro de
venda por etapa do funil) e `roteiro` (as tarefas de execução que viram cartões do projeto).
Conferido no banco: os 10 têm roteiro, de 3 a 4 tarefas cada, com checklists de 1 a 3 itens.

**Motor que transforma conteúdo em trabalho:**
`apps/api/src/modules/projetos/projetos.service.ts:205-266` (`criarCardsDoServico` — cria o cartão
"Entregas do cliente" a partir das exigências obrigatórias, mais um cartão por tarefa do roteiro) e
`apps/api/src/modules/leads/leads.service.ts:297+` (`reconciliarPassosAuto` — materializa os passos
do serviço como `LeadPasso` na etapa certa do funil).

**Modelos de dados a estender:** `ServicoPasso` (`packages/db/prisma/schema.prisma:762-774`) e
`LeadPasso` (`:835-855`) — **nenhum dos dois tem campo dizendo de quem é o passo**. É a migração
aditiva desta esteira.

**Ferramenta de limpeza, pronta e segura:** `scripts/limpar-dados.ts` — dry-run por padrão,
`mysqldump` para `backups/` antes de apagar, e a trava `podeRodarDemoSeed`
(`packages/db/src/seed-guard.ts:31-58`) que recusa rodar fora de `localhost`. Preserva ROOT,
etapas do funil, catálogo de serviços, modelos de documento, operadoras e templates de e-mail.

**Seed de demonstração a reescrever:** `packages/db/prisma/demo-seed.ts` (189 linhas) — hoje cria
3 clientes, 5 leads, 5 eventos e 5 contas, com nomes rasos e sem coerência entre si.

**Testes que existem:** 33 arquivos em `e2e/`. Responsividade em `e2e/responsive.spec.ts` (7 rotas
× 5 tamanhos, só overflow horizontal) e `e2e/responsividade.spec.ts` (3 tamanhos + fluxo
funcional). Acessibilidade em `e2e/a11y.spec.ts` (foco de modal e combobox) e `e2e/a11y-axe.spec.ts`
(varredura axe). Trava do menu em `e2e/menu-sem-scroll.spec.ts`. Nenhum cobre Sistema, Serviços,
Modelos nem a maioria das telas do Portal em tela pequena — exatamente as que têm menos adaptação.

**Achados abertos herdados, com arquivo:linha:** consolidados das auditorias de 27 e 28/08 —
dinheiro (`M1` `servicos-cliente.service.ts:156-186`, `C10` `contas.service.ts:223-234,260-283`,
`M15` `criarContaDoHonorario:263`, `F8` `LeadsPipelinePage.tsx:86` + `dashboard.service.ts:194,262`,
`F9` `documentos.service.ts:647,672`) e trabalho invisível (`C1` `leads.service.ts:348-352`,
`C2` `documentos.service.ts:787-791`, `M6` `emails.registry.ts:658-732`, `M8`
`mensagens.service.ts:375`, `C8` parcial em `usuarios.service.ts:298-320`).

**Desempenho nosso, confirmado ainda no código:** `seedIfEmpty()` roda em toda leitura do catálogo
(`servicos.service.ts:389-425`, chamada em `:470,475,485,632`, com dois laços `await` dentro) — é
a origem do `portal.servicosDisponiveis` de 11,9s medido em produção. E `login()` faz três
escritas em série (`auth.service.ts:143-149`).

## fontes_externas

nenhuma — todo o trabalho é sobre código e conteúdo que já vivem neste repositório, e as regras de
negócio vêm do catálogo real da Med já semeado. Se a fase de design precisar de referência visual
externa, ela entra registrada no `design.md`.

## fora_de_escopo

- **Cadastrar dado em produção.** O classificador me barra de digitar em formulário de produção
  (testado nas duas formas em 28/08) e cadastro de cliente real é trabalho do dono.
- **Modo escuro.** Tokens prontos em `index.css`, falta o interruptor. Ligá-lo aqui dobraria a
  conferência de tela (30 telas × 2 temas). Fica oferecido para a rodada seguinte.
- **Aplicativo nativo.** O Portal responsivo cobre a necessidade.
- **O banco de produção que cai** — é hospedagem, e há ordem expressa de não tocar.
- **Enviar qualquer e-mail de verdade.** Ordem do dono nesta rodada: só endereços de teste
  `@medconsultoria.com.br`. O ambiente local não tem servidor de e-mail de qualquer forma
  (`ECONNREFUSED 127.0.0.1:587`), mas a regra vale para não depender disso.
- **`@@unique(nome)` em `Servico` e o consentimento da assinatura** — migrações próprias, sem
  relação com este trabalho.
- **DPA com a OpenAI e rotação do token vazado** — pendências jurídicas registradas na ADR-137/141.

## contradicoes_resolvidas

- **Desktop-first × totalmente responsivo.** O `UI_GUIDELINES.md` §7 diz "o MVP é desktop-first,
  layout responsivo básico não deve quebrar". O dono pediu "totalmente responsivo", incluindo a
  área do cliente. **Vence o dono**, e o documento é corrigido junto com o código — guia que
  descreve a regra de ontem mente com autoridade. Nuance mantida: o app **interno** continua
  otimizado para o computador (é onde a Thaís opera oito horas), mas passa a **funcionar de
  verdade** no celular; o **Portal** passa a ser projetado a partir do celular, porque é lá que o
  médico o abre.
- **"Dados reais" — base fictícia × cadastro em produção.** O dono esclareceu: o que precisa ser
  real é o **conteúdo dos passos e das tarefas** que a Thaís vai seguir, e ele aprovou a base de
  demonstração rica no ambiente local. **Vence:** conteúdo operacional real + base local
  verossímil; produção intocada. Sem isso a esteira violaria a regra da casa (local usa dado de
  mentira, produção usa dado real) e o classificador barraria metade do trabalho.
- **Onde moram as primitivas novas.** `packages/ui` é a casa "correta" por nome, mas as 33
  existentes vivem em `apps/web/src/components/ui/` e toda a aplicação importa de lá. **Vence o
  lugar de fato**: as novas nascem ao lado das antigas. Mudar 33 caminhos de import para ganhar
  pureza de pacote é risco sem retorno nesta rodada.
- **Corrigir regra × refinar tela no mesmo lote.** A lição da ADR-139 diz para separar, porque
  misturar esconde qual dos dois quebrou. O dono quer as duas coisas. **Vence a separação por
  onda e por commit**, não por rodada: mesma branch, commits distintos e claramente rotulados,
  com os testes de regra escritos antes da correção (TDD) e os de tela depois.
- **Um PR grande × muitos pequenos.** A CI é escalonada e cada PR dispara a suíte inteira
  (medido: este repositório sozinho já consumiu 116% da cota mensal da conta). **Vence poucos PRs
  gordos** — três, um por grupo de ondas.

## duvidas_para_o_dono

Uma só, e ela pode esperar até a onda 4 (não bloqueia nada antes disso):

- **Cancelar um serviço deve encerrar a mensalidade?** Hoje o cancelamento na ficha não encerra a
  conta a receber recorrente, e a Med **segue cobrando** um serviço que já não presta (achado A6 /
  M16, `servicos-cliente.service.ts:277-326` contra `:169-179`). **RECOMENDO: sim, encerrar** — a
  cobrança acompanha a prestação, e o oposto vira devolução e desgaste com o cliente. Mas é
  decisão de dinheiro e de contrato, não minha. Pergunto quando a onda 4 começar.
