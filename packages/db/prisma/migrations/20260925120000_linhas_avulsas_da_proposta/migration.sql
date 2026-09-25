-- LINHA AVULSA DA PROPOSTA PERSONALIZADA VIRA COBRANÇA NO ACEITE (Onda 4A).
--
-- Até aqui a linha avulsa ("Treinamento da recepção") existia só no texto do papel: o aceite não
-- a enxergava, e o que o cliente aceitou não virava conta a receber — alguém tinha de lembrar de
-- lançar à mão. Agora ela fica guardada estruturada no documento e, no aceite, vira UMA conta.
--
-- ADITIVA: três colunas NULAS e um índice único. Nenhuma linha existente muda de valor, nada é
-- apagado ou convertido, nenhum backfill (propostas antigas não têm linha avulsa estruturada — e
-- por isso não geram conta, como antes).
--
-- O índice único (origemDocumentoId, origemLinha) é a trava contra cobrar duas vezes: reenviar a
-- proposta para aceite reinicia a resposta, então a mesma linha pode ser aceita de novo. O MySQL
-- trata NULL como distinto em índice único, então as contas comuns ficam de fora dele.
--
-- REVERTER:
--   DROP INDEX `Conta_origemDocumentoId_origemLinha_key` ON `Conta`;
--   ALTER TABLE `Conta` DROP COLUMN `origemDocumentoId`, DROP COLUMN `origemLinha`;
--   ALTER TABLE `Documento` DROP COLUMN `linhasAvulsas`;

-- AlterTable
ALTER TABLE `Conta` ADD COLUMN `origemDocumentoId` VARCHAR(191) NULL,
    ADD COLUMN `origemLinha` INTEGER NULL;

-- AlterTable
ALTER TABLE `Documento` ADD COLUMN `linhasAvulsas` JSON NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Conta_origemDocumentoId_origemLinha_key` ON `Conta`(`origemDocumentoId`, `origemLinha`);
