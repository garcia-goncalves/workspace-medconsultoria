-- A PROVA DO CONSENTIMENTO DA ASSINATURA ELETRONICA.
--
-- A tela de assinar sempre exigiu a caixa "li o documento e concordo" e o servidor sempre
-- recusou sem ela -- mas nada disso era gravado. Depois do clique nao sobrava no sistema
-- nenhum registro de que a pessoa consentiu, nem com que texto. Numa assinatura contestada,
-- "a tela exigia a caixa" e afirmacao sobre o codigo de hoje, nao prova sobre aquele dia.
--
-- MIGRACAO ADITIVA: duas colunas novas e NULAVEIS. Nada e apagado, nada e convertido, nenhuma
-- linha existente muda de valor.
--
-- As assinaturas ANTERIORES ficam com as duas colunas nulas, de proposito: o consentimento
-- delas foi exigido na tela, mas a prova nao foi guardada -- e preencher a data com um chute
-- (a data da assinatura, por exemplo) fabricaria uma prova que ninguem coletou, que e pior
-- que a ausencia honesta. A tela do documento diz "nao registrado" nesses casos.
--
-- REVERTER E DUAS LINHAS:
--   ALTER TABLE `Assinatura` DROP COLUMN `consentimentoEm`;
--   ALTER TABLE `Assinatura` DROP COLUMN `consentimentoVersao`;

ALTER TABLE `Assinatura`
  ADD COLUMN `consentimentoEm` DATETIME(3) NULL,
  ADD COLUMN `consentimentoVersao` VARCHAR(191) NULL;
