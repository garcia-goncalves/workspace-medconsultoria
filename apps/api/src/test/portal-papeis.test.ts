import { describe, it, expect } from "vitest";
import {
  podeNoPortal,
  sobraResponsavel,
  ACOES_LIBERADAS_PARA_EQUIPE,
  PORTAL_PAPEIS,
  PORTAL_PAPEL_LABEL,
  podeAssinarPelaClinica,
  podeAgirNoPortal,
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
      papelPortal: "RESPONSAVEL",
      operador: { id: "u1", nome: "Thaís" },
    });
    expect(r.pode).toBe(false);
    expect(r.pode === false && r.motivo).toBe("SUPORTE_SO_LEITURA");
  });

  it("a EQUIPE da clínica NÃO assina pela clínica (ADR-131)", () => {
    const r = podeAssinarPelaClinica({ papelPortal: "EQUIPE", operador: null });
    expect(r.pode).toBe(false);
    expect(r.pode === false && r.motivo).toBe("SO_RESPONSAVEL");
  });

  it("o responsável da clínica assina, logado ou não", () => {
    expect(podeAssinarPelaClinica({ papelPortal: "RESPONSAVEL" }).pode).toBe(true);
    // Conta anterior à ADR-131: papel nulo vale como responsável, a mesma leitura do `podeNoPortal`.
    expect(podeAssinarPelaClinica({ papelPortal: null }).pode).toBe(true);
  });

  it("a sessão de suporte é recusada ANTES do papel — a Med não assina nem pelo responsável", () => {
    const r = podeAssinarPelaClinica({
      papelPortal: "EQUIPE",
      operador: { id: "u1", nome: "Thaís" },
    });
    expect(r.pode === false && r.motivo).toBe("SUPORTE_SO_LEITURA");
  });

  it("conta interna da Med (sem papel de portal) não é barrada por esta regra", () => {
    expect(podeAssinarPelaClinica({ papelPortal: null, operador: null }).pode).toBe(true);
  });
});

/**
 * A RÉGUA ÚNICA DE "PODE AGIR" — a que a tela e o servidor passaram a compartilhar.
 *
 * Existe porque quatro botões do Portal ("Não tenho mais interesse", "Quero retomar",
 * "Solicitar" e "Cancelar serviço") apareciam para quem o servidor ia recusar. Consertar só a
 * tela criaria duas réguas para a mesma pergunta — o modo de falha da ADR-133 —, então o
 * `portalProcedure` passou a chamar esta mesma função.
 *
 * A matriz abaixo é a prova de que a refatoração NÃO mudou comportamento: papel × ação ×
 * sessão de suporte, com o resultado que o servidor já dava antes.
 */
describe("podeAgirNoPortal — papel x ação x sessão de suporte", () => {
  const OS_QUATRO_BOTOES = ["desistir", "retomar", "solicitarServicos", "cancelarServico"] as const;

  it("o RESPONSAVEL pode os quatro botões", () => {
    for (const acao of OS_QUATRO_BOTOES) {
      expect(podeAgirNoPortal({ papelPortal: "RESPONSAVEL", operador: null }, acao).pode, acao).toBe(true);
    }
  });

  it("a EQUIPE não pode nenhum dos quatro, e o motivo é o papel", () => {
    for (const acao of OS_QUATRO_BOTOES) {
      const v = podeAgirNoPortal({ papelPortal: "EQUIPE", operador: null }, acao);
      expect(v.pode, acao).toBe(false);
      expect(v.pode === false && v.motivo).toBe("SO_RESPONSAVEL");
    }
  });

  it("a EQUIPE PODE o que a lista de liberações libera — a trava é sobre agir pela clínica", () => {
    for (const acao of ACOES_LIBERADAS_PARA_EQUIPE) {
      expect(podeAgirNoPortal({ papelPortal: "EQUIPE", operador: null }, acao).pode, acao).toBe(true);
    }
  });

  it("a sessão de suporte da Med não faz NADA, nem o que a EQUIPE pode", () => {
    // ADR-128: "vê tudo, não assina nada". Vale inclusive para abrir chamado e enviar arquivo.
    const suporte = { papelPortal: "RESPONSAVEL" as const, operador: { id: "u1", nome: "Thaís" } };
    for (const acao of [...OS_QUATRO_BOTOES, ...ACOES_LIBERADAS_PARA_EQUIPE]) {
      const v = podeAgirNoPortal(suporte, acao);
      expect(v.pode, acao).toBe(false);
      expect(v.pode === false && v.motivo, acao).toBe("SUPORTE_SO_LEITURA");
    }
  });

  it("dar e tirar acesso é do RESPONSAVEL, e a sessão de suporte não faz nem isso", () => {
    // A tela "Quem da clínica entra aqui" mostrava "Convidar pessoa" e "Revogar" olhando SÓ o
    // papel (`papelPortal !== "EQUIPE"`) — e a sessão de suporte da Med entra justamente como
    // RESPONSAVEL da clínica. O servidor recusava (as ações `pessoas.*` nunca estiveram na
    // lista de liberações), mas a recusa chegava depois do clique e do modal: do lado de quem
    // usa, isso se lê como sistema quebrado. Quem entra no Portal enxerga contrato, preço e
    // documento — dar esse acesso é falar pela clínica.
    const AS_ACOES_DE_PESSOAS = [
      "pessoas.convidar",
      "pessoas.alterarPapel",
      "pessoas.revogar",
      "pessoas.devolver",
      "pessoas.reenviarConvite",
    ] as const;

    for (const acao of AS_ACOES_DE_PESSOAS) {
      expect(podeAgirNoPortal({ papelPortal: "RESPONSAVEL", operador: null }, acao).pode, acao).toBe(true);

      const equipe = podeAgirNoPortal({ papelPortal: "EQUIPE", operador: null }, acao);
      expect(equipe.pode, acao).toBe(false);
      expect(equipe.pode === false && equipe.motivo, acao).toBe("SO_RESPONSAVEL");

      const suporte = podeAgirNoPortal({ papelPortal: "RESPONSAVEL", operador: { id: "u1" } }, acao);
      expect(suporte.pode, acao).toBe(false);
      expect(suporte.pode === false && suporte.motivo, acao).toBe("SUPORTE_SO_LEITURA");
    }
  });

  it("a sessão de suporte vence o papel: mesmo sendo EQUIPE, o motivo é o suporte", () => {
    // A ordem importa para a MENSAGEM: quem está no painel do cliente precisa ler "modo de
    // suporte", não "peça ao responsável da clínica" — o responsável não resolveria nada.
    const v = podeAgirNoPortal({ papelPortal: "EQUIPE", operador: { id: "u1" } }, "cancelarServico");
    expect(v.pode === false && v.motivo).toBe("SUPORTE_SO_LEITURA");
  });

  it("papel NULO vale como RESPONSAVEL — são as contas anteriores à regra", () => {
    for (const acao of OS_QUATRO_BOTOES) {
      expect(podeAgirNoPortal({ papelPortal: null, operador: null }, acao).pode, acao).toBe(true);
    }
  });

  it("ação nova nasce FECHADA para a EQUIPE (o padrão é negar)", () => {
    expect(podeAgirNoPortal({ papelPortal: "EQUIPE", operador: null }, "acaoQueNinguemEscreveuAinda").pode).toBe(false);
  });

  it("dá exatamente a mesma resposta que as duas condições soltas de antes", () => {
    // A refatoração juntou `operador` + `podeNoPortal` numa função. Esta é a prova de que a
    // matriz não mudou: para toda combinação, o veredito bate com a conta feita à mão.
    const papeis = ["RESPONSAVEL", "EQUIPE", null] as const;
    const acoes = [...OS_QUATRO_BOTOES, ...ACOES_LIBERADAS_PARA_EQUIPE, "qualquerOutra"];
    for (const papelPortal of papeis) {
      for (const operador of [null, { id: "u1" }]) {
        for (const acao of acoes) {
          const esperado = operador ? false : podeNoPortal(papelPortal, acao);
          expect(podeAgirNoPortal({ papelPortal, operador }, acao).pode, `${papelPortal}/${acao}`).toBe(esperado);
        }
      }
    }
  });
});
