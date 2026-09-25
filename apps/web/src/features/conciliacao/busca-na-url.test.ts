import { describe, expect, it } from "vitest";
import { lerBuscaDaConciliacao, limparBusca, STATUS_FILTRO } from "./busca-na-url";
import { STATUS_CONCILIACAO } from "./partes";

describe("estado da Conciliação na URL", () => {
  it("lê cliente, aba e os filtros das duas abas", () => {
    expect(
      lerBuscaDaConciliacao({
        cliente: "cmabc123",
        aba: "cirurgias",
        mes: "2026-05",
        tipo: "CONSULTA",
        operadora: "op1",
        paciente: "maria",
        cirMes: "2026-04",
        cirStatus: "GLOSA_TOTAL",
        cirSituacao: "SEM_ATENDIMENTO",
        cirOperadora: "__particular__",
        cirRecurso: "SEM_RECURSO",
        cirPrazo: "atrasadas",
        cirPaciente: "joão",
      }),
    ).toEqual({
      cliente: "cmabc123",
      aba: "cirurgias",
      mes: "2026-05",
      tipo: "CONSULTA",
      operadora: "op1",
      paciente: "maria",
      cirMes: "2026-04",
      cirStatus: "GLOSA_TOTAL",
      cirSituacao: "SEM_ATENDIMENTO",
      cirOperadora: "__particular__",
      cirRecurso: "SEM_RECURSO",
      cirPrazo: "atrasadas",
      cirPaciente: "joão",
    });
  });

  it("valor fora do formato vira 'sem filtro' — nunca erro, nunca vai ao servidor", () => {
    expect(
      lerBuscaDaConciliacao({
        cliente: "c1",
        aba: "financeiro",
        mes: "2026-13",
        cirMes: "maio",
        cirStatus: "QUALQUER",
        cirPrazo: "sim",
        operadora: "a b; drop",
        paciente: "   ",
      }),
    ).toEqual({ cliente: "c1" });
  });

  it("a aba do honorário sobrevive ao recarregar (é o destino do lembrete por e-mail)", () => {
    expect(lerBuscaDaConciliacao({ cliente: "c1", aba: "honorario" })).toEqual({ cliente: "c1", aba: "honorario" });
  });

  it("sem cliente, nenhum filtro sobra (a URL da visão geral fica limpa)", () => {
    expect(lerBuscaDaConciliacao({ mes: "2026-05", aba: "cirurgias" })).toEqual({});
    expect(lerBuscaDaConciliacao({ cliente: "../../etc" })).toEqual({});
  });

  it("busca numérica (o roteador lê a URL como JSON) continua sendo busca, e respeita o teto de 120", () => {
    expect(lerBuscaDaConciliacao({ cliente: "c1", paciente: 2026 }).paciente).toBe("2026");
    expect(lerBuscaDaConciliacao({ cliente: "c1", cirPaciente: "x".repeat(300) }).cirPaciente).toHaveLength(120);
  });

  it("limpar tira as chaves vazias", () => {
    expect(limparBusca({ cliente: "c1", mes: undefined, paciente: "" })).toEqual({ cliente: "c1" });
  });

  it("⚠️ os status aceitos na URL são exatamente os da tela — status novo sem entrar aqui sumiria ao recarregar", () => {
    expect([...STATUS_FILTRO].sort()).toEqual(Object.keys(STATUS_CONCILIACAO).sort());
  });
});
