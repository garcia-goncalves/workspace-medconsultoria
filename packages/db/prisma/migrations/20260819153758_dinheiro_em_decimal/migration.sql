-- AlterTable
ALTER TABLE `ClienteServico` MODIFY `valor` DECIMAL(12, 2) NULL,
    MODIFY `percentual` DECIMAL(12, 2) NULL;

-- AlterTable
ALTER TABLE `Lead` MODIFY `valorEstimado` DECIMAL(12, 2) NULL;

-- AlterTable
ALTER TABLE `Servico` MODIFY `valor` DECIMAL(12, 2) NULL,
    MODIFY `percentual` DECIMAL(12, 2) NULL;
