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
 * O que a gravação automática devolve ao front (é o retorno do `email.salvarRascunho` do tRPC —
 * o contrato que `useRascunhoAutomatico` consome).
 */
export type SalvarRascunhoResultado = {
  /**
   * UID da versão que acabou de ser gravada no servidor, para a próxima gravação regravar por cima
   * dela (`uidAnterior`). `null` = nada foi gravado, OU foi gravado e o servidor não disse onde.
   */
  uid: number | null;
  /**
   * PARE de reagendar a gravação automática nesta composição — insistir é inútil ou danoso, e
   * nenhuma tentativa futura vai mudar isso enquanto a pessoa estiver escrevendo este e-mail.
   * (O que a pessoa digitou continua na tela; só a cópia no servidor deixa de existir.)
   *
   * Vem `true` em exatamente dois casos, os dois estruturais e não transitórios:
   *  1. Servidor sem UIDPLUS — nada é gravado, e cada tentativa abre uma conexão IMAP nova a cada
   *     5 s de pausa na digitação para não gravar coisa nenhuma.
   *  2. Servidor anunciou UIDPLUS mas não devolveu `APPENDUID` — a mensagem FOI gravada, mas sem
   *     UID de volta a próxima gravação não tem a que apontar: cada ciclo de 5 s acrescentaria uma
   *     cópia nova sem remover nenhuma, sem teto, até encher a pasta Rascunhos.
   *
   * Vem `false` em falha de rede/servidor comum: essa é transitória e tentar de novo é o certo.
   * Também vem `false` quando a caixa não tem pasta Drafts mapeada — ali não se gasta conexão
   * nenhuma (é só uma consulta ao banco) e a pasta pode aparecer na próxima sincronização.
   */
  gravacaoDesligada: boolean;
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
export async function salvarRascunho(
  userId: string,
  input: SalvarRascunhoInput,
): Promise<SalvarRascunhoResultado> {
  // Posse da caixa — o MESMO caminho do envio (Tarefa 3). `comCaixa` não filtra por dono: só é
  // seguro chamá-lo com um `caixaId` que já passou por aqui.
  const caixa = await caixaDoUsuario(userId, input.caixaId);

  // Caixa sem pasta de rascunhos é possível (servidor sem SPECIAL-USE reconhecido para Drafts, ou
  // sincronização de pastas que ainda não rodou). Perder o texto da pessoa por causa de uma pasta
  // ausente seria pior que simplesmente não salvar — por isso devolve uid nulo sem estourar. Não
  // desliga a gravação (`gravacaoDesligada: false`): este ramo não gasta conexão IMAP nenhuma, só
  // uma consulta ao banco, e a pasta pode passar a existir na próxima sincronização de pastas.
  const drafts = await prisma.caixaPasta.findFirst({
    where: { caixaId: caixa.id, papel: "DRAFTS" },
    select: { caminho: true },
  });
  if (!drafts) return { uid: null, gravacaoDesligada: false };

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

  // O `try` envolve o `comCaixa` INTEIRO, não só o callback — porque a CONEXÃO em si (que o
  // `comCaixa` abre antes de chamar o callback) é o que mais falha aqui: esta é uma conexão IMAP
  // nova aberta a cada 5 s de pausa na digitação, sujeita a timeout e ao limite de conexões
  // simultâneas por IP do servidor. Gravar rascunho é automático e invisível: a pessoa nem sabe que
  // existe, e a UI engole o erro (`useRascunhoAutomatico` tem um `.catch` mudo). Deixar isso
  // estourar dizia "sua caixa está com problema" para significar "não consegui salvar um rascunho".
  // O `marcarErro: false` é a outra metade e a que de fato importa: sem ele, o `catch` do próprio
  // `comCaixa` já teria gravado `estado: "ERRO"` na caixa ANTES de a exceção chegar aqui, e este
  // `try` não desfaria nada.
  try {
    // Tudo dentro de UMA conexão: `comCaixa` fecha o socket assim que o callback retorna, então
    // gravar a nova e remover a antiga têm de acontecer lá dentro, nesta ordem.
    return await comCaixa(
      caixa.id,
      async (c) => {
        // O "gravar por cima" INTEIRO depende de UIDPLUS, e nada garante a extensão:
        // `descobrirServidor` (`imap.ts`) deriva `mail.<domínio>` de qualquer endereço digitado,
        // então a garantia é do servidor de hoje, não da estrutura. Sem a extensão, as duas metades
        // quebram: o `append` não devolve UID (não sobra a que apontar depois) e o
        // `messageDelete(uid: true)` degrada, DENTRO do imapflow, para um `EXPUNGE` cego — que apaga
        // TODA mensagem \Deleted da pasta Drafts, inclusive rascunho de outra composição que a
        // pessoa tenha apagado pelo webmail. Gravar assim mesmo deixaria uma cópia nova a cada 5 s,
        // sem teto e sem ninguém removendo a anterior. Entre encher a pasta e não gravar, não gravar
        // é o menor dano — é a mesma degradação já aceita quando a pasta Drafts não existe.
        //
        // E aqui a gravação para de vez (`gravacaoDesligada`): sem isso o front reagenda a cada 5 s
        // de pausa e abre uma conexão IMAP nova toda vez só para descobrir de novo o mesmo "não dá".
        if (!c.capabilities.has("UIDPLUS")) {
          console.warn("[email] rascunho: servidor sem UIDPLUS — gravação automática desligada nesta caixa.");
          return { uid: null, gravacaoDesligada: true };
        }

        // `\Seen` junto de `\Draft`, como na cópia em Enviados (`envio.service.ts`): sem ele o
        // contador de não-lidos da pasta Rascunhos sobe a cada gravação automática (uma a cada 5 s
        // de pausa na digitação) — ruído diário e visível no webmail e no celular.
        const gravado = await c.append(drafts.caminho, mime, ["\\Draft", "\\Seen"]);
        const uidNovo = gravado && typeof gravado.uid === "number" ? gravado.uid : null;
        if (uidNovo === null) {
          // UIDPLUS anunciado mas sem `APPENDUID` na resposta: a mensagem foi gravada e não sobrou
          // a que apontar. O dano de insistir é IDÊNTICO ao que fez desligar o ramo sem UIDPLUS —
          // `uidAnterior` fica `undefined` na próxima gravação e cada ciclo de 5 s acrescenta uma
          // cópia sem remover nenhuma, sem teto. Por isso desliga a gravação em vez de só logar:
          // devolver uid nulo e deixar o front reagendar era o mesmo estrago com outro nome.
          console.warn("[email] rascunho: o servidor gravou o rascunho e não devolveu o UID (sem APPENDUID).");
        }

        // Só remove a versão anterior DEPOIS de gravar a nova — nunca antes (0.3 do brief). Se a
        // remoção falhar, a pessoa fica com uma duplicata no webmail (cosmético), nunca sem
        // rascunho. Vale mesmo quando o `APPENDUID` faltou: a cópia nova já está lá de qualquer
        // jeito, então tirar a anterior continua sendo o menor estrago possível.
        if (input.uidAnterior !== undefined) {
          try {
            const lock = await c.getMailboxLock(drafts.caminho);
            try {
              // `messageDelete` com `uid: true` faz STORE +FLAGS \Deleted seguido de UID EXPUNGE —
              // e só porque a checagem de UIDPLUS acima já garantiu que este servidor o suporta.
              // Expurga só a mensagem apontada, nunca a pasta inteira.
              //
              // CONFERIR O RETORNO é obrigatório: `messageDelete` NÃO lança quando o expurgo falha.
              // Devolve `false` (o `catch` de `lib/commands/expunge.js` engole o erro e só escreve
              // no logger interno, que está desligado por `logger: false`), devolve `undefined` se a
              // pasta não estiver selecionada, e o STORE prévio já devolve `false` calado quando
              // `\Deleted` não está nos `permanentFlags` da pasta. Ou seja: o `catch` abaixo só
              // pega erro de socket — sem esta conferência, uma pasta Drafts que não aceite
              // `\Deleted` faria TODAS as gravações deixarem lixo, sem uma linha de log.
              const removido = await c.messageDelete(String(input.uidAnterior), { uid: true });
              if (!removido) {
                console.warn(
                  `[email] rascunho: o servidor não removeu a versão anterior (uid ${input.uidAnterior}) e não acusou erro — ` +
                    "a pasta Rascunhos vai acumular uma cópia por gravação.",
                );
              }
            } finally {
              lock.release();
            }
          } catch (e) {
            // A gravação nova já aconteceu — não remover a antiga é cosmético, não perda. Mas falha
            // SISTEMÁTICA aqui é uma cópia nova a cada 5 s até a pasta Rascunhos encher, e sem
            // rastro isso é invisível: registra e segue (nunca vira exceção — quebraria o fluxo à
            // toa, e faria a caixa inteira parecer quebrada por causa de um expurgo cosmético).
            console.warn(`[email] rascunho: não consegui remover a versão anterior (uid ${input.uidAnterior}).`, e);
          }
        }

        return { uid: uidNovo, gravacaoDesligada: uidNovo === null };
      },
      { marcarErro: false },
    );
  } catch (e) {
    // Falha de rede/servidor: transitória por natureza, então NÃO desliga a gravação — a próxima
    // tecla digitada tenta de novo, que é o certo. Devolve o mesmo formato de "não gravei"
    // (`uid: null`), o que preserva a regra 0.3 do brief: no pior caso a gravação seguinte cria uma
    // duplicata na pasta, nunca perde o texto de quem está escrevendo.
    console.warn("[email] rascunho: não consegui gravar o rascunho no servidor (a composição segue na tela).", e);
    return { uid: null, gravacaoDesligada: false };
  }
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

  // Achado 1-B da Tarefa 5, o mesmo tratamento já aplicado ao download de anexo
  // (`http/email-anexo.ts`): falha em operação ACESSÓRIA não pode marcar a caixa como quebrada.
  //
  // As DUAS metades são necessárias, e a rodada anterior só tinha uma. `marcarErro: false` impede a
  // marcação: o `catch` do `comCaixa` grava `estado: "ERRO"` + `ultimoErro` na caixa ANTES de
  // relançar, então um `try` aqui fora, sozinho, não desfaria nada. E o `try` precisa envolver o
  // `comCaixa` INTEIRO, não só o callback: este descarte roda logo DEPOIS de um envio bem-sucedido
  // e abre uma conexão IMAP NOVA — falha de conexão (timeout de 15 s, limite de conexões
  // simultâneas por IP logo depois de o envio ter gastado as suas, DNS que soluçou) é o modo de
  // falha mais provável aqui, e ele acontece em `c.connect()`, fora do callback.
  try {
    await comCaixa(
      caixa.id,
      async (c) => {
        // Mesmo motivo do `salvarRascunho`: sem UIDPLUS o `messageDelete(uid: true)` degrada para
        // um `EXPUNGE` cego e apagaria TODA mensagem \Deleted desta pasta, não só a do `uid`
        // pedido. Um descarte cosmético nunca pode apagar o rascunho de outra composição — sem a
        // extensão, não descarta (o pior caso é um rascunho órfão no webmail).
        if (!c.capabilities.has("UIDPLUS")) {
          console.warn("[email] rascunho: servidor sem UIDPLUS — descarte por UID não é seguro, rascunho mantido.");
          return;
        }

        const lock = await c.getMailboxLock(drafts.caminho);
        try {
          // Mesma conferência de retorno do `salvarRascunho`: `messageDelete` devolve `false`
          // (ou `undefined`) sem lançar quando o expurgo não acontece — pasta que não aceita
          // `\Deleted` nos `permanentFlags`, servidor que anuncia UIDPLUS e recusa `UID EXPUNGE`.
          // Sem conferir, o rascunho órfão do e-mail que acabou de sair fica lá sem nenhum rastro.
          const removido = await c.messageDelete(String(input.uid), { uid: true });
          if (!removido) {
            console.warn(
              `[email] rascunho: o servidor não descartou o rascunho (uid ${input.uid}) depois do envio e não acusou erro.`,
            );
          }
        } finally {
          lock.release();
        }
      },
      { marcarErro: false },
    );
  } catch (e) {
    console.warn(`[email] rascunho: não consegui descartar o rascunho (uid ${input.uid}) depois do envio.`, e);
  }
}
