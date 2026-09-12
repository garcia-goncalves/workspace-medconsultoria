-- SESSÃO DE SUPORTE e ÚLTIMO ACESSO (ADR-128).
--
-- Três colunas NOVAS e NULÁVEIS, mais uma chave estrangeira e um índice. Nada é apagado, nada é
-- convertido, nenhuma linha existente muda de valor: toda sessão que já existe continua sendo
-- uma sessão normal (`operadorId` nulo), e todo usuário continua sem data de último acesso até
-- entrar pela primeira vez depois desta mudança.
--
-- Reverter = derrubar a FK, o índice e as três colunas.
--
-- `Session.operadorId` guarda QUEM DA EQUIPE abriu a sessão para ver o Portal de um cliente. O
-- `userId` continua sendo o dono do Portal, então o isolamento do `portalProcedure` (que filtra
-- tudo por `clienteId` da sessão) não muda uma linha — o que muda é o histórico saber dizer
-- "Thaís, vendo como Clínica X" em vez de culpar o cliente pelo que a equipe fizer lá dentro.
--
-- `ON DELETE SET NULL` de propósito: apagar quem deu suporte não pode apagar a sessão nem sumir
-- com o rastro do acesso. Rastro de acesso a dado pessoal não se apaga por efeito colateral.
ALTER TABLE `Session`
  ADD COLUMN `operadorId` VARCHAR(191) NULL,
  ADD COLUMN `voltarParaSessionId` VARCHAR(191) NULL;

CREATE INDEX `Session_operadorId_idx` ON `Session`(`operadorId`);

ALTER TABLE `Session`
  ADD CONSTRAINT `Session_operadorId_fkey`
  FOREIGN KEY (`operadorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Última vez que a pessoa entrou DE VERDADE (login com senha). Nulo = nunca entrou.
-- ⚠️ Sessão de suporte da equipe NÃO atualiza este campo: ele responde "o CLIENTE veio?", e nós
-- entrarmos no painel dele não é o cliente vindo.
ALTER TABLE `User`
  ADD COLUMN `ultimoAcessoEm` DATETIME(3) NULL;
