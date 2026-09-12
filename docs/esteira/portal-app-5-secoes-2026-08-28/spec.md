# Spec — O Portal do cliente vira aplicativo, em 5 seções

- **slug:** portal-app-5-secoes-2026-08-28 · **data:** 2026-08-28 · **fase:** 2 (Descoberta)
- **entrada:** `docs/esteira/portal-app-5-secoes-2026-08-28/briefing.md` (aprovado) e
  `docs/esteira/refino-final-2026-08-28/achados.md` PARTE 3 (`:162-176`)
- **método:** leitura integral dos 13 arquivos de `apps/web/src/features/portal/`, de
  `App.tsx`, do roteador, dos dois testes-guarda de catálogo e das réguas do servidor.
  Nenhum arquivo foi editado.

---

## problema

Quem entra no Portal é o médico ou a secretária da clínica, do celular, poucas vezes por
mês, com pressa e sem treinamento. O que ele encontra é **uma página só** — 16 blocos
empilhados dentro de `max-w-4xl` (`apps/web/src/features/portal/PortalHome.tsx:155-558`,
com o shell em `PortalLayout.tsx:235-263`) — e para achar qualquer coisa ele rola. Não há
menu, aba, seção recolhível, nem endereço: a URL é sempre a mesma, o botão "voltar" do
navegador não faz nada dentro do Portal, e recarregar devolve o topo da página.

Três consequências medidas, não supostas:

1. **Não existe tratamento de celular.** São **9 ocorrências de breakpoint em 7 linhas**,
   em 4 dos 13 arquivos (`PortalHome.tsx` 4× `sm:`, `PortalLayout.tsx` 3× `sm:` + 1× `md:`,
   `PortalDocumentoModal.tsx` 1× `sm:`), sobre **2.316 linhas** de Portal. Zero hambúrguer,
   zero drawer, zero barra inferior. A tela de quem quase só usa celular é a única da
   aplicação que nunca foi desenhada para celular.
2. **Tudo carrega sempre.** `PortalHome` dispara `portal.resumo` (`:73`), `portal.emails`
   (`:78`) e `portal.servicosDisponiveis` (`:97`) juntas, mais as consultas dos quatro
   componentes filhos. Em produção `portal.servicosDisponiveis` leva **11,9 s** (medido em
   *SISTEMA → Desempenho*, 28/08) — e ela alimenta um bloco que quase ninguém abre.
3. **A régua de papel não chegou à tela.** O servidor separa RESPONSAVEL de EQUIPE desde a
   ADR-131 e endureceu na ADR-137, mas quatro botões do Portal ainda são oferecidos a quem
   o servidor vai recusar (achado **M12** — ver `## m12`).

O risco de mexer nisso é o inverso do problema: hoje a página única **garante** que tudo
está visível por rolagem. Distribuir em seções pode fazer uma funcionalidade desaparecer
sem ninguém notar. É por isso que a entrega central desta spec é o mapa
`## mapa_bloco_para_secao`, com destino escrito para cada item.

## solucao

O Portal passa a ser um aplicativo de **5 seções com endereço próprio**, navegado por uma
barra inferior fixa no celular e pela mesma divisão no computador:

| # | Seção | Endereço | O que reúne |
|---|---|---|---|
| 1 | Início | `/portal` | o que pede ação: atendimento, propostas, assinaturas, o que depende de você, projetos, próximas reuniões |
| 2 | Documentos | `/portal/documentos` | os que a Med preparou + os que o cliente enviou |
| 3 | Credenciamento | `/portal/credenciamento` | a papelada por médico — **só existe quando há processo** |
| 4 | Meus serviços | `/portal/servicos` | contratados, convênios, checklists e o catálogo para pedir mais |
| 5 | Suporte | `/portal/suporte` | conversa com a equipe + histórico de e-mails |

Fora da barra, no **menu do avatar**: *Equipe da clínica* (`/portal/equipe`) e *Editar
perfil* (o modal que já existe).

**Por que esta forma, e não abas dentro da mesma página.** Três razões, todas verificáveis
no código de hoje:

- **O endereço é o que faz o "voltar" funcionar.** O critério do briefing pede recarregar
  e voltar na mesma seção; sem rota isso é estado em memória, que morre no F5.
- **A seção é o único corte que resolve o custo.** Com rotas, `portal.servicosDisponiveis`
  (11,9 s) só é disparada em *Meus serviços* e `portal.emails` só em *Suporte* — hoje as
  duas são obrigatórias para abrir o Portal (`PortalHome.tsx:78,97`).
- **A condição de existir do Credenciamento já é do servidor.**
  `credenciamentoParaOPortal` devolve `null` para quem não tem processo
  (`apps/api/src/modules/servicos/credenciamento.service.ts:600-611`, a guarda em `:603`).
  A mesma resposta que hoje some com o card passa a sumir com o item do menu — nenhuma
  regra nova, nenhum campo novo.

Nada de regra de negócio muda: aceite, assinatura, contratação e cancelamento continuam
como as ADR-137 e ADR-138 os deixaram. O único conserto de comportamento é o **M12**, que
o briefing incluiu no critério de aceitação — e ele é sobre *avisar antes*, não sobre
mudar quem pode o quê.

## o_que_ja_existe

### O Portal, arquivo por arquivo (2.316 linhas, 13 arquivos)

| Arquivo | Linhas | O que é |
|---|---|---|
| `apps/web/src/features/portal/PortalHome.tsx` | 560 | a página única — 16 blocos + 1 modal |
| `apps/web/src/features/portal/PortalLayout.tsx` | 264 | shell: faixa de suporte, cabeçalho, menu do avatar, modal de perfil, guia |
| `apps/web/src/features/portal/PessoasDoPortal.tsx` | 360 | a lista de pessoas da clínica, compartilhada com a ficha interna |
| `apps/web/src/features/portal/BriefingDialog.tsx` | 176 | o formulário/briefing preenchido na tela |
| `apps/web/src/features/portal/PortalCredenciamento.tsx` | 175 | a papelada por médico |
| `apps/web/src/features/portal/PortalServicos.tsx` | 168 | serviços contratados + checklists |
| `apps/web/src/features/portal/PortalSuporte.tsx` | 146 | chamados e conversa |
| `apps/web/src/features/portal/SuporteChat.tsx` | 109 | a bolha de mensagem |
| `apps/web/src/features/portal/PortalMeusDocumentos.tsx` | 106 | os arquivos que o cliente enviou |
| `apps/web/src/features/portal/PortalMinhaEquipe.tsx` | 93 | "Quem da clínica entra aqui" (ADR-131) |
| `apps/web/src/features/portal/PortalDocumentoModal.tsx` | 66 | leitura do documento em A4 + imprimir/Word |
| `apps/web/src/features/portal/FaixaDeSuporte.tsx` | 48 | a faixa "vendo como X" (ADR-128) |
| `apps/web/src/features/portal/GuiaPortal.tsx` | 45 | o guia "?" — hoje **um só**, genérico |

### Onde o Portal é escolhido, hoje

`apps/web/src/App.tsx:86-100` — a decisão inteira:

```tsx
    <AuthProvider value={authValue}>
      <DialogsProvider>
        {me.data.role === "CLIENTE" ? (
          <SobDemanda>
            <PortalLayout>
              <PortalHome />
            </PortalLayout>
          </SobDemanda>
        ) : (
          <RouterProvider router={router} />
        )}
```

- O caminho é ignorado: **qualquer** URL de um `CLIENTE` renderiza o Portal.
- Antes disso, `App.tsx:49-58` resolve as rotas **públicas** por `window.location.pathname`
  — `/definir-senha`, `/esqueci-senha`, `/redefinir-senha`, `/comecar`, `/assinar/:token`
  (`:57`) e `/proposta/:token` (`:58`). Elas rodam **antes** do `auth.me` e continuam
  valendo para quem está logado — é por `/assinar/:token` que o responsável assina.
- `PortalLayout` e `PortalHome` já são carregados sob demanda (`App.tsx:23-24`), pelo motivo
  escrito em `App.tsx:7-15`: a tela do cliente não deve viajar no pacote da equipe.

### O roteador do app interno

`apps/web/src/app/router.tsx` — 24 rotas, todas filhas de **um** `rootRoute` cujo
`component` é o `AppLayout` (`:55`), que renderiza `<Outlet/>` em
`apps/web/src/components/layout/AppLayout.tsx:507,513`. O tipo é registrado uma única vez
em `router.tsx:275-279` (`interface Register { router: typeof router }`). Versão instalada:
`@tanstack/react-router` **1.170.17** (`apps/web/package.json:24` pede `^1.95.1`).

### Os dois testes-guarda que leem o roteador

Isto é o achado que mais restringe o desenho, e não está no `achados.md`:

- `apps/web/src/lib/paginas.test.ts:15-20` lê **o texto de `apps/web/src/app/router.tsx`**
  e extrai `path:\s*"(\/[a-z-]*)"`. Depois exige que toda rota extraída esteja em `PAGINAS`
  (`:23-27`) e tenha grupo de menu ou exceção declarada em `FORA_DO_MENU` (`:71-78`,
  `:83-89`).
- `apps/web/src/components/GuiaTour.test.ts:14-18` faz **a mesma leitura do mesmo arquivo**
  e exige que toda rota tenha guia próprio (`:21-25`), com ≥2 passos e texto de verdade
  (`:56-67`).

Ou seja: **os dois catálogos do app interno são cobrados a partir do conteúdo de um arquivo
específico**. Consequência em `## rotas`.

### A régua de papel, que já é pura e já está num lugar só

`packages/shared/src/portal-papeis.ts`:

- `ACOES_LIBERADAS_PARA_EQUIPE` (`:54-67`) — lista de **liberações**, padrão **negar**:
  `atualizarMeusDados`, `confirmarReuniao`, `briefing.salvar`, `removerArquivo`,
  `suporte.abrir`, `suporte.enviar`. Tudo o mais é do RESPONSAVEL.
- `podeNoPortal(papel, acao)` (`:78-81`) — papel nulo vale RESPONSAVEL.
- `podeAssinarPelaClinica(sessao)` (`:160-167`) — a régua da ADR-137, que barra a sessão de
  suporte e a conta EQUIPE.

O guarda do servidor está em `apps/api/src/trpc/trpc.ts:81-115`, com **duas** condições:
`operador` barra toda mutação (`:98-100`) e `podeNoPortal` barra as não liberadas
(`:110-112`). Leitura é livre para os dois papéis, de propósito (`:108-109`).

A sessão já entrega à tela tudo o que essa régua precisa:
`packages/shared/src/types.ts:18` (`papelPortal`) e `:22-25` (`operador`) — e a tela já os
lê em `PortalMinhaEquipe.tsx:56` e `FaixaDeSuporte.tsx:311`.

### O que o servidor já devolve pronto

- `portal.resumo` (`apps/api/src/modules/portal/portal.service.ts:54-204`) devolve
  `clienteNome`, `projetos`, `aguardandoVoce`, `documentos`, `reunioes`, `atendimento`,
  `podeDesistir`, `atendimentoEncerrado`, `servicosAtuais`, **`podeAssinar`** (`:201`),
  `paraAssinar` (`:202`) e `propostas` (`:203`). O token só sai para quem pode agir
  (ADR-137, comentário em `:56-62`).
- `portal.credenciamento` → `credenciamento.service.ts:600-611`, **`null` sem processo**
  (`:603`), e `progresso` com `total/atendidas/faltam/percentual` (`:582-587`).
- `portal.meusServicos` → cada serviço traz `pendentes` (lido em `PortalServicos.tsx:70`).
- `portal.suporte.listChamados` → cada chamado traz `naoLidas` (lido em
  `PortalSuporte.tsx:203`).
- Roteador tRPC completo do Portal: `apps/api/src/modules/portal/portal.router.ts:24-124`
  — 24 procedimentos, todos `portalProcedure`.

### O vocabulário visual disponível

- `packages/ui/src/index.ts` tem **uma linha**: `export { cn } from "./cn.js";` — e
  `packages/ui/src/` só contém `cn.ts` e `index.ts`. **Confirmado: não há Tabs, Sheet nem
  Drawer no repositório.**
- Mas o Portal já usa, de `apps/web/src/components/ui/`: `Card`/`CardHeader`/`CardTitle`/
  `CardContent`, `Button`, `Modal`, `Input`, `Label`, `Select`, `Badge`, `Textarea`,
  `Skeleton`, `Avatar`/`AvatarUpload`, `MaskedInput`, `UploadArquivo`/`ArquivoLink`,
  `useConfirm`/`usePrompt`, `toast`. **O que falta construir é a barra inferior — só ela.**
- O drawer mobile do app interno está em
  `apps/web/src/components/layout/AppLayout.tsx:414-432` (o caminho no `achados.md` está
  abreviado; as linhas conferem). Reaproveita-se o **padrão** — `fixed inset-0 z-50
  md:hidden` + backdrop `animate-fade-in` + `animate-slide-in-right` —, não o componente:
  ele desenha `SidebarConteudo` com os grupos de `paginas.ts` e `Link` tipado no roteador
  interno. Uma barra inferior não é um drawer.
- Empilhamento de camadas que a barra inferior terá de respeitar: faixa de suporte
  `sticky top-0 z-40` (`FaixaDeSuporte.tsx:314`), cabeçalho `sticky top-0 z-30`
  (`PortalLayout.tsx:242`), modais `z-50` (`PortalDocumentoModal.tsx:23`).

### Os e2e que já cobrem o Portal

- `e2e/flows-portal.spec.ts:17-18` — `goto("/")` e exige `heading /Portal/i`.
- `e2e/flows-portal.spec.ts:22-23` — **`goto("/financeiro")` e exige o mesmo cabeçalho**:
  o "qualquer caminho cai nele" é contrato testado.
- `e2e/flows-portal-ui.spec.ts:15-46` (briefing na tela) e `:50-59` (cancelar serviço) —
  os dois partindo de `goto("/")`; passam a precisar de `/portal/servicos`.
- `e2e/flows-credenciamento-portal.spec.ts:56,91` — `goto("/")`, idem para
  `/portal/credenciamento`.
- `e2e/flows-pessoas-do-portal.spec.ts` — usa o lado **interno** (`/clientes`), não muda.

## mapa_bloco_para_secao

Contagem real, conferida na leitura: **16 blocos** de primeiro nível em `PortalHome.tsx`
(o `achados.md:164` acerta) — a saudação mais 15 cartões — **mais 1 modal** (`:557`), e
**6 elementos de shell** em `PortalLayout.tsx`. Destrinchados em funcionalidades
endereçáveis, são **53 linhas**, e não 37: o `achados.md:169` contou num nível mais
grosso. Nenhuma das 37 se perde — as 53 as contêm.

Coluna *visível para quem*: **os dois** = RESPONSAVEL e EQUIPE (a trava é sobre agir, não
sobre ver — `portal-papeis.ts:17-21`).

| bloco | onde está hoje (arquivo:linha) | seção de destino | visível para quem | condição de aparecer | observação |
|---|---|---|---|---|---|
| 1. Faixa "vendo como X" + "Voltar ao meu acesso" | `PortalLayout.tsx:241` → `FaixaDeSuporte.tsx:299-332` | shell (todas) | os dois | `user.operador` não nulo | ADR-128. `sticky top-0 z-40`; a barra inferior não pode disputar camada com ela |
| 2. Logotipo no cabeçalho | `PortalLayout.tsx:244` | shell | os dois | sempre | no celular divide espaço com o título da seção |
| 3. Botão "?" (guia) | `PortalLayout.tsx:246-253` | shell | os dois | sempre | passa a abrir o guia **da seção** — ver `## guia_por_secao` |
| 4. Menu do avatar | `PortalLayout.tsx:254`, def. `:18-70` | shell | os dois | sempre | ganha o item novo *Equipe da clínica* |
| 5. "Editar perfil" (item do menu) | `PortalLayout.tsx:52-57` | menu do avatar | os dois | sempre | já está no lugar pedido pelo briefing; nada muda |
| 6. Modal Editar perfil (foto/logo, CNPJ com dígito, telefone, e-mail só leitura, aviso LGPD) | `PortalLayout.tsx:77-233`, montado em `:260` | menu do avatar | os dois | ao abrir | `atualizarMeusDados` é liberado à EQUIPE (`portal-papeis.ts:57`) |
| 7. "Sair" | `PortalLayout.tsx:58-64` | menu do avatar | os dois | sempre | |
| 8. Modal do guia | `PortalLayout.tsx:261` → `GuiaPortal.tsx:282-284` | shell | os dois | ao abrir | conteúdo passa a variar por seção |
| 9. Saudação "Bem-vindo(a) ao seu Portal 👋" + nome | `PortalHome.tsx:157-162` | Início | os dois | sempre | ⚠️ `e2e/flows-portal.spec.ts:18,23` casa `heading /Portal/i` — manter "Portal" no `h1` do Início ou atualizar os dois testes |
| 10. Card "Seu atendimento" (etapa do funil + barra) | `PortalHome.tsx:165-199` | Início | os dois | `r.atendimento` ≠ null (prospect no funil) | rótulos amigáveis em `:35-41` |
| 11. Botão "Não tenho mais interesse" | `PortalHome.tsx:185-196`, ação `:109-121` | Início | **RESPONSAVEL** | `r.podeDesistir` | ⚠️ **M12**: hoje aparece para EQUIPE e falha depois do modal. `desistir` fora de `ACOES_LIBERADAS_PARA_EQUIPE`. (Que cliente **ativo** o veja é o achado M9 — fora de escopo) |
| 12. Card "Atendimento encerrado" + "Quero retomar" | `PortalHome.tsx:202-219`, ação `:123-133` | Início | **RESPONSAVEL** | `r.atendimentoEncerrado` | ⚠️ M12 vale aqui: `retomar` também está fora da lista |
| 13. Card "Propostas para você" | `PortalHome.tsx:278-308` | Início | os dois | `r.propostas.length > 0` | o **item** aparece para os dois; o botão vira a frase "Só o responsável pela clínica responde" (`:26`, `:302`) quando não há token — ADR-137, já feito |
| 14. Card "Documentos para assinar" | `PortalHome.tsx:311-341` | Início | os dois | `r.paraAssinar.length > 0` | idem, com "Só o responsável pela clínica assina" (`:27`, `:335`) |
| 15. Card "O que depende de você" | `PortalHome.tsx:344-371` | Início | os dois | `r.aguardandoVoce.length > 0` | ⚠️ o rodapé `:367-369` diz *"pelo Suporte, aqui embaixo"* — com seções isso deixa de ser verdade; vira link para `/portal/suporte` |
| 16. Card "Seus projetos" (progresso, previsão, próxima reunião) | `PortalHome.tsx:373-424` | Início | os dois | sempre (tem vazio próprio `:379-383`) | o briefing não nomeia "Projetos"; Início é o único destino que não inventa seção |
| 17. Card "Próximas reuniões" | `PortalHome.tsx:495-555` | Início | os dois | sempre (vazio `:501-505`) | |
| 18. "Confirmar presença" | `PortalHome.tsx:525-531` | Início | os dois | reunião sem `clienteConfirmadoEm` | `confirmarReuniao` é liberado à EQUIPE (`portal-papeis.ts:58`) |
| 19. "Adicionar à agenda" (.ics gerado no navegador) | `PortalHome.tsx:533-539`, fn `:43-70` | Início | os dois | sempre | 100% cliente, sem servidor |
| 20. "Entrar" (link da reunião) | `PortalHome.tsx:540-549` | Início | os dois | `ev.linkReuniao` | |
| 21. Card "Documentos da MedConsultoria" | `PortalHome.tsx:426-474` | Documentos | os dois | sempre (vazio `:435-439`) | fonte: `resumo.documentos` |
| 22. Selo Aceita/Assinado/Recusada | `PortalHome.tsx:457-468` (`situacaoDocumento`) | Documentos | os dois | conforme a situação | régua compartilhada de `@app/shared` |
| 23. Modal de leitura do documento (A4, imprimir, baixar Word) | `PortalHome.tsx:74,445,557` → `PortalDocumentoModal.tsx:12-66` | Documentos | os dois | ao clicar no documento | usa `DocumentoBranded` + `imprimirDocumento` (ADR-129) |
| 24. Card "Seus documentos" (o que o cliente enviou) | `PortalHome.tsx:477` → `PortalMeusDocumentos.tsx:190-281` | Documentos | os dois | sempre (vazio `:224-227`) | |
| 25. Upload avulso | `PortalMeusDocumentos.tsx:222` | Documentos | os dois | sempre | o `/upload` repete a trava da ADR-128 fora do tRPC |
| 26. Contexto do arquivo (requisito · lado · médico) + selo Você/MedConsultoria | `PortalMeusDocumentos.tsx:234-263` | Documentos | os dois | sempre | conserto da ADR-105 (seis "Diploma" iguais) |
| 27. Remover arquivo (só o enviado pelo cliente) | `PortalMeusDocumentos.tsx:264-272`, ação `:201-211` | Documentos | os dois | `enviadoPorTipo === "CLIENTE"` | `removerArquivo` liberado à EQUIPE (`portal-papeis.ts:63`) |
| 28. Card "Documentos do credenciamento" | `PortalHome.tsx:229` → `PortalCredenciamento.tsx:114-174` | Credenciamento | os dois | **`portal.credenciamento !== null`** (`credenciamento.service.ts:603`) | ⚠️ **é esta a fonte da condição do item de menu** — a mesma consulta, sem campo novo |
| 29. Barra de progresso por PARES (documento × médico × lado) | `PortalCredenciamento.tsx:124-139` | Credenciamento | os dois | sempre na seção | `progresso.faltam` alimenta o contador do menu |
| 30. "Precisamos disto para seguir" (pendências da triagem) | `PortalCredenciamento.tsx:141-152` | Credenciamento | os dois | `dados.pendencias.length > 0` | o cliente nunca lê "inapto" (ADR-103) |
| 31. Grupos por escopo (clínica/empresa) | `PortalCredenciamento.tsx:154-159` | Credenciamento | os dois | há grupos | |
| 32. Bloco por profissional | `PortalCredenciamento.tsx:161-171` | Credenciamento | os dois | há profissionais | é o que justifica tela própria |
| 33. Upload por vaga (frente/verso, por médico) | `PortalCredenciamento.tsx:83-92` | Credenciamento | os dois | vaga sem arquivo | |
| 34. Remover arquivo do credenciamento | `PortalCredenciamento.tsx:74-80`, ação `:49-57` | Credenciamento | os dois | vaga com arquivo | |
| 35. Card "Seus serviços" | `PortalHome.tsx:225` → `PortalServicos.tsx:58-167` | Meus serviços | os dois | `meusServicos.length > 0` (`:34` devolve `null`) | prospect sem serviço não vê nada — a seção precisa de estado vazio próprio, que hoje não existe |
| 36. Selo "Faltam N documentos" / "Tudo enviado" | `PortalServicos.tsx:70-78` | Meus serviços | os dois | sempre por serviço | `pendentes` alimenta o contador do menu |
| 37. "Cancelar serviço" | `PortalServicos.tsx:79-84`, ação `:36-47` | Meus serviços | **RESPONSAVEL** | serviço contratado | ⚠️ **M12**: `cancelarServico` fora da lista de liberações |
| 38. "Convênios atendidos" | `PortalServicos.tsx:89-94` | Meus serviços | os dois | `s.convenios.length > 0` | ADR-126. Que o **percentual** aceito não apareça é o achado F20 — fora de escopo |
| 39. Checklist "O que precisamos de você" | `PortalServicos.tsx:96-161` | Meus serviços | os dois | `s.requisitos.length > 0` | |
| 40. Upload por requisito | `PortalServicos.tsx:146-153` | Meus serviços | os dois | requisito `DOCUMENTO` | |
| 41. Remover arquivo do requisito | `PortalServicos.tsx:133-141` | Meus serviços | os dois | arquivo do cliente | |
| 42. Formulário/briefing na tela (rascunho, enviar, baixar) | `PortalServicos.tsx:119-125` → `BriefingDialog.tsx:21-176` | Meus serviços | os dois | requisito ≠ `DOCUMENTO` | `briefing.salvar` liberado à EQUIPE (`portal-papeis.ts:62`) |
| 43. Card "O que você precisa?" (catálogo de autosserviço) | `PortalHome.tsx:232-275` | Meus serviços | **RESPONSAVEL** | `catalogo.data.length > 0` | ⚠️ **M12**: `solicitarServicos` fora da lista. ⚠️ é a consulta de **11,9 s** em produção — carregá-la só nesta seção é o maior ganho de desempenho do redesenho |
| 44. "Você já pediu: …" | `PortalHome.tsx:246-250` | Meus serviços | os dois | `r.servicosAtuais.length > 0` | |
| 45. Card "Suporte" | `PortalHome.tsx:222` → `PortalSuporte.tsx:116-239` | Suporte | os dois | sempre | `suporte.abrir` e `suporte.enviar` liberados à EQUIPE (`portal-papeis.ts:65-66`) |
| 46. Lista de chamados + contador de não lidas | `PortalSuporte.tsx:191-207` (`c.naoLidas` em `:203`) | Suporte | os dois | há chamados (vazio `:208-213`) | alimenta o contador do menu |
| 47. "Abrir chamado" (modal assunto + mensagem) | `PortalSuporte.tsx:166-169`, modal `:215-236` | Suporte | os dois | fora da conversa | |
| 48. Conversa do chamado (polling + tempo real) | `PortalSuporte.tsx:172-186` → `SuporteChat.tsx` | Suporte | os dois | chamado selecionado | `useEventoRealtime` em `:145-148` |
| 49. "Meus chamados" (voltar da conversa) | `PortalSuporte.tsx:161-165` | Suporte | os dois | dentro de uma conversa | com rotas, o "voltar" do navegador passa a ser um segundo caminho — decidir um só |
| 50. Card "Seus e-mails" | `PortalHome.tsx:483-493` (`portal.emails` em `:78`) | Suporte | os dois | sempre (vazio pelo `EmailsEnviadosList`) | o briefing já o coloca em Suporte |
| 51. Card "Quem da clínica entra aqui" | `PortalHome.tsx:481` → `PortalMinhaEquipe.tsx:20-93` | menu do avatar (`/portal/equipe`) | os dois | sempre | EQUIPE **vê e não mexe** (`podeEditar={souResponsavel}`, `:56,74`) — já correto hoje |
| 52. Convidar / alterar papel / revogar / devolver / reenviar convite | `PortalMinhaEquipe.tsx:28-51` → `PessoasDoPortal.tsx:275-360` | menu do avatar | **RESPONSAVEL** | `podeEditar` | ADR-131. Que o convite nasça sem papel é o achado C7 — fora de escopo |
| 53. Aviso "Ninguém aqui fala pela clínica" | `PessoasDoPortal.tsx:305-311` | menu do avatar | os dois | `faltaResponsavel` (`:301`) | ⚠️ é um aviso que trava o negócio e vive numa tela que sai do corpo — avaliar espelhá-lo no Início |

## rotas

### O que muda em `App.tsx`

Hoje (`apps/web/src/App.tsx:86-100`):

```tsx
        {me.data.role === "CLIENTE" ? (
          <SobDemanda>
            <PortalLayout>
              <PortalHome />
            </PortalLayout>
          </SobDemanda>
        ) : (
          <RouterProvider router={router} />
        )}
```

Passa a ser:

```tsx
        {me.data.role === "CLIENTE" ? (
          <SobDemanda>
            <PortalApp />
          </SobDemanda>
        ) : (
          <RouterProvider router={router} />
        )}
```

`PortalApp` é um arquivo fino novo (`apps/web/src/features/portal/PortalApp.tsx`) que só
devolve `<RouterProvider router={portalRouter} />`, carregado por `lazy()` como
`PortalLayout` e `PortalHome` são hoje (`App.tsx:23-24`) — o motivo escrito em
`App.tsx:7-15` (a tela do cliente não viaja no pacote da equipe) continua valendo, e uma
instância de roteador não pode ser `lazy` diretamente.

**As linhas `App.tsx:49-58` não são tocadas.** Elas resolvem as rotas públicas por
`window.location.pathname` **antes** do `auth.me`, e é por `/assinar/:token` (`:57`) e
`/proposta/:token` (`:58`) que o responsável **logado** assina — a ADR-137 manteve essas
rotas públicas de propósito. Se o `portalRouter` passasse a resolvê-las, o link do e-mail
deixaria de abrir.

### Por que um roteador SEPARADO, e não rotas novas em `router.tsx`

1. **O `rootRoute` interno é o `AppLayout`** (`router.tsx:55`). Toda rota filha nasce
   dentro do shell da equipe — barra lateral, Ctrl+K, `GuiaTour`. Não há como pendurar
   `/portal` ali sem herdar isso.
2. **Os dois testes-guarda leem o arquivo `router.tsx` por texto.**
   `paginas.test.ts:15-20` e `GuiaTour.test.ts:14-18` extraem
   `path:\s*"(\/[a-z-]*)"` de `apps/web/src/app/router.tsx`. Um `path: "/portal"` ali seria
   capturado e **os dois reprovariam**: o primeiro exigiria entrada em `PAGINAS`
   (`paginas.ts:74-98`, tudo `minRole` `FUNCIONARIO`+) e grupo de menu ou exceção em
   `FORA_DO_MENU` (`paginas.test.ts:71-78`); o segundo exigiria guia por prefixo em
   `OUTRAS` (`GuiaTour.tsx:308-329`), cujos passos são filtrados por
   `hasRoleLevel(user.role, …)` (`GuiaTour.tsx:476`) — papel **interno**, que o cliente não
   tem. ⚠️ E a reprovação seria **pela metade**: `path: "/portal/documentos"` **não** casa
   com o regex (ele para no `[a-z-]*` antes da segunda barra), então só a rota-mãe
   apareceria — um erro confuso de diagnosticar. Com arquivo separado
   (`apps/web/src/app/portal-router.tsx`), nenhum dos dois testes o lê e `paginas.ts` não
   muda uma linha.
3. **A tipagem aguenta dois roteadores.** `router.tsx:275-279` declara
   `interface Register { router: typeof router }` — e essa declaração é única. O
   `portalRouter` **não** a redeclara; onde o Portal usar `Link` ou `useRouterState`, passa
   o roteador como generic explícito. Conferido na tipagem instalada (1.170.17):
   `LinkComponent` tem `TRouter extends AnyRouter = RegisteredRouter`
   (`node_modules/@tanstack/react-router/dist/esm/link.d.ts:46,80`) e `useRouterState`
   idem (`useRouterState.d.ts:20`). Na prática: `<Link<typeof portalRouter>
   to="/portal/documentos">`. Em tempo de execução não há ambiguidade — o contexto é o do
   `RouterProvider` que envolve.

### A árvore do `portalRouter`

`PortalLayout` deixa de receber `children` (`PortalLayout.tsx:235`) e vira o `component` da
rota-raiz, trocando `{children}` (`:258`) por `<Outlet/>` — o mesmo arranjo do app interno
(`router.tsx:55` + `AppLayout.tsx:507,513`).

| rota | componente | observação |
|---|---|---|
| `/` | — | `beforeLoad` que redireciona para `/portal`; é onde o cliente cai depois do login |
| `/portal` | `PortalInicio` | blocos 9-20 do mapa |
| `/portal/documentos` | `PortalDocumentos` | blocos 21-27 |
| `/portal/credenciamento` | `PortalCredenciamentoPage` | blocos 28-34. ⚠️ precisa de guarda própria: sem processo (`portal.credenciamento === null`) redireciona a `/portal` — endereço colado por quem não tem processo não pode virar tela em branco |
| `/portal/servicos` | `PortalMeusServicos` | blocos 35-44 |
| `/portal/suporte` | `PortalSuportePage` | blocos 45-50 |
| `/portal/equipe` | `PortalEquipe` | blocos 51-53; **fora da barra inferior**, alcançada pelo menu do avatar. Rota própria em vez de modal porque a lista já abre um modal por dentro ("Convidar pessoa", `PessoasDoPortal.tsx`) e modal dentro de modal é o que a ADR-44 evita |
| qualquer outra | `notFoundComponent` | **redireciona para `/portal`** |

**Preservar o "qualquer caminho cai nele".** Hoje `/financeiro` renderiza o Portal porque
`App.tsx:89` ignora o caminho — e isso é **testado** em `e2e/flows-portal.spec.ts:22-23`.
Com roteador, `/financeiro` cairia no `notFoundComponent`; por isso ele redireciona para
`/portal` em vez de mostrar "página não encontrada". O teste segue verde desde que o `h1`
do Início contenha a palavra "Portal" (`flows-portal.spec.ts:18`).

### A sessão de suporte da equipe (ADR-128) — o que precisa continuar de pé

- A sessão de suporte tem **`role === "CLIENTE"`** (o `userId` é o do cliente; quem entrou
  fica em `Session.operadorId`), então cai no mesmo ramo do `App.tsx:89` e passa a usar o
  `portalRouter`. **Nada a fazer** — e nada no servidor muda.
- `FaixaDeSuporte` é renderizada pelo `PortalLayout` (`PortalLayout.tsx:241`); virando
  rota-raiz, ela continua em **todas** as seções, que é o requisito da ADR-128 (quem
  esquece que está no painel de outra pessoa acha que está no próprio).
- ⚠️ **O redirecionamento `/` → `/portal` só pode existir dentro do `portalRouter`.**
  "Voltar ao meu acesso" faz `window.location.href = "/"` (`FaixaDeSuporte.tsx:307`) —
  recarga inteira, de propósito, porque a sessão muda de dono. Depois dela o usuário é
  `FUNCIONARIO` e `/` é o Dashboard interno (`router.tsx:57-61`). Se o redirecionamento
  vazar para `App.tsx` ou para o roteador interno, o operador volta e é jogado ao Portal de
  novo, em laço.
- A trava de só-leitura continua onde está — `trpc.ts:98-100` barra **toda** mutação para
  quem tem `operador`, e o `/upload` a repete por não passar pelo tRPC. O redesenho não
  toca no servidor.

## pendencias_por_secao

O contador do ícone precisa de uma fonte **já existente**, e a barra é desenhada em toda
seção — então ele não pode custar uma consulta nova por seção.

| seção | consulta | campo | pronto? |
|---|---|---|---|
| Início | `portal.resumo` (`portal.service.ts:188-204`) | `paraAssinar.length` (`:202`) + `propostas.length` (`:203`) + `aguardandoVoce.length` (`:191`) | **sim** |
| Documentos | — | — | **NÃO existe fonte pronta** (ver abaixo) |
| Credenciamento | `portal.credenciamento` (`credenciamento.service.ts:600-611`) | `progresso.faltam` (`:582-587`, lido em `PortalCredenciamento.tsx:112,127`) | **sim** — e a mesma resposta (`null` em `:603`) decide se o item existe |
| Meus serviços | `portal.meusServicos` | soma de `s.pendentes` (lido em `PortalServicos.tsx:70`) | **sim** |
| Suporte | `portal.suporte.listChamados` | soma de `c.naoLidas` (lido em `PortalSuporte.tsx:203`) | **sim** |

**Documentos não tem fonte, e é melhor não ter contador.** `resumo.documentos` (`:192`) é
o acervo inteiro, sem marca de lido; `portal.arquivos` lista o que o cliente já enviou, sem
noção de pendência. O que "falta enviar" mora em `meusServicos[].pendentes` e no
`progresso.faltam` do credenciamento — ou seja, **a pendência de documento é das seções
*Meus serviços* e *Credenciamento***, e repeti-la em Documentos contaria a mesma coisa duas
vezes. Recomendação: *Documentos* fica sem contador (é acervo, não fila). Criar um campo
"não lido" exigiria coluna nova no banco, o que o briefing colocou fora de escopo.

**O que o menu pode e o que não pode disparar.** As quatro consultas acima já são leves
(`leads.list` responde em 15 ms; nenhuma delas aparece na lista de lentas de *Desempenho*).
⚠️ **`portal.servicosDisponiveis` (11,9 s) e `portal.emails` NÃO alimentam contador nenhum**
— hoje as duas são obrigatórias para abrir o Portal (`PortalHome.tsx:78,97`), e devem
passar a carregar **só** nas suas seções. Este é o ganho de desempenho que sai de graça do
redesenho.

Um detalhe que o desenho precisa respeitar: `paraAssinar` e `propostas` continuam com
comprimento para quem é EQUIPE — o que a ADR-137 anula é o **token** (`:202-203`), não o
item. Está certo assim: a secretária precisa ver que existe uma proposta esperando, para
avisar quem assina. O contador acende para os dois papéis.

## m12

### O código de hoje

O botão (`apps/web/src/features/portal/PortalHome.tsx:185-196`):

```tsx
            {r.podeDesistir && (
              <div className="mt-4 border-t pt-3">
                <button
                  type="button"
                  onClick={pedirDesistencia}
                  disabled={desistir.isPending}
                  className="text-xs text-muted-foreground underline-offset-2 …"
                >
                  Não tenho mais interesse
                </button>
              </div>
            )}
```

A ação (`PortalHome.tsx:109-121`), que abre o modal **antes** de saber se pode:

```tsx
  const pedirDesistencia = async () => {
    const motivo = await prompt({
      title: "Não deseja mais seguir?",
      …
    });
    if (motivo !== null) desistir.mutate({ motivo: motivo.trim() || undefined });
  };
```

A recusa só chega depois, do servidor: `apps/api/src/trpc/trpc.ts:110-112` responde
`FORBIDDEN` com `PORTAL_SO_RESPONSAVEL`. A secretária escreve o motivo, confirma e leva um
erro vermelho.

**Não é um botão, são quatro** — todos com a mesma forma e todos com a ação fora de
`ACOES_LIBERADAS_PARA_EQUIPE` (`packages/shared/src/portal-papeis.ts:54-67`):

| botão | tela | ação tRPC |
|---|---|---|
| "Não tenho mais interesse" | `PortalHome.tsx:185-196` → `:109-121` | `desistir` |
| "Quero retomar" | `PortalHome.tsx:214-216` → `:123-133` | `retomar` |
| "Solicitar" (catálogo) | `PortalHome.tsx:262-268` → `:100-107` | `solicitarServicos` |
| "Cancelar serviço" | `PortalServicos.tsx:79-84` → `:36-47` | `cancelarServico` |

⚠️ **A linha citada no `achados.md:133` (`PortalHome.tsx:177-186`) está desatualizada.** O
arquivo tinha 544 linhas quando a auditoria foi escrita e tem **560** hoje (a ADR-137
acrescentou as constantes `:21-27` e os ramos de token). O bloco correto é `185-196`. O
próprio `achados.md:125-126` já avisa que os números de linha dos arquivos de tela não
foram conferidos — isto confirma o aviso.

### A regra pura que já existe

`packages/shared/src/portal-papeis.ts`:

- `podeNoPortal(papel, acao)` — `:78-81`. Papel nulo vale RESPONSAVEL (`:79`).
- `ACOES_LIBERADAS_PARA_EQUIPE` — `:54-67`, lista de **liberações**, padrão negar.
- `podeAssinarPelaClinica(sessao)` — `:160-167`, a régua da ADR-137 (assinar/aceitar).

E a tela já tem os dois dados de que a régua precisa: `user.papelPortal`
(`packages/shared/src/types.ts:18`) e `user.operador` (`:22-25`), lidos hoje em
`PortalMinhaEquipe.tsx:56` e `FaixaDeSuporte.tsx:311`. O comentário de `types.ts:15-16`
inclusive **já promete** que "a tela do Portal … esconde o botão que a pessoa não pode
apertar" — é essa promessa que M12 mostra não cumprida.

### A correção mínima

O guarda do servidor aplica **duas** condições (`trpc.ts:98-112`): `operador` barra toda
mutação, e `podeNoPortal` barra as não liberadas. A tela precisa responder exatamente à
mesma pergunta — e a lição da ADR-133 (e o comentário de `portal.service.ts:56-62`) é que
ela **não pode** ter uma segunda lista.

Então, na ordem:

1. **Uma função pura nova em `packages/shared/src/portal-papeis.ts`**, ao lado das outras —
   algo como `podeAgirNoPortal(sessao, acao)`, que é `!sessao.operador &&
   podeNoPortal(sessao.papelPortal, acao)`, reusando o tipo `SessaoQueAssina` (`:155-158`)
   ou um irmão dele.
2. **O guarda do servidor passa a chamá-la** (`trpc.ts:98-112`), para haver **uma** régua e
   não duas. Sem esse passo, o conserto vira a divergência que ele veio evitar.
3. **As quatro telas escondem o botão** e mostram, no lugar, a mesma frase curta que a
   ADR-137 já usa para propostas e assinaturas (`PortalHome.tsx:26-27`), adaptada por ação
   — "Só o responsável pela clínica cancela", e assim por diante. **Esconder, não
   desabilitar sem explicação**: botão apagado sem motivo é o defeito que se relata como
   "o sistema não funciona".
4. O **item** continua visível. A trava é sobre agir, não sobre ver
   (`portal-papeis.ts:17-21`) — e a secretária precisa saber que há um serviço contratado
   para avisar quem cancela.

Isso cobre a sessão de suporte da Med pelo mesmo caminho: `user.operador` faz a função
recusar tudo, e hoje o operador também vê os quatro botões e leva `SUPORTE_SO_LEITURA`.

Teste que fecha a regressão: unidade sobre a função pura (as combinações de papel × ação ×
operador) mais um caso de tela por botão. O e2e já entra como EQUIPE em
`e2e/flows-pessoas-do-portal.spec.ts` — há trilha pronta para exercitar o caminho.

## guia_por_secao

### Como o app interno registra os guias

- `apps/web/src/components/GuiaTour.tsx:308-329` — `OUTRAS`, uma lista de
  `{ prefixo, guia }` com **18 entradas**, uma por página.
- `guiaDaRota(path)` — `:335-339`: `/` devolve a visão geral; o resto é
  `OUTRAS.find(o => path.startsWith(o.prefixo))`, **parando no primeiro**. Por isso a ordem
  importa e o comentário `:304-307` obriga o prefixo mais específico a vir antes
  (`/emails-enviados` antes de `/emails`, `/email` depois dos dois).
- `GuiaTour` — `:472-477`: lê a rota com `useRouterState` (`:474`), resolve o guia e filtra
  os passos por papel (`:476`, `hasRoleLevel(user.role, p.minRole)`).
- O **visual** é desacoplado: `GuiaModal` (`:346`) recebe `titulo`, `passos` e `resetKey` —
  e o Portal **já o reusa** (`GuiaPortal.tsx:283`).
- O guarda: `apps/web/src/components/GuiaTour.test.ts` — nenhuma página cai no genérico
  (`:21-25`), a ordem dos prefixos não mascara ninguém (`:40-54`), todo guia tem ≥2 passos
  com título e descrição de verdade (`:56-67`). `PREFIXOS_GUIA` (`GuiaTour.tsx:332`) existe
  só para esse teste.

### O que o Portal tem hoje

**Um guia só, genérico**: `PASSOS_PORTAL` — 5 passos, `GuiaPortal.tsx:248-280` — aberto
pelo "?" do cabeçalho (`PortalLayout.tsx:246-253`, montado em `:261`), **sem nenhuma
consciência de onde a pessoa está**. Os passos falam de serviços, documentos, suporte e
LGPD todos de uma vez, porque tudo estava na mesma página.

### O que é preciso para ter um por seção

1. **Uma lista no Portal com a mesma forma de `OUTRAS`**, dentro de `GuiaPortal.tsx`, com
   6 entradas: `/portal/documentos`, `/portal/credenciamento`, `/portal/servicos`,
   `/portal/suporte`, `/portal/equipe` e — **por último** — `/portal`. ⚠️ `/portal` é
   prefixo de todos os outros: posto primeiro, `startsWith` o faz capturar tudo, e as cinco
   seções abririam o guia do Início. É exatamente a armadilha que `GuiaTour.test.ts:40-54`
   existe para pegar.
2. **`GuiaPortal` passa a ler a rota atual** — `useRouterState<typeof portalRouter>({
   select: s => s.location.pathname })` —, o que só é válido dentro do `RouterProvider` do
   Portal, e a passar `resetKey={pathname}` ao `GuiaModal` (`:346`) para o carrossel voltar
   ao passo 1 a cada troca de seção, como o app interno já faz (`GuiaTour.tsx:477`).
3. **Um teste-guarda espelhado**, lendo `apps/web/src/app/portal-router.tsx` em vez de
   `router.tsx`, com as mesmas três asserções: cobertura, ordem de prefixos e guia completo.
4. Conteúdo: os 5 passos de hoje se dividem quase naturalmente — *Seus serviços*
   (`GuiaPortal.tsx:257-261`) → Meus serviços; *Documentos e assinatura* (`:262-267`) →
   Documentos; *Suporte* (`:268-273`) → Suporte; *Seus dados, protegidos* (`:274-279`) →
   menu do avatar / Equipe; *Bem-vindo* (`:249-255`) → Início. Falta escrever o de
   Credenciamento, que nunca teve passo próprio. Redação é da fase 3.

⚠️ **Não pôr os guias do Portal em `OUTRAS`.** `GuiaTour` filtra passo por
`hasRoleLevel(user.role, p.minRole)` (`:476`) — papel **interno** (`FUNCIONARIO`/`ADMIN`/
`ROOT`), que o cliente não tem; e `GuiaTour.test.ts:14-18` cruza aquela lista com
`router.tsx`. Os dois catálogos são do app da equipe. O filtro do Portal, se um dia
existir, é por `papelPortal`.

## fontes_externas

nenhuma. Nada foi pesquisado na web. As únicas fontes fora do código da aplicação são a
tipagem instalada de `@tanstack/react-router@1.170.17`
(`node_modules/@tanstack/react-router/dist/esm/link.d.ts:46,80` e
`useRouterState.d.ts:20`), lida em disco para confirmar que dois roteadores tipados no
mesmo aplicativo são possíveis.

## fora_de_escopo

Copiado do briefing (`briefing.md`, seção `fora_de_escopo`), sem alteração:

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

Acrescento, para não haver dúvida na fase 5: **nenhuma migração e nenhuma mudança de
comportamento no servidor**, com uma única exceção — o passo 2 do `## m12`, que faz o
guarda do `portalProcedure` (`apps/api/src/trpc/trpc.ts:98-112`) chamar a função pura nova
em vez de repetir a condição. É refatoração sem mudança de comportamento, e existe
justamente para a tela e o servidor não terem duas réguas.

## contradicoes_resolvidas

O `achados.md` é hipótese até ser conferido — e a PARTE 3 saiu quase toda certa. O que a
leitura do código contrariou:

1. **`PortalHome.tsx` tem 560 linhas, não 544** (`achados.md:164`). A ADR-137 acrescentou
   as constantes `SO_RESPONSAVEL_RESPONDE`/`SO_RESPONSAVEL_ASSINA` (`:21-27`) e os ramos de
   token. **Consequência prática:** as linhas de M12 (`achados.md:133` cita
   `PortalHome.tsx:177-186`) apontam hoje para a barra de progresso da etapa do funil. O
   botão está em `185-196`. O próprio `achados.md:125-126` já avisava que os números dos
   arquivos de tela não tinham sido conferidos.
2. **"6 usos de breakpoint em 2.300 linhas" (`achados.md:168`) está subestimado: são 9
   ocorrências, em 7 linhas, em 4 arquivos** — `PortalHome.tsx` 4× `sm:`, `PortalLayout.tsx`
   3× `sm:` + 1× `md:`, `PortalDocumentoModal.tsx` 1× `sm:` — sobre 2.316 linhas. A
   conclusão (praticamente não há tratamento de celular) fica de pé; o número, não.
3. **"`packages/ui` exporta só `cn`" está certo** — `packages/ui/src/index.ts` é uma linha
   e a pasta só tem `cn.ts` e `index.ts`. Mas a conclusão *"a navegação do Portal terá de
   ser construída"* merece recorte: o Portal já usa `Card`, `Button`, `Modal`, `Input`,
   `Label`, `Select`, `Badge`, `Textarea`, `Skeleton`, `Avatar`, `MaskedInput`,
   `UploadArquivo`, `useConfirm`/`usePrompt` e `toast` de `apps/web/src/components/ui/`.
   **O que falta construir é a barra inferior — e só ela.**
4. **A "peça reaproveitável" não é reaproveitável como está.** `achados.md:171` aponta
   `AppLayout.tsx:414-432` (o caminho completo é
   `apps/web/src/components/layout/AppLayout.tsx`; as linhas conferem, é o drawer mobile).
   Mas o que está ali é um **drawer lateral** que renderiza `SidebarConteudo` com os grupos
   derivados de `paginas.ts` e `Link` tipado no roteador interno. Reaproveita-se o
   **padrão** de camadas e animação (`fixed inset-0 z-50 md:hidden`, backdrop
   `animate-fade-in`, `animate-slide-in-right`), não o componente. Uma barra inferior não é
   um drawer.
5. **O `achados.md` não menciona o obstáculo que mais restringe o desenho:**
   `paginas.test.ts:15-20` e `GuiaTour.test.ts:14-18` **leem o texto de
   `apps/web/src/app/router.tsx`** e cobram catálogo e guia para toda rota que acharem
   ali. Pôr `/portal` naquele arquivo reprova os dois testes — e pela metade, porque o
   regex não casa `/portal/documentos`. É a razão principal de o Portal ganhar roteador em
   arquivo próprio.
6. **"qualquer caminho cai nele" não é acidente, é contrato testado.**
   `e2e/flows-portal.spec.ts:22-23` vai a `/financeiro` e exige o cabeçalho do Portal. Quem
   introduzir rotas precisa manter o comportamento (redirecionando) ou mexer no teste
   conscientemente.
7. **"o Portal está fora do roteador" precisa de nuance.** As rotas **públicas** também
   estão: `App.tsx:49-58` as resolve por `window.location.pathname` antes do `auth.me`, e
   `/assinar/:token` e `/proposta/:token` continuam valendo para quem está logado. Elas não
   podem passar para o `portalRouter`.
8. **"37 funcionalidades" (`achados.md:169`) é um corte mais grosso do que o que este mapa
   precisa.** Contadas como itens endereçáveis — cada botão, cada upload, cada estado que
   pode sumir sem ninguém notar —, são **53**, listadas em `## mapa_bloco_para_secao`. Não é
   contradição, é granularidade; as 37 estão contidas nas 53. Os **16 blocos** de
   `achados.md:164-165` conferem exatamente: a saudação mais 15 cartões de primeiro nível,
   fora o modal de leitura (`PortalHome.tsx:557`) e os 6 elementos de shell do
   `PortalLayout`.

## duvidas_para_o_dono

**nenhuma.** A única decisão de produto que faltava — a divisão em 5 seções — foi aprovada
na sessão de 28/08 e está no briefing. Nada do que a leitura do código levantou muda o que
o software **é**; tudo o que apareceu é forma, e forma é da fase 3.

Registro aqui as **três escolhas que tomei sozinho** para o dono poder vetá-las numa linha,
em vez de ter de perguntar:

1. **"Seus projetos" e "Próximas reuniões" vão para o Início.** O briefing nomeia
   "próxima reunião" no Início e não nomeia projetos. Como não há seção "Projetos" na
   divisão aprovada e nada pode se perder, Início é o único destino que não inventa uma
   sexta seção.
2. **"Documentos" não terá contador de pendência.** Não existe fonte pronta e a pendência
   de documento já é contada em *Meus serviços* e *Credenciamento* — repetir contaria a
   mesma coisa duas vezes. Detalhe em `## pendencias_por_secao`.
3. **"Equipe da clínica" vira endereço próprio (`/portal/equipe`), fora da barra**, em vez
   de modal aberto pelo menu do avatar — porque a lista já abre um modal por dentro
   ("Convidar pessoa") e modal dentro de modal é o que a ADR-44 evita. *Editar perfil*
   continua modal, como hoje.
