import { describe, expect, it } from "vitest";
import { decidirRotaDaNotificacao, type NotifParaRota } from "./notificacao-rota";

const notif = (over: Partial<NotifParaRota>): NotifParaRota => ({
  tipo: "lembrete",
  entidadeTipo: null,
  entidadeId: null,
  ...over,
});

describe("decidirRotaDaNotificacao", () => {
  it("projeto: vai para a ficha do projeto", () => {
    expect(decidirRotaDaNotificacao(notif({ entidadeTipo: "projeto", entidadeId: "p1" }))).toEqual({
      destino: "projeto",
      id: "p1",
    });
  });

  it("documento: vai para a ficha do documento", () => {
    expect(decidirRotaDaNotificacao(notif({ entidadeTipo: "documento", entidadeId: "d1" }))).toEqual({
      destino: "documento",
      id: "d1",
    });
  });

  it("cliente: vai para a ficha do cliente", () => {
    expect(decidirRotaDaNotificacao(notif({ entidadeTipo: "cliente", entidadeId: "c1" }))).toEqual({
      destino: "cliente",
      id: "c1",
    });
  });

  it("evento: vai para a agenda", () => {
    expect(decidirRotaDaNotificacao(notif({ entidadeTipo: "evento", entidadeId: "e1" }))).toEqual({ destino: "evento" });
  });

  it("conta: vai para o financeiro", () => {
    expect(decidirRotaDaNotificacao(notif({ entidadeTipo: "conta", entidadeId: "cta1" }))).toEqual({ destino: "conta" });
  });

  it("lead: vai para o funil de vendas", () => {
    expect(decidirRotaDaNotificacao(notif({ entidadeTipo: "lead", entidadeId: "l1" }))).toEqual({ destino: "lead" });
  });

  it("incidente e erro: vão para o Sistema", () => {
    expect(decidirRotaDaNotificacao(notif({ entidadeTipo: "incidente", entidadeId: "i1" }))).toEqual({ destino: "sistema" });
    expect(decidirRotaDaNotificacao(notif({ entidadeTipo: "erro", entidadeId: "er1" }))).toEqual({ destino: "sistema" });
  });

  it("tarefa atribuída/delegada/com prazo alterado/atrasada: vai para 'Comigo'", () => {
    for (const tipo of ["tarefa_atribuida", "tarefa_delegada", "tarefa_prazo_alterado", "tarefa_vencida"]) {
      expect(decidirRotaDaNotificacao(notif({ tipo, entidadeTipo: "tarefa", entidadeId: "t1" }))).toEqual({
        destino: "tarefa",
        aba: "COMIGO",
        id: "t1",
      });
    }
  });

  it("tarefa concluída: vai para 'Deleguei' (quem pediu)", () => {
    expect(decidirRotaDaNotificacao(notif({ tipo: "tarefa_concluida", entidadeTipo: "tarefa", entidadeId: "t1" }))).toEqual({
      destino: "tarefa",
      aba: "DELEGUEI",
      id: "t1",
    });
  });

  it("sem entidadeId onde é exigido: não navega", () => {
    expect(decidirRotaDaNotificacao(notif({ entidadeTipo: "projeto", entidadeId: null }))).toBeNull();
    expect(decidirRotaDaNotificacao(notif({ entidadeTipo: "tarefa", entidadeId: null }))).toBeNull();
  });

  it("entidadeTipo desconhecido ou ausente: não navega", () => {
    expect(decidirRotaDaNotificacao(notif({ entidadeTipo: null, entidadeId: null }))).toBeNull();
    expect(decidirRotaDaNotificacao(notif({ entidadeTipo: "algo-novo", entidadeId: "x" }))).toBeNull();
  });
});
