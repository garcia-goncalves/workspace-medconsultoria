import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * O `approvalToken` da Fase 2 (CORA-003) — o que a Thaís aprovou, assinado.
 *
 * ⚠️ **O TOKEN NÃO É CRACHÁ, É RECIBO DO QUE FOI APROVADO.** Ele não diz "pode escrever" — quem
 * diz isso é a delegação e o escopo. Ele diz *"foi exatamente ISTO que a pessoa leu e
 * aprovou"*, e é por isso que carrega o hash dos argumentos e a resolução com os **rótulos como
 * foram exibidos**. Sem isso, a aprovação da Thaís cobriria uma montagem parecida, e entre uma
 * coisa e outra cabe qualquer coisa.
 *
 * ⚠️ **SEM ESTADO NA PRÉVIA, DE PROPÓSITO.** A prévia é leitura pura: refazê-la não pode custar
 * nada nem sujar tabela. Se o token fosse uma linha gravada, cada prévia descartada (e elas são
 * a maioria — a Cora refaz a prévia a cada desambiguação) deixaria lixo que cresce para sempre,
 * que é a lição do `ActivityLog` na ADR-148. O que consome o token é o `INSERT` do `jti` na
 * hora de **executar** — ver `AgentIdempotency`.
 *
 * ⚠️ **OPACO POR CONTRATO.** É base64url legível, não cifrado: não há segredo dentro (só ids e
 * rótulos que a Cora acabou de receber na resposta da prévia). O contrato declara o valor
 * opaco pelo mesmo motivo do cursor — para ninguém do outro lado passar a depender do formato
 * e quebrar no dia em que acrescentarmos um campo.
 */

const ROTULO = "agent-v1:approval";

/** Quanto vale um token. Higiene, não defesa — a defesa é revalidar no instante de executar. */
export const MINUTOS_DA_APROVACAO = 15;

export type TipoDeReferencia = "cliente" | "projeto" | "responsavel";

/** Uma referência resolvida, do jeito que foi MOSTRADA a quem aprovou. */
export interface ReferenciaResolvida {
  tipo: TipoDeReferencia;
  id: string;
  rotulo: string;
}

/**
 * Os argumentos que serão gravados. É sobre esta forma — e só sobre ela — que o `argsHash`
 * é calculado nos dois lados (na prévia, para assinar; na execução, para comparar).
 */
export interface ArgumentosDaTarefa {
  titulo: string;
  prioridade: "BAIXA" | "NORMAL" | "ALTA";
  /** ISO 8601, ou `null`. ⚠️ Ausência de prazo nunca vira prazo inventado. */
  prazo: string | null;
  clienteId: string | null;
  projetoId: string | null;
  responsavelIds: string[];
}

/**
 * FORMA CANÔNICA dos argumentos.
 *
 * ⚠️ **Existe para um `409` falso não nascer de uma diferença que não é diferença.** Reformatar
 * o JSON, mandar as chaves em outra ordem, trocar `-03:00` por `Z`, deixar um espaço no fim do
 * título — nada disso muda o que a Thaís aprovou, e sem canonização cada um desses viraria
 * "argumento alterado". A Cora passaria a desconfiar do servidor por um defeito nosso.
 *
 * A ordem das chaves é fixada pelo literal abaixo; a lista de responsáveis é deduplicada e
 * ordenada; a data vai para UTC.
 */
export function formaCanonicaDosArgumentos(a: ArgumentosDaTarefa): string {
  return JSON.stringify({
    // ⚠️ **NFC.** "ç" composto e "ç" decomposto são o MESMO título aos olhos de quem aprovou, e
    // sem normalizar dariam hashes diferentes — um `APPROVAL_MISMATCH` falso, que é justamente o
    // que esta forma canônica existe para evitar. Achado do revisor de segurança.
    titulo: a.titulo.normalize("NFC").trim(),
    prioridade: a.prioridade,
    prazo: a.prazo ? new Date(a.prazo).toISOString() : null,
    clienteId: a.clienteId ?? null,
    projetoId: a.projetoId ?? null,
    responsavelIds: [...new Set(a.responsavelIds)].sort(),
  });
}

export function hashDosArgumentos(a: ArgumentosDaTarefa): string {
  return createHash("sha256").update(formaCanonicaDosArgumentos(a), "utf8").digest("hex");
}

const ROTULO_DA_RESOLUCAO = "agent-v1:resolution";

/** FORMA CANÔNICA da resolução — ids **e rótulos**, em ordem estável. */
function canonizarResolucao(refs: readonly ReferenciaResolvida[]): string {
  const ordenadas = [...refs]
    .map((r) => [r.tipo, r.id, r.rotulo] as const)
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return JSON.stringify(ordenadas);
}

/**
 * O `resolutionHash` — e ele **não é um hash cru, é um selo opaco, determinístico e assinado**.
 *
 * ⚠️ **A CORA PEDIU `mudou: [...]` COM O QUE SAIU E O QUE ENTROU, E UM HASH CRU NÃO ENTREGA
 * ISSO.** De um SHA-256 só dá para dizer *"está diferente"*; para dizer **o quê** é preciso ter
 * a resolução anterior em mãos. Guardá-la do nosso lado exigiria gravar toda prévia — e a
 * prévia é leitura pura de propósito, refeita a cada desambiguação, então a tabela cresceria
 * para sempre (a lição do `ActivityLog`, ADR-148). Então a resolução anterior viaja **dentro do
 * próprio valor**, assinada.
 *
 * ⚠️ **Continua valendo tudo o que um hash valia:** é **determinístico** (a mesma resolução
 * produz exatamente a mesma string, então comparar por igualdade continua sendo o teste de
 * "mudou?"), é **opaco por contrato** e é **inviolável** — resolução adulterada não passa pela
 * assinatura, e sem isso `previousResolutionHash` viraria entrada de fora capaz de fabricar um
 * "não mudou nada".
 *
 * ⚠️ **Não entra relógio nem nada aleatório aqui.** Um carimbo de tempo dentro do selo faria
 * duas prévias idênticas produzirem valores diferentes, e a comparação por igualdade — que é o
 * uso principal do outro lado — passaria a acusar mudança que não existe.
 */
export function selarResolucao(refs: readonly ReferenciaResolvida[], segredo: string): string {
  const payload = Buffer.from(canonizarResolucao(refs), "utf8").toString("base64url");
  return `${payload}.${assinarCom(ROTULO_DA_RESOLUCAO, payload, segredo)}`;
}

/** Abre um selo de resolução. `null` para qualquer valor que não tenhamos emitido. */
export function abrirResolucao(selo: string, segredo: string): ReferenciaResolvida[] | null {
  const partes = selo.split(".");
  if (partes.length !== 2) return null;
  const [payload, assinatura] = partes;
  if (!payload || !assinatura) return null;
  const esperada = Buffer.from(assinarCom(ROTULO_DA_RESOLUCAO, payload, segredo), "utf8");
  const recebida = Buffer.from(assinatura, "utf8");
  if (esperada.length !== recebida.length) return null;
  if (!timingSafeEqual(esperada, recebida)) return null;
  try {
    const cru: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Array.isArray(cru)) return null;
    return cru.map((t) => {
      const [tipo, id, rotulo] = t as [TipoDeReferencia, string, string];
      return { tipo, id, rotulo };
    });
  } catch {
    return null;
  }
}

export interface CorpoDoToken {
  v: 1;
  /** Identificador único do token. É ele que o `INSERT` consome — ver `AgentIdempotency.jti`. */
  jti: string;
  /** Quem aprovou. Vem do token da delegação, nunca do payload. */
  sub: string;
  /** Que serviço pediu a prévia. Token da Cora não vale para outro programa. */
  cli: string;
  /** SHA-256 dos argumentos aprovados. */
  ah: string;
  /** O SELO da resolução aprovada (ver `selarResolucao`). */
  rh: string;
  /** A resolução inteira, com os rótulos como exibidos — é dela que sai o diff do `409`. */
  res: [TipoDeReferencia, string, string][];
  /** Epoch em segundos. */
  exp: number;
}

/**
 * HMAC com RÓTULO próprio por uso.
 *
 * ⚠️ O rótulo não é enfeite: sem ele, um selo de resolução e um corpo de token com o mesmo texto
 * teriam a mesma assinatura, e um valor emitido para um uso passaria a valer no outro. É a mesma
 * precaução que o cursor da Fase 1 já tomava.
 */
function assinarCom(rotulo: string, corpo: string, segredo: string): string {
  return createHmac("sha256", segredo).update(`${rotulo}\n${corpo}`).digest("base64url");
}

function assinar(corpo: string, segredo: string): string {
  return assinarCom(ROTULO, corpo, segredo);
}

export interface AprovacaoEmitida {
  token: string;
  jti: string;
  expiraEm: Date;
  resolutionHash: string;
}

export function emitirAprovacao(
  dados: {
    requesterUserId: string;
    clientId: string;
    argumentos: ArgumentosDaTarefa;
    referencias: readonly ReferenciaResolvida[];
  },
  segredo: string,
  agora: Date = new Date(),
): AprovacaoEmitida {
  const jti = randomUUID();
  const expiraEm = new Date(agora.getTime() + MINUTOS_DA_APROVACAO * 60_000);
  const rh = selarResolucao(dados.referencias, segredo);
  const corpo: CorpoDoToken = {
    v: 1,
    jti,
    sub: dados.requesterUserId,
    cli: dados.clientId,
    ah: hashDosArgumentos(dados.argumentos),
    rh,
    res: dados.referencias.map((r) => [r.tipo, r.id, r.rotulo]),
    exp: Math.floor(expiraEm.getTime() / 1000),
  };
  const payload = Buffer.from(JSON.stringify(corpo), "utf8").toString("base64url");
  return { token: `${payload}.${assinar(payload, segredo)}`, jti, expiraEm, resolutionHash: rh };
}

export type MotivoDaAprovacaoInvalida =
  | "MALFORMADO"
  | "ASSINATURA"
  | "OUTRA_PESSOA"
  | "OUTRO_SERVICO"
  | "EXPIRADO";

export type LeituraDaAprovacao =
  | { ok: true; corpo: CorpoDoToken }
  | { ok: false; motivo: MotivoDaAprovacaoInvalida };

/**
 * Confere um `approvalToken`.
 *
 * ⚠️ **A ordem é deliberada: assinatura primeiro.** Só depois de saber que o corpo é nosso é que
 * faz sentido ler `sub`, `cli` ou `exp` — antes disso são campos escolhidos por quem chama.
 *
 * ⚠️ **`sub` e `cli` são conferidos contra a autenticação DESTA chamada.** Sem isso, um token
 * emitido para uma pessoa executaria em nome de outra — que é exatamente o buraco que a
 * separação entre serviço e delegação existe para fechar.
 */
export function lerAprovacao(
  token: string,
  esperado: { requesterUserId: string; clientId: string },
  segredo: string,
  agora: Date = new Date(),
): LeituraDaAprovacao {
  const partes = token.split(".");
  if (partes.length !== 2) return { ok: false, motivo: "MALFORMADO" };
  const [payload, assinatura] = partes;
  if (!payload || !assinatura) return { ok: false, motivo: "MALFORMADO" };

  const esperada = Buffer.from(assinar(payload, segredo), "utf8");
  const recebida = Buffer.from(assinatura, "utf8");
  if (esperada.length !== recebida.length) return { ok: false, motivo: "ASSINATURA" };
  if (!timingSafeEqual(esperada, recebida)) return { ok: false, motivo: "ASSINATURA" };

  let corpo: CorpoDoToken;
  try {
    corpo = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CorpoDoToken;
  } catch {
    return { ok: false, motivo: "MALFORMADO" };
  }
  // Assinatura válida com corpo de outra forma = token de uma versão que não é esta. Recusar é
  // a única resposta honesta: "mais ou menos compatível" é como um campo novo passa despercebido.
  if (
    corpo?.v !== 1 ||
    typeof corpo.jti !== "string" ||
    typeof corpo.sub !== "string" ||
    typeof corpo.cli !== "string" ||
    typeof corpo.ah !== "string" ||
    typeof corpo.rh !== "string" ||
    !Array.isArray(corpo.res) ||
    typeof corpo.exp !== "number"
  ) {
    return { ok: false, motivo: "MALFORMADO" };
  }

  if (corpo.sub !== esperado.requesterUserId) return { ok: false, motivo: "OUTRA_PESSOA" };
  if (corpo.cli !== esperado.clientId) return { ok: false, motivo: "OUTRO_SERVICO" };
  if (corpo.exp * 1000 <= agora.getTime()) return { ok: false, motivo: "EXPIRADO" };

  return { ok: true, corpo };
}

/** As referências que estavam dentro do token, de volta na forma de objeto. */
export function referenciasDoToken(corpo: {
  res: [TipoDeReferencia, string, string][];
}): ReferenciaResolvida[] {
  return corpo.res.map(([tipo, id, rotulo]) => ({ tipo, id, rotulo }));
}
