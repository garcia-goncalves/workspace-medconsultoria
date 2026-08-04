import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { pipeline, finished } from "node:stream/promises";
import { join, resolve, sep } from "node:path";
import { prisma } from "@app/db";
import { usuarioDaRequest } from "./uploads.js";
import { comCaixa } from "../modules/email/imap.js";
import { BASE, TAMANHO_MAX } from "../lib/storage.js";

/** Área temporária dos anexos de saída, por usuário. */
export function pastaTemp(userId: string): string {
  return join(BASE, "email-tmp", userId);
}

/**
 * Caminho de um anexo temporário. O `id` vem do cliente, então NUNCA entra no caminho sem ser
 * validado: só aceitamos o formato de UUID que nós mesmos geramos, e conferimos o prefixo do
 * caminho resolvido (com o separador, como em `caminhoAbsoluto` de `lib/storage.ts` — sem isso
 * uma pasta irmã cujo nome começa igual passaria pelo `startsWith`). Sem nada disso, `../../`
 * no id daria leitura de arquivo arbitrário do servidor.
 */
export function caminhoTemp(userId: string, id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Anexo inválido.");
  const raiz = resolve(pastaTemp(userId));
  const alvo = resolve(join(pastaTemp(userId), id));
  if (alvo !== raiz && !alvo.startsWith(raiz + sep)) throw new Error("Anexo inválido.");
  return alvo;
}

/**
 * Duas rotas de anexo de e-mail, fora do tRPC:
 *
 *  - GET  /email-anexo/:mensagemId/:anexoId   baixa um anexo já recebido, em stream.
 *  - POST /email-anexo                        grava um anexo de SAÍDA num arquivo temporário
 *                                              (sem tabela — vive só entre o upload e o envio;
 *                                              o model `Arquivo` não serve aqui, tem `clienteId`
 *                                              obrigatório e anexo de e-mail nem sempre tem cliente).
 *
 * Baixar é o lado delicado: arquivo de terceiro, servido pelo NOSSO domínio.
 */
export function registrarRotaAnexoEmail(app: FastifyInstance): void {
  app.get<{ Params: { mensagemId: string; anexoId: string } }>(
    "/email-anexo/:mensagemId/:anexoId",
    async (req, reply) => {
      const user = await usuarioDaRequest(req);
      if (!user) return reply.code(401).send({ error: "Faça login para baixar o anexo." });
      if (user.role === "CLIENTE") return reply.code(403).send({ error: "Sem acesso." });

      // Posse pelo mesmo caminho do resto do módulo: a caixa tem de ser desta pessoa.
      const anexo = await prisma.emailAnexo.findFirst({
        where: {
          id: req.params.anexoId,
          mensagemId: req.params.mensagemId,
          mensagem: { pasta: { caixa: { userId: user.id, deletedAt: null } } },
        },
        select: {
          nome: true,
          parte: true,
          mensagem: {
            select: { uid: true, pasta: { select: { caminho: true, caixaId: true } } },
          },
        },
      });
      if (!anexo) return reply.code(404).send({ error: "Anexo não encontrado." });

      // Duas regras obrigatórias, sem exceção:
      //  1) Stream, nunca memória — um processo Node serve API + SPA + tempo real; juntar 20 MB
      //     de anexo em Buffer é o mesmo erro do corpo do e-mail, só que maior.
      //  2) `attachment` + `nosniff`, sempre — anexo é arquivo de terceiro. Um `anexo.html` que
      //     abrisse no navegador seria XSS no NOSSO domínio. Por isso nem o Content-Type do
      //     e-mail é repassado: vai sempre `application/octet-stream`.
      //
      // O download E o envio da resposta acontecem os DOIS aqui dentro, dentro do `comCaixa`:
      // a conexão IMAP fecha assim que o callback retorna, mas `c.download()` só busca o
      // primeiro pedaço antes de resolver a promise — o resto continua sendo puxado do socket
      // em segundo plano. Se devolvêssemos o stream para fora e respondêssemos depois, a conexão
      // fecharia no meio da leitura e o anexo chegaria cortado. Por isso esperamos aqui dentro o
      // stream terminar de escoar antes de deixar o `comCaixa` fechar a conexão.
      const entregue = await comCaixa(anexo.mensagem.pasta.caixaId, async (c) => {
        const lock = await c.getMailboxLock(anexo.mensagem.pasta.caminho);
        try {
          const r = await c.download(String(anexo.mensagem.uid), anexo.parte, { uid: true });
          if (!r?.content) return false;

          reply.header("Content-Type", "application/octet-stream");
          reply.header("X-Content-Type-Options", "nosniff");
          reply.header("Cache-Control", "private, no-store");
          reply.header(
            "Content-Disposition",
            `attachment; filename*=UTF-8''${encodeURIComponent(anexo.nome)}`,
          );
          const conteudo = r.content;
          reply.send(conteudo);
          try {
            // `finished` cobre "end" (terminou de escoar) E "close" (destruído antes de
            // terminar — é o que o Fastify faz quando quem baixa cancela: fecha a aba, aperta
            // Cancelar, dá F5 no meio). Sem isto, um download cancelado nunca resolveria esta
            // promise, o callback do `comCaixa` nunca retornaria, e a conexão IMAP (com o lock
            // da caixa) ficaria pendurada até o processo reiniciar.
            await finished(conteudo);
          } catch (e) {
            const erro = e as NodeJS.ErrnoException;
            // Cancelamento vira ERR_STREAM_PREMATURE_CLOSE aqui — não é falha de verdade.
            // Qualquer OUTRO erro (ex.: a conexão IMAP caiu no meio do download) também fica
            // contido AQUI DENTRO: falha ao ENTREGAR um anexo não é falha da CAIXA — se
            // deixássemos subir, o catch do `comCaixa` marcaria a caixa inteira como ERRO por
            // causa de um anexo que não baixou, sem nenhuma relação com a sincronização dela.
            if (erro.code !== "ERR_STREAM_PREMATURE_CLOSE") {
              req.log.warn({ err: erro }, "Anexo: o download terminou com erro depois de a resposta já ter começado.");
            }
          }
          return true;
        } finally {
          lock.release();
        }
      });
      if (!entregue) return reply.code(404).send({ error: "O servidor de e-mail não devolveu este anexo." });
      return;
    },
  );

  app.post("/email-anexo", async (req, reply) => {
    const user = await usuarioDaRequest(req);
    if (!user) return reply.code(401).send({ error: "Faça login para anexar." });
    if (user.role === "CLIENTE") return reply.code(403).send({ error: "Sem acesso." });

    const parte = await req.file();
    if (!parte) return reply.code(400).send({ error: "Nenhum arquivo recebido." });

    const id = randomUUID();
    await mkdir(pastaTemp(user.id), { recursive: true });
    await pipeline(parte.file, createWriteStream(caminhoTemp(user.id, id)));

    // O @fastify/multipart corta no limite e marca truncado — arquivo cortado não pode virar anexo.
    if (parte.file.truncated) {
      await rm(caminhoTemp(user.id, id), { force: true });
      return reply.code(413).send({ error: `Arquivo acima do limite de ${TAMANHO_MAX / 1024 / 1024} MB.` });
    }
    return reply.send({ id, nome: parte.filename });
  });
}
