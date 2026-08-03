# E-mail dentro da aplicação — desenho

> **Status:** aprovado no brainstorm de 03/08/2026 · aguardando revisão do dono
> **Origem:** pedido do dono — "que o ROOT, ADMIN e funcionários tenham um sistema de e-mail
> dentro da aplicação, para não precisar abrir Outlook, Gmail, webmail".

---

## 1. Objetivo

Cada pessoa da equipe lê, responde e escreve e-mail **dentro do Workspace**, sem abrir o webmail —
e a correspondência com clientes e leads deixa de ficar ilhada numa caixa de e-mail pessoal e
passa a fazer parte do histórico do cliente na aplicação.

Medido contra a pergunta-guia do produto ("como fazer a Thaís trabalhar com muito menos
estresse?"): hoje a informação de um cliente está dividida entre a app e a caixa de e-mail de
quem falou com ele. Este trabalho junta as duas.

## 2. Escopo

**Entra (Fase 1 completa):** caixas `@medconsultoria.com.br` · ler · responder · responder a
todos · encaminhar · escrever novo · anexos · pastas do servidor · marcar lido/mover/excluir ·
aviso de e-mail novo · assinatura por caixa · rascunho · busca · vínculo com cliente/lead ·
card de e-mails na ficha do cliente · IA para redigir e melhorar resposta.

**Fica de fora, deliberadamente:**

| Fora | Por quê |
|---|---|
| Gmail / Hotmail / Outlook.com | Google exige Senha de app (com 2FA obrigatório); Microsoft desligou senha em IMAP para contas pessoais em set/2024 e exige OAuth2. É o dobro do risco por uma fração do ganho — e quebra sozinho quando eles mudam a regra. Reavaliar depois da Fase 1 no ar. |
| Disparo em massa / campanha / newsletter | Outro produto, com outros requisitos (descadastro, reputação de domínio, agendamento). O servidor ainda limita 200 destinatários e 100 mensagens por conexão. |
| Notificar a equipe inteira de e-mail de cliente | Vira barulho; as pessoas desligam tudo. Só o dono da caixa é avisado. |
| Sincronizar rascunho com o webmail | Rascunho fica só na app (ver §5.6). Custo alto, valor baixo. |
| `IDLE` (push instantâneo do IMAP) | A hospedagem derruba o processo Node ocioso (mesma causa do ADR-84). Ver §6. |

## 3. Decisões do brainstorm (e o porquê)

1. **Só caixas `@medconsultoria.com.br` na Fase 1.** Todas as contas cadastradas da equipe são
   desse domínio; funcionam com usuário e senha, sem depender de Google/Microsoft.
2. **Não existe "caixa compartilhada" gerida pela app.** Cada usuário pluga na própria conta as
   caixas cuja senha ele tem. Quem manda no acesso é o servidor de e-mail. Para cortar o acesso
   de alguém, troca-se a senha da caixa no painel da hospedagem — a credencial guardada aqui
   simplesmente para de funcionar. Se duas pessoas plugam `contato@`, é a **mesma caixa**: o que
   uma lê ou apaga vale para a outra (comportamento correto de IMAP e o desejado para atendimento
   em equipe).
3. **A caixa é privada; a correspondência com o cliente é da empresa.** Ninguém abre a caixa de
   entrada de ninguém. Mas o e-mail trocado com um cliente/lead cadastrado é registro comercial
   da MedConsultoria e aparece na ficha daquele cliente para **quem já pode abrir aquela ficha** —
   nenhuma permissão nova é criada. Sustentado por duas garantias obrigatórias:
   - **"Marcar como particular"**: um clique tira o e-mail da ficha e ele volta a ser só do dono
     da caixa. Sem essa válvula, ninguém usa a caixa da app para assunto delicado e o recurso
     morre de desuso.
   - **Importar histórico é escolha informada**: ao plugar uma caixa, a app pergunta se deve
     trazer os e-mails já trocados com clientes cadastrados e avisa, na mesma tela, que eles
     ficarão visíveis para quem enxerga esses clientes.
4. **Índice + cache, não espelho completo** (opção "C"). A app guarda remetente, assunto, data,
   destinatários e o resumo; o corpo é buscado ao abrir e fica em cache. O **servidor de e-mail
   continua sendo a fonte da verdade** — apagou no celular, sumiu aqui.
5. **Página própria "E-mail"** no menu "Dia a dia", não uma aba de Mensagens. Mensagens é conversa
   interna da equipe e chamado de suporte; e-mail tem assunto, cópia, anexo e pasta.
6. **E-mails automáticos continuam saindo do remetente institucional** (`SMTP_FROM`), como hoje.
   A caixa pessoal serve para o que a pessoa escreve à mão. Na ficha do cliente os dois aparecem
   na mesma linha do tempo.

## 4. Realidade verificada do servidor

Verificado em 03/08/2026 com sondas diretas (não é suposição nem documentação da hospedagem):

| Item | Resultado |
|---|---|
| MX de `medconsultoria.com.br` | `mail.medconsultoria.com.br` → `148.113.216.81` (TineHost/`atena.hostsrv.org`). **Não** é Google Workspace nem Microsoft 365 |
| Portas | IMAP 993/143 · SMTP 465/587 · POP 995/110 — todas abertas |
| TLS | TLSv1.3, certificado válido |
| Servidor IMAP | Dovecot |
| Separador de pastas | **`.`** (ponto) — `INBOX.spam`, não `INBOX/spam` |
| Pastas especiais | Vêm marcadas com `SPECIAL-USE`: `\Sent` `\Trash` `\Drafts` `\Junk` — não é preciso adivinhar nomes |
| Capacidades relevantes | `QRESYNC` `CONDSTORE` `MOVE` `UIDPLUS` `ESEARCH` `SORT` `THREAD=REFERENCES` `PREVIEW` `BINARY` `SPECIAL-USE` `LITERAL+` `COMPRESS=DEFLATE` `QUOTA` `IDLE` |
| SMTP 465 | `AUTH PLAIN LOGIN`, `SIZE 78643200` (75 MB por mensagem), `LIMITS MAILMAX=100 RCPTMAX=200` |

**Consequências de desenho** (as capacidades acima não são detalhe — elas definem o §6):

- `ESEARCH` → **a busca por palavra dentro do corpo funciona** sem espelhar corpo nenhum: quem
  procura é o servidor. Isso remove a única desvantagem real da opção "C".
- `QRESYNC`+`CONDSTORE` → o servidor informa exatamente o que mudou desde a última sincronização,
  **inclusive o que foi apagado**. Retomar depois de o processo cair custa uma pergunta.
- `PREVIEW` → o resumo de uma linha da lista vem do servidor; não é preciso baixar o corpo.
- `THREAD=REFERENCES` → agrupamento de conversa feito pelo servidor.
- `UIDPLUS` → o `APPEND` na pasta Enviados devolve o UID novo; a linha entra no banco na hora,
  sem esperar a próxima sincronização.
- `SIZE`/`RCPTMAX` → limites de anexo (~50 MB de arquivo) e destinatários (200) validados na tela.

## 5. Modelo de dados

Seis models novos em `packages/db/prisma/schema.prisma`. Convenções do projeto (cuid, camelCase,
`deletedAt` para soft-delete onde faz sentido).

### 5.1 `CaixaEmail` — a caixa que alguém plugou

`id` · `userId` (dono, base da privacidade) · `email` · `rotulo` · `nomeExibicao` (vai no `From`) ·
`assinatura` · `imapHost`/`imapPorta` · `smtpHost`/`smtpPorta` · `usuario` · **`segredo`** (senha
cifrada, ver §7.1) · `padrao` · `ativa` · `estado` (`OK` | `AUTENTICACAO_FALHOU` | `ERRO`) ·
`ultimoErro` · `ultimaSyncEm` · `importarDesde` · `createdAt` · `deletedAt`.
`@@unique([userId, email])` · `@@index([userId, ativa])`.

O `segredo` **nunca** sai da API: nenhum procedure tRPC o devolve, em nenhuma forma.

### 5.2 `CaixaPasta` — uma pasta da caixa

`id` · `caixaId` · `caminho` (`INBOX`, `INBOX.spam`, `Sent`) · `nome` (rótulo amigável) · `papel`
(enum `PastaPapel`: `INBOX`|`SENT`|`DRAFTS`|`TRASH`|`JUNK`|`ARCHIVE`|`null`, vindo de
`SPECIAL-USE`) ·
`uidValidity` · `ultimoUid` · `highestModseq` (o ponteiro do `QRESYNC`) · `naoLidos` · `total` ·
`ordem`. `@@unique([caixaId, caminho])`.

### 5.3 `EmailMensagem` — o índice (e o cache do corpo)

`id` · `caixaId` · `pastaId` · `uid` · `messageId` · `inReplyTo` · `referencias` · `threadKey` ·
`deNome` · `deEmail` · `assunto` · `trecho` (do `PREVIEW`) · `dataEm` · `lido` · `respondido` ·
`temAnexo` · `tamanho` · **`corpoHtml`/`corpoTexto`** (nulos até alguém abrir) · `corpoEm` ·
**`particular`** · `createdAt`.
`@@unique([pastaId, uid])` · `@@index([caixaId, dataEm])` · `@@index([threadKey])`.

### 5.4 `EmailEndereco` — como se descobre o cliente

`id` · `mensagemId` · `papel` (enum `EnderecoPapel`: `DE`|`PARA`|`CC`|`CCO`|`RESPONDER_A`) ·
`nome` · `endereco` (sempre minúsculo). `@@index([endereco])` · `@@index([mensagemId])`.

> Enums no Prisma são globais ao schema — daí os nomes distintos `PastaPapel` e `EnderecoPapel`,
> em vez de um `Papel` que colidiria com o outro (e com qualquer `Papel` futuro).

**Decisão deliberada:** o vínculo com `Cliente`/`Lead` **não** é gravado na mensagem; é resolvido
por `JOIN` no endereço na hora de consultar. Consequência prática: um cliente cadastrado hoje faz
os e-mails antigos dele aparecerem na ficha **imediatamente**, sem rotina de correção. Gravar o
vínculo fixo exigiria um backfill a cada criação/alteração de cadastro — exatamente o tipo de
rotina que falha em silêncio.

### 5.5 `EmailAnexo` — metadado do anexo

`id` · `mensagemId` · `nome` · `tipo` (MIME) · `tamanho` · `parte` (caminho da parte no IMAP,
ex. `2.1`) · `cid` (para imagem embutida) · `arquivoId` (preenchido quando o anexo é salvo como
arquivo do cliente). `@@index([mensagemId])`.

O conteúdo do anexo **não é guardado**: é buscado no IMAP e transmitido ao navegador na hora do
download. Só vira arquivo em disco (via `lib/storage.ts`) quando a pessoa clica em salvar como
documento do cliente.

### 5.6 `EmailRascunho` — rascunho local

`id` · `caixaId` · `emRespostaA` (mensagemId) · `modo` (`NOVO`|`RESPONDER`|`RESPONDER_TODOS`|
`ENCAMINHAR`) · `para`/`cc`/`cco` (Json) · `assunto` · `corpo` · `anexosJson` · `atualizadoEm`.

**Limitação conhecida e aceita:** o rascunho vive só na aplicação, não aparece em Rascunhos do
webmail. Sincronizar rascunho por IMAP obriga a apagar e reenviar a mensagem inteira a cada
salvamento automático — custo alto para um objeto efêmero.

## 6. Backend

Módulo novo `apps/api/src/modules/email/` seguindo a camada do projeto
(`router` → `service` → Prisma): `email.router.ts`, `caixas.service.ts`, `sync.service.ts`,
`leitura.service.ts`, `envio.service.ts`, `vinculo.service.ts`, e `lib/imap.ts` (conexão),
`lib/mime.ts` (parse), `lib/cripto-caixa.ts` (cifra), `lib/sanitizar-html.ts`.

### 6.1 Dependências novas

| Pacote | Para quê | Observação |
|---|---|---|
| `imapflow` | Falar IMAP | MIT, mesmo autor do `nodemailer` já usado no projeto |
| `mailparser` | Desmontar MIME (corpo, anexos, cabeçalhos) | MIT, mesmo autor |
| `sanitize-html` | Higienizar o HTML recebido | MIT, amplamente usado |

Envio reaproveita o `nodemailer` que já existe — passa a aceitar credenciais por caixa em vez do
SMTP único.

### 6.2 Sincronização

Uma função `sincronizarPasta(caixaId, pastaId)`:

1. Conecta (TLS 993), `SELECT` com `QRESYNC (uidValidity highestModseq)`.
2. **`uidValidity` mudou** → o servidor renumerou a pasta: apaga as linhas locais daquela pasta e
   ressincroniza do zero.
3. O servidor devolve `VANISHED` (o que foi apagado) e as mudanças de marcação desde o
   `highestModseq` → aplica: remove linhas, atualiza `lido`/`respondido`.
4. `UID FETCH <ultimoUid+1>:*` com `UID FLAGS ENVELOPE BODYSTRUCTURE RFC822.SIZE PREVIEW` →
   grava as mensagens novas (índice + endereços + metadados de anexo). **O corpo não é baixado.**
5. Atualiza `ultimoUid`, `highestModseq`, `naoLidos`, `total`, `ultimaSyncEm`.
6. Fecha a conexão.

**Idempotente e interrompível:** avança por `UID` crescente e só move os ponteiros no fim. Se o
processo morrer no meio, a próxima execução retoma sem duplicar e sem buraco.

**Primeira sincronização:** limitada por `importarDesde`. São **duas coisas diferentes**, e a
distinção importa:

- **A janela padrão são 90 dias**, sem perguntar nada. É o que faz a caixa abrir rápido. O fim da
  lista tem "carregar mais antigos", que empurra a janela para trás sob demanda, de quem quiser.
- **"Importar histórico" é a pergunta do §3.3** e serve a outro propósito: puxar mais para trás
  (padrão sugerido: 24 meses) **porque esses e-mails vão aparecer nas fichas dos clientes**. É por
  isso que ela é opt-in e vem com o aviso de visibilidade — a janela de 90 dias é conveniência de
  desempenho; esta é uma decisão sobre quem vai ver o quê.

Nos dois casos `importarDesde` é o mesmo campo: a importação de histórico simplesmente o empurra
para trás e dispara uma sincronização de recuperação.

**Trava de concorrência:** uma sincronização por pasta por vez, com expiração — o processo pode
morrer segurando a trava, então ela precisa vencer sozinha.

### 6.3 Quando sincroniza

Não há `IDLE`: o LiteSpeed/lsnode derruba o processo ocioso (mesma causa do ADR-84). Conexão
sempre curta — abre, sincroniza, fecha. Três gatilhos:

| Gatilho | Efeito |
|---|---|
| Abrir a página / trocar de pasta | Sincroniza aquela pasta na hora |
| `refetchInterval` com a página aberta | Chega em segundos (padrão de tempo real do projeto, ADR-84) |
| Cron no servidor (`scripts/server/sync-emails.sh`, a cada 5 min) | Gera o aviso no sino com a página fechada; mesma infraestrutura do backup diário e do health-check |

O cron chama uma rota protegida por segredo compartilhado no `.env` (não é rota autenticada por
sessão — não há usuário logado num cron).

**Pré-carregamento do corpo:** o cron também busca o corpo das mensagens vinculadas a
cliente/lead. Isso existe por um motivo de privacidade, não de desempenho — ver §7.4.

### 6.4 Leitura

`abrirMensagem(mensagemId)`: se `corpoHtml` é nulo, busca a parte no IMAP, higieniza, grava o
cache e devolve; marca `\Seen` no servidor. Conversa completa via `THREAD=REFERENCES`.

**Busca:** `UID SEARCH` no servidor (`ESEARCH`) — cobre remetente, assunto **e corpo**. Os UIDs
devolvidos são casados com as linhas locais; o que não estiver indexado tem o envelope buscado na
hora.

### 6.5 Ações que escrevem no servidor

Marcar lido/não lido (`STORE \Seen`), mover (`MOVE`, suportado), excluir (**mover para a pasta
`\Trash`**, que é o que o webmail faz — não `EXPUNGE` direto), e enviar.

**Enviar** = SMTP 465 autenticado com as credenciais da caixa, `From` = a caixa, **mais `APPEND`
na pasta `\Sent`**. O `APPEND` não é opcional: sem ele a pessoa responde pela app e no celular
parece que nunca respondeu. Com `UIDPLUS` o `APPEND` devolve o UID, então a linha entra no banco
imediatamente.

Cabeçalhos de resposta corretos (`In-Reply-To`, `References`) para a conversa não quebrar no
cliente de e-mail do destinatário.

## 7. Segurança

### 7.1 Senhas das caixas

AES-256-GCM com o `crypto` nativo do Node (sem dependência nova). Chave em `EMAIL_CRYPTO_KEY`
(32 bytes, base64) no `.env` do servidor. Guardado como `v1:<iv>:<tag>:<cifrado>`, permitindo
trocar de esquema depois. **Sem a chave, o recurso fica desligado** — mesmo comportamento que o
`isEmailReal` já tem hoje quando falta SMTP.

**Limite honesto, registrado de propósito:** isso protege contra vazamento apenas do banco (um
dump, o backup diário). Não protege contra quem tem o servidor inteiro — ou seja, os ROOTs. Não
existe solução técnica para isso num sistema que precisa buscar e-mail sozinho; a alternativa
seria digitar a senha a cada acesso. A privacidade entre pessoas da equipe é regra de produto e
de conduta, não barreira criptográfica.

### 7.2 HTML de e-mail é a entrada mais hostil do sistema

Qualquer pessoa do mundo pode mandar HTML com código para dentro da aplicação. Três camadas, todas
obrigatórias:

1. **Higienização no servidor** (`sanitize-html`): remove `script`, `iframe`, `object`, `form`,
   `style` externo, atributos `on*` e URLs `javascript:`/`data:` executáveis.
2. **Exibição em `<iframe sandbox>`** sem `allow-scripts` e sem `allow-same-origin` — mesmo que
   algo escape da camada 1, não alcança a sessão da aplicação.
3. **Imagem remota bloqueada por padrão**, com botão "Mostrar imagens". Não é frescura: o pixel
   invisível é como quem manda spam confirma que o endereço existe e foi lido.

### 7.3 Proteção contra bloqueio no servidor de e-mail

Depois de falhas consecutivas de autenticação, a caixa entra em `AUTENTICACAO_FALHOU`, a app
**para de tentar** e a tela mostra "precisa reconectar". Tentar em laço faz o servidor bloquear o
IP por suspeita de invasão — e aí ninguém mais recebe e-mail, nem os automáticos.

### 7.4 Autorização

- Tudo em `protectedProcedure` (equipe). O Portal do Cliente **não** tem acesso a nada disto.
- Toda consulta de caixa/pasta/mensagem filtra por `caixa.userId === ctx.user.id`.
- **Exceção única e deliberada — `email.doCliente(clienteId)`**: consulta todas as caixas, sem
  filtro de dono, devolvendo só mensagens vinculadas àquele cliente/lead e **não** marcadas como
  `particular`. É a materialização da regra "correspondência com o cliente é da empresa". Reusa a
  mesma checagem de acesso que a ficha do cliente já faz — nenhuma permissão nova.
- **A ficha nunca busca corpo de mensagem no IMAP.** Ela mostra o corpo que já está em cache; o
  que não estiver aparece com cabeçalho e resumo. Isso evita que uma request de um usuário use as
  credenciais guardadas de outro para abrir a caixa dele. O pré-carregamento do §6.3 roda no cron,
  no contexto do próprio dono da caixa, e é o que mantém a ficha útil.
- **Revisão obrigatória antes do merge:** `security-reviewer` (credenciais, HTML hostil, a exceção
  de autorização acima) e `database-reviewer` (migrations e índices).

### 7.5 LGPD

E-mail de cliente contém dado pessoal e pode conter dado sensível. Duas coberturas: a válvula
"marcar como particular" e o aviso explícito na hora de importar histórico. A visibilidade nunca
excede quem já podia abrir a ficha daquele cliente.

## 8. Front-end

Módulo `apps/web/src/features/email/`, rota `/email`, entrada no menu "Dia a dia"
(`lib/paginas.ts`). Incluir `/email` no modo tela cheia do `AppLayout.tsx:374` (hoje fixo em
`/mensagens` e `/agenda`), com o mesmo divisor arrastável das Mensagens (ADR-83).

Três colunas: **caixas e pastas** (com contador de não lidos e "+ Adicionar caixa") · **lista**
(remetente com `Avatar`, assunto, resumo, data via `data()`, clipe de anexo, negrito para não
lido, busca com "Limpar" no padrão dos ADR-65..75, e **selo do cliente/lead** quando o remetente é
conhecido) · **mensagem aberta** (cabeçalho, corpo isolado, anexos, ações, e a faixa de contexto
com atalhos para a ficha, abrir chamado de suporte ou criar tarefa).

**Escrever:** `Modal` com `footer` fixo (ADR-44), seletor de caixa remetente, `Combobox` de
destinatários com autocomplete de clientes/leads/equipe (ADR-9), assunto, corpo com formatação,
anexos com validação dos limites do §4, assinatura da caixa entrando sozinha, e o botão de IA
reaproveitando o `AssistenteIADialog` (ADR-30) — a IA sugere, a pessoa aprova e envia.

**Adicionar caixa:** e-mail e senha; a app deduz servidor e portas do domínio, **testa a conexão
antes de salvar** e só grava se funcionar; erro de senha é dito na hora. Na mesma tela, a pergunta
sobre importar histórico, com o aviso de visibilidade.

**Formatação:** usar sempre os helpers centrais (`data`/`dataHora`/`haQuanto` de
`lib/format-date`) — nunca reimplementar (ADR-32).

## 9. Integração com o CRM

- **Card "E-mails" na ficha do cliente**: linha do tempo unificando o que a aplicação enviou
  (`EmailEnviado`, que já existe) e o que a equipe trocou pelas caixas, em ordem de data.
- **Responder de dentro da ficha**, já na conversa certa.
- **Anexo vira documento do cliente com um clique** — entra em `lib/storage.ts` e, se atender uma
  exigência de serviço pendente, marca o checklist (a infraestrutura do ADR-26 já existe inteira).
- **E-mail de desconhecido vira lead com um clique** — cria o lead no funil com nome, e-mail e o
  texto como primeiro registro, espelhando o que a captação pública já faz (ADR-15).
- **Aviso de e-mail novo:** novo tipo em `emails.registry` (`email_novo`) com `notificacao: true`
  e **fora** de `EMAIL_TIPOS` — gera notificação in-app e sino, e **nenhum e-mail** (mandar e-mail
  avisando de e-mail é absurdo). O registro é obrigatório: tipo ausente do registry quebra o scan.

## 10. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Processo derrubado no meio da sincronização | `QRESYNC` + avanço por UID + ponteiros movidos só no fim (§6.2) |
| Caixa grande na primeira sincronização | Janela de 90 dias + "carregar mais antigos" (§6.2) |
| Senha trocada no webmail → laço de falhas → IP bloqueado | Estado `AUTENTICACAO_FALHOU` para as tentativas (§7.3) |
| XSS via HTML de e-mail | Higienização + `iframe sandbox` + imagem remota bloqueada (§7.2) |
| E-mail sensível exposto na ficha | "Marcar como particular" + aviso ao importar histórico (§3.3) |
| Cache divergir do servidor | Servidor é a fonte da verdade; `VANISHED` do `QRESYNC` remove o que foi apagado |
| Enviado não aparecer no celular | `APPEND` na pasta `\Sent` (§6.5) |
| Servidor de e-mail lento travar a página | Prazo máximo por conexão e por operação; falha vira estado visível, não espera infinita |
| Anexo acima do limite | Validação na tela com os números reais do §4 |

## 11. Fatias de entrega

Cada fatia é um PR com CI verde e uma verificação real — nada é dado por pronto sem a prova.

| # | Entrega | Prova |
|---|---|---|
| 1 | Modelos, migration, cifra da caixa, plugar caixa com teste de conexão | Plugo `teste@medconsultoria.com.br` e ela aparece conectada |
| 2 | Sincronizar, listar, abrir mensagem (corpo sob demanda, higienizado) | Leio na app um e-mail mandado de fora |
| 3 | Pastas, marcar lido/não lido, mover, excluir | Mexo na app e confiro no webmail que mudou lá |
| 4 | Enviar: responder, responder a todos, encaminhar, novo, anexos, `APPEND` | Envio para `tibamooca@gmail.com`, chega, e está em Enviados no webmail |
| 5 | Vínculo com o CRM: selo na lista, card na ficha, "particular", importar histórico | Abro a ficha de um cliente e vejo a conversa |
| 6 | Aviso de e-mail novo (cron + sino + contador) | Mando um e-mail e o sino acende com a página fechada |
| 7 | IA para responder · anexo vira documento do cliente · e-mail vira lead | Fluxo completo ponta a ponta |

Depois da fatia 4 o webmail já é dispensável; da 5 em diante é o ganho que só esta app dá.

## 12. Testes

- **Vitest** nas partes puras e nas de risco: cifra/decifra da senha, parse de endereços e
  normalização, resolução do vínculo com cliente/lead, higienização do HTML (com casos de ataque
  reais), montagem dos cabeçalhos de resposta, decisão de ressincronização por `uidValidity`.
- **Integração** contra a caixa real de teste (`teste@medconsultoria.com.br`), no mesmo espírito
  dos testes de SMTP que já existem: sincronizar, enviar, conferir `APPEND`, simular senha errada.
- **Playwright** no fluxo crítico: plugar caixa → ler → responder → ver na ficha do cliente.
- Envio real de teste **apenas** para `tibamooca@gmail.com` ou `contato@medconsultoria.com.br`.

## 13. Pendências do dono

1. ~~Criar a caixa de teste~~ — **feito** (`teste@medconsultoria.com.br`, criada em 03/08/2026).
   A senha **não** está neste documento nem em nenhum arquivo do repositório; fica só no `.env`
   local, que é ignorado pelo git. **Recomendado trocá-la ao fim do desenvolvimento**, por ter
   trafegado por conversa.
2. **Gerar a `EMAIL_CRYPTO_KEY`** e colar no `.env` do servidor na hora do deploy — comando exato
   será fornecido. A chave não é guardada por mim nem versionada.
3. **Decidir depois da Fase 1** se contas externas (Gmail/Outlook) ainda fazem falta.

## 14. Documentação a atualizar ao concluir

`docs/CLAUDE.md` (regras de negócio + índice de ADRs) · `docs/DECISIONS.md` (ADR novo) ·
`docs/DATABASE.md` (os seis models) · `docs/ARCHITECTURE.md` (módulo `email`) ·
`docs/LINKS.md` (nada de porta nova; citar a página) · `docs/DEPLOY.md` (`EMAIL_CRYPTO_KEY`,
segredo do cron e a entrada de cron nova) · `CLAUDE.md` da raiz (estado atual).
