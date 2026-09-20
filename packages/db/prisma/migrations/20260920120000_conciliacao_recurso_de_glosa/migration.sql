-- Conciliação Fase 2c: o recurso de glosa — o que se faz DEPOIS de achar o problema.
-- Spec: docs/superpowers/specs/2026-09-20-conciliacao-fase-2c-recurso-de-glosa-design.md
--
-- ADITIVA E ISOLADA: UMA tabela nova. Nenhuma tabela existente muda, nenhuma coluna é acrescentada
-- a nada que já exista, nenhum backfill. Reverter é uma linha:
--   DROP TABLE `RecursoDeGlosa`;
--
-- ⚠️ A tabela NÃO guarda dinheiro, de propósito. Quando a operadora acata, o valor entra num
-- repasse futuro, sobe o `recebido` e faz a glosa se recalcular sozinha — um campo de valor aqui
-- seria uma segunda fonte do mesmo número. Aqui mora o PROCESSO: quando, por onde, protocolo,
-- desfecho.

-- CreateTable
CREATE TABLE `RecursoDeGlosa` (
    `id` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `cirurgiaId` VARCHAR(191) NOT NULL,
    `tentativa` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('ABERTO', 'ACATADO', 'NEGADO', 'ENCERRADO') NOT NULL DEFAULT 'ABERTO',
    `canal` VARCHAR(60) NULL,
    `protocolo` VARCHAR(60) NULL,
    `abertoEm` DATE NOT NULL,
    `respondidoEm` DATE NULL,
    `motivoDaGlosa` TEXT NULL,
    `observacao` TEXT NULL,
    `criadoPorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RecursoDeGlosa_clienteId_status_idx`(`clienteId`, `status`),
    INDEX `RecursoDeGlosa_criadoPorId_idx`(`criadoPorId`),
    UNIQUE INDEX `RecursoDeGlosa_cirurgiaId_tentativa_key`(`cirurgiaId`, `tentativa`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RecursoDeGlosa` ADD CONSTRAINT `RecursoDeGlosa_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecursoDeGlosa` ADD CONSTRAINT `RecursoDeGlosa_cirurgiaId_fkey` FOREIGN KEY (`cirurgiaId`) REFERENCES `ProducaoCirurgia`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecursoDeGlosa` ADD CONSTRAINT `RecursoDeGlosa_criadoPorId_fkey` FOREIGN KEY (`criadoPorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

