import { describe, it, expect } from "vitest";
import { destinatariosDaRespostaAoCliente } from "../modules/mensagens/aviso-de-resposta.js";
import { templateDe } from "../modules/emails/emails.registry.js";

/**
 * M8 — O CLIENTE ABRE O CHAMADO, A EQUIPE RESPONDE, E ELE NÃO FICA SABENDO.
 *
 * O caminho de ida já existia: cliente escreve → a equipe recebe `suporte` (notificação +
 * e-mail). A volta não existia. O cliente só descobria a resposta se voltasse ao Portal por
 * conta própria — e quem abre chamado costuma abrir e sair.
 *
 * A régua de PARA QUEM vai o aviso é pura de propósito: é a mesma pergunta que a ficha, o
 * `destinatarioDeAssinatura` e o painel de pessoas já fazem — e `ativo = false` sozinho não
 * responde (ADR-131: conta convidada também é inativa; quem foi revogado tem
 * `acessoRevogadoEm`).
 */

type P = Parameters<typeof destinatariosDaRespostaAoCliente>[0][number];

const pessoa = (over: Partial<P> = {}): P => ({
  userId: "u1",
  nome: "Dra. Helena",
  email: "teste.helena@medconsultoria.com.br",
  role: "CLIENTE",
  ativo: true,
  acessoRevogadoEm: null,
  ...over,
});

describe("quem é avisado quando a equipe responde o chamado", () => {
  it("avisa as contas do Portal daquela clínica", () => {
    const r = destinatariosDaRespostaAoCliente([pessoa()], "operador");
    expect(r).toEqual([{ nome: "Dra. Helena", email: "teste.helena@medconsultoria.com.br" }]);
  });

  it("não avisa quem é da casa — a equipe já tem a conversa na tela", () => {
    expect(
      destinatariosDaRespostaAoCliente(
        [pessoa({ userId: "op", role: "ADMIN", email: "teste.equipe@medconsultoria.com.br" })],
        "outro",
      ),
    ).toEqual([]);
  });

  it("não manda de volta para quem acabou de escrever", () => {
    expect(destinatariosDaRespostaAoCliente([pessoa({ userId: "u1" })], "u1")).toEqual([]);
  });

  it("não escreve para quem teve o acesso REVOGADO, mesmo que a linha ainda esteja lá", () => {
    expect(destinatariosDaRespostaAoCliente([pessoa({ acessoRevogadoEm: new Date() })], "op")).toEqual([]);
  });

  it("quem foi CONVIDADO e ainda não entrou continua sendo avisado", () => {
    // `ativo: false` aqui NÃO quer dizer acesso encerrado — quer dizer "ainda não criou senha".
    // Deixar de avisá-lo esconderia a resposta justamente de quem ainda nem sabe que o Portal
    // existe. Ver ADR-131.
    expect(destinatariosDaRespostaAoCliente([pessoa({ ativo: false })], "op")).toHaveLength(1);
  });

  it("ignora conta sem e-mail e tombstone de excluído", () => {
    expect(destinatariosDaRespostaAoCliente([pessoa({ email: null })], "op")).toEqual([]);
    expect(
      destinatariosDaRespostaAoCliente([pessoa({ email: "deleted+abc@medconsultoria.com.br" })], "op"),
    ).toEqual([]);
  });

  it("não repete o mesmo endereço quando a pessoa participa duas vezes", () => {
    expect(destinatariosDaRespostaAoCliente([pessoa(), pessoa({ userId: "u2" })], "op")).toHaveLength(1);
  });

  it("o modelo do e-mail existe no registry (senão o render explode em runtime)", () => {
    const meta = templateDe("suporte_resposta");
    expect(meta).toBeDefined();
    expect(meta?.notificacao).toBe(false); // transacional para o cliente, não aviso interno
  });
});
