-- A API DO AGENTE (ADR-149): identidade de SERVICO e DELEGACAO revogavel do usuario.
--
-- Duas tabelas NOVAS. Nenhuma tabela existente e alterada, nenhuma linha e apagada ou
-- convertida, nao ha backfill. Sem estas tabelas povoadas a API do agente simplesmente nao
-- autentica ninguem -- ela nasce fechada.
--
-- POR QUE DUAS TABELAS E NAO UMA: `AgentClient` responde "que PROGRAMA esta chamando";
-- `AgentDelegation` responde "em nome de QUE PESSOA". Juntar as duas faria o segredo do
-- servico virar, sozinho, acesso ao dado de gente -- que e exatamente o que a secao 6 do
-- briefing da Cora proibe ("separar identidade do servico da identidade do usuario").
--
-- POR QUE SO O HASH: nem o segredo do servico nem o token de delegacao sao guardados. O valor
-- bruto existe uma unica vez, na saida do comando que o emitiu. Vazamento do banco nao entrega
-- credencial utilizavel.
--
-- REVERTER SAO DUAS LINHAS (nesta ordem, por causa da chave estrangeira):
--   DROP TABLE `AgentDelegation`;
--   DROP TABLE `AgentClient`;

CREATE TABLE `AgentClient` (
    `id` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `segredoHash` VARCHAR(191) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `revogadoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AgentClient_nome_key`(`nome`),
    UNIQUE INDEX `AgentClient_segredoHash_key`(`segredoHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AgentDelegation` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `escopos` TEXT NOT NULL,
    `expiraEm` DATETIME(3) NOT NULL,
    `revogadaEm` DATETIME(3) NULL,
    `criadaPorId` VARCHAR(191) NULL,
    `ultimoUsoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AgentDelegation_tokenHash_key`(`tokenHash`),
    INDEX `AgentDelegation_userId_idx`(`userId`),
    INDEX `AgentDelegation_clientId_idx`(`clientId`),
    INDEX `AgentDelegation_expiraEm_idx`(`expiraEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AgentDelegation` ADD CONSTRAINT `AgentDelegation_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `AgentClient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AgentDelegation` ADD CONSTRAINT `AgentDelegation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AgentDelegation` ADD CONSTRAINT `AgentDelegation_criadaPorId_fkey` FOREIGN KEY (`criadaPorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
