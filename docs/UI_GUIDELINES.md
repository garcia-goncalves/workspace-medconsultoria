# UI_GUIDELINES.md — Design System Workspace MedConsultoria

Design system da aplicação. Alinhado à identidade da MedConsultoria. Implementação em `packages/ui` (tokens + componentes shadcn temáticos).

**Sensação alvo:** confiança · organização · profissionalismo · tecnologia · simplicidade.
**Inspiração** (sem copiar): Linear, Notion, Slack, ClickUp, Perfex CRM, Stripe Dashboard.
**Regra máxima:** interface limpa e espaçada. Nada de telas poluídas. Cada elemento na tela justifica sua presença.

---

## 1. Cores

### Paleta de marca

| Token | Hex | Uso |
|-------|-----|-----|
| `--brand-green` | `#30AD73` | Ações positivas, sucesso, destaques, gráficos |
| `--brand-blue-light` | `#2DA8E1` | Acentos, links, estados informativos, seleção |
| `--brand-blue-dark` | `#002463` | Sidebar, cabeçalhos, superfícies escuras, texto forte |
| `--brand-blue-text` | `#003591` | Cor primária de texto/títulos e links |

### Escala neutra (cinza)

Base para fundos, bordas e texto secundário. Definir de `--gray-50` a `--gray-900`. Fundo do app `--gray-50`; superfícies (cards) branco; bordas `--gray-200`.

### Semânticos

`--success` = green · `--info` = blue-light · `--warning` = âmbar (`#F59E0B`) · `--danger` = vermelho (`#E5484D`). Cada um com variante de fundo suave (tint) para badges/alerts.

### ⚠️ Acessibilidade de contraste (obrigatório)

- **Texto:** usar `--brand-blue-text` (#003591) ou `--brand-blue-dark` sobre branco — ambos passam AA/AAA.
- **`--brand-green` (#30AD73) e `--brand-blue-light` (#2DA8E1) NÃO têm contraste suficiente para texto pequeno sobre branco.** Usá-los apenas em: preenchimentos, ícones grandes, barras, botões com **texto branco** por cima (aí sim passam), badges com tint.
- Todo par texto/fundo deve atingir **WCAG AA (4.5:1** texto normal, **3:1** texto grande). Validar no design.
- Foco visível sempre (`--brand-blue-light` ring). Nunca remover outline sem substituto.

### Modo

Começar com **tema claro** (prioridade). Tokens já preparados para dark mode via CSS variables, mas dark é fase futura — não bloquear o MVP.

---

## 1.5. Logo & assets da marca

Fontes em `brand/` (logos, manual da marca, apresentação). Assets aplicados no app em `apps/web/public/`:

- `logo.png` — logotipo completo (espiral + "med consultoria"), **usado no login** (fundo claro).
- `simbolo.png` — só a espiral (verde/azul), **usado na sidebar** (fundo azul escuro) + fonte dos favicons.
- `favicon-16/32/180/192/512.png` — favicons/apple-touch (gerados do símbolo).

Gerados via PIL a partir de `brand/logos/medconsultoria-logo.png` (removendo o wordmark navy por cor para isolar o símbolo). O logo confirma a paleta: verde ≈ #30AD73, azul claro ≈ #2DA8E1, azul texto/escuro #003591/#002463.

---

## 2. Tipografia

- **Família:** Montserrat (self-hosted via `@fontsource/montserrat` — não depender de CDN em produção). Fallback: `system-ui, sans-serif`.
- **Pesos:** 400 (regular), 500 (medium), 600 (semibold), 700 (bold). Títulos em 600/700; corpo em 400/500.
- **Escala** (base 16px / 1rem):

| Token | Tamanho | Uso |
|-------|---------|-----|
| `text-xs` | 12px | metadados, labels |
| `text-sm` | 14px | corpo secundário, tabelas |
| `text-base` | 16px | corpo padrão |
| `text-lg` | 18px | subtítulos |
| `text-xl` | 20px | títulos de seção |
| `text-2xl` | 24px | título de página |
| `text-3xl` | 30px | dashboards/hero interno |

- **Altura de linha:** 1.5 para corpo, 1.2–1.3 para títulos.
- **Legibilidade:** largura máxima de blocos de texto ~72ch.

---

## 3. Espaçamento & layout

- **Escala (base 4px):** 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Usar tokens do Tailwind (`p-2` = 8px, etc.). **Consistência > precisão pixel.**
- **Densidade:** confortável, não apertada. Respiro generoso — inspiração Linear/Stripe.
- **Grid do app:** sidebar fixa à esquerda (colapsável) + header + área de conteúdo com `max-width` e padding generoso.
- **Cards:** raio `--radius` = 10px; sombra sutil (`--shadow-sm`); borda `--gray-200`. Evitar sombras pesadas.
- **Container de conteúdo:** corpo das páginas alargado, até **~1600px** (não mais o `max-w-7xl`/1280px original); listas/tabelas podem usar largura total com `overflow-x-auto`.
- **Largura das páginas — padrão ÚNICO (ADR-48):** o `AppLayout` já centraliza **todo** o conteúdo no container global `max-w-[1600px]` (`AppLayout.tsx`). **Nenhuma página impõe largura própria no seu contêiner raiz** — todas preenchem esse container (a raiz da página é só `space-y-6`/`flex h-full flex-col`, sem `mx-auto max-w-*`). Isso mantém listas, fichas e detalhes com a **mesma largura**. Larguras `max-w-*` **internas** (coluna de leitura de texto ~72ch, bolhas de chat, células de tabela, a folha do documento) são intencionais e permanecem. Ao criar uma página nova, **não** embrulhe a raiz num `max-w-*`.

---

## 4. Componentes (shadcn/ui temático)

Base = shadcn/ui, re-temado com os tokens acima em `packages/ui`. Componentes-chave do MVP:

- **Navegação:** Sidebar (com ícones + labels, navegação **agrupada por pergunta** — Início solto no topo, depois Comunicação/Meu trabalho/Negócio/Configuração, ADR-94; + **menu do usuário no rodapé** com Configurações e Sair), Header (**breadcrumbs**, busca global proeminente, notificações), Breadcrumbs. **O menu é derivado de `lib/paginas.ts`** (campo `grupo`), que também alimenta a busca do Ctrl+K — nunca crie uma segunda lista de navegação à mão.
- **Breadcrumbs (`components/layout/Breadcrumbs.tsx`, ADR-48):** o **caminho** de toda página, no **cabeçalho** do shell (ocupa o lugar do antigo título). `<nav aria-label="Breadcrumb"><ol>…</ol></nav>`, ícone **Início** (Home → `/`), separador chevron `aria-hidden`, item atual com `aria-current="page"` **sem** link; rótulos longos com `truncate`; `hidden md:flex` (mobile enxuto). A **trilha é derivada da rota** (`trailFor`) reaproveitando os grupos do menu — páginas de **Ajustes** ganham o pai *Ajustes* (ex.: `Início / Ajustes / Documentos`). As **fichas** publicam o nome do registro pelo contexto **`useDynamicCrumb(nome)`** (cliente/projeto/documento) → `Início / Clientes / Acme Saúde`. Use `activeOptions={{ exact: true }}` nos `<Link>` internos para o TanStack **não** duplicar o `aria-current` no pai. O `<title>` da aba do navegador acompanha a página.
- **Command Palette (Ctrl+K):** navegação e ações rápidas desde o shell — teclado-first, com **duas abas visíveis**: **Buscar** (dados **reais** via `busca.global` — clientes, leads, projetos, documentos, agrupados por tipo, + navegação por página) e **Assistente IA** (quando a IA está disponível) — um **chat** com balões, sugestões de perguntas e input próprio; a aba deixa a IA óbvia em vez de escondida atrás de digitar. Prioridade alta (é o que dá a sensação Linear/Notion).
- **Notificações (sino no header):** central de alertas **clicáveis** — cada item leva à entidade relacionada (projeto, documento, financeiro, agenda) e é marcado como lido no clique (não marca tudo ao abrir, para não "sumir" com o que ainda precisa de atenção); ícone e tom por tipo, ponto de não-lida, "Marcar todas". Alimentada por push real-time (Socket.IO) e por um **scan proativo** no servidor (tarefa atrasada, conta vencida, documento aguardando revisão) — ver ADR-12.
- **Dados:** DataTable (ordenação, filtro, paginação), Card, Badge/Tag, Avatar, EmptyState (importante — toda lista vazia tem estado bonito e orientador).
- **Kanban:** Board + Column + Card arrastável (dnd-kit).
- **Formulários:** Input, Select, Combobox, DatePicker, Textarea, Switch, Checkbox, RadioGroup — todos com validação Zod + mensagens claras em PT-BR.
- **Feedback:** Toast (sucesso/erro), Dialog/Modal, Sheet (painéis laterais), AlertDialog (confirmação de ações destrutivas), Skeleton (loading), Spinner.
- **Overlays:** Tooltip, Popover, DropdownMenu, ContextMenu.

Regra: **um componente por necessidade**. Não criar variações especulativas.

### Kit de primitivos padronizados (`apps/web/src/components/ui/`)

Use SEMPRE estes em vez de repetir classes inline — garante consistência de tamanho/cor/espaçamento:

- **`Button`** — `variant`: `default` (primário, com sombra) · `secondary` · `ghost` · `outline` · `destructive`; `size`: `default` · `sm` · `lg` · `icon`. Micro-press no `active` (`translate-y-px`).
- **`Input`, `Label`, `Textarea`, `Select`** — controles de formulário. Campos têm `shadow-sm`, hover de borda e foco suave (`border-primary` + `ring-primary/20`). O `Select` traz **chevron próprio** (é `appearance-none` com ícone; ele embrulha o `<select>` num `div relative` — o `ref`/`{...register}` continuam indo no `<select>`).
- **`Combobox`** (`apps/web/src/components/ui/combobox.tsx`) — autocomplete com typeahead e navegação por teclado. Padrão para selecionar uma entidade em formulários — **cliente** (projeto, conta, evento, documento, resumir reunião, acesso de Portal) e **responsável** (cartão do kanban, via `usuarios.equipe`). Prefira-o a `Select` sempre que a lista de opções tende a crescer.
- **`Card` / `CardHeader` / `CardTitle` / `CardContent`** — superfícies. `Card` = `rounded-xl border bg-card shadow-sm`.
- **`Badge`** — `variant`: `default` (cinza) · `primary` (azul) · `success` (verde) · `warning` (âmbar) · `danger` (vermelho). Cada um com `ring-inset` para definição.
- **`PageHeader`** — `title` + `subtitle` + ações (children à direita). Responsivo (empilha no mobile). Cabeçalho de toda página.
- **`Table` / `THead` / `TH` / `TR` / `TD`** — tabela padrão (já embrulhada em card com `rounded-xl`, borda, sombra e `overflow-x-auto`; header em `uppercase tracking-wider`; hover e transição na linha). O `<tbody>` e a linha do header são nativos.
- **`EmptyState`** — `icon` (em círculo com tint da marca) + `title` + `description` + CTA. Todo estado vazio.
- **`Modal`** — diálogo (Esc/click-fora fecham). Backdrop com blur, header com borda, corpo rolável (`max-h-[90vh]`), animação de entrada.
- **`Skeleton` / `TableSkeleton`** — placeholders de carregamento. **Prefira-os a spinners** em telas com layout (listas, tabelas, cards). Spinner (`Loader2`) fica só para botões/ações inline.

Convenções: título de página `text-2xl font-semibold tracking-tight text-primary`; subtítulo `mt-1 text-sm text-muted-foreground`; grid de cards `gap-3`; seções `space-y-6`.

### Fundação elevada (tokens + shell)

- **Sombras em camadas** via CSS vars (`--shadow-sm/-/-md/-lg`), tom azulado da marca — expostas no Tailwind como `shadow-sm|shadow|shadow-md|shadow-lg`. Nada de sombra pesada.
- **Animações** registradas no preset: `animate-fade-in`, `animate-scale-in`, `animate-slide-down`, `animate-slide-in-right` (usadas em modais, dropdowns, cmdk e drawer). Skeletons usam `animate-pulse`.
- **Foco:** botões usam `ring-ring` com offset; campos usam `border-primary` + `ring-primary/20` (mais suave). Nunca remover foco visível.
- **Scrollbars** discretas no tom do tema (`::-webkit-scrollbar` + `scrollbar-*`).
- **Shell:** sidebar mais larga, com navegação **agrupada por seção** (Principal/Comercial/Operação/Gestão), rótulo de seção e indicador do item ativo (barra azul-claro à esquerda + pílula), e **menu do usuário no rodapé** (avatar em gradiente `from-brand-blueLight to-primary` + Configurações + Sair); **drawer de navegação no mobile** (hambúrguer no topo, `< md`); header com título da página, busca global e notificações; conteúdo alargado até **~1600px**.
- **Dark mode:** os tokens já têm bloco `.dark` pronto em `index.css` — falta apenas um toggle (fase futura). Não wire agora.

---

## 5. Ícones

- **Biblioteca:** lucide-react (combina com shadcn, traço limpo, consistente). Uma biblioteca só.
- Tamanho padrão 16–20px em UI; 24px+ em destaques. Cor herda do texto ou usa acento.

---

## 6. Animações & movimento

- **Sutil e rápido.** Transições 150–200ms, easing suave (`ease-out`). Nada de bounce exagerado.
- Usos: hover/focus states, entrada de modais/sheets, reordenação de kanban, toasts. Respeitar `prefers-reduced-motion`.
- Skeletons em vez de spinners para carregamento de listas/páginas quando possível.

---

## 7. Padrões de UX (a filosofia do sistema)

- **Poucos cliques.** O caminho para a ação mais comum de cada tela deve ser óbvio e curto.
- **Estados vazios orientadores:** toda lista vazia diz o que é e oferece a ação para começar ("Nenhum cliente ainda — Adicionar cliente").
- **Confirmação só para o destrutivo.** Ação reversível não pede confirmação; ação destrutiva usa AlertDialog.
- **Feedback imediato:** toda mutação dá retorno (toast/optimistic update). Erros em linguagem humana, em PT-BR, dizendo o que fazer.
- **Busca global (Cmd-K)** encontra cliente/projeto/tarefa rapidamente.
- **Consistência:** mesma ação → mesmo lugar → mesmo rótulo em todo o app.
- **Mobile:** o MVP é desktop-first (uso operacional interno), mas layout responsivo básico não deve quebrar. App mobile dedicado não está no escopo agora.

---

## 8. Conteúdo & tom

- Idioma: **PT-BR** em toda a interface.
- Rótulos curtos e diretos. Voz ativa. Sem jargão técnico para ADMIN/FUNCIONÁRIO.
- Datas em formato brasileiro (`dd/mm/aaaa`), fuso `America/Sao_Paulo`. Dinheiro em `R$ 0,00`.

---

## 9. Implementação (tokens)

Tokens como CSS variables no `:root` (em `packages/ui`), mapeados no `tailwind.config` como cores nomeadas (`brand.green`, `brand.blueDark`, etc.). Componentes consomem os tokens — **nunca** hex hardcoded em componente. Trocar um token reflete no app inteiro.

---

## 10. Documentos — folha A4 + interação por tipo (ADR-47/48)

- **Moldura branded (`DocumentoBranded`):** o corpo (Markdown) é renderizado numa folha na **proporção A4** (`aspect-[210/297]`) numa **escala de tela confortável** (`max-w-[640px]`, **não** o A4 real de 794px — que ocuparia a tela toda e ficava "gigante"). A folha aparece **inteira por padrão** (mesmo com pouco conteúdo, com espaço em branco embaixo como papel de verdade) e **cresce** quando há mais conteúdo; centralizada num *canvas* cinza (visualizador tipo Google Docs), com margens internas e **sombra de página**. **Impressão/PDF = A4 real:** a **mesma moldura** é reimpressa por `imprimirDocumento` com **`@page A4`** (independente da largura de tela) → o PDF sai em A4 verdadeiro, WYSIWYG, sem engine de PDF no servidor.
- **Sem scroll dentro do documento:** a leitura **não** usa `max-h/overflow` próprio — quem rola é a **página** (o `<main>` do shell).
- **Editar (`DocumentoEditor`):** editor de duas colunas — **barra de formatação** (negrito/itálico/título/listas/citação/link/tabela/divisória, que agem sobre a seleção; atalhos Ctrl+B/Ctrl+I) + textarea Markdown à esquerda; **preview A4 ao vivo** à direita (sem scroll próprio — a página rola). A barra de ações (Cancelar/Salvar) e o editor são **`sticky`** — ficam visíveis enquanto se rola o preview. Não é preciso conhecer Markdown (a barra escreve por você); rodapé com contador de palavras.
- **Interação por tipo (`DOC_INTERACAO` em `packages/shared/src/schemas/documento.ts`):** cada tipo tem UM modo — a ficha do documento renderiza o card certo (ou nenhum):
  - **`assinatura`** (assinatura eletrônica, Lei 14.063/2020): **só o Contrato** → `AssinaturasCard`.
  - **`aceite`** (aceite/recusa online, 1 clique + trilha): **Proposta** → `PropostaAceiteCard`.
  - **`nenhum`** (só leitura/entrega, ou **preenchido online** no Portal como o **Briefing**): **Escopo de trabalho** (anexo da proposta/contrato), relatórios, ata, pautas, diagnóstico, plano de ação, onboarding, checklist, recibo, briefing. Documento sem modelo = `nenhum`.
  - Regra: **assinar só o contrato**; a proposta se **aceita** (não tem "Solicitar assinatura"); o briefing o cliente **preenche** (formulário no Portal); o escopo é anexo (o vínculo vem pela proposta aceita + contrato assinado).
