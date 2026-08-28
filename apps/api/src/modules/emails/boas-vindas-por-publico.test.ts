import { describe, it, expect } from "vitest";
import { EMAIL_TEMPLATES } from "./emails.registry.js";
import { templateDeBoasVindas } from "./boas-vindas-por-publico.js";

/**
 * O cliente do Portal recebia um e-mail escrito para a EQUIPE.
 *
 * `aceitarConvite` chamava `enviarBoasVindas` sem olhar o papel — e o cliente do Portal também é
 * `User` (a mesma armadilha da ADR-100 e do vazamento de token de 05/08). O médico que acabava de
 * ativar o acesso ao **Portal** recebia, conferido na tela de Mensagens automáticas em 28/08/2026:
 *
 *   Assunto: "Bem-vindo ao Workspace MedConsultoria"
 *   Corpo:   "Sua conta no Workspace MedConsultoria foi ativada… Aqui você acompanha clientes,
 *             projetos, agenda, finanças, documentos e se comunica com a equipe"
 *   Botão:   "Acessar o workspace"  →  o sistema INTERNO da Med
 *
 * Três coisas erradas de uma vez: o nome de um sistema que ele não conhece, a promessa de
 * funcionalidades que ele não tem, e um botão para o lugar errado. É o mesmo tipo de vazamento de
 * vocabulário interno que a memória `conteudo-institucional-real` proíbe em material do cliente.
 */
describe("boas-vindas escolhe o texto pelo público", () => {
  it("cliente do Portal recebe o texto do PORTAL", () => {
    expect(templateDeBoasVindas("CLIENTE")).toBe("boas_vindas_portal");
  });

  it("quem é da casa continua recebendo o texto do Workspace", () => {
    for (const papel of ["ROOT", "ADMIN", "FUNCIONARIO"] as const) {
      expect(templateDeBoasVindas(papel)).toBe("boas_vindas");
    }
  });

  /**
   * ⚠️ O padrão é o do CLIENTE. Papel novo (ou nulo, vindo de conta antiga) cai no texto neutro:
   * errar para o lado do cliente tira um link que ele já tinha na tela; errar para o outro lado
   * manda o endereço do sistema interno para fora da empresa.
   */
  it("papel desconhecido cai no texto do Portal, nunca no do Workspace", () => {
    expect(templateDeBoasVindas(null)).toBe("boas_vindas_portal");
    expect(templateDeBoasVindas("PAPEL_QUE_AINDA_NAO_EXISTE")).toBe("boas_vindas_portal");
  });

  it("o texto do Portal não menciona o Workspace nem promete o que o cliente não tem", () => {
    const t = EMAIL_TEMPLATES.boas_vindas_portal.default;
    const tudo = `${t.assunto} ${t.titulo} ${t.corpo} ${t.ctaTexto ?? ""}`.toLowerCase();
    expect(tudo).not.toContain("workspace");
    for (const proibido of ["finanças", "equipe da med", "clientes e projetos"]) {
      expect(tudo).not.toContain(proibido);
    }
    expect(tudo).toContain("portal");
  });

  it("o texto de redefinir senha serve aos DOIS públicos — quem esquece a senha pode ser o cliente", () => {
    const t = EMAIL_TEMPLATES.reset_senha.default;
    const tudo = `${t.assunto} ${t.titulo} ${t.corpo}`.toLowerCase();
    expect(tudo).not.toContain("workspace");
  });
});
