import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { LoginInput, SessionUser } from "@app/shared";
import { hashPassword, verifyPassword, precisaRehash } from "../../lib/password.js";
import { createSession } from "../../lib/session.js";
import { consumirToken, inspecionarToken, criarToken } from "../../lib/tokens.js";
import { removerArquivo } from "../../lib/storage.js";
import { enviarEmailTemplate } from "../emails/enviados.service.js";
import { templateDeBoasVindas } from "../emails/boas-vindas-por-publico.js";
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

/**
 * O SEGUNDO FREIO, E ELE É POR IP SOZINHO — sem o e-mail na chave.
 *
 * ⚠️ O freio de cima é `(ip, e-mail)`, e **quem escolhe o e-mail é quem ataca**: basta variar o
 * endereço a cada tentativa para ele nunca engatar. Isso já era ruim; virou perigoso quando o
 * caminho da conta inexistente passou a conferir a senha contra um hash de descarte (a defesa
 * contra enumeração por tempo, logo abaixo). Sem este freio, **cada e-mail inventado passou a
 * custar um argon2id completo** — 19 MiB e duas passadas, na threadpool de 4 do Node.
 *
 * E o cliente fala por LOTE: uma requisição HTTP carrega centenas de chamadas, e o rate-limit
 * global conta requisições, não chamadas. Um anônimo pedia dezenas de milhares de verificações
 * por minuto, com e-mails sempre novos — a fila da threadpool é a mesma que lê arquivo e serve
 * avatar, então o processo inteiro (API + site + tempo real, tudo num Node só) parava de
 * responder. A defesa contra vazar informação teria virado o jeito mais barato de derrubar o
 * sistema.
 *
 * 60 tentativas por IP em 15 minutos é largo para gente (o teto por e-mail continua sendo 8) e
 * estreito para robô. Recusa ANTES de queimar tempo — é esse "antes" que faz o freio valer.
 */
const MAX_POR_IP = 60;
const tentativasPorIp = new Map<string, { count: number; ate: number }>();

function loginBloqueadoPorIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const reg = tentativasPorIp.get(ip);
  if (!reg) return false;
  if (Date.now() >= reg.ate) {
    tentativasPorIp.delete(ip);
    return false;
  }
  return reg.count >= MAX_POR_IP;
}

function registrarFalhaPorIp(ip: string | undefined): void {
  if (!ip) return;
  const agora = Date.now();
  const reg = tentativasPorIp.get(ip);
  // ⚠️ Apaga a entrada vencida em vez de só sobrescrever: sem isso o mapa guarda para sempre
  // todo IP que já errou uma senha, e cunhar IPs é barato para quem ataca.
  if (!reg || agora >= reg.ate) tentativasPorIp.set(ip, { count: 1, ate: agora + JANELA_MS });
  else reg.count += 1;
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

/**
 * FREIO PRÓPRIO DESTA ROTA — o rate-limit global não segura sozinho.
 *
 * `registrarBloqueioNoNavegador` é pública, anônima, e cada chamada GRAVA uma linha no
 * `ActivityLog` com texto escolhido por quem chama. O teto global é de 300 requisições HTTP por
 * minuto e por IP — mas o cliente fala por LOTE (`httpBatchLink`), então uma requisição carrega
 * dezenas de chamadas: o teto real de gravações era ordens de grandeza maior do que parecia.
 *
 * O estrago não é derrubar o servidor, é APAGAR O RASTRO: `SISTEMA → Atividade` mostra as 60
 * linhas mais recentes, e é onde a casa responde "quem viu o quê" (quem entrou no painel do
 * cliente, quem removeu arquivo, quem assinou). Enchendo a tabela, tudo isso sai da tela.
 *
 * 60 por hora e por IP é largo para o diagnóstico (é gente errando a senha, não um robô) e
 * estreito para o abuso. Mesmo molde do freio do formulário público em `leads.service.ts`.
 */
const BLOQUEIO_MAX_POR_HORA = 60;
const BLOQUEIO_JANELA_MS = 60 * 60 * 1000;
const bloqueiosPorIp = new Map<string, { count: number; ate: number }>();

function diagnosticoBloqueado(ip: string): boolean {
  const reg = bloqueiosPorIp.get(ip);
  const agora = Date.now();
  if (!reg || agora >= reg.ate) {
    bloqueiosPorIp.set(ip, { count: 1, ate: agora + BLOQUEIO_JANELA_MS });
    return false;
  }
  reg.count += 1;
  return reg.count > BLOQUEIO_MAX_POR_HORA;
}

/** Idem, para o caso em que o NAVEGADOR barrou antes de enviar (validação do formulário). */
export async function registrarBloqueioCliente(email: string, motivo: string, userAgent?: string, ip?: string) {
  // Silencioso de propósito: isto é diagnóstico, não uma resposta que alguém espera. Devolver
  // erro ensinaria o teto a quem está testando o teto.
  if (ip && diagnosticoBloqueado(ip)) return;
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

/**
 * O HASH CONTRA O QUAL SE QUEIMA TEMPO quando a conta não existe.
 *
 * É o hash argon2id de um valor aleatório sorteado no primeiro uso: ninguém sabe a senha dele,
 * nenhuma senha real bate com ele, e ele não abre nada. Serve só para que conferir a senha de
 * uma conta INEXISTENTE custe o mesmo que conferir a de uma conta que existe.
 *
 * Sorteado em memória, e não escrito no código, porque valor fixo em repositório é a coisa que
 * um dia alguém copia achando que é senha de exemplo.
 */
let hashDeDescarte: Promise<string> | null = null;
function hashParaQueimarTempo(): Promise<string> {
  // ⚠️ `??=` guardaria a promessa REJEITADA para sempre: se o argon2 não carregasse na primeira
  // vez, todo login com e-mail desconhecido passaria a responder erro interno em vez de
  // "e-mail ou senha incorretos" — e encheria SISTEMA → Erros (a lição da ADR-135). Por isso
  // o descarte no `catch`: a próxima chamada tenta de novo.
  hashDeDescarte ??= hashPassword(randomBytes(32).toString("hex")).catch((e) => {
    hashDeDescarte = null;
    throw e;
  });
  return hashDeDescarte;
}

/**
 * Queima o mesmo tempo que custaria conferir a senha de uma conta que existe.
 *
 * Nada aqui pode derrubar o login: se o hash de descarte falhar, o caminho continua devolvendo
 * "e-mail ou senha incorretos" — perder a defesa de tempo é muito menos grave que transformar
 * uma tentativa comum em erro interno.
 */
async function queimarTempoDeSenha(senha: string): Promise<void> {
  try {
    await verifyPassword(await hashParaQueimarTempo(), senha);
  } catch {
    /* defesa de tempo é best-effort */
  }
}

/** Aquece o hash de descarte no boot: gerá-lo na 1ª tentativa faria justamente ela destoar. */
export function aquecerDefesaDeTempo(): void {
  void hashParaQueimarTempo().catch(() => {});
}

/** Autentica por e-mail/senha, cria sessão e retorna o usuário público. */
export async function login(
  input: LoginInput,
  userAgent?: string,
  ip?: string,
): Promise<{ sid: string; user: SessionUser }> {
  const chave = chaveLogin(ip, input.email);
  // Os dois freios, nesta ordem: o do par (ip, e-mail) protege UMA conta; o de IP protege o
  // servidor de quem varia o e-mail justamente para escapar do primeiro.
  if (loginBloqueado(chave) || loginBloqueadoPorIp(ip)) throw MUITAS_TENTATIVAS;

  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Sem passwordHash = convite ainda não aceito → não pode logar.
  if (!user || !user.ativo || user.deletedAt || !user.passwordHash) {
    // ⚠️ QUEIMA O MESMO TEMPO DE QUEM EXISTE — senão o relógio conta o que a mensagem cala.
    //
    // A mensagem de erro é a mesma para conta que existe e conta que não existe, de propósito.
    // Mas conferir argon2id custa dezenas a centenas de milissegundos e sair sem conferir custa
    // ~5 ms: bastava cronometrar UMA tentativa por endereço para descobrir quem tem acesso ao
    // sistema — sem sequer gastar as 8 tentativas do freio. Isso derrubava, pela segunda porta,
    // a garantia que `solicitarReset` foi escrito para dar (lá a resposta é igual justamente
    // para não confirmar endereço).
    await queimarTempoDeSenha(input.password);
    registrarFalha(chave);
    registrarFalhaPorIp(ip);
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
    registrarFalhaPorIp(ip);
    await registrarTentativaFalha(input.email, "senha não confere", userAgent);
    throw CREDENCIAIS_INVALIDAS;
  }

  tentativas.delete(chave); // sucesso zera o contador

  // AS QUATRO ESCRITAS DO LOGIN BEM-SUCEDIDO NÃO DEPENDEM UMA DA OUTRA — nenhuma lê o
  // resultado de outra (nem `createSession` precisa do rehash, nem o registro de acesso
  // precisa do `sid`). Rodá-las em paralelo, em vez de em série, corta a latência do login sem
  // mudar o resultado observável:
  //  - o rehash e a marcação de `ultimoAcessoEm` já eram best-effort (`.catch(() => {})`) —
  //    continuam engolindo a própria falha, então NUNCA derrubam o `Promise.all` nem o login;
  //  - `createSession` e o registro em `activityLog` continuam SEM catch, exatamente como
  //    antes — se algum dos dois falhar, o login falha junto, igual ao comportamento de hoje.

  // Rehash transparente: se a senha estava em algoritmo legado (ex.: bcrypt do Plano B) e o
  // Argon2 está disponível, reescreve o hash para Argon2id no login — sem forçar reset. Ver #3.
  const rehash = precisaRehash(user.passwordHash)
    .then((precisa) =>
      precisa
        ? hashPassword(input.password).then((novo) =>
            prisma.user.update({ where: { id: user.id }, data: { passwordHash: novo } }),
          )
        : undefined,
    )
    .catch(() => {});

  // ÚLTIMO ACESSO (ADR-128): marcado só aqui, no login com senha. É o que o card do lead/cliente
  // mostra para a Thaís saber se o cliente apareceu depois do convite. Sessão de suporte da
  // equipe NÃO passa por aqui, de propósito — nós entrarmos no painel dele não é ele vindo.
  const ultimoAcesso = prisma.user
    .update({ where: { id: user.id }, data: { ultimoAcessoEm: new Date() } })
    .catch(() => {});

  const [sid] = await Promise.all([
    createSession(user.id, { userAgent, ip }),
    prisma.activityLog.create({ data: { userId: user.id, acao: "login" } }),
    rehash,
    ultimoAcesso,
  ]);

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
 * ACESSO REVOGADO NÃO VOLTA POR UM LINK ANTIGO.
 *
 * `aceitarConvite` e `redefinirSenha` gravam `ativo: true` — é o certo para o caminho normal.
 * Mas quem teve o acesso revogado depois de receber o link (convite vale 72h, reset 1h) ficava
 * a um clique de reabrir a própria conta, e a tela continuava mostrando "REVOGADO" enquanto a
 * pessoa navegava. O token agora é apagado na revogação; esta é a segunda tranca, para o caso
 * de a revogação ter vindo por um caminho que esqueça de apagar.
 */
async function recusarSeAcessoRevogado(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { acessoRevogadoEm: true },
  });
  if (u?.acessoRevogadoEm) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Este acesso foi encerrado. Fale com quem administra a conta para receber um novo convite.",
    });
  }
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
  await recusarSeAcessoRevogado(userId);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(novaSenha), ativo: true, senhaTrocadaEm: new Date() },
  });
  const sid = await createSession(user.id, { userAgent, ip });
  // Definir a senha pelo convite JÁ é entrar: o cliente atravessou a porta neste instante.
  await prisma.user.update({ where: { id: user.id }, data: { ultimoAcessoEm: new Date() } }).catch(() => {});
  await prisma.activityLog.create({ data: { userId: user.id, acao: "convite_aceito" } });
  void enviarBoasVindas(user.nome, user.email, user.role).catch(() => {});
  // Automação do funil: o prospect ativou o acesso e entrou no Portal (sinal de
  // engajamento) → avança o lead para "qualificação" (nunca pula direto p/ proposta).
  if (user.role === "CLIENTE" && user.clienteId) {
    void avancarLeadPorClienteAuto(user.clienteId, "qualificacao", "Lead ativou o acesso ao Portal").catch(() => {});
  }
  return { sid, user: toSessionUser(user) };
}

/**
 * E-mail de boas-vindas (transacional, sempre enviado) após ativar o acesso.
 *
 * O texto MUDA conforme o papel: o cliente do Portal também é `User` e chega aqui pelo mesmo
 * caminho — antes desta escolha ele recebia o e-mail escrito para a equipe, com o nome do sistema
 * interno e um botão para ele. O link continua sendo o mesmo endereço: quem é CLIENTE cai no
 * Portal ao entrar, e quem é da casa cai no Workspace.
 */
async function enviarBoasVindas(nome: string, email: string, papel: string | null): Promise<void> {
  await enviarEmailTemplate(templateDeBoasVindas(papel), email, { nome, link: config.WEB_ORIGIN });
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
  await recusarSeAcessoRevogado(userId);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(novaSenha), ativo: true, senhaTrocadaEm: new Date() },
  });
  await prisma.session.deleteMany({ where: { userId } }); // derruba sessões antigas
  const sid = await createSession(user.id, { userAgent, ip });
  await prisma.user.update({ where: { id: user.id }, data: { ultimoAcessoEm: new Date() } }).catch(() => {});
  await prisma.activityLog.create({ data: { userId: user.id, acao: "senha_redefinida" } });
  return { sid, user: toSessionUser(user) };
}
