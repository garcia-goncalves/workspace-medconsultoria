import { describe, it, expect } from "vitest";
import {
  PRAZO_ACOMPANHAMENTO_PADRAO_DIAS,
  diasNaSituacaoAtual,
  credenciamentoPrecisaDeAtencao,
  ordenarPainelCredenciamentos,
  type LinhaDoPainel,
} from "@app/shared";

/**
 * O PAINEL de credenciamentos (esteira `painel-credenciamentos`): a visão de todos os
 * cruzamentos médico × operadora de TODOS os clientes, que existe para responder uma
 * pergunta só — "o que travou e eu preciso cobrar hoje?".
 *
 * O prazo é 60 dias porque a Thaís disse (11/08/2026): "a partir de 60 dias precisamos
 * ficar de olho". Não é palpite de engenharia.
 */

const dias = (n: number) => {
  const d = new Date("2026-08-11T12:00:00Z");
  d.setDate(d.getDate() - n);
  return d;
};
const AGORA = new Date("2026-08-11T12:00:00Z");

const linha = (over: Partial<LinhaDoPainel> = {}): LinhaDoPainel => ({
  id: "c1",
  status: "PROTOCOLADO",
  createdAt: dias(100),
  protocoladoEm: dias(10),
  emAnaliseEm: null,
  aprovadoEm: null,
  negadoEm: null,
  encerradoEm: null,
  ...over,
});

describe("dias na situação atual", () => {
  it("conta a partir do carimbo da situação em que o credenciamento está, não da criação", () => {
    // Criado há 100 dias, mas protocolado há 10: está parado há 10, não há 100.
    expect(diasNaSituacaoAtual(linha({ status: "PROTOCOLADO", protocoladoEm: dias(10) }), AGORA)).toBe(10);
  });

  it("usa a data de análise quando já está em análise", () => {
    const l = linha({ status: "EM_ANALISE", protocoladoEm: dias(90), emAnaliseEm: dias(3) });
    expect(diasNaSituacaoAtual(l, AGORA)).toBe(3);
  });

  it("cai na data de criação quando ainda está a protocolar (nenhum carimbo existe)", () => {
    const l = linha({ status: "A_PROTOCOLAR", createdAt: dias(45), protocoladoEm: null });
    expect(diasNaSituacaoAtual(l, AGORA)).toBe(45);
  });

  it("carimbo faltando não quebra a conta: volta para a criação", () => {
    // Dado antigo, anterior ao Bloco B, pode ter status sem a data correspondente.
    const l = linha({ status: "PROTOCOLADO", protocoladoEm: null, createdAt: dias(7) });
    expect(diasNaSituacaoAtual(l, AGORA)).toBe(7);
  });

  it("nunca devolve número negativo, mesmo com data no futuro", () => {
    const l = linha({ status: "PROTOCOLADO", protocoladoEm: new Date("2026-09-01T12:00:00Z") });
    expect(diasNaSituacaoAtual(l, AGORA)).toBe(0);
  });
});

describe("precisa de atenção", () => {
  it("o prazo padrão é 60 dias — o número que a Thaís usa", () => {
    expect(PRAZO_ACOMPANHAMENTO_PADRAO_DIAS).toBe(60);
  });

  it("marca o que passou do prazo esperando a operadora", () => {
    expect(credenciamentoPrecisaDeAtencao("PROTOCOLADO", 60, 60)).toBe(true);
    expect(credenciamentoPrecisaDeAtencao("EM_ANALISE", 61, 60)).toBe(true);
  });

  it("não marca quem ainda está dentro do prazo", () => {
    expect(credenciamentoPrecisaDeAtencao("PROTOCOLADO", 59, 60)).toBe(false);
  });

  it("marca também o que ESTAMOS devendo: a protocolar parado é culpa nossa", () => {
    expect(credenciamentoPrecisaDeAtencao("A_PROTOCOLAR", 70, 60)).toBe(true);
  });

  it("nunca marca o que já terminou — aprovado, negado e encerrado não esperam ninguém", () => {
    expect(credenciamentoPrecisaDeAtencao("APROVADO", 900, 60)).toBe(false);
    expect(credenciamentoPrecisaDeAtencao("NEGADO", 900, 60)).toBe(false);
    expect(credenciamentoPrecisaDeAtencao("ENCERRADO", 900, 60)).toBe(false);
  });

  it("respeita o prazo configurado, não o padrão", () => {
    // O dono muda para 30 em Ajustes: quem está há 45 dias passa a precisar de atenção.
    expect(credenciamentoPrecisaDeAtencao("PROTOCOLADO", 45, 30)).toBe(true);
    expect(credenciamentoPrecisaDeAtencao("PROTOCOLADO", 45, 60)).toBe(false);
  });
});

describe("ordenação do painel", () => {
  it("põe os atrasados primeiro, e entre eles o que está parado há mais tempo", () => {
    const linhas = [
      { id: "ok", precisaAtencao: false, diasParados: 5 },
      { id: "atrasado-novo", precisaAtencao: true, diasParados: 61 },
      { id: "atrasado-velho", precisaAtencao: true, diasParados: 200 },
    ];
    expect(ordenarPainelCredenciamentos(linhas).map((l) => l.id)).toEqual([
      "atrasado-velho",
      "atrasado-novo",
      "ok",
    ]);
  });

  it("entre os que estão em dia, o mais parado também vem antes", () => {
    const linhas = [
      { id: "recente", precisaAtencao: false, diasParados: 1 },
      { id: "antigo", precisaAtencao: false, diasParados: 30 },
    ];
    expect(ordenarPainelCredenciamentos(linhas).map((l) => l.id)).toEqual(["antigo", "recente"]);
  });

  it("não altera o array recebido", () => {
    const linhas = [
      { id: "a", precisaAtencao: false, diasParados: 1 },
      { id: "b", precisaAtencao: true, diasParados: 90 },
    ];
    ordenarPainelCredenciamentos(linhas);
    expect(linhas.map((l) => l.id)).toEqual(["a", "b"]);
  });
});
