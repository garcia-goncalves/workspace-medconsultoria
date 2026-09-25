-- Onda 2: o honorário do Faturamento, calculado do repasse importado na Conciliação.
--
-- O serviço de Faturamento é cobrado SÓ por percentual mensal do que a clínica RECEBE dos
-- convênios, e até aqui nenhuma conta a receber nascia para ele: não havia número a lançar. A
-- Conciliação passou a saber quanto cada clínica recebeu (RepasseLinha.valor + dataPagamento), e
-- lançar o honorário de um mês cria a conta a receber E grava este retrato, na mesma transação.
--
-- ADITIVA E ISOLADA: UMA tabela nova. Nenhuma tabela existente muda, nenhum backfill.
-- Reverter é uma linha:  DROP TABLE `HonorarioFaturamento`;
-- (as contas a receber já criadas ficam no Financeiro, como qualquer outra — só perdem o elo.)
--
-- ⚠️ As colunas de dinheiro NÃO são fonte de verdade do valor de hoje: o honorário corrente é
-- sempre recalculado do repasse. Estas guardam o que foi LANÇADO, para a tela poder mostrar a
-- divergência ("lançado sobre R$ X; hoje o repasse do mês soma R$ Y").
--
-- ⚠️ O índice único (clienteId, mes) é a trava contra lançar o mesmo mês duas vezes.

-- CreateTable
CREATE TABLE `HonorarioFaturamento` (
    `id` VARCHAR(191) NOT NULL,
    `clienteId` VARCHAR(191) NOT NULL,
    `mes` CHAR(7) NOT NULL,
    `base` DECIMAL(12, 2) NOT NULL,
    `percentual` DECIMAL(12, 2) NOT NULL,
    `valor` DECIMAL(12, 2) NOT NULL,
    `contaId` VARCHAR(191) NULL,
    `lancadoPorId` VARCHAR(191) NULL,
    `lancadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `atualizadoEm` DATETIME(3) NULL,
    `observacao` TEXT NULL,

    INDEX `HonorarioFaturamento_contaId_idx`(`contaId`),
    INDEX `HonorarioFaturamento_lancadoPorId_idx`(`lancadoPorId`),
    UNIQUE INDEX `HonorarioFaturamento_clienteId_mes_key`(`clienteId`, `mes`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `HonorarioFaturamento` ADD CONSTRAINT `HonorarioFaturamento_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Cliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HonorarioFaturamento` ADD CONSTRAINT `HonorarioFaturamento_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Conta`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HonorarioFaturamento` ADD CONSTRAINT `HonorarioFaturamento_lancadoPorId_fkey` FOREIGN KEY (`lancadoPorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
