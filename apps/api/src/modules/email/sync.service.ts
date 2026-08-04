import { prisma } from "@app/db";
import { comCaixa } from "./imap.js";
import { extrairEnderecos, derivarThreadKey } from "./enderecos.js";

/** Uma sincronização por pasta por vez. Expira sozinha: o processo pode morrer segurando a trava. */
const TRAVA_MS = 2 * 60 * 1000;

type ParteAnexo = { nome: string; tipo: string; tamanho: number; parte: string; cid: string | null };

/** Percorre a árvore MIME e junta só o que é anexo de verdade (tem nome de arquivo ou é embutido). */
function coletarAnexos(no: unknown, saida: ParteAnexo[] = []): ParteAnexo[] {
  const n = no as {
    childNodes?: unknown[];
    disposition?: string;
    dispositionParameters?: { filename?: string };
    parameters?: { name?: string };
    part?: string;
    type?: string;
    size?: number;
    id?: string;
  };
  if (!n) return saida;

  if (n.childNodes?.length) {
    for (const filho of n.childNodes) coletarAnexos(filho, saida);
    return saida;
  }

  const nome = n.dispositionParameters?.filename ?? n.parameters?.name;
  const embutido = n.disposition === "inline" && !!n.id;
  if ((n.disposition === "attachment" || embutido) && n.part) {
    saida.push({
      nome: nome ?? "(sem nome)",
      tipo: n.type ?? "application/octet-stream",
      tamanho: n.size ?? 0,
      parte: n.part,
      cid: n.id ? n.id.replace(/^<|>$/g, "") : null,
    });
  }
  return saida;
}

/**
 * O `References` NÃO vem no ENVELOPE do IMAP — é preciso pedir a linha de cabeçalho e lê-la aqui.
 * Sem ele a conversa se parte: é a linhagem que diz quem respondeu quem.
 */
function lerReferences(headers?: Buffer): string | null {
  if (!headers) return null;
  // Cabeçalho longo vem DOBRADO: a continuação começa com espaço ou tab. Desdobra antes de ler.
  const texto = headers.toString("utf8").replace(/\r?\n[ \t]+/g, " ");
  const linha = texto.split(/\r?\n/).find((l) => /^references\s*:/i.test(l));
  if (!linha) return null;
  return linha.slice(linha.indexOf(":") + 1).trim() || null;
}

/**
 * Sincroniza UMA pasta. Idempotente e interrompível: avança por UID crescente e só move os
 * ponteiros no fim. Se o processo morrer no meio (o lsnode derruba o Node ocioso), a próxima
 * execução retoma sem duplicar e sem buraco.
 *
 * Usa QRESYNC/CONDSTORE — o servidor informa o que mudou desde o `highestModseq`, inclusive o
 * que foi APAGADO no celular. Verificado: este Dovecot anuncia as duas capacidades.
 */
export async function sincronizarPasta(
  caixaId: string,
  pastaId: string,
): Promise<{ novas: number; removidas: number }> {
  const pasta = await prisma.caixaPasta.findFirstOrThrow({
    where: { id: pastaId, caixaId },
    select: {
      id: true,
      caminho: true,
      uidValidity: true,
      ultimoUid: true,
      highestModseq: true,
      sincronizando: true,
    },
  });

  const agora = Date.now();
  if (pasta.sincronizando && agora - pasta.sincronizando.getTime() < TRAVA_MS) {
    return { novas: 0, removidas: 0 };
  }
  await prisma.caixaPasta.update({ where: { id: pasta.id }, data: { sincronizando: new Date() } });

  const caixa = await prisma.caixaEmail.findFirstOrThrow({
    where: { id: caixaId },
    select: { importarDesde: true },
  });

  try {
    return await comCaixa(caixaId, async (c) => {
      const lock = await c.getMailboxLock(pasta.caminho);
      let novas = 0;
      let removidas = 0;

      try {
        const mb = c.mailbox as { uidValidity: bigint; uidNext: number; highestModseq?: bigint; exists: number };
        const uidValidityServidor = BigInt(mb.uidValidity);

        // O servidor renumerou a pasta: tudo que está aqui é lixo. Recomeça.
        if (pasta.uidValidity !== 0n && uidValidityServidor !== pasta.uidValidity) {
          const apagadas = await prisma.emailMensagem.deleteMany({ where: { pastaId: pasta.id } });
          removidas += apagadas.count;
          await prisma.caixaPasta.update({
            where: { id: pasta.id },
            data: { uidValidity: uidValidityServidor, ultimoUid: 0, highestModseq: 0 },
          });
          pasta.ultimoUid = 0n;
          pasta.highestModseq = 0n;
        }

        // ── 1. o que mudou (marcações) e o que sumiu, desde a última vez ──
        if (pasta.highestModseq > 0n && pasta.ultimoUid > 0n) {
          // `changedSince` é opção do fetch (3º argumento) — não faz parte do range.
          for await (const m of c.fetch(
            { uid: `1:${pasta.ultimoUid}` },
            { uid: true, flags: true },
            { uid: true, changedSince: pasta.highestModseq },
          )) {
            await prisma.emailMensagem.updateMany({
              where: { pastaId: pasta.id, uid: BigInt(m.uid) },
              data: {
                lido: m.flags?.has("\\Seen") ?? false,
                respondido: m.flags?.has("\\Answered") ?? false,
              },
            });
          }

          // Apagado no celular some daqui: o servidor é a fonte da verdade.
          const aindaNoServidor = await c.search({ uid: `1:${pasta.ultimoUid}` }, { uid: true });
          const vivos = new Set((aindaNoServidor || []).map(String));
          const locais = await prisma.emailMensagem.findMany({
            where: { pastaId: pasta.id, uid: { lte: pasta.ultimoUid } },
            select: { id: true, uid: true },
          });
          const sumiram = locais.filter((l) => !vivos.has(String(l.uid))).map((l) => l.id);
          if (sumiram.length) {
            const r = await prisma.emailMensagem.deleteMany({ where: { id: { in: sumiram } } });
            removidas += r.count;
          }
        }

        // ── 2. as novas ──
        if (mb.exists > 0 && mb.uidNext > Number(pasta.ultimoUid) + 1) {
          for await (const m of c.fetch(
            { uid: `${pasta.ultimoUid + 1n}:*` },
            { uid: true, flags: true, envelope: true, bodyStructure: true, size: true, headers: ["references"] },
            { uid: true },
          )) {
            const env = m.envelope;
            if (!env) continue;

            const dataEm = env.date ?? new Date();
            // Primeira sincronização tem janela: caixa antiga não pode virar espera de 40 minutos.
            if (caixa.importarDesde && dataEm < caixa.importarDesde) continue;

            const de = env.from?.[0];
            const enderecos = extrairEnderecos(env);
            const anexos = coletarAnexos(m.bodyStructure);
            const referencias = lerReferences(m.headers);

            await prisma.emailMensagem.upsert({
              where: { pastaId_uid: { pastaId: pasta.id, uid: BigInt(m.uid) } },
              update: { lido: m.flags?.has("\\Seen") ?? false },
              create: {
                caixaId,
                pastaId: pasta.id,
                uid: BigInt(m.uid),
                messageId: env.messageId?.slice(0, 512) ?? null,
                inReplyTo: env.inReplyTo?.slice(0, 512) ?? null,
                referencias,
                threadKey:
                  derivarThreadKey({
                    messageId: env.messageId,
                    inReplyTo: env.inReplyTo,
                    referencias,
                  })?.slice(0, 512) ?? null,
                deNome: de?.name?.trim() || null,
                deEmail: (de?.address ?? "").toLowerCase(),
                assunto: env.subject ?? null,
                dataEm,
                lido: m.flags?.has("\\Seen") ?? false,
                respondido: m.flags?.has("\\Answered") ?? false,
                temAnexo: anexos.length > 0,
                tamanho: m.size ?? null,
                enderecos: { create: enderecos },
                anexos: { create: anexos },
              },
            });
            novas += 1;
          }
        }

        // ── 3. ponteiros e contadores, SÓ no fim ──
        const status = await c.status(pasta.caminho, { messages: true, unseen: true });
        await prisma.caixaPasta.update({
          where: { id: pasta.id },
          data: {
            uidValidity: uidValidityServidor,
            ultimoUid: BigInt(Math.max(Number(pasta.ultimoUid), mb.uidNext - 1)),
            highestModseq: mb.highestModseq ? BigInt(mb.highestModseq) : pasta.highestModseq,
            total: status.messages ?? 0,
            naoLidos: status.unseen ?? 0,
          },
        });
      } finally {
        lock.release();
      }

      await prisma.caixaEmail.update({
        where: { id: caixaId },
        data: { ultimaSyncEm: new Date(), estado: "OK", ultimoErro: null },
      });
      return { novas, removidas };
    });
  } finally {
    await prisma.caixaPasta
      .update({ where: { id: pasta.id }, data: { sincronizando: null } })
      .catch(() => {});
  }
}
