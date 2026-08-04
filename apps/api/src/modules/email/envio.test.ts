import { describe, it, expect } from "vitest";
import { conferirDestinoPermitido } from "./envio.service.js";

describe("conferirDestinoPermitido (fora de produção)", () => {
  it("deixa passar os dois endereços de teste", () => {
    expect(() => conferirDestinoPermitido(["tibamooca@gmail.com"])).not.toThrow();
    expect(() => conferirDestinoPermitido(["contato@medconsultoria.com.br"])).not.toThrow();
  });

  it("barra qualquer outro destino — o SMTP aqui é real e o cliente também seria", () => {
    expect(() => conferirDestinoPermitido(["cliente.de.verdade@exemplo.com"])).toThrow(/desenvolvimento/i);
  });

  it("barra se UM dos destinos não estiver liberado", () => {
    expect(() => conferirDestinoPermitido(["tibamooca@gmail.com", "outro@exemplo.com"])).toThrow();
  });

  it("não se deixa enganar por maiúsculas ou espaço", () => {
    expect(() => conferirDestinoPermitido([" TibaMooca@Gmail.com "])).not.toThrow();
  });
});
