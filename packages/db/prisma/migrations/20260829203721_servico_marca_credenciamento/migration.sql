-- A MARCA DO CREDENCIAMENTO — a cura do remendo apontado pela ADR-140.
--
-- Até aqui, "este serviço é o credenciamento?" era respondido comparando o NOME com a
-- constante `Credenciamento médico e odontológico`. Três regras de dinheiro dependiam disso
-- (ADR-104/108), então corrigir um typo em Ajustes → Serviços fazia o cliente ser cobrado na
-- conversão do lead E de novo quando a operadora aprovasse.
--
-- ADITIVA: uma coluna nova com padrão. Reverter é `DROP COLUMN`.
ALTER TABLE `Servico` ADD COLUMN `ehCredenciamento` BOOLEAN NOT NULL DEFAULT false;

-- ⚠️ O BACKFILL É PARTE DA MIGRAÇÃO, NÃO UM PASSO SEGUINTE.
-- Com a coluna criada e nenhuma linha marcada, o sistema passaria a tratar o credenciamento
-- como serviço comum entre o `ALTER` e o `UPDATE` — e esse é justamente o lado que cobra
-- cedo demais. A comparação repete a da aplicação (`trim` + minúsculas) para pegar também a
-- linha cadastrada com espaço sobrando ou caixa diferente.
UPDATE `Servico`
   SET `ehCredenciamento` = true
 WHERE LOWER(TRIM(`nome`)) = LOWER('Credenciamento médico e odontológico');
