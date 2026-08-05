# E-mail na aplicação — Fase 2A (escrever, responder, encaminhar) — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam
> caixinhas (`- [ ]`) para acompanhamento.

**Objetivo:** a equipe escreve, responde, responde a todos e encaminha e-mail de dentro do
Workspace, com anexo e rascunho, sem abrir o webmail.

**Arquitetura:** SMTP por conexão curta (`comSmtp`, espelhando o `comCaixa` do IMAP), mensagem
composta **uma única vez** em MIME e reaproveitada nos três passos do envio (SMTP → `APPEND` na
pasta Enviados → marcar `\Answered` na original). Regras puras (citação, destinatários, assunto)
ficam fora do serviço, em `citacao.ts`, para serem testadas sem servidor de e-mail.

**Stack:** Fastify + tRPC + Prisma/MySQL · `nodemailer` (SMTP + `MailComposer`) · `imapflow`
(`APPEND`, flags, `FETCH` de parte) · `@fastify/multipart` · Vite + React + TanStack Query.
**Nenhuma dependência nova** — as três já estão em `apps/api/package.json`.

**Referência:** `docs/superpowers/specs/2026-08-04-email-bloco2-escrever-e-agir-design.md` — este
plano cobre as **fatias 1 a 4** da seção 12 daquele documento. As fases 2B, 2D e 2C ganham plano
próprio.

## Restrições globais

Valem para **todas** as tarefas deste plano.

- **Idioma:** todo texto de interface, mensagem de erro, comentário e commit em **pt-BR**.
- **`noUncheckedIndexedAccess` está ligado.** Todo acesso por índice devolve `T | undefined`.
  Trate com checagem explícita — **nunca** `as string` nem `!` em código de produção (em teste,
  `!` é aceitável).
- **Camadas:** `router` (tRPC + Zod + autorização) → `service` (regra, sem saber de HTTP) →
  Prisma. Nunca Prisma dentro de router.
- **Autorização:** tudo usa `funcionarioProcedure`. **Toda** consulta de caixa/pasta/mensagem
  filtra por `caixa.userId === ctx.user.id`. Sem exceção.
- **O `segredo` da caixa nunca sai da API** e nunca vai para log — inclusive o objeto de
  configuração do transporte SMTP inteiro.
- **`exigirModuloLigado()`** no começo de todo procedure novo deste plano (o módulo é desligado
  quando falta `EMAIL_CRYPTO_KEY`).
- **Envio real só para `tibamooca@gmail.com` ou `contato@medconsultoria.com.br`** fora de
  produção — isso vira código na Tarefa 1, não disciplina.
- **Teto de anexo: 20 MB** (`TAMANHO_MAX` de `lib/storage.ts`), não os 75 MB do servidor.
- **Nenhuma migration neste plano.** Se alguma se mostrar necessária, PARE e reavalie com o dono:
  o spec afirma que o schema do Bloco 1 já basta.
- **Reiniciar a API pelo MODO PAUSA** antes de testar em tela (`touch scripts/.keepalive-pause`
  → esperar → `rm`): o tsx-watch não recarrega serviço novo de forma confiável e você acaba
  depurando código velho.
- **Placar dos testes:** os de integração **pulam em silêncio** sem `EMAIL_TESTE_USER`/`PASS`.
  Pular não é passar — confira o número de pulados (o certo hoje é **0**).

---

### Tarefa 1: Regras puras do envio (`citacao.ts`) e schema compartilhado

Começa pelo que é testável sem rede. Nada aqui toca IMAP, SMTP ou banco.

**Files:**
- Create: `apps/api/src/modules/email/citacao.ts`
- Create: `apps/api/src/modules/email/citacao.test.ts`
- Modify: `packages/shared/src/schemas/email.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `montarCitacao(original: { deNome: string | null; deEmail: string; dataEm: Date; corpoHtml: string | null; corpoTexto: string | null }): string`
  - `destinatariosResposta(args: { deEmail: string; para: string[]; cc: string[]; meuEndereco: string; aTodos: boolean }): { para: string[]; cc: string[] }`
  - `assuntoResposta(assunto: string | null): string` e `assuntoEncaminhar(assunto: string | null): string`
  - `enviarEmailSchema` / `EnviarEmailInput` em `@app/shared`
  - `DESTINOS_TESTE_PERMITIDOS: readonly string[]` em `@app/shared`

- [ ] **Step 1: Escrever os testes que falham**

```ts
// apps/api/src/modules/email/citacao.test.ts
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

  it("traz cabeçalho de citação em pt-BR com quem escreveu", () => {
    const c = montarCitacao(original);
    expect(c).toContain("José Cliente");
    expect(c).toContain("escreveu");
    expect(c).toContain("04/08/2026");
  });

  it("cita o texto dentro de blockquote", () => {
    const c = montarCitacao(original);
    expect(c).toContain("<blockquote");
    expect(c).toContain("linha um");
  });

  it("HIGIENIZA o HTML original — citar HTML cru reintroduz o XSS e ainda o manda para fora", () => {
    const c = montarCitacao({ ...original, corpoHtml: '<p>oi</p><script>alert(1)</script>' });
    expect(c).toContain("oi");
    expect(c.toLowerCase()).not.toContain("<script");
  });

  it("sem corpo nenhum, não inventa citação vazia", () => {
    const c = montarCitacao({ ...original, corpoHtml: null, corpoTexto: null });
    expect(c).toBe("");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/api test -- --run src/modules/email/citacao.test.ts`
Expected: FAIL — `Cannot find module './citacao.js'`.

- [ ] **Step 3: Implementar `citacao.ts`**

```ts
// apps/api/src/modules/email/citacao.ts
import { sanitizarEmailHtml } from "../../lib/sanitizar-html.js";

/** Data no formato pt-BR do cabeçalho de citação. O fuso da empresa é o de São Paulo. */
function dataCitacao(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function normalizar(e: string): string {
  return e.trim().toLowerCase();
}

function escapar(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Citação da mensagem original, para ir dentro da resposta.
 *
 * O corpo original é HIGIENIZADO aqui mesmo. Citar o HTML cru de um terceiro reintroduziria o
 * XSS que as três camadas do Bloco 1 barram — e, pior, mandaria o conteúdo hostil para fora com
 * a nossa assinatura.
 */
export function montarCitacao(original: {
  deNome: string | null;
  deEmail: string;
  dataEm: Date;
  corpoHtml: string | null;
  corpoTexto: string | null;
}): string {
  const quem = original.deNome ? `${original.deNome} &lt;${original.deEmail}&gt;` : original.deEmail;
  const cabecalho = `Em ${dataCitacao(original.dataEm)}, ${escapar(quem)} escreveu:`;

  let corpo: string;
  if (original.corpoHtml) {
    corpo = sanitizarEmailHtml(original.corpoHtml).html;
  } else if (original.corpoTexto) {
    corpo = original.corpoTexto
      .split("\n")
      .map((l) => escapar(l))
      .join("<br>");
  } else {
    // Mensagem sem corpo nenhum: citação vazia seria só um traço solto na resposta.
    return "";
  }

  return [
    `<p>${cabecalho}</p>`,
    `<blockquote style="margin:0 0 0 .8em;padding-left:.8em;border-left:2px solid #ccc">`,
    corpo,
    `</blockquote>`,
  ].join("\n");
}

/**
 * Quem recebe a resposta. "Responder" vai só a quem escreveu; "responder a todos" mantém os
 * demais — tirando SEMPRE o endereço da própria caixa, senão a pessoa se copia em tudo.
 */
export function destinatariosResposta(args: {
  deEmail: string;
  para: string[];
  cc: string[];
  meuEndereco: string;
  aTodos: boolean;
}): { para: string[]; cc: string[] } {
  const eu = normalizar(args.meuEndereco);
  const semMim = (lista: string[]) => lista.filter((e) => normalizar(e) !== eu);
  const unico = (lista: string[]) => {
    const vistos = new Set<string>();
    return lista.filter((e) => {
      const k = normalizar(e);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  };

  if (!args.aTodos) return { para: [args.deEmail], cc: [] };
  return {
    para: unico(semMim([args.deEmail, ...args.para])),
    cc: unico(semMim(args.cc)),
  };
}

function comPrefixo(assunto: string | null, prefixo: string, jaTem: RegExp): string {
  const base = assunto?.trim() || "(sem assunto)";
  return jaTem.test(base) ? base : `${prefixo} ${base}`;
}

export function assuntoResposta(assunto: string | null): string {
  return comPrefixo(assunto, "Re:", /^re:/i);
}

export function assuntoEncaminhar(assunto: string | null): string {
  return comPrefixo(assunto, "Enc:", /^(enc|fwd|fw):/i);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @app/api test -- --run src/modules/email/citacao.test.ts`
Expected: PASS, 11 testes.

- [ ] **Step 5: Acrescentar o schema de envio ao `@app/shared`**

Adicione ao FIM de `packages/shared/src/schemas/email.ts` (não mexa no que já está lá):

```ts
/**
 * Endereços para os quais é permitido enviar de verdade fora de produção. Existe porque o envio
 * da Fase 2A usa o SMTP REAL da caixa da pessoa: sem esta trava, um teste de desenvolvimento
 * manda e-mail de verdade para um cliente de verdade.
 */
export const DESTINOS_TESTE_PERMITIDOS = [
  "tibamooca@gmail.com",
  "contato@medconsultoria.com.br",
] as const;

/** Teto do servidor de e-mail (SMTP anuncia RCPTMAX=200). */
export const MAX_DESTINATARIOS = 200;

const listaDeEmails = z
  .array(z.string().email("Endereço de e-mail inválido"))
  .max(MAX_DESTINATARIOS, `São no máximo ${MAX_DESTINATARIOS} destinatários por e-mail.`)
  .default([]);

export const enviarEmailSchema = z
  .object({
    caixaId: z.string().min(1),
    para: listaDeEmails,
    cc: listaDeEmails,
    cco: listaDeEmails,
    assunto: z.string().max(500).default(""),
    corpoHtml: z.string().max(500_000, "O texto do e-mail ficou grande demais.").default(""),
    /** Mensagem sendo respondida ou encaminhada — define os cabeçalhos de conversa. */
    emRespostaA: z.string().optional(),
    encaminhando: z.string().optional(),
    /** Anexos já enviados pela rota multipart, referenciados por id. */
    anexos: z.array(z.string()).max(20).default([]),
  })
  .refine((v) => v.para.length + v.cc.length + v.cco.length > 0, {
    message: "Informe pelo menos um destinatário.",
    path: ["para"],
  })
  .refine((v) => v.para.length + v.cc.length + v.cco.length <= MAX_DESTINATARIOS, {
    message: `São no máximo ${MAX_DESTINATARIOS} destinatários por e-mail.`,
    path: ["para"],
  });
export type EnviarEmailInput = z.infer<typeof enviarEmailSchema>;
```

- [ ] **Step 6: Conferir que o `shared` exporta e compila**

Run: `pnpm --filter @app/shared typecheck && pnpm --filter @app/api typecheck`
Expected: sem erro. Se `enviarEmailSchema` não for visível em `@app/shared`, confira o
`packages/shared/src/index.ts` — o arquivo de schemas precisa estar reexportado lá.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/email/citacao.ts apps/api/src/modules/email/citacao.test.ts packages/shared/src/schemas/email.ts
git commit -m "feat(email): regras puras de resposta (citação, destinatários, assunto) e schema de envio"
```

---

### Tarefa 2: Conexão SMTP por caixa (`smtp.ts`)

**Files:**
- Create: `apps/api/src/modules/email/smtp.ts`
- Test: coberto pela Tarefa 6 (integração real). Aqui não há teste unitário: o valor de `comSmtp`
  está em falar com o servidor, e um mock de nodemailer só testaria o mock.

**Interfaces:**
- Consumes: `decifrar` de `lib/cripto-caixa.js`; padrão de `comCaixa` em `./imap.js`.
- Produces: `comSmtp<T>(caixaId: string, fn: (t: Transporter) => Promise<T>): Promise<T>`

- [ ] **Step 1: Implementar**

```ts
// apps/api/src/modules/email/smtp.ts
import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "@app/db";
import { decifrar } from "../../lib/cripto-caixa.js";

/**
 * Abre uma conexão SMTP para a caixa, roda `fn` e fecha SEMPRE. Conexão curta pela mesma razão
 * do IMAP (ver `imap.ts`): o LiteSpeed/lsnode derruba o processo Node ocioso, então não existe
 * conexão viva entre requisições.
 *
 * Falha de autenticação marca a caixa como `AUTENTICACAO_FALHOU` e a app PARA de tentar —
 * tentar em laço faz o servidor de e-mail bloquear o IP, e aí ninguém mais envia nada, nem os
 * e-mails automáticos da aplicação.
 */
export async function comSmtp<T>(caixaId: string, fn: (t: Transporter) => Promise<T>): Promise<T> {
  const caixa = await prisma.caixaEmail.findFirst({
    where: { id: caixaId, deletedAt: null },
    select: { id: true, smtpHost: true, smtpPorta: true, usuario: true, segredo: true, estado: true },
  });
  if (!caixa) throw new Error("Caixa não encontrada.");
  if (caixa.estado === "AUTENTICACAO_FALHOU") {
    throw new Error("Esta caixa precisa ser reconectada: a senha guardada foi recusada pelo servidor.");
  }

  // Mesmo tratamento do `comCaixa`: segredo que não abre é problema de chave, e o remédio é
  // reconectar — não adianta tentar de novo.
  let senha: string;
  try {
    senha = decifrar(caixa.segredo);
  } catch (e) {
    await prisma.caixaEmail.update({
      where: { id: caixa.id },
      data: { estado: "AUTENTICACAO_FALHOU", ultimoErro: (e as Error).message.slice(0, 500) },
    });
    throw e;
  }

  const transporte = nodemailer.createTransport({
    host: caixa.smtpHost,
    port: caixa.smtpPorta,
    secure: caixa.smtpPorta === 465,
    auth: { user: caixa.usuario, pass: senha },
    // NUNCA ligar logger/debug: o diálogo SMTP inclui a autenticação.
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 45_000,
  });

  try {
    return await fn(transporte);
  } catch (e) {
    const err = e as { responseCode?: number; message?: string };
    // 535 = credencial recusada. Só isso vira AUTENTICACAO_FALHOU; rede fora do ar não pode
    // parar a caixa de uma pessoa cuja senha está certa.
    if (err.responseCode === 535) {
      await prisma.caixaEmail.update({
        where: { id: caixa.id },
        data: { estado: "AUTENTICACAO_FALHOU", ultimoErro: "Senha recusada pelo servidor de e-mail." },
      });
    }
    throw e;
  } finally {
    transporte.close();
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @app/api typecheck`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/email/smtp.ts
git commit -m "feat(email): conexão SMTP curta por caixa (comSmtp)"
```

---

### Tarefa 3: Serviço de envio — os três passos (`envio.service.ts`)

O coração da fase. Compõe o MIME **uma vez** e usa o mesmo buffer no SMTP e no `APPEND`, para
que a cópia em Enviados seja idêntica ao que saiu.

**Files:**
- Create: `apps/api/src/modules/email/envio.service.ts`
- Create: `apps/api/src/modules/email/envio.test.ts`

**Interfaces:**
- Consumes: `comSmtp` (Tarefa 2); `comCaixa` de `./imap.js`; `montarCitacao`,
  `destinatariosResposta`, `assuntoResposta`, `assuntoEncaminhar` (Tarefa 1);
  `DESTINOS_TESTE_PERMITIDOS`, `EnviarEmailInput` de `@app/shared`.
- Produces:
  - `conferirDestinoPermitido(destinos: string[]): void` — lança em ambiente não-produção
  - `enviarMensagem(userId: string, input: EnviarEmailInput): Promise<{ enviado: true; copiaEmEnviados: boolean }>`

- [ ] **Step 1: Escrever o teste que falha (a trava de destinatário, que é regra pura)**

```ts
// apps/api/src/modules/email/envio.test.ts
import { describe, it, expect } from "vitest";
import { conferirDestinoPermitido } from "./envio.service.js";

describe("conferirDestinoPermitido (fora de produção)", () => {
  it("deixa passar os dois endereços de teste", () => {
    expect(() => conferirDestinoPermitido(["tibamooca@gmail.com"])).not.toThrow();
    expect(() => conferirDestinoPermitido(["contato@medconsultoria.com.br"])).not.toThrow();
  });

  it("barra qualquer outro destino — o SMTP aqui é real e o cliente também seria", () => {
    expect(() => conferirDestinoPermitido(["cliente.de.verdade@exemplo.com"])).toThrow(/desenvolvimento/i);
  });

  it("barra se UM dos destinos não estiver liberado", () => {
    expect(() => conferirDestinoPermitido(["tibamooca@gmail.com", "outro@exemplo.com"])).toThrow();
  });

  it("não se deixa enganar por maiúsculas ou espaço", () => {
    expect(() => conferirDestinoPermitido([" TibaMooca@Gmail.com "])).not.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/api test -- --run src/modules/email/envio.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o serviço**

```ts
// apps/api/src/modules/email/envio.service.ts
import { TRPCError } from "@trpc/server";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { prisma } from "@app/db";
import { DESTINOS_TESTE_PERMITIDOS, type EnviarEmailInput } from "@app/shared";
import { isProd } from "../../config.js"; // já existe: `export const isProd = config.NODE_ENV === "production"`
import { comSmtp } from "./smtp.js";
import { comCaixa } from "./imap.js";
import { montarCitacao, destinatariosResposta, assuntoResposta, assuntoEncaminhar } from "./citacao.js";

/**
 * Fora de produção, só é permitido enviar para os endereços de teste do dono.
 *
 * Isto é código, e não disciplina, de propósito: o envio desta fase usa o SMTP REAL da caixa da
 * pessoa. Um teste distraído mandaria e-mail de verdade para um cliente de verdade, e não existe
 * desfazer.
 */
export function conferirDestinoPermitido(destinos: string[]): void {
  if (isProd) return;
  const permitidos = new Set<string>(DESTINOS_TESTE_PERMITIDOS.map((e) => e.toLowerCase()));
  const proibido = destinos.find((d) => !permitidos.has(d.trim().toLowerCase()));
  if (proibido) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Em desenvolvimento só é permitido enviar para ${DESTINOS_TESTE_PERMITIDOS.join(" ou ")}. Recusei enviar para ${proibido}.`,
    });
  }
}

/** Caixa da pessoa, com o que o envio precisa. O `segredo` NÃO entra neste select. */
async function caixaDoUsuario(userId: string, caixaId: string) {
  const caixa = await prisma.caixaEmail.findFirst({
    where: { id: caixaId, userId, deletedAt: null },
    select: { id: true, email: true, nomeExibicao: true, assinatura: true },
  });
  if (!caixa) throw new TRPCError({ code: "NOT_FOUND", message: "Caixa não encontrada." });
  return caixa;
}

/** Mensagem original (resposta/encaminhamento), com posse conferida pelo mesmo caminho. */
async function originalDoUsuario(userId: string, mensagemId: string) {
  return prisma.emailMensagem.findFirst({
    where: { id: mensagemId, pasta: { caixa: { userId, deletedAt: null } } },
    select: {
      id: true,
      uid: true,
      messageId: true,
      referencias: true,
      assunto: true,
      pastaId: true,
      pasta: { select: { caminho: true, caixaId: true } },
    },
  });
}

export async function enviarMensagem(
  userId: string,
  input: EnviarEmailInput,
): Promise<{ enviado: true; copiaEmEnviados: boolean }> {
  const caixa = await caixaDoUsuario(userId, input.caixaId);
  const todos = [...input.para, ...input.cc, ...input.cco];
  conferirDestinoPermitido(todos);

  const original = input.emRespostaA ? await originalDoUsuario(userId, input.emRespostaA) : null;
  if (input.emRespostaA && !original) {
    throw new TRPCError({ code: "NOT_FOUND", message: "A mensagem que você está respondendo não existe mais." });
  }

  const corpo = [input.corpoHtml, caixa.assinatura ? `<br>--<br>${caixa.assinatura}` : ""]
    .filter(Boolean)
    .join("\n");

  // Cabeçalhos de conversa. Sem eles a resposta chega ao destinatário como assunto novo e a
  // conversa se parte DO LADO DELE — dano invisível daqui.
  const referencias = original
    ? [original.referencias, original.messageId].filter(Boolean).join(" ").trim()
    : "";

  const composer = new MailComposer({
    from: { name: caixa.nomeExibicao, address: caixa.email },
    to: input.para,
    cc: input.cc,
    bcc: input.cco,
    subject: input.assunto,
    html: corpo,
    inReplyTo: original?.messageId ?? undefined,
    references: referencias || undefined,
  });

  // Compor UMA vez: o mesmo MIME vai para o SMTP e para a cópia em Enviados, então o que está
  // na pasta é exatamente o que saiu.
  const mime: Buffer = await new Promise((ok, falhou) => {
    composer.compile().build((erro, buffer) => (erro ? falhou(erro) : ok(buffer)));
  });

  // PASSO 1 — enviar.
  await comSmtp(caixa.id, async (t) => {
    await t.sendMail({ envelope: { from: caixa.email, to: todos }, raw: mime });
  });

  // PASSO 2 — guardar a cópia em Enviados. SMTP não guarda cópia: sem isto, a pessoa responde
  // aqui e no celular dela o e-mail não existe.
  //
  // Falha aqui NÃO desfaz o envio (não existe desfazer) e NÃO reenvia. A tela avisa que a cópia
  // não foi guardada, e só.
  let copiaEmEnviados = false;
  const enviados = await prisma.caixaPasta.findFirst({
    where: { caixaId: caixa.id, papel: "SENT" },
    select: { caminho: true },
  });
  if (enviados) {
    try {
      await comCaixa(caixa.id, async (c) => {
        await c.append(enviados.caminho, mime, ["\\Seen"]);
      });
      copiaEmEnviados = true;
    } catch {
      /* avisado ao chamador por `copiaEmEnviados: false` */
    }
  }

  // PASSO 3 — marcar a original como respondida. É o que acende o "já respondi este".
  if (original) {
    try {
      await comCaixa(caixa.id, async (c) => {
        const lock = await c.getMailboxLock(original.pasta.caminho);
        try {
          await c.messageFlagsAdd(String(original.uid), ["\\Answered"], { uid: true });
        } finally {
          lock.release();
        }
      });
      await prisma.emailMensagem.update({ where: { id: original.id }, data: { respondido: true } });
    } catch {
      /* cosmético: não vale falhar um envio que já saiu */
    }
  }

  return { enviado: true, copiaEmEnviados };
}

/** Rascunho de resposta pronto para a tela: destinatários, assunto e citação já montados. */
export async function prepararResposta(
  userId: string,
  mensagemId: string,
  aTodos: boolean,
): Promise<{ para: string[]; cc: string[]; assunto: string; citacao: string }> {
  const msg = await prisma.emailMensagem.findFirst({
    where: { id: mensagemId, pasta: { caixa: { userId, deletedAt: null } } },
    select: {
      deNome: true,
      deEmail: true,
      dataEm: true,
      assunto: true,
      corpoHtml: true,
      corpoTexto: true,
      enderecos: { select: { papel: true, endereco: true } },
      pasta: { select: { caixa: { select: { email: true } } } },
    },
  });
  if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada." });

  const { para, cc } = destinatariosResposta({
    deEmail: msg.deEmail,
    para: msg.enderecos.filter((e) => e.papel === "PARA").map((e) => e.endereco),
    cc: msg.enderecos.filter((e) => e.papel === "CC").map((e) => e.endereco),
    meuEndereco: msg.pasta.caixa.email,
    aTodos,
  });

  return {
    para,
    cc,
    assunto: assuntoResposta(msg.assunto),
    citacao: montarCitacao(msg),
  };
}

/** Idem para encaminhar: sem destinatário, assunto com Enc: e a mensagem inteira citada. */
export async function prepararEncaminhamento(
  userId: string,
  mensagemId: string,
): Promise<{ assunto: string; citacao: string }> {
  const msg = await prisma.emailMensagem.findFirst({
    where: { id: mensagemId, pasta: { caixa: { userId, deletedAt: null } } },
    select: { deNome: true, deEmail: true, dataEm: true, assunto: true, corpoHtml: true, corpoTexto: true },
  });
  if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada." });
  return { assunto: assuntoEncaminhar(msg.assunto), citacao: montarCitacao(msg) };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @app/api test -- --run src/modules/email/envio.test.ts && pnpm --filter @app/api typecheck`
Expected: PASS, 4 testes, typecheck limpo.

**Se o import do `MailComposer` falhar no typecheck:** confira o caminho em
`node_modules/nodemailer/lib/mail-composer/`. Alternativa aceitável: `t.sendMail({...campos})`
direto e, para a cópia, `info.message` — mas prefira o `MailComposer`, porque garante que a cópia
em Enviados é byte a byte o que saiu.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/email/envio.service.ts apps/api/src/modules/email/envio.test.ts
git commit -m "feat(email): envio em três passos (SMTP, cópia em Enviados, marcar respondida)"
```

---

### Tarefa 4: Procedures de envio no router

**Files:**
- Modify: `apps/api/src/modules/email/email.router.ts`

**Interfaces:**
- Consumes: `enviarMensagem`, `prepararResposta`, `prepararEncaminhamento` (Tarefa 3);
  `enviarEmailSchema` (Tarefa 1).
- Produces: `email.enviar`, `email.prepararResposta`, `email.prepararEncaminhamento` para o front.

- [ ] **Step 1: Acrescentar ao `emailRouter`**

Adicione o import `import * as envio from "./envio.service.js";` junto dos outros services e
`enviarEmailSchema` no import de `@app/shared`. Depois, dentro do `router({...})`:

```ts
  enviar: funcionarioProcedure.input(enviarEmailSchema).mutation(({ ctx, input }) => {
    exigirModuloLigado();
    return envio.enviarMensagem(ctx.user.id, input);
  }),

  prepararResposta: funcionarioProcedure
    .input(z.object({ mensagemId: z.string().min(1), aTodos: z.boolean().default(false) }))
    .query(({ ctx, input }) => {
      exigirModuloLigado();
      return envio.prepararResposta(ctx.user.id, input.mensagemId, input.aTodos);
    }),

  prepararEncaminhamento: funcionarioProcedure
    .input(z.object({ mensagemId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      exigirModuloLigado();
      return envio.prepararEncaminhamento(ctx.user.id, input.mensagemId);
    }),
```

- [ ] **Step 2: Typecheck dos dois lados**

Run: `pnpm --filter @app/api typecheck && pnpm --filter @app/web typecheck`
Expected: sem erro (o front enxerga os procedures novos pelo tipo do `AppRouter`).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/email/email.router.ts
git commit -m "feat(email): procedures de enviar, preparar resposta e encaminhamento"
```

---

### Tarefa 5: Anexos — enviar e baixar

Baixar é o ponto delicado: arquivo de terceiro, servido pelo nosso domínio.

**Files:**
- Create: `apps/api/src/http/email-anexo.ts`
- Modify: `apps/api/src/server.ts` (registrar a rota, junto de `registrarRotaCorpoEmail`)
- Modify: `apps/api/src/modules/email/envio.service.ts` (aceitar anexos no envio)

**Interfaces:**
- Consumes: `usuarioDaRequest` de `../http/uploads.js`; `comCaixa` de `../modules/email/imap.js`.
- Produces: `registrarRotaAnexoEmail(app: FastifyInstance): void`; rota
  `GET /email-anexo/:mensagemId/:anexoId`.

- [ ] **Step 1: Implementar a rota de download**

```ts
// apps/api/src/http/email-anexo.ts
import type { FastifyInstance } from "fastify";
import { prisma } from "@app/db";
import { usuarioDaRequest } from "./uploads.js";
import { comCaixa } from "../modules/email/imap.js";

/**
 * Baixa UM anexo, buscando só a parte MIME dele no servidor e devolvendo em stream.
 *
 * Duas coisas são obrigatórias aqui e não podem ser afrouxadas:
 *
 * 1. **Stream, nunca memória.** Um processo Node serve API + SPA + tempo real; juntar 20 MB de
 *    anexo em Buffer é o mesmo erro do corpo, só que maior.
 * 2. **`attachment` + `nosniff`, sempre.** Anexo é arquivo de terceiro. Um `anexo.html` que
 *    abrisse no navegador seria XSS no NOSSO domínio, contornando as três camadas do Bloco 1.
 *    Por isso nem o `Content-Type` do e-mail é repassado: vai `application/octet-stream`.
 */
export function registrarRotaAnexoEmail(app: FastifyInstance): void {
  app.get<{ Params: { mensagemId: string; anexoId: string } }>(
    "/email-anexo/:mensagemId/:anexoId",
    async (req, reply) => {
      const user = await usuarioDaRequest(req);
      if (!user) return reply.code(401).send({ error: "Faça login para baixar o anexo." });
      if (user.role === "CLIENTE") return reply.code(403).send({ error: "Sem acesso." });

      // Posse pelo mesmo caminho do resto do módulo: a caixa tem de ser desta pessoa.
      const anexo = await prisma.emailAnexo.findFirst({
        where: {
          id: req.params.anexoId,
          mensagemId: req.params.mensagemId,
          mensagem: { pasta: { caixa: { userId: user.id, deletedAt: null } } },
        },
        select: {
          nome: true,
          parte: true,
          mensagem: {
            select: { uid: true, pasta: { select: { caminho: true, caixaId: true } } },
          },
        },
      });
      if (!anexo) return reply.code(404).send({ error: "Anexo não encontrado." });

      const conteudo = await comCaixa(anexo.mensagem.pasta.caixaId, async (c) => {
        const lock = await c.getMailboxLock(anexo.mensagem.pasta.caminho);
        try {
          const r = await c.download(String(anexo.mensagem.uid), anexo.parte, { uid: true });
          return r?.content ?? null;
        } finally {
          lock.release();
        }
      });
      if (!conteudo) return reply.code(404).send({ error: "O servidor de e-mail não devolveu este anexo." });

      reply.header("Content-Type", "application/octet-stream");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cache-Control", "private, no-store");
      reply.header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(anexo.nome)}`,
      );
      return reply.send(conteudo);
    },
  );
}
```

- [ ] **Step 2: Registrar no servidor**

Em `apps/api/src/server.ts`, ao lado do `registrarRotaCorpoEmail(app)` já existente:

```ts
import { registrarRotaAnexoEmail } from "./http/email-anexo.js";
// ...
registrarRotaAnexoEmail(app);
```

- [ ] **Step 3: Rota de upload do anexo de saída (arquivo temporário, SEM tabela)**

**Não reaproveite o model `Arquivo`.** Ele tem `clienteId` **obrigatório** (verificado em
`schema.prisma:525`): anexo de e-mail nem sempre tem cliente, e afrouxar aquele campo seria uma
migration — que este plano proíbe. Anexo de saída é **efêmero**: vive em disco entre o upload e o
envio, e some depois.

Acrescente a `apps/api/src/http/email-anexo.ts`:

```ts
import { randomUUID } from "node:crypto";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join, resolve } from "node:path";
import { BASE, TAMANHO_MAX } from "../lib/storage.js";

/** Área temporária dos anexos de saída, por usuário. */
export function pastaTemp(userId: string): string {
  return join(BASE, "email-tmp", userId);
}

/**
 * Caminho de um anexo temporário. O `id` vem do cliente, então NUNCA entra no caminho sem ser
 * validado: só aceitamos o formato de UUID que nós mesmos geramos, e conferimos o prefixo do
 * caminho resolvido. Sem isso, `../../` no id daria leitura de arquivo arbitrário.
 */
export function caminhoTemp(userId: string, id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Anexo inválido.");
  const alvo = resolve(join(pastaTemp(userId), id));
  if (!alvo.startsWith(resolve(pastaTemp(userId)))) throw new Error("Anexo inválido.");
  return alvo;
}
```

E a rota de upload (no mesmo arquivo, dentro de `registrarRotaAnexoEmail`):

```ts
  app.post("/email-anexo", async (req, reply) => {
    const user = await usuarioDaRequest(req);
    if (!user) return reply.code(401).send({ error: "Faça login para anexar." });
    if (user.role === "CLIENTE") return reply.code(403).send({ error: "Sem acesso." });

    const parte = await req.file();
    if (!parte) return reply.code(400).send({ error: "Nenhum arquivo recebido." });

    const id = randomUUID();
    await mkdir(pastaTemp(user.id), { recursive: true });
    await pipeline(parte.file, createWriteStream(caminhoTemp(user.id, id)));

    // O @fastify/multipart corta no limite e marca truncado — arquivo cortado não pode virar anexo.
    if (parte.file.truncated) {
      await rm(caminhoTemp(user.id, id), { force: true });
      return reply.code(413).send({ error: `Arquivo acima do limite de ${TAMANHO_MAX / 1024 / 1024} MB.` });
    }
    return reply.send({ id, nome: parte.filename });
  });
```

Em `envio.service.ts`, antes de montar o `MailComposer`:

```ts
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { caminhoTemp } from "../../http/email-anexo.js";
// ...
// `input.anexos` traz { id, nome } — o id é o do upload temporário, o nome é o original.
  attachments: input.anexos.map((a) => ({
    filename: a.nome,
    content: createReadStream(caminhoTemp(userId, a.id)),
  })),
```

E, DEPOIS do passo 1 do envio (dê certo ou não), limpe os temporários:

```ts
await Promise.all(
  input.anexos.map((a) => rm(caminhoTemp(userId, a.id), { force: true }).catch(() => {})),
);
```

**Ajuste no schema da Tarefa 1:** `anexos` deixa de ser `z.array(z.string())` e passa a ser
`z.array(z.object({ id: z.string().uuid(), nome: z.string().min(1).max(255) })).max(20).default([])`.
Corrija lá antes de continuar — o `enviarEmailSchema` é a fonte única e o front usa o mesmo tipo.

- [ ] **Step 4: Typecheck e teste manual do download**

Run: `pnpm --filter @app/api typecheck`
Depois reinicie pelo MODO PAUSA e baixe um anexo de um e-mail real da caixa de teste. Confira no
DevTools (aba Network) que a resposta traz `Content-Disposition: attachment` e
`X-Content-Type-Options: nosniff`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/http/email-anexo.ts apps/api/src/server.ts apps/api/src/modules/email/envio.service.ts
git commit -m "feat(email): anexo — download em stream com attachment+nosniff e envio com anexo"
```

---

### Tarefa 6: Teste de integração contra o servidor real

Sem isto, "enviado" é promessa, não fato.

**Files:**
- Modify: `apps/api/src/test/email-caixa.integration.test.ts`

- [ ] **Step 1: Escrever o teste**

Acrescente ao `describe` existente (ele já tem `userId` e a caixa plugada):

```ts
  it("envia de verdade, guarda cópia em Enviados e marca a original como respondida", async () => {
    const { enviarMensagem } = await import("../modules/email/envio.service.js");
    const { sincronizarPastas } = await import("../modules/email/pastas.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });
    await sincronizarPastas(caixa.id);

    const marca = `envio-${Date.now()}`;
    const r = await enviarMensagem(userId, {
      caixaId: caixa.id,
      // Destino de teste: a trava do `conferirDestinoPermitido` recusaria qualquer outro.
      para: ["contato@medconsultoria.com.br"],
      cc: [],
      cco: [],
      assunto: marca,
      corpoHtml: "<p>corpo de teste</p>",
      anexos: [],
    });

    expect(r.enviado).toBe(true);
    expect(r.copiaEmEnviados, "a cópia em Enviados é o passo que todo mundo esquece").toBe(true);

    // A cópia tem de estar VISÍVEL na pasta de enviados do servidor, não só no nosso índice.
    const { sincronizarPasta } = await import("../modules/email/sync.service.js");
    const enviados = await prisma.caixaPasta.findFirstOrThrow({ where: { caixaId: caixa.id, papel: "SENT" } });
    await sincronizarPasta(caixa.id, enviados.id);
    const copia = await prisma.emailMensagem.findFirst({ where: { pastaId: enviados.id, assunto: marca } });
    expect(copia).toBeTruthy();
  });

  it("recusa enviar para endereço fora da lista de teste", async () => {
    const { enviarMensagem } = await import("../modules/email/envio.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });
    await expect(
      enviarMensagem(userId, {
        caixaId: caixa.id,
        para: ["cliente.de.verdade@exemplo.com"],
        cc: [],
        cco: [],
        assunto: "não deve sair",
        corpoHtml: "<p>x</p>",
        anexos: [],
      }),
    ).rejects.toThrow(/desenvolvimento/i);
  });
```

- [ ] **Step 2: Rodar a suíte inteira e CONFERIR O PLACAR**

Run: `pnpm --filter @app/api test`
Expected: todos passando e **0 pulados**. Se aparecer "skipped", faltam `EMAIL_TESTE_USER`/`PASS`
no `.env` — pare e peça ao dono, porque pular não é passar.

- [ ] **Step 3: Conferir a caixa de verdade**

Abra o webmail de `contato@medconsultoria.com.br` e confirme que a mensagem com a marca chegou.
Abra a pasta Enviados da caixa de teste e confirme que a cópia está lá.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/test/email-caixa.integration.test.ts
git commit -m "test(email): envio real com cópia em Enviados e trava de destinatário"
```

---

### Tarefa 7: Tela de escrever (`Escrever.tsx`)

Um componente só, com o modo por parâmetro — não quatro telas parecidas.

**Files:**
- Create: `apps/web/src/features/email/Escrever.tsx`
- Modify: `apps/web/src/features/email/EmailPage.tsx`

**Interfaces:**
- Consumes: `trpc.email.enviar`, `trpc.email.prepararResposta`, `trpc.email.prepararEncaminhamento`.
- Produces: `<Escrever modo={...} caixaId={...} mensagemId={...} onFechar={...} />` com
  `modo: "novo" | "responder" | "responderTodos" | "encaminhar"`.

- [ ] **Step 1: Criar o componente**

Regras que o componente precisa respeitar (o resto é o padrão de formulário da app):

- Usa `Modal` com `size="xl"` e `footer` (rodapé fixo com "Cancelar" e "Enviar") — ADR-44.
- Campos: Para, Cc/Cco (escondidos atrás de um link "Cc/Cco"), Assunto, corpo em `Textarea`
  (não existe editor rico no projeto e **este plano não cria um** — YAGNI; o corpo vai como
  HTML simples, com as quebras de linha convertidas em `<br>`).
- Nos modos de resposta/encaminhamento, busca os valores prontos por
  `trpc.email.prepararResposta` / `prepararEncaminhamento` e **põe a citação abaixo do cursor**,
  já preenchida.
- Ao enviar com sucesso: `utils.email.mensagens.invalidate()`, toast de sucesso e fecha. Se
  `copiaEmEnviados === false`, o toast avisa: *"E-mail enviado, mas não consegui guardar a cópia
  em Enviados."* — nunca reenviar.
- Erro vem pronto do servidor (`onError: (e) => toast(e.message)`), inclusive a trava de destino.

- [ ] **Step 2: Ligar os botões na mensagem aberta**

Em `EmailPage.tsx`, no cabeçalho da mensagem aberta (perto do bloco de anexos, ~linha 310), três
botões: **Responder**, **Responder a todos**, **Encaminhar**. E um botão **Escrever** no topo da
coluna das caixas, ao lado do `+`.

- [ ] **Step 3: Guardas do front**

Run: `pnpm --filter @app/web test && pnpm --filter @app/web typecheck`
Expected: 38+ testes passando. **Nenhuma rota nova é criada nesta fase** (tudo vive dentro de
`/email`), então `paginas.test.ts`, `socket.test.ts` e `GuiaTour.test.ts` não deveriam reclamar.
Se reclamarem, foi porque uma rota nova entrou sem querer — reveja.

- [ ] **Step 4: Provar na tela**

Reinicie pelo MODO PAUSA. Em `/email`: escreva para `contato@medconsultoria.com.br`, envie,
confira o toast, e confirme que a mensagem aparece na pasta Enviados depois da sincronização.
Depois abra um e-mail recebido e use **Responder** — a citação tem de vir preenchida.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/email/Escrever.tsx apps/web/src/features/email/EmailPage.tsx
git commit -m "feat(email): tela de escrever, responder, responder a todos e encaminhar"
```

---

### Tarefa 8: Rascunho na pasta `Drafts` do servidor

**Files:**
- Create: `apps/api/src/modules/email/rascunhos.service.ts`
- Modify: `apps/api/src/modules/email/email.router.ts`
- Modify: `apps/web/src/features/email/Escrever.tsx`

**Interfaces:**
- Consumes: `comCaixa`; o mesmo `MailComposer` da Tarefa 3.
- Produces: `salvarRascunho(userId, input: { caixaId, para, cc, cco, assunto, corpoHtml, uidAnterior?: number }): Promise<{ uid: number | null }>`

- [ ] **Step 1: Implementar o serviço**

IMAP **não edita mensagem**: cada gravação é um `APPEND` novo mais a remoção da versão anterior.
O `UIDPLUS` devolve o UID da nova no `appendRes.uid` — é ele que o front guarda para mandar de
volta como `uidAnterior` na gravação seguinte.

```ts
// apps/api/src/modules/email/rascunhos.service.ts (esqueleto — o corpo espelha o da Tarefa 3)
export async function salvarRascunho(userId: string, input: { /* ...campos acima... */ }): Promise<{ uid: number | null }> {
  // 1. conferir posse da caixa (mesmo `caixaDoUsuario` da Tarefa 3 — exporte-o de lá em vez de duplicar)
  // 2. achar a pasta com papel "DRAFTS"; se não existir, devolver { uid: null } sem estourar
  //    (caixa sem pasta de rascunhos é possível, e perder o texto por causa disso seria pior)
  // 3. compor o MIME com MailComposer, igual à Tarefa 3, sem enviar nada
  // 4. dentro de UM `comCaixa`: append(caminhoDrafts, mime, ["\\Draft"]) e, se veio `uidAnterior`,
  //    marcar a antiga como \Deleted e expurgar — nesta ordem, para nunca ficar sem rascunho nenhum
  // 5. devolver o uid novo (appendRes.uid)
}
```

- [ ] **Step 2: Procedure**

```ts
  salvarRascunho: funcionarioProcedure
    .input(
      z.object({
        caixaId: z.string().min(1),
        para: z.array(z.string()).default([]),
        cc: z.array(z.string()).default([]),
        cco: z.array(z.string()).default([]),
        assunto: z.string().max(500).default(""),
        corpoHtml: z.string().max(500_000).default(""),
        uidAnterior: z.number().int().positive().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      exigirModuloLigado();
      return rascunhos.salvarRascunho(ctx.user.id, input);
    }),
```

- [ ] **Step 3: Ligar no `Escrever.tsx`**

Salva **5 segundos depois da última tecla** e ao fechar a janela. Nunca a cada tecla — seria uma
conexão IMAP por tecla. Guarde o `uid` devolvido em estado e mande-o de volta como `uidAnterior`.

- [ ] **Step 4: Provar**

Escreva metade de um e-mail, espere 5 segundos, feche. Abra a pasta **Rascunhos** no webmail: o
texto tem de estar lá, **uma vez só** (se aparecerem duas cópias, a remoção da anterior não
rodou — é o defeito clássico desta tarefa).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/email/rascunhos.service.ts apps/api/src/modules/email/email.router.ts apps/web/src/features/email/Escrever.tsx
git commit -m "feat(email): rascunho salvo na pasta Drafts do servidor"
```

---

### Tarefa 9: Revisões especialistas, documentação e fechamento

- [ ] **Step 1: Rodar a bateria completa**

```bash
pnpm --filter @app/api test        # conferir 0 pulados
pnpm --filter @app/web test
pnpm --filter @app/api typecheck && pnpm --filter @app/web typecheck
pnpm lint                          # 0 errors (warnings pré-existentes são aceitáveis)
pnpm test:e2e:isolado e2e/email.spec.ts
```

- [ ] **Step 2: Revisores especialistas, em paralelo**

`security-reviewer` é **OBRIGATÓRIO** nesta fase — envio usa credencial de terceiro e anexo é
conteúdo hostil. Mande junto `typescript-reviewer` e `react-reviewer`. No briefing de cada um,
aponte: `envio.service.ts`, `smtp.ts`, `http/email-anexo.ts`, `citacao.ts` e `Escrever.tsx`.

- [ ] **Step 3: Corrigir o que for real**

Nem toda observação de revisor procede — confira cada uma no código antes de mexer (skill
`superpowers:receiving-code-review`).

- [ ] **Step 4: Documentar**

- `docs/DECISIONS.md`: ADR novo para a Fase 2A, registrando a **reversão do rascunho** (ADR-95 §2
  dizia rascunho só na app) e a **trava de destinatário fora de produção**.
- `docs/CLAUDE.md` e `CLAUDE.md` da raiz: estado atual (o e-mail agora envia).
- `docs/ROADMAP.md`: Bloco 2 fase 2A concluída.
- Memória `email-na-aplicacao-2026-08-03`.

- [ ] **Step 5: Commit final**

```bash
git add docs CLAUDE.md
git commit -m "docs(email): ADR da fase 2A (envio) e estado atual"
```

---

## Auto-revisão deste plano

**Cobertura do spec (fatias 1 a 4 do §12):** fatia 1 (SMTP + enviar + `APPEND`) → Tarefas 2, 3, 4;
fatia 2 (responder/todos/encaminhar/citação/assinatura) → Tarefas 1, 3, 7 (a assinatura entra no
corpo em `enviarMensagem`); fatia 3 (anexos enviar e baixar) → Tarefa 5; fatia 4 (rascunho na
`Drafts`) → Tarefa 8. Segurança do §8 do spec → Tarefas 1 (destinatários, trava de destino), 3
(citação higienizada, posse), 5 (`attachment`+`nosniff`).

**Um ponto que o executor precisa confirmar olhando o código:** o caminho de import do
`MailComposer` (Tarefa 3, Step 4), com plano B explícito. O outro risco — reusar o model
`Arquivo` para anexos — foi verificado e **descartado**: `Arquivo.clienteId` é obrigatório
(`schema.prisma:525`), então a Tarefa 5 usa arquivo temporário em disco, sem tabela e sem
migration.

**Uma coisa que este plano acrescenta ao spec:** a trava de destinatário fora de produção
(Tarefa 1/3). O `lib/email.ts` de hoje não tem allowlist — a única proteção é o gate
`isEmailReal`, que não vale aqui, porque o SMTP da caixa da pessoa é real em qualquer ambiente.
Sem essa trava, um teste de desenvolvimento manda e-mail de verdade para um cliente de verdade.

**O que este plano deliberadamente NÃO faz:** editor de texto rico (YAGNI — o projeto não tem um,
e `Textarea` resolve), agrupar conversa, ações de mover/apagar (fase 2B), ficha do cliente (2D).
