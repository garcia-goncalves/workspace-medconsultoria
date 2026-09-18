-- Conciliação Fase 2a: o mapa cirúrgico do TASY entra no sistema.
-- Spec: docs/superpowers/specs/2026-09-18-conciliacao-cirurgias-tasy-design.md
--
-- ADITIVA: um valor novo no enum de origem, duas colunas nuláveis em ProducaoLote e uma tabela
-- nova. Nenhuma linha existente muda de valor. Reverter:
--   DROP TABLE `ProducaoCirurgia`;
--   ALTER TABLE `ProducaoLote` DROP COLUMN `periodoInicio`, DROP COLUMN `periodoFim`,
--     MODIFY `origem` ENUM('CONSULTAS_NUVENS') NOT NULL DEFAULT 'CONSULTAS_NUVENS';
--   (o MODIFY só depois de não restar lote CIRURGIAS_TASY)

-- AlterTable
ALTER TABLE `ProducaoLote` ADD COLUMN `periodoFim` DATE NULL,
    ADD COLUMN `periodoInicio` DATE NULL,
    MODIFY `origem` ENUM('CONSULTAS_NUVENS', 'CIRURGIAS_TASY') NOT NULL DEFAULT 'CONSULTAS_NUVENS';

-- CreateTable
CREATE TABLE `ProducaoCirurgia` (
    `id` VARCHAR(191) NOT NULL,
    `loteId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `competencia` CHAR(7) NOT NULL,
    `linha` INTEGER NOT NULL,
    `numeroCirurgia` VARCHAR(20) NOT NULL,
    `atendimento` VARCHAR(20) NULL,
    `dataCirurgia` DATE NOT NULL,
    `inicioEm` DATETIME(3) NULL,
    `pacienteNome` VARCHAR(191) NOT NULL,
    `procedimento` VARCHAR(255) NOT NULL,
    `status` ENUM('EXECUTADA', 'RESERVADA', 'OUTRO') NOT NULL,
    `statusBruto` VARCHAR(191) NOT NULL,
    `autorizacao` ENUM('AUTORIZADO', 'PARCIAL', 'PENDENTE', 'NAO_NECESSITA', 'OUTRO') NOT NULL,
    `autorizacaoBruto` VARCHAR(191) NOT NULL,
    `categoriaConvenio` ENUM('PARTICULAR', 'CONVENIO', 'SUS', 'AUTOGESTAO', 'OUTRO') NOT NULL,
    `tipoConvenioBruto` VARCHAR(191) NULL,
    `convenioBruto` VARCHAR(191) NOT NULL,
    `operadoraId` VARCHAR(191) NULL,
    `plano` VARCHAR(191) NULL,
    `profissionalBruto` VARCHAR(191) NOT NULL,
    `profissionalId` VARCHAR(191) NULL,
    `anestesista` VARCHAR(191) NULL,
    `opme` BOOLEAN NULL,
    `tempoMinutos` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProducaoCirurgia_clienteId_competencia_idx`(`clienteId`, `competencia`),
    INDEX `ProducaoCirurgia_clienteId_atendimento_idx`(`clienteId`, `atendimento`),
    INDEX `ProducaoCirurgia_loteId_idx`(`loteId`),
    INDEX `ProducaoCirurgia_operadoraId_idx`(`operadoraId`),
    INDEX `ProducaoCirurgia_profissionalId_idx`(`profissionalId`),
    UNIQUE INDEX `ProducaoCirurgia_clienteId_numeroCirurgia_key`(`clienteId`, `numeroCirurgia`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProducaoCirurgia` ADD CONSTRAINT `ProducaoCirurgia_loteId_fkey` FOREIGN KEY (`loteId`) REFERENCES `ProducaoLote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProducaoCirurgia` ADD CONSTRAINT `ProducaoCirurgia_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProducaoCirurgia` ADD CONSTRAINT `ProducaoCirurgia_operadoraId_fkey` FOREIGN KEY (`operadoraId`) REFERENCES `Operadora`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProducaoCirurgia` ADD CONSTRAINT `ProducaoCirurgia_profissionalId_fkey` FOREIGN KEY (`profissionalId`) REFERENCES `Profissional`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
