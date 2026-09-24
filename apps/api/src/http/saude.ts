import type { FastifyInstance } from "fastify";
import { prisma } from "@app/db";

/**
 * As duas perguntas de saúde, e por que são DUAS.
 *
 *   GET /health         — "o processo está vivo?" (liveness). Não toca o banco, de propósito.
 *   GET /health/pronto  — "consigo atender de verdade?" (readiness). Faz `SELECT 1`.
 *
 * POR QUE O SEGUNDO EXISTE: em 22/09/2026 a homologação ficou com o banco FORA e o `/health`
 * dizendo "ok" — o deploy e qualquer monitor olhando para ele achavam que estava tudo no ar.
 * O `/health/pronto` é o que o smoke test do deploy e o monitor externo devem ler.
 *
 * ⚠️ POR QUE O `/health` NÃO PASSOU A CONSULTAR O BANCO: é ele que o HEALTHCHECK da imagem lê.
 * Se o banco cai, reiniciar o app não conserta nada — e um app marcado "unhealthy" por causa do
 * banco vira candidato a reinício em laço (qualquer autoheal, ou a próxima pessoa que "resolve"
 * com `docker restart`), derrubando junto o SPA e as telas que funcionariam sem banco.
 *
 * ⚠️ O 503 NÃO diz o motivo. A mensagem do Prisma traz host, porta e às vezes o usuário do
 * banco — e esta rota é anônima e pública. O detalhe vai para o log do servidor.
 */
export const TEMPO_MAXIMO_DA_SONDA_MS = 2_000;

export type SondaDoBanco = () => Promise<unknown>;

const sondaPadrao: SondaDoBanco = () => prisma.$queryRaw`SELECT 1`;

/**
 * Corre a sonda contra um relógio. ⚠️ O prazo curto importa mais que parece: com o pool
 * esgotado (limite 13, já visto em produção) o Prisma espera até 10 s por uma conexão — um
 * monitor com timeout de 5 s leria isso como "site fora" sem saber por quê. Aqui a resposta
 * sai em 2 s, dizendo "banco indisponível".
 */
export async function bancoResponde(
  sonda: SondaDoBanco,
  tempoMaximoMs = TEMPO_MAXIMO_DA_SONDA_MS,
): Promise<{ ok: true } | { ok: false; erro: unknown }> {
  let relogio: NodeJS.Timeout | undefined;
  const estourou = new Promise<never>((_, rejeitar) => {
    relogio = setTimeout(
      () => rejeitar(new Error(`o banco não respondeu em ${tempoMaximoMs} ms`)),
      tempoMaximoMs,
    );
  });
  try {
    await Promise.race([sonda(), estourou]);
    return { ok: true };
  } catch (erro) {
    return { ok: false, erro };
  } finally {
    clearTimeout(relogio);
  }
}

export function registrarRotasDeSaude(
  app: FastifyInstance,
  sonda: SondaDoBanco = sondaPadrao,
  tempoMaximoMs = TEMPO_MAXIMO_DA_SONDA_MS,
): void {
  app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

  app.get("/health/pronto", async (_req, reply) => {
    // Resposta de saúde nunca pode vir de cache (do nginx, de um CDN, do navegador): um "pronto"
    // guardado de cinco minutos atrás é exatamente a mentira que esta rota veio desfazer.
    reply.header("Cache-Control", "no-store");
    const r = await bancoResponde(sonda, tempoMaximoMs);
    if (r.ok) return { status: "pronto", banco: "ok", ts: new Date().toISOString() };
    app.log.warn({ err: r.erro }, "[saude] /health/pronto: banco indisponível");
    return reply.code(503).send({ status: "indisponivel", banco: "indisponivel" });
  });
}
