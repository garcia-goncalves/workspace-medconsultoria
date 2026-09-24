import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { prisma } from "@app/db";
import { MARCADOR_ANONIMIZADO } from "@app/shared";
import { caminhoAbsoluto, removerArquivo } from "../lib/storage.js";
import { expurgarDadosVencidos } from "../modules/sistema/retencao.service.js";
import {
  MARCADOR_PACIENTE_EXPURGADO,
  expurgarDadoDePacienteVencido,
  limiteDoDadoDePaciente,
} from "../modules/conciliacao/retencao-paciente.service.js";
import { anonimizarCliente } from "../modules/clientes/anonimizar.service.js";

/**
 * PRAZO DE GUARDA DO DADO DE PACIENTE DA CONCILIAÇÃO — contra o MySQL de verdade e o disco de
 * verdade. O que só o banco prova: o corte é pela DATA DO ATENDIMENTO (não pela importação), o
 * dinheiro fica, as FKs de recurso e lote continuam de pé, e o arquivo original some do disco.
 */

const PFX = `ret-pac-${randomBytes(4).toString("hex")}`;
const ANO = 365.25 * 24 * 60 * 60 * 1000;
const agora = new Date();
const anosAtras = (n: number) => new Date(agora.getTime() - n * ANO);
/** Dia (sem hora), como as colunas `@db.Date`. */
const dia = (d: Date) => new Date(d.toISOString().slice(0, 10) + "T00:00:00.000Z");

const NOME_VELHO = `${PFX} Maria Antiga da Silva`;
const NOME_NOVO = `${PFX} João Recente Souza`;
const NOME_MEIO = `${PFX} Ana Quatro Anos`;

let clienteId = "";
let usuarioId = "";
let prazoOriginal = 5;

type Fixture = {
  loteId: string;
  consultaVelha: string;
  consultaNova: string;
  consultaMeio: string;
  cirurgiaVelha: string;
  cirurgiaNova: string;
  recursoVelho: string;
  repasseVelho: string;
  arquivoVelho: { id: string; caminho: string };
  arquivoNovo: { id: string; caminho: string };
  arquivoCredenciamento: { id: string; caminho: string };
};
let fx: Fixture;

async function criarArquivoNoDisco(cId: string, criadoEm: Date, extra: Record<string, unknown> = {}) {
  const caminho = `clientes/${cId}/${randomUUID()}.csv`;
  const abs = caminhoAbsoluto(caminho);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, `Paciente;CPF\n${NOME_VELHO};123.456.789-09\n`, "utf8");
  const a = await prisma.arquivo.create({
    data: {
      nome: `${PFX}-relatorio.csv`,
      mimetype: "text/csv",
      tamanho: 40,
      caminho,
      clienteId: cId,
      enviadoPorTipo: "EQUIPE",
      createdAt: criadoEm,
      ...extra,
    },
  });
  return { id: a.id, caminho };
}

async function montarCliente(nome: string): Promise<{ id: string; fx: Fixture }> {
  const c = await prisma.cliente.create({ data: { nome } });
  const id = c.id;

  const arquivoVelho = await criarArquivoNoDisco(id, anosAtras(6));
  const arquivoNovo = await criarArquivoNoDisco(id, anosAtras(0.1));
  // Documento de CREDENCIAMENTO que por engano foi parar num lote: NUNCA pode ser apagado aqui.
  const servico = await prisma.servico.create({ data: { nome: `${nome}-serv` } });
  const arquivoCredenciamento = await criarArquivoNoDisco(id, anosAtras(7), { servicoId: servico.id });

  const lote = await prisma.producaoLote.create({
    data: {
      clienteId: id,
      competencia: "2020-01",
      origem: "CIRURGIAS_TASY",
      arquivoId: arquivoVelho.id,
      nomeArquivo: "mapa.csv",
      formato: "csv",
      hashArquivo: "a".repeat(64),
      status: "IMPORTADO",
    },
  });
  // Lotes que apontam para os outros dois arquivos (é o que os torna "da Conciliação").
  await prisma.producaoLote.create({
    data: {
      clienteId: id,
      competencia: "2026-08",
      origem: "CONSULTAS_NUVENS",
      arquivoId: arquivoNovo.id,
      nomeArquivo: "consultas.csv",
      formato: "csv",
      hashArquivo: "b".repeat(64),
      status: "IMPORTADO",
    },
  });
  await prisma.producaoLote.create({
    data: {
      clienteId: id,
      competencia: "2019-01",
      origem: "REPASSE_TASY",
      arquivoId: arquivoCredenciamento.id,
      nomeArquivo: "rg.csv",
      formato: "csv",
      hashArquivo: "c".repeat(64),
      status: "IMPORTADO",
    },
  });

  const consulta = (nomePac: string, data: Date, linha: number) =>
    prisma.producaoConsulta.create({
      data: {
        loteId: lote.id,
        clienteId: id,
        competencia: data.toISOString().slice(0, 7),
        linha,
        dataAtendimento: dia(data),
        pacienteNome: nomePac,
        pacienteCpfCifrado: "cifrado-cpf",
        pacienteCpfApelido: "f".repeat(64),
        pacienteTelefoneCifrado: "cifrado-tel",
        pacienteEmailCifrado: "cifrado-email",
        tipoAtendimento: "CONSULTA",
        tipoAtendimentoBruto: "Consulta",
        convenioBruto: "UNIMED",
        profissionalBruto: "DR. FULANO",
      },
    });
  const consultaVelha = await consulta(NOME_VELHO, anosAtras(6), 1);
  const consultaNova = await consulta(NOME_NOVO, anosAtras(0.5), 2);
  const consultaMeio = await consulta(NOME_MEIO, anosAtras(4), 3);

  const cirurgia = (nomePac: string, data: Date, n: string) =>
    prisma.producaoCirurgia.create({
      data: {
        loteId: lote.id,
        clienteId: id,
        competencia: data.toISOString().slice(0, 7),
        linha: 1,
        numeroCirurgia: `${PFX}-${n}`.slice(0, 20),
        atendimento: `AT${n}`,
        dataCirurgia: dia(data),
        pacienteNome: nomePac,
        procedimento: "Revascularização",
        status: "EXECUTADA",
        statusBruto: "Executada",
        autorizacao: "AUTORIZADO",
        autorizacaoBruto: "Autorizado",
        categoriaConvenio: "CONVENIO",
        convenioBruto: "UNIMED",
        profissionalBruto: "DR. FULANO",
        valorCobrado: "1500.00",
        valorRecebido: "1200.00",
        observacao: `Ligar para ${nomePac}, CPF 123.456.789-09`,
      },
    });
  const cirurgiaVelha = await cirurgia(NOME_VELHO, anosAtras(6), "1");
  const cirurgiaNova = await cirurgia(NOME_NOVO, anosAtras(0.5), "2");

  const recurso = await prisma.recursoDeGlosa.create({
    data: {
      clienteId: id,
      cirurgiaId: cirurgiaVelha.id,
      abertoEm: dia(anosAtras(5.9)),
      motivoDaGlosa: "Procedimento não autorizado",
      observacao: `Paciente ${NOME_VELHO} reclamou`,
    },
  });
  const repasse = await prisma.repasseLinha.create({
    data: { loteId: lote.id, clienteId: id, linha: 1, atendimento: "AT1", valor: "1200.00", dataPagamento: dia(anosAtras(5.8)) },
  });

  return {
    id,
    fx: {
      loteId: lote.id,
      consultaVelha: consultaVelha.id,
      consultaNova: consultaNova.id,
      consultaMeio: consultaMeio.id,
      cirurgiaVelha: cirurgiaVelha.id,
      cirurgiaNova: cirurgiaNova.id,
      recursoVelho: recurso.id,
      repasseVelho: repasse.id,
      arquivoVelho,
      arquivoNovo,
      arquivoCredenciamento,
    },
  };
}

beforeAll(async () => {
  expect(process.env.DATABASE_URL).toContain("_test");
  const identidade = await prisma.identidadeInstitucional.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      nome: "MedConsultoria",
      tagline: "",
      site: "",
      siteUrl: "",
      email: "contato@teste.local",
      telefone: "",
      cidade: "",
      instagram: "",
      instagramUrl: "",
    },
  });
  prazoOriginal = identidade.retencaoPacienteAnos;
  await prisma.identidadeInstitucional.update({ where: { id: "default" }, data: { retencaoPacienteAnos: 5 } });

  const montado = await montarCliente(`${PFX}-clinica`);
  clienteId = montado.id;
  fx = montado.fx;
  usuarioId = (await prisma.user.create({ data: { nome: `${PFX}-root`, email: `${PFX}-root@teste.local`, role: "ROOT" } })).id;
});

afterAll(async () => {
  await prisma.identidadeInstitucional.update({ where: { id: "default" }, data: { retencaoPacienteAnos: prazoOriginal } });
  const clientes = await prisma.cliente.findMany({ where: { nome: { startsWith: PFX } }, select: { id: true } });
  const ids = clientes.map((c) => c.id);
  // Os arquivos que o teste deixou no disco (os que o expurgo não apagou, de propósito).
  const restantes = await prisma.arquivo.findMany({ where: { clienteId: { in: ids } }, select: { caminho: true } });
  await Promise.all(restantes.map((a) => removerArquivo(a.caminho)));
  await prisma.recursoDeGlosa.deleteMany({ where: { clienteId: { in: ids } } });
  await prisma.cliente.deleteMany({ where: { id: { in: ids } } });
  await prisma.servico.deleteMany({ where: { nome: { startsWith: PFX } } });
  await prisma.activityLog.deleteMany({ where: { userId: usuarioId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PFX } } });
});

describe("limiteDoDadoDePaciente — anos de calendário", () => {
  it("5 anos antes de 24/09/2026 é 24/09/2021", () => {
    expect(limiteDoDadoDePaciente(5, new Date("2026-09-24T15:00:00Z")).toISOString()).toBe("2021-09-24T00:00:00.000Z");
  });
});

describe("expurgo diário do dado de paciente (5 anos, pela data do atendimento)", () => {
  it("anonimiza o atendimento de 6 anos atrás e NÃO toca o de 4 anos nem o recente", async () => {
    const r = await expurgarDadosVencidos();
    expect(r.pacientes.anos).toBe(5);

    const velha = await prisma.producaoConsulta.findUniqueOrThrow({ where: { id: fx.consultaVelha } });
    expect(velha.pacienteNome).toBe(MARCADOR_PACIENTE_EXPURGADO);
    expect(velha.pacienteCpfCifrado).toBeNull();
    expect(velha.pacienteCpfApelido).toBeNull();
    expect(velha.pacienteTelefoneCifrado).toBeNull();
    expect(velha.pacienteEmailCifrado).toBeNull();
    // O que não identifica ninguém fica: é o histórico da clínica.
    expect(velha.convenioBruto).toBe("UNIMED");
    expect(velha.profissionalBruto).toBe("DR. FULANO");

    const meio = await prisma.producaoConsulta.findUniqueOrThrow({ where: { id: fx.consultaMeio } });
    expect(meio.pacienteNome).toBe(NOME_MEIO);
    expect(meio.pacienteCpfCifrado).toBe("cifrado-cpf");
    const nova = await prisma.producaoConsulta.findUniqueOrThrow({ where: { id: fx.consultaNova } });
    expect(nova.pacienteNome).toBe(NOME_NOVO);
  });

  it("na cirurgia antiga: nome e observação saem, o DINHEIRO e a chave do repasse ficam", async () => {
    const c = await prisma.producaoCirurgia.findUniqueOrThrow({ where: { id: fx.cirurgiaVelha } });
    expect(c.pacienteNome).toBe(MARCADOR_PACIENTE_EXPURGADO);
    expect(c.observacao).toBeNull();
    expect(c.valorCobrado?.toString()).toBe("1500");
    expect(c.valorRecebido?.toString()).toBe("1200");
    expect(c.atendimento).toBe("AT1");

    const recurso = await prisma.recursoDeGlosa.findUniqueOrThrow({ where: { id: fx.recursoVelho } });
    expect(recurso.observacao).toBeNull();
    expect(recurso.motivoDaGlosa).toBe("Procedimento não autorizado");
    expect(recurso.cirurgiaId).toBe(fx.cirurgiaVelha);

    const repasse = await prisma.repasseLinha.findUniqueOrThrow({ where: { id: fx.repasseVelho } });
    expect(repasse.valor.toString()).toBe("1200");

    const recente = await prisma.producaoCirurgia.findUniqueOrThrow({ where: { id: fx.cirurgiaNova } });
    expect(recente.pacienteNome).toBe(NOME_NOVO);
    expect(recente.observacao).toContain(NOME_NOVO);
  });

  it("apaga do DISCO e do banco a planilha enviada há mais de 5 anos; a recente e a de credenciamento ficam", async () => {
    expect(existsSync(caminhoAbsoluto(fx.arquivoVelho.caminho))).toBe(false);
    expect(await prisma.arquivo.findUnique({ where: { id: fx.arquivoVelho.id } })).toBeNull();
    // O lote fica, sem o arquivo — o histórico da importação não some.
    const lote = await prisma.producaoLote.findUniqueOrThrow({ where: { id: fx.loteId } });
    expect(lote.arquivoId).toBeNull();
    expect(lote.nomeArquivo).toBe("mapa.csv");

    expect(existsSync(caminhoAbsoluto(fx.arquivoNovo.caminho))).toBe(true);
    expect(existsSync(caminhoAbsoluto(fx.arquivoCredenciamento.caminho))).toBe(true);
    expect(await prisma.arquivo.findUnique({ where: { id: fx.arquivoCredenciamento.id } })).not.toBeNull();
  });

  it("fica registrado no ActivityLog com CONTAGEM e sem nome, numa ação que o expurgo preserva", async () => {
    const log = await prisma.activityLog.findFirst({
      where: { acao: "conciliacao.paciente_expurgado" },
      orderBy: { createdAt: "desc" },
    });
    expect(log).not.toBeNull();
    const texto = JSON.stringify(log?.dados);
    expect(texto).not.toContain(PFX);
    expect(texto).not.toContain("123.456.789-09");
    expect((log?.dados as { consultas: number }).consultas).toBeGreaterThanOrEqual(1);

    // E o próprio expurgo do ActivityLog não apaga essa linha, mesmo velha.
    await prisma.activityLog.update({ where: { id: log!.id }, data: { createdAt: anosAtras(3) } });
    await expurgarDadosVencidos();
    expect(await prisma.activityLog.findUnique({ where: { id: log!.id } })).not.toBeNull();
  });

  it("rodar de novo não reescreve o que já foi limpo", async () => {
    const r = await expurgarDadoDePacienteVencido();
    const nossos = await prisma.producaoConsulta.count({
      where: { clienteId, pacienteNome: MARCADOR_PACIENTE_EXPURGADO },
    });
    expect(nossos).toBe(1);
    // Nada novo deste cliente passou do prazo entre as duas passadas.
    expect(r.consultas).toBe(0);
  });

  it("o prazo editado em Ajustes muda o corte: com 3 anos, o atendimento de 4 anos atrás cai", async () => {
    await prisma.identidadeInstitucional.update({ where: { id: "default" }, data: { retencaoPacienteAnos: 3 } });
    try {
      const r = await expurgarDadoDePacienteVencido();
      expect(r.anos).toBe(3);
      const meio = await prisma.producaoConsulta.findUniqueOrThrow({ where: { id: fx.consultaMeio } });
      expect(meio.pacienteNome).toBe(MARCADOR_PACIENTE_EXPURGADO);
      expect(meio.pacienteCpfCifrado).toBeNull();
      const nova = await prisma.producaoConsulta.findUniqueOrThrow({ where: { id: fx.consultaNova } });
      expect(nova.pacienteNome).toBe(NOME_NOVO);
    } finally {
      await prisma.identidadeInstitucional.update({ where: { id: "default" }, data: { retencaoPacienteAnos: 5 } });
    }
  });

  it("a página pública de privacidade recebe o prazo pelo mesmo caminho dos outros", async () => {
    const { getPrivacidadePublica } = await import("../modules/identidade/identidade.service.js");
    const p = await getPrivacidadePublica();
    expect(p.retencaoPacienteAnos).toBe(5);
  });
});

describe("anonimizar cliente (a pedido do titular) limpa também a Conciliação dele", () => {
  it("todo paciente daquele cliente sai — sem corte de data — e as planilhas somem do disco", async () => {
    const outro = await montarCliente(`${PFX}-titular`);
    await prisma.cliente.update({ where: { id: outro.id }, data: { deletedAt: new Date() } });

    await anonimizarCliente(outro.id, usuarioId);

    const consultas = await prisma.producaoConsulta.findMany({ where: { clienteId: outro.id } });
    const cirurgias = await prisma.producaoCirurgia.findMany({ where: { clienteId: outro.id } });
    const recursos = await prisma.recursoDeGlosa.findMany({ where: { clienteId: outro.id } });
    expect(consultas).toHaveLength(3);
    expect(cirurgias).toHaveLength(2);
    for (const c of consultas) {
      expect(c.pacienteNome).toBe(MARCADOR_ANONIMIZADO);
      expect(c.pacienteCpfCifrado).toBeNull();
      expect(c.pacienteTelefoneCifrado).toBeNull();
      expect(c.pacienteEmailCifrado).toBeNull();
      expect(c.pacienteCpfApelido).toBeNull();
    }
    for (const c of cirurgias) {
      expect(c.pacienteNome).toBe(MARCADOR_ANONIMIZADO);
      expect(c.valorCobrado?.toString()).toBe("1500");
    }

    // Varredura: nenhum nome, CPF ou texto livre de paciente sobra no que é do cliente.
    const tudo = JSON.stringify({ consultas, cirurgias, recursos });
    expect(tudo).not.toContain(NOME_VELHO);
    expect(tudo).not.toContain(NOME_NOVO);
    expect(tudo).not.toContain(NOME_MEIO);
    expect(tudo).not.toContain("123.456.789-09");
    expect(tudo).not.toContain("cifrado-");

    // As planilhas da Conciliação somem (inclusive a recente); a de credenciamento, não.
    expect(existsSync(caminhoAbsoluto(outro.fx.arquivoVelho.caminho))).toBe(false);
    expect(existsSync(caminhoAbsoluto(outro.fx.arquivoNovo.caminho))).toBe(false);
    expect(existsSync(caminhoAbsoluto(outro.fx.arquivoCredenciamento.caminho))).toBe(true);

    const log = await prisma.activityLog.findFirst({ where: { acao: "cliente.anonimizado", entidadeId: outro.id } });
    const dados = log?.dados as { conciliacao: { consultas: number; cirurgias: number; arquivos: number } };
    expect(dados.conciliacao).toMatchObject({ consultas: 3, cirurgias: 2, arquivos: 2 });
  });

  it("não mexe na Conciliação de OUTRO cliente", async () => {
    const nova = await prisma.producaoConsulta.findUniqueOrThrow({ where: { id: fx.consultaNova } });
    expect(nova.pacienteNome).toBe(NOME_NOVO);
    expect(existsSync(caminhoAbsoluto(fx.arquivoNovo.caminho))).toBe(true);
  });
});
