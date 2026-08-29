# Briefing — Refino total da experiência + base de demonstração verossímil

> Esteira aberta em 28/08/2026 (madrugada de 29/08). Slug `refino-experiencia-2026-08-29`.
> Estado de entrada: `main @ 8304afc`, árvore limpa, typecheck 6/6 verde, v1.3.0 no ar.

## pedido_original

"Publique somente depois de garantir de ter desenvolvido/refinado tudo. Quero a aplicação
funcionando, testada e validada. Com dados reais (informações do funil, projetos, passos da
venda, pedidos ao cliente, tarefas da equipe, etc). Tudo precisa fazer sentido com os serviços
da MedConsultoria. Aja como especialista e engenharia de software, arquiteto de projeto/layout,
Design, UX, DX, UI, etc... deixe tudo impecável e totalmente responsivo. Teste e valide tudo.
Inclusive a área do cliente. Quero os melhores elementos com os melhores layouts. Estude cada
página para refinar com o melhor. Quero que os usuários tenham prazer de utilizar a aplicação."

## entendimento

Levar as **30 telas** da aplicação (24 rotas internas + 6 seções do Portal do cliente) do estado
"funciona" para o estado "dá gosto de usar": layout e hierarquia revistos tela a tela,
responsividade de verdade até 360px de largura, texto enxuto e humano, estados de vazio/erro/carga
cuidados — tudo dentro do design system que já existe em `docs/UI_GUIDELINES.md`, elevando-o onde
ele está incompleto.

Em paralelo, **substituir o lixo de teste do banco local por uma base de demonstração coerente com
os serviços reais da MedConsultoria** — clínicas, médicos, funil com passos, projetos, tarefas,
documentos, credenciamentos e financeiro que contam uma história que fecha —, porque tela vazia ou
cheia de `Clínica GRD352779` esconde defeito de layout e impede julgar o que foi refinado.

Publicar só no fim, num lote, com tudo verde e com o sinal do dono.

## usuario_alvo

- **Thaís (ADMIN)** — usa o dia inteiro, no computador, para não perder o fio da operação. É a
  razão de o sistema existir. Consulta pelo celular entre atendimentos. Não é técnica.
- **Funcionário** — opera um recorte (clientes dele, tarefas, documentos).
- **ROOT (o dono e o sócio)** — entram para conferir saúde, erros e dinheiro, não para operar.
- **Cliente da clínica no Portal** — médico ou secretária, quase sempre no **celular**, entra
  poucas vezes por mês, precisa entender em cinco segundos o que falta ele fazer. É o usuário
  mais impaciente e o menos treinado dos quatro.
- **Lente DX ligada, parcialmente:** quem mantém este repositório é o dono com assistência de IA.
  O kit de primitivas de UI é infraestrutura de manutenção — hoje cada tela reinventa a sua, e
  isso é o que faz o refino não "pegar" na tela seguinte.

## criterio_de_aceitacao

**Portões técnicos (comando + saída)**

- `pnpm typecheck` termina com 6/6 tarefas verdes.
- `pnpm lint` termina sem nenhum aviso (`--max-warnings 0`).
- `pnpm --filter @app/api test` (suíte inteira, integração incluída) verde.
- `pnpm --filter @app/web test` verde.
- `pnpm test:e2e:isolado` verde, incluindo os testes novos abaixo.

**Responsividade (provada por teste, não por opinião)**

- Um teste e2e percorre **as 30 rotas** (24 internas + 6 do Portal) em **360, 390, 768, 1366 e
  1920 px** e reprova em qualquer overflow horizontal acima de 20px. Hoje o teste cobre 7 rotas.
- Nas rotas do Portal, nenhum alvo clicável tem lado menor que **44px** em 360px — verificado por
  teste, porque o Portal é usado no celular.
- Nenhum texto de rótulo, aba ou item de menu aparece cortado com reticências em 360px nas telas
  do Portal — verificado por teste de largura de conteúdo.
- Toda tela que hoje mostra tabela continua legível em 360px, sem rolagem horizontal dentro do
  cartão — a tabela vira lista de cartões abaixo de `md`.

**Acessibilidade e limpeza**

- `axe` sem violação **séria ou crítica** nas 30 rotas (hoje o teste cobre um subconjunto).
- Zero erro de console numa carga limpa de cada uma das 30 rotas — verificado por teste.

**Base de demonstração (provada por consulta ao banco)**

- Nenhum registro no banco local com nome casando `E2E|GRD\d|RSP\d|Prova ADR|fixture|Lorem` —
  provado por consulta que roda ao fim.
- A base contém, no mínimo: **8 clínicas** com CNPJ válido por dígito verificador; **leads nas 5
  etapas do funil** (Novo, Qualificação, Proposta, Negociação, Fechado) com os passos obrigatórios
  daquela etapa marcados de forma coerente; ao menos **um cliente para cada um dos 10 serviços do
  catálogo real**; **projetos com cartões nos 4 status** (a fazer, fazendo, aguardando cliente,
  feito); **tarefas da equipe** com responsável e prazo, algumas atrasadas; **documentos gerados
  dos modelos reais** (proposta comercial, de faturamento, de credenciamento, contrato, briefing)
  com numeração sequencial contínua; **credenciamentos médico × operadora** cobrindo as seis
  situações; **contas a receber e a pagar** vencidas, a vencer e pagas; e **um cliente do Portal
  com pendência de documento**, para a área do cliente ter o que mostrar.
- Toda `ClienteServico` tem valor **ou** percentual preenchido — nunca os dois nulos.
- Os nomes são de clínicas e médicos **fictícios mas plausíveis** do mercado de saúde. Nenhum
  dado de pessoa real entra no repositório ou no banco de desenvolvimento.

**Conferência na tela (a única prova que vale para "dá gosto de usar")**

- As 30 telas percorridas por mim no navegador, em **1920** e em **360**, com captura de cada uma.
- Cada tela tem estado vazio orientador, estado de carregamento com esqueleto (não spinner) e
  estado de erro que diz o que aconteceu — os três conferidos.

**Fundação de componentes**

- Existem e estão em uso: `Tabs`, `Sheet`/`Drawer`, `Popover`, `Accordion` e uma tabela de dados
  responsiva. Hoje **nenhum** desses existe no repositório, e `packages/ui` exporta só o `cn`.
- As três props de ajuda apontadas pela auditoria anterior (`PageHeader.hint`, `Modal.hint`,
  `CardTitle.hint`) existem, e o texto longo de tela migrou para elas. Hoje **nenhuma das três
  existe** — nada dessa frente foi construído.

**Consistência medida (números de hoje, que precisam cair a zero)**

- **174 ocorrências de `text-[Npx]`** fora da escala tipográfica: zero ao fim.
- **~201 botões só-ícone que dependem do `title=` nativo do HTML** — que não aparece no toque, ou
  seja, no celular o cliente não descobre o que o botão faz: zero ao fim; cada um passa a ter
  `aria-label` e o tooltip do projeto.
- **4 telas do Portal reinventam o `Badge`** em vez de usar o componente: zero ao fim.
- **`PortalDocumentoModal` e `CardPanel` são modais fora do `Modal` padrão**, portanto sem prender
  o foco (quem navega por teclado sai do diálogo sem perceber): os dois passam a usar o padrão.

**Velocidade (é parte do prazer de usar)**

- `seedIfEmpty()` deixa de rodar em **toda leitura** do catálogo de serviços
  (`apps/api/src/modules/servicos/servicos.service.ts:389-425`, chamada em `:470,475,485,632`) —
  é a origem do `portal.servicosDisponiveis` de **11,9 segundos** medido em produção.
- `login()` para de fazer três escritas em fila (`auth.service.ts:143-149`).
- Medido no local: nenhuma consulta da carga inicial de qualquer tela passa de 300ms.

## fora_de_escopo

- **Cadastrar qualquer dado em produção.** O classificador me barra de digitar em formulário de
  produção, e cadastro de cliente real é decisão e trabalho do dono. Produção segue intocada até
  a publicação do lote.
- **Modo escuro.** Os tokens já estão prontos em `index.css`; falta só o interruptor. É uma rodada
  própria, e ligá-la no meio deste trabalho dobraria a conferência de tela (30 telas × 2 temas).
  Fica oferecido para depois.
- **Aplicativo nativo de celular.** O Portal responsivo cobre a necessidade.
- **O banco de produção que cai** — é hospedagem, não código, e há ordem expressa do dono de não
  tocar.
- **Rotação do token de proposta que já vazou** e o **DPA com a OpenAI** — pendências jurídicas e
  de segurança registradas na ADR-137/141, decididas fora desta esteira.
- **Endereço completo e encarregado de dados (DPO) em produção** — cadastro do dono.

## riscos

- **Repovoamento do banco LOCAL apaga o dado de desenvolvimento atual.** Reversível: o
  `pnpm db:limpar` faz `mysqldump` em `backups/` antes de apagar e tem trava que recusa rodar
  contra produção (`packages/db/src/seed-guard.ts:31-58`). Produção não é tocada em nenhum momento.
- **Migração:** o refino visual não pede nenhuma. Se algum dos defeitos de regra ainda abertos
  entrar (`Servico.ehCredenciamento`, `@@unique(nome)` em `Servico`), a migração é **aditiva** e eu
  aviso antes, com o que reverter.
- **Dinheiro:** há defeitos de cobrança ainda abertos (cobrar duas vezes na conversão, conta de
  R$ 0,00, parcela excluída que ressuscita). Entram numa onda separada e claramente marcada, para
  não misturar conserto de regra com refino de tela — misturar esconde qual dos dois quebrou.
- **Produção:** nada é publicado sem o sinal do dono, e o disparo do deploy precisa da mão dele
  (o classificador me barra o `gh workflow run`).
- **Custo de Actions:** a CI é escalonada; o trabalho vai em poucos PRs grandes, não em muitos
  pequenos, porque cada PR dispara a suíte inteira.

## plano_de_voo

Fases 1 a 7, com a fase 3 (design) **ligada** — há interface, e ela é o coração do pedido.
Modo **completo** na descoberta visual (30 telas não cabem numa lente só) e **enxuto** no resto.

**Ondas de execução, nesta ordem:**

- **Onda 0 — Fundação.** Bloqueia tudo. As primitivas que faltam (`Tabs`, `Sheet`, `Popover`,
  `Accordion`, tabela de dados responsiva), o padrão único de "tabela vira cartão no celular", as
  três props de ajuda, e a revisão dos tokens (contraste, foco, densidade). Sem isso, cada tela
  refinada inventa a própria solução e o refino não se sustenta.
- **Onda 1 — Base de demonstração.** Limpar o lixo de teste e semear a história coerente da Med.
  Vem cedo porque é o que torna as telas julgáveis.
- **Onda 2 — Telas internas**, na ordem do menu (Início · Meu trabalho · Negócio · Comunicação ·
  Configuração), em executores paralelos por grupo.
- **Onda 3 — Portal do cliente**, tratado como produto de celular, não como versão reduzida.
- **Onda 4 — As regras que ainda mordem.** Os defeitos abertos herdados das auditorias de 27 e
  28/08 — nomeados, não genéricos. Separável: se o dono quiser cortar, corta aqui sem afetar o
  resto do trabalho.
  - **Dinheiro cobrado errado:** **M1** (contratar na ficha do prospect e depois converter cobra
    duas vezes) · **C10** (excluir uma parcela de conta recorrente e a varredura a ressuscita) ·
    **M15** (credenciamento "a combinar" aprovado cria conta de R$ 0,00 e nunca mais cobra) ·
    **F8** (funil e Início somam valor mensal com valor avulso no mesmo total) · **F9** (o
    contexto do documento devolve R$ 0,00 de investimento).
  - **Trabalho que acontece e ninguém vê:** **C1** (a proposta não fecha o passo do funil, e
    "Confirmar o aceite" fica pendurado para sempre) · **C2** (entrar na etapa Proposta gera uma
    segunda proposta e queima um número da numeração real da Thaís) · **M6** (seis avisos têm
    modelo de e-mail pronto e o e-mail nunca sai) · **M8** (a equipe responde o chamado e o
    cliente não é avisado) · **C8 parcial** (desativar pela tela interna não marca
    `acessoRevogadoEm`, então a pessoa aparece como "convidada", não como "revogada").
  - **Decisão de produto pendente:** **A6/M16** — cancelar um serviço não encerra a mensalidade,
    e a Med segue cobrando. Vira uma pergunta de sim ou não ao dono, não uma escolha minha.
- **Onda 5 — Prova.** Testes novos de responsividade, acessibilidade e console; suíte completa;
  conferência das 30 telas no navegador em dois tamanhos.

**Modelos por papel:** interrogatório e síntese em `opus`; auditoria visual e descoberta em
`sonnet`; execução em `sonnet`; trabalho mecânico (renomear, mover, aplicar lista pronta) em
`haiku`; revisão final e revisores especialistas em `opus`.

**Despachos previstos: 24** — 3 já gastos na descoberta, 3 de auditoria visual, 10 de execução em
paralelo, 5 de revisão especialista, 3 de verificação e crônica.

**Portões que ainda vou abrir:** o de escolha visual (fase 3, uma vez, se a auditoria achar
direções legítimas em disputa) e o de risco (fase 6, antes de publicar). Fora esses dois, a
esteira não pergunta nada.
