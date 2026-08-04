import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { prisma } from "@app/db";
import { comCaixa } from "./imap.js";
import { caixaDoUsuario } from "./envio.service.js";

export type SalvarRascunhoInput = {
  caixaId: string;
  para: string[];
  cc: string[];
  cco: string[];
  assunto: string;
  corpoHtml: string;
  /** UID (no servidor) do rascunho gravado da vez anterior — para regravar por cima dele. */
  uidAnterior?: number;
};

/**
 * Grava o que a pessoa está escrevendo na pasta Drafts do SERVIDOR — não só dentro da app
 * (reverte o ADR-95 §2, de propósito; a reversão vira ADR novo na Tarefa 9). Sem isto, fechar a
 * janela por engano ou a aba cair perde o e-mail inteiro, e o rascunho não aparece no celular
 * nem no webmail da pessoa.
 *
 * IMAP não edita mensagem: cada gravação é um `APPEND` novo. A ORDEM importa — grava a nova
 * primeiro e só DEPOIS remove a anterior (dentro da MESMA conexão). Ao contrário, uma falha no
 * meio deixaria a pessoa sem rascunho nenhum; nesta ordem, o pior caso é uma duplicata cosmética
 * na pasta (que a próxima gravação bem-sucedida resolve sozinha).
 */
export async function salvarRascunho(userId: string, input: SalvarRascunhoInput): Promise<{ uid: number | null }> {
  // Posse da caixa — o MESMO caminho do envio (Tarefa 3). `comCaixa` não filtra por dono: só é
  // seguro chamá-lo com um `caixaId` que já passou por aqui.
  const caixa = await caixaDoUsuario(userId, input.caixaId);

  // Caixa sem pasta de rascunhos é possível (servidor sem SPECIAL-USE reconhecido para Drafts, ou
  // sincronização de pastas que ainda não rodou). Perder o texto da pessoa por causa de uma pasta
  // ausente seria pior que simplesmente não salvar — por isso devolve `{ uid: null }` sem estourar.
  const drafts = await prisma.caixaPasta.findFirst({
    where: { caixaId: caixa.id, papel: "DRAFTS" },
    select: { caminho: true },
  });
  if (!drafts) return { uid: null };

  // Mesma composição do envio (Tarefa 3), sem anexo e sem mandar nada: um rascunho não tem os
  // cabeçalhos de conversa (`inReplyTo`/`references`) porque ainda não é uma resposta enviada.
  const composer = new MailComposer({
    from: { name: caixa.nomeExibicao, address: caixa.email },
    to: input.para,
    cc: input.cc,
    bcc: input.cco,
    subject: input.assunto,
    html: input.corpoHtml,
  });
  const mime: Buffer = await new Promise((ok, falhou) => {
    composer.compile().build((erro, buffer) => (erro ? falhou(erro) : ok(buffer)));
  });

  // Tudo dentro de UMA conexão: `comCaixa` fecha o socket assim que o callback retorna, então
  // gravar a nova e remover a antiga têm de acontecer aqui dentro, nesta ordem.
  return comCaixa(caixa.id, async (c) => {
    const gravado = await c.append(drafts.caminho, mime, ["\\Draft"]);
    const uidNovo = gravado && typeof gravado.uid === "number" ? gravado.uid : null;

    // Só remove a versão anterior DEPOIS de gravar a nova — nunca antes (0.3 do brief). Se a
    // remoção falhar, a pessoa fica com uma duplicata no webmail (cosmético), nunca sem rascunho.
    if (input.uidAnterior !== undefined) {
      try {
        const lock = await c.getMailboxLock(drafts.caminho);
        try {
          // `messageDelete` com `uid: true` faz STORE +FLAGS \Deleted seguido de UID EXPUNGE
          // (este servidor tem UIDPLUS) — expurga só a mensagem apontada, nunca a pasta inteira.
          // Um `EXPUNGE` cego apagaria também rascunhos de outras composições que a pessoa tenha
          // marcado \Deleted no webmail.
          await c.messageDelete(String(input.uidAnterior), { uid: true });
        } finally {
          lock.release();
        }
      } catch {
        /* a gravação nova já aconteceu — não remover a antiga é cosmético, não perda */
      }
    }

    return { uid: uidNovo };
  });
}
