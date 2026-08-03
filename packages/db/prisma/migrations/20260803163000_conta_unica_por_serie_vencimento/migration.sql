-- Uma série de contas recorrentes não pode ter DUAS parcelas no mesmo vencimento.
-- Vale para TODA a tabela, inclusive linhas soft-deletadas: por isso a geração ressuscita
-- a apagada em vez de criar outra (ADR-92). Conta não-recorrente tem recorrenteId nulo e
-- fica de fora — o MySQL trata NULL como distinto em índice único.
CREATE UNIQUE INDEX `Conta_recorrenteId_vencimento_key` ON `Conta`(`recorrenteId`, `vencimento`);
