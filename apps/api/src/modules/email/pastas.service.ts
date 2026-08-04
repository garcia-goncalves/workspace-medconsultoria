import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { PastaPapel } from "@app/db";
import { comCaixa } from "./imap.js";

/**
 * Papel da pasta vem do SPECIAL-USE do servidor (verificado: este Dovecot manda `\Inbox`,
 * `\Sent`, `\Drafts`, `\Junk`, `\Trash`). Adivinhar por nome só entra como último recurso,
 * porque o nome muda com o idioma do webmail.
 */
const POR_SPECIAL_USE: Record<string, PastaPapel> = {
  "\\Inbox": "INBOX",
  "\\Sent": "SENT",
  "\\Drafts": "DRAFTS",
  "\\Trash": "TRASH",
  "\\Junk": "JUNK",
  "\\Archive": "ARCHIVE",
};

/** Ordem de exibição: o que se usa mais fica em cima. */
const ORDEM: Record<string, number> = { INBOX: 0, SENT: 1, DRAFTS: 2, ARCHIVE: 3, JUNK: 8, TRASH: 9 };

function rotuloAmigavel(caminho: string, papel: PastaPapel | null): string {
  if (papel === "INBOX") return "Caixa de entrada";
  if (papel === "SENT") return "Enviados";
  if (papel === "DRAFTS") return "Rascunhos";
  if (papel === "TRASH") return "Lixeira";
  if (papel === "JUNK") return "Spam";
  if (papel === "ARCHIVE") return "Arquivados";
  // Separador deste servidor é ponto: "INBOX.clientes" → "clientes".
  return caminho.split(".").pop() ?? caminho;
}

export async function sincronizarPastas(caixaId: string): Promise<void> {
  const doServidor = await comCaixa(caixaId, async (c) => {
    const lista = await c.list();
    return lista.map((p) => ({ caminho: p.path, specialUse: p.specialUse ?? null }));
  });

  // Servidor sem NENHUMA pasta não existe (a INBOX é obrigatória). Lista vazia é sinal de
  // resposta truncada — apagar tudo aqui levaria junto o cache de mensagens de todas as pastas.
  if (doServidor.length === 0) {
    throw new Error("O servidor não devolveu nenhuma pasta. Tente sincronizar de novo.");
  }

  const vistos: string[] = [];

  for (const p of doServidor) {
    const papel = p.specialUse ? (POR_SPECIAL_USE[p.specialUse] ?? null) : null;
    vistos.push(p.caminho);
    await prisma.caixaPasta.upsert({
      where: { caixaId_caminho: { caixaId, caminho: p.caminho } },
      create: {
        caixaId,
        caminho: p.caminho,
        nome: rotuloAmigavel(p.caminho, papel),
        papel,
        ordem: papel ? (ORDEM[papel] ?? 5) : 5,
      },
      // Nome e papel podem mudar (renomear pasta no webmail). Os ponteiros de sync NÃO se tocam.
      update: { nome: rotuloAmigavel(p.caminho, papel), papel, ordem: papel ? (ORDEM[papel] ?? 5) : 5 },
    });
  }

  // Pasta apagada no webmail some daqui junto com as mensagens dela (cascade).
  await prisma.caixaPasta.deleteMany({ where: { caixaId, caminho: { notIn: vistos } } });
}

export async function listarPastas(userId: string, caixaId: string) {
  const caixa = await prisma.caixaEmail.findFirst({
    where: { id: caixaId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!caixa) throw new TRPCError({ code: "NOT_FOUND", message: "Caixa não encontrada." });

  // Caixa sem NENHUMA pasta = a descoberta ainda não rodou (ou falhou ao plugar). Roda agora:
  // sem isto, a pessoa vê a caixa conectada e nenhuma Caixa de entrada — que foi exatamente o
  // que aconteceu com a primeira caixa plugada de verdade. Só acontece quando está vazio, então
  // não pesa no uso normal; se o servidor estiver fora, a lista volta vazia em vez de estourar.
  if ((await prisma.caixaPasta.count({ where: { caixaId } })) === 0) {
    try {
      await sincronizarPastas(caixaId);
    } catch {
      /* servidor fora do ar: devolve o que houver e a próxima abertura tenta de novo */
    }
  }

  return prisma.caixaPasta.findMany({
    where: { caixaId },
    select: { id: true, caminho: true, nome: true, papel: true, naoLidos: true, total: true },
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
  });
}
