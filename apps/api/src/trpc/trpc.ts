import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import {
  hasRoleLevel,
  podeAgirNoPortal,
  podeAssinarPelaClinica,
  PORTAL_SO_RESPONSAVEL,
  type Role,
} from "@app/shared";
import type { Context } from "./context.js";
import { recordCall } from "../observability/monitor.js";
import { SUPORTE_SO_LEITURA } from "../modules/auth/painel-cliente.service.js";

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const middleware = t.middleware;

// Telemetria RED: cronometra TODA chamada tRPC (rota + duração + sucesso/erro).
// Base de todos os procedures — sem instrumentar módulo por módulo.
const timed = t.procedure.use(async ({ path, next }) => {
  const start = Date.now();
  const result = await next();
  recordCall(path, result.ok, Date.now() - start);
  return result;
});

/** Sem autenticação. */
export const publicProcedure = timed;

/**
 * ACEITAR PROPOSTA E ASSINAR CONTRATO — público, mas com as travas do Portal valendo.
 *
 * Continua aberto a quem não está logado: o link de assinatura chega por e-mail e o token é a
 * credencial. O que este procedure acrescenta é a leitura da SESSÃO quando ela existe — sem
 * isso, a secretária EQUIPE (ADR-131) e a sessão de suporte da Med (ADR-128), as duas
 * barradas no `portalProcedure`, davam a volta pela rota pública e assinavam assim mesmo.
 * A régua é a mesma função pura que a tela usa para decidir se mostra o botão.
 */
export const aceiteProcedure = timed.use(
  middleware(({ ctx, next }) => {
    const veredito = podeAssinarPelaClinica(ctx.user);
    if (!veredito.pode) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: veredito.motivo === "SUPORTE_SO_LEITURA" ? SUPORTE_SO_LEITURA : PORTAL_SO_RESPONSAVEL,
      });
    }
    return next();
  }),
);

/** Exige sessão válida; injeta `ctx.user` não-nulo. */
const isAuthed = middleware(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Não autenticado" });
  return next({ ctx: { user: ctx.user } });
});
export const protectedProcedure = timed.use(isAuthed);

/** Exige papel com privilégio >= `min`. */
function requireRole(min: Role) {
  return middleware(({ ctx, next }) => {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Não autenticado" });
    if (!hasRoleLevel(ctx.user.role, min)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão" });
    }
    return next({ ctx: { user: ctx.user } });
  });
}

/** Acesso interno (FUNCIONARIO, ADMIN ou ROOT) — exclui CLIENTE (Portal). */
export const funcionarioProcedure = timed.use(requireRole("FUNCIONARIO"));
export const adminProcedure = timed.use(requireRole("ADMIN"));
export const rootProcedure = timed.use(requireRole("ROOT"));

/**
 * Portal do Cliente: exige papel CLIENTE e injeta `ctx.clienteId` a partir da
 * SESSÃO (nunca do input). Todo dado do portal DEVE filtrar por esse clienteId
 * — é o isolamento rígido (o cliente nunca vê dados internos nem de outros).
 */
export const portalProcedure = timed.use(
  middleware(({ ctx, next, type, path }) => {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Não autenticado" });
    if (ctx.user.role !== "CLIENTE" || !ctx.user.clienteId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Acesso restrito ao Portal do Cliente" });
    }
    // QUEM PODE AGIR PELO CLIENTE — duas travas, uma régua só (`podeAgirNoPortal`).
    //
    // (1) SESSÃO DE SUPORTE (ADR-128): a equipe da Med **vê tudo e não assina nada**.
    // (2) PAPEL DENTRO DA CLÍNICA (ADR-131): a secretária cuida do dia a dia e não fala pela
    //     clínica; a lista de liberações tem padrão NEGAR, então ação nova nasce fechada.
    //
    // As duas moram AQUI, e não dentro de cada ação, de propósito. Marcar ação por ação exige
    // acertar a lista hoje e lembrar dela em toda ação nova — e a que alguém esquecer é
    // justamente a que vai morder, porque no Portal escrever é sempre falar pelo cliente.
    //
    // Só vale para MUTAÇÃO: os dois papéis leem tudo daquela clínica. A trava é sobre agir, não
    // sobre ver — a secretária precisa conferir a cobrança que ela mesma processa.
    //
    // ⚠️ A função é a MESMA que a tela usa para decidir se mostra o botão. Duas cópias
    // divergiriam na primeira liberação nova, e a tela passaria a esconder um botão que o
    // servidor aceita (ou a mostrar um que ele recusa) — o modo de falha da ADR-133.
    if (type === "mutation") {
      const veredito = podeAgirNoPortal(ctx.user, path.replace(/^portal\./, ""));
      if (!veredito.pode) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: veredito.motivo === "SUPORTE_SO_LEITURA" ? SUPORTE_SO_LEITURA : PORTAL_SO_RESPONSAVEL,
        });
      }
    }
    return next({ ctx: { user: ctx.user, clienteId: ctx.user.clienteId } });
  }),
);
