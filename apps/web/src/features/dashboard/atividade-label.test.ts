import { describe, it, expect } from "vitest";
import { acaoLabel, atorDaAtividade } from "./DashboardPage";

/**
 * A "Atividade recente" monta a frase `<Pessoa> <ação>`. Toda ação precisa começar por um
 * VERBO, senão sai texto quebrado ("Thaís arquivo removido"). Estas ações são as que o
 * backend realmente grava em `activityLog` — se alguém adicionar uma nova sem rótulo,
 * o fallback ainda produz português legível.
 */
const ACOES_REAIS = [
  "arquivo.removido",
  "card.criado",
  "cliente.criado",
  "cliente.dados_atualizados_portal",
  "cliente.excluido_definitivo",
  "cliente.removido",
  "conta.criada",
  "documento.assinado",
  "documento.assinatura_solicitada",
  "documento.contrato_auto",
  "documento.contrato_gerado",
  "documento.ia_ata",
  "documento.ia_gerado",
  "documento.ia_pauta",
  "documento.proposta_auto",
  "documento.proposta_gerada",
  "evento.criado",
  "evento.removido",
  "lead.auto_avancou",
  "lead.auto_avancou_checklist",
  "lead.avancou_etapa",
  "lead.capturado",
  "lead.convertido",
  "lead.criado",
  "lead.moveu_etapa",
  "lead.perdido",
  "lead.reaberto",
  "lead.recapturado",
  "lead.removido",
  "lead.servicos_portal",
  "login",
  "projeto.concluido",
  "projeto.criado",
  "projeto.reaberto",
  "projeto.removido",
  "proposta.aceite_habilitado",
  "servico.cancelado",
  "servico.contratado",
  "servico.sincronizado_aceite",
];

describe("frase da Atividade recente", () => {
  it("toda ação real do backend tem rótulo próprio (nenhuma cai no fallback)", () => {
    const semRotulo = ACOES_REAIS.filter((a) => acaoLabel(a).startsWith("registrou:"));
    expect(semRotulo).toEqual([]);
  });

  it("nenhum rótulo repete a chave crua — sempre frase com verbo", () => {
    for (const acao of ACOES_REAIS) {
      const frase = acaoLabel(acao);
      expect(frase).not.toContain(".");
      expect(frase).not.toContain("_");
    }
  });

  it("o caso que quebrava vira português correto", () => {
    expect(acaoLabel("arquivo.removido")).toBe("removeu um arquivo");
  });

  it("documento gerado por modelo (ação montada em runtime) ganha frase legível", () => {
    expect(acaoLabel("documento.escopo_gerado")).toBe("gerou um documento (escopo)");
    expect(acaoLabel("documento.plano_de_acao_gerado")).toBe("gerou um documento (plano de acao)");
  });

  it("ação desconhecida ainda começa por verbo", () => {
    expect(acaoLabel("coisa.nova")).toBe("registrou: coisa nova");
  });
});

/**
 * Quem assina a linha. Evento automático (o projeto que se conclui sozinho quando o último
 * cartão fecha) saía como "Alguém concluiu um projeto" — pessoa que não existe. O servidor
 * marca `auto`; a tela obedece.
 */
describe("autor da atividade", () => {
  it("evento marcado como automático pelo servidor é da Automação, não de 'Alguém'", () => {
    expect(atorDaAtividade({ acao: "projeto.concluido", usuario: null, auto: true })).toEqual({
      nome: "Automação",
      automatico: true,
    });
  });

  it("o mesmo vale para o projeto reaberto sozinho", () => {
    expect(atorDaAtividade({ acao: "projeto.reaberto", usuario: null, auto: true }).nome).toBe("Automação");
  });

  it("avanço automático do funil continua sendo Automação mesmo sem a marca do servidor", () => {
    expect(atorDaAtividade({ acao: "lead.auto_avancou", usuario: null }).nome).toBe("Automação");
  });

  it("ação de gente mostra o nome de quem fez", () => {
    expect(atorDaAtividade({ acao: "cliente.criado", usuario: "Thaís Garcia" })).toEqual({
      nome: "Thaís Garcia",
      automatico: false,
    });
  });

  it("'Alguém' fica só para o autor genuinamente desconhecido", () => {
    expect(atorDaAtividade({ acao: "cliente.criado", usuario: null }).nome).toBe("Alguém");
  });
});
