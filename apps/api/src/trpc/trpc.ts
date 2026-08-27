import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { hasRoleLevel, podeNoPortal, PORTAL_SO_RESPONSAVEL, type Role } from "@app/shared";
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
    // SESSÃO DE SUPORTE (ADR-128): a equipe **vê tudo e não assina nada**.
    //
    // A trava mora AQUI, e não em cada ação, de propósito. Marcar ação por ação exige acertar a
    // lista hoje e lembrar dela em toda ação nova — e a que alguém esquecer é justamente a que
    // vai morder, porque no Portal escrever é sempre falar pelo cliente: desistir do
    // atendimento, cancelar serviço, pedir serviço novo, enviar briefing, apagar documento,
    // abrir chamado. Barrando toda MUTAÇÃO num lugar só, ação nova nasce protegida.
    //
    // Leitura segue livre — é para isso que a equipe entra no painel. E o que a equipe
    // legitimamente precisa escrever (anexar documento, mudar dado cadastral, abrir conversa)
    // ela faz pelas telas internas, assinando com o próprio nome.
    if (type === "mutation" && ctx.user.operador) {
      throw new TRPCError({ code: "FORBIDDEN", message: SUPORTE_SO_LEITURA });
    }
    // QUEM, DENTRO DA CLÍNICA, PODE ISTO (ADR-131).
    //
    // Mora aqui pelo mesmo motivo da trava acima: numa clínica com médico, secretária e dono
    // usando contas próprias, decidir permissão dentro de cada ação é apostar que ninguém vai
    // esquecer — e a que esquecerem é a que cancela um serviço contratado. Aqui a ação nova
    // nasce fechada, e liberar é acrescentar o nome dela em `ACOES_LIBERADAS_PARA_EQUIPE`.
    //
    // Só vale para MUTAÇÃO: os dois papéis leem tudo daquela clínica. A trava é sobre assinar,
    // não sobre ver — a secretária precisa conferir a cobrança que ela mesma processa.
    if (type === "mutation" && !podeNoPortal(ctx.user.papelPortal, path.replace(/^portal\./, ""))) {
      throw new TRPCError({ code: "FORBIDDEN", message: PORTAL_SO_RESPONSAVEL });
    }
    return next({ ctx: { user: ctx.user, clienteId: ctx.user.clienteId } });
  }),
);
