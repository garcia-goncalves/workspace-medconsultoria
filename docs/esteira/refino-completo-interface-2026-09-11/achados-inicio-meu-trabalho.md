# Achados de layout/responsividade — Início e Meu trabalho (Tarefas, Agenda, Projetos)

Auditoria só de leitura, 11/09/2026. Escopo: `apps/web/src/features/{dashboard,tarefas,agenda,projetos}/`
+ componentes de UI compartilhados usados por eles (`apps/web/src/components/ui/`).

Panorama geral: as quatro páginas já carregam bastante disciplina das rodadas anteriores
(ADR-129/130/136/143) — `min-w-0` nos filhos de flex/grid, `truncate` nos textos de card, alvos de
toque com `h-11 w-11` no celular e `md:h-Ø` no desktop, `grid-cols-[minmax(0,1fr)]` nas grades que
antes vazavam. A maior parte dos achados abaixo é pontual, não sistêmica.

---

## 1. [MÉDIA] `<select>` com `w-auto` reintroduz o bug já documentado do projeto (ADR "emails-enviados")

**Arquivos/linhas:**
- `apps/web/src/features/agenda/AgendaPage.tsx:438` — filtro "Filtrar por tipo" (`className="h-9 w-auto"`)
- `apps/web/src/features/agenda/AgendaPage.tsx:447` — filtro "Filtrar por responsável" (`className="h-9 w-auto"`)
- `apps/web/src/features/agenda/AgendaPage.tsx:982` — seletor de Mês na visão Lista (`className="h-9 w-auto"`)
- `apps/web/src/features/agenda/AgendaPage.tsx:987` — seletor de Ano na visão Lista (`className="h-9 w-auto"`)
- `apps/web/src/features/projetos/ProjetosListPage.tsx:251` — filtro "Filtrar por responsável"
  (`className="w-auto min-w-[160px]"` — tem piso, mas nenhum teto)

**O que está errado:** `components/ui/select.tsx` define a base como `w-full` (linha 14); a
`className` passada por essas páginas sobrescreve para `w-auto` via `cn`/tailwind-merge (linha 13).
Isso é exatamente o padrão que já causou bug real neste projeto — documentado em CLAUDE.md/ADR-129:
*"o `<select>` de `/emails-enviados` — `w-auto` num `<select>` é a largura da opção mais longa,
+84px"*. Um `<select>` nativo sem largura fixa tende a dimensionar pelo conteúdo (a opção
selecionada, e em alguns motores/momentos a mais longa das opções) — a 360px isso pode estourar a
tela, especialmente nos filtros de Agenda onde as opções incluem "Todos os responsáveis" e nomes de
pessoas da equipe (arbitrariamente longos).

**Por que a régua atual (`e2e/responsividade-total.spec.ts`) não pega isso:** o teste só faz
`page.goto(url)` e mede o layout no estado inicial — nunca interage com o `<select>` trocando a
opção selecionada. O `<select>` "Filtrar por tipo" nasce com o valor padrão curto ("Todos os
tipos"); o estouro só aparece depois que a Thaís escolhe uma opção mais longa (ou quando a lista de
responsáveis/equipe tiver um nome comprido). Isso é folga real na régua para este padrão específico
— não falta rota, falta interação com o próprio elemento.

**Direção da correção:** tirar o `w-auto` (deixar o `w-full` da base, envolvendo o `<select>` num
contêiner com `max-w-[...]` quando for preciso encolher, como já é feito noutros lugares do
projeto) ou trocar por `Combobox` (que já convive bem com texto longo via `truncate`, como visto em
`ParticipantesDialog`/`TarefaFormDialog`). Se for para manter `<select>` nativo por ser filtro
simples, fixar uma largura com `max-w` explícito em vez de `w-auto`.

---

## 2. [BAIXA] Título do cartão do Kanban sem `truncate`/`min-w-0` no cabeçalho do card

**Arquivo/linha:** `apps/web/src/features/projetos/KanbanCard.tsx:87-98`

```tsx
<div className="flex items-start justify-between gap-1.5">
  <div className="text-sm font-medium">{card.titulo}</div>
  {card.responsavel && (...)}
</div>
```

**O que está errado:** o `div` do título não tem `min-w-0` nem `flex-1`/`truncate`. Num flex row
sem `min-w-0`, o filho de texto herda `min-width:auto` (= largura mínima do conteúdo). Para texto
normal com espaços isso só força quebra de linha (não é catastrófico), mas um título sem espaço
(ex.: um link colado, um código, um nome de arquivo) empurra a largura do item além do card de
`w-72` (288px) fixo em `ProjetoDetailPage.tsx:79`, estourando a coluna. O padrão do resto do
projeto (inclusive linhas vizinhas deste mesmo arquivo, como o `Badge`/avatar) sempre marca o
container de texto com `min-w-0`/`truncate` quando compartilha linha com outro elemento shrink-0.

**Direção da correção:** envolver o título em `<div className="min-w-0 flex-1">` e considerar
`line-clamp-2` (título de cartão pode ter 2 linhas sem problema) para não deixar um título muito
longo dominar o card verticalmente.

---

## 3. [BAIXA] `AgendaPage` — grade `TimeGrid` no modo "Dia" não passa por `lg:hidden`/breakpoint, mas o `EventoChip`/bloco do evento tem largura calculada por porcentagem sem piso mínimo

**Arquivo/linha:** `apps/web/src/features/agenda/AgendaPage.tsx:719-767` (cálculo de `w`/`left` dos
blocos de evento dentro da grade de horário)

**O que está errado:** quando há 3+ eventos sobrepostos no mesmo horário (`col.lanes` alto), a
largura de cada bloco (`width: calc(${w}% - 4px)`) pode ficar bem estreita (ex. 4 eventos = ~22%
de uma coluna que já é 1/7 da largura da grade). No celular a grade "Dia" continua sendo a
`TimeGrid` (só "Semana" tem a variante em lista abaixo de `lg`, ver linha 491-497) — ou seja, no
modo Dia a 360px um usuário com 3 reuniões sobrepostas veria blocos de poucos pixels de largura,
com texto cortado mesmo com `truncate`. Não é overflow de tela (fica contido), mas é uma
degradação de usabilidade que a régua atual não mede (ela só verifica overflow/estouro/alvo de
toque, não legibilidade de texto dentro de blocos estreitos). Achado de baixa prioridade, mais
observação para o plano do que bug confirmado — vale conferir na tela com carga real de eventos.

**Direção da correção:** nenhuma ação obrigatória agora; se o plano quiser tratar, uma opção é
empilhar os eventos sobrepostos numa lista compacta abaixo de um certo número de "lanes" no modo
Dia a `< sm`, em vez de dividir a largura em colunas cada vez mais finas.

---

## 4. [INFORMATIVO] Cobertura de alvo de toque (44px) não é verificada nas rotas internas, só no Portal

**Arquivo:** `e2e/responsividade-total.spec.ts:218-241` (`verificarAlvosDeToque`) e
`e2e/responsividade-total.spec.ts:311+` (só chamada na bateria de rotas do Portal, não na de
`ROTAS_INTERNAS`)

**O que está errado (folga na régua, não bug de código):** `/`, `/tarefas`, `/agenda`, `/projetos`
e `/projetos/$id` estão cobertas para overflow horizontal, elemento estourando e zero erro de
console — mas a checagem de alvo de toque mínimo (44×44px), que é regra explícita do projeto, só
roda nas rotas do Portal (`ROTAS_PORTAL`). Nas páginas auditadas aqui, o código já demonstra
disciplina de `h-11 w-11` manualmente em vários botões de ação (ex.: `TarefasPage.tsx:118`,
`AgendaPage.tsx:1085/1092`, `ProjetosListPage.tsx:389/399`), então não há indício de violação hoje
— mas nada impede uma regressão futura nessas páginas de passar despercebida pela CI, porque a
checagem nem roda ali.

**Direção da correção (fora do escopo desta auditoria, mas vale registrar no plano):** estender
`verificarAlvosDeToque` (e talvez `verificarTextoNaoCortado`, onde aplicável) também para
`ROTAS_INTERNAS`, ao menos nos tamanhos 360/390.

---

## Resumo

- **4 achados** ao todo: 1 médio, 2 baixos, 1 informativo (folga de régua, não bug de código).
- **Mais grave:** os `<select>` nativos com `w-auto` em `AgendaPage.tsx` (4 ocorrências) e
  `ProjetosListPage.tsx` (1 ocorrência) reproduzem um padrão de bug já catalogado e corrigido antes
  neste mesmo projeto (`/emails-enviados`) — e a régua de e2e atual não pega porque nunca troca a
  opção selecionada do `<select>`, só carrega a página no estado padrão.
- **Segundo mais notável:** o título do `KanbanCard` não tem `min-w-0`/`truncate` no contêiner de
  texto, indo contra o padrão consistente do resto do código — risco baixo (título costuma ter
  espaços), mas inconsistente com a disciplina que o projeto adotou em todo outro lugar.
- **Terceiro:** a checagem de alvo de toque (44px) da suíte e2e cobre só as rotas do Portal, não as
  internas — não é um defeito encontrado hoje, é uma lacuna de cobertura a considerar no plano.
