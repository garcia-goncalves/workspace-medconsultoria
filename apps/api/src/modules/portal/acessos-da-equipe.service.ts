import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { SessionUser } from "@app/shared";

/**
 * "QUEM DA MEDCONSULTORIA ENTROU NO MEU PORTAL?" — a outra metade da sessão de suporte (ADR-128).
 *
 * A ADR-128 deixou a equipe abrir o Portal do cliente em modo de leitura, e registrou cada entrada
 * (`painel_cliente.entrou` / `.saiu` no `ActivityLog`) para a CASA poder responder "quem viu o
 * quê". Faltava o dono do dado poder perguntar o mesmo: é o Portal DELE, com os documentos dele, e
 * transparência sobre quem olhou é o que transforma "a Med pode ver tudo" em algo aceitável sob a
 * LGPD (art. 9º — o titular tem direito a saber como o dado é tratado).
 *
 * ⚠️ O que sai daqui é só **quem** (o nome de quem entrou), **quando** e **por quanto tempo**. Nada
 * de e-mail, papel ou id interno da pessoa da Med: o cliente precisa reconhecer "a Thaís entrou",
 * não ganhar o diretório da equipe (a lição da ADR-150, em que a distinção de pessoa entregava
 * papel e e-mail completos).
 */

const JANELA_DIAS = 90;
/** A sessão de suporte dura 30 min (`SUPORTE_TTL_MS`, lib/session.ts). Sem "saiu", foi o prazo. */
const DURACAO_MAXIMA_MS = 30 * 60 * 1000;
/** Teto de linhas lidas: 90 dias de suporte cabem folgados; o teto só impede resposta gigante. */
const MAX_LINHAS = 1000;

export interface LinhaDeAcesso {
  acao: string;
  createdAt: Date;
  userId: string | null;
  nome: string | null;
}

export interface AcessoDaEquipe {
  quem: string;
  entrouEm: Date;
  /** Nulo quando não houve "voltar ao meu acesso": a sessão acabou sozinha no prazo (ou segue aberta). */
  saiuEm: Date | null;
  duracaoMinutos: number | null;
  /** Entrou há menos de 30 min e ainda não saiu — a sessão pode estar aberta agora. */
  emAndamento: boolean;
}

/**
 * Emparelha cada ENTRADA com a SAÍDA da mesma pessoa. Pura, para ser testada sem banco.
 *
 * A saída casa com a entrada mais recente e ainda aberta daquela pessoa, e só dentro dos 30 min
 * que a sessão de suporte pode durar: um "saiu" órfão (ou muito depois) não inventa duração.
 * Devolve do mais recente para o mais antigo, que é a ordem em que se lê um histórico.
 */
export function emparelharAcessos(linhas: LinhaDeAcesso[], agora: Date): AcessoDaEquipe[] {
  const ordenadas = [...linhas].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const abertos = new Map<string, AcessoDaEquipe>();
  const saida: AcessoDaEquipe[] = [];

  for (const l of ordenadas) {
    const chave = l.userId ?? "(removido)";
    if (l.acao === "painel_cliente.entrou") {
      const acesso: AcessoDaEquipe = {
        // Pessoa da Med apagada depois (FK SetNull): o registro fica, sem nome.
        quem: l.nome ?? "Alguém da equipe MedConsultoria",
        entrouEm: l.createdAt,
        saiuEm: null,
        duracaoMinutos: null,
        emAndamento: false,
      };
      abertos.set(chave, acesso);
      saida.push(acesso);
    } else if (l.acao === "painel_cliente.saiu") {
      const aberto = abertos.get(chave);
      if (!aberto) continue;
      const ms = l.createdAt.getTime() - aberto.entrouEm.getTime();
      // Um minuto de folga sobre os 30: o "saiu" é gravado depois de a sessão ser conferida.
      if (ms >= 0 && ms <= DURACAO_MAXIMA_MS + 60_000) {
        aberto.saiuEm = l.createdAt;
        aberto.duracaoMinutos = Math.max(1, Math.round(ms / 60_000));
      }
      abertos.delete(chave);
    }
  }

  for (const a of saida) {
    if (!a.saiuEm && agora.getTime() - a.entrouEm.getTime() < DURACAO_MAXIMA_MS) a.emAndamento = true;
  }
  return saida.reverse();
}

/**
 * Os acessos da equipe ao Portal DESTA clínica nos últimos 90 dias.
 *
 * ⚠️ Filtra pelo `clienteId` DA SESSÃO (o `portalProcedure` injeta), nunca por um id do pedido —
 * é o isolamento de sempre do Portal: a clínica A não vê quem entrou na clínica B.
 * ⚠️ Só o RESPONSÁVEL vê (ADR-131): quem fala pela clínica é quem precisa saber quem olhou.
 * Papel nulo vale como responsável, a mesma leitura de `podeNoPortal`.
 */
export async function acessosDaEquipeAoPortal(
  clienteId: string,
  quemPergunta: SessionUser,
  agora = new Date(),
): Promise<AcessoDaEquipe[]> {
  if (quemPergunta.papelPortal === "EQUIPE") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Só o responsável pela clínica vê os acessos da equipe MedConsultoria.",
    });
  }
  const desde = new Date(agora.getTime() - JANELA_DIAS * 24 * 60 * 60 * 1000);
  const linhas = await prisma.activityLog.findMany({
    where: {
      entidadeTipo: "cliente",
      entidadeId: clienteId,
      acao: { in: ["painel_cliente.entrou", "painel_cliente.saiu"] },
      createdAt: { gte: desde },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_LINHAS,
    select: { acao: true, createdAt: true, userId: true, user: { select: { nome: true } } },
  });
  return emparelharAcessos(
    linhas.map((l) => ({ acao: l.acao, createdAt: l.createdAt, userId: l.userId, nome: l.user?.nome ?? null })),
    agora,
  );
}
