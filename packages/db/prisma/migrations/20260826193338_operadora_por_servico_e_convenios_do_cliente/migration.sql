-- ADR-126 — a operadora vira UM cadastro só, com marcação por serviço; e os convênios
-- atendidos passam a ficar com o CLIENTE.
--
-- Puramente ADITIVA. Nada é apagado, nada é convertido, nenhuma linha existente muda de valor.
--
--  * `Operadora.usoCredenciamento` / `usoFaturamento` nascem `true`: toda operadora que já
--    existe entra marcada NAS DUAS listas. Sem isso, a primeira proposta de faturamento abriria
--    vazia e pareceria defeito.
--  * `_ClienteServicoOperadoras` é a tabela de ligação N-N entre o serviço contratado e os
--    convênios que o cliente atende naquele serviço. Nasce vazia.
--
-- Reverter em produção = apagar as duas colunas e a tabela de ligação.

-- AlterTable
ALTER TABLE `Operadora` ADD COLUMN `usoCredenciamento` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `usoFaturamento` BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE `_ClienteServicoOperadoras` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_ClienteServicoOperadoras_AB_unique`(`A`, `B`),
    INDEX `_ClienteServicoOperadoras_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `_ClienteServicoOperadoras` ADD CONSTRAINT `_ClienteServicoOperadoras_A_fkey` FOREIGN KEY (`A`) REFERENCES `ClienteServico`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ClienteServicoOperadoras` ADD CONSTRAINT `_ClienteServicoOperadoras_B_fkey` FOREIGN KEY (`B`) REFERENCES `Operadora`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
