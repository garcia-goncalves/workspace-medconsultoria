import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { cifrar } from "../../lib/cripto-caixa.js";
import { descobrirServidor, testarConexao } from "./imap.js";

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

  const primeira = (await prisma.caixaEmail.count({ where: { userId, deletedAt: null } })) === 0;

  const criada = await prisma.caixaEmail.create({
    data: {
      userId,
      email,
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
      estado: "OK",
    },
    select: { id: true },
  });
  return criada;
}

export async function reconectarCaixa(userId: string, caixaId: string, senha: string) {
  const caixa = await prisma.caixaEmail.findFirst({
    where: { id: caixaId, userId, deletedAt: null },
    select: { id: true, email: true, imapHost: true, imapPorta: true, usuario: true },
  });
  if (!caixa) throw new TRPCError({ code: "NOT_FOUND", message: "Caixa não encontrada." });

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
    data: { deletedAt: new Date(), ativa: false },
  });
}
