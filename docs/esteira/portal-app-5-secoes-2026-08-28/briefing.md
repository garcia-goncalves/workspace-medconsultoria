# Briefing — O Portal do cliente vira aplicativo, em 5 seções

- **slug:** portal-app-5-secoes-2026-08-28 · **data:** 2026-08-28

## pedido_original
"Achei que a area do cliente está confusa e crua. Talvez está uma página muito comprida...
talvez colocar um menu? O que vc acha? QUero tudo BEM ORGANIZADO E FÁCIL DO CLIENTE
ENTENDER/MEXER. Para mobile, pensei em menu tipo o app da Binance (menu na parte inferior
da tela, sabe?) Quero que para celular pareça um app mesmo sabe?"

Aprovação da divisão, dada em 28/08/2026 nesta sessão: **as 5 seções recomendadas** —
Início · Documentos · Credenciamento · Meus serviços · Suporte, com *Equipe* e *Perfil* no
menu do avatar.

## entendimento
O Portal do cliente é hoje uma página única de 16 blocos empilhados, sem roteador, sem
menu e praticamente sem tratamento de celular (6 usos de breakpoint em 2.300 linhas). Vai
virar um aplicativo de 5 seções com endereço próprio (`/portal/...`), navegado por um menu
inferior fixo no celular — como o app da Binance — e pela mesma divisão no computador. As
37 funcionalidades existentes continuam todas lá; o que muda é onde cada uma mora e como
se chega nela.

## usuario_alvo
O médico e a secretária da clínica cliente. Entram poucas vezes por mês, quase sempre pelo
**celular**, com pressa e sem treinamento: para enviar um documento que a Med pediu,
acompanhar em que pé está o credenciamento numa operadora, aceitar uma proposta ou falar
com a equipe. Não são desenvolvedores — a lente DX não se aplica. Dois papéis com direitos
diferentes: RESPONSAVEL (assina, contrata, cancela) e EQUIPE (o operacional), separados
pela ADR-131 e endurecidos pela ADR-137.

## criterio_de_aceitacao
- As **5 seções** existem com endereço próprio (`/portal`, `/portal/documentos`,
  `/portal/credenciamento`, `/portal/servicos`, `/portal/suporte`); recarregar a página em
  qualquer uma delas devolve a mesma seção, e o botão "voltar" do navegador funciona.
- **Credenciamento só aparece** quando aquela clínica tem processo de credenciamento; sem
  processo, o menu mostra 4 itens e nenhum item morto.
- *Equipe da clínica* e *Editar perfil* saem do corpo da página e ficam no **menu do
  avatar**; nenhuma das duas some da aplicação.
- Cada uma das **37 funcionalidades** hoje mapeadas continua alcançável, e cada bloco de
  `PortalHome.tsx` tem destino escrito no `spec.md` (nada é descartado por esquecimento).
- Em **390×844 e 360×800**, conferido na tela: menu inferior fixo e visível, sem rolagem
  horizontal, sem elemento cortado, alvo de toque de no mínimo 44px em todo item do menu.
- No **computador (1920×1080)**, a mesma divisão navega sem menu inferior, e nenhuma tela
  fica com o conteúdo esticado na largura toda.
- O **contador de pendência** aparece no ícone da seção que tem algo esperando o cliente, e
  bate com o número que a seção mostra dentro.
- O guia do Portal deixa de ser um único texto genérico e passa a ter **um guia por seção**.
- **M12 corrigido:** a secretária (papel EQUIPE) vê a ação bloqueada *antes* de clicar, e
  não depois de confirmar o modal (`PortalHome.tsx:177-186`).
- `pnpm -r typecheck`, `pnpm -r lint`, `pnpm --filter @app/api test`, `pnpm --filter
  @app/web test` e a suíte e2e verdes; **CI verde no PR** antes de mesclar.
- Conferido clicando no localhost como cliente do Portal, nos dois papéis, com **zero erro
  de console**.

## fora_de_escopo
- Os demais achados do Portal na auditoria: **M9** (cliente ativo vê "Não tenho mais
  interesse"), **C7** (convite cria conta sem papel), **C8** ("Equipe e acessos" desativa
  sem checar `sobraResponsavel`), **F20** (o Portal nunca mostra o percentual aceito). São
  correções de regra, não de navegação; entram numa rodada própria.
- O texto em excesso **fora do Portal** (PARTE 4 da auditoria: `EmailPage`,
  `IdentidadeDialog`, `EmailsAdminPage`).
- A **lentidão e a queda do banco de produção** — é hospedagem, não código, e o dono mandou
  não tocar.
- **Publicar.** O trabalho para no merge com CI verde; a publicação é um lote no fim do dia,
  com o sim do dono.
- Mudar qualquer regra de negócio do Portal: aceite, assinatura, contratação e cancelamento
  continuam exatamente como estão depois das ADR-137/138.

## riscos
Nenhum toque em dado de paciente, pagamento, migration ou configuração de deploy — o
redesenho é de navegação e apresentação. **Um risco real, de regressão:** o Portal é a
única tela que o cliente vê, e a página única de hoje garante que tudo esteja visível por
rolagem; distribuir em seções pode esconder uma funcionalidade sem ninguém notar. É por
isso que o critério exige destino escrito para cada um dos blocos e conferência clicando.
Segundo risco: `App.tsx:89` escolhe o Portal por papel e **qualquer caminho cai nele** —
introduzir rotas ali mexe no roteamento de toda a aplicação, inclusive na sessão de suporte
da equipe (ADR-128).

## plano_de_voo
Modo **enxuto**, porque a descoberta já foi feita: o mapa do Portal, os 16 blocos e as 37
funcionalidades estão em `docs/esteira/refino-final-2026-08-28/achados.md` (PARTE 3).

| Fase | Papéis | Modelo | Despachos |
|---|---|---|---|
| 2 · Descoberta | Arquiteto+Analista num despacho só (mapa bloco→seção com arquivo:linha, e o que existe de navegação reaproveitável) | opus | 1 |
| 3 · Design | Diretor de arte + Redator num despacho (tab-bar, ícones, rótulos, estados vazio/carregando/erro, 360px) | opus | 1 |
| 4 · Plano | neguin-planner | opus | 1 |
| 5 · Execução | neguin-executor em worktrees isoladas (shell+rotas · seções · guia+M12) | sonnet | 3 |
| 6 · Revisão | react-reviewer · design-reviewer · conteudo-reviewer em paralelo + verificação na tela por mim | sonnet/opus | 3 |
| 7 · Cronista | doc, memória, ADR, PR, handoff | opus | 1 |

**Total previsto: 10 despachos.** Portões: o 1 (este briefing) e o 3 (escolha visual do
menu inferior, uma vez). O portão 4 (risco) não se aplica — não há migration, pagamento nem
dado de paciente. O portão 2 (decisão de produto) já foi respondido: as 5 seções.
