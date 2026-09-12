# Briefing — Refino final antes dos testes com dado real

- **slug:** refino-final-2026-08-28 · **data:** 2026-08-28

## pedido_original
"Pode fazer todas as outras coisas que você comentou. Eu já loguei no chrome com o login do root. Faça tudo! Deixe tudo funcionando perfeitamente e validado. Vi que tem coisas que não fazem sentido e precisa corrigir. Uma delas é o serviço de FATURAMENTO que não trabalhamos com valor FIXO. É SEMPRE SOMENTE % (ganhamos somente porcentagem mensal). Todos os lugares que falar de faturamento, precisa estar bem alinhado. Quero também que tire informações em demasia que estiver em toda aplicação. Não quero muita explicação em texto nas coisas (quero tooltip no máximo de lugares possíveis). Você também precisa garantir que tudo esteja fazendo sentido (funil de vendas/leads, informações, fluxo, automação, inteligência/lógica, etc). Tudo. Inclusive na área do cliente. Achei que a area do cliente está confusa e crua. Talvez está uma página muito comprida... talvez colocar um menu? O que vc acha? QUero tudo BEM ORGANIZADO E FÁCIL DO CLIENTE ENTENDER/MEXER. Para mobile, pensei em menu tipo o app da Binance (menu na parte inferior da tela, sabe?) Quero que para celular pareça um app mesmo sabe? Quero todas as suas ideias de melhorias e refinamentos. Preciso finalizar essa aplicação e começar os testes. Mas preciso que vc refine, teste e garanta tudo 100% por favor, Claude Code."

## entendimento
Quatro frentes de refino antes do dado real: reorganizar o Portal do cliente (hoje uma
página única com 16 blocos empilhados e quase nenhum tratamento de celular) em seções
navegáveis, com menu inferior fixo no celular; alinhar em toda a aplicação que o serviço
de Faturamento é sempre e somente percentual mensal; tirar da tela o texto explicativo em
excesso, preferindo tooltip; e auditar a coerência de fluxo, lógica e automação do funil
ao Portal. Duas frentes menores já foram fechadas nesta sessão: a ADR-136 foi mesclada e
as três provas pendentes de produção foram conferidas como ROOT.

## usuario_alvo
Dois públicos. (a) A Thaís e a equipe da MedConsultoria, no computador, o dia inteiro —
consultoras, não desenvolvedoras, que precisam de tela limpa e sem parágrafo para ler.
(b) O médico e a secretária da clínica cliente, no Portal, quase sempre pelo celular,
entrando poucas vezes e com pressa, para enviar documento, acompanhar credenciamento e
aceitar proposta. Nenhum dos dois é desenvolvedor — a lente DX não se aplica.

## criterio_de_aceitacao
- Portal: as 37 funcionalidades mapeadas ficam alcançáveis por navegação explícita; nenhuma
  exige rolar mais de uma tela cheia depois de escolhida a seção.
- Portal em 390x844 e em 360x800: menu inferior fixo visível, sem rolagem horizontal e sem
  elemento cortado, conferido na tela.
- Faturamento: teste automatizado reprova qualquer caminho que grave ou exiba valor fixo em
  serviço somente-percentual; zero achado de severidade ALTA em aberto na auditoria.
- Texto: cada bloco do inventário tem destino aplicado (tooltip, encurtado ou removido) e
  não sobra nenhum parágrafo de ajuda solto embaixo de campo.
- Fluxo: todo achado ALTA da auditoria de coerência corrigido com teste, ou adiado com o
  motivo escrito no relatório.
- `pnpm -r typecheck`, `pnpm -r lint`, testes de unidade de `@app/api` e `@app/web` e a
  suíte e2e verdes; CI verde no PR antes de mesclar.
- Conferido clicando: como ROOT no localhost e como CLIENTE no Portal local.

## fora_de_escopo
Preencher o "Foro de eleição" em Ajustes (pendência do dono com a Thaís, não é código).
Investigar ou corrigir a lentidão e as quedas do banco de dados em produção — achado grave
desta sessão, mas é infraestrutura de produção e exige ordem explícita do dono.
Publicar em produção: o lote fecha no merge com CI verde, e a publicação é decisão dele.
Transformar o Portal em PWA instalável (service worker, manifesto, offline).

## riscos
Nenhuma migração de banco prevista até aqui — as quatro frentes são de tela, texto e regra.
Se a auditoria de faturamento ou de fluxo exigir mudança de coluna, isso vira portão de
risco antes de qualquer alteração no schema. Não há toque em dado de paciente, pagamento
real nem configuração de deploy.

## plano_de_voo
Fases 1 a 7, com a fase 3 ligada (há interface nova no Portal). Descoberta em modo
completo e já executada: quatro lentes em paralelo (mapa do Portal, auditoria de
faturamento, inventário de texto, coerência de fluxo), todas em opus, porque o custo de
um achado perdido aqui é uma frente inteira refeita. Design em um despacho para a direção
do Portal. Execução paralela por frente em worktrees isoladas. Revisão por revisor
especialista de cada tipo de arquivo tocado mais verificação na tela.
Modelos: descoberta opus (4 despachos, feitos), design sonnet com juízo opus, execução
sonnet, revisão sonnet e opus, cronista sonnet.
Despachos previstos: 18 no total, dos quais 4 já gastos na descoberta.
