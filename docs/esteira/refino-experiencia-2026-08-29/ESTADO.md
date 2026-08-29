# Estado da esteira — refino da experiência + dados reais

> Atualizado em 29/08/2026, madrugada. Branch **`refino/experiencia-total`**.
> Leia com `briefing.md` e `spec.md` ao lado. Este arquivo é o que sobrevive ao `/clear`.

## Onde estamos

Fases 1 a 5 da esteira feitas ou em curso. **Nada foi publicado** — a v1.3.0 continua no ar.
A branch **não tem PR aberto ainda**.

### Commits desta esteira (todos com typecheck 6/6, lint limpo e testes verdes no momento do commit)

| Commit | O que entrou |
|---|---|
| `dd82570` | **Cada passo do funil diz de quem está esperando** — enum `QuemFaz` (MED/CLIENTE) em `ServicoPasso` e `LeadPasso`, migração `20260829014839_passo_diz_quem_faz` (duas colunas com padrão; reverter é `DROP COLUMN`). Os 10 serviços reais ganharam de 2 a 5 passos da clínica. Backfill guardado por "este serviço não tem NENHUM passo do cliente". Selo âmbar "com a clínica" no painel do lead. **De quebra:** `seedIfEmpty` ganhou memória de 30 s — era a origem medida do `portal.servicosDisponiveis` de 11,9 s em produção. |
| `be0db3c` | **A caixa de peças**: `tabs`, `sheet`, `popover`, `accordion`, `dialog-stack`, `data-table` (acima de `md` tabela, abaixo cartões, toque 44px) e a prop `hint` em `PageHeader`/`Modal`/`CardTitle`. Tudo à mão — **nenhuma biblioteca nova**. |
| `d991d73` | `docs/UI_GUIDELINES.md` deixou de dizer "desktop-first" e passou a descrever a caixa de peças. |
| `0f53c6a` | Teste-trava do catálogo: todo serviço tem os dois lados, o passo do cliente é escrito na voz dele, e a etapa existe. **Visto reprovando antes.** |
| `c8239db` | **Os 5 defeitos de cobrança**: M1 (cobrava 2×), C10 (parcela excluída ressuscitava), M15 (conta de R$ 0,00 que nunca mais cobra), F8 (mensal somado com avulso), F9 (investimento R$ 0,00 no contexto). 29 testes novos, todos vistos vermelhos antes. Zero migração. |
| `3da44b2` | **20 telas responsivas.** ⚠️ A causa raiz do quadro que vazava até no notebook era o `<main>` do `AppLayout` sem `min-w-0` — vazamento clássico de `min-width:auto` do Flexbox. Kanban vira uma coluna por vez no celular; Agenda ganha lista por dia abaixo de `lg`; tabelas viram `DataTable`; Portal com toque de 44px; erro antes de vazio em mais 6 lugares. |
| `315a3cd` | **Carteira de demonstração pelos fluxos reais** (`apps/api/src/scripts/demo-rica.ts`, `pnpm db:demo:rica`). |

## Medição de responsividade — antes × depois

Teste: `e2e/responsividade-total.spec.ts` (30 rotas × 5 tamanhos; overflow, elemento estourando, erro de console, alvo de toque 44px no Portal, texto cortado). Rodar com `pnpm test:e2e:isolado e2e/responsividade-total.spec.ts --reporter=list`.

- **Portal do cliente: reprovava em 360 e 390 → PASSA NOS CINCO TAMANHOS.** ✅
- **Área interna: ainda reprova nos cinco.** Parte é layout das telas que ainda estavam sendo refinadas quando a medição rodou (Início, Vendas, Mensagens, E-mail, Sistema); parte é **ruído de ambiente**, não layout:
  - `/email` dispara `412 Precondition Failed` em toda carga — é a caixa IMAP semeada pedindo reconexão. **Não é defeito de layout**, mas viola "zero erro de console" e polui o sinal. **Precisa ser tratado antes da medição final.**

Números medidos ANTES das correções, para comparar depois:

| Rota | 360 | 390 | 768 | 1366 |
|---|---|---|---|---|
| `/projetos/$id` (Kanban) | +1160 | +1130 | +1024 | **+442** |
| `/usuarios` | +624 | +594 | +452 | — |
| `/financeiro` | +321 | +291 | +185 | — |
| `/agenda` | +173 | +143 | +37 | — |
| `/documentos` | +158 | +128 | +22 | — |
| `/modelos` | +135 | +105 | — | — |
| `/clientes` | +36 | — | — | — |

## Banco de desenvolvimento

Limpo e repovoado. Backup do estado anterior em `backups/medconsultoria-antes-da-limpeza-20260829-031805.sql`.

**9 clientes** (6 ativos + prospects), **14 leads**, 13 projetos, **58 cartões**, 18 tarefas, 18 eventos, 11 documentos, 16 profissionais, **39 credenciamentos** cobrindo as 6 situações, 16 contas, **143 passos de funil**. Zero nome de lixo de teste (a `Operadora GRD352779` foi apagada, com o credenciamento dela reapontado para a Unimed).

**Entrar:** `pnpm contas:teste` cria `root@`/`admin@`/`funcionario@`/`cliente@teste.local`, senha `teste1234`. O Portal da carteira nova é `teste.portal@medconsultoria.com.br` (Centro de Diagnóstico Penha, com documentação parcialmente enviada de propósito).

⚠️ **Nenhum e-mail alcança a rede**: o semeador zera `SMTP_HOST/USER/PASS` no processo antes de importar a API, então todo envio cai no ramo que só registra. Ordem do dono. Dois caminhos ainda *disparam* a notificação (`convertLead` avisa ADMIN/ROOT; gerar documento avisa o responsável) — relatados, não contornados.

## O que estava em curso quando este arquivo foi escrito

Três frentes despachadas e **ainda não conferidas**:

1. **Fim da mensalidade ao cancelar serviço** (decisão do dono: SIM — parcelas já vencidas ficam, futuras param) **+ os 5 defeitos de aviso mudo**: C1 (proposta não fecha o passo do funil), C2 (entrar na etapa Proposta gera 2ª proposta e queima número da numeração real da Thaís), M6 (6 avisos com modelo pronto que nunca saem), M8 (equipe responde chamado e o cliente não sabe), C8 (desativar pela tela interna não marca `acessoRevogadoEm`).
2. **As 5 telas que faltam**: Início, Vendas (funil, é um Kanban — deve seguir a mesma solução do quadro de projetos), Mensagens, E-mail, Sistema.
3. **Datar os credenciamentos para trás** no semeador — hoje **zero** estão parados há mais de 60 dias, então o alerta âmbar (a razão de a tela de Credenciamentos existir) nunca acende na demonstração. A régua lê `createdAt`/`protocoladoEm`/`emAnaliseEm` conforme a situação (`credenciamento-painel.service.ts:85-105`), **não** o `updatedAt`.

**Antes de considerar qualquer uma pronta:** `pnpm typecheck` (6/6), `pnpm lint`, `pnpm --filter @app/web test` (213), `pnpm --filter @app/api test` (**suíte inteira — `test:unit` NÃO roda integração**, e a CI já reprovou por isso).

## O que ainda falta, depois disso

- **Rodar a medição de responsividade de novo** e fechar o que sobrar na área interna.
- **Tratar o `412` do `/email`** — é dado do ambiente, mas quebra o critério "zero erro de console".
- **Conferir as 30 telas no navegador**, em 1920 e 360. ⚠️ Local usa Playwright; produção usa a extensão do Chrome.
- **Documentação e ADR**: escrever a ADR desta esteira em `docs/DECISIONS.md` e atualizar o `CLAUDE.md` do projeto.
- **Abrir o PR** e esperar a CI (3 verificações obrigatórias; a `main` só aceita PR).
- **Publicar** — só com o sinal do dono, e o `gh workflow run` **é barrado para mim**: ele precisa colar `! gh workflow run deploy.yml --ref main -f confirmar=PUBLICAR`.

## Armadilhas desta rodada, para não repetir

- ⚠️ **O VS Code mente muito aqui.** Ele mostrou dezenas de erros que não existiam (JSX não fechado, export sumido, campo do Prisma ausente) enquanto `pnpm typecheck` saía 6/6. **A verdade é o terminal.** Quando o cliente do Prisma muda, o editor precisa de *TypeScript: Restart TS Server*.
- ⚠️ **Agentes em paralelo no mesmo repositório se atropelam.** Vários relataram "typecheck limpo" em momentos diferentes e a foto final ficava vermelha. O jeito que funcionou: dar a cada um um conjunto de arquivos **disjunto**, e conferir a árvore inteira só depois que todos voltam.
- ⚠️ **`prisma migrate dev` reexecuta o seed** e quebra o login dos e2e. O caminho limpo é `migrate dev --create-only` e depois `migrate deploy`, rodados **da raiz** (de dentro de `packages/db` o Prisma não acha as variáveis de ambiente).
- ⚠️ **Os bancos auxiliares precisam migrar junto**: `medconsultoria_test` (integração) e `medconsultoria_e2e`. Os dois já receberam a migração desta esteira.
- ⚠️ **O hook de segredo barra qualquer comando de Bash que cite `.env`** — inclusive `cat packages/db/package.json` se a linha contiver a palavra. Para consultar o banco, escreva um script `.mts` **dentro do repositório** (fora dele o `@prisma/client` não resolve) e rode com `pnpm exec tsx`.
- ⚠️ **A raiz não é ESM**: script solto precisa da extensão `.mts`, senão `tsx` reclama de *top-level await*.

## ⚠️ Pendência do banco de demonstração (29/08, madrugada)

A datação dos credenciamentos **está feita** no semeador: as datas são relativas ao prazo
lido de `IdentidadeInstitucional` (não a 60 fixo), e três linhas nascem claramente
atrasadas — `A_PROTOCOLAR` há 120 dias, `PROTOCOLADO` há 90, `EM_ANALISE` há 75 —, mais
duas dentro do prazo para o contraste.

**Mas o banco de desenvolvimento está com dado duplicado:** 49 credenciamentos e 21
profissionais, quando o desenho pede 10 e 5. São **quatro gerações sobrepostas dos mesmos
nomes**, e a causa é concorrência: mais de um processo rodou `pnpm db:demo:rica` contra o
mesmo banco ao mesmo tempo, e a checagem de idempotência (`findFirst` antes de criar) tem
uma janela de corrida entre "conferi que não existe" e "criei".

**Não é defeito da lógica** — no banco isolado, rodando sozinho, três execuções seguidas
deram 10 nas três, sem crescer.

**O que fazer:** com **nada mais rodando neste checkout**, um único
`pnpm db:limpar --apply && pnpm db:demo:rica`. Depois, conferir que dá 10 credenciamentos,
3 deles com o alerta âmbar aceso.
