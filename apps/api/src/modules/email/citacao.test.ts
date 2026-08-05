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
    const { preview, envio } = montarCitacao(original, { restaurarImagensNoEnvio: false });
    for (const c of [preview, envio]) {
      expect(c).toContain("José Cliente");
      expect(c).toContain("escreveu");
      expect(c).toContain("04/08/2026");
    }
  });

  it("cita o texto dentro de blockquote, nas duas versões", () => {
    const { preview, envio } = montarCitacao(original, { restaurarImagensNoEnvio: false });
    for (const c of [preview, envio]) {
      expect(c).toContain("<blockquote");
      expect(c).toContain("linha um");
    }
  });

  it("HIGIENIZA o HTML original nas duas versões — citar HTML cru reintroduz o XSS e ainda o manda para fora", () => {
    const { preview, envio } = montarCitacao(
      { ...original, corpoHtml: '<p>oi</p><script>alert(1)</script>' },
      { restaurarImagensNoEnvio: false },
    );
    for (const c of [preview, envio]) {
      expect(c).toContain("oi");
      expect(c.toLowerCase()).not.toContain("<script");
    }
  });

  /**
   * Esta regra MUDOU de sentido, e a razão importa mais que o valor esperado.
   *
   * Ela nasceu quando corpos nulos queriam dizer "não sei o que tem nesta mensagem" — o corpo
   * podia simplesmente nunca ter sido buscado, e afirmar procedência sobre conteúdo desconhecido
   * seria inventar. Depois da correção do `corpoEm` (a guarda `exigirCorpoGuardado`, em
   * `envio.service.ts`, barra antes tudo o que nunca foi baixado), corpos nulos chegam aqui
   * significando outra coisa, e ela é um FATO conhecido e verdadeiro: a mensagem é legitimamente
   * vazia — o conteúdo dela é o anexo. Encaminhar o contrato do cliente sem dizer de quem ele
   * veio é encaminhamento cego.
   *
   * O que continua proibido é o que sempre foi: inventar CORPO. O `<blockquote>` sai vazio.
   */
  it("mensagem legitimamente vazia: sai o cabeçalho de procedência, e o blockquote fica VAZIO", () => {
    const { preview, envio } = montarCitacao(
      { ...original, corpoHtml: null, corpoTexto: null },
      { restaurarImagensNoEnvio: false },
    );
    for (const c of [preview, envio]) {
      // Procedência: quem escreveu e quando.
      expect(c).toContain("José Cliente");
      expect(c).toContain("&lt;jose@exemplo.com&gt;");
      expect(c).toContain("04/08/2026");
      // E nada de corpo inventado dentro da citação.
      expect(c).toContain("<blockquote");
      const dentro = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/.exec(c)?.[1] ?? "";
      expect(dentro.trim(), "citação de mensagem vazia não pode ter conteúdo").toBe("");
    }
  });

  it("formata corretamente e-mail entre entidades sem duplo-escape", () => {
    const { preview } = montarCitacao(original, { restaurarImagensNoEnvio: false });
    // O e-mail deve aparecer entre &lt; e &gt; de VERDADE
    expect(preview).toContain("&lt;jose@exemplo.com&gt;");
    // Nunca duplo-escape (&amp;lt;)
    expect(preview).not.toContain("&amp;lt;");
    expect(preview).not.toContain("&amp;gt;");
  });

  it("escapa nome hostil no cabeçalho mantendo a segurança", () => {
    const { preview } = montarCitacao(
      { ...original, deNome: '<script>alert(1)</script>', corpoTexto: "teste" },
      { restaurarImagensNoEnvio: false },
    );
    // Nome hostil deve aparecer escapado
    expect(preview).toContain("&lt;script&gt;");
    // Nunca o script cru
    expect(preview.toLowerCase()).not.toContain("<script");
  });

  describe("Achado 1 (segurança) — a versão de envio só restaura imagem em RESPOSTA, nunca em ENCAMINHAMENTO", () => {
    // Resposta: quem recebe é quem mandou o e-mail original — se há pixel de rastreio, é dela, e
    // ela não descobre nada que já não soubesse. Encaminhamento: quem recebe é um terceiro (o
    // cliente) que nunca escolheu abrir aquele e-mail — restaurar a imagem repassaria o pixel a
    // ele, com o NOSSO domínio no remetente dando credibilidade ao golpe.
    const comImagemRemota = {
      ...original,
      corpoHtml: '<p>Logo:</p><img src="https://terceiro.exemplo/logo.png"><script>alert(1)</script>',
      corpoTexto: null,
    };

    it("resposta (restaurarImagensNoEnvio: true): a versão de envio mantém o src da imagem, e continua sem <script>", () => {
      const { envio } = montarCitacao(comImagemRemota, { restaurarImagensNoEnvio: true });
      expect(envio).toContain('src="https://terceiro.exemplo/logo.png"');
      expect(envio).not.toContain("data-src-bloqueada");
      expect(envio.toLowerCase()).not.toContain("<script");
    });

    it("encaminhamento (restaurarImagensNoEnvio: false): a versão de envio NÃO restaura o src — fica data-src-bloqueada, igual ao preview —, e continua sem <script>", () => {
      const { envio } = montarCitacao(comImagemRemota, { restaurarImagensNoEnvio: false });
      expect(envio).toContain('data-src-bloqueada="https://terceiro.exemplo/logo.png"');
      expect(envio).not.toMatch(/<img[^>]*\ssrc=/);
      expect(envio.toLowerCase()).not.toContain("<script");
    });

    it("preview continua SEMPRE bloqueado, nos dois casos — protege quem escreve de disparar o pixel enquanto ainda compõe (o iframe sandbox=\"\" não bloqueia imagem)", () => {
      for (const opcoes of [{ restaurarImagensNoEnvio: true }, { restaurarImagensNoEnvio: false }]) {
        const { preview } = montarCitacao(comImagemRemota, opcoes);
        expect(preview).toContain('data-src-bloqueada="https://terceiro.exemplo/logo.png"');
        expect(preview).not.toMatch(/<img[^>]*\ssrc=/);
        expect(preview.toLowerCase()).not.toContain("<script");
      }
    });

    // Regressão contra a forma REAL do banco (achado da revisão de segurança sobre este mesmo
    // achado 1): `EmailMensagem.corpoHtml` só é gravado por `abrirMensagem` (leitura.service.ts),
    // que SEMPRE sanitiza com imagem bloqueada antes de salvar — então, na prática, o `corpoHtml`
    // que `prepararResposta`/`prepararEncaminhamento` leem do banco NUNCA tem um `src` de imagem
    // remota "vivo": ele já chega como `data-src-bloqueada`. Os testes acima usam HTML bruto (com
    // `src=` de verdade) para travar o CONTRATO de `montarCitacao` — este aqui trava o
    // COMPORTAMENTO OBSERVÁVEL de hoje com o dado no formato real, para que uma tentativa futura
    // de "consertar" a imagem quebrada da citação (ex.: copiar o
    // `replace(/data-src-bloqueada=/g, "src=")` de `http/email-corpo.ts` para dentro deste fluxo)
    // quebre um teste, em vez de reabrir o vazamento em silêncio.
    it("regressão — com o corpo JÁ bloqueado como sai do banco, o encaminhamento nunca produz src= de verdade", () => {
      const jaBloqueadoPeloBanco = {
        ...original,
        corpoHtml: '<p>Logo:</p><img data-src-bloqueada="https://terceiro.exemplo/logo.png">',
        corpoTexto: null,
      };
      const { envio } = montarCitacao(jaBloqueadoPeloBanco, { restaurarImagensNoEnvio: false });
      expect(envio).toContain('data-src-bloqueada="https://terceiro.exemplo/logo.png"');
      expect(envio).not.toMatch(/<img[^>]*\ssrc=/);
    });
  });
});
