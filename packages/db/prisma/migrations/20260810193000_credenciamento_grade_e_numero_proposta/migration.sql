-- AlterTable
ALTER TABLE `Documento` ADD COLUMN `numero` INTEGER NULL;

-- CreateTable
CREATE TABLE `Credenciamento` (
    `id` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `profissionalId` VARCHAR(191) NOT NULL,
    `operadoraId` VARCHAR(191) NOT NULL,
    `valor` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `status` ENUM('A_PROTOCOLAR', 'PROTOCOLADO', 'EM_ANALISE', 'APROVADO', 'NEGADO', 'ENCERRADO') NOT NULL DEFAULT 'A_PROTOCOLAR',
    `tentativa` INTEGER NOT NULL DEFAULT 1,
    `documentoId` VARCHAR(191) NULL,
    `contaId` VARCHAR(191) NULL,
    `protocoladoEm` DATETIME(3) NULL,
    `emAnaliseEm` DATETIME(3) NULL,
    `aprovadoEm` DATETIME(3) NULL,
    `negadoEm` DATETIME(3) NULL,
    `encerradoEm` DATETIME(3) NULL,
    `motivoNegativa` TEXT NULL,
    `observacoes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Credenciamento_clienteId_status_idx`(`clienteId`, `status`),
    INDEX `Credenciamento_documentoId_idx`(`documentoId`),
    INDEX `Credenciamento_operadoraId_idx`(`operadoraId`),
    INDEX `Credenciamento_contaId_idx`(`contaId`),
    UNIQUE INDEX `Credenciamento_profissionalId_operadoraId_tentativa_key`(`profissionalId`, `operadoraId`, `tentativa`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Documento_numero_key` ON `Documento`(`numero`);

-- AddForeignKey
ALTER TABLE `Credenciamento` ADD CONSTRAINT `Credenciamento_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Credenciamento` ADD CONSTRAINT `Credenciamento_profissionalId_fkey` FOREIGN KEY (`profissionalId`) REFERENCES `Profissional`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Credenciamento` ADD CONSTRAINT `Credenciamento_operadoraId_fkey` FOREIGN KEY (`operadoraId`) REFERENCES `Operadora`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Credenciamento` ADD CONSTRAINT `Credenciamento_documentoId_fkey` FOREIGN KEY (`documentoId`) REFERENCES `Documento`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Credenciamento` ADD CONSTRAINT `Credenciamento_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Conta`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

