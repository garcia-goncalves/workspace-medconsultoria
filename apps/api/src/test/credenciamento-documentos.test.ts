import { describe, it, expect } from "vitest";
import { DOCUMENTOS_CREDENCIAMENTO, planejarSincronizacaoDocumentos } from "../modules/servicos/credenciamento.service.js";

/**
 * A LISTA REAL de documentos do credenciamento (spec §4), tirada do PDF da Thaís
 * `brand/identidade/Lista de documentos credenciamento médico.pdf`.
 *
 * O outro lado, tão importante quanto: a reconciliação com o que já está no banco NÃO
 * APAGA exigência nenhuma. `Arquivo.requisitoId` é `SetNull` — apagar a exigência desliga
 * o arquivo que o cliente já enviou, e ele fica órfão e invisível. Documento que a Thaís
 * não pede vira "não obrigatório" e ela remove pela tela se quiser.
 */

const tituloDe = (t: string) => DOCUMENTOS_CREDENCIAMENTO.find((d) => d.titulo === t);

describe("a lista real de documentos", () => {
  it("tem os 14 documentos do PDF, distribuídos nos quatro escopos", () => {
    expect(DOCUMENTOS_CREDENCIAMENTO).toHaveLength(14);
    const porEscopo = (e: string) => DOCUMENTOS_CREDENCIAMENTO.filter((d) => d.escopo === e).length;
    expect(porEscopo("EMPRESA")).toBe(5);
    expect(porEscopo("CLINICA")).toBe(5);
    expect(porEscopo("PROFISSIONAL")).toBe(3);
    expect(porEscopo("RESPONSAVEL_TECNICO")).toBe(1);
  });

  it("os três documentos de cada profissional são frente e verso", () => {
    const doProfissional = DOCUMENTOS_CREDENCIAMENTO.filter((d) => d.escopo === "PROFISSIONAL");
    expect(doProfissional.every((d) => d.frenteVerso)).toBe(true);
    expect(DOCUMENTOS_CREDENCIAMENTO.filter((d) => d.frenteVerso)).toHaveLength(3);
  });

  it("as travas de elegibilidade estão nos documentos certos", () => {
    expect(tituloDe("Alvará de funcionamento")?.travaElegibilidade).toBe("ALVARA_FUNCIONAMENTO");
    expect(tituloDe("Alvará da Vigilância Sanitária")?.travaElegibilidade).toBe("ALVARA_VIGILANCIA");
    expect(tituloDe("Registro no CNES")?.travaElegibilidade).toBe("CNES");
    expect(tituloDe("Especializações")?.travaElegibilidade).toBe("TITULO_ESPECIALISTA");
  });

  it("só o comprovante de isenção fiscal é dispensável — o PDF diz 'se houver'", () => {
    const opcionais = DOCUMENTOS_CREDENCIAMENTO.filter((d) => !d.obrigatorio).map((d) => d.titulo);
    expect(opcionais).toEqual(["Comprovantes de isenções fiscais, tributárias e contribuições"]);
  });

  it("todo documento é do tipo DOCUMENTO — a lista do PDF é de papel, não de pergunta", () => {
    expect(DOCUMENTOS_CREDENCIAMENTO.every((d) => d.tipo === "DOCUMENTO")).toBe(true);
  });
});

describe("reconciliar a lista com o que já está no banco", () => {
  it("num serviço sem nenhuma exigência, cria os 14 e não mexe em mais nada", () => {
    const plano = planejarSincronizacaoDocumentos([]);
    expect(plano.criar).toHaveLength(14);
    expect(plano.atualizar).toEqual([]);
    expect(plano.rebaixar).toEqual([]);
  });

  it("exigência que já existe com o mesmo título é ATUALIZADA, nunca recriada — o arquivo do cliente segue preso a ela", () => {
    const plano = planejarSincronizacaoDocumentos([
      { id: "req-cnes", titulo: "Registro no CNES", tipo: "DOCUMENTO", obrigatorio: true },
    ]);
    expect(plano.criar).toHaveLength(13);
    expect(plano.atualizar).toHaveLength(1);
    expect(plano.atualizar[0]?.id).toBe("req-cnes");
    expect(plano.atualizar[0]?.dados.travaElegibilidade).toBe("CNES");
  });

  it("'RG e CPF do médico' NÃO é apagado — vira não obrigatório", () => {
    const plano = planejarSincronizacaoDocumentos([
      { id: "req-rg", titulo: "RG e CPF do médico", tipo: "DOCUMENTO", obrigatorio: true },
    ]);
    expect(plano.rebaixar.map((r) => r.id)).toEqual(["req-rg"]);
    expect(JSON.stringify(plano)).not.toContain("remover");
  });

  it("documento antigo que já está opcional não é mexido de novo (rodar duas vezes não faz nada)", () => {
    const plano = planejarSincronizacaoDocumentos([
      { id: "req-rg", titulo: "RG e CPF do médico", tipo: "DOCUMENTO", obrigatorio: false },
    ]);
    expect(plano.rebaixar).toEqual([]);
  });

  it("pergunta ao cliente (INFORMACAO) não é documento e fica intocada", () => {
    const plano = planejarSincronizacaoDocumentos([
      { id: "req-info", titulo: "Quais operadoras deseja credenciar?", tipo: "INFORMACAO", obrigatorio: true },
    ]);
    expect(plano.rebaixar).toEqual([]);
    expect(plano.atualizar).toEqual([]);
  });

  it("rodar com a lista já sincronizada não cria nada nem rebaixa nada", () => {
    const existentes = DOCUMENTOS_CREDENCIAMENTO.map((d, i) => ({
      id: `req-${i}`,
      titulo: d.titulo,
      tipo: "DOCUMENTO" as const,
      obrigatorio: d.obrigatorio,
    }));
    const plano = planejarSincronizacaoDocumentos(existentes);
    expect(plano.criar).toEqual([]);
    expect(plano.rebaixar).toEqual([]);
    expect(plano.atualizar).toHaveLength(14);
  });

  it("duas linhas com o MESMO título (corrida na semeadura) — a primeira vale, a outra sai da conta", () => {
    const plano = planejarSincronizacaoDocumentos([
      { id: "cnes-a", titulo: "Registro no CNES", tipo: "DOCUMENTO", obrigatorio: true },
      { id: "cnes-b", titulo: "Registro no CNES", tipo: "DOCUMENTO", obrigatorio: true },
    ]);
    expect(plano.atualizar.map((a) => a.id)).toEqual(["cnes-a"]);
    expect(plano.duplicados.map((d) => d.id)).toEqual(["cnes-b"]);
    // Lixo nosso não vira pendência da Thaís: não entra no rebaixar, que é a lista dela.
    expect(plano.rebaixar).toEqual([]);
  });

  it("sem duplicata, a lista de duplicados vem vazia", () => {
    const plano = planejarSincronizacaoDocumentos([
      { id: "cnes-a", titulo: "Registro no CNES", tipo: "DOCUMENTO", obrigatorio: true },
    ]);
    expect(plano.duplicados).toEqual([]);
  });

  it("diferença de espaço ou de caixa no título não duplica a exigência", () => {
    const plano = planejarSincronizacaoDocumentos([
      { id: "req-cnes", titulo: "  registro no cnes  ", tipo: "DOCUMENTO", obrigatorio: true },
    ]);
    expect(plano.criar).toHaveLength(13);
    expect(plano.atualizar[0]?.id).toBe("req-cnes");
  });
});
