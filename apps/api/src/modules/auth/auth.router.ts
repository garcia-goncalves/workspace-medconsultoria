import { z } from "zod";
import type {} from "@fastify/cookie"; // carrega o augmentation (setCookie/clearCookie/unsignCookie)
import {
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
  aceitarConviteSchema,
  solicitarResetSchema,
  redefinirSenhaSchema,
  confirmarSegundoFatorSchema,
  confirmarAtivacaoSegundoFatorSchema,
  desativarSegundoFatorSchema,
  type ResultadoDeEntrada,
} from "@app/shared";
import { router, publicProcedure, protectedProcedure, funcionarioProcedure } from "../../trpc/trpc.js";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, destroySession, ttlDaSessao } from "../../lib/session.js";
import { abrirPainelDoCliente, voltarDoPainel } from "./painel-cliente.service.js";
import { isProd } from "../../config.js";
import {
  login,
  updateProfile,
  removerAvatar,
  changePassword,
  validarConvite,
  aceitarConvite,
  solicitarReset,
  validarReset,
  redefinirSenha,
  registrarBloqueioCliente,
  concluirEntradaComSegundoFator,
  type EntradaDoServico,
} from "./auth.service.js";
import {
  statusSegundoFator,
  iniciarAtivacao,
  confirmarAtivacao,
  desativarSegundoFator,
} from "./segundo-fator.service.js";

const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax" as const,
  path: "/",
  signed: true,
  maxAge: SESSION_TTL_SECONDS,
};

/**
 * Converte o que o serviço devolveu no que vai ao navegador — e só põe o cookie quando HÁ sessão.
 *
 * ⚠️ Com 2FA ativo o desafio volta no CORPO, nunca num cookie de sessão: ele não é sessão, e um
 * cookie `sid` com um valor que não é sessão faria o `me` responder nulo e a tela piscar. O
 * desafio sozinho não dá acesso a nada (a sessão ainda exige o código).
 */
function responderEntrada(
  ctx: { res: { setCookie: (n: string, v: string, o: typeof cookieOptions) => unknown } },
  r: EntradaDoServico,
): ResultadoDeEntrada {
  if (r.desafio !== undefined) return { segundoFator: true, desafio: r.desafio };
  ctx.res.setCookie(SESSION_COOKIE, r.sid, cookieOptions);
  return { segundoFator: false, user: r.user };
}

export const authRouter = router({
  /**
   * Login por e-mail/senha. Sem 2FA, define o cookie de sessão httpOnly. Com 2FA ativo, devolve
   * o desafio e a sessão só nasce em `confirmarSegundoFator`.
   */
  login: publicProcedure.input(loginSchema).mutation(async ({ ctx, input }) => {
    const userAgent = ctx.req.headers["user-agent"];
    return responderEntrada(ctx, await login(input, userAgent, ctx.req.ip));
  }),

  /** Segunda etapa do login: desafio + código do aplicativo (ou de recuperação) → sessão. */
  confirmarSegundoFator: publicProcedure.input(confirmarSegundoFatorSchema).mutation(async ({ ctx, input }) => {
    const userAgent = ctx.req.headers["user-agent"];
    const { sid, user } = await concluirEntradaComSegundoFator(input.desafio, input.codigo, userAgent, ctx.req.ip);
    ctx.res.setCookie(SESSION_COOKIE, sid, cookieOptions);
    return user;
  }),

  /**
   * VERIFICAÇÃO EM DUAS ETAPAS da própria conta (tela Configurações). `protectedProcedure` e não
   * `adminProcedure` no status e no desativar: quem foi rebaixado de ADMIN continua com o 2FA
   * ligado e precisa conseguir vê-lo e desligá-lo. Ativar é que fica restrito (no serviço).
   */
  segundoFator: router({
    status: protectedProcedure.query(({ ctx }) => statusSegundoFator(ctx.user)),
    iniciar: protectedProcedure.mutation(({ ctx }) => iniciarAtivacao(ctx.user)),
    confirmar: protectedProcedure
      .input(confirmarAtivacaoSegundoFatorSchema)
      .mutation(({ ctx, input }) => {
        // A sessão ATUAL sobrevive; as outras caem (ver `confirmarAtivacao`).
        const raw = ctx.req.cookies[SESSION_COOKIE];
        const unsigned = raw ? ctx.req.unsignCookie(raw) : null;
        const sidAtual = unsigned?.valid ? unsigned.value ?? undefined : undefined;
        return confirmarAtivacao(ctx.user, input.senha, input.codigo, ctx.req.ip, sidAtual);
      }),
    desativar: protectedProcedure
      .input(desativarSegundoFatorSchema)
      .mutation(({ ctx, input }) => desativarSegundoFator(ctx.user, input.senha, input.codigo, ctx.req.ip)),
  }),

  /**
   * Registra um login que o NAVEGADOR barrou antes de sair (validação do formulário).
   *
   * Ponto cego que custou dois diagnósticos errados: quando o campo não passa na validação do
   * cliente, nenhuma requisição chega ao servidor — logo, não havia registro nenhum e "não
   * consigo entrar" ficava indepurável. Agora fica.
   *
   * Só grava e-mail e motivo; NUNCA a senha.
   *
   * ⚠️ Tem FREIO PRÓPRIO por IP (`registrarBloqueioCliente`), e não só o rate-limit global: a
   * rota é anônima e cada chamada grava uma linha no `ActivityLog`, que o cliente pode disparar
   * dezenas de vezes numa requisição HTTP só (`httpBatchLink`). Sem o freio, dava para empurrar
   * para fora da tela do ROOT todo o rastro de quem-fez-o-quê.
   */
  registrarBloqueioNoNavegador: publicProcedure
    .input(z.object({ email: z.string().max(200), motivo: z.string().max(200) }))
    .mutation(async ({ ctx, input }) => {
      await registrarBloqueioCliente(input.email, input.motivo, ctx.req.headers["user-agent"], ctx.req.ip);
      return { ok: true };
    }),

  /** Encerra a sessão atual. */
  logout: publicProcedure.mutation(async ({ ctx }) => {
    const raw = ctx.req.cookies[SESSION_COOKIE];
    const unsigned = raw ? ctx.req.unsignCookie(raw) : null;
    await destroySession(unsigned?.valid ? unsigned.value ?? undefined : undefined);
    ctx.res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }),

  /** Usuário autenticado atual (ou null). Base do "estou logado?" no front. */
  me: publicProcedure.query(({ ctx }) => ctx.user),

  /**
   * PAINEL DO CLIENTE (ADR-128) — a equipe abre o Portal deste cliente em modo de suporte.
   *
   * Troca o cookie por uma sessão que pertence ao cliente mas guarda quem entrou. A sessão do
   * operador continua viva, então "voltar ao meu acesso" não pede login de novo. Dura 30 min.
   */
  entrarNoPainelDoCliente: funcionarioProcedure
    .input(z.object({ clienteId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const raw = ctx.req.cookies[SESSION_COOKIE];
      const unsigned = raw ? ctx.req.unsignCookie(raw) : null;
      const sidAtual = unsigned?.valid ? unsigned.value ?? undefined : undefined;
      const { sid, cliente } = await abrirPainelDoCliente(input.clienteId, ctx.user, sidAtual);
      ctx.res.setCookie(SESSION_COOKIE, sid, { ...cookieOptions, maxAge: ttlDaSessao(true) });
      return { cliente };
    }),

  /** Encerra a sessão de suporte e devolve o operador ao próprio acesso. */
  voltarDoPainelDoCliente: protectedProcedure.mutation(async ({ ctx }) => {
    const raw = ctx.req.cookies[SESSION_COOKIE];
    const unsigned = raw ? ctx.req.unsignCookie(raw) : null;
    const sidAtual = unsigned?.valid ? unsigned.value ?? undefined : undefined;
    const { sid } = await voltarDoPainel(ctx.user, sidAtual);
    if (sid) {
      ctx.res.setCookie(SESSION_COOKIE, sid, cookieOptions);
      return { voltou: true };
    }
    // A sessão original expirou enquanto a pessoa estava no painel: sai limpo, a tela manda
    // para o login. Melhor do que deixá-la presa numa sessão de suporte que ela nao quer mais.
    ctx.res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { voltou: false };
  }),

  /** Verifica um token de convite (para a tela de definir senha). Público. */
  validarConvite: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(({ input }) => validarConvite(input.token)),

  /** Aceita o convite: define a senha e já autentica (ou pede o 2FA, se ativo). Público. */
  aceitarConvite: publicProcedure.input(aceitarConviteSchema).mutation(async ({ ctx, input }) => {
    const userAgent = ctx.req.headers["user-agent"];
    return responderEntrada(ctx, await aceitarConvite(input.token, input.novaSenha, userAgent, ctx.req.ip));
  }),

  /** Solicita redefinição de senha. Sempre responde ok (anti-enumeração). Público. */
  solicitarReset: publicProcedure
    .input(solicitarResetSchema)
    .mutation(({ input }) => solicitarReset(input.email)),

  /** Verifica um token de redefinição (para a tela). Público. */
  validarReset: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(({ input }) => validarReset(input.token)),

  /** Redefine a senha via token e já autentica — ou pede o 2FA, que o reset NÃO pula. Público. */
  redefinirSenha: publicProcedure.input(redefinirSenhaSchema).mutation(async ({ ctx, input }) => {
    const userAgent = ctx.req.headers["user-agent"];
    return responderEntrada(ctx, await redefinirSenha(input.token, input.novaSenha, userAgent, ctx.req.ip));
  }),

  /** Edita o próprio perfil (nome). */
  updateProfile: protectedProcedure
    .input(updateProfileSchema)
    .mutation(({ ctx, input }) => updateProfile(ctx.user.id, input.nome)),

  /** Remove a própria foto de perfil. */
  removerAvatar: protectedProcedure.mutation(({ ctx }) => removerAvatar(ctx.user.id)),

  /** Troca a própria senha (mantém a sessão atual, revoga as demais). */
  changePassword: protectedProcedure
    .input(changePasswordSchema)
    .mutation(({ ctx, input }) => {
      const raw = ctx.req.cookies[SESSION_COOKIE];
      const unsigned = raw ? ctx.req.unsignCookie(raw) : null;
      const currentSid = unsigned?.valid ? unsigned.value ?? undefined : undefined;
      return changePassword(ctx.user.id, input.senhaAtual, input.novaSenha, currentSid);
    }),
});
