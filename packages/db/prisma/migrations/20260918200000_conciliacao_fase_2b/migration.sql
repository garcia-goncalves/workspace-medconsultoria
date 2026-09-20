-- Conciliação Fase 2b: o dinheiro de cada cirurgia, o de-para de procedimento e o repasse.
-- Spec: docs/superpowers/specs/2026-09-18-conciliacao-fase-2b-design.md
--
-- ADITIVA: colunas novas (nuláveis ou com padrão) em ProducaoCirurgia, dois valores novos no enum
-- de origem e duas tabelas novas. Nenhuma linha existente muda de valor. Reverter:
--   DROP TABLE `RepasseLinha`; DROP TABLE `MapeamentoProcedimento`;
--   ALTER TABLE `ProducaoCirurgia` DROP COLUMN `codigoProcedimento`, DROP COLUMN `valorCobrado`,
--     DROP COLUMN `valorRecebido`, DROP COLUMN `dataPagamento`,
--     DROP COLUMN `naoCobrar`, DROP COLUMN `observacao`;
--   (e o enum de origem, só depois de não restar lote REPASSE_TASY/PLANILHA_CONCILIACAO)

-- AlterTable
ALTER TABLE `ProducaoCirurgia` ADD COLUMN `codigoProcedimento` VARCHAR(40) NULL,
    ADD COLUMN `dataPagamento` DATE NULL,
    ADD COLUMN `naoCobrar` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `observacao` TEXT NULL,
    ADD COLUMN `valorCobrado` DECIMAL(12, 2) NULL,
    ADD COLUMN `valorRecebido` DECIMAL(12, 2) NULL;

-- AlterTable
ALTER TABLE `ProducaoLote` MODIFY `origem` ENUM('CONSULTAS_NUVENS', 'CIRURGIAS_TASY', 'REPASSE_TASY', 'PLANILHA_CONCILIACAO') NOT NULL DEFAULT 'CONSULTAS_NUVENS';

-- CreateTable
CREATE TABLE `MapeamentoProcedimento` (
    `id` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `textoBruto` VARCHAR(255) NOT NULL,
    `textoNormalizado` VARCHAR(255) NOT NULL,
    `operadoraId` VARCHAR(191) NULL,
    `codigo` VARCHAR(40) NULL,
    `valor` DECIMAL(12, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MapeamentoProcedimento_operadoraId_idx`(`operadoraId`),
    UNIQUE INDEX `MapeamentoProcedimento_clienteId_textoNormalizado_operadoraI_key`(`clienteId`, `textoNormalizado`, `operadoraId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RepasseLinha` (
    `id` VARCHAR(191) NOT NULL,
    `loteId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `linha` INTEGER NOT NULL,
    `repasseNumero` VARCHAR(30) NULL,
    `atendimento` VARCHAR(20) NULL,
    `convenioBruto` VARCHAR(191) NOT NULL DEFAULT '',
    `executor` VARCHAR(191) NOT NULL DEFAULT '',
    `codigo` VARCHAR(40) NULL,
    `descricao` VARCHAR(255) NULL,
    `dataItem` DATE NULL,
    `dataPagamento` DATE NULL,
    `valor` DECIMAL(12, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `operadoraId` VARCHAR(191) NULL,

    INDEX `RepasseLinha_clienteId_atendimento_idx`(`clienteId`, `atendimento`),
    INDEX `RepasseLinha_clienteId_dataPagamento_idx`(`clienteId`, `dataPagamento`),
    INDEX `RepasseLinha_loteId_idx`(`loteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MapeamentoProcedimento` ADD CONSTRAINT `MapeamentoProcedimento_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MapeamentoProcedimento` ADD CONSTRAINT `MapeamentoProcedimento_operadoraId_fkey` FOREIGN KEY (`operadoraId`) REFERENCES `Operadora`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RepasseLinha` ADD CONSTRAINT `RepasseLinha_loteId_fkey` FOREIGN KEY (`loteId`) REFERENCES `ProducaoLote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RepasseLinha` ADD CONSTRAINT `RepasseLinha_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RepasseLinha` ADD CONSTRAINT `RepasseLinha_operadoraId_fkey` FOREIGN KEY (`operadoraId`) REFERENCES `Operadora`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

