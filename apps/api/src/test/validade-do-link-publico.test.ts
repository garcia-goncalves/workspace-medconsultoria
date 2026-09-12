import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DIAS_PARA_ABRIR,
  DIAS_APOS_RESPOSTA,
  situacaoDoLinkPublico,
  mensagemDeLinkExpirado,
} from "@app/shared";

const dia = 24 * 60 * 60 * 1000;
const emitido = new Date("2026-01-01T12:00:00Z");
const depois = (base: Date, dias: number) => new Date(base.getTime() + dias * dia);

describe("validade do link de proposta e de assinatura (ADR-141)", () => {
  it("vale nos primeiros 30 dias e morre depois", () => {
    expect(situacaoDoLinkPublico({ emitidoEm: emitido, respondidoEm: null, agora: depois(emitido, 29) }).valido).toBe(true);
    expect(situacaoDoLinkPublico({ emitidoEm: emitido, respondidoEm: null, agora: depois(emitido, 31) }).valido).toBe(false);
    expect(DIAS_PARA_ABRIR).toBe(30);
  });

  it("no minuto exato do limite AINDA vale — a borda erra a favor de quem vai assinar", () => {
    expect(situacaoDoLinkPublico({ emitidoEm: emitido, respondidoEm: null, agora: depois(emitido, 30) }).valido).toBe(true);
  });

  it("depois de assinado dá mais 90 dias, contados da RESPOSTA, para reler o que assinou", () => {
    const respondido = depois(emitido, 25);
    // dia 40: o prazo de abrir já passou, mas ele respondeu — continua podendo reler
    expect(situacaoDoLinkPublico({ emitidoEm: emitido, respondidoEm: respondido, agora: depois(emitido, 40) }).valido).toBe(true);
    expect(situacaoDoLinkPublico({ emitidoEm: emitido, respondidoEm: respondido, agora: depois(respondido, 91) }).valido).toBe(false);
    expect(DIAS_APOS_RESPOSTA).toBe(90);
  });

  it("sem data de emissão o link NÃO é trancado — não dá para datar, e trancar deixaria o cliente sem saída", () => {
    const s = situacaoDoLinkPublico({ emitidoEm: null, respondidoEm: null, agora: new Date() });
    expect(s.valido).toBe(true);
    expect(s.valido && s.expiraEm).toBeNull();
  });

  it("a frase diz POR QUE expirou e o que fazer — expirado não é inválido", () => {
    const s = situacaoDoLinkPublico({ emitidoEm: emitido, respondidoEm: null, agora: depois(emitido, 60) });
    expect(s.valido).toBe(false);
    const frase = mensagemDeLinkExpirado(s);
    expect(frase).toMatch(/expirou/i);
    expect(frase).toMatch(/01\/01\/2026|31\/01\/2026/); // data em pt-BR, nunca ISO
    expect(frase).toMatch(/novo link|equipe/i);
  });
});

describe("as quatro portas do token — a leitura E a escrita", () => {
  const ler = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
  const assinaturas = ler("../modules/assinaturas/assinaturas.service.ts");
  const propostas = ler("../modules/propostas/propostas.service.ts");

  it("assinaturas: abrir E assinar conferem a validade", () => {
    expect(assinaturas.match(/situacaoDoLinkPublico/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("propostas: abrir E responder conferem a validade", () => {
    expect(propostas.match(/situacaoDoLinkPublico/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("link expirado responde PRECONDITION_FAILED — é estado esperado, não erro do sistema (ADR-135)", () => {
    expect(assinaturas).toContain("PRECONDITION_FAILED");
    expect(propostas).toContain("PRECONDITION_FAILED");
  });

  it("cada abertura por token fica registrada — hoje ninguém sabe quem abriu", () => {
    expect(assinaturas).toContain("assinatura.link_aberto");
    expect(propostas).toContain("proposta.link_aberto");
  });
});
