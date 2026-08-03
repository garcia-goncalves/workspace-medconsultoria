-- CreateTable
CREATE TABLE `CaixaEmail` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `rotulo` VARCHAR(191) NULL,
    `nomeExibicao` VARCHAR(191) NOT NULL,
    `assinatura` TEXT NULL,
    `imapHost` VARCHAR(191) NOT NULL,
    `imapPorta` INTEGER NOT NULL DEFAULT 993,
    `smtpHost` VARCHAR(191) NOT NULL,
    `smtpPorta` INTEGER NOT NULL DEFAULT 465,
    `usuario` VARCHAR(191) NOT NULL,
    `segredo` TEXT NOT NULL,
    `padrao` BOOLEAN NOT NULL DEFAULT false,
    `ativa` BOOLEAN NOT NULL DEFAULT true,
    `estado` ENUM('OK', 'AUTENTICACAO_FALHOU', 'ERRO') NOT NULL DEFAULT 'OK',
    `ultimoErro` TEXT NULL,
    `ultimaSyncEm` DATETIME(3) NULL,
    `importarDesde` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    INDEX `CaixaEmail_userId_ativa_idx`(`userId`, `ativa`),
    UNIQUE INDEX `CaixaEmail_userId_email_key`(`userId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CaixaPasta` (
    `id` VARCHAR(191) NOT NULL,
    `caixaId` VARCHAR(191) NOT NULL,
    `caminho` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `papel` ENUM('INBOX', 'SENT', 'DRAFTS', 'TRASH', 'JUNK', 'ARCHIVE') NULL,
    `uidValidity` BIGINT NOT NULL DEFAULT 0,
    `ultimoUid` BIGINT NOT NULL DEFAULT 0,
    `highestModseq` BIGINT NOT NULL DEFAULT 0,
    `naoLidos` INTEGER NOT NULL DEFAULT 0,
    `total` INTEGER NOT NULL DEFAULT 0,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `sincronizando` DATETIME(3) NULL,

    INDEX `CaixaPasta_caixaId_ordem_idx`(`caixaId`, `ordem`),
    UNIQUE INDEX `CaixaPasta_caixaId_caminho_key`(`caixaId`, `caminho`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailMensagem` (
    `id` VARCHAR(191) NOT NULL,
    `caixaId` VARCHAR(191) NOT NULL,
    `pastaId` VARCHAR(191) NOT NULL,
    `uid` BIGINT NOT NULL,
    `messageId` VARCHAR(512) NULL,
    `inReplyTo` VARCHAR(512) NULL,
    `referencias` TEXT NULL,
    `threadKey` VARCHAR(512) NULL,
    `deNome` VARCHAR(191) NULL,
    `deEmail` VARCHAR(191) NOT NULL,
    `assunto` TEXT NULL,
    `trecho` TEXT NULL,
    `dataEm` DATETIME(3) NOT NULL,
    `lido` BOOLEAN NOT NULL DEFAULT false,
    `respondido` BOOLEAN NOT NULL DEFAULT false,
    `temAnexo` BOOLEAN NOT NULL DEFAULT false,
    `tamanho` INTEGER NULL,
    `corpoHtml` LONGTEXT NULL,
    `corpoTexto` LONGTEXT NULL,
    `corpoEm` DATETIME(3) NULL,
    `particular` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmailMensagem_caixaId_dataEm_idx`(`caixaId`, `dataEm`),
    INDEX `EmailMensagem_threadKey_idx`(`threadKey`),
    UNIQUE INDEX `EmailMensagem_pastaId_uid_key`(`pastaId`, `uid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailEndereco` (
    `id` VARCHAR(191) NOT NULL,
    `mensagemId` VARCHAR(191) NOT NULL,
    `papel` ENUM('DE', 'PARA', 'CC', 'CCO', 'RESPONDER_A') NOT NULL,
    `nome` VARCHAR(191) NULL,
    `endereco` VARCHAR(191) NOT NULL,

    INDEX `EmailEndereco_endereco_idx`(`endereco`),
    INDEX `EmailEndereco_mensagemId_idx`(`mensagemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailAnexo` (
    `id` VARCHAR(191) NOT NULL,
    `mensagemId` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `tamanho` INTEGER NOT NULL,
    `parte` VARCHAR(191) NOT NULL,
    `cid` VARCHAR(191) NULL,
    `arquivoId` VARCHAR(191) NULL,

    INDEX `EmailAnexo_mensagemId_idx`(`mensagemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CaixaEmail` ADD CONSTRAINT `CaixaEmail_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CaixaPasta` ADD CONSTRAINT `CaixaPasta_caixaId_fkey` FOREIGN KEY (`caixaId`) REFERENCES `CaixaEmail`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailMensagem` ADD CONSTRAINT `EmailMensagem_pastaId_fkey` FOREIGN KEY (`pastaId`) REFERENCES `CaixaPasta`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailEndereco` ADD CONSTRAINT `EmailEndereco_mensagemId_fkey` FOREIGN KEY (`mensagemId`) REFERENCES `EmailMensagem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailAnexo` ADD CONSTRAINT `EmailAnexo_mensagemId_fkey` FOREIGN KEY (`mensagemId`) REFERENCES `EmailMensagem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
