export type EnderecoBruto = { name?: string | null; address?: string | null };

type EnvelopeParcial = {
  from?: EnderecoBruto[] | null;
  to?: EnderecoBruto[] | null;
  cc?: EnderecoBruto[] | null;
  bcc?: EnderecoBruto[] | null;
  replyTo?: EnderecoBruto[] | null;
};

export type PapelEndereco = "DE" | "PARA" | "CC" | "CCO" | "RESPONDER_A";

/** Minúsculo, sem espaço e sem os `<>` que alguns servidores mandam. É a chave do vínculo. */
export function normalizarEndereco(e: string): string {
  return e.trim().replace(/^<|>$/g, "").trim().toLowerCase();
}

const MAPA: Array<[keyof EnvelopeParcial, PapelEndereco]> = [
  ["from", "DE"],
  ["to", "PARA"],
  ["cc", "CC"],
  ["bcc", "CCO"],
  ["replyTo", "RESPONDER_A"],
];

export function extrairEnderecos(env: EnvelopeParcial) {
  const saida: Array<{ papel: PapelEndereco; nome: string | null; endereco: string }> = [];
  for (const [campo, papel] of MAPA) {
    for (const item of env[campo] ?? []) {
      if (!item?.address) continue; // grupos e entradas malformadas não viram vínculo
      saida.push({ papel, nome: item.name?.trim() || null, endereco: normalizarEndereco(item.address) });
    }
  }
  return saida;
}

/**
 * Raiz da conversa. `References` guarda a linhagem em ordem — o primeiro item é quem começou.
 * Cair no `In-Reply-To` e, por fim, no próprio `Message-ID` cobre respostas de clientes que
 * não mandam `References` (acontece bastante com celular).
 */
export function derivarThreadKey(a: {
  messageId?: string | null;
  inReplyTo?: string | null;
  referencias?: string | null;
}): string | null {
  const primeira = a.referencias?.trim().split(/\s+/).filter(Boolean)[0];
  return primeira || a.inReplyTo?.trim() || a.messageId?.trim() || null;
}
