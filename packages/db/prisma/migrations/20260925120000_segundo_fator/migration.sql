-- Onda 4C: VERIFICACAO EM DUAS ETAPAS (TOTP) para ADMIN e ROOT.
--
-- Sem isto, uma senha roubada de ADMIN/ROOT dava acesso total por 30 dias (a vida do cookie de
-- sessao). Com isto, o login com senha certa de quem ativou o 2FA so devolve um desafio de 5 min;
-- a sessao nasce depois do codigo do aplicativo autenticador (ou de um codigo de recuperacao).
--
-- ADITIVA E ISOLADA: DUAS tabelas novas. Nenhuma tabela existente muda, nenhum backfill. Sem
-- linha em `SegundoFator`, o login continua exatamente como antes -- ninguem e obrigado a nada.
--
-- POR QUE O SEGREDO E CIFRADO E OS CODIGOS SAO HASH: o segredo TOTP precisa ser LIDO de volta
-- para conferir o codigo, entao e cifrado (AES-256-GCM, TOTP_CRYPTO_KEY). O codigo de
-- recuperacao so precisa ser CONFERIDO, entao so o SHA-256 dele e guardado -- e nao depende da
-- chave: se ela sumir do servidor, o codigo de recuperacao continua abrindo a porta.
--
-- POR QUE `COLLATE utf8mb4_bin` NO HASH: a colacao da casa ignora maiuscula e acento (ADR-147).
--
-- REVERTER SAO DUAS LINHAS (quem tinha 2FA volta a entrar so com a senha):
--   DROP TABLE `CodigoRecuperacao`;
--   DROP TABLE `SegundoFator`;

CREATE TABLE `SegundoFator` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `segredoCifrado` TEXT NOT NULL,
    `ativadoEm` DATETIME(3) NULL,
    `ultimoPasso` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SegundoFator_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CodigoRecuperacao` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
    `usadoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CodigoRecuperacao_userId_hash_key`(`userId`, `hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SegundoFator` ADD CONSTRAINT `SegundoFator_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CodigoRecuperacao` ADD CONSTRAINT `CodigoRecuperacao_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
