/**
 * O que a proposta diz sobre DINHEIRO A RECEBER: onde o cliente paga, e quando (ADR-127).
 *
 * O caso que originou: o papel real que a Thaís manda ao cliente traz os dados bancários e a
 * chave PIX no fim, e diz explicitamente quando o repasse do faturamento cai. O sistema não
 * guardava nem uma coisa nem outra — a conta bancária não existia em lugar nenhum, e o "quando"
 * dependia de alguém digitar a frase, igual, num campo livre chamado "Condições de pagamento".
 * Esse campo foi removido: não há condição a negociar, é sempre PIX.
 *
 * O que estes testes guardam, e não pode regredir:
 *  - campo em branco NÃO vira rótulo vazio no papel do cliente ("Agência: " sozinho);
 *  - com nada cadastrado, o bloco inteiro some — melhor faltar do que sair pela metade;
 *  - a frase do repasse sai do CADASTRO do serviço, e só cai no texto padrão quando não há
 *    nenhum cadastrado;
 *  - frases iguais não se repetem no documento;
 *  - o corpo do modelo de faturamento continua declarando os marcadores que o servidor preenche,
 *    e continua SEM os dois que a ADR-127 tirou de circulação.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { montarDadosPagamento, fraseDoRepasse, FRASE_REPASSE_FATURAMENTO } from "@app/shared";

const COMPLETO = {
  bancoNome: "Nubank",
  bancoAgencia: "0001",
  bancoConta: "686169152-5",
  bancoTitular: "Thais Garcia Gestão Saúde",
  pixChave: "34.270.022/0001-93",
};

const VAZIO = { bancoNome: null, bancoAgencia: null, bancoConta: null, bancoTitular: null, pixChave: null };

describe("dados para pagamento no papel do cliente", () => {
  it("monta uma linha por campo preenchido", () => {
    const bloco = montarDadosPagamento(COMPLETO);
    expect(bloco).toContain("| Banco | Nubank |");
    expect(bloco).toContain("| Agência | 0001 |");
    expect(bloco).toContain("| Conta | 686169152-5 |");
    expect(bloco).toContain("| Titular | Thais Garcia Gestão Saúde |");
    expect(bloco).toContain("| Chave PIX | 34.270.022/0001-93 |");
  });

  it("com NADA cadastrado, devolve vazio — a seção some do documento", () => {
    expect(montarDadosPagamento(VAZIO)).toBe("");
    expect(montarDadosPagamento({ ...VAZIO, bancoAgencia: "   " })).toBe("");
  });

  it("campo em branco não vira rótulo solto na frente do cliente", () => {
    const bloco = montarDadosPagamento({ ...COMPLETO, bancoAgencia: "", bancoTitular: null });
    expect(bloco).toContain("| Banco | Nubank |");
    expect(bloco).not.toContain("Agência");
    expect(bloco).not.toContain("Titular");
    // e o que sobrou continua sendo uma tabela válida, não um pedaço solto
    expect(bloco.split("\n")[0]).toBe("| | |");
  });

  it("só o PIX preenchido já rende um bloco", () => {
    expect(montarDadosPagamento({ ...VAZIO, pixChave: "contato@medconsultoria.com.br" })).toContain(
      "| Chave PIX | contato@medconsultoria.com.br |",
    );
  });
});

describe("a frase de quando o repasse é pago", () => {
  it("usa o texto cadastrado no serviço", () => {
    const cadastrada = "O repasse é feito todo dia 10, após o crédito da operadora.";
    expect(fraseDoRepasse([cadastrada])).toBe(cadastrada);
  });

  it("cai no texto padrão quando nenhum serviço tem frase própria", () => {
    expect(fraseDoRepasse([])).toBe(FRASE_REPASSE_FATURAMENTO);
    expect(fraseDoRepasse([null, undefined, "  "])).toBe(FRASE_REPASSE_FATURAMENTO);
  });

  it("não repete a mesma frase quando dois serviços percentuais têm o mesmo texto", () => {
    const f = "O recebimento do Repasse será sempre feito após o crédito na conta da Clínica.";
    expect(fraseDoRepasse([f, f])).toBe(f);
  });

  it("junta frases DIFERENTES — no caso misturado o cliente precisa ler as duas", () => {
    const a = "Repasse após o crédito da operadora.";
    const b = "Mensalidade no dia 5.";
    expect(fraseDoRepasse([a, b])).toBe(`${a} ${b}`);
  });
});

describe("o corpo do modelo de proposta de faturamento", () => {
  const modelos = readFileSync(
    fileURLToPath(new URL("../modules/documentos/modelos.service.ts", import.meta.url)),
    "utf8",
  );
  // Só o CORPO do modelo de faturamento — nem os outros 15 modelos do arquivo, nem o comentário
  // que explica a decisão logo acima dele (o comentário cita "Condições de pagamento" de
  // propósito, contando por que ela saiu; proibir a explicação seria trocar uma armadilha por
  // outra).
  const trecho = modelos.slice(
    modelos.indexOf('nome: "Proposta de faturamento médico"'),
    modelos.indexOf('nome: "Contrato de prestação de serviços"'),
  );
  const corpo = trecho.slice(trecho.indexOf("corpo: "));

  it("declara os marcadores que o servidor preenche", () => {
    for (const marcador of ["{{numero}}", "{{data}}", "{{convenios}}", "{{servicos}}", "{{dadosPagamento}}", "{{consultora}}"]) {
      expect(corpo).toContain(marcador);
    }
  });

  it("traz as seções do papel real da Thaís, na ordem dela", () => {
    // Sem numeração, como no papel dela. O título "Investimento" NÃO está aqui de propósito:
    // quem o traz é o bloco {{servicos}}, montado pelo servidor — escrevê-lo também no modelo
    // punha dois títulos "Investimento" seguidos no documento.
    const secoes = [
      "Objetivo da parceria",
      "Como funciona o nosso serviço",
      "O que a Clínica nos encaminha",
      "O que a MedConsultoria faz",
      "Suporte comercial",
      "Gestão e acompanhamento",
      "Prazos e rotina de faturamento",
      "{{servicos}}",
      "{{dadosPagamento}}",
      "Confidencialidade",
    ];
    let cursor = -1;
    for (const secao of secoes) {
      const pos = corpo.indexOf(secao);
      expect(pos, `seção ausente: ${secao}`).toBeGreaterThan(-1);
      expect(pos, `seção fora de ordem: ${secao}`).toBeGreaterThan(cursor);
      cursor = pos;
    }
  });

  it("os dados de pagamento saem na comercial e no faturamento, mas NÃO no credenciamento", () => {
    // Ordem do dono (26/08/2026): a proposta de credenciamento não mostra onde pagar, porque
    // ali a Thaís só cobra depois do sucesso do credenciamento na operadora — a conta a receber
    // nasce na aprovação, não no aceite (ADR-104).
    const corpoDe = (nome: string, ate: string) => {
      const t = modelos.slice(modelos.indexOf(`nome: "${nome}"`), modelos.indexOf(`nome: "${ate}"`));
      return t.slice(t.indexOf("corpo: "));
    };
    expect(corpoDe("Proposta comercial", "Proposta de credenciamento")).toContain("{{dadosPagamento}}");
    expect(corpo).toContain("{{dadosPagamento}}");
    expect(corpoDe("Proposta de credenciamento", "Proposta de faturamento médico")).not.toContain(
      "{{dadosPagamento}}",
    );
  });

  it("NÃO fala em condições de pagamento nem em faixa de faturamento", () => {
    // O Faturamento é só percentual, negociado por cliente (ordem do dono, 26/08/2026), e não
    // há condição a negociar: é sempre PIX. Se uma das duas voltar ao papel, este teste reprova.
    expect(corpo).not.toContain("Condições de pagamento");
    expect(corpo.toLowerCase()).not.toContain("faturamento bruto mensal");
  });
});
