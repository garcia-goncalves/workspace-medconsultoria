# Crônica — o Portal virou aplicativo

- **slug:** `portal-app-5-secoes-2026-08-28` · **fase:** 7 (crônica) · **data:** 2026-08-28
- **O porquê de cada escolha está na ADR-139** (`docs/DECISIONS.md`). Este arquivo guarda só o que
  a execução ensinou e que não cabe numa ADR.

## O que mudou entre o plano e a entrega

1. **O `Link` tipado do TanStack não foi usado — e a alternativa que o revisor propôs também não.**
   O plano previa passar o roteador do Portal como genérico explícito. Na prática, a saída barata
   foi um desvio de tipo **num lugar só** (`features/portal/navegar.ts`), porque importar a
   instância `portalRouter` — que daria conferência de rota de verdade — **fecha um ciclo de
   módulos**: `portal-router` → `PortalLayout` → `PortalTabBar` → `navegar` → `portal-router`.
   Quebrá-lo exigiria carregar a própria casca sob demanda, trocando um cast documentado por um
   piscar da tela a cada primeira carga. Quem confere que as rotas existem é o `secoes.test.ts`,
   lendo o texto do roteador — conferência de arquivo no lugar da conferência de tipo.

2. **Dois arquivos de e2e a mais do que o plano listou.** `realtime-mensagens.spec.ts` abria `/` e
   clicava em "Abrir chamado", que passou a morar em `/portal/suporte`; e `a11y-axe.spec.ts` varria
   só o Início do Portal, deixando de fora exatamente o que é novo (os rótulos e contadores da
   barra, que só um leitor de tela reclama). Os dois entraram. **Lição:** ao dividir uma página
   única em seções, a lista de arquivos afetados **não** é a lista de arquivos daquela página —
   é a de todo teste que dependia de "está tudo numa tela só".

3. **O preço do serviço ficou de fora, e a régua que barrou foi a do próprio plano.** O design
   pedia preço no card do serviço contratado; `portal.meusServicos` não devolve preço, e buscá-lo
   é mexer no servidor, onde vale a ADR-118 (`Decimal` não atravessa o tRPC). O plano dizia, no
   item 6 dos riscos: *"se alguma precisar, pare e replaneje"*. Parou.

## O que só a tela mostrou (e nenhum revisor pegaria)

- **O selo "AMBIENTE LOCAL" caiu em cima da barra de seções.** Nenhum revisor de código encontraria
  isto: as duas peças estão certas cada uma por si, e o defeito é a soma — um elemento fixo no
  rodapé de um arquivo, outro elemento fixo no rodapé de outro. Só aparece com os dois na tela.
- **"Documentos" cortado em "Docume…"** com cinco itens a 360px. O teste-guarda permitia rótulos de
  até 11 caracteres e "Documentos" tem 10 — o limite estava certo para 11px de fonte e errado para
  cinco itens. **Medir na tela é o que fecha esse tipo de conta.**

## O que ficou aberto

- **O banco de e2e isolado (`medconsultoria_e2e`) não tem as exigências de credenciamento
  semeadas.** `flows-credenciamento-portal` falha lá com "Tudo enviado 0/0" e passa no banco de
  desenvolvimento. É lacuna daquele ambiente, não do código — mas quem rodar
  `pnpm test:e2e:isolado` vai tropeçar nela até alguém semear.
- **Espelhar no Início o aviso de que ninguém fala pela clínica** (ADR-131) — anotado como
  sugestão ao dono, fora do escopo desta rodada.
- **O e-mail de ação levando à seção certa** (proposta em `/portal`, exigência em
  `/portal/documentos`, papelada em `/portal/credenciamento`). Não é navegação, é conteúdo de
  e-mail; entra numa rodada própria se o dono quiser.
