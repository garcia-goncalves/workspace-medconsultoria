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

  it("envia de verdade e guarda cópia em Enviados", async () => {
    // NOTA: este teste NÃO cobre o PASSO 3 (marcar a original como respondida) — o input não
    // tem `emRespostaA`, então `modo` fica `null` e o passo nem roda. A cobertura do PASSO 3
    // está no teste seguinte, que responde de verdade a uma mensagem existente.
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
      anexosOriginais: [],
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

  it("responde a uma mensagem existente e marca a original como respondida (banco e servidor)", async () => {
    // Cobre o PASSO 3 de `enviarMensagem` (envio.service.ts): só roda quando `emRespostaA` vem
    // preenchido. Cria a mensagem original AQUI (não depende de estado prévio da caixa), com
    // `From` já autorizado — é para ele que a resposta vai, e `conferirDestinoPermitido`
    // recusaria qualquer outro destino fora dos dois endereços de teste.
    const { ImapFlow } = await import("imapflow");
    const { sincronizarPasta } = await import("../modules/email/sync.service.js");
    const { enviarMensagem } = await import("../modules/email/envio.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });
    const inbox = await prisma.caixaPasta.findFirstOrThrow({ where: { caixaId: caixa.id, papel: "INBOX" } });

    const marca = `resposta-${Date.now()}`;
    const c1 = new ImapFlow({
      host: "mail.medconsultoria.com.br",
      port: 993,
      secure: true,
      auth: { user: USER!, pass: PASS! },
      logger: false,
    });
    await c1.connect();
    await c1.append(
      "INBOX",
      Buffer.from(
        [
          `From: Contato MedConsultoria <contato@medconsultoria.com.br>`,
          `To: ${USER}`,
          `Subject: ${marca}`,
          `Message-ID: <${marca}@medconsultoria.com.br>`,
          "Content-Type: text/plain; charset=utf-8",
          "",
          "corpo original",
        ].join("\r\n"),
        "utf8",
      ),
    );
    await c1.logout();

    await sincronizarPasta(caixa.id, inbox.id);
    const original = await prisma.emailMensagem.findFirstOrThrow({ where: { pastaId: inbox.id, assunto: marca } });
    expect(original.respondido, "a mensagem recém-criada ainda não foi respondida").toBe(false);

    const r = await enviarMensagem(userId, {
      caixaId: caixa.id,
      para: ["contato@medconsultoria.com.br"],
      cc: [],
      cco: [],
      assunto: `Re: ${marca}`,
      corpoHtml: "<p>resposta de teste</p>",
      anexos: [],
      anexosOriginais: [],
      emRespostaA: original.id,
    });
    expect(r.enviado).toBe(true);

    // Ponta 1 — banco: o PASSO 3 grava `respondido: true` na mensagem original.
    const depois = await prisma.emailMensagem.findFirstOrThrow({ where: { id: original.id } });
    expect(depois.respondido, "PASSO 3 tem de gravar respondido=true no banco").toBe(true);

    // Ponta 2 — servidor: a flag \Answered tem de estar de fato na mensagem, por UID, numa
    // conexão IMAP nova. Esta é a asserção que importa: `messageFlagsAdd` do imapflow devolve
    // `false` sem lançar quando não consegue marcar, e o PASSO 3 engole qualquer erro num
    // `catch {}` vazio — sem conferir o servidor, o banco podia dizer "respondido" com o
    // servidor nunca tendo marcado nada.
    const c2 = new ImapFlow({
      host: "mail.medconsultoria.com.br",
      port: 993,
      secure: true,
      auth: { user: USER!, pass: PASS! },
      logger: false,
    });
    await c2.connect();
    const lock = await c2.getMailboxLock("INBOX");
    let flags: Set<string> | undefined;
    try {
      const msg = await c2.fetchOne(String(original.uid), { flags: true }, { uid: true });
      flags = msg ? msg.flags : undefined;
    } finally {
      lock.release();
    }
    await c2.logout();
    expect(flags?.has("\\Answered"), "a flag \\Answered tem de estar de fato marcada no servidor").toBe(true);
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
        anexosOriginais: [],
      }),
    ).rejects.toThrow(/desenvolvimento/i);
  });

  it("grava rascunho na pasta Drafts do servidor e regravar por cima (uidAnterior) não duplica", async () => {
    // Prova ao vivo do defeito clássico da Tarefa 8 (0.3 do brief): se a remoção da versão
    // anterior não rodasse, a segunda gravação deixaria DUAS mensagens na pasta Drafts.
    //
    // Confere por UID (não por SEARCH SUBJECT): `SEARCH SUBJECT` do IMAP é por SUBSTRING, então
    // um assunto "X-v2" bate na busca por "X" — não serve para provar unicidade.
    const { salvarRascunho } = await import("../modules/email/rascunhos.service.js");
    const { ImapFlow } = await import("imapflow");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });
    const drafts = await prisma.caixaPasta.findFirstOrThrow({ where: { caixaId: caixa.id, papel: "DRAFTS" } });

    const r1 = await salvarRascunho(userId, {
      caixaId: caixa.id,
      para: ["contato@medconsultoria.com.br"],
      cc: [],
      cco: [],
      assunto: `rascunho-${Date.now()}`,
      corpoHtml: "<p>primeira versão</p>",
    });
    expect(r1.uid, "UIDPLUS deste servidor devolve o uid da mensagem recém-gravada").not.toBeNull();

    const r2 = await salvarRascunho(userId, {
      caixaId: caixa.id,
      para: ["contato@medconsultoria.com.br"],
      cc: [],
      cco: [],
      assunto: `rascunho-${Date.now()}-outro-assunto-independente`,
      corpoHtml: "<p>segunda versão, por cima da primeira</p>",
      uidAnterior: r1.uid!,
    });
    expect(r2.uid).not.toBeNull();
    expect(r2.uid).not.toBe(r1.uid);

    const c = new ImapFlow({
      host: "mail.medconsultoria.com.br",
      port: 993,
      secure: true,
      auth: { user: USER!, pass: PASS! },
      logger: false,
    });
    await c.connect();
    try {
      const lock = await c.getMailboxLock(drafts.caminho);
      try {
        const antigo = await c.fetchOne(String(r1.uid), { uid: true }, { uid: true });
        expect(antigo, "a versão antiga tem de ter sumido — é ela que a regravação removeu").toBeFalsy();

        const novo = await c.fetchOne(String(r2.uid), { flags: true }, { uid: true });
        expect(novo, "a versão nova tem de estar lá").toBeTruthy();
        expect(novo && novo.flags?.has("\\Draft"), "gravado com a flag \\Draft").toBe(true);
      } finally {
        lock.release();
      }
      // Limpa o artefato de teste — não deixar rascunho de teste morando na caixa real.
      const lock2 = await c.getMailboxLock(drafts.caminho);
      try {
        await c.messageDelete(String(r2.uid!), { uid: true });
      } finally {
        lock2.release();
      }
    } finally {
      await c.logout().catch(() => {});
    }
  });

  it("expurgo é por UID — não mexe em outro rascunho marcado \\Deleted por fora (webmail)", async () => {
    // Prova ao vivo da armadilha 2 do brief: um EXPUNGE cego apagaria TODAS as mensagens
    // \Deleted da pasta. `messageDelete(uid, { uid: true })` tem de mexer só na apontada.
    const { salvarRascunho } = await import("../modules/email/rascunhos.service.js");
    const { ImapFlow } = await import("imapflow");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });
    const drafts = await prisma.caixaPasta.findFirstOrThrow({ where: { caixaId: caixa.id, papel: "DRAFTS" } });

    const marcaBase = `rascunho-base-${Date.now()}`;
    const base = await salvarRascunho(userId, {
      caixaId: caixa.id,
      para: ["contato@medconsultoria.com.br"],
      cc: [],
      cco: [],
      assunto: marcaBase,
      corpoHtml: "<p>base</p>",
    });
    expect(base.uid).not.toBeNull();

    const c = new ImapFlow({
      host: "mail.medconsultoria.com.br",
      port: 993,
      secure: true,
      auth: { user: USER!, pass: PASS! },
      logger: false,
    });
    await c.connect();
    let uidAlheio: number | undefined;
    try {
      // Simula um rascunho de OUTRA composição que a pessoa marcou \Deleted no webmail, mas
      // ainda não expurgou — o cenário exato em que um EXPUNGE cego apagaria o que não devia.
      const alheio = await c.append(
        drafts.caminho,
        Buffer.from(
          [`From: ${USER}`, `Subject: alheio-${Date.now()}`, "Content-Type: text/plain; charset=utf-8", "", "rascunho alheio"].join(
            "\r\n",
          ),
          "utf8",
        ),
        ["\\Draft"],
      );
      uidAlheio = alheio && typeof alheio.uid === "number" ? alheio.uid : undefined;
      expect(uidAlheio, "precisa do UID para marcar \\Deleted por fora do nosso serviço").not.toBeUndefined();

      const lockMarcar = await c.getMailboxLock(drafts.caminho);
      try {
        await c.messageFlagsAdd(String(uidAlheio), ["\\Deleted"], { uid: true });
      } finally {
        lockMarcar.release();
      }

      // Regrava o rascunho BASE por cima — dispara `messageDelete(base.uid, { uid: true })`.
      const marcaNova = `${marcaBase}-v2`;
      const novo = await salvarRascunho(userId, {
        caixaId: caixa.id,
        para: ["contato@medconsultoria.com.br"],
        cc: [],
        cco: [],
        assunto: marcaNova,
        corpoHtml: "<p>por cima</p>",
        uidAnterior: base.uid!,
      });

      const lockConferir = await c.getMailboxLock(drafts.caminho);
      try {
        const aindaExiste = await c.fetchOne(String(uidAlheio), { flags: true }, { uid: true });
        expect(aindaExiste, "a mensagem alheia \\Deleted NÃO pode ter sido expurgada").toBeTruthy();
      } finally {
        lockConferir.release();
      }

      // Limpa os dois artefatos de teste.
      const lockLimpar = await c.getMailboxLock(drafts.caminho);
      try {
        if (novo.uid !== null) await c.messageDelete(String(novo.uid), { uid: true });
        if (uidAlheio !== undefined) await c.messageDelete(String(uidAlheio), { uid: true });
      } finally {
        lockLimpar.release();
      }
    } finally {
      await c.logout().catch(() => {});
    }
  });

  it("caixa sem pasta Drafts devolve uid null sem estourar (não perde o texto por causa de pasta ausente)", async () => {
    const { salvarRascunho } = await import("../modules/email/rascunhos.service.js");
    const { sincronizarPastas } = await import("../modules/email/pastas.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });
    const drafts = await prisma.caixaPasta.findFirstOrThrow({ where: { caixaId: caixa.id, papel: "DRAFTS" } });

    // Remove só o CACHE local da pasta (o que `salvarRascunho` consulta) — a pasta continua
    // existindo de verdade no servidor. `sincronizarPastas`, no `finally`, recria a linha.
    await prisma.caixaPasta.delete({ where: { id: drafts.id } });
    try {
      await expect(
        salvarRascunho(userId, {
          caixaId: caixa.id,
          para: ["contato@medconsultoria.com.br"],
          cc: [],
          cco: [],
          assunto: "não pode estourar",
          corpoHtml: "<p>x</p>",
        }),
      ).resolves.toEqual({ uid: null });
    } finally {
      await sincronizarPastas(caixa.id);
    }
  });

  it("descartarRascunho apaga o rascunho por UID (usado pelo front depois de um envio bem-sucedido)", async () => {
    // Rodada de correção 1 — achado 2: o rascunho da composição que acabou de ser enviada não
    // pode sobrar para sempre em Rascunhos. Este é o teste ao vivo da procedure que o front chama
    // no `onSuccess` do envio.
    const { salvarRascunho, descartarRascunho } = await import("../modules/email/rascunhos.service.js");
    const { ImapFlow } = await import("imapflow");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });
    const drafts = await prisma.caixaPasta.findFirstOrThrow({ where: { caixaId: caixa.id, papel: "DRAFTS" } });

    const salvo = await salvarRascunho(userId, {
      caixaId: caixa.id,
      para: ["contato@medconsultoria.com.br"],
      cc: [],
      cco: [],
      assunto: `rascunho-a-descartar-${Date.now()}`,
      corpoHtml: "<p>vai ser descartado</p>",
    });
    expect(salvo.uid).not.toBeNull();

    await descartarRascunho(userId, { caixaId: caixa.id, uid: salvo.uid! });

    const c = new ImapFlow({
      host: "mail.medconsultoria.com.br",
      port: 993,
      secure: true,
      auth: { user: USER!, pass: PASS! },
      logger: false,
    });
    await c.connect();
    try {
      const lock = await c.getMailboxLock(drafts.caminho);
      try {
        const ainda = await c.fetchOne(String(salvo.uid), { uid: true }, { uid: true });
        expect(ainda, "o rascunho tem de ter sumido do servidor, não só do índice local").toBeFalsy();
      } finally {
        lock.release();
      }
    } finally {
      await c.logout().catch(() => {});
    }
  });

  it("descartarRascunho não estoura se a caixa não tiver pasta Drafts (mesma defesa do salvar)", async () => {
    const { descartarRascunho } = await import("../modules/email/rascunhos.service.js");
    const { sincronizarPastas } = await import("../modules/email/pastas.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });
    const drafts = await prisma.caixaPasta.findFirstOrThrow({ where: { caixaId: caixa.id, papel: "DRAFTS" } });

    await prisma.caixaPasta.delete({ where: { id: drafts.id } });
    try {
      await expect(descartarRascunho(userId, { caixaId: caixa.id, uid: 999999 })).resolves.toBeUndefined();
    } finally {
      await sincronizarPastas(caixa.id);
    }
  });
});
