# Design — O Portal do cliente vira aplicativo, em 5 seções

- **slug:** portal-app-5-secoes-2026-08-28 · **fase:** 3 (Design) · **data:** 2026-08-28
- **Escopo desta fase:** navegação e apresentação. Nenhuma regra de negócio muda.
- **Lido antes de desenhar:** `briefing.md` · `docs/UI_GUIDELINES.md` ·
  `apps/web/src/index.css` (tokens) · `apps/web/tailwind.config.js` ·
  `apps/web/index.html` (meta viewport) · `PortalLayout.tsx` · `PortalHome.tsx` ·
  `FaixaDeSuporte.tsx` · `PortalCredenciamento.tsx` · `PortalServicos.tsx` ·
  `PortalSuporte.tsx` · `components/layout/AppLayout.tsx:398-432` (o drawer mobile) ·
  `components/ui/badge.tsx` · `packages/ui/src/index.ts`.

---

## direcao_visual_escolhida

O dono pediu "menu tipo o app da Binance". Isso fixa **onde** (barra inferior, fixa) mas
não fixa **como**. Três direções legítimas foram desenhadas; a comparação abaixo é para
quem não é designer ler e decidir.

### 🏆 ESCOLHIDA — Direção A: barra sólida, **ícone + rótulo sempre visíveis**

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│                   conteúdo da seção                      │
│                                                          │
├──────────────────────────────────────────────────────────┤ ← borda de 1px
│  ▔▔▔▔▔                                                   │ ← barra de 3px no ativo
│    🏠      📄③      🩺       📦       💬                  │
│  Início  Documentos Convênios Serviços Suporte           │
└──────────────────────────────────────────────────────────┘ ← área segura do iPhone
```

- Item ativo: ícone e rótulo em `--primary`, com uma barra de 3px no **topo** do item.
- Itens inativos: `--muted-foreground`, sem preenchimento nenhum.
- Fundo `--card` sólido (não translúcido), borda superior `--border`, e uma sombra
  projetada para cima, para a barra descolar do conteúdo que passa por baixo.

**Por que ela vence.** Quem usa entra **poucas vezes por mês, com pressa e sem
treinamento** (briefing, `usuario_alvo`). Rótulo visível é *reconhecimento*; ícone sozinho
é *memória* — e memória é exatamente o que essa pessoa não tem do nosso app. É também a
direção que mais se parece com o que o dono pediu: a Binance mostra ícone **e** texto nos
cinco itens. E é a única em que o contador de pendência ("③") aparece grudado a um ícone
que tem nome embaixo — num item sem rótulo, uma bolinha só levanta a pergunta "três o quê?".

**O preço que ela cobra, e que aceitamos:** o rótulo precisa caber em ~68px a 360px de
largura (ver `textos`). É o que obriga a decisão de nome da 3ª seção — a única pendência
do dono neste documento.

### ❌ RECUSADA — Direção B: só ícone, rótulo **apenas no item ativo**

Padrão do Material 3: os inativos são ícones nus; o ativo ganha uma pílula com o nome.

- **Recusada porque** resolve um problema que não temos (falta de espaço) criando um que
  temos de verdade (usuário sem treinamento). Quem entra uma vez por mês teria de
  **adivinhar 4 dos 5 destinos** em toda visita.
- **Recusada também porque o contador fica órfão:** `③` sobre um ícone anônimo não diz em
  que seção estão as três pendências — e o contador é critério de aceitação.
- Único ganho real: nomes longos deixariam de ser problema. Ganho pequeno perto do custo.

### ❌ RECUSADA — Direção C: pílula flutuante sobre o conteúdo

Barra arredondada, com margem lateral e sombra, flutuando ~12px acima da borda inferior.

- **Recusada porque flutuar significa tapar conteúdo:** o último item de qualquer lista
  passa por baixo dela, e a faixa entre a pílula e a borda da tela vira uma zona de toque
  acidental, colada à barra de gestos do iPhone.
- **Recusada porque muda de largura:** quando a clínica não tem credenciamento a pílula
  encolhe de 5 para 4 itens e o objeto inteiro muda de tamanho na tela — visível, e o
  critério de aceitação diz que um menu que muda de tamanho não pode ficar torto.
- **Recusada porque o tom não é o nosso:** pílula flutuante é linguagem de app de consumo.
  A sensação-alvo declarada em `UI_GUIDELINES.md` é *confiança · organização ·
  profissionalismo* — a barra ancorada, sólida e previsível diz isso; a pílula diz
  "moderno". Aqui o cliente assina contrato.

---

## tokens

Tudo abaixo usa **os tokens que já existem** em `apps/web/src/index.css` e no preset do
Tailwind. Nenhuma cor nova, nenhum hex solto (`UI_GUIDELINES.md` §9).

### Cor — o que cada estado usa

| Elemento | Token | Classe |
|---|---|---|
| Fundo da barra | `--card` | `bg-card` |
| Borda superior da barra | `--border` | `border-t` |
| Sombra (projetada para cima) | `--shadow-color` | `shadow-[0_-6px_20px_-8px_hsl(var(--shadow-color)/0.18)]` |
| Item **ativo** (ícone, rótulo, barra de 3px) | `--primary` (#003591) | `text-primary` / `bg-primary` |
| Item **inativo** | `--muted-foreground` | `text-muted-foreground` |
| Toque / hover do item | `--accent` | `hover:bg-accent/60` |
| Foco visível | `--ring` | `focus-visible:ring-2 focus-visible:ring-primary/40` |
| **Contador de pendência** | `--warning` + `--warning-foreground` | `bg-warning text-warning-foreground` |
| Barra de sessão de suporte (já existe) | `--warning/15` + `--warning/40` | inalterada |
| Estado de erro nas seções | `--destructive` | `text-destructive` |

⚠️ **O contador é âmbar, não vermelho, e isso é uma decisão.** `--destructive` no projeto
significa *erro / destrutivo* (`Badge variant="danger"`, exclusão, CNPJ inválido). Uma
pendência do cliente não é um erro — é algo **esperando**. Âmbar é o token que o projeto já
usa para "precisa de atenção" (a faixa de suporte, o painel de credenciamentos parado,
`Badge variant="warning"`). `--warning` é `38 96% 29%` — âmbar **escuro**, então o número
branco por cima passa AA com folga (≈7:1), o que um âmbar claro não faria.

⚠️ **`--primary` como cor do ativo, não `--brand-green` nem `--brand-blueLight`.**
`UI_GUIDELINES.md` §1 é explícito: verde e azul-claro **não têm contraste** para texto
pequeno sobre branco. O rótulo do menu é texto de 10px — o menor da interface inteira.
`--primary` (#003591) sobre `--card` dá ≈11:1.

### Tipografia

| Elemento | Tamanho | Peso | Observação |
|---|---|---|---|
| Rótulo do menu | **10px** (`text-[10px]`) | 600 | `leading-none`, `tracking-[-0.01em]`, `truncate` |
| Número do contador | **10px** | 700 | `tabular-nums`, `leading-none` |
| Título da seção (H1), celular | 20px (`text-xl`) | 600 | `text-primary` |
| Título da seção (H1), computador | 24px (`text-2xl`) | 600 | `text-primary` |
| Subtítulo da seção | 14px (`text-sm`) | 400 | `text-muted-foreground` |
| Abas do computador | 14px (`text-sm`) | 500 / 600 no ativo | |

10px é **abaixo** da escala documentada (`text-xs` = 12px). É deliberado e é o único lugar
do produto onde isso acontece: é a régua real de uma tab-bar de 360px, e a fonte é
Montserrat SemiBold, que a 10px continua legível. Se o dono recusar os 10px, a saída é a
Direção B — não um rótulo cortado.

### Espaçamento e medidas (a parte que decide se cabe)

| Medida | Valor | De onde vem |
|---|---|---|
| Altura útil da barra | **56px** | ≥ 44px de alvo de toque, com folga real |
| Altura total da barra | `56px + área segura` | ver ponto 4 |
| Ícone | **22px** (`h-[22px] w-[22px]`) | acima dos 16–20px de UI porque é alvo de toque |
| Vão ícone→rótulo | 4px (`gap-1`) | escala de 4px |
| Padding lateral do item | 2px | o item é uma coluna de grade, não uma caixa fixa |
| Largura do item a 360px, 5 itens | **72px** (68px úteis) | `360 ÷ 5` |
| Largura do item a 360px, 4 itens | **90px** | `360 ÷ 4` |
| Respiro do conteúdo acima da barra | `56px + área segura + 16px` | senão o último card fica embaixo da barra |
| Largura do corpo no computador | **`max-w-4xl` (896px)**, mantida | já é o que o `PortalLayout` faz — nada estica |

### Tokens que faltam — o que criar e onde

1. **`--portal-tabbar-h: 56px`** em `apps/web/src/index.css`, no `:root`. Motivo: a altura
   aparece em **três** lugares (a barra, o `padding-bottom` do conteúdo, o campo de escrita
   ancorado do Suporte). Três números soltos divergem — é o modo de falha da ADR-133
   aplicado a CSS. Consumo: `h-[var(--portal-tabbar-h)]`.
2. **`--portal-faixa-h: 0px`** no `:root`, escrito em tempo de execução pela faixa de
   suporte (ver ponto 5). Serve para o cabeçalho grudar **abaixo** dela.
3. **Utilitário de área segura, não token:** `pb-[env(safe-area-inset-bottom)]` escrito à
   mão na barra e no respiro do conteúdo. Não vale criar um token — `env()` é dinâmico e um
   `--var` congelaria o valor. ⚠️ Ver o ponto 4 antes de mexer no `index.html`.
4. **Nenhum token de cor novo.** Se alguém propuser um "verde de menu ativo", a resposta
   está em `UI_GUIDELINES.md` §1: ele não passa em contraste.

### O que NÃO entra

- **Nenhuma biblioteca nova.** `packages/ui` exporta só `cn`; não há Tabs, Sheet nem
  Drawer. A barra é `<nav>` + `<Link>` do TanStack Router + `grid` do Tailwind: ~50 linhas.
  Custo de dependência: **zero**. Propor Radix Tabs (~12 kB) para 5 links seria pagar peso
  por nada — a barra não tem estado, ela lê a rota.
- **Nenhuma animação de transição de rota.** `UI_GUIDELINES.md` §6 pede sutil e rápido: a
  troca de seção é instantânea, com `animate-fade-in` (já registrado no preset) no conteúdo
  e nada mais. Slide horizontal entre seções exigiria máquina de estado e brigaria com o
  botão "voltar" do navegador, que é critério de aceitação.

---

## telas

Regras válidas para **todas** as cinco:

- **Cabeçalho da seção:** H1 curto + subtítulo de uma linha. Nada de parágrafo de abertura
  (a régua do projeto: até ~25 palavras vira tooltip; acima disso encurta ou vai para o
  guia — e agora o guia é por seção).
- **Carregando:** `Skeleton`, nunca spinner (`UI_GUIDELINES.md` §4). O **cabeçalho e a
  tab-bar aparecem imediatamente**, com o corpo em skeleton — o app precisa parecer de pé no
  primeiro instante, não uma tela branca.
- **Erro:** card com borda `--destructive/30`, texto humano em pt-BR e **botão "Tentar de
  novo"**. Erro que não oferece saída deixa o cliente sem nada a fazer (a lição da ADR-102,
  quando a página de e-mail mentia em vez de dizer que falhou).
- **Vazio:** o primitivo `EmptyState` (ícone em círculo com tint + título + descrição + CTA
  quando existe ação).
- **A 360px:** uma coluna sempre; nenhuma tabela — listas de cards; nenhum `min-w-*` fixo;
  todo card `min-w-0` com `truncate` nos nomes longos; valores em `tabular-nums`.
- **Sem rolagem horizontal:** proibido `overflow-x` no corpo; conteúdo que não cabe (nome de
  operadora, nome de arquivo) trunca com `title`, não empurra a página.

### 1 · Início — `/portal`

**A pergunta que responde:** "o que eu preciso fazer?"

Ordem, de cima para baixo — **ação primeiro, informação depois**:

1. Saudação de uma linha: *"Olá, Clínica Vida Plena"* (H1 curto, sem parágrafo).
2. **Propostas para você** — só se houver. Card com borda `--primary/30`.
3. **Documentos para assinar** — só se houver. Ícone `PenLine` em `--warning`.
4. **O que depende de você** — pendências de exigência. Borda `--warning/40`.
5. **Seu atendimento** — a régua do funil, só enquanto for prospect.
6. **Próxima reunião** — uma só, com "Adicionar à minha agenda".
7. **Seus projetos** — lista curta, sem cartões nem colunas.

Os blocos 2, 3 e 4 **somem quando vazios** — nesta seção o vazio é boa notícia. Se os três
estiverem vazios, entra o estado abaixo. Tudo o que não é ação (e-mails, acervo de
documentos, catálogo) **sai daqui** e mora na sua seção.

| Estado | O que aparece |
|---|---|
| Vazio (nada pendente) | `EmptyState`, ícone `CheckCircle2` em tint verde: **"Está tudo em dia"** / *"Nada esperando por você agora. Quando precisarmos de algo, aparece aqui."* |
| Carregando | Saudação real (vem do `auth.me`, já em cache) + 3 skeletons de card de 96px |
| Erro | *"Não conseguimos carregar o seu painel."* + "Tentar de novo" |

**360px:** cards de largura total, `p-4`; o botão de ação do card ocupa a largura toda
(`w-full`) em vez de flutuar à direita — dedo grande, botão largo.

### 2 · Documentos — `/portal/documentos`

**A pergunta:** "onde estão os papéis?"

1. **Documentos da MedConsultoria** — propostas, contratos, atas, com selo de situação.
2. **O que ainda falta enviar** — as exigências em aberto, com o botão de envio na linha.
3. **Documentos que você enviou** — com quem enviou e quando.

⚠️ **O bloco 2 fica no meio, não no fim.** É o único acionável dos três, e é o que a Med
está esperando. Enterrá-lo embaixo do acervo é o que faz o cliente achar que já entregou
tudo.

| Estado | O que aparece |
|---|---|
| Vazio (nenhum documento, nada a enviar) | `EmptyState` `FileText`: **"Nenhum documento por aqui ainda"** / *"Quando prepararmos algo para você, aparece nesta página."* |
| Vazio só do "enviados" | Linha discreta: *"Você ainda não enviou nenhum arquivo."* + botão "Enviar arquivo" |
| Carregando | 1 skeleton de cabeçalho + 4 linhas de 56px |
| Erro | *"Não conseguimos carregar os seus documentos."* + "Tentar de novo" |
| Enviando arquivo | Barra de progresso na própria linha; a lista **não** entra em skeleton |

**360px:** cada documento é uma linha de duas alturas — nome truncado em cima, situação +
data embaixo. Nunca lado a lado, nunca tabela.

### 3 · Convênios (credenciamento) — `/portal/credenciamento`

**A pergunta:** "em que pé está o meu credenciamento?"
**Só existe se aquela clínica tiver processo de credenciamento** (ver ponto 3).

1. Uma linha de resumo: *"12 de 18 documentos entregues"*, com barra de progresso.
2. **Um bloco por médico** (`Stethoscope` + nome + CRM), com as exigências dentro.
   Documento de frente e verso = **duas vagas separadas**, cada uma com o seu estado.

⚠️ **O que o cliente nunca lê aqui:** o veredito comercial da triagem (INAPTO/PENDENTE). É
ferramenta da equipe e mora na ficha (ADR-103). Aqui só aparece o que ele resolve
entregando alguma coisa.

| Estado | O que aparece |
|---|---|
| Vazio (tem processo, nada pedido ainda) | `EmptyState` `Stethoscope`: **"Ainda não pedimos nenhum documento"** / *"Assim que a lista estiver pronta, ela aparece aqui por médico."* |
| Sem processo | **A seção não existe** — nem no menu, nem como rota (ver ponto 3) |
| Carregando | 2 blocos de médico em skeleton, com 3 linhas cada |
| Erro | *"Não conseguimos carregar o credenciamento."* + "Tentar de novo" |

**360px:** o nome do médico trunca; a vaga de envio é uma linha inteira, com o rótulo
(*Frente* / *Verso*) como `Badge` à esquerda do botão.

### 4 · Meus serviços — `/portal/servicos`

**A pergunta:** "o que eu contratei, e o que mais existe?"

1. **Serviços contratados** — nome, preço no formato do projeto (`formatPreco`), convênios
   atendidos, e o checklist de exigências daquele serviço.
2. **O que você precisa?** — o catálogo do que ainda não foi pedido, para solicitar.

⚠️ **A trava da secretária aparece ANTES do clique, não depois** (M12 do briefing): para o
papel EQUIPE, os botões de contratar e cancelar vêm **desabilitados**, com o tooltip *"Só o
responsável pela clínica contrata"*, no lugar do modal que hoje só recusa no fim. Botão que
some seria pior — a secretária acharia que a função não existe e pediria por WhatsApp.

| Estado | O que aparece |
|---|---|
| Vazio (nada contratado) | `EmptyState` `Package`: **"Você ainda não tem serviços ativos"** / *"Veja abaixo o que podemos fazer por você."* + o catálogo logo em seguida |
| Catálogo vazio (pediu tudo) | Linha discreta: *"Você já pediu tudo o que temos hoje."* |
| Carregando | 2 skeletons de card + 4 pílulas de catálogo em skeleton |
| Erro | *"Não conseguimos carregar os seus serviços."* + "Tentar de novo" |

**360px:** o card do serviço empilha preço e convênios (nunca duas colunas); o catálogo vira
lista de uma coluna, não grade de pílulas.

### 5 · Suporte — `/portal/suporte`

**A pergunta:** "como falo com alguém?"

1. **Botão "Abrir um chamado"**, primeira coisa da tela.
2. **Seus chamados** — protocolo, assunto, situação, última mensagem. Abrir entra na
   conversa.
3. **Seus e-mails** — o histórico do que a Med enviou (só assunto e data).

Dentro de um chamado a seção vira conversa em tela cheia: cabeçalho com voltar + protocolo,
balões, e o campo de escrita **ancorado acima da tab-bar**.

⚠️ **A tab-bar continua visível dentro do chamado.** Escondê-la ao abrir a conversa tiraria
a única saída visível de quem entrou por engano. O campo de escrita fica
`sticky bottom-[calc(var(--portal-tabbar-h)+env(safe-area-inset-bottom))]`.

| Estado | O que aparece |
|---|---|
| Vazio | `EmptyState` `LifeBuoy`: **"Nenhum chamado aberto"** / *"Precisa de alguma coisa? Abra um chamado que a nossa equipe responde por aqui."* + "Abrir um chamado" |
| Carregando | Botão real + 3 linhas de chamado em skeleton |
| Erro | *"Não conseguimos carregar os seus chamados."* + "Tentar de novo" |
| Enviando mensagem | O balão aparece esmaecido com `Loader2` até confirmar |

**360px:** balões com `max-w-[85%]`; o campo de escrita cresce até 4 linhas e depois rola
por dentro.

### O comportamento a 360px, em uma tabela

| Critério de aceitação | Como este desenho cumpre |
|---|---|
| Menu inferior fixo e visível | `fixed inset-x-0 bottom-0 z-40` + `bg-card` **sólido** (translúcido deixaria o texto aparecer por baixo) |
| Sem rolagem horizontal | Barra em `grid` de N colunas iguais (`1fr`), nunca largura fixa; corpo sem `overflow-x`; nomes com `truncate` |
| Sem elemento cortado | Conteúdo com `padding-bottom: calc(var(--portal-tabbar-h) + env(safe-area-inset-bottom) + 1rem)` |
| Alvo de toque ≥ 44px | Item de **56px de altura × 72px de largura** (a 5 itens) — o menor lado é 56px |
| 390×844 | Mesma barra, itens de 78px — mais folga ainda |

---

## textos

Todo texto de interface, em português do Brasil, pronto para colar.

### Os 5 rótulos do menu — e a conta que os define

A régua: **68px úteis** por item a 360px com 5 seções. Montserrat SemiBold a 10px gasta
≈5,5px por caractere ⇒ o limite prático é **≤ 11 caracteres**.

| # | Rótulo | Caracteres | Largura estimada | Cabe? |
|---|---|---|---|---|
| 1 | **Início** | 6 | ≈33px | ✅ |
| 2 | **Documentos** | 10 | ≈55px | ✅ |
| 3 | **Convênios** | 9 | ≈50px | ✅ ⚠️ ver abaixo |
| 4 | **Serviços** | 8 | ≈44px | ✅ |
| 5 | **Suporte** | 7 | ≈39px | ✅ |

⚠️ **RESPONDIDA pelo dono em 28/08 — ver `decisao_do_dono_a_barra_e_dinamica`, no fim deste arquivo: a 3ª posição virou uma VAGA dinâmica, e o rótulo escolhido é "Convênios".** "Credenciamento" tem
**14 caracteres ≈ 77px** e **não cabe** — nem a 9px (≈69px, em cima do limite). Não vale
truncar ("Credenciam…") nem quebrar em duas linhas dentro de uma barra de 56px. Três saídas:

| Saída | Fica assim | Custo |
|---|---|---|
| **RECOMENDADA — rótulo "Convênios"**, H1 da seção *"Credenciamento nos convênios"* | O nome do menu aparece **dentro** do título da página, então não são dois nomes soltos | É a palavra do dia a dia do médico (Unimed, Bradesco Saúde), mas exige o aceite do dono |
| Rótulo "Credenciar" | Verbo, 10 caracteres, cabe | Nav em verbo destoa das outras quatro, que são substantivos |
| Manter "Credenciamento" | Obriga a Direção B (só ícone) | Perde o rótulo nas **cinco** seções para resolver **uma** |

O resto deste documento escreve **Convênios**; trocar é uma linha.

### Títulos e subtítulos das seções

| Seção | H1 | Subtítulo (uma linha) |
|---|---|---|
| Início | *Olá, Clínica Vida Plena* | *O que precisa da sua atenção hoje.* |
| Documentos | *Documentos* | *O que preparamos para você e o que ainda falta enviar.* |
| Convênios | *Credenciamento nos convênios* | *A papelada de cada médico, por convênio.* |
| Meus serviços | *Meus serviços* | *O que você contratou e o que podemos fazer por você.* |
| Suporte | *Suporte* | *Fale com a nossa equipe.* |

### Estados vazios (título / descrição)

| Onde | Título | Descrição |
|---|---|---|
| Início, tudo em dia | **Está tudo em dia** | Nada esperando por você agora. Quando precisarmos de algo, aparece aqui. |
| Documentos | **Nenhum documento por aqui ainda** | Quando prepararmos algo para você, aparece nesta página. |
| Documentos → enviados | *(linha discreta)* | Você ainda não enviou nenhum arquivo. |
| Convênios | **Ainda não pedimos nenhum documento** | Assim que a lista estiver pronta, ela aparece aqui por médico. |
| Meus serviços | **Você ainda não tem serviços ativos** | Veja abaixo o que podemos fazer por você. |
| Catálogo esgotado | *(linha discreta)* | Você já pediu tudo o que temos hoje. |
| Suporte | **Nenhum chamado aberto** | Precisa de alguma coisa? Abra um chamado que a nossa equipe responde por aqui. |
| E-mails | *(linha discreta)* | Você ainda não recebeu e-mails. |

Nenhuma passa de 20 palavras. Nenhuma usa "nenhum registro encontrado", "sem dados" ou
"lista vazia" — vocabulário de banco de dados, não de clínica.

### Erros (todos com o botão **"Tentar de novo"**)

- Início: *Não conseguimos carregar o seu painel.*
- Documentos: *Não conseguimos carregar os seus documentos.*
- Convênios: *Não conseguimos carregar o credenciamento.*
- Meus serviços: *Não conseguimos carregar os seus serviços.*
- Suporte: *Não conseguimos carregar os seus chamados.*
- Envio de arquivo falhou: *O arquivo não foi enviado. Tente de novo ou fale com a nossa equipe.*

"Não conseguimos" e não "Erro ao carregar": a culpa é nossa, e dizer isso em voz ativa é o
tom do produto.

### Menu do avatar (topo direito)

```
┌─────────────────────────────┐
│ 🖼  Clínica Vida Plena       │
│    contato@vidaplena.com.br │
├─────────────────────────────┤
│ 👥  Equipe da clínica        │
│ ⚙️  Editar perfil            │
│ ❓  Guia do Portal           │
├─────────────────────────────┤
│ ↪  Sair                      │
└─────────────────────────────┘
```

Rótulos exatos: **Equipe da clínica** · **Editar perfil** · **Guia do Portal** · **Sair**.
O "Guia do Portal" **desce do cabeçalho para dentro do menu** — no celular, dois botões
soltos no topo competem com o logotipo, e o guia é o menos usado dos dois. O guia que abre é
o **da seção em que a pessoa está** (o buraco de granularidade apontado na auditoria).

### Contador de pendência — o texto que o leitor de tela ouve

O número é `aria-hidden`; o `<Link>` carrega o rótulo completo:

- Sem pendência: `aria-label="Documentos"`
- Com 1: `aria-label="Documentos, 1 pendência"`
- Com 3: `aria-label="Documentos, 3 pendências"`
- Com 12: `aria-label="Documentos, 12 pendências"` — **o número exato**, mesmo quando o
  visual mostra "9+". Truncar é decisão de largura, não de informação.

### Textos das travas de papel (M12)

- Contratar/cancelar serviço, papel EQUIPE: *"Só o responsável pela clínica contrata"*
- Aceitar proposta: *"Só o responsável pela clínica responde"* (frase já no código)
- Assinar documento: *"Só o responsável pela clínica assina"* (frase já no código)

### Dados de demonstração (para protótipo e conferência na tela)

Clínicas: **Clínica Vida Plena** (São Paulo/SP) · **Clínica Bem Estar** ·
**MedLar Home Care** · **Clínica na Mooca** · **Instituto Cardio Sul**.
Médicos: **Dra. Helena Martins Prado** — Cardiologista, CRM-SP 128.440 ·
**Dr. Ricardo Alves Tavares** — Ortopedista, CRM-SP 96.117 ·
**Dra. Camila Nogueira Freitas** — Dermatologista, CRM-SP 143.902.
Secretária: **Patrícia Souza** (papel Equipe no Portal).
Operadoras/convênios: **Unimed** · **Bradesco Saúde** · **Amil** · **SulAmérica** ·
**Omint** · **Porto Seguro Saúde**.
Serviços: **Gestão Operacional** (R$ 3.500,00/mês) · **Faturamento de contas médicas**
(5% do faturamento/mês) · **Credenciamento médico e odontológico**.
Documentos: **Proposta comercial nº 0231** · **Contrato de prestação de serviços** ·
**Ata da reunião de kickoff**. Chamado: **#1042 — Dúvida sobre o repasse de setembro**.

---

## assets

**Biblioteca de ícones do projeto: `lucide-react`** — declarada em `UI_GUIDELINES.md` §5
("uma biblioteca só") e confirmada nos imports de `PortalHome.tsx:2` e de todos os outros
arquivos do Portal. Licença ISC, já é dependência: **custo zero, nenhuma dependência nova**.

### Os 5 ícones do menu

| Seção | Ícone lucide | Por que este |
|---|---|---|
| Início | `Home` | O único novo. Universal, e "casa = começo" não precisa de tradução |
| Documentos | `FileText` | **Já é o ícone de documento do Portal** (`PortalHome.tsx`, `PortalDocumentoModal.tsx`) |
| Convênios | `Stethoscope` | **Já é o ícone de `PortalCredenciamento.tsx`** — o cliente já viu |
| Meus serviços | `Package` | **Já é o ícone de `PortalServicos.tsx`** |
| Suporte | `LifeBuoy` | **Já é o ícone de `PortalSuporte.tsx` e do `SuporteChat.tsx`** |

⚠️ **Quatro dos cinco ícones já significam exatamente essas coisas no código de hoje.** Isso
não é economia — é continuidade: quem já usa o Portal reencontra o mesmo desenho, agora no
menu. O `Home` é o único a escolher, e é o menos ambíguo dos cinco.

Traço: `strokeWidth={2}` no ativo, `strokeWidth={1.75}` no inativo — dá peso ao ativo sem
depender só de cor (importante para quem não distingue as duas).

### Ícones do menu do avatar

`Users` (Equipe da clínica) · `UserCog` (Editar perfil) · `HelpCircle` (Guia do Portal) ·
`LogOut` (Sair) — **todos já importados** no Portal hoje.

### Imagens

**Nenhuma foto realista é necessária, e nenhuma imagem nova precisa ser produzida.** O único
recurso gráfico do shell é `/logo.png`, que já está no repositório e continua onde está. Os
estados vazios usam ícone lucide em círculo com tint da marca (o padrão do primitivo
`EmptyState`), **não ilustração** — ilustração de estado vazio seria trabalho novo para
dizer o que uma frase já diz, e a régua do projeto é interface limpa.

**Ícone de aplicativo:** `favicon-192.png` e `favicon-512.png` **já existem** em
`apps/web/public/`. Não há `manifest.webmanifest` no projeto — sem ele, "adicionar à tela de
início" no iPhone funciona, mas usa o `favicon-180` e abre com a barra do navegador. Um
manifesto seria ~15 linhas e faria o Portal abrir em tela cheia (o "parece um app mesmo"
levado ao limite). **Está fora do escopo desta rodada** — declaro o custo e deixo registrado.

---

## estrategia_de_aquisicao

**O Portal é área logada. Não há SEO a fazer, não há campanha, não há página de entrada
pública, e não existe funil de aquisição aqui — dizê-lo com todas as letras é mais útil do
que inventar um.** Ninguém "descobre" o Portal; ele é entregue a quem já é lead ou cliente
da Med. O equivalente honesto é a **chegada** e a **primeira ação óbvia**.

⚠️ **Não acrescentar `noindex` global.** O mesmo `index.html` serve as páginas **públicas**
`/comecar` (captação) e `/proposta/{token}`. Um `robots: noindex` no documento derrubaria a
captação junto. Se algum dia for preciso, é por rota.

### Como a pessoa chega — os quatro caminhos reais

1. **E-mail de convite** — `boas_vindas_portal` (ADR-135), com o botão **"Entrar no
   Portal"**. É a porta principal. ⚠️ Esse template foi criado justamente porque o antigo
   mandava o cliente para o sistema **interno**; ele hoje aponta para o Portal.
2. **E-mail de ação** — "Você tem uma proposta para responder", "Documento para assinar".
3. **Digitando o endereço** — quem já entrou uma vez volta pelo histórico do navegador.
4. **Sessão de suporte da Med** (ADR-128) — a equipe entrando para *ver*, nunca para agir.

⚠️ **Consequência de projeto que vem daí:** o link do e-mail de ação precisa levar à **seção
certa**, agora que elas existem — proposta e assinatura em `/portal`, exigência em
`/portal/documentos`, papelada em `/portal/credenciamento`. Hoje tudo caía na página única e
a pessoa rolava até achar. Depois do login, o destino guardado deve ser respeitado — e não
um `redirect` cego para `/portal`.

### O primeiro segundo

A pessoa abre o celular e vê, sem rolar: o **logotipo** da MedConsultoria (é ele que diz
"você está no lugar certo, isto é da Med"), **"Olá, Clínica Vida Plena"** (é ele que diz "e é
a sua clínica, não a de outro"), o **primeiro card de ação** e a **barra inferior com os
cinco destinos**. O menu visível na primeira dobra é o que faz o produto parecer um
aplicativo em vez de uma página — é literalmente o pedido do dono.

Se estiver tudo em dia, o primeiro card é **"Está tudo em dia"**. Isso é entrega, não vazio:
para quem entra uma vez por mês, "não preciso fazer nada" é uma resposta valiosa.

### O próximo passo óbvio, seção por seção

| Seção | O que a pessoa faz em seguida | Onde está o botão |
|---|---|---|
| **Início** | Responder a proposta, assinar, ou entregar o que falta | No card, botão de largura total |
| **Documentos** | Enviar o arquivo que a Med pediu | Na linha da exigência, sem sair da página |
| **Convênios** | Enviar o documento de um médico específico | Na vaga (frente/verso) daquele médico |
| **Meus serviços** | Pedir um serviço novo | "O que você precisa?", logo abaixo dos contratados |
| **Suporte** | Abrir um chamado | Primeiro elemento da tela, antes da lista |

⚠️ Em **todas**, o próximo passo está na **primeira dobra a 360px**. Ação que exige rolar
para ser descoberta não acontece com quem está com pressa.

### Retorno e recorrência

Não há push, não há PWA instalável, não há notificação no celular. **Quem traz a pessoa de
volta é o e-mail** — e o e-mail já funciona em produção desde 22/08 (ADR-122). Nenhuma
mecânica nova de retenção é recomendada nesta rodada: seria produto novo, não redesenho.

---

## Os 5 pontos que o design tinha de resolver

### 1 · O contador de pendência

**Como se parece.** Pílula de **18px de altura**, `bg-warning` com número
`--warning-foreground` (branco) a 10px/700 `tabular-nums`, `rounded-full`, **ancorada ao
canto superior direito do ÍCONE** (`absolute -top-1 -right-2`), com `ring-2 ring-card` para
descolar do fundo.

```
      ┌───┐                    ┌───┐
      │ 3 │                    │9+ │
   ┌──┴───┴──┐              ┌──┴───┴──┐
   │   📄    │              │   📄    │
   │Documentos│             │Documentos│
```

**Por que número e não bolinha muda.** Bolinha diz "tem algo"; número diz "tem três". Para
quem entra uma vez por mês, a diferença entre 1 e 8 pendências é a diferença entre resolver
agora e reservar uma hora. Bolinha só seria melhor se o número fosse instável — não é.

**Com 10 ou mais: "9+".** A pílula tem **largura fixa de 18px de 0 a 9**, e a partir de 10
cresce para 22px com "9+". Nunca "12", nunca "99+": três dígitos empurrariam o rótulo e a
barra sairia do lugar. **O número exato continua acessível** — vai no `aria-label` (ver
`textos`) e aparece dentro da seção, que é onde ele importa.

**Quando o rótulo é longo.** A âncora é o **ícone**, não o item nem o texto — então rótulo
de 6 ou de 11 caracteres deixa o contador no mesmo lugar. O rótulo carrega `truncate` como
cinto de segurança; o contador nunca é empurrado por ele.

**Onde ele NÃO aparece.** Nunca em "Início" (a seção *é* a lista de pendências — contar duas
vezes o mesmo item confunde) e nunca em "Suporte" para mensagem já lida. O número tem de
**bater com o que a seção mostra por dentro** (critério de aceitação): a mesma consulta
alimenta os dois — nunca uma contagem própria da barra, que é o modo de falha da ADR-133.

### 2 · O computador (1920×1080)

**Nada de menu inferior no computador.** Barra colada ao rodapé de um monitor de 1080px fica
a centenas de pixels do conteúdo que a pessoa está lendo — é gesto de polegar, não de mouse.

**A navegação equivalente: uma fileira de abas horizontal, logo abaixo do cabeçalho, sticky,
dentro da mesma largura do conteúdo.**

```
┌────────────────────────────────────────────────────────────────┐
│  [logo]                                        🖼 Clínica ▾     │ ← cabeçalho (sticky)
├────────────────────────────────────────────────────────────────┤
│  Início   Documentos ③   Convênios   Meus serviços   Suporte   │ ← abas (sticky)
│  ▔▔▔▔▔▔                                                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   ← 896px de conteúdo, centrado, com respiro dos dois lados →  │
```

**Por que abas e não uma barra lateral.** (a) A barra lateral é a linguagem do **sistema
interno** da equipe (`AppLayout`, 13 itens em 4 grupos); o Portal é outro produto, com 5
destinos rasos — copiar o shell interno faria o cliente achar que entrou no sistema da Med.
(b) Uma lateral de 264px dentro de um corpo de 896px deixaria 630px de conteúdo, **mais
estreito do que hoje**. (c) **A ordem, os rótulos, os ícones e os contadores são exatamente
os mesmos** da barra do celular: um modelo mental, duas renderizações. Aprendeu no celular,
sabe no computador.

**"Nenhuma tela fica com o conteúdo esticado."** O corpo mantém o `max-w-4xl` (896px)
centrado que o `PortalLayout` **já usa** hoje — a 1920px sobram ~500px de respiro de cada
lado, e nenhuma lista se estica em linhas ilegíveis de 1800px. Não é mudança: é a decisão
existente sendo preservada de propósito, e é diferente da regra de `max-w-[1600px]` do
sistema interno, que é uma ferramenta de trabalho densa.

**O ponto de virada é `md` (768px).** Abaixo: tab-bar inferior, sem abas. A partir dele:
abas, sem tab-bar. Nunca as duas. Detalhe: a troca é por **breakpoint CSS**, não por
detecção de dispositivo — girar o telefone para paisagem (844px) mostra as abas, que é o
comportamento certo, e nenhum JavaScript decide layout.

### 3 · A seção que some

```
5 seções (clínica COM credenciamento) — itens de 72px a 360px
┌────────┬────────┬────────┬────────┬────────┐
│ Início │  Docs  │Convênio│Serviços│Suporte │
└────────┴────────┴────────┴────────┴────────┘

4 seções (clínica SEM credenciamento) — itens de 90px a 360px
┌──────────┬──────────┬──────────┬──────────┐
│  Início  │Documentos│ Serviços │ Suporte  │
└──────────┴──────────┴──────────┴──────────┘
```

**A regra que impede o menu torto:** a barra é uma **grade de N colunas de `1fr`**, com N
calculado a partir da lista de seções visíveis:

```
style={{ gridTemplateColumns: `repeat(${secoes.length}, minmax(0, 1fr))` }}
```

Nunca `flex` com largura fixa (sobraria um buraco à direita com 4 itens), nunca
`justify-between` (as bordas ficariam desiguais), nunca um item invisível ocupando o lugar
(alvo de toque fantasma). Com 4 itens **cada um cresce para 90px** — a barra continua
preenchendo a largura toda, simétrica, e os rótulos ganham folga.

**No computador vale o mesmo:** as abas são a mesma lista; com 4, são 4 abas, sem espaço
reservado.

**Como se decide se aparece:** um único sinalizador vindo do servidor (*"esta clínica tem
processo de credenciamento"*), lido em **um lugar só** e usado pelo menu, pelas abas e pela
rota. ⚠️ **A rota `/portal/credenciamento` também tem de sumir** quando não há processo —
menu sem item mas com endereço vivo deixa um link de e-mail antigo levando a uma tela vazia.
Sem processo, o endereço redireciona para `/portal`.

⚠️ **Nunca escondemos a seção "porque está vazia".** O critério é *ter processo*, não *ter
documento pendente*: uma clínica que já entregou tudo continua querendo ver a papelada dela.
Esconder por vazio faria a seção piscar entre visitas.

### 4 · A área segura do iPhone

**O estado de hoje, conferido:** `apps/web/index.html:5` traz
`<meta name="viewport" content="width=device-width, initial-scale=1.0" />` — **sem**
`viewport-fit=cover`. Consequência que muda a resposta inteira: o iOS já **encolhe a
viewport** acima da barra de gestos, então uma barra `fixed bottom-0` **já fica acima** do
indicador de home. Não estamos com o último item inalcançável hoje.

**O que faço, mesmo assim:**

1. `padding-bottom: env(safe-area-inset-bottom)` na barra e no respiro do conteúdo. **Hoje
   resolve para 0** e não muda nada; no dia em que alguém acrescentar `viewport-fit=cover`
   (para pintar o fundo até a borda), a barra já estará correta — em vez de o último item
   ficar sob o indicador e ninguém entender por quê.
2. **NÃO acrescentar `viewport-fit=cover` nesta rodada.** ⚠️ O `index.html` é **um só** para
   o Portal, para o sistema interno e para as páginas públicas: ligar `cover` mexeria no
   cabeçalho fixo do `AppLayout`, no drawer mobile e em `/comecar` de uma vez. É mudança
   global disfarçada de linha de meta tag, e o critério de aceitação não pede.
3. **Altura em `dvh`, nunca `vh`.** A barra de endereço do Safari encolhe e cresce ao rolar;
   `100vh` faz a barra inferior **saltar** durante a rolagem. `min-h-dvh` no shell do Portal
   (não `min-h-screen`) é o que mantém a barra parada. Este é o defeito de iPhone que de
   fato aparece — mais do que a área segura.
4. **`overscroll-behavior: contain`** no corpo, para o "puxar para atualizar" do Safari não
   disputar com a rolagem da lista.

### 5 · A faixa de sessão de suporte

Hoje (`FaixaDeSuporte.tsx`): `sticky top-0 z-40`, fundo `--warning/15`, borda `--warning/40`,
com o botão **"Voltar ao meu acesso"** à direita. Só existe quando `user.operador` não é
nulo (ADR-128) — o cliente de verdade nunca a vê.

**Como ela convive com a tab-bar fixa:**

- **Não colidem.** Uma mora no topo (`sticky top-0 z-40`), a outra no rodapé
  (`fixed bottom-0 z-40`). São extremidades opostas; não há sobreposição possível.
- **O empilhamento no topo, sim, precisa de cuidado:** a faixa é `top-0 z-40` e o cabeçalho
  do Portal também é `sticky top-0`, com `z-30`. O cabeçalho tem de grudar **abaixo** da
  faixa (`top: var(--portal-faixa-h)`), senão os dois disputam o mesmo topo e o logotipo
  passa por trás da faixa ao rolar. Como a faixa quebra linha em telas estreitas, a altura
  não é constante: medir com `ResizeObserver` e publicar em `--portal-faixa-h` (0px por
  padrão) é mais barato e mais correto do que chutar 40px.
- **A tab-bar continua totalmente navegável em sessão de suporte.** A trava da ADR-128 é
  sobre **mutação**; navegar é ler. Esconder o menu faria o operador da Med não conseguir
  ver as seções do cliente — que é exatamente o motivo de a sessão existir.
- **O que muda visualmente:** em sessão de suporte a tab-bar ganha `border-t-warning/50` (em
  vez de `border-t-border`). É o mesmo âmbar da faixa, emoldurando a tela em cima e embaixo:
  quem olhou só o rodapé sabe que ainda está no painel de outra pessoa. Custo: uma classe
  condicional.
- **A 360px:** a faixa hoje é `flex-wrap` e quebra em duas linhas (texto em cima, botão
  embaixo). Fica assim — encolher o texto tiraria o nome do cliente, que é justamente o dado
  que impede alguém de se esquecer de onde está.
- ⚠️ **Nunca mover "Voltar ao meu acesso" para a tab-bar.** A saída de suporte não é uma
  seção do Portal, e ocupar uma das cinco colunas com ela faria o menu do operador ser
  diferente do menu do cliente — e é o menu do cliente que ele precisa enxergar.

---

## Resumo para quem for implementar

| Peça | Decisão |
|---|---|
| Direção | Barra sólida, ícone + rótulo sempre visíveis, ativo em `--primary` com barra de 3px no topo |
| Rótulos | Início · Documentos · **Convênios** ⚠️ · Serviços · Suporte |
| Ícones | `Home` · `FileText` · `Stethoscope` · `Package` · `LifeBuoy` (lucide; 4 já em uso no Portal) |
| Contador | Pílula âmbar de 18px no canto do ícone; "9+" a partir de 10; número exato no `aria-label` |
| Altura | 56px + `env(safe-area-inset-bottom)`; token novo `--portal-tabbar-h` |
| Menu de 4 ou 5 | `grid` de N colunas `1fr` — nunca `flex` com largura fixa |
| Computador | Abas horizontais sticky sob o cabeçalho, a partir de `md`; corpo mantém `max-w-4xl` |
| Shell | `min-h-dvh` (não `min-h-screen`); `overscroll-behavior: contain` |
| Faixa de suporte | Fica no topo; a tab-bar ganha borda âmbar; cabeçalho gruda abaixo dela via `--portal-faixa-h` |
| Dependências novas | **Nenhuma.** ~50 linhas de `<nav>` + `grid` + `Link` |
| Imagens novas | **Nenhuma.** Nenhuma foto realista é necessária |

---

## decisao_do_dono_a_barra_e_dinamica

**Decidido em 28/08/2026, no portão visual.** O dono aprovou a Direção A (ícone + rótulo
sempre visíveis) e **recusou a premissa da 3ª seção**, com a razão certa:

> "Temos que pensar direito, pq nem todos nossos clientes tem convênios. Nem todos tem
> credenciamento tbm. O menu precisa ter coisas coringas. Que sirva para todos os clientes.
> Ou precisa ser inteligente o suficiente para detectar o que o cliente tem de serviço."

Ele delegou a forma ("decida você como será melhor"). A decisão:

### Quatro coringas e uma vaga

| Posição | Item | Vale para quem |
|---|---|---|
| 1 | **Início** | todo cliente — é a caixa de entrada do que pede ação |
| 2 | **Documentos** | todo cliente — toda relação com a Med gera papel |
| 3 | **⟨vaga⟩** | só quem tem aquela frente de trabalho aberta |
| 4 | **Serviços** | todo cliente — é o que ele contratou e o que pode pedir |
| 5 | **Suporte** | todo cliente — é a porta para falar com a equipe |

As quatro fixas não citam serviço nenhum: valem para o médico que só faz faturamento, para
a clínica que só se credencia e para quem contrata gestão. **A vaga é a única parte que
olha o cliente.**

### A vaga é uma lista de candidatas, nunca um `if`

Esta é a parte que decide se a ideia do dono sobrevive à próxima frente de trabalho. A
barra **não** pergunta "esse cliente tem credenciamento?". Ela percorre uma lista de
candidatas declaradas e mostra a primeira que se aplica:

```
CANDIDATAS_DA_VAGA = [
  { chave: "credenciamento", rotulo: "Convênios", rota: "/portal/credenciamento",
    aplica: (r) => r.credenciamentos.length > 0 },
  // frente nova entra AQUI, sem tocar na barra
]
```

Escrever `if (temCredenciamento)` dentro do componente da barra resolveria hoje e cobraria
a dívida no dia em que o Faturamento ganhasse tela própria — que é exatamente o pedido do
dono. A lista custa as mesmas linhas e aceita a próxima frente sem abrir a barra.

⚠️ **Hoje existe UMA candidata**, e é fato do repositório, não escolha: `PortalCredenciamento.tsx`
é a única tela de frente de trabalho que existe no Portal. Faturamento, gestão e marketing
não têm tela própria — construí-las é outra rodada, e está no `fora_de_escopo`.

⚠️ **Regra para o dia em que houver duas candidatas:** a barra mostra **no máximo uma**, e
vence a que tem pendência esperando o cliente; a outra continua alcançável dentro de *Meus
serviços*. Barra que cresce para 6 itens quebra a conta de 360px — 60px por item derruba o
alvo de toque abaixo dos 44px exigidos.

### O que isso resolve do problema do rótulo

A dúvida devolvida acima ("Credenciamento" não cabe em 68px) **muda de natureza**: a vaga só
aparece para quem tem credenciamento, e para essa pessoa a palavra do dia a dia é o convênio
(Unimed, Bradesco Saúde). O rótulo fica **"Convênios"** e o H1 da seção,
*"Credenciamento nos convênios"* — o nome do menu vive dentro do título, então não são dois
nomes soltos para a mesma coisa. Nenhuma das outras quatro seções perde rótulo.

**Sem candidata aplicável, a barra tem 4 itens de 90px** — mais folgada que os 72px de
cinco, nunca torta: a grade é `grid-cols-4` ou `grid-cols-5` conforme o que sobrou, não uma
largura fixa com um buraco.
