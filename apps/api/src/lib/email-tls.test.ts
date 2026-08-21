import { describe, expect, it } from "vitest";
import { ehHostLocal, opcoesTls } from "./email-tls.js";

// Contexto (21/08/2026): NENHUM e-mail transacional jamais saiu de produção. Filtrando o
// monitor `/emails-enviados` por "Enviados" + "Todo o período", o servidor respondeu
// "Nenhum e-mail encontrado" — e as 25 falhas dos últimos 7 dias traziam todas a MESMA
// mensagem, literal:
//
//   Hostname/IP does not match certificate's altnames:
//   Host: localhost. is not in the cert's altnames: DNS:atena.hostsrv.org
//
// O `.env` do servidor aponta `SMTP_HOST=localhost` (o servidor de e-mail roda na própria
// máquina da TineHost), mas o certificado que ele apresenta no STARTTLS é o da máquina
// física, `atena.hostsrv.org`. O nodemailer valida o nome, não bate, e recusa a conexão.
//
// Reparar isso baixando a guarda para QUALQUER host seria trocar um e-mail que não sai por
// um e-mail que sai para o servidor errado. A dispensa vale só para loopback, onde os bytes
// não chegam a entrar numa rede — e é por isso que estes testes existem: o dia em que
// alguém "simplificar" a condição, o teste do host remoto reprova.

describe("ehHostLocal", () => {
  it("reconhece as formas de loopback, inclusive a que veio no erro de produção", () => {
    // O erro do servidor dizia "Host: localhost." — com ponto final (FQDN absoluto).
    // Uma comparação ingênua com === "localhost" NÃO pega este caso.
    expect(ehHostLocal("localhost.")).toBe(true);
    expect(ehHostLocal("localhost")).toBe(true);
    expect(ehHostLocal("LOCALHOST")).toBe(true);
    expect(ehHostLocal("  localhost  ")).toBe(true);
    expect(ehHostLocal("127.0.0.1")).toBe(true);
    expect(ehHostLocal("::1")).toBe(true);
    expect(ehHostLocal("[::1]")).toBe(true);
  });

  it("NÃO confunde host remoto que apenas contém a palavra localhost", () => {
    // Estes são endereços de internet de verdade. Se algum dia um deles for tratado como
    // loopback, o app passa a aceitar certificado inválido num tráfego que sai da máquina.
    expect(ehHostLocal("localhost.evil.com")).toBe(false);
    expect(ehHostLocal("smtp.localhost.com")).toBe(false);
    expect(ehHostLocal("naolocalhost")).toBe(false);
    expect(ehHostLocal("atena.hostsrv.org")).toBe(false);
    expect(ehHostLocal("smtp.gmail.com")).toBe(false);
    expect(ehHostLocal("127.0.0.1.evil.com")).toBe(false);
    expect(ehHostLocal("")).toBe(false);
    expect(ehHostLocal(undefined)).toBe(false);
  });
});

describe("opcoesTls", () => {
  it("dispensa a conferência do NOME do certificado quando o SMTP é local", () => {
    // É este objeto que faltava no transporte e que fazia 100% dos e-mails falharem.
    expect(opcoesTls("localhost")).toEqual({ tls: { rejectUnauthorized: false } });
    expect(opcoesTls("localhost.")).toEqual({ tls: { rejectUnauthorized: false } });
    expect(opcoesTls("127.0.0.1")).toEqual({ tls: { rejectUnauthorized: false } });
  });

  it("mantém a conferência INTEIRA para qualquer host remoto", () => {
    // Nada de `tls` no objeto = o padrão do nodemailer, que é validar. A asserção é
    // negativa de propósito (lição da ADR-114): provar que a dispensa NÃO vazou.
    expect(opcoesTls("atena.hostsrv.org")).toEqual({});
    expect(opcoesTls("smtp.gmail.com")).toEqual({});
    expect(opcoesTls("localhost.evil.com")).toEqual({});
    expect(opcoesTls(undefined)).toEqual({});
  });
});
