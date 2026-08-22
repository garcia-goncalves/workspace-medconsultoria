import { prisma } from "@app/db";
import { notificar } from "../modules/notificacoes/notificacoes.service.js";
import { statusJobs } from "../realtime/reminders.js";
import { getProcessoAgora, getResumoTrafego } from "./monitor.js";
import { falhasSeguidas, LIMITE_MESMO_DESTINATARIO } from "./entrega-email.js";
import { isEmailReal } from "../config.js";

/**
 * Motor de alertas. A cada 30s avalia sinais de saúde. Para evitar alarme falso
 * (o problema clássico que a pesquisa apontou), cada regra usa:
 *  - período de espera: só dispara se o limiar for excedido em N avaliações seguidas;
 *  - histerese: só considera "recuperado" quando cai abaixo de um limiar MENOR
 *    que o de disparo (recupera < dispara), para não piscar no limite.
 * Ao disparar, abre um Incidente (persistido, com MTTR) e notifica o ROOT; ao
 * recuperar, resolve o incidente automaticamente e avisa.
 */

const INTERVALO_MS = 30_000;
const PENDENTES_PADRAO = 2;

type Severidade = "degradado" | "critico";

interface Regra {
  chave: string;
  componente: string;
  titulo: string;
  unidade: string;
  ler: () => Promise<number | null>;
  dispara: number;
  recupera: number;
  severidade: (v: number) => Severidade;
  pendentes?: number;
}

const REGRAS: Regra[] = [
  {
    chave: "event_loop",
    componente: "Processo",
    titulo: "Event loop lento",
    unidade: "ms",
    ler: async () => getProcessoAgora().loopP99,
    dispara: 100,
    recupera: 60,
    severidade: (v) => (v >= 250 ? "critico" : "degradado"),
  },
  {
    chave: "heap",
    componente: "Processo",
    titulo: "Uso de memória alto",
    unidade: "%",
    ler: async () => getProcessoAgora().heapUsoPct,
    dispara: 85,
    recupera: 75,
    severidade: (v) => (v >= 92 ? "critico" : "degradado"),
  },
  {
    chave: "taxa_erro",
    componente: "API",
    titulo: "Taxa de erro elevada",
    unidade: "%",
    ler: async () => {
      const t = getResumoTrafego();
      return t.reqUltimoMin >= 5 ? t.taxaErroUltimoMin : null; // sem tráfego mínimo, não avalia
    },
    dispara: 5,
    recupera: 2,
    severidade: (v) => (v >= 20 ? "critico" : "degradado"),
  },
  {
    chave: "db_latencia",
    componente: "Banco de dados",
    titulo: "Banco lento",
    unidade: "ms",
    ler: async () => {
      const t0 = Date.now();
      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch {
        return 99999;
      }
      return Date.now() - t0;
    },
    dispara: 500,
    recupera: 250,
    severidade: (v) => (v >= 2000 ? "critico" : "degradado"),
  },
  {
    chave: "conexoes_db",
    componente: "Banco de dados",
    titulo: "Conexões do banco no limite",
    unidade: "%",
    ler: async () => {
      try {
        const conn = await prisma.$queryRawUnsafe<{ Value: string }[]>(
          "SHOW STATUS LIKE 'Threads_connected'",
        );
        const max = await prisma.$queryRawUnsafe<{ Value: string }[]>(
          "SHOW VARIABLES LIKE 'max_connections'",
        );
        const c = Number(conn[0]?.Value ?? 0);
        const m = Number(max[0]?.Value ?? 0);
        return m ? Math.round((c / m) * 100) : null;
      } catch {
        return null;
      }
    },
    dispara: 80,
    recupera: 65,
    severidade: (v) => (v >= 90 ? "critico" : "degradado"),
  },
  {
    chave: "jobs_parados",
    componente: "Jobs",
    titulo: "Jobs em segundo plano parados",
    unidade: "min",
    ler: async () => {
      const j = statusJobs();
      if (!j.ultimoScanEm) return null; // ainda não rodaram
      return (Date.now() - new Date(j.ultimoScanEm).getTime()) / 60000;
    },
    dispara: 25,
    recupera: 15,
    severidade: (v) => (v >= 40 ? "critico" : "degradado"),
  },
  {
    chave: "entrega_email",
    componente: "E-mail",
    titulo: "E-mail transacional não está saindo",
    unidade: " falhas seguidas",
    /**
     * Conta as falhas registradas DEPOIS do último envio bem-sucedido. O porquê de ser
     * "falhas seguidas" e não "taxa de entrega" está em `entrega-email.ts`: taxa exige
     * volume, e foi justamente por falta de volume que o defeito da ADR-122 passou semanas
     * despercebido, com 100% dos e-mails de produção morrendo em silêncio.
     *
     * ⛔ `isEmailReal` é a primeira linha DE PROPÓSITO: fora de produção não há SMTP e todo
     * envio é gravado como FALHOU por projeto (`enviarEmail` devolve `enviado: false` em modo
     * dev, para o chamador mostrar o link na tela). Sem esta guarda o alerta gritaria em toda
     * máquina de desenvolvimento e em toda rodada de e2e — e alarme falso ensina a ignorar
     * alarme, que é exatamente o que não se pode perder aqui.
     */
    ler: async () => {
      if (!isEmailReal) return null;
      const ultimoSucesso = await prisma.emailEnviado.findFirst({
        where: { status: "ENVIADO" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const falhas = await prisma.emailEnviado.findMany({
        where: {
          status: "FALHOU",
          ...(ultimoSucesso ? { createdAt: { gt: ultimoSucesso.createdAt } } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: { para: true },
        take: 50,
      });
      return falhasSeguidas(falhas);
    },
    dispara: 3,
    recupera: 1, // recupera com 0: um único e-mail que sai zera a conta e resolve o incidente
    severidade: (v) => (v >= LIMITE_MESMO_DESTINATARIO ? "critico" : "degradado"),
    // Uma avaliação basta. O valor não é pico instantâneo que oscila — é contador que já exige
    // três mortes seguidas para chegar a 3. Esperar mais 30s não acrescentaria informação.
    pendentes: 1,
  },
];

interface Estado {
  disparado: boolean;
  excedeuVezes: number;
  pico: number;
  incidenteId?: string;
}
const estados = new Map<string, Estado>();

async function notificarRoot(titulo: string, detalhe: string, incidenteId: string): Promise<void> {
  const roots = await prisma.user.findMany({
    where: { role: "ROOT", ativo: true, deletedAt: null },
    select: { id: true },
  });
  for (const r of roots) {
    await notificar(r.id, "incidente", { titulo, detalhe }, { entidadeTipo: "incidente", entidadeId: incidenteId });
  }
}

async function avaliar(): Promise<void> {
  for (const regra of REGRAS) {
    let valor: number | null;
    try {
      valor = await regra.ler();
    } catch {
      continue;
    }
    if (valor == null) continue;

    const est = estados.get(regra.chave) ?? { disparado: false, excedeuVezes: 0, pico: 0 };

    if (!est.disparado) {
      if (valor >= regra.dispara) {
        est.excedeuVezes++;
        est.pico = Math.max(est.pico, valor);
        if (est.excedeuVezes >= (regra.pendentes ?? PENDENTES_PADRAO)) {
          const sev = regra.severidade(est.pico);
          const detalhe = `${regra.titulo}: chegou a ${est.pico}${regra.unidade} (limite ${regra.dispara}${regra.unidade}).`;
          // Reaproveita incidente ainda aberto da mesma regra (ex.: após restart).
          const existente = await prisma.incidente.findFirst({
            where: { regra: regra.chave, status: { in: ["ABERTO", "RECONHECIDO"] } },
            orderBy: { createdAt: "desc" },
          });
          const inc =
            existente ??
            (await prisma.incidente.create({
              data: {
                regra: regra.chave,
                titulo: regra.titulo,
                severidade: sev,
                componente: regra.componente,
                detalhe,
                valorPico: est.pico,
              },
            }));
          est.disparado = true;
          est.incidenteId = inc.id;
          est.excedeuVezes = 0;
          if (!existente) {
            await notificarRoot(`🚨 ${regra.titulo}`, detalhe, inc.id);
          }
        }
      } else {
        est.excedeuVezes = 0;
        est.pico = 0;
      }
    } else {
      est.pico = Math.max(est.pico, valor);
      if (est.incidenteId) {
        await prisma.incidente
          .update({ where: { id: est.incidenteId }, data: { valorPico: est.pico } })
          .catch(() => {});
      }
      if (valor < regra.recupera) {
        if (est.incidenteId) {
          const inc = await prisma.incidente
            .update({
              where: { id: est.incidenteId },
              data: { status: "RESOLVIDO", resolvidoEm: new Date() },
            })
            .catch(() => null);
          if (inc) {
            const durMin = Math.round((Date.now() - new Date(inc.createdAt).getTime()) / 60000);
            await notificarRoot(
              `✅ Resolvido: ${regra.titulo}`,
              `Voltou ao normal (${valor}${regra.unidade}) após ${durMin}min.`,
              inc.id,
            );
          }
        }
        est.disparado = false;
        est.excedeuVezes = 0;
        est.pico = 0;
        est.incidenteId = undefined;
      }
    }

    estados.set(regra.chave, est);
  }
}

let intervalo: NodeJS.Timeout | null = null;
export function startAlertas(): void {
  if (intervalo) return;
  intervalo = setInterval(() => void avaliar().catch(() => {}), INTERVALO_MS);
  intervalo.unref();
}
