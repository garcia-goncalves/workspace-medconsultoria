import { prisma, type Prisma } from "@app/db";
import { LADO_ARQUIVO_LABEL, decidirEmailOperacional, type Role } from "@app/shared";
import { credenciamentoParaOPortal } from "../servicos/credenciamento.service.js";
import { servicosDoClientePortal } from "../servicos/servicos-cliente.service.js";
import { enviarEmailTemplate } from "../emails/enviados.service.js";
import { config } from "../../config.js";

/**
 * O E-MAIL AO CLIENTE QUANDO SURGE PENDÊNCIA NOVA DE DOCUMENTO (Onda 3B).
 *
 * Até aqui o cliente só descobria que faltava um documento ENTRANDO no Portal. Quem não entrava
 * não descobria, a papelada parava, e a equipe cobrava por WhatsApp.
 *
 * ⚠️ **POR QUE RESUMO DIÁRIO NA VARREDURA, e não gatilho em cada lugar que cria exigência.** A
 * pendência nova nasce por pelo menos QUATRO portas: contratar um serviço com exigências (ficha,
 * aceite de proposta, conversão do lead), a sincronização de requisitos do catálogo, cadastrar um
 * médico novo no credenciamento (que abre as vagas dele) e a Thaís acrescentar uma exigência em
 * Serviços. Um gatilho em cada porta é o padrão da ADR-140 esperando para acontecer: a quinta
 * porta nasce sem aviso e ninguém percebe. Aqui a pergunta é feita ao RESULTADO — "o que falta
 * hoje que não faltava no último aviso?" —, e porta nova nasce coberta. De brinde, o agrupamento:
 * cinco médicos cadastrados de uma vez viram UM e-mail, não cinco.
 *
 * ⚠️ **A memória do "último aviso" é uma linha do `ActivityLog`** (`portal.pendencias_avisadas`,
 * com as chaves do que faltava naquele dia). Não pediu migração, e é rastro verdadeiro: "a
 * automação avisou a clínica X destas pendências em tal data" é exatamente o que um registro de
 * atividade deve dizer. Só se grava quando se AVISA (ou na primeira vez, para marcar a base) —
 * gravar a cada varredura empurraria a atividade real para fora das 60 linhas que o painel mostra.
 *
 * ⚠️ **A PRIMEIRA VEZ É SILENCIOSA, de propósito.** Sem base anterior, "novo" seria TUDO o que
 * falta — e no dia da publicação cada clínica receberia um e-mail com a papelada inteira, inclusive
 * a que ela já sabe que deve. A base é marcada calada; o aviso é para o que surgir DEPOIS. Quem
 * acabou de entrar no Portal vê a lista inteira na primeira tela, que é onde ela precisa estar.
 *
 * Quem recebe: **RESPONSAVEL e EQUIPE**. Mandar documento é justamente o trabalho da secretária
 * (ADR-131 libera para ela o envio de papelada); avisar só o médico que fala pela clínica seria
 * avisar quem não vai subir o arquivo. Só contas ATIVAS (que já entraram) e sem acesso revogado —
 * convidado que nunca definiu senha não tem Portal para abrir.
 */

export const ACAO_AVISO_PENDENCIAS = "portal.pendencias_avisadas";
/** No máximo um aviso por clínica a cada ~dia. 23 h e não 24 para a varredura de 10 em 10 min
 *  não empurrar o aviso um pouco mais tarde a cada dia até cair de madrugada. */
export const INTERVALO_MINIMO_MS = 23 * 60 * 60 * 1000;
/** Sem aviso novo, a mesma clínica não é recalculada a cada varredura (a conta é pesada). */
const RECHECAR_A_CADA_MS = 6 * 60 * 60 * 1000;

export interface Pendencia {
  /** Estável entre dias — é por ela que "novo" se decide. */
  chave: string;
  /** O que o cliente lê. Só nome de documento e de médico: nada interno. */
  rotulo: string;
  /** Onde se envia — decide o link do botão. */
  onde: "credenciamento" | "documentos";
}

export type PlanoDoAviso = { acao: "MARCAR_BASE" } | { acao: "NADA" } | { acao: "AVISAR"; novas: Pendencia[] };

/** Pura: dado o que falta hoje e o que faltava no último aviso, o que fazer. */
export function planejarAvisoDePendencias(atuais: Pendencia[], anterior: { chaves: string[] } | null): PlanoDoAviso {
  if (!anterior) return { acao: "MARCAR_BASE" };
  const jaAvisadas = new Set(anterior.chaves);
  const novas = atuais.filter((p) => !jaAvisadas.has(p.chave));
  return novas.length ? { acao: "AVISAR", novas } : { acao: "NADA" };
}

/** Pura: já passou tempo bastante desde o último registro para esta clínica ser avisada de novo? */
export function podeAvisarDeNovo(ultimoRegistroEm: Date | null, agora: Date): boolean {
  return !ultimoRegistroEm || agora.getTime() - ultimoRegistroEm.getTime() >= INTERVALO_MINIMO_MS;
}

/**
 * O que falta HOJE para a clínica, em itens obrigatórios. Usa as MESMAS consultas que o Portal
 * desenha (`credenciamentoParaOPortal`, `servicosDoClientePortal`), para o e-mail nunca pedir
 * algo que a tela do cliente não mostra.
 *
 * ⚠️ Não engole falha: se uma das duas consultas cair, a função cai junto. "Falhou" lido como
 * "não falta nada" faria as pendências sumirem de um dia e voltarem no outro — como NOVAS, num
 * e-mail repetido.
 */
export async function pendenciasAtuais(clienteId: string): Promise<Pendencia[]> {
  const [cred, servicos] = await Promise.all([credenciamentoParaOPortal(clienteId), servicosDoClientePortal(clienteId)]);
  const itens: Pendencia[] = [];

  if (cred) {
    type Req = (typeof cred.grupos)[number]["requisitos"][number];
    const vagas = (r: Req, medico: string | null) => {
      if (!r.obrigatorio) return;
      for (const v of r.vagas) {
        if (v.preenchida) continue;
        const partes = [r.titulo, medico ? `— ${medico}` : null, v.lado ? `(${LADO_ARQUIVO_LABEL[v.lado]})` : null];
        itens.push({
          chave: `cred:${r.id}:${v.profissionalId ?? ""}:${v.lado ?? ""}`,
          rotulo: partes.filter(Boolean).join(" "),
          onde: "credenciamento",
        });
      }
    };
    for (const g of cred.grupos) for (const r of g.requisitos) vagas(r, null);
    for (const p of cred.porProfissional) for (const r of p.requisitos) vagas(r, p.profissional.nome);
  }

  for (const s of servicos) {
    for (const r of s.requisitos) {
      if (!r.obrigatorio || r.atendido) continue;
      itens.push({ chave: `srv:${r.id}`, rotulo: `${r.titulo} (${s.servico.nome})`, onde: "documentos" });
    }
  }
  return itens;
}

const verificadoEm = new Map<string, number>();

/** Para os testes: esquece o freio em memória entre um cenário e outro. */
export function esquecerVerificacoesEmMemoria() {
  verificadoEm.clear();
}

type Destinatario = {
  id: string;
  nome: string;
  email: string | null;
  role: Role;
  ativo: boolean;
  deletedAt: Date | null;
};

/**
 * Uma rodada: para cada clínica com gente ativa no Portal, decide e (talvez) avisa.
 * Devolve quantas clínicas foram avisadas — só para teste e diagnóstico.
 */
export async function avisarPendenciasNovasAosClientes(agora: Date = new Date()): Promise<number> {
  const pessoas = await prisma.user.findMany({
    where: {
      role: "CLIENTE",
      ativo: true,
      deletedAt: null,
      acessoRevogadoEm: null,
      clienteId: { not: null },
      cliente: { deletedAt: null },
    },
    select: { id: true, nome: true, email: true, role: true, ativo: true, deletedAt: true, clienteId: true },
  });
  const porClinica = new Map<string, Destinatario[]>();
  for (const p of pessoas) {
    const lista = porClinica.get(p.clienteId!) ?? [];
    lista.push(p);
    porClinica.set(p.clienteId!, lista);
  }

  let avisadas = 0;
  for (const [clienteId, destinatarios] of porClinica) {
    try {
      const ultimaVerificacao = verificadoEm.get(clienteId);
      if (ultimaVerificacao !== undefined && agora.getTime() - ultimaVerificacao < RECHECAR_A_CADA_MS) continue;

      const ultimo = await prisma.activityLog.findFirst({
        where: { acao: ACAO_AVISO_PENDENCIAS, entidadeTipo: "cliente", entidadeId: clienteId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, dados: true },
      });
      if (!podeAvisarDeNovo(ultimo?.createdAt ?? null, agora)) continue;

      const atuais = await pendenciasAtuais(clienteId);
      verificadoEm.set(clienteId, agora.getTime());
      const plano = planejarAvisoDePendencias(atuais, ultimo ? { chaves: chavesGravadas(ultimo.dados) } : null);

      const registrar = (avisou: boolean) =>
        prisma.activityLog.create({
          data: {
            acao: ACAO_AVISO_PENDENCIAS,
            entidadeTipo: "cliente",
            entidadeId: clienteId,
            createdAt: agora,
            dados: { chaves: atuais.map((p) => p.chave), avisou } satisfies Prisma.InputJsonValue,
          },
        });

      if (plano.acao === "NADA") continue;
      if (plano.acao === "MARCAR_BASE") {
        await registrar(false);
        continue;
      }

      const enviados = await enviarAviso(clienteId, destinatarios, plano.novas, atuais.length);
      // Gente elegível e NENHUMA entrega = servidor de e-mail fora do ar: NÃO grava, e a próxima
      // rodada (daqui a 6 h) tenta de novo. Gravar agora daria o aviso por dado sem ninguém ter
      // recebido nada. Sem ninguém elegível (todos desligaram o aviso), grava — senão, no dia em
      // que alguém religasse, chegaria de uma vez tudo o que se acumulou.
      if (enviados.elegiveis > 0 && enviados.entregues === 0) continue;
      await registrar(enviados.entregues > 0);
      if (enviados.entregues > 0) avisadas++;
    } catch {
      /* uma clínica com problema não derruba o aviso das outras */
    }
  }
  return avisadas;
}

function chavesGravadas(dados: Prisma.JsonValue | null): string[] {
  if (dados && typeof dados === "object" && !Array.isArray(dados) && Array.isArray(dados.chaves)) {
    return dados.chaves.filter((c): c is string => typeof c === "string");
  }
  return [];
}

async function enviarAviso(
  clienteId: string,
  destinatarios: Destinatario[],
  novas: Pendencia[],
  total: number,
): Promise<{ elegiveis: number; entregues: number }> {
  const [cliente, prefs] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true } }),
    prisma.preferenciaEmail.findMany({
      where: { tipo: "pendencia_documentos_cliente", userId: { in: destinatarios.map((d) => d.id) } },
      select: { userId: true, ativo: true },
    }),
  ]);
  const pref = new Map(prefs.map((p) => [p.userId, p.ativo]));
  const secao = novas.every((p) => p.onde === "credenciamento") ? "/portal/credenciamento" : "/portal/documentos";
  const vars = {
    clinica: cliente?.nome ?? "sua clínica",
    // Um parágrafo por item: quebra simples vira espaço no HTML do e-mail (ver o template).
    pendencias: novas.map((p) => `• ${p.rotulo}`).join("\n\n"),
    total: String(total),
    link: config.WEB_ORIGIN + secao,
  };

  let elegiveis = 0;
  let entregues = 0;
  for (const d of destinatarios) {
    const pode = decidirEmailOperacional({
      tipo: "pendencia_documentos_cliente",
      role: d.role,
      email: d.email,
      ativo: d.ativo,
      excluido: !!d.deletedAt,
      preferencia: pref.has(d.id) ? pref.get(d.id)! : null,
      emailDoSistema: config.ROOT_PROTEGIDO_EMAIL,
    });
    if (!pode) continue;
    elegiveis++;
    const { enviado } = await enviarEmailTemplate("pendencia_documentos_cliente", d.email!, { ...vars, nome: d.nome });
    if (enviado) entregues++;
  }
  return { elegiveis, entregues };
}
