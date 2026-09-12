# Briefing — Proposta de faturamento médico, no modelo real da Thaís

## pedido_original

> também preciso alterar algumas coisas na proposta comercial do serviço de FATURAMENTO. Sei que
> temos um modelo PADRÃO de proposta para todos os serviços, mas sempre que tiver o serviço
> FATURAMENTO, ele é um pouco diferente dos outros serviços (peculiaridades). E precisa ter
> informações na proposta que nenhum outro serviço terá. Então preciso te enviar um modelo de
> proposta de FATURAMENTO que a Thais me enviou de exemplos (modelo que ela gosta de usar). Ela
> disse que vc não pode mudar a "estrutura" do conteúdo (tudo o que ela pede ou informa o
> cliente), mas disse que vc pode melhorar/lapidar/refinar melhorando o modelo dela. Deixando
> tudo bem estruturado e organizado.

Seguiu o modelo integral que a Thaís usa (Proposta 33 — Prisma Visão / Dr. Luis Paves,
26.08.26), com as seções: apresentação, OBJETIVO DA PARCERIA, COMO FUNCIONA NOSSO SERVIÇO,
GESTÃO E ACOMPANHAMENTO, PRAZOS E ROTINA DE FATURAMENTO, INVESTIMENTO (faixas de faturamento
bruto × honorário), despesa do portador, condição de pagamento do repasse, dados bancários e
PIX, CONFIDENCIALIDADE, fechamento.

Correções e decisões de produto do dono, depois da 1ª leitura do briefing:
1. **O Faturamento NÃO tem valor fixo. É só porcentagem**, e a porcentagem **varia por cliente**.
   A tabela de faixas do papel de exemplo está **cancelada** — o dono é a autoridade sobre o
   próprio preço, e o exemplo da Thaís estava desatualizado nesse ponto. O sistema já faz isto
   hoje: `Servico.percentual` é o padrão e o campo é editável dentro de cada proposta
   (`apps/web/src/features/documentos/PropostaServicosPicker.tsx:150`). **Zero código de preço
   novo, zero migração para isto.**
2. Os **dados bancários saem em TODAS as propostas** — a comercial padrão e a de faturamento —,
   **menos na de credenciamento**, porque ali a Thaís só cobra depois do sucesso do
   credenciamento na operadora, e a cobrança nasce em outro momento (ADR-104).
3. **O campo "Condições de pagamento" sai dos modelos de proposta.** Não existe condição a
   negociar: é sempre PIX, e o PIX já vai no bloco de dados para pagamento.
4. **Sempre que o serviço de Faturamento estiver na proposta**, o documento traz, na seção que
   fala do faturamento: *"O recebimento do Repasse do faturamento médico será sempre feito após
   o crédito na conta da Clínica."* Vale também em proposta misturada com outros serviços.
5. **O faturamento mensal médio sai do papel do cliente e continua no funil.** Decisão minha,
   recomendada ao dono e aceita: imprimir *"R$ 6.000,00/mês (5% de R$ 120.000,00)"* é uma
   promessa que envelhece no mês seguinte — a preocupação que o próprio dono levantou. O papel
   passa a dizer só o percentual sobre o efetivamente faturado e recebido. O número continua
   sendo perguntado no construtor (marcado "não sai no documento") e continua alimentando o
   valor do negócio no funil, senão o lead de faturamento volta a valer R$ 0,00 — o defeito que
   a ADR-125 consertou em 26/08.

## entendimento

A "Proposta de faturamento médico" que está no ar hoje é uma versão genérica que eu escrevi;
o papel que a Thaís realmente manda ao cliente tem seções e informações que o sistema não
guarda em lugar nenhum. Vamos reescrever o modelo para ser o papel dela — mantendo a estrutura
e o que ela diz ao cliente, só arrumando redação, ordem e formatação — e criar os dois campos
que faltam para o sistema preencher sozinho: a **tabela de honorário por faixa de faturamento**
(no serviço, editável na proposta) e os **dados para pagamento** (em Ajustes → Dados da empresa).

## usuario_alvo

A Thaís, montando uma proposta de faturamento em `/documentos` → Novo documento → Proposta de
faturamento médico, e o cliente que recebe o PDF. Não é desenvolvedor.

## criterio_de_aceitacao

1. `pnpm -r typecheck`, `pnpm lint`, `pnpm --filter @app/api test:unit` e a suíte e2e passam.
2. O construtor da proposta continua deixando ajustar a **porcentagem daquela proposta** sem
   mexer no cadastro do serviço — provado gerando duas propostas com percentuais diferentes e
   conferindo que `Servico.percentual` não mudou.
3. Em **Ajustes → Dados da empresa** existem os campos Banco, Agência, Conta, Titular e Chave
   PIX. Salvar e reabrir devolve o que foi digitado.
3b. Os dados de pagamento saem na **Proposta comercial** e na **Proposta de faturamento médico**,
   e **NÃO saem** na **Proposta de credenciamento** — conferido gerando as três na tela. Com os
   campos em branco em Ajustes, o bloco inteiro some do papel em vez de sair meio preenchido.
4. Gerar uma proposta de faturamento na tela produz um documento com todas as seções do papel da
   Thaís, na ordem dela, com: os convênios marcados, a tabela de faixas renderizada, os dados
   bancários preenchidos a partir de Ajustes, e a condição de pagamento do serviço.
5. O campo **"Condições de pagamento" não aparece mais** em nenhum dos três formatos de
   proposta (comercial, credenciamento, faturamento) — nem na tela do construtor, nem no papel.
6. Toda proposta que inclua um serviço **cobrado só por percentual** traz a frase do repasse
   ("...sempre feito após o crédito na conta da Clínica"), inclusive em proposta misturada com
   serviços de valor fixo. Provado por teste, e o texto vem de `Servico.condicaoPagamento`, não
   do código — a Thaís muda a vírgula pela tela de Serviços.
7. A proposta **não imprime mais** a conta "R$ X/mês (Y% de R$ Z)". O faturamento mensal
   continua sendo perguntado no construtor, com o aviso de que não sai no documento, e continua
   gravando no lead e recalculando o valor do negócio (`reconciliarPassosAuto`).
8. A comparação `categoria === "Faturamento"` **não existe mais** em
   `apps/api/src/modules/documentos/documentos.service.ts` (hoje está nas linhas 555, 575, 789 e
   907). Quem decide é o preço (`temPercentual`/`ehServicoSomentePercentual`, em `@app/shared`),
   e um teste reprova a volta da comparação — igual ao que já existe para os outros caminhos.
9. Nenhum erro no console do navegador ao gerar e visualizar a proposta.

## fora_de_escopo

- Mudar a **estrutura** da proposta de credenciamento ou da proposta comercial padrão. A única
  coisa que entra nas duas é o bloco de dados para pagamento — e na de credenciamento nem isso.
- Criar campo para a plataforma de gestão da clínica (o "Feegow Clinic" do exemplo). O texto sai
  genérico — "a plataforma de gestão utilizada pela Clínica" — e quem monta a proposta escreve o
  nome no documento, que é editável.
- Guardar os nomes de quem coordena e de quem dá suporte comercial em campo do banco. Eles ficam
  no **corpo do modelo**, que a Thaís edita em Ajustes → Modelos sem publicação nenhuma.
- Cobrar/emitir o repasse. Isto é só o documento; o Financeiro não muda.
- A tabela de faixas do papel de exemplo (o `R$ 1.1200,00` e o buraco entre R$ 25.000 e
  R$ 100.000). O dono determinou que o Faturamento é **só percentual** — a tabela não entra.
- Apagar a coluna `Servico.condicaoPagamento`. Migração destrutiva por um campo de um dia não se
  paga; ela continua viva, com outro papel.

## riscos

- **Migration** — aditiva e pequena: cinco colunas de texto **nuláveis** em
  `IdentidadeInstitucional` (banco, agência, conta, titular, chave PIX). Nada é apagado, nada é
  convertido, nenhuma linha existente muda de valor. Reverter é apagar as cinco colunas.
  `Servico.condicaoPagamento` **não é apagada** — muda de papel (passa a ser a frase do repasse
  daquele serviço), o que é mudança de rótulo na tela, não de banco. **Exige o sim do dono antes
  de mesclar** (portão 4 da esteira).
- **Dinheiro e dados bancários no papel do cliente** — a chave PIX e a conta saem no documento.
  Conta errada ali é dinheiro no lugar errado. Mitigação: o valor vem de Ajustes, digitado uma
  vez pela Thaís, nunca do código; campo em branco faz o bloco inteiro sumir em vez de sair pela
  metade; e a formatação é a do formatador central de pt-BR, nunca reimplementada.
- Sem dado de paciente. Sem config de deploy. Sem produção nesta fase.

## plano_de_voo

- **Modo enxuto.** Domínio recém-trabalhado (ADR-125/126, mesma sessão anterior); a descoberta já
  foi feita inline nesta janela, com os arquivos e o schema lidos.
- **Fases ligadas:** 1 (este briefing) → 4/5 (plano e execução por mim, num branch só: os
  arquivos são acoplados e worktrees paralelas dariam conflito no mesmo modelo) → 6 (verificação)
  → 7 (documentação, memória, PR).
- **Fase 2 (descoberta) e fase 3 (design) desligadas.** Não há direção visual nova: a tela é o
  construtor de proposta que já existe.
- **Número de despachos previsto: 0.** O disparo de subagentes segue desligado nesta sessão por
  configuração — os revisores especialistas (typescript, react, database) não rodam. A
  verificação é por `pnpm lint`, `pnpm -r typecheck`, testes de unidade, teste contra o MySQL de
  verdade, e2e isolado e o percurso na tela.
