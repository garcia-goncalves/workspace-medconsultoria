import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda ESTÁTICA (lê o texto-fonte, não renderiza o componente): não há Testing Library neste
 * repo, e montar `Escrever.tsx` de verdade (tRPC + react-query + Modal + o formulário inteiro)
 * seria uma infraestrutura nova só para isto. O que este teste cobre é o que a revisão da Tarefa
 * 8 apontou como o buraco real: `useRascunhoAutomatico.test.tsx` testa o HOOK isolado, mas nenhum
 * teste quebrava se alguém apagasse a CHAMADA do hook em `Escrever.tsx` — a fiação entre a tela e
 * o hook não tinha rede. Isto não substitui um teste de componente completo (registrado como
 * lacuna conhecida no relatório), mas pega exatamente o acidente "apaguei a linha errada".
 */
// `vitest` roda com cwd = raiz do pacote (`apps/web`) — caminho relativo simples, sem depender de
// `import.meta.url` (que aqui não vem como uma URL `file:` de verdade).
const codigo = readFileSync(join(process.cwd(), "src/features/email/Escrever.tsx"), "utf8");

describe("Escrever.tsx — fiação com useRascunhoAutomatico (guarda estática)", () => {
  it("chama rascunho.aoComecarEnvio() ANTES de enviar.mutate(...)", () => {
    const idxComecar = codigo.indexOf("rascunho.aoComecarEnvio()");
    const idxMutate = codigo.indexOf("enviar.mutate(");
    expect(idxComecar, "rascunho.aoComecarEnvio() precisa existir em Escrever.tsx").toBeGreaterThan(-1);
    expect(idxMutate, "enviar.mutate(...) precisa existir em Escrever.tsx").toBeGreaterThan(-1);
    expect(
      idxComecar,
      "aoComecarEnvio tem de rodar ANTES do mutate — senão o timer não é cancelado a tempo (achados 1/3)",
    ).toBeLessThan(idxMutate);
  });

  it("chama rascunho.descartarAposEnvio() dentro do onSuccess do envio", () => {
    const idxOnSuccess = codigo.indexOf("onSuccess: (r) => {");
    const idxOnError = codigo.indexOf("onError: (e) => {");
    const idxDescartar = codigo.indexOf("rascunho.descartarAposEnvio()");
    expect(idxOnSuccess, "onSuccess do envio precisa existir em Escrever.tsx").toBeGreaterThan(-1);
    expect(idxOnError, "onError do envio precisa existir em Escrever.tsx").toBeGreaterThan(-1);
    expect(idxDescartar, "rascunho.descartarAposEnvio() precisa existir em Escrever.tsx").toBeGreaterThan(-1);
    expect(idxDescartar, "descartarAposEnvio tem de estar DENTRO do onSuccess (achado 2)").toBeGreaterThan(idxOnSuccess);
    expect(idxDescartar, "descartarAposEnvio não pode estar depois do onError").toBeLessThan(idxOnError);
  });

  it("chama rascunho.aoEnvioFalhou() dentro do onError do envio", () => {
    const idxOnError = codigo.indexOf("onError: (e) => {");
    const idxFalhou = codigo.indexOf("rascunho.aoEnvioFalhou()");
    expect(idxOnError, "onError do envio precisa existir em Escrever.tsx").toBeGreaterThan(-1);
    expect(idxFalhou, "rascunho.aoEnvioFalhou() precisa existir em Escrever.tsx").toBeGreaterThan(-1);
    expect(idxFalhou, "aoEnvioFalhou tem de estar DENTRO do onError — senão `enviando` trava ligado após uma falha").toBeGreaterThan(
      idxOnError,
    );
  });
});
