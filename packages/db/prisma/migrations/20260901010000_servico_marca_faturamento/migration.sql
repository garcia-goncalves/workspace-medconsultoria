-- A MARCA DO FATURAMENTO — quem pode ser cobrado por PERCENTUAL.
--
-- Ordem do dono (31/08/2026): só o faturamento médico é cobrado por percentual do que a
-- clínica fatura. Todo o resto do catálogo é valor fixo, avulso ou mensal. Até aqui a tela de
-- Ajustes → Serviços oferecia o botão "% do faturamento" nos DEZ serviços, inclusive no
-- credenciamento (que é valor fixo, cobrado só quando a operadora aprova — ADR-104/108).
--
-- ⚠️ É uma MARCA, e não `categoria = 'Faturamento'`: essa comparação já foi escrita e removida
-- CINCO vezes (ADR-125/126/127/137/138), porque bastava renomear a categoria em Ajustes para o
-- dinheiro mudar de regra em silêncio. Mesmo molde de `ehCredenciamento` (ADR-144).
--
-- ADITIVA: uma coluna nova com padrão. Reverter é `DROP COLUMN`.
ALTER TABLE `Servico` ADD COLUMN `ehFaturamento` BOOLEAN NOT NULL DEFAULT false;

-- ⚠️ O BACKFILL É PARTE DA MIGRAÇÃO, NÃO UM PASSO SEGUINTE.
-- Entre o `ALTER` e o `UPDATE`, um serviço percentual sem marca seria um serviço que a tela
-- mostra como "valor fixo" e que o servidor recusa editar — o dado ficaria preso.
--
-- O critério NÃO é o nome, é o PREÇO GRAVADO: marca-se quem hoje já é cobrado exclusivamente
-- por percentual (a mesma pergunta que `ehServicoSomentePercentual` faz na aplicação). Assim a
-- marca nasce descrevendo a realidade do banco, e não uma suposição sobre como o serviço se
-- chama — que é exatamente o erro que esta coluna existe para não repetir.
UPDATE `Servico`
   SET `ehFaturamento` = true
 WHERE `percentual` IS NOT NULL
   AND `percentual` > 0
   AND (`valor` IS NULL OR `valor` = 0);
