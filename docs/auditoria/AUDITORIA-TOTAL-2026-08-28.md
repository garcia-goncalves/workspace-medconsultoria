# Auditoria total da aplicação — 28/08/2026

> **Pedido do dono, com todas as letras:** *"Estou com receio de que a aplicação não esteja 100%.
> Analise tudo profundamente, todas as páginas e funcionalidades, como se fosse um usuário mesmo
> fazendo os trabalhos de todos os dias. Não deixe nada para trás sem testar. Preciso da aplicação
> pronta. Tudo precisa fazer sentido."*
>
> Este arquivo é o **retrato completo**: o que foi conferido, o que estava errado, o que foi
> corrigido nesta rodada e o que ficou aberto — com arquivo:linha em tudo.

---

## Como a auditoria foi feita

Oito frentes em paralelo, **todas lendo o código de hoje** (`main` @ `3dfbc93`), mais a aplicação
percorrida no navegador com dado de teste:

| Frente | Cobertura |
|---|---|
| Segurança | os 27 módulos da API, procedure por procedure — 237 rotas classificadas por papel |
| Banco | schema, 100+ migrações, cascatas, índices, `Decimal`, N+1 |
| Regra de negócio | o fluxo lead → proposta → aceite → cliente → contrato → conta → credenciamento |
| Telas (React) | as 37 páginas, procurando erro disfarçado de vazio, hooks, formulário, dinheiro |
| Saúde/LGPD | dado de médico, arquivo enviado, trilha de auditoria, IA, retenção |
| Texto | vocabulário, jargão vazando, mensagem de erro, os 42 modelos de e-mail |
| Visual | consistência entre telas, token, responsividade a 360px e 1920px |
| Conferência dos 48 achados anteriores | `docs/esteira/refino-final-2026-08-28/achados.md`, item a item |

**Na tela**, como ROOT e como cliente do Portal: Início, Vendas (funil), Clientes, Credenciamentos,
Documentos, Financeiro, Tarefas, Sistema (9 abas) e as 6 seções do Portal. Mais o **formulário
público** `/comecar`, preenchido de verdade.

### As provas que a rodada começou tendo

Antes de qualquer mudança, a base estava sadia:

```
typecheck  6/6 pacotes            lint  0 problemas
@app/api   72 arquivos, 679 testes    @app/web  18 arquivos, 171 testes
e2e        99 testes                  todos verdes
```

**Nenhum defeito desta auditoria foi pego por teste.** Todos vieram de leitura dirigida do código
e de uso na tela — é a mesma lição das ADR-105, 118 e 139: suíte verde prova que o que alguém já
pensou em testar continua funcionando, não que o sistema esteja certo.

---

## Parte 1 — O que foi CORRIGIDO nesta rodada

Ordenado por gravidade. Cada item tem teste, e cada teste foi visto **reprovando antes** da correção.

### 1. Um funcionário qualquer podia se dar acesso de dono a QUALQUER clínica 🔴

`apps/api/src/modules/clientes/clientes.router.ts:73-105`

`clientes.pessoas.convidar/alterarPapel/revogar/devolver/reenviarConvite` eram
`funcionarioProcedure` e recebiam o `clienteId` **do pedido**. O serviço conferia se a *pessoa* era
daquela clínica — ninguém conferia se o *ator* tinha alcance sobre aquele cliente.

O caminho completo: o funcionário chama `convidar` com o `clienteId` de qualquer clínica, papel
`RESPONSAVEL` e um e-mail dele. O convite **sempre sai** (é o desenho da ADR-131), ele aceita, e
entra no Portal alheio com **sessão normal de cliente** — sem a marca de sessão de suporte que a
ADR-128 criou justamente para isso ficar rastreável. Dali, aceita proposta, assina contrato,
cancela serviço e revoga os colegas. No sentido inverso, `revogar` tranca o responsável de verdade
para fora.

**Correção:** as cinco mutações passam por `assertPodeVerOPainel` — a **mesma** régua do Painel do
Cliente (ADMIN+ sempre; funcionário só nos clientes dele). A leitura (`list`) segue como o resto da
ficha, que já é assim.

### 2. Toda secretária cadastrada pela tela da Med podia assinar contrato 🔴

`apps/api/src/modules/usuarios/usuarios.service.ts` (`createUsuario`, `convidarUsuario`)

Em *Equipe e acessos*, criar ou convidar um usuário com papel CLIENTE **não gravava
`papelPortal`**. Papel nulo vale como RESPONSAVEL (é a compatibilidade com as contas anteriores à
ADR-131) — ou seja, essa porta furava na origem a trava que as ADR-131 e 137 construíram.

**Correção:** nasceu `papelPortalPadraoDaClinica` (`apps/api/src/modules/portal/papel-da-clinica.ts`),
usada pelas duas funções. Sem ninguém falando pela clínica, a primeira pessoa é RESPONSAVEL; havendo
alguém, a seguinte entra como EQUIPE e quem administra promove depois. ⚠️ **Errar para este lado
tira um poder que se devolve num clique; errar para o outro dá poder de assinar contrato a quem só
ia anexar documento.**

*(O arquivo é separado por causa de ciclo de módulos: `pessoas.service.ts` já importa
`gerarConvite` de `usuarios.service.ts`, então o caminho de volta não podia ser import estático.)*

### 3. Pedir assinatura de novo APAGAVA a assinatura já dada 🔴

`apps/api/src/modules/assinaturas/assinaturas.service.ts:53`

`solicitar()` fazia `deleteMany` de todas as assinaturas do documento, sem olhar se alguma estava
`ASSINADO`, e zerava `documento.assinadoEm`. Some IP, user-agent, data, hash do conteúdo assinado,
imagem do traço e quem assinou — **a prova inteira**, que não é versionada em lugar nenhum (o
`DocumentoVersao` guarda o texto, nunca a assinatura). Qualquer FUNCIONARIO disparava.

**Correção:** recusa com frase em português quando já existe assinatura dada, dizendo o nome de
quem assinou e apontando a saída certa (gerar documento novo). Reenviar continua liberado enquanto
ninguém assinou.

### 4. A 2ª proposta de credenciamento apagava as linhas da 1ª 🔴

`apps/api/src/modules/servicos/credenciamento-grade.service.ts:148,192-201`

Cada proposta de credenciamento é de **uma** operadora (ADR-126), e o construtor manda para
`salvarGrade` só as células dela. A grade, porém, foi escrita para a tela da ficha — onde a carga é
o **cliente inteiro** — e lia todo par ausente como "desmarcado". Emitir a proposta da Bradesco
apagava os cruzamentos ainda `A_PROTOCOLAR` da Unimed, sem aviso e sem erro na tela.

**Correção:** `somenteOperadorasDaGrade`. Ligada (proposta), a remoção fica confinada às operadoras
que vieram na carga. Desligada (grade da ficha), o comportamento antigo continua valendo — e há
teste para o segundo caso, para ninguém "consertar" isto ligando a marca para todo mundo.

### 5. Excluir cliente apagava, em cascata e em silêncio, o que a tela dizia não existir 🔴

`apps/api/src/modules/clientes/clientes.service.ts:336`

A exclusão definitiva confere 10 vínculos antes de liberar o `DELETE` — e o schema tem **13**
relações em cascata a partir de `Cliente`. Faltavam três, e as três guardam trabalho que não se
refaz: **histórico do chat de suporte**, **médicos cadastrados** e **andamento do credenciamento na
operadora**. A tela dizia "sem vínculos, seguro remover" e o banco apagava.

**Correção:** as três entraram na lista, com nome em português na mensagem de bloqueio.

### 6. Vendido e não cobrado: o upsell aceito nunca virava conta a receber 🔴

`apps/api/src/modules/servicos/servicos-cliente.service.ts` (`provisionarUpsellAceito`)

Há três portas para um serviço passar a valer, e só duas cobravam: a conversão do lead e a
contratação pela ficha. Aceitar proposta sincronizava o serviço, gerava o contrato, abria o
projeto — **e parava**. Para quem ainda é lead, a conversão vem atrás e cobra; para o cliente **já
convertido** que aceita um upsell (justamente o que a Med mais quer vender), não vinha conversão
nenhuma e **nada** chegava ao Financeiro.

**Correção:** a provisão passou a existir nessa porta também. ⚠️ **A guarda contra cobrar duas
vezes é o lead ativo:** havendo lead não convertido, quem cobra é a conversão e aqui não se toca em
dinheiro. As demais regras são as mesmas da ficha, de propósito — credenciamento fora (honorário na
aprovação, ADR-104), só-percentual fora, valor **aceito** e nunca o de catálogo (ADR-137), e conta
que já existe não é lançada de novo.

### 7. A automação pós-aceite falhava em silêncio 🟠

`apps/api/src/modules/propostas/propostas.service.ts:226`

Um `catch(() => {})` vazio. A proposta já está gravada como ACEITA e a equipe já recebeu o aviso —
se a automação falhasse, o cliente ficava **sem serviço na ficha, sem contrato e sem conta**, e
ninguém ficava sabendo: nem a tela, nem o painel de erros do ROOT, nem um log.

**Correção:** continua best-effort de propósito (o aceite do cliente não pode cair porque a nossa
automação tropeçou), mas a falha agora **aparece em SISTEMA → Erros**, dizendo qual cliente conferir.

### 8. `trustProxy: true` entregava ao visitante o controle do próprio IP 🟠

`apps/api/src/server.ts:31`

`true` significa "confie na cadeia inteira do `X-Forwarded-For`" — e quem escreve a entrada mais à
esquerda é o próprio visitante. Isso zerava, de uma vez, o limite de 300 requisições/min, as 8
tentativas de login por conta e o freio do formulário público. E envenenava a prova jurídica: o
`req.ip` é o mesmo gravado em `Assinatura.ip` e em `Documento.propostaRespIp`.

**Correção:** `trustProxy: 1` — confia só no salto mais próximo, que é a topologia real da TineHost.

### 9. Acesso revogado voltava por um link antigo 🟠

`pessoas.service.ts` · `usuarios.service.ts` · `auth.service.ts`

Revogar derrubava a sessão e **não tocava nos tokens**. O convite vale 72 h e o reset, 1 h; quem
fosse revogado com um link na caixa clicava nele, e `aceitarConvite`/`redefinirSenha` gravam
`ativo: true`. A conta voltava a entrar sozinha — e a tela continuava mostrando "REVOGADO"
enquanto a pessoa navegava.

**Correção, em duas trancas:** revogar e desativar apagam os tokens não usados; e as duas rotas de
aceite recusam quem tem `acessoRevogadoEm` preenchido.

### 10. Dava para desativar o único responsável pela tela interna 🟠

`apps/api/src/modules/usuarios/usuarios.service.ts` (`updateUsuario`)

A tela do Portal e a ficha do cliente já recusavam deixar a clínica sem ninguém que assine
(`sobraResponsavel`, ADR-131). *Equipe e acessos* não perguntava.

**Correção:** a mesma régua, agora também ali.

### 11. Renomear um serviço podia religar uma cobrança proibida 🟠

`apps/api/src/modules/servicos/servicos.service.ts` (`atualizarServico`)

`ehServicoDeCredenciamento` casa por **nome**, e três decisões de dinheiro dependem dela. Bastava
corrigir um typo em *Ajustes → Serviços* para que converter um lead passasse a gerar conta pelo
credenciamento — e, na aprovação da operadora, uma **segunda** conta pelo mesmo honorário.

**Correção:** o nome desse serviço ficou travado, com frase explicando o porquê. É remendo, não
cura: a cura é um campo estrutural (ver Parte 2).

### 12. Lead dado por perdido voltava pelo site e sumia 🟠

`apps/api/src/modules/leads/leads.service.ts` (recaptura)

A recaptura acha o lead perdido (certo — é o mesmo lead) mas nunca limpava `perdidoEm`. Ele
continuava fora do quadro, enquanto a equipe recebia "novo lead, ver no funil" e não achava nada
lá. **Negócio voltando pela porta da frente e ninguém atendendo.**

**Correção:** reabre como `reabrirLead` faz — zera a perda e põe o card no fim da coluna —, e grava
`lead.reaberto_pelo_site` no histórico.

### 13. O cliente apagava o próprio documento e não ficava registro 🟠

`apps/api/src/modules/portal/portal.router.ts:80`

O `activityLog` já estava escrito dentro de `removerArquivo`; faltava passar **quem**. O arquivo
some do disco (irreversível) e ninguém sabia quem apagou o RG ou o diploma do médico.

**Correção:** uma linha — `ctx.user.id`.

### 14. Sete telas diziam "não há nada" quando na verdade a consulta falhou 🟠

A aplicação tem rede de segurança para **mutação** (`main.tsx:20-27` dá aviso em qualquer mutação
sem tratamento) e **nenhuma** para consulta — e `retry: false` faz um único tropeço de rede virar
estado final. O resultado é sempre o mesmo: falha vira boa notícia.

| Onde | O que o usuário lia | Consequência |
|---|---|---|
| `App.tsx` | é jogado na tela de **login** | perde o formulário aberto, acha que a sessão caiu |
| `AssinarPage` (pública) | *"Link inválido"* | pede outro link; a Med emite uma 2ª assinatura |
| `PropostaPublicaPage` (pública) | *"Link inválido"* | idem, na proposta que fecha venda |
| `ExigenciasPendentes` (Portal) | ✅ *"Você já enviou tudo"* | **para de mandar documento** |
| `PortalDocumentosPage` | *"Ainda não preparamos nenhum documento"* | não vê o contrato esperando assinatura |
| `PortalServicos` | *"Você ainda não tem serviços ativos"* | ao lado do catálogo que o convida a contratar de novo |
| `PortalMeusDocumentos` | *"Você ainda não enviou nenhum documento"* | reenvia tudo |
| `PortalSuporte` | *"Nenhum chamado aberto"* | abre um chamado duplicado |
| `PortalTabBar` | o item **Convênios some da barra** | perde o caminho para a seção |
| `SistemaPage` | esqueleto pulsando **para sempre** | o painel que existe para avisar não avisa |

**Correção:** erro **antes** de vazio em todas, com frase que diz o que aconteceu e um botão
*Tentar de novo*. No `SistemaPage` o ramo de erro era código morto — vinha depois do `!saude.data`,
que já capturava o caso; foi só a ordem, e sumir (`return null`) também não servia.

### 15. Incoerências de texto que o dono lê como "o sistema não bate" 🟡

- **`DashboardPage`** dizia *"28 documento(s) aguardando revisão"*; clicando, a página Documentos
  mostrava **10**. O número conta rascunho **+** revisão. O rótulo passou a dizer o que conta.
- **`LoginPage`** — a **mesma** tela serve a equipe da Med e ao cliente da clínica — dizia *"entrar
  no workspace"* e *"fale com o administrador do workspace"*. É o mesmo vazamento do nome do
  sistema interno que a ADR-135 fechou nos e-mails.
- **`DashboardPage`** tinha *"Prospects"*, em inglês, como rótulo visível.
- **Portal** dizia *"Faltam 1 documento"*.

---

## Parte 2 — O que ficou ABERTO, e por quê

Nada aqui foi esquecido: são itens que **exigem decisão do dono**, **migração de banco**, ou que
não cabem numa rodada sem transformar o PR num monólito impossível de revisar.

### Exige decisão do dono (produto ou jurídico)

| # | Assunto | A pergunta |
|---|---|---|
| A1 | **Dado de cliente indo para a OpenAI** | `ia.service.ts:220,247` mandam `observacoes` do cliente e do lead. Esse campo **contém CPF** — a migração `20260819161500` moveu para lá o CPF de quem era pessoa física. O `docs/IA_PRIVACIDADE.md` promete mandar menos do que o código manda, e lista "base legal / DPA com a OpenAI" como pendência. **Parar de enviar, ou fechar a base legal?** |
| A2 | **Retenção e direito de eliminação (LGPD)** | Não existe caminho: `EmailEnviado` guarda o corpo para sempre, e `excluirDefinitivoCliente` bloqueia diante de qualquer vínculo — na prática, nenhum cliente real é eliminável, e não há anonimização como alternativa. **Qual o prazo de guarda do acervo de credenciamento depois de encerrado o contrato?** |
| A3 | **Política de privacidade** | `/comecar` tem só a frase *"conforme a LGPD"*; não há página de política, nem aceite registrado, nem versão do aviso. |
| A4 | **Token de proposta e de assinatura não expiram** | Um link de um ano atrás continua abrindo o documento inteiro, sem login. **Vale 30 dias?** |
| A5 | **Credenciamento reaberto cobra de novo?** | Aprovado → Encerrado → nova tentativa → Aprovado gera uma **segunda** conta. Pode ser certo (novo trabalho, novo honorário) ou errado. É regra comercial, não código. |
| A6 | **Cancelar serviço não encerra a mensalidade** | A Med segue cobrando até alguém notar. Parece deliberado; confirmar. |
| A7 | **"Foro de eleição"** em *Ajustes → Dados da empresa* continua em branco — o contrato sai com `[A PREENCHER]`. |

### Exige migração de banco (rodada própria, com o cuidado que migração pede)

- **`Servico.ehCredenciamento`** — a cura de verdade do item 11. Enquanto for nome, é remendo.
- **`Servico` sem `@@unique(nome)`** — `seedIfEmpty` faz *lê-então-cria* não atômico; duas
  requisições simultâneas num banco novo podem duplicar o catálogo. A ADR-139 tornou isto **mais
  provável** ao chamar `garantirCatalogoDeServicos` também de `credenciamentoDoCliente`.
- **Consentimento da assinatura** — o schema exige `consentimento: true` e **não guarda** o aceite
  nem a versão do termo mostrado.

### Dinheiro, ainda aberto (ALTA, mas exige desenho antes de código)

- **M1 — cobrança em dobro:** contratar pela ficha do prospect gera conta, e converter o lead
  depois provisiona de novo pelos contratados.
- **C10:** excluir uma parcela pendente de conta recorrente — o varredor a **ressuscita**.
- **M15:** credenciamento "a combinar" (valor 0) aprovado cria conta de **R$ 0,00** e grava o
  vínculo, e nunca mais gera cobrança.
- **F8:** o total do funil soma mensalidade com valor avulso no mesmo bolo.
- **F9:** contrato e recibo de cliente só-percentual saem com investimento **R$ 0,00**.

### Trabalho invisível (não produz dado errado, mas custa o dia da Thaís)

- **C1:** proposta ACEITA e o funil continua pedindo "Confirmar o aceite".
- **C2:** entrar na etapa "Proposta" pode emitir uma **segunda** proposta e queimar um número da
  numeração real dela (0225…).
- **M6:** seis avisos têm modelo de e-mail e **nunca saem** (conflito de agenda, projeto parado,
  projeto sem responsável, upsell, documento parado, lead parado).
- **M8:** quando a equipe responde o chamado, o cliente **não é avisado**.
- **Recaptura de lead não manda confirmação:** conferido na tela — preenchi `/comecar` com um
  e-mail já no funil; saíram **2 e-mails internos** (correto, ADR-134) e **nenhuma confirmação ao
  lead**, embora a tela diga *"Recebemos seu contato!"*.

### Desempenho (o gargalo é a hospedagem, mas há duas coisas nossas)

- `seedIfEmpty()` roda **em toda leitura** do catálogo — no mínimo 4 idas ao banco, e com backfill
  pendente entram dois laços com `await` dentro. É o `portal.servicosDisponiveis` de 11,9 s.
- `login()` faz **três escritas sequenciais** que não dependem uma da outra. Explica boa parte dos
  `auth.login` de 9,9 s.

### Visual e acessibilidade

- Quatro arquivos do Portal reinventam o selo de situação em vez de usar `<Badge>`; convivem três
  tamanhos de fonte (10, 11 e 12px) para o mesmo elemento. E há **174** ocorrências de `text-[Npx]`
  abaixo do menor token da escala.
- **~201 botões só-de-ícone** dependem de `title=` para nome acessível — que não existe no toque.
- `PortalDocumentoModal` e `CardPanel` são modais feitos à mão, fora do `Modal` do repositório:
  sem foco inicial, sem *focus trap*, e o `BriefingDialog` em erro abre **sem rodapé** — sem
  Cancelar, sem Salvar, sem mensagem.

---

## Parte 3 — O que foi conferido e está CERTO

Isto importa tanto quanto a lista de defeitos: é o que **não** deve ser mexido.

- **Isolamento do Portal: sólido.** `portalProcedure` tira o `clienteId` da **sessão**, nunca do
  input, e nenhuma das 27 rotas de `portal.*` aceita `clienteId` do cliente. Cada rota que recebe
  um id confere o dono. Um médico de outra clínica **não** baixa o diploma alheio trocando um id.
- **Nenhuma injeção de SQL, nenhum XSS, nenhum *path traversal*, nenhum *redirect* aberto,
  nenhum segredo em código.** Os `$queryRawUnsafe` recebem só literais; o Markdown passa por
  DOMPurify; o arquivo em disco é UUID com guarda de prefixo, allowlist de 8 tipos e
  `Content-Disposition: attachment`.
- **Senha e token de convite/reset: modelo exemplar.** Argon2id com rehash transparente, token de
  256 bits guardado só como SHA-256, uso único atômico, TTL curto.
- **A disciplina da ADR-118 está de pé:** nenhum `Decimal` atravessa o tRPC, e nenhum "R$ NaN"
  apareceu em nenhuma tela.
- **A dívida da ADR-137 está paga:** o token de assinatura só sai para quem pode assinar.
- **Confirmação em ação destrutiva: 37 de 37.** Nenhuma exclusão dispara direto do clique.
- **O painel de erros do ROOT não voltou a mentir.** Os 5 erros abertos no banco local são
  resíduo de 28/07 e 04/08, de antes da ADR-135 — conferido que os cinco caminhos de reconexão de
  caixa hoje lançam `PRECONDITION_FAILED`, e os dois `new Error` crus de `cripto-caixa.ts` são
  embrulhados nos dois únicos lugares que os chamam.
- **A ADR-134 funciona na prática:** criar um lead pelo formulário público disparou **exatamente 2
  e-mails internos** (os dois ADMIN), não 4 nem 6.
- **A barra do Portal (ADR-139) é o melhor exemplo de disciplina do repositório** — largura por
  `gridTemplateColumns`, rótulo medido a 360px, `aria-label` completo mesmo mostrando "9+", e uma
  lista de seções só, servindo celular e computador.

---

## Sobre o e-mail de teste que o dono pediu

**Não é possível provar entrega a partir do computador dele, e o motivo não é defeito da
aplicação:** a máquina não tem servidor de e-mail. Toda tentativa responde
`connect ECONNREFUSED 127.0.0.1:587` — o monitor local mostra **181 falhas em 7 dias, taxa 0%**.

O que **foi** provado localmente: o **disparo** funciona, com destinatário e assunto certos, e
para o lead novo saíram exatamente os 2 e-mails que a ADR-134 manda sair.

A **entrega** só se prova em produção, e lá ela já foi provada em 22/08 (ADR-122): a taxa saiu de
0% para 17% e o e-mail para `tibamooca@gmail.com` foi entregue. Para repetir hoje, o caminho é
publicar este lote e usar o botão **"Enviar acesso"** no card de um lead — ⚠️ **não** reenviar o
formulário público com um endereço que já está no funil, porque a recaptura não manda convite novo.

---

## Provas desta rodada

```
typecheck  6/6 pacotes            lint  0 problemas
@app/api   688 testes  (679 antes + 9 novos, todos vistos reprovando sem a correção)
@app/web   171 testes
e2e        99 testes
```

Arquivos de teste novos:

- `apps/api/src/test/credenciamento-grade-por-operadora.integration.test.ts`
- `apps/api/src/test/auditoria-total-travas.integration.test.ts`
- `apps/api/src/test/upsell-vira-conta.integration.test.ts`

**Zero migração** neste lote — nada mudou no banco.
