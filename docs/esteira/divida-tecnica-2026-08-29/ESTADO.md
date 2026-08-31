# Estado — dívida técnica e avisos (ADR-144)

> Escrito em 29/08/2026, fim de tarde. Branch **`fix/divida-tecnica-e-avisos`**, 4 commits,
> tudo no GitHub. **PR ainda NÃO aberto.** Nada publicado — a v1.3.0 continua no ar.

## O que está pronto e provado

- **A marca do credenciamento** (`Servico.ehCredenciamento`, migrações `20260829203721` +
  `20260829210500`), matando o "casa por nome" que a ADR-140 deixou como remendo.
- **Doze defeitos** fechados: M10, M11, M13, M17, M18, M20, F13, F20, F21, B2, B3 e o aviso
  mudo do cadastro de cliente.
- **Três achados da revisão**, todos criados pela própria correção: o clone do catálogo, o
  backfill silencioso e o oráculo de e-mail na rota pública.
- ADR-144 escrita, `CLAUDE.md` atualizado, memória gravada.
- **Provas:** typecheck 6/6 · lint limpo · 814 testes da API · 220 da web.

## O que travava o PR — RESOLVIDO em 31/08/2026

> A 3ª tentativa (o `await q.refetch()` duas vezes) foi confirmada: **`flows-documentos-ui`
> passa**, e o log do servidor prova o mecanismo — depois do upload saem **duas** releituras de
> `clientes.arquivos` (antes não saía nenhuma). **Suíte e2e completa: 109/109 verdes**, o mesmo
> placar da `main`. Typecheck 6/6 · lint limpo · 814 testes da API · 220 da web.

O relato abaixo fica como registro do diagnóstico.

## O diagnóstico (histórico)

**A suíte e2e reprova em `flows-documentos-ui.spec.ts:12` (upload pela ficha do cliente).**
Investigado a fundo, com evidência — não é instabilidade:

- `main` roda a mesma suíte, no mesmo runner: **109/109 verdes**.
- O commit `d686345` do ramo também: **109/109**.
- O commit `c3b5071` reprova, **sempre no mesmo teste**.

### O mecanismo, medido no trace do Playwright

1. A ficha carrega tudo num **lote único** de tRPC (`clientes.servicos`,
   `credenciamento.porCliente`, `credenciamento.grade`, `clientes.pessoas.list`,
   **`clientes.arquivos`**, `email.conversaDoCliente`).
2. O upload responde **200** cerca de **120 ms depois** de esse lote começar — ou seja, com ele
   ainda no ar.
3. O aviso do upload roda (prova: `clientes.servicos` é relido em +116 ms, e **não é polling** —
   só `chamados` faz polling, e ele aparece aos 15 s).
4. Mas **`clientes.arquivos` nunca é relido**: pedir "busque de novo" a uma consulta em
   andamento faz o React Query reaproveitar a busca, e a resposta que chega é a de **antes** do
   envio. Nenhuma requisição chega a sair.

**Consequência para quem usa:** anexar um documento logo depois de abrir a ficha deixa o
arquivo fora da lista até alguém recarregar a página, sem nenhum sinal de erro.

### Tentativas de correção, na ordem

1. `invalidate(..., { cancelRefetch: true })` — **não funcionou**: o `invalidate` do tRPC recebe
   as opções na TERCEIRA posição, e a opção foi ignorada.
2. `q.refetch()` direto — **não funcionou**: `refetch` também é deduplicado contra a busca em
   andamento (o link de lote do tRPC não aborta por consulta).
3. **`await q.refetch()` duas vezes em sequência** — a primeira espera o que está no ar, a
   segunda é a que sai de verdade. **CONFIRMADA em 31/08: é a correção que entrou.**

### Armadilha nova, e cara

⚠️ **Rodar `prisma generate` num git worktree CORROMPE o cliente do repositório principal** — o
pnpm liga os dois pelo mesmo `node_modules`. Sintoma: a semeadura do e2e morre com
*"The requested module '@prisma/client' does not provide an export named 'PrismaClient'"*.
Conserto: `pnpm --filter @app/db exec prisma generate` na raiz do repositório principal.
O worktree `C:\...\Temp\claude\wt-main-e2e` **não foi removido** (diretório não vazio) — apagar.

## O que falta, na ordem

1. ~~Confirmar a 3ª tentativa de correção com a suíte e2e completa.~~ **FEITO em 31/08: 109/109.**
2. Abrir o PR (corpo pronto em `scratchpad/pr-body.md` da sessão; se perdido, reescrever a
   partir da ADR-144).
3. **Antes de publicar:** conferir em produção o **nome do serviço de credenciamento** — a
   migração-guarda barra a publicação se ele divergir do canônico. A conferência pelo navegador
   não funcionou nesta sessão (a aba voltava para "Nova guia").
4. Fora de escopo, com motivo: `@@unique(nome)` em `Servico` (depende da conferência acima) e o
   consentimento da assinatura (pede migração e a decisão do texto, que é do dono).
