import { prisma } from "@app/db";
import { notificar } from "../modules/notificacoes/notificacoes.service.js";
import { enviarEmailTemplate } from "../modules/emails/enviados.service.js";
import { garantirProximasRecorrencias } from "../modules/financeiro/contas.service.js";
import { hojeBRT } from "../lib/datas.js";

const JANELA_MIN = 15;
const SCAN_MIN = 10;
const LEMBRETE_CLIENTE_MIN = 30; // cadência do lembrete por e-mail ao cliente
const JANELA_CLIENTE_H = 24; // avisa o cliente das reuniões nas próximas 24h

// Última execução de cada loop — exposto ao painel de Sistema (ROOT).
let ultimoLembreteEm: Date | null = null;
let ultimoScanEm: Date | null = null;
export function statusJobs() {
  return { ultimoLembreteEm, ultimoScanEm, janelaLembreteMin: JANELA_MIN, scanMin: SCAN_MIN };
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dataFmt = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const horaFmt = (d: Date) =>
  d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const quandoFmt = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(d);

/**
 * Loop de lembretes: a cada minuto procura eventos (não recorrentes) que começam
 * nos próximos 15 min e ainda não foram avisados, cria a notificação e empurra
 * em tempo real via Socket.IO para o DONO e os PARTICIPANTES do evento.
 */
export function startReminderLoop(): void {
  const check = async () => {
    ultimoLembreteEm = new Date();
    const agora = new Date();
    const limite = new Date(agora.getTime() + JANELA_MIN * 60 * 1000);
    const eventos = await prisma.evento.findMany({
      where: {
        deletedAt: null,
        lembreteEnviado: false,
        recorrencia: "NENHUMA",
        inicio: { gte: agora, lte: limite },
      },
      include: { participantes: { select: { userId: true } } },
    });
    for (const ev of eventos) {
      const hora = horaFmt(ev.inicio);
      const destinatarios = new Set<string>([ev.donoId, ...ev.participantes.map((p) => p.userId)]);
      for (const uid of destinatarios) {
        await notificar(
          uid,
          "lembrete",
          { evento: ev.titulo, hora },
          { entidadeTipo: "evento", entidadeId: ev.id },
        );
      }
      await prisma.evento.update({ where: { id: ev.id }, data: { lembreteEnviado: true } });
    }
  };

  setInterval(() => void check().catch(() => {}), 60_000);
  void check().catch(() => {});

  setInterval(() => void scanProativo().catch(() => {}), SCAN_MIN * 60 * 1000);
  void scanProativo().catch(() => {});

  setInterval(() => void lembrarClientes().catch(() => {}), LEMBRETE_CLIENTE_MIN * 60 * 1000);
  void lembrarClientes().catch(() => {});
}

/**
 * Lembrete por e-mail ao cliente: reuniões/compromissos (escopo EMPRESA, não
 * recorrentes) nas próximas 24h, ainda não lembradas, cujo cliente tem e-mail.
 */
export async function lembrarClientes(): Promise<void> {
  const agora = new Date();
  const limite = new Date(agora.getTime() + JANELA_CLIENTE_H * 60 * 60 * 1000);
  const eventos = await prisma.evento.findMany({
    where: {
      deletedAt: null,
      lembreteClienteEnviado: false,
      recorrencia: "NENHUMA",
      escopo: "EMPRESA",
      tipo: { in: ["REUNIAO", "COMPROMISSO"] },
      inicio: { gte: agora, lte: limite },
      cliente: { is: { email: { not: null } } },
    },
    select: {
      id: true,
      titulo: true,
      inicio: true,
      diaInteiro: true,
      linkReuniao: true,
      cliente: { select: { nome: true, email: true } },
    },
  });
  for (const ev of eventos) {
    if (ev.cliente?.email) {
      void enviarEmailTemplate("lembrete_reuniao_cliente", ev.cliente.email, {
        nome: ev.cliente.nome,
        titulo: ev.titulo,
        quando: ev.diaInteiro ? `${dataFmt(ev.inicio)} (dia inteiro)` : quandoFmt(ev.inicio),
        link: ev.linkReuniao ?? "",
      }).catch(() => {});
    }
    await prisma.evento.update({ where: { id: ev.id }, data: { lembreteClienteEnviado: true } });
  }
}

/**
 * Scan proativo (a cada ~10 min): gera alertas do que precisa de atenção e que o
 * usuário não deve esquecer — tarefas atrasadas (para o responsável), contas
 * vencidas e documentos aguardando revisão (para admins). Deduplicado por entidade.
 */
export async function scanProativo(): Promise<void> {
  ultimoScanEm = new Date();
  const agora = new Date();

  // 1) Tarefas atrasadas — agrupadas por (responsável, projeto).
  const cards = await prisma.card.findMany({
    where: {
      deletedAt: null,
      status: { not: "CONCLUIDO" },
      responsavelId: { not: null },
      prazo: { lt: agora },
    },
    select: { responsavelId: true, projetoId: true, projeto: { select: { nome: true } } },
  });
  const grupos = new Map<string, { userId: string; projetoId: string; nome: string; qtd: number }>();
  for (const c of cards) {
    if (!c.responsavelId) continue;
    const key = `${c.responsavelId}:${c.projetoId}`;
    const g = grupos.get(key);
    if (g) g.qtd++;
    else
      grupos.set(key, {
        userId: c.responsavelId,
        projetoId: c.projetoId,
        nome: c.projeto.nome,
        qtd: 1,
      });
  }
  for (const g of grupos.values()) {
    await notificar(
      g.userId,
      "tarefa_atrasada",
      { qtd: String(g.qtd), projeto: g.nome },
      { entidadeTipo: "projeto", entidadeId: g.projetoId, unico: true },
    );
  }

  // Admins/root recebem alertas de gestão (financeiro e documentos).
  const admins = await prisma.user.findMany({
    where: { ativo: true, deletedAt: null, role: { in: ["ADMIN", "ROOT"] } },
    select: { id: true },
  });

  // Materializa a próxima parcela das contas recorrentes (rede de segurança, sem cron).
  await garantirProximasRecorrencias().catch(() => {});

  // 2) Contas: alerta de VENCIDA e de A VENCER (≤7 dias, mesma janela do chip do Início).
  //    Carteira EMPRESA → todos os admins; carteira PESSOAL → SÓ o dono (a vida particular
  //    de um não vaza p/ outro).
  const inicioHoje = hojeBRT();
  const em7diasContas = new Date(inicioHoje.getTime() + 7 * 86_400_000);
  const contas = await prisma.conta.findMany({
    where: { deletedAt: null, pago: false, vencimento: { lt: em7diasContas } },
    select: { id: true, descricao: true, tipo: true, valor: true, vencimento: true, escopo: true, donoId: true },
  });
  const alvosDe = (c: { escopo: string; donoId: string | null }) =>
    c.escopo === "PESSOAL" ? (c.donoId ? [c.donoId] : []) : admins.map((a) => a.id);
  for (const conta of contas) {
    const rotulo = conta.tipo === "RECEBER" ? "A receber" : "A pagar";
    const vencida = conta.vencimento < inicioHoje;
    const vars = {
      descricao: conta.descricao,
      tipo: rotulo,
      valor: brl.format(Number(conta.valor)),
      vencimento: dataFmt(conta.vencimento),
    };
    for (const uid of alvosDe(conta)) {
      await notificar(uid, vencida ? "conta_vencida" : "conta_a_vencer", vars, {
        entidadeTipo: "conta",
        entidadeId: conta.id,
        unico: true,
      });
    }
  }

  // 3) Documentos aguardando revisão.
  const docs = await prisma.documento.findMany({
    where: { deletedAt: null, status: "EM_REVISAO" },
    select: { id: true, titulo: true },
  });
  for (const doc of docs) {
    for (const a of admins) {
      await notificar(
        a.id,
        "documento_revisao",
        { documento: doc.titulo },
        { entidadeTipo: "documento", entidadeId: doc.id, unico: true },
      );
    }
  }

  const idAdmins = admins.map((a) => a.id);

  // 4) Conflitos de horário próximos (7 dias) — avisa DONO + PARTICIPANTES. Só eventos
  //    concretos (não recorrentes, com hora). Assim o conflito não depende de abrir a agenda.
  try {
    const em7dias = new Date(inicioHoje.getTime() + 7 * 86_400_000);
    const eventosProx = await prisma.evento.findMany({
      where: { deletedAt: null, recorrencia: "NENHUMA", diaInteiro: false, inicio: { gte: agora, lte: em7dias } },
      select: { id: true, titulo: true, inicio: true, fim: true, donoId: true, participantes: { select: { userId: true } } },
    });
    // Agenda de cada pessoa (dono + participantes).
    const porPessoa = new Map<string, { id: string; titulo: string; inicio: Date; fim: Date | null }[]>();
    for (const ev of eventosProx) {
      for (const uid of new Set<string>([ev.donoId, ...ev.participantes.map((p) => p.userId)])) {
        const arr = porPessoa.get(uid) ?? [];
        arr.push({ id: ev.id, titulo: ev.titulo, inicio: ev.inicio, fim: ev.fim });
        porPessoa.set(uid, arr);
      }
    }
    for (const [uid, evs] of porPessoa) {
      const ord = [...evs].sort((a, b) => +a.inicio - +b.inicio);
      const conflitantes = new Set<string>();
      for (let i = 0; i < ord.length; i++) {
        const a = ord[i]!;
        const af = a.fim ? +a.fim : +a.inicio + 30 * 60000;
        for (let j = i + 1; j < ord.length; j++) {
          const b = ord[j]!;
          const bi = +b.inicio;
          if (bi >= af) break; // ordenado por início: nada mais adiante sobrepõe "a"
          conflitantes.add(a.id);
          conflitantes.add(b.id);
        }
      }
      for (const ev of ord) {
        if (!conflitantes.has(ev.id)) continue;
        await notificar(
          uid,
          "conflito_agenda",
          { titulo: ev.titulo, quando: quandoFmt(ev.inicio) },
          { entidadeTipo: "evento", entidadeId: ev.id, unico: true },
        ).catch(() => {});
      }
    }
  } catch {
    /* uma falha aqui não pode derrubar o resto do scan */
  }

  // 5) Projetos ativos PARADOS (+14d) e SEM RESPONSÁVEL.
  try {
    const d14 = new Date(agora.getTime() - 14 * 86_400_000);
    const parados = await prisma.projeto.findMany({
      where: { deletedAt: null, status: "ATIVO", updatedAt: { lt: d14 } },
      select: { id: true, nome: true, responsavelId: true },
    });
    for (const p of parados) {
      const alvo = p.responsavelId ? [p.responsavelId] : idAdmins;
      for (const uid of alvo) {
        await notificar(uid, "projeto_parado", { projeto: p.nome }, { entidadeTipo: "projeto", entidadeId: p.id, unico: true }).catch(() => {});
      }
    }
    const semResp = await prisma.projeto.findMany({
      where: { deletedAt: null, status: { not: "CONCLUIDO" }, responsavelId: null },
      select: { id: true, nome: true },
    });
    for (const p of semResp) {
      for (const uid of idAdmins) {
        await notificar(uid, "projeto_sem_responsavel", { projeto: p.nome }, { entidadeTipo: "projeto", entidadeId: p.id, unico: true }).catch(() => {});
      }
    }
  } catch {
    /* isola a falha */
  }

  // 6) Upsell — cliente ATIVO/INATIVO com oportunidade aberta no funil (quer mais serviços).
  try {
    const oportunidades = await prisma.lead.findMany({
      where: {
        deletedAt: null,
        convertidoEmClienteId: null,
        perdidoEm: null,
        clientePortal: { is: { situacaoComercial: { in: ["ATIVO", "INATIVO"] } } },
      },
      select: { id: true, responsavelId: true, clientePortal: { select: { nome: true } } },
    });
    for (const o of oportunidades) {
      const alvo = o.responsavelId ? [o.responsavelId] : idAdmins;
      for (const uid of alvo) {
        await notificar(uid, "upsell_oportunidade", { cliente: o.clientePortal?.nome ?? "Cliente" }, { entidadeTipo: "lead", entidadeId: o.id, unico: true }).catch(() => {});
      }
    }
  } catch {
    /* isola a falha */
  }

  // 7) Documentos PARADOS — proposta sem aceite / assinatura pendente há +5 dias.
  //    Avisa quem criou o documento + admins.
  try {
    const d5 = new Date(agora.getTime() - 5 * 86_400_000);
    const parados = await prisma.documento.findMany({
      where: {
        deletedAt: null,
        OR: [
          { propostaStatus: "PENDENTE", propostaSolicitadaEm: { lt: d5 }, propostaRespondidaEm: null },
          { assinaturaSolicitadaEm: { lt: d5 }, assinadoEm: null },
        ],
      },
      select: { id: true, titulo: true, criadoPorId: true },
    });
    for (const doc of parados) {
      for (const uid of new Set<string>([doc.criadoPorId, ...idAdmins].filter((x): x is string => !!x))) {
        await notificar(uid, "documento_parado", { documento: doc.titulo }, { entidadeTipo: "documento", entidadeId: doc.id, unico: true }).catch(() => {});
      }
    }
  } catch {
    /* isola a falha */
  }

  // 8) Leads PARADOS no funil (+14d, ativos) — avisa o responsável (ou admins).
  try {
    const d14lead = new Date(agora.getTime() - 14 * 86_400_000);
    const leadsParados = await prisma.lead.findMany({
      where: { deletedAt: null, convertidoEmClienteId: null, perdidoEm: null, updatedAt: { lt: d14lead } },
      select: { id: true, nome: true, empresa: true, responsavelId: true },
    });
    for (const l of leadsParados) {
      const contato = l.empresa ? `${l.nome} · ${l.empresa}` : l.nome;
      const alvo = l.responsavelId ? [l.responsavelId] : idAdmins;
      for (const uid of alvo) {
        await notificar(uid, "lead_parado", { contato }, { entidadeTipo: "lead", entidadeId: l.id, unico: true }).catch(() => {});
      }
    }
  } catch {
    /* isola a falha */
  }
}
