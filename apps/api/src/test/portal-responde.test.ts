import { describe, it, expect } from "vitest";
import {
  STATUS_CREDENCIAMENTO,
  andamentoParaOCliente,
  decidirEmailOperacional,
  linhasDadosPagamento,
  marcoDoAndamento,
  montarDadosPagamento,
} from "@app/shared";
import {
  INTERVALO_MINIMO_MS,
  planejarAvisoDePendencias,
  podeAvisarDeNovo,
  type Pendencia,
} from "../modules/portal/aviso-de-pendencias.js";
import { descricaoParaOCliente } from "../modules/portal/pagamentos.service.js";

/** Onda 3B — as regras puras do Portal que responde o que o cliente pergunta por WhatsApp. */

describe("andamento na operadora, na língua do cliente", () => {
  it("cada situação tem a sua frase, com a data quando a frase fala de quando", () => {
    expect(andamentoParaOCliente("A_PROTOCOLAR", null).frase).toBe("Preparando o protocolo");
    expect(andamentoParaOCliente("PROTOCOLADO", "03/09/2026").frase).toBe("Protocolado em 03/09/2026");
    expect(andamentoParaOCliente("EM_ANALISE", "10/09/2026").frase).toBe("Em análise pela operadora desde 10/09/2026");
    expect(andamentoParaOCliente("APROVADO", "20/09/2026").frase).toBe("Aprovado em 20/09/2026");
    expect(andamentoParaOCliente("NEGADO", "01/09/2026").frase).toBe("Não aprovado nesta tentativa");
    expect(andamentoParaOCliente("ENCERRADO", null).frase).toBe("Encerrado");
  });

  it("nenhuma frase diz 'negado', 'inapto' nem fala de dinheiro", () => {
    for (const s of STATUS_CREDENCIAMENTO) {
      const { frase } = andamentoParaOCliente(s, "01/01/2026");
      expect(frase.toLowerCase()).not.toMatch(/negad|inapt|r\$|honor/);
    }
  });

  it("sem data, a frase não fica pela metade", () => {
    expect(andamentoParaOCliente("PROTOCOLADO", null).frase).toBe("Protocolado");
    expect(andamentoParaOCliente("EM_ANALISE", null).frase).toBe("Em análise pela operadora");
  });

  it("o marco é a data da situação atual, e só dela", () => {
    const d = (n: number) => new Date(2026, 8, n);
    const linha = { protocoladoEm: d(1), emAnaliseEm: d(5), aprovadoEm: d(9) };
    expect(marcoDoAndamento({ ...linha, status: "PROTOCOLADO" })).toEqual(d(1));
    expect(marcoDoAndamento({ ...linha, status: "EM_ANALISE" })).toEqual(d(5));
    expect(marcoDoAndamento({ ...linha, status: "APROVADO" })).toEqual(d(9));
    expect(marcoDoAndamento({ ...linha, status: "NEGADO" })).toBeNull();
    expect(marcoDoAndamento({ ...linha, status: "A_PROTOCOLAR" })).toBeNull();
  });
});

describe("dados para pagamento — a mesma regra do vazio no Portal e na proposta", () => {
  it("linha em branco some, e as duas formas concordam", () => {
    const d = { bancoNome: "Nubank", bancoAgencia: "  ", bancoConta: null, bancoTitular: "Thais", pixChave: "34.270.022/0001-93" };
    expect(linhasDadosPagamento(d)).toEqual([
      { rotulo: "Banco", valor: "Nubank" },
      { rotulo: "Titular", valor: "Thais" },
      { rotulo: "Chave PIX", valor: "34.270.022/0001-93" },
    ]);
    expect(montarDadosPagamento(d).split("\n")).toHaveLength(2 + 3);
  });

  it("tudo em branco = lista vazia (a tela não desenha 'Chave PIX:' sem chave)", () => {
    const vazio = { bancoNome: null, bancoAgencia: "", bancoConta: undefined, bancoTitular: " ", pixChave: null };
    expect(linhasDadosPagamento(vazio)).toEqual([]);
    expect(montarDadosPagamento(vazio)).toBe("");
  });
});

describe("descrição da conta vista pelo cliente", () => {
  it("tira o nome da própria clínica só quando ele é o SUFIXO", () => {
    expect(descricaoParaOCliente("Faturamento — Clínica X", "Clínica X")).toBe("Faturamento");
    expect(descricaoParaOCliente("Clínica X — ajuste", "Clínica X")).toBe("Clínica X — ajuste");
    expect(descricaoParaOCliente("Faturamento", null)).toBe("Faturamento");
    // A descrição nunca some inteira.
    expect(descricaoParaOCliente(" — Clínica X", "Clínica X")).toBe("— Clínica X");
  });
});

describe("aviso de pendência nova — a régua", () => {
  const p = (chave: string): Pendencia => ({ chave, rotulo: chave, onde: "documentos" });

  it("sem aviso anterior, só marca a base (a primeira vez é calada)", () => {
    expect(planejarAvisoDePendencias([p("a"), p("b")], null)).toEqual({ acao: "MARCAR_BASE" });
  });

  it("avisa só do que não estava no último aviso", () => {
    const plano = planejarAvisoDePendencias([p("a"), p("b"), p("c")], { chaves: ["a", "b"] });
    expect(plano).toEqual({ acao: "AVISAR", novas: [p("c")] });
  });

  it("nada novo (inclusive quando algo foi ENTREGUE) = nada a fazer", () => {
    expect(planejarAvisoDePendencias([p("a")], { chaves: ["a", "b"] })).toEqual({ acao: "NADA" });
    expect(planejarAvisoDePendencias([], { chaves: ["a"] })).toEqual({ acao: "NADA" });
  });

  it("no máximo um aviso por dia", () => {
    const agora = new Date("2026-09-24T12:00:00Z");
    expect(podeAvisarDeNovo(null, agora)).toBe(true);
    expect(podeAvisarDeNovo(new Date(agora.getTime() - INTERVALO_MINIMO_MS + 1), agora)).toBe(false);
    expect(podeAvisarDeNovo(new Date(agora.getTime() - INTERVALO_MINIMO_MS), agora)).toBe(true);
  });
});

describe("categoria de e-mail só para o cliente", () => {
  const base = {
    tipo: "pendencia_documentos_cliente",
    email: "alguem@example.test",
    ativo: true,
    excluido: false,
    preferencia: null,
    emailDoSistema: "root@medconsultoria.com.br",
  };

  it("o cliente recebe por padrão", () => {
    expect(decidirEmailOperacional({ ...base, role: "CLIENTE" })).toBe(true);
  });

  it("ninguém da equipe recebe, nem ligando a preferência à mão", () => {
    for (const role of ["FUNCIONARIO", "ADMIN", "ROOT"] as const) {
      expect(decidirEmailOperacional({ ...base, role, preferencia: true })).toBe(false);
    }
  });

  it("o cliente que desligou não recebe", () => {
    expect(decidirEmailOperacional({ ...base, role: "CLIENTE", preferencia: false })).toBe(false);
  });
});
