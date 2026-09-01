import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { PROXY_CONFIAVEL } from "./proxy-confiavel.js";

/**
 * O `req.ip` é a chave de TODOS os freios da casa e é a prova gravada em `Assinatura.ip`.
 * Estes testes exercem o Fastify DE VERDADE (não uma reimplementação da régua), porque o que
 * mordeu em 01/09/2026 foi exatamente o Fastify mudar o significado do valor por baixo:
 * `trustProxy: 1` deixou de "confiar no salto mais próximo" e passou a NÃO confiar em ninguém,
 * silenciosamente, numa subida de versão MENOR.
 */
async function ipVisto(opcoes: {
  trustProxy: unknown;
  peer: string;
  encaminhado?: string;
}): Promise<string> {
  const app = Fastify({ trustProxy: opcoes.trustProxy as never });
  app.get("/quem-sou", async (req) => ({ ip: req.ip }));
  const resposta = await app.inject({
    method: "GET",
    url: "/quem-sou",
    remoteAddress: opcoes.peer,
    headers: opcoes.encaminhado ? { "x-forwarded-for": opcoes.encaminhado } : {},
  });
  await app.close();
  return (resposta.json() as { ip: string }).ip;
}

const VISITANTE = "203.0.113.7"; // faixa de documentação (RFC 5737), nunca é IP de gente
const IMPOSTOR = "198.51.100.9";

describe("PROXY_CONFIAVEL — de onde vem o req.ip", () => {
  it("atrás do LiteSpeed (mesma máquina), enxerga o IP REAL do visitante", async () => {
    const ip = await ipVisto({
      trustProxy: [...PROXY_CONFIAVEL],
      peer: "127.0.0.1",
      encaminhado: VISITANTE,
    });
    expect(ip).toBe(VISITANTE);
  });

  it("atrás de proxy em rede privada, também enxerga o IP real", async () => {
    const ip = await ipVisto({
      trustProxy: [...PROXY_CONFIAVEL],
      peer: "10.0.0.5",
      encaminhado: VISITANTE,
    });
    expect(ip).toBe(VISITANTE);
  });

  it("⚠️ cliente PÚBLICO direto NÃO se faz passar por outro IP", async () => {
    // Ele chega de fora e manda o cabeçalho na mão. Como o endereço dele não é nem loopback nem
    // rede privada, a régua recusa confiar: vale o endereço da conexão, não o que ele escreveu.
    const ip = await ipVisto({
      trustProxy: [...PROXY_CONFIAVEL],
      peer: IMPOSTOR,
      encaminhado: VISITANTE,
    });
    expect(ip).toBe(IMPOSTOR);
  });

  it("sem cabeçalho nenhum, vale o endereço da conexão", async () => {
    const ip = await ipVisto({ trustProxy: [...PROXY_CONFIAVEL], peer: "127.0.0.1" });
    expect(ip).toBe("127.0.0.1");
  });

  it("a régua NUNCA é `true` nem o número `1`", () => {
    // `true` deixaria o visitante escrever o próprio IP. O número `1` é o formato que o Fastify
    // 5.12 aposentou — ele passou a falhar fechado, e aí TODO visitante vira o mesmo IP.
    expect(PROXY_CONFIAVEL).not.toBe(true);
    expect(PROXY_CONFIAVEL as unknown).not.toBe(1);
    expect([...PROXY_CONFIAVEL]).toEqual(["loopback", "uniquelocal"]);
  });

  it("PROVA DA REGRESSÃO: com o antigo `1`, o visitante real SUMIRIA", async () => {
    // Este é o defeito que a subida do Fastify traria se ninguém olhasse: mesmo atrás do nosso
    // proxy, o IP do visitante é descartado e todo mundo vira o endereço da conexão. Se este
    // teste passar a devolver VISITANTE um dia, o Fastify voltou atrás e a régua pode ser revista.
    const ip = await ipVisto({ trustProxy: 1, peer: "127.0.0.1", encaminhado: VISITANTE });
    expect(ip).toBe("127.0.0.1");
    expect(ip).not.toBe(VISITANTE);
  });
});
