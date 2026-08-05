# E-mail na aplicação — Bloco 2: escrever, agir e ligar ao cliente

**Data:** 04/08/2026 · **Branch:** `feat/email-na-aplicacao` · **Continua:** ADR-95 (Bloco 1)
**Spec do Bloco 1:** `docs/superpowers/specs/2026-08-03-email-na-aplicacao-design.md`

## 1. Objetivo

O Bloco 1 entregou uma página que **lê**. Este bloco a transforma numa caixa de e-mail de
trabalho: escrever, responder, encaminhar, anexar, agir sobre a mensagem — e, o que só esta
aplicação pode dar, mostrar a correspondência com o cliente **dentro da ficha dele**.

Pergunta-guia de sempre: *como fazer a Thaís trabalhar com menos estresse?* O que reduz estresse
aqui é parar de alternar entre webmail e sistema, e nunca mais procurar "o que foi combinado com
esse cliente" em três lugares.

## 2. O que este bloco NÃO é

O pedido original foi "como se fosse o Gmail, bem completo, com tudo". Isso é o alvo errado, e
vale registrar por escrito para não voltar como pedido daqui a três meses.

O Gmail resolve o problema de bilhões de desconhecidos: propaganda, promoções, remetentes
hostis, gente que recebe centenas de e-mails por dia. Não é o problema da Thaís. Copiar o Gmail
entregaria o que ela menos precisa e adiaria o que só esta app dá.

| Fora | Por quê |
|---|---|
| Filtros e regras automáticas | Caixa de trabalho de uma pessoa; a pasta certa se resolve por ação manual, que é a fase 2B |
| Marcadores múltiplos (etiquetas) | IMAP tem **pasta**, não etiqueta. Emular custa caro e confunde quem também usa o webmail |
| Adiar (*snooze*), agendar envio | Exigem trabalho agendado confiável; o processo Node é derrubado quando fica ocioso |
| **Desfazer envio** | Exigiria segurar a mensagem nesse mesmo processo derrubável: ela sumiria sem enviar. Pior que não ter |
| Confirmação de leitura, abas de promoções, PGP | Custo alto, valor nenhum no uso interno |
| Agrupar a lista por conversa | Caro (muda listagem, paginação e contadores) para pouco ganho. Ver §6: 80% do valor por quase nada |
| Gmail/Outlook.com como caixa | Decisão do ADR-95, inalterada: OAuth2 obrigatório do outro lado |

## 3. Decisões deste brainstorm

1. **Ordem: 2A → 2B → 2D → 2C.** Ao fim de 2A+2B o webmail é dispensável; 2D é o ganho
   exclusivo; 2C é polimento e vem por último de propósito.
2. **Rascunho fica no servidor, na pasta `Drafts`** — isto **reverte** a decisão do ADR-95 §2
   ("sincronizar rascunho com o webmail: custo alto, valor baixo"). Motivo da mudança: rascunho
   só na app criaria uma **segunda pasta de rascunhos** na coluna, ao lado da `Drafts` do
   servidor — exatamente o defeito de usabilidade corrigido em 04/08 nas duas pastas de spam.
   Uma pasta só, e o rascunho existe no celular.
3. **Teto de anexo: 20 MB**, não os 75 MB que o servidor aceita. Alinha com `storage.ts` e com o
   processo único que serve API + SPA. Acima de 25 MB o destinatário no Gmail recusa de qualquer
   forma, então o limite maior seria promessa falsa.
4. **Conversa é leitura, não estrutura**: `threadKey` já é gravado e indexado; ao abrir uma
   mensagem, mostramos as anteriores da mesma conversa. A lista continua sendo de mensagens.
5. **IA para redigir e aviso de e-mail novo ficam para a fase 2E**, depois de a caixa funcionar.
6. **O que a pessoa envia à mão não entra em `EmailEnviado`.** Aquela tabela é o monitor dos
   e-mails automáticos da app (ADR-21); misturar envio humano poluiria o painel de entregas. A
   cópia do enviado vive na pasta `Enviados` do servidor, como manda o IMAP. Na ficha do cliente
   (§7) os dois aparecem na mesma linha do tempo — que é o único lugar onde juntá-los ajuda.

## 4. Restrições herdadas (do ADR-95, não renegociar)

- Servidor **Dovecot** da TineHost; separador de pasta é **ponto**; `MOVE`, `UIDPLUS`, `ESEARCH`,
  `QRESYNC` disponíveis; **sem `IDLE` utilizável** — nada de push, tudo por sincronização.
- **Um processo Node** serve API + SPA + tempo real: nada de segurar coisa grande em memória.
- **Índice + cache, nunca espelho.** O servidor de e-mail é a fonte da verdade.
- E-mail é **conteúdo hostil de terceiro**: as três camadas do Bloco 1 (higienizar → rota
  `/email-corpo/:id` com CSP própria → imagem remota bloqueada por allowlist `cid:`) continuam
  valendo e não podem ser contornadas por caminho novo.
- SMTP 465, `RCPTMAX=200`. Envio real de teste **só** para `tibamooca@gmail.com` ou
  `contato@medconsultoria.com.br`.

## 5. Fase 2A — Escrever, responder, encaminhar

A fase mais pesada do bloco. É ela que dispensa o webmail.

### 5.1 Conexão SMTP

`smtp.ts` com `comSmtp(caixaId, fn)`, espelhando o `comCaixa` do `imap.ts`: decifra a senha,
abre conexão curta em `mail.<domínio>:465`, executa, fecha **sempre**. Sem conexão viva entre
requisições — mesma razão do IMAP.

Falha de autenticação marca `AUTENTICACAO_FALHOU` e **para** de tentar, como no IMAP: laço de
tentativas faz o servidor bloquear o IP, e aí ninguém recebe e-mail, nem os automáticos.

### 5.2 Os três passos do envio

Nesta ordem, e o segundo é o que quase todo mundo esquece:

1. **SMTP envia.** Ao responder, os cabeçalhos `In-Reply-To` e `References` saem da mensagem
   original. Sem eles a resposta chega ao destinatário como assunto novo e a conversa se parte
   **do lado dele** — dano invisível daqui.
2. **`APPEND` na pasta `\Sent`.** SMTP não guarda cópia. Sem este passo, ela responde pela app e
   no celular dela o e-mail não existe.
3. **Marca `\Answered`** na original e `respondido = true` no índice — é o que acende o "já
   respondi este".

**Falha parcial:** se o processo cair entre 1 e 2, o e-mail foi enviado e a cópia falta. A tela
avisa que a cópia não foi guardada; **não reenvia**. Reenviar seria pior que a falha.

### 5.3 Escrever, responder, responder a todos, encaminhar

Um único componente de composição, com o modo vindo por parâmetro — não quatro telas parecidas.

- **Responder a todos** remove o próprio endereço da caixa dos destinatários. Sem isso ela se
  copia em toda resposta.
- **Citação** da mensagem original com cabeçalho ("Em 04/08/2026, Fulano escreveu:"), a partir do
  corpo **já higienizado** — nunca do HTML cru (ver §8).
- **Encaminhar** leva os anexos originais junto, buscando as partes no servidor no momento do
  envio (não guardamos anexo em disco por causa disso).
- **Assinatura:** `CaixaEmail.assinatura` já existe no schema e nunca foi usado. Entra na edição
  da caixa e é anexada ao corpo ao compor.

### 5.4 Anexos

**Enviar:** rota multipart reaproveitando `uploads.ts` (teto de 20 MB e allowlist de mimetypes
já existentes). O arquivo é gravado sob `UPLOADS_DIR` numa pasta `email-tmp/<caixaId>/`, enviado
e removido logo depois — inclusive quando o envio falha, para o diretório não virar depósito.

**Baixar** é o ponto delicado. Rota própria fora do tRPC (`http/email-anexo.ts`), que faz `FETCH`
**só daquela parte** (`EmailAnexo.parte` já é gravado no índice) e responde em *stream*: carregar
20 MB na memória do processo que serve a app inteira é o mesmo erro do corpo, só que maior.

Obrigatórios na resposta: `Content-Disposition: attachment` (sempre, inclusive para tipos que o
navegador saberia abrir) e `X-Content-Type-Options: nosniff`. Um `anexo.html` aberto no navegador
seria XSS no nosso próprio domínio, contornando as três camadas do Bloco 1.

### 5.5 Rascunho

`APPEND` na pasta `Drafts` do servidor **após 5 segundos sem digitar, e ao fechar a janela** —
nunca a cada tecla, que seria uma conexão IMAP por tecla. IMAP não edita mensagem: cada gravação é um
`APPEND` novo mais a remoção da versão anterior, cujo UID veio do `UIDPLUS` da gravação passada.

### 5.6 Prova da fase

Teste de integração contra o servidor real: envio para `tibamooca@gmail.com`, confirmação de que
chegou, de que está em `Enviados` e de que `In-Reply-To`/`References` vieram corretos. Sem isso,
"enviado" é promessa, não fato.

## 6. Fase 2B — Ações do dia a dia

Marcar lido/não lido · arquivar · apagar (mover para `Trash`) · mover para pasta · marcar spam.
Barato: o servidor tem `MOVE` e `UIDPLUS`.

Regras:
- **Ação destrutiva pede confirmação** (regra da app inteira, 100% das ações destrutivas).
- **O servidor é a fonte da verdade:** a ação vai ao IMAP primeiro e o índice local é atualizado
  depois. Índice otimista que diverge do servidor é pior que ação lenta.
- Apagar move para a Lixeira; **não** existe apagar definitivo pela app.

## 7. Fase 2D — O que só esta app dá

A regra de negócio do ADR-95: **a caixa é privada, a correspondência com o cliente é da empresa.**

- **Card "E-mails" na ficha do cliente/lead**: linha do tempo unindo o que a app enviou
  (`EmailEnviado`) e o que a equipe trocou pelas caixas. O vínculo é `JOIN` em `EmailEndereco`
  pelo endereço do cliente — a tabela e o índice `@@index([endereco])` já existem.
- **Visibilidade:** aparece para quem já pode abrir aquela ficha. **Nenhuma permissão nova.**
- **"Marcar como particular"** (`EmailMensagem.particular`, campo já existe): um clique tira da
  ficha. Sem essa válvula ninguém usa a caixa da app para assunto delicado e o recurso morre.
- **Anexo vira documento do cliente** com um clique (`EmailAnexo.arquivoId` já existe; a
  infraestrutura de exigências do ADR-26 já existe inteira).
- **E-mail de desconhecido vira lead** com um clique, espelhando a captação pública (ADR-15).

## 8. Segurança

Revisão de segurança é **obrigatória** neste bloco: envio mexe com autenticação de terceiro e
anexo é conteúdo hostil.

- **Autorização:** toda mutation confere que a caixa é do usuário logado, no serviço, antes de
  tocar no IMAP/SMTP — o padrão que `listarPastas` já estabeleceu.
- **Citação higienizada:** citar HTML cru de terceiro dentro de um e-mail nosso reintroduz o XSS
  pela porta dos fundos, e ainda o envia para fora com nossa assinatura.
- **Anexo baixado:** `attachment` + `nosniff`, sempre; nome de arquivo sanitizado.
- **Destinatários:** no máximo 200 (`RCPTMAX`), validado no schema de entrada.
- **Segredo:** a senha da caixa nunca sai da API, nem em log, nem em erro (o `logger: false` do
  `imapflow` vale igual para o transporte SMTP).
- **Envio real de teste:** só `tibamooca@gmail.com` ou `contato@medconsultoria.com.br`.

## 9. Banco de dados

**Nenhuma migration prevista.** O schema do Bloco 1 já tem tudo que este bloco usa:
`CaixaEmail.assinatura`, `EmailMensagem.respondido`, `EmailMensagem.particular`,
`EmailMensagem.threadKey` (+ índice), `EmailAnexo.parte`, `EmailAnexo.cid`, `EmailAnexo.arquivoId`
e `EmailEndereco` com `@@index([endereco])`.

Se ainda assim surgir uma, aplicar nos **três** bancos: dev, `medconsultoria_test` e
`medconsultoria_e2e` — e migrar em MODO PAUSA (`touch scripts/.keepalive-pause`).

## 10. Arquivos previstos

O módulo hoje soma ~1.200 linhas na API e ~510 no front. Para não repetir o inchaço, cada
responsabilidade nova nasce em arquivo próprio:

| Arquivo | Responsabilidade |
|---|---|
| `apps/api/src/modules/email/smtp.ts` | `comSmtp`: conexão curta e tradução de erro |
| `apps/api/src/modules/email/envio.service.ts` | Montar a mensagem, os três passos do envio |
| `apps/api/src/modules/email/citacao.ts` | Citação e cabeçalho de resposta (puro, testável) |
| `apps/api/src/modules/email/rascunhos.service.ts` | `APPEND`/substituição na `Drafts` |
| `apps/api/src/modules/email/acoes.service.ts` | Lido, mover, arquivar, apagar, spam (2B) |
| `apps/api/src/modules/email/vinculo.service.ts` | E-mails por cliente/lead (2D) |
| `apps/api/src/http/email-anexo.ts` | Download em stream, com `attachment` + `nosniff` |
| `apps/web/src/features/email/Escrever.tsx` | Composição única, com modo por parâmetro |

## 11. Testes

- **Puro/unitário:** citação e cabeçalhos de conversa, "responder a todos" tirando o próprio
  endereço, validação de destinatários e de tamanho de anexo.
- **Integração contra o servidor real:** envio + `APPEND` + `\Answered`; rascunho gravado e
  substituído na `Drafts`; mover e apagar refletindo no servidor.
- **E2E:** escrever e responder pela tela; anexo baixado com o cabeçalho certo.
- **Placar:** os testes de integração **pulam em silêncio** sem `EMAIL_TESTE_USER`/`PASS`.
  Pular não é passar — conferir o número de pulados a cada rodada.

## 12. Fatias de entrega

| # | Entrega | Prova |
|---|---|---|
| 1 | `comSmtp` + enviar novo e-mail + `APPEND` em Enviados | E-mail chega em `tibamooca@` e aparece em Enviados no webmail |
| 2 | Responder, responder a todos, encaminhar, citação, assinatura | Respondo pela app e a conversa continua certa no cliente do destinatário |
| 3 | Anexos: enviar e baixar em stream | Mando um PDF e baixo o anexo de um e-mail recebido |
| 4 | Rascunho na `Drafts` do servidor | Escrevo metade, fecho, e o rascunho está no webmail |
| 5 | Ações (2B): lido, mover, arquivar, apagar, spam | Mexo na app e confiro no webmail que mudou lá |
| 6 | Ficha do cliente (2D): card, particular, anexo→documento, e-mail→lead | Abro a ficha de um cliente e vejo a conversa |
| 7 | Conforto (2C): conversa ao abrir, filtros, busca, atalhos | Navego a caixa sem tocar no mouse |

**Um plano por fase, não um plano para o bloco todo.** O primeiro plano cobre a fase 2A (fatias
1 a 4); as fases 2B, 2D e 2C ganham plano próprio quando chegarem. Plano longo demais envelhece
antes de ser executado — foi o que já aconteceu com o rascunho, decidido de um jeito no ADR-95 e
revertido aqui.

## 13. Riscos

| Risco | Mitigação |
|---|---|
| Processo cai entre enviar e `APPEND` | Avisa que a cópia falhou; nunca reenvia (§5.2) |
| Anexo grande derruba o processo | Teto de 20 MB + download em *stream*, nunca em memória |
| `anexo.html` aberto no navegador vira XSS | `Content-Disposition: attachment` + `nosniff`, sempre |
| Citação reintroduz HTML hostil | Citar só o corpo já higienizado |
| Conversa se parte no destinatário | `In-Reply-To`/`References` cobertos por teste |
| Rascunho gerando conexão por tecla | Grava ao pausar e ao fechar, não a cada tecla |
| E-mail sensível exposto na ficha | "Marcar como particular" (§7) |

## 14. Documentação a atualizar ao concluir

`docs/DECISIONS.md` (ADR novo, referenciando o ADR-95 e registrando a reversão do rascunho),
`docs/CLAUDE.md`, `CLAUDE.md` da raiz (estado atual), `docs/ROADMAP.md` e a memória
`email-na-aplicacao-2026-08-03`.
