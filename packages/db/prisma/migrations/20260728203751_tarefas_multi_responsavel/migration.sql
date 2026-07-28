/*
  Warnings:

  - You are about to drop the column `responsavelId` on the `Tarefa` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE `Tarefa` DROP FOREIGN KEY `Tarefa_responsavelId_fkey`;

-- DropIndex
DROP INDEX `Tarefa_responsavelId_status_idx` ON `Tarefa`;

-- AlterTable
ALTER TABLE `Tarefa` DROP COLUMN `responsavelId`;

-- CreateTable
CREATE TABLE `TarefaResponsavel` (
    `id` VARCHAR(191) NOT NULL,
    `tarefaId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `TarefaResponsavel_userId_idx`(`userId`),
    UNIQUE INDEX `TarefaResponsavel_tarefaId_userId_key`(`tarefaId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TarefaResponsavel` ADD CONSTRAINT `TarefaResponsavel_tarefaId_fkey` FOREIGN KEY (`tarefaId`) REFERENCES `Tarefa`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TarefaResponsavel` ADD CONSTRAINT `TarefaResponsavel_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
