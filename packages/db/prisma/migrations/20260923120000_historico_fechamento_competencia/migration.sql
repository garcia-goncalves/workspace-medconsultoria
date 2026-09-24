-- Conciliação: o HISTÓRICO do fechamento de competência (fechou / reabriu, quem e quando).
-- Spec: docs/superpowers/specs/2026-09-20-conciliacao-fechamento-de-competencia-design.md
--
-- O defeito: `CompetenciaFechada` é uma linha por cliente+mês. Reabrir tirava o mês da tela e
-- não sobrava nada visível dizendo quem tinha conferido; fechar de novo escrevia por cima do
-- fechamento anterior. `CompetenciaFechada` continua sendo o ESTADO (a trava de edição lê dela);
-- esta tabela nova é o registro, APPEND-ONLY, de cada fechar e cada reabrir.
--
-- ADITIVA E ISOLADA: UMA tabela nova. Nenhuma tabela existente muda.
-- Reverter é uma linha:  DROP TABLE `CompetenciaFechamentoEvento`;
--
-- ⚠️ O backfill só recupera o que o estado ainda sabe: o ÚLTIMO fechamento de cada mês (e a
-- reabertura dele, se houver). Fechamentos anteriores que foram escritos por cima já se perderam
-- — é exatamente o defeito que esta tabela fecha daqui para a frente.

-- CreateTable
CREATE TABLE `CompetenciaFechamentoEvento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clienteId` VARCHAR(191) NOT NULL,
    `competencia` CHAR(7) NOT NULL,
    `tipo` ENUM('FECHOU', 'REABRIU') NOT NULL,
    `em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `porId` VARCHAR(191) NULL,
    `porNome` VARCHAR(191) NULL,
    `observacao` TEXT NULL,
    `cobrado` DECIMAL(12, 2) NULL,
    `recebido` DECIMAL(12, 2) NULL,
    `glosa` DECIMAL(12, 2) NULL,
    `aReceber` DECIMAL(12, 2) NULL,
    `cirurgias` INTEGER NULL,

    INDEX `CompetenciaFechamentoEvento_clienteId_competencia_idx`(`clienteId`, `competencia`),
    INDEX `CompetenciaFechamentoEvento_porId_idx`(`porId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CompetenciaFechamentoEvento` ADD CONSTRAINT `CompetenciaFechamentoEvento_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompetenciaFechamentoEvento` ADD CONSTRAINT `CompetenciaFechamentoEvento_porId_fkey` FOREIGN KEY (`porId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill 1/2: o fechamento vigente (ou o último, se reaberto) de cada mês.
INSERT INTO `CompetenciaFechamentoEvento`
    (`clienteId`, `competencia`, `tipo`, `em`, `porId`, `porNome`, `observacao`, `cobrado`, `recebido`, `glosa`, `aReceber`, `cirurgias`)
SELECT f.`clienteId`, f.`competencia`, 'FECHOU', f.`fechadoEm`, u.`id`, u.`nome`, f.`observacao`,
       f.`cobrado`, f.`recebido`, f.`glosa`, f.`aReceber`, f.`cirurgias`
FROM `CompetenciaFechada` f
LEFT JOIN `User` u ON u.`id` = f.`fechadoPorId`
ORDER BY f.`fechadoEm`, f.`id`;

-- Backfill 2/2: a reabertura, quando houver. Vem DEPOIS do 1/2 para que, dentro de um mesmo mês,
-- o `id` (a ordem do histórico) ponha o FECHOU antes do REABRIU.
-- ⚠️ `reabertoPorId` não tem chave estrangeira na tabela antiga: o LEFT JOIN transforma um id
-- órfão em nulo, senão a FK nova recusaria o INSERT e travaria a publicação.
INSERT INTO `CompetenciaFechamentoEvento`
    (`clienteId`, `competencia`, `tipo`, `em`, `porId`, `porNome`)
SELECT f.`clienteId`, f.`competencia`, 'REABRIU', f.`reabertoEm`, u.`id`, u.`nome`
FROM `CompetenciaFechada` f
LEFT JOIN `User` u ON u.`id` = f.`reabertoPorId`
WHERE f.`reabertoEm` IS NOT NULL
ORDER BY f.`reabertoEm`, f.`id`;
