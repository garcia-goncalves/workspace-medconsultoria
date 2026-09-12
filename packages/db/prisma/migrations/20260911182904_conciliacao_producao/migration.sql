-- CreateTable
CREATE TABLE `ProducaoLote` (
    `id` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `competencia` CHAR(7) NOT NULL,
    `origem` ENUM('CONSULTAS_NUVENS') NOT NULL DEFAULT 'CONSULTAS_NUVENS',
    `arquivoId` VARCHAR(191) NULL,
    `nomeArquivo` VARCHAR(191) NOT NULL,
    `formato` VARCHAR(191) NOT NULL,
    `hashArquivo` CHAR(64) NOT NULL,
    `status` ENUM('PROCESSANDO', 'IMPORTADO', 'FALHOU', 'SUBSTITUIDO') NOT NULL DEFAULT 'PROCESSANDO',
    `erro` TEXT NULL,
    `linhasLidas` INTEGER NOT NULL DEFAULT 0,
    `linhasImportadas` INTEGER NOT NULL DEFAULT 0,
    `linhasIgnoradas` INTEGER NOT NULL DEFAULT 0,
    `competenciaVigente` CHAR(7) NULL,
    `importadoPorId` VARCHAR(191) NULL,
    `substituidoPorId` VARCHAR(191) NULL,
    `substituidoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProducaoLote_clienteId_competencia_idx`(`clienteId`, `competencia`),
    INDEX `ProducaoLote_clienteId_origem_hashArquivo_idx`(`clienteId`, `origem`, `hashArquivo`),
    INDEX `ProducaoLote_arquivoId_idx`(`arquivoId`),
    INDEX `ProducaoLote_importadoPorId_idx`(`importadoPorId`),
    INDEX `ProducaoLote_substituidoPorId_idx`(`substituidoPorId`),
    INDEX `ProducaoLote_status_idx`(`status`),
    UNIQUE INDEX `ProducaoLote_clienteId_origem_competenciaVigente_key`(`clienteId`, `origem`, `competenciaVigente`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProducaoConsulta` (
    `id` VARCHAR(191) NOT NULL,
    `loteId` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `competencia` CHAR(7) NOT NULL,
    `linha` INTEGER NOT NULL,
    `dataAgenda` DATE NULL,
    `dataAtendimento` DATE NOT NULL,
    `pacienteNome` VARCHAR(191) NOT NULL,
    `pacienteCpfCifrado` TEXT NULL,
    `pacienteCpfApelido` CHAR(64) NULL,
    `pacienteTelefoneCifrado` TEXT NULL,
    `pacienteEmailCifrado` TEXT NULL,
    `tipoAtendimento` ENUM('CONSULTA', 'CORTESIA', 'SEM_VINCULO_AGENDA', 'OUTRO') NOT NULL,
    `tipoAtendimentoBruto` VARCHAR(191) NOT NULL,
    `convenioBruto` VARCHAR(191) NOT NULL,
    `operadoraId` VARCHAR(191) NULL,
    `plano` VARCHAR(191) NULL,
    `profissionalBruto` VARCHAR(191) NOT NULL,
    `profissionalId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProducaoConsulta_clienteId_competencia_idx`(`clienteId`, `competencia`),
    INDEX `ProducaoConsulta_loteId_idx`(`loteId`),
    INDEX `ProducaoConsulta_operadoraId_idx`(`operadoraId`),
    INDEX `ProducaoConsulta_profissionalId_idx`(`profissionalId`),
    INDEX `ProducaoConsulta_pacienteCpfApelido_idx`(`pacienteCpfApelido`),
    INDEX `ProducaoConsulta_dataAtendimento_idx`(`dataAtendimento`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MapeamentoConvenio` (
    `id` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `textoBruto` VARCHAR(191) NOT NULL,
    `textoNormalizado` VARCHAR(191) NOT NULL,
    `operadoraId` VARCHAR(191) NULL,
    `plano` VARCHAR(191) NULL,
    `particular` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MapeamentoConvenio_operadoraId_idx`(`operadoraId`),
    UNIQUE INDEX `MapeamentoConvenio_clienteId_textoNormalizado_key`(`clienteId`, `textoNormalizado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MapeamentoProfissional` (
    `id` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `textoBruto` VARCHAR(191) NOT NULL,
    `textoNormalizado` VARCHAR(191) NOT NULL,
    `profissionalId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MapeamentoProfissional_profissionalId_idx`(`profissionalId`),
    UNIQUE INDEX `MapeamentoProfissional_clienteId_textoNormalizado_key`(`clienteId`, `textoNormalizado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProducaoLote` ADD CONSTRAINT `ProducaoLote_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProducaoLote` ADD CONSTRAINT `ProducaoLote_arquivoId_fkey` FOREIGN KEY (`arquivoId`) REFERENCES `Arquivo`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProducaoLote` ADD CONSTRAINT `ProducaoLote_importadoPorId_fkey` FOREIGN KEY (`importadoPorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProducaoLote` ADD CONSTRAINT `ProducaoLote_substituidoPorId_fkey` FOREIGN KEY (`substituidoPorId`) REFERENCES `ProducaoLote`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProducaoConsulta` ADD CONSTRAINT `ProducaoConsulta_loteId_fkey` FOREIGN KEY (`loteId`) REFERENCES `ProducaoLote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProducaoConsulta` ADD CONSTRAINT `ProducaoConsulta_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProducaoConsulta` ADD CONSTRAINT `ProducaoConsulta_operadoraId_fkey` FOREIGN KEY (`operadoraId`) REFERENCES `Operadora`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProducaoConsulta` ADD CONSTRAINT `ProducaoConsulta_profissionalId_fkey` FOREIGN KEY (`profissionalId`) REFERENCES `Profissional`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MapeamentoConvenio` ADD CONSTRAINT `MapeamentoConvenio_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MapeamentoConvenio` ADD CONSTRAINT `MapeamentoConvenio_operadoraId_fkey` FOREIGN KEY (`operadoraId`) REFERENCES `Operadora`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MapeamentoProfissional` ADD CONSTRAINT `MapeamentoProfissional_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MapeamentoProfissional` ADD CONSTRAINT `MapeamentoProfissional_profissionalId_fkey` FOREIGN KEY (`profissionalId`) REFERENCES `Profissional`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

