# Plano de execução — O Portal do cliente vira aplicativo (barra de 4 coringas + 1 vaga)

- **slug:** portal-app-5-secoes-2026-08-28 · **fase:** 4 (Plano) · **data:** 2026-08-28
- **branch de origem:** `feat/portal-app-5-secoes` · **HEAD lido:** `614b7b8`
- **entrada (contrato, não sugestão):** os três arquivos de
  `docs/esteira/portal-app-5-secoes-2026-08-28/` — `briefing.md`, `spec.md` e `design.md`, este
  último com a seção `decisao_do_dono_a_barra_e_dinamica`, que **substitui** a premissa de 5
  seções fixas.
- **índice do grafo:** `ready`, 6.453 nós, no mesmo `head_sha` da branch — a análise não está velha.

> **Regra de ouro deste plano:** duas etapas que rodam em paralelo **nunca** escrevem no mesmo
> arquivo. Onde havia interseção, virou dependência declarada. A lista de arquivos de cada etapa é
> **fechada** — tocar em arquivo fora dela é sinal de que o fatiamento errou, e a hora de dizer
> isso é antes de escrever, não no merge.

---

## Contexto verificado

Tudo abaixo foi lido no código desta branch, não presumido do `achados.md`.

- **O Portal é escolhido por papel, ignorando o caminho** — `apps/web/src/App.tsx:89`. As rotas
  públicas são resolvidas ANTES, por `window.location.pathname` (`App.tsx:50-58`), inclusive
  `/assinar/` e `/proposta/`: elas **não** passam pelo roteador novo e não podem passar.
- **Os dois testes-guarda leem o TEXTO de `apps/web/src/app/router.tsx`:**
  `apps/web/src/lib/paginas.test.ts:15-20` e `apps/web/src/components/GuiaTour.test.ts:14-18`, os
  dois com o mesmo regex de `path:`. Um `path: "/portal"` naquele arquivo reprova os dois — e o
  regex **não** casa `/portal/documentos`, então a falha viria pela metade. Confirmado.
  Logo: **roteador do Portal em arquivo próprio; `apps/web/src/lib/paginas.ts` não muda uma linha.**
- **"Qualquer caminho cai no Portal" é contrato testado em DOIS arquivos**, não um:
  `e2e/flows-portal.spec.ts:17-18` e `:22-23` (vai a `/financeiro`) **e** `e2e/rbac.spec.ts:42-46`
  (vai a `/clientes`). Os quatro `expect` casam um heading pelo padrão `/Portal/i`.
- **A tipagem aguenta dois roteadores.** `router.tsx:275-279` declara `interface Register` uma vez
  só; `node_modules/@tanstack/react-router/dist/esm/link.d.ts:47` mostra que `LinkComponent` tem
  `TRouter` com padrão `RegisteredRouter` — logo dá para passar o roteador do Portal como generic
  explícito no `Link`, sem redeclarar nada.
- **`credenciamentoParaOPortal` devolve `null` sem processo** —
  `apps/api/src/modules/servicos/credenciamento.service.ts:600-611`, guarda em `:602-603`. É esta
  a fonte da vaga dinâmica: nenhum campo novo, nenhuma consulta nova.
- **O guarda do servidor tem DUAS condições**, `apps/api/src/trpc/trpc.ts:98-100` (a sessão de
  suporte barra toda mutação) e `:110-112` (`podeNoPortal`), com mensagens diferentes
  (`SUPORTE_SO_LEITURA` × `PORTAL_SO_RESPONSAVEL`). E o padrão de "função pura devolve o MOTIVO,
  servidor traduz em frase" **já existe** no mesmo arquivo: `aceiteProcedure`, `trpc.ts:40-51`,
  com `podeAssinarPelaClinica` + `MotivoSemAssinar` (`packages/shared/src/portal-papeis.ts:148-167`).
- **M12 são quatro botões, e as linhas do `achados.md` estão erradas** (o arquivo tem 560 linhas
  hoje). As corretas, conferidas:

  | botão | onde | ação tRPC |
  |---|---|---|
  | "Não tenho mais interesse" | `PortalHome.tsx:185-196` → `:109-121` | `desistir` |
  | "Quero retomar" | `PortalHome.tsx:214-216` → `:123-133` | `retomar` |
  | "Solicitar" (catálogo) | `PortalHome.tsx:262-268` → `:100-107` | `solicitarServicos` |
  | "Cancelar serviço" | `PortalServicos.tsx:79-84` → `:36-47` | `cancelarServico` |

  Nenhuma das quatro está em `ACOES_LIBERADAS_PARA_EQUIPE` (`portal-papeis.ts:54-67`).
- **`EmptyState` existe e serve** (`apps/web/src/components/ui/empty-state.tsx`) — e renderiza um
  `h2`, então não disputa o `h1` da seção. `Skeleton`, `Card`, `Badge`, `Modal`, `UploadArquivo`,
  `useConfirm`/`usePrompt` e `toast` idem, todos já usados pelo Portal.
- **Tokens existem:** `--warning` e `--warning-foreground` (`index.css:43-44`), `--primary`
  (`:19`), `--shadow-color` (`:57`). Tailwind 3.4.17, então `min-h-dvh` é suportado.
  `apps/web/index.html:5` **não** traz `viewport-fit=cover` (e não ganha nesta rodada).
- **`packages/ui` exporta só `cn`** — confirmado. Nenhuma dependência nova é necessária.

### Premissas do pedido que NÃO se confirmaram

1. **`FaixaDeSuporte.tsx` tem 48 linhas, não ~330.** As citações `:299-332`, `:307`, `:311` e
   `:314` (no `spec.md`, no `design.md` e no briefing desta fase) estão **erradas**. As linhas
   reais: a recarga `window.location.href` em **`FaixaDeSuporte.tsx:23`**; a guarda
   `if (!user.operador) return null` em **`:27`**; o `sticky top-0 z-40` com o âmbar em **`:30`**.
   O comportamento descrito está certo; os números, não.
2. **NÃO existe sessão e2e com papel EQUIPE.** `e2e/auth.setup.ts:10-14` cria quatro perfis:
   `root`, `admin`, `funcionario` e `cliente`. O `spec.md:515-516` afirma que "o e2e já entra como
   EQUIPE em `flows-pessoas-do-portal.spec.ts`" — **não entra**: aquele spec usa
   `e2e/.auth/admin.json` e trabalha o lado INTERNO (`/clientes`). Consequência para a etapa M12:
   **a prova da trava de papel é teste de unidade da função pura mais conferência na tela**, não
   e2e — criar um perfil EQUIPE de e2e é trabalho próprio e está fora do escopo desta rodada.
3. **Não há Testing Library no repositório.** Os testes de componente existentes montam com
   `react-dom/client` e `act` na mão (`apps/web/src/components/ui/modal.test.tsx:1-8`, que
   documenta a ausência). Portanto "um caso de tela por botão" (`spec.md:514-515`) **não é
   barato**: a prova de tela do M12 fica no roteiro de cliques, e o que vira teste automático é a
   **função pura** e a lista de seções.
4. **O H1 do Início briga com quatro asserções de e2e.** `design.md:354` manda
   `H1 = "Olá, Clínica Vida Plena"`; `flows-portal.spec.ts:18,23` e `rbac.spec.ts:43,46` exigem um
   heading que case `/Portal/i`. **Não dá para ter os dois como estão** — resolvido na Etapa 1
   (ver *Decisão D1*).
5. **`PortalCredenciamento.tsx` não desenha "bloco por médico com CRM"** como o design supõe:
   `:161-171` mostra apenas nome e especialidade — **`conselhoNumero` e `conselhoUf` não são
   devolvidos** por `credenciamentoParaOPortal` (`credenciamento.service.ts:604-610` recorta para
   id, nome e especialidade). Mostrar CRM exigiria mexer no servidor: **fora de escopo**, e o
   design deve ser cumprido sem o CRM.

---

## Decisões que este plano toma (para o dono vetar numa linha)

**D1 — o H1 do Início.** Duas leituras legítimas; escolher em silêncio custaria uma execução.

| Leitura | O que se faz | Custo |
|---|---|---|
| **A (RECOMENDADA)** — a palavra "Portal" fica no H1 | `H1 = "Seu Portal"`; a saudação desce para o subtítulo: *"Olá, Clínica Vida Plena — o que precisa da sua atenção hoje."* | Uma linha de desvio do `design.md`. **Zero** mudança nos quatro `expect` de e2e; a saudação e o nome da clínica continuam na primeira dobra |
| B — o design ao pé da letra | `H1 = "Olá, Clínica Vida Plena"`, e as 4 asserções passam a conferir a URL `/portal` mais a barra de navegação visível | Mexe em guarda de regressão para ganhar uma palavra. Só vale se o dono fizer questão do texto exato |

Este plano segue a **leitura A**. Trocar é editar duas linhas na Etapa 1 e quatro nos e2e.

**D2 — o "o que ainda falta enviar" aparece em dois lugares, de propósito.** O `design.md:222-224`
põe as exigências pendentes no meio da seção *Documentos*; a mesma informação vive dentro do card
de cada serviço em *Meus serviços*. São **duas apresentações da mesma consulta**
(`portal.meusServicos`), não duas regras: uma é a **fila plana** ("o que a Med está esperando"), a
outra é o **checklist por serviço**. Ficam em arquivos diferentes para as Etapas 2 e 3 rodarem em
paralelo, e nenhuma das duas reimplementa régua nenhuma.

**D3 — contador em três seções, não em cinco.** Convênios (`progresso.faltam`), Meus serviços
(soma de `pendentes`) e Suporte (soma de `naoLidas`). **Início nunca tem contador** (a seção *é* a
fila — `design.md:573-575`) e **Documentos também não** (não existe fonte, e a pendência já é
contada nas outras duas — `spec.md:400-406`). As três consultas do contador são **as mesmas** que
as seções usam: mesma chave de cache, **uma** ida ao servidor.
`portal.servicosDisponiveis` (11,9 s em produção) e `portal.emails` **não** alimentam contador e
passam a carregar só nas suas seções — é daí que sai o ganho de desempenho.

---

## Riscos

1. **Uma das 53 funcionalidades sumir sem ninguém notar.** É o risco central do briefing. Freio: a
   Etapa 1 é uma **mudança de casa sem redesenho** — nenhum bloco é reescrito, só realocado —, e o
   roteiro de cliques no fim deste arquivo percorre os 53 itens do mapa do `spec.md`. Se um bloco
   não tiver destino no código ao fim da Etapa 1, a etapa não está pronta.
2. **O operador da Med entra em laço.** "Voltar ao meu acesso" recarrega para `/`
   (**`FaixaDeSuporte.tsx:23`**) e, depois disso, a pessoa é FUNCIONARIO — para quem `/` é o
   Dashboard interno. Se o redirecionamento de `/` para `/portal` vazar para `App.tsx` ou para
   `apps/web/src/app/router.tsx`, ele volta e é jogado ao Portal outra vez, para sempre. **Freio:**
   o redirecionamento existe **só** dentro do roteador do Portal, e a Etapa 1 tem passo de
   conferência específico para isso.
3. **Endereço colado por quem não tem credenciamento.** `/portal/credenciamento` precisa
   redirecionar para `/portal` quando a consulta devolve `null` — senão um link de e-mail antigo
   vira tela em branco. Idem para o item da barra: some junto.
4. **A CI reprovar por um teste que ninguém leu.** `paginas.test.ts` e `GuiaTour.test.ts` leem
   `router.tsx` por texto: se alguém "resolver" pondo `/portal` lá, a falha aparece como "rotas sem
   lugar no menu", que não parece o que é. **Se acontecer, o conserto é apagar a rota daquele
   arquivo, nunca acrescentar entrada em `paginas.ts`.**
5. **`pnpm --filter @app/api test:unit` NÃO roda a integração** (armadilha registrada no
   `CLAUDE.md`; custou uma CI vermelha em 28/08). A etapa que mexe em `apps/api` roda a suíte
   inteira: `pnpm --filter @app/api test`.
6. **O `Decimal` não pode atravessar o tRPC** (ADR-118). Nenhuma etapa aqui mexe em serviço que
   devolva dinheiro — se alguma precisar, pare e replaneje.

---

## Etapas

### Etapa 1 — O esqueleto: roteador próprio, shell, barra dinâmica e a mudança de casa

**Objetivo.** O cliente passa a navegar o Portal por endereços (`/portal`, `/portal/documentos`,
`/portal/credenciamento`, `/portal/servicos`, `/portal/suporte`, `/portal/equipe`), com barra
inferior fixa no celular e abas no computador; recarregar devolve a mesma seção e o "voltar" do
navegador funciona. **Nenhum conteúdo é redesenhado nesta etapa** — cada bloco de hoje é recortado
e colado na seção de destino, exatamente como está.

**Arquivos (lista fechada).**

- `apps/web/src/App.tsx` *(edita)*
- `apps/web/src/features/portal/PortalApp.tsx` *(novo)*
- `apps/web/src/app/portal-router.tsx` *(novo)*
- `apps/web/src/features/portal/secoes.ts` *(novo)*
- `apps/web/src/features/portal/secoes.test.ts` *(novo)*
- `apps/web/src/features/portal/PortalTabBar.tsx` *(novo)*
- `apps/web/src/features/portal/PortalLayout.tsx` *(edita)*
- `apps/web/src/features/portal/FaixaDeSuporte.tsx` *(edita)*
- `apps/web/src/index.css` *(edita — só o `:root`)*
- `apps/web/src/features/portal/PortalHome.tsx` *(REMOVIDO ao fim da etapa)*
- `apps/web/src/features/portal/paginas/PortalInicio.tsx` *(novo)*
- `apps/web/src/features/portal/paginas/PortalDocumentosPage.tsx` *(novo)*
- `apps/web/src/features/portal/paginas/PortalCredenciamentoPage.tsx` *(novo)*
- `apps/web/src/features/portal/paginas/PortalServicosPage.tsx` *(novo)*
- `apps/web/src/features/portal/paginas/PortalSuportePage.tsx` *(novo)*
- `apps/web/src/features/portal/paginas/PortalEquipePage.tsx` *(novo)*
- `e2e/flows-portal-ui.spec.ts` *(edita)*
- `e2e/flows-credenciamento-portal.spec.ts` *(edita)*

**Não tocar, em hipótese nenhuma:** `apps/web/src/app/router.tsx` · `apps/web/src/lib/paginas.ts` ·
`apps/web/src/lib/paginas.test.ts` · `apps/web/src/components/GuiaTour.tsx` e o teste dele ·
qualquer arquivo em `apps/api` ou em `packages/`.

**Contexto que o executor precisa.**

- Hoje: `App.tsx:86-100` decide entre Portal e roteador interno; `PortalLayout.tsx:235` recebe
  `children` e o desenha em `:258`; `PortalHome.tsx` (560 linhas) empilha 16 blocos.
- O `rootRoute` interno é o `AppLayout` (`router.tsx:55`) — nada do Portal pode pendurar ali.
- `App.tsx:50-58` fica **intocado**: é por `/assinar/:token` e `/proposta/:token` que o responsável
  assina, e essas rotas são resolvidas antes do `auth.me`.
- `PortalLayout` e `PortalHome` já são `lazy` (`App.tsx:23-24`) pelo motivo escrito em
  `App.tsx:7-15`. Uma instância de roteador não pode ser `lazy` diretamente: por isso nasce
  `PortalApp.tsx`, arquivo fino que só devolve o `RouterProvider` do Portal, e é **ele** que vira o
  `lazy` no `App.tsx`.
- Empilhamento de camadas a respeitar: faixa de suporte `sticky top-0 z-40`
  (**`FaixaDeSuporte.tsx:30`**), cabeçalho `sticky top-0 z-30` (`PortalLayout.tsx:242`), modais
  `z-50` (`PortalDocumentoModal.tsx:23`). A barra inferior é `fixed inset-x-0 bottom-0 z-40` —
  extremidade oposta, não colide.

**Fazer.**

1. **`portal-router.tsx`**: rota-raiz com `PortalLayout` como `component`, mais as seis rotas da
   tabela do `spec.md` (seção `rotas`), cada página por `lazyRouteComponent`. Mais **uma rota
   curinga** (`path: "$"`) cujo `beforeLoad` lança um `redirect` para `/portal` — é ela que
   preserva o "qualquer caminho cai no Portal", inclusive `/financeiro` e `/clientes`. Deixe também
   o `defaultNotFoundComponent` redirecionando, como cinto de segurança. **Não** declarar
   `interface Register` neste arquivo; onde usar `Link` ou `useRouterState`, passar o roteador do
   Portal como generic explícito.
2. **`PortalLayout`** deixa de receber `children` e vira o `component` da raiz, trocando o
   `{children}` de `:258` por um `Outlet`. Ganha: `min-h-dvh` no lugar de `min-h-screen`;
   `overscroll-behavior: contain`; o `main` com respiro inferior de
   `calc(var(--portal-tabbar-h) + env(safe-area-inset-bottom) + 1rem)` **abaixo de `md`**; o
   cabeçalho grudando em `top: var(--portal-faixa-h)`; e a barra. No **menu do avatar**
   (`ProfileMenu`, `:18-70`) entram, nesta ordem e com estes rótulos: **Equipe da clínica**
   (`Users`, leva a `/portal/equipe`) · **Editar perfil** (`UserCog`, como hoje) · **Guia do
   Portal** (`HelpCircle`) · separador · **Sair** (`LogOut`). O botão de ajuda solto do cabeçalho
   (`:246-253`) **sai** — o guia agora mora no menu.
3. **`FaixaDeSuporte`**: mede a própria altura com `ResizeObserver` e publica em
   `--portal-faixa-h` (0px quando ela não existe). Não mexer na recarga da linha 23 — é proposital.
4. **`index.css`**: acrescentar ao `:root` `--portal-tabbar-h: 56px` e `--portal-faixa-h: 0px`.
   Nenhum token de cor novo.
5. **`secoes.ts`** — o coração da decisão do dono. Exporta `SECOES_FIXAS` (as quatro coringas, com
   rota, rótulo, ícone e a chave do contador) e **`CANDIDATAS_DA_VAGA`**, um array de objetos com
   `chave`, `rotulo`, `rota` e `aplica`. Hoje há **uma** candidata: credenciamento, rótulo
   **Convênios**, rota `/portal/credenciamento`, aplicável quando a consulta do credenciamento não
   é nula. Mais uma função pura `montarSecoes(dados)` que devolve a lista final, com a vaga **na 3ª
   posição** e **no máximo uma** candidata. É **proibido** escrever um `if` de credenciamento
   dentro do componente da barra: a razão é que a próxima frente de trabalho (Faturamento com tela
   própria) precisa entrar acrescentando uma linha na lista, sem abrir a barra.
6. **`PortalTabBar.tsx`** (~50 linhas, zero dependência nova): abaixo de `md`, um `nav` fixo com
   rótulo acessível "Seções do Portal" e `gridTemplateColumns` calculado a partir do número de
   seções — **nunca** `flex` com largura fixa, **nunca** um item invisível ocupando lugar. A partir
   de `md`, a mesma lista vira a fileira de abas sticky sob o cabeçalho, dentro do `max-w-4xl`, e a
   barra inferior some. Ativo em `--primary` com uma barra de 3px no topo do item; inativo em
   `--muted-foreground`; contador em pílula `bg-warning` ancorada ao **ícone**, virando "9+" a
   partir de 10, e o número exato sempre no `aria-label` (por exemplo: Serviços, 12 pendências).
   Em sessão de suporte a borda superior vira âmbar. Rótulos: **Início · Documentos · (Convênios) ·
   Serviços · Suporte**. Ícones lucide: `Home` · `FileText` · `Stethoscope` · `Package` ·
   `LifeBuoy` — quatro dos cinco já são os ícones que o Portal usa hoje.
7. **A mudança de casa**, seguindo o mapa do `spec.md` linha a linha: `PortalInicio` recebe os
   blocos 9 a 20; `PortalDocumentosPage` os 21 a 27; `PortalCredenciamentoPage` os 28 a 34
   (envolvendo `PortalCredenciamento`) **mais a guarda** — sem processo, redireciona para
   `/portal`; `PortalServicosPage` os 35 a 44 (`PortalServicos` mais o catálogo do autosserviço,
   que sai do `PortalHome`); `PortalSuportePage` os 45 a 50; `PortalEquipePage` os 51 a 53
   (`PortalMinhaEquipe`). `PortalHome.tsx` é **apagado**. Atenção ao rodapé do card "O que depende
   de você" (`PortalHome.tsx:367-369`), que manda falar com o Suporte "aqui embaixo" — deixa de ser
   verdade e vira link para `/portal/suporte`.
8. **D1**: `PortalInicio` abre com o H1 **Seu Portal** e o subtítulo
   *Olá, {clienteNome} — o que precisa da sua atenção hoje.*
9. **`secoes.test.ts`** (guarda, espelhando `paginas.test.ts`): sem candidata aplicável a barra tem
   **4** itens; com credenciamento tem **5**, com Convênios na 3ª posição; nunca 6; e **toda rota
   declarada em `secoes.ts` existe no texto de `apps/web/src/app/portal-router.tsx`** (leitura por
   `readFileSync`, como o guarda do app interno faz).
10. **e2e**: em `flows-portal-ui.spec.ts:15` e `:50`, trocar o `goto` da raiz por
    `/portal/servicos`; em `flows-credenciamento-portal.spec.ts:56` e `:91`, por
    `/portal/credenciamento`. **`flows-portal.spec.ts` e `rbac.spec.ts` NÃO mudam** — são a prova
    de que o "qualquer caminho cai no Portal" sobreviveu.

**Verificação.**

```
pnpm -r typecheck
pnpm --filter @app/web lint
pnpm --filter @app/web test
pnpm exec playwright test e2e/flows-portal.spec.ts e2e/rbac.spec.ts e2e/flows-portal-ui.spec.ts e2e/flows-credenciamento-portal.spec.ts
```

Espera-se: typecheck e lint sem erro; `paginas.test`, `GuiaTour.test` e o novo `secoes.test`
verdes; os quatro specs verdes. Na tela, como cliente do Portal: abrir `/portal/documentos`,
**recarregar** e cair na mesma seção; apertar "voltar" e voltar à seção anterior; digitar
`/financeiro` e cair em `/portal`. **Prova do laço:** entrar pelo botão *Painel* de um cliente
(como ADMIN), clicar em **Voltar ao meu acesso** e conferir que se chega ao **Dashboard interno** —
não ao Portal.

**Depende de:** nenhuma.

---

### Etapa 2 — Início e Documentos: cabeçalho, ordem, vazio, erro e 360px

**Objetivo.** As duas primeiras seções ganham a forma do `design.md`: ação primeiro, H1 curto com
subtítulo de uma linha, `Skeleton` no lugar de spinner, estado vazio com voz humana e erro que
oferece saída.

**Arquivos (lista fechada).**

- `apps/web/src/features/portal/paginas/PortalInicio.tsx`
- `apps/web/src/features/portal/paginas/PortalDocumentosPage.tsx`
- `apps/web/src/features/portal/PortalMeusDocumentos.tsx`
- `apps/web/src/features/portal/ExigenciasPendentes.tsx` *(novo)*

**Contexto.**

- Ordem do Início (`design.md:191-203`): saudação · **Propostas para você** · **Documentos para
  assinar** · **O que depende de você** · **Seu atendimento** · **Próxima reunião** · **Seus
  projetos**. Os três primeiros **somem quando vazios** — aqui vazio é boa notícia.
- Com os três vazios, entra o `EmptyState` com `CheckCircle2`: **Está tudo em dia** /
  *Nada esperando por você agora. Quando precisarmos de algo, aparece aqui.*
- Documentos, na ordem: acervo da Med · **o que ainda falta enviar** (a decisão D2, no
  `ExigenciasPendentes` novo, lendo `portal.meusServicos`) · o que o cliente enviou. O bloco do
  meio é o **único acionável** dos três; enterrá-lo no fim é o que faz o cliente achar que já
  entregou tudo.
- Textos exatos (H1, subtítulo, vazios, erros) estão na seção `textos` do `design.md` — copiar de
  lá, não reescrever.
- **A decisão D1 vale:** o H1 do Início contém a palavra **Portal**. Mudá-lo quebra quatro
  asserções em `e2e/flows-portal.spec.ts` e `e2e/rbac.spec.ts`.
- Os ramos de token da ADR-137 (`PortalHome.tsx:293-303` e `:326-336`, com as constantes de
  `:26-27`) **ficam como estão** — é regra de negócio, não apresentação.
- 360px: card de largura total, `p-4`, botão de ação ocupando a largura toda, nada de tabela,
  `truncate` em nome longo, `min-w-0` nos contêineres.

**Verificação.**

```
pnpm -r typecheck
pnpm --filter @app/web lint
pnpm --filter @app/web test
pnpm exec playwright test e2e/flows-portal.spec.ts e2e/rbac.spec.ts
```

Espera-se tudo verde. Na tela, a 360x800 e 1920x1080: `/portal` e `/portal/documentos` sem rolagem
horizontal, sem elemento cortado, `Skeleton` (nunca spinner) durante a carga, e **zero erro de
console**.

**Depende de:** Etapa 6 (que já terá aplicado a trava de papel em `PortalInicio.tsx`).

---

### Etapa 3 — Meus serviços e Convênios

**Objetivo.** As duas seções que carregam a papelada ganham a forma do design, e
`portal.servicosDisponiveis` (11,9 s em produção) passa a ser disparada **só** aqui.

**Arquivos (lista fechada).**

- `apps/web/src/features/portal/paginas/PortalServicosPage.tsx`
- `apps/web/src/features/portal/PortalServicos.tsx`
- `apps/web/src/features/portal/paginas/PortalCredenciamentoPage.tsx`
- `apps/web/src/features/portal/PortalCredenciamento.tsx`

**Contexto.**

- Meus serviços: contratados (nome, preço, convênios, checklist) e depois o catálogo do
  autosserviço. Vazio: `EmptyState` `Package` — **Você ainda não tem serviços ativos** /
  *Veja abaixo o que podemos fazer por você* — e o catálogo **logo em seguida**. Atenção: hoje
  `PortalServicos.tsx:34` faz `return null` quando não há serviço, e some a tela inteira; a seção
  precisa de estado vazio próprio.
- Convênios: H1 *Credenciamento nos convênios*, subtítulo *A papelada de cada médico, por
  convênio*; resumo com barra de progresso (que conta **pares**: documento x médico x lado); um
  bloco por médico; frente e verso como **duas vagas separadas**.
  **Sem CRM na tela** — `credenciamentoParaOPortal` devolve só id, nome e especialidade
  (`credenciamento.service.ts:604-610`); pedir mais é mexer no servidor, que está fora de escopo.
  E o cliente **nunca** lê o veredito da triagem: só `dados.pendencias`, que já vem redigido como
  pedido (ADR-103).
- **A guarda da rota** (sem processo, redireciona a `/portal`) foi montada na Etapa 1 e **não pode
  ser removida** ao refinar.
- A trava de papel dos botões de cancelar e de solicitar chega da Etapa 6 e **fica**.
- 360px: o card do serviço empilha preço e convênios; o catálogo vira lista de uma coluna; na vaga
  de credenciamento, Frente/Verso como `Badge` à esquerda do botão.

**Verificação.**

```
pnpm -r typecheck
pnpm --filter @app/web lint
pnpm --filter @app/web test
pnpm exec playwright test e2e/flows-portal-ui.spec.ts e2e/flows-credenciamento-portal.spec.ts
```

Na tela, como cliente do Portal: enviar um documento por uma vaga de credenciamento e ver o
progresso subir; abrir o catálogo em Meus serviços. **Prova de desempenho:** na aba Rede do
navegador, `portal.servicosDisponiveis` **não** aparece ao abrir `/portal`, e aparece ao abrir
`/portal/servicos`.

**Depende de:** Etapa 6.

---

### Etapa 4 — Suporte e Equipe da clínica

**Objetivo.** A seção de falar com a equipe fica com o botão de abrir chamado como primeiro
elemento, a conversa vira tela cheia com o campo de escrita ancorado acima da barra, e a lista de
pessoas da clínica ganha endereço próprio.

**Arquivos (lista fechada).**

- `apps/web/src/features/portal/paginas/PortalSuportePage.tsx`
- `apps/web/src/features/portal/PortalSuporte.tsx`
- `apps/web/src/features/portal/SuporteChat.tsx`
- `apps/web/src/features/portal/paginas/PortalEquipePage.tsx`
- `apps/web/src/features/portal/PortalMinhaEquipe.tsx`

**Contexto.**

- Ordem: **Abrir um chamado** primeiro · lista de chamados (protocolo, assunto, situação, última
  mensagem) · **Seus e-mails** (`portal.emails`, só assunto e data). O `portal.emails` passa a
  carregar **só aqui**.
- Vazio: `EmptyState` `LifeBuoy` — **Nenhum chamado aberto** / *Precisa de alguma coisa? Abra um
  chamado que a nossa equipe responde por aqui* — mais o botão.
- **A barra continua visível dentro do chamado.** Escondê-la tiraria a única saída de quem entrou
  por engano. O campo de escrita fica ancorado em
  `bottom: calc(var(--portal-tabbar-h) + env(safe-area-inset-bottom))`, consumindo o token criado
  na Etapa 1.
- **Escolher um único caminho de "voltar"** dentro da conversa: hoje há o botão "Meus chamados"
  (`PortalSuporte.tsx:67-70`) e, com rotas, o botão do navegador. Recomendação: manter o botão e
  **não** criar rota por chamado nesta rodada — rota por chamado é produto novo.
- `PortalMinhaEquipe`: quem é EQUIPE **vê e não mexe** (`podeEditar={souResponsavel}`, `:56`) — já
  está correto e **não muda**. O aviso de que ninguém fala pela clínica
  (`PessoasDoPortal.tsx:305-311`) trava o negócio e agora vive numa tela fora do corpo:
  **espelhá-lo no Início fica FORA desta etapa** (tocaria `PortalInicio.tsx`, que é da Etapa 2) —
  anote como sugestão para o dono.
- `PessoasDoPortal.tsx` é **compartilhado com a ficha interna do cliente**: não tocar.
- 360px: balões com largura máxima de 85%; o campo cresce até 4 linhas e depois rola por dentro.

**Verificação.**

```
pnpm -r typecheck
pnpm --filter @app/web lint
pnpm --filter @app/web test
pnpm exec playwright test e2e/realtime-mensagens.spec.ts
```

Na tela, a 390x844: abrir um chamado, escrever uma mensagem e conferir que **o campo de escrita
nunca fica embaixo da barra inferior**; abrir o menu do avatar, ir em *Equipe da clínica* e cair em
`/portal/equipe` com a lista.

**Depende de:** Etapa 1.

---

### Etapa 5 — Um guia por seção

**Objetivo.** O botão de ajuda deixa de abrir um texto único e genérico e passa a abrir o guia **da
seção em que a pessoa está**, com um guarda que impede seção nova de nascer sem guia.

**Arquivos (lista fechada).**

- `apps/web/src/features/portal/GuiaPortal.tsx`
- `apps/web/src/features/portal/GuiaPortal.test.ts` *(novo)*

**Contexto.**

- Hoje: `PASSOS_PORTAL`, 5 passos, `GuiaPortal.tsx:9-41`, aberto pelo menu do avatar (a Etapa 1
  moveu o botão para lá).
- O visual é desacoplado e **já é reusado**: `GuiaModal` (`GuiaTour.tsx:346-360`) recebe `titulo`,
  `passos` e `resetKey`, e `GuiaPortal.tsx:44` já o chama.
- Passa a haver uma lista com a forma de `OUTRAS` (`GuiaTour.tsx:308-329`), com **6 entradas**:
  `/portal/documentos`, `/portal/credenciamento`, `/portal/servicos`, `/portal/suporte`,
  `/portal/equipe` e — **por último** — `/portal`. O `/portal` é prefixo de todos os outros: posto
  primeiro, o `startsWith` captura tudo e as cinco seções abrem o guia do Início. É exatamente a
  armadilha que `GuiaTour.test.ts:40-54` existe para pegar.
- Ler a rota atual com `useRouterState` tipado no roteador do Portal — só válido dentro do
  `RouterProvider` dele — e passar `resetKey` com o caminho ao `GuiaModal`, para o carrossel voltar
  ao passo 1 a cada troca de seção, como o app interno já faz em `GuiaTour.tsx:477`.
- Conteúdo: os 5 passos de hoje se dividem quase sozinhos — *Seus serviços* (`:18-22`) para Meus
  serviços · *Documentos e assinatura* (`:23-28`) para Documentos · *Suporte* (`:29-34`) para
  Suporte · *Seus dados, protegidos* (`:35-40`) para Equipe · *Bem-vindo* (`:10-16`) para Início.
  **Falta escrever o de Convênios**, que nunca teve passo próprio. Cada guia com **2 passos no
  mínimo**, título com mais de 2 caracteres e descrição com mais de 30.
- **Não pôr os guias do Portal em `OUTRAS`.** O `GuiaTour` filtra passo por papel **interno**
  (`:476`), que o cliente não tem, e `GuiaTour.test.ts:14-18` cruza aquela lista com `router.tsx`.
  São os catálogos do app da equipe.
- **`GuiaPortal.test.ts`** espelha as três asserções de `GuiaTour.test.ts`, lendo
  `apps/web/src/app/portal-router.tsx` em vez de `router.tsx`: cobertura (nenhuma rota cai no
  genérico), ordem de prefixos (`/portal` por último) e guia completo.

**Verificação.**

```
pnpm --filter @app/web test
pnpm -r typecheck
pnpm --filter @app/web lint
```

Espera-se `GuiaPortal.test.ts` verde e `GuiaTour.test.ts` intacto. Na tela: abrir a ajuda pelo menu
do avatar em cada uma das seções e conferir que o **título muda** e que o carrossel **volta ao
passo 1** a cada troca.

**Depende de:** Etapa 1.

---

### Etapa 6 — M12: a trava de papel aparece antes do clique, com UMA régua só

**Objetivo.** A secretária (papel EQUIPE) e a sessão de suporte da Med deixam de ver quatro botões
que o servidor vai recusar. E o servidor passa a usar **a mesma função pura** que a tela — sem isso
o conserto cria a divergência que veio evitar (o modo de falha da ADR-133).

**Arquivos (lista fechada).**

- `packages/shared/src/portal-papeis.ts`
- `apps/api/src/trpc/trpc.ts`
- `apps/api/src/test/portal-papeis.test.ts`
- `apps/web/src/features/portal/paginas/PortalInicio.tsx`
- `apps/web/src/features/portal/paginas/PortalServicosPage.tsx`
- `apps/web/src/features/portal/PortalServicos.tsx`

**Contexto.**

- Os quatro botões, com as linhas **conferidas nesta branch** (as do `achados.md` estão
  desatualizadas): desistir (`PortalHome.tsx:185-196`, ação em `:109-121`), retomar (`:214-216`,
  ação em `:123-133`), solicitar serviços (`:262-268`, ação em `:100-107`) e cancelar serviço
  (`PortalServicos.tsx:79-84`, ação em `:36-47`). Depois da Etapa 1 os três primeiros moram em
  `PortalInicio.tsx` e `PortalServicosPage.tsx` — **localize-os pelo texto do botão, não pela
  linha**.
- O guarda do servidor aplica **duas** condições, com **mensagens diferentes**: `trpc.ts:98-100`
  (sessão de suporte, mensagem `SUPORTE_SO_LEITURA`) e `:110-112` (`podeNoPortal`, mensagem
  `PORTAL_SO_RESPONSAVEL`).
- **O molde já existe no mesmo arquivo:** `aceiteProcedure` (`trpc.ts:40-51`) chama
  `podeAssinarPelaClinica`, recebe um veredito com `motivo` e traduz o motivo em frase. Repita esse
  molde. Reuse `SessaoQueAssina` (`portal-papeis.ts:155-158`) e `MotivoSemAssinar` (`:148`) — o
  campo do operador é tipado como **objeto**, não `unknown`, de propósito (`:150-154`): com
  `unknown` o compilador aceitaria valores falsy que fariam a trava sumir em silêncio.
- A função nova, ao lado das outras em `portal-papeis.ts`: recebe a sessão e o nome da ação (o
  caminho tRPC **sem** o prefixo do Portal, `:51-53`) e devolve o mesmo formato de veredito.
  Substitui **as duas** condições de `:98-112` por uma chamada. É refatoração **sem mudança de
  comportamento** — a matriz de decisão tem de sair idêntica.
- Na tela: **esconder o botão e pôr no lugar a frase curta**, no mesmo padrão que a ADR-137 já usa
  em `PortalHome.tsx:26-27` (*Só o responsável pela clínica responde* / *assina*). Aqui:
  *Só o responsável pela clínica cancela*, e assim por diante.
  **Esconder com explicação, nunca desabilitar em silêncio** — botão apagado sem motivo é o defeito
  que se relata como "o sistema não funciona".
  **O item continua visível.** A trava é sobre agir, não sobre ver (`portal-papeis.ts:17-21`): a
  secretária precisa saber que existe um serviço contratado para avisar quem cancela.
- A sessão de suporte da Med é coberta pelo mesmo caminho (o campo do operador faz a função recusar
  tudo) — hoje o operador também vê os quatro botões e leva a recusa depois de confirmar o modal.
- **Não existe perfil e2e com papel EQUIPE** (`e2e/auth.setup.ts:10-14` cria só root, admin,
  funcionario e cliente) e **não há Testing Library** neste repositório
  (`components/ui/modal.test.tsx:1-8`). Portanto: teste automático = **unidade da função pura**, na
  matriz papel x ação x sessão de suporte, dentro de `apps/api/src/test/portal-papeis.test.ts`
  (onde as outras já moram). A prova de tela é o roteiro no fim deste arquivo.
- **`pnpm --filter @app/api test:unit` NÃO roda a integração.** Esta etapa mexe em
  `apps/api/src/trpc/trpc.ts`, que atravessa **todo** o Portal: rode a suíte inteira.

**Verificação.**

```
pnpm -r typecheck
pnpm -r lint
pnpm --filter @app/api test
pnpm --filter @app/web test
```

O `pnpm --filter @app/api test` é a **suíte inteira**, como a CI — não o `test:unit`. Na tela, com
uma conta EQUIPE (receita no roteiro abaixo): os quatro botões **não aparecem**, e no lugar de cada
um está a frase; com a conta responsável, os quatro **aparecem e funcionam**. E a prova de que o
servidor não afrouxou: entrando pelo *Painel* (sessão de suporte) e tentando qualquer mutação, a
recusa continua sendo a de só-leitura.

**Depende de:** Etapa 1.

---

## Paralelizável

- **Onda 1 (sozinha):** **Etapa 1**. Ela cria os arquivos que todas as outras editam.
- **Onda 2 (três worktrees ao mesmo tempo):** **Etapa 4** (Suporte e Equipe) · **Etapa 5** (guia) ·
  **Etapa 6** (M12). Interseção de arquivos entre elas: **nenhuma**.
- **Onda 3 (duas worktrees ao mesmo tempo):** **Etapa 2** (Início e Documentos) · **Etapa 3**
  (Serviços e Convênios). Interseção entre elas: **nenhuma**.

## Sequencial obrigatório

- **Tudo depois da Etapa 1**, porque é ela quem cria `portal-router.tsx`, `secoes.ts`, a barra e os
  seis arquivos de página. Antes dela não há onde editar.
- **Etapas 2 e 3 depois da Etapa 6**, e a razão é de arquivo: a Etapa 6 escreve em
  `PortalInicio.tsx` e em `PortalServicos.tsx` / `PortalServicosPage.tsx`, exatamente os arquivos
  que as Etapas 2 e 3 refinam. Pôr a trava **antes** do refino tem uma vantagem além de evitar
  conflito: quem refina teria de **apagar a trava de propósito** para perdê-la — enquanto, na ordem
  inversa, bastaria esquecer.
- **A Etapa 4 não depende da 6** porque as duas ações de suporte (abrir chamado e enviar mensagem)
  já estão **liberadas** à EQUIPE (`portal-papeis.ts:65-66`) — não há botão a esconder ali.

---

## o que provar na tela

Roteiro de cliques no localhost. **Ambiente:** `node scripts/keep-alive.mjs`, com 4310 (web) e 4319
(API) respondendo. Contas: `pnpm contas:teste` (senha `teste1234`) ou as do seed. Manter o
**console do navegador aberto o tempo todo** — a régua é **zero erro**. Ao terminar, devolver a
janela a **1920x1080**.

### Preparação (uma vez)

1. **Uma conta EQUIPE de verdade.** Entrar como ADMIN, ir em `/clientes`, abrir a ficha do cliente
   do Portal, card **Pessoas com acesso ao Portal**: *Convidar pessoa* com papel **Responsável**
   (para a clínica não ficar sem quem assine) e, só então, **rebaixar a conta do cliente para
   Equipe**. Sem o primeiro passo o sistema **recusa** o rebaixamento (`sobraResponsavel`), em
   português. Assim a conta EQUIPE tem senha conhecida. **Ao terminar tudo, promover a conta de
   volta a Responsável** — senão os e2e que cancelam serviço passam a falhar.
2. **Os dois casos da barra, sem precisar de senha.** Entrar como ADMIN e usar o botão **Painel**
   (sessão de suporte, ADR-128) em **dois** clientes: um **com** o serviço de credenciamento
   contratado e um **sem**. Em sessão de suporte **toda mutação é recusada** — use-a só para
   **olhar**; para clicar, use o login real.

### A · Estrutura e navegação, a 390x844

1. Entrar como cliente do Portal. Sem rolar, ver: **logotipo**, o **H1 Seu Portal** com a saudação
   e o nome da clínica, o **primeiro card de ação** e a **barra inferior**.
2. Percorrer as seções pela barra: **Início, Documentos, (Convênios), Serviços, Suporte**. Em cada
   uma, conferir que o item ativo está em azul com a **barra de 3px no topo** e que o endereço
   mudou.
3. **Recarregar (F5)** em `/portal/servicos`: volta na **mesma** seção.
4. **Voltar do navegador** três vezes: desanda a navegação, sem sair do Portal.
5. Digitar `/financeiro` na barra de endereços: cai em **`/portal`**.
6. Digitar `/portal/xpto`: cai em **`/portal`**, sem "página não encontrada".
7. **Menu do avatar:** *Equipe da clínica* (vai a `/portal/equipe`) · *Editar perfil* (abre o
   modal, e o CNPJ recusa número inválido) · *Guia do Portal* · *Sair*.
8. **O último card de cada seção não fica embaixo da barra** — rolar até o fim das cinco.
9. **Sem rolagem horizontal em nenhuma seção.**

### B · A barra com e sem a vaga

10. Cliente **com credenciamento**: **5 itens**, com **Convênios** na 3ª posição e o ícone do
    estetoscópio; a barra preenche a largura, itens simétricos.
11. Cliente **sem credenciamento**: **4 itens** (Início, Documentos, Serviços, Suporte), **mais
    largos**, barra simétrica, **nenhum buraco** e nenhum item morto.
12. Nesse mesmo cliente, digitar `/portal/credenciamento`: **redireciona para `/portal`**.

### C · Contadores

13. Como equipe, deixar pelo menos **duas** exigências pendentes num serviço e **uma** mensagem de
    suporte não lida. No Portal: as pílulas âmbar aparecem em Serviços e Suporte, e o número **bate
    com o que a seção mostra por dentro**.
14. **Início e Documentos não têm contador** — conferir que nenhuma pílula aparece neles.
15. Resolver uma pendência (enviar o documento): o contador **desce sozinho** na barra.

### D · Os dois papéis (M12)

16. Entrar com a conta **EQUIPE**. Em Início: **não** existem "Não tenho mais interesse" nem "Quero
    retomar" — no lugar, a frase de que só o responsável faz isso. Em Serviços: **não** existem
    "Cancelar serviço" nem o botão de solicitar do catálogo; as frases estão lá. **Os itens
    continuam visíveis** — a lista de serviços, o catálogo e as propostas aparecem.
17. Ainda como EQUIPE: Documentos, Convênios e Suporte funcionam inteiros — **enviar um arquivo**,
    **preencher um briefing** e **abrir um chamado** têm de dar certo (são ações liberadas).
18. Em Equipe da clínica, quem é EQUIPE **vê a lista e não tem botão de mexer**.
19. Sair e entrar com a conta **RESPONSÁVEL**: os quatro botões voltam e **funcionam** (cancelar um
    serviço de teste e conferir o aviso na tela).
20. **Sessão de suporte:** entrar pelo *Painel* como ADMIN — a **faixa âmbar** no topo, a **barra
    com borda âmbar** embaixo, navegação livre pelas seções, e **Voltar ao meu acesso** levando ao
    **Dashboard interno** (não ao Portal, e sem laço).

### E · Guia por seção

21. Abrir a ajuda (menu do avatar) em cada uma das seções: o **título muda**, o conteúdo fala
    daquela seção, e o carrossel **volta ao passo 1** a cada troca. Em Convênios, o guia é o novo —
    não pode ser o do Início.

### F · Larguras

22. **360x800:** repetir A1 a A9 e B10 a B11. Alvo de toque de **44px no mínimo** em todo item do
    menu (a barra tem 56px de altura útil); nenhum rótulo cortado; nenhuma tabela.
23. **390x844:** idem, com mais folga. No Suporte, abrir um chamado e conferir que o **campo de
    escrita fica acima da barra**, nunca por baixo dela.
24. **1920x1080:** a barra inferior **não existe**; no lugar, a fileira de **abas sticky** sob o
    cabeçalho, com os mesmos rótulos, ícones, ordem e contadores. O corpo continua em `max-w-4xl`
    **centrado** — nenhuma tela esticada na largura toda.
25. **Girar para paisagem (844px de largura):** aparecem as **abas** e some a barra — nunca as duas
    ao mesmo tempo.

### G · Desempenho (o ganho que sai de graça)

26. Aba **Rede** do navegador, carregando `/portal`: **`portal.servicosDisponiveis` não aparece**
    (é a consulta de 11,9 s em produção) e **`portal.emails` não aparece**. Ir a `/portal/servicos`
    e a primeira aparece; ir a `/portal/suporte` e a segunda aparece.

### H · A varredura das 53

27. Com o mapa `mapa_bloco_para_secao` do `spec.md` aberto ao lado, percorrer as **53 linhas** e
    marcar cada uma como alcançável. É este passo, e não a suíte de testes, que fecha o risco
    principal do briefing: a página única de hoje **garante** que tudo está visível por rolagem; a
    divisão em seções pode esconder uma funcionalidade sem ninguém notar.

---

## O que eu não consegui confirmar

- **Se o cliente do Portal do banco local tem processo de credenciamento em curso.** Não rodei o
  banco. Quem executar o roteiro precisa conferir na ficha antes de julgar a barra "errada" por
  mostrar 4 itens.
- **Se o `Link` tipado no roteador do Portal compila sem atrito na 1.170.17.** A tipagem
  (`link.d.ts:47`) diz que sim, e o `spec.md` verificou o mesmo em disco — mas **ninguém compilou
  ainda**. Se der atrito, a saída barata é um `PortalLink` tipado uma vez em `portal-router.tsx`,
  do qual o resto do Portal importa. **Não** redeclare `interface Register`.
- **Quanto do `PortalHome.tsx` sobrevive intacto à mudança de casa.** Estimo que quase tudo (é
  recorte, não reescrita), mas o card do catálogo (`:232-275`) é uma função imediata que mistura
  `catalogo.data` com `r.servicosAtuais` do resumo — mudá-lo de seção significa que
  `PortalServicosPage` também consome `portal.resumo`. É consulta leve e já em cache; se o executor
  preferir, pode passar só a lista de nomes por props.
- **Se o `ResizeObserver` da faixa de suporte se justifica.** É a solução correta (a faixa quebra
  em duas linhas a 360px), mas o cliente de verdade **nunca** vê a faixa. Se custar mais de umas 15
  linhas, um `--portal-faixa-h` fixo com dois valores por breakpoint resolve — só não vale chutar
  40px e deixar o logotipo passar por trás dela ao rolar.
- **O e-mail de ação levando à seção certa** (`design.md:505-509`: proposta em `/portal`, exigência
  em `/portal/documentos`, papelada em `/portal/credenciamento`). Não conferi os templates. **Não
  está em nenhuma etapa deste plano** — é conteúdo de e-mail, não navegação; se o dono quiser,
  entra numa rodada própria.

## Fora do plano, de propósito (dito em uma linha e seguido adiante)

Manifesto web para o Portal abrir em tela cheia (~15 linhas, `design.md:477-481`) · o
`viewport-fit=cover` no `index.html` (é mudança global disfarçada de meta tag) · espelhar no Início
o aviso de que ninguém fala pela clínica · rota por chamado de suporte · e os achados M9, C7, C8 e
F20, que o briefing já pôs em `fora_de_escopo`.
