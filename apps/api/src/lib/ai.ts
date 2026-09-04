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
  transcrever(buffer: Buffer, filename: string): Promise<string>;
}

// Achado por chamada real, não por documentação — a Cora tentou `gemini-3.8-flash` (503,
// sobrecarga) e `gemini-2.5-flash` (404, aposentado; a própria API sugeriu este no erro).
const MODELO = "gemini-3.6-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;

// Este modelo gasta parte do orçamento de saída em "thinking" interno antes do texto visível
// (thoughtsTokenCount) — com teto baixo a resposta corta (finishReason MAX_TOKENS). 4096 é o
// valor que a Cora já validou sem cortar.
const MAX_OUTPUT_TOKENS = 4096;

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

/** Chama `generateContent` e devolve o texto — nunca o JSON cru da Google para quem chamou. */
async function chamarGemini(systemInstruction: string, textoUsuario: string): Promise<string> {
  const chave = garantirChave();

  const resp = await fetch(`${ENDPOINT}?key=${chave}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: textoUsuario }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: MAX_OUTPUT_TOKENS },
    }),
  });

  if (!resp.ok) {
    const corpo = await resp.json().catch(() => null);
    const mensagem = (corpo as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(
      `Gemini respondeu ${resp.status}${mensagem ? `: ${mensagem}` : ""} — a IA não gerou o rascunho.`,
    );
  }

  const dados = (await resp.json()) as RespostaGemini;

  if (dados.promptFeedback?.blockReason) {
    throw new Error(`O Gemini bloqueou a resposta (${dados.promptFeedback.blockReason}).`);
  }

  const partes = dados.candidates?.[0]?.content?.parts ?? [];
  const texto = partes
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("")
    .trim();

  if (!texto) {
    throw new Error("O Gemini devolveu resposta vazia — nada para revisar.");
  }
  return texto;
}

export const aiService: AiService = {
  async gerarRascunho(system: string, user: string): Promise<string> {
    // ADR-141 — ESTA é a porta única para o provedor de IA: toda a app passa por aqui.
    // A peneira mora no portão, não em cada lugar que monta contexto: a lição da
    // ADR-140 é que o furo aparece na SEGUNDA porta, e chamada nova nasce coberta.
    const { texto, achados } = redigirDadoPessoal(user);
    const bruto = await chamarGemini(
      achados.length ? `${system}\n\n${AVISO_MARCADORES_IA}` : system,
      texto,
    );
    // A volta devolve o original: sem isto, "melhorar com IA" apagaria o CNPJ do contrato.
    return restaurarDadoPessoal(bruto, achados);
  },

  // ⚠️ Ainda não exercido com áudio real — a Cora não usa Gemini para transcrição (o motor de
  // teste de lá é só texto). O Gemini aceita áudio como parte multimodal `inlineData` dentro do
  // mesmo `generateContent`; o limite conhecido é o corpo da requisição inteira em base64 (~20 MB
  // no endpoint REST) — áudio de reunião longa pode estourar isso, e nesse caso a saída seria o
  // "File API" do Gemini (upload em duas etapas), não implementado aqui.
  async transcrever(buffer: Buffer, _filename: string): Promise<string> {
    const chave = garantirChave();
    const audioBase64 = buffer.toString("base64");

    const resp = await fetch(`${ENDPOINT}?key=${chave}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: "Transcreva literalmente, em português, o que é dito neste áudio. Devolva só a transcrição, sem comentário nenhum." },
              { inlineData: { mimeType: "audio/mpeg", data: audioBase64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS },
      }),
    });

    if (!resp.ok) {
      const corpo = await resp.json().catch(() => null);
      const mensagem = (corpo as { error?: { message?: string } } | null)?.error?.message;
      throw new Error(
        `Gemini respondeu ${resp.status}${mensagem ? `: ${mensagem}` : ""} — a transcrição não saiu.`,
      );
    }

    const dados = (await resp.json()) as RespostaGemini;
    const partes = dados.candidates?.[0]?.content?.parts ?? [];
    return partes
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join("")
      .trim();
  },
};
