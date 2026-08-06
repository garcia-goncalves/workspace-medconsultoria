import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { LoginInput, SessionUser } from "@app/shared";
import { hashPassword, verifyPassword, precisaRehash } from "../../lib/password.js";
import { createSession } from "../../lib/session.js";
import { consumirToken, inspecionarToken, criarToken } from "../../lib/tokens.js";
import { removerArquivo } from "../../lib/storage.js";
import { enviarEmailTemplate } from "../emails/enviados.service.js";
import { avancarLeadPorClienteAuto } from "../leads/leads.service.js";
import { config } from "../../config.js";

/** Link de redefinição de senha válido por 1 hora. */
const RESET_TTL_MS = 60 * 60 * 1000;

/** Projeta o usuário do banco para a forma pública exposta ao front. */
function toSessionUser(u: {
  id: string;
  nome: string;
  email: string;
  role: SessionUser["role"];
  avatarUrl: string | null;
  clienteId: string | null;
  senhaTrocadaEm: Date | null;
}): SessionUser {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    role: u.role,
    senhaTrocadaEm: u.senhaTrocadaEm,
    avatarUrl: u.avatarUrl,
    clienteId: u.clienteId,
  };
}

const CREDENCIAIS_INVALIDAS = new TRPCError({
  code: "UNAUTHORIZED",
  message: "E-mail ou senha incorretos",
});

const MUITAS_TENTATIVAS = new TRPCError({
  code: "TOO_MANY_REQUESTS",
  message: "Muitas tentativas de login. Aguarde alguns minutos e tente novamente.",
});

// Throttle de brute-force por (IP + e-mail), em memória (app de 1 processo — ADR-2).
const MAX_TENTATIVAS = 8;
const JANELA_MS = 15 * 60 * 1000;
const tentativas = new Map<string, { count: number; ate: number }>();

function chaveLogin(ip: string | undefined, email: string): string {
  return `${ip ?? "?"}:${email.trim().toLowerCase()}`;
}
function loginBloqueado(chave: string): boolean {
  const reg = tentativas.get(chave);
  if (!reg) return false;
  if (Date.now() >= reg.ate) {
    tentativas.delete(chave);
    return false;
  }
  return reg.count >= MAX_TENTATIVAS;
}
function registrarFalha(chave: string): void {
  const agora = Date.now();
  const reg = tentativas.get(chave);
  if (!reg || agora >= reg.ate) tentativas.set(chave, { count: 1, ate: agora + JANELA_MS });
  else reg.count += 1;
}

/**
 * Registra uma tentativa de login que FALHOU, para diagnóstico.
 *
 * Sem isto, "não consigo entrar" é indepurável: a API responde 200 nos testes, mas o navegador
 * da pessoa pode estar enviando outro e-mail (autofill) ou outra senha (gerenciador guardou a de
 * outra conta) — e não havia nenhum registro do que chegou de fato.
 *
 * NUNCA grava a senha. Só e-mail tentado, motivo e navegador. Fica visível ao ROOT em
 * Sistema → Atividade. Best-effort: um erro aqui não pode impedir o fluxo de login.
 */
async function registrarTentativaFalha(email: string, motivo: string, userAgent?: string) {
  try {
    await prisma.activityLog.create({
      data: {
        acao: "login.falhou",
        entidadeTipo: "auth",
        dados: { email, motivo, navegador: userAgent?.slice(0, 160) ?? null },
      },
    });
  } catch {
    /* diagnóstico não pode quebrar o login */
  }
}

/** Idem, para o caso em que o NAVEGADOR barrou antes de enviar (validação do formulário). */
export async function registrarBloqueioCliente(email: string, motivo: string, userAgent?: string) {
  try {
    await prisma.activityLog.create({
      data: {
        acao: "login.bloqueado_no_navegador",
        entidadeTipo: "auth",
        dados: { email, motivo, navegador: userAgent?.slice(0, 160) ?? null },
      },
    });
  } catch {
    /* diagnóstico não pode quebrar nada */
  }
}

/** Autentica por e-mail/senha, cria sessão e retorna o usuário público. */
export async function login(
  input: LoginInput,
  userAgent?: string,
  ip?: string,
): Promise<{ sid: string; user: SessionUser }> {
  const chave = chaveLogin(ip, input.email);
  if (loginBloqueado(chave)) throw MUITAS_TENTATIVAS;

  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Sem passwordHash = convite ainda não aceito → não pode logar.
  if (!user || !user.ativo || user.deletedAt || !user.passwordHash) {
    registrarFalha(chave);
    await registrarTentativaFalha(
      input.email,
      !user ? "conta inexistente" : !user.ativo ? "conta inativa" : user.deletedAt ? "conta removida" : "convite não aceito (sem senha)",
      userAgent,
    );
    throw CREDENCIAIS_INVALIDAS;
  }

  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    registrarFalha(chave);
    await registrarTentativaFalha(input.email, "senha não confere", userAgent);
    throw CREDENCIAIS_INVALIDAS;
  }

  tentativas.delete(chave); // sucesso zera o contador

  // Rehash transparente: se a senha estava em algoritmo legado (ex.: bcrypt do Plano B) e o
  // Argon2 está disponível, reescreve o hash para Argon2id no login — sem forçar reset. Ver #3.
  if (await precisaRehash(user.passwordHash)) {
    const novo = await hashPassword(input.password);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: novo } }).catch(() => {});
  }

  const sid = await createSession(user.id, userAgent, ip);
  await prisma.activityLog.create({ data: { userId: user.id, acao: "login" } });

  return { sid, user: toSessionUser(user) };
}

/** Atualiza o próprio nome; devolve o usuário público atualizado. */
export async function updateProfile(userId: string, nome: string): Promise<SessionUser> {
  const user = await prisma.user.update({ where: { id: userId }, data: { nome: nome.trim() } });
  return toSessionUser(user);
}

/** Remove a foto de perfil (apaga o arquivo e limpa avatarUrl). */
export async function removerAvatar(userId: string): Promise<SessionUser> {
  const atual = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
  if (atual?.avatarUrl) await removerArquivo(atual.avatarUrl);
  const user = await prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } });
  return toSessionUser(user);
}

/**
 * Troca a própria senha após validar a atual e **revoga as demais sessões**
 * (mantém apenas a sessão atual) — trocar a senha por suspeita de invasão deve
 * expulsar qualquer sessão roubada.
 */
export async function changePassword(
  userId: string,
  senhaAtual: string,
  novaSenha: string,
  currentSid?: string,
): Promise<{ ok: true }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.passwordHash) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Conta sem senha definida." });
  }
  const ok = await verifyPassword(user.passwordHash, senhaAtual);
  if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "A senha atual está incorreta." });
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(novaSenha), senhaTrocadaEm: new Date() },
  });
  await prisma.session.deleteMany({
    where: { userId, ...(currentSid ? { NOT: { id: currentSid } } : {}) },
  });
  return { ok: true };
}

/** Verifica o token de convite para a tela de definir senha (sem consumir). */
export async function validarConvite(
  token: string,
): Promise<{ valido: boolean; nome?: string; email?: string }> {
  const info = await inspecionarToken(token, "CONVITE");
  return info ? { valido: true, nome: info.nome, email: info.email } : { valido: false };
}

/**
 * Aceita o convite: valida o token, define a senha, ativa a conta e já cria a
 * sessão (a pessoa entra direto). Token é de uso único.
 */
export async function aceitarConvite(
  token: string,
  novaSenha: string,
  userAgent?: string,
  ip?: string,
): Promise<{ sid: string; user: SessionUser }> {
  const userId = await consumirToken(token, "CONVITE");
  if (!userId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Convite inválido ou expirado." });
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(novaSenha), ativo: true, senhaTrocadaEm: new Date() },
  });
  const sid = await createSession(user.id, userAgent, ip);
  await prisma.activityLog.create({ data: { userId: user.id, acao: "convite_aceito" } });
  void enviarBoasVindas(user.nome, user.email).catch(() => {});
  // Automação do funil: o prospect ativou o acesso e entrou no Portal (sinal de
  // engajamento) → avança o lead para "qualificação" (nunca pula direto p/ proposta).
  if (user.role === "CLIENTE" && user.clienteId) {
    void avancarLeadPorClienteAuto(user.clienteId, "qualificacao", "Lead ativou o acesso ao Portal").catch(() => {});
  }
  return { sid, user: toSessionUser(user) };
}

/** E-mail de boas-vindas (transacional, sempre enviado) após ativar o acesso. */
async function enviarBoasVindas(nome: string, email: string): Promise<void> {
  await enviarEmailTemplate("boas_vindas", email, { nome, link: config.WEB_ORIGIN });
}

/**
 * Freio do "esqueci minha senha", por E-MAIL (não por IP).
 *
 * O `login` já tinha throttle; o reset não tinha nada além do rate-limit global por IP
 * (300/min), e quem sofre aqui não é quem pede: é o DONO da caixa. Sem isto, qualquer
 * pessoa da internet dispara centenas de e-mails de redefinição para a caixa da Thaís,
 * inutiliza a caixa e queima a reputação do nosso SMTP — o mesmo que manda proposta e
 * contrato para cliente. Por IP não adianta: trocar de IP é trivial, e o alvo é a caixa.
 *
 * Contar por e-mail (inclusive de conta que não existe) mantém a anti-enumeração: a
 * resposta é `{ ok: true }` em todos os casos, e o silêncio ao estourar o teto é igual
 * ao silêncio de um e-mail desconhecido.
 *
 * Pura de propósito, para ser testável sem banco nem SMTP.
 */
const RESET_MAX = 3;
const RESET_JANELA_MS = 60 * 60 * 1000;
const resetPedidos = new Map<string, { count: number; ate: number }>();

export function podeEnviarReset(email: string, agora = Date.now()): boolean {
  const chave = email.trim().toLowerCase();
  const reg = resetPedidos.get(chave);
  if (!reg || agora >= reg.ate) {
    resetPedidos.set(chave, { count: 1, ate: agora + RESET_JANELA_MS });
    return true;
  }
  reg.count += 1;
  return reg.count <= RESET_MAX;
}

/** Só para teste: zera o freio entre casos. */
export function _limparFreioReset(): void {
  resetPedidos.clear();
}

/**
 * Solicita redefinição de senha. SEMPRE responde ok (não revela se o e-mail
 * existe — anti-enumeração). Se existir uma conta ativa com senha, envia o link.
 */
export async function solicitarReset(email: string): Promise<{ ok: true }> {
  if (!podeEnviarReset(email)) return { ok: true };
  const user = await prisma.user.findFirst({
    where: { email: email.trim().toLowerCase(), ativo: true, deletedAt: null, passwordHash: { not: null } },
    select: { id: true, nome: true, email: true },
  });
  if (user) {
    const token = await criarToken(user.id, "RESET", RESET_TTL_MS);
    const url = `${config.WEB_ORIGIN}/redefinir-senha?token=${token}`;
    const { enviado } = await enviarEmailTemplate("reset_senha", user.email, { nome: user.nome, link: url });
    // Em modo dev (não enviado) o link nunca vai ao navegador do solicitante
    // (endpoint anônimo) — vai só para o log do servidor, para testes.
    if (!enviado) console.info(`[reset:dev] link para ${user.email}: ${url}`);
  }
  return { ok: true };
}

/** Verifica um token de RESET (para a tela de redefinir senha). */
export async function validarReset(
  token: string,
): Promise<{ valido: boolean; nome?: string; email?: string }> {
  const info = await inspecionarToken(token, "RESET");
  return info ? { valido: true, nome: info.nome, email: info.email } : { valido: false };
}

/**
 * Redefine a senha a partir do token: **revoga todas as sessões** (segurança) e
 * já cria uma nova sessão para a pessoa entrar. Token é de uso único.
 */
export async function redefinirSenha(
  token: string,
  novaSenha: string,
  userAgent?: string,
  ip?: string,
): Promise<{ sid: string; user: SessionUser }> {
  const userId = await consumirToken(token, "RESET");
  if (!userId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Link inválido ou expirado." });
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(novaSenha), ativo: true, senhaTrocadaEm: new Date() },
  });
  await prisma.session.deleteMany({ where: { userId } }); // derruba sessões antigas
  const sid = await createSession(user.id, userAgent, ip);
  await prisma.activityLog.create({ data: { userId: user.id, acao: "senha_redefinida" } });
  return { sid, user: toSessionUser(user) };
}
