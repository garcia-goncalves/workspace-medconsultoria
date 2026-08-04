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

/**
 * Último recurso, quando o servidor não põe SPECIAL-USE na pasta. Não é preciosismo: este
 * Dovecot marca `\Junk` numa pasta `Junk` que ninguém usa e deixa a `INBOX.spam` — onde o
 * filtro realmente entrega — sem selo nenhum. Sem isto, o spam de verdade apareceria como
 * uma pasta comum chamada "spam", fora de ordem e sem ícone.
 */
const POR_NOME: Array<[RegExp, PastaPapel]> = [
  [/^(spam|junk|lixo eletr[oô]nico)$/i, "JUNK"],
  [/^(trash|lixeira|deleted items?|itens exclu[ií]dos)$/i, "TRASH"],
  [/^(sent|enviados?|sent items?|sent messages)$/i, "SENT"],
  [/^(drafts?|rascunhos?)$/i, "DRAFTS"],
  [/^(archive|arquivos?|arquivados?)$/i, "ARCHIVE"],
];

/** Ordem de exibição: o que se usa mais fica em cima. */
const ORDEM: Record<string, number> = { INBOX: 0, SENT: 1, DRAFTS: 2, ARCHIVE: 3, JUNK: 8, TRASH: 9 };

export type PastaDoServidor = { caminho: string; specialUse: string | null; inscrita: boolean };
export type PastaDecidida = { caminho: string; nome: string; papel: PastaPapel | null; ordem: number };

function ultimoSegmento(caminho: string): string {
  // Separador deste servidor é ponto: "INBOX.clientes" → "clientes".
  return caminho.split(".").pop() ?? caminho;
}

/** "INBOX.antigos.clientes" → "antigos / clientes". Só usado para desempatar rótulo repetido. */
function caminhoLegivel(caminho: string): string {
  return caminho.replace(/^INBOX\./, "").split(".").join(" / ");
}

function papelDe(p: PastaDoServidor): PastaPapel | null {
  // O selo do servidor manda; o nome só decide quando não há selo.
  const porSelo = p.specialUse ? (POR_SPECIAL_USE[p.specialUse] ?? null) : null;
  if (porSelo) return porSelo;
  const nome = ultimoSegmento(p.caminho);
  return POR_NOME.find(([re]) => re.test(nome))?.[1] ?? null;
}

function rotuloAmigavel(caminho: string, papel: PastaPapel | null): string {
  if (papel === "INBOX") return "Caixa de entrada";
  if (papel === "SENT") return "Enviados";
  if (papel === "DRAFTS") return "Rascunhos";
  if (papel === "TRASH") return "Lixeira";
  if (papel === "JUNK") return "Spam";
  if (papel === "ARCHIVE") return "Arquivados";
  return ultimoSegmento(caminho);
}

/**
 * Decide o que aparece na coluna da esquerda e com que nome.
 *
 * **Só entram pastas inscritas** (`LIST ... SUBSCRIBED`) — é o que todo cliente de e-mail faz e
 * o que o webmail dele mostra. Foi o que resolveu as DUAS pastas de spam: o servidor tem `Junk`
 * (com selo `\Junk`, NÃO inscrita, ninguém usa) e `INBOX.spam` (sem selo, inscrita, é onde o
 * filtro entrega). Filtrar pelo selo teria escolhido justamente a pasta errada.
 *
 * Pura de propósito: a regra é testável sem servidor de e-mail nenhum.
 */
export function decidirPastas(doServidor: PastaDoServidor[]): PastaDecidida[] {
  // Servidor que não informa inscrição em pasta alguma não pode esvaziar a coluna.
  const algumaInscrita = doServidor.some((p) => p.inscrita);
  const visiveis = doServidor.filter(
    (p) => !algumaInscrita || p.inscrita || p.caminho.toUpperCase() === "INBOX",
  );

  const decididas = visiveis.map((p) => {
    const papel = papelDe(p);
    return { caminho: p.caminho, nome: rotuloAmigavel(p.caminho, papel), papel, ordem: papel ? (ORDEM[papel] ?? 5) : 5 };
  });

  // Rótulo repetido esconderia uma pasta atrás da outra. Mostrar o caminho é melhor que sumir
  // com pasta que pode ter mensagem dentro.
  const quantos = new Map<string, number>();
  for (const d of decididas) quantos.set(d.nome, (quantos.get(d.nome) ?? 0) + 1);
  for (const d of decididas) {
    if ((quantos.get(d.nome) ?? 0) > 1) d.nome = caminhoLegivel(d.caminho);
  }

  return decididas;
}

export async function sincronizarPastas(caixaId: string): Promise<void> {
  const doServidor = await comCaixa(caixaId, async (c) => {
    const lista = await c.list();
    return lista.map((p) => ({
      caminho: p.path,
      specialUse: p.specialUse ?? null,
      inscrita: p.subscribed === true,
    }));
  });

  // Servidor sem NENHUMA pasta não existe (a INBOX é obrigatória). Lista vazia é sinal de
  // resposta truncada — apagar tudo aqui levaria junto o cache de mensagens de todas as pastas.
  if (doServidor.length === 0) {
    throw new Error("O servidor não devolveu nenhuma pasta. Tente sincronizar de novo.");
  }

  const decididas = decidirPastas(doServidor);
  const vistos: string[] = [];

  for (const p of decididas) {
    vistos.push(p.caminho);
    await prisma.caixaPasta.upsert({
      where: { caixaId_caminho: { caixaId, caminho: p.caminho } },
      create: { caixaId, caminho: p.caminho, nome: p.nome, papel: p.papel, ordem: p.ordem },
      // Nome e papel podem mudar (renomear pasta no webmail). Os ponteiros de sync NÃO se tocam.
      update: { nome: p.nome, papel: p.papel, ordem: p.ordem },
    });
  }

  // Pasta apagada — ou desinscrita — no webmail some daqui junto com o cache dela (cascade).
  // É só cache: reinscrever no webmail traz a pasta e as mensagens de volta na próxima sync.
  await prisma.caixaPasta.deleteMany({ where: { caixaId, caminho: { notIn: vistos } } });
}

/** A pasta ainda está na caixa? Usado depois de redescobrir, porque ela pode ter sumido. */
export async function pastaExiste(caixaId: string, pastaId: string): Promise<boolean> {
  return (await prisma.caixaPasta.count({ where: { id: pastaId, caixaId } })) > 0;
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
