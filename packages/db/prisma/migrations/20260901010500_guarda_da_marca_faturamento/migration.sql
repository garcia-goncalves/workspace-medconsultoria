-- GUARDA DO BACKFILL DA MIGRAÇÃO ANTERIOR — mesmo molde da `20260829210500` (ADR-144).
--
-- A `20260901010000` marca por PREÇO: `percentual > 0 AND (valor IS NULL OR valor = 0)`. Isso
-- acerta o catálogo de produção de hoje (dez serviços, só o "Faturamento" percentual e sem
-- valor), mas há dois desfechos errados possíveis, e NENHUM DOS DOIS produz erro, log ou
-- sintoma na tela:
--
--   ZERO MARCADOS — o serviço de faturamento estiver com o percentual em branco ("a combinar")
--   ou com algum valor gravado. Aí nenhum serviço pode mais receber percentual: o construtor da
--   proposta de faturamento abre vazio, e o editor de preço passa a recusar salvar o serviço
--   que hoje fatura. Pior, se alguém o tiver renomeado, a semeadura do catálogo cria um CLONE
--   "Faturamento" marcado (a mesma armadilha que a ADR-144 pagou para aprender).
--
--   DOIS OU MAIS MARCADOS — houver outro serviço só-percentual no catálogo. Nasce direto do
--   backfill o estado que a ordem do dono proíbe (dois serviços percentuais), e NENHUMA trava o
--   corrige depois: a guarda da marca única só roda na transição desmarcado→marcado, então
--   editar qualquer um dos dois passa batido para sempre.
--
-- ⚠️ Por isso a conferência é parte da migração: havendo serviço percentual no banco, exige-se
-- EXATAMENTE UM marcado, e a publicação PARA aqui — antes de o servidor subir com a regra
-- errada — em vez de deixar o preço sair errado em silêncio.
--
-- Banco novo (CI, instalação nova) passa direto: o catálogo é criado sob demanda pela aplicação
-- (`seedIfEmpty`), que já nasce marcando a linha certa. Não há nada a casar neste momento.
CREATE TABLE `_guarda_marca_faturamento` (
  `ok` TINYINT NOT NULL,
  CONSTRAINT `marca_do_faturamento_incorreta` CHECK (`ok` = 1)
);

INSERT INTO `_guarda_marca_faturamento` (`ok`)
SELECT CASE
         -- Catálogo sem nenhum serviço percentual: não há o que marcar. Passa.
         WHEN NOT EXISTS (
           SELECT 1 FROM `Servico` WHERE `percentual` IS NOT NULL AND `percentual` > 0
         ) AND (SELECT COUNT(*) FROM `Servico` WHERE `ehFaturamento` = 1) <= 1 THEN 1
         -- Havendo serviço percentual, tem de haver exatamente UM marcado.
         WHEN (SELECT COUNT(*) FROM `Servico` WHERE `ehFaturamento` = 1) = 1 THEN 1
         ELSE 0
       END;

DROP TABLE `_guarda_marca_faturamento`;
