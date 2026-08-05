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
 * 3. **A chave do JOIN nunca é um endereço da casa** (`enderecosDaCasa`). Como o cadastro do
 *    cliente é editável por qualquer funcionário, sem isso quem escolhe a chave da consulta é
 *    quem edita o cadastro — e leria a caixa de um colega pondo o e-mail dele num cliente.
 */

/**
 * Nunca entram na ficha: o que foi jogado fora (ou marcado como lixo) não é histórico — e
 * RASCUNHO menos ainda. O rascunho grava sozinho na pasta `Drafts` do servidor a cada pausa da
 * digitação, então sem `DRAFTS` aqui vazaria e-mail meio escrito, inclusive o que a pessoa
 * pensou melhor e decidiu não mandar.
 */
const PASTAS_FORA: PastaPapel[] = ["TRASH", "JUNK", "DRAFTS"];

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 200;

/** Teto de endereços por consulta — um cadastro com 300 contatos não vira um `IN (...)` gigante. */
const MAXIMO_ENDERECOS = 50;

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

/**
 * Endereços que pertencem à CASA: e-mail de usuário, endereço de caixa plugada e o usuário de
 * login dessa caixa. Nenhum deles pode virar chave do JOIN.
 *
 * O motivo é que a chave é escolhida por quem edita o cadastro — e `Cliente.email`/`Contato.email`
 * são graváveis por qualquer FUNCIONARIO. Sem esta trava, basta pôr o endereço de um colega no
 * cadastro de um cliente descartável para ler, pela ficha, metadado e trecho da caixa dele.
 *
 * Caixa desplugada e usuário desativado continuam na lista de propósito: endereço que um dia foi
 * da casa não deve poder ser reciclado como chave.
 *
 * `role: { not: CLIENTE }` NÃO é detalhe: o cliente do Portal também tem `User`, e sem esse filtro
 * a ficha de todo cliente com acesso ao Portal ficaria vazia. Ninguém consegue se esconder aqui
 * criando um `User` CLIENTE com o e-mail de um colega — `User.email` é único.
 */
async function enderecosDaCasa(): Promise<Set<string>> {
  const [users, caixas] = await Promise.all([
    prisma.user.findMany({ where: { role: { not: "CLIENTE" } }, select: { email: true } }),
    prisma.caixaEmail.findMany({ select: { email: true, usuario: true } }),
  ]);
  return new Set(limpar([...users.map((u) => u.email), ...caixas.flatMap((c) => [c.email, c.usuario])]));
}

/** Tira os endereços da casa e aplica o teto. Lista vazia aqui = nenhuma consulta lá na frente. */
async function soDeFora(enderecos: string[]): Promise<string[]> {
  if (enderecos.length === 0) return [];
  const casa = await enderecosDaCasa();
  return enderecos.filter((e) => !casa.has(e)).slice(0, MAXIMO_ENDERECOS);
}

/** `Cliente.email` MAIS o e-mail de cada contato — é assim que uma PJ aparece na ficha. */
export async function enderecosDoCliente(clienteId: string): Promise<string[]> {
  const cliente = await prisma.cliente.findFirst({
    where: { id: clienteId, deletedAt: null },
    select: { email: true, contatos: { select: { email: true } } },
  });
  if (!cliente) return [];
  return soDeFora(limpar([cliente.email, ...cliente.contatos.map((c) => c.email)]));
}

/** Lead não tem contatos — só o próprio e-mail. */
export async function enderecosDoLead(leadId: string): Promise<string[]> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: { email: true },
  });
  if (!lead) return [];
  return soDeFora(limpar([lead.email]));
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

  // A MESMA mensagem existe na caixa de quem mandou e na de cada colega que recebeu. Filtrar só
  // por `particular: false` esconderia a cópia de quem marcou e deixaria a do colega na ficha,
  // com o mesmo assunto e o mesmo trecho — ou seja, a válvula não valvularia nada. Marcar uma
  // cópia esconde TODAS as cópias daquele `messageId`.
  const marcadas = await prisma.emailMensagem.findMany({
    where: { particular: true, enderecos: { some: { endereco: { in: enderecos } } } },
    select: { messageId: true },
  });
  const escondidos = [...new Set(marcadas.map((m) => m.messageId).filter((m): m is string => !!m))];

  const linhas = await prisma.emailMensagem.findMany({
    where: {
      particular: false,
      ...(escondidos.length > 0 ? { messageId: { notIn: escondidos } } : {}),
      enderecos: { some: { endereco: { in: enderecos } } },
      // `notIn` sozinho descartaria a pasta SEM papel (a que a pessoa criou), porque em SQL
      // `NULL NOT IN (...)` não é verdadeiro. O `OR` com `papel: null` é o que mantém a pasta
      // comum dentro e só tira Lixeira, Spam e Rascunhos.
      //
      // `caixa.deletedAt: null` alinha a listagem com o `marcarParticular`: sem isso, quem
      // desplugou a caixa continuava com a correspondência na ficha E recebia FORBIDDEN ao
      // tentar marcá-la como particular — perdia a válvula justamente quem já tinha saído.
      pasta: {
        caixa: { deletedAt: null },
        OR: [{ papel: null }, { papel: { notIn: PASTAS_FORA } }],
      },
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

/**
 * `trecho` fica `null` para o e-mail automático: o corpo dele carrega o link de ação COM TOKEN, e
 * é por isso que `listPorCliente`/`listPorLead` pararam de devolver corpo. Assunto, tipo, data e
 * entrega já dizem o que aconteceu; o texto integral vive no monitor de e-mails (ADMIN).
 */
function doLogAutomatico(r: RowEnviado): ItemAutomatico {
  return {
    origem: "automatico",
    id: r.id,
    dataEm: r.createdAt,
    assunto: r.assunto,
    trecho: null,
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
