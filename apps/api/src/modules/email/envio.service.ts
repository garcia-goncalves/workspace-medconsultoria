import { TRPCError } from "@trpc/server";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { createReadStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import { prisma } from "@app/db";
import { DESTINOS_TESTE_PERMITIDOS, type EnviarEmailInput } from "@app/shared";
import { isProd } from "../../config.js";
import { comSmtp } from "./smtp.js";
import { comCaixa } from "./imap.js";
import { montarCitacao, destinatariosResposta, assuntoResposta, assuntoEncaminhar } from "./citacao.js";
import { LIMITE_CORPO_BYTES } from "./leitura.service.js";
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
 * Corpo usado quando a pessoa não escreveu nada. Existe por uma razão só, e é grave: `html: ""`
 * é FALSY para o `MailComposer` (`getAlternatives`, do nodemailer), e sem nenhuma "alternativa"
 * ele não monta `multipart/mixed` — uma mensagem sem texto e com UM anexo COLAPSA, e o anexo
 * VIRA o corpo (`Content-Type: text/html; name=contrato.html`). O e-mail sai sem anexo nenhum,
 * a nossa cópia em Enviados grava `temAnexo: false` e quem escreveu vê sucesso na tela. Com um
 * anexo `.html`, o cliente de e-mail de quem recebe ainda renderiza HTML de terceiro como corpo,
 * com o NOSSO domínio no remetente. E mandar só "segue o contrato em anexo", sem escrever nada,
 * é caso de uso normal — uma caixa COM assinatura configurada mascarava o defeito.
 */
const CORPO_MINIMO = "<p></p>";

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
 * `bytesJaContados` são os anexos que NÃO estão no nosso disco e entram no mesmo teto: os do
 * e-mail original, rebaixados do IMAP num encaminhamento. Sem somá-los aqui, encaminhar um
 * e-mail de 24 MB com mais um arquivo anexado passaria batido pelo teto.
 *
 * Também é a defesa contra o temporário que sumiu entre anexar e enviar — a varredura de 24h
 * (`limparAnexosTempOrfaos`) apaga o anexo de um compose deixado aberto além do prazo. Sem esta
 * checagem, o `createReadStream` do `MailComposer` cairia num ENOENT cru — que, sem
 * `errorFormatter` no tRPC, vazaria o caminho de disco do servidor pro cliente e pro ErrorLog.
 */
export async function conferirAnexos(
  userId: string,
  anexos: EnviarEmailInput["anexos"],
  bytesJaContados = 0,
): Promise<void> {
  let total = bytesJaContados;
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

/** O que o `MailComposer` precisa de cada anexo — arquivo em stream ou conteúdo já em memória. */
type AnexoParaCompor = { filename: string; content: Readable | Buffer };

/**
 * Monta o MIME da mensagem. Separado do envio de propósito: é aqui que um detalhe do
 * `MailComposer` decide se o anexo sai como ANEXO ou vira o corpo (ver `CORPO_MINIMO`), e isso
 * só dá para travar com um teste que inspecione o buffer construído — sem SMTP nem IMAP no meio.
 */
export async function montarMime(m: {
  de: { nome: string; email: string };
  para: string[];
  cc: string[];
  cco: string[];
  assunto: string;
  corpoHtml: string;
  inReplyTo?: string;
  references?: string;
  anexos: AnexoParaCompor[];
}): Promise<Buffer> {
  const composer = new MailComposer({
    from: { name: m.de.nome, address: m.de.email },
    to: m.para,
    cc: m.cc,
    bcc: m.cco,
    subject: m.assunto,
    html: m.corpoHtml || CORPO_MINIMO,
    inReplyTo: m.inReplyTo,
    references: m.references,
    attachments: m.anexos,
  });
  return new Promise<Buffer>((ok, falhou) => {
    composer.compile().build((erro, buffer) => (erro ? falhou(erro) : ok(buffer)));
  });
}

/**
 * Anexos do e-mail original escolhidos para ir junto no encaminhamento, resolvidos no banco.
 *
 * A POSSE vem da cadeia inteira: `citada` só existe se `originalDoUsuario` a achou pela caixa
 * DESTA pessoa, e aqui os anexos são presos a `mensagemId: citada.id`. Um id de anexo de outra
 * mensagem (ou de outra pessoa) simplesmente não é encontrado.
 *
 * O `nome` sai do BANCO, nunca do cliente: é o mesmo nome que a pessoa viu na mensagem aberta.
 */
async function resolverAnexosOriginais(
  citada: { id: string } | null,
  ids: string[],
): Promise<{ id: string; nome: string; tamanho: number; parte: string }[]> {
  if (ids.length === 0) return [];
  if (!citada) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Só dá para levar anexos do e-mail original ao responder ou encaminhar uma mensagem.",
    });
  }
  const achados = await prisma.emailAnexo.findMany({
    where: { id: { in: ids }, mensagemId: citada.id },
    select: { id: true, nome: true, tamanho: true, parte: true },
  });
  if (achados.length !== new Set(ids).size) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Um dos anexos do e-mail original não está mais disponível. Abra a mensagem de novo e tente encaminhar.",
    });
  }
  return achados;
}

/**
 * Rebaixa do IMAP os anexos do original para anexá-los ao e-mail que sai. Uma conexão e um lock
 * para o conjunto todo — encaminhar um e-mail com 5 anexos não pode abrir 5 conexões.
 *
 * TUDO acontece DENTRO do `comCaixa`, inclusive esgotar o stream: `c.download()` resolve depois
 * do PRIMEIRO pedaço e o resto continua sendo puxado do socket. Devolver o stream para fora
 * fecharia a conexão no meio da leitura e o anexo sairia CORTADO, em silêncio, acima de ~64 KB —
 * é a mesma regra que `http/email-anexo.ts` documenta na rota de download.
 *
 * "O servidor não devolveu esta parte" NÃO sobe de dentro do callback de propósito: o `catch` do
 * `comCaixa` marcaria a CAIXA INTEIRA como `ERRO` por causa de um anexo — sem nenhuma relação
 * com a sincronização dela.
 */
async function baixarAnexosOriginais(
  citada: { uid: bigint; pasta: { caminho: string; caixaId: string } },
  anexos: { nome: string; parte: string }[],
): Promise<AnexoParaCompor[]> {
  if (anexos.length === 0) return [];

  const r = await comCaixa(citada.pasta.caixaId, async (c) => {
    const lock = await c.getMailboxLock(citada.pasta.caminho);
    try {
      const prontos: AnexoParaCompor[] = [];
      for (const a of anexos) {
        const baixado = await c.download(String(citada.uid), a.parte, { uid: true });
        if (!baixado?.content) return { faltou: a.nome } as const;
        const pedacos: Buffer[] = [];
        for await (const p of baixado.content) pedacos.push(p as Buffer);
        prontos.push({ filename: a.nome, content: Buffer.concat(pedacos) });
      }
      return { prontos } as const;
    } finally {
      lock.release();
    }
  });

  if ("faltou" in r) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `O servidor de e-mail não devolveu o anexo "${r.faltou}". Tente encaminhar de novo em alguns instantes.`,
    });
  }
  return r.prontos;
}

export async function enviarMensagem(
  userId: string,
  input: EnviarEmailInput,
): Promise<{ enviado: true; copiaEmEnviados: boolean }> {
  const caixa = await caixaDoUsuario(userId, input.caixaId);
  const todos = [...input.para, ...input.cc, ...input.cco];
  conferirDestinoPermitido(todos);

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

  // Anexos do original (encaminhamento) primeiro: eles entram no MESMO teto de 25 MB dos
  // temporários, então o tamanho tem de ser conhecido antes de conferir o conjunto.
  const originais = await resolverAnexosOriginais(citada, input.anexosOriginais);
  await conferirAnexos(userId, input.anexos, originais.reduce((s, a) => s + a.tamanho, 0));

  const corpo = [input.corpoHtml, caixa.assinatura ? `<br>--<br>${caixa.assinatura}` : ""]
    .filter(Boolean)
    .join("\n");

  // Cabeçalhos de conversa. Sem eles a resposta OU o encaminhamento chega ao destinatário como
  // assunto novo e a conversa se parte DO LADO DELE — dano invisível daqui. `references` entra
  // nos dois casos; `inReplyTo` só na resposta (encaminhar não é responder a ela — 0.1 do brief).
  const referencias = citada ? [citada.referencias, citada.messageId].filter(Boolean).join(" ").trim() : "";

  // Os anexos do original saem do IMAP ANTES de compor: se o servidor de e-mail não os devolver,
  // nada foi enviado ainda e a pessoa vê o erro em vez de um encaminhamento sem o anexo — que é
  // justamente o ponto de encaminhar.
  const doOriginal = citada ? await baixarAnexosOriginais(citada, originais) : [];

  // Compor UMA vez: o mesmo MIME vai para o SMTP e para a cópia em Enviados, então o que está
  // na pasta é exatamente o que saiu.
  const mime = await montarMime({
    de: { nome: caixa.nomeExibicao, email: caixa.email },
    para: input.para,
    cc: input.cc,
    cco: input.cco,
    assunto: input.assunto,
    corpoHtml: corpo,
    inReplyTo: modo === "resposta" ? (citada?.messageId ?? undefined) : undefined,
    references: referencias || undefined,
    anexos: [
      // `input.anexos` traz { id, nome }: o id é o do upload temporário (POST /email-anexo), o
      // nome é o original informado por quem escreveu o e-mail.
      ...input.anexos.map((a) => ({
        filename: a.nome,
        content: createReadStream(caminhoTemp(userId, a.id)),
      })),
      ...doOriginal,
    ],
  });

  // PASSO 1 — enviar.
  await comSmtp(caixa.id, async (t) => {
    await t.sendMail({ envelope: { from: caixa.email, to: todos }, raw: mime });
  });

  // Os temporários só somem depois de o SMTP ACEITAR a mensagem. Apagá-los num `finally` (dê
  // certo ou não) fechava um beco sem saída: SMTP recusa (greylisting, timeout, 535) → a tela
  // mostra o erro → a pessoa clica Enviar de novo → `conferirAnexos` acusa "anexo não está mais
  // disponível" porque os arquivos já morreram, e anexar de novo não resolve (os ids mortos
  // continuam na lista da tela). Anexo abandonado — compose cancelado, aba fechada, envio que
  // falhou e não foi retomado — é coberto pela varredura de 24h, que foi escrita para isso
  // (`limparAnexosTempOrfaos`, `http/email-anexo.ts`).
  await Promise.all(
    input.anexos.map((a) => rm(caminhoTemp(userId, a.id), { force: true }).catch(() => {})),
  );

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

/**
 * Recusa preparar resposta/encaminhamento de uma mensagem cujo corpo NUNCA foi buscado.
 *
 * Quem responde "o corpo já foi buscado?" é `corpoEm` — NÃO `corpoHtml`/`corpoTexto`.
 * `abrirMensagem` (`leitura.service.ts`) grava `corpoEm` assim que baixa e higieniza a mensagem,
 * MESMO que os dois corpos saiam nulos: e-mail cujo conteúdo inteiro É o anexo (cliente que manda
 * `contrato.pdf` sem escrever nada, robô de nota fiscal, scanner) é legítimo e comum, e o mesmo
 * acontece com corpo que a higienização descarta por inteiro. Olhar para os corpos proibia
 * justamente ENCAMINHAR esse e-mail — o caso que esta fase veio atender —, e ainda mentia na
 * tarja dizendo que a mensagem era grande demais.
 *
 * Sobram dois motivos para `corpoEm` nulo, e cada um tem o seu desfecho:
 *
 *  - acima de `LIMITE_CORPO_BYTES`: o ramo `grandeDemais` de `abrirMensagem` decidiu não tocar na
 *    rede e NUNCA vai baixar essa mensagem. Mandar abrir de novo não resolve — o desfecho honesto
 *    é o webmail;
 *  - abaixo do teto: a mensagem só não foi aberta aqui ainda. Abrir resolve, e é o que dizemos.
 *
 * A tarja de erro de `Escrever.tsx` mostra esta mensagem como está.
 */
function exigirCorpoGuardado(
  msg: { corpoEm: Date | null; tamanho: number | null },
  acao: "responder" | "encaminhar",
): void {
  if (msg.corpoEm !== null) return;
  if ((msg.tamanho ?? 0) > LIMITE_CORPO_BYTES) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `Não dá para ${acao} esta mensagem por aqui: ela é grande demais para ser aberta na ` +
        `aplicação (${Math.round((msg.tamanho ?? 0) / 1024 / 1024)} MB). Use o webmail para ${acao} esta.`,
    });
  }
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `Abra esta mensagem antes de ${acao}: o conteúdo dela ainda não foi carregado na aplicação.`,
  });
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
      // `corpoEm` e `tamanho` são o que a guarda de corpo lê — sem eles ela não sabe distinguir
      // "nunca buscado" de "buscado e legitimamente vazio".
      corpoEm: true,
      tamanho: true,
      enderecos: { select: { papel: true, endereco: true } },
      pasta: { select: { caixa: { select: { email: true } } } },
    },
  });
  if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada." });
  exigirCorpoGuardado(msg, "responder");

  const { para, cc } = destinatariosResposta({
    deEmail: msg.deEmail,
    para: msg.enderecos.filter((e) => e.papel === "PARA").map((e) => e.endereco),
    cc: msg.enderecos.filter((e) => e.papel === "CC").map((e) => e.endereco),
    meuEndereco: msg.pasta.caixa.email,
    aTodos,
  });

  // Resposta: quem recebe é quem mandou o e-mail original — pode restaurar a imagem remota da
  // citação de envio (ver a razão completa no comentário de `montarCitacao`, `citacao.ts`).
  const citacao = montarCitacao(msg, { restaurarImagensNoEnvio: true });
  return {
    para,
    cc,
    assunto: assuntoResposta(msg.assunto),
    citacaoPreview: citacao.preview,
    citacaoEnvio: citacao.envio,
  };
}

/**
 * Idem para encaminhar: sem destinatário, assunto com Enc: e a mensagem inteira citada.
 *
 * Devolve TAMBÉM os anexos do original (`anexos`), porque encaminhar o e-mail cujo ponto inteiro
 * É o PDF anexo é o caso normal, não a exceção. A tela mostra a lista já marcada e manda de volta
 * em `anexosOriginais` do envio os ids que a pessoa quis levar; o conteúdo em si nunca passa pelo
 * navegador — quem rebaixa do IMAP é `enviarMensagem`.
 */
export async function prepararEncaminhamento(
  userId: string,
  mensagemId: string,
): Promise<{
  assunto: string;
  citacaoPreview: string;
  citacaoEnvio: string;
  anexos: { id: string; nome: string; tamanho: number }[];
}> {
  const msg = await prisma.emailMensagem.findFirst({
    where: { id: mensagemId, pasta: { caixa: { userId, deletedAt: null } } },
    select: {
      deNome: true,
      deEmail: true,
      dataEm: true,
      assunto: true,
      corpoHtml: true,
      corpoTexto: true,
      corpoEm: true,
      tamanho: true,
      // `cid` entra no select só para FILTRAR aqui dentro (ver o `filter` do retorno); ele não
      // faz parte do contrato desta procedure.
      anexos: { select: { id: true, nome: true, tamanho: true, cid: true } },
    },
  });
  if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada." });
  exigirCorpoGuardado(msg, "encaminhar");
  // Encaminhamento: quem recebe é um TERCEIRO que nunca escolheu abrir aquele e-mail — a citação
  // de envio fica bloqueada (igual ao preview), senão repassa o pixel de rastreio a ele (ver
  // `montarCitacao`, `citacao.ts`).
  const citacao = montarCitacao(msg, { restaurarImagensNoEnvio: false });
  return {
    assunto: assuntoEncaminhar(msg.assunto),
    citacaoPreview: citacao.preview,
    citacaoEnvio: citacao.envio,
    // Só o anexo DE VERDADE (`cid === null`). `sync.service.ts` grava como `EmailAnexo` também a
    // parte EMBUTIDA (`disposition: inline` com `cid`) — a logo da assinatura de quem escreveu,
    // tipicamente `image001.png`. Oferecê-la aqui fazia a tela listar imagem-lixo como anexo e o
    // encaminhamento sair com ela pendurada, para o cliente. A imagem embutida da citação já
    // chega quebrada hoje (as partes MIME do original não são reanexadas com o `cid` preservado —
    // pendência registrada de fase futura), então filtrar não piora nada e tira o lixo.
    //
    // O filtro é em JS, e não um `where` no `select`, de propósito: é o que deixa a regra
    // observável no teste que dubla o Prisma (`envio.preparar.test.ts`).
    anexos: msg.anexos.filter((a) => a.cid === null).map(({ id, nome, tamanho }) => ({ id, nome, tamanho })),
  };
}
