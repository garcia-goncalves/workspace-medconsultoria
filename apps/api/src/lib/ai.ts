import { AVISO_MARCADORES_IA, redigirDadoPessoal, restaurarDadoPessoal } from "@app/shared";
import { config, isAiEnabled } from "../config.js";

/**
 * Camada de IA (Fase 9) — provedor Gemini (Google), REST direto, sem SDK. Ver docs/DECISIONS.md
 * ADR-6 e ADR-151 (a troca de provedor). Trocou de OpenAI para Gemini em 04/09/2026 — mesma
 * configuração já provada pela Cora (`cora-med`, motor de teste da ADR 0003 de lá): sem SDK
 * novo, porque este servidor já não usa framework HTTP nenhum, chamada crua com `fetch` basta.
 *
 * `gerarRascunho` sempre produz TEXTO de rascunho — o envio de documento exige
 * aprovação humana (garantido pelo fluxo de status). Versões geradas por IA são
 * marcadas com `origem: "IA"`. Se não houver GEMINI_API_KEY, lança erro claro.
 */
export interface AiService {
  gerarRascunho(system: string, user: string): Promise<string>;
  /** Transcreve um áudio (reunião, ditado) para texto — usado em Ata/Pauta/IA. */
  transcrever(buffer: Buffer, mimetype: string): Promise<string>;
}

// Achado por chamada real, não por documentação — a Cora tentou `gemini-3.8-flash` (503,
// sobrecarga) e `gemini-2.5-flash` (404, aposentado; a própria API sugeriu este no erro).
const MODELO = "gemini-3.6-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;

// Este modelo gasta parte do orçamento de saída em "thinking" interno antes do texto visível
// (thoughtsTokenCount) — com teto baixo a resposta corta (finishReason MAX_TOKENS). 4096 é o
// valor que a Cora já validou sem cortar.
const MAX_OUTPUT_TOKENS = 4096;

// Achado do revisor de TS: chamada de rede externa sem teto trava a requisição do Fastify
// indefinidamente se o Gemini engasgar — diferente do padrão do resto do projeto, que sempre põe
// tempo máximo em chamada de rede.
const TIMEOUT_MS = 30_000;

interface ParteGemini {
  text?: string;
  /** Marca a parte como raciocínio interno do modelo, não a resposta — nunca vai para o usuário. */
  thought?: boolean;
}

interface RespostaGemini {
  candidates?: Array<{ content?: { parts?: ParteGemini[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

function garantirChave(): string {
  if (!isAiEnabled || !config.GEMINI_API_KEY) {
    throw new Error("IA não configurada. Defina GEMINI_API_KEY no .env.");
  }
  return config.GEMINI_API_KEY;
}

function textoDasPartes(partes: ParteGemini[]): string {
  return partes
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("")
    .trim();
}

/**
 * Faz o POST em `generateContent` e devolve o JSON já validado como `ok`.
 *
 * ⚠️ `chave` NUNCA aparece na mensagem de erro daqui — ela vai só na URL da chamada. Um `fetch`
 * que falha ANTES de obter resposta (DNS, conexão recusada, timeout) lançaria um erro nativo do
 * Node com a URL completa no meio; por isso o `catch` relança com mensagem própria, sem
 * interpolar `chave` nem a URL (achado do revisor: `?key=${chave}` some se o erro cru subisse).
 */
async function chamarGeminiOk(chave: string, corpo: unknown): Promise<RespostaGemini> {
  let resp: Response;
  try {
    resp = await fetch(`${ENDPOINT}?key=${chave}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const semTempo = e instanceof Error && e.name === "TimeoutError";
    throw new Error(semTempo ? "O Gemini não respondeu a tempo." : "Não consegui falar com o Gemini (rede).");
  }

  if (!resp.ok) {
    const corpoErro = await resp.json().catch(() => null);
    const mensagem = (corpoErro as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(`Gemini respondeu ${resp.status}${mensagem ? `: ${mensagem}` : ""}.`);
  }

  const dados = (await resp.json()) as RespostaGemini;
  if (dados.promptFeedback?.blockReason) {
    throw new Error(`O Gemini bloqueou a resposta (${dados.promptFeedback.blockReason}).`);
  }
  return dados;
}

export const aiService: AiService = {
  async gerarRascunho(system: string, user: string): Promise<string> {
    // ADR-141 — ESTA é a porta única para o provedor de IA: toda a app passa por aqui.
    // A peneira mora no portão, não em cada lugar que monta contexto: a lição da
    // ADR-140 é que o furo aparece na SEGUNDA porta, e chamada nova nasce coberta.
    const { texto, achados } = redigirDadoPessoal(user);
    const chave = garantirChave();
    const dados = await chamarGeminiOk(chave, {
      systemInstruction: { parts: [{ text: achados.length ? `${system}\n\n${AVISO_MARCADORES_IA}` : system }] },
      contents: [{ role: "user", parts: [{ text: texto }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: MAX_OUTPUT_TOKENS },
    });

    const bruto = textoDasPartes(dados.candidates?.[0]?.content?.parts ?? []);
    if (!bruto) throw new Error("O Gemini devolveu resposta vazia — nada para revisar.");
    // A volta devolve o original: sem isto, "melhorar com IA" apagaria o CNPJ do contrato.
    return restaurarDadoPessoal(bruto, achados);
  },

  // ⚠️ Ainda não exercido com áudio REAL de reunião — a Cora não usa Gemini para transcrição (o
  // motor de teste de lá é só texto). O Gemini aceita áudio como parte multimodal `inlineData`
  // dentro do mesmo `generateContent`; o limite conhecido é o corpo da requisição inteira em
  // base64 (~20 MB no endpoint REST) — áudio de reunião longa pode estourar isso, e nesse caso a
  // saída seria o "File API" do Gemini (upload em duas etapas), não implementado aqui.
  async transcrever(buffer: Buffer, mimetype: string): Promise<string> {
    const chave = garantirChave();
    const audioBase64 = buffer.toString("base64");
    // Achado do revisor: mandar "audio/mpeg" fixo mentia para o Gemini — a gravação pelo
    // microfone do navegador manda WebM/Opus, não MP3. Usa o mimetype REAL do arquivo recebido
    // (via multipart), só removendo parâmetro de codec (`;codecs=opus`) que o `MediaRecorder` do
    // navegador anexa e que a Gemini API não espera no campo `mimeType`.
    const mimeTypeLimpo = mimetype.split(";")[0]?.trim() || "audio/webm";

    const dados = await chamarGeminiOk(chave, {
      contents: [
        {
          role: "user",
          parts: [
            { text: "Transcreva literalmente, em português, o que é dito neste áudio. Devolva só a transcrição, sem comentário nenhum." },
            { inlineData: { mimeType: mimeTypeLimpo, data: audioBase64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS },
    });

    return textoDasPartes(dados.candidates?.[0]?.content?.parts ?? []);
  },
};
