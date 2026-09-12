-- ADR-125 — o serviço percentual (Faturamento de contas médicas) para de pedir valor fixo.
--
-- Duas colunas NOVAS e NULÁVEIS. Nada é apagado, nada é convertido, nenhuma linha existente
-- muda de valor: em produção esta migração é reversível apagando as duas colunas.
--
--  * `Lead.faturamentoMensalEstimado` — a base do cálculo quando todos os serviços do lead são
--    percentuais. O `valorEstimado` continua existindo e passa a ser DERIVADO dela nesse caso.
--  * `Servico.condicaoPagamento` — a frase de condição de pagamento que entra na proposta,
--    escrita pela Thaís na tela de Serviços (mesmo padrão de `clausulasContrato`).
--
-- Escrita à mão de propósito: `prisma migrate dev` geraria o mesmo ALTER, mas o comentário
-- acima é o que explica a intenção para quem abrir isto daqui a um ano.

ALTER TABLE `Lead` ADD COLUMN `faturamentoMensalEstimado` DECIMAL(12, 2) NULL;

ALTER TABLE `Servico` ADD COLUMN `condicaoPagamento` TEXT NULL;
