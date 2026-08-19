-- ADR-119: todo cliente da MedConsultoria é pessoa jurídica.
-- Os clientes são médicos e clínicas, e todos são PJ. A escolha "pessoa física ou jurídica"
-- deixa de existir no cadastro, no Portal e na conversão do lead.
--
-- ⚠️ IRREVERSÍVEL PELO DADO: a marcação de quem era pessoa física some. Nada é apagado sem
-- destino — o documento que estivesse guardado vai para as observações da ficha.
--
-- **Por que cada passo é condicional.** O MySQL faz commit implícito a cada DDL: não há
-- transação que cubra o arquivo inteiro. Se o `DROP COLUMN` falhasse (lock, conexão caída)
-- depois de o `RENAME` já ter commitado, o Prisma marcaria a migração como falha — e rodá-la
-- de novo quebraria no passo 1, que procura uma coluna que o passo 2 acabou de renomear.
-- Com as guardas de `information_schema` abaixo, **o arquivo inteiro é repetível**: cada passo
-- que já aconteceu vira `SELECT 1`. Retomar de uma falha é reexecutar, sem cirurgia manual.

-- ---------------------------------------------------------------------------------------
-- 1) Cliente que era pessoa física guardava CPF no campo `documento`. Esse campo vira CNPJ,
--    e um CPF não pode ficar ali se passando por CNPJ — sairia impresso em contrato como
--    "inscrita sob o CNPJ 529.982.247-25". O número não é apagado: vai para as observações,
--    onde a equipe vê e decide o que fazer.
--    Move QUALQUER documento de cadastro PF, sem olhar o tamanho: o documento de uma pessoa
--    física não é o CNPJ da clínica, mesmo quando por acaso tem 14 caracteres.
-- ---------------------------------------------------------------------------------------
SET @tem_tipo := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Cliente' AND COLUMN_NAME = 'tipo');

SET @sql := IF(@tem_tipo = 1,
  "UPDATE `Cliente`
      SET `observacoes` = TRIM(CONCAT(
            COALESCE(CONCAT(`observacoes`, '\n'), ''),
            '[ADR-119] Documento do cadastro antigo (a conta era pessoa física): ',
            `documento`
          )),
          `documento` = NULL
    WHERE `tipo` = 'PF' AND `documento` IS NOT NULL AND `documento` <> ''",
  "SELECT 1");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------------------
-- 2) `documento` vira `cnpj`. RENAME, e não DROP + ADD: o Prisma geraria drop+add e apagaria
--    os CNPJs já cadastrados (ele avisou — "about to drop the column `documento`, which still
--    contains 2 non-null values"). Renomear preserva tudo.
-- ---------------------------------------------------------------------------------------
SET @tem_documento := (SELECT COUNT(*) FROM information_schema.COLUMNS
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Cliente' AND COLUMN_NAME = 'documento');

SET @sql := IF(@tem_documento = 1,
  "ALTER TABLE `Cliente` RENAME COLUMN `documento` TO `cnpj`",
  "SELECT 1");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------------------
-- 3) Não existe mais tipo de pessoa. Depois disto o banco RECUSA gravar PF por não ter onde:
--    a regra deixa de depender de alguém lembrar dela na tela.
-- ---------------------------------------------------------------------------------------
SET @tem_tipo := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Cliente' AND COLUMN_NAME = 'tipo');

SET @sql := IF(@tem_tipo = 1, "ALTER TABLE `Cliente` DROP COLUMN `tipo`", "SELECT 1");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------------------
-- 4) O lead passa a carregar o CNPJ da clínica desde o primeiro contato, para não redigitar
--    na conversão. Opcional: no primeiro contato nem sempre se tem o número.
-- ---------------------------------------------------------------------------------------
SET @tem_cnpj_lead := (SELECT COUNT(*) FROM information_schema.COLUMNS
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Lead' AND COLUMN_NAME = 'cnpj');

SET @sql := IF(@tem_cnpj_lead = 0, "ALTER TABLE `Lead` ADD COLUMN `cnpj` VARCHAR(191) NULL", "SELECT 1");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
