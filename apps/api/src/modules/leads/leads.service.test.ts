import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";
import { exigirBancoDeTeste } from "../../test/guarda-banco-de-teste.js";
import { derivarRastreioOrigem, solicitarServicosPeloCliente } from "./leads.service.js";
import { listStages } from "../pipeline/pipeline.service.js";

/**
 * derivarRastreioOrigem — função pura. B3: `utmTerm`, `utmContent` e `landing` eram
 * aceitos pelo schema e jogados fora; agora entram no texto de `rastreio`, no mesmo
 * padrão em português das outras linhas.
 */
describe("derivarRastreioOrigem", () => {
  it("identifica a origem pelo utm_source conhecido", () => {
    const r = derivarRastreioOrigem({ utmSource: "google", utmMedium: "cpc" });
    expect(r.origem).toBe("Google");
  });

  it("sem nenhum sinal, cai em Página de Captura com acesso direto", () => {
    const r = derivarRastreioOrigem({});
    expect(r.origem).toBe("Página de Captura");
    expect(r.rastreio).toContain("Acesso direto");
  });

  it("grava termo de busca, conteúdo do anúncio e página de entrada quando vierem preenchidos", () => {
    const r = derivarRastreioOrigem({
      utmSource: "google",
      utmTerm: "consultoria credenciamento",
      utmContent: "anuncio-azul",
      landing: "https://medconsultoria.com.br/comecar?utm_source=google",
    });
    expect(r.rastreio).toContain("Termo de busca (utm_term): consultoria credenciamento");
    expect(r.rastreio).toContain("Conteúdo do anúncio (utm_content): anuncio-azul");
    expect(r.rastreio).toContain("Página de entrada: https://medconsultoria.com.br/comecar?utm_source=google");
  });

  it("omite as três linhas quando os campos não vêm preenchidos", () => {
    const r = derivarRastreioOrigem({ utmSource: "google" });
    expect(r.rastreio).not.toContain("Termo de busca");
    expect(r.rastreio).not.toContain("Conteúdo do anúncio");
    expect(r.rastreio).not.toContain("Página de entrada");
  });
});

/**
 * M10 — "Solicitar serviço" pelo Portal depois de desistir precisa REABRIR o negócio
 * perdido, não criar um segundo card no funil.
 */
describe("solicitarServicosPeloCliente — reabre negócio perdido", () => {
  const PFX = `m10-${randomBytes(4).toString("hex")}`;
  let clienteId: string;
  let servicoId: string;
  let etapaId: string;
  let leadPerdidoId: string;

  beforeAll(async () => {
    exigirBancoDeTeste();
    servicoId = (
      await prisma.servico.create({ data: { nome: `${PFX}-servico`, categoria: "Gestão", ordem: 995, valor: 1000 } })
    ).id;
    clienteId = (await prisma.cliente.create({ data: { nome: `${PFX}-clinica`, situacaoComercial: "PROSPECT" } })).id;

    const stages = await listStages();
    etapaId = stages[0]!.id;

    leadPerdidoId = (
      await prisma.lead.create({
        data: {
          nome: `${PFX}-contato`,
          empresa: `${PFX}-clinica`,
          clienteId,
          pipelineStageId: etapaId,
          ordem: 0,
          perdidoEm: new Date(),
          motivoPerda: "Desistência pelo Portal",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.leadPasso.deleteMany({ where: { leadId: leadPerdidoId } });
    await prisma.activityLog.deleteMany({ where: { entidadeId: leadPerdidoId } });
    await prisma.lead.deleteMany({ where: { clienteId } });
    await prisma.clienteServico.deleteMany({ where: { clienteId } });
    await prisma.cliente.deleteMany({ where: { id: clienteId } });
    await prisma.servico.deleteMany({ where: { id: servicoId } });
  });

  it("reabre o lead perdido em vez de criar um segundo, e limpa perdidoEm", async () => {
    await solicitarServicosPeloCliente(clienteId, [servicoId], "Quero contratar de novo");

    const leads = await prisma.lead.findMany({ where: { clienteId, deletedAt: null } });
    expect(leads).toHaveLength(1);
    expect(leads[0]!.id).toBe(leadPerdidoId);
    expect(leads[0]!.perdidoEm).toBeNull();
    expect(leads[0]!.motivoPerda).toBeNull();
  });
});
