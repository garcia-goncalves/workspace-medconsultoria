import "./env.js"; // PRIMEIRO: carrega .env antes de qualquer leitura de config
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import type { TRPCError } from "@trpc/server";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { config, isProd } from "./config.js";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/context.js";
import { initRealtime } from "./realtime/socket.js";
import { registrarRotasArquivos } from "./http/uploads.js";
import { registrarRotaCorpoEmail } from "./http/email-corpo.js";
import { registrarRotaLinkDeAssinatura } from "./http/link-de-assinatura.js";
import { registrarRotaAnexoEmail, iniciarLimpezaAnexosTemp } from "./http/email-anexo.js";
import { iniciarExpurgoDeRetencao } from "./modules/sistema/retencao.service.js";
import { aquecerDefesaDeTempo } from "./modules/auth/auth.service.js";
import { validarPastaUploads } from "./lib/storage.js";
import { startReminderLoop } from "./realtime/reminders.js";
import { startMonitor } from "./observability/monitor.js";
import { startAlertas } from "./observability/alertas.js";
import { registrarErro } from "./modules/sistema/sistema.service.js";
import { marcarCspLigada } from "./lib/seguranca-http.js";
import { PROXY_CONFIAVEL } from "./lib/proxy-confiavel.js";
import type { Context } from "./trpc/context.js";

// trustProxy: quem é o nosso proxy — a régua mora em `lib/proxy-confiavel.ts`, com o porquê
// inteiro escrito lá (NUNCA `true`, e NUNCA MAIS o número `1`, que o Fastify 5.12 aposentou).
//
// maxParamLength: o tRPC httpBatchLink junta as procedures no path (`/trpc/a,b,c,…`);
// com o batch cheio (ex.: a ficha do cliente) o path passa de 100 chars e o find-my-way
// do Fastify devolveria 414. 5000 cobre qualquer batch com folga.
const app = Fastify({
  logger: true,
  trustProxy: [...PROXY_CONFIAVEL],
  maxParamLength: 5000,
});

await app.register(cookie, { secret: config.SESSION_SECRET });
await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });

// Headers de segurança + CSP afinada. Ver correção #5 da finalização.
//  - script-src 'self': o SPA buildado tem só JS externo (nenhum <script> inline).
//  - style-src 'unsafe-inline': o React aplica estilos inline (style={{…}}) — justificativa técnica.
//  - img-src data:/blob:: avatares e imagens de assinatura são data-URI; previews de upload = blob.
//  - font-src 'self' data:: Montserrat é self-hosted (@fontsource), não CDN.
//  - connect-src inclui o WebSocket (Socket.IO) da mesma origem (ws/wss).
//  - upgrade-insecure-requests só em produção (HTTPS).
const wsOrigin = config.WEB_ORIGIN.replace(/^http/i, "ws"); // http→ws, https→wss
const opcoesHelmet = {
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      formAction: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'", wsOrigin],
      workerSrc: ["'self'", "blob:"],
      ...(isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  // Permite abrir recursos próprios (ex.: download de arquivo/PDF) sem bloquear cross-origin legítimo.
  crossOriginResourcePolicy: { policy: "same-origin" as const },
  crossOriginEmbedderPolicy: false,
};
await app.register(helmet, opcoesHelmet);
// O painel SISTEMA → Manutenção LÊ daqui. E lê do objeto acima, não de uma segunda declaração:
// o jeito mais provável de desligar a CSP não é apagar o `register`, é trocar
// `contentSecurityPolicy` por `false` — e nesse caso o painel precisa dizer "Desligada" sozinho.
// Marcar "ligada" à mão reintroduziria, a uma edição de distância, exatamente o defeito que a
// ADR-135 corrigiu, e desta vez para o lado perigoso.
marcarCspLigada(Boolean(opcoesHelmet.contentSecurityPolicy));

// Limite de requisições por IP — baseline contra abuso/brute-force/scraping.
// Folgado para o uso normal (o front agrupa queries); barra rajadas.
await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

await app.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    createContext,
    onError({
      path,
      error,
      ctx,
    }: {
      path?: string;
      error: TRPCError;
      ctx?: Context;
    }) {
      app.log.error({ path, err: error }, "tRPC error");
      // Só bugs de servidor (não erros esperados de validação/autz) vão para o painel de Sistema.
      if (error.code === "INTERNAL_SERVER_ERROR") {
        void registrarErro({
          rota: path ?? null,
          mensagem: error.message,
          stack: error.stack ?? null,
          userId: ctx?.user?.id ?? null,
        }).catch(() => {});
      }
    },
  },
});

app.get("/health", async () => ({ status: "ok", ts: new Date().toISOString() }));

// Upload/download de arquivos (multipart + stream, fora do tRPC).
// Valida a pasta de uploads no boot — em produção, impede subir se UPLOADS_DIR for relativo
// ou não puder ser escrito (ver #4). Loga o resultado.
const upl = await validarPastaUploads();
app.log.info({ uploads: upl }, `[uploads] base=${upl.base} escrita=${upl.escrita}`);
await registrarRotasArquivos(app);

// Corpo do e-mail em documento próprio, com CSP própria (o `srcdoc` herdaria a CSP da app e
// bloquearia a imagem remota mesmo depois de a pessoa clicar em "Mostrar imagens").
registrarRotaCorpoEmail(app);
registrarRotaLinkDeAssinatura(app);

// Anexo de e-mail: baixar (stream) e anexar ao escrever (arquivo temporário). Depende do
// @fastify/multipart registrado dentro de `registrarRotasArquivos`, acima.
registrarRotaAnexoEmail(app);

// Em produção, o mesmo processo serve o SPA buildado (copiado para dist/public no build).
const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, "public");
if (isProd && existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/trpc") || req.url.startsWith("/socket.io")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html"); // SPA fallback
  });
}

initRealtime(app);
startReminderLoop();
startMonitor();
startAlertas();
iniciarLimpezaAnexosTemp();
// Prazo de guarda da LGPD (ADR-141): retenção sem rotina não é política de retenção.
iniciarExpurgoDeRetencao();
// Gera o hash de descarte agora: deixá-lo para a 1ª tentativa faria justamente ela destoar no
// relógio, que é o sinal que a defesa de tempo existe para apagar.
aquecerDefesaDeTempo();

await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
app.log.info(`API ouvindo na porta ${config.API_PORT}`);
