// ⚠️ `ROTULO_STATUS` MORA no módulo do status, não aqui: a exportação é consumidora dele, e
// uma segunda tabela de rótulos divergiria no dia em que um status novo nascesse.
import { ROTULO_STATUS } from "./conciliacao-cirurgica.js";
export { ROTULO_STATUS };
import type { LinhaConciliada } from "./conciliacao-financeira.service.js";
import { chaveDoConvenio } from "./producao-consultas.js";

/**
 * CONCILIAÇÃO — Fase 2b: as planilhas que saem do sistema. Puras.
 *
 * O MODELO tem exatamente as colunas da planilha que a equipe já usava
 * (`MODELO_conciliacao_clinica_sergio_almeida.csv`, 18/09/2026) — é ela que volta preenchida pela
 * importação de planilha, casando pelo Nº Cirurgia. Os dois resumos repetem os arquivos
 * `resumo_por_convenio.csv` e `resumo_por_mes_medico.csv`, com as colunas de dinheiro a mais.
 *
 * ⚠️ `Prontuário` sai VAZIA: o sistema não o grava (minimização). A coluna fica para a planilha
 * continuar com o formato de sempre; quem precisar do prontuário tem o arquivo original do TASY.
 */

/** Texto entre aspas; e sem abrir porta para fórmula quando a planilha for aberta no Excel. */
function texto(v: string | null | undefined): string {
  let s = v ?? "";
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
/** Dinheiro no jeito brasileiro, sem milhar: `1234,56` — o Excel em pt-BR lê como número. */
const reais = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));
const dataBR = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const csv = (linhas: string[][]) => "﻿" + linhas.map((l) => l.join(";")).join("\r\n") + "\r\n";

const nomeDoMedico = (l: LinhaConciliada) => l.profissional?.nome ?? l.profissionalBruto;

export function planilhaModelo(linhas: LinhaConciliada[]): string {
  const cab = [
    "Data",
    "Nº Cirurgia",
    "Atendimento",
    "Paciente",
    "Prontuário",
    "Convênio",
    "Médico",
    "Procedimento (Tasy)",
    "Status Tasy",
    "Autorização Tasy",
    "Cód. Procedimento (De-Para)",
    "Valor cobrado (R$)",
    "Valor recebido (R$)",
    "Glosa (R$)",
    "Data pagamento",
    "Status conciliação",
    "Observação",
  ].map(texto);

  const corpo = [...linhas]
    .sort((a, b) => a.dataCirurgia.localeCompare(b.dataCirurgia) || a.numeroCirurgia.localeCompare(b.numeroCirurgia))
    .map((l) => [
      texto(l.dataCirurgia),
      texto(l.numeroCirurgia),
      texto(l.atendimento),
      texto(l.pacienteNome),
      texto(""),
      texto(l.convenioBruto),
      texto(nomeDoMedico(l)),
      texto(l.procedimento),
      texto(l.statusBruto),
      texto(l.autorizacaoBruto),
      texto(l.codigo),
      reais(l.cobrado),
      reais(l.recebido),
      reais(l.glosa),
      texto(dataBR(l.dataPagamento)),
      texto(ROTULO_STATUS[l.statusConciliacao]),
      texto(l.observacao),
    ]);
  return csv([cab, ...corpo]);
}

interface Acumulado {
  qtd: number;
  cobrado: number;
  recebido: number;
  glosa: number;
  aReceber: number;
}
const vazio = (): Acumulado => ({ qtd: 0, cobrado: 0, recebido: 0, glosa: 0, aReceber: 0 });
const mais = (a: number, b: number | null) => (b === null ? a : Math.round((a + b) * 100) / 100);

/** Conta TODAS as cirurgias (como a planilha de sempre); o dinheiro, só as que entram na conta. */
function acumular(acc: Acumulado, l: LinhaConciliada) {
  acc.qtd++;
  if (l.statusConciliacao === "NAO_REALIZADA" || l.statusConciliacao === "NAO_COBRAR") return;
  acc.cobrado = mais(acc.cobrado, l.cobrado);
  acc.recebido = mais(acc.recebido, l.recebido);
  acc.glosa = mais(acc.glosa, l.glosa);
  if (l.statusConciliacao === "A_RECEBER") acc.aReceber = mais(acc.aReceber, l.cobrado);
}

const colunasDinheiro = (a: Acumulado) => [reais(a.cobrado), reais(a.recebido), reais(a.glosa), reais(a.aReceber)];
const CAB_DINHEIRO = ["Cobrado (R$)", "Recebido (R$)", "Glosa (R$)", "A receber (R$)"].map(texto);

/**
 * ⚠️ Agrupa pela OPERADORA LIGADA (o de-para de convênio), não pelo texto cru do TASY — a mesma
 * régua de `somarPorOperadora`, que a tela usa. Pelo texto, "BRADESCO SAUDE" e "BRADESCO SAÚDE -
 * TOP" saíam em duas linhas, e a planilha contradizia a tela sobre quanto a Bradesco deve.
 * Sem ligação, o texto bruto sai com "(a ligar)" — o mesmo aviso da tela de que o número ainda
 * não está fechado —, juntando as grafias que normalizam igual (`Cassi` × `CASSI`).
 */
export function resumoPorConvenio(linhas: LinhaConciliada[]): string {
  const mapa = new Map<string, { rotulo: string; acc: Acumulado }>();
  for (const l of linhas) {
    const [chave, rotulo] = l.operadora
      ? [`op:${l.operadora.id}`, l.operadora.nome]
      : l.convenioParticular
        ? ["__particular__", "Particular"]
        : [`bruto:${chaveDoConvenio(l.convenioBruto)}`, `${l.convenioBruto} (a ligar)`];
    const item = mapa.get(chave) ?? { rotulo, acc: vazio() };
    acumular(item.acc, l);
    mapa.set(chave, item);
  }
  const corpo = [...mapa.values()]
    .sort((a, b) => b.acc.qtd - a.acc.qtd || a.rotulo.localeCompare(b.rotulo))
    .map(({ rotulo, acc }) => [texto(rotulo), String(acc.qtd), ...colunasDinheiro(acc)]);
  return csv([[texto("Convênio"), texto("Qtd cirurgias"), ...CAB_DINHEIRO], ...corpo]);
}

export function resumoPorMesMedico(linhas: LinhaConciliada[]): string {
  const mapa = new Map<string, { mes: string; medico: string; acc: Acumulado }>();
  for (const l of linhas) {
    const medico = nomeDoMedico(l);
    const chave = `${l.competencia}|${medico}`;
    const item = mapa.get(chave) ?? { mes: l.competencia, medico, acc: vazio() };
    acumular(item.acc, l);
    mapa.set(chave, item);
  }
  const corpo = [...mapa.values()]
    .sort((a, b) => a.mes.localeCompare(b.mes) || a.medico.localeCompare(b.medico))
    .map((i) => [texto(i.mes), texto(i.medico), String(i.acc.qtd), ...colunasDinheiro(i.acc)]);
  return csv([[texto("Mês"), texto("Médico"), texto("Qtd cirurgias"), ...CAB_DINHEIRO], ...corpo]);
}
