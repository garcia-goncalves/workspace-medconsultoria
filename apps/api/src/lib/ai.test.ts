import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * `lib/ai.ts` fala com o Gemini por REST puro (`fetch`), sem SDK — mesma escolha do motor de
 * teste da Cora (`cora-med`, ADR 0003 de lá): o servidor já não usa framework HTTP nenhum aqui,
 * então trazer um SDK novo só para isto seria peso morto. Estes testes mockam `global.fetch`
 * para não depender de rede nem de `GEMINI_API_KEY` real.
 */
const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  restoreEnv();
});

function respostaGemini(partes: Array<{ text: string; thought?: boolean }>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: partes } }] }),
  };
}

describe("gerarRascunho (Gemini, generateContent)", () => {
  it("extrai o texto da resposta e ignora partes de 'thought'", async () => {
    vi.resetModules();
    process.env.GEMINI_API_KEY = "chave-de-teste";
    delete process.env.IA_ENABLED;

    const fetchMock = vi.fn().mockResolvedValue(
      respostaGemini([
        { text: "raciocinando...", thought: true },
        { text: "Rascunho final do documento." },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { aiService } = await import("./ai.js");
    const resultado = await aiService.gerarRascunho("Você é um assistente.", "Escreva um resumo.");

    expect(resultado).toBe("Rascunho final do documento.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("generateContent");
    expect(url).toContain("chave-de-teste");
    const corpo = JSON.parse(init.body as string);
    expect(corpo.systemInstruction.parts[0].text).toContain("Você é um assistente.");
    expect(corpo.contents[0].parts[0].text).toContain("Escreva um resumo.");
  });

  it("concatena múltiplas partes de texto na ordem em que vieram", async () => {
    vi.resetModules();
    process.env.GEMINI_API_KEY = "chave-de-teste";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respostaGemini([{ text: "Parte um. " }, { text: "Parte dois." }])),
    );

    const { aiService } = await import("./ai.js");
    const resultado = await aiService.gerarRascunho("s", "u");
    expect(resultado).toBe("Parte um. Parte dois.");
  });

  it("erro HTTP (429, cota) vira mensagem clara, não o JSON cru da Google", async () => {
    vi.resetModules();
    process.env.GEMINI_API_KEY = "chave-de-teste";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: "Resource exhausted" } }),
      }),
    );

    const { aiService } = await import("./ai.js");
    await expect(aiService.gerarRascunho("s", "u")).rejects.toThrow(/429|cota|Resource exhausted/i);
  });

  it("resposta sem `candidates` (bloqueio de segurança, por exemplo) não quebra com erro cru", async () => {
    vi.resetModules();
    process.env.GEMINI_API_KEY = "chave-de-teste";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }) }),
    );

    const { aiService } = await import("./ai.js");
    await expect(aiService.gerarRascunho("s", "u")).rejects.toThrow(/SAFETY|resposta vazia|bloque/i);
  });
});
