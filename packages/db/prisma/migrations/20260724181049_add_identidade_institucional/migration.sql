-- CreateTable
CREATE TABLE `IdentidadeInstitucional` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `nome` VARCHAR(191) NOT NULL,
    `tagline` VARCHAR(191) NOT NULL,
    `site` VARCHAR(191) NOT NULL,
    `siteUrl` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `telefone` VARCHAR(191) NOT NULL,
    `cidade` VARCHAR(191) NOT NULL,
    `instagram` VARCHAR(191) NOT NULL,
    `instagramUrl` VARCHAR(191) NOT NULL,
    `razaoSocial` TEXT NULL,
    `cnpj` VARCHAR(191) NULL,
    `enderecoCompleto` TEXT NULL,
    `foro` TEXT NULL,
    `atualizadoEm` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
