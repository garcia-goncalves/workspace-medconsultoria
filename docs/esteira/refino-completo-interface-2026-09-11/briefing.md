## pedido_original
"Percebi que você precisa refinar todas as páginas da aplicação. Por exemplo a página
'VENDAS'. Quero que no menu chame 'FUNIL DE VENDAS'. a url eu quero que mude 'leads' para
'funil-de-vendas'. E precisa corrigir a página/layout da página. Por exemplo: os cards dos
leads está bugado. O botão 'enviar acesso' está pulando linha. O botão para remover o lead
está saindo fora do card. Corrija tudo e corrija qualquer coisa que todas as páginas
precisem. Abra seu navegador e acesse/clique em tudo para analisar tudo com assertividade e
corrija tudo. Quero o melhor layout/design/arquitetura. Impecável!"

## entendimento
Duas coisas amarradas: (1) um pedido concreto — renomear "Vendas" para "Funil de Vendas" no
menu, trocar a URL de `/leads` para `/funil-de-vendas`, e consertar três defeitos citados no
card de lead (card "bugado", botão "Enviar acesso" quebrando linha, botão de remover
vazando do card); (2) um pedido amplo — percorrer TODA a aplicação no navegador (área
interna com os 13 itens do menu, as 5 seções do Portal do cliente, e as páginas públicas) e
corrigir qualquer defeito ou inconsistência de layout/design encontrado, elevando o
acabamento visual ao nível "impecável". É refinamento e correção sobre o design que já
existe (Tailwind + tokens já estabelecidos, ADR-129/130/136/143) — não uma reconstrução
visual do zero com paleta/tipografia/biblioteca novas.

## usuario_alvo
A Thaís e a equipe da MedConsultoria, usando no dia a dia em computador e celular — não são
desenvolvedores, então um botão fora do lugar ou uma tela quebrando no celular é o tipo de
coisa que gera trabalho manual desnecessário ou vergonha na frente do cliente (o Portal é
visto por clientes reais). A lente DX não se aplica.

## criterio_de_aceitacao
- Menu mostra "Funil de Vendas" (não "Vendas"); acessar `/funil-de-vendas` abre a página;
  quem tinha `/leads` salvo é redirecionado sem quebrar (link antigo continua funcionando).
- No card de lead: o botão "Enviar acesso" não quebra linha e o botão de remover fica
  inteiramente dentro do card, nos 5 tamanhos já usados na régua de responsividade do
  projeto (360 · 390 · 768 · 1366 · 1920px).
- Cada uma das 13 páginas do menu interno (Início, Tarefas, Agenda, Projetos, Funil de
  Vendas, Clientes, Credenciamentos, Documentos, Financeiro, E-mail, Mensagens, Ajustes,
  Sistema), as 5 seções do Portal do cliente e as páginas públicas (`/comecar`,
  `/privacidade`, tela de assinar, proposta pública) são abertas de verdade no navegador,
  nos mesmos 5 tamanhos, e ficam sem: elemento vazando do card/tela, botão sobreposto ou
  cortado, texto estourando o contêiner, erro no console do navegador.
- Cada defeito encontrado na varredura é corrigido, ou — se for mudança de REGRA DE NEGÓCIO
  (não de layout) — é separado à parte e registrado para decisão própria, nunca misturado
  na mesma correção.
- Ao final: typecheck do monorepo em 0 erros, lint limpo, suíte completa (`@app/api` +
  `@app/web` + e2e) verde, revisores especialistas (react/design) rodados no diff sem
  achado bloqueante.
- Trabalho termina em PR aberto com CI verde — publicar em produção continua sendo decisão
  do dono, feita depois, à parte.

## fora_de_escopo
Redesenho visual do zero (paleta nova, tipografia nova, trocar shadcn/Tailwind por outra
biblioteca) — não foi pedido e multiplicaria o custo sem necessidade; o pedido, pelos
exemplos dados, é consistência e acabamento sobre o que já existe. Mudança de REGRA DE
NEGÓCIO que a varredura encontrar pelo caminho (ex.: uma ação que falta existir) — vira
achado registrado, não entra nesta correção. Publicar em produção.

## riscos
nenhum — é camada de tela (rotas, componentes, CSS/layout); nenhum dado de paciente,
pagamento, migration de banco ou config de deploy é tocado. Único cuidado técnico (não é
risco de negócio): a troca de `/leads` para `/funil-de-vendas` pode exigir ajustar e2e/testes
que hoje referenciam a rota antiga — fica coberto no critério de aceitação (suíte verde).

## plano_de_voo
Fases 1 a 7, modo hÍbrido: a Fase 2 (Descoberta) roda como varredura em paralelo, um
despacho por grupo de páginas (mesmos grupos do próprio menu da app: Início solo · Meu
trabalho · Negócio · Comunicação · Configuração · Portal do cliente · Páginas públicas —
7 despachos), cada um lendo o código E abrindo a tela de verdade (Playwright/Claude-in-Chrome)
nos 5 tamanhos, listando defeitos com arquivo:linha e print. Um Sintetizador (opus) consolida
em spec.md, corta o que é regra de negócio (vira backlog, não entra aqui) e decide se algum
achado precisa da Fase 3 (Design) — só liga se houver uma escolha visual real entre direções
legítimas; senão pula direto para o plano.

Fase 4: neguin-planner (opus) quebra a spec em etapas por ARQUIVOS DISJUNTOS (lição já
registrada neste projeto: agentes em paralelo no mesmo arquivo se atropelam), começando pela
etapa do menu/rota (`paginas.ts` + roteador) e os 3 defeitos já citados dos cards de lead,
depois uma etapa por página/grupo com achado.

Fase 5: neguin-executor (sonnet, haiku no puramente mecânico) por etapa, em paralelo onde os
arquivos não se cruzam, cada um em worktree isolada, com teste onde há regra testável.

Fase 6: revisores por tipo de arquivo tocado (react-reviewer sempre; design-reviewer nas
telas mexidas; typescript-reviewer se tocar `apps/api`) em paralelo, mais um Verificador
técnico (typecheck+testes+lint) e um Verificador de tela final (percorre o critério de
aceitação de novo, os 5 tamanhos, print como prova) — sonnet, síntese final em opus.

Fase 7: Cronista (sonnet) — documentação (CLAUDE.md), memória do que se aprendeu, PR único
(ou poucos, por onda), handoff.

Despachos previstos: ~28 (7 descoberta + 1 síntese + 0–2 design condicional + 1 plano +
~9 execução + ~5 revisão + 1 cronista). Maior gasto do projeto até aqui em uma única
esteira — por isso este briefing pede aprovação explícita antes de começar a Fase 2.
