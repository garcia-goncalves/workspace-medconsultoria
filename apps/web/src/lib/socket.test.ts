import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guarda do TEMPO REAL POR POLLING (Opção A). A dor que originou isto: a hospedagem (LiteSpeed)
 * não faz upgrade de WebSocket e bufferiza o long-polling do Socket.IO, então o tempo real só
 * chega por polling. Se alguém remover o `refetchInterval` de uma dessas telas, ela volta a
 * "congelar" no servidor; se reabrir um socket sem o gate de produção, ele fica pendurado no
 * LiteSpeed consumindo workers à toa. Este teste trava as duas coisas.
 */
const web = resolve(__dirname, "..");
const CONSUMIDORES = [
  "features/mensagens/MensagensPage.tsx",
  "features/portal/PortalSuporte.tsx",
  "features/crm/clientes/ClienteDetailPage.tsx",
  "components/layout/NotificationBell.tsx",
  // O IMAP desta hospedagem não faz IDLE: sem polling, e-mail novo só apareceria ao recarregar.
  "features/email/EmailPage.tsx",
];

describe("tempo real por polling (Opção A)", () => {
  it("todo consumidor de tempo real faz polling", () => {
    for (const rel of CONSUMIDORES) {
      const src = readFileSync(resolve(web, rel), "utf8");
      expect(src, `${rel}: sem refetchInterval — o tempo real quebraria no LiteSpeed`).toContain("refetchInterval");
    }
  });

  // O gate saiu dos consumidores e foi para dentro do `useEventoRealtime` (19/08/2026), junto
  // com o import dinâmico do socket.io-client. Isto é MAIS forte do que antes — não dá para
  // assinar um evento sem passar pelo gate —, mas a versão anterior deste teste procurava
  // `getSocket()` no consumidor e teria virado VAZIA depois da refatoração, passando por não
  // encontrar nada. A guarda foi reescrita para a forma nova em vez de simplesmente apagada.
  it("o gate de produção mora no hook, e é por lá que os consumidores assinam", () => {
    const hook = readFileSync(resolve(web, "lib/socket.ts"), "utf8");
    expect(hook, "useEventoRealtime sumiu — os consumidores ficariam sem gate").toContain("export function useEventoRealtime");
    expect(hook, "o hook precisa checar o gate antes de assinar").toContain("if (!REALTIME_SOCKET_ENABLED) return;");
  });

  it("nenhum consumidor abre socket por fora do hook", () => {
    for (const rel of CONSUMIDORES) {
      const src = readFileSync(resolve(web, rel), "utf8");
      if (src.includes("getSocket(")) {
        expect(src, `${rel}: chama getSocket direto — use useEventoRealtime, que já tem o gate`).toContain("REALTIME_SOCKET_ENABLED");
      }
    }
  });

  // A razão de o import ser dinâmico: estático, ele entrava no pacote principal de PRODUÇÃO,
  // onde o socket está DESLIGADO e nunca abre conexão. Eram 93 kB entregues a todo mundo à toa.
  it("o socket.io-client entra por import dinâmico, não estático", () => {
    const src = readFileSync(resolve(web, "lib/socket.ts"), "utf8");
    // Varredura de linha em vez de regex: a versão anterior desta asserção tinha um \b que virou
    // byte de controle no arquivo, e o lint pegou. Aqui não há o que escapar.
    const importEstatico = src
      .split("\n")
      .find((l) => l.startsWith("import ") && l.includes("socket.io-client") && !l.includes("import type"));
    expect(importEstatico, "import estático voltaria a pôr 93 kB no pacote principal").toBeUndefined();
    expect(src, "o cliente precisa ser buscado sob demanda").toContain('import("socket.io-client")');
  });
});
