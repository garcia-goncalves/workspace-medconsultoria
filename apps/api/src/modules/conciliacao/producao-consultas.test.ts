import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lerGrade, type Grade } from "./planilha/index.js";
import {
  chaveDoConvenio,
  chaveDoProfissional,
  competenciaDe,
  ErroDeLeitura,
  interpretarData,
  interpretarProducaoConsultas,
  interpretarTipo,
} from "./producao-consultas.js";

/** Dados SINTÉTICOS com a forma do arquivo real (print de 11/09/2026). */
const CABECALHO = [
  "Data da agenda",
  "Data do atendimento",
  "Paciente",
  "CPF do paciente",
  "Telefone do Paciente",
  "E-mail",
  "Tipo de atendimento",
  "Plano de convênio",
  "Profissional",
];

function grade(...linhas: string[][]): Grade {
  return { formato: "csv", linhas };
}

describe("interpretarData", () => {
  it("lê o formato do arquivo (dd/mm/aaaa) em UTC", () => {
    const d = interpretarData("31/08/2026")!;
    expect(d.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("lê ISO também", () => {
    expect(interpretarData("2026-08-31")!.toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("ano de 2 dígitos é deste século", () => {
    expect(interpretarData("31/08/26")!.getUTCFullYear()).toBe(2026);
  });

  it("ignora a hora quando vem junto — aqui é dia", () => {
    expect(interpretarData("27/04/2026 07:00")!.toISOString()).toBe("2026-04-27T00:00:00.000Z");
  });

  it("RECUSA data que não existe — 31/02 viraria 03/03 em silêncio", () => {
    // Este é o erro que poria um atendimento no mês errado.
    expect(interpretarData("31/02/2026")).toBeNull();
    expect(interpretarData("30/02/2026")).toBeNull();
    expect(interpretarData("32/01/2026")).toBeNull();
    expect(interpretarData("01/13/2026")).toBeNull();
  });

  it("aceita 29/02 em ano bissexto e recusa em ano comum", () => {
    expect(interpretarData("29/02/2028")).not.toBeNull();
    expect(interpretarData("29/02/2026")).toBeNull();
  });

  it("vazio e lixo devolvem nulo", () => {
    expect(interpretarData("")).toBeNull();
    expect(interpretarData("   ")).toBeNull();
    expect(interpretarData("Total: 132")).toBeNull();
  });

  it("competenciaDe usa o mês em UTC", () => {
    expect(competenciaDe(new Date("2026-08-31T00:00:00Z"))).toBe("2026-08");
    expect(competenciaDe(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });
});

describe("interpretarTipo", () => {
  it("reconhece os três valores do arquivo real", () => {
    expect(interpretarTipo("Consulta")).toBe("CONSULTA");
    expect(interpretarTipo("Cortesia")).toBe("CORTESIA");
    expect(interpretarTipo("Sem vínculo com a agenda")).toBe("SEM_VINCULO_AGENDA");
  });

  it("não depende de acento nem de caixa", () => {
    expect(interpretarTipo("SEM VINCULO COM A AGENDA")).toBe("SEM_VINCULO_AGENDA");
    expect(interpretarTipo("CONSULTA")).toBe("CONSULTA");
  });

  it("o que não conhecemos vira OUTRO — e o bruto é guardado ao lado", () => {
    expect(interpretarTipo("Retorno")).toBe("OUTRO");
    expect(interpretarTipo("")).toBe("OUTRO");
  });
});

describe("chaves do de-para", () => {
  it("tira o pronome de tratamento do profissional", () => {
    // O relatório escreve "DR. LEONARDO..."; o cadastro guarda "Leonardo...".
    expect(chaveDoProfissional("DR. LEONARDO GIGLIO DRAGONE")).toBe("leonardo giglio dragone");
    expect(chaveDoProfissional("DRA. LAYS JOSE MORESCHI")).toBe("lays jose moreschi");
    expect(chaveDoProfissional("Dr Mohamad Said Ghandour")).toBe("mohamad said ghandour");
  });

  it("nome sem pronome passa intacto", () => {
    expect(chaveDoProfissional("Leonardo Giglio Dragone")).toBe("leonardo giglio dragone");
  });

  it("não come o nome de quem começa com 'Dra' por coincidência", () => {
    expect(chaveDoProfissional("Draco Silva")).toBe("draco silva");
  });

  it("convênio casa sem caixa e sem acento — senão Cassi e CASSI viram duas operadoras", () => {
    expect(chaveDoConvenio("PORTO SEGURO - BÁSICO")).toBe("porto seguro - basico");
    expect(chaveDoConvenio("Porto Seguro - Básico")).toBe(chaveDoConvenio("PORTO SEGURO - BÁSICO"));
    expect(chaveDoConvenio("  Cassi   -  Associados ")).toBe("cassi - associados");
  });
});

describe("interpretarProducaoConsultas", () => {
  const LINHA_OK = [
    "31/08/2026",
    "31/08/2026",
    "WILMA SAVINI",
    "029.978.978-07",
    "(11) 96067-6368, (11) 99340-4760",
    "",
    "Consulta",
    "PORTO SEGURO - BÁSICO",
    "DR. LEONARDO GIGLIO DRAGONE",
  ];

  it("lê uma linha completa", () => {
    const r = interpretarProducaoConsultas(grade(CABECALHO, LINHA_OK));
    expect(r.linhas).toHaveLength(1);
    const l = r.linhas[0]!;
    expect(l.linha).toBe(2);
    expect(l.pacienteNome).toBe("WILMA SAVINI");
    expect(l.competencia).toBe("2026-08");
    expect(l.tipoAtendimento).toBe("CONSULTA");
    expect(l.convenioBruto).toBe("PORTO SEGURO - BÁSICO");
    // O telefone com vários números fica INTEIRO — quem separa depois é outra decisão.
    expect(l.telefone).toBe("(11) 96067-6368, (11) 99340-4760");
    expect(l.email).toBeNull();
  });

  it("acha o cabeçalho depois de título e linha em branco", () => {
    const r = interpretarProducaoConsultas(
      grade(["Relatório de produção de consultas"], ["Período: 01/08 a 31/08"], [], CABECALHO, LINHA_OK),
    );
    expect(r.cabecalhoNaLinha).toBe(4);
    expect(r.linhas[0]!.linha).toBe(5);
  });

  it("Data da agenda vazia é o caso 'Sem vínculo com a agenda', não erro", () => {
    const r = interpretarProducaoConsultas(
      grade(CABECALHO, ["", "28/08/2026", "CELIA OTA", "", "", "", "Sem vínculo com a agenda", "Cassi", "DRA. LAYS"]),
    );
    expect(r.ignoradas).toHaveLength(0);
    expect(r.linhas[0]!.dataAgenda).toBeNull();
    expect(r.linhas[0]!.tipoAtendimento).toBe("SEM_VINCULO_AGENDA");
  });

  it("agenda e atendimento podem divergir de verdade", () => {
    const r = interpretarProducaoConsultas(
      grade(CABECALHO, ["25/08/2026", "28/08/2026", "LUCAS", "", "", "", "Cortesia", "Particular", "DR. MOHAMAD"]),
    );
    expect(r.linhas[0]!.dataAgenda!.toISOString().slice(0, 10)).toBe("2026-08-25");
    expect(r.linhas[0]!.dataAtendimento.toISOString().slice(0, 10)).toBe("2026-08-28");
  });

  it("linha sem data vira IGNORADA com o número da linha e o motivo", () => {
    const r = interpretarProducaoConsultas(grade(CABECALHO, ["", "", "SEM DATA", "", "", "", "Consulta", "X", "Y"]));
    expect(r.linhas).toHaveLength(0);
    expect(r.ignoradas).toEqual([{ linha: 2, motivo: "Sem data do atendimento." }]);
  });

  it("data ilegível diz QUAL texto não foi entendido", () => {
    const r = interpretarProducaoConsultas(grade(CABECALHO, ["", "31/02/2026", "IMPOSSIVEL", "", "", "", "Consulta", "X", "Y"]));
    expect(r.ignoradas[0]!.motivo).toContain("31/02/2026");
  });

  it("linha em branco no meio e rodapé de total não viram erro", () => {
    const r = interpretarProducaoConsultas(grade(CABECALHO, LINHA_OK, [], ["", "", "", "", "", "", "", "", ""]));
    expect(r.linhas).toHaveLength(1);
    expect(r.ignoradas).toHaveLength(0);
  });

  it("importa mesmo sem as colunas de dado pessoal, e avisa quais faltaram", () => {
    // Se um dia o cliente parar de exportar CPF/telefone/e-mail, o mês não pode travar.
    const enxuto = ["Data do atendimento", "Paciente", "Tipo de atendimento", "Plano de convênio", "Profissional"];
    const r = interpretarProducaoConsultas(grade(enxuto, ["31/08/2026", "WILMA", "Consulta", "CABESP", "DR. LEO"]));
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]!.cpf).toBeNull();
    expect(r.colunasAusentes).toEqual(["Data da agenda", "CPF do paciente", "Telefone do Paciente", "E-mail"]);
  });

  it("recusa arquivo que não é o relatório de produção", () => {
    expect(() => interpretarProducaoConsultas(grade(["Nome", "Valor"], ["a", "1"]))).toThrow(ErroDeLeitura);
    expect(() => interpretarProducaoConsultas(grade(["Nome", "Valor"], ["a", "1"]))).toThrow(/não reconheci/i);
  });

  it("junta as competências encontradas — é como se vê atendimento pingando de outro mês", () => {
    const r = interpretarProducaoConsultas(
      grade(
        CABECALHO,
        LINHA_OK,
        ["", "01/09/2026", "OUTRO MES", "", "", "", "Consulta", "CABESP", "DR. LEO"],
        ["", "30/07/2026", "MES ANTERIOR", "", "", "", "Consulta", "CABESP", "DR. LEO"],
      ),
    );
    expect(r.competencias).toEqual(["2026-07", "2026-08", "2026-09"]);
  });
});

describe("ponta a ponta contra a fixture .xlsx real", () => {
  it("lê o arquivo de verdade e entrega produção pronta para gravar", async () => {
    const caminho = fileURLToPath(new URL("../../test/fixtures/producao-consultas.xlsx", import.meta.url));
    const r = interpretarProducaoConsultas(await lerGrade(readFileSync(caminho)));

    expect(r.cabecalhoNaLinha).toBe(4);
    expect(r.linhas).toHaveLength(3);
    expect(r.ignoradas).toHaveLength(0);
    expect(r.competencias).toEqual(["2026-08"]);
    expect(r.colunasAusentes).toEqual([]);

    // A data veio do número de série do Excel e atravessou tudo sem escorregar de dia.
    expect(r.linhas[0]!.dataAtendimento.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(r.linhas[1]!.dataAgenda).toBeNull();
    expect(r.linhas[1]!.tipoAtendimento).toBe("SEM_VINCULO_AGENDA");
    expect(r.linhas[2]!.tipoAtendimento).toBe("CORTESIA");
    expect(r.linhas[2]!.convenioBruto).toBe("PARTICULAR DR. MOHAMAD - MAESTRO CARDIM");
  });
});
