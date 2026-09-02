import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  it("O CASO REAL DE PRODUÇÃO: forja à esquerda + IP real anexado pelo LiteSpeed à direita", async () => {
    // É assim que o cabeçalho chega de verdade: o visitante escreve o que quiser, e o LiteSpeed
    // ACRESCENTA o endereço real dele ao FIM. Os outros testes usam cabeçalho de um elemento só e
    // por isso nunca exerceram a regra de precedência, que é o que decide quem ganha.
    const ip = await ipVisto({
      trustProxy: [...PROXY_CONFIAVEL],
      peer: "127.0.0.1",
      encaminhado: `${IMPOSTOR}, ${VISITANTE}`,
    });
    expect(ip).toBe(VISITANTE);
    expect(ip).not.toBe(IMPOSTOR);
  });

  it("⚠️ O LIMITE DA RÉGUA: privado à direita faz o valor FORJADO vencer", async () => {
    // Documenta uma DEPENDÊNCIA DE TOPOLOGIA, não um desejo. O `@fastify/proxy-addr` caminha da
    // direita para a esquerda pulando TODO endereço confiável que encontrar, e para no primeiro
    // que não é. Se algum dia algo de rede privada passar a anexar o endereço DEPOIS do LiteSpeed,
    // o que sobra é o que o visitante escreveu — e ele volta a escolher o próprio IP.
    //
    // A régua nova só é sólida enquanto o LiteSpeed anexar o IP real À DIREITA. Este teste existe
    // para que mudar a topologia REPROVE aqui, em vez de mudar o `req.ip` em silêncio — que é
    // exatamente o modo de falha que a ADR-146 veio consertar.
    const ip = await ipVisto({
      trustProxy: [...PROXY_CONFIAVEL],
      peer: "127.0.0.1",
      encaminhado: `${IMPOSTOR}, 10.0.0.5`,
    });
    expect(ip).toBe(IMPOSTOR);
  });

  it("⚠️ e ele pula TODOS os privados seguidos, não apenas um", async () => {
    // O antigo `1` pulava um salto só. Esta régua pula a sequência inteira, então acrescentar mais
    // um proxy interno não devolve a proteção — o alcance do limite acima é maior do que parece.
    const ip = await ipVisto({
      trustProxy: [...PROXY_CONFIAVEL],
      peer: "127.0.0.1",
      encaminhado: `${IMPOSTOR}, 10.0.0.5, 192.168.1.9`,
    });
    expect(ip).toBe(IMPOSTOR);
  });
});

/**
 * A trava acima protege a CONSTANTE. Esta protege o PONTO DE USO: sem ela, quem escrevesse
 * `trustProxy: true` direto no `Fastify({...})` de `server.ts` não seria reprovado por nada — a
 * constante seguiria correta, intocada e simplesmente não usada. Molde da casa: teste que lê o
 * TEXTO do arquivo (ver `apps/web/src/lib/paginas.test.ts`).
 */
describe("o servidor USA a régua — e não um valor escrito à mão", () => {
  // Só o CÓDIGO. Comentário citando `trustProxy:` não é ponto de uso, e a régua tem justamente
  // um comentário longo logo acima da linha real: a 1ª versão desta trava lia a explicação e
  // aprovava o texto errado. Bloco /* */ sai inteiro antes, porque nem toda linha interna dele
  // começa com `*`.
  const servidor = () =>
    readFileSync(resolve(__dirname, "../server.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");

  // A expressão inteira que o Fastify recebe como `trustProxy`, sem comentário no meio.
  const valorDoTrustProxy = () => {
    const achado = servidor().match(/trustProxy:\s*([^,]+)/);
    expect(achado, "não achei `trustProxy:` em server.ts — ele foi removido?").not.toBeNull();
    return achado![1]!.trim();
  };

  it("o `trustProxy` é EXATAMENTE a régua — nem valor à mão, nem ternário com escape", () => {
    // ⚠️ IGUALDADE, e não "contém". Com `toContain` esta trava tinha um furo REAL, achado pelo
    // revisor e reproduzido antes de corrigir: `trustProxy: modoDebug ? [...PROXY_CONFIAVEL] :
    // true` passava VERDE nas 12 travas. A captura contém o nome da constante (satisfaz o
    // "contém") e o literal proibido não vem logo depois dos dois-pontos (escapa da trava
    // abaixo). Um ramo que ninguém lê devolveria `true` em produção e o `req.ip` voltaria a ser
    // escolhido pelo visitante — sem erro, sem log, sem CI vermelha.
    // ⚠️ RESTRIÇÃO DELIBERADA, para quem for reprovado sem entender: extrair a régua para uma
    // variável intermediária (`const p = [...PROXY_CONFIAVEL]; trustProxy: p`) TAMBÉM reprova
    // aqui. É de propósito — a constante tem de estar visível no ponto de uso, senão a trava
    // volta a proteger só o nome e não o que o Fastify recebe.
    expect(valorDoTrustProxy()).toBe("[...PROXY_CONFIAVEL]");
  });

  it("nenhum literal (`true`, número ou string) em PONTO NENHUM da expressão", () => {
    // Rede de segurança da trava acima: se um dia a igualdade exata for afrouxada, esta ainda
    // pega o literal onde quer que ele esteja na expressão — não só colado nos dois-pontos.
    const proibidos = [...valorDoTrustProxy().matchAll(/\b(?:true|\d+)\b|"[^"]*"|'[^']*'/g)];
    expect(
      proibidos.map((m) => m[0]),
      "trustProxy com valor à mão: a régua e o porquê moram em lib/proxy-confiavel.ts",
    ).toEqual([]);
  });

  it("server.ts importa a régua do módulo dela", () => {
    expect(servidor()).toMatch(
      /import\s*\{[^}]*PROXY_CONFIAVEL[^}]*\}\s*from\s*"\.\/lib\/proxy-confiavel\.js"/,
    );
  });
});
