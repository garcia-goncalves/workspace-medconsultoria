import { describe, it, expect } from "vitest";
import { CONTEUDO_SERVICOS } from "../modules/servicos/servicos.service.js";

/**
 * Trava do conteúdo operacional: TODO serviço do catálogo tem os DOIS lados da dança.
 *
 * Até 29/08/2026 o catálogo só tinha passos escritos do ponto de vista da Med ("Apresentar
 * proposta", "Negociar tabelas"). O trabalho da clínica não existia no funil — vivia só na
 * lista de documentos do Portal —, e a pergunta que a Thaís faz toda manhã (*o que está
 * parado esperando o cliente?*) não tinha resposta na tela.
 *
 * ⚠️ Este teste existe porque a regressão é SILENCIOSA: um serviço novo escrito só com passos
 * nossos passa em tudo, desenha certo e simplesmente nunca aparece na fila "com a clínica".
 * Ninguém percebe até a Thaís cobrar um cliente que ela nem sabia que estava devendo.
 */
describe("catálogo de serviços — os passos dizem de quem são", () => {
  it("todo serviço tem pelo menos um passo NOSSO e um passo DA CLÍNICA", () => {
    const semLadoDoCliente = CONTEUDO_SERVICOS.filter(
      (s) => !s.passos.some((p) => p.quemFaz === "CLIENTE"),
    ).map((s) => s.nome);
    const semLadoNosso = CONTEUDO_SERVICOS.filter(
      (s) => !s.passos.some((p) => (p.quemFaz ?? "MED") === "MED"),
    ).map((s) => s.nome);

    expect(semLadoDoCliente, "serviços sem nenhum passo da clínica").toEqual([]);
    expect(semLadoNosso, "serviços sem nenhum passo nosso").toEqual([]);
  });

  it("o passo da clínica é escrito na voz da clínica, não na nossa", () => {
    // Convenção de redação: o passo do cliente começa por "Clínica ..." — é o que faz a lista
    // ser lida como um diálogo entre dois lados, e não como uma lista de afazeres nossos.
    const foraDaConvencao = CONTEUDO_SERVICOS.flatMap((s) =>
      s.passos.filter((p) => p.quemFaz === "CLIENTE" && !p.titulo.startsWith("Clínica ")).map((p) => `${s.nome}: ${p.titulo}`),
    );
    expect(foraDaConvencao).toEqual([]);
  });

  it("nenhum passo NOSSO é escrito como se fosse do cliente", () => {
    // O inverso da trava acima: um passo que começa com "Clínica ..." mas está marcado MED
    // apareceria na fila errada — a Thaís acharia que é a vez dela quando é a do cliente.
    const marcadoErrado = CONTEUDO_SERVICOS.flatMap((s) =>
      s.passos.filter((p) => (p.quemFaz ?? "MED") === "MED" && p.titulo.startsWith("Clínica ")).map((p) => `${s.nome}: ${p.titulo}`),
    );
    expect(marcadoErrado).toEqual([]);
  });

  it("o passo da clínica cai numa etapa que existe no funil", () => {
    const ETAPAS = new Set(["novo", "qualificacao", "proposta", "negociacao", "fechado"]);
    const etapaInvalida = CONTEUDO_SERVICOS.flatMap((s) =>
      s.passos.filter((p) => !ETAPAS.has(p.etapaChave)).map((p) => `${s.nome}: ${p.titulo} (${p.etapaChave})`),
    );
    expect(etapaInvalida).toEqual([]);
  });
});
