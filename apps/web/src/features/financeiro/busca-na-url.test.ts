import { describe, expect, it } from "vitest";
import { SEM_CATEGORIA } from "@app/shared";
import { lerBuscaDoFinanceiro, limparBusca, SEM_CATEGORIA_URL, temFiltroExtra } from "./busca-na-url";
import { diaAnterior, larguraRelativa, nomeDoArquivo, rotuloDoMes, rotuloExportar, textoAtraso } from "./relatorios-formato";

describe("estado do Financeiro na URL", () => {
  it("lê todos os filtros válidos", () => {
    expect(
      lerBuscaDoFinanceiro({
        carteira: "TUDO",
        aba: "relatorios",
        tipo: "PAGAR",
        status: "TODAS",
        cliente: "cm123",
        categoria: "__sem__",
        de: "2026-01-01",
        ate: "2026-01-31",
        busca: "aluguel",
        pagina: 3,
      }),
    ).toEqual({
      carteira: "TUDO",
      aba: "relatorios",
      tipo: "PAGAR",
      status: "TODAS",
      cliente: "cm123",
      categoria: "__sem__",
      de: "2026-01-01",
      ate: "2026-01-31",
      busca: "aluguel",
      pagina: 3,
    });
  });

  it("⚠️ descarta o que não tem forma (a URL é texto que qualquer um edita)", () => {
    expect(
      lerBuscaDoFinanceiro({
        carteira: "DE_OUTRO",
        tipo: "X",
        cliente: "a b; drop",
        de: "2026-13-01",
        ate: "ontem",
        pagina: -2,
        busca: "   ",
      }),
    ).toEqual({});
  });

  it("os padrões não vão para a URL (/financeiro limpo é a tela de sempre)", () => {
    expect(lerBuscaDoFinanceiro({ carteira: "EMPRESA", aba: "contas", tipo: "RECEBER", status: "PENDENTES", pagina: 1 })).toEqual({});
    expect(limparBusca({ carteira: "EMPRESA", busca: "", cliente: undefined })).toEqual({});
  });

  it("busca numérica chega como número do roteador e vira texto; o teto é 120", () => {
    expect(lerBuscaDoFinanceiro({ busca: 2026 })).toEqual({ busca: "2026" });
    expect(lerBuscaDoFinanceiro({ busca: "x".repeat(200) }).busca).toHaveLength(120);
  });

  it("'sem categoria' da tela é o mesmo valor do servidor", () => {
    expect(SEM_CATEGORIA_URL).toBe(SEM_CATEGORIA);
  });

  it("recorte extra é só cliente/categoria/período/busca", () => {
    expect(temFiltroExtra({ carteira: "TUDO", tipo: "PAGAR", status: "TODAS" })).toBe(false);
    expect(temFiltroExtra({ de: "2026-01-01" })).toBe(true);
  });
});

describe("formatação dos relatórios", () => {
  it("rotula o mês e não quebra com texto estranho", () => {
    expect(rotuloDoMes("2026-09")).toBe("set/2026");
    expect(rotuloDoMes("2027-01")).toBe("jan/2027");
    expect(rotuloDoMes("lixo")).toBe("lixo");
  });

  it("dia anterior atravessa a virada de mês e de ano", () => {
    expect(diaAnterior("2026-03-01")).toBe("2026-02-28");
    expect(diaAnterior("2027-01-01")).toBe("2026-12-31");
  });

  it("atraso, barra e botão", () => {
    expect(textoAtraso(1)).toBe("1 dia");
    expect(textoAtraso(40)).toBe("40 dias");
    expect(larguraRelativa(50, 200)).toBe(25);
    expect(larguraRelativa(10, 0)).toBe(0);
    expect(larguraRelativa(-5, 10)).toBe(0);
    expect(rotuloExportar(null)).toBe("Exportar para o contador");
    expect(rotuloExportar(1)).toBe("Exportar 1 conta");
    expect(rotuloExportar(12)).toBe("Exportar 12 contas");
  });

  it("nome do arquivo diz carteira, período e recorte", () => {
    expect(nomeDoArquivo({ carteira: "EMPRESA", recortado: false, hoje: "2026-09-24" })).toBe("financeiro_empresa_2026-09-24.csv");
    expect(nomeDoArquivo({ carteira: "TUDO", de: "2026-01-01", recortado: true, hoje: "2026-09-24" })).toBe(
      "financeiro_tudo_2026-01-01_a_hoje_filtro_2026-09-24.csv",
    );
  });
});
