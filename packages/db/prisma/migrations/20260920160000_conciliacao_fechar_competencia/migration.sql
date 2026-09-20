-- Conciliação: fechar a competência ("este mês está conferido").
-- Spec: docs/superpowers/specs/2026-09-20-conciliacao-fechamento-de-competencia-design.md
--
-- ADITIVA E ISOLADA: UMA tabela nova. Nenhuma tabela existente muda, nenhum backfill.
-- Reverter é uma linha:  DROP TABLE `CompetenciaFechada`;
--
-- ⚠️ As colunas de dinheiro aqui NÃO são fonte de verdade do valor de hoje. Todo número da
-- Conciliação é calculado a cada leitura; estas guardam o RETRATO do que foi conferido, e servem
-- só para responder "mudou alguma coisa desde então?". Nenhuma tela as exibe como valor corrente.

-- CreateTable
CREATE TABLE `CompetenciaFechada` (
    `id` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `competencia` CHAR(7) NOT NULL,
    `fechadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fechadoPorId` VARCHAR(191) NULL,
    `reabertoEm` DATETIME(3) NULL,
    `reabertoPorId` VARCHAR(191) NULL,
    `observacao` TEXT NULL,
    `cobrado` DECIMAL(12, 2) NOT NULL,
    `recebido` DECIMAL(12, 2) NOT NULL,
    `glosa` DECIMAL(12, 2) NOT NULL,
    `aReceber` DECIMAL(12, 2) NOT NULL,
    `cirurgias` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompetenciaFechada_fechadoPorId_idx`(`fechadoPorId`),
    UNIQUE INDEX `CompetenciaFechada_clienteId_competencia_key`(`clienteId`, `competencia`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CompetenciaFechada` ADD CONSTRAINT `CompetenciaFechada_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetenciaFechada` ADD CONSTRAINT `CompetenciaFechada_fechadoPorId_fkey` FOREIGN KEY (`fechadoPorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

