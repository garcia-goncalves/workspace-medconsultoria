import { readFileSync } from "node:fs";

/** Dados determinísticos semeados pela setup (ids/nomes REAIS do seed atual — nunca hardcodar). */
export interface Fixtures {
  briefingReqId: string;
  portalClienteId: string;
  portalClienteNome: string;
  outroClienteId: string;
  outroDocId: string;
  outroConversaId: string;
  /** Projeto garantido pela setup — não depende de outro spec ter convertido um lead. */
  projetoId: string;
  /** Cliente dedicado ao card de e-mails da ficha (e-mail de domínio externo — ver ADR-97). */
  emailClienteId: string;
  resetRawValid: string;
  resetRawExpired: string;
}

/** Lê e2e/.auth/fixtures.json. Chamar DENTRO do teste (o arquivo só existe após a setup). */
export function lerFixtures(): Fixtures {
  return JSON.parse(readFileSync("e2e/.auth/fixtures.json", "utf8")) as Fixtures;
}
