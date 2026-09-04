import { z } from "zod";

/**
 * Configuração validada no boot. O app NÃO sobe com env inválida.
 * Carrega o .env da raiz do monorepo (feito pelo tsx/node via --env-file ou dotenv no server).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().default(4319),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatório"),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET deve ter ao menos 16 caracteres"),
  WEB_ORIGIN: z.string().url().default("http://localhost:4310"),
  // Root "primordial" IMUTÁVEL: nunca pode ser rebaixado, desativado ou excluído (nem por
  // outro ROOT, nem por ele mesmo). Garante que a aplicação nunca fique sem um super-admin.
  ROOT_PROTEGIDO_EMAIL: z.string().default("root@medconsultoria.com.br"),
  // Provedor Gemini (Google) — trocou de OPENAI_API_KEY em 04/09/2026 (ADR-151). Chave gratuita,
  // gerada em aistudio.google.com/apikey.
  GEMINI_API_KEY: z.string().optional(),
  // Interruptor GLOBAL da IA (privacidade): "false"/"0" desliga a IA MESMO com chave presente.
  // Útil para cortar o envio de dados ao provedor sem remover a chave. Ver docs/IA_PRIVACIDADE.md.
  IA_ENABLED: z.string().optional(),
  // Pasta persistente onde ficam os arquivos enviados (upload). Relativa ao cwd do
  // processo ou absoluta. Na TineHost deve apontar para uma pasta FORA do diretório do
  // deploy (que é sobrescrito no rsync) e entrar no backup. Ver DECISIONS (pendência de deploy).
  UPLOADS_DIR: z.string().default("storage/uploads"),
  // E-mail transacional (opcional). Sem SMTP_HOST, o app roda em "modo dev":
  // os convites/links são exibidos na tela em vez de enviados por e-mail.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  // Ops de produção (opcionais; definidas só no .env do servidor). Deixam a aba "Operação" da
  // SISTEMA enxergar os backups automáticos e disparar um backup sob demanda. Ausentes no dev →
  // a aba mostra "não configurado neste ambiente" (degrada com elegância).
  BACKUPS_DIR: z.string().optional(),
  OPS_DIR: z.string().optional(),
  // Chave de cifra das senhas das caixas de e-mail plugadas pela equipe (32 bytes em base64).
  // Gerar com: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  // Ausente → o e-mail dentro da aplicação fica DESLIGADO (mesma degradação do SMTP).
  EMAIL_CRYPTO_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Configuração inválida:\n", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === "production";

/**
 * `WEB_ORIGIN` em produção: sem default silencioso.
 *
 * O default de desenvolvimento é `http://localhost:4310`. Se a variável faltar no `.env` do
 * servidor, o app **sobe normalmente** — mas o CORS passa a recusar o domínio real e o cookie de
 * sessão não volta. Sintoma: ninguém consegue entrar, e **nenhum erro aparece no servidor**.
 * Falhar aqui custa um minuto; descobrir isso em produção custa muito mais.
 *
 * `UPLOADS_DIR` não precisa de verificação aqui: `lib/storage.ts::validarPastaUploads` já exige
 * caminho ABSOLUTO em produção e testa escrita de verdade antes de o app subir.
 */
if (isProd) {
  const origem = process.env.WEB_ORIGIN;
  const problema = !origem
    ? "WEB_ORIGIN não definida"
    : origem.includes("localhost") || origem.includes("127.0.0.1")
      ? `WEB_ORIGIN aponta para o ambiente local ("${origem}")`
      : !origem.startsWith("https://")
        ? `WEB_ORIGIN sem https ("${origem}") — o cookie de sessão é "secure" em produção e não voltaria`
        : null;
  if (problema) {
    console.error(
      `❌ Configuração inválida para produção: ${problema}.\n` +
        "   Defina WEB_ORIGIN no .env do servidor com o domínio público exato (ex.: https://workspace.medconsultoria.com.br).",
    );
    process.exit(1);
  }
}
/** IA (Gemini) disponível = chave presente E não desligada globalmente (IA_ENABLED != false/0). */
const iaDesligada = ["false", "0", "off", "no"].includes((config.IA_ENABLED ?? "").trim().toLowerCase());
export const isAiEnabled = !!config.GEMINI_API_KEY && !iaDesligada;
/** E-mail "real" só quando SMTP está completo; caso contrário, modo dev (link em tela). */
export const isEmailReal = !!(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS);
/** E-mail dentro da app (IMAP por usuário) só liga com a chave de cifra presente e válida. */
export const isEmailAppEnabled = (() => {
  const b64 = config.EMAIL_CRYPTO_KEY;
  if (!b64) return false;
  try {
    return Buffer.from(b64, "base64").length === 32;
  } catch {
    return false;
  }
})();
