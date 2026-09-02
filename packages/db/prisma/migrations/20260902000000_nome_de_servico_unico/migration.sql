-- O NOME DO SERVIÇO PASSA A IDENTIFICAR O SERVIÇO.
--
-- Por que isto é regra e não capricho: a semeadura do catálogo casa por NOME
-- (`semearCatalogoSeFaltar`), o construtor da proposta lista os serviços lado a lado sem nada que
-- distinga dois iguais, e a ficha do cliente idem. Com duas linhas de mesmo nome ninguém sabe qual
-- levou o preço, as exigências e o roteiro do projeto — e o engano só aparece no papel que já foi
-- para o cliente. É o outro lado das ADR-144/145: lá o perigo era a REGRA casar por nome; aqui é o
-- nome deixar de identificar.
--
-- ⚠️ A GUARDA VEM ANTES DO ÍNDICE DE PROPÓSITO. Se produção tiver nome duplicado, o
-- `CREATE UNIQUE INDEX` falha sozinho — mas com erro cru do MySQL (1062, "Duplicate entry"), que
-- não diz o que fazer e chega no meio de uma publicação. A guarda para no mesmo lugar, com uma
-- condição que se lê: existe algum nome com mais de uma linha? Molde da `20260829210500`.
--
-- Conferido em produção em 01/09/2026, lendo Ajustes → Serviços como ROOT: são 10 serviços e os 10
-- nomes são diferentes. ⚠️ E a lista daquela tela INCLUI OS INATIVOS (`listServicos` não filtra
-- `ativo`), então não há serviço escondido — a ressalva antiga de que poderia haver um arquivado
-- fora da lista estava errada.
--
-- Banco novo (CI, instalação nova) passa direto: a tabela está vazia neste momento, o catálogo é
-- criado depois pela aplicação, e `semearCatalogoSeFaltar` já é idempotente por nome.
CREATE TABLE `_guarda_nome_de_servico_unico` (
  `ok` TINYINT NOT NULL,
  CONSTRAINT `nome_de_servico_duplicado_em_producao` CHECK (`ok` = 1)
);

INSERT INTO `_guarda_nome_de_servico_unico` (`ok`)
SELECT CASE
         WHEN EXISTS (
           SELECT 1 FROM `Servico` GROUP BY `nome` HAVING COUNT(*) > 1
         ) THEN 0
         ELSE 1
       END;

DROP TABLE `_guarda_nome_de_servico_unico`;

-- Reverter é `DROP INDEX \`Servico_nome_key\` ON \`Servico\`;` — nada é apagado nem convertido.
CREATE UNIQUE INDEX `Servico_nome_key` ON `Servico`(`nome`);
