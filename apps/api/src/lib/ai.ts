import OpenAI, { toFile } from "openai";
import { AVISO_MARCADORES_IA, redigirDadoPessoal, restaurarDadoPessoal } from "@app/shared";
import { config, isAiEnabled } from "../config.js";

/**
 * Camada de IA (Fase 9) — provedor OpenAI. Ver docs/DECISIONS.md ADR-6.
 *
 * `gerarRascunho` sempre produz TEXTO de rascunho — o envio de documento exige
 * aprovação humana (garantido pelo fluxo de status). Versões geradas por IA são
 * marcadas com `origem: "IA"`. Se não houver OPENAI_API_KEY, lança erro claro.
 */
export interface AiService {
  gerarRascunho(system: string, user: string): Promise<string>;
  /** Transcreve um áudio (reunião, ditado) para texto — usado em Ata/Pauta/IA. */
  transcrever(buffer: Buffer, filename: string): Promise<string>;
}

const MODELO = "gpt-4o-mini"; // barato e capaz (decisão de custo — ADR-6)

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!isAiEnabled) {
    throw new Error("IA não configurada. Defina OPENAI_API_KEY no .env.");
  }
  if (!client) client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  return client;
}

export const aiService: AiService = {
  async gerarRascunho(system: string, user: string): Promise<string> {
    // ADR-141 — ESTA é a porta única para a OpenAI: toda a app passa por aqui.
    // A peneira mora no portão, não em cada lugar que monta contexto: a lição da
    // ADR-140 é que o furo aparece na SEGUNDA porta, e chamada nova nasce coberta.
    const { texto, achados } = redigirDadoPessoal(user);
    const resp = await getClient().chat.completions.create({
      model: MODELO,
      temperature: 0.4,
      messages: [
        { role: "system", content: achados.length ? `${system}\n\n${AVISO_MARCADORES_IA}` : system },
        { role: "user", content: texto },
      ],
    });
    const bruto = resp.choices[0]?.message?.content?.trim() ?? "";
    // A volta devolve o original: sem isto, "melhorar com IA" apagaria o CNPJ do contrato.
    return restaurarDadoPessoal(bruto, achados);
  },

  async transcrever(buffer: Buffer, filename: string): Promise<string> {
    const file = await toFile(buffer, filename);
    const resp = await getClient().audio.transcriptions.create({ file, model: "whisper-1", language: "pt" });
    return (resp.text ?? "").trim();
  },
};
