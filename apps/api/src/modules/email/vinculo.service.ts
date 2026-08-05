import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { PastaPapel } from "@app/db";
import { normalizarEndereco } from "./enderecos.js";
import { listPorCliente, listPorLead } from "../emails/enviados.service.js";

/**
 * O vínculo entre a caixa pessoal de cada um e a ficha do cliente/lead (ADR-95, fase 2D-1).
 *
 * Duas regras mandam aqui e nenhuma é detalhe de implementação:
 *
 * 1. **A lista nunca devolve corpo.** Qualquer pessoa da equipe vê remetente, destinatários,
 *    assunto, data e o `trecho` (o resumo em texto puro que o índice já guarda). O corpo
 *    completo continua só para o dono da caixa, em `/email`. Ampliar depois é um `select` a
 *    mais; estreitar depois de alguém ter lido a correspondência alheia é impossível.
 * 2. **O vínculo não é gravado** — é resolvido na consulta, por JOIN no endereço. Cliente que
 *    troca de e-mail passa a refletir a verdade nova sem migração nenhuma.
 */

/** Nunca entram na ficha: o que foi jogado fora (ou marcado como lixo) não é histórico. */
const PASTAS_FORA: PastaPapel[] = ["TRASH", "JUNK"];

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 200;

/** Tamanho do trecho — o mesmo que `abrirMensagem` grava em `EmailMensagem.trecho`. */
const TAMANHO_TRECHO = 200;

export type ItemDaCaixa = {
  origem: "caixa";
  id: string;
  dataEm: Date;
  assunto: string | null;
  trecho: string | null;
  deNome: string | null;
  deEmail: string;
  para: string[];
  temAnexo: boolean;
  particular: boolean;
  /** Quem é o dono decide o que a tela oferece: só ele abre o corpo e só ele marca particular. */
  caixa: { id: string; email: string; donoId: string; donoNome: string };
};

export type ItemAutomatico = {
  origem: "automatico";
  id: string;
  dataEm: Date;
  assunto: string;
  trecho: string | null;
  para: string;
  status: "ENVIADO" | "FALHOU";
  erro: string | null;
  templateLabel: string;
};

export type ItemDaConversa = ItemDaCaixa | ItemAutomatico;

function limpar(enderecos: Array<string | null | undefined>): string[] {
  const vistos = new Set<string>();
  for (const e of enderecos) {
    const n = e ? normalizarEndereco(e) : "";
    if (n) vistos.add(n);
  }
  return [...vistos];
}

/** `Cliente.email` MAIS o e-mail de cada contato — é assim que uma PJ aparece na ficha. */
export async function enderecosDoCliente(clienteId: string): Promise<string[]> {
  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, deletedAt: null },
    select: { email: true, contatos: { select: { email: true } } },
  });
  if (!cliente) return [];
  return limpar([cliente.email, ...cliente.contatos.map((c) => c.email)]);
}

/** Lead não tem contatos — só o próprio e-mail. */
export async function enderecosDoLead(leadId: string): Promise<string[]> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: { email: true },
  });
  if (!lead) return [];
  return limpar([lead.email]);
}

/**
 * A mesma mensagem existe na caixa de quem mandou (Enviados) e na de cada pessoa da equipe que
 * recebeu. Deduplicar por `messageId` ficando com a MAIS ANTIGA dá o item estável — e mensagem
 * sem `messageId` (servidor antigo, rascunho importado) nunca é agrupada com outra.
 */
function deduplicar<T extends { id: string; messageId: string | null; dataEm: Date }>(linhas: T[]): T[] {
  const porMessageId = new Map<string, T>();
  const soltas: T[] = [];
  for (const l of linhas) {
    if (!l.messageId) {
      soltas.push(l);
      continue;
    }
    const atual = porMessageId.get(l.messageId);
    if (!atual || l.dataEm.getTime() < atual.dataEm.getTime()) porMessageId.set(l.messageId, l);
  }
  return [...porMessageId.values(), ...soltas].sort((a, b) => b.dataEm.getTime() - a.dataEm.getTime());
}

export async function listarPorEnderecos(enderecos: string[], limite = LIMITE_PADRAO): Promise<ItemDaCaixa[]> {
  // Cliente sem e-mail e sem contato não pode virar uma varredura da tabela inteira.
  if (enderecos.length === 0) return [];
  const teto = Math.min(Math.max(limite, 1), LIMITE_MAXIMO);

  const linhas = await prisma.emailMensagem.findMany({
    where: {
      particular: false,
      enderecos: { some: { endereco: { in: enderecos } } },
      // `notIn` sozinho descartaria a pasta SEM papel (a que a pessoa criou), porque em SQL
      // `NULL NOT IN (...)` não é verdadeiro. O `OR` com `papel: null` é o que mantém a pasta
      // comum dentro e só tira Lixeira e Spam.
      pasta: { OR: [{ papel: null }, { papel: { notIn: PASTAS_FORA } }] },
    },
    select: {
      id: true,
      messageId: true,
      deNome: true,
      deEmail: true,
      assunto: true,
      trecho: true,
      dataEm: true,
      temAnexo: true,
      particular: true,
      enderecos: { select: { papel: true, endereco: true } },
      pasta: {
        select: {
          papel: true,
          nome: true,
          caixa: { select: { id: true, email: true, userId: true, user: { select: { nome: true } } } },
        },
      },
    },
    orderBy: { dataEm: "desc" },
    // Buscar com folga porque a deduplicação só acontece aqui: sem isso, uma página cheia de
    // cópias da mesma mensagem devolveria bem menos que o limite pedido.
    take: Math.min(teto * 3, LIMITE_MAXIMO * 3),
  });

  return deduplicar(linhas)
    .slice(0, teto)
    .map((m) => ({
      origem: "caixa" as const,
      id: m.id,
      dataEm: m.dataEm,
      assunto: m.assunto,
      trecho: m.trecho,
      deNome: m.deNome,
      deEmail: m.deEmail,
      para: m.enderecos.filter((e) => e.papel === "PARA" || e.papel === "CC").map((e) => e.endereco),
      temAnexo: m.temAnexo,
      particular: m.particular,
      caixa: {
        id: m.pasta.caixa.id,
        email: m.pasta.caixa.email,
        donoId: m.pasta.caixa.userId,
        donoNome: m.pasta.caixa.user.nome,
      },
    }));
}

export async function mensagensDoCliente(clienteId: string, limite = LIMITE_PADRAO): Promise<ItemDaCaixa[]> {
  return listarPorEnderecos(await enderecosDoCliente(clienteId), limite);
}

export async function mensagensDoLead(leadId: string, limite = LIMITE_PADRAO): Promise<ItemDaCaixa[]> {
  return listarPorEnderecos(await enderecosDoLead(leadId), limite);
}

// ── Linha do tempo unificada ──────────────────────────────────────────────────────────────

type RowEnviado = Awaited<ReturnType<typeof listPorCliente>>[number];

function doLogAutomatico(r: RowEnviado): ItemAutomatico {
  return {
    origem: "automatico",
    id: r.id,
    dataEm: r.createdAt,
    assunto: r.assunto,
    trecho: r.corpo.replace(/\s+/g, " ").trim().slice(0, TAMANHO_TRECHO) || null,
    para: r.para,
    status: r.status,
    erro: r.erro,
    templateLabel: r.templateLabel,
  };
}

export type Conversa = { itens: ItemDaConversa[]; caixaIndisponivel: boolean };

/**
 * Junta as duas fontes: o log dos e-mails automáticos (`EmailEnviado`, que já tem consumidor
 * próprio e fica intocado) e o que a equipe trocou pela própria caixa.
 *
 * A caixa depende de rede indireta e de um índice que pode estar sincronizando. Se ela falhar,
 * o card ainda mostra o log automático e avisa por `caixaIndisponivel` — derrubar a ficha
 * inteira porque o IMAP tossiu seria pior do que mostrar uma parte com o aviso.
 */
async function montarConversa(
  automaticos: Promise<RowEnviado[]>,
  daCaixa: Promise<ItemDaCaixa[]>,
  limite: number,
): Promise<Conversa> {
  const [log, caixa] = await Promise.all([
    automaticos,
    daCaixa.then((i) => ({ ok: true as const, i })).catch(() => ({ ok: false as const, i: [] as ItemDaCaixa[] })),
  ]);

  const itens: ItemDaConversa[] = [...log.map(doLogAutomatico), ...caixa.i].sort(
    (a, b) => b.dataEm.getTime() - a.dataEm.getTime(),
  );

  return { itens: itens.slice(0, limite), caixaIndisponivel: !caixa.ok };
}

export function conversaDoCliente(clienteId: string, limite = LIMITE_PADRAO): Promise<Conversa> {
  return montarConversa(listPorCliente(clienteId), mensagensDoCliente(clienteId, limite), limite);
}

export function conversaDoLead(leadId: string, limite = LIMITE_PADRAO): Promise<Conversa> {
  return montarConversa(listPorLead(leadId), mensagensDoLead(leadId, limite), limite);
}

// ── A válvula de privacidade ──────────────────────────────────────────────────────────────

/**
 * Tira (ou devolve) uma mensagem da ficha do cliente. **Só o dono da caixa** — a posse vai no
 * `where` do próprio `updateMany`, e não numa leitura anterior: assim, para quem não é dono, não
 * existe caminho em que algo seja gravado. `count === 0` é indistinguível de "não existe", e é
 * de propósito: responder `NOT_FOUND` para um id alheio já contaria que ele existe.
 */
export async function marcarParticular(userId: string, mensagemId: string, particular: boolean) {
  const r = await prisma.emailMensagem.updateMany({
    where: { id: mensagemId, pasta: { caixa: { userId, deletedAt: null } } },
    data: { particular },
  });
  if (r.count === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Só quem é dono da caixa pode marcar esta mensagem como particular.",
    });
  }
  return { id: mensagemId, particular };
}
