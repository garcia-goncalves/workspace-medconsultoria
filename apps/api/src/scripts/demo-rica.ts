/**
 * DEMO RICA — semeador de demonstração que produz uma carteira de clientes coerente e
 * verossímil, construída PELOS MESMOS CAMINHOS que a aplicação usa (os serviços reais de
 * `apps/api`), nunca por INSERT solto. É por isso que ele nasce dentro de `apps/api` e não em
 * `packages/db`: só daqui dá para importar `leads.service`, `servicos-cliente.service` e
 * `projetos.service` — o mesmo motor que a tela usa.
 *
 * Rodar:  pnpm db:demo:rica
 *
 * Travas:
 *  - `podeRodarDemoSeed` (a MESMA do `demo-seed` e do `contas-de-teste`) recusa banco remoto
 *    ou `NODE_ENV=production`.
 *  - Idempotente: cada entidade é procurada por um identificador estável (nome/e-mail/título)
 *    antes de ser criada — rodar duas vezes não duplica nada.
 *  - ZERO e-mail sai daqui — ver `bloquearDisparoDeEmail()` logo no início de `main()`.
 *  - Senha das contas novas = `SEED_ROOT_PASSWORD` do `.env` (ADR-98), nunca um literal.
 *  - CNPJ falso, mas VÁLIDO no dígito verificador — conferido com `validarCNPJ` antes de gravar.
 */
import "../env.js"; // mesmo carregador do server.ts — .env já está em process.env quando main() roda
import { Readable } from "node:stream";
import { hash } from "@node-rs/argon2";
import { prisma } from "@app/db";
import { podeRodarDemoSeed } from "@app/db/seed-guard";
import { validarCNPJ, formatarCNPJ } from "@app/shared";

// ── util: datas ──────────────────────────────────────────
function diasAtras(n: number, hora = 10, minuto = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hora, minuto, 0, 0);
  return d;
}
function diasNaFrente(n: number, hora = 10, minuto = 0): Date {
  return diasAtras(-n, hora, minuto);
}

// ── util: e-mail e telefone de teste ─────────────────────
function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/(^\.+|\.+$)/g, "");
}
/** Domínio da própria empresa + prefixo `teste.` — nunca um domínio de terceiro (ordem do dono). */
function emailTeste(texto: string): string {
  return `teste.${slug(texto)}@medconsultoria.com.br`;
}
const DDDS_FICTICIOS = ["94123", "95234", "96345", "97456", "98567", "99678", "94789", "95890"];
function telefoneFicticio(seq: number): string {
  const prefixo = DDDS_FICTICIOS[seq % DDDS_FICTICIOS.length]!;
  const final = String(1000 + ((seq * 37) % 9000)).padStart(4, "0");
  return `(11) ${prefixo}-${final}`;
}

// ── util: CNPJ falso, dígito verificador VÁLIDO ──────────
// Mesmo algoritmo de `packages/shared/src/cnpj.ts` (módulo 11, peso 2..9 da direita) —
// reimplementado aqui só para GERAR; a checagem final é sempre feita com o `validarCNPJ`
// real, importado de `@app/shared`, nunca por uma segunda régua.
function valorCaractere(c: string): number {
  return c.charCodeAt(0) - 48;
}
function digitoModulo11(valores: number[]): number {
  let peso = 2;
  let soma = 0;
  for (let i = valores.length - 1; i >= 0; i--) {
    soma += valores[i]! * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}
function gerarCNPJ(sequencial: number): string {
  const base8 = String(10_000_000 + sequencial).slice(-8);
  const base = `${base8}0001`;
  const valores = base.split("").map(valorCaractere);
  const dv1 = digitoModulo11(valores);
  const dv2 = digitoModulo11([...valores, dv1]);
  const completo = `${base}${dv1}${dv2}`;
  if (!validarCNPJ(completo)) {
    throw new Error(`CNPJ gerado é INVÁLIDO (sequencial ${sequencial}): ${completo} — não deveria acontecer.`);
  }
  return formatarCNPJ(completo);
}

function senhaDeSeed(): string {
  const senha = process.env.SEED_ROOT_PASSWORD;
  if (!senha) throw new Error("Defina SEED_ROOT_PASSWORD no .env antes de rodar a demo rica.");
  return senha;
}

// ── etapas do funil ───────────────────────────────────────
const ORDEM_ETAPAS = ["novo", "qualificacao", "proposta", "negociacao", "fechado"] as const;
type EtapaChave = (typeof ORDEM_ETAPAS)[number];

async function main() {
  const guard = podeRodarDemoSeed(process.env);
  if (!guard.permitido) throw new Error(`demo-rica BLOQUEADA: ${guard.motivo}`);
  console.log(`• demo-rica liberada: ${guard.motivo}\n`);

  // ── BLOQUEIO DE E-MAIL — ANTES de importar qualquer módulo que leia a configuração ──
  //
  // `apps/api/src/config.ts` calcula `isEmailReal` (e `isAiEnabled`) UMA VEZ, no momento em
  // que o módulo é carregado (`export const isEmailReal = !!(SMTP_HOST && SMTP_USER && ...)`).
  // Zerando as três variáveis AQUI — antes do primeiro `import()` de um módulo de
  // `apps/api/src/modules` ou `apps/api/src/lib` — qualquer `notificar()`/`enviarEmailTemplate()`
  // disparado pelos serviços REAIS que este script usa (ex.: "lead_convertido" dentro de
  // `convertLead`, "documento_revisao" quando `docsAoEntrarEtapa` gera a proposta/contrato
  // automático ao mover um lead para "Proposta"/"Negociação") cai no ramo de MODO DEV de
  // `enviarEmail()` — só loga (`[email:dev] ... não enviado — modo dev`) e NUNCA abre uma
  // conexão de rede. Isso é o `process.env` DESTE processo, não o arquivo `.env` do
  // repositório: nada é escrito em disco, e a alteração morre quando o script termina.
  //
  // Esses dois `notificar()` são chamadas INEVITÁVEIS dentro das funções reais pedidas
  // (`convertLead` chama "lead_convertido" incondicionalmente para ADMIN/ROOT; entrar em
  // "Proposta"/"Negociação" gera documento e avisa "documento_revisao" ao responsável) — não
  // há como usar essas funções e evitar a CHAMADA a `notificar()`. O que esta trava evita é
  // a ENTREGA: nenhuma delas chega a tentar abrir uma conexão SMTP.
  process.env.SMTP_HOST = "";
  process.env.SMTP_USER = "";
  process.env.SMTP_PASS = "";
  // Defensivo: nenhum caminho usado aqui deveria chamar a OpenAI (as duas gerações de
  // documento automáticas passam `usarIA: false` explicitamente), mas zerar a chave também
  // garante que nenhuma chamada real aconteça mesmo que um caminho futuro esqueça a flag.
  process.env.OPENAI_API_KEY = "";

  const { createLead, moveLead, reconciliarPassosAuto, togglePasso, convertLead, marcarPerdido, criarOportunidadeParaCliente, getLeadDetalhe, updateLead } =
    await import("../modules/leads/leads.service.js");
  const { ativarServicoCliente, atualizarContratacaoCliente } = await import("../modules/servicos/servicos-cliente.service.js");
  const { garantirCatalogoDeServicos, seedRequisitosSeVazio } = await import("../modules/servicos/servicos.service.js");
  const { listOperadoras } = await import("../modules/documentos/operadoras.service.js");
  const { listStages } = await import("../modules/pipeline/pipeline.service.js");
  const { registrarUpload } = await import("../modules/arquivos/arquivos.service.js");
  const { salvarArquivo } = await import("../lib/storage.js");
  const { emReais } = await import("../lib/dinheiro.js");

  const senhaHash = await hash(senhaDeSeed());

  async function usuarioPorEmail(email: string) {
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) throw new Error(`Usuário não encontrado: ${email} — rode "pnpm db:seed" antes da demo rica.`);
    return u;
  }

  // ══════════════════════════════════════════════════════════════════════
  // 1) EQUIPE INTERNA
  // ══════════════════════════════════════════════════════════════════════
  console.log("── Equipe ──");
  const EQUIPE_DEMO = [
    { nome: "Juliana Prado", email: emailTeste("juliana"), role: "FUNCIONARIO" as const },
    { nome: "Rafael Menezes", email: emailTeste("rafael"), role: "FUNCIONARIO" as const },
  ];
  for (const u of EQUIPE_DEMO) {
    const dados = { nome: u.nome, role: u.role, passwordHash: senhaHash, senhaTrocadaEm: new Date(), ativo: true };
    await prisma.user.upsert({ where: { email: u.email }, create: { email: u.email, ...dados }, update: {} });
    console.log(`  ✔ ${u.email} (${u.role}) — ${u.nome}`);
  }
  const juliana = await usuarioPorEmail(emailTeste("juliana"));
  const rafael = await usuarioPorEmail(emailTeste("rafael"));
  const thais =
    (await prisma.user.findUnique({ where: { email: "thais.garcia@medconsultoria.com.br" } })) ??
    (await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } }));
  if (!thais) throw new Error('Nenhuma conta ADMIN encontrada — rode "pnpm db:seed" antes da demo rica.');

  // ══════════════════════════════════════════════════════════════════════
  // 2) CATÁLOGO (serviços, exigências, operadoras, etapas do funil)
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n── Catálogo ──");
  await garantirCatalogoDeServicos();
  await seedRequisitosSeVazio();
  await listOperadoras();
  const stagesRaw = await listStages();
  const stagesByChave = new Map<EtapaChave, { id: string; chaveAuto: string | null }>();
  for (const s of stagesRaw) {
    if (s.chaveAuto && (ORDEM_ETAPAS as readonly string[]).includes(s.chaveAuto)) {
      stagesByChave.set(s.chaveAuto as EtapaChave, { id: s.id, chaveAuto: s.chaveAuto });
    }
  }
  for (const chave of ORDEM_ETAPAS) {
    if (!stagesByChave.has(chave)) throw new Error(`Etapa do funil "${chave}" não encontrada após listStages().`);
  }
  console.log(`  ✔ catálogo de serviços, exigências e operadoras garantidos; ${stagesByChave.size} etapas do funil.`);

  async function servicoPorNome(nome: string) {
    const s = await prisma.servico.findFirst({ where: { nome } });
    if (!s) throw new Error(`Serviço não encontrado no catálogo: "${nome}"`);
    return s;
  }

  // ══════════════════════════════════════════════════════════════════════
  // 3) CLIENTES ATIVOS — cada um nasce convertendo um lead (funil real)
  // ══════════════════════════════════════════════════════════════════════
  interface ClienteAtivoSpec {
    clinica: string;
    contato: string;
    cargo: string;
    servicosNaConversao: string[];
    servicosUpsell?: string[];
    observacao: string;
    origem: string;
    responsavel: { id: string };
    faturamentoMensal?: number;
    percentualOverride?: { servico: string; percentual: number };
    seq: number;
    diasAtrasCriacao: number;
  }

  const ATIVOS: ClienteAtivoSpec[] = [
    {
      clinica: "Clínica Ortopédica Vila Mariana",
      contato: "Dra. Renata Salgado",
      cargo: "Ortopedista",
      servicosNaConversao: ["Gestão Operacional", "Faturamento"],
      observacao: "3 médicos na clínica. Faturamento médio de R$ 240.000,00/mês.",
      origem: "Indicação",
      responsavel: juliana,
      faturamentoMensal: 240_000,
      percentualOverride: { servico: "Faturamento", percentual: 6 },
      seq: 1,
      diasAtrasCriacao: 150,
    },
    {
      clinica: "Odonto Ipiranga",
      contato: "Dr. Marcelo Tavares",
      cargo: "Cirurgião-dentista (CRO)",
      servicosNaConversao: ["Credenciamento médico e odontológico", "Negociação com operadoras"],
      observacao: "2 dentistas na clínica.",
      origem: "Site",
      responsavel: rafael,
      seq: 2,
      diasAtrasCriacao: 120,
    },
    {
      clinica: "Instituto Cardiológico Tatuapé",
      contato: "Dr. Sérgio Bittencourt",
      cargo: "Cardiologista",
      servicosNaConversao: ["Faturamento", "Gestão Operacional"],
      observacao: "Faturamento médio de R$ 410.000,00/mês. O maior cliente da carteira.",
      origem: "Indicação",
      responsavel: juliana,
      faturamentoMensal: 410_000,
      seq: 3,
      diasAtrasCriacao: 200,
    },
    {
      clinica: "Clínica Derma Moema",
      contato: "Dra. Camila Ferraz",
      cargo: "Dermatologista",
      servicosNaConversao: ["Identidade visual (Branding)", "Manual da marca"],
      servicosUpsell: ["Desenvolvimento de site"],
      observacao: "Pacote de marca, tudo avulso.",
      origem: "Instagram",
      responsavel: thais,
      seq: 4,
      diasAtrasCriacao: 90,
    },
    {
      clinica: "CliniKids Santana",
      contato: "Dra. Beatriz Nakamura",
      cargo: "Pediatra",
      servicosNaConversao: ["Gestão de redes sociais", "Tráfego pago"],
      servicosUpsell: ["Conteúdo & SEO"],
      observacao: "Pacote de marketing recorrente.",
      origem: "Evento",
      responsavel: thais,
      seq: 5,
      diasAtrasCriacao: 60,
    },
    {
      clinica: "Centro de Diagnóstico Penha",
      contato: "Dr. Otávio Lins",
      cargo: "Radiologista",
      servicosNaConversao: ["Credenciamento médico e odontológico"],
      observacao: "3 médicos na clínica. Credenciamento em andamento.",
      origem: "LinkedIn",
      responsavel: rafael,
      seq: 6,
      diasAtrasCriacao: 45,
    },
  ];

  async function criarClienteAtivo(spec: ClienteAtivoSpec): Promise<string> {
    let lead = await prisma.lead.findFirst({ where: { nome: spec.contato, empresa: spec.clinica } });
    if (!lead) {
      const servicos = await Promise.all(spec.servicosNaConversao.map(servicoPorNome));
      const valorEstimado = servicos.reduce((soma, s) => soma + (emReais(s.valor) ?? 0), 0);
      const criado = await createLead(
        {
          nome: spec.contato,
          empresa: spec.clinica,
          cnpj: gerarCNPJ(spec.seq),
          email: emailTeste(spec.clinica),
          telefone: telefoneFicticio(spec.seq),
          origem: spec.origem,
          observacoes: spec.observacao,
          valorEstimado: valorEstimado || undefined,
          faturamentoMensalEstimado: spec.faturamentoMensal,
          pipelineStageId: stagesByChave.get("novo")!.id,
          responsavelId: spec.responsavel.id,
          servicoIds: servicos.map((s) => s.id),
        },
        spec.responsavel.id,
      );
      await prisma.lead.update({ where: { id: criado.id }, data: { createdAt: diasAtras(spec.diasAtrasCriacao) } });
      await getLeadDetalhe(criado.id);
      await moveLead({ id: criado.id, pipelineStageId: stagesByChave.get("fechado")!.id, ordem: 0 }, spec.responsavel.id);
      lead = await prisma.lead.findUniqueOrThrow({ where: { id: criado.id } });
      console.log(`  ✔ lead "${spec.contato} / ${spec.clinica}" criado e movido para Fechado.`);
    } else {
      console.log(`  • lead "${spec.contato} / ${spec.clinica}" já existia — reaproveitando.`);
    }

    let clienteId = lead.convertidoEmClienteId;
    if (!clienteId) {
      const resultado = await convertLead(lead.id, spec.responsavel.id, false);
      clienteId = resultado.clienteId;
      console.log(`  ✔ ${spec.clinica} convertida em cliente ATIVO.`);
    } else {
      console.log(`  • ${spec.clinica} já era cliente — pulando conversão.`);
    }

    // A conversão real não pergunta o cargo do contato — enriquece o que ela já criou.
    await prisma.contato.updateMany({ where: { clienteId, principal: true, cargo: null }, data: { cargo: spec.cargo } });

    if (spec.percentualOverride) {
      const servico = await servicoPorNome(spec.percentualOverride.servico);
      await atualizarContratacaoCliente(clienteId, servico.id, { percentual: spec.percentualOverride.percentual });
      console.log(`  ✔ ${spec.clinica}: ${spec.percentualOverride.servico} ajustado para ${spec.percentualOverride.percentual}%.`);
    }

    if (spec.servicosUpsell?.length) {
      for (const nome of spec.servicosUpsell) {
        const servico = await servicoPorNome(nome);
        const jaContratado = await prisma.clienteServico.findUnique({ where: { clienteId_servicoId: { clienteId, servicoId: servico.id } } });
        if (jaContratado) continue;
        await ativarServicoCliente(clienteId, servico.id, { origem: "MANUAL" }, { id: spec.responsavel.id });
        console.log(`  ✔ ${spec.clinica}: upsell "${nome}" contratado pela ficha.`);
      }
    }

    return clienteId;
  }

  console.log("\n── Clientes ativos (via conversão de lead) ──");
  const clienteIdPorClinica = new Map<string, string>();
  for (const spec of ATIVOS) {
    const clienteId = await criarClienteAtivo(spec);
    clienteIdPorClinica.set(spec.clinica, clienteId);
  }

  // Upsell em aberto no funil de um cliente JÁ ativo — exercita `criarOportunidadeParaCliente`.
  const instituto = clienteIdPorClinica.get("Instituto Cardiológico Tatuapé")!;
  const jaTemOportunidade = await prisma.lead.findFirst({
    where: { clienteId: instituto, deletedAt: null, convertidoEmClienteId: null, origem: "Cliente existente" },
  });
  if (!jaTemOportunidade) {
    const negociacaoOperadoras = await servicoPorNome("Negociação com operadoras");
    await criarOportunidadeParaCliente(instituto, juliana.id, {
      servicoIds: [negociacaoOperadoras.id],
      valorEstimado: emReais(negociacaoOperadoras.valor) ?? undefined,
      observacoes: "Upsell: renegociar tabelas com a Unimed e a SulAmérica antes da renovação anual.",
    });
    console.log("  ✔ nova oportunidade (upsell) aberta para o Instituto Cardiológico Tatuapé, já cliente.");
  } else {
    console.log("  • oportunidade de upsell do Instituto Cardiológico Tatuapé já existia.");
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4) LEADS NO FUNIL — um em cada etapa, mais um perdido
  // ══════════════════════════════════════════════════════════════════════
  interface LeadFunilSpec {
    etapaAlvo: EtapaChave;
    contato: string;
    clinica: string;
    servicos: string[];
    origem: string;
    responsavel: { id: string };
    valorEstimado?: number;
    faturamentoMensal?: number;
    perdido?: { motivo: string };
    definirValorNaQualificacao?: boolean;
    seq: number;
    diasAtrasCriacao: number;
  }

  const LEADS_FUNIL: LeadFunilSpec[] = [
    {
      etapaAlvo: "novo",
      contato: "Dr. Emerson Fialho",
      clinica: "Consultório Dermatológico Mooca",
      servicos: ["Credenciamento médico e odontológico"],
      origem: "Site",
      responsavel: rafael,
      seq: 101,
      diasAtrasCriacao: 4,
    },
    {
      etapaAlvo: "novo",
      contato: "Ana Lúcia Barros",
      clinica: "Clínica Fisio Movimento",
      servicos: ["Gestão Operacional"],
      origem: "Instagram",
      responsavel: thais,
      seq: 102,
      diasAtrasCriacao: 1,
    },
    {
      etapaAlvo: "qualificacao",
      contato: "Dr. Paulo Kimura",
      clinica: "Núcleo Oftalmológico Anália Franco",
      servicos: ["Faturamento"],
      origem: "Indicação",
      responsavel: juliana,
      faturamentoMensal: 180_000,
      definirValorNaQualificacao: true,
      seq: 103,
      diasAtrasCriacao: 18,
    },
    {
      etapaAlvo: "proposta",
      contato: "Dra. Mariana Duarte",
      clinica: "Clínica da Mulher Aclimação",
      servicos: ["Gestão Operacional", "Gestão de redes sociais"],
      origem: "LinkedIn",
      responsavel: thais,
      valorEstimado: 5_300,
      seq: 104,
      diasAtrasCriacao: 30,
    },
    {
      etapaAlvo: "negociacao",
      contato: "Dr. Fábio Rosseto",
      clinica: "Odontologia Sorriso Real (Santo André)",
      servicos: ["Credenciamento médico e odontológico", "Negociação com operadoras"],
      origem: "Evento",
      responsavel: rafael,
      valorEstimado: 2_700,
      seq: 105,
      diasAtrasCriacao: 45,
    },
    {
      etapaAlvo: "fechado",
      contato: "Dra. Lívia Camargo",
      clinica: "Clínica Vida Ativa Guarulhos",
      servicos: ["Faturamento"],
      origem: "Site",
      responsavel: juliana,
      faturamentoMensal: 95_000,
      seq: 106,
      diasAtrasCriacao: 70,
    },
    {
      etapaAlvo: "qualificacao",
      contato: "Dr. Ricardo Haddad",
      clinica: "Consultório Haddad",
      servicos: ["Gestão Operacional"],
      origem: "Indicação",
      responsavel: thais,
      perdido: { motivo: "Optou por concorrente com preço menor" },
      seq: 107,
      diasAtrasCriacao: 25,
    },
  ];

  /**
   * Avança o lead até a etapa `alvo`, uma etapa por vez, com `moveLead` (nunca por cascata
   * automática): a etapa em que o lead FICA sempre recebe conclusão parcial (na pior das
   * hipóteses, o que os próprios gatilhos automáticos já concluem sozinhos); toda etapa
   * VENCIDA (que o lead já passou) recebe os passos obrigatórios concluídos —
   * `reconciliarPassosAuto` para o passo derivado "valor" (via `updateLead`, que o alimenta) e
   * `togglePasso` para os manuais.
   */
  async function avancarLeadAte(leadId: string, atorId: string, alvo: EtapaChave, opts: { valorEstimado?: number; faturamentoMensalEstimado?: number }) {
    const idxAlvo = ORDEM_ETAPAS.indexOf(alvo);
    for (let guarda = 0; guarda < 8; guarda++) {
      const atual = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { pipelineStage: true } });
      const chaveAtual = (atual.pipelineStage.chaveAuto ?? "novo") as EtapaChave;
      const idxAtual = ORDEM_ETAPAS.indexOf(chaveAtual);
      if (idxAtual >= idxAlvo) break;

      const proximaChave = ORDEM_ETAPAS[idxAtual + 1]!;
      const proximaStage = stagesByChave.get(proximaChave)!;
      await moveLead({ id: leadId, pipelineStageId: proximaStage.id, ordem: 0 }, atorId);
      await getLeadDetalhe(leadId); // seeda o checklist da etapa recém-entrada + reconcilia

      const ehVencida = idxAtual + 1 < idxAlvo;
      if (!ehVencida) continue; // é a etapa-alvo: fica com conclusão parcial, de propósito

      if (proximaChave === "qualificacao") {
        // O único obrigatório de Qualificação é DERIVADO ("valor") — só se completa
        // informando o número; `togglePasso` recusaria (é passo automático).
        await updateLead({ id: leadId, valorEstimado: opts.valorEstimado, faturamentoMensalEstimado: opts.faturamentoMensalEstimado }, atorId);
        await reconciliarPassosAuto(leadId);
      } else {
        const pendentes = await prisma.leadPasso.findMany({
          where: { leadId, stageId: proximaStage.id, obrigatorio: true, concluido: false, autoRegra: null },
        });
        for (const p of pendentes) await togglePasso(p.id, atorId);
      }
    }
  }

  console.log("\n── Leads no funil ──");
  for (const spec of LEADS_FUNIL) {
    const existente = await prisma.lead.findFirst({ where: { nome: spec.contato, empresa: spec.clinica } });
    if (existente) {
      console.log(`  • lead "${spec.contato} / ${spec.clinica}" já existia — pulando.`);
      continue;
    }

    const servicos = await Promise.all(spec.servicos.map(servicoPorNome));
    const lead = await createLead(
      {
        nome: spec.contato,
        empresa: spec.clinica,
        cnpj: spec.etapaAlvo === "novo" ? undefined : gerarCNPJ(spec.seq),
        email: emailTeste(`${spec.contato} ${spec.clinica}`),
        telefone: telefoneFicticio(spec.seq),
        origem: spec.origem,
        pipelineStageId: stagesByChave.get("novo")!.id,
        responsavelId: spec.responsavel.id,
        servicoIds: servicos.map((s) => s.id),
      },
      spec.responsavel.id,
    );
    await prisma.lead.update({ where: { id: lead.id }, data: { createdAt: diasAtras(spec.diasAtrasCriacao) } });
    await getLeadDetalhe(lead.id);

    if (spec.etapaAlvo !== "novo") {
      await avancarLeadAte(lead.id, spec.responsavel.id, spec.etapaAlvo, {
        valorEstimado: spec.valorEstimado,
        faturamentoMensalEstimado: spec.faturamentoMensal,
      });
      // O lead do Dr. Paulo Kimura fica SENTADO em Qualificação com o número já sabido —
      // é o único caso em que a etapa-ALVO (não uma vencida) recebe o valor.
      if (spec.etapaAlvo === "qualificacao" && spec.definirValorNaQualificacao && !spec.perdido) {
        await updateLead({ id: lead.id, valorEstimado: spec.valorEstimado, faturamentoMensalEstimado: spec.faturamentoMensal }, spec.responsavel.id);
        await reconciliarPassosAuto(lead.id);
      }
    }

    if (spec.perdido) {
      await marcarPerdido(lead.id, spec.perdido.motivo, spec.responsavel.id);
      console.log(`  ✔ ${spec.contato} / ${spec.clinica} — marcado como PERDIDO ("${spec.perdido.motivo}").`);
    } else {
      console.log(`  ✔ ${spec.contato} / ${spec.clinica} — sentado em "${spec.etapaAlvo}".`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 5) CREDENCIAMENTOS — as seis situações, cobrindo Odonto Ipiranga e Centro de Diagnóstico Penha
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n── Credenciamentos ──");
  interface ProfissionalSpec {
    clinica: string;
    nome: string;
    conselho: "CRM" | "CRO";
    conselhoNumero: string;
    conselhoUf: string;
    especialidade: string;
    anoFormatura: number;
  }
  const PROFISSIONAIS: ProfissionalSpec[] = [
    { clinica: "Odonto Ipiranga", nome: "Dr. Marcelo Tavares", conselho: "CRO", conselhoNumero: "48213", conselhoUf: "SP", especialidade: "Ortodontia", anoFormatura: 2012 },
    { clinica: "Odonto Ipiranga", nome: "Dra. Fernanda Lacerda", conselho: "CRO", conselhoNumero: "52890", conselhoUf: "SP", especialidade: "Endodontia", anoFormatura: 2015 },
    { clinica: "Centro de Diagnóstico Penha", nome: "Dr. Otávio Lins", conselho: "CRM", conselhoNumero: "98213", conselhoUf: "SP", especialidade: "Radiologia", anoFormatura: 2009 },
    { clinica: "Centro de Diagnóstico Penha", nome: "Dr. Henrique Bastos", conselho: "CRM", conselhoNumero: "112044", conselhoUf: "SP", especialidade: "Radiologia", anoFormatura: 2013 },
    { clinica: "Centro de Diagnóstico Penha", nome: "Dra. Patrícia Nogueira", conselho: "CRM", conselhoNumero: "134567", conselhoUf: "SP", especialidade: "Radiologia", anoFormatura: 2017 },
  ];
  const profissionalIdPorNome = new Map<string, string>();
  for (const p of PROFISSIONAIS) {
    const clienteId = clienteIdPorClinica.get(p.clinica)!;
    let prof = await prisma.profissional.findFirst({ where: { clienteId, nome: p.nome } });
    if (!prof) {
      prof = await prisma.profissional.create({
        data: {
          clienteId,
          nome: p.nome,
          conselho: p.conselho,
          conselhoNumero: p.conselhoNumero,
          conselhoUf: p.conselhoUf,
          especialidade: p.especialidade,
          anoFormatura: p.anoFormatura,
        },
      });
      console.log(`  ✔ profissional "${p.nome}" (${p.clinica}) cadastrado.`);
    }
    profissionalIdPorNome.set(p.nome, prof.id);
  }

  // O catálogo de operadoras é o que existe DE VERDADE neste banco (a Med o edita direto na
  // tela) — nunca uma lista fixa no código. Um nome de operadora que exista hoje pode deixar
  // de existir amanhã (renomeada, removida); o semeador não pode morrer por isso.
  //
  // Lixo de teste conhecido: remove "Operadora GRD352779" se sobrou de uma rodada de e2e —
  // só quando não tiver NENHUM vínculo (credenciamento ou convênio de cliente), para nunca
  // apagar dado real por engano.
  const operadoraLixo = await prisma.operadora.findFirst({ where: { nome: "Operadora GRD352779" } });
  if (operadoraLixo) {
    const [temCredenciamento, temClienteServico] = await Promise.all([
      prisma.credenciamento.count({ where: { operadoraId: operadoraLixo.id } }),
      prisma.clienteServico.count({ where: { operadoras: { some: { id: operadoraLixo.id } } } }),
    ]);
    if (temCredenciamento === 0 && temClienteServico === 0) {
      await prisma.operadora.delete({ where: { id: operadoraLixo.id } });
      console.log('  ✔ lixo de teste "Operadora GRD352779" removido (sem vínculo).');
    } else {
      console.log('  • "Operadora GRD352779" tem vínculo — não removida.');
    }
  }

  // Ordem de preferência: as que a Med realmente usa primeiro; o resto do catálogo depois,
  // como reserva. `resolverOperadora` cai para a próxima ainda não usada por aquele
  // profissional quando o nome desejado não existir (ou já tiver sido usado) — nunca lança.
  const OPERADORAS_PREFERIDAS = ["Unimed", "Bradesco Saúde", "Amil / One", "Porto Seguro", "Omint", "Care Plus", "Saúde Caixa", "Geap"];
  const operadorasCatalogo = await prisma.operadora.findMany({ orderBy: [{ ordem: "asc" }, { nome: "asc" }] });
  const operadorasOrdenadas = [
    ...OPERADORAS_PREFERIDAS.map((nome) => operadorasCatalogo.find((o) => o.nome === nome)).filter((o): o is (typeof operadorasCatalogo)[number] => !!o),
    ...operadorasCatalogo.filter((o) => !OPERADORAS_PREFERIDAS.includes(o.nome)),
  ];
  if (operadorasOrdenadas.length === 0) throw new Error("Catálogo de operadoras está vazio — nada para credenciar.");

  function resolverOperadora(nomeDesejado: string, jaUsadasPeloProfissional: Set<string>): { id: string; nome: string } {
    const direta = operadorasOrdenadas.find((o) => o.nome === nomeDesejado);
    if (direta && !jaUsadasPeloProfissional.has(direta.id)) return direta;
    if (direta) console.log(`  ⚠ operadora "${nomeDesejado}" já usada por este profissional neste banco — escolhendo outra.`);
    else console.log(`  ⚠ operadora "${nomeDesejado}" não existe neste catálogo — escolhendo outra disponível.`);
    const alternativa = operadorasOrdenadas.find((o) => !jaUsadasPeloProfissional.has(o.id));
    if (!alternativa) throw new Error("Catálogo de operadoras esgotado para este profissional.");
    console.log(`    → usando "${alternativa.nome}" no lugar.`);
    return alternativa;
  }

  interface CredenciamentoSpec {
    profissional: string;
    operadoraDesejada: string;
    status: "A_PROTOCOLAR" | "PROTOCOLADO" | "EM_ANALISE" | "APROVADO" | "NEGADO" | "ENCERRADO";
    valor: number;
    diasAtras: number;
    motivoNegativa?: string;
    observacoes?: string;
  }
  const CREDENCIAMENTOS: CredenciamentoSpec[] = [
    { profissional: "Dr. Marcelo Tavares", operadoraDesejada: "Unimed", status: "APROVADO", valor: 350, diasAtras: 40 },
    { profissional: "Dr. Marcelo Tavares", operadoraDesejada: "Bradesco Saúde", status: "A_PROTOCOLAR", valor: 300, diasAtras: 5 },
    // Parado há mais de 60 dias — é o que acende o alerta âmbar do painel de credenciamentos.
    { profissional: "Dra. Fernanda Lacerda", operadoraDesejada: "Amil / One", status: "PROTOCOLADO", valor: 350, diasAtras: 75 },
    { profissional: "Dra. Fernanda Lacerda", operadoraDesejada: "Porto Seguro", status: "EM_ANALISE", valor: 320, diasAtras: 20 },
    { profissional: "Dr. Otávio Lins", operadoraDesejada: "Omint", status: "APROVADO", valor: 400, diasAtras: 30 },
    {
      profissional: "Dr. Otávio Lins",
      operadoraDesejada: "Care Plus",
      status: "NEGADO",
      valor: 380,
      diasAtras: 15,
      motivoNegativa: "Documentação da especialização fora do prazo de validade exigido pela operadora.",
    },
    { profissional: "Dr. Henrique Bastos", operadoraDesejada: "Saúde Caixa", status: "EM_ANALISE", valor: 360, diasAtras: 10 },
    { profissional: "Dr. Henrique Bastos", operadoraDesejada: "Unimed", status: "A_PROTOCOLAR", valor: 350, diasAtras: 3 },
    { profissional: "Dra. Patrícia Nogueira", operadoraDesejada: "Geap", status: "PROTOCOLADO", valor: 340, diasAtras: 12 },
    {
      profissional: "Dra. Patrícia Nogueira",
      operadoraDesejada: "Bradesco Saúde",
      status: "ENCERRADO",
      valor: 320,
      diasAtras: 5,
      observacoes: "Encerrado a pedido da clínica — profissional mudou de instituição antes da efetivação.",
    },
  ];
  // Idempotência: por PROFISSIONAL, não por linha. Como o catálogo de operadoras pode não ter
  // o nome desejado (ou já ter sido usado), o resolvedor sempre acha ALGUMA — e comparar
  // (profissional, operadora resolvida) contra o banco não bastaria: numa rodada seguinte, com
  // as mesmas desejadas já "queimadas", ele resolveria para OUTRAS operadoras de novo, e a
  // tabela cresceria a cada execução. Em vez disso: se este profissional já tem `credenciamento`
  // suficiente (uma linha por especificação dele), a rodada inteira dele é pulada.
  const specsPorProfissional = new Map<string, number>();
  for (const c of CREDENCIAMENTOS) specsPorProfissional.set(c.profissional, (specsPorProfissional.get(c.profissional) ?? 0) + 1);
  const jaSemeadoPorProfissional = new Map<string, boolean>();
  for (const [nome, profissionalId] of profissionalIdPorNome) {
    const existentes = await prisma.credenciamento.count({ where: { profissionalId } });
    const esperado = specsPorProfissional.get(nome) ?? 0;
    jaSemeadoPorProfissional.set(profissionalId, existentes >= esperado);
  }
  const operadorasUsadasPorProfissional = new Map<string, Set<string>>();
  for (const c of CREDENCIAMENTOS) {
    const profissionalId = profissionalIdPorNome.get(c.profissional)!;
    if (jaSemeadoPorProfissional.get(profissionalId)) continue; // este profissional já está completo

    const usadas = operadorasUsadasPorProfissional.get(profissionalId) ?? new Set<string>();
    operadorasUsadasPorProfissional.set(profissionalId, usadas);
    const operadora = resolverOperadora(c.operadoraDesejada, usadas);
    usadas.add(operadora.id);

    const jaExiste = await prisma.credenciamento.findFirst({ where: { profissionalId, operadoraId: operadora.id, tentativa: 1 } });
    if (jaExiste) continue;

    const prof = PROFISSIONAIS.find((p) => p.nome === c.profissional)!;
    const clienteId = clienteIdPorClinica.get(prof.clinica)!;
    const criadoEm = diasAtras(c.diasAtras);

    let contaId: string | undefined;
    if (c.status === "APROVADO") {
      const conta = await prisma.conta.create({
        data: {
          tipo: "RECEBER",
          descricao: `Honorário de credenciamento — ${c.profissional} × ${operadora.nome}`,
          valor: c.valor,
          vencimento: diasNaFrente(15),
          clienteId,
          observacoes: "Provisionado na aprovação do credenciamento.",
        },
      });
      contaId = conta.id;
    }

    await prisma.credenciamento.create({
      data: {
        clienteId,
        profissionalId,
        operadoraId: operadora.id,
        valor: c.valor,
        status: c.status,
        createdAt: criadoEm,
        protocoladoEm: c.status === "A_PROTOCOLAR" ? null : criadoEm,
        emAnaliseEm: c.status === "EM_ANALISE" || c.status === "APROVADO" || c.status === "NEGADO" ? diasAtras(Math.max(c.diasAtras - 5, 0)) : null,
        aprovadoEm: c.status === "APROVADO" ? diasAtras(Math.max(c.diasAtras - 10, 0)) : null,
        negadoEm: c.status === "NEGADO" ? diasAtras(Math.max(c.diasAtras - 10, 0)) : null,
        encerradoEm: c.status === "ENCERRADO" ? criadoEm : null,
        motivoNegativa: c.motivoNegativa ?? null,
        observacoes: c.observacoes ?? null,
        contaId,
      },
    });
    console.log(`  ✔ ${c.profissional} × ${operadora.nome}: ${c.status}.`);
  }

  // Documentação enviada só PARCIALMENTE — de propósito, para a seção "o que ainda falta
  // enviar" do Portal não aparecer vazia. Só o Dr. Otávio Lins, só 2 dos 8 requisitos, só o
  // lado FRENTE — o resto (os outros médicos, o verso, o restante da lista) fica pendente.
  const servicoCredenciamento = await servicoPorNome("Credenciamento médico e odontológico");
  const requisitosParaEnviar = await prisma.servicoRequisito.findMany({
    where: { servicoId: servicoCredenciamento.id, titulo: { in: ["RG e CPF do médico", "CRM/CRO e comprovante de especialização"] } },
  });
  const centroDiagnostico = clienteIdPorClinica.get("Centro de Diagnóstico Penha")!;
  const otavioLinsId = profissionalIdPorNome.get("Dr. Otávio Lins")!;
  for (const req of requisitosParaEnviar) {
    const jaEnviado = await prisma.arquivo.findFirst({
      where: { clienteId: centroDiagnostico, requisitoId: req.id, profissionalId: otavioLinsId, lado: "FRENTE", deletedAt: null },
    });
    if (jaEnviado) continue;
    const nomeArquivo = `${req.titulo} - Dr. Otavio Lins (frente).txt`;
    const conteudo = `Documento de demonstração — ${req.titulo}.\nProfissional: Dr. Otávio Lins.\nGerado pelo semeador demo-rica, sem dado real.`;
    const { caminho, tamanho } = await salvarArquivo(centroDiagnostico, nomeArquivo, Readable.from(Buffer.from(conteudo, "utf8")));
    await registrarUpload({
      clienteId: centroDiagnostico,
      servicoId: servicoCredenciamento.id,
      requisitoId: req.id,
      profissionalId: otavioLinsId,
      lado: "FRENTE",
      nome: nomeArquivo,
      mimetype: "text/plain",
      tamanho,
      caminho,
      enviadoPorTipo: "EQUIPE", // nunca "CLIENTE" — evita o notify() de "documento_cliente_enviado"
      enviadoPorId: rafael.id,
    });
    console.log(`  ✔ documento "${req.titulo}" enviado para Dr. Otávio Lins (frente).`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // 6) TAREFAS DA EQUIPE
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n── Tarefas ──");
  interface TarefaSpec {
    titulo: string;
    descricao?: string;
    clinica?: string;
    responsavel: { id: string };
    criadoPor: { id: string };
    prioridade: "BAIXA" | "NORMAL" | "ALTA";
    prazoDias: number; // negativo = vencida
    status?: "PENDENTE" | "FAZENDO" | "CONCLUIDA";
  }
  const TAREFAS: TarefaSpec[] = [
    { titulo: "Recorrer glosa de 12 guias — Instituto Cardiológico Tatuapé", clinica: "Instituto Cardiológico Tatuapé", responsavel: juliana, criadoPor: thais, prioridade: "ALTA", prazoDias: -2 },
    { titulo: "Enviar relatório de faturamento de julho — Ortopédica Vila Mariana", clinica: "Clínica Ortopédica Vila Mariana", responsavel: juliana, criadoPor: thais, prioridade: "NORMAL", prazoDias: -1 },
    { titulo: "Conferir demonstrativos da Unimed do mês — Instituto Cardiológico Tatuapé", clinica: "Instituto Cardiológico Tatuapé", responsavel: juliana, criadoPor: juliana, prioridade: "NORMAL", prazoDias: 0, status: "FAZENDO" },
    { titulo: "Protocolar credenciamento na SulAmérica — Odonto Ipiranga", clinica: "Odonto Ipiranga", responsavel: rafael, criadoPor: thais, prioridade: "ALTA", prazoDias: 1 },
    { titulo: "Cobrar documentação pendente do Dr. Otávio Lins", clinica: "Centro de Diagnóstico Penha", responsavel: rafael, criadoPor: rafael, prioridade: "ALTA", prazoDias: -3 },
    { titulo: "Acompanhar retorno da Hapvida sobre a negativa do Dr. Otávio Lins", clinica: "Centro de Diagnóstico Penha", responsavel: rafael, criadoPor: thais, prioridade: "NORMAL", prazoDias: 5 },
    { titulo: "Revisar proposta de credenciamento antes de enviar — Odontologia Sorriso Real", responsavel: rafael, criadoPor: thais, prioridade: "NORMAL", prazoDias: 2 },
    { titulo: "Preparar apresentação da proposta de faturamento — Núcleo Oftalmológico Anália Franco", responsavel: juliana, criadoPor: thais, prioridade: "NORMAL", prazoDias: 3 },
    { titulo: "Atualizar calendário de postagens do mês — CliniKids Santana", clinica: "CliniKids Santana", responsavel: thais, criadoPor: thais, prioridade: "BAIXA", prazoDias: 4, status: "FAZENDO" },
    { titulo: "Aprovar moodboard da identidade visual — Clínica Derma Moema", clinica: "Clínica Derma Moema", responsavel: thais, criadoPor: thais, prioridade: "NORMAL", prazoDias: 6 },
    { titulo: "Configurar acesso de administrador nas redes sociais — CliniKids Santana", clinica: "CliniKids Santana", responsavel: thais, criadoPor: thais, prioridade: "ALTA", prazoDias: -4 },
    { titulo: "Confirmar reunião de kickoff — Odonto Ipiranga", clinica: "Odonto Ipiranga", responsavel: rafael, criadoPor: rafael, prioridade: "NORMAL", prazoDias: 2 },
    { titulo: "Revisar cláusulas do manual da marca — Clínica Derma Moema", clinica: "Clínica Derma Moema", responsavel: thais, criadoPor: thais, prioridade: "BAIXA", prazoDias: 10 },
    { titulo: "Montar organograma da equipe — Clínica Fisio Movimento", responsavel: thais, criadoPor: thais, prioridade: "NORMAL", prazoDias: 7 },
    { titulo: "Follow-up pós-proposta — Clínica da Mulher Aclimação", responsavel: thais, criadoPor: thais, prioridade: "ALTA", prazoDias: 1 },
    { titulo: "Revisar política de reajuste de honorários 2027", responsavel: thais, criadoPor: thais, prioridade: "BAIXA", prazoDias: 20 },
  ];
  for (const t of TAREFAS) {
    const existente = await prisma.tarefa.findFirst({ where: { titulo: t.titulo, deletedAt: null } });
    if (existente) continue;
    const clienteId = t.clinica ? clienteIdPorClinica.get(t.clinica) : undefined;
    await prisma.tarefa.create({
      data: {
        titulo: t.titulo,
        descricao: t.descricao ?? null,
        criadoPorId: t.criadoPor.id,
        prazo: diasNaFrente(t.prazoDias, 18, 0),
        prioridade: t.prioridade,
        status: t.status ?? "PENDENTE",
        clienteId: clienteId ?? null,
        responsaveis: { create: [{ userId: t.responsavel.id }] },
      },
    });
  }
  console.log(`  ✔ ${TAREFAS.length} tarefas conferidas/criadas.`);

  // ══════════════════════════════════════════════════════════════════════
  // 7) AGENDA
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n── Agenda ──");
  interface EventoSpec {
    titulo: string;
    tipo: "COMPROMISSO" | "RETORNO" | "REUNIAO" | "PESSOAL";
    escopo: "EMPRESA" | "PESSOAL";
    dono: { id: string };
    clinica?: string;
    diasDeHoje: number; // negativo = passado
    hora: number;
    minuto?: number;
    duracaoMin?: number;
    recorrencia?: "SEMANAL";
  }
  const AGENDA: EventoSpec[] = [
    { titulo: "Reunião de alinhamento — Ortopédica Vila Mariana", tipo: "REUNIAO", escopo: "EMPRESA", dono: juliana, clinica: "Clínica Ortopédica Vila Mariana", diasDeHoje: 3, hora: 10, duracaoMin: 60 },
    { titulo: "Kickoff de implantação — Instituto Cardiológico Tatuapé", tipo: "REUNIAO", escopo: "EMPRESA", dono: juliana, clinica: "Instituto Cardiológico Tatuapé", diasDeHoje: 5, hora: 14, duracaoMin: 90 },
    { titulo: "Apresentação de proposta — Núcleo Oftalmológico Anália Franco", tipo: "REUNIAO", escopo: "EMPRESA", dono: juliana, diasDeHoje: 2, hora: 11, duracaoMin: 45 },
    { titulo: "Reunião semanal de equipe", tipo: "REUNIAO", escopo: "EMPRESA", dono: thais, diasDeHoje: 7, hora: 9, duracaoMin: 60, recorrencia: "SEMANAL" },
    { titulo: "Retorno com Dr. Otávio Lins sobre documentação", tipo: "RETORNO", escopo: "EMPRESA", dono: rafael, clinica: "Centro de Diagnóstico Penha", diasDeHoje: 1, hora: 15 },
    { titulo: "Revisão de calendário de postagens — CliniKids Santana", tipo: "COMPROMISSO", escopo: "EMPRESA", dono: thais, clinica: "CliniKids Santana", diasDeHoje: 6, hora: 10, minuto: 30, duracaoMin: 30 },
    { titulo: "Reunião de kickoff — Clínica Derma Moema", tipo: "REUNIAO", escopo: "EMPRESA", dono: thais, clinica: "Clínica Derma Moema", diasDeHoje: -10, hora: 14, duracaoMin: 60 },
    { titulo: "Alinhamento mensal — Odonto Ipiranga", tipo: "REUNIAO", escopo: "EMPRESA", dono: rafael, clinica: "Odonto Ipiranga", diasDeHoje: -6, hora: 9, minuto: 30, duracaoMin: 45 },
    { titulo: "Consulta médica (pessoal)", tipo: "PESSOAL", escopo: "PESSOAL", dono: thais, diasDeHoje: 4, hora: 8 },
    { titulo: "Reunião de negociação — Odontologia Sorriso Real", tipo: "REUNIAO", escopo: "EMPRESA", dono: rafael, diasDeHoje: 7, hora: 16, duracaoMin: 60 },
    { titulo: "Apresentação da proposta — Clínica da Mulher Aclimação", tipo: "REUNIAO", escopo: "EMPRESA", dono: thais, diasDeHoje: -3, hora: 11, duracaoMin: 45 },
    { titulo: "Dentista (pessoal)", tipo: "PESSOAL", escopo: "PESSOAL", dono: juliana, diasDeHoje: -8, hora: 17 },
  ];
  for (const e of AGENDA) {
    const existente = await prisma.evento.findFirst({ where: { titulo: e.titulo, deletedAt: null } });
    if (existente) continue;
    const clienteId = e.clinica ? clienteIdPorClinica.get(e.clinica) : undefined;
    const inicio = diasNaFrente(e.diasDeHoje, e.hora, e.minuto ?? 0);
    const fim = e.duracaoMin ? new Date(inicio.getTime() + e.duracaoMin * 60_000) : null;
    await prisma.evento.create({
      data: {
        titulo: e.titulo,
        tipo: e.tipo,
        escopo: e.escopo,
        inicio,
        fim,
        donoId: e.dono.id,
        clienteId: clienteId ?? null,
        recorrencia: e.recorrencia ?? "NENHUMA",
      },
    });
  }
  console.log(`  ✔ ${AGENDA.length} eventos conferidos/criados.`);

  // ══════════════════════════════════════════════════════════════════════
  // 8) FINANCEIRO — despesas de escritório (vencidas, pagas e a vencer)
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n── Financeiro (despesas) ──");
  const CATEGORIAS_DESPESA: { nome: string; cor: string }[] = [
    { nome: "Aluguel", cor: "#E5484D" },
    { nome: "Salários", cor: "#F59E0B" },
    { nome: "Impostos", cor: "#002463" },
    { nome: "Contabilidade", cor: "#8E4EC6" },
    { nome: "Software e assinaturas", cor: "#2DA8E1" },
  ];
  const categoriaIdPorNome = new Map<string, string>();
  for (const c of CATEGORIAS_DESPESA) {
    let cat = await prisma.categoria.findFirst({ where: { nome: c.nome, tipo: "DESPESA" } });
    cat ??= await prisma.categoria.create({ data: { nome: c.nome, tipo: "DESPESA", cor: c.cor } });
    categoriaIdPorNome.set(c.nome, cat.id);
  }
  interface DespesaSpec {
    descricao: string;
    categoria: string;
    valor: number;
    vencimentoDias: number; // negativo = já venceu
    pago?: boolean;
  }
  const DESPESAS: DespesaSpec[] = [
    { descricao: "Aluguel do escritório — setembro", categoria: "Aluguel", valor: 4200, vencimentoDias: 5 },
    { descricao: "Aluguel do escritório — agosto", categoria: "Aluguel", valor: 4200, vencimentoDias: -10 },
    { descricao: "Salários da equipe — agosto", categoria: "Salários", valor: 14500, vencimentoDias: -3, pago: true },
    { descricao: "Honorários contábeis — agosto", categoria: "Contabilidade", valor: 900, vencimentoDias: -1 },
    { descricao: "DAS — Simples Nacional", categoria: "Impostos", valor: 1350, vencimentoDias: 8 },
    { descricao: "Assinaturas de ferramentas (CRM, e-mail, IA)", categoria: "Software e assinaturas", valor: 620, vencimentoDias: 12 },
    { descricao: "Internet e telefonia do escritório", categoria: "Software e assinaturas", valor: 380, vencimentoDias: -15, pago: true },
  ];
  for (const d of DESPESAS) {
    const existente = await prisma.conta.findFirst({ where: { descricao: d.descricao, tipo: "PAGAR" } });
    if (existente) continue;
    await prisma.conta.create({
      data: {
        tipo: "PAGAR",
        descricao: d.descricao,
        valor: d.valor,
        vencimento: diasNaFrente(d.vencimentoDias, 12, 0),
        categoriaId: categoriaIdPorNome.get(d.categoria) ?? null,
        pago: d.pago ?? false,
        pagoEm: d.pago ? diasNaFrente(d.vencimentoDias, 9, 0) : null,
      },
    });
  }
  console.log(`  ✔ ${DESPESAS.length} despesas de escritório conferidas/criadas.`);

  // ══════════════════════════════════════════════════════════════════════
  // 9) PORTAL DO CLIENTE — aponta para o Centro de Diagnóstico Penha
  // ══════════════════════════════════════════════════════════════════════
  console.log("\n── Portal do cliente ──");
  const emailPortal = emailTeste("portal");
  await prisma.user.upsert({
    where: { email: emailPortal },
    create: {
      nome: "Dr. Otávio Lins",
      email: emailPortal,
      role: "CLIENTE",
      clienteId: centroDiagnostico,
      passwordHash: senhaHash,
      senhaTrocadaEm: new Date(),
      papelPortal: "RESPONSAVEL",
      convidadoPorId: rafael.id,
      ativo: true,
    },
    update: {},
  });
  console.log(`  ✔ ${emailPortal} → Portal do Centro de Diagnóstico Penha (documentação parcialmente enviada).`);

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n✓ demo-rica concluída.");
  const totais = await Promise.all([
    prisma.cliente.count({ where: { deletedAt: null, situacaoComercial: "ATIVO" } }),
    prisma.lead.count({ where: { deletedAt: null, convertidoEmClienteId: null } }),
    prisma.profissional.count(),
    prisma.credenciamento.count(),
    prisma.tarefa.count({ where: { deletedAt: null } }),
    prisma.evento.count({ where: { deletedAt: null } }),
    prisma.conta.count({ where: { deletedAt: null } }),
  ]);
  const [nClientes, nLeads, nProfissionais, nCredenciamentos, nTarefas, nEventos, nContas] = totais;
  console.log(
    `  ${nClientes} clientes ativos · ${nLeads} leads no funil · ${nProfissionais} profissionais · ` +
      `${nCredenciamentos} credenciamentos · ${nTarefas} tarefas · ${nEventos} eventos · ${nContas} contas.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
