import { describe, expect, it } from "vitest";
import type { Grade } from "./index.js";
import { dicaDeRota, identificarRelatorio } from "./qual-relatorio.js";

/**
 * Os quatro cabeçalhos REAIS, copiados da origem de cada um — não inventados:
 *
 * - `MODELO` é o cabeçalho que `planilhaModelo` (exportacao.ts) escreve.
 * - `CIRURGIAS` e `REPASSE` são os do TASY, como estão nas constantes dos leitores.
 * - `CONSULTAS` é o do relatório de produção (print de 11/09/2026).
 */
const MODELO = [
  "Data", "Nº Cirurgia", "Atendimento", "Paciente", "Prontuário", "Convênio", "Médico",
  "Procedimento (Tasy)", "Status Tasy", "Autorização Tasy", "Cód. Procedimento (De-Para)",
  "Valor cobrado (R$)", "Valor recebido (R$)", "Glosa (R$)", "Data pagamento",
  "Status conciliação", "Observação",
];
const CIRURGIAS = ["Data", "Hora (UTC)", "Paciente", "Atendimento", "Nº Cirurgia", "Convênio", "Médico", "Procedimento", "Status"];
const REPASSE = ["Atend", "Convênio", "Medico Executor", "Dt Item", "Código", "Descrição", "Vl Repasse", "Data Pagamento"];
const CONSULTAS = ["Data da agenda", "Data do atendimento", "Paciente", "CPF do paciente", "Tipo de atendimento", "Plano de convênio", "Profissional"];

const grade = (cabecalho: string[]): Grade => ({ formato: "csv", linhas: [cabecalho, cabecalho.map(() => "")] });

describe("identificarRelatorio", () => {
  it("reconhece cada um dos quatro pelo cabeçalho", () => {
    expect(identificarRelatorio(grade(CONSULTAS))).toBe("consultas");
    expect(identificarRelatorio(grade(CIRURGIAS))).toBe("cirurgias");
    expect(identificarRelatorio(grade(REPASSE))).toBe("repasse");
    expect(identificarRelatorio(grade(MODELO))).toBe("planilha");
  });

  /**
   * ⚠️ ESTE É O TESTE QUE GUARDA A ORDEM DA LISTA, e ele reprova quem a inverter.
   *
   * O MODELO satisfaz INTEIRO o importador de cirurgias: traz Data, Paciente, Atendimento,
   * Nº Cirurgia, Convênio e Médico com o nome exato, e casa as duas últimas por PREFIXO —
   * `Procedimento (Tasy)` com `Procedimento`, `Status Tasy` com `Status`. Só a ordem
   * (mais específico primeiro) impede a dica de mandar a pessoa para a porta errada.
   */
  it("o MODELO satisfaz a régua do mapa cirúrgico — e ainda assim é identificado como planilha", () => {
    const g = grade(MODELO);
    // A premissa do teste: as oito exigidas do mapa cirúrgico estão de fato lá.
    const comoCirurgia = MODELO.map((c) => c.toLowerCase());
    for (const exigida of ["data", "paciente", "atendimento", "nº cirurgia", "convênio", "médico"]) {
      expect(comoCirurgia).toContain(exigida);
    }
    expect(comoCirurgia.some((c) => c.startsWith("procedimento"))).toBe(true);
    expect(comoCirurgia.some((c) => c.startsWith("status"))).toBe(true);
    // E mesmo assim:
    expect(identificarRelatorio(g)).toBe("planilha");
  });

  it("o mapa cirúrgico CRU não é confundido com a planilha preenchida", () => {
    // Os dois têm "Nº Cirurgia"; o que separa é ter ao menos uma coluna de conciliação.
    expect(identificarRelatorio(grade(CIRURGIAS))).toBe("cirurgias");
  });

  it("não identifica o que não é nenhum dos quatro", () => {
    expect(identificarRelatorio(grade(["Nome", "Telefone", "Cidade"]))).toBeNull();
  });

  it("não identifica quando o cabeçalho está além da linha 30", () => {
    const enfeite = Array.from({ length: 31 }, () => [""]);
    expect(identificarRelatorio({ formato: "csv", linhas: [...enfeite, CONSULTAS] })).toBeNull();
  });
});

describe("dicaDeRota", () => {
  /** O caso real de 21/09/2026: a planilha MODELO foi parar no importador de consultas. */
  it("aponta a porta certa para o arquivo que foi recusado", () => {
    const dica = dicaDeRota(grade(MODELO), "consultas");
    expect(dica).toContain("a planilha de conciliação preenchida");
    expect(dica).toContain("Cirurgias (TASY) → Importar planilha preenchida");
  });

  it("cobre os doze cruzamentos — cada arquivo em cada porta errada", () => {
    const arquivos = [
      { cab: CONSULTAS, tipo: "consultas", onde: "Consultas → Importar produção" },
      { cab: CIRURGIAS, tipo: "cirurgias", onde: "Cirurgias (TASY) → Importar cirurgias" },
      { cab: REPASSE, tipo: "repasse", onde: "Cirurgias (TASY) → Importar repasse" },
      { cab: MODELO, tipo: "planilha", onde: "Cirurgias (TASY) → Importar planilha preenchida" },
    ] as const;

    for (const arquivo of arquivos) {
      for (const porta of arquivos) {
        if (porta.tipo === arquivo.tipo) continue;
        const dica = dicaDeRota(grade(arquivo.cab), porta.tipo);
        expect(dica, `${arquivo.tipo} recusado por ${porta.tipo}`).toContain(arquivo.onde);
      }
    }
  });

  /**
   * ⚠️ Calar aqui é a decisão certa: se quem reconhece o arquivo é o PRÓPRIO importador que
   * recusou, o problema é outro (cabeçalho além da linha 30, uma coluna faltando de verdade), e
   * dizer "importe em Consultas → Importar produção" a quem já está exatamente ali é ruído.
   */
  it("cala quando quem reconhece é o próprio importador que recusou", () => {
    expect(dicaDeRota(grade(CONSULTAS), "consultas")).toBeNull();
    expect(dicaDeRota(grade(MODELO), "planilha")).toBeNull();
  });

  it("cala quando nenhum dos quatro reconhece o arquivo", () => {
    expect(dicaDeRota(grade(["Nome", "Telefone", "Cidade"]), "consultas")).toBeNull();
  });
});
