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
    // O "gravar por cima" INTEIRO depende de UIDPLUS, e nada garante a extensão: `descobrirServidor`
    // (`imap.ts`) deriva `mail.<domínio>` de qualquer endereço digitado, então a garantia é do
    // servidor de hoje, não da estrutura. Sem a extensão, as duas metades quebram: o `append` não
    // devolve UID (não sobra a que apontar depois) e o `messageDelete(uid: true)` degrada, DENTRO
    // do imapflow, para um `EXPUNGE` cego — que apaga TODA mensagem \Deleted da pasta Drafts,
    // inclusive rascunho de outra composição que a pessoa tenha apagado pelo webmail. Gravar assim
    // mesmo deixaria uma cópia nova a cada 5 s, sem teto e sem ninguém removendo a anterior. Entre
    // encher a pasta e não gravar, não gravar é o menor dano — é a mesma degradação já aceita
    // quando a pasta Drafts não existe.
    if (!c.capabilities.has("UIDPLUS")) {
      console.warn("[email] rascunho: servidor sem UIDPLUS — gravação automática desligada nesta caixa.");
      return { uid: null };
    }

    // `\Seen` junto de `\Draft`, como na cópia em Enviados (`envio.service.ts`): sem ele o
    // contador de não-lidos da pasta Rascunhos sobe a cada gravação automática (uma a cada 5 s
    // de pausa na digitação) — ruído diário e visível no webmail e no celular.
    const gravado = await c.append(drafts.caminho, mime, ["\\Draft", "\\Seen"]);
    const uidNovo = gravado && typeof gravado.uid === "number" ? gravado.uid : null;
    if (uidNovo === null) {
      // UIDPLUS anunciado mas sem `APPENDUID` na resposta: a próxima gravação não terá a que
      // apontar e vai duplicar. Não dá para consertar daqui — mas não pode passar em silêncio.
      console.warn("[email] rascunho: o servidor gravou o rascunho e não devolveu o UID (sem APPENDUID).");
    }

    // Só remove a versão anterior DEPOIS de gravar a nova — nunca antes (0.3 do brief). Se a
    // remoção falhar, a pessoa fica com uma duplicata no webmail (cosmético), nunca sem rascunho.
    if (input.uidAnterior !== undefined) {
      try {
        const lock = await c.getMailboxLock(drafts.caminho);
        try {
          // `messageDelete` com `uid: true` faz STORE +FLAGS \Deleted seguido de UID EXPUNGE —
          // e só porque a checagem de UIDPLUS acima já garantiu que este servidor o suporta.
          // Expurga só a mensagem apontada, nunca a pasta inteira.
          await c.messageDelete(String(input.uidAnterior), { uid: true });
        } finally {
          lock.release();
        }
      } catch (e) {
        // A gravação nova já aconteceu — não remover a antiga é cosmético, não perda. Mas falha
        // SISTEMÁTICA aqui é uma cópia nova a cada 5 s até a pasta Rascunhos encher, e sem rastro
        // isso é invisível: registra e segue (nunca vira exceção — quebraria o fluxo à toa).
        console.warn(`[email] rascunho: não consegui remover a versão anterior (uid ${input.uidAnterior}).`, e);
      }
    }

    return { uid: uidNovo };
  });
}

/**
 * Apaga um rascunho específico da pasta Drafts do servidor, por UID — chamado depois de um envio
 * bem-sucedido, para não deixar em Rascunhos uma cópia desatualizada da composição que acabou de
 * sair (achado da revisão da Tarefa 8: sem isto, quase todo e-mail respondido/encaminhado deixava
 * um rascunho órfão para sempre, que dava pra reabrir e reenviar pela metade).
 *
 * Mesma trava de posse (`caixaDoUsuario`) e mesmo cuidado de expurgo do `salvarRascunho`: por UID
 * (`messageDelete` com `uid: true`), nunca um `EXPUNGE` cego que mexeria em outra mensagem
 * `\Deleted` da pasta.
 */
export async function descartarRascunho(userId: string, input: { caixaId: string; uid: number }): Promise<void> {
  const caixa = await caixaDoUsuario(userId, input.caixaId);

  const drafts = await prisma.caixaPasta.findFirst({
    where: { caixaId: caixa.id, papel: "DRAFTS" },
    select: { caminho: true },
  });
  // A pasta pode ter sumido entre a gravação e o descarte (desinscrita/apagada no webmail) — não
  // há mais o que apagar.
  if (!drafts) return;

  await comCaixa(caixa.id, async (c) => {
    // Mesmo motivo do `salvarRascunho`: sem UIDPLUS o `messageDelete(uid: true)` degrada para um
    // `EXPUNGE` cego e apagaria TODA mensagem \Deleted desta pasta, não só a do `uid` pedido. Um
    // descarte cosmético nunca pode apagar o rascunho de outra composição — sem a extensão, não
    // descarta (o pior caso é um rascunho órfão no webmail).
    if (!c.capabilities.has("UIDPLUS")) {
      console.warn("[email] rascunho: servidor sem UIDPLUS — descarte por UID não é seguro, rascunho mantido.");
      return;
    }

    try {
      const lock = await c.getMailboxLock(drafts.caminho);
      try {
        await c.messageDelete(String(input.uid), { uid: true });
      } finally {
        lock.release();
      }
    } catch (e) {
      // Achado 1-B da Tarefa 5, o mesmo tratamento já aplicado ao download de anexo
      // (`http/email-anexo.ts`): falha em operação ACESSÓRIA não pode marcar a caixa como
      // quebrada. Este callback roda dentro do `comCaixa`, e qualquer exceção que suba daqui
      // grava `estado: "ERRO"` + `ultimoErro` na caixa (`imap.ts`) — ou seja, o envio dá certo,
      // o descarte do rascunho tem um soluço de rede, e a caixa aparece "com erro" na tela.
      console.warn(`[email] rascunho: não consegui descartar o rascunho (uid ${input.uid}) depois do envio.`, e);
    }
  });
}
