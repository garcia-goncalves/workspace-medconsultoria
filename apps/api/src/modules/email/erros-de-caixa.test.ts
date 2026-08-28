import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TRPCError } from "@trpc/server";
import { erroPrecisaReconectar, ehErroPrecisaReconectar } from "./erros-de-caixa.js";

/**
 * A caixa de e-mail que perdeu a senha é um estado ESPERADO — não é bug de servidor.
 *
 * O `onError` do tRPC (`server.ts`) manda para o painel de Sistema **só** o que tem código
 * `INTERNAL_SERVER_ERROR`, com o comentário explícito de que erro esperado não vai para lá.
 * Só que "esta caixa precisa ser reconectada" era lançado como `new Error(...)` cru, e o tRPC
 * classifica `Error` sem código como INTERNAL. Resultado medido no banco local em 28/08/2026:
 * **66 ocorrências** de um "erro" que a própria tela já trata com o botão *Reconectar*, contra
 * 2 registros de bug de verdade. O painel do ROOT dizia "5 erros não resolvidos" e nenhum era
 * um erro. Pior: o primeiro registro dispara e-mail "Novo erro no sistema" ao ROOT, e marcar
 * como resolvido não adianta — a próxima abertura da página reabre como REGRESSÃO e avisa de
 * novo. É o mesmo ruído que a ADR-134 combateu no aviso de lead novo.
 *
 * ⚠️ A tela não é afetada: `EmailPage` decide o que mostrar pelo `estado` da caixa gravado no
 * banco (`AUTENTICACAO_FALHOU`), nunca pela mensagem ou pelo código do erro.
 */
describe("erro de caixa que precisa reconectar", () => {
  it("NUNCA é INTERNAL_SERVER_ERROR — é isso que o mantém fora do painel de Sistema", () => {
    const e = erroPrecisaReconectar("A senha guardada foi recusada pelo servidor.");
    expect(e).toBeInstanceOf(TRPCError);
    expect(e.code).not.toBe("INTERNAL_SERVER_ERROR");
  });

  it("preserva a mensagem em português — é ela que a pessoa lê na tela", () => {
    const e = erroPrecisaReconectar("A senha guardada foi recusada pelo servidor.");
    expect(e.message).toBe("A senha guardada foi recusada pelo servidor.");
  });

  it("se reconhece, e não confunde com erro de verdade", () => {
    expect(ehErroPrecisaReconectar(erroPrecisaReconectar("x"))).toBe(true);
    expect(ehErroPrecisaReconectar(new Error("servidor fora do ar"))).toBe(false);
    expect(ehErroPrecisaReconectar(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "x" }))).toBe(false);
    expect(ehErroPrecisaReconectar(null)).toBe(false);
  });

  /**
   * Trava de regressão no estilo da ADR-127: lê o arquivo do servidor. Sem ela, alguém
   * reescreve o trecho com `new Error` e o painel volta a encher — sem nenhum teste falhar,
   * porque o comportamento só aparece com uma caixa quebrada de verdade.
   */
  it("os caminhos de reconexão do IMAP e do SMTP não lançam Error cru", () => {
    for (const arquivo of ["imap.ts", "smtp.ts"]) {
      const fonte = readFileSync(new URL(arquivo, import.meta.url), "utf8");
      const linhas = fonte
        .split("\n")
        .filter((l) => /reconectada|recusada pelo servidor|não pôde ser aberta/i.test(l))
        .filter((l) => /throw new Error\(/.test(l));
      expect(linhas, `${arquivo} voltou a lançar Error cru: ${linhas.join(" | ")}`).toEqual([]);
    }
  });
});
