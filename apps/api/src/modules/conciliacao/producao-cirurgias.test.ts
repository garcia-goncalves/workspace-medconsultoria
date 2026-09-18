import { describe, it, expect } from "vitest";
import { lerGrade } from "./planilha/index.js";
import {
  interpretarAutorizacao,
  interpretarCategoria,
  interpretarInstante,
  interpretarMapaCirurgico,
  interpretarStatus,
} from "./producao-cirurgias.js";

/** Cabeçalho idêntico ao do arquivo real do TASY (18/09/2026). Dados abaixo são inventados. */
const CABECALHO =
  '"Data";"Hora (UTC)";"Sala";"Duração prev (min)";"Paciente";"Prontuário";"Atendimento";"Nº Cirurgia";"Seq Cirurgia";"Convênio";"Tipo Conv";"Médico";"Anestesista";"Tipo Anestesia";"Procedimento";"Status";"Autorização";"Cód Aut";"Unid. Internação";"Setor";"Cód Pessoa";"OPME";"Tempo (min)";"Técnica"';

function linha(c: Partial<Record<string, string>>): string {
  const v = {
    data: "2026-05-04",
    hora: "2026-05-04T10:00:00Z",
    paciente: "PACIENTE FICTICIO",
    prontuario: "9999999",
    atendimento: "19100842",
    cirurgia: "400001",
    convenio: "Sul América",
    tipo: "2",
    medico: "Sergio Almeida de Oliveira",
    anest: "Anestesista Ficticio",
    proc: "Revascularização Miocárdica com uso de extracorporea",
    status: "Executada",
    aut: "Autorizado",
    cod: "A",
    unid: "Leito 1310 01",
    pessoa: "123456",
    opme: "Com OPME",
    tempo: "240",
    ...c,
  };
  return [
    v.data,
    v.hora,
    "Sala 08",
    "240",
    v.paciente,
    v.prontuario,
    v.atendimento,
    v.cirurgia,
    "7901977029",
    v.convenio,
    v.tipo,
    v.medico,
    v.anest,
    "",
    v.proc,
    v.status,
    v.aut,
    v.cod,
    v.unid,
    "",
    v.pessoa,
    v.opme,
    v.tempo,
    "Convencional",
  ]
    .map((x) => `"${x}"`)
    .join(";");
}

async function ler(...linhas: string[]) {
  return interpretarMapaCirurgico(await lerGrade(Buffer.from([CABECALHO, ...linhas].join("\n"), "utf8")));
}

describe("interpretarMapaCirurgico", () => {
  it("lê uma cirurgia com todos os campos que importam", async () => {
    const r = await ler(linha({}));
    expect(r.cabecalhoNaLinha).toBe(1);
    expect(r.ignoradas).toEqual([]);
    expect(r.colunasAusentes).toEqual([]);
    const l = r.linhas[0]!;
    expect(l).toMatchObject({
      numeroCirurgia: "400001",
      atendimento: "19100842",
      competencia: "2026-05",
      pacienteNome: "PACIENTE FICTICIO",
      status: "EXECUTADA",
      autorizacao: "AUTORIZADO",
      categoriaConvenio: "CONVENIO",
      convenioBruto: "Sul América",
      profissionalBruto: "Sergio Almeida de Oliveira",
      opme: true,
      tempoMinutos: 240,
    });
    expect(l.dataCirurgia.toISOString()).toBe("2026-05-04T00:00:00.000Z");
    expect(l.inicioEm?.toISOString()).toBe("2026-05-04T10:00:00.000Z");
  });

  it("NÃO carrega prontuário, código da pessoa nem leito — minimização (spec §2.3)", async () => {
    const r = await ler(linha({ prontuario: "PRONT-SECRETO", pessoa: "PESSOA-SECRETA", unid: "LEITO-SECRETO" }));
    const json = JSON.stringify(r);
    expect(json).not.toContain("PRONT-SECRETO");
    expect(json).not.toContain("PESSOA-SECRETA");
    expect(json).not.toContain("LEITO-SECRETO");
  });

  it("sem Atendimento importa, com atendimento nulo — não é descartada", async () => {
    const r = await ler(linha({ atendimento: "" }));
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]!.atendimento).toBeNull();
  });

  it("cirurgia repetida no arquivo: a primeira fica, a repetição é reportada", async () => {
    const r = await ler(linha({ cirurgia: "1" }), linha({ cirurgia: "1", paciente: "OUTRO" }));
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]!.pacienteNome).toBe("PACIENTE FICTICIO");
    expect(r.ignoradas).toEqual([{ linha: 3, motivo: "Cirurgia 1 repetida (já lida na linha 2)." }]);
  });

  it("linha sem número, sem data válida ou sem paciente é ignorada com o motivo", async () => {
    const r = await ler(linha({ cirurgia: "" }), linha({ cirurgia: "2", data: "2026-02-31" }), linha({ cirurgia: "3", paciente: "" }));
    expect(r.linhas).toHaveLength(0);
    expect(r.ignoradas.map((i) => i.motivo)).toEqual([
      "Sem número da cirurgia.",
      'Data não reconhecida: "2026-02-31".',
      "Sem nome do paciente.",
    ]);
  });

  it("devolve o período coberto pelo arquivo", async () => {
    const r = await ler(linha({ cirurgia: "1", data: "2026-03-10" }), linha({ cirurgia: "2", data: "2025-09-18" }));
    expect(r.periodo?.inicio.toISOString().slice(0, 10)).toBe("2025-09-18");
    expect(r.periodo?.fim.toISOString().slice(0, 10)).toBe("2026-03-10");
  });

  it("recusa o relatório de CONSULTAS — é outro documento", async () => {
    const consultas =
      "Data da agenda;Data do atendimento;Paciente;Tipo de atendimento;Plano de convênio;Profissional\n31/08/2026;31/08/2026;X;Consulta;CABESP;DR. X";
    await expect(async () => interpretarMapaCirurgico(await lerGrade(Buffer.from(consultas, "utf8")))).rejects.toThrow(/mapa cirúrgico/);
  });
});

describe("tradutores", () => {
  it("status", () => {
    expect(interpretarStatus("Executada")).toBe("EXECUTADA");
    expect(interpretarStatus("Reservada")).toBe("RESERVADA");
    expect(interpretarStatus("Cancelada")).toBe("OUTRO");
  });

  it("autorização: o código manda, o texto é reserva", () => {
    expect(interpretarAutorizacao("PA", "Autorizado")).toBe("PENDENTE");
    expect(interpretarAutorizacao("PZ", "")).toBe("PARCIAL");
    expect(interpretarAutorizacao("NN", "")).toBe("NAO_NECESSITA");
    expect(interpretarAutorizacao("", "Parcialmente autorizado")).toBe("PARCIAL");
    expect(interpretarAutorizacao("", "Não necessita autorização")).toBe("NAO_NECESSITA");
    expect(interpretarAutorizacao("XX", "algo novo")).toBe("OUTRO");
  });

  it("categoria do convênio pelo Tipo Conv; código desconhecido nunca vira palpite", () => {
    expect(interpretarCategoria("1")).toBe("PARTICULAR");
    expect(interpretarCategoria("2")).toBe("CONVENIO");
    expect(interpretarCategoria("3")).toBe("SUS");
    expect(interpretarCategoria("6")).toBe("AUTOGESTAO");
    expect(interpretarCategoria("4")).toBe("OUTRO");
    expect(interpretarCategoria(null)).toBe("OUTRO");
  });

  it("instante só com fuso explícito", () => {
    expect(interpretarInstante("2025-09-26T10:00:01Z")?.toISOString()).toBe("2025-09-26T10:00:01.000Z");
    expect(interpretarInstante("2025-09-26 10:00")).toBeNull();
    expect(interpretarInstante("")).toBeNull();
  });
});
