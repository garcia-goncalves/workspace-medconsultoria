import type { FastifyInstance } from "fastify";
import type { Dirent } from "node:fs";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, readdir, stat } from "node:fs/promises";
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
 * Prazo de vida de um anexo temporário de saída (`POST /email-anexo`) antes de a varredura
 * (`limparAnexosTempOrfaos`) tratá-lo como órfão e apagar. Generoso de propósito: quem escreve
 * pode deixar a tela de compose aberta um bom tempo antes de enviar — 24h cobre isso sem risco
 * de apagar o anexo de um envio ainda em curso.
 */
export const PRAZO_ANEXO_TEMP_MS = 24 * 60 * 60 * 1000;

/**
 * Função pura: decide se um anexo temporário venceu, dado o mtime do arquivo e o instante atual
 * (ambos em ms desde a época). Separada da varredura em si para dar para testar sem relógio real.
 */
export function anexoTempVencido(mtimeMs: number, agoraMs: number, prazoMs: number = PRAZO_ANEXO_TEMP_MS): boolean {
  return agoraMs - mtimeMs > prazoMs;
}

/**
 * Teto de disco da área temporária de anexos, POR PESSOA. Sem isto, `POST /email-anexo` grava até
 * 20 MB por requisição sem somar nada antes: dentro do rate limit global (300 req/min), uma
 * sessão de funcionário enche o disco muito antes de a varredura de órfãos encostar em qualquer
 * arquivo (ela tem prazo de 24 h e roda de hora em hora — não impede o estrago, só limpa depois).
 * Aqui isso não derruba só o e-mail: a hospedagem é compartilhada e um único processo Node serve
 * API + SPA, então disco cheio derruba a app inteira.
 *
 * 200 MB = oito composições do tamanho máximo de um envio (25 MB, teto do `conferirAnexos`)
 * abertas ao mesmo tempo — muito acima do uso real —, e pequeno o bastante para as poucas pessoas
 * da empresa somadas não ameaçarem o disco.
 */
export const COTA_ANEXO_TEMP_BYTES = 200 * 1024 * 1024;

/**
 * Função pura: decide se ainda cabe mais um upload, dado o que a pessoa já tem gravado.
 *
 * PESSIMISTA de propósito — conta o pior caso (`TAMANHO_MAX`, o teto que o multipart aplica por
 * arquivo) em vez do tamanho real do que está chegando, porque esse tamanho só seria conhecido
 * DEPOIS de gravar o arquivo, que é justamente o que a cota existe para evitar. Assim nenhuma
 * decisão depende de um valor que ainda pode mudar, e duas requisições simultâneas que leiam o
 * mesmo total ultrapassam a cota em no máximo um arquivo cada — nunca sem teto.
 */
export function cabeMaisUmAnexoTemp(
  usadosBytes: number,
  tamanhoMaxBytes: number = TAMANHO_MAX,
  cotaBytes: number = COTA_ANEXO_TEMP_BYTES,
): boolean {
  return usadosBytes + tamanhoMaxBytes <= cotaBytes;
}

/**
 * Soma o que a pessoa já tem gravado na PRÓPRIA área temporária. É uma pasta por usuário, com os
 * anexos de composições ainda abertas — na prática um punhado de arquivos, então o `readdir` +
 * `stat` custa milissegundos e só roda no upload, não em toda requisição. Pasta inexistente = 0.
 *
 * Conta TUDO o que ocupa disco ali (não só o que casa com o formato de UUID): para uma cota, o
 * que importa é o espaço realmente usado. O nome vem do `readdir` da própria pasta e nunca contém
 * separador, então não há caminho para escapar dela.
 */
export async function usoPastaTemp(userId: string): Promise<number> {
  const pasta = pastaTemp(userId);
  let arquivos: Dirent[];
  try {
    arquivos = await readdir(pasta, { withFileTypes: true });
  } catch {
    return 0; // esta pessoa ainda não anexou nada
  }
  let total = 0;
  for (const arquivo of arquivos) {
    if (!arquivo.isFile()) continue;
    try {
      total += (await stat(join(pasta, arquivo.name))).size;
    } catch {
      /* sumiu entre listar e medir (envio ou limpeza concorrente) — não ocupa mais espaço */
    }
  }
  return total;
}

/**
 * Varredura por mtime dos temporários de anexo de e-mail. Cobre os três jeitos de um anexo ficar
 * órfão que o envio (`envio.service.ts:enviarMensagem`) NÃO cobre — porque só limpa o que foi
 * efetivamente enviado: anexo REMOVIDO da lista antes de enviar, compose CANCELADO, ou aba
 * FECHADA no meio. Sem isto o arquivo fica no disco para sempre.
 *
 * Não mexe em caminho de disco cru: cada arquivo passa por `caminhoTemp` (o mesmo guardião
 * contra travessia de caminho usado no upload) antes de ser tocado — um nome que não bate com o
 * formato de UUID esperado é ignorado, não apagado.
 *
 * Nunca derruba o processo: falha ao listar ou apagar é registrada no log (nunca engolida em
 * silêncio) e a varredura segue em frente para o próximo usuário/arquivo.
 */
export async function limparAnexosTempOrfaos(): Promise<void> {
  const raizTemp = join(BASE, "email-tmp");
  let usuarios: Dirent[];
  try {
    usuarios = await readdir(raizTemp, { withFileTypes: true });
  } catch (e) {
    const erro = e as NodeJS.ErrnoException;
    if (erro.code === "ENOENT") return; // nenhum anexo foi criado ainda nesta instalação
    console.error("[email] limpeza de anexos temporários: não consegui listar a pasta.", erro);
    return;
  }

  const agora = Date.now();
  for (const usuario of usuarios) {
    if (!usuario.isDirectory()) continue;
    let arquivos: Dirent[];
    try {
      arquivos = await readdir(pastaTemp(usuario.name), { withFileTypes: true });
    } catch (e) {
      console.error(`[email] limpeza de anexos temporários: não consegui listar a pasta do usuário ${usuario.name}.`, e);
      continue;
    }
    for (const arquivo of arquivos) {
      if (!arquivo.isFile()) continue;
      let caminho: string;
      try {
        caminho = caminhoTemp(usuario.name, arquivo.name);
      } catch {
        continue; // nome fora do formato de anexo temporário (uuid) — não é nosso, não mexe
      }
      try {
        const info = await stat(caminho);
        if (anexoTempVencido(info.mtimeMs, agora)) {
          await rm(caminho, { force: true });
        }
      } catch (e) {
        console.error(`[email] limpeza de anexos temporários: falha ao processar ${arquivo.name}.`, e);
      }
    }
  }
}

let intervaloLimpeza: NodeJS.Timeout | null = null;

/**
 * Liga a varredura periódica de temporários órfãos. A hospedagem não tem cron externo, então
 * isto substitui um: roda uma vez de imediato e depois a cada hora (o prazo de 24h dá folga de
 * sobra para essa cadência). `unref()` para o timer nunca impedir o processo de encerrar.
 */
export function iniciarLimpezaAnexosTemp(): void {
  if (intervaloLimpeza) return;
  const rodar = () => void limparAnexosTempOrfaos().catch((e) => console.error("[email] limpeza de anexos temporários falhou.", e));
  rodar();
  intervaloLimpeza = setInterval(rodar, 60 * 60 * 1000);
  intervaloLimpeza.unref();
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

    // Cota por pessoa ANTES de gravar um byte (ver `COTA_ANEXO_TEMP_BYTES`). O stream é drenado
    // (`resume()`) antes de responder — mesmo padrão das recusas de `/upload`: sem isso o cliente
    // vê a conexão cair em vez da mensagem de erro.
    const usados = await usoPastaTemp(user.id);
    if (!cabeMaisUmAnexoTemp(usados)) {
      parte.file.resume();
      return reply.code(413).send({
        error:
          `Você já tem ${Math.round(usados / 1024 / 1024)} MB de anexos aguardando envio ` +
          `(limite de ${COTA_ANEXO_TEMP_BYTES / 1024 / 1024} MB por pessoa). ` +
          `Envie ou feche os e-mails que estão abertos e tente de novo.`,
      });
    }

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
