import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

/**
 * O vínculo e-mail ↔ cliente/lead (fase 2D-1). Prisma dublado, mas NÃO com um `findMany` que
 * devolve lista fixa: aqui o dublê **avalia o `where`** contra um conjunto de linhas em memória.
 *
 * O motivo é que as três regras de privacidade desta fase — `particular`, Lixeira e Spam — moram
 * no `where`, ou seja, no SQL. Um dublê que ignorasse o `where` deixaria os testes 3 e 4 verdes
 * com o filtro apagado do código, que é exatamente o defeito que eles existem para pegar (já
 * aconteceu três vezes nesta fase: teste que passa antes da implementação é teste errado).
 * O dublê entende só os construtos que o serviço usa; se o serviço mudar a forma do `where`,
 * o dublê deixa de filtrar e o teste fica vermelho — o acoplamento é proposital.
 */

type Linha = {
  id: string;
  messageId: string | null;
  deNome: string | null;
  deEmail: string;
  assunto: string | null;
  trecho: string | null;
  dataEm: Date;
  temAnexo: boolean;
  particular: boolean;
  /** Papel da pasta em que a mensagem está — `null` = pasta comum criada pela pessoa. */
  papel: "INBOX" | "SENT" | "DRAFTS" | "TRASH" | "JUNK" | "ARCHIVE" | null;
  dono: { id: string; nome: string };
  caixa: { id: string; email: string };
  enderecos: Array<{ papel: string; nome: string | null; endereco: string }>;
  /** Corpo em cache — a lista NUNCA pode devolver isto. */
  corpoHtml?: string | null;
  corpoTexto?: string | null;
};

const mocks = vi.hoisted(() => ({
  clienteFindFirst: vi.fn(),
  leadFindFirst: vi.fn(),
  mensagemFindMany: vi.fn(),
  mensagemUpdateMany: vi.fn(),
  listPorCliente: vi.fn(),
  listPorLead: vi.fn(),
}));

vi.mock("@app/db", () => ({
  prisma: {
    cliente: { findFirst: mocks.clienteFindFirst },
    lead: { findFirst: mocks.leadFindFirst },
    emailMensagem: { findMany: mocks.mensagemFindMany, updateMany: mocks.mensagemUpdateMany },
  },
}));

vi.mock("../emails/enviados.service.js", () => ({
  listPorCliente: mocks.listPorCliente,
  listPorLead: mocks.listPorLead,
}));

const {
  enderecosDoCliente,
  enderecosDoLead,
  listarPorEnderecos,
  mensagensDoCliente,
  conversaDoCliente,
  conversaDoLead,
  marcarParticular,
} = await import("./vinculo.service.js");

// ── dublê de banco: avalia o `where` que o serviço monta ──────────────────────────────────

/** O que o Prisma devolveria para o `select` do serviço, a partir de uma linha do conjunto. */
function comoOPrismaDevolve(l: Linha) {
  return {
    id: l.id,
    messageId: l.messageId,
    deNome: l.deNome,
    deEmail: l.deEmail,
    assunto: l.assunto,
    trecho: l.trecho,
    dataEm: l.dataEm,
    temAnexo: l.temAnexo,
    particular: l.particular,
    enderecos: l.enderecos,
    pasta: {
      papel: l.papel,
      nome: l.papel ?? "pasta",
      caixa: { id: l.caixa.id, email: l.caixa.email, userId: l.dono.id, user: { nome: l.dono.nome } },
    },
  };
}

function bancoDeMensagens(linhas: Linha[]) {
  mocks.mensagemFindMany.mockImplementation(async (args: any) => {
    const w = args?.where ?? {};
    let saida = linhas.filter((l) => {
      if (w.particular === false && l.particular) return false;

      const alvos: string[] | undefined = w.enderecos?.some?.endereco?.in;
      if (alvos && !l.enderecos.some((e) => alvos.includes(e.endereco))) return false;

      // `pasta: { OR: [{ papel: null }, { papel: { notIn: [...] } }] }`
      const ou: any[] | undefined = w.pasta?.OR;
      if (ou) {
        const passa = ou.some((c) => {
          if ("papel" in c && c.papel === null) return l.papel === null;
          const fora: string[] | undefined = c.papel?.notIn;
          return fora ? l.papel !== null && !fora.includes(l.papel) : true;
        });
        if (!passa) return false;
      }
      return true;
    });

    saida = saida.sort((a, b) => b.dataEm.getTime() - a.dataEm.getTime());
    if (typeof args?.take === "number") saida = saida.slice(0, args.take);
    return saida.map(comoOPrismaDevolve);
  });
}

// ── conjunto de apoio ─────────────────────────────────────────────────────────────────────

const DONA = { id: "user-thais", nome: "Thaís" };
const CAIXA = { id: "caixa-1", email: "thais@medconsultoria.com.br" };

let seq = 0;
function linha(p: Partial<Linha> = {}): Linha {
  seq += 1;
  return {
    id: `msg-${seq}`,
    messageId: `<${seq}@exemplo.com>`,
    deNome: "Thaís",
    deEmail: CAIXA.email,
    assunto: "Assunto",
    trecho: "resumo em texto puro",
    dataEm: new Date("2026-08-01T12:00:00Z"),
    temAnexo: false,
    particular: false,
    papel: "INBOX",
    dono: DONA,
    caixa: CAIXA,
    enderecos: [{ papel: "DE", nome: "Thaís", endereco: CAIXA.email }],
    ...p,
  };
}

function clienteComEmails(email: string | null, contatos: Array<string | null> = []) {
  mocks.clienteFindFirst.mockResolvedValue({ email, contatos: contatos.map((e) => ({ email: e })) });
}

beforeEach(() => {
  seq = 0;
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.listPorCliente.mockResolvedValue([]);
  mocks.listPorLead.mockResolvedValue([]);
  bancoDeMensagens([]);
});

// ── Fatia 1 — o vínculo ───────────────────────────────────────────────────────────────────

describe("endereços do cliente e do lead", () => {
  it("junta o e-mail do cliente com o de cada contato, normalizado e sem repetir", async () => {
    clienteComEmails("Contato@Empresa.com.br", ["Financeiro@Empresa.com.br", "contato@empresa.com.br", null]);
    expect(await enderecosDoCliente("cli-1")).toEqual([
      "contato@empresa.com.br",
      "financeiro@empresa.com.br",
    ]);
  });

  it("lead usa o próprio e-mail (não tem contatos)", async () => {
    mocks.leadFindFirst.mockResolvedValue({ email: " Fulano@Exemplo.COM " });
    expect(await enderecosDoLead("lead-1")).toEqual(["fulano@exemplo.com"]);
  });
});

describe("listagem por endereço", () => {
  it("1. lista mensagem cujo REMETENTE é o cliente", async () => {
    clienteComEmails("cliente@exemplo.com");
    bancoDeMensagens([
      linha({
        deEmail: "cliente@exemplo.com",
        enderecos: [
          { papel: "DE", nome: "Cliente", endereco: "cliente@exemplo.com" },
          { papel: "PARA", nome: null, endereco: CAIXA.email },
        ],
      }),
      linha({ enderecos: [{ papel: "DE", nome: null, endereco: "outro@exemplo.com" }] }),
    ]);

    const r = await mensagensDoCliente("cli-1");
    expect(r.map((m) => m.deEmail)).toEqual(["cliente@exemplo.com"]);
  });

  it("2. lista mensagem cujo DESTINATÁRIO (para/cc) é o cliente", async () => {
    clienteComEmails("cliente@exemplo.com");
    bancoDeMensagens([
      linha({
        id: "no-para",
        enderecos: [
          { papel: "DE", nome: null, endereco: CAIXA.email },
          { papel: "PARA", nome: null, endereco: "cliente@exemplo.com" },
        ],
      }),
      linha({
        id: "no-cc",
        enderecos: [
          { papel: "DE", nome: null, endereco: CAIXA.email },
          { papel: "CC", nome: null, endereco: "cliente@exemplo.com" },
        ],
      }),
    ]);

    const r = await mensagensDoCliente("cli-1");
    expect(r.map((m) => m.id).sort()).toEqual(["no-cc", "no-para"]);
  });

  it("3. NÃO lista mensagem marcada como particular", async () => {
    clienteComEmails("cliente@exemplo.com");
    const enderecos = [{ papel: "PARA", nome: null, endereco: "cliente@exemplo.com" }];
    bancoDeMensagens([
      linha({ id: "publica", enderecos }),
      linha({ id: "particular", particular: true, enderecos }),
    ]);

    const r = await mensagensDoCliente("cli-1");
    expect(r.map((m) => m.id)).toEqual(["publica"]);
  });

  it("4. NÃO lista mensagem em Lixeira nem em Spam (mas lista a de pasta comum)", async () => {
    clienteComEmails("cliente@exemplo.com");
    const enderecos = [{ papel: "PARA", nome: null, endereco: "cliente@exemplo.com" }];
    bancoDeMensagens([
      linha({ id: "entrada", papel: "INBOX", enderecos }),
      linha({ id: "pasta-da-pessoa", papel: null, enderecos }),
      linha({ id: "lixeira", papel: "TRASH", enderecos }),
      linha({ id: "spam", papel: "JUNK", enderecos }),
    ]);

    const r = await mensagensDoCliente("cli-1");
    expect(r.map((m) => m.id).sort()).toEqual(["entrada", "pasta-da-pessoa"]);
  });

  it("5. DEDUPLICA por messageId, ficando com a mais antiga", async () => {
    clienteComEmails("cliente@exemplo.com");
    const enderecos = [{ papel: "PARA", nome: null, endereco: "cliente@exemplo.com" }];
    bancoDeMensagens([
      linha({ id: "copia-recebida", messageId: "<x@exemplo.com>", dataEm: new Date("2026-08-01T12:00:05Z"), enderecos }),
      linha({ id: "copia-enviada", messageId: "<x@exemplo.com>", dataEm: new Date("2026-08-01T12:00:00Z"), papel: "SENT", enderecos }),
      linha({ id: "sem-message-id-a", messageId: null, enderecos }),
      linha({ id: "sem-message-id-b", messageId: null, enderecos }),
    ]);

    const r = await mensagensDoCliente("cli-1");
    expect(r.map((m) => m.id).sort()).toEqual(["copia-enviada", "sem-message-id-a", "sem-message-id-b"]);
  });

  it("6. endereço em MAIÚSCULAS no cadastro casa com o e-mail gravado em minúsculas", async () => {
    clienteComEmails("Cliente@Exemplo.COM");
    bancoDeMensagens([
      linha({ id: "achada", enderecos: [{ papel: "DE", nome: null, endereco: "cliente@exemplo.com" }] }),
    ]);

    const r = await mensagensDoCliente("cli-1");
    expect(r.map((m) => m.id)).toEqual(["achada"]);
    // O que foi ao banco já estava normalizado — o banco guarda sempre minúsculo.
    expect(mocks.mensagemFindMany.mock.calls[0]![0].where.enderecos.some.endereco.in).toEqual([
      "cliente@exemplo.com",
    ]);
  });

  it("7. cliente sem e-mail e sem contato: lista vazia SEM consultar mensagem nenhuma", async () => {
    clienteComEmails(null, [null]);
    const r = await mensagensDoCliente("cli-1");
    expect(r).toEqual([]);
    expect(mocks.mensagemFindMany).not.toHaveBeenCalled();
  });

  it("7b. lista vazia direto quando não há endereço nenhum para procurar", async () => {
    expect(await listarPorEnderecos([])).toEqual([]);
    expect(mocks.mensagemFindMany).not.toHaveBeenCalled();
  });

  it("8. respeita o limite", async () => {
    clienteComEmails("cliente@exemplo.com");
    const enderecos = [{ papel: "PARA", nome: null, endereco: "cliente@exemplo.com" }];
    bancoDeMensagens(
      Array.from({ length: 30 }, (_, i) =>
        linha({ dataEm: new Date(Date.UTC(2026, 7, 1, 12, i)), enderecos }),
      ),
    );

    const r = await mensagensDoCliente("cli-1", 5);
    expect(r).toHaveLength(5);
    // Mais recentes primeiro.
    expect(r[0]!.dataEm.getTime()).toBeGreaterThan(r[4]!.dataEm.getTime());
  });

  it("NUNCA devolve o corpo — só metadado e o trecho", async () => {
    clienteComEmails("cliente@exemplo.com");
    bancoDeMensagens([
      linha({
        enderecos: [{ papel: "DE", nome: null, endereco: "cliente@exemplo.com" }],
        corpoHtml: "<p>segredo</p>",
        corpoTexto: "segredo",
      }),
    ]);

    const r = await mensagensDoCliente("cli-1");
    expect(r[0]!.trecho).toBe("resumo em texto puro");
    expect(JSON.stringify(r)).not.toContain("segredo");
    // E o corpo nem sequer é pedido ao banco.
    const select = mocks.mensagemFindMany.mock.calls[0]![0].select;
    expect(select.corpoHtml).toBeUndefined();
    expect(select.corpoTexto).toBeUndefined();
  });

  it("diz de quem é a caixa (a ficha precisa saber quem é o dono)", async () => {
    clienteComEmails("cliente@exemplo.com");
    bancoDeMensagens([
      linha({ enderecos: [{ papel: "DE", nome: null, endereco: "cliente@exemplo.com" }] }),
    ]);

    const r = await mensagensDoCliente("cli-1");
    expect(r[0]!.caixa).toEqual({ id: CAIXA.id, email: CAIXA.email, donoId: DONA.id, donoNome: DONA.nome });
  });
});

// ── Fatia 2 — a linha do tempo unificada ──────────────────────────────────────────────────

function automatico(id: string, createdAt: string) {
  return {
    id,
    para: "cliente@exemplo.com",
    assunto: "Boas-vindas",
    template: "cliente_boas_vindas",
    templateLabel: "Boas-vindas",
    corpo: "texto do e-mail automático",
    status: "ENVIADO" as const,
    erro: null,
    createdAt: new Date(createdAt),
  };
}

describe("linha do tempo unificada (caixa + log automático)", () => {
  it("ordena por data decrescente MISTURANDO as duas fontes, e marca a origem de cada item", async () => {
    clienteComEmails("cliente@exemplo.com");
    const enderecos = [{ papel: "PARA", nome: null, endereco: "cliente@exemplo.com" }];
    bancoDeMensagens([
      linha({ id: "caixa-mais-nova", dataEm: new Date("2026-08-03T10:00:00Z"), enderecos }),
      linha({ id: "caixa-mais-velha", dataEm: new Date("2026-08-01T10:00:00Z"), enderecos }),
    ]);
    mocks.listPorCliente.mockResolvedValue([
      automatico("auto-meio", "2026-08-02T10:00:00Z"),
      automatico("auto-velho", "2026-07-30T10:00:00Z"),
    ]);

    const r = await conversaDoCliente("cli-1");
    expect(r.itens.map((i) => [i.origem, i.id])).toEqual([
      ["caixa", "caixa-mais-nova"],
      ["automatico", "auto-meio"],
      ["caixa", "caixa-mais-velha"],
      ["automatico", "auto-velho"],
    ]);
    expect(r.caixaIndisponivel).toBe(false);
  });

  it("fonte vazia de um lado não quebra o outro", async () => {
    clienteComEmails("cliente@exemplo.com");
    mocks.listPorCliente.mockResolvedValue([automatico("auto-1", "2026-08-02T10:00:00Z")]);
    const soAutomatico = await conversaDoCliente("cli-1");
    expect(soAutomatico.itens.map((i) => i.origem)).toEqual(["automatico"]);

    mocks.listPorLead.mockResolvedValue([]);
    mocks.leadFindFirst.mockResolvedValue({ email: "lead@exemplo.com" });
    bancoDeMensagens([
      linha({ id: "so-caixa", enderecos: [{ papel: "DE", nome: null, endereco: "lead@exemplo.com" }] }),
    ]);
    const soCaixa = await conversaDoLead("lead-1");
    expect(soCaixa.itens.map((i) => [i.origem, i.id])).toEqual([["caixa", "so-caixa"]]);
  });

  it("falha ao ler a caixa NÃO derruba o card: o log automático continua aparecendo", async () => {
    clienteComEmails("cliente@exemplo.com");
    mocks.mensagemFindMany.mockRejectedValue(new Error("banco fora do ar"));
    mocks.listPorCliente.mockResolvedValue([automatico("auto-1", "2026-08-02T10:00:00Z")]);

    const r = await conversaDoCliente("cli-1");
    expect(r.itens.map((i) => i.id)).toEqual(["auto-1"]);
    expect(r.caixaIndisponivel).toBe(true);
  });
});

// ── Autorização: marcar como particular ───────────────────────────────────────────────────

describe("marcarParticular só é do dono da caixa", () => {
  /** Dublê de `updateMany` que grava DE VERDADE, para dar sentido a "nada é gravado". */
  function bancoGravavel(linhas: Linha[]) {
    mocks.mensagemUpdateMany.mockImplementation(async (args: any) => {
      const dono = args?.where?.pasta?.caixa?.userId;
      const alvo = linhas.filter(
        (l) => l.id === args?.where?.id && (dono === undefined || l.dono.id === dono),
      );
      for (const l of alvo) Object.assign(l, args.data);
      return { count: alvo.length };
    });
    return linhas;
  }

  it("o dono marca e a mensagem sai da ficha", async () => {
    const dados = bancoGravavel([linha({ id: "msg-1" })]);
    const r = await marcarParticular(DONA.id, "msg-1", true);
    expect(r).toEqual({ id: "msg-1", particular: true });
    expect(dados[0]!.particular).toBe(true);
  });

  it("quem NÃO é dono recebe FORBIDDEN e nada é gravado", async () => {
    const dados = bancoGravavel([linha({ id: "msg-1" })]);
    const erro = await marcarParticular("user-intruso", "msg-1", true).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(TRPCError);
    expect((erro as TRPCError).code).toBe("FORBIDDEN");
    expect(dados[0]!.particular).toBe(false);
  });
});
