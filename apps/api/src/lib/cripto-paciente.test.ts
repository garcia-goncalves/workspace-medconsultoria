import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

// As chaves precisam existir ANTES de o config.ts ser importado (ele valida no boot).
beforeAll(() => {
  process.env.EMAIL_CRYPTO_KEY = randomBytes(32).toString("base64");
  process.env.PACIENTE_CRYPTO_KEY = randomBytes(32).toString("base64");
});

describe("cripto-paciente", () => {
  it("decifra de volta o que cifrou", async () => {
    const { cifrarDadoPaciente, decifrarDadoPaciente } = await import("./cripto-paciente.js");
    const cpf = "123.456.789-09";
    const guardado = cifrarDadoPaciente(cpf);
    expect(guardado).not.toBeNull();
    expect(decifrarDadoPaciente(guardado!)).toBe(cpf);
  });

  it("não guarda nada quando a coluna vem vazia", async () => {
    const { cifrarDadoPaciente } = await import("./cripto-paciente.js");
    // O relatório traz linha sem e-mail e sem telefone o tempo todo. Cifrar "" gastaria espaço
    // e faria a coluna parecer preenchida.
    expect(cifrarDadoPaciente("")).toBeNull();
    expect(cifrarDadoPaciente("   ")).toBeNull();
    expect(cifrarDadoPaciente(null)).toBeNull();
    expect(cifrarDadoPaciente(undefined)).toBeNull();
  });

  it("o mesmo CPF cifra diferente a cada vez (IV aleatório)", async () => {
    const { cifrarDadoPaciente } = await import("./cripto-paciente.js");
    expect(cifrarDadoPaciente("12345678909")).not.toBe(cifrarDadoPaciente("12345678909"));
  });

  it("o apelido do CPF é estável — é ele que casa o paciente entre relatórios", async () => {
    const { apelidoCpf } = await import("./cripto-paciente.js");
    expect(apelidoCpf("12345678909")).toBe(apelidoCpf("12345678909"));
  });

  it("o apelido ignora pontuação: o mesmo CPF formatado de dois jeitos casa", async () => {
    const { apelidoCpf } = await import("./cripto-paciente.js");
    // Este é o defeito que a normalização evita: produção manda "123.456.789-09" e o repasse
    // manda "12345678909". Sem isto, a conciliação não cruzaria e ninguém saberia por quê.
    expect(apelidoCpf("123.456.789-09")).toBe(apelidoCpf("12345678909"));
    expect(apelidoCpf(" 123 456 789 09 ")).toBe(apelidoCpf("12345678909"));
  });

  it("CPFs diferentes têm apelidos diferentes", async () => {
    const { apelidoCpf } = await import("./cripto-paciente.js");
    expect(apelidoCpf("12345678909")).not.toBe(apelidoCpf("98765432100"));
  });

  it("sem CPF não há apelido", async () => {
    const { apelidoCpf } = await import("./cripto-paciente.js");
    expect(apelidoCpf("")).toBeNull();
    expect(apelidoCpf("---")).toBeNull();
    expect(apelidoCpf(null)).toBeNull();
  });

  it("o apelido NÃO é o SHA-256 do CPF — hash puro de CPF se quebra por força bruta", async () => {
    const { createHash } = await import("node:crypto");
    const { apelidoCpf } = await import("./cripto-paciente.js");
    const shaPuro = createHash("sha256").update("12345678909", "utf8").digest("hex");
    expect(apelidoCpf("12345678909")).not.toBe(shaPuro);
  });

  it("cifra e apelido usam subchaves distintas da mesma env", async () => {
    const { apelidoHmac, cifrarCom, lerChave, subchave } = await import("./cripto.js");
    const { apelidoCpf } = await import("./cripto-paciente.js");
    const raiz = lerChave(process.env.PACIENTE_CRYPTO_KEY, "PACIENTE_CRYPTO_KEY", "falta");
    // Usar a raiz crua no HMAC daria outro resultado que o apelido — prova que houve derivação.
    expect(apelidoCpf("12345678909")).not.toBe(apelidoHmac(raiz, "12345678909"));
    expect(apelidoCpf("12345678909")).toBe(apelidoHmac(subchave(raiz, "conciliacao:paciente:apelido"), "12345678909"));
    expect(typeof cifrarCom(subchave(raiz, "conciliacao:paciente:cifra"), "x")).toBe("string");
  });

  it("recusa conteúdo adulterado (GCM detecta)", async () => {
    const { cifrarDadoPaciente, decifrarDadoPaciente } = await import("./cripto-paciente.js");
    const partes = cifrarDadoPaciente("12345678909")!.split(":");
    const cifrado = Buffer.from(partes[3]!, "base64");
    cifrado[0] = cifrado[0]! ^ 0xff;
    partes[3] = cifrado.toString("base64");
    expect(() => decifrarDadoPaciente(partes.join(":"))).toThrow();
  });

  it("chave trocada diz para reimportar, em vez de vazar o erro cru do GCM", async () => {
    const { createCipheriv } = await import("node:crypto");
    const { decifrarDadoPaciente } = await import("./cripto-paciente.js");
    // Dado gravado com OUTRA chave, no mesmo formato v1 (a chave em uso já foi congelada pelo
    // config no boot, então não adianta mexer no process.env aqui).
    const outraChave = randomBytes(32);
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", outraChave, iv);
    const cifrado = Buffer.concat([c.update("12345678909", "utf8"), c.final()]);
    const guardado = ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), cifrado.toString("base64")].join(":");

    expect(() => decifrarDadoPaciente(guardado)).toThrow(/reimporte/i);
    expect(() => decifrarDadoPaciente(guardado)).not.toThrow(/Unsupported state/i);
  });

  it("a senha da caixa de e-mail NÃO abre com a chave do paciente (domínios isolados)", async () => {
    // O motivo de existirem duas envs: rotacionar a do paciente não pode derrubar o e-mail de
    // ninguém. Se um dia alguém "simplificar" reusando a mesma chave, este teste reprova.
    const { cifrar } = await import("./cripto-caixa.js");
    const { decifrarDadoPaciente } = await import("./cripto-paciente.js");
    expect(() => decifrarDadoPaciente(cifrar("senha-da-caixa"))).toThrow();
  });
});
