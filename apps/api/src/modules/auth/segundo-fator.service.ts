import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { segundoFatorRecomendadoPara, type SessionUser } from "@app/shared";
import { config, isSegundoFatorEnabled } from "../../config.js";
import { cifrarCom, decifrarCom, lerChave, subchave } from "../../lib/cripto.js";
import { verifyPassword } from "../../lib/password.js";
import { base32Codificar, conferirCodigoTotp, gerarSegredoTotp, uriOtpauth } from "../../lib/totp.js";

/**
 * VERIFICAÇÃO EM DUAS ETAPAS (TOTP) — onda 4C.
 *
 * O problema que isto resolve: uma senha de ADMIN/ROOT roubada (phishing, gerenciador vazado,
 * reuso de senha de outro site) dava acesso total por 30 dias, que é a vida do cookie. Com o 2FA
 * ativo, a senha certa sozinha não abre sessão: o login devolve um DESAFIO de 5 minutos, e a
 * sessão só nasce com o código do aplicativo autenticador (ou um código de recuperação).
 *
 * O que NÃO passa por aqui, de propósito:
 *  - a SESSÃO DE SUPORTE (ADR-128): ela nasce de uma sessão da equipe que já passou pelo login
 *    (e pelo 2FA, se ativo) — pedir código de novo não protegeria nada;
 *  - a API DO AGENTE (ADR-149): tem credencial própria (segredo do serviço + delegação), que não
 *    é senha de gente e não vive em cookie.
 */

// ─── Cifra do segredo ────────────────────────────────────────────────────────

const FALTA_CHAVE =
  "TOTP_CRYPTO_KEY não configurada — a verificação em duas etapas não pode ser ativada neste servidor.";

function chaveDoSegredo(): Buffer {
  return subchave(lerChave(config.TOTP_CRYPTO_KEY, "TOTP_CRYPTO_KEY", FALTA_CHAVE), "auth:totp:segredo");
}

function cifrarSegredo(segredo: Buffer): string {
  return cifrarCom(chaveDoSegredo(), segredo.toString("base64"));
}

/** `null` quando a chave falta ou foi trocada — quem chama trata como "o TOTP não confere". */
function decifrarSegredo(guardado: string): Buffer | null {
  try {
    const b64 = decifrarCom(chaveDoSegredo(), guardado, {
      formato: "Segredo TOTP em formato desconhecido.",
      ilegivel: "Segredo TOTP ilegível (TOTP_CRYPTO_KEY trocada?).",
    });
    return Buffer.from(b64, "base64");
  } catch {
    // ⚠️ Sem chave (ou com chave trocada) o TOTP não confere — mas NÃO derruba o login com erro
    // interno: o código de recuperação continua abrindo a porta, e é para isso que ele existe.
    return null;
  }
}

// ─── Códigos de recuperação ─────────────────────────────────────────────────

const QUANTOS_CODIGOS = 10;

/**
 * Normaliza o que a pessoa digita: tira hífen e espaço, passa a maiúscula. Assim
 * `abcd-efgh-...` colado de um bloco de notas confere igual ao `ABCD-EFGH-...` mostrado.
 */
function normalizarCodigoDeRecuperacao(codigo: string): string {
  return codigo.toUpperCase().replace(/[\s-]/g, "");
}

/**
 * SHA-256, e não argon2 — de propósito. O código tem 80 bits SORTEADOS por nós (10 bytes), não é
 * senha escolhida por gente: não há dicionário a atacar, e 2^80 não se tabela. argon2 aqui
 * custaria uma verificação cara por código guardado a cada tentativa, num caminho anônimo — a
 * lição da ADR-148, em que argon2 num caminho anônimo virou o jeito mais barato de derrubar o
 * processo.
 */
function hashCodigoDeRecuperacao(codigo: string): string {
  return createHash("sha256").update(normalizarCodigoDeRecuperacao(codigo)).digest("hex");
}

/** `XXXX-XXXX-XXXX-XXXX` em Base32 (o alfabeto já não tem 0/1/8/9, que se confundem com O/I/B). */
function gerarCodigoDeRecuperacao(): string {
  const b32 = base32Codificar(randomBytes(10)); // 10 bytes = 16 caracteres Base32 exatos
  return b32.match(/.{4}/g)!.join("-");
}

// ─── Freios (em memória, processo único — ADR-2) ────────────────────────────

/**
 * Seis dígitos são só um milhão de combinações, e a janela de ±1 passo aceita três delas a cada
 * instante: sem freio, um robô com o desafio (ou seja, com a SENHA) acerta em horas. Por isso
 * dois freios, no molde dos do login (ADR-148):
 *  - por PESSOA: 5 erros em 15 min. É o que protege a conta — e não depende de quem ataca;
 *  - por IP: 30 em 15 min. É o que protege o servidor de quem varre várias contas.
 * Recusa ANTES de conferir, e o acerto zera o contador da pessoa.
 *
 * ⚠️ A TENTATIVA É COBRADA NA ENTRADA, não no erro — achado da revisão de segurança. Conferir só
 * depois de duas idas ao banco deixava TODAS as chamadas simultâneas passarem pelo freio antes de
 * a primeira registrar o erro; e o cliente fala por LOTE (dezenas de chamadas numa requisição),
 * então uma rajada virava dezenas de milhares de palpites. `reservarTentativa` confere e soma no
 * MESMO trecho síncrono (sem `await` no meio, o Node não intercala outra chamada), e o acerto
 * devolve a tentativa. Assim o teto vale inclusive para quem manda tudo ao mesmo tempo.
 *
 * ⚠️ UMA RESERVA POR OPERAÇÃO, e só o SEGUNDO FATOR CERTO zera a pessoa (achado M1 da revisão da
 * onda 4). `desativar` cobrava a tentativa, a SENHA CERTA a "devolvia" APAGANDO o contador inteiro
 * da pessoa, e o código cobrava +1 — o contador nunca passava de 1 e sobrava só o teto por IP: com
 * vários IPs, quem tem a senha e uma sessão aberta voltava a poder varrer o TOTP daquela conta, e o
 * mesmo `delete` zerava os erros da 2ª etapa do login. Senha certa não prova nada sobre o código;
 * só o código certo (ou o par senha + código certo) pode zerar.
 */
const JANELA_MS = 15 * 60 * 1000;
const MAX_POR_PESSOA = 5;
const MAX_POR_IP = 30;
const errosPorPessoa = new Map<string, { count: number; ate: number }>();
const errosPorIp = new Map<string, { count: number; ate: number }>();

function estourou(mapa: Map<string, { count: number; ate: number }>, chave: string, max: number): boolean {
  const reg = mapa.get(chave);
  if (!reg) return false;
  if (Date.now() >= reg.ate) {
    mapa.delete(chave);
    return false;
  }
  return reg.count >= max;
}

function contarErro(mapa: Map<string, { count: number; ate: number }>, chave: string): void {
  const agora = Date.now();
  const reg = mapa.get(chave);
  // Apaga a entrada vencida em vez de só somar: o mesmo cuidado dos freios do login.
  if (!reg || agora >= reg.ate) mapa.set(chave, { count: 1, ate: agora + JANELA_MS });
  else reg.count += 1;
}

/** Confere o freio e JÁ cobra a tentativa, sem `await` entre as duas coisas. */
function reservarTentativa(userId: string, ip: string | undefined): void {
  if (estourou(errosPorPessoa, userId, MAX_POR_PESSOA) || (!!ip && estourou(errosPorIp, ip, MAX_POR_IP))) {
    throw MUITAS_TENTATIVAS();
  }
  contarErro(errosPorPessoa, userId);
  if (ip) contarErro(errosPorIp, ip);
}

/**
 * O SEGUNDO FATOR conferiu: a conta da pessoa zera e a tentativa cobrada do IP é devolvida.
 * ⚠️ Nunca chame isto por ter acertado só a SENHA (ver o M1 acima).
 */
function registrarAcerto(userId: string, ip: string | undefined): void {
  errosPorPessoa.delete(userId);
  const reg = ip ? errosPorIp.get(ip) : undefined;
  if (reg && reg.count > 0) reg.count -= 1;
}

/** Só para teste: zera os freios (e as marcas de aviso) entre casos. */
export function _limparFreiosSegundoFator(): void {
  errosPorPessoa.clear();
  errosPorIp.clear();
  freioRegistradoAte.clear();
  ultimoAvisoAoDono.clear();
}

// ─── Rastro e aviso ao dono (achado B1 da revisão da onda 4) ────────────────
//
// Só chega a digitar código quem ACERTOU a senha (o desafio do login, ou a sessão aberta mais a
// senha, no desativar). Código errado ali é a prova de que a senha está com alguém — e o dono da
// conta não ficava sabendo: o freio segurava calado. Agora fica rastro (`seguranca.*`, que o
// expurgo preserva) e o dono recebe aviso (sininho + e-mail) no máximo UMA vez por hora.
//
// ⚠️ O rastro NUNCA grava o código digitado: um código errado é um palpite, e palpite guardado é
// insumo para o próximo.

const AVISO_AO_DONO_A_CADA_MS = 60 * 60 * 1000;
/** Até quando o freio desta pessoa já está registrado — um registro por janela, não um por recusa. */
const freioRegistradoAte = new Map<string, number>();
const ultimoAvisoAoDono = new Map<string, number>();

type OrigemDoCodigo = "login" | "desativar";

/** Rastro e aviso nunca derrubam a resposta: o erro que importa é o do código. */
async function registrarCodigoErrado(userId: string, ip: string | undefined, origem: OrigemDoCodigo): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: { userId, acao: "seguranca.2fa_codigo_errado", dados: { origem, ip: ip ?? null } },
    });
    await avisarDonoDaConta(userId, ip);
  } catch {
    /* best-effort — ver acima */
  }
}

async function registrarFreio(userId: string, ip: string | undefined, origem: OrigemDoCodigo): Promise<void> {
  const agora = Date.now();
  if ((freioRegistradoAte.get(userId) ?? 0) > agora) return;
  freioRegistradoAte.set(userId, agora + JANELA_MS);
  try {
    await prisma.activityLog.create({ data: { userId, acao: "seguranca.2fa_freio", dados: { origem, ip: ip ?? null } } });
    await avisarDonoDaConta(userId, ip);
  } catch {
    /* best-effort */
  }
}

async function avisarDonoDaConta(userId: string, ip: string | undefined): Promise<void> {
  const agora = Date.now();
  // Marca ANTES do `await`: duas recusas simultâneas não mandam dois avisos.
  if (agora - (ultimoAvisoAoDono.get(userId) ?? 0) < AVISO_AO_DONO_A_CADA_MS) return;
  ultimoAvisoAoDono.set(userId, agora);
  const quando = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(agora));
  const { notificar } = await import("../notificacoes/notificacoes.service.js");
  await notificar(
    userId,
    "seguranca_2fa_codigo_errado",
    { quando, ip: ip ?? "desconhecido" },
    { entidadeTipo: "seguranca", entidadeId: userId },
  );
}

/** `reservarTentativa` que, ao recusar, deixa o rastro do freio. */
function reservarOuRegistrarFreio(userId: string, ip: string | undefined, origem: OrigemDoCodigo): void {
  try {
    reservarTentativa(userId, ip);
  } catch (e) {
    void registrarFreio(userId, ip, origem);
    throw e;
  }
}

const MUITAS_TENTATIVAS = () =>
  new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: "Muitas tentativas de código. Aguarde alguns minutos e tente novamente.",
  });

/** Mensagem ÚNICA para código errado, antigo, reusado ou inexistente — não ensina nada. */
const CODIGO_INVALIDO = () => new TRPCError({ code: "UNAUTHORIZED", message: "Código inválido ou expirado." });

// ─── Conferência do código (TOTP ou recuperação) ────────────────────────────

/** 2FA ATIVO = linha com `ativadoEm` preenchido. Ativação começada e não confirmada não conta. */
export async function segundoFatorAtivo(userId: string): Promise<boolean> {
  const sf = await prisma.segundoFator.findUnique({ where: { userId }, select: { ativadoEm: true } });
  return !!sf?.ativadoEm;
}

/**
 * Confere o código de quem tem 2FA ativo. Aceita os 6 dígitos do aplicativo OU um código de
 * recuperação (que é consumido). Devolve por onde entrou; lança erro genérico se não conferir.
 *
 * ⚠️ As duas gravações são CONDICIONAIS e atômicas (`updateMany` com a condição no `where`), no
 * molde da reserva do credenciamento (ADR-148): duas requisições simultâneas com o MESMO código
 * não passam as duas — o anti-replay e o "uso único" valem também contra a corrida.
 */
export async function conferirSegundoFator(
  userId: string,
  codigo: string,
  ip: string | undefined,
  origem: OrigemDoCodigo = "login",
): Promise<"totp" | "recuperacao"> {
  reservarOuRegistrarFreio(userId, ip, origem);
  const via = await conferirCodigoSemFreio(userId, codigo);
  if (!via) {
    await registrarCodigoErrado(userId, ip, origem);
    throw CODIGO_INVALIDO(); // a tentativa já foi cobrada na entrada
  }
  registrarAcerto(userId, ip);
  return via;
}

/**
 * A conferência em si, SEM mexer no freio — quem chama já reservou a tentativa (uma só para a
 * operação inteira). `null` = não conferiu.
 */
async function conferirCodigoSemFreio(userId: string, codigo: string): Promise<"totp" | "recuperacao" | null> {
  const sf = await prisma.segundoFator.findUnique({ where: { userId } });
  if (!sf?.ativadoEm) return null;

  const digitado = codigo.trim();
  let via: "totp" | "recuperacao" | null = null;

  if (/^\d{3}\s?\d{3}$/.test(digitado)) {
    const segredo = decifrarSegredo(sf.segredoCifrado);
    const passo = segredo ? conferirCodigoTotp(segredo, digitado, Date.now(), sf.ultimoPasso) : null;
    if (passo !== null) {
      const r = await prisma.segundoFator.updateMany({
        where: { userId, OR: [{ ultimoPasso: null }, { ultimoPasso: { lt: passo } }] },
        data: { ultimoPasso: passo },
      });
      if (r.count === 1) via = "totp";
    }
  } else {
    const r = await prisma.codigoRecuperacao.updateMany({
      where: { userId, hash: hashCodigoDeRecuperacao(digitado), usadoEm: null },
      data: { usadoEm: new Date() },
    });
    if (r.count === 1) {
      via = "recuperacao";
      const restantes = await prisma.codigoRecuperacao.count({ where: { userId, usadoEm: null } });
      // Rastro, não diagnóstico: usar um código de recuperação é o sinal de "perdi o celular" —
      // ou de alguém que tem os códigos. Nos dois casos o dono da conta precisa poder ver.
      await prisma.activityLog.create({
        data: { userId, acao: "seguranca.2fa_codigo_recuperacao_usado", dados: { restantes } },
      });
    }
  }

  return via;
}

// ─── Desafio do login (a "meia sessão" de 5 minutos) ────────────────────────

const DESAFIO_TTL_MS = 5 * 60 * 1000;

/** HMAC com subchave do SESSION_SECRET — mesmo segredo que assina o cookie, outro propósito. */
function chaveDoDesafio(): Buffer {
  return subchave(Buffer.from(config.SESSION_SECRET, "utf8"), "auth:desafio-2fa");
}

/**
 * O que amarra o desafio à SENHA daquele momento: se a senha for trocada (ou redefinida) nos
 * 5 minutos, o desafio antigo morre. `senhaTrocadaEm` e não o hash, porque o rehash transparente
 * do login (bcrypt → argon2) muda o hash sem mudar a senha — e derrubaria o desafio recém-emitido.
 */
function versaoDaSenha(senhaTrocadaEm: Date | null): string {
  return String(senhaTrocadaEm?.getTime() ?? 0);
}

/**
 * Emite o desafio. Stateless e assinado (HMAC-SHA256), no molde do cursor da API do agente
 * (ADR-149): não precisa de tabela nem de limpeza, e adulterar qualquer campo invalida a
 * assinatura. Ele NÃO dá acesso a nada sozinho — só prova "esta pessoa acertou a senha há menos
 * de 5 minutos"; a sessão continua exigindo o código.
 */
export function emitirDesafio(user: { id: string; senhaTrocadaEm: Date | null }, agoraMs = Date.now()): string {
  const corpo = Buffer.from(
    JSON.stringify({ u: user.id, e: agoraMs + DESAFIO_TTL_MS, v: versaoDaSenha(user.senhaTrocadaEm) }),
  ).toString("base64url");
  const assinatura = createHmac("sha256", chaveDoDesafio()).update(corpo).digest("base64url");
  return `${corpo}.${assinatura}`;
}

/** Lê o desafio. `null` para adulterado, malformado ou vencido — nunca lança. */
export function lerDesafio(desafio: string, agoraMs = Date.now()): { userId: string; versao: string } | null {
  const [corpo, assinatura, sobra] = desafio.split(".");
  if (!corpo || !assinatura || sobra !== undefined) return null;
  const esperada = createHmac("sha256", chaveDoDesafio()).update(corpo).digest();
  const recebida = Buffer.from(assinatura, "base64url");
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  try {
    const d = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as { u?: unknown; e?: unknown; v?: unknown };
    if (typeof d.u !== "string" || typeof d.e !== "number" || typeof d.v !== "string") return null;
    if (agoraMs > d.e) return null;
    return { userId: d.u, versao: d.v };
  } catch {
    return null;
  }
}

/** O desafio ainda corresponde à senha atual da pessoa? */
export function desafioBateComASenha(versao: string, senhaTrocadaEm: Date | null): boolean {
  return versao === versaoDaSenha(senhaTrocadaEm);
}

// ─── Ativar / desativar (tela "Configurações") ──────────────────────────────

export interface StatusSegundoFator {
  /** O servidor tem a chave para guardar o segredo? Sem ela, ativar é impossível. */
  disponivel: boolean;
  ativo: boolean;
  ativadoEm: Date | null;
  codigosRestantes: number;
  /** ADMIN/ROOT — quem a tela convida a ativar (e quem, por ora, PODE ativar). */
  recomendado: boolean;
}

export async function statusSegundoFator(user: SessionUser): Promise<StatusSegundoFator> {
  const sf = await prisma.segundoFator.findUnique({ where: { userId: user.id }, select: { ativadoEm: true } });
  const codigosRestantes = sf?.ativadoEm
    ? await prisma.codigoRecuperacao.count({ where: { userId: user.id, usadoEm: null } })
    : 0;
  return {
    disponivel: isSegundoFatorEnabled,
    ativo: !!sf?.ativadoEm,
    ativadoEm: sf?.ativadoEm ?? null,
    codigosRestantes,
    recomendado: segundoFatorRecomendadoPara(user.role),
  };
}

function recusarSessaoDeSuporte(user: SessionUser): void {
  // Sessão de suporte (ADR-128) pertence ao CLIENTE; ninguém mexe na segurança "em nome de" outro.
  if (user.operador) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Volte ao seu acesso para mexer na sua segurança." });
  }
}

function exigirQuePodeAtivar(user: SessionUser): void {
  recusarSessaoDeSuporte(user);
  if (!segundoFatorRecomendadoPara(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "A verificação em duas etapas é para administradores." });
  }
  if (!isSegundoFatorEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "A verificação em duas etapas ainda não foi configurada neste servidor (falta a TOTP_CRYPTO_KEY).",
    });
  }
}

/**
 * Começa a ativação: sorteia um segredo NOVO e o devolve UMA vez, para o aplicativo.
 *
 * ⚠️ É o único momento em que o segredo sai do servidor. A linha fica com `ativadoEm` nulo até
 * alguém digitar um código que confira — e nesse estado o login NÃO pede código, senão quem
 * abrisse esta tela e desistisse ficaria trancado fora.
 */
export async function iniciarAtivacao(user: SessionUser): Promise<{ chave: string; uri: string }> {
  exigirQuePodeAtivar(user);
  const jaAtiva = new TRPCError({ code: "BAD_REQUEST", message: "A verificação em duas etapas já está ativa." });
  const segredo = gerarSegredoTotp();
  const segredoCifrado = cifrarSegredo(segredo);
  const atual = await prisma.segundoFator.findUnique({ where: { userId: user.id }, select: { ativadoEm: true } });
  if (atual?.ativadoEm) throw jaAtiva;
  if (!atual) {
    try {
      await prisma.segundoFator.create({ data: { userId: user.id, segredoCifrado } });
    } catch {
      // P2002: outra aba criou a linha entre a leitura e aqui. Recomeçar é o caminho seguro.
      throw new TRPCError({ code: "CONFLICT", message: "Comece a ativação de novo." });
    }
  } else {
    // ⚠️ CONDICIONAL, e não `upsert`: um `upsert` cego sobrescreveria um 2FA que acabou de ser
    // ATIVADO em outra aba (entre a leitura e esta linha), zerando `ativadoEm` — ou seja,
    // DESLIGANDO a proteção em silêncio. Com `ativadoEm: null` no filtro, só a ativação
    // pendente é trocada.
    const r = await prisma.segundoFator.updateMany({
      where: { userId: user.id, ativadoEm: null },
      data: { segredoCifrado, ultimoPasso: null },
    });
    if (r.count !== 1) throw jaAtiva;
  }
  const chave = base32Codificar(segredo);
  return { chave, uri: uriOtpauth(chave, user.email) };
}

/**
 * Confirma a ativação com a SENHA e um código do aplicativo, e devolve os 10 códigos de
 * recuperação — a ÚNICA vez que eles existem em claro. Guardamos só o hash.
 *
 * ⚠️ EXIGE A SENHA (achado da revisão de segurança). Sem ela, quem roubasse só o COOKIE de uma
 * sessão de ADMIN (aba esquecida) cadastraria o PRÓPRIO autenticador — e dali em diante o dono
 * da conta digitaria a senha certa e receberia um desafio cujo código só o invasor tem. Nem
 * redefinir a senha o salvaria, porque o reset (corretamente) não pula o 2FA.
 *
 * ⚠️ E DERRUBA AS OUTRAS SESSÕES, no molde da troca de senha: uma sessão roubada ANTES de ativar
 * continuaria valendo 30 dias — exatamente o cenário que o 2FA veio fechar.
 */
export async function confirmarAtivacao(
  user: SessionUser,
  senha: string,
  codigo: string,
  ip: string | undefined,
  sidAtual?: string,
): Promise<{ codigosRecuperacao: string[] }> {
  exigirQuePodeAtivar(user);
  reservarTentativa(user.id, ip);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (!u.passwordHash || !(await verifyPassword(u.passwordHash, senha))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Senha ou código incorretos." });
  }
  const sf = await prisma.segundoFator.findUnique({ where: { userId: user.id } });
  if (!sf || sf.ativadoEm) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Comece a ativação de novo." });
  }
  const segredo = decifrarSegredo(sf.segredoCifrado);
  const passo = segredo ? conferirCodigoTotp(segredo, codigo, Date.now(), null) : null;
  if (passo === null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Senha ou código incorretos. Confira também se o relógio do celular está certo.",
    });
  }
  // Senha E código conferiram — aqui, e só aqui, a pessoa zera.
  registrarAcerto(user.id, ip);

  const codigos = Array.from({ length: QUANTOS_CODIGOS }, gerarCodigoDeRecuperacao);
  const ativou = await prisma.$transaction(async (tx) => {
    // Condicional: duas confirmações simultâneas não geram dois jogos de códigos.
    const r = await tx.segundoFator.updateMany({
      where: { userId: user.id, ativadoEm: null },
      data: { ativadoEm: new Date(), ultimoPasso: passo },
    });
    if (r.count !== 1) return false;
    await tx.codigoRecuperacao.deleteMany({ where: { userId: user.id } });
    await tx.codigoRecuperacao.createMany({
      data: codigos.map((c) => ({ userId: user.id, hash: hashCodigoDeRecuperacao(c) })),
    });
    return true;
  });
  if (!ativou) throw new TRPCError({ code: "BAD_REQUEST", message: "A verificação em duas etapas já está ativa." });
  await prisma.session.deleteMany({
    where: { userId: user.id, ...(sidAtual ? { NOT: { id: sidAtual } } : {}) },
  });
  await prisma.activityLog.create({ data: { userId: user.id, acao: "seguranca.2fa_ativado" } });
  return { codigosRecuperacao: codigos };
}

/**
 * Desativa. Exige a SENHA **e** um código (do aplicativo ou de recuperação): quem roubou só a
 * sessão aberta (aba esquecida) não consegue tirar a proteção, e quem tem só a senha também não.
 */
export async function desativarSegundoFator(
  user: SessionUser,
  senha: string,
  codigo: string,
  ip: string | undefined,
): Promise<{ ok: true }> {
  recusarSessaoDeSuporte(user);
  // UMA tentativa para a operação inteira (senha + código): a senha errada conta no mesmo freio,
  // e a senha CERTA não devolve nada — só o código certo zera (M1).
  reservarOuRegistrarFreio(user.id, ip, "desativar");
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (!u.passwordHash || !(await verifyPassword(u.passwordHash, senha))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Senha ou código incorretos." });
  }
  const via = await conferirCodigoSemFreio(user.id, codigo);
  if (!via) {
    // Senha CERTA e código errado — o mesmo sinal do login (B1).
    await registrarCodigoErrado(user.id, ip, "desativar");
    throw new TRPCError({ code: "BAD_REQUEST", message: "Senha ou código incorretos." });
  }
  registrarAcerto(user.id, ip);
  await prisma.$transaction([
    prisma.codigoRecuperacao.deleteMany({ where: { userId: user.id } }),
    prisma.segundoFator.deleteMany({ where: { userId: user.id } }),
  ]);
  await prisma.activityLog.create({ data: { userId: user.id, acao: "seguranca.2fa_desativado" } });
  return { ok: true };
}
