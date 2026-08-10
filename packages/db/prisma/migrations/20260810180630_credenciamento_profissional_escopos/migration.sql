-- AlterTable
ALTER TABLE `Arquivo` ADD COLUMN `lado` VARCHAR(191) NULL,
    ADD COLUMN `profissionalId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `ServicoRequisito` ADD COLUMN `escopo` VARCHAR(191) NULL,
    ADD COLUMN `frenteVerso` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `travaElegibilidade` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Profissional` (
    `id` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `conselho` VARCHAR(191) NOT NULL,
    `conselhoNumero` VARCHAR(191) NULL,
    `conselhoUf` VARCHAR(2) NULL,
    `especialidade` VARCHAR(191) NULL,
    `anoFormatura` INTEGER NULL,
    `tituloEspecialista` BOOLEAN NOT NULL DEFAULT false,
    `responsavelTecnico` BOOLEAN NOT NULL DEFAULT false,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Profissional_clienteId_idx`(`clienteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Arquivo_profissionalId_idx` ON `Arquivo`(`profissionalId`);

-- AddForeignKey
ALTER TABLE `Arquivo` ADD CONSTRAINT `Arquivo_profissionalId_fkey` FOREIGN KEY (`profissionalId`) REFERENCES `Profissional`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Profissional` ADD CONSTRAINT `Profissional_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
