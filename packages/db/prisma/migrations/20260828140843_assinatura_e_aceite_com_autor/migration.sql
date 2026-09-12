-- AlterTable
ALTER TABLE `Assinatura` ADD COLUMN `assinadoPorId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Documento` ADD COLUMN `propostaRespPorId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `Documento` ADD CONSTRAINT `Documento_propostaRespPorId_fkey` FOREIGN KEY (`propostaRespPorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assinatura` ADD CONSTRAINT `Assinatura_assinadoPorId_fkey` FOREIGN KEY (`assinadoPorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
