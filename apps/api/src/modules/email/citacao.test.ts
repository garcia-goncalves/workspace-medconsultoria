import { describe, it, expect } from "vitest";
import { montarCitacao, destinatariosResposta, assuntoResposta, assuntoEncaminhar } from "./citacao.js";

describe("destinatariosResposta", () => {
  const base = {
    deEmail: "cliente@exemplo.com",
    para: ["eu@medconsultoria.com.br", "colega@medconsultoria.com.br"],
    cc: ["chefe@exemplo.com"],
    meuEndereco: "eu@medconsultoria.com.br",
  };

  it("responder simples vai só para quem escreveu", () => {
    expect(destinatariosResposta({ ...base, aTodos: false })).toEqual({
      para: ["cliente@exemplo.com"],
      cc: [],
    });
  });

  it("responder a todos mantém os outros e TIRA o meu endereço", () => {
    // Sem isto a pessoa se copia em toda resposta que manda.
    const r = destinatariosResposta({ ...base, aTodos: true });
    expect(r.para).toEqual(["cliente@exemplo.com", "colega@medconsultoria.com.br"]);
    expect(r.cc).toEqual(["chefe@exemplo.com"]);
    expect([...r.para, ...r.cc]).not.toContain("eu@medconsultoria.com.br");
  });

  it("compara endereço sem diferenciar maiúsculas", () => {
    const r = destinatariosResposta({ ...base, para: ["EU@MedConsultoria.com.BR"], aTodos: true });
    expect(r.para).toEqual(["cliente@exemplo.com"]);
  });

  it("não repete endereço que aparece duas vezes", () => {
    const r = destinatariosResposta({ ...base, para: ["cliente@exemplo.com"], aTodos: true });
    expect(r.para).toEqual(["cliente@exemplo.com"]);
  });
});

describe("assunto", () => {
  it("põe Re: uma vez só", () => {
    expect(assuntoResposta("Proposta")).toBe("Re: Proposta");
    expect(assuntoResposta("Re: Proposta")).toBe("Re: Proposta");
    expect(assuntoResposta("RE: Proposta")).toBe("RE: Proposta");
  });
  it("assunto vazio vira aviso legível", () => {
    expect(assuntoResposta(null)).toBe("Re: (sem assunto)");
  });
  it("encaminhar usa Enc:", () => {
    expect(assuntoEncaminhar("Proposta")).toBe("Enc: Proposta");
    expect(assuntoEncaminhar("Enc: Proposta")).toBe("Enc: Proposta");
  });
});

describe("montarCitacao", () => {
  const original = {
    deNome: "José Cliente",
    deEmail: "jose@exemplo.com",
    dataEm: new Date("2026-08-04T14:30:00Z"),
    corpoHtml: null,
    corpoTexto: "linha um\nlinha dois",
  };

  it("traz cabeçalho de citação em pt-BR com quem escreveu, nas duas versões", () => {
    const { preview, envio } = montarCitacao(original);
    for (const c of [preview, envio]) {
      expect(c).toContain("José Cliente");
      expect(c).toContain("escreveu");
      expect(c).toContain("04/08/2026");
    }
  });

  it("cita o texto dentro de blockquote, nas duas versões", () => {
    const { preview, envio } = montarCitacao(original);
    for (const c of [preview, envio]) {
      expect(c).toContain("<blockquote");
      expect(c).toContain("linha um");
    }
  });

  it("HIGIENIZA o HTML original nas duas versões — citar HTML cru reintroduz o XSS e ainda o manda para fora", () => {
    const { preview, envio } = montarCitacao({ ...original, corpoHtml: '<p>oi</p><script>alert(1)</script>' });
    for (const c of [preview, envio]) {
      expect(c).toContain("oi");
      expect(c.toLowerCase()).not.toContain("<script");
    }
  });

  it("sem corpo nenhum, não inventa citação vazia em nenhuma das duas versões", () => {
    const c = montarCitacao({ ...original, corpoHtml: null, corpoTexto: null });
    expect(c).toEqual({ preview: "", envio: "" });
  });

  it("formata corretamente e-mail entre entidades sem duplo-escape", () => {
    const { preview } = montarCitacao(original);
    // O e-mail deve aparecer entre &lt; e &gt; de VERDADE
    expect(preview).toContain("&lt;jose@exemplo.com&gt;");
    // Nunca duplo-escape (&amp;lt;)
    expect(preview).not.toContain("&amp;lt;");
    expect(preview).not.toContain("&amp;gt;");
  });

  it("escapa nome hostil no cabeçalho mantendo a segurança", () => {
    const { preview } = montarCitacao({
      ...original,
      deNome: '<script>alert(1)</script>',
      corpoTexto: "teste",
    });
    // Nome hostil deve aparecer escapado
    expect(preview).toContain("&lt;script&gt;");
    // Nunca o script cru
    expect(preview.toLowerCase()).not.toContain("<script");
  });

  describe("Achado B — preview bloqueia imagem, envio restaura o src", () => {
    const comImagemRemota = {
      ...original,
      corpoHtml: '<p>Logo:</p><img src="https://terceiro.exemplo/logo.png"><script>alert(1)</script>',
      corpoTexto: null,
    };

    it("preview: imagem remota continua bloqueada (data-src-bloqueada), sem <script>", () => {
      const { preview } = montarCitacao(comImagemRemota);
      expect(preview).toContain('data-src-bloqueada="https://terceiro.exemplo/logo.png"');
      expect(preview).not.toMatch(/<img[^>]*\ssrc=/);
      expect(preview.toLowerCase()).not.toContain("<script");
    });

    it("envio: mantém o src da imagem (senão o e-mail sai com a figura quebrada) E continua sem <script>", () => {
      const { envio } = montarCitacao(comImagemRemota);
      expect(envio).toContain('src="https://terceiro.exemplo/logo.png"');
      expect(envio).not.toContain("data-src-bloqueada");
      expect(envio.toLowerCase()).not.toContain("<script");
    });
  });
});
