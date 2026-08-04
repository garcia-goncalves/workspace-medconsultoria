import { describe, it, expect, beforeAll } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";

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

  it("chave trocada pede reconexão, em vez de vazar o erro cru do GCM", async () => {
    // Acontece de verdade: rotacionar EMAIL_CRYPTO_KEY (ou plugar a caixa com uma chave e
    // subir o servidor com outra) deixa todo segredo guardado ilegível. O erro do Node é
    // "Unsupported state or unable to authenticate data" — que chegava à tela como um 500
    // com stack, sem dizer à pessoa a única coisa que resolve: reconectar a caixa.
    const { decifrar } = await import("./cripto-caixa.js");
    // Segredo gravado com OUTRA chave, no mesmo formato v1 (a chave em uso já foi congelada
    // pelo config no boot, então não adianta mexer no process.env aqui).
    const outraChave = randomBytes(32);
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", outraChave, iv);
    const cifrado = Buffer.concat([c.update("senha-antiga", "utf8"), c.final()]);
    const guardado = ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), cifrado.toString("base64")].join(
      ":",
    );

    expect(() => decifrar(guardado)).toThrow(/reconect/i);
    expect(() => decifrar(guardado)).not.toThrow(/Unsupported state/i);
  });
});
