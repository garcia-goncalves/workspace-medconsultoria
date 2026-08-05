import type { FastifyInstance, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { prisma } from "@app/db";
import type { SessionUser } from "@app/shared";
import { getUserFromSession, SESSION_COOKIE } from "../lib/session.js";
import {
  salvarArquivo,
  salvarAvatar,
  removerArquivo,
  caminhoAbsoluto,
  MIMETYPES_ACEITOS,
  MIMETYPES_IMAGEM,
  TAMANHO_MAX,
  AVATAR_MAX,
} from "../lib/storage.js";
import { registrarUpload, getArquivo } from "../modules/arquivos/arquivos.service.js";
import { isAiEnabled } from "../config.js";
import { aiService } from "../lib/ai.js";

const CONTENT_TYPE_POR_EXT: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/** Resolve o usuário autenticado a partir do cookie de sessão assinado. */
/** Sessão a partir do cookie, para rotas HTTP fora do tRPC (arquivos, avatar, corpo de e-mail). */
export async function usuarioDaRequest(req: FastifyRequest): Promise<SessionUser | null> {
  const raw = req.cookies[SESSION_COOKIE];
  const unsigned = raw ? req.unsignCookie(raw) : null;
  const sid = unsigned?.valid ? unsigned.value ?? undefined : undefined;
  return getUserFromSession(sid);
}

/**
 * Rotas de arquivo (fora do tRPC, que não lida com multipart):
 *  - POST /upload            recebe um arquivo (campos ANTES do arquivo no FormData)
 *  - GET  /arquivos/:id      baixa um arquivo (com checagem de posse)
 *
 * Autenticação por cookie. CLIENTE (Portal) só grava/baixa no PRÓPRIO cadastro.
 */
export async function registrarRotasArquivos(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: TAMANHO_MAX, files: 1 } });

  app.post("/upload", async (req, reply) => {
    const user = await usuarioDaRequest(req);
    if (!user) return reply.code(401).send({ error: "Não autenticado." });
    const isCliente = user.role === "CLIENTE";

    const campos: Record<string, string> = {};
    let salvo:
      | { caminho: string; tamanho: number; nome: string; mimetype: string; clienteId: string }
      | null = null;

    for await (const part of req.parts()) {
      if (part.type === "field") {
        campos[part.fieldname] = String(part.value);
        continue;
      }
      if (part.fieldname !== "arquivo") {
        part.file.resume();
        continue;
      }
      if (!MIMETYPES_ACEITOS.has(part.mimetype)) {
        part.file.resume();
        return reply.code(415).send({ error: "Tipo de arquivo não permitido. Envie PDF, imagem, Word ou Excel." });
      }
      // CLIENTE só grava no próprio cadastro; equipe informa o cliente-destino.
      const clienteId = isCliente ? user.clienteId : campos.clienteId;
      if (!clienteId) {
        part.file.resume();
        return reply.code(400).send({ error: "Cliente não informado." });
      }
      const { caminho, tamanho } = await salvarArquivo(clienteId, part.filename, part.file);
      if (part.file.truncated) {
        await removerArquivo(caminho);
        return reply.code(413).send({ error: "Arquivo excede o limite de 20 MB." });
      }
      salvo = { caminho, tamanho, nome: part.filename, mimetype: part.mimetype, clienteId };
    }

    if (!salvo) return reply.code(400).send({ error: "Nenhum arquivo enviado." });

    const arquivo = await registrarUpload({
      clienteId: salvo.clienteId,
      servicoId: campos.servicoId || null,
      requisitoId: campos.requisitoId || null,
      nome: salvo.nome,
      mimetype: salvo.mimetype,
      tamanho: salvo.tamanho,
      caminho: salvo.caminho,
      enviadoPorTipo: isCliente ? "CLIENTE" : "EQUIPE",
      enviadoPorId: user.id,
    });
    return reply.send({ id: arquivo.id, nome: arquivo.nome, tamanho: arquivo.tamanho });
  });

  // Transcrição de áudio (reunião/ditado) → texto, via IA (Whisper). Só equipe.
  app.post("/transcrever", async (req, reply) => {
    const user = await usuarioDaRequest(req);
    if (!user || user.role === "CLIENTE") return reply.code(401).send({ error: "Não autenticado." });
    if (!isAiEnabled) return reply.code(412).send({ error: "IA não configurada (OPENAI_API_KEY)." });

    let buffer: Buffer | null = null;
    let filename = "audio.webm";
    for await (const part of req.parts()) {
      if (part.type === "field") continue;
      if (part.fieldname !== "audio") {
        part.file.resume();
        continue;
      }
      if (!/^(audio|video)\//.test(part.mimetype)) {
        part.file.resume();
        return reply.code(415).send({ error: "Envie um arquivo de áudio." });
      }
      filename = part.filename || "audio.webm";
      const chunks: Buffer[] = [];
      for await (const c of part.file) chunks.push(c as Buffer);
      if (part.file.truncated) return reply.code(413).send({ error: "Áudio muito grande (máx. 20 MB)." });
      buffer = Buffer.concat(chunks);
    }
    if (!buffer || buffer.length === 0) return reply.code(400).send({ error: "Nenhum áudio enviado." });

    try {
      const texto = await aiService.transcrever(buffer, filename);
      return reply.send({ texto });
    } catch {
      return reply.code(500).send({ error: "Não consegui transcrever o áudio. Tente de novo." });
    }
  });

  // Foto de perfil (avatar) — do próprio usuário logado (equipe ou Portal).
  app.post("/avatar", async (req, reply) => {
    const user = await usuarioDaRequest(req);
    if (!user) return reply.code(401).send({ error: "Não autenticado." });

    let salvo: { caminho: string; tamanho: number } | null = null;
    for await (const part of req.parts()) {
      if (part.type === "field") continue;
      if (part.fieldname !== "arquivo") {
        part.file.resume();
        continue;
      }
      if (!MIMETYPES_IMAGEM.has(part.mimetype)) {
        part.file.resume();
        return reply.code(415).send({ error: "Envie uma imagem JPG, PNG ou WebP." });
      }
      salvo = await salvarAvatar(user.id, part.filename, part.file);
      if (part.file.truncated || salvo.tamanho > AVATAR_MAX) {
        await removerArquivo(salvo.caminho);
        return reply.code(413).send({ error: "Imagem muito grande (máx. 5 MB)." });
      }
    }
    if (!salvo) return reply.code(400).send({ error: "Nenhuma imagem enviada." });

    // Troca o avatar e apaga o arquivo antigo (best-effort).
    const anterior = await prisma.user.findUnique({ where: { id: user.id }, select: { avatarUrl: true } });
    await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: salvo.caminho } });
    if (anterior?.avatarUrl && anterior.avatarUrl !== salvo.caminho) await removerArquivo(anterior.avatarUrl);
    return reply.send({ avatarUrl: salvo.caminho });
  });

  // Serve a foto de perfil de qualquer usuário (aparece em toda a app). Requer login.
  app.get<{ Params: { userId: string } }>("/avatar/:userId", async (req, reply) => {
    const user = await usuarioDaRequest(req);
    if (!user) return reply.code(401).send({ error: "Não autenticado." });
    const alvo = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { avatarUrl: true } });
    if (!alvo?.avatarUrl) return reply.code(404).send({ error: "Sem foto." });
    let stream;
    try {
      stream = createReadStream(caminhoAbsoluto(alvo.avatarUrl));
    } catch {
      return reply.code(404).send({ error: "Foto não encontrada." });
    }
    reply.header("Content-Type", CONTENT_TYPE_POR_EXT[extname(alvo.avatarUrl).toLowerCase()] ?? "image/png");
    reply.header("Cache-Control", "private, max-age=300");
    return reply.send(stream);
  });

  app.get<{ Params: { id: string } }>("/arquivos/:id", async (req, reply) => {
    const user = await usuarioDaRequest(req);
    if (!user) return reply.code(401).send({ error: "Não autenticado." });

    const arquivo = await getArquivo(req.params.id);
    // CLIENTE só acessa arquivos do próprio cadastro; equipe acessa qualquer um.
    if (user.role === "CLIENTE" && arquivo.clienteId !== user.clienteId) {
      return reply.code(403).send({ error: "Sem acesso a este arquivo." });
    }

    let stream;
    try {
      stream = createReadStream(caminhoAbsoluto(arquivo.caminho));
    } catch {
      return reply.code(404).send({ error: "Arquivo não encontrado." });
    }
    reply.header("Content-Type", arquivo.mimetype);
    // `nosniff` escrito AQUI, e não emprestado do helmet global: o `mimetype` vem do banco, e o
    // acervo passou a receber arquivo de terceiro (anexo de e-mail, fase 2D-2). Hoje a allowlist
    // de `/upload` prende o valor a 8 tipos, mas quem afrouxar aquela lista amanhã não vai
    // adivinhar que esta rota dependia dela.
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(arquivo.nome)}`,
    );
    return reply.send(stream);
  });
}
