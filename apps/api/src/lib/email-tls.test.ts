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
    // 587 (STARTTLS) é a porta que o servidor de produção usa; 465 e 25 seguem o mesmo caminho.
    const local = { requireTLS: false, tls: { rejectUnauthorized: false } };
    expect(opcoesTls("localhost", 587)).toEqual(local);
    expect(opcoesTls("localhost.", 587)).toEqual(local);
    expect(opcoesTls("127.0.0.1", 465)).toEqual(local);
    expect(opcoesTls("localhost", 25)).toEqual(local);
  });

  it("mantém a conferência INTEIRA e EXIGE TLS para qualquer host remoto", () => {
    // Sem `tls` no objeto = o padrão do nodemailer, que é validar cadeia e nome. A asserção é
    // negativa de propósito (lição da ADR-114): provar que a dispensa NÃO vazou para fora.
    // `requireTLS: true` fecha o downgrade para texto claro, que levaria a senha junto.
    const remoto = { requireTLS: true };
    expect(opcoesTls("atena.hostsrv.org", 587)).toEqual(remoto);
    expect(opcoesTls("smtp.gmail.com", 465)).toEqual(remoto);
    expect(opcoesTls("localhost.evil.com", 587)).toEqual(remoto);
    expect(opcoesTls(undefined, 587)).toEqual(remoto);
  });

  it("NÃO dispensa o certificado em porta alta, mesmo sendo loopback", () => {
    // Em hospedagem compartilhada, porta >=1024 pode ser ocupada por um vizinho SEM ser root.
    // Se aceitássemos certificado autoassinado ali, ele colheria SMTP_USER e SMTP_PASS no AUTH.
    // Preferimos o e-mail falhar de forma visível a vazar a senha em silêncio.
    expect(opcoesTls("localhost", 1024)).toEqual({ requireTLS: false });
    expect(opcoesTls("localhost", 2525)).toEqual({ requireTLS: false });
    expect(opcoesTls("127.0.0.1", 8025)).toEqual({ requireTLS: false });
    // A fronteira exata, para ninguém trocar <= por < sem o teste reclamar.
    expect(opcoesTls("localhost", 1023)).toEqual({
      requireTLS: false,
      tls: { rejectUnauthorized: false },
    });
  });

  it("NÃO exige STARTTLS em loopback — foi isto que quebrou a CI na primeira tentativa", () => {
    // O job `integration` reprovou com "Nenhum e-mail para ... em 15000ms" quando `requireTLS`
    // era `true` sempre: o Mailpit (servidor de e-mail de mentira dos testes) não oferece
    // STARTTLS, e o envio morria calado. Este teste existe para a regressão não voltar.
    expect(opcoesTls("localhost", 1025).requireTLS).toBe(false);
    expect(opcoesTls("127.0.0.1", 1025).requireTLS).toBe(false);
  });
});
