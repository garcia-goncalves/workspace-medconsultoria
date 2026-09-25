-- Tarefa que se repete (Onda 4B). Ao CONCLUIR uma tarefa recorrente, o servidor cria a próxima
-- ocorrência da série (mesmo título, descrição e responsáveis; prazo = próximo da série).
-- `recorrenteId` é o id da 1ª tarefa da série (nulo na própria 1ª e em tarefa avulsa).
--
-- O índice único (recorrenteId, prazo) é a trava de idempotência: concluir duas vezes, ou duas
-- pessoas concluindo ao mesmo tempo, esbarra nele em vez de criar a mesma ocorrência duas vezes.
-- Nenhuma linha existente entra nele (todas têm recorrenteId nulo, e NULL é distinto no MySQL).
--
-- ADITIVA: três colunas novas (uma com padrão, duas nulas) e um índice. Nenhum backfill.
-- Reverter:
--   DROP INDEX `Tarefa_recorrenteId_prazo_key` ON `Tarefa`;
--   ALTER TABLE `Tarefa` DROP COLUMN `recorrencia`, DROP COLUMN `recorrenciaAte`, DROP COLUMN `recorrenteId`;

-- AlterTable
ALTER TABLE `Tarefa`
    ADD COLUMN `recorrencia` ENUM('NENHUMA', 'DIARIA', 'SEMANAL', 'MENSAL') NOT NULL DEFAULT 'NENHUMA',
    ADD COLUMN `recorrenciaAte` DATETIME(3) NULL,
    ADD COLUMN `recorrenteId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Tarefa_recorrenteId_prazo_key` ON `Tarefa`(`recorrenteId`, `prazo`);
