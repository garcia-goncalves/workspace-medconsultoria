import { describe, it, expect } from "vitest";
import { triarCredenciamento, motivosParaOCliente, vagasCredenciamento, progressoCredenciamento } from "@app/shared";

/**
 * A TRIAGEM do credenciamento (spec `2026-08-10-proposta-credenciamento-design.md` §3.1).
 * Regra pura, sem banco: dado o cadastro do cliente, dos profissionais e o que já foi
 * entregue, dizer se dá para credenciar.
 *
 * A distinção que importa: INAPTO = fato que papelada nenhuma resolve hoje (a Thaís não
 * vende); PENDENTE = falta documento (a Thaís cobra e segue).
 */

const CLINICA_COMPLETA = { alvaraFuncionamento: true, alvaraVigilancia: true, cnes: true };
const MEDICO_OK = { id: "p1", nome: "Dra. Carina", anoFormatura: 2010, tituloEspecialista: true };

describe("triagem de credenciamento", () => {
  it("aprova quando o cliente é PJ, a clínica tem os três registros e o médico está regular", () => {
    const r = triarCredenciamento({
      cliente: { tipo: "PJ" },
      clinica: CLINICA_COMPLETA,
      profissionais: [MEDICO_OK],
      anoAtual: 2026,
    });
    expect(r.veredito).toBe("APTO");
    expect(r.motivos).toEqual([]);
  });

  it("R1: cliente pessoa física é INAPTO — credenciamento só existe para PJ", () => {
    const r = triarCredenciamento({
      cliente: { tipo: "PF" },
      clinica: CLINICA_COMPLETA,
      profissionais: [MEDICO_OK],
      anoAtual: 2026,
    });
    expect(r.veredito).toBe("INAPTO");
    expect(r.motivos.map((m) => m.regra)).toContain("R1");
  });

  it("R5: menos de 5 anos de formado é INAPTO, e informa o ano em que fica apto", () => {
    const r = triarCredenciamento({
      cliente: { tipo: "PJ" },
      clinica: CLINICA_COMPLETA,
      profissionais: [{ id: "p2", nome: "Dr. Novato", anoFormatura: 2023, tituloEspecialista: true }],
      anoAtual: 2026,
    });
    expect(r.veredito).toBe("INAPTO");
    const motivo = r.motivos.find((m) => m.regra === "R5");
    expect(motivo?.nivel).toBe("INAPTO");
    expect(motivo?.aptoAPartirDe).toBe(2028);
    expect(motivo?.profissionalId).toBe("p2");
  });

  it("R5: exatamente 5 anos de formado já está apto (a régua não empurra o limite)", () => {
    const r = triarCredenciamento({
      cliente: { tipo: "PJ" },
      clinica: CLINICA_COMPLETA,
      profissionais: [{ id: "p3", nome: "Dr. Cinco", anoFormatura: 2021, tituloEspecialista: true }],
      anoAtual: 2026,
    });
    expect(r.veredito).toBe("APTO");
  });

  it("R5: sem o ano de formatura, a triagem PEDE o dado em vez de recusar", () => {
    const r = triarCredenciamento({
      cliente: { tipo: "PJ" },
      clinica: CLINICA_COMPLETA,
      profissionais: [{ id: "p9", nome: "Dr. Sem Data", anoFormatura: null, tituloEspecialista: true }],
      anoAtual: 2026,
    });
    expect(r.veredito).toBe("PENDENTE");
    const motivo = r.motivos.find((m) => m.regra === "R5");
    expect(motivo?.nivel).toBe("PENDENTE");
    expect(motivo?.aptoAPartirDe).toBeUndefined();
  });

  it("R2/R3/R4: cada registro da clínica que falta vira uma PENDÊNCIA, não uma recusa", () => {
    const r = triarCredenciamento({
      cliente: { tipo: "PJ" },
      clinica: { alvaraFuncionamento: false, alvaraVigilancia: false, cnes: false },
      profissionais: [MEDICO_OK],
      anoAtual: 2026,
    });
    expect(r.veredito).toBe("PENDENTE");
    expect(r.motivos.map((m) => m.regra).sort()).toEqual(["R2", "R3", "R4"]);
    expect(r.motivos.every((m) => m.nivel === "PENDENTE")).toBe(true);
  });

  it("R6: profissional sem título de especialista fica PENDENTE", () => {
    const r = triarCredenciamento({
      cliente: { tipo: "PJ" },
      clinica: CLINICA_COMPLETA,
      profissionais: [{ id: "p4", nome: "Dr. Sem Título", anoFormatura: 2010, tituloEspecialista: false }],
      anoAtual: 2026,
    });
    expect(r.veredito).toBe("PENDENTE");
    expect(r.motivos.find((m) => m.regra === "R6")?.profissionalId).toBe("p4");
  });

  it("um INAPTO no meio de pendências manda no veredito final", () => {
    const r = triarCredenciamento({
      cliente: { tipo: "PF" },
      clinica: { alvaraFuncionamento: false, alvaraVigilancia: true, cnes: true },
      profissionais: [MEDICO_OK],
      anoAtual: 2026,
    });
    expect(r.veredito).toBe("INAPTO");
  });

  it("sem nenhum profissional cadastrado, não há o que triar do lado das pessoas", () => {
    const r = triarCredenciamento({
      cliente: { tipo: "PJ" },
      clinica: CLINICA_COMPLETA,
      profissionais: [],
      anoAtual: 2026,
    });
    expect(r.motivos.filter((m) => m.regra === "R5" || m.regra === "R6")).toEqual([]);
  });
});

describe("o que o cliente lê no Portal", () => {
  it("só mostra o que ele resolve entregando documento — nunca a recusa comercial", () => {
    const r = triarCredenciamento({
      cliente: { tipo: "PF" },
      clinica: { alvaraFuncionamento: false, alvaraVigilancia: true, cnes: true },
      profissionais: [{ id: "p5", nome: "Dr. Novato", anoFormatura: 2024, tituloEspecialista: false }],
      anoAtual: 2026,
    });
    const paraOCliente = motivosParaOCliente(r);

    expect(paraOCliente.map((m) => m.regra).sort()).toEqual(["R2", "R6"]);
    const texto = paraOCliente.map((m) => m.pedido).join(" ").toLowerCase();
    expect(texto).not.toContain("inapto");
    expect(texto).not.toContain("pessoa jurídica");
    expect(texto).toContain("alvará de funcionamento");
  });
});

describe("progresso da papelada", () => {
  const REQ_DIPLOMA = { id: "r-diploma", escopo: "PROFISSIONAL" as const, frenteVerso: true, obrigatorio: true };
  const REQUISITOS = [
    { id: "r-cnpj", escopo: "EMPRESA" as const, frenteVerso: false, obrigatorio: true },
    REQ_DIPLOMA,
    { id: "r-isencao", escopo: "EMPRESA" as const, frenteVerso: false, obrigatorio: false },
  ];
  const DOIS_MEDICOS = [{ id: "p1" }, { id: "p2" }];

  it("uma exigência por médico vira uma vaga por médico, e frente e verso são duas vagas", () => {
    const vagas = vagasCredenciamento({ requisitos: REQUISITOS, profissionais: DOIS_MEDICOS, tipoCliente: "PJ" });
    const doDiploma = vagas.filter((v) => v.requisitoId === "r-diploma");
    expect(doDiploma).toHaveLength(4);
    expect(doDiploma.filter((v) => v.profissionalId === "p1").map((v) => v.lado).sort()).toEqual(["FRENTE", "VERSO"]);
  });

  it("exigência não obrigatória não entra na conta do progresso", () => {
    const vagas = vagasCredenciamento({ requisitos: REQUISITOS, profissionais: DOIS_MEDICOS, tipoCliente: "PJ" });
    expect(vagas.some((v) => v.requisitoId === "r-isencao")).toBe(false);
  });

  it("documento da empresa não é cobrado de cliente pessoa física", () => {
    const vagas = vagasCredenciamento({ requisitos: REQUISITOS, profissionais: DOIS_MEDICOS, tipoCliente: "PF" });
    expect(vagas.some((v) => v.requisitoId === "r-cnpj")).toBe(false);
  });

  it("dois médicos com metade da papelada entregue dão 50% — a conta é por par, não por exigência", () => {
    const p = progressoCredenciamento({
      requisitos: [REQ_DIPLOMA],
      profissionais: DOIS_MEDICOS,
      tipoCliente: "PJ",
      enviados: [
        { requisitoId: "r-diploma", profissionalId: "p1", lado: "FRENTE" },
        { requisitoId: "r-diploma", profissionalId: "p1", lado: "VERSO" },
      ],
    });
    expect(p.total).toBe(4);
    expect(p.atendidas).toBe(2);
    expect(p.faltam).toBe(2);
    expect(p.percentual).toBe(50);
  });

  it("arquivo enviado para o médico errado não conta pelo outro", () => {
    const p = progressoCredenciamento({
      requisitos: [REQ_DIPLOMA],
      profissionais: DOIS_MEDICOS,
      tipoCliente: "PJ",
      enviados: [
        { requisitoId: "r-diploma", profissionalId: "p1", lado: "FRENTE" },
        { requisitoId: "r-diploma", profissionalId: "p1", lado: "FRENTE" },
      ],
    });
    expect(p.atendidas).toBe(1);
  });

  it("sem nenhuma vaga o progresso é 100% — e não uma divisão por zero", () => {
    const p = progressoCredenciamento({ requisitos: [], profissionais: [], tipoCliente: "PJ", enviados: [] });
    expect(p.total).toBe(0);
    expect(p.percentual).toBe(100);
  });
});
