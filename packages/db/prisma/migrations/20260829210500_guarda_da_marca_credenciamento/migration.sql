-- GUARDA DO BACKFILL DA MIGRAÇÃO ANTERIOR — para o silêncio não ser possível.
--
-- A `20260829203721` marca o serviço de credenciamento comparando o NOME com o canônico
-- (`LOWER(TRIM(nome))`). Se em produção esse nome divergir — typo, caixa diferente, espaço
-- não-ASCII colado de um documento, ou um renomear feito antes de a trava da ADR-140 existir —
-- o backfill casa ZERO linhas. E aí `ehCredenciamento` fica `false` para todo mundo, o que é
-- exatamente o lado perigoso: a conversão do lead volta a gerar conta a receber e a aprovação
-- da operadora gera a SEGUNDA pelo mesmo honorário (ADR-104/108).
--
-- ⚠️ ESSE ESTADO NÃO PRODUZ ERRO NENHUM. Não há log, não há tela, e o dinheiro sai errado em
-- silêncio. Por isso a conferência vira parte da migração: se existe no banco um serviço que se
-- parece com o credenciamento e NENHUM ficou marcado, a publicação PARA aqui, antes de o
-- servidor subir com a regra desligada.
--
-- Banco novo (CI, instalação nova) passa direto: o catálogo é criado sob demanda pela aplicação
-- (`seedIfEmpty`), que já nasce marcando a linha certa — não há nada a casar neste momento.
CREATE TABLE `_guarda_marca_credenciamento` (
  `ok` TINYINT NOT NULL,
  CONSTRAINT `marca_do_credenciamento_ausente` CHECK (`ok` = 1)
);

INSERT INTO `_guarda_marca_credenciamento` (`ok`)
SELECT CASE
         WHEN EXISTS (SELECT 1 FROM `Servico` WHERE `ehCredenciamento` = 1) THEN 1
         WHEN NOT EXISTS (SELECT 1 FROM `Servico` WHERE `nome` LIKE '%redenciament%') THEN 1
         ELSE 0
       END;

DROP TABLE `_guarda_marca_credenciamento`;
