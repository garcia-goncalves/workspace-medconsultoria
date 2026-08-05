import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { cifrar } from "../../lib/cripto-caixa.js";
import { descobrirServidor, testarConexao } from "./imap.js";
import { sincronizarPastas } from "./pastas.service.js";

/**
 * Freio de tentativa de senha, POR USUÁRIO.
 *
 * Sem ele, `plugarCaixa` é um oráculo de senha contra o servidor de e-mail da empresa: qualquer
 * pessoa da equipe (o papel mais baixo já basta) escolhe o endereço de um colega e chuta senha
 * pela API, com resposta limpa de "acertou/errou", no limite de 300 req/min do rate-limit global.
 * Mesmo sem acertar nada, a rajada faz a hospedagem bloquear o IP do servidor por força bruta —
 * e aí a aplicação inteira para de receber e enviar e-mail.
 *
 * Em memória de propósito: é UM processo Node (ADR-2). Reiniciou, zerou — e tudo bem: o que se
 * quer impedir é a rajada, não guardar histórico. Persistir isso pediria tabela e limpeza.
 */
const TENTATIVAS_MAX = 5;
const JANELA_MS = 15 * 60 * 1000;
const tentativas = new Map<string, { n: number; desde: number }>();

function conferirFreio(userId: string) {
  const agora = Date.now();
  const atual = tentativas.get(userId);
  if (!atual || agora - atual.desde > JANELA_MS) {
    tentativas.set(userId, { n: 1, desde: agora });
    return;
  }
  atual.n += 1;
  if (atual.n > TENTATIVAS_MAX) {
    const faltam = Math.ceil((JANELA_MS - (agora - atual.desde)) / 60000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Muitas tentativas de conexão. Espere ${faltam} minuto(s) e tente de novo.`,
    });
  }
}

/** Conexão que deu certo limpa o freio — quem acertou a senha não é quem se quer frear. */
function liberarFreio(userId: string) {
  tentativas.delete(userId);
}

/** Campos devolvidos ao front. O `segredo` NUNCA entra aqui — nem cifrado. */
const CAMPOS_PUBLICOS = {
  id: true,
  email: true,
  rotulo: true,
  nomeExibicao: true,
  assinatura: true,
  padrao: true,
  ativa: true,
  estado: true,
  ultimoErro: true,
  ultimaSyncEm: true,
  createdAt: true,
} as const;

export async function listarCaixas(userId: string) {
  return prisma.caixaEmail.findMany({
    where: { userId, deletedAt: null },
    select: CAMPOS_PUBLICOS,
    orderBy: [{ padrao: "desc" }, { createdAt: "asc" }],
  });
}

export async function plugarCaixa(
  userId: string,
  e: { email: string; senha: string; nomeExibicao: string; rotulo?: string; importarMeses?: number },
) {
  const email = e.email.trim().toLowerCase();

  const jaTem = await prisma.caixaEmail.findFirst({
    where: { userId, email, deletedAt: null },
    select: { id: true },
  });
  if (jaTem) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Você já plugou esta caixa." });
  }

  const servidor = descobrirServidor(email);

  conferirFreio(userId);

  // Testar ANTES de gravar: caixa quebrada no banco falha depois, em silêncio, longe daqui.
  const teste = await testarConexao({
    imapHost: servidor.imapHost,
    imapPorta: servidor.imapPorta,
    usuario: email,
    senha: e.senha,
  });
  if (!teste.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        teste.motivo === "AUTENTICACAO"
          ? "Senha recusada pelo servidor de e-mail. Confira a senha da caixa (é a mesma do webmail)."
          : `Não consegui falar com ${servidor.imapHost}. Detalhe: ${teste.detalhe}`,
    });
  }

  const meses = e.importarMeses ?? 3;
  const desde = new Date();
  desde.setMonth(desde.getMonth() - meses);

  liberarFreio(userId);

  const primeira = (await prisma.caixaEmail.count({ where: { userId, deletedAt: null } })) === 0;

  const dados = {
    rotulo: e.rotulo?.trim() || null,
    nomeExibicao: e.nomeExibicao.trim(),
    usuario: email,
    segredo: cifrar(e.senha),
    imapHost: servidor.imapHost,
    imapPorta: servidor.imapPorta,
    smtpHost: servidor.smtpHost,
    smtpPorta: servidor.smtpPorta,
    importarDesde: desde,
    padrao: primeira,
    estado: "OK" as const,
    ultimoErro: null,
  };

  // Plugar de novo uma caixa REMOVIDA ressuscita a linha, em vez de criar outra. O
  // `@@unique([userId, email])` não enxerga o `deletedAt`, então `create` bateria num P2002 cru
  // e a pessoa ficaria travada: não conseguiria recriar (índice) nem reconectar (`reconectarCaixa`
  // filtra `deletedAt: null` e não acha a removida). É o mesmo remédio do ADR-92 nas contas.
  const removida = await prisma.caixaEmail.findFirst({
    where: { userId, email, deletedAt: { not: null } },
    select: { id: true },
  });

  const criada = removida
    ? await prisma.caixaEmail.update({
        where: { id: removida.id },
        data: { ...dados, deletedAt: null, ativa: true },
        select: { id: true },
      })
    : await prisma.caixaEmail.create({ data: { userId, email, ...dados }, select: { id: true } });

  // Descobrir as pastas AQUI: sem isto a coluna de pastas nasce vazia e a pessoa vê a caixa
  // conectada sem Caixa de entrada nenhuma. Best-effort — a caixa já está gravada e válida, e
  // `listarPastas` refaz a descoberta sozinho se esta chamada falhar por oscilação de rede.
  try {
    await sincronizarPastas(criada.id);
  } catch {
    /* a caixa vale mesmo sem as pastas; `listarPastas` tenta de novo na primeira abertura */
  }

  return criada;
}

export async function reconectarCaixa(userId: string, caixaId: string, senha: string) {
  const caixa = await prisma.caixaEmail.findFirst({
    where: { id: caixaId, userId, deletedAt: null },
    select: { id: true, email: true, imapHost: true, imapPorta: true, usuario: true },
  });
  if (!caixa) throw new TRPCError({ code: "NOT_FOUND", message: "Caixa não encontrada." });

  conferirFreio(userId);

  const teste = await testarConexao({
    imapHost: caixa.imapHost,
    imapPorta: caixa.imapPorta,
    usuario: caixa.usuario,
    senha,
  });
  if (!teste.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        teste.motivo === "AUTENTICACAO"
          ? "Senha recusada pelo servidor de e-mail."
          : `Não consegui conectar: ${teste.detalhe}`,
    });
  }

  liberarFreio(userId);

  await prisma.caixaEmail.update({
    where: { id: caixa.id },
    data: { segredo: cifrar(senha), estado: "OK", ultimoErro: null },
  });
}

/** Soft-delete: some da tela e para de sincronizar. Não apaga nada no servidor de e-mail. */
export async function removerCaixa(userId: string, caixaId: string) {
  const caixa = await prisma.caixaEmail.findFirst({
    where: { id: caixaId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!caixa) throw new TRPCError({ code: "NOT_FOUND", message: "Caixa não encontrada." });
  await prisma.caixaEmail.update({
    where: { id: caixa.id },
    // A senha some AGORA. Guardar credencial de uma caixa que a pessoa mandou remover é
    // retenção sem finalidade — e plugar de novo pede a senha outra vez de qualquer forma.
    data: { deletedAt: new Date(), ativa: false, segredo: "" },
  });
}
