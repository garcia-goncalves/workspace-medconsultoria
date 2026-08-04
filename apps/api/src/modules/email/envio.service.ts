import { TRPCError } from "@trpc/server";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { prisma } from "@app/db";
import { DESTINOS_TESTE_PERMITIDOS, type EnviarEmailInput } from "@app/shared";
import { isProd } from "../../config.js";
import { comSmtp } from "./smtp.js";
import { comCaixa } from "./imap.js";
import { montarCitacao, destinatariosResposta, assuntoResposta, assuntoEncaminhar } from "./citacao.js";
import { caminhoTemp } from "../../http/email-anexo.js";

/**
 * Teto do CONJUNTO de anexos de um envio — não o de cada arquivo (`TAMANHO_MAX`, 20 MB, em
 * `lib/storage.ts`). É o que os servidores de e-mail aceitam de qualquer forma, então uma
 * mensagem acima disso não sairia mesmo. E compor o MIME materializa a mensagem inteira (anexos
 * em base64 incluídos) num Buffer só, no mesmo processo que serve a tela — no pior caso (20
 * anexos de 20 MB) seriam ~530 MB de base64 sem este teto.
 */
const LIMITE_ANEXOS_BYTES = 25 * 1024 * 1024;

/**
 * Fora de produção, só é permitido enviar para os endereços de teste do dono.
 *
 * Isto é código, e não disciplina, de propósito: o envio desta fase usa o SMTP REAL da caixa da
 * pessoa. Um teste distraído mandaria e-mail de verdade para um cliente de verdade, e não existe
 * desfazer.
 */
export function conferirDestinoPermitido(destinos: string[]): void {
  if (isProd) return;
  const permitidos = new Set<string>(DESTINOS_TESTE_PERMITIDOS.map((e) => e.toLowerCase()));
  const proibido = destinos.find((d) => !permitidos.has(d.trim().toLowerCase()));
  if (proibido) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Em desenvolvimento só é permitido enviar para ${DESTINOS_TESTE_PERMITIDOS.join(" ou ")}. Recusei enviar para ${proibido}.`,
    });
  }
}

/**
 * Confere os anexos temporários ANTES de compor o e-mail: existem de verdade, e a soma não
 * passa do teto do CONJUNTO. Chamada antes de `compile().build()`, que materializa a mensagem
 * inteira (anexos em base64 incluídos) num Buffer só — no mesmo processo que serve a tela.
 *
 * Também é a defesa contra reenviar depois de uma falha do SMTP: o `finally` do PASSO 1 já
 * apagou os temporários da tentativa anterior, e sem esta checagem o `createReadStream` do
 * `MailComposer` cairia num ENOENT cru — que, sem `errorFormatter` no tRPC, vazaria o caminho de
 * disco do servidor pro cliente e pro ErrorLog.
 */
export async function conferirAnexos(userId: string, anexos: EnviarEmailInput["anexos"]): Promise<void> {
  let total = 0;
  for (const a of anexos) {
    let tamanho: number;
    try {
      tamanho = (await stat(caminhoTemp(userId, a.id))).size;
    } catch {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Um dos anexos não está mais disponível. Anexe o arquivo de novo e tente enviar.",
      });
    }
    total += tamanho;
  }
  if (total > LIMITE_ANEXOS_BYTES) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Os anexos somam ${(total / 1024 / 1024).toFixed(1)} MB — o limite total é ${LIMITE_ANEXOS_BYTES / 1024 / 1024} MB.`,
    });
  }
}

/** Caixa da pessoa, com o que o envio precisa. O `segredo` NÃO entra neste select. */
export async function caixaDoUsuario(userId: string, caixaId: string) {
  const caixa = await prisma.caixaEmail.findFirst({
    where: { id: caixaId, userId, deletedAt: null },
    select: { id: true, email: true, nomeExibicao: true, assinatura: true },
  });
  if (!caixa) throw new TRPCError({ code: "NOT_FOUND", message: "Caixa não encontrada." });
  return caixa;
}

/** Mensagem original (resposta/encaminhamento), com posse conferida pelo mesmo caminho. */
async function originalDoUsuario(userId: string, mensagemId: string) {
  return prisma.emailMensagem.findFirst({
    where: { id: mensagemId, pasta: { caixa: { userId, deletedAt: null } } },
    select: {
      id: true,
      uid: true,
      messageId: true,
      referencias: true,
      assunto: true,
      pastaId: true,
      pasta: { select: { caminho: true, caixaId: true } },
    },
  });
}

export async function enviarMensagem(
  userId: string,
  input: EnviarEmailInput,
): Promise<{ enviado: true; copiaEmEnviados: boolean }> {
  const caixa = await caixaDoUsuario(userId, input.caixaId);
  const todos = [...input.para, ...input.cc, ...input.cco];
  conferirDestinoPermitido(todos);

  await conferirAnexos(userId, input.anexos);

  // `emRespostaA` e `encaminhando` são mutuamente exclusivos na prática; se vierem os dois,
  // `emRespostaA` manda (é o caso mais forte) — não estoura erro por isso.
  const modo: "resposta" | "encaminhar" | null = input.emRespostaA ? "resposta" : input.encaminhando ? "encaminhar" : null;
  const mensagemCitadaId = input.emRespostaA ?? input.encaminhando;

  const citada = mensagemCitadaId ? await originalDoUsuario(userId, mensagemCitadaId) : null;
  if (mensagemCitadaId && !citada) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        modo === "resposta"
          ? "A mensagem que você está respondendo não existe mais."
          : "A mensagem que você está encaminhando não existe mais.",
    });
  }

  const corpo = [input.corpoHtml, caixa.assinatura ? `<br>--<br>${caixa.assinatura}` : ""]
    .filter(Boolean)
    .join("\n");

  // Cabeçalhos de conversa. Sem eles a resposta OU o encaminhamento chega ao destinatário como
  // assunto novo e a conversa se parte DO LADO DELE — dano invisível daqui. `references` entra
  // nos dois casos; `inReplyTo` só na resposta (encaminhar não é responder a ela — 0.1 do brief).
  const referencias = citada ? [citada.referencias, citada.messageId].filter(Boolean).join(" ").trim() : "";

  const composer = new MailComposer({
    from: { name: caixa.nomeExibicao, address: caixa.email },
    to: input.para,
    cc: input.cc,
    bcc: input.cco,
    subject: input.assunto,
    html: corpo,
    inReplyTo: modo === "resposta" ? (citada?.messageId ?? undefined) : undefined,
    references: referencias || undefined,
    // `input.anexos` traz { id, nome }: o id é o do upload temporário (POST /email-anexo), o
    // nome é o original informado por quem escreveu o e-mail.
    attachments: input.anexos.map((a) => ({
      filename: a.nome,
      content: createReadStream(caminhoTemp(userId, a.id)),
    })),
  });

  // Compor UMA vez: o mesmo MIME vai para o SMTP e para a cópia em Enviados, então o que está
  // na pasta é exatamente o que saiu.
  const mime: Buffer = await new Promise((ok, falhou) => {
    composer.compile().build((erro, buffer) => (erro ? falhou(erro) : ok(buffer)));
  });

  // PASSO 1 — enviar. Os anexos temporários são de uso único: limpa dê certo ou não o envio
  // (`finally` — se o envio falhar e a limpeza ficasse só depois, o arquivo vazaria no disco).
  try {
    await comSmtp(caixa.id, async (t) => {
      await t.sendMail({ envelope: { from: caixa.email, to: todos }, raw: mime });
    });
  } finally {
    await Promise.all(
      input.anexos.map((a) => rm(caminhoTemp(userId, a.id), { force: true }).catch(() => {})),
    );
  }

  // PASSO 2 — guardar a cópia em Enviados. SMTP não guarda cópia: sem isto, a pessoa responde
  // aqui e no celular dela o e-mail não existe.
  //
  // Falha aqui NÃO desfaz o envio (não existe desfazer) e NÃO reenvia. A tela avisa que a cópia
  // não foi guardada, e só.
  let copiaEmEnviados = false;
  const enviados = await prisma.caixaPasta.findFirst({
    where: { caixaId: caixa.id, papel: "SENT" },
    select: { caminho: true },
  });
  if (enviados) {
    try {
      await comCaixa(caixa.id, async (c) => {
        await c.append(enviados.caminho, mime, ["\\Seen"]);
      });
      copiaEmEnviados = true;
    } catch {
      /* avisado ao chamador por `copiaEmEnviados: false` */
    }
  }

  // PASSO 3 — marcar a original como respondida. É o que acende o "já respondi este". Só vale
  // para RESPOSTA — encaminhar não é responder, então não marca (0.1 do brief).
  //
  // Usa a caixa DONA da mensagem original (`citada.pasta.caixaId`), não a caixa de ENVIO: a
  // pessoa pode ter mais de uma caixa plugada e responder pela ORIGEM de uma usando o SMTP de
  // outra — a mensagem sendo marcada mora no servidor da caixa original, não na de envio.
  if (modo === "resposta" && citada) {
    try {
      await comCaixa(citada.pasta.caixaId, async (c) => {
        const lock = await c.getMailboxLock(citada.pasta.caminho);
        try {
          await c.messageFlagsAdd(String(citada.uid), ["\\Answered"], { uid: true });
        } finally {
          lock.release();
        }
      });
      await prisma.emailMensagem.update({ where: { id: citada.id }, data: { respondido: true } });
    } catch {
      /* cosmético: não vale falhar um envio que já saiu */
    }
  }

  return { enviado: true, copiaEmEnviados };
}

/** Rascunho de resposta pronto para a tela: destinatários, assunto e citação já montados. */
export async function prepararResposta(
  userId: string,
  mensagemId: string,
  aTodos: boolean,
): Promise<{ para: string[]; cc: string[]; assunto: string; citacaoPreview: string; citacaoEnvio: string }> {
  const msg = await prisma.emailMensagem.findFirst({
    where: { id: mensagemId, pasta: { caixa: { userId, deletedAt: null } } },
    select: {
      deNome: true,
      deEmail: true,
      dataEm: true,
      assunto: true,
      corpoHtml: true,
      corpoTexto: true,
      enderecos: { select: { papel: true, endereco: true } },
      pasta: { select: { caixa: { select: { email: true } } } },
    },
  });
  if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada." });

  const { para, cc } = destinatariosResposta({
    deEmail: msg.deEmail,
    para: msg.enderecos.filter((e) => e.papel === "PARA").map((e) => e.endereco),
    cc: msg.enderecos.filter((e) => e.papel === "CC").map((e) => e.endereco),
    meuEndereco: msg.pasta.caixa.email,
    aTodos,
  });

  const citacao = montarCitacao(msg);
  return {
    para,
    cc,
    assunto: assuntoResposta(msg.assunto),
    citacaoPreview: citacao.preview,
    citacaoEnvio: citacao.envio,
  };
}

/** Idem para encaminhar: sem destinatário, assunto com Enc: e a mensagem inteira citada. */
export async function prepararEncaminhamento(
  userId: string,
  mensagemId: string,
): Promise<{ assunto: string; citacaoPreview: string; citacaoEnvio: string }> {
  const msg = await prisma.emailMensagem.findFirst({
    where: { id: mensagemId, pasta: { caixa: { userId, deletedAt: null } } },
    select: { deNome: true, deEmail: true, dataEm: true, assunto: true, corpoHtml: true, corpoTexto: true },
  });
  if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada." });
  const citacao = montarCitacao(msg);
  return { assunto: assuntoEncaminhar(msg.assunto), citacaoPreview: citacao.preview, citacaoEnvio: citacao.envio };
}
