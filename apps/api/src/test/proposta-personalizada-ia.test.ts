import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * O assistente de IA do Personalizado (ADR-156) passa pela PORTA ÚNICA — `aiService.gerarRascunho`,
 * onde mora a peneira de dado pessoal (ADR-141) — e nunca grava nada. Aqui a IA é simulada: o que
 * se prova é o caminho, não a qualidade do texto.
 */

const estado = vi.hoisted(() => ({ ia: true }));
const mocks = vi.hoisted(() => ({
  gerarRascunho: vi.fn(),
  clienteFindFirst: vi.fn(),
  servicoFindMany: vi.fn(),
  documentoCreate: vi.fn(),
}));

vi.mock("../config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../config.js")>();
  return {
    ...original,
    get isAiEnabled() {
      return estado.ia;
    },
  };
});
vi.mock("../lib/ai.js", () => ({ aiService: { gerarRascunho: mocks.gerarRascunho, transcrever: vi.fn() } }));
vi.mock("@app/db", () => ({
  prisma: {
    cliente: { findFirst: mocks.clienteFindFirst },
    servico: { findMany: mocks.servicoFindMany },
    // Se o assistente tentasse gravar, cairia aqui — e o teste confere que não caiu.
    documento: { create: mocks.documentoCreate },
  },
}));

const { assistentePersonalizado, secoesDoMarkdown } = await import("../modules/documentos/proposta-personalizada.service.js");

beforeEach(() => {
  estado.ia = true;
  for (const m of Object.values(mocks)) m.mockReset();
});

describe("assistente do Personalizado — sempre pela porta única da IA", () => {
  it("sugerirSecoes chama gerarRascunho e devolve as seções, sem gravar nada", async () => {
    mocks.clienteFindFirst.mockResolvedValue({ nome: "Clínica Vida" });
    mocks.gerarRascunho.mockResolvedValue("```markdown\n## Diagnóstico\n\nLevantamos a rotina.\n\n## Escopo\n\n- Agenda\n- {{x}}Recepção\n```");

    const r = await assistentePersonalizado({ acao: "sugerirSecoes", resumo: "Clínica com agenda caótica", clienteId: "c1" });

    expect(mocks.gerarRascunho).toHaveBeenCalledTimes(1);
    const [, pedido] = mocks.gerarRascunho.mock.calls[0]!;
    expect(pedido).toContain("Clínica com agenda caótica");
    expect(pedido).toContain("Clínica Vida");
    expect(r).toEqual({
      acao: "sugerirSecoes",
      secoes: [
        { titulo: "Diagnóstico", corpo: "Levantamos a rotina." },
        // a chave dupla que a IA devolveu é limpa — o schema a recusaria na hora de gerar
        { titulo: "Escopo", corpo: "- Agenda\n- xRecepção" },
      ],
    });
    expect(mocks.documentoCreate).not.toHaveBeenCalled();
  });

  it("redigirClausula e revisarTexto devolvem o texto da IA", async () => {
    mocks.gerarRascunho.mockResolvedValueOnce("A MedConsultoria guarda sigilo.").mockResolvedValueOnce("Texto revisado.");
    expect(await assistentePersonalizado({ acao: "redigirClausula", pedido: "sigilo" })).toEqual({
      acao: "redigirClausula",
      texto: "A MedConsultoria guarda sigilo.",
    });
    expect(await assistentePersonalizado({ acao: "revisarTexto", texto: "texo com eru" })).toEqual({
      acao: "revisarTexto",
      texto: "Texto revisado.",
    });
    expect(mocks.gerarRascunho).toHaveBeenCalledTimes(2);
    expect(mocks.gerarRascunho.mock.calls[1]![1]).toContain("texo com eru");
  });

  it("resumirInvestimento: a CONTA é do código, a IA só recebe os números prontos", async () => {
    mocks.gerarRascunho.mockResolvedValue("O investimento é de R$ 1.200,00.");
    const r = await assistentePersonalizado({
      acao: "resumirInvestimento",
      itens: [{ descricao: "Treinamento", valor: 400, quantidade: 3, recorrencia: "AVULSO" }],
    });
    expect(r.acao === "resumirInvestimento" && r.totais.avulso).toBe(1200);
    expect(mocks.gerarRascunho.mock.calls[0]![1]).toMatch(/Total à vista: R\$\s1\.200,00/);
    expect(mocks.servicoFindMany).not.toHaveBeenCalled(); // só linha avulsa: nada a buscar
  });

  it("IA desligada: recusa com PRECONDITION_FAILED e NÃO chama o provedor", async () => {
    estado.ia = false;
    await expect(assistentePersonalizado({ acao: "revisarTexto", texto: "x" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mocks.gerarRascunho).not.toHaveBeenCalled();
  });
});

describe("seções a partir do Markdown da IA", () => {
  it("sem título nenhum, o texto inteiro vira UMA seção", () => {
    expect(secoesDoMarkdown("Só um parágrafo.")).toEqual([{ titulo: "Sugestão", corpo: "Só um parágrafo." }]);
  });
  it("seção sem corpo é descartada", () => {
    expect(secoesDoMarkdown("## Vazia\n\n## Cheia\ntexto")).toEqual([{ titulo: "Cheia", corpo: "texto" }]);
  });
});
