import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * O CURSOR DE PAGINAÇÃO da API do agente — opaco por fora, assinado por dentro.
 *
 * A ordenação é `createdAt DESC, id DESC` (par TOTAL: `id` é único, então não há empate
 * possível e nenhuma linha pode ser pulada ou repetida entre duas páginas). O cursor carrega
 * exatamente esse par.
 *
 * ⚠️ **POR QUE ASSINADO, e não só base64.** Sem assinatura, `createdAt` e `id` viram entrada
 * de usuário: quem chama escolheria de onde a página começa. Isso não vaza tarefa de outra
 * pessoa (o filtro por responsável continua valendo em cima), mas transforma um valor que o
 * contrato declara **opaco** em parâmetro manipulável — e a CORA pediu explicitamente que
 * cursor adulterado responda `400 INVALID_INPUT`, o que só é possível se dá para DETECTAR a
 * adulteração. Base64 sozinho não detecta nada: todo palpite é "válido".
 *
 * A chave é o `SESSION_SECRET`, com rótulo próprio no HMAC para não colidir com outro uso.
 * Consequência aceita e documentada no contrato: trocar o segredo invalida os cursores em voo
 * — a Cora recomeça a listagem, que é o comportamento certo para um valor efêmero.
 */

const ROTULO = "agent-v1:tasks-cursor";

export interface PosicaoDoCursor {
  createdAt: Date;
  id: string;
}

function assinar(corpo: string, segredo: string): string {
  return createHmac("sha256", segredo).update(`${ROTULO}\n${corpo}`).digest("base64url");
}

export function codificarCursor(pos: PosicaoDoCursor, segredo: string): string {
  const corpo = Buffer.from(`${pos.createdAt.toISOString()}|${pos.id}`, "utf8").toString("base64url");
  return `${corpo}.${assinar(corpo, segredo)}`;
}

/** Devolve `null` para QUALQUER cursor que não seja exatamente um que nós emitimos. */
export function decodificarCursor(cursor: string, segredo: string): PosicaoDoCursor | null {
  const partes = cursor.split(".");
  if (partes.length !== 2) return null;
  const [corpo, assinatura] = partes;
  if (!corpo || !assinatura) return null;

  const esperada = Buffer.from(assinar(corpo, segredo), "utf8");
  const recebida = Buffer.from(assinatura, "utf8");
  if (esperada.length !== recebida.length) return null;
  if (!timingSafeEqual(esperada, recebida)) return null;

  const texto = Buffer.from(corpo, "base64url").toString("utf8");
  const sep = texto.indexOf("|");
  if (sep < 0) return null;
  const createdAt = new Date(texto.slice(0, sep));
  const id = texto.slice(sep + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}
