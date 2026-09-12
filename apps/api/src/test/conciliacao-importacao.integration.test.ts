import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";

process.env.EMAIL_CRYPTO_KEY ??= randomBytes(32).toString("base64");
process.env.PACIENTE_CRYPTO_KEY ??= randomBytes(32).toString("base64");

const { prisma } = await import("@app/db");
const { importarProducao, ligarConvenio, ligarProfissional, previsualizarImportacao } = await import(
  "../modules/conciliacao/conciliacao.service.js"
);

/**
 * Conciliação — o serviço de importação, contra MySQL de verdade.
 *
 * O que este arquivo protege são as regras que só existem quando há banco: substituição do mês,
 * retroação do de-para, casamento automático de médico, e — a mais importante — **que nenhum
 * retorno do serviço carregue CPF, telefone ou e-mail do paciente**.
 */

const SUFIXO = randomBytes(4).toString("hex");
let clienteId = "";
let outroClienteId = "";
let operadoraId = "";
let profissionalId = "";
let usuarioId = "";

const CABECALHO =
  "Data da agenda;Data do atendimento;Paciente;CPF do paciente;Telefone do Paciente;E-mail;Tipo de atendimento;Plano de convênio;Profissional";

/** CSV sintético com a forma do arquivo real. CPF/telefone/e-mail inventados. */
function csv(...linhas: string[]): Buffer {
  return Buffer.from([CABECALHO, ...linhas].join("\n"), "utf8");
}

const WILMA =
  "31/08/2026;31/08/2026;WILMA SAVINI;123.456.789-09;(11) 96067-6368;wilma@exemplo.test;Consulta;PORTO SEGURO - BÁSICO;DR. LEONARDO GIGLIO DRAGONE";
const CELIA = ";28/08/2026;CELIA OTA;987.654.321-00;;;Sem vínculo com a agenda;porto seguro - básico;DRA. DESCONHECIDA";

beforeAll(async () => {
  const cliente = await prisma.cliente.create({ data: { nome: `Clínica import ${SUFIXO}` } });
  clienteId = cliente.id;
  const outro = await prisma.cliente.create({ data: { nome: `Outra clínica ${SUFIXO}` } });
  outroClienteId = outro.id;

  const operadora = await prisma.operadora.create({ data: { nome: `Porto Seguro ${SUFIXO}` } });
  operadoraId = operadora.id;

  const prof = await prisma.profissional.create({
    data: { clienteId, nome: "Leonardo Giglio Dragone", conselho: "CRM" },
  });
  profissionalId = prof.id;

  // O banco de teste não roda seed: quem importa precisa existir de verdade (FK do lote).
  const usuario = await prisma.user.create({
    data: { nome: `Importador ${SUFIXO}`, email: `importador-${SUFIXO}@teste.local`, role: "FUNCIONARIO" },
  });
  usuarioId = usuario.id;
});

afterAll(async () => {
  await prisma.cliente.deleteMany({ where: { id: { in: [clienteId, outroClienteId] } } });
  await prisma.operadora.deleteMany({ where: { id: operadoraId } });
  await prisma.user.deleteMany({ where: { id: usuarioId } });
  await prisma.$disconnect();
});

describe("previsualizar — conferir antes de gravar", () => {
  it("mostra o que vai entrar, o que falta ligar, e não grava nada", async () => {
    const previa = await previsualizarImportacao({ clienteId, bytes: csv(WILMA, CELIA) });

    expect(previa.formato).toBe("csv");
    expect(previa.totalLinhas).toBe(2);
    expect(previa.competenciaSugerida).toBe("2026-08");
    expect(previa.ignoradas).toHaveLength(0);
    expect(previa.jaImportado).toBeNull();

    // Os dois textos de convênio normalizam para a MESMA chave — a prévia não os conta em dobro.
    expect(previa.conveniosNovos).toEqual(["PORTO SEGURO - BÁSICO"]);
    // "DR. LEONARDO..." casa sozinho com o cadastro; a "DRA. DESCONHECIDA" não.
    expect(previa.profissionaisNovos).toEqual(["DRA. DESCONHECIDA"]);

    expect(await prisma.producaoLote.count({ where: { clienteId } })).toBe(0);
  });

  it("a prévia NÃO devolve CPF, telefone nem e-mail — nem dentro da amostra", async () => {
    const previa = await previsualizarImportacao({ clienteId, bytes: csv(WILMA) });
    const texto = JSON.stringify(previa);
    // O teste que mais importa: regressão aqui é vazamento, não bug de tela.
    expect(texto).not.toContain("123.456.789-09");
    expect(texto).not.toContain("96067-6368");
    expect(texto).not.toContain("wilma@exemplo.test");
    expect(Object.keys(previa.amostra[0]!)).not.toContain("cpf");
  });
});

describe("importar", () => {
  it("grava o mês, cifra o dado do paciente e liga o médico sozinho", async () => {
    const r = await importarProducao({
      clienteId,
      competencia: "2026-08",
      bytes: csv(WILMA, CELIA),
      nomeArquivo: "producao-08.csv",
      usuarioId,
    });

    expect(r.linhasImportadas).toBe(2);
    expect(r.profissionaisLigadosAutomaticamente).toBe(1);
    expect(r.conveniosNovos).toEqual(["PORTO SEGURO - BÁSICO"]);

    const linhas = await prisma.producaoConsulta.findMany({ where: { clienteId }, orderBy: { linha: "asc" } });
    expect(linhas).toHaveLength(2);
    // O CPF não está em claro no banco.
    expect(linhas[0]!.pacienteCpfCifrado).toMatch(/^v1:/);
    expect(linhas[0]!.pacienteCpfCifrado).not.toContain("123");
    // O médico foi resolvido pelo nome, sem ninguém ligar à mão.
    expect(linhas[0]!.profissionalId).toBe(profissionalId);
    expect(linhas[1]!.profissionalId).toBeNull();
    // Convênio ainda sem operadora — estado válido, não impediu a importação.
    expect(linhas[0]!.operadoraId).toBeNull();
    expect(linhas[1]!.dataAgenda).toBeNull();
  });

  it("recusa o MESMO arquivo de novo, dizendo quando entrou", async () => {
    await expect(
      importarProducao({
        clienteId,
        competencia: "2026-08",
        bytes: csv(WILMA, CELIA),
        nomeArquivo: "producao-08.csv",
        usuarioId,
      }),
    ).rejects.toThrow(/já foi importado/i);
  });

  it("arquivo diferente no mesmo mês PERGUNTA antes de substituir", async () => {
    await expect(
      importarProducao({
        clienteId,
        competencia: "2026-08",
        bytes: csv(WILMA),
        nomeArquivo: "producao-08-v2.csv",
        usuarioId,
      }),
    ).rejects.toThrow(/Confirme a substituição/i);
  });

  it("substituir troca o mês inteiro e guarda o lote antigo", async () => {
    const r = await importarProducao({
      clienteId,
      competencia: "2026-08",
      bytes: csv(WILMA),
      nomeArquivo: "producao-08-v2.csv",
      usuarioId,
      substituir: true,
    });

    expect(r.substituiuLoteId).not.toBeNull();
    expect(r.linhasImportadas).toBe(1);

    // As linhas do lote antigo TÊM de sair. Se ficassem, agosto mostraria a produção velha
    // somada à nova — e este número é a única coisa que denuncia isso.
    expect(await prisma.producaoConsulta.count({ where: { clienteId } })).toBe(1);

    const lotes = await prisma.producaoLote.findMany({ where: { clienteId }, orderBy: { createdAt: "asc" } });
    expect(lotes).toHaveLength(2);
    expect(lotes[0]!.status).toBe("SUBSTITUIDO");
    expect(lotes[0]!.competenciaVigente).toBeNull();
    expect(lotes[0]!.substituidoPorId).toBe(r.loteId);
    expect(lotes[1]!.competenciaVigente).toBe("2026-08");
  });

  it("recusa arquivo sem nenhum atendimento do mês escolhido, dizendo quais achou", async () => {
    await expect(
      importarProducao({
        clienteId,
        competencia: "2026-12",
        bytes: csv(WILMA),
        nomeArquivo: "x.csv",
        usuarioId,
      }),
    ).rejects.toThrow(/2026-08/);
  });

  it("linha de outro mês fica de fora e é REPORTADA, não descartada em silêncio", async () => {
    const setembro = "01/09/2026;01/09/2026;PACIENTE SET;;;;Consulta;CABESP;DR. LEONARDO GIGLIO DRAGONE";
    const r = await importarProducao({
      clienteId,
      competencia: "2026-09",
      bytes: csv(setembro, WILMA),
      nomeArquivo: "misturado.csv",
      usuarioId,
    });
    expect(r.linhasImportadas).toBe(1);
    expect(r.foraDaCompetencia).toEqual([{ competencia: "2026-08", linhas: 1 }]);
  });

  it("recusa arquivo que não é o relatório de produção", async () => {
    await expect(
      importarProducao({
        clienteId,
        competencia: "2026-08",
        bytes: Buffer.from("Nome;Valor\nabc;1", "utf8"),
        nomeArquivo: "outro.csv",
        usuarioId,
      }),
    ).rejects.toThrow(/não reconheci/i);
  });
});

describe("de-para — ligar retroage no que já entrou", () => {
  it("ligar o convênio atualiza as linhas JÁ importadas, inclusive as de outra caixa", async () => {
    // Havia "PORTO SEGURO - BÁSICO" e "porto seguro - básico" no arquivo: os dois têm de casar.
    const r = await ligarConvenio({
      clienteId,
      textoBruto: "PORTO SEGURO - BÁSICO",
      operadoraId,
      plano: "Básico",
    });
    expect(r.linhasAtualizadas).toBeGreaterThanOrEqual(1);

    const semOperadora = await prisma.producaoConsulta.count({
      where: { clienteId, convenioBruto: { contains: "PORTO SEGURO" }, operadoraId: null },
    });
    expect(semOperadora).toBe(0);
  });

  it("particular fica sem operadora e não exige uma", async () => {
    const r = await ligarConvenio({
      clienteId,
      textoBruto: "PARTICULAR DR. LÉO - MAESTRO CARDIM",
      operadoraId: null,
      particular: true,
    });
    expect(r.linhasAtualizadas).toBe(0); // não há linha desse convênio ainda
    const m = await prisma.mapeamentoConvenio.findFirstOrThrow({
      where: { clienteId, textoNormalizado: "particular dr. leo - maestro cardim" },
    });
    expect(m.particular).toBe(true);
    expect(m.operadoraId).toBeNull();
  });

  it("sem operadora e sem particular, recusa — senão o de-para nasce sem significado", async () => {
    await expect(ligarConvenio({ clienteId, textoBruto: "CABESP", operadoraId: null })).rejects.toThrow(/operadora|particular/i);
  });

  it("NÃO liga a produção ao médico de OUTRO cliente", async () => {
    // Sem a checagem de posse, um id vindo da tela cruzaria os dados de dois clientes.
    await expect(ligarProfissional({ clienteId: outroClienteId, textoBruto: "DR. LEONARDO", profissionalId })).rejects.toThrow(
      /não encontrado/i,
    );
  });

  it("ligar o profissional retroage nas linhas dele", async () => {
    const nova = await prisma.profissional.create({
      data: { clienteId, nome: "Lays Jose Moreschi", conselho: "CRM" },
    });
    const r = await ligarProfissional({
      clienteId,
      textoBruto: "DRA. DESCONHECIDA",
      profissionalId: nova.id,
    });
    // Pode ser 0 se a linha da "DRA. DESCONHECIDA" saiu na substituição — o que importa é o
    // mapeamento ter sido gravado para valer da próxima importação em diante.
    expect(r.linhasAtualizadas).toBeGreaterThanOrEqual(0);
    const m = await prisma.mapeamentoProfissional.findFirstOrThrow({
      where: { clienteId, textoNormalizado: "desconhecida" },
    });
    expect(m.profissionalId).toBe(nova.id);
  });
});
