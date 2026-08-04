import { describe, it, expect } from "vitest";
import { sep } from "node:path";
import { pastaTemp, caminhoTemp } from "./email-anexo.js";

describe("caminhoTemp (defesa contra travessia de caminho)", () => {
  const userId = "cku1abc123xyz";
  const uuid = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

  it("aceita um UUID válido e devolve caminho dentro da pasta temp do usuário", () => {
    const caminho = caminhoTemp(userId, uuid);
    expect(caminho.startsWith(pastaTemp(userId) + sep)).toBe(true);
    expect(caminho.endsWith(uuid)).toBe(true);
  });

  it("aceita UUID em maiúsculas (o formato de UUID gerado por randomUUID é sempre minúsculo, mas o formato em si não é sensível a caixa)", () => {
    expect(() => caminhoTemp(userId, uuid.toUpperCase())).not.toThrow();
  });

  it("recusa id vazio", () => {
    expect(() => caminhoTemp(userId, "")).toThrow(/inválido/i);
  });

  it("recusa travessia de caminho (../../etc/passwd)", () => {
    expect(() => caminhoTemp(userId, "../../../../etc/passwd")).toThrow(/inválido/i);
  });

  it("recusa id com barra", () => {
    expect(() => caminhoTemp(userId, "../outro-usuario/segredo")).toThrow(/inválido/i);
  });

  it("recusa id com ponto (não é hex nem hífen)", () => {
    expect(() => caminhoTemp(userId, "3fa85f64-5717-4562-b3fc-2c963f66afa.")).toThrow(/inválido/i);
  });

  it("recusa id curto demais ou longo demais", () => {
    expect(() => caminhoTemp(userId, "abc")).toThrow(/inválido/i);
    expect(() => caminhoTemp(userId, uuid + "a")).toThrow(/inválido/i);
  });

  it("o caminho resolvido nunca escapa da pasta temp do usuário, mesmo com id válido", () => {
    // Defesa em profundidade: mesmo que o regex de formato mude no futuro, o prefixo
    // resolvido tem de ficar sempre dentro de `pastaTemp(userId)`.
    const caminho = caminhoTemp(userId, uuid);
    const raiz = pastaTemp(userId);
    expect(caminho === raiz || caminho.startsWith(raiz + sep)).toBe(true);
  });
});
