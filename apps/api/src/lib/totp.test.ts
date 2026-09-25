import { describe, it, expect } from "vitest";
import {
  base32Codificar,
  base32Decodificar,
  codigoDoPasso,
  conferirCodigoTotp,
  passoDoInstante,
  uriOtpauth,
  gerarSegredoTotp,
} from "./totp";

// Segredo dos vetores do RFC 6238, apêndice B (SHA1): o ASCII "12345678901234567890".
const SEGREDO_RFC = Buffer.from("12345678901234567890", "ascii");

describe("TOTP — vetores oficiais do RFC 6238 (SHA1, 8 dígitos)", () => {
  const vetores: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [t, esperado] of vetores) {
    it(`T=${t} → ${esperado}`, () => {
      expect(codigoDoPasso(SEGREDO_RFC, passoDoInstante(t * 1000), 8)).toBe(esperado);
    });
  }

  it("com 6 dígitos devolve os 6 finais do vetor (é o que o aplicativo mostra)", () => {
    expect(codigoDoPasso(SEGREDO_RFC, passoDoInstante(59_000))).toBe("287082");
    expect(codigoDoPasso(SEGREDO_RFC, passoDoInstante(1234567890_000))).toBe("005924");
  });
});

describe("Base32 — vetores do RFC 4648 (sem preenchimento)", () => {
  const vetores: Array<[string, string]> = [
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ];
  for (const [txt, b32] of vetores) {
    it(`"${txt}" ↔ "${b32}"`, () => {
      expect(base32Codificar(Buffer.from(txt))).toBe(b32);
      expect(base32Decodificar(b32).toString()).toBe(txt);
    });
  }

  it("decodifica o que a pessoa cola: minúscula, espaço, hífen e `=`", () => {
    expect(base32Decodificar("mzxw 6ytb-oi======").toString()).toBe("foobar");
  });

  it("recusa caractere fora do alfabeto em vez de decodificar pela metade", () => {
    expect(() => base32Decodificar("MZXW1")).toThrow();
  });

  it("ida e volta de um segredo sorteado", () => {
    const s = gerarSegredoTotp();
    expect(s.length).toBe(20);
    expect(base32Decodificar(base32Codificar(s)).equals(s)).toBe(true);
  });
});

describe("conferirCodigoTotp — janela e anti-replay", () => {
  const agora = 1_800_000_000_000;
  const passo = passoDoInstante(agora);
  const codigo = (p: number) => codigoDoPasso(SEGREDO_RFC, p);

  it("aceita o código do passo atual e devolve o passo", () => {
    expect(conferirCodigoTotp(SEGREDO_RFC, codigo(passo), agora, null)).toBe(passo);
  });

  it("tolera ±1 passo (relógio do celular adiantado/atrasado)", () => {
    expect(conferirCodigoTotp(SEGREDO_RFC, codigo(passo - 1), agora, null)).toBe(passo - 1);
    expect(conferirCodigoTotp(SEGREDO_RFC, codigo(passo + 1), agora, null)).toBe(passo + 1);
  });

  it("recusa código de 2 passos atrás (antigo)", () => {
    expect(conferirCodigoTotp(SEGREDO_RFC, codigo(passo - 2), agora, null)).toBeNull();
  });

  it("recusa REUSO: passo igual ou anterior ao último aceito", () => {
    expect(conferirCodigoTotp(SEGREDO_RFC, codigo(passo), agora, passo)).toBeNull();
    expect(conferirCodigoTotp(SEGREDO_RFC, codigo(passo - 1), agora, passo)).toBeNull();
    expect(conferirCodigoTotp(SEGREDO_RFC, codigo(passo + 1), agora, passo)).toBe(passo + 1);
  });

  it("recusa formato inválido e código errado", () => {
    expect(conferirCodigoTotp(SEGREDO_RFC, "12345", agora, null)).toBeNull();
    expect(conferirCodigoTotp(SEGREDO_RFC, "abcdef", agora, null)).toBeNull();
    const errado = codigo(passo) === "000000" ? "000001" : "000000";
    expect(conferirCodigoTotp(SEGREDO_RFC, errado, agora, null)).toBeNull();
  });

  it("aceita o código com espaço no meio (\"123 456\", como o aplicativo mostra)", () => {
    const c = codigo(passo);
    expect(conferirCodigoTotp(SEGREDO_RFC, `${c.slice(0, 3)} ${c.slice(3)}`, agora, null)).toBe(passo);
  });
});

describe("uriOtpauth", () => {
  it("traz emissor no rótulo e no parâmetro, e os parâmetros fixos", () => {
    const uri = uriOtpauth("JBSWY3DPEHPK3PXP", "thais@medconsultoria.com.br");
    expect(uri.startsWith("otpauth://totp/MedConsultoria:thais%40medconsultoria.com.br?")).toBe(true);
    const q = new URL(uri).searchParams;
    expect(q.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(q.get("issuer")).toBe("MedConsultoria");
    expect(q.get("digits")).toBe("6");
    expect(q.get("period")).toBe("30");
    expect(q.get("algorithm")).toBe("SHA1");
  });
});
