## problema
Layout quebra em telas estreitas em vários pontos da aplicação: o exemplo relatado (card de
lead com botão quebrando linha e botão de remover vazando do card) é um sintoma de um padrão
que se repete — falta `flex-wrap`/`min-w-0`/`whitespace-nowrap` em pontos específicos que a
suíte de responsividade existente (`e2e/responsividade-total.spec.ts`) não cobre inteiramente.
Um achado é mais grave que layout: em Mensagens, editar/apagar a própria mensagem depende de
`:hover`, então não funciona em celular — perda de funcionalidade, não só estética.

## solucao
Seis auditorias de código em paralelo (uma por grupo de páginas do menu) já levantaram os
defeitos reais, cada um com arquivo:linha. A correção segue o padrão que o próprio projeto já
usa em código vizinho (não inventa CSS novo): aplicar `flex-wrap`/`min-w-0`/`truncate`/
`whitespace-nowrap` nos pontos que faltam, subir botão pequeno demais para 44px de alvo de
toque, e trocar `:hover`-only por um gate `md:` (padrão que já existe num botão irmão na
mesma tela). Mais: renomear "Vendas"→"Funil de Vendas" no menu e a URL `/leads`→
`/funil-de-vendas` (com redirecionamento do link antigo).

Também corrige a PRÓPRIA RÉGUA em três pontos onde ela deixou passar bug real: (1) o quadro do
funil marca a fileira inteira de colunas com `data-rolagem-horizontal`, isentando também o
conteúdo INTERNO de cada card — a checagem de estouro fica cega para os cards, que é
exatamente onde o bug relatado mora; (2) a checagem de alvo de toque/texto cortado só roda
nas rotas do Portal, nunca nas internas nem nas públicas; (3) `/sistema` e os 6 modais de
`/ajustes` só são medidos na carga inicial, nunca depois de trocar de aba/abrir modal.

## o_que_ja_existe
- `apps/web/src/lib/paginas.ts:81` — entrada do menu "Vendas" → `/leads`.
- `apps/web/src/features/crm/leads/LeadCard.tsx:171-175` — `flex` sem `flex-wrap` no rodapé
  do card (causa raiz dos 3 bugs relatados pelo dono).
- `apps/web/src/features/crm/leads/LeadDetailPanel.tsx:493` — a MESMA composição de botões,
  já com `flex flex-wrap gap-2` correto — é o padrão a copiar, não a inventar.
- `apps/web/src/features/crm/AcessoPortalBotao.tsx:49-50` — texto do botão sem
  `whitespace-nowrap`.
- `apps/web/src/features/crm/leads/LeadsPipelinePage.tsx:680` — `data-rolagem-horizontal` na
  fileira inteira de colunas, isentando o conteúdo interno dos cards da checagem de estouro.
- `apps/web/src/features/agenda/AgendaPage.tsx:438,447,982,987` e
  `apps/web/src/features/projetos/ProjetosListPage.tsx:251` — `<select>` com `w-auto`
  (bug já catalogado no projeto: vira do tamanho da opção mais longa).
- `apps/web/src/features/projetos/KanbanCard.tsx:87-98` — título do card sem `min-w-0`/
  `truncate`.
- `apps/web/src/features/mensagens/MensagensPage.tsx:409-414` — botões de editar/apagar só em
  `:hover`, sem o gate `md:` que o botão "⋮" da mesma página (linha 278) já usa certo;
  `:439` — balão de mensagem sem `break-words`/`min-w-0` (URL longa estoura).
  `:278` (referência do padrão correto a copiar).
- `apps/web/src/features/sistema/SistemaPage.tsx:1586-1590` — nome de migração sem `min-w-0`
  no `truncate` (aba Manutenção).
  `:` (`ConfigLinha`, mesma aba) — mesmo defeito, risco menor.
- `apps/web/src/features/portal/PortalSuporte.tsx:137-140` — assunto do chamado sem
  `min-w-0`, mesma classe de bug já corrigida noutros lugares do Portal (ADR-143), só que
  aqui faltou.
- `apps/web/src/features/portal/PessoasDoPortal.tsx:94-96` — mesmo defeito, risco menor
  (o contêiner já tem `flex-wrap`).
- `apps/web/src/features/assinaturas/AssinarPage.tsx:118-138` — lista de signatários sem
  `flex-wrap`/`min-w-0`/`truncate`, nome vindo do banco sem teto.
- `apps/web/src/features/assinaturas/SignaturePad.tsx:66-90` — botões "Desenhar"/"Digitar"
  com ~32-34px, abaixo do alvo de toque mínimo de 44px (ADR-143).
- `e2e/responsividade-total.spec.ts:268-296` — a função `verificarRota`, e a lista de rotas
  testada: cobre 22 internas + 6 do Portal, zero públicas; a checagem de toque/texto cortado
  só roda com `opts.portal`.

## fontes_externas
nenhuma

## fora_de_escopo
Redesenho visual do zero (paleta, tipografia, biblioteca de componente nova) — nenhum achado
das 6 auditorias pediu isso; todo defeito encontrado tem um padrão CORRETO já existente em
código vizinho do mesmo projeto para copiar, então não há decisão de design pendente (Fase 3
da esteira não é necessária). Nenhum achado de REGRA DE NEGÓCIO fora de layout foi reportado
por nenhum dos 6 auditores. Publicar em produção — decisão do dono, depois, à parte.

## contradicoes_resolvidas
nenhuma — os 6 auditores trabalharam em páginas disjuntas e não encontraram achados
conflitantes entre si; todos os achados são do mesmo padrão (falta de `flex-wrap`/`min-w-0`/
`whitespace-nowrap`/alvo de toque), o que reforça que é um hábito de código a reforçar, não
uma disputa de abordagem.

## duvidas_para_o_dono
nenhuma
