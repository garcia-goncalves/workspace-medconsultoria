-- ADR-126 — some a pergunta que virou campo.
--
-- A exigencia "Quais operadoras voce atende?" do servico de Faturamento pedia, em texto livre,
-- exatamente a lista que a ADR-126 tornou um campo estruturado (os convenios do cliente). No
-- Portal o cliente via a MESMA pergunta duas vezes, uma delas obrigatoria.
--
-- Precisa ser migracao, e nao so tirar da semente: `seedRequisitosSeVazio` so semeia quando a
-- tabela esta VAZIA, entao apagar a linha da semente nao removeria nada de um banco que ja roda.
--
-- ⚠️ A GUARDA E O QUE IMPORTA: so apaga se NINGUEM tiver respondido. Apagar exigencia respondida
-- levaria junto o trabalho do cliente. Onde houver resposta, a exigencia FICA — a duplicidade e
-- menos grave que a perda, e a Thais decide caso a caso na tela de Servicos.
--
-- O `Formulario` interno NAO e apagado de proposito: `FormularioResposta.formularioId` e Cascade,
-- entao apagar o formulario apagaria as respostas. Um formulario interno orfao nao aparece em
-- tela nenhuma e nao custa nada.
--
-- Reverter = recadastrar a exigencia em Servicos → Faturamento → Exigencias.

DELETE r FROM `ServicoRequisito` r
WHERE r.titulo = 'Quais operadoras você atende?'
  AND NOT EXISTS (
    SELECT 1 FROM `FormularioResposta` fr WHERE fr.requisitoId = r.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM `Arquivo` a WHERE a.requisitoId = r.id
  );
