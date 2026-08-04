# E-mail na aplicação — Bloco 1 (plugar uma caixa e ler) — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam
> caixinhas (`- [ ]`) para acompanhamento.

**Objetivo:** um membro da equipe pluga a própria caixa `@medconsultoria.com.br` no Workspace e lê
os e-mails dela dentro da aplicação, sem abrir o webmail.

**Arquitetura:** módulo novo `apps/api/src/modules/email/` na camada padrão do projeto
(`router` → `service` → Prisma), falando IMAP por conexões curtas (`imapflow`), guardando **índice
e cache** — remetente, assunto, data, destinatários e resumo — e buscando o corpo só quando alguém
abre a mensagem. O servidor de e-mail continua sendo a fonte da verdade. Front em
`apps/web/src/features/email/` numa página de três colunas em modo tela cheia.

**Stack:** Fastify + tRPC + Prisma/MySQL · `imapflow` (IMAP) · `mailparser` (MIME) ·
`sanitize-html` (higienização) · Vite + React + TanStack Query.

**Referência:** `docs/superpowers/specs/2026-08-03-email-na-aplicacao-design.md` — este plano
cobre as **fatias 1 e 2** da seção 11 daquele documento.

## Restrições globais

Valem para **todas** as tarefas deste plano.

- **Idioma:** todo texto de interface, mensagem de erro, comentário e commit em **pt-BR**.
- **`noUncheckedIndexedAccess` está ligado.** Todo acesso por índice (`partes[1]`,
  `email.split("@")[1]`, `lista[0]`) devolve `T | undefined`. Trate com checagem explícita que
  produza mensagem útil em pt-BR — **nunca** com `as string` nem com `!` em código de produção
  (em teste, `!` é aceitável). Custou duas rodadas na Tarefa 1; não repita.
- **Camadas:** `router` (tRPC + Zod + autorização) → `service` (regra, sem saber de HTTP) →
  Prisma. Nunca Prisma dentro de router.
- **Autorização:** tudo neste bloco usa `funcionarioProcedure` (equipe interna; exclui o papel
  `CLIENTE` do Portal). **Toda** consulta de caixa/pasta/mensagem filtra por
  `caixa.userId === ctx.user.id`. Não existe exceção neste bloco.
- **O `segredo` da caixa nunca sai da API.** Nenhum procedure devolve o campo, nem cifrado, nem
  mascarado. Todo `select` de `CaixaEmail` é explícito — nunca `include` cru do model inteiro.
- **Nunca logar credencial.** Nada de `console.log` de senha, de `segredo`, nem do objeto de
  configuração da conexão IMAP inteiro.
- **Formatação na UI:** usar os helpers centrais (`data`, `dataHora`, `haQuanto` de
  `apps/web/src/lib/format-date`). Proibido reimplementar formatador local (ADR-32).
- **Migrations com o keep-alive em PAUSA.** Antes de qualquer `prisma migrate`:
  `touch scripts/.keepalive-pause`; depois `rm scripts/.keepalive-pause`. Nunca matar o node cru —
  isso deixa o banco travado pela metade.
- **Envio real de teste:** só para `tibamooca@gmail.com` ou `contato@medconsultoria.com.br`.
  (Neste bloco não há envio; a regra fica registrada porque vale no bloco seguinte.)
- **Caixa de teste:** `teste@medconsultoria.com.br`, servidor `mail.medconsultoria.com.br`,
  IMAP 993 TLS. A senha vive **apenas** no `.env` local (ignorado pelo git) nas variáveis
  `EMAIL_TESTE_USER` / `EMAIL_TESTE_PASS`. **Nunca** escrever a senha em arquivo versionado,
  em teste, em fixture ou em mensagem de commit.
- **Fatos verificados do servidor** (sondados em 03/08/2026 — não presumir outra coisa):
  Dovecot · separador de pasta **`.`** · `SPECIAL-USE` presente (`\Inbox` `\Sent` `\Drafts`
  `\Junk` `\Trash`) · `QRESYNC` `CONDSTORE` `MOVE` `UIDPLUS` `ESEARCH` `PREVIEW`
  `THREAD=REFERENCES` disponíveis · SMTP 465 `SIZE 78643200` `RCPTMAX=200`.

---

## Estrutura de arquivos

**Criar (API)**

| Arquivo | Responsabilidade |
|---|---|
| `apps/api/src/lib/cripto-caixa.ts` | Cifrar/decifrar a senha da caixa (AES-256-GCM) |
| `apps/api/src/lib/cripto-caixa.test.ts` | Testes da cifra |
| `apps/api/src/lib/sanitizar-html.ts` | Higienizar o HTML recebido por e-mail |
| `apps/api/src/lib/sanitizar-html.test.ts` | Testes com vetores de ataque reais |
| `apps/api/src/modules/email/imap.ts` | Conexão IMAP, descoberta de servidor, teste de conexão |
| `apps/api/src/modules/email/caixas.service.ts` | Plugar, listar, remover e reconectar caixa |
| `apps/api/src/modules/email/pastas.service.ts` | Descobrir e sincronizar a lista de pastas |
| `apps/api/src/modules/email/sync.service.ts` | Sincronizar mensagens de uma pasta (QRESYNC) |
| `apps/api/src/modules/email/leitura.service.ts` | Listar mensagens e abrir uma (corpo sob demanda) |
| `apps/api/src/modules/email/enderecos.ts` | Normalizar endereços e derivar `threadKey` |
| `apps/api/src/modules/email/enderecos.test.ts` | Testes da normalização |
| `apps/api/src/modules/email/email.router.ts` | Procedures tRPC do módulo |
| `apps/api/src/test/email-caixa.integration.test.ts` | Integração contra a caixa real de teste |

**Modificar (API)**

| Arquivo | Mudança |
|---|---|
| `packages/db/prisma/schema.prisma` | 5 models + 2 enums novos |
| `apps/api/src/config.ts` | `EMAIL_CRYPTO_KEY` + `isEmailAppEnabled` |
| `apps/api/src/trpc/router.ts` | Plugar `email: emailRouter` |
| `apps/api/package.json` | `imapflow`, `mailparser`, `sanitize-html` (+ tipos) |

**Front** — definido nas tarefas 10 a 12 (arquivos em `apps/web/src/features/email/`).

---

## Tarefa 1 — Cifra da senha da caixa

**Arquivos**
- Criar: `apps/api/src/lib/cripto-caixa.ts`
- Criar: `apps/api/src/lib/cripto-caixa.test.ts`
- Modificar: `apps/api/src/config.ts`

**Interfaces**
- Consome: `config` de `../config.js`
- Produz: `cifrar(texto: string): string` · `decifrar(guardado: string): string` ·
  `isEmailAppEnabled: boolean` (exportado de `config.ts`)

- [ ] **Passo 1 — escrever o teste que falha**

`apps/api/src/lib/cripto-caixa.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

// A chave precisa existir ANTES de o config.ts ser importado (ele valida no boot).
beforeAll(() => {
  process.env.EMAIL_CRYPTO_KEY = randomBytes(32).toString("base64");
});

describe("cripto-caixa", () => {
  it("decifra de volta o que cifrou", async () => {
    const { cifrar, decifrar } = await import("./cripto-caixa.js");
    const segredo = "senha-da-caixa-com-acento-ção-e-símbolo-@#$";
    expect(decifrar(cifrar(segredo))).toBe(segredo);
  });

  it("gera saída diferente a cada chamada (IV aleatório)", async () => {
    const { cifrar } = await import("./cripto-caixa.js");
    expect(cifrar("igual")).not.toBe(cifrar("igual"));
  });

  it("recusa conteúdo adulterado (GCM detecta)", async () => {
    const { cifrar, decifrar } = await import("./cripto-caixa.js");
    const [v, iv, tag, ct] = cifrar("original").split(":");
    const adulterado = Buffer.from(ct, "base64");
    adulterado[0] = adulterado[0] ^ 0xff;
    expect(() => decifrar([v, iv, tag, adulterado.toString("base64")].join(":"))).toThrow();
  });

  it("recusa formato de versão desconhecida", async () => {
    const { decifrar } = await import("./cripto-caixa.js");
    expect(() => decifrar("v9:a:b:c")).toThrow(/desconhecid/i);
  });
});
```

- [ ] **Passo 2 — rodar e confirmar que falha**

Rodar: `pnpm --filter @app/api test -- cripto-caixa`
Esperado: FALHA com "Cannot find module './cripto-caixa.js'".

- [ ] **Passo 3 — declarar a variável no config**

Em `apps/api/src/config.ts`, dentro do `z.object({...})`, logo depois do bloco `SMTP_*`:

```ts
  // Chave de cifra das senhas das caixas de e-mail plugadas pela equipe (32 bytes em base64).
  // Gerar com: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  // Ausente → o e-mail dentro da aplicação fica DESLIGADO (mesma degradação do SMTP).
  EMAIL_CRYPTO_KEY: z.string().optional(),
```

E no fim do arquivo, junto de `isEmailReal`:

```ts
/** E-mail dentro da app (IMAP por usuário) só liga com a chave de cifra presente e válida. */
export const isEmailAppEnabled = (() => {
  const b64 = config.EMAIL_CRYPTO_KEY;
  if (!b64) return false;
  try {
    return Buffer.from(b64, "base64").length === 32;
  } catch {
    return false;
  }
})();
```

- [ ] **Passo 4 — implementar a cifra**

`apps/api/src/lib/cripto-caixa.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config.js";

/** Versão do formato guardado. Trocar de esquema no futuro = novo prefixo, sem migration. */
const VERSAO = "v1";

function chave(): Buffer {
  const b64 = config.EMAIL_CRYPTO_KEY;
  if (!b64) {
    throw new Error("EMAIL_CRYPTO_KEY não configurada — o e-mail dentro da aplicação está desligado.");
  }
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) {
    throw new Error("EMAIL_CRYPTO_KEY inválida: são necessários 32 bytes em base64.");
  }
  return k;
}

/** Cifra a senha da caixa. Formato: `v1:<iv>:<tag>:<cifrado>`, tudo em base64. */
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const cifrado = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [VERSAO, iv.toString("base64"), c.getAuthTag().toString("base64"), cifrado.toString("base64")].join(":");
}

/** Decifra. Lança se a chave estiver errada OU se o conteúdo tiver sido adulterado (GCM). */
export function decifrar(guardado: string): string {
  const [versao, ivB64, tagB64, cifradoB64] = guardado.split(":");
  if (versao !== VERSAO || !ivB64 || !tagB64 || !cifradoB64) {
    throw new Error("Formato de segredo desconhecido — a caixa precisa ser reconectada.");
  }
  const d = createDecipheriv("aes-256-gcm", chave(), Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([d.update(Buffer.from(cifradoB64, "base64")), d.final()]).toString("utf8");
}
```

- [ ] **Passo 5 — rodar e confirmar que passa**

Rodar: `pnpm --filter @app/api test -- cripto-caixa`
Esperado: 4 testes PASSAM.

- [ ] **Passo 6 — commitar**

```bash
git add apps/api/src/lib/cripto-caixa.ts apps/api/src/lib/cripto-caixa.test.ts apps/api/src/config.ts
git commit -m "feat(email): cifra AES-256-GCM da senha das caixas plugadas"
```

---

## Tarefa 2 — Modelos no banco

**Arquivos**
- Modificar: `packages/db/prisma/schema.prisma`
- Criar: a migration gerada em `packages/db/prisma/migrations/`

**Interfaces**
- Produz: models `CaixaEmail`, `CaixaPasta`, `EmailMensagem`, `EmailEndereco`, `EmailAnexo`;
  enums `CaixaEstado`, `PastaPapel`, `EnderecoPapel`. `EmailRascunho` **não** entra aqui — é do
  bloco de envio (fatia 4), e criar campo sem uso agora é especulação.

- [ ] **Passo 1 — pausar o keep-alive**

Rodar: `touch scripts/.keepalive-pause`
Esperado: o supervisor registra "pausa detectada" em `scripts/.keepalive.log` e o dev para.

- [ ] **Passo 2 — escrever os models**

No fim de `packages/db/prisma/schema.prisma`:

```prisma
// ─────────────────────────────────────────────────────────────
// E-mail dentro da aplicação (IMAP por usuário) — ver
// docs/superpowers/specs/2026-08-03-email-na-aplicacao-design.md

enum CaixaEstado {
  OK
  AUTENTICACAO_FALHOU
  ERRO
}

enum PastaPapel {
  INBOX
  SENT
  DRAFTS
  TRASH
  JUNK
  ARCHIVE
}

enum EnderecoPapel {
  DE
  PARA
  CC
  CCO
  RESPONDER_A
}

/// Caixa de e-mail que UM usuário plugou na própria conta. A privacidade nasce do `userId`:
/// ninguém enxerga caixa de ninguém. Duas pessoas podem plugar o MESMO endereço (ex.: contato@)
/// — são duas linhas, e o servidor de e-mail é quem concilia (é a mesma caixa de verdade).
model CaixaEmail {
  id            String      @id @default(cuid())
  userId        String
  email         String
  rotulo        String?
  nomeExibicao  String
  assinatura    String?     @db.Text
  imapHost      String
  imapPorta     Int         @default(993)
  smtpHost      String
  smtpPorta     Int         @default(465)
  usuario       String
  /// Senha cifrada (AES-256-GCM, ver lib/cripto-caixa.ts). NUNCA sai da API.
  segredo       String      @db.Text
  padrao        Boolean     @default(false)
  ativa         Boolean     @default(true)
  estado        CaixaEstado @default(OK)
  ultimoErro    String?     @db.Text
  ultimaSyncEm  DateTime?
  /// Limite para trás da sincronização. Padrão = 90 dias atrás no momento de plugar.
  importarDesde DateTime?
  createdAt     DateTime    @default(now())
  deletedAt     DateTime?

  user   User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  pastas CaixaPasta[]

  @@unique([userId, email])
  @@index([userId, ativa])
}

/// Uma pasta da caixa, com os ponteiros de sincronização do IMAP.
model CaixaPasta {
  id            String      @id @default(cuid())
  caixaId       String
  caminho       String
  nome          String
  papel         PastaPapel?
  uidValidity   BigInt      @default(0)
  ultimoUid     BigInt      @default(0)
  highestModseq BigInt      @default(0)
  naoLidos      Int         @default(0)
  total         Int         @default(0)
  ordem         Int         @default(0)
  sincronizando DateTime?

  caixa     CaixaEmail      @relation(fields: [caixaId], references: [id], onDelete: Cascade)
  mensagens EmailMensagem[]

  @@unique([caixaId, caminho])
  @@index([caixaId, ordem])
}

/// Índice de uma mensagem. O corpo é CACHE: nulo até alguém abrir.
model EmailMensagem {
  id          String    @id @default(cuid())
  caixaId     String
  pastaId     String
  uid         BigInt
  messageId   String?   @db.VarChar(512)
  inReplyTo   String?   @db.VarChar(512)
  referencias String?   @db.Text
  threadKey   String?   @db.VarChar(512)
  deNome      String?
  deEmail     String
  assunto     String?   @db.Text
  trecho      String?   @db.Text
  dataEm      DateTime
  lido        Boolean   @default(false)
  respondido  Boolean   @default(false)
  temAnexo    Boolean   @default(false)
  tamanho     Int?
  corpoHtml   String?   @db.LongText
  corpoTexto  String?   @db.LongText
  corpoEm     DateTime?
  /// Marcada como particular pelo dono: sai da ficha do cliente (usado no bloco do CRM).
  particular  Boolean   @default(false)
  createdAt   DateTime  @default(now())

  pasta     CaixaPasta      @relation(fields: [pastaId], references: [id], onDelete: Cascade)
  enderecos EmailEndereco[]
  anexos    EmailAnexo[]

  @@unique([pastaId, uid])
  @@index([caixaId, dataEm])
  @@index([threadKey])
}

/// Todos os endereços de uma mensagem. O vínculo com Cliente/Lead é resolvido por JOIN
/// neste endereço na hora de consultar — nunca gravado fixo (ver §5.4 do desenho).
model EmailEndereco {
  id         String        @id @default(cuid())
  mensagemId String
  papel      EnderecoPapel
  nome       String?
  endereco   String

  mensagem EmailMensagem @relation(fields: [mensagemId], references: [id], onDelete: Cascade)

  @@index([endereco])
  @@index([mensagemId])
}

/// Metadado do anexo. O CONTEÚDO não é guardado — é buscado no IMAP na hora do download.
model EmailAnexo {
  id         String  @id @default(cuid())
  mensagemId String
  nome       String
  tipo       String
  tamanho    Int
  parte      String
  cid        String?
  arquivoId  String?

  mensagem EmailMensagem @relation(fields: [mensagemId], references: [id], onDelete: Cascade)

  @@index([mensagemId])
}
```

- [ ] **Passo 3 — declarar a relação no `User`**

No model `User` de `packages/db/prisma/schema.prisma`, junto das outras relações, acrescentar:

```prisma
  caixasEmail CaixaEmail[]
```

- [ ] **Passo 4 — gerar a migration**

Rodar (da raiz do repositório, no Bash):

```bash
set -a; . ./.env; set +a
pnpm --filter @app/db exec prisma migrate dev --name email_caixas --skip-generate
```

**Por que não é `pnpm db:migrate`:** o script roda o Prisma com o diretório de trabalho em
`packages/db`, e o `.env` vive na **raiz** — o Prisma não o enxerga e morre com
`P1012: Environment variable not found: DATABASE_URL`. Carregar o `.env` no ambiente antes
resolve. (Custou uma rodada na execução real; não repita.)

Esperado: cria `packages/db/prisma/migrations/<timestamp>_email_caixas/migration.sql` e aplica no
MySQL da porta 3307. Se recusar por interatividade, gerar com `prisma migrate diff` e aplicar com
`prisma migrate deploy` (armadilha conhecida do projeto).

- [ ] **Passo 5 — gerar o client e conferir que compila**

Rodar (**no mesmo shell** do passo anterior, com o `.env` já carregado):
`pnpm db:generate && pnpm --filter @app/api typecheck`
Esperado: sem erro.

- [ ] **Passo 6 — despausar o keep-alive e confirmar que a app voltou**

Rodar: `rm scripts/.keepalive-pause`
Depois: `curl -s http://localhost:4319/health`
Esperado: `{"status":"ok",...}`.

- [ ] **Passo 7 — commitar**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(email): models CaixaEmail/CaixaPasta/EmailMensagem/EmailEndereco/EmailAnexo"
```

---

## Tarefa 3 — Normalização de endereços e chave de conversa

**Arquivos**
- Criar: `apps/api/src/modules/email/enderecos.ts`
- Criar: `apps/api/src/modules/email/enderecos.test.ts`

**Interfaces**
- Produz:
  - `normalizarEndereco(e: string): string`
  - `type EnderecoBruto = { name?: string | null; address?: string | null }`
  - `extrairEnderecos(env: EnvelopeParcial): Array<{ papel: "DE"|"PARA"|"CC"|"CCO"|"RESPONDER_A"; nome: string | null; endereco: string }>`
  - `derivarThreadKey(a: { messageId?: string | null; inReplyTo?: string | null; referencias?: string | null }): string | null`

- [ ] **Passo 1 — escrever o teste que falha**

`apps/api/src/modules/email/enderecos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizarEndereco, extrairEnderecos, derivarThreadKey } from "./enderecos.js";

describe("normalizarEndereco", () => {
  it("baixa a caixa e tira espaços", () => {
    expect(normalizarEndereco("  Thais.Garcia@MedConsultoria.com.BR ")).toBe("thais.garcia@medconsultoria.com.br");
  });
  it("tira os sinais de menor/maior que alguns servidores mandam", () => {
    expect(normalizarEndereco("<contato@medconsultoria.com.br>")).toBe("contato@medconsultoria.com.br");
  });
});

describe("extrairEnderecos", () => {
  it("classifica de/para/cc e ignora entrada sem endereço", () => {
    const r = extrairEnderecos({
      from: [{ name: "José", address: "Jose@Cliente.com" }],
      to: [{ name: null, address: "teste@medconsultoria.com.br" }],
      cc: [{ name: "Sem endereço", address: null }],
    });
    expect(r).toEqual([
      { papel: "DE", nome: "José", endereco: "jose@cliente.com" },
      { papel: "PARA", nome: null, endereco: "teste@medconsultoria.com.br" },
    ]);
  });
});

describe("derivarThreadKey", () => {
  it("usa a PRIMEIRA referência, que é a raiz da conversa", () => {
    expect(
      derivarThreadKey({ messageId: "<c@x>", inReplyTo: "<b@x>", referencias: "<a@x> <b@x>" }),
    ).toBe("<a@x>");
  });
  it("sem referências, cai no inReplyTo", () => {
    expect(derivarThreadKey({ messageId: "<b@x>", inReplyTo: "<a@x>", referencias: null })).toBe("<a@x>");
  });
  it("mensagem que inicia a conversa é a própria raiz", () => {
    expect(derivarThreadKey({ messageId: "<a@x>", inReplyTo: null, referencias: null })).toBe("<a@x>");
  });
  it("sem nada devolve nulo, e não uma string vazia", () => {
    expect(derivarThreadKey({ messageId: null, inReplyTo: null, referencias: null })).toBeNull();
  });
});
```

- [ ] **Passo 2 — rodar e confirmar que falha**

Rodar: `pnpm --filter @app/api test -- enderecos`
Esperado: FALHA com "Cannot find module './enderecos.js'".

- [ ] **Passo 3 — implementar**

`apps/api/src/modules/email/enderecos.ts`:

```ts
export type EnderecoBruto = { name?: string | null; address?: string | null };

type EnvelopeParcial = {
  from?: EnderecoBruto[] | null;
  to?: EnderecoBruto[] | null;
  cc?: EnderecoBruto[] | null;
  bcc?: EnderecoBruto[] | null;
  replyTo?: EnderecoBruto[] | null;
};

export type PapelEndereco = "DE" | "PARA" | "CC" | "CCO" | "RESPONDER_A";

/** Minúsculo, sem espaço e sem os `<>` que alguns servidores mandam. É a chave do vínculo. */
export function normalizarEndereco(e: string): string {
  return e.trim().replace(/^<|>$/g, "").trim().toLowerCase();
}

const MAPA: Array<[keyof EnvelopeParcial, PapelEndereco]> = [
  ["from", "DE"],
  ["to", "PARA"],
  ["cc", "CC"],
  ["bcc", "CCO"],
  ["replyTo", "RESPONDER_A"],
];

export function extrairEnderecos(env: EnvelopeParcial) {
  const saida: Array<{ papel: PapelEndereco; nome: string | null; endereco: string }> = [];
  for (const [campo, papel] of MAPA) {
    for (const item of env[campo] ?? []) {
      if (!item?.address) continue; // grupos e entradas malformadas não viram vínculo
      saida.push({ papel, nome: item.name?.trim() || null, endereco: normalizarEndereco(item.address) });
    }
  }
  return saida;
}

/**
 * Raiz da conversa. `References` guarda a linhagem em ordem — o primeiro item é quem começou.
 * Cair no `In-Reply-To` e, por fim, no próprio `Message-ID` cobre respostas de clientes que
 * não mandam `References` (acontece bastante com celular).
 */
export function derivarThreadKey(a: {
  messageId?: string | null;
  inReplyTo?: string | null;
  referencias?: string | null;
}): string | null {
  const primeira = a.referencias?.trim().split(/\s+/).filter(Boolean)[0];
  return primeira || a.inReplyTo?.trim() || a.messageId?.trim() || null;
}
```

- [ ] **Passo 4 — rodar e confirmar que passa**

Rodar: `pnpm --filter @app/api test -- enderecos`
Esperado: 7 testes PASSAM.

- [ ] **Passo 5 — commitar**

```bash
git add apps/api/src/modules/email/enderecos.ts apps/api/src/modules/email/enderecos.test.ts
git commit -m "feat(email): normalização de endereços e chave de conversa"
```

---

## Tarefa 4 — Higienização do HTML recebido

**Arquivos**
- Criar: `apps/api/src/lib/sanitizar-html.ts`
- Criar: `apps/api/src/lib/sanitizar-html.test.ts`
- Modificar: `apps/api/package.json`

**Interfaces**
- Produz: `sanitizarEmailHtml(html: string): { html: string; imagensRemotasBloqueadas: number }`

> Esta é a camada 1 das três do §7.2 do desenho. As camadas 2 e 3 (iframe isolado e botão
> "Mostrar imagens") são da Tarefa 11, no front. **Nenhuma delas é opcional.**

- [ ] **Passo 1 — instalar a dependência**

Rodar: `pnpm --filter @app/api add sanitize-html && pnpm --filter @app/api add -D @types/sanitize-html`
Esperado: entram em `apps/api/package.json`.

- [ ] **Passo 2 — escrever o teste que falha**

`apps/api/src/lib/sanitizar-html.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizarEmailHtml } from "./sanitizar-html.js";

describe("sanitizarEmailHtml", () => {
  it("remove script", () => {
    const { html } = sanitizarEmailHtml('<p>oi</p><script>fetch("/roubar")</script>');
    expect(html).toContain("oi");
    expect(html.toLowerCase()).not.toContain("script");
  });

  it("remove atributos de evento", () => {
    const { html } = sanitizarEmailHtml('<img src="https://x/y.png" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("remove link javascript:", () => {
    const { html } = sanitizarEmailHtml('<a href="javascript:alert(1)">clique</a>');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("clique");
  });

  it("remove iframe e form (roubo de credencial dentro do e-mail)", () => {
    const { html } = sanitizarEmailHtml('<iframe src="https://x"></iframe><form action="https://x"><input name="senha"></form>');
    expect(html.toLowerCase()).not.toContain("<iframe");
    expect(html.toLowerCase()).not.toContain("<form");
  });

  it("bloqueia imagem remota e conta quantas", () => {
    const r = sanitizarEmailHtml('<img src="https://rastreio/pixel.gif"><img src="http://outro/a.png">');
    expect(r.imagensRemotasBloqueadas).toBe(2);
    // O que precisa ser verdade é que NENHUMA imagem tem `src` — o navegador não busca nada.
    // A URL continua no HTML, guardada em `data-src-bloqueada`: é dela que o botão
    // "Mostrar imagens" precisa. Afirmar que a URL sumiu quebraria esse botão.
    expect(r.html).not.toMatch(/<img[^>]*\ssrc=/);
    expect(r.html).toContain('data-src-bloqueada="https://rastreio/pixel.gif"');
    expect(r.html).toContain('data-src-bloqueada="http://outro/a.png"');
  });

  it("preserva formatação legítima de e-mail (tabela, negrito, link http)", () => {
    const { html } = sanitizarEmailHtml('<table><tr><td><b>Total</b> <a href="https://medconsultoria.com.br">site</a></td></tr></table>');
    expect(html).toContain("<table");
    expect(html).toContain("<b>Total</b>");
    expect(html).toContain('href="https://medconsultoria.com.br"');
  });

  it("aguenta entrada vazia sem explodir", () => {
    expect(sanitizarEmailHtml("").html).toBe("");
  });
});
```

- [ ] **Passo 3 — rodar e confirmar que falha**

Rodar: `pnpm --filter @app/api test -- sanitizar-html`
Esperado: FALHA com "Cannot find module './sanitizar-html.js'".

- [ ] **Passo 4 — implementar**

`apps/api/src/lib/sanitizar-html.ts`:

```ts
import sanitizeHtml from "sanitize-html";

/**
 * Higieniza o HTML de um e-mail recebido. É a entrada mais hostil do sistema: qualquer pessoa do
 * mundo pode mandar HTML para cá. Camada 1 de 3 — as outras duas (iframe isolado e "Mostrar
 * imagens") são no front. Ver §7.2 do desenho.
 *
 * Imagem remota vira `data-src-bloqueada`: o front decide mostrar. O "pixel invisível" é como
 * quem manda spam confirma que o endereço existe e que foi lido.
 */
export function sanitizarEmailHtml(html: string): { html: string; imagensRemotasBloqueadas: number } {
  if (!html) return { html: "", imagensRemotasBloqueadas: 0 };

  let bloqueadas = 0;

  const limpo = sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "hr", "div", "span", "b", "strong", "i", "em", "u", "s", "sub", "sup",
      "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code",
      "ul", "ol", "li", "dl", "dt", "dd",
      "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
      "a", "img", "figure", "figcaption", "center", "font",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "data-src-bloqueada", "data-cid"],
      "*": ["style", "align", "valign", "colspan", "rowspan", "width", "height", "bgcolor", "color", "face", "size"],
    },
    // Só o que é seguro navegar. `data:` fica de fora de propósito (vetor de execução).
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "cid"] },
    // Toda âncora sai isolada da aba de origem.
    transformTags: {
      a: (nome, atributos) => ({
        tagName: "a",
        attribs: { ...atributos, target: "_blank", rel: "noopener noreferrer nofollow" },
      }),
      img: (nome, atributos) => {
        const src = atributos.src ?? "";
        if (/^https?:/i.test(src)) {
          bloqueadas += 1;
          const { src: _fora, ...resto } = atributos;
          return { tagName: "img", attribs: { ...resto, "data-src-bloqueada": src } };
        }
        return { tagName: "img", attribs: atributos };
      },
    },
    // `style` sobrevive, mas sem `position`/`url()` — que servem para sobrepor a interface.
    allowedStyles: {
      "*": {
        color: [/^.*$/],
        "background-color": [/^.*$/],
        "font-size": [/^.*$/],
        "font-family": [/^.*$/],
        "font-weight": [/^.*$/],
        "font-style": [/^.*$/],
        "text-align": [/^.*$/],
        "text-decoration": [/^.*$/],
        padding: [/^.*$/],
        margin: [/^.*$/],
        border: [/^.*$/],
        width: [/^.*$/],
        "max-width": [/^.*$/],
      },
    },
    disallowedTagsMode: "discard",
  });

  return { html: limpo, imagensRemotasBloqueadas: bloqueadas };
}
```

- [ ] **Passo 5 — rodar e confirmar que passa**

Rodar: `pnpm --filter @app/api test -- sanitizar-html`
Esperado: 7 testes PASSAM.

- [ ] **Passo 6 — commitar**

```bash
git add apps/api/src/lib/sanitizar-html.ts apps/api/src/lib/sanitizar-html.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(email): higienização do HTML recebido (camada 1 de 3)"
```

---

## Tarefa 5 — Conexão IMAP e teste de credencial

**Arquivos**
- Criar: `apps/api/src/modules/email/imap.ts`
- Modificar: `apps/api/package.json`

**Interfaces**
- Consome: `decifrar` de `../../lib/cripto-caixa.js`
- Produz:
  - `type DadosConexao = { imapHost: string; imapPorta: number; usuario: string; senha: string }`
  - `descobrirServidor(email: string): { imapHost: string; imapPorta: number; smtpHost: string; smtpPorta: number }`
  - `testarConexao(d: DadosConexao): Promise<{ ok: true } | { ok: false; motivo: "AUTENTICACAO" | "REDE"; detalhe: string }>`
  - `comCaixa<T>(caixaId: string, fn: (c: ImapFlow) => Promise<T>): Promise<T>`

- [ ] **Passo 1 — instalar as dependências**

Rodar:

```bash
pnpm --filter @app/api add imapflow mailparser
pnpm --filter @app/api add -D @types/mailparser
```

Esperado: entram em `apps/api/package.json`. **`imapflow` traz os próprios tipos; `mailparser`
NÃO traz** (`package.json` dele não tem `types`) — sem `@types/mailparser` a Tarefa 8 não compila.
(Verificado na execução real; o plano dizia o contrário.)

- [ ] **Passo 2 — implementar**

`apps/api/src/modules/email/imap.ts`:

```ts
import { ImapFlow } from "imapflow";
import { prisma } from "@app/db";
import { decifrar } from "../../lib/cripto-caixa.js";

export type DadosConexao = { imapHost: string; imapPorta: number; usuario: string; senha: string };

/** Prazos curtos de propósito: servidor de e-mail lento não pode travar a página. */
const TEMPO_CONEXAO = 15_000;
const TEMPO_OPERACAO = 45_000;

/**
 * Deduz o servidor a partir do domínio do endereço. Vale para o domínio da MedConsultoria e
 * para qualquer hospedagem que siga a convenção `mail.<domínio>` — que é o caso da TineHost
 * (verificado: MX = mail.medconsultoria.com.br). Caixas externas não entram nesta fase.
 */
export function descobrirServidor(email: string) {
  const dominio = email.split("@")[1]?.trim().toLowerCase();
  if (!dominio) throw new Error("Endereço de e-mail inválido.");
  return { imapHost: `mail.${dominio}`, imapPorta: 993, smtpHost: `mail.${dominio}`, smtpPorta: 465 };
}

function novoCliente(d: DadosConexao): ImapFlow {
  return new ImapFlow({
    host: d.imapHost,
    port: d.imapPorta,
    secure: true,
    auth: { user: d.usuario, pass: d.senha },
    logger: false, // NUNCA ligar: o log do imapflow inclui o diálogo de autenticação
    connectionTimeout: TEMPO_CONEXAO,
    greetingTimeout: TEMPO_CONEXAO,
    socketTimeout: TEMPO_OPERACAO,
  });
}

/**
 * Testa a credencial ANTES de gravar a caixa. Distingue senha errada de servidor fora do ar:
 * a primeira é culpa de quem digitou, a segunda não — e a mensagem na tela muda por causa disso.
 */
export async function testarConexao(
  d: DadosConexao,
): Promise<{ ok: true } | { ok: false; motivo: "AUTENTICACAO" | "REDE"; detalhe: string }> {
  const c = novoCliente(d);
  try {
    await c.connect();
    await c.logout();
    return { ok: true };
  } catch (e) {
    const err = e as { authenticationFailed?: boolean; responseText?: string; message?: string };
    const autenticacao = err.authenticationFailed === true || /auth/i.test(err.responseText ?? "");
    return {
      ok: false,
      motivo: autenticacao ? "AUTENTICACAO" : "REDE",
      detalhe: err.responseText ?? err.message ?? "Falha desconhecida ao conectar.",
    };
  } finally {
    // `close` é síncrono e idempotente — garante que o socket não fique pendurado se `logout` falhar.
    c.close();
  }
}

/**
 * Abre uma conexão para a caixa, roda `fn` e fecha SEMPRE. Conexão curta é obrigatória: o
 * LiteSpeed/lsnode derruba o processo Node ocioso (mesma causa do ADR-84), então não existe
 * conexão viva entre requisições nem `IDLE`.
 *
 * Falha de autenticação marca a caixa como `AUTENTICACAO_FALHOU` e a app PARA de tentar — tentar
 * em laço faz o servidor de e-mail bloquear o IP por suspeita de invasão, e aí ninguém mais
 * recebe e-mail, nem os automáticos.
 */
export async function comCaixa<T>(caixaId: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const caixa = await prisma.caixaEmail.findFirst({
    where: { id: caixaId, deletedAt: null },
    select: { id: true, imapHost: true, imapPorta: true, usuario: true, segredo: true, estado: true },
  });
  if (!caixa) throw new Error("Caixa não encontrada.");
  if (caixa.estado === "AUTENTICACAO_FALHOU") {
    throw new Error("Esta caixa precisa ser reconectada: a senha guardada foi recusada pelo servidor.");
  }

  const c = novoCliente({
    imapHost: caixa.imapHost,
    imapPorta: caixa.imapPorta,
    usuario: caixa.usuario,
    senha: decifrar(caixa.segredo),
  });

  try {
    await c.connect();
    const r = await fn(c);
    await c.logout();
    return r;
  } catch (e) {
    const err = e as { authenticationFailed?: boolean; message?: string };
    if (err.authenticationFailed === true) {
      await prisma.caixaEmail.update({
        where: { id: caixa.id },
        data: { estado: "AUTENTICACAO_FALHOU", ultimoErro: "Senha recusada pelo servidor de e-mail." },
      });
    } else {
      await prisma.caixaEmail.update({
        where: { id: caixa.id },
        data: { estado: "ERRO", ultimoErro: (err.message ?? "Falha ao falar com o servidor.").slice(0, 500) },
      });
    }
    throw e;
  } finally {
    c.close();
  }
}
```

- [ ] **Passo 3 — conferir que compila**

Rodar: `pnpm --filter @app/api typecheck`
Esperado: sem erro.

- [ ] **Passo 4 — commitar**

```bash
git add apps/api/src/modules/email/imap.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(email): conexão IMAP curta, descoberta de servidor e teste de credencial"
```

---

## Tarefa 6 — Plugar, listar e remover caixa

**Arquivos**
- Criar: `apps/api/src/modules/email/caixas.service.ts`
- Criar: `apps/api/src/test/email-caixa.integration.test.ts`

**Interfaces**
- Consome: `descobrirServidor`, `testarConexao` de `./imap.js`; `cifrar` de `../../lib/cripto-caixa.js`
- Produz:
  - `plugarCaixa(userId: string, e: { email: string; senha: string; nomeExibicao: string; rotulo?: string; importarMeses?: number }): Promise<{ id: string }>`
  - `listarCaixas(userId: string)` → sem o campo `segredo`
  - `removerCaixa(userId: string, caixaId: string): Promise<void>`
  - `reconectarCaixa(userId: string, caixaId: string, senha: string): Promise<void>`

- [ ] **Passo 1 — escrever o teste de integração que falha**

`apps/api/src/test/email-caixa.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@app/db";

const USER = process.env.EMAIL_TESTE_USER;
const PASS = process.env.EMAIL_TESTE_PASS;
const temCaixa = !!(USER && PASS);

// Sem credencial no .env local, o teste é pulado em vez de falhar — o CI não tem a caixa.
const talvez = temCaixa ? describe : describe.skip;

talvez("plugar caixa (integração, caixa real de teste)", () => {
  let userId = "";

  beforeAll(async () => {
    process.env.EMAIL_CRYPTO_KEY ||= randomBytes(32).toString("base64");
    // O banco dos testes é ISOLADO (medconsultoria_test) — a vitest.config injeta a URL.
    expect(process.env.DATABASE_URL).toContain("_test");
    const u = await prisma.user.create({
      // O campo do model User é `passwordHash` — NÃO `senhaHash`.
      data: { nome: "Teste E-mail", email: `email-teste-${randomBytes(4).toString("hex")}@exemplo.local`, passwordHash: "x", role: "FUNCIONARIO" },
    });
    userId = u.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it("recusa senha errada, sem gravar a caixa", async () => {
    const { plugarCaixa } = await import("../modules/email/caixas.service.js");
    await expect(plugarCaixa(userId, { email: USER!, senha: "senha-errada-de-proposito", nomeExibicao: "Teste" })).rejects.toThrow(/senha|autentic/i);
    expect(await prisma.caixaEmail.count({ where: { userId } })).toBe(0);
  });

  it("pluga com a senha certa e NÃO devolve o segredo", async () => {
    const { plugarCaixa, listarCaixas } = await import("../modules/email/caixas.service.js");
    await plugarCaixa(userId, { email: USER!, senha: PASS!, nomeExibicao: "Caixa de teste" });
    const caixas = await listarCaixas(userId);
    expect(caixas).toHaveLength(1);
    expect(caixas[0].email).toBe(USER);
    expect(caixas[0].estado).toBe("OK");
    expect(JSON.stringify(caixas)).not.toContain("segredo");
  });

  it("não deixa a mesma pessoa plugar o mesmo endereço duas vezes", async () => {
    const { plugarCaixa } = await import("../modules/email/caixas.service.js");
    await expect(plugarCaixa(userId, { email: USER!, senha: PASS!, nomeExibicao: "De novo" })).rejects.toThrow(/já/i);
  });
});
```

- [ ] **Passo 2 — rodar e confirmar que falha**

Antes, garantir no `.env` da raiz (arquivo **não** versionado):
`EMAIL_TESTE_USER=teste@medconsultoria.com.br` e `EMAIL_TESTE_PASS=<a senha da caixa de teste>`.

**E aplicar a migration no banco de teste** (ele é separado — `medconsultoria_test`; o
`migrate dev` do passo anterior só tocou o banco de dev):

```bash
set -a; . ./.env; set +a
DATABASE_URL="${DATABASE_URL}_test" pnpm --filter @app/db exec prisma migrate deploy
```

**Sem as duas variáveis o `describe` é PULADO** — o teste não falha, ele some do placar
(4 skipped). Não confunda "pulou" com "passou".

Rodar: `pnpm --filter @app/api test -- email-caixa`
Esperado: FALHA com "Cannot find module '../modules/email/caixas.service.js'".

- [ ] **Passo 3 — implementar**

`apps/api/src/modules/email/caixas.service.ts`:

```ts
import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import { cifrar } from "../../lib/cripto-caixa.js";
import { descobrirServidor, testarConexao } from "./imap.js";

/** Campos devolvidos ao front. O `segredo` NUNCA entra aqui — nem cifrado. */
const CAMPOS_PUBLICOS = {
  id: true,
  email: true,
  rotulo: true,
  nomeExibicao: true,
  assinatura: true,
  padrao: true,
  ativa: true,
  estado: true,
  ultimoErro: true,
  ultimaSyncEm: true,
  createdAt: true,
} as const;

export async function listarCaixas(userId: string) {
  return prisma.caixaEmail.findMany({
    where: { userId, deletedAt: null },
    select: CAMPOS_PUBLICOS,
    orderBy: [{ padrao: "desc" }, { createdAt: "asc" }],
  });
}

export async function plugarCaixa(
  userId: string,
  e: { email: string; senha: string; nomeExibicao: string; rotulo?: string; importarMeses?: number },
) {
  const email = e.email.trim().toLowerCase();

  const jaTem = await prisma.caixaEmail.findFirst({ where: { userId, email, deletedAt: null }, select: { id: true } });
  if (jaTem) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Você já plugou esta caixa." });
  }

  const servidor = descobrirServidor(email);

  // Testar ANTES de gravar: caixa quebrada no banco falha depois, em silêncio, longe daqui.
  const teste = await testarConexao({
    imapHost: servidor.imapHost,
    imapPorta: servidor.imapPorta,
    usuario: email,
    senha: e.senha,
  });
  if (!teste.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        teste.motivo === "AUTENTICACAO"
          ? "Senha recusada pelo servidor de e-mail. Confira a senha da caixa (é a mesma do webmail)."
          : `Não consegui falar com ${servidor.imapHost}. Detalhe: ${teste.detalhe}`,
    });
  }

  const meses = e.importarMeses ?? 3;
  const desde = new Date();
  desde.setMonth(desde.getMonth() - meses);

  const primeira = (await prisma.caixaEmail.count({ where: { userId, deletedAt: null } })) === 0;

  const criada = await prisma.caixaEmail.create({
    data: {
      userId,
      email,
      rotulo: e.rotulo?.trim() || null,
      nomeExibicao: e.nomeExibicao.trim(),
      usuario: email,
      segredo: cifrar(e.senha),
      imapHost: servidor.imapHost,
      imapPorta: servidor.imapPorta,
      smtpHost: servidor.smtpHost,
      smtpPorta: servidor.smtpPorta,
      importarDesde: desde,
      padrao: primeira,
      estado: "OK",
    },
    select: { id: true },
  });
  return criada;
}

export async function reconectarCaixa(userId: string, caixaId: string, senha: string) {
  const caixa = await prisma.caixaEmail.findFirst({
    where: { id: caixaId, userId, deletedAt: null },
    select: { id: true, email: true, imapHost: true, imapPorta: true, usuario: true },
  });
  if (!caixa) throw new TRPCError({ code: "NOT_FOUND", message: "Caixa não encontrada." });

  const teste = await testarConexao({
    imapHost: caixa.imapHost,
    imapPorta: caixa.imapPorta,
    usuario: caixa.usuario,
    senha,
  });
  if (!teste.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: teste.motivo === "AUTENTICACAO" ? "Senha recusada pelo servidor de e-mail." : `Não consegui conectar: ${teste.detalhe}`,
    });
  }

  await prisma.caixaEmail.update({
    where: { id: caixa.id },
    data: { segredo: cifrar(senha), estado: "OK", ultimoErro: null },
  });
}

/** Soft-delete: some da tela e para de sincronizar. Não apaga nada no servidor de e-mail. */
export async function removerCaixa(userId: string, caixaId: string) {
  const caixa = await prisma.caixaEmail.findFirst({ where: { id: caixaId, userId, deletedAt: null }, select: { id: true } });
  if (!caixa) throw new TRPCError({ code: "NOT_FOUND", message: "Caixa não encontrada." });
  await prisma.caixaEmail.update({ where: { id: caixa.id }, data: { deletedAt: new Date(), ativa: false } });
}
```

- [ ] **Passo 4 — rodar e confirmar que passa**

Rodar: `pnpm --filter @app/api test -- email-caixa`
Esperado: 3 testes PASSAM (contra o servidor real).

- [ ] **Passo 5 — commitar**

```bash
git add apps/api/src/modules/email/caixas.service.ts apps/api/src/test/email-caixa.integration.test.ts
git commit -m "feat(email): plugar/listar/remover/reconectar caixa, com teste de credencial antes de gravar"
```

---

## Tarefa 7 — Descobrir e sincronizar as pastas

**Arquivos**
- Criar: `apps/api/src/modules/email/pastas.service.ts`

**Interfaces**
- Consome: `comCaixa` de `./imap.js`
- Produz: `sincronizarPastas(caixaId: string): Promise<void>` · `listarPastas(userId: string, caixaId: string)`

- [ ] **Passo 1 — implementar**

`apps/api/src/modules/email/pastas.service.ts`:

```ts
import { TRPCError } from "@trpc/server";
import { prisma } from "@app/db";
import type { PastaPapel } from "@app/db";
import { comCaixa } from "./imap.js";

/**
 * Papel da pasta vem do SPECIAL-USE do servidor (verificado: este Dovecot manda `\Inbox`,
 * `\Sent`, `\Drafts`, `\Junk`, `\Trash`). Adivinhar por nome só entra como último recurso,
 * porque o nome muda com o idioma do webmail.
 */
const POR_SPECIAL_USE: Record<string, PastaPapel> = {
  "\\Inbox": "INBOX",
  "\\Sent": "SENT",
  "\\Drafts": "DRAFTS",
  "\\Trash": "TRASH",
  "\\Junk": "JUNK",
  "\\Archive": "ARCHIVE",
};

/** Ordem de exibição: o que se usa mais fica em cima. */
const ORDEM: Record<string, number> = { INBOX: 0, SENT: 1, DRAFTS: 2, ARCHIVE: 3, JUNK: 8, TRASH: 9 };

function rotuloAmigavel(caminho: string, papel: PastaPapel | null): string {
  if (papel === "INBOX") return "Caixa de entrada";
  if (papel === "SENT") return "Enviados";
  if (papel === "DRAFTS") return "Rascunhos";
  if (papel === "TRASH") return "Lixeira";
  if (papel === "JUNK") return "Spam";
  if (papel === "ARCHIVE") return "Arquivados";
  // Separador deste servidor é ponto: "INBOX.clientes" → "clientes".
  return caminho.split(".").pop() ?? caminho;
}

export async function sincronizarPastas(caixaId: string): Promise<void> {
  const doServidor = await comCaixa(caixaId, async (c) => {
    const lista = await c.list();
    return lista.map((p) => ({ caminho: p.path, specialUse: p.specialUse ?? null }));
  });

  // Servidor sem NENHUMA pasta não existe (a INBOX é obrigatória). Lista vazia é sinal de
  // resposta truncada — apagar tudo aqui levaria junto o cache de mensagens de todas as pastas.
  // (Sem esta guarda, o `deleteMany` com `notIn: []` do fim da função limpa a caixa inteira.)
  if (doServidor.length === 0) {
    throw new Error("O servidor não devolveu nenhuma pasta. Tente sincronizar de novo.");
  }

  const vistos: string[] = [];

  for (const p of doServidor) {
    // `(p.specialUse && POR_SPECIAL_USE[p.specialUse]) ?? null` NÃO compila: com
    // `noUncheckedIndexedAccess`, o tipo resultante inclui a string vazia.
    const papel = p.specialUse ? (POR_SPECIAL_USE[p.specialUse] ?? null) : null;
    vistos.push(p.caminho);
    await prisma.caixaPasta.upsert({
      where: { caixaId_caminho: { caixaId, caminho: p.caminho } },
      create: {
        caixaId,
        caminho: p.caminho,
        nome: rotuloAmigavel(p.caminho, papel),
        papel,
        ordem: papel ? (ORDEM[papel] ?? 5) : 5,
      },
      // Nome e papel podem mudar (renomear pasta no webmail). Os ponteiros de sync NÃO se tocam.
      update: { nome: rotuloAmigavel(p.caminho, papel), papel, ordem: papel ? (ORDEM[papel] ?? 5) : 5 },
    });
  }

  // Pasta apagada no webmail some daqui junto com as mensagens dela (cascade).
  await prisma.caixaPasta.deleteMany({ where: { caixaId, caminho: { notIn: vistos } } });
}

export async function listarPastas(userId: string, caixaId: string) {
  const caixa = await prisma.caixaEmail.findFirst({ where: { id: caixaId, userId, deletedAt: null }, select: { id: true } });
  if (!caixa) throw new TRPCError({ code: "NOT_FOUND", message: "Caixa não encontrada." });

  return prisma.caixaPasta.findMany({
    where: { caixaId },
    select: { id: true, caminho: true, nome: true, papel: true, naoLidos: true, total: true },
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
  });
}
```

- [ ] **Passo 2 — acrescentar o teste de integração**

Ao fim do `describe` em `apps/api/src/test/email-caixa.integration.test.ts`:

```ts
  it("descobre as pastas do servidor com os papéis certos", async () => {
    const { sincronizarPastas, listarPastas } = await import("../modules/email/pastas.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });

    await sincronizarPastas(caixa.id);
    const pastas = await listarPastas(userId, caixa.id);

    const papeis = pastas.map((p) => p.papel);
    expect(papeis).toContain("INBOX");
    expect(papeis).toContain("SENT");
    expect(papeis).toContain("TRASH");
    expect(pastas.find((p) => p.papel === "INBOX")!.nome).toBe("Caixa de entrada");
    // A INBOX aparece primeiro (ordem 0).
    expect(pastas[0].papel).toBe("INBOX");
  });
```

- [ ] **Passo 3 — rodar e confirmar que passa**

Rodar: `pnpm --filter @app/api test -- email-caixa`
Esperado: 4 testes PASSAM.

- [ ] **Passo 4 — commitar**

```bash
git add apps/api/src/modules/email/pastas.service.ts apps/api/src/test/email-caixa.integration.test.ts
git commit -m "feat(email): descoberta de pastas por SPECIAL-USE com rótulos em pt-BR"
```

---

## Tarefa 8 — Sincronizar as mensagens de uma pasta

**Arquivos**
- Criar: `apps/api/src/modules/email/sync.service.ts`

**Interfaces**
- Consome: `comCaixa` de `./imap.js`; `extrairEnderecos`, `derivarThreadKey`, `normalizarEndereco` de `./enderecos.js`
- Produz: `sincronizarPasta(caixaId: string, pastaId: string): Promise<{ novas: number; removidas: number }>`

- [ ] **Passo 1 — implementar**

`apps/api/src/modules/email/sync.service.ts`:

```ts
import { prisma } from "@app/db";
import { comCaixa } from "./imap.js";
import { extrairEnderecos, derivarThreadKey } from "./enderecos.js";

/** Uma sincronização por pasta por vez. Expira sozinha: o processo pode morrer segurando a trava. */
const TRAVA_MS = 2 * 60 * 1000;

type ParteAnexo = { nome: string; tipo: string; tamanho: number; parte: string; cid: string | null };

/** Percorre a árvore MIME e junta só o que é anexo de verdade (tem nome de arquivo ou é embutido). */
function coletarAnexos(no: unknown, saida: ParteAnexo[] = []): ParteAnexo[] {
  const n = no as {
    childNodes?: unknown[];
    disposition?: string;
    dispositionParameters?: { filename?: string };
    parameters?: { name?: string };
    part?: string;
    type?: string;
    size?: number;
    id?: string;
  };
  if (!n) return saida;

  if (n.childNodes?.length) {
    for (const filho of n.childNodes) coletarAnexos(filho, saida);
    return saida;
  }

  const nome = n.dispositionParameters?.filename ?? n.parameters?.name;
  const embutido = n.disposition === "inline" && !!n.id;
  if ((n.disposition === "attachment" || embutido) && n.part) {
    saida.push({
      nome: nome ?? "(sem nome)",
      tipo: n.type ?? "application/octet-stream",
      tamanho: n.size ?? 0,
      parte: n.part,
      cid: n.id ? n.id.replace(/^<|>$/g, "") : null,
    });
  }
  return saida;
}

/**
 * Sincroniza UMA pasta. Idempotente e interrompível: avança por UID crescente e só move os
 * ponteiros no fim. Se o processo morrer no meio (o lsnode derruba o Node ocioso), a próxima
 * execução retoma sem duplicar e sem buraco.
 *
 * Usa QRESYNC/CONDSTORE — o servidor informa o que mudou desde o `highestModseq`, inclusive o
 * que foi APAGADO no celular. Verificado: este Dovecot anuncia as duas capacidades.
 */
export async function sincronizarPasta(caixaId: string, pastaId: string): Promise<{ novas: number; removidas: number }> {
  const pasta = await prisma.caixaPasta.findFirstOrThrow({
    where: { id: pastaId, caixaId },
    select: { id: true, caminho: true, uidValidity: true, ultimoUid: true, highestModseq: true, sincronizando: true },
  });

  const agora = Date.now();
  if (pasta.sincronizando && agora - pasta.sincronizando.getTime() < TRAVA_MS) {
    return { novas: 0, removidas: 0 };
  }
  await prisma.caixaPasta.update({ where: { id: pasta.id }, data: { sincronizando: new Date() } });

  const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { id: caixaId }, select: { importarDesde: true } });

  try {
    return await comCaixa(caixaId, async (c) => {
      const lock = await c.getMailboxLock(pasta.caminho);
      let novas = 0;
      let removidas = 0;

      try {
        const mb = c.mailbox as { uidValidity: bigint; uidNext: number; highestModseq?: bigint; exists: number };
        const uidValidityServidor = BigInt(mb.uidValidity);

        // O servidor renumerou a pasta: tudo que está aqui é lixo. Recomeça.
        if (pasta.uidValidity !== 0n && uidValidityServidor !== pasta.uidValidity) {
          const apagadas = await prisma.emailMensagem.deleteMany({ where: { pastaId: pasta.id } });
          removidas += apagadas.count;
          await prisma.caixaPasta.update({
            where: { id: pasta.id },
            data: { uidValidity: uidValidityServidor, ultimoUid: 0, highestModseq: 0 },
          });
          pasta.ultimoUid = 0n;
          pasta.highestModseq = 0n;
        }

        // ── 1. o que mudou (marcações) e o que sumiu, desde a última vez ──
        if (pasta.highestModseq > 0n && pasta.ultimoUid > 0n) {
          // ATENÇÃO: `changedSince` é opção do fetch (3º argumento, `FetchOptions`) — NÃO faz
          // parte do range (1º argumento, `SearchObject`). Pôr lá não compila.
          for await (const m of c.fetch(
            { uid: `1:${pasta.ultimoUid}` },
            { uid: true, flags: true },
            { uid: true, changedSince: pasta.highestModseq },
          )) {
            await prisma.emailMensagem.updateMany({
              where: { pastaId: pasta.id, uid: BigInt(m.uid) },
              data: {
                lido: m.flags?.has("\\Seen") ?? false,
                respondido: m.flags?.has("\\Answered") ?? false,
              },
            });
          }

          // Apagado no celular some daqui: o servidor é a fonte da verdade.
          const aindaNoServidor = await c.search({ uid: `1:${pasta.ultimoUid}` }, { uid: true });
          const vivos = new Set((aindaNoServidor || []).map(String));
          const locais = await prisma.emailMensagem.findMany({
            where: { pastaId: pasta.id, uid: { lte: pasta.ultimoUid } },
            select: { id: true, uid: true },
          });
          const sumiram = locais.filter((l) => !vivos.has(String(l.uid))).map((l) => l.id);
          if (sumiram.length) {
            const r = await prisma.emailMensagem.deleteMany({ where: { id: { in: sumiram } } });
            removidas += r.count;
          }
          void conhecidos;
        }

        // ── 2. as novas ──
        if (mb.exists > 0 && mb.uidNext > Number(pasta.ultimoUid) + 1) {
          for await (const m of c.fetch(
            { uid: `${pasta.ultimoUid + 1n}:*` },
            { uid: true, flags: true, envelope: true, bodyStructure: true, size: true },
            { uid: true },
          )) {
            const env = m.envelope;
            if (!env) continue;

            const dataEm = env.date ?? new Date();
            // Primeira sincronização tem janela: caixa antiga não pode virar espera de 40 minutos.
            if (caixa.importarDesde && dataEm < caixa.importarDesde) continue;

            const de = env.from?.[0];
            const enderecos = extrairEnderecos(env);
            const anexos = coletarAnexos(m.bodyStructure);
            // `env.references` NÃO EXISTE: o ENVELOPE do IMAP não traz o References. É preciso
            // pedir a linha no fetch (`headers: ["references"]`) e lê-la de `m.headers` (Buffer),
            // desdobrando as continuações. Ver `lerReferences` no arquivo implementado.
            const referencias = lerReferences(m.headers);

            await prisma.emailMensagem.upsert({
              where: { pastaId_uid: { pastaId: pasta.id, uid: BigInt(m.uid) } },
              update: { lido: m.flags?.has("\\Seen") ?? false },
              create: {
                caixaId,
                pastaId: pasta.id,
                uid: BigInt(m.uid),
                messageId: env.messageId?.slice(0, 512) ?? null,
                inReplyTo: env.inReplyTo?.slice(0, 512) ?? null,
                referencias,
                threadKey: derivarThreadKey({
                  messageId: env.messageId,
                  inReplyTo: env.inReplyTo,
                  referencias,
                })?.slice(0, 512),
                deNome: de?.name?.trim() || null,
                deEmail: (de?.address ?? "").toLowerCase(),
                assunto: env.subject ?? null,
                dataEm,
                lido: m.flags?.has("\\Seen") ?? false,
                respondido: m.flags?.has("\\Answered") ?? false,
                temAnexo: anexos.length > 0,
                tamanho: m.size ?? null,
                enderecos: { create: enderecos },
                anexos: { create: anexos },
              },
            });
            novas += 1;
          }
        }

        // ── 3. ponteiros e contadores, SÓ no fim ──
        const status = await c.status(pasta.caminho, { messages: true, unseen: true });
        await prisma.caixaPasta.update({
          where: { id: pasta.id },
          data: {
            uidValidity: uidValidityServidor,
            ultimoUid: BigInt(Math.max(Number(pasta.ultimoUid), mb.uidNext - 1)),
            highestModseq: mb.highestModseq ? BigInt(mb.highestModseq) : pasta.highestModseq,
            total: status.messages ?? 0,
            naoLidos: status.unseen ?? 0,
          },
        });
      } finally {
        lock.release();
      }

      await prisma.caixaEmail.update({
        where: { id: caixaId },
        data: { ultimaSyncEm: new Date(), estado: "OK", ultimoErro: null },
      });
      return { novas, removidas };
    });
  } finally {
    await prisma.caixaPasta.update({ where: { id: pasta.id }, data: { sincronizando: null } }).catch(() => {});
  }
}
```

- [ ] **Passo 2 — acrescentar o teste de integração**

Ao fim do `describe` em `apps/api/src/test/email-caixa.integration.test.ts`:

```ts
  it("sincroniza a INBOX e indexa uma mensagem que acabou de chegar", async () => {
    const { ImapFlow } = await import("imapflow");
    const { sincronizarPasta } = await import("../modules/email/sync.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });
    const inbox = await prisma.caixaPasta.findFirstOrThrow({ where: { caixaId: caixa.id, papel: "INBOX" } });

    const marca = `sync-${Date.now()}`;
    const c = new ImapFlow({ host: "mail.medconsultoria.com.br", port: 993, secure: true, auth: { user: USER!, pass: PASS! }, logger: false });
    await c.connect();
    await c.append(
      "INBOX",
      Buffer.from(
        [`From: Cliente Teste <cliente@exemplo.com>`, `To: ${USER}`, `Subject: ${marca}`, `Message-ID: <${marca}@exemplo.com>`, "Content-Type: text/plain; charset=utf-8", "", "corpo"].join("\r\n"),
        "utf8",
      ),
    );
    await c.logout();

    const r = await sincronizarPasta(caixa.id, inbox.id);
    expect(r.novas).toBeGreaterThanOrEqual(1);

    const msg = await prisma.emailMensagem.findFirst({
      where: { pastaId: inbox.id, assunto: marca },
      include: { enderecos: true },
    });
    expect(msg).toBeTruthy();
    expect(msg!.deEmail).toBe("cliente@exemplo.com");
    expect(msg!.corpoHtml).toBeNull(); // índice não baixa corpo — é o ponto da opção "C"
    expect(msg!.enderecos.map((e) => e.papel)).toContain("DE");
    expect(msg!.enderecos.map((e) => e.endereco)).toContain("cliente@exemplo.com");
  });
```

- [ ] **Passo 3 — rodar e confirmar que passa**

Rodar: `pnpm --filter @app/api test -- email-caixa`
Esperado: 5 testes PASSAM. Em especial `corpoHtml` **nulo** — prova de que o índice não baixa corpo.

- [ ] **Passo 4 — commitar**

```bash
git add apps/api/src/modules/email/sync.service.ts apps/api/src/test/email-caixa.integration.test.ts
git commit -m "feat(email): sincronização de mensagens por UID com QRESYNC, interrompível"
```

---

## Tarefa 9 — Listar e abrir mensagem

**Arquivos**
- Criar: `apps/api/src/modules/email/leitura.service.ts`

**Interfaces**
- Consome: `comCaixa` de `./imap.js`; `sanitizarEmailHtml` de `../../lib/sanitizar-html.js`
- Produz:
  - `listarMensagens(userId, e: { pastaId: string; busca?: string; limite?: number; antesDe?: Date })`
  - `abrirMensagem(userId: string, mensagemId: string)`

- [ ] **Passo 1 — implementar**

`apps/api/src/modules/email/leitura.service.ts`:

```ts
import { TRPCError } from "@trpc/server";
import { simpleParser } from "mailparser";
import { prisma } from "@app/db";
import { comCaixa } from "./imap.js";
import { sanitizarEmailHtml } from "../../lib/sanitizar-html.js";

/** Teto de UIDs vindos da busca do servidor: um `IN (...)` com milhares de valores derruba a query. */
const MAX_UIDS_BUSCA = 500;

/** Garante que a pasta é de uma caixa DESTE usuário. Base da privacidade — sempre chamar. */
async function pastaDoUsuario(userId: string, pastaId: string) {
  const pasta = await prisma.caixaPasta.findFirst({
    where: { id: pastaId, caixa: { userId, deletedAt: null } },
    select: { id: true, caixaId: true, caminho: true },
  });
  if (!pasta) throw new TRPCError({ code: "NOT_FOUND", message: "Pasta não encontrada." });
  return pasta;
}

export async function listarMensagens(
  userId: string,
  e: { pastaId: string; busca?: string; limite?: number; antesDe?: Date },
) {
  const pasta = await pastaDoUsuario(userId, e.pastaId);
  const limite = Math.min(e.limite ?? 50, 200);
  const busca = e.busca?.trim();

  // Busca vai ao SERVIDOR (ESEARCH): cobre remetente, assunto E o corpo — sem espelhar corpo
  // nenhum. É o que remove a única desvantagem real da opção "C" do desenho.
  let uidsDaBusca: bigint[] | null = null;
  if (busca) {
    const achados = await comCaixa(pasta.caixaId, async (c) => {
      const lock = await c.getMailboxLock(pasta.caminho);
      try {
        return (await c.search({ or: [{ body: busca }, { subject: busca }, { from: busca }] }, { uid: true })) || [];
      } finally {
        lock.release();
      }
    });
    // Só os mais recentes: UID maior = chegou depois na pasta, então cortar por UID decrescente
    // é a mesma ordem que a tela mostra (data decrescente).
    uidsDaBusca = achados
      .sort((a, b) => b - a)
      .slice(0, MAX_UIDS_BUSCA)
      .map((u) => BigInt(u));
    if (uidsDaBusca.length === 0) return [];
  }

  return prisma.emailMensagem.findMany({
    where: {
      pastaId: pasta.id,
      ...(uidsDaBusca ? { uid: { in: uidsDaBusca } } : {}),
      ...(e.antesDe ? { dataEm: { lt: e.antesDe } } : {}),
    },
    select: {
      id: true,
      deNome: true,
      deEmail: true,
      assunto: true,
      trecho: true,
      dataEm: true,
      lido: true,
      temAnexo: true,
      threadKey: true,
    },
    orderBy: { dataEm: "desc" },
    take: limite,
  });
}

export async function abrirMensagem(userId: string, mensagemId: string) {
  const msg = await prisma.emailMensagem.findFirst({
    where: { id: mensagemId, pasta: { caixa: { userId, deletedAt: null } } },
    include: {
      enderecos: { select: { papel: true, nome: true, endereco: true } },
      anexos: { select: { id: true, nome: true, tipo: true, tamanho: true } },
      pasta: { select: { id: true, caminho: true, caixaId: true } },
    },
  });
  if (!msg) throw new TRPCError({ code: "NOT_FOUND", message: "Mensagem não encontrada." });

  let corpoHtml = msg.corpoHtml;
  let corpoTexto = msg.corpoTexto;
  let imagensBloqueadas = 0;

  // Cache frio: busca o corpo AGORA. É o "sob demanda" da opção "C". Quem responde se já
  // buscamos é o `corpoEm` — não os corpos: mensagem vazia (ou só com script/imagem remota,
  // que a higienização descarta) deixaria os dois nulos e voltaria ao IMAP a cada abertura.
  if (msg.corpoEm === null) {
    const bruto = await comCaixa(msg.pasta.caixaId, async (c) => {
      const lock = await c.getMailboxLock(msg.pasta.caminho);
      try {
        const r = await c.download(String(msg.uid), undefined, { uid: true });
        if (!r?.content) return null;
        const pedacos: Buffer[] = [];
        for await (const p of r.content) pedacos.push(p as Buffer);
        return Buffer.concat(pedacos);
      } finally {
        lock.release();
      }
    });

    if (bruto) {
      const parsed = await simpleParser(bruto);
      const limpo = sanitizarEmailHtml(parsed.html || "");
      corpoHtml = limpo.html || null;
      imagensBloqueadas = limpo.imagensRemotasBloqueadas;
      corpoTexto = parsed.text ?? null;
      // A prévia da lista só existe a partir daqui: o índice não baixa corpo (opção "C").
      const trecho = corpoTexto?.replace(/\s+/g, " ").trim().slice(0, 200) || null;

      await prisma.emailMensagem.update({
        where: { id: msg.id },
        data: { corpoHtml, corpoTexto, trecho, corpoEm: new Date() },
      });
    }
  } else if (corpoHtml) {
    imagensBloqueadas = (corpoHtml.match(/data-src-bloqueada=/g) ?? []).length;
  }

  // Marcar lido no SERVIDOR (e não só aqui) — senão o celular continua mostrando não lido.
  if (!msg.lido) {
    await comCaixa(msg.pasta.caixaId, async (c) => {
      const lock = await c.getMailboxLock(msg.pasta.caminho);
      try {
        await c.messageFlagsAdd(String(msg.uid), ["\\Seen"], { uid: true });
      } finally {
        lock.release();
      }
    }).catch(() => {
      /* marcar lido é secundário: falhar aqui não pode impedir a leitura */
    });
    await prisma.emailMensagem.update({ where: { id: msg.id }, data: { lido: true } });
  }

  return {
    id: msg.id,
    assunto: msg.assunto,
    deNome: msg.deNome,
    deEmail: msg.deEmail,
    dataEm: msg.dataEm,
    enderecos: msg.enderecos,
    anexos: msg.anexos,
    corpoHtml,
    corpoTexto,
    imagensBloqueadas,
  };
}
```

- [ ] **Passo 2 — acrescentar o teste de integração**

Ao fim do `describe` em `apps/api/src/test/email-caixa.integration.test.ts`:

```ts
  it("abre a mensagem, higieniza o corpo e guarda em cache", async () => {
    const { ImapFlow } = await import("imapflow");
    const { sincronizarPasta } = await import("../modules/email/sync.service.js");
    const { abrirMensagem } = await import("../modules/email/leitura.service.js");
    const caixa = await prisma.caixaEmail.findFirstOrThrow({ where: { userId }, select: { id: true } });
    const inbox = await prisma.caixaPasta.findFirstOrThrow({ where: { caixaId: caixa.id, papel: "INBOX" } });

    const marca = `corpo-${Date.now()}`;
    const c = new ImapFlow({ host: "mail.medconsultoria.com.br", port: 993, secure: true, auth: { user: USER!, pass: PASS! }, logger: false });
    await c.connect();
    await c.append(
      "INBOX",
      Buffer.from(
        [`From: Hostil <mau@exemplo.com>`, `To: ${USER}`, `Subject: ${marca}`, "Content-Type: text/html; charset=utf-8", "", '<p>ola</p><script>alert(1)</script><img src="https://rastreio/p.gif">'].join("\r\n"),
        "utf8",
      ),
    );
    await c.logout();

    await sincronizarPasta(caixa.id, inbox.id);
    const msg = await prisma.emailMensagem.findFirstOrThrow({ where: { pastaId: inbox.id, assunto: marca } });

    const aberta = await abrirMensagem(userId, msg.id);
    expect(aberta.corpoHtml).toContain("ola");
    expect(aberta.corpoHtml!.toLowerCase()).not.toContain("script");
    expect(aberta.imagensBloqueadas).toBe(1);

    const depois = await prisma.emailMensagem.findFirstOrThrow({ where: { id: msg.id } });
    expect(depois.corpoEm).not.toBeNull(); // cache preenchido
    expect(depois.lido).toBe(true);
    expect(depois.trecho).toContain("ola"); // prévia da lista nasce aqui, não no índice
  });
```

- [ ] **Passo 3 — rodar e confirmar que passa**

Rodar: `pnpm --filter @app/api test -- email-caixa`
Esperado: 6 testes PASSAM.

- [ ] **Passo 4 — commitar**

```bash
git add apps/api/src/modules/email/leitura.service.ts apps/api/src/test/email-caixa.integration.test.ts
git commit -m "feat(email): listar com busca no servidor e abrir mensagem com corpo sob demanda"
```

---

## Tarefa 10 — Router tRPC do módulo

**Arquivos**
- Criar: `packages/shared/src/schemas/email.ts` · `apps/api/src/modules/email/email.router.ts`
- Modificar: `packages/shared/src/index.ts` · `apps/api/src/trpc/router.ts`

**Interfaces**
- Produz: `plugarCaixaSchema` / `PlugarCaixaInput`; `emailRouter`, plugado no `appRouter` como
  `email`. Procedures: `caixas` · `plugarCaixa` · `reconectarCaixa` · `removerCaixa` · `pastas` ·
  `sincronizar` · `mensagens` · `abrir`

- [ ] **Passo 0 — schema compartilhado do input**

O input do `plugarCaixa` é o MESMO do formulário da Tarefa 11 — a convenção do projeto é um
schema Zod único em `packages/shared` (não repetir o objeto inline no router).

`packages/shared/src/schemas/email.ts`:

```ts
import { z } from "zod";

/** Plugar uma caixa. O MESMO schema valida o formulário no front e a procedure no back. */
export const plugarCaixaSchema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  senha: z.string().min(1, "Informe a senha da caixa"),
  nomeExibicao: z.string().min(1, "Informe o nome que aparece para quem recebe"),
  rotulo: z.string().optional(),
  importarMeses: z.coerce.number().int().min(1).max(60).default(3),
});
export type PlugarCaixaInput = z.infer<typeof plugarCaixaSchema>;
```

Em `packages/shared/src/index.ts`, junto dos outros reexports:

```ts
export * from "./schemas/email.js";
```

- [ ] **Passo 1 — implementar o router**

`apps/api/src/modules/email/email.router.ts`:

```ts
import { z } from "zod";
import { plugarCaixaSchema } from "@app/shared";
import { router, funcionarioProcedure } from "../../trpc/trpc.js";
import * as caixas from "./caixas.service.js";
import * as pastas from "./pastas.service.js";
import * as sync from "./sync.service.js";
import * as leitura from "./leitura.service.js";

/**
 * E-mail dentro da aplicação. TODO procedure é `funcionarioProcedure` (equipe; o Portal do
 * Cliente não entra) e TODA consulta filtra pelo dono da caixa: ninguém vê caixa de ninguém.
 */
export const emailRouter = router({
  caixas: funcionarioProcedure.query(({ ctx }) => caixas.listarCaixas(ctx.user.id)),

  plugarCaixa: funcionarioProcedure
    .input(plugarCaixaSchema)
    .mutation(({ ctx, input }) => caixas.plugarCaixa(ctx.user.id, input)),

  reconectarCaixa: funcionarioProcedure
    .input(z.object({ caixaId: z.string().min(1), senha: z.string().min(1) }))
    .mutation(({ ctx, input }) => caixas.reconectarCaixa(ctx.user.id, input.caixaId, input.senha)),

  removerCaixa: funcionarioProcedure
    .input(z.object({ caixaId: z.string().min(1) }))
    .mutation(({ ctx, input }) => caixas.removerCaixa(ctx.user.id, input.caixaId)),

  pastas: funcionarioProcedure
    .input(z.object({ caixaId: z.string().min(1) }))
    .query(({ ctx, input }) => pastas.listarPastas(ctx.user.id, input.caixaId)),

  /** Chamado ao abrir a página e pelo polling. Devolve o que mudou para o front decidir avisar. */
  sincronizar: funcionarioProcedure
    .input(z.object({ caixaId: z.string().min(1), pastaId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // A checagem de posse acontece aqui, antes de tocar no IMAP: `listarPastas` estoura
      // NOT_FOUND se a caixa não for desta pessoa.
      await pastas.listarPastas(ctx.user.id, input.caixaId);
      await sync.sincronizarPasta(input.caixaId, input.pastaId);
      return { ok: true };
    }),

  mensagens: funcionarioProcedure
    .input(
      z.object({
        pastaId: z.string().min(1),
        busca: z.string().optional(),
        limite: z.number().int().min(1).max(200).optional(),
        antesDe: z.date().optional(),
      }),
    )
    .query(({ ctx, input }) => leitura.listarMensagens(ctx.user.id, input)),

  abrir: funcionarioProcedure
    .input(z.object({ mensagemId: z.string().min(1) }))
    .query(({ ctx, input }) => leitura.abrirMensagem(ctx.user.id, input.mensagemId)),
});
```

- [ ] **Passo 2 — plugar no router raiz**

Em `apps/api/src/trpc/router.ts`, junto dos outros imports:

```ts
import { emailRouter } from "../modules/email/email.router.js";
```

E dentro do `router({...})`, depois de `emailsEnviados: emailsEnviadosRouter,`:

```ts
  email: emailRouter,
```

- [ ] **Passo 3 — conferir que compila dos dois lados**

Rodar: `pnpm typecheck`
Esperado: sem erro (o tipo `AppRouter` propaga para o front).

- [ ] **Passo 4 — commitar**

```bash
git add apps/api/src/modules/email/email.router.ts apps/api/src/trpc/router.ts
git commit -m "feat(email): router tRPC do módulo e registro no appRouter"
```

---

## Tarefa 11 — Diálogo "Adicionar caixa"

**Arquivos**
- Criar: `apps/web/src/features/email/AdicionarCaixaDialog.tsx`

**Interfaces**
- Consome: `trpc.email.plugarCaixa` + `plugarCaixaSchema`/`PlugarCaixaInput` (Tarefa 10)
- Produz: `<AdicionarCaixaDialog open onClose />`

- [ ] **Passo 1 — schema compartilhado: JÁ FEITO na Tarefa 10 (Passo 0)**

O `plugarCaixaSchema` é a fonte única de verdade do formulário e da procedure — foi criado
junto do router para não existir a mesma validação escrita duas vezes. Nada a fazer aqui.

- [ ] **Passo 2 — o diálogo**

`apps/web/src/features/email/AdicionarCaixaDialog.tsx`:

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { plugarCaixaSchema, type PlugarCaixaInput } from "@app/shared";
import { trpc } from "../../lib/trpc";
import { sincronizarAutofill } from "../../lib/form-autofill";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { toast } from "../../components/ui/toast";

export function AdicionarCaixaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<PlugarCaixaInput>({
    resolver: zodResolver(plugarCaixaSchema),
    defaultValues: { importarMeses: 3 },
  });

  const plugar = trpc.email.plugarCaixa.useMutation({
    onSuccess: () => {
      utils.email.caixas.invalidate();
      toast("Caixa conectada.", "success");
      reset();
      onClose();
    },
    // A mensagem vem pronta do servidor e distingue senha errada de servidor fora do ar.
    onError: (e) => toast(e.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar caixa de e-mail"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="caixa-form" disabled={plugar.isPending}>
            {plugar.isPending ? "Testando conexão…" : "Conectar"}
          </Button>
        </>
      }
    >
      <form
        id="caixa-form"
        onSubmit={(e) => {
          // O autofill do Chrome escreve no DOM sem disparar o evento que o react-hook-form
          // escuta — e este formulário é e-mail + senha, o alvo preferido do autofill. Sem
          // isto, "Conectar" manda o que o React lembrava (vazio) em vez do que está na tela.
          sincronizarAutofill(e, setValue, ["email", "senha", "nomeExibicao"]);
          void handleSubmit((v) => plugar.mutate(v))(e);
        }}
        className="space-y-3"
        noValidate
      >
        <div className="space-y-1">
          <Label htmlFor="cx-email" hint="O endereço completo, igual ao que você usa no webmail.">
            E-mail *
          </Label>
          <Input id="cx-email" type="email" autoComplete="off" placeholder="voce@medconsultoria.com.br" {...register("email")} />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="cx-senha" hint="É a mesma senha que você usa para entrar no webmail. Ela fica guardada cifrada e nunca aparece em tela.">
            Senha da caixa *
          </Label>
          <Input id="cx-senha" type="password" autoComplete="new-password" {...register("senha")} />
          {errors.senha && <p className="text-xs text-destructive">{errors.senha.message}</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="cx-nome" hint="Nome que aparece para quem recebe seus e-mails.">
              Seu nome *
            </Label>
            <Input id="cx-nome" placeholder="André Cintra" {...register("nomeExibicao")} />
            {errors.nomeExibicao && <p className="text-xs text-destructive">{errors.nomeExibicao.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="cx-rotulo" hint="Apelido para distinguir suas caixas na lista.">
              Apelido
            </Label>
            <Input id="cx-rotulo" placeholder="(opcional) Contato" {...register("rotulo")} />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="cx-meses" hint="Quanto tempo para trás trazer na primeira sincronização. Quanto maior, mais demora a primeira vez.">
            Trazer os últimos (meses)
          </Label>
          <Input id="cx-meses" type="number" min={1} max={60} {...register("importarMeses")} />
        </div>

        <p className="rounded-lg border bg-muted/30 p-2.5 text-xs text-muted-foreground">
          Só você enxerga esta caixa. A senha é guardada cifrada e serve apenas para a aplicação
          buscar e enviar seus e-mails. Para cortar o acesso, troque a senha da caixa no painel da
          hospedagem.
        </p>
      </form>
    </Modal>
  );
}
```

- [ ] **Passo 3 — conferir que compila**

Rodar: `pnpm typecheck`
Esperado: sem erro.

- [ ] **Passo 4 — commitar**

```bash
git add packages/shared/src/schemas/email.ts packages/shared/src/index.ts apps/web/src/features/email/AdicionarCaixaDialog.tsx
git commit -m "feat(email): diálogo de adicionar caixa com teste de conexão antes de salvar"
```

---

## Tarefa 12 — Página `/email`

**Arquivos**
- Criar: `apps/web/src/features/email/EmailPage.tsx`
- Criar: `apps/web/src/features/email/CorpoEmail.tsx`
- Modificar: `apps/web/src/lib/socket.ts` (chaves de polling) e `apps/web/src/lib/socket.test.ts`
- Modificar: `apps/web/src/app/router.tsx`
- Modificar: `apps/web/src/lib/paginas.ts`
- Modificar: `apps/web/src/components/GuiaTour.tsx` (guia "?" da página)
- Modificar: `apps/web/src/components/layout/AppLayout.tsx:374`

**Interfaces**
- Consome: `trpc.email.caixas` · `trpc.email.pastas` · `trpc.email.sincronizar` ·
  `trpc.email.mensagens` · `trpc.email.abrir` (Tarefa 10); `<AdicionarCaixaDialog>` (Tarefa 11)
- Produz: `EmailPage` (export nomeado, exigido pelo `lazyRouteComponent`)

- [ ] **Passo 1 — chaves de polling**

Em `apps/web/src/lib/socket.ts`, dentro do objeto `POLL` já existente, acrescentar:

```ts
  /** Lista de e-mails com a página aberta. O IMAP não empurra (sem IDLE) — ver ADR-84. */
  emailLista: 30_000,
  /** Pastas: contador de não lidos. Muda devagar. */
  emailPastas: 60_000,
```

O teste `socket.test.ts` guarda isso — mas por uma lista FIXA de arquivos. A página nova não
entra sozinha; acrescentar em `CONSUMIDORES`:

```ts
  // O IMAP desta hospedagem não faz IDLE: sem polling, e-mail novo só apareceria ao recarregar.
  "features/email/EmailPage.tsx",
```

- [ ] **Passo 2 — o corpo isolado (camadas 2 e 3 da defesa)**

`apps/web/src/features/email/CorpoEmail.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";

/**
 * Camadas 2 e 3 da defesa contra HTML hostil (a 1 é a higienização no servidor):
 *  - `sandbox` SEM `allow-scripts` e SEM `allow-same-origin` → mesmo que algo escape da camada 1,
 *    não alcança a sessão da aplicação.
 *  - imagem remota fica bloqueada até a pessoa pedir (o pixel invisível é como quem manda spam
 *    confirma que o endereço existe e foi lido).
 * NUNCA usar `dangerouslySetInnerHTML` aqui.
 */
export function CorpoEmail({
  html,
  texto,
  imagensBloqueadas,
}: {
  html: string | null;
  texto: string | null;
  imagensBloqueadas: number;
}) {
  const [mostrarImagens, setMostrarImagens] = useState(false);

  const documento = useMemo(() => {
    if (!html) return null;
    const corpo = mostrarImagens ? html.replace(/data-src-bloqueada=/g, "src=") : html;
    return `<!doctype html><meta charset="utf-8"><base target="_blank">
<style>body{margin:0;padding:12px;font:14px/1.5 Montserrat,system-ui,sans-serif;color:#111;word-break:break-word}img{max-width:100%;height:auto}table{max-width:100%}</style>
${corpo}`;
  }, [html, mostrarImagens]);

  if (!documento) {
    return <pre className="whitespace-pre-wrap p-3 text-sm">{texto ?? "(sem conteúdo)"}</pre>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {imagensBloqueadas > 0 && !mostrarImagens && (
        <div className="flex items-center justify-between gap-3 border-b bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span>
            {imagensBloqueadas === 1 ? "1 imagem foi bloqueada" : `${imagensBloqueadas} imagens foram bloqueadas`} para
            que o remetente não saiba que você abriu.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => setMostrarImagens(true)}>
            Mostrar imagens
          </Button>
        </div>
      )}
      <iframe
        title="Conteúdo do e-mail"
        sandbox=""
        srcDoc={documento}
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
```

- [ ] **Passo 3 — a página**

`apps/web/src/features/email/EmailPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Mail, Plus, Search, X, AlertTriangle, Paperclip } from "lucide-react";
import { cn } from "@app/ui";
import { trpc } from "../../lib/trpc";
import { POLL } from "../../lib/socket";
import { data, hora } from "../../lib/format-date";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Avatar } from "../../components/ui/avatar";
import { AdicionarCaixaDialog } from "./AdicionarCaixaDialog";
import { CorpoEmail } from "./CorpoEmail";

export function EmailPage() {
  const utils = trpc.useUtils();
  const [adicionando, setAdicionando] = useState(false);
  const [caixaId, setCaixaId] = useState<string | null>(null);
  const [pastaId, setPastaId] = useState<string | null>(null);
  const [msgId, setMsgId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");

  // Divisor arrastável, no mesmo padrão das Mensagens (ADR-83).
  const [larguraLista, setLarguraLista] = useState(() => {
    const v = Number(localStorage.getItem("email:larguraLista"));
    return v >= 280 && v <= 620 ? v : 380;
  });
  useEffect(() => {
    localStorage.setItem("email:larguraLista", String(larguraLista));
  }, [larguraLista]);
  const iniciarRedimensionar = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = larguraLista;
    const mover = (ev: PointerEvent) => setLarguraLista(Math.min(620, Math.max(280, w0 + (ev.clientX - x0))));
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };

  const caixas = trpc.email.caixas.useQuery();
  const caixaAtual = useMemo(
    () => caixas.data?.find((c) => c.id === caixaId) ?? caixas.data?.[0] ?? null,
    [caixas.data, caixaId],
  );

  const pastas = trpc.email.pastas.useQuery(
    { caixaId: caixaAtual?.id ?? "" },
    { enabled: !!caixaAtual, refetchInterval: POLL.emailPastas },
  );
  const pastaAtual = useMemo(
    () => pastas.data?.find((p) => p.id === pastaId) ?? pastas.data?.find((p) => p.papel === "INBOX") ?? null,
    [pastas.data, pastaId],
  );

  const sincronizar = trpc.email.sincronizar.useMutation({
    onSuccess: () => {
      utils.email.mensagens.invalidate();
      utils.email.pastas.invalidate();
    },
  });

  // Sincroniza ao abrir a pasta: com a tela aberta, o e-mail chega quase na hora.
  useEffect(() => {
    if (caixaAtual && pastaAtual) sincronizar.mutate({ caixaId: caixaAtual.id, pastaId: pastaAtual.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caixaAtual?.id, pastaAtual?.id]);

  const mensagens = trpc.email.mensagens.useQuery(
    { pastaId: pastaAtual?.id ?? "", busca: buscaAtiva || undefined },
    { enabled: !!pastaAtual, refetchInterval: POLL.emailLista },
  );

  const aberta = trpc.email.abrir.useQuery({ mensagemId: msgId ?? "" }, { enabled: !!msgId });

  // Abrir marca a mensagem como lida no servidor. Sem avisar a lista e o contador de não lidos,
  // o e-mail continuaria em negrito até o próximo polling.
  useEffect(() => {
    if (!aberta.data) return;
    utils.email.mensagens.invalidate();
    utils.email.pastas.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta.data?.id]);

  if (caixas.isLoading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;

  // Nenhuma caixa plugada: a página inteira é o convite para plugar a primeira.
  if (!caixas.data?.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Mail className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold text-primary">Seu e-mail, aqui dentro</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Conecte a sua caixa <strong>@medconsultoria.com.br</strong> para ler e responder sem sair
          do Workspace. Só você enxerga a sua caixa.
        </p>
        <Button onClick={() => setAdicionando(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Adicionar caixa
        </Button>
        <AdicionarCaixaDialog open={adicionando} onClose={() => setAdicionando(false)} />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* ── coluna 1: caixas e pastas ── */}
      <aside className="hidden w-56 shrink-0 flex-col border-r md:flex">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <h1 className="text-sm font-semibold text-primary">E-mail</h1>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdicionando(true)} aria-label="Adicionar caixa">
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {caixas.data.map((c) => (
            <div key={c.id} className="mb-3">
              <button
                type="button"
                onClick={() => {
                  setCaixaId(c.id);
                  setPastaId(null);
                  setMsgId(null);
                }}
                className={cn(
                  "w-full truncate rounded-lg px-2 py-1.5 text-left text-xs font-semibold",
                  c.id === caixaAtual?.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
                title={c.email}
              >
                {c.rotulo || c.email}
              </button>

              {c.estado === "AUTENTICACAO_FALHOU" && (
                <p className="mt-1 flex items-start gap-1 px-2 text-[11px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  Precisa reconectar: a senha foi recusada.
                </p>
              )}

              {c.id === caixaAtual?.id &&
                pastas.data?.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPastaId(p.id);
                      setMsgId(null);
                    }}
                    className={cn(
                      "mt-0.5 flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                      p.id === pastaAtual?.id ? "bg-muted font-medium" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="truncate">{p.nome}</span>
                    {p.naoLidos > 0 && (
                      <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{p.naoLidos}</span>
                    )}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </aside>

      {/* ── coluna 2: lista ── */}
      <div
        style={{ ["--lista-w" as string]: `${larguraLista}px` }}
        className={cn("w-full shrink-0 flex-col border-r md:flex md:w-[var(--lista-w)]", msgId ? "hidden md:flex" : "flex")}
      >
        <div className="flex items-center gap-2 border-b p-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setBuscaAtiva(busca)}
              placeholder="Buscar (remetente, assunto ou texto)"
              className="pl-8"
            />
          </div>
          {(busca || buscaAtiva) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setBusca("");
                setBuscaAtiva("");
              }}
            >
              <X className="mr-1 h-3.5 w-3.5" /> Limpar
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {mensagens.isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando…</p>}
          {mensagens.data?.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              {buscaAtiva ? "Nenhum e-mail encontrado para esta busca." : "Nenhum e-mail nesta pasta."}
            </p>
          )}
          {mensagens.data?.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMsgId(m.id)}
              className={cn(
                "flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left hover:bg-muted/50",
                m.id === msgId && "bg-muted",
              )}
            >
              <Avatar nome={m.deNome || m.deEmail} className="mt-0.5 h-8 w-8 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn("truncate text-sm", !m.lido && "font-semibold")}>{m.deNome || m.deEmail}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{data(m.dataEm)}</span>
                </div>
                <p className={cn("truncate text-sm", !m.lido ? "font-medium" : "text-muted-foreground")}>
                  {m.assunto || "(sem assunto)"}
                </p>
                {m.trecho && <p className="truncate text-xs text-muted-foreground">{m.trecho}</p>}
              </div>
              {m.temAnexo && <Paperclip className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </button>
          ))}
        </div>
      </div>

      {/* divisor arrastável */}
      <div
        onPointerDown={iniciarRedimensionar}
        className="hidden w-1 cursor-col-resize bg-border transition-colors hover:bg-primary/40 md:block"
        role="separator"
        aria-orientation="vertical"
        aria-label="Ajustar largura da lista"
      />

      {/* ── coluna 3: mensagem aberta ── */}
      <section className={cn("min-w-0 flex-1 flex-col", msgId ? "flex" : "hidden md:flex")}>
        {!msgId && <p className="m-auto text-sm text-muted-foreground">Escolha um e-mail para ler.</p>}

        {msgId && aberta.isLoading && <p className="p-4 text-sm text-muted-foreground">Abrindo…</p>}

        {msgId && aberta.data && (
          <>
            <header className="shrink-0 border-b p-4">
              <Button type="button" variant="ghost" size="sm" className="mb-2 md:hidden" onClick={() => setMsgId(null)}>
                Voltar
              </Button>
              <h2 className="text-base font-semibold">{aberta.data.assunto || "(sem assunto)"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{aberta.data.deNome || aberta.data.deEmail}</span>{" "}
                &lt;{aberta.data.deEmail}&gt; · {data(aberta.data.dataEm)} às {hora(aberta.data.dataEm)}
              </p>
              {aberta.data.anexos.length > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Paperclip className="h-3.5 w-3.5" />
                  {aberta.data.anexos.map((a) => (
                    <span key={a.id} className="rounded border px-1.5 py-0.5">
                      {a.nome}
                    </span>
                  ))}
                </p>
              )}
            </header>

            <CorpoEmail
              html={aberta.data.corpoHtml}
              texto={aberta.data.corpoTexto}
              imagensBloqueadas={aberta.data.imagensBloqueadas}
            />
          </>
        )}
      </section>

      <AdicionarCaixaDialog open={adicionando} onClose={() => setAdicionando(false)} />
    </div>
  );
}
```

> **Nota sobre baixar anexo:** nesta tarefa os anexos aparecem, mas ainda **não baixam** — a rota
> de download entra no bloco de envio (fatia 4), junto com o anexar. Mostrar o que existe já evita
> a pergunta "cadê o arquivo que ele mandou?".

- [ ] **Passo 4 — registrar a rota**

Em `apps/web/src/app/router.tsx`, junto dos outros `lazyRouteComponent`:

```ts
const EmailPage = lazyRouteComponent(() => import("../features/email/EmailPage"), "EmailPage");
```

Junto das outras `createRoute`:

```ts
const emailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/email",
  component: EmailPage,
});
```

E `emailRoute` dentro do array de `rootRoute.addChildren([...])`.

- [ ] **Passo 5 — menu**

Em `apps/web/src/lib/paginas.ts`, no grupo "Dia a dia", logo depois do item de Mensagens:

```ts
{ label: "E-mail", icon: Inbox, to: "/email", minRole: "FUNCIONARIO", keywords: ["email", "e-mail", "caixa de entrada", "webmail", "inbox", "mensagem"] },
```

Acrescentar `Inbox` ao import de `lucide-react` do arquivo. O ícone é `Inbox`, e não `Mail`,
porque `Mail` já é o ícone de "Mensagens automáticas" — dois itens de menu com o mesmo desenho
confundem quem é leigo, que é o público desta app.

- [ ] **Passo 6 — guia "?" da página**

Existe teste-guarda (`GuiaTour.test.ts`) que reprova qualquer rota sem guia próprio. Em
`apps/web/src/components/GuiaTour.tsx`, criar um `GUIA_EMAIL` com **≥ 2 passos** (título e
descrição de verdade — o teste exige descrição > 30 caracteres) e registrá-lo em `OUTRAS`
**depois** de `/emails-enviados` e `/emails`:

```ts
  // `/email` (a caixa da pessoa) vem DEPOIS de `/emails*` — é prefixo dos dois.
  { prefixo: "/email", guia: { titulo: "E-mail", passos: GUIA_EMAIL } },
```

- [ ] **Passo 7 — tela cheia no layout**

Em `apps/web/src/components/layout/AppLayout.tsx:374` — atenção: `startsWith("/email")` casaria
também com `/emails` e `/emails-enviados`, que são páginas normais.

```ts
  // `/email` exato (e filhas): `startsWith("/email")` pegaria junto `/emails` e
  // `/emails-enviados`, que são páginas normais e não podem virar tela cheia.
  const telaCheia =
    pathname.startsWith("/mensagens") ||
    pathname.startsWith("/agenda") ||
    pathname === "/email" ||
    pathname.startsWith("/email/");
```

- [ ] **Passo 8 — conferir que compila e que o menu bate com a rota**

Rodar: `pnpm typecheck && pnpm --filter @app/web test`
Esperado: sem erro. Os testes-guarda que precisam passar: `paginas.test.ts` (rota × catálogo da
busca), `socket.test.ts` (polling) e `GuiaTour.test.ts` (guia próprio por página).

- [ ] **Passo 9 — commitar**

```bash
git add apps/web/src/features/email apps/web/src/app/router.tsx apps/web/src/lib/paginas.ts apps/web/src/lib/socket.ts apps/web/src/lib/socket.test.ts apps/web/src/components/GuiaTour.tsx apps/web/src/components/layout/AppLayout.tsx
git commit -m "feat(email): página /email em três colunas com corpo isolado e imagem remota bloqueada"
```

---

## Tarefa 13 — Verificação ponta a ponta e documentação

**Arquivos**
- Criar: `e2e/email.spec.ts`
- Modificar: `docs/DATABASE.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/CLAUDE.md`,
  `docs/DEPLOY.md`, `CLAUDE.md` (raiz)

- [ ] **Passo 1 — E2E do estado vazio**

`e2e/email.spec.ts` — autenticação por `storageState`, que é o padrão real deste repositório
(não existe helper de login; ver `e2e/auth.setup.ts` e qualquer `flows-*.spec.ts`):

```ts
import { test, expect } from "@playwright/test";

test.describe("E-mail dentro da aplicação", () => {
  test.use({ storageState: "e2e/.auth/funcionario.json" });

  test("convida a plugar a primeira caixa e abre o diálogo", async ({ page }) => {
    await page.goto("/email");

    await expect(page.getByRole("heading", { name: "Seu e-mail, aqui dentro" })).toBeVisible();
    await page.getByRole("button", { name: "Adicionar caixa" }).click();

    await expect(page.getByRole("dialog")).toContainText("Adicionar caixa de e-mail");
    await expect(page.getByLabel("E-mail *")).toBeVisible();
    await expect(page.getByLabel("Senha da caixa *")).toBeVisible();
  });

  test("explica quando não consegue falar com o servidor, sem deixar a caixa gravada", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/email");
    await page.getByRole("button", { name: "Adicionar caixa" }).click();

    // Domínio que não existe DE PROPÓSITO: exercita o caminho de erro sem mandar uma única
    // tentativa de senha errada ao servidor real. Repetir login inválido a cada rodada de CI
    // faria o Dovecot bloquear o IP por força bruta — e aí nem os e-mails automáticos sairiam.
    await page.getByLabel("E-mail *").fill("ninguem@dominio-que-nao-existe-mc.invalid");
    await page.getByLabel("Senha da caixa *").fill("irrelevante");
    await page.getByLabel("Seu nome *").fill("Teste");
    await page.getByRole("button", { name: "Conectar" }).click();

    await expect(page.getByText(/não consegui falar com/i)).toBeVisible({ timeout: 40_000 });
    // O diálogo continua aberto: nada foi gravado pela metade.
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
```

> **O caminho de senha errada já é coberto** — uma vez só, no teste de integração da Tarefa 6,
> que roda localmente com a credencial no `.env`. Não se repete no E2E de propósito.

- [ ] **Passo 2 — rodar o E2E isolado**

Rodar: `pnpm test:e2e:isolado -- email`
Esperado: 2 testes PASSAM. (Usar o isolado — o `test:e2e` cru suja o banco de desenvolvimento.)

- [ ] **Passo 3 — verificação manual na tela**

1. Abrir http://localhost:4310/email
2. Plugar `teste@medconsultoria.com.br` com a senha correta → a caixa aparece conectada
3. Mandar um e-mail de fora para essa caixa (do Gmail pessoal, por exemplo)
4. Recarregar a página → o e-mail aparece na lista em até 30 segundos
5. Abrir o e-mail → o corpo aparece; se tiver imagem, a faixa de bloqueio aparece
6. Conferir no webmail que a mensagem ficou marcada como lida

- [ ] **Passo 4 — atualizar a documentação**

| Arquivo | O que escrever |
|---|---|
| `docs/DATABASE.md` | Os 5 models novos e o porquê de `EmailEndereco` resolver o vínculo por JOIN |
| `docs/ARCHITECTURE.md` | O módulo `email` e a regra da conexão IMAP curta (sem `IDLE`, por causa do lsnode) |
| `docs/DECISIONS.md` | ADR novo: e-mail dentro da aplicação — índice+cache, caixa privada por usuário, as três camadas contra HTML hostil |
| `docs/CLAUDE.md` | Regra de negócio do e-mail + o ADR no índice da seção 6 |
| `docs/DEPLOY.md` | `EMAIL_CRYPTO_KEY` no `.env` do servidor, com o comando de geração |
| `CLAUDE.md` (raiz) | Estado atual: e-mail dentro da app (Bloco 1) |

- [ ] **Passo 5 — commitar**

```bash
git add e2e/email.spec.ts docs CLAUDE.md
git commit -m "test(email): E2E do estado vazio e da senha recusada + documentação"
```

---

## Verificação do bloco

Antes de considerar o Bloco 1 pronto:

- [ ] `pnpm --filter @app/api test` — todos os testes do módulo passam
- [ ] `pnpm typecheck` e `pnpm lint` limpos
- [ ] Revisão obrigatória por `security-reviewer` (credenciais guardadas, HTML hostil, filtro por
      dono em todo procedure) e `database-reviewer` (a migration e os índices)
- [ ] `typescript-reviewer` no módulo `email`
- [ ] Confirmar na tela: plugar a caixa de teste, abrir a Caixa de entrada, ler um e-mail enviado
      de fora
