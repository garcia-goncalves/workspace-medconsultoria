-- AlterTable
ALTER TABLE `Cliente` ADD COLUMN `anonimizadoEm` DATETIME(3) NULL,
    ADD COLUMN `anonimizadoPorId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `IdentidadeInstitucional` ADD COLUMN `encarregadoEmail` VARCHAR(191) NULL,
    ADD COLUMN `encarregadoNome` VARCHAR(191) NULL,
    ADD COLUMN `retencaoAcervoAnos` INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN `retencaoCorpoEmailDias` INTEGER NOT NULL DEFAULT 180;

-- AlterTable
ALTER TABLE `Lead` ADD COLUMN `privacidadeAceitaEm` DATETIME(3) NULL,
    ADD COLUMN `privacidadeVersao` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `Cliente` ADD CONSTRAINT `Cliente_anonimizadoPorId_fkey` FOREIGN KEY (`anonimizadoPorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
