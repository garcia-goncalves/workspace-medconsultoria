import { TRPCError } from "@trpc/server";
import { simpleParser } from "mailparser";
import { prisma } from "@app/db";
import { comCaixa } from "./imap.js";
import { sanitizarEmailHtml } from "../../lib/sanitizar-html.js";

/** Teto de UIDs vindos da busca do servidor: um `IN (...)` com milhares de valores derruba a query. */
const MAX_UIDS_BUSCA = 500;

/**
 * Teto para baixar o corpo. O servidor aceita mensagem de até 75 MB (SIZE do SMTP), e trazer
 * uma dessas para a memória do processo que serve a aplicação inteira é como um estranho
 * derruba tudo sem ter conta nenhuma. 10 MB cobre com folga e-mail real com anexo.
 */
const LIMITE_CORPO_BYTES = 10 * 1024 * 1024;

/** Garante que a pasta é de uma caixa DESTE usuário. Base da privacidade — sempre chamar. */
async function pastaDoUsuario(userId: string, pastaId: string) {
  const pasta = await prisma.caixaPasta.findFirst({
    where: { id: pastaId, caixa: { userId, deletedAt: null } },
    select: { id: true, caixaId: true, caminho: true },
  });
  if (!pasta) throw new TRPCError({ code: "NOT_FOUND", message: "Pasta não encontrada." });
  return pasta;
}

export async function listarMensagens(
  userId: string,
  e: { pastaId: string; busca?: string; limite?: number; antesDe?: Date },
) {
  const pasta = await pastaDoUsuario(userId, e.pastaId);
  const limite = Math.min(e.limite ?? 50, 200);
  const busca = e.busca?.trim();

  // Busca vai ao SERVIDOR (ESEARCH): cobre remetente, assunto E o corpo — sem espelhar corpo
  // nenhum. É o que remove a única desvantagem real da opção "C" do desenho.
  let uidsDaBusca: bigint[] | null = null;
  if (busca) {
    const achados = await comCaixa(pasta.caixaId, async (c) => {
      const lock = await c.getMailboxLock(pasta.caminho);
      try {
        return (await c.search({ or: [{ body: busca }, { subject: busca }, { from: busca }] }, { uid: true })) || [];
      } finally {
        lock.release();
      }
    });
    // Só os mais recentes: UID maior = chegou depois na pasta, então cortar por UID decrescente
    // é a mesma ordem que a tela mostra (data decrescente).
    uidsDaBusca = achados
      .sort((a, b) => b - a)
      .slice(0, MAX_UIDS_BUSCA)
      .map((u) => BigInt(u));
    if (uidsDaBusca.length === 0) return [];
  }

  return prisma.emailMensagem.findMany({
    where: {
      pastaId: pasta.id,
      ...(uidsDaBusca ? { uid: { in: uidsDaBusca } } : {}),
      ...(e.antesDe ? { dataEm: { lt: e.antesDe } } : {}),
    },
    select: {
      id: true,
      deNome: true,
      deEmail: true,
      assunto: true,
      trecho: true,
      dataEm: true,
      lido: true,
      temAnexo: true,
      threadKey: true,
    },
    orderBy: { dataEm: "desc" },
    take: limite,
  });
}

export async function abrirMensagem(userId: string, mensagemId: string) {
  const msg = await prisma.emailMensagem.findFirst({
    where: { id: mensagemId, pasta: { caixa: { userId, deletedAt: null } } },
    include: {
      enderecos: { select: { papel: true, nome: true, endereco: true } },
      anexos: { select: { id: true, nome: true, tipo: true, tamanho: true } },
      pasta: { select: { id: true, caminho: true, caixaId: true } },
    },
  });
  if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada." });

  let corpoHtml = msg.corpoHtml;
  let corpoTexto = msg.corpoTexto;
  let imagensBloqueadas = 0;

  // Cache frio: busca o corpo AGORA. É o "sob demanda" da opção "C". Quem responde se já
  // buscamos é o `corpoEm` — não os corpos: mensagem vazia (ou só com script/imagem remota,
  // que a higienização descarta) deixaria os dois nulos e voltaria ao IMAP a cada abertura.
  // Teto de tamanho ANTES de tocar na rede. Sem isto, qualquer pessoa do mundo derruba o
  // Workspace inteiro mandando um e-mail grande: o `download` traz a mensagem RFC822 completa
  // (anexos inclusive) para a memória do ÚNICO processo Node que serve API + SPA + tempo real,
  // e o mailparser multiplica esse pico. Acima do teto, mostramos o que já se sabe e explicamos.
  const grandeDemais = (msg.tamanho ?? 0) > LIMITE_CORPO_BYTES;
  if (msg.corpoEm === null && grandeDemais) {
    corpoTexto =
      "Esta mensagem é grande demais para abrir aqui " +
      `(${Math.round((msg.tamanho ?? 0) / 1024 / 1024)} MB). Abra pelo webmail.`;
  } else if (msg.corpoEm === null) {
    const bruto = await comCaixa(msg.pasta.caixaId, async (c) => {
      const lock = await c.getMailboxLock(msg.pasta.caminho);
      try {
        const r = await c.download(String(msg.uid), undefined, { uid: true });
        if (!r?.content) return null;
        const pedacos: Buffer[] = [];
        for await (const p of r.content) pedacos.push(p as Buffer);
        return Buffer.concat(pedacos);
      } finally {
        lock.release();
      }
    });

    if (bruto) {
      const parsed = await simpleParser(bruto);
      const limpo = sanitizarEmailHtml(parsed.html || "");
      corpoHtml = limpo.html || null;
      imagensBloqueadas = limpo.imagensRemotasBloqueadas;
      corpoTexto = parsed.text ?? null;
      // A prévia da lista só existe a partir daqui: o índice não baixa corpo (opção "C").
      const trecho = corpoTexto?.replace(/\s+/g, " ").trim().slice(0, 200) || null;

      await prisma.emailMensagem.update({
        where: { id: msg.id },
        data: { corpoHtml, corpoTexto, trecho, corpoEm: new Date() },
      });
    }
  } else if (corpoHtml) {
    imagensBloqueadas = (corpoHtml.match(/data-src-bloqueada=/g) ?? []).length;
  }

  // Marcar lido no SERVIDOR (e não só aqui) — senão o celular continua mostrando não lido.
  if (!msg.lido) {
    await comCaixa(msg.pasta.caixaId, async (c) => {
      const lock = await c.getMailboxLock(msg.pasta.caminho);
      try {
        await c.messageFlagsAdd(String(msg.uid), ["\\Seen"], { uid: true });
      } finally {
        lock.release();
      }
    }).catch(() => {
      /* marcar lido é secundário: falhar aqui não pode impedir a leitura */
    });
    await prisma.emailMensagem.update({ where: { id: msg.id }, data: { lido: true } });
  }

  return {
    id: msg.id,
    assunto: msg.assunto,
    deNome: msg.deNome,
    deEmail: msg.deEmail,
    dataEm: msg.dataEm,
    enderecos: msg.enderecos,
    anexos: msg.anexos,
    corpoHtml,
    corpoTexto,
    imagensBloqueadas,
  };
}
