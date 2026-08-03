import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

// A chave precisa existir ANTES de o config.ts ser importado (ele valida no boot).
beforeAll(() => {
  process.env.EMAIL_CRYPTO_KEY = randomBytes(32).toString("base64");
});

describe("cripto-caixa", () => {
  it("decifra de volta o que cifrou", async () => {
    const { cifrar, decifrar } = await import("./cripto-caixa.js");
    const segredo = "senha-da-caixa-com-acento-ção-e-símbolo-@#$";
    expect(decifrar(cifrar(segredo))).toBe(segredo);
  });

  it("gera saída diferente a cada chamada (IV aleatório)", async () => {
    const { cifrar } = await import("./cripto-caixa.js");
    expect(cifrar("igual")).not.toBe(cifrar("igual"));
  });

  it("recusa conteúdo adulterado (GCM detecta)", async () => {
    const { cifrar, decifrar } = await import("./cripto-caixa.js");
    const partes = cifrar("original").split(":");
    const cifrado = Buffer.from(partes[3]!, "base64");
    cifrado[0] = cifrado[0]! ^ 0xff;
    partes[3] = cifrado.toString("base64");
    expect(() => decifrar(partes.join(":"))).toThrow();
  });

  it("recusa formato de versão desconhecida", async () => {
    const { decifrar } = await import("./cripto-caixa.js");
    expect(() => decifrar("v9:a:b:c")).toThrow(/desconhecid/i);
  });
});
