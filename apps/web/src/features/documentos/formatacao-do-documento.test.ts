import { describe, it, expect } from "vitest";
import { DOC_STYLES, previewModelo, renderMarkdown, rotuloDoCampo, trocarCheckboxPorSimbolo } from "./DocumentoBranded";

/**
 * FORMATAÇÃO DA FOLHA — o que a auditoria de 27/08 encontrou nos 16 modelos.
 *
 * Os três defeitos abaixo tinham a mesma assinatura: **o teste passava e a tela mentia**.
 * Nenhum deles quebra a montagem do Markdown, nenhum aparece no console e nenhum é pego por
 * `tsc` — só olhando o papel. Por isso viraram asserção.
 */
describe("marcador de lista na folha do documento", () => {
  /**
   * O reset do Tailwind zera `list-style` em TODO `ul`/`ol` da aplicação. A folha declarava
   * `padding-left` e nunca declarou `list-style`, então na TELA a lista numerada saía sem os
   * números — a proposta de faturamento tem uma lista de seis passos que chegava ao cliente
   * como seis frases soltas. Na janela de impressão (que não carrega o Tailwind) os números
   * apareciam: tela e PDF discordando, o mesmo mal que a ADR-129 corrigiu por outro caminho.
   *
   * Nunca apague estas declarações confiando no "padrão do navegador": aqui o padrão do
   * navegador não vale, porque o reset já passou por cima.
   */
  it("declara list-style explicitamente para lista com bala e numerada", () => {
    expect(DOC_STYLES).toMatch(/\.doc-body ul\s*\{[^}]*list-style:\s*disc/);
    expect(DOC_STYLES).toMatch(/\.doc-body ol\s*\{[^}]*list-style:\s*decimal/);
  });

  it("mantém o `li` como item de lista (o reset também mexe no display)", () => {
    expect(DOC_STYLES).toMatch(/\.doc-body li\s*\{[^}]*display:\s*list-item/);
  });
});

describe("caixa de seleção do checklist", () => {
  /**
   * O `marked` emite `- [ ]` como `<input type="checkbox">`, e `input` é PROIBIDO no
   * sanitizador — e continua proibido: campo de formulário dentro de documento do cliente não
   * tem uso legítimo. O efeito era o checklist de credenciamento chegar ao médico como uma
   * lista de nomes de documento sem caixa nenhuma para marcar.
   */
  it("troca a caixa por um caractere que atravessa o sanitizador", () => {
    const html = renderMarkdown("- [ ] RG e CPF\n- [x] Diploma");
    expect(html).toContain("☐");
    expect(html).toContain("☑");
    expect(html).not.toContain("<input");
  });

  it("não deixa o item da checklist com caixa E bala ao mesmo tempo", () => {
    expect(renderMarkdown("- [ ] RG e CPF")).toContain('class="doc-task"');
  });

  it("reconhece a caixa marcada venha o `checked` antes ou depois do `type`", () => {
    expect(trocarCheckboxPorSimbolo('<input checked type="checkbox" disabled>')).toContain("☑");
    expect(trocarCheckboxPorSimbolo('<input type="checkbox" checked disabled>')).toContain("☑");
    expect(trocarCheckboxPorSimbolo('<input type="checkbox" disabled>')).toContain("☐");
  });
});

describe("prévia do modelo com dado real", () => {
  /**
   * Com o cliente JÁ escolhido na tela, a prévia mostrava "[nome do cliente]". Isso esconde
   * exatamente o que se confere antes de gerar: como o documento fica com o nome da clínica
   * dentro — que é mais comprido que o rótulo e quebra as linhas de outro jeito.
   */
  const corpo = "Prezado(a) {{cliente.nome}}, CNPJ {{cliente.cnpj}}, em {{data}}.";

  it("usa o dado quando ele existe", () => {
    const saida = previewModelo(corpo, {
      clienteNome: "Clínica Vida Plena",
      clienteCnpj: "12.345.678/0001-90",
      data: "27/08/2026",
    });
    expect(saida).toBe("Prezado(a) Clínica Vida Plena, CNPJ 12.345.678/0001-90, em 27/08/2026.");
  });

  it("volta ao rótulo quando o dado não existe — sem deixar marcador cru", () => {
    const saida = previewModelo(corpo);
    expect(saida).toContain("[nome do cliente]");
    expect(saida).toContain("[CNPJ]");
    expect(saida).not.toContain("{{");
  });

  it("trata vazio e só-espaço como ausente (senão a prévia fica com um buraco)", () => {
    expect(previewModelo(corpo, { clienteNome: "   " })).toContain("[nome do cliente]");
  });

  it("explica o bloco de convênios em vez de imprimir [convenios]", () => {
    expect(previewModelo("{{convenios}}")).not.toContain("[convenios]");
  });
});

describe("rótulo de campo em português", () => {
  /**
   * A prévia mostrava o nome do IDENTIFICADOR no meio de um documento que vai para o médico:
   * "[dadosPagamento]", "[clausulas_servicos]", "[fora_escopo]". Nome de código à mostra é a
   * marca de software mal acabado — e a prévia é justamente o que se olha antes de mandar.
   */
  it("traduz os campos conhecidos", () => {
    expect(rotuloDoCampo("dadosPagamento")).toBe("dados para pagamento");
    expect(rotuloDoCampo("clausulas_servicos")).toBe("condições de cada serviço");
    expect(rotuloDoCampo("decisoes")).toBe("discussões e decisões");
  });

  it("deixa legível um campo NOVO, que a Thaís crie no modelo", () => {
    expect(rotuloDoCampo("meu_campo_novo")).toBe("meu campo novo");
    expect(rotuloDoCampo("meuCampoNovo")).toBe("meu campo novo");
  });

  it("não deixa sobrar sublinhado nem camelCase em nenhum campo dos modelos", () => {
    const camposDosModelos = [
      "objeto", "valor", "prazo", "foro", "clausulas_servicos", "dadosPagamento", "contratada",
      "profissionais", "profissionais_nomes", "objetivo", "atividades", "entregaveis",
      "fora_escopo", "prazos", "observacoes", "data_reuniao", "local", "participantes", "pauta",
      "decisoes", "proximos_passos", "data_hora", "topicos", "decisoes_necessarias",
      "pontos_chave", "materiais", "periodo", "postagens", "total_faturado", "total_glosado",
      "glosas_recuperadas", "percentual_glosa", "motivos_glosa", "acoes", "recomendacoes",
      "indicadores", "destaques", "atencao", "alcance", "var_alcance", "seguidores",
      "var_seguidores", "engajamento", "var_engajamento", "leads", "var_leads", "proximas_acoes",
      "situacao", "pontos_fortes", "oportunidades", "valor_extenso", "referente",
      "forma_pagamento", "servico", "numero",
    ];
    for (const c of camposDosModelos) {
      // "MedConsultoria" é nome próprio: a maiúscula no meio é da marca, não de camelCase.
      const r = rotuloDoCampo(c).replace(/MedConsultoria/g, "");
      expect(r, `campo ${c}`).not.toMatch(/_/);
      expect(r, `campo ${c}`).not.toMatch(/[a-z][A-Z]/);
    }
  });
});
