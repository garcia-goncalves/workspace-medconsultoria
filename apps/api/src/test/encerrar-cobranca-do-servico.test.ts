import { describe, it, expect } from "vitest";
import {
  planejarEncerramentoDaCobranca,
  type ParcelaDaCobranca,
} from "../modules/servicos/encerrar-cobranca.js";

/**
 * CANCELAR O SERVIÇO ENCERRA A MENSALIDADE — decisão do dono (28/08/2026).
 *
 * "As parcelas JÁ VENCIDAS continuam de pé — o serviço foi prestado naquele mês e o dinheiro
 * é devido. Param as futuras."
 *
 * A régua é pura porque ela é a MESMA em dois lugares: a tela que promete na confirmação
 * ("2 parcelas futuras serão encerradas; as vencidas continuam") e o servidor que executa.
 * Duas cópias divergiriam, e a confirmação passaria a mentir sobre dinheiro — que é
 * exatamente como se instala desconfiança no sistema.
 */

const HOJE = new Date(Date.UTC(2026, 7, 29));
const dia = (d: number) => new Date(Date.UTC(2026, 7, d));

const parcela = (over: Partial<ParcelaDaCobranca> = {}): ParcelaDaCobranca => ({
  id: "c1",
  vencimento: dia(29),
  pago: false,
  valor: 3500,
  recorrencia: "MENSAL",
  recorrenteId: null,
  ...over,
});

describe("o que para e o que continua quando o serviço é cancelado", () => {
  it("a parcela FUTURA em aberto é encerrada", () => {
    const p = planejarEncerramentoDaCobranca([parcela({ id: "futura", vencimento: dia(30) })], HOJE);
    expect(p.encerrar).toEqual(["futura"]);
    expect(p.valorEncerrado).toBe(3500);
  });

  it("a parcela VENCIDA e não paga continua de pé — o serviço foi prestado", () => {
    const p = planejarEncerramentoDaCobranca([parcela({ id: "vencida", vencimento: dia(10) })], HOJE);
    expect(p.encerrar).toEqual([]);
    expect(p.mantidas).toEqual(["vencida"]);
  });

  it("a parcela que vence HOJE continua — hoje ainda não é futuro", () => {
    const p = planejarEncerramentoDaCobranca([parcela({ id: "hoje", vencimento: dia(29) })], HOJE);
    expect(p.encerrar).toEqual([]);
  });

  it("parcela já paga nunca é tocada, mesmo com vencimento à frente", () => {
    const p = planejarEncerramentoDaCobranca(
      [parcela({ id: "paga", vencimento: dia(30), pago: true })],
      HOJE,
    );
    expect(p.encerrar).toEqual([]);
    expect(p.mantidas).toEqual(["paga"]);
  });

  it("cobrança AVULSA fica fora: não há mensalidade a encerrar", () => {
    const p = planejarEncerramentoDaCobranca(
      [parcela({ id: "avulsa", vencimento: dia(30), recorrencia: "NENHUMA" })],
      HOJE,
    );
    expect(p.encerrar).toEqual([]);
    expect(p.mantidas).toEqual([]);
    expect(p.series).toEqual([]);
  });

  it("a SÉRIE é fechada pela âncora — é ela que a geração consulta", () => {
    const p = planejarEncerramentoDaCobranca(
      [
        parcela({ id: "ancora", vencimento: dia(10), recorrenteId: null }),
        parcela({ id: "filha", vencimento: dia(30), recorrenteId: "ancora" }),
      ],
      HOJE,
    );
    expect(p.series).toEqual(["ancora"]);
    expect(p.encerrar).toEqual(["filha"]);
    expect(p.mantidas).toEqual(["ancora"]);
  });

  it("conta o que a tela precisa dizer ANTES do clique", () => {
    const p = planejarEncerramentoDaCobranca(
      [
        parcela({ id: "a", vencimento: dia(10), valor: 1000 }),
        parcela({ id: "b", vencimento: dia(30), valor: 1000, recorrenteId: "a" }),
        parcela({ id: "c", vencimento: dia(31), valor: 1000, recorrenteId: "a" }),
      ],
      HOJE,
    );
    expect(p.encerrar).toEqual(["b", "c"]);
    expect(p.valorEncerrado).toBe(2000);
    expect(p.mantidas).toEqual(["a"]);
  });
});
