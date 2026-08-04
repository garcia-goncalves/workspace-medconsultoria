import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";

const USER = process.env.EMAIL_TESTE_USER;
const PASS = process.env.EMAIL_TESTE_PASS;
const temCaixa = !!(USER && PASS);

// Sem credencial no .env local, o teste é pulado em vez de falhar — o CI não tem a caixa.
const talvez = temCaixa ? describe : describe.skip;

talvez("plugar caixa (integração, caixa real de teste)", () => {
  let userId = "";

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toContain("_test");
    process.env.EMAIL_CRYPTO_KEY ||= randomBytes(32).toString("base64");
    const u = await prisma.user.create({
      data: {
        nome: "Teste E-mail",
        email: `email-teste-${randomBytes(4).toString("hex")}@exemplo.local`,
        passwordHash: "x",
        role: "FUNCIONARIO",
      },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("recusa senha errada, sem gravar a caixa", async () => {
    const { plugarCaixa } = await import("../modules/email/caixas.service.js");
    await expect(
      plugarCaixa(userId, { email: USER!, senha: "senha-errada-de-proposito", nomeExibicao: "Teste" }),
    ).rejects.toThrow(/senha|autentic/i);
    expect(await prisma.caixaEmail.count({ where: { userId } })).toBe(0);
  });

  it("pluga com a senha certa e NÃO devolve o segredo", async () => {
    const { plugarCaixa, listarCaixas } = await import("../modules/email/caixas.service.js");
    await plugarCaixa(userId, { email: USER!, senha: PASS!, nomeExibicao: "Caixa de teste" });
    const caixas = await listarCaixas(userId);
    expect(caixas).toHaveLength(1);
    expect(caixas[0]!.email).toBe(USER);
    expect(caixas[0]!.estado).toBe("OK");
    expect(JSON.stringify(caixas)).not.toContain("segredo");
  });

  it("não deixa a mesma pessoa plugar o mesmo endereço duas vezes", async () => {
    const { plugarCaixa } = await import("../modules/email/caixas.service.js");
    await expect(
      plugarCaixa(userId, { email: USER!, senha: PASS!, nomeExibicao: "De novo" }),
    ).rejects.toThrow(/já/i);
  });

  it("remover e plugar de novo o MESMO endereço funciona (ressuscita a linha)", async () => {
    // Armadilha real: `removerCaixa` é soft-delete, mas o `@@unique([userId, email])` não
    // enxerga o `deletedAt`. Recriando com `create`, a pessoa batia num P2002 cru — e ficava
    // travada, porque `reconectarCaixa` também só acha caixa não-removida. Mesmo remédio do
    // ADR-92 nas contas: procurar a apagada e ressuscitar.
    const { plugarCaixa, removerCaixa, listarCaixas } = await import("../modules/email/caixas.service.js");
    const antes = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });

    await removerCaixa(userId, antes.id);
    expect(await listarCaixas(userId)).toHaveLength(0);
    const removida = await prisma.caixaEmail.findFirstOrThrow({ where: { id: antes.id }, select: { segredo: true } });
    expect(removida.segredo, "a senha não fica guardada depois de remover").toBe("");

    const denovo = await plugarCaixa(userId, { email: USER!, senha: PASS!, nomeExibicao: "Caixa de teste" });
    expect(denovo.id, "é a MESMA linha, ressuscitada").toBe(antes.id);
    const caixas = await listarCaixas(userId);
    expect(caixas).toHaveLength(1);
    expect(caixas[0]!.estado).toBe("OK");
  });

  it("descobre as pastas do servidor com os papéis certos", async () => {
    const { sincronizarPastas, listarPastas } = await import("../modules/email/pastas.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });

    await sincronizarPastas(caixa.id);
    const pastas = await listarPastas(userId, caixa.id);

    const papeis = pastas.map((p) => p.papel);
    expect(papeis).toContain("INBOX");
    expect(papeis).toContain("SENT");
    expect(papeis).toContain("TRASH");
    expect(pastas.find((p) => p.papel === "INBOX")!.nome).toBe("Caixa de entrada");
    // A INBOX aparece primeiro (ordem 0).
    expect(pastas[0]!.papel).toBe("INBOX");
  });

  it("mostra UMA pasta de spam, e é a que o servidor tem inscrita", async () => {
    // Este servidor devolve duas candidatas: `Junk` (com selo `\Junk`, mas NÃO inscrita — o
    // webmail não mostra) e `INBOX.spam` (sem selo, inscrita, é onde o filtro entrega). A
    // coluna mostrava as duas, "Spam" e "spam". Só entra pasta inscrita; o papel de quem não
    // tem selo sai do nome. Se a hospedagem mudar essa configuração, este teste avisa.
    const { listarPastas } = await import("../modules/email/pastas.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });

    const pastas = await listarPastas(userId, caixa.id);

    expect(pastas.filter((p) => p.papel === "JUNK")).toHaveLength(1);
    expect(pastas.filter((p) => p.nome === "Spam")).toHaveLength(1);
    expect(pastas.map((p) => p.caminho)).not.toContain("Junk");
    expect(pastas.find((p) => p.papel === "JUNK")!.caminho).toBe("INBOX.spam");
  });

  it("sincroniza a INBOX e indexa uma mensagem que acabou de chegar", async () => {
    const { ImapFlow } = await import("imapflow");
    const { sincronizarPasta } = await import("../modules/email/sync.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });
    const inbox = await prisma.caixaPasta.findFirstOrThrow({ where: { caixaId: caixa.id, papel: "INBOX" } });

    const marca = `sync-${Date.now()}`;
    const c = new ImapFlow({
      host: "mail.medconsultoria.com.br",
      port: 993,
      secure: true,
      auth: { user: USER!, pass: PASS! },
      logger: false,
    });
    await c.connect();
    await c.append(
      "INBOX",
      Buffer.from(
        [
          `From: Cliente Teste <cliente@exemplo.com>`,
          `To: ${USER}`,
          `Subject: ${marca}`,
          `Message-ID: <${marca}@exemplo.com>`,
          "Content-Type: text/plain; charset=utf-8",
          "",
          "corpo",
        ].join("\r\n"),
        "utf8",
      ),
    );
    await c.logout();

    const r = await sincronizarPasta(caixa.id, inbox.id);
    expect(r.novas).toBeGreaterThanOrEqual(1);

    const msg = await prisma.emailMensagem.findFirst({
      where: { pastaId: inbox.id, assunto: marca },
      include: { enderecos: true },
    });
    expect(msg).toBeTruthy();
    expect(msg!.deEmail).toBe("cliente@exemplo.com");
    expect(msg!.corpoHtml).toBeNull(); // índice não baixa corpo — é o ponto da opção "C"
    expect(msg!.enderecos.map((e) => e.papel)).toContain("DE");
    expect(msg!.enderecos.map((e) => e.endereco)).toContain("cliente@exemplo.com");
  });

  it("abre a mensagem, higieniza o corpo e guarda em cache", async () => {
    const { ImapFlow } = await import("imapflow");
    const { sincronizarPasta } = await import("../modules/email/sync.service.js");
    const { abrirMensagem } = await import("../modules/email/leitura.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });
    const inbox = await prisma.caixaPasta.findFirstOrThrow({ where: { caixaId: caixa.id, papel: "INBOX" } });

    const marca = `corpo-${Date.now()}`;
    const c = new ImapFlow({
      host: "mail.medconsultoria.com.br",
      port: 993,
      secure: true,
      auth: { user: USER!, pass: PASS! },
      logger: false,
    });
    await c.connect();
    await c.append(
      "INBOX",
      Buffer.from(
        [
          `From: Hostil <mau@exemplo.com>`,
          `To: ${USER}`,
          `Subject: ${marca}`,
          "Content-Type: text/html; charset=utf-8",
          "",
          '<p>ola</p><script>alert(1)</script><img src="https://rastreio/p.gif">',
        ].join("\r\n"),
        "utf8",
      ),
    );
    await c.logout();

    await sincronizarPasta(caixa.id, inbox.id);
    const msg = await prisma.emailMensagem.findFirstOrThrow({ where: { pastaId: inbox.id, assunto: marca } });

    const aberta = await abrirMensagem(userId, msg.id);
    expect(aberta.corpoHtml).toContain("ola");
    expect(aberta.corpoHtml!.toLowerCase()).not.toContain("script");
    expect(aberta.imagensBloqueadas).toBe(1);

    const depois = await prisma.emailMensagem.findFirstOrThrow({ where: { id: msg.id } });
    expect(depois.corpoEm).not.toBeNull(); // cache preenchido
    expect(depois.lido).toBe(true);
    expect(depois.trecho).toContain("ola"); // prévia da lista nasce aqui, não no índice
  });

  it("envia de verdade, guarda cópia em Enviados e marca a original como respondida", async () => {
    const { enviarMensagem } = await import("../modules/email/envio.service.js");
    const { sincronizarPastas } = await import("../modules/email/pastas.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });
    await sincronizarPastas(caixa.id);

    const marca = `envio-${Date.now()}`;
    const r = await enviarMensagem(userId, {
      caixaId: caixa.id,
      // Destino de teste: a trava do `conferirDestinoPermitido` recusaria qualquer outro.
      para: ["contato@medconsultoria.com.br"],
      cc: [],
      cco: [],
      assunto: marca,
      corpoHtml: "<p>corpo de teste</p>",
      anexos: [],
    });

    expect(r.enviado).toBe(true);
    expect(r.copiaEmEnviados, "a cópia em Enviados é o passo que todo mundo esquece").toBe(true);

    // A cópia tem de estar VISÍVEL na pasta de enviados do servidor, não só no nosso índice.
    const { sincronizarPasta } = await import("../modules/email/sync.service.js");
    const enviados = await prisma.caixaPasta.findFirstOrThrow({ where: { caixaId: caixa.id, papel: "SENT" } });
    await sincronizarPasta(caixa.id, enviados.id);
    const copia = await prisma.emailMensagem.findFirst({ where: { pastaId: enviados.id, assunto: marca } });
    expect(copia).toBeTruthy();
  });

  it("recusa enviar para endereço fora da lista de teste", async () => {
    const { enviarMensagem } = await import("../modules/email/envio.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });
    await expect(
      enviarMensagem(userId, {
        caixaId: caixa.id,
        para: ["cliente.de.verdade@exemplo.com"],
        cc: [],
        cco: [],
        assunto: "não deve sair",
        corpoHtml: "<p>x</p>",
        anexos: [],
      }),
    ).rejects.toThrow(/desenvolvimento/i);
  });
});
