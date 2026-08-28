import { describe, it, expect } from "vitest";
import {
  podeNoPortal,
  sobraResponsavel,
  ACOES_LIBERADAS_PARA_EQUIPE,
  PORTAL_PAPEIS,
  PORTAL_PAPEL_LABEL,
  podeAssinarPelaClinica,
} from "@app/shared";

/**
 * A regra de quem, dentro da clínica, pode o quê no Portal (ADR-131).
 *
 * Testado aqui e não na tela porque é decisão de autorização: se ela estiver errada, uma
 * secretária cancela um serviço contratado, e não há aviso nenhum na tela dizendo que isso
 * aconteceu por engano.
 */
describe("podeNoPortal — o que cada pessoa da clínica pode fazer", () => {
  it("o RESPONSAVEL pode tudo, inclusive o que compromete a clínica", () => {
    expect(podeNoPortal("RESPONSAVEL", "solicitarServicos")).toBe(true);
    expect(podeNoPortal("RESPONSAVEL", "cancelarServico")).toBe(true);
    expect(podeNoPortal("RESPONSAVEL", "desistir")).toBe(true);
    expect(podeNoPortal("RESPONSAVEL", "briefing.salvar")).toBe(true);
  });

  it("a EQUIPE NÃO assina pela clínica", () => {
    expect(podeNoPortal("EQUIPE", "solicitarServicos")).toBe(false);
    expect(podeNoPortal("EQUIPE", "cancelarServico")).toBe(false);
    expect(podeNoPortal("EQUIPE", "desistir")).toBe(false);
    expect(podeNoPortal("EQUIPE", "retomar")).toBe(false);
    expect(podeNoPortal("EQUIPE", "pessoas.convidar")).toBe(false);
    expect(podeNoPortal("EQUIPE", "pessoas.revogar")).toBe(false);
  });

  it("a EQUIPE faz o operacional: papelada, formulário, agenda e suporte", () => {
    expect(podeNoPortal("EQUIPE", "briefing.salvar")).toBe(true);
    expect(podeNoPortal("EQUIPE", "removerArquivo")).toBe(true);
    expect(podeNoPortal("EQUIPE", "confirmarReuniao")).toBe(true);
    expect(podeNoPortal("EQUIPE", "atualizarMeusDados")).toBe(true);
    expect(podeNoPortal("EQUIPE", "suporte.abrir")).toBe(true);
    expect(podeNoPortal("EQUIPE", "suporte.enviar")).toBe(true);
  });

  it("AÇÃO NOVA NASCE FECHADA para a equipe — o padrão é negar, não permitir", () => {
    // Esta é a trava que vale o teste inteiro. Se alguém escrever `portal.aceitarContrato`
    // amanhã e não pensar em permissão, a secretária NÃO pode. O contrário — nascer aberta —
    // é como se perde uma autorização em silêncio.
    expect(podeNoPortal("EQUIPE", "acaoQueAindaNaoExiste")).toBe(false);
    expect(podeNoPortal("EQUIPE", "aceitarContrato")).toBe(false);
    expect(podeNoPortal("EQUIPE", "")).toBe(false);
  });

  it("conta antiga (papel nulo) continua podendo tudo — era a conta única da clínica", () => {
    expect(podeNoPortal(null, "cancelarServico")).toBe(true);
    expect(podeNoPortal(undefined, "solicitarServicos")).toBe(true);
  });

  it("toda ação liberada para a equipe é de fato liberada", () => {
    for (const acao of ACOES_LIBERADAS_PARA_EQUIPE) {
      expect(podeNoPortal("EQUIPE", acao)).toBe(true);
    }
  });

  it("todo papel tem rótulo em português", () => {
    for (const papel of PORTAL_PAPEIS) {
      expect(PORTAL_PAPEL_LABEL[papel]).toBeTruthy();
    }
  });
});

describe("sobraResponsavel — a clínica nunca fica sem quem assine", () => {
  const dono = { id: "u1", papel: "RESPONSAVEL" as const, ativo: true };
  const secretaria = { id: "u2", papel: "EQUIPE" as const, ativo: true };

  it("recusa rebaixar o único responsável", () => {
    expect(sobraResponsavel([dono, secretaria], { id: "u1", papel: "EQUIPE" })).toBe(false);
  });

  it("recusa desativar o único responsável", () => {
    expect(sobraResponsavel([dono, secretaria], { id: "u1", ativo: false })).toBe(false);
  });

  it("permite rebaixar quando há outro responsável ativo", () => {
    const socio = { id: "u3", papel: "RESPONSAVEL" as const, ativo: true };
    expect(sobraResponsavel([dono, socio, secretaria], { id: "u1", papel: "EQUIPE" })).toBe(true);
  });

  it("um responsável DESATIVADO não conta — ele não abre a porta", () => {
    const socioInativo = { id: "u3", papel: "RESPONSAVEL" as const, ativo: false };
    expect(sobraResponsavel([dono, socioInativo], { id: "u1", ativo: false })).toBe(false);
  });

  it("promover alguém a responsável é sempre permitido", () => {
    expect(sobraResponsavel([dono, secretaria], { id: "u2", papel: "RESPONSAVEL" })).toBe(true);
  });

  it("desativar quem é só equipe não trava nada", () => {
    expect(sobraResponsavel([dono, secretaria], { id: "u2", ativo: false })).toBe(true);
  });

  it("conta antiga de papel nulo vale como responsável", () => {
    const antiga = { id: "u9", papel: null, ativo: true };
    expect(sobraResponsavel([antiga], { id: "u9", papel: "RESPONSAVEL" })).toBe(true);
    expect(sobraResponsavel([antiga], { id: "u9", ativo: false })).toBe(false);
  });

  it("responsável convidado que ainda não entrou VALE — senão a clínica trava", () => {
    // Conta sem senha definida é conta pendente; ela ainda assim é a dona da clínica. Se não
    // contasse, a clínica recém-cadastrada não conseguiria convidar a primeira secretária.
    const pendente = { id: "u4", papel: "RESPONSAVEL" as const, ativo: true };
    expect(sobraResponsavel([pendente, secretaria], { id: "u2", papel: "EQUIPE" })).toBe(true);
  });
});

/**
 * A TRAVA DAS PÁGINAS DE TOKEN (C6 da descoberta de 28/08).
 *
 * `propostas.responder` e `assinaturas.assinar` são rotas públicas, e precisam continuar
 * sendo: quem assina clica num link de e-mail sem login. O defeito era que o Portal
 * entregava o token no resumo da home, e aí quem já estava logado e **não** podia assinar
 * — a secretária EQUIPE e a sessão de suporte da Med — assinava por fora das duas travas.
 *
 * Testado aqui porque é autorização: errar para o lado permissivo faz uma secretária
 * assinar um contrato pela clínica, e nada na tela diz que foi por engano.
 */
describe("podeAssinarPelaClinica — quem pode aceitar proposta e assinar contrato", () => {
  it("ninguém logado continua podendo: é o link de e-mail, o caminho normal de quem assina", () => {
    expect(podeAssinarPelaClinica(null).pode).toBe(true);
    expect(podeAssinarPelaClinica(undefined).pode).toBe(true);
  });

  it("a sessão de suporte da Med NÃO assina — vê tudo, não assina nada (ADR-128)", () => {
    const r = podeAssinarPelaClinica({
      role: "CLIENTE",
      papelPortal: "RESPONSAVEL",
      operador: { id: "u1", nome: "Thaís" },
    });
    expect(r.pode).toBe(false);
    expect(r.pode === false && r.motivo).toBe("SUPORTE_SO_LEITURA");
  });

  it("a EQUIPE da clínica NÃO assina pela clínica (ADR-131)", () => {
    const r = podeAssinarPelaClinica({ role: "CLIENTE", papelPortal: "EQUIPE", operador: null });
    expect(r.pode).toBe(false);
    expect(r.pode === false && r.motivo).toBe("SO_RESPONSAVEL");
  });

  it("o responsável da clínica assina, logado ou não", () => {
    expect(podeAssinarPelaClinica({ role: "CLIENTE", papelPortal: "RESPONSAVEL" }).pode).toBe(true);
    // Conta anterior à ADR-131: papel nulo vale como responsável, a mesma leitura do `podeNoPortal`.
    expect(podeAssinarPelaClinica({ role: "CLIENTE", papelPortal: null }).pode).toBe(true);
  });

  it("a sessão de suporte é recusada ANTES do papel — a Med não assina nem pelo responsável", () => {
    const r = podeAssinarPelaClinica({
      role: "CLIENTE",
      papelPortal: "EQUIPE",
      operador: { id: "u1", nome: "Thaís" },
    });
    expect(r.pode === false && r.motivo).toBe("SUPORTE_SO_LEITURA");
  });

  it("conta interna da Med (sem papel de portal) não é barrada por esta regra", () => {
    expect(podeAssinarPelaClinica({ role: "ADMIN", papelPortal: null, operador: null }).pode).toBe(true);
  });
});
