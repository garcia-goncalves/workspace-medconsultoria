import { describe, it, expect } from "vitest";
import {
  criarPropostaPersonalizadaSchema,
  itemPropostaPersonalizadaSchema,
  montarBlocoPersonalizado,
  aplicarMolduraPersonalizada,
  resumoInvestimentoPersonalizado,
  PRECO_VALOR_E_PERCENTUAL,
  TEXTO_COM_MARCADOR,
  type ItemPersonalizadoResolvido,
} from "@app/shared";

/**
 * A proposta PERSONALIZADA (ADR-156): o coringa com tudo livre — itens do catálogo, linhas
 * avulsas, seções e cláusulas escritas à mão. O que estes testes guardam é o que o papel que vai
 * ao cliente NÃO pode ter: marcador cru, "(a preencher)", conta errada, e o preço dizendo duas
 * coisas ao mesmo tempo.
 */

// O `Intl` do Node separa "R$" do número com espaço fixo (U+00A0): comparar com espaço comum
// reprovaria um texto certo.
const semNbsp = (s: string) => s.split(String.fromCharCode(160)).join(" ");

const MOLDURA = `**Proposta {{numero}}** · **Data:** {{data}}

Prezado(a) {{cliente.nome}},

{{personalizado}}

Atenciosamente,
**{{consultora}}**`;

const itens: ItemPersonalizadoResolvido[] = [
  { nome: "Gestão Operacional", detalhe: "Rotina administrativa da clínica", valor: 3500, quantidade: 1, recorrencia: "MENSAL" },
  { nome: "Treinamento da recepção", valor: 400, quantidade: 3, recorrencia: "AVULSO" },
  { nome: "Faturamento", valor: 0, quantidade: 1, recorrencia: "MENSAL", percentual: 5 },
];

describe("o resumo do investimento", () => {
  it("soma à vista e mensal separados, e lista o percentual à parte", () => {
    const r = resumoInvestimentoPersonalizado(itens);
    expect(r.avulso).toBe(1200);
    expect(r.mensal).toBe(3500);
    expect(r.percentuais).toEqual([{ nome: "Faturamento", percentual: 5 }]);
  });

  it("não acumula lixo de ponto flutuante nos centavos", () => {
    const r = resumoInvestimentoPersonalizado([
      { nome: "a", valor: 0.1, quantidade: 1, recorrencia: "AVULSO" },
      { nome: "b", valor: 0.2, quantidade: 1, recorrencia: "AVULSO" },
    ]);
    expect(r.avulso).toBe(0.3);
  });
});

describe("o texto gerado da proposta personalizada", () => {
  const bloco = montarBlocoPersonalizado({
    secoes: [
      { titulo: "Apresentação", corpo: "Cuidamos da sua clínica." },
      { titulo: "Seção vazia", corpo: "   " },
      { titulo: "Escopo", corpo: "- Item um\n- Item dois" },
    ],
    itens,
    clausulas: ["O pagamento é feito por PIX.", "A proposta pode ser revista a cada 12 meses."],
    validadeDias: 15,
    observacoes: "Valores revistos em janeiro.",
    dadosPagamento: "| | |\n| --- | --- |\n| Chave PIX | 34.270.022/0001-93 |",
    fraseRepasse: "O repasse é pago após o crédito.",
  });
  const doc = semNbsp(
    aplicarMolduraPersonalizada(MOLDURA, { numero: "0231", data: "23/09/2026", clienteNome: "Clínica Vida", consultora: "Thaís" }, bloco),
  );

  it("nunca deixa marcador cru nem '(a preencher)'", () => {
    expect(doc).not.toMatch(/\{\{|\}\}/);
    expect(doc).not.toMatch(/a preencher/i);
  });

  it("preenche a moldura com número, data, cliente e consultora", () => {
    expect(doc).toContain("**Proposta 0231**");
    expect(doc).toContain("23/09/2026");
    expect(doc).toContain("Prezado(a) Clínica Vida,");
    expect(doc).toContain("**Thaís**");
  });

  it("as seções saem na ordem dada, e a vazia não vira título solto", () => {
    expect(doc.indexOf("## Apresentação")).toBeLessThan(doc.indexOf("## Escopo"));
    expect(doc).not.toContain("Seção vazia");
  });

  it("a tabela mostra avulso, mensal e percentual, com o total certo", () => {
    expect(doc).toContain("| **Gestão Operacional**<br>Rotina administrativa da clínica | R$ 3.500,00/mês |");
    expect(doc).toContain("| **Treinamento da recepção** | 3 × R$ 400,00 = R$ 1.200,00 |");
    expect(doc).toContain("| **Faturamento** | 5% do faturamento mensal |");
    expect(doc).toContain("| **Total** | **R$ 1.200,00 (1x) + R$ 3.500,00/mês + percentual sobre o faturamento** |");
  });

  it("frase do repasse, validade, PIX, cláusulas numeradas, observações e dados bancários", () => {
    expect(doc).toContain("O repasse é pago após o crédito.");
    expect(doc).toContain("válida por 15 dias");
    expect(doc).toContain("PIX");
    expect(doc).toContain("1. O pagamento é feito por PIX.");
    expect(doc).toContain("2. A proposta pode ser revista a cada 12 meses.");
    expect(doc).toContain("Valores revistos em janeiro.");
    expect(doc).toContain("| Chave PIX | 34.270.022/0001-93 |");
  });

  it("sem itens com valor, o total diz 'a combinar' — nunca R$ 0,00", () => {
    const b = semNbsp(
      montarBlocoPersonalizado({
        secoes: [],
        itens: [{ nome: "Serviço sob medida", valor: 0, quantidade: 1, recorrencia: "AVULSO" }],
        clausulas: [],
        validadeDias: 10,
      }),
    );
    expect(b).toContain("| **Serviço sob medida** | a combinar |");
    expect(b).toContain("| **Total** | **a combinar** |");
    expect(b).not.toContain("R$ 0,00");
  });

  it("linha avulsa com barra vertical ou quebra de linha não entorta a tabela", () => {
    const b = montarBlocoPersonalizado({
      secoes: [],
      itens: [{ nome: "Plano A | B\nextra", valor: 10, quantidade: 1, recorrencia: "AVULSO" }],
      clausulas: [],
      validadeDias: 10,
    });
    expect(b).toContain("Plano A \\| B extra");
  });

  it("moldura sem o marcador recebe o bloco no fim, e marcador desconhecido some", () => {
    const d = aplicarMolduraPersonalizada("Olá {{cliente.nome}} {{outra_coisa}}", { numero: "1", data: "x", clienteNome: "C", consultora: "T" }, "BLOCO");
    expect(d).toBe("Olá C \n\nBLOCO");
  });

  it("valor que contém o marcador NÃO é reprocessado (nome vindo do formulário público)", () => {
    const d = aplicarMolduraPersonalizada("{{cliente.nome}} {{personalizado}}", { numero: "1", data: "x", clienteNome: "{{personalizado}}", consultora: "T" }, "BLOCO");
    expect(d.match(/BLOCO/g)).toHaveLength(1);
  });
});

describe("o schema da proposta personalizada", () => {
  const base = { clienteId: "c1", itens: [{ descricao: "Linha avulsa", valor: 100 }] };

  it("aceita cliente com linha avulsa e aplica os padrões (PIX, 15 dias, AVULSO)", () => {
    const r = criarPropostaPersonalizadaSchema.parse(base);
    expect(r.formaPagamento).toBe("PIX");
    expect(r.validadeDias).toBe(15);
    expect(r.itens[0]!.recorrencia).toBe("AVULSO");
  });

  it("exige UM destino: cliente OU lead, nunca os dois nem nenhum", () => {
    expect(criarPropostaPersonalizadaSchema.safeParse({ itens: base.itens }).success).toBe(false);
    expect(criarPropostaPersonalizadaSchema.safeParse({ ...base, leadId: "l1" }).success).toBe(false);
    expect(criarPropostaPersonalizadaSchema.safeParse({ leadId: "l1", itens: base.itens }).success).toBe(true);
  });

  it("recusa valor fixo E percentual na mesma linha", () => {
    const r = itemPropostaPersonalizadaSchema.safeParse({ descricao: "x", valor: 100, percentual: 5 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(PRECO_VALOR_E_PERCENTUAL);
  });

  it("linha sem serviço do catálogo precisa de descrição", () => {
    expect(itemPropostaPersonalizadaSchema.safeParse({ valor: 100 }).success).toBe(false);
    expect(itemPropostaPersonalizadaSchema.safeParse({ servicoId: "s1", valor: 100 }).success).toBe(true);
  });

  it("proposta vazia (sem item e sem seção com texto) é recusada", () => {
    expect(criarPropostaPersonalizadaSchema.safeParse({ clienteId: "c1", secoes: [{ titulo: "A", corpo: "" }] }).success).toBe(false);
    expect(criarPropostaPersonalizadaSchema.safeParse({ clienteId: "c1", secoes: [{ titulo: "A", corpo: "texto" }] }).success).toBe(true);
  });

  it("forma de pagamento só PIX (ADR-127)", () => {
    expect(criarPropostaPersonalizadaSchema.safeParse({ ...base, formaPagamento: "BOLETO" }).success).toBe(false);
  });

  it("texto com chaves duplas é recusado, dizendo por quê", () => {
    const r = criarPropostaPersonalizadaSchema.safeParse({ ...base, clausulas: ["Vale {{valor}}"] });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain(TEXTO_COM_MARCADOR);
  });
});
