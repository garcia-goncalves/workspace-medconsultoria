-- AlterTable
ALTER TABLE `User` ADD COLUMN `convidadoPorId` VARCHAR(191) NULL,
    ADD COLUMN `papelPortal` ENUM('RESPONSAVEL', 'EQUIPE') NULL;

-- CreateIndex
CREATE INDEX `User_convidadoPorId_idx` ON `User`(`convidadoPorId`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_convidadoPorId_fkey` FOREIGN KEY (`convidadoPorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- QUEM JA TEM ACESSO AO PORTAL HOJE VIRA RESPONSAVEL, EXPLICITAMENTE.
--
-- Ate aqui cada clinica tinha UMA conta de Portal, e essa conta sempre pode tudo. `podeNoPortal`
-- ja trata nulo como RESPONSAVEL, entao esta linha nao muda comportamento nenhum -- ela existe
-- para a TELA nao ficar muda: sem marcar, o novo card "Pessoas com acesso" mostraria a coluna
-- Papel em branco justamente para quem manda na clinica.
--
-- So toca conta de Portal (`role = 'CLIENTE'`). Conta interna da Med continua com o campo nulo,
-- que e o que ele significa la: "isto nao e uma pessoa de clinica".
-- Reverter e `ALTER TABLE User DROP COLUMN papelPortal, DROP COLUMN convidadoPorId` (a FK e o
-- indice caem junto): nada foi apagado e nenhuma linha existente mudou de sentido.
UPDATE `User` SET `papelPortal` = 'RESPONSAVEL' WHERE `role` = 'CLIENTE';
