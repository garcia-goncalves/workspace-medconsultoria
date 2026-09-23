import { describe, it, expect } from "vitest";
import { DEFAULTS } from "./modelos.service.js";

/**
 * MARCADORES `{{x}}` DOS MODELOS-SEMENTE — a lista fechada do que o servidor sabe preencher.
 *
 * `render()` (documentos.service.ts) troca o marcador por valor e, quando não há valor, por
 * "*(a preencher)*". Um marcador digitado errado num modelo (`{{cliente.nme}}`) nunca dá erro:
 * vira "(a preencher)" no papel que segue ao cliente. Este teste fecha a porta — modelo novo
 * com marcador fora da lista reprova, e quem o acrescentar decide conscientemente (e o acrescenta
 * aqui, junto com a explicação de onde o valor nasce).
 *
 * Origem dos valores:
 *  - `personalizado`: preenchido só por criarPropostaPersonalizada (proposta-personalizada.service.ts);
 *  - `cliente.*` e `data`: `render()` os deriva do cliente e do relógio;
 *  - o restante vem de `variaveis` (campos do formulário "Novo documento" de cada tipo, ou do
 *    construtor de proposta/contrato), então o marcador vazio vira "(a preencher)" de propósito
 *    — a tela avisa antes de exportar (`confirmarExportacao`).
 */
export const MARCADORES_CONHECIDOS = new Set([
  "acoes", "alcance", "apresentacao", "personalizado", "atencao", "atividades", "clausulas_servicos",
  "cliente.cnpj", "cliente.email", "cliente.nome", "consultora", "contratada", "convenios",
  "dadosPagamento", "data", "data_hora", "data_reuniao", "decisoes", "decisoes_necessarias",
  "destaques", "engajamento", "entregaveis", "fora_escopo", "forma_pagamento", "foro",
  "glosas_recuperadas", "indicadores", "leads", "local", "materiais", "motivos_glosa", "numero",
  "objetivo", "objeto", "observacoes", "operadoras", "oportunidades", "participantes", "pauta",
  "percentual_glosa", "periodo", "pontos_chave", "pontos_fortes", "postagens", "prazo", "prazos",
  "profissionais", "profissionais_nomes", "proximas_acoes", "proximos_passos", "recomendacoes",
  "referente", "seguidores", "servico", "servicos", "situacao", "topicos", "total_faturado",
  "total_glosado", "valor", "valor_extenso", "var_alcance", "var_engajamento", "var_leads",
  "var_seguidores",
]);

const MARCADOR = /\{\{\s*([\w.]+)\s*\}\}/g;

describe("modelos-semente", () => {
  it("todo marcador {{x}} é de um conjunto conhecido", () => {
    const desconhecidos: string[] = [];
    for (const m of DEFAULTS) {
      for (const [, chave] of m.corpo.matchAll(MARCADOR)) {
        if (!MARCADORES_CONHECIDOS.has(chave!)) desconhecidos.push(`${m.nome}: {{${chave}}}`);
      }
    }
    expect(desconhecidos).toEqual([]);
  });

  it("não sobra chave solta ({{ sem fechar, ou marcador com formato inválido)", () => {
    const soltos: string[] = [];
    for (const m of DEFAULTS) {
      const semValidos = m.corpo.replace(MARCADOR, "");
      if (semValidos.includes("{{") || semValidos.includes("}}")) soltos.push(m.nome);
    }
    expect(soltos).toEqual([]);
  });

  it("preenchidos todos os marcadores, nenhum modelo carrega '{{', 'RASCUNHO' ou 'a preencher'", () => {
    for (const m of DEFAULTS) {
      const pronto = m.corpo.replace(MARCADOR, "valor");
      expect(pronto, m.nome).not.toContain("{{");
      expect(pronto, m.nome).not.toMatch(/rascunho|a preencher|a definir/i);
    }
  });
});
