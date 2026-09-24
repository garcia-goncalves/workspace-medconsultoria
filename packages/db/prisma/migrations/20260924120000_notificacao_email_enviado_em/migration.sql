-- Mensagem interna passou a notificar (sininho + e-mail) os outros participantes da conversa —
-- antes só emitia socket (que em produção nem existe: tempo real é polling). O sininho AGREGA
-- (atualiza a notificação não lida existente da conversa em vez de criar uma por mensagem), e o
-- e-mail tem anti-spam de 1 por conversa/destinatário a cada 30 min. Este campo é o relógio desse
-- anti-spam: guarda quando o e-mail da notificação (agregada) saiu pela última vez.
--
-- ADITIVA E ISOLADA: uma coluna nova, nula, em tabela existente. Nenhum backfill.
-- Reverter é uma linha: ALTER TABLE `Notificacao` DROP COLUMN `emailEnviadoEm`;

-- AlterTable
ALTER TABLE `Notificacao` ADD COLUMN `emailEnviadoEm` DATETIME(3) NULL;
