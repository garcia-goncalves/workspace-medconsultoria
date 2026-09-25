import { describe, it, expect } from "vitest";
import { agruparChave, textoDosCodigos } from "./segundo-fator-texto";

describe("agruparChave", () => {
  it("separa a chave em blocos de 4, sem espaço sobrando no fim", () => {
    expect(agruparChave("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
    expect(agruparChave("ABCDEF")).toBe("ABCD EF");
    expect(agruparChave("")).toBe("");
  });
});

describe("textoDosCodigos", () => {
  it("leva os códigos e o aviso de uso único", () => {
    const t = textoDosCodigos(["AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH"]);
    expect(t).toContain("AAAA-BBBB-CCCC-DDDD\nEEEE-FFFF-GGGG-HHHH");
    expect(t).toContain("UMA vez");
  });
});
