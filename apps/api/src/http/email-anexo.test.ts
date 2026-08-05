import { describe, it, expect, afterAll, vi } from "vitest";
import { sep } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, utimes, rm, readdir } from "node:fs/promises";
import { Readable } from "node:stream";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { TAMANHO_MAX } from "../lib/storage.js";
import {
  pastaTemp,
  caminhoTemp,
  anexoTempVencido,
  limparAnexosTempOrfaos,
  cabeMaisUmAnexoTemp,
  usoPastaTemp,
  PRAZO_ANEXO_TEMP_MS,
  COTA_ANEXO_TEMP_BYTES,
} from "./email-anexo.js";

describe("caminhoTemp (defesa contra travessia de caminho)", () => {
  const userId = "cku1abc123xyz";
  const uuid = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

  it("aceita um UUID válido e devolve caminho dentro da pasta temp do usuário", () => {
    const caminho = caminhoTemp(userId, uuid);
    expect(caminho.startsWith(pastaTemp(userId) + sep)).toBe(true);
    expect(caminho.endsWith(uuid)).toBe(true);
  });

  it("aceita UUID em maiúsculas (o formato de UUID gerado por randomUUID é sempre minúsculo, mas o formato em si não é sensível a caixa)", () => {
    expect(() => caminhoTemp(userId, uuid.toUpperCase())).not.toThrow();
  });

  it("recusa id vazio", () => {
    expect(() => caminhoTemp(userId, "")).toThrow(/inválido/i);
  });

  it("recusa travessia de caminho (../../etc/passwd)", () => {
    expect(() => caminhoTemp(userId, "../../../../etc/passwd")).toThrow(/inválido/i);
  });

  it("recusa id com barra", () => {
    expect(() => caminhoTemp(userId, "../outro-usuario/segredo")).toThrow(/inválido/i);
  });

  it("recusa id com ponto (não é hex nem hífen)", () => {
    expect(() => caminhoTemp(userId, "3fa85f64-5717-4562-b3fc-2c963f66afa.")).toThrow(/inválido/i);
  });

  it("recusa id curto demais ou longo demais", () => {
    expect(() => caminhoTemp(userId, "abc")).toThrow(/inválido/i);
    expect(() => caminhoTemp(userId, uuid + "a")).toThrow(/inválido/i);
  });

  it("o caminho resolvido nunca escapa da pasta temp do usuário, mesmo com id válido", () => {
    // Defesa em profundidade: mesmo que o regex de formato mude no futuro, o prefixo
    // resolvido tem de ficar sempre dentro de `pastaTemp(userId)`.
    const caminho = caminhoTemp(userId, uuid);
    const raiz = pastaTemp(userId);
    expect(caminho === raiz || caminho.startsWith(raiz + sep)).toBe(true);
  });
});

// Achado A da rodada de correção 1: anexo removido da lista / compose cancelado / aba fechada
// não passam pelo `finally` de `enviarMensagem` — só a varredura por mtime limpa esses casos.
describe("anexoTempVencido (decide sem relógio real)", () => {
  it("arquivo mais novo que o prazo não venceu", () => {
    const agora = 10_000_000;
    expect(anexoTempVencido(agora - 1_000, agora, PRAZO_ANEXO_TEMP_MS)).toBe(false);
  });

  it("arquivo mais velho que o prazo venceu", () => {
    const agora = 10_000_000;
    expect(anexoTempVencido(agora - PRAZO_ANEXO_TEMP_MS - 1, agora, PRAZO_ANEXO_TEMP_MS)).toBe(true);
  });

  it("arquivo exatamente no limite do prazo ainda não venceu (limite exclusivo)", () => {
    const agora = 10_000_000;
    expect(anexoTempVencido(agora - PRAZO_ANEXO_TEMP_MS, agora, PRAZO_ANEXO_TEMP_MS)).toBe(false);
  });

  it("usa 24h como prazo padrão quando não informado", () => {
    expect(PRAZO_ANEXO_TEMP_MS).toBe(24 * 60 * 60 * 1000);
    const agora = 10_000_000;
    expect(anexoTempVencido(agora - 1_000, agora)).toBe(false);
    expect(anexoTempVencido(agora - PRAZO_ANEXO_TEMP_MS - 1_000, agora)).toBe(true);
  });
});

// Achado B1 da revisão de segurança: `POST /email-anexo` gravava até 20 MB por requisição sem
// somar NADA antes. Dentro do rate limit global (300 req/min), uma sessão de funcionário enche o
// disco muito antes de a varredura de órfãos (24 h de prazo, de hora em hora) tocar em algo — e,
// em hospedagem compartilhada, disco cheio derruba a app inteira, não só o e-mail.
describe("cota de disco dos anexos temporários, por pessoa", () => {
  const userId = `teste-cota-anexos-${randomUUID()}`;

  afterAll(async () => {
    await rm(pastaTemp(userId), { recursive: true, force: true });
  });

  it("deixa passar quem ainda não tem nada gravado", () => {
    expect(cabeMaisUmAnexoTemp(0)).toBe(true);
  });

  it("recusa mais um anexo quando o que já está gravado não deixa espaço para outro arquivo do tamanho máximo", () => {
    // Pessimista de propósito: o tamanho do arquivo que está chegando só seria conhecido DEPOIS
    // de gravá-lo — que é exatamente o que a cota existe para evitar.
    expect(cabeMaisUmAnexoTemp(COTA_ANEXO_TEMP_BYTES - TAMANHO_MAX)).toBe(true);
    expect(cabeMaisUmAnexoTemp(COTA_ANEXO_TEMP_BYTES - TAMANHO_MAX + 1)).toBe(false);
    expect(cabeMaisUmAnexoTemp(COTA_ANEXO_TEMP_BYTES)).toBe(false);
  });

  it("a cota é por pessoa e cabe folgadamente um envio inteiro (25 MB do teto agregado)", () => {
    expect(COTA_ANEXO_TEMP_BYTES).toBe(200 * 1024 * 1024);
    expect(cabeMaisUmAnexoTemp(25 * 1024 * 1024)).toBe(true);
  });

  it("usoPastaTemp devolve 0 quando a pessoa nunca anexou nada (pasta inexistente)", async () => {
    await expect(usoPastaTemp(`nunca-existiu-${randomUUID()}`)).resolves.toBe(0);
  });

  it("usoPastaTemp soma o tamanho real dos anexos já gravados da própria pessoa", async () => {
    await mkdir(pastaTemp(userId), { recursive: true });
    await writeFile(caminhoTemp(userId, randomUUID()), Buffer.alloc(3_000));
    await writeFile(caminhoTemp(userId, randomUUID()), Buffer.alloc(1_000));
    await expect(usoPastaTemp(userId)).resolves.toBe(4_000);
  });

  it("o upload seguinte é recusado quando a soma do que já está em disco estoura a cota", async () => {
    // Regressão do defeito em si, com os limites parametrizados para não escrever 200 MB no
    // disco só para provar a soma: 4 KB gravados, teto de 1 KB por arquivo, cota de 4 KB.
    const usados = await usoPastaTemp(userId);
    expect(usados).toBe(4_000);
    expect(cabeMaisUmAnexoTemp(usados, 1_000, 4_000)).toBe(false);
    expect(cabeMaisUmAnexoTemp(usados, 1_000, 8_000)).toBe(true);
  });
});

/**
 * Os testes acima cobrem as duas PEÇAS da cota (a decisão pura e a soma em disco) e não provam nada
 * sobre o HANDLER: apagando as linhas de `POST /email-anexo` que consultam `usoPastaTemp` e
 * recusam com 413, todos eles continuavam verdes — a correção da cota não tinha regressão nenhuma.
 * Isto aqui exercita a rota de verdade (`app.inject`), que é a única forma de travar o defeito.
 *
 * `app.inject` em vez de extrair a decisão para uma função: extrair só moveria o buraco de lugar —
 * apagar a CHAMADA da função dentro do handler continuaria passando. O custo do inject é uma
 * instância de Fastify por teste, medida em milissegundos.
 *
 * O que é dublado, e por quê:
 *  - `usuarioDaRequest`: a rota exige sessão por cookie assinado; não é o que está sob teste.
 *  - `TAMANHO_MAX` (o teto POR ARQUIVO que o multipart aplica): a decisão é `usados + TAMANHO_MAX
 *    <= COTA`, então provar a recusa com os valores reais exigiria 181 MB em disco. Baixar o teto
 *    por arquivo até a cota inteira faz um único byte já gravado estourar a conta — é o mesmo
 *    recurso que os testes puros acima usam ao passar limites por parâmetro. A COTA em si e a soma
 *    em disco continuam as de verdade.
 */
describe("rotas de anexo de e-mail (app de verdade, via app.inject)", () => {
  const usuarios: { pasta: string }[] = [];

  afterAll(async () => {
    for (const u of usuarios) await rm(u.pasta, { recursive: true, force: true });
    for (const m of ["../lib/storage.js", "./uploads.js", "@app/db", "../modules/email/imap.js"]) vi.doUnmock(m);
    vi.resetModules();
  });

  /** Espião do efeito colateral do `comCaixa` real: marcar a caixa como ERRO (`imap.ts`). */
  const marcouCaixaComoErro = vi.fn();

  /**
   * Repete o contrato do `comCaixa` real, inclusive as duas coisas que importam aqui: ele marca a
   * caixa como ERRO ANTES de relançar (então um `try` de fora não desfaz nada), e ele só NÃO marca
   * quando quem chamou passou `marcarErro: false`. `falhaAoConectar` dubla o `c.connect()` que
   * estoura — o callback nem chega a rodar, que é justamente o buraco que nenhum `try` interno pega.
   */
  function comCaixaFalso(opcoes: { cliente?: unknown; falhaAoConectar?: Error }) {
    return vi.fn(
      async (_caixaId: string, fn: (c: never) => Promise<unknown>, cfg?: { marcarErro?: boolean }) => {
        try {
          if (opcoes.falhaAoConectar) throw opcoes.falhaAoConectar;
          return await fn(opcoes.cliente as never);
        } catch (e) {
          if (cfg?.marcarErro !== false) marcouCaixaComoErro(e);
          throw e;
        }
      },
    );
  }

  const ANEXO_NO_BANCO = {
    nome: "contrato.pdf",
    parte: "2",
    mensagem: { uid: 77, pasta: { caminho: "INBOX", caixaId: "caixa-1" } },
  };

  /** Sobe uma app Fastify com só esta rota, sobre uma cópia fresca do módulo. */
  async function montarApp(opcoes: {
    userId: string;
    role?: string;
    tamanhoMaxPorArquivo: number;
    /** O que `prisma.emailAnexo.findFirst` devolve — só o GET usa. */
    anexo?: unknown;
    /** Dublagem do `comCaixa` — só o GET usa (ver `comCaixaFalso`). */
    comCaixa?: unknown;
  }) {
    vi.resetModules();
    marcouCaixaComoErro.mockClear();
    const storageReal = await vi.importActual<typeof import("../lib/storage.js")>("../lib/storage.js");
    vi.doMock("../lib/storage.js", () => ({ ...storageReal, TAMANHO_MAX: opcoes.tamanhoMaxPorArquivo }));
    vi.doMock("./uploads.js", () => ({
      usuarioDaRequest: async () => ({ id: opcoes.userId, role: opcoes.role ?? "ADMIN" }),
    }));
    vi.doMock("@app/db", () => ({
      prisma: { emailAnexo: { findFirst: async () => opcoes.anexo ?? null } },
    }));
    vi.doMock("../modules/email/imap.js", () => ({ comCaixa: opcoes.comCaixa ?? vi.fn() }));
    const mod = await import("./email-anexo.js");

    const app = Fastify();
    await app.register(multipart, { limits: { fileSize: opcoes.tamanhoMaxPorArquivo, files: 1 } });
    mod.registrarRotaAnexoEmail(app);
    await app.ready();

    usuarios.push({ pasta: mod.pastaTemp(opcoes.userId) });
    return { app, mod };
  }

  function corpoMultipart(conteudo: string) {
    const boundary = "----limiteDeTesteDoAnexo";
    return {
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="anexo.txt"\r\n` +
          `Content-Type: text/plain\r\n\r\n${conteudo}\r\n--${boundary}--\r\n`,
      ),
    };
  }

  it("recusa com 413 quando o que a pessoa já tem em disco não deixa espaço para mais um arquivo", async () => {
    const userId = `teste-handler-cota-${randomUUID()}`;
    const { app, mod } = await montarApp({ userId, tamanhoMaxPorArquivo: COTA_ANEXO_TEMP_BYTES });
    await mkdir(mod.pastaTemp(userId), { recursive: true });
    await writeFile(mod.caminhoTemp(userId, randomUUID()), Buffer.alloc(1_000));

    const r = await app.inject({ method: "POST", url: "/email-anexo", ...corpoMultipart("nao pode entrar") });

    expect(r.statusCode).toBe(413);
    expect(r.json().error).toMatch(/limite de 200 MB por pessoa/i);
    // E, sobretudo, NÃO gravou: a cota existe para nada tocar o disco depois de a conta estourar.
    expect(await readdir(mod.pastaTemp(userId))).toHaveLength(1);
    await app.close();
  });

  it("deixa passar e grava o anexo quando ainda cabe", async () => {
    const userId = `teste-handler-cabe-${randomUUID()}`;
    const { app, mod } = await montarApp({ userId, tamanhoMaxPorArquivo: 4_000 });

    const r = await app.inject({ method: "POST", url: "/email-anexo", ...corpoMultipart("conteudo do anexo") });

    expect(r.statusCode).toBe(200);
    expect(r.json().nome).toBe("anexo.txt");
    expect(await readdir(mod.pastaTemp(userId))).toEqual([r.json().id]);
    await app.close();
  });

  it("CLIENTE (Portal) não anexa e-mail nenhum, nem chega a gastar disco", async () => {
    const userId = `teste-handler-cliente-${randomUUID()}`;
    const { app } = await montarApp({ userId, role: "CLIENTE", tamanhoMaxPorArquivo: 4_000 });

    const r = await app.inject({ method: "POST", url: "/email-anexo", ...corpoMultipart("nao deveria passar") });

    expect(r.statusCode).toBe(403);
    await app.close();
  });

  // Achado da revisão da onda B2: o GET tinha o MESMO buraco do descarte de rascunho, com o mesmo
  // comentário afirmando cobertura que não existia. O `try` interno protege o corpo do callback,
  // mas a CONEXÃO é aberta antes dele — e aqui a recusa por limite de conexões simultâneas do
  // Dovecot é o caso normal, não o raro: o download segura o lock da pasta durante a entrega
  // inteira. Regra da fase: falha em operação ACESSÓRIA não marca a caixa.
  describe("GET /email-anexo/:mensagemId/:anexoId — baixar anexo não pode declarar a caixa quebrada", () => {
    function clienteQueBaixa() {
      return {
        getMailboxLock: async () => ({ release: () => {} }),
        download: async () => ({ content: Readable.from([Buffer.from("conteudo do anexo")]) }),
      };
    }

    it("entrega o anexo pedindo ao comCaixa para NÃO marcar a caixa", async () => {
      const comCaixa = comCaixaFalso({ cliente: clienteQueBaixa() });
      const { app } = await montarApp({
        userId: `teste-get-ok-${randomUUID()}`,
        tamanhoMaxPorArquivo: 4_000,
        anexo: ANEXO_NO_BANCO,
        comCaixa,
      });

      const r = await app.inject({ method: "GET", url: "/email-anexo/msg-1/anexo-1" });

      expect(r.statusCode).toBe(200);
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      expect(r.headers["content-type"]).toBe("application/octet-stream");
      expect(comCaixa).toHaveBeenCalledWith("caixa-1", expect.any(Function), { marcarErro: false });
      await app.close();
    });

    it("falha ao CONECTAR não marca a caixa como ERRO — e quem clicou continua vendo o erro", async () => {
      const comCaixa = comCaixaFalso({
        cliente: clienteQueBaixa(),
        falhaAoConectar: new Error("Maximum number of connections from user+IP exceeded"),
      });
      const { app } = await montarApp({
        userId: `teste-get-conexao-${randomUUID()}`,
        tamanhoMaxPorArquivo: 4_000,
        anexo: ANEXO_NO_BANCO,
        comCaixa,
      });

      const r = await app.inject({ method: "GET", url: "/email-anexo/msg-1/anexo-1" });

      // As duas metades: a requisição falha (o erro continua visível para quem apertou Baixar)…
      expect(r.statusCode).toBe(500);
      // …e mesmo assim a caixa da pessoa NÃO passa a aparecer quebrada na tela.
      expect(marcouCaixaComoErro).not.toHaveBeenCalled();
      await app.close();
    });

    it("anexo que não é da caixa desta pessoa dá 404 e nem chega a abrir conexão", async () => {
      const comCaixa = comCaixaFalso({ cliente: clienteQueBaixa() });
      const { app } = await montarApp({
        userId: `teste-get-404-${randomUUID()}`,
        tamanhoMaxPorArquivo: 4_000,
        anexo: null, // o `findFirst` já filtra por `caixa: { userId }` — não achou = não é dela
        comCaixa,
      });

      const r = await app.inject({ method: "GET", url: "/email-anexo/msg-1/anexo-1" });

      expect(r.statusCode).toBe(404);
      expect(comCaixa).not.toHaveBeenCalled();
      await app.close();
    });
  });
});

describe("limparAnexosTempOrfaos (varredura real em disco, por mtime)", () => {
  const userId = `teste-limpeza-anexos-${randomUUID()}`;

  afterAll(async () => {
    await rm(pastaTemp(userId), { recursive: true, force: true });
  });

  it("não lança quando a pasta email-tmp ainda não existe (instalação sem nenhum anexo)", async () => {
    await expect(limparAnexosTempOrfaos()).resolves.toBeUndefined();
  });

  it("apaga só o anexo mais velho que o prazo, mantendo o recente e ignorando nome fora do formato", async () => {
    const velhoId = randomUUID();
    const novoId = randomUUID();
    await mkdir(pastaTemp(userId), { recursive: true });
    await writeFile(caminhoTemp(userId, velhoId), "conteudo velho");
    await writeFile(caminhoTemp(userId, novoId), "conteudo novo");
    // Nome que não é UUID: a varredura tem de ignorar (não é um anexo temporário nosso).
    await writeFile(`${pastaTemp(userId)}${sep}nao-e-um-anexo.txt`, "estranho");

    // Backdata o mtime do "velho" para além do prazo, sem precisar mockar o relógio.
    const passado = new Date(Date.now() - PRAZO_ANEXO_TEMP_MS - 60_000);
    await utimes(caminhoTemp(userId, velhoId), passado, passado);

    await limparAnexosTempOrfaos();

    const restantes = await readdir(pastaTemp(userId));
    expect(restantes).toContain(novoId);
    expect(restantes).toContain("nao-e-um-anexo.txt");
    expect(restantes).not.toContain(velhoId);
  });
});
