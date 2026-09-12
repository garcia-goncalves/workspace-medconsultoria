-- A CONTA PASSA A SABER DE QUE SERVICO ELA VEIO.
--
-- A conferencia que impede cobrar duas vezes o mesmo servico (`provisionarUpsellAceito`)
-- casava por TEXTO da descricao: "<Servico> -- <Cliente>". Renomear o cliente na ficha muda a
-- descricao das cobrancas seguintes; a conferencia deixa de casar com as antigas; e aceitar
-- uma segunda proposta que repita o servico lanca a cobranca DE NOVO. Em silencio, porque duas
-- contas a receber com descricoes diferentes nao parecem duplicata para ninguem.
--
-- MIGRACAO ADITIVA: uma coluna nulavel e um indice. Nada e apagado, nada e convertido, nenhuma
-- linha existente muda de valor.
--
-- SEM BACKFILL, DE PROPOSITO. Deduzir o servico das contas antigas exigiria interpretar o texto
-- da descricao -- exatamente a fragilidade que esta coluna existe para substituir, e um palpite
-- errado aqui apagaria ou duplicaria cobranca. As contas antigas seguem sendo conferidas pela
-- descricao, que e como sempre funcionou para elas; as novas passam a ser conferidas pelo id.
-- A conferencia olha as DUAS coisas, entao nao ha janela sem protecao.
--
-- REVERTER E DUAS LINHAS:
--   DROP INDEX `Conta_clienteId_origemServicoId_idx` ON `Conta`;
--   ALTER TABLE `Conta` DROP COLUMN `origemServicoId`;

ALTER TABLE `Conta` ADD COLUMN `origemServicoId` VARCHAR(191) NULL;
CREATE INDEX `Conta_clienteId_origemServicoId_idx` ON `Conta`(`clienteId`, `origemServicoId`);
