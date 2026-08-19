-- ADR-119: todo cliente da MedConsultoria é pessoa jurídica.
-- Os clientes são médicos e clínicas, e todos são PJ. A escolha "pessoa física ou jurídica"
-- deixa de existir no cadastro, no Portal e na conversão do lead.
--
-- ⚠️ Esta migração é IRREVERSÍVEL pelo dado: a marcação de quem era pessoa física some.
-- Nada é apagado sem destino — o CPF que estivesse guardado vai para as observações da ficha.

-- 1) Cliente que era pessoa física guardava CPF no campo `documento`. Esse campo vira CNPJ,
--    e um CPF não pode ficar ali se passando por CNPJ (sairia impresso em contrato como
--    "inscrita sob o CNPJ 529.982.247-25"). O número não é apagado: vai para as observações,
--    onde a equipe vê e decide o que fazer.
UPDATE `Cliente`
SET `observacoes` = TRIM(CONCAT(
      COALESCE(CONCAT(`observacoes`, '\n'), ''),
      '[ADR-119] CPF do cadastro antigo (a conta era pessoa física): ',
      `documento`
    )),
    `documento` = NULL
WHERE `tipo` = 'PF'
  AND `documento` IS NOT NULL
  AND `documento` <> ''
  AND CHAR_LENGTH(REGEXP_REPLACE(`documento`, '[^0-9A-Za-z]', '')) <> 14;

-- 2) `documento` vira `cnpj`. RENAME, e não DROP + ADD: o Prisma geraria drop+add e apagaria
--    os CNPJs já cadastrados (ele avisou "about to drop the column, which still contains
--    2 non-null values"). Renomear preserva tudo.
ALTER TABLE `Cliente` RENAME COLUMN `documento` TO `cnpj`;

-- 3) Não existe mais tipo de pessoa. Depois disto o banco RECUSA gravar PF por não ter onde:
--    a regra deixa de depender de alguém lembrar dela na tela.
ALTER TABLE `Cliente` DROP COLUMN `tipo`;

-- 4) O lead passa a carregar o CNPJ da clínica desde o primeiro contato, para não redigitar
--    na conversão. Opcional: no primeiro contato nem sempre se tem o número.
ALTER TABLE `Lead` ADD COLUMN `cnpj` VARCHAR(191) NULL;
