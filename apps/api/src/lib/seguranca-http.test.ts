import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { marcarCspLigada, estaCspLigada, _resetarParaTeste } from "./seguranca-http.js";

/**
 * O painel SISTEMA → Manutenção mostrava **"Proteção de cabeçalhos (CSP): Desligada"** — e a CSP
 * estava LIGADA. A linha era um `cspLigada: false` fixo em `sistema.service.ts`, com o comentário
 * "desativada por ora" que envelheceu quando o `helmet` ganhou as diretivas.
 *
 * Conferido em 28/08/2026 no localhost: `curl -D - /health` devolve
 * `Content-Security-Policy: default-src 'self'; …; script-src 'self'; …`.
 *
 * ⚠️ **Um painel de segurança que mente é pior do que não existir**, mesmo mentindo para o lado
 * pessimista: além de mandar o dono "ligar" o que já está ligado, ele não mudaria de valor no dia
 * em que a CSP fosse REALMENTE desligada — porque não lia nada. Por isso a marcação não é uma
 * constante nova: quem a acende é o boot, na mesma linha em que registra o `helmet`. Tirar o
 * registro apaga a marcação junto.
 */
describe("estado real da CSP", () => {
  beforeEach(() => _resetarParaTeste());

  it("nasce desligada — sem ninguém registrar o helmet, o painel não pode dizer que está protegido", () => {
    expect(estaCspLigada()).toBe(false);
  });

  it("acende com o que o boot realmente registrou — e apaga se a política for desligada", () => {
    marcarCspLigada(true);
    expect(estaCspLigada()).toBe(true);
    marcarCspLigada(false);
    expect(estaCspLigada()).toBe(false);
  });

  /**
   * Trava de regressão: o valor só é verdade porque o boot o acende. Se alguém mexer no
   * `server.ts` e tirar a chamada mantendo o helmet (ou o contrário), o painel volta a mentir —
   * e nenhum outro teste falharia, porque o cabeçalho continuaria saindo normalmente.
   */
  it("o boot registra a CSP E acende a marcação, sempre os dois juntos", () => {
    const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
    const temPolitica = /contentSecurityPolicy:\s*\{/.test(server);
    // Precisa ser o VALOR das opções, não um literal: `marcarCspLigada(true)` seria uma segunda
    // declaração, e trocar `contentSecurityPolicy` por `false` faria o painel anunciar uma
    // proteção inexistente. Achado da revisão de segurança da ADR-135.
    const acende = /marcarCspLigada\(\s*Boolean\([A-Za-z]+\.contentSecurityPolicy\s*\)\s*\)/.test(server);
    expect(temPolitica, "server.ts não configura mais a CSP — revise o painel de Sistema").toBe(true);
    expect(acende, "a marcação virou literal em vez de ler as opções do helmet: o painel vai mentir").toBe(true);
  });

  it("o painel de Sistema não guarda mais um valor fixo", () => {
    const painel = readFileSync(new URL("../modules/sistema/sistema.service.ts", import.meta.url), "utf8");
    expect(/cspLigada:\s*(true|false)\b/.test(painel), "cspLigada voltou a ser constante").toBe(false);
  });
});
