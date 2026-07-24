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
];

describe("tempo real por polling (Opção A)", () => {
  it("todo consumidor de tempo real faz polling", () => {
    for (const rel of CONSUMIDORES) {
      const src = readFileSync(resolve(web, rel), "utf8");
      expect(src, `${rel}: sem refetchInterval — o tempo real quebraria no LiteSpeed`).toContain("refetchInterval");
    }
  });

  it("quem abre socket precisa desligá-lo em produção (gate REALTIME_SOCKET_ENABLED)", () => {
    for (const rel of CONSUMIDORES) {
      const src = readFileSync(resolve(web, rel), "utf8");
      if (src.includes("getSocket()")) {
        expect(src, `${rel}: socket sem gate — ficaria pendurado no LiteSpeed`).toContain("REALTIME_SOCKET_ENABLED");
      }
    }
  });
});
