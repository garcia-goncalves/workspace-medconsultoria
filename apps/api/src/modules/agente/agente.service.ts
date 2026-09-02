import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@app/db";

/**
 * A API DO AGENTE (ADR-149) — quem pode chamar, e em nome de quem.
 *
 * SÃO DUAS IDENTIDADES, E ELAS NÃO PODEM VIRAR UMA:
 *
 *  1. **O serviço** (`AgentClient`) responde "que PROGRAMA está falando" — hoje, a Cora.
 *  2. **A delegação** (`AgentDelegation`) responde "em nome de QUE PESSOA" — e é a única
 *     origem do `requesterUserId`.
 *
 * ⚠️ `userId` no corpo, na query ou num cabeçalho livre **não autentica nada**. Este arquivo é
 * o único lugar que decide quem é o usuário de uma chamada de agente; nenhuma rota pode
 * receber isso de fora. É o requisito duro da seção 6 do briefing da Cora, e é o mesmo motivo
 * pelo qual `clienteId` vem da sessão e nunca do input no `portalProcedure`.
 *
 * ⚠️ **POR QUE SHA-256 E NÃO argon2 AQUI.** Senha de gente é de baixa entropia e precisa de
 * hash caro. Estes dois segredos são 32 bytes sorteados por nós (256 bits): não há dicionário
 * a percorrer, e o custo de um argon2 por requisição seria o amplificador que a ADR-148
 * consertou no login — a API do agente é chamada em laço por um programa, não uma vez por
 * pessoa por dia. O que protege aqui é a entropia do segredo, não a lentidão da conferência.
 *
 * ⚠️ **O que NÃO fica guardado:** nem o segredo do serviço nem o token bruto. Só o hash. O
 * valor bruto existe uma vez, na saída do comando que o emitiu (`scripts/agente.ts`).
 */

/** Escopos que existem hoje. Lista de LIBERAÇÃO com padrão NEGAR: escopo novo nasce fechado. */
export const ESCOPOS_CONHECIDOS = ["tasks:read"] as const;
export type EscopoDeAgente = (typeof ESCOPOS_CONHECIDOS)[number];

/** Cabeçalhos do transporte. Ficam aqui para o contrato e o código não divergirem. */
export const CABECALHO_CLIENTE = "x-agent-client";
export const CABECALHO_SEGREDO = "x-agent-secret";

function hashDeSegredo(bruto: string): string {
  return createHash("sha256").update(bruto, "utf8").digest("hex");
}

/** Comparação em tempo constante entre dois hashes hex do mesmo tamanho. */
function hashesIguais(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

function gerarSegredo(): string {
  return randomBytes(32).toString("base64url");
}

/** Normaliza a lista de escopos: sem vazios, sem duplicata, ordem estável. */
export function normalizarEscopos(escopos: readonly string[]): string[] {
  return [...new Set(escopos.map((e) => e.trim()).filter(Boolean))].sort();
}

/** Motivos de recusa. Cada um vira um par (HTTP, código) na rota — ver `agent-v1.ts`. */
export type MotivoDaRecusa =
  | "SEM_CREDENCIAL"
  | "CLIENTE_INVALIDO"
  | "TOKEN_INVALIDO"
  | "DELEGACAO_EXPIRADA"
  | "DELEGACAO_REVOGADA"
  | "USUARIO_SEM_ACESSO"
  | "ESCOPO_INSUFICIENTE";

export type ResultadoDaAutenticacao =
  | {
      ok: true;
      /** Vem do TOKEN. Nunca do payload. */
      requesterUserId: string;
      role: string;
      escopos: string[];
      delegationId: string;
      clientId: string;
    }
  | { ok: false; motivo: MotivoDaRecusa };

export interface CredenciaisRecebidas {
  clientId?: string;
  clientSecret?: string;
  bearer?: string;
}

/**
 * Autentica uma chamada de agente e devolve quem é o usuário delegado.
 *
 * A ordem das conferências é deliberada: primeiro o SERVIÇO, depois a DELEGAÇÃO, depois a
 * PESSOA, depois o ESCOPO. Assim um token de delegação vazado não diz nada a quem não tem
 * também o segredo do serviço, e uma pessoa desativada é barrada mesmo com token válido.
 */
export async function autenticarChamadaDeAgente(
  cred: CredenciaisRecebidas,
  escopoExigido: EscopoDeAgente,
): Promise<ResultadoDaAutenticacao> {
  const clientId = cred.clientId?.trim();
  const clientSecret = cred.clientSecret?.trim();
  const token = cred.bearer?.trim();
  if (!clientId || !clientSecret || !token) return { ok: false, motivo: "SEM_CREDENCIAL" };

  const client = await prisma.agentClient.findUnique({ where: { id: clientId } });
  if (!client || !client.ativo || client.revogadoEm) return { ok: false, motivo: "CLIENTE_INVALIDO" };
  if (!hashesIguais(client.segredoHash, hashDeSegredo(clientSecret))) {
    return { ok: false, motivo: "CLIENTE_INVALIDO" };
  }

  const delegacao = await prisma.agentDelegation.findUnique({
    where: { tokenHash: hashDeSegredo(token) },
    include: { user: { select: { id: true, role: true, ativo: true, deletedAt: true, acessoRevogadoEm: true } } },
  });
  if (!delegacao) return { ok: false, motivo: "TOKEN_INVALIDO" };
  // ⚠️ A delegação é PRESA ao serviço que a recebeu: token da Cora não vale para outro programa.
  if (delegacao.clientId !== client.id) return { ok: false, motivo: "TOKEN_INVALIDO" };
  if (delegacao.revogadaEm) return { ok: false, motivo: "DELEGACAO_REVOGADA" };
  if (delegacao.expiraEm <= new Date()) return { ok: false, motivo: "DELEGACAO_EXPIRADA" };

  // ⚠️ A PESSOA é revalidada A CADA CHAMADA, não só na emissão. Delegação de 8 horas emitida
  // de manhã não pode continuar valendo depois de o acesso da pessoa ser cortado ao meio-dia.
  const u = delegacao.user;
  if (!u.ativo || u.deletedAt || u.acessoRevogadoEm) return { ok: false, motivo: "USUARIO_SEM_ACESSO" };
  // A tarefa interna é da EQUIPE. Conta de Portal (papel CLIENTE) não tem o que ler aqui — é a
  // mesma régua do `funcionarioProcedure`, que exclui CLIENTE do lado humano.
  if (u.role === "CLIENTE") return { ok: false, motivo: "USUARIO_SEM_ACESSO" };

  const escopos = normalizarEscopos(delegacao.escopos.split(/\s+/));
  if (!escopos.includes(escopoExigido)) return { ok: false, motivo: "ESCOPO_INSUFICIENTE" };

  // Carimbo de uso — serve à lista de delegações e à pergunta "esta credencial ainda é usada?".
  // Best-effort: não pode derrubar a chamada, e o painel de erros já mostra queda de banco.
  void prisma.agentDelegation
    .update({ where: { id: delegacao.id }, data: { ultimoUsoEm: new Date() } })
    .catch(() => {});

  return {
    ok: true,
    requesterUserId: u.id,
    role: u.role,
    escopos,
    delegationId: delegacao.id,
    clientId: client.id,
  };
}

// ─────────────────────────────────────────────────────────────
// Emissão e revogação (usadas pelo comando `pnpm agente:*`)
// ─────────────────────────────────────────────────────────────

export async function criarClienteDeAgente(nome: string): Promise<{ id: string; segredo: string }> {
  const segredo = gerarSegredo();
  const client = await prisma.agentClient.create({
    data: { nome: nome.trim(), segredoHash: hashDeSegredo(segredo) },
  });
  return { id: client.id, segredo };
}

export async function emitirDelegacao(opts: {
  clientId: string;
  userId: string;
  escopos: string[];
  minutos: number;
  criadaPorId?: string | null;
}): Promise<{ id: string; token: string; expiraEm: Date }> {
  const token = gerarSegredo();
  // `minutos` negativo emite delegação JÁ EXPIRADA — é como se prova o T2 sem esperar o relógio.
  const expiraEm = new Date(Date.now() + opts.minutos * 60_000);
  const delegacao = await prisma.agentDelegation.create({
    data: {
      clientId: opts.clientId,
      userId: opts.userId,
      tokenHash: hashDeSegredo(token),
      escopos: normalizarEscopos(opts.escopos).join(" "),
      expiraEm,
      criadaPorId: opts.criadaPorId ?? null,
    },
  });
  return { id: delegacao.id, token, expiraEm };
}

/** Revogação com efeito na PRÓXIMA chamada — não há cache de token em memória. */
export async function revogarDelegacao(id: string): Promise<boolean> {
  const res = await prisma.agentDelegation.updateMany({
    where: { id, revogadaEm: null },
    data: { revogadaEm: new Date() },
  });
  return res.count === 1;
}
