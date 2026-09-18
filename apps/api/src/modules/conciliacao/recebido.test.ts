import { describe, it, expect } from "vitest";
import { lerGrade } from "./planilha/index.js";
import { interpretarPlanilhaConciliacao, interpretarRepasse, interpretarValor } from "./recebido.js";

const grade = (texto: string) => lerGrade(Buffer.from(texto, "utf8"));

describe("interpretarValor — dinheiro do jeito que as planilhas escrevem", () => {
  it("formato brasileiro, americano, com R$ e vazio", () => {
    expect(interpretarValor("159.666,00")).toBe(159666);
    expect(interpretarValor("12.106,64")).toBe(12106.64);
    expect(interpretarValor("1234,5")).toBe(1234.5);
    expect(interpretarValor("12106.64")).toBe(12106.64);
    expect(interpretarValor("R$ 1.000,00")).toBe(1000);
    expect(interpretarValor("-250,00")).toBe(-250);
    expect(interpretarValor("")).toBeNull();
    expect(interpretarValor("-")).toBeNull();
    expect(interpretarValor("abc")).toBeUndefined();
  });

  it("estorno entre parênteses ou com sinal no fim é negativo, não ilegível", () => {
    expect(interpretarValor("(1.234,56)")).toBe(-1234.56);
    expect(interpretarValor("1.234,56-")).toBe(-1234.56);
  });

  it("número cru de XLSX: o ponto é decimal — 250.125 não vira duzentos e cinquenta mil", () => {
    expect(interpretarValor("250.125", { numeroCru: true })).toBe(250.13);
    expect(interpretarValor("1.000", { numeroCru: true })).toBe(1);
    expect(interpretarValor("1.234,56", { numeroCru: true })).toBe(1234.56); // texto no XLSX segue a regra BR
  });

  it("ponto de milhar sem vírgula (1.000) é milhar, não decimal", () => {
    expect(interpretarValor("1.000")).toBe(1000);
    expect(interpretarValor("1.000.000")).toBe(1000000);
  });
});

describe("interpretarRepasse", () => {
  const CAB = "Convênio;Atend;Medico Executor;Paciente;Dt Item;Código;Descrição;Data Pagamento;Vl Repasse";

  it("lê as linhas pelas colunas do relatório e NÃO carrega o paciente", async () => {
    const r = interpretarRepasse(
      await grade(
        `${CAB}\nUnimed Seguros Saúde;19100842;Gustavo Ieno Judas;PACIENTE SECRETO;15/05/2026;40020045;Revascularização;31/08/2026;1.500,00`,
      ),
    );
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({
      atendimento: "19100842",
      convenioBruto: "Unimed Seguros Saúde",
      executor: "Gustavo Ieno Judas",
      codigo: "40020045",
      valor: 1500,
    });
    expect(r.linhas[0]!.dataPagamento?.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(JSON.stringify(r)).not.toContain("PACIENTE SECRETO");
  });

  it("linha de incremento (Atend 0, sem paciente) ENTRA, com atendimento nulo — são R$ 12 mil que não podem sumir", async () => {
    const r = interpretarRepasse(await grade(`${CAB}\n;0;;;;0;MC - JUNHO/26;31/08/2026;12.106,64`));
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]).toMatchObject({ atendimento: null, codigo: null, descricao: "MC - JUNHO/26", valor: 12106.64 });
  });

  it("linha de grupo 'Repasse: 179978' vira o número do repasse das linhas seguintes", async () => {
    const r = interpretarRepasse(
      await grade(`${CAB}\nRepasse: 179978;;;;;;;;\nSUS - BP Paulista;18579361;Sergio;X;01/05/2026;406010935;Revasc;31/08/2026;900,00`),
    );
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]!.repasseNumero).toBe("179978");
  });

  it("valor que não é número é ignorado com o motivo, não vira zero", async () => {
    const r = interpretarRepasse(await grade(`${CAB}\nAmil;1;X;Y;01/05/2026;1;D;31/08/2026;abc`));
    expect(r.linhas).toHaveLength(0);
    expect(r.ignoradas[0]!.motivo).toMatch(/valor/i);
  });

  it("linha de total não é pagamento — e é reportada, não some", async () => {
    const r = interpretarRepasse(await grade(`${CAB}\n;;;;;;Total do repasse;;13.306,64`));
    expect(r.linhas).toHaveLength(0);
    expect(r.ignoradas[0]!.motivo).toMatch(/total/i);
  });

  it("devolve o período de pagamento coberto", async () => {
    const r = interpretarRepasse(await grade(`${CAB}\nA;1;X;Y;01/05/2026;1;D;15/08/2026;1,00\nA;2;X;Y;01/05/2026;1;D;31/08/2026;1,00`));
    expect(r.periodoPagamento).toEqual({ inicio: "2026-08-15", fim: "2026-08-31" });
  });

  it("recusa arquivo que não é repasse", async () => {
    expect(() => interpretarRepasse({ formato: "csv", linhas: [["Nome", "Valor"]] })).toThrow(/repasse/i);
  });
});

describe("interpretarPlanilhaConciliacao — o MODELO preenchido de volta", () => {
  const CAB =
    '"Data";"Nº Cirurgia";"Atendimento";"Paciente";"Prontuário";"Convênio";"Médico";"Procedimento (Tasy)";"Status Tasy";"Autorização Tasy";"Cód. Procedimento (De-Para)";"Valor cobrado (R$)";"Valor recebido (R$)";"Glosa (R$)";"Data pagamento";"Status conciliação";"Observação"';

  it("lê só o que foi preenchido; célula vazia não apaga nada", async () => {
    const r = interpretarPlanilhaConciliacao(
      await grade(
        `${CAB}\n"2026-05-04";"400001";"19100842";"X";"9";"Sul América";"S";"Revasc";"Executada";"Autorizado";"30917042";"10.000,00";"8.500,00";"1.500,00";"31/08/2026";"";"glosou OPME"\n"2026-05-05";"400002";"";"Y";"9";"SUS";"S";"Revasc";"Executada";"Pendente";"";"";"";"";"";"";""`,
      ),
    );
    expect(r.linhas).toHaveLength(1); // a segunda não tem nada preenchido — não é "mudança"
    expect(r.linhas[0]).toMatchObject({
      numeroCirurgia: "400001",
      codigoProcedimento: "30917042",
      valorCobrado: 10000,
      valorRecebido: 8500,
      observacao: "glosou OPME",
    });
    expect(r.linhas[0]).not.toHaveProperty("naoCobrar");
    expect(r.linhas[0]!.dataPagamento?.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(r.semAlteracao).toBe(1);
  });

  it("'Não cobrar' no status marca a cirurgia fora da conta", async () => {
    const r = interpretarPlanilhaConciliacao(
      await grade(`${CAB}\n"2026-05-04";"400001";"";"";"";"";"";"";"";"";"";"";"";"";"";"Não cobrar";""`),
    );
    expect(r.linhas[0]!.naoCobrar).toBe(true);
  });

  it("valor ilegível é reportado e a linha inteira fica de fora — metade gravada é pior", async () => {
    const r = interpretarPlanilhaConciliacao(
      await grade(`${CAB}\n"2026-05-04";"400001";"";"";"";"";"";"";"";"";"";"dez mil";"";"";"";"";""`),
    );
    expect(r.linhas).toHaveLength(0);
    expect(r.ignoradas[0]!.motivo).toMatch(/cobrado/i);
  });
});
