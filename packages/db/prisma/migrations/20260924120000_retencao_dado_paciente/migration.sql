-- LGPD: prazo de guarda do dado de PACIENTE da Conciliação (Onda 1 · W7, decisão do dono).
--
-- O defeito: `ProducaoConsulta`, `ProducaoCirurgia` e o arquivo original importado (planilha do
-- TASY / de consultas / de repasse, com tudo em claro) ficavam PARA SEMPRE. O expurgo da ADR-141
-- cobria corpo de e-mail e avisava do acervo de credenciamento, mas não sabia que paciente existia.
--
-- ADITIVA E ISOLADA: UMA coluna nova com padrão (5 anos). Nenhuma linha existente muda de valor,
-- nenhum dado é apagado por esta migração — quem anonimiza é a rotina diária, lendo este prazo.
-- Reverter é uma linha:  ALTER TABLE `IdentidadeInstitucional` DROP COLUMN `retencaoPacienteAnos`;

-- AlterTable
ALTER TABLE `IdentidadeInstitucional` ADD COLUMN `retencaoPacienteAnos` INTEGER NOT NULL DEFAULT 5;
