-- CreateTable
CREATE TABLE `Tarefa` (
    `id` VARCHAR(191) NOT NULL,
    `titulo` VARCHAR(191) NOT NULL,
    `descricao` TEXT NULL,
    `criadoPorId` VARCHAR(191) NOT NULL,
    `responsavelId` VARCHAR(191) NOT NULL,
    `prazo` DATETIME(3) NULL,
    `prioridade` ENUM('BAIXA', 'NORMAL', 'ALTA') NOT NULL DEFAULT 'NORMAL',
    `status` ENUM('PENDENTE', 'FAZENDO', 'CONCLUIDA') NOT NULL DEFAULT 'PENDENTE',
    `clienteId` VARCHAR(191) NULL,
    `projetoId` VARCHAR(191) NULL,
    `concluidaEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Tarefa_responsavelId_status_idx`(`responsavelId`, `status`),
    INDEX `Tarefa_criadoPorId_status_idx`(`criadoPorId`, `status`),
    INDEX `Tarefa_clienteId_idx`(`clienteId`),
    INDEX `Tarefa_projetoId_idx`(`projetoId`),
    INDEX `Tarefa_prazo_idx`(`prazo`),
    INDEX `Tarefa_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Tarefa` ADD CONSTRAINT `Tarefa_criadoPorId_fkey` FOREIGN KEY (`criadoPorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tarefa` ADD CONSTRAINT `Tarefa_responsavelId_fkey` FOREIGN KEY (`responsavelId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tarefa` ADD CONSTRAINT `Tarefa_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tarefa` ADD CONSTRAINT `Tarefa_projetoId_fkey` FOREIGN KEY (`projetoId`) REFERENCES `Projeto`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
