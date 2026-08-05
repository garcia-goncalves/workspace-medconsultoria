# Plano — E-mail fase 2D‑1: a conversa com o cliente aparece na ficha

> Spec: `docs/superpowers/specs/2026-08-04-email-bloco2-escrever-e-agir-design.md` §7.
> Antecessores: ADR‑95 (plugar e ler) e ADR‑96 (escrever/responder/encaminhar/anexar).
> **A fase 2D foi fatiada.** Este plano é a fatia 1. As fatias 2 e 3 estão no fim.

## Por que fatiar

O levantamento de 05/08 (dois subagentes, contra o código) desmentiu a premissa do
plano original em dois pontos:

1. **O card não é novo.** A ficha do cliente (`ClienteDetailPage.tsx:774‑783`) e o painel
   do lead (`LeadDetailPanel.tsx:384‑390`) já têm "E‑mails enviados", servido por
   `emailsEnviados.doCliente` / `.doLead` e desenhado por `EmailsEnviadosList`.
   Só que ele mostra **exclusivamente `EmailEnviado`** — o log dos e‑mails automáticos
   de template. Nada do que a pessoa escreve em `/email` cai ali: o módulo `email`
   (caixa pessoal) não chama `registrarEmailEnviado`, e isso é proposital (ADR‑96 §3.6).
   **2D‑1 é unir duas fontes num card que já existe**, não construir um card.
2. **`EmailMensagem.particular` existe no banco e nenhum código o escreve.** A válvula de
   privacidade está prevista desde o ADR‑95 e nunca foi implementada. Sem ela, esta fase
   não pode ir ao ar: é ela que torna aceitável expor a caixa de alguém na ficha.

## Decisões desta fatia (e o que cada uma custa)

### 1. Quem vê o quê — a decisão que precisa estar consciente

A regra do ADR‑95 é *"a caixa é privada, a correspondência com o cliente é da empresa"*.
Levada ao pé da letra, qualquer funcionário abriria a ficha e leria o corpo inteiro de um
e‑mail que outra pessoa trocou. **Não vamos tão longe nesta fatia:**

| Quem | O que vê na ficha |
|---|---|
| Qualquer pessoa da equipe (`funcionarioProcedure`) | Remetente, destinatários, assunto, data e o **trecho** (`EmailMensagem.trecho`, o resumo em texto puro que o índice já guarda) |
| **Só o dono da caixa** | O corpo completo, abrindo em `/email` |

**Motivo:** ampliar depois é um `select` a mais; estreitar depois de alguém ter lido a
correspondência alheia é impossível. Metadado + trecho já entrega o que a fase promete
("abro a ficha e vejo a conversa com este cliente") sem transformar a caixa de cada um em
documento público. Se na prática faltar, o dono decide e a gente amplia — e isso vira ADR.

### 2. Como o e‑mail acha o cliente

`JOIN` em `EmailEndereco.endereco` (índice `@@index([endereco])` já existe), comparando com
os endereços do cliente: `Cliente.email` **mais** o e‑mail de cada contato do cliente.
Normalizado em minúsculas pelo `normalizarEndereco` que já existe em `enderecos.ts`.
O vínculo **nunca é gravado** — é resolvido na consulta, como manda o ADR‑95. Se o cliente
trocar de e‑mail, a ficha reflete a verdade nova sem migração.

### 3. O que fica de fora da lista, sempre

- `particular = true` (a válvula).
- Mensagens em pasta de **Lixeira** e **Spam** — o que foi jogado fora não é histórico.
- Duplicatas: a mesma mensagem existe na caixa de quem mandou (Enviados) e na de quem
  recebeu (Entrada). Deduplicar por `messageId`, ficando com a mais antiga.

### 4. Marcar como particular

Mutation `email.marcarParticular({ mensagemId, particular })`, **só para o dono da caixa**
(`where: { id, pasta: { caixa: { userId, deletedAt: null } } }`; qualquer outro recebe
`FORBIDDEN`). O botão só aparece para o dono. Marcar tira da ficha na hora — para todo
mundo, inclusive para quem já estava com a tela aberta (a query invalida).

## Fatias

### Fatia 1 — Backend: o vínculo (TDD)

**Arquivo novo:** `apps/api/src/modules/email/vinculo.service.ts`

```
enderecosDoCliente(clienteId): Promise<string[]>     // Cliente.email + contatos, normalizados
enderecosDoLead(leadId): Promise<string[]>
listarPorEnderecos(enderecos, limite): Promise<ItemDaCaixa[]>
```

Testes primeiro (`vinculo.test.ts`, `prisma` dublado no padrão de `envio.preparar.test.ts`):

1. lista mensagem cujo **remetente** é o cliente;
2. lista mensagem cujo **destinatário** (`para`/`cc`) é o cliente;
3. **não** lista mensagem marcada `particular`;
4. **não** lista mensagem em Lixeira nem em Spam;
5. **deduplica** por `messageId`, mantendo a mais antiga;
6. endereço em MAIÚSCULAS no e‑mail casa com o cadastro em minúsculas;
7. cliente sem e‑mail e sem contato → lista vazia, sem consultar mensagem nenhuma;
8. respeita o limite.

**Router** (`email.router.ts`), ambas `funcionarioProcedure`:
- `doCliente({ clienteId })` / `doLead({ leadId })` → itens da caixa (sem corpo).
- `marcarParticular({ mensagemId, particular })` → só o dono; devolve o estado novo.

Teste de autorização obrigatório: usuário que **não** é dono recebe `FORBIDDEN` e **nada**
é gravado.

### Fatia 2 — Backend: a linha do tempo unificada

`emailsEnviados.doCliente` continua como está (é log de empresa e tem consumidor próprio).
A união acontece num procedure novo, `email.conversaDoCliente`, que devolve as duas fontes
já ordenadas por data decrescente, cada item com `origem: "automatico" | "caixa"`.

Testes: ordenação por data misturando as fontes; fonte vazia de um lado não quebra o outro;
falha ao ler a caixa **não** derruba o card (o log automático ainda aparece).

### Fatia 3 — Front: o card

Extrair de `ClienteDetailPage.tsx` (e do `LeadDetailPanel.tsx`) o card "E‑mails enviados"
para **`EmailsDoClienteCard`** (`apps/web/src/features/crm/clientes/`), que:

- mostra a linha do tempo unificada, com um selo distinguindo *"enviado pelo sistema"* de
  *"da caixa de <pessoa>"*;
- trata **carregando** e **erro** de verdade (`QueryError`) — os cards de hoje tratam só o
  vazio, e este passa a depender de rede IMAP indireta;
- mostra "Marcar como particular" **só** para o dono da mensagem;
- link "abrir na minha caixa" **só** para o dono.

Testes de componente no padrão de `EmailPage.test.tsx`: selo por origem; botão de
particular ausente para não‑dono; estado de erro visível.

### Fatia 4 — e2e e documentação

`e2e/email-ficha-cliente.spec.ts` — **hoje nenhum e2e toca a ficha do cliente.**
Cobrir: o card aparece na ficha; e‑mail marcado como particular some do card.

Docs a atualizar ao fim: `docs/DECISIONS.md` (ADR‑97), `docs/CLAUDE.md` (regra de negócio
do e‑mail), `CLAUDE.md` da raiz (estado atual), `docs/LINKS.md` (o que a ficha passa a
mostrar).

## Fora desta fatia (ficam para 2D‑2 e 2D‑3)

- **Anexo vira documento do cliente** com um clique (`EmailAnexo.arquivoId` já existe).
- **E‑mail de desconhecido vira lead** com um clique.

Ambas dependem deste card existir e são independentes entre si — cabem em uma sessão cada.

## Verificação

`pnpm --filter @app/api test:unit` (**nunca** `test` — manda e‑mail real), `pnpm run
typecheck --force`, `pnpm --filter @app/web test`, e o e2e isolado
(`pnpm test:e2e:isolado`). Revisão por `security-reviewer` **obrigatória** antes do merge:
esta fatia expõe conteúdo de caixa pessoal a terceiros.
