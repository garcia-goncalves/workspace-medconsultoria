# Conciliação — Fase 2b: o dinheiro de cada cirurgia, para N clientes

> 18/09/2026 · pedido do dono: _"quero uma ferramenta foda de conciliação, pra N clientes
> diferentes"_, com os arquivos do dia: `MODELO_conciliacao_clinica_sergio_almeida.csv` (o gabarito
> que a equipe preenche), `resumo_por_convenio.csv` e `resumo_por_mes_medico.csv`.
> Continua `2026-09-18-conciliacao-cirurgias-tasy-design.md` (Fase 2a).

## 1. O gabarito manda

O MODELO é o mapa cirúrgico com sete colunas a mais: **Cód. Procedimento (De-Para), Valor cobrado,
Valor recebido, Glosa, Data pagamento, Status conciliação, Observação**. A ferramenta preenche essas
colunas e devolve a mesma planilha — nada de formato novo para a equipe aprender.

## 2. Decisões

1. **Cobrado vem do de-para do PROCEDIMENTO** (`MapeamentoProcedimento`), por cliente e
   opcionalmente por operadora — a mesma revascularização vale diferente na Unimed e no SUS (§4b.4
   da Fase 1). Operadora primeiro, padrão depois.
2. **Recebido vem de dois caminhos:** o repasse do TASY (`RepasseLinha`, casa pelo **atendimento**)
   ou a planilha preenchida (casa pelo **Nº Cirurgia**). O valor digitado (tela ou planilha) **manda**
   sobre o importado.
3. **Nada de dinheiro calculado é gravado.** Cobrado = digitado ?? de-para; recebido = digitado ??
   parte do repasse; glosa e status são calculados a cada leitura (`conciliacao-cirurgica.ts`, pura,
   em centavos inteiros). Mudar o preço de um pacote vale na hora para todas as cirurgias, sem
   retroação a lembrar, e o status nunca envelhece ao lado do número que o desmente.
4. **Um atendimento, várias cirurgias** (3 casos no arquivo real): o repasse é repartido
   proporcionalmente ao cobrado; sem referência, tudo vai para a primeira. A soma bate no centavo.
5. **Repasse sem cirurgia entra e aparece à parte** ("recebido sem produção"): incremento e acordo
   vêm com `Atend = 0` e são dinheiro de verdade (R$ 12.106,64 numa linha só, §4b.1). Descartar seria
   apagar recebimento em silêncio.
6. **O mesmo pagamento nunca conta duas vezes:** mesmo arquivo é recusado; outro arquivo com
   pagamentos no mesmo período pede confirmação e **substitui** as linhas daquele período.
7. **Status:** Não realizada · Não cobrar · Sem atendimento · Sem valor de referência · A receber ·
   Pago · Glosa parcial · Glosa total · Pago a mais · Recebido sem referência. Não realizada e Não
   cobrar ficam **fora** de toda soma de dinheiro.
8. **Planilha preenchida: célula vazia não apaga.** Só o que veio escrito é gravado. Valor ilegível
   descarta a LINHA inteira (metade gravada é pior) e é reportado.
9. **Exportação** = o MODELO (mesmas 17 colunas; `Prontuário` sai vazia — não é gravado) + os dois
   resumos com colunas de dinheiro. CSV `;`, UTF-8 com BOM, dinheiro `1234,56`, e célula que começa
   com `= + - @` é neutralizada (injeção de fórmula).
10. **Visão geral:** sem cliente escolhido, a tela lista todos os clientes com produção — cobrado,
    recebido, glosa, a receber e pendências —, ordenados pelo que mais pede atenção.
11. **Nome de paciente não trafega em URL:** as queries da Conciliação vão por POST
    (`methodOverride`) e a exportação é mutation.

## 3. Limites conhecidos

- **O formato do repasse vem do PRINT** (§4b da Fase 1): colunas `Atend` e `Vl Repasse`
  obrigatórias; linha de grupo `Repasse: <nº>` reconhecida; totais ignorados. O primeiro arquivo
  real pode trazer nomes de coluna diferentes — o leitor avisa o que não achou.
- **Imposto retido não entra:** a comparação é contra o bruto do repasse (a tela diz isso).
- **Quem pode ver** continua `funcionarioProcedure` — pendência de decisão do dono (Fase 2a).
