# Achados — grupo "Negócio" (Funil de Vendas · Clientes · Serviços · Credenciamentos · Documentos · Financeiro)

> Auditoria só de leitura, 11/09/2026. Escopo: `apps/web/src/features/crm/leads`,
> `apps/web/src/features/crm/clientes`, `apps/web/src/features/crm/servicos`,
> `apps/web/src/features/credenciamentos`, `apps/web/src/features/documentos`,
> `apps/web/src/features/financeiro`, mais `apps/web/src/components`/`packages/ui`.
> Nenhum arquivo foi editado.

## Os 3 defeitos relatados pelo dono no card de lead — diagnóstico exato

**Arquivo:** `apps/web/src/features/crm/leads/LeadCard.tsx`
**Linha-raiz dos três:** 171–175 — a linha de ações do rodapé do card:

```tsx
171   <div
172     className="mt-2 flex items-center gap-1 border-t pt-2"
173     onPointerDown={(e) => e.stopPropagation()}
174     onClick={(e) => e.stopPropagation()}
175   >
```

Essa `<div>` é um **flex sem `flex-wrap`**, com três grupos de filhos dentro dela:
"Converter" (176–184), `AcessoPortalBotao` (187–193, texto variável: "Enviar acesso" /
"Reenviar acesso" / "Painel") e, dentro de um `ml-auto` (194–211), os dois botões-ícone
"Editar" e "Remover" (44×44px cada, alvo de toque). Nenhum desses três grupos tem
`shrink-0` nem `whitespace-nowrap`.

A largura disponível para essa linha é estreita por desenho: no quadro (desktop/tablet)
cada coluna do funil tem `lg:min-w-[12rem]` (192px) — `LeadsPipelinePage.tsx:97` — menos
o padding do card (`p-3` = 24px) sobra ~144–168px; no celular (`ColunaMobile`), o card
divide a largura da tela com o botão "Mover para…" (44px) —
`LeadsPipelinePage.tsx:223-236`. Em qualquer um dos dois casos, "Converter" + "Reenviar
acesso" + dois ícones de 44px não cabem lado a lado nesse espaço.

Como não há `flex-wrap`, o CSS não move o conteúdo excedente para uma segunda linha —
ele **espreme os itens que ainda têm onde encolher** (as caixas de texto, cujo
`flex-shrink` é `1` por padrão e cujo tamanho mínimo, para texto, é a largura da maior
palavra) e **empurra para fora os que não encolhem** (os botões-ícone de 44×44, que têm
tamanho mínimo fixo). Isso produz os três sintomas relatados:

1. **"Os cards dos leads estão bugado" (genérico).** É o efeito visual do rodapé inteiro
   sofrendo essa disputa de espaço ao mesmo tempo: texto de botão quebrando, ícones
   vazando, badges e rótulos ficando desalinhados verticalmente — um card que deveria
   ter altura previsível fica com o rodapé "amassado" e de altura variável conforme o
   texto do estado do Portal (`SEM_ACESSO`/`CONVIDADO`/`ATIVO`) do lead daquela linha.
   Não é um defeito à parte dos itens 2 e 3 — é a soma visível dos dois.
2. **Botão "Enviar acesso" pulando linha.** O texto vem de
   `apps/web/src/features/crm/AcessoPortalBotao.tsx:98-99` (e "Reenviar acesso" na linha
   99), dentro de um `<button className={BOTAO} ...>` cujo `BOTAO` (linha 49-50) é
   `inline-flex items-center gap-1 ...` **sem `whitespace-nowrap`**. Um `<button
   inline-flex>` é, ele mesmo, um contêiner flex — o ícone (`KeyRound`) e o texto são
   filhos flex dele. Como o botão inteiro é espremido pelo rodapé sem `flex-wrap` (ponto
   acima), e o texto tem `white-space: normal` (padrão do Tailwind/browser), o
   navegador prefere **quebrar a palavra em duas linhas dentro do próprio botão** — via
   o ponto de quebra natural do espaço em "Enviar acesso"/"Reenviar acesso" — a deixar o
   botão mais largo que o espaço que sobrou. É por isso que especificamente esse botão
   (o de texto mais longo dos três) é o que "pula linha": ele é o primeiro a atingir o
   limite de quebra por palavra.
3. **Botão de remover saindo do card.** O grupo `ml-auto` (linhas 194-211) reúne
   "Editar" (198-202) e "Remover" (203-210), cada um com `min-h-11 min-w-11` — 44px
   fixos, sem `flex-shrink-0` explícito mas também sem conteúdo para encolher (só um
   ícone SVG de 14px dentro de uma caixa de toque fixa). Como esses dois não têm como
   encolher e o card (`LeadCard.tsx:91-101`) não declara `overflow-hidden`, quando o
   texto dos outros itens já foi espremido ao máximo e ainda assim a soma excede a
   largura do card, o `ml-auto` empurra esse grupo para a direita **além da borda
   direita do card**, ficando visualmente sobreposto/fora dele. É mais visível no
   quadro (desktop/tablet), onde as colunas ficam mais estreitas ainda com várias
   etapas lado a lado.

**Prova de que é omissão, não desenho:** o painel de detalhe do mesmo lead
(`apps/web/src/features/crm/leads/LeadDetailPanel.tsx:493`) resolve a mesma composição
— "Editar", "Enviar acesso", "Converter", "Perdido", "Remover" — com
`className="flex flex-wrap gap-2 border-t p-4"`, **com** `flex-wrap`. O padrão certo já
existe no código, ao lado; só não foi aplicado no card.

**Direção da correção (sem tocar em código agora, por instrução do escopo):**
- Acrescentar `flex-wrap` (e `gap-y-1` ou similar) à `className` de `LeadCard.tsx:172`,
  no molde de `LeadDetailPanel.tsx:493`.
- Acrescentar `whitespace-nowrap` ao `BOTAO` de `AcessoPortalBotao.tsx:49-50` (e, por
  consistência, ao botão "Converter" em `LeadCard.tsx:179`) — para que, com o
  `flex-wrap` do pai, cada botão quebre para a **linha seguinte inteiro**, em vez de
  quebrar o próprio texto ao meio.
- Confirmar que o grupo `ml-auto` de `LeadCard.tsx:194` continua com `shrink-0`
  (adicionar explicitamente, hoje implícito por não ter conteúdo elástico) para that
  ele sempre migre para a 2ª linha do rodapé como bloco, nunca meio-cortado.

---

## Por que a rede de e2e (`responsividade-total.spec.ts`) não pegou os 3 acima

`/leads` **está** na lista de rotas cobertas
(`e2e/responsividade-total.spec.ts:65`, dentro de `ROTAS_INTERNAS`), nos 5 tamanhos. Mas
a checagem que deveria pegar exatamente este tipo de defeito —
`verificarSemElementoEstourando` (linhas 134-192) — tem um ponto cego estrutural para
este caso específico:

- A verificação **exclui** qualquer elemento cujo ancestral tenha o atributo
  `data-rolagem-horizontal` (`dentroDeAlgoQueRola`, linha 146: `!!el.parentElement
  ?.closest("[data-rolagem-horizontal]")`) — desenhada para não reprovar a rolagem
  horizontal *intencional* de um quadro Kanban inteiro.
- Em `LeadsPipelinePage.tsx:680`, a `<div>` que envolve **todas as colunas do funil**
  (desktop/tablet, ≥768px) carrega exatamente essa marca:
  `<div data-rolagem-horizontal className="flex ... lg:overflow-x-auto ...">`.
- Como `LeadCard` — e, portanto, o rodapé com o bug — está aninhado **dentro** dessa
  `<div>`, **qualquer estouro dentro de um card individual fica isento do teste**, não
  só o estouro do quadro como um todo. A marca foi pensada para "este contêiner rola de
  propósito", mas na prática também apaga a checagem de "este botão vazou do card que
  está dentro dele". Isso explica por que o bug 3 (remover saindo do card) nunca
  reprovou a CI, mesmo com `/leads` coberta a 1366px e 1920px.
- Em celular (360/390), quem renderiza é `ColunaMobile` (`LeadsPipelinePage.tsx:187-243`
  ), que **não** tem essa marca — então a checagem deveria pegar. Mas, como descrito no
  diagnóstico do bug 2, o efeito real ali não é o botão ultrapassar a JANELA
  (`rect.right > largura + 20px`, o que a checagem mede): é o **texto quebrar em duas
  linhas dentro do próprio botão**, aumentando a altura do card, não a largura. A
  checagem de estouro só olha largura; um card mais alto do que deveria passa
  despercebido por ela.

**Recomendação para a rede:** ou restringir a isenção de `data-rolagem-horizontal` para
não se propagar a descendentes de outra unidade de repetição (por exemplo, também
exigir que o próprio elemento avaliado — não um ancestral genérico — esteja
imediatamente dentro do contêiner marcado, não dentro de um card que por sua vez está
dentro dele), ou acrescentar uma checagem própria por card (`[data-linha]`/seletor do
`LeadCard`) que compare a borda direita dos filhos do rodapé com a borda direita do
PRÓPRIO card, não da janela.

---

## Outros achados no grupo, por gravidade

### 2. `PropostaServicosPicker.tsx:192` — linha do percentual sem `flex-wrap`, ao lado de uma que tem

**Arquivo:** `apps/web/src/features/documentos/PropostaServicosPicker.tsx`
**Linha:** 192 — `<div className="flex items-center gap-2 text-xs text-muted-foreground">`
contendo o rótulo "% do faturamento:", um input numérico com sufixo "%" (194-211,
`w-20` fixo), o texto "/mês" e, condicionalmente, um `ml-auto` com o valor calculado
(213-217).

A linha irmã logo acima, para o valor fixo (linha 152), tem exatamente a mesma forma —
rótulo + campos + `ml-auto` com o total — e **tem** `flex-wrap`
(`"flex flex-wrap items-center gap-2"`). A linha do percentual não tem. Esse trecho vive
dentro do construtor de proposta (`NovoDocumentoDialog`), num modal que pode ficar
estreito a 360/390px, com um recuo (`pl-6`, linha 150) reduzindo ainda mais o espaço —
soma estimada de conteúdo (~300px) facilmente maior que a largura útil do modal nesses
tamanhos. Mesmo padrão de risco do LeadCard (itens sem onde encolher + `ml-auto`), numa
escala menor porque o modal é mais largo que uma coluna de Kanban.

**Direção:** acrescentar `flex-wrap` à `className` da linha 192, igualando à 152.

### 3. `ClientesListPage.tsx:451-463` — `<Select>` com `w-auto` no filtro de responsável

**Arquivo:** `apps/web/src/features/crm/clientes/ClientesListPage.tsx`, linha 454:
`className="h-9 w-auto"`.

É o mesmo padrão que a ADR-130 já documentou e corrigiu uma vez em `/emails-enviados`:
um `<select>` nativo sem largura explícita se dimensiona pela **opção mais longa da
lista**, não pelo valor selecionado nem pelo espaço disponível — historicamente medido
em +84px de excesso. Aqui a lista é "Todos os responsáveis" + nomes da equipe; o filtro
de responsável equivalente do Funil de Vendas (`LeadsPipelinePage.tsx:638`) já usa
`className="w-56"` (largura fixa) para o mesmo tipo de campo. A barra em
`ClientesListPage.tsx:412` tem `flex-wrap`, então o risco aqui é o `<Select>` empurrar
os elementos vizinhos e criar uma quebra de linha inesperada no meio da barra de busca,
não um estouro de janela — gravidade baixa a média.

**Direção:** trocar `w-auto` por uma largura fixa (ex.: `w-56`, igual ao
`LeadsPipelinePage.tsx:638`), para consistência com o padrão já usado no funil.

### 4. `PautaPostagemFields.tsx:56` e `:61` — mesmo padrão `w-auto` em `<Select>`

**Arquivo:** `apps/web/src/features/documentos/PautaPostagemFields.tsx`.
`<Select ... className="h-8 w-auto" ...>` para "Rede" (linha 56) e "Formato" (linha 61).
Mesma causa-raiz do achado 3, gravidade menor porque as opções (nomes de rede social,
formato de post) tendem a ser curtas — o excesso de largura é pequeno. Registrado por
consistência de padrão, não por impacto visual medido.

**Direção:** mesma do achado 3, se o refino tratar os dois casos juntos.

### 5. `<select>` nativo fora do componente `Select` compartilhado (inconsistência visual, gravidade baixa)

Dois lugares no grupo usam `<select>` cru em vez do componente `Select` de
`apps/web/src/components/ui/select.tsx` (que traz o ícone de seta e o estilo padrão da
aplicação):
- `apps/web/src/features/crm/servicos/ServicosPage.tsx:836-846` (etapa do passo do
  serviço).
- `apps/web/src/features/documentos/PropostaServicosPicker.tsx:169-181`
  (avulso/mensal do item da proposta).

Nenhum dos dois vaza ou quebra layout no lugar onde está (ambos dentro de linhas com
`flex-wrap`), mas rendem visualmente diferentes do resto da aplicação (sem a seta do
componente padrão). Não é defeito de responsividade — é inconsistência visual, então
registro só para conhecimento; **fora da prioridade desta auditoria**.

---

## Fora do escopo desta correção (regra de negócio, não layout)

Nada encontrado nesta rodada que pareça defeito de regra de negócio ainda não
documentado — o grupo já carrega histórico extenso de correções desse tipo (ADR-125 a
ADR-152, ver `docs/CLAUDE.md`). A única observação adjacente: o texto de
`ServicosContratadosCard.tsx:52-55` (`bloqueadoPeloOrfao`) e o aviso âmbar de
"percentual órfão" são comportamento intencional e testado (ver comentário no próprio
arquivo, linhas 40-55) — não é um achado novo, só confirmando que não é layout quebrado.

---

## Resumo

- **3 achados de gravidade média/baixa** além dos 3 do card de lead (achados 2-4 acima:
  `PropostaServicosPicker.tsx:192`, `ClientesListPage.tsx:454`,
  `PautaPostagemFields.tsx:56/61`) + **1 nota de inconsistência visual sem impacto de
  layout** (achado 5).
- **Nenhum achado de regra de negócio** fora de layout neste grupo.
- Diagnóstico exato dos 3 bugs do card de lead: os três nascem da **mesma linha**,
  `LeadCard.tsx:171-175` (`mt-2 flex items-center gap-1 border-t pt-2`), que é um flex
  **sem `flex-wrap`** — diferente do `LeadDetailPanel.tsx:493`, que resolve a mesma
  composição de botões com `flex flex-wrap gap-2` e não tem o problema. Sem
  `flex-wrap`, o navegador (1) espreme o texto dos botões de largura variável até
  quebrar a palavra ao meio (o "Enviar acesso pulando linha") e (2) empurra o grupo
  `ml-auto` de Editar/Remover para fora da borda do card, que não tem
  `overflow-hidden` (o "botão de remover saindo do card"); a queixa genérica "cards
  bugados" é a soma visível dos dois. A rede de e2e não pega isto porque a checagem de
  estouro isenta tudo que está dentro de um ancestral `[data-rolagem-horizontal]` — e
  o quadro do funil marca a fileira inteira de colunas com esse atributo, isentando
  também o que acontece dentro de cada card individual; no celular, o mesmo bug se
  manifesta como aumento de ALTURA do card (quebra de texto), que a checagem de
  estouro (que só mede largura contra a janela) não enxerga.
