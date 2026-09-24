import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registrarRotasDeSaude } from "./saude.js";

// A sonda é injetada: o teste prova a ROTA (código, corpo, prazo, sigilo) sem depender de um
// MySQL no ar — e consegue derrubar o "banco" de propósito, que é o caso que importa.

let app: ReturnType<typeof Fastify> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function montar(sonda: () => Promise<unknown>, tempoMaximoMs = 200) {
  app = Fastify({ logger: false });
  registrarRotasDeSaude(app, sonda, tempoMaximoMs);
  await app.ready();
  return app;
}

describe("/health (liveness)", () => {
  it("diz ok MESMO com o banco fora — é de propósito, é o que o HEALTHCHECK da imagem lê", async () => {
    const a = await montar(() => Promise.reject(new Error("banco caiu")));
    const r = await a.inject({ method: "GET", url: "/health" });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("ok");
  });
});

describe("/health/pronto (readiness)", () => {
  it("200 quando o banco responde", async () => {
    const a = await montar(() => Promise.resolve([{ 1: 1 }]));
    const r = await a.inject({ method: "GET", url: "/health/pronto" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "pronto", banco: "ok" });
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("503 quando o banco falha, SEM vazar a mensagem do erro", async () => {
    const segredo = "Can't reach database server at mysql:3306 user=medconsultoria";
    const a = await montar(() => Promise.reject(new Error(segredo)));
    const r = await a.inject({ method: "GET", url: "/health/pronto" });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ status: "indisponivel", banco: "indisponivel" });
    expect(r.body).not.toContain("mysql");
    expect(r.body).not.toContain("3306");
  });

  it("503 quando o banco fica pendurado além do prazo (pool esgotado)", async () => {
    const a = await montar(() => new Promise(() => {}), 50);
    const inicio = Date.now();
    const r = await a.inject({ method: "GET", url: "/health/pronto" });
    expect(r.statusCode).toBe(503);
    expect(Date.now() - inicio).toBeLessThan(2_000);
  });
});
