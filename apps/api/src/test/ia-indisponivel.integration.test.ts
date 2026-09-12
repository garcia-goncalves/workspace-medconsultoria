import { describe, it, expect, afterEach, afterAll, vi } from "vitest";

// Bloco 9 — IA INDISPONÍVEL (estados B e C), automatizado sem reinício manual do app.
// `isAiEnabled` é derivado do config no load; re-lemos o módulo (vi.resetModules) com o
// process.env ajustado para exercer cada estado de verdade, e conferimos o gate (exigirIA/getClient).
// O estado A (chave real, chamada externa) fica em e2e-integration/ia-estado-a.spec.ts.

const KEY_ORIG = process.env.GEMINI_API_KEY;
const IAEN_ORIG = process.env.IA_ENABLED;

function restoreEnv() {
  if (KEY_ORIG === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = KEY_ORIG;
  if (IAEN_ORIG === undefined) delete process.env.IA_ENABLED;
  else process.env.IA_ENABLED = IAEN_ORIG;
}

afterEach(() => {
  vi.resetModules();
  restoreEnv();
});

afterAll(() => {
  restoreEnv();
});

describe("IA indisponível — gate sem chave / desligada (estados B e C)", () => {
  it("Estado B (sem GEMINI_API_KEY): isAiEnabled=false; gerarRascunho e as sugestões falham com erro claro", async () => {
    vi.resetModules();
    delete process.env.GEMINI_API_KEY;
    delete process.env.IA_ENABLED;

    const { isAiEnabled } = await import("../config.js");
    expect(isAiEnabled).toBe(false);

    // `perguntar` chama gerarRascunho direto → getClient() lança antes de qualquer chamada externa.
    const { aiService } = await import("../lib/ai.js");
    await expect(aiService.gerarRascunho("s", "u")).rejects.toThrow(/IA não configurada/i);

    // As sugestões passam por exigirIA() → PRECONDITION_FAILED antes de tocar o banco/OpenAI.
    const svc = await import("../modules/ia/ia.service.js");
    await expect(svc.resumoDoDia("qualquer-user", "ADMIN")).rejects.toThrow(/IA não configurada/i);
    await expect(svc.sugerirRequisitos("qualquer-servico")).rejects.toThrow(/IA não configurada/i);
    await expect(svc.diagnosticoSistema()).rejects.toThrow(/IA não configurada/i);
  });

  it("Estado C (IA_ENABLED=false com chave presente): interruptor global desliga a IA", async () => {
    vi.resetModules();
    process.env.GEMINI_API_KEY = "chave-dummy"; // valor fictício — só precisa ser truthy
    process.env.IA_ENABLED = "false";

    const { isAiEnabled } = await import("../config.js");
    expect(isAiEnabled, "IA_ENABLED=false desliga mesmo com chave").toBe(false);

    const svc = await import("../modules/ia/ia.service.js");
    await expect(svc.sugerirCampos("Briefing")).rejects.toThrow(/IA não configurada/i);
  });

  it("Estado A (chave presente e não desligada): isAiEnabled=true (habilita o gate)", async () => {
    vi.resetModules();
    process.env.GEMINI_API_KEY = "chave-dummy"; // valor fictício — só precisa ser truthy
    delete process.env.IA_ENABLED;

    const { isAiEnabled } = await import("../config.js");
    expect(isAiEnabled).toBe(true);
  });
});
