/**
 * Aviso de "você está editando a série inteira", na Agenda.
 *
 * Evento recorrente é UMA linha no banco: clicar na reunião de 24/08 abre o
 * formulário com a data da 1ª ocorrência (03/08), e salvar muda TODAS as
 * repetições. Sem aviso, quem mexe no horário acha que mexeu em uma.
 *
 * Regra pura para poder ser testada; o texto vive aqui junto porque é a mesma
 * decisão ("há divergência de dia?" → "que frase mostrar?").
 */
import type { Recorrencia } from "@app/shared";
import { data as fmtData } from "../../lib/format-date";

export interface AvisoSerie {
  titulo: string;
  /** Só existe quando a data do formulário difere do dia em que a pessoa clicou. */
  detalhe: string | null;
}

export function avisoDeSerie(args: {
  recorrencia: Recorrencia;
  /** Início da ocorrência clicada na tela. Ausente = veio de outro caminho. */
  ocorrenciaClicada?: Date | null;
  /** Início da série (o que o formulário mostra). */
  baseInicio?: Date | null;
}): AvisoSerie | null {
  if (args.recorrencia === "NENHUMA") return null;

  const titulo = "Este evento se repete — salvar altera a série inteira.";

  const clicada = args.ocorrenciaClicada ? fmtData(args.ocorrenciaClicada) : "";
  const base = args.baseInicio ? fmtData(args.baseInicio) : "";
  if (!clicada || !base || clicada === base) return { titulo, detalhe: null };

  return {
    titulo,
    detalhe: `A data abaixo é a da 1ª repetição (${base}), não a de ${clicada} em que você clicou.`,
  };
}
