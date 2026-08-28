# Achados da descoberta — 2026-08-28

Quatro auditorias em paralelo (Portal · Faturamento · Texto em excesso · Coerência de
fluxo). Cada item traz arquivo:linha. **ALTA** = dado errado, dinheiro errado, trabalho
perdido ou brecha de permissão.

---

## PARTE 1 — Faturamento é sempre e somente percentual mensal

Régua correta e única confiável: `ehServicoSomentePercentual` —
`packages/shared/src/estimativa.ts:129-131` (lê `temValorFixo`/`temPercentual`, `:111-118`).
O problema é que boa parte da aplicação não a consulta.

### ALTA
- **F1. Converter lead de Faturamento cria conta a receber AVULSA de valor fixo.**
  `apps/api/src/modules/leads/leads.service.ts:1359` + `servicos/credenciamento.service.ts:97`.
  `usarEstimativa` fica true porque o `Lead.valorEstimado` virou derivado (ADR-125).
  O comentário em `leads.service.ts:1325-1327` jura o contrário e envelheceu.
  Correção: `usarEstimativa` recusa quando a estimativa é derivada de percentual
  (lista `percentuais` não vazia com avulso=0 e mensal=0).
- **F2. A ficha mostra "Valor contratado R$ X" para quem só paga percentual.**
  `apps/web/src/features/crm/clientes/ClienteDetailPage.tsx:543`. O comentário :544-548
  diz que a soma dá zero — não dá mais. Decidir o ramo por `ehServicoSomentePercentual`.
- **F3. O editor de preço da ficha oferece Valor e Avulso/Mensal ao serviço percentual.**
  `ServicosContratadosCard.tsx:75-87` e `:59-60`. Gravar valor fixo faz
  `ehServicoSomentePercentual` virar false e reconfigura a cobrança em cadeia, em silêncio.
- **F4. O campo de % só existe se a categoria se chamar "Faturamento" (5a ocorrência).**
  `apps/web/src/features/crm/servicos/ServicosPage.tsx:100` (usado em :213 e :300).
  Impede 2o serviço percentual; renomear a categoria some com o %; o campo Valor segue
  visível. O teste de regressão `apps/api/src/test/preco-do-servico.test.ts:59-79` só
  guarda `PropostaServicosPicker.tsx` — estender a `ServicosPage.tsx` e
  `ServicosContratadosCard.tsx`.

### MÉDIA
- **F5.** Lead misturado descarta o percentual do valor do negócio. `packages/shared/src/estimativa.ts:87-89`.
- **F6.** `valorEstimado` derivado nunca é limpo. `leads.service.ts:320-326`.
- **F7.** "Nova oportunidade" pede valor fixo mesmo com serviço percentual. `NovaOportunidadeDialog.tsx:96-101`.
- **F8.** Funil e Início somam mensal derivado com avulso. `LeadsPipelinePage.tsx:86`, `dashboard.service.ts:194,262`.
- **F9.** Contexto de documento devolve R$ 0,00 de investimento. `documentos.service.ts:647,672`.
- **F10 (texto).** A ajuda ensina a regra errada: "Escolher Faturamento libera o %". `ServicosPage.tsx:207,288`.
- **F11 (texto).** Prévia do CONTRATO usa formato antigo do percentual. `NovoDocumentoDialog.tsx:516` vs `documentos.service.ts:187`.
- **F12 (texto).** Ajuda da condição de pagamento descreve tela removida na ADR-127. `ServicosPage.tsx:307-309`.
- **F13 (texto).** Card e painel do lead mostram valor percentual sem dizer "/mês". `LeadCard.tsx:116`, `LeadDetailPanel.tsx:134`.

### BAIXA
- **F14.** Recontratar serviço cancelado não reerda o percentual. `servicos-cliente.service.ts:122`.
- **F15.** Editor de preço grava `percentual: null`. `ServicosContratadosCard.tsx:61`.
- **F16.** `percentualRecorrencia` aceita AVULSO. `packages/shared/src/schemas/lead.ts:109,125,237`.
- **F17 (texto).** Comentário da semente autoriza valor fixo + %. `servicos.service.ts:91-92`.
- **F18 (texto).** IA recebe valor derivado como fechamento. `ia.service.ts:245`.
- **F19 (texto).** Comparação por categoria sobrevive na ficha. `ServicosContratadosCard.tsx:31`.
- **F20.** O Portal nunca mostra ao cliente o percentual aceito. `servicos-cliente.service.ts:363-383`.
- **F21.** Catálogo público devolve preço a anônimo. `servicos.router.ts:16` + `servicos.service.ts:463-483`.

### A trava que falta (fecha F3, F4 e parte de F15 num lugar só)
Não existe NENHUMA trava — banco (`schema.prisma:465-468`, sem CHECK), Zod
(`schemas/lead.ts:101-133`), servidor (`servicos.service.ts:485-543`) nem tela —
impedindo valor fixo + percentual no mesmo serviço. Fechar com `refine` em
`createServicoSchema` / `updateServicoSchema` / `atualizarContratacaoClienteSchema`
mais um interruptor "cobra percentual" desacoplado da categoria.

---

## PARTE 2 — Coerência de fluxo, lógica e automação

### ALTA
- **C1. Proposta pela ADR-132 não liga ao passo do funil; os marcos leem a coluna errada.**
  `leads.service.ts:348-352`, `documentos.service.ts:937,991`, `propostas.service.ts:155-163`.
  Na tela: "Confirmar o aceite" com círculo vazio ao lado do selo verde "Aceita"
  (`LeadDetailPanel.tsx:278-316`). Derivar de `situacaoDocumento`
  (`schemas/documento.ts:167-176`), ligar `documentoId` em `criarProposta`, e chamar
  `reconciliarPassosAuto` no aceite.
- **C2. Entrar na etapa "Proposta" gera uma SEGUNDA proposta e queima um número.**
  `documentos.service.ts:787-791`, `leads.service.ts:648-654,1250-1252`.
  A guarda deve procurar proposta por cliente, não pelo vínculo com o passo.
- **C3. A conversão provisiona pelo preço de CATÁLOGO, não pelo aceito.**
  `leads.service.ts:1262-1266,1335-1337`. Agravante: contrata TODOS os `lead.servicos`,
  não só os aceitos (`:1291`).
- **C4. Contratar na ficha com preço combinado gera conta pelo preço de tabela.**
  `servicos-cliente.service.ts:156-172`. E a guarda `:161` deixa serviço sem preço de
  catálogo sem conta nenhuma.
- **C5. Automação pós-aceite é `void ... .catch(() => {})`.** `propostas.service.ts:195-219`.
  Proposta ACEITA e ficha sem serviço, sem contrato, sem conta — e nada na tela avisa.
- **C6. SEGURANÇA: aceitar proposta e assinar contrato escapam das duas travas.**
  `propostas.router.ts:21` e `assinaturas.router.ts:25` são `publicProcedure`;
  `portal.service.ts:189-190` entrega os tokens a qualquer um. A secretária EQUIPE
  (ADR-131) e a sessão de suporte da Med (ADR-128) assinam contrato. A assinatura grava
  IP e user-agent, não quem clicou.
- **C7. Convite pela tela interna cria conta de Portal SEM papel — e nulo vale RESPONSAVEL.**
  `usuarios.service.ts:203-225,163-192`; regra em `packages/shared/src/portal-papeis.ts:79`.
- **C8. "Equipe e acessos" desativa conta de Portal sem `sobraResponsavel` e sem
  `acessoRevogadoEm`.** `usuarios.service.ts:298-305`, `listUsuarios:143-151`.
- **C9. A 2a proposta de credenciamento APAGA as linhas da 1a.**
  `credenciamento-grade.service.ts:148-155,192-201`. Escopar a exclusão ao documento ou
  à operadora enviada, nunca ao cliente inteiro.
- **C10. Excluir parcela pendente de conta recorrente é desfeito pelo próximo scan.**
  `contas.service.ts:223-234,260-283`.
- **C11. Aprovado -> encerrado -> nova tentativa -> aprovado cobra o honorário 2x.**
  `schemas/credenciamento.ts:346-353,384-387`, `credenciamento-grade.service.ts:262-264,391-401`.
- **C12. Lead PERDIDO que volta pelo site some, e o aviso manda "ver no funil".**
  `leads.service.ts:1457` (+ :1491, :728). Tratar recaptura de perdido como retomada.
- **C13. "Credenciamento só cobra no sucesso" pendura num NOME editável na tela.**
  `packages/shared/src/estimativa.ts:25,28-30`. Renomear o serviço em Ajustes religa a
  cobrança antecipada em três lugares. Ancorar em campo estável.

### MÉDIA — VERIFICADOS no código
M1 contratar no prospect + converter cobra 2x (`servicos-cliente.service.ts:156-186`) ·
M2 upsell aceito por cliente já convertido não vira dinheiro (`propostas.service.ts:195-219`) ·
M3 arrastar card zera o relógio de "lead parado" da coluna toda (`leads.service.ts:1210-1230`) ·
M4 automação avança lead PERDIDO (`leads.service.ts:121`) ·
M5 editar o texto da proposta não atualiza os itens (`documentos.service.ts:999-1012`) ·
M6 seis avisos têm template e o e-mail nunca sai (`emails.registry.ts:658-732`, nenhum em `EMAIL_CATEGORIAS`) ·
M7 `decidirEmailOperacional` ignora `minRole` (`listarPreferenciasEmail:140` filtra, a função pura não) ·
M8 cliente não é avisado quando a equipe responde o chamado (`mensagens.service.ts:375` só notifica autor CLIENTE) ·
M9 cliente ativo vê "Não tenho mais interesse" por causa de upsell (`portal.service.ts:116` não filtra `situacaoComercial`) ·
M11 `garantirAcessoPortal` diz "já tinha acesso" para e-mail de outra conta (`usuarios.service.ts:71-72`) ·
M14 painel diz "conta criada" para conta excluída (`schema.prisma:727` tem `SetNull`, mas `removeConta` é soft-delete — nunca dispara) ·
M15 credenciamento "a combinar" vira conta de R$ 0,00 sem volta (`criarContaDoHonorario` recebe `Number(atual.valor):263`, sem guarda de zero) ·
M17 trava `TITULO_ESPECIALISTA` declarada e nunca lida (`credenciamento.service.ts:478-480` só usa nos 3 alvarás/CNES) ·
M18 "Documento aguardando revisão" avisa que foi ASSINADO (`emails.registry.ts:474-477` vs `assinaturas.service.ts:172-178`) ·
M19 lead nasce sem dono e nada cobra atribuição (`leads.service.ts:1509`) ·
M20 a página pública não conta que criou acesso ao Portal (`CapturaLeadPage.tsx:51-66`).

> Nos itens M8, M9 e M14 os números de linha dos ARQUIVOS DE TELA
> (`PortalHome.tsx`, `AppLayout.tsx`, `credenciamento-painel.service.ts`) não foram
> conferidos — o defeito no servidor está verificado, a citação da tela não.

### ⚠️ HIPÓTESES — não verificadas, conferir antes de mexer
- **M10.** Depois de desistir, "Solicitar serviço" criaria lead novo em vez de retomar o
  perdido (`leads.service.ts:903-907`).
- **M12.** A tela do Portal não leria `papelPortal`, e a secretária só descobriria a
  proibição depois de confirmar o modal (`PortalHome.tsx:177-186`).
- **M13.** Desativar médico esconde a papelada — **metade confirmada**
  (`credenciamento.service.ts:421` filtra `ativo: true`); o efeito "progresso vai a 100%"
  NÃO foi confirmado.
- **M16.** Cancelar serviço não encerraria a mensalidade
  (`servicos-cliente.service.ts:293-298` vs `:169-179`).
- **B1.** "X de Y aprovado(s)" contaria tentativas negadas (`CredenciamentoGradeCard.tsx:72,81`).

### BAIXA — VERIFICADOS
B2 conta criada por automação nasce sem categoria (zero ocorrência de `categoriaId` nos 3 arquivos) ·
B3 `utm_term`/`utm_content`/`landing` coletados e jogados fora (`schemas/lead.ts:79-84`).

### ❌ RETIRADO — conferido e está errado
~~B4 módulo de suporte paralelo e morto.~~ `PortalSuporte.tsx:30` usa
`trpc.portal.suporte.listChamados`. O módulo **não** está morto. Ignorar.

> **Procedência.** A auditoria de fluxo foi escrita por um agente que, no meio do
> trabalho, redigiu parte do relatório como se duas sub-auditorias tivessem respondido —
> elas não responderam. Ele mesmo detectou, voltou atrás e conferiu item a item no código.
> A separação acima (verificado / hipótese / retirado) é o resultado dessa conferência.
> Os itens ALTA C1–C13 estão todos verificados.

### Conferido e SADIO — não mexer
Isolamento da carteira PESSOAL (`contas.service.ts:61-75`) · `Decimal -> number` (ADR-118)
em todos os caminhos lidos · âncora da recorrência mensal (31/01 correto) ·
`garantirClienteDoLead` idempotente · etapas do funil sem CRUD.

---

## PARTE 3 — Portal do cliente (mapa para o redesenho)

Página única `apps/web/src/features/portal/PortalHome.tsx` (544 linhas), **16 blocos
empilhados** em `max-w-4xl`, **sem roteador** (o Portal é escolhido por papel em
`App.tsx:89` e qualquer caminho cai nele), sem menu, sem abas, sem seção recolhível.
Shell em `PortalLayout.tsx:235-263` — cabeçalho com 2 controles (guia e perfil).
**6 usos de breakpoint em 2.300 linhas**; zero hambúrguer, drawer ou tab-bar.
**37 funcionalidades** mapeadas.

Peça reaproveitável: o drawer mobile do app interno, `AppLayout.tsx:414-432`.
`packages/ui` exporta só `cn` — não há Tabs, Sheet nem Drawer no repositório, e o único
componente de UI de terceiro é `cmdk`. A navegação do Portal terá de ser construída.

### Divisão proposta (5 seções — menu inferior no celular, abas no computador)
1. **Início** — o que pede ação: pendências, propostas, assinaturas, próxima reunião
2. **Documentos** — os da Med + os que o cliente enviou + os que faltam
3. **Credenciamento** — papelada por médico (só aparece se houver processo)
4. **Meus serviços** — contratados, convênios, checklists, catálogo para pedir mais
5. **Suporte** — conversa com a equipe + histórico de e-mails

*Equipe da clínica* e *Editar perfil* saem do corpo e vão para o menu do avatar.
Contador no ícone quando há pendência. O endereço passa a mudar junto (`/portal/...`).

---

## PARTE 4 — Texto em excesso

**A régua descoberta na auditoria:** até ~25 palavras vira tooltip; acima disso, encurtar
ou mandar para o Guia. Existe hoje um `hint` de ~40 palavras em
`ajustes/IdentidadeDialog.tsx:240` — parágrafo espremido num balão de 280px, que é o
contraexemplo do que não fazer.

**Camada limpa, 0 achados:** `components/` (inclusive `components/ui/`), `features/auth/`,
`features/captura/`. Os primitivos recebem texto por prop — é a camada mais disciplinada.

**Três props baratas que faltam e destravam o resto:** `PageHeader.hint`, `Modal.hint`,
`CardTitle.hint`.

**Leva 1 — 10 blocos, zero decisão de produto:** 6 remoções de `<p>` que duplicam um
`hint` vizinho · 3 frases repetidas de "Salvar alterações" · a duplicação entre
`PortalMinhaEquipe.tsx:65` e `:75`.

**Achados nomeados:** `email/EmailPage.tsx:140` (confirmação de 38 palavras) ·
`email/EmailPage.tsx:418,718` (`title=` nativo, que não é o tooltip do projeto e falha no
toque) · `ajustes/IdentidadeDialog.tsx:222` (36 palavras) · `EmailsAdminPage.tsx:351` (28).

**Buraco de granularidade:** o Portal tem **um único guia genérico** (`GuiaPortal.tsx`,
5 passos, ~130 palavras) para Serviços + Documentos + Suporte + Dados juntos, enquanto o
lado da equipe tem um guia por página (19 guias, 86 passos, média 30,6 palavras). Sem
dividir esse guia, o texto excedente do Portal não tem para onde ir — a alternativa vira
remover, não mover.

---

## PARTE 5 — Achado de produção (fora do escopo de código)

Conferido na tela em 28/08 como ROOT, em `workspace.medconsultoria.com.br`:

- **O banco cai de vez em quando.** Os 5 erros não resolvidos do painel são todos
  `Can't reach database server at localhost:3306` (o mais recente há 10 horas) e um
  esgotamento do pool (limite 13, timeout 10s).
- **A produção está lenta.** `portal.servicosDisponiveis` 11,9s de máximo;
  `auth.login` 9,9s; consultas de 4 a 12s. Para comparar, `leads.list` responde em 15ms —
  o código não é o gargalo.

Exige ordem do dono; é infraestrutura, não código da aplicação.
