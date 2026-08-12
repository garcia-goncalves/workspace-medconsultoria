## pedido_original

"A Thais olhou a proposta e ficou boa. Pode prosseguir com tudo o que está faltando.
Continue de onde você parou e desenvolva tudo para que possamos já começar a usar a
aplicação ao vivo (no servidor/domínio). Preciso que tudo esteja funcionando e
integrado/automatizado. Inclusive o Painel do Cliente (precisa tudo estar funcionando.
Inclusive os documentos que o cliente enviar pelo portal do cliente, o usuário
(funcionário) da MedConsultoria precisa enxergar no Card do cliente dentro da aplicação.
Tudo bem organizado e fácil de acessar. Aceito suas sugestões..."

Recorte desta esteira, escolhido pelo dono em 11/08/2026 entre três frentes propostas:
o **Painel de Credenciamentos**.

## entendimento

Uma tela nova, `/credenciamentos`, onde a Thaís vê num lugar só todos os credenciamentos
(cada cruzamento médico × operadora) de todos os clientes — hoje ela só enxerga isso
entrando cliente por cliente, um de cada vez. A tela abre destacando **o que está parado**
há tempo demais e permite mudar a situação sem sair dali. Enquanto essa visão não existir,
ela mantém a planilha paralela e o sistema não substitui o caos: vira mais um lugar para
olhar.

## usuario_alvo

Thaís, sócia da MedConsultoria, no começo do dia, perguntando "o que travou e o que
preciso cobrar hoje?". Também ADMIN e FUNCIONARIO que tocam credenciamento. Não é
desenvolvedora e não deve precisar aprender conceito novo: a tela tem que se explicar na
primeira olhada. A lente DX não se aplica.

## criterio_de_aceitacao

Cada item abaixo é provável por um comando, um teste ou uma olhada na tela.

- A rota `/credenciamentos` abre e aparece no menu lateral, no grupo **Negócio**.
- `pnpm --filter @app/web test` passa, inclusive `paginas.test.ts` (página nova é obrigada
  a escolher um grupo do menu — ADR-94).
- `e2e/menu-sem-scroll.spec.ts` continua verde: o menu não passa a rolar por causa do item
  novo.
- A tela lista **uma linha por credenciamento** de **todos** os clientes, mostrando:
  médico, operadora, cliente, situação, há quantos dias está parado e valor.
- Credenciamento parado há **60 dias ou mais** aparece marcado como atrasado, e a tela
  **abre ordenada com os atrasados primeiro**. O número **60 veio da Thaís** em 11/08/2026
  ("a partir de 60 dias precisamos ficar de olho") e substitui o palpite inicial de 30.
- O prazo de 60 dias é **editável em Ajustes → Dados da empresa** e a tela respeita o valor
  gravado (mudar para 30 muda quem aparece marcado, sem alterar código).
- Os filtros de operadora, cliente e situação funcionam **combinados** (operadora X +
  situação "em análise" devolve só a interseção).
- Dá para mudar a situação direto na linha, e as travas do ADR-104 continuam valendo:
  `NEGADO` **não** volta a `APROVADO` por edição, e aprovar **cria a conta a receber**
  (se a criação da conta falhar, a aprovação falha junto — não é best-effort).
- O rodapé mostra o total por situação e a soma dos valores.
- Testes novos cobrindo, no mínimo: cálculo de "parado há N dias" a partir das datas de
  transição; ordenação com atrasados primeiro; e a recusa de `NEGADO → APROVADO`.
- Médico desativado com credenciamento em curso continua visível e marcado, e não some da
  tela (é o defeito 1 do ADR-105 — listar por `ativo:true` apaga o que foi preservado de
  propósito).
- Zero texto em inglês em tela.
- Legível em 360px de largura (a tabela rola dentro do próprio quadro, a página não rola
  de lado).
- `pnpm --filter @app/api test:unit` e `pnpm typecheck --force` verdes; CI verde antes do
  merge.

## fora_de_escopo

- Relatório e exportação (PDF/Excel) do painel — sai numa rodada própria se ela pedir.
- Gráfico e visão financeira consolidada de credenciamento: o foco escolhido foi "o que
  está parado", não "quanto dinheiro está por vir".
- Formato de quadro arrastável (estilo funil): recusado na fase 1 em favor da lista com
  filtros, que aguenta centenas de linhas.
- Aviso automático por e-mail quando um credenciamento passa do prazo — a tela marca; ela
  decide. Automatizar cobrança sem ela pedir seria decidir pelo negócio dela.
- As outras duas frentes propostas (correção das 10 falhas altas de dependência; varredura
  tela por tela) — ficaram acordadas para depois desta.

## riscos

Sim, três, e todos exigem ramo separado com ponto de retorno:

1. **Mudança na estrutura do banco (migration)**: campo novo em `IdentidadeInstitucional`
   para guardar o prazo de alerta em dias. Migration em projeto que já está no ar em
   produção.
2. **Dinheiro**: mudar situação para `APROVADO` cria conta a receber no Financeiro. Um
   clique errado na tela nova vira lançamento financeiro real.
3. **Produção**: o resultado será publicado no servidor que já atende em
   workspace.medconsultoria.com.br.

Não toca dado de paciente nem prontuário. Não toca autenticação nem pagamento externo.

## plano_de_voo

Fases 1 a 7, com a fase 3 (design) **ligada e reduzida**: a tela nasce dentro de um
aplicativo com identidade visual já definida e tokens em uso, então não há painel de
direções visuais a escolher — o portão 3 não se aplica, e o trabalho de design é aplicar o
padrão existente (tabela, filtros, selos de situação) já usado no `CredenciamentoGradeCard`.

**Modo enxuto.** Esta sessão está configurada para não despachar subagentes, então as
lentes da descoberta, a revisão de código por especialidade e a verificação de tela são
feitas pelo condutor, em passes separados e declarados — não diluídos no meio da
implementação. **Despachos previstos: 0.** O dono foi avisado disto no portão 1 e pode
pedir revisores independentes a qualquer momento.

Verificação de tela feita ao vivo com Playwright, no navegador, com dados de teste do
próprio banco local — foi o que achou os cinco defeitos do ADR-105 que os 338 testes
automáticos não pegavam.

Portões desta esteira: **portão 1** (este briefing) e **portão 4** (risco: migration +
dinheiro + produção), este último como uma pergunta de sim ou não antes de publicar.
