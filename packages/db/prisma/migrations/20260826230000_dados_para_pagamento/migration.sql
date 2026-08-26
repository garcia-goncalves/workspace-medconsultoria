-- DADOS PARA PAGAMENTO na identidade institucional.
--
-- Cinco colunas NOVAS e NULÁVEIS. Nada é apagado, nada é convertido, nenhuma linha existente
-- muda de valor: reverter é `DROP COLUMN` nas cinco. Nulas de propósito — enquanto a Thaís não
-- preencher em Ajustes → Dados da empresa, o bloco de pagamento SOME da proposta, em vez de sair
-- pela metade na frente do cliente. Ver o modelo de proposta de faturamento (ADR-127).
ALTER TABLE `IdentidadeInstitucional`
  ADD COLUMN `bancoNome` VARCHAR(191) NULL,
  ADD COLUMN `bancoAgencia` VARCHAR(191) NULL,
  ADD COLUMN `bancoConta` VARCHAR(191) NULL,
  ADD COLUMN `bancoTitular` TEXT NULL,
  ADD COLUMN `pixChave` VARCHAR(191) NULL;
