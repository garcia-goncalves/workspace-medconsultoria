import type { FastifyInstance } from "fastify";
import { usuarioDaRequest } from "./uploads.js";
import { abrirMensagem } from "../modules/email/leitura.service.js";

/**
 * Serve o CORPO de um e-mail como documento HTML próprio, para o `<iframe sandbox="">` da tela.
 *
 * Por que uma rota, e não `srcdoc`: um documento `srcdoc` **herda a CSP da página que o embute**.
 * A CSP da aplicação tem `img-src 'self' data: blob:` — ou seja, em produção a imagem remota
 * ficaria bloqueada pelo navegador MESMO depois de a pessoa clicar em "Mostrar imagens", e o
 * botão seria uma promessa que a tela não cumpre. Servido por uma URL, este documento tem a
 * PRÓPRIA CSP: fechada por padrão, liberando imagem só quando foi pedido explicitamente.
 *
 * A CSP daqui é mais dura que a da app: `default-src 'none'` (sem script, sem fetch, sem
 * formulário, sem plugin), estilo inline só para a folha que nós mesmos escrevemos. Ela SOMA
 * com o `sandbox=""` do iframe — as duas juntas, não uma no lugar da outra.
 */
export function registrarRotaCorpoEmail(app: FastifyInstance) {
  app.get<{ Params: { mensagemId: string }; Querystring: { imagens?: string } }>(
    "/email-corpo/:mensagemId",
    async (req, reply) => {
      const user = await usuarioDaRequest(req);
      if (!user) return reply.code(401).send({ error: "Não autenticado." });
      // O Portal do Cliente não tem e-mail; a posse da caixa é conferida dentro de `abrirMensagem`.
      if (user.role === "CLIENTE") return reply.code(403).send({ error: "Sem acesso." });

      const msg = await abrirMensagem(user.id, req.params.mensagemId);
      const mostrarImagens = req.query.imagens === "1";

      const corpo = msg.corpoHtml
        ? mostrarImagens
          ? msg.corpoHtml.replace(/data-src-bloqueada=/g, "src=")
          : msg.corpoHtml
        : `<pre>${escaparTexto(msg.corpoTexto ?? "(sem conteúdo)")}</pre>`;

      const documento = `<!doctype html><meta charset="utf-8"><base target="_blank">
<style>body{margin:0;padding:12px;font:14px/1.5 Montserrat,system-ui,sans-serif;color:#111;word-break:break-word}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap;font:inherit}</style>
${corpo}`;

      reply.header("Content-Type", "text/html; charset=utf-8");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cache-Control", "private, no-store");
      reply.header(
        "Content-Security-Policy",
        [
          "default-src 'none'",
          // `data:` entra sempre porque e-mail embute imagem assim o tempo todo; `https:` só
          // depois de a pessoa pedir para ver as imagens.
          mostrarImagens ? "img-src https: data:" : "img-src data:",
          "style-src 'unsafe-inline'",
          "font-src data:",
          "base-uri 'none'",
          "form-action 'none'",
          "frame-ancestors 'self'",
        ].join("; "),
      );
      return reply.send(documento);
    },
  );
}

/** Texto puro vira HTML aqui — sem isto, e-mail só-texto contendo `<` viraria marcação. */
function escaparTexto(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
