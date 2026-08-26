# DATABASE.md — Workspace MedConsultoria

Modelagem de dados. Banco: **MySQL 8+ (utf8mb4)**. ORM: **Prisma**. Este documento é a referência de alto nível; a fonte de verdade é o `schema.prisma` em `packages/db`. Atualize os dois juntos.

> Estado atual: o schema já cobre CRM inteligente, projetos, agenda, financeiro, mensagens, documentos+assinatura, e-mails e observabilidade. Migrations são aplicadas incrementalmente (ver `packages/db/prisma/migrations`).

---

## 1. Convenções

- **PK:** `id String @id @default(cuid())` — não-sequencial (seguro em URLs e no Portal). Exceção: `EmailTemplate` usa `chave` como PK.
- **Timestamps:** a maioria dos models tem `createdAt` e, quando muda, `updatedAt`.
- **Soft delete:** onde faz sentido (Cliente, Lead, Projeto, Card, Conta, Documento, Mensagem), `deletedAt DateTime?`; queries padrão filtram `deletedAt: null`.
- **Charset:** utf8mb4. **Dinheiro:** `Decimal @db.Decimal(12,2)` — **nunca float, sem exceção** (a última, `Lead.valorEstimado`, caiu na ADR-118). O `Decimal` **para no servidor**: a função de serviço converte para `number` com `emReais()`/`emReaisOu()` (`apps/api/src/lib/dinheiro.ts`) antes de devolver ao tRPC — `Decimal` que chega ao navegador vira objeto no JSON e a tela mostra "R$ NaN". **Datas:** UTC.
- **Índices:** toda FK e filtro comum indexado.
- **Auditoria:** ações relevantes geram `ActivityLog` (alimenta timelines e rastreio LGPD).
- **Polimorfismo:** `Nota`, `ActivityLog` e `Notificacao` usam `entidadeTipo (String) + entidadeId (String)` (Prisma não tem relação polimórfica nativa) — validado na camada de service.

---

## 2. Identidade, Acesso & Observabilidade

### User
`id`, `nome`, `email @unique`, `passwordHash?` (null = convite pendente, ainda sem senha), `role (enum Role)`, `ativo Boolean`, **`avatarUrl?`** (foto de perfil — caminho relativo em `avatars/{userId}/…`; servido por `GET /avatar/:userId`, enviado por `POST /avatar`; ADR-42), `clienteId?` (escopo do Portal quando `role = CLIENTE`), **`senhaTrocadaEm?`** (quando a pessoa definiu a PRÓPRIA senha; nulo = nunca — conta interna nessa situação é obrigada a definir no 1º acesso, ADR-91), timestamps, `deletedAt?`.
- `role`: `ROOT | ADMIN | FUNCIONARIO | CLIENTE`.
- Relações: sessions, tokens, notas, notificações, preferências de e-mail, participações em projeto, docs criados/aprovados, etc.

### Session
`id`, `userId`, `expiresAt`, `userAgent?`, `ip?`, `createdAt`. Permite revogação (logout, troca de senha, desativação).

### Token
Token de uso único, guarda **só o hash** (sha256). `id`, `tokenHash @unique`, `tipo` ("CONVITE" | "RESET"), `userId`, `expiresAt`, `usedAt?`, `createdAt`. O valor cru só existe no link enviado por e-mail.

### PreferenciaEmail
Opt-out por categoria de e-mail. `id`, `userId`, `tipo`, `ativo` (default true), `@@unique([userId, tipo])`. **Ausência de linha = habilitado.**

### EmailTemplate
Template editável de e-mail (PK = `chave`). `chave`, `assunto`, `titulo`, `corpo @Text` (parágrafos + `{{variaveis}}`), `ctaTexto?`, `nota?`, `atualizadoPor?`, `atualizadoEm`. Semeado a partir do registry; editável em Comunicações.

### ActivityLog
`id`, `userId?`, `acao`, `entidadeTipo?`, `entidadeId?`, `dados Json?`, `createdAt`. Genérico — timeline + auditoria.

### ErrorLog
Erros do servidor agrupados por `fingerprint @unique` (estilo "issue" do Sentry), capturados automaticamente para o painel ROOT. `rota?`, `mensagem`, `stack?`, `userId?`, `ocorrencias`, `resolvido`, `resolvidoEm?`, `regrediu`, `ignorado`, `createdAt`, `ultimaVez`. Ocorrências idênticas somam no mesmo registro.

### Incidente
Aberto automaticamente pelo motor de alertas quando um sinal cruza o limiar (com histerese). `regra`, `titulo`, `severidade` ("degradado"|"critico"), `componente`, `detalhe`, `status` (ABERTO|RECONHECIDO|RESOLVIDO), `valorPico?`, `createdAt`, `reconhecidoEm?`, `resolvidoEm?`. Guarda histórico + MTTR.

### IdentidadeInstitucional (ADR-85)
**Identidade da empresa, editável pela Thaís** (Ajustes → Dados da empresa). Linha única (singleton, `id: "default"`). Campos de marca/contato **NOT NULL** (semeados com os dados reais na 1ª leitura via `getIdentidade()` upsert): `nome`, `tagline`, `site`, `siteUrl`, `email`, `telefone`, `cidade`, `instagram`, `instagramUrl`. Campos **jurídicos NULLABLE** (`@db.Text` onde faz sentido): `razaoSocial?`, `cnpj?`, `enderecoCompleto?`, `foro?` — começam `null` (ninguém inventa CNPJ; enquanto vazios, o contrato mostra `**[A PREENCHER]**`). `atualizadoEm`. É a **fonte da verdade** que alimenta contratos/propostas/e-mails; `packages/shared/.../institucional.ts` é o padrão/fallback. Escrita só ADMIN+ (`identidade.atualizar`), leitura pela equipe (`identidade.get`).

---

## 3. CRM (Fase 1 + funil inteligente)

### Cliente
`id`, `nome`, `cnpj?` (**sempre CNPJ** — todo cliente é pessoa jurídica, ADR-119; o campo `tipo`/`ClienteTipo` e o antigo `documento` deixaram de existir na migração `20260819161500_cliente_sempre_pj`), `email?`, `telefone?`, `observacoes?`, **`situacaoComercial String @default("ATIVO")`** (`PROSPECT | NEGOCIACAO | ATIVO | INATIVO | PERDIDO`) — PROSPECT/NEGOCIACAO/PERDIDO são estados do **funil** (leads), mantidos por `reconciliarSituacaoCliente` (ADR-22). **ATIVO/INATIVO** são estados de **cliente de verdade** (toggle manual via `clientes.setAtivo`; ATIVO nunca é rebaixado pelo funil). A **página Clientes lista só ATIVO/INATIVO** (ADR-24) — os demais vivem no Funil. `responsavelId?`, timestamps, `deletedAt?`.
- Relações: `contatos[]`, `projetos[]`, `eventos[]`, `contas[]`, `documentos[]`, `usuariosPortal[]` (User CLIENTE), `suporteMensagens[]`, `leadsConvertidos[]` (LeadConvertido) e `leadsPortal[]` (LeadClientePortal).

### Contato
Pessoa dentro de um Cliente. `id`, `clienteId`, `nome`, `cargo?`, `email?`, `telefone?`, `principal Boolean`.

### PipelineStage
Colunas do funil. `id`, `nome`, `ordem`, `cor?`, **`chaveAuto?`** (chave estável usada pela automação: `novo|qualificacao|proposta|negociacao|fechado`). Auto-semeadas.

### Origem
Catálogo editável de origens de lead. `id`, `nome`, `ativo`, `ordem`, `createdAt`. Alimenta o autocomplete de origem.

### Operadora
Catálogo editável de operadoras/convênios — **um cadastro só, usado por dois serviços** (ADR-58, ADR-126). `id`, `nome`, `ordem`, `createdAt`, **`usoCredenciamento Boolean @default(true)`** e **`usoFaturamento Boolean @default(true)`**. A mesma Unimed que se credencia é a Unimed cujas contas se faturam: duas listas separadas divergiriam com o tempo, então o que muda de um serviço para o outro são as **marcações**. Ambas nascem `true` — as operadoras que já existiam entram nas duas listas, senão a 1ª proposta de faturamento abriria vazia e pareceria defeito. ⚠️ **Operadora marcada para NADA é recusada** (serviço e tela): ela sumiria de todas as listas sem aviso. Semeado com `OPERADORAS_COMUNS` na 1ª leitura; a equipe renomeia e exclui pela tela. Router `documentos.operadoras` (**list com filtro `uso`** / criar / **atualizar** — o antigo `renomear` virou `atualizar`, porque nome e marcações se gravam no mesmo movimento / remover). A **grade do credenciamento** (`gradeDoCliente`) mostra as marcadas para CREDENCIAMENTO **mais** as que já têm processo daquele cliente, mesmo desmarcadas depois — mesma lição da ADR-105: filtrar por marcação atual apagaria da tela o que foi preservado. **Desde o ADR-104 há FK:** `Credenciamento.operadoraId` é `Restrict`, então **operadora com credenciamento registrado não pode ser excluída** — apagá-la levaria junto o andamento e o elo com a cobrança. O serviço confere antes e devolve um recado dizendo quantos processos estão presos nela; renomear continua livre.

### Servico
Catálogo de serviços da MedConsultoria (editável). `id`, `nome`, `descricao?`, **`categoria?`** (pilar: Gestão|Faturamento|Networking|Desenvolvimento|Marketing — ADR-27), `ativo`, `ordem`, `createdAt`. **Precificação flexível (ADR-33):** **`valor? Decimal @db.Decimal(12,2)`** (valor fixo de referência — era `Float` até a ADR-118) + **`valorRecorrencia PrecoRecorrencia @default(AVULSO)`**; **`percentual? Decimal @db.Decimal(12,2)`** (% sobre o faturamento do cliente, ex.: 5 = 5%) + **`percentualRecorrencia PrecoRecorrencia @default(MENSAL)`** — enum **`PrecoRecorrencia { AVULSO, MENSAL }`**. Um serviço pode ter valor fixo e/ou %, cada um avulso ou mensal. **Na UI o % aparece quando o serviço TEM percentual, não só na categoria "Faturamento" (ADR-125)** — a checagem por categoria fazia abrir-e-salvar outro serviço apagar o percentual dele em silêncio. Também **`condicaoPagamento? @Text` (ADR-125)**: a frase de condição de pagamento que a PROPOSTA pré-preenche quando este serviço é escolhido (o Faturamento nasce com "O recebimento do Repasse será sempre feito após o crédito na conta da Clínica."); mesmo molde de `clausulasContrato` — editável em Serviços, nunca escrita no código. Relações: `leads[]` (LeadServicos, N-N), `passos[]`, `requisitos[]`, `contratacoes[]` (ClienteServico), `arquivos[]`. O lead marca o que precisa; guia o checklist do funil e vira tarefas do projeto na conversão. Catálogo granular real (10 serviços) semeado a partir de `brand/` + site.

### ServicoPasso
Passo padrão de um serviço, atrelado a uma etapa. `id`, `servicoId`, `titulo`, `obrigatorio`, **`etapaChave`** (`novo|qualificacao|...`), `ordem`. Ao um lead escolher o serviço, estes passos entram no checklist da etapa correspondente.

### ServicoRequisito (ADR-26, ADR-31)
Exigência (item de checklist) de um serviço — o que é preciso para executá-lo. `id`, `servicoId`, `titulo`, `descricao?`, **`tipo`** (`DOCUMENTO` = cliente envia arquivo; **`INFORMACAO` = cliente escreve uma resposta na tela**; `BRIEFING` = formulário online com várias perguntas), `obrigatorio`, `ordem`, `createdAt`. Semeado com exemplos editáveis (`seedRequisitosSeVazio`, por palavra-chave do nome do serviço). **Atendimento:** `DOCUMENTO` fica "atendido" quando há um `Arquivo`; `INFORMACAO`/`BRIEFING` quando há uma `FormularioResposta` `ENVIADO`.

**Credenciamento (ADR-103) — 3 colunas opcionais:** **`escopo?`** (`EMPRESA|CLINICA|PROFISSIONAL|RESPONSAVEL_TECNICO`, validado em `@app/shared`; ausente = comportamento de sempre, uma vaga sem vínculo com médico — e `PROFISSIONAL` **repete por médico**); **`frenteVerso Boolean @default(false)`** (divide a exigência em **duas vagas de envio**); **`travaElegibilidade?`** (`ALVARA_FUNCIONAMENTO|ALVARA_VIGILANCIA|CNES|TITULO_ESPECIALISTA` — a triagem consulta a **chave**, nunca o título, para renomear o documento na tela não quebrar a regra). A lista canônica dos 14 documentos e a reconciliação vivem em `servicos/credenciamento.service.ts`, que **nunca apaga exigência** (ver `Arquivo`).

### Profissional (ADR-103)
Médico/dentista **a credenciar**, filho de um `Cliente` — o credenciamento é por pessoa. `id`, `clienteId`, `nome`, **`conselho`** (`CRM|CRO|CRP|CRN|CREFITO|CRFA`, texto validado por Zod e não enum do banco: aceitar conselho novo é uma linha no `shared`, sem migração), `conselhoNumero?`, `conselhoUf? @db.VarChar(2)`, `especialidade?` (entra na proposta), **`anoFormatura? Int`** (regra R5: 5 anos de formado; a triagem devolve o **ano em que fica apto**), **`tituloEspecialista`** (R6 — declarado; o comprovante é a exigência "Especializações"), `responsavelTecnico`, **`ativo`** (desligar sem apagar histórico), timestamps. `onDelete: Cascade` a partir de `Cliente`. **Remover profissional com arquivo enviado OU com credenciamento registrado apenas o DESATIVA** — apagar soltaria o arquivo do cliente (`Arquivo.profissionalId` é `SetNull`) e levaria junto o andamento na operadora (`Credenciamento.profissionalId` é `Cascade`).

### Credenciamento (ADR-104)
A **grade médico × operadora**: cada cruzamento é uma linha. Uma peça, três funções — monta o preço da proposta, acompanha o andamento e dispara a cobrança. `id`, `clienteId`, `profissionalId`, `operadoraId`, **`valor Decimal(12,2)`** (o preço daquela célula), **`status StatusCredenciamento`** (`A_PROTOCOLAR|PROTOCOLADO|EM_ANALISE|APROVADO|NEGADO|ENCERRADO`), **`tentativa Int @default(1)`**, `documentoId?` (a proposta que originou, `SetNull`), **`contaId?`** (a conta a receber criada na aprovação, `SetNull`), `protocoladoEm?`/`emAnaliseEm?`/`aprovadoEm?`/`negadoEm?`/`encerradoEm?`, `motivoNegativa? @Text`, `observacoes? @Text`, timestamps. **`@@unique([profissionalId, operadoraId, tentativa])`** — não existem duas linhas para o mesmo par na mesma tentativa.

**Regras que moram aqui, não na tela:** as transições permitidas são as de `transicaoCredenciamentoPermitida` (`@app/shared`, pura e testada) — **`NEGADO` nunca vira `APROVADO`** (a negativa é o fato que justifica cobrar de novo; retentar é linha NOVA com `tentativa` maior e o acordo do §3.4 gravado), e `APROVADO` só vai para `ENCERRADO`. `operadoraId` é **`Restrict`**: operadora com credenciamento não sai do catálogo (o serviço traduz o erro do banco em recado explicável). **A conta a receber nasce só quando o status vira `APROVADO`** (`credenciamento-grade.service.ts`) — nem no aceite da proposta, nem ao contratar o serviço na ficha, nem na conversão do lead; nesses dois últimos, `ehServicoDeCredenciamento` faz a provisão automática pular este serviço.

### Formulario / FormularioCampo / FormularioResposta (ADR-28, ADR-31)
Formulários/briefings online reutilizáveis. **`Formulario`**: `id`, `titulo`, `descricao?`, `ativo`, **`interno`** (`Boolean @default(false)` — criado automaticamente para um requisito `INFORMACAO` de pergunta única; **não** aparece no catálogo de Formulários, é gerido junto com o requisito e apagado quando ele é removido), timestamps; relações `campos[]`, `requisitos[]`, `respostas[]`. **`FormularioCampo`**: `id`, `formularioId`, `rotulo`, **`tipo`** (`TEXTO_CURTO|TEXTO_LONGO|ESCOLHA|MULTIPLA|NUMERO|SIM_NAO|DATA`), `obrigatorio`, `opcoes?` (JSON), `ajuda?`, `ordem`. **`FormularioResposta`**: `id`, `formularioId`, `clienteId`, `requisitoId?`, `servicoId?`, `respostas @Text` (JSON `{campoId: valor}`), **`status`** (`RASCUNHO|ENVIADO`), `enviadoEm?`, timestamps. `ServicoRequisito.formularioId` liga um requisito `BRIEFING` (formulário do catálogo) ou `INFORMACAO` (formulário interno de 1 campo `TEXTO_LONGO`) ao seu formulário; fica "atendido" quando há resposta `ENVIADO`.

### ClienteServico (ADR-26, ADR-33)
Fonte da verdade dos **serviços contratados** por um cliente. `id`, `clienteId`, `servicoId`, **`status`** (`ATIVO|CANCELADO`), **`origem`** (`MANUAL` = equipe ligou na ficha; `FUNIL` = veio da conversão de um lead ganho), `observacao?`, `contratadoEm`, `canceladoEm?`, **`canceladoPorTipo?`** (`EQUIPE|CLIENTE`), timestamps. **Precificação do que o cliente REALMENTE paga (ADR-33):** `valor? Decimal @db.Decimal(12,2)` (era `Float` até a ADR-118) + **`valorRecorrencia PrecoRecorrencia @default(AVULSO)`** + `percentual? Decimal @db.Decimal(12,2)` + **`percentualRecorrencia PrecoRecorrencia @default(MENSAL)`** — herdada do `Servico` ao contratar (`ativarServicoCliente`), **editável na ficha** (`clientes.atualizarContratacao`; card "Serviços contratados"). **@@unique([clienteId, servicoId])** (idempotente). Substitui os "contratados" antes derivados dos leads ganhos. **Convênios atendidos (ADR-126):** relação **N-N `operadoras[]`** (tabela de ligação `_ClienteServicoOperadoras`) — os convênios que o cliente atende NAQUELE serviço. Nascem da proposta aceita (viajam **dentro do item**, em `conveniosIds`, para atravessar o aceite pelo mesmo caminho de serviço e preço) e seguem editáveis na ficha (`clientes.atualizarContratacao`, campo `conveniosIds`) — a lista muda com o tempo e é dado do CLIENTE, não do documento que a originou. Aparecem também no **Portal do cliente**. A gravação usa `set` (a lista manda), e `conveniosIds` ausente **não mexe** no que já está lá: proposta de outro serviço não pode zerar a lista de passagem.

### Arquivo (ADR-26)
Arquivo enviado (upload) — pelo `CLIENTE` (Portal) ou pela `EQUIPE` (ficha). Guardado no disco (`UPLOADS_DIR`); aqui só os metadados. `id`, `nome` (original), `mimetype`, `tamanho Int`, **`caminho`** (relativo, nome em disco por UUID), `clienteId`, `servicoId?`, `requisitoId?` (atende uma exigência), **`enviadoPorTipo`** (`CLIENTE|EQUIPE`), `enviadoPorId?`, `createdAt`, `deletedAt?`. Servido por `GET /arquivos/:id` (fora do tRPC), autenticado com checagem de posse.

**Credenciamento (ADR-103) — 2 colunas opcionais:** **`profissionalId?`** (de qual médico é o documento; `SetNull`) e **`lado?`** (`FRENTE|VERSO`). Arquivo antigo continua válido sem elas. **`profissionalId` vem do formulário — inclusive do Portal, onde quem envia é o cliente — e é conferido contra o dono** em `registrarUpload`: id que não seja de um profissional daquele cliente é **descartado** (e não recusado, para o endpoint não virar oráculo de "este id existe?"). **Nunca apague um `ServicoRequisito` com arquivos:** `requisitoId` é `SetNull` e o documento do cliente ficaria órfão e invisível na tela.

### Lead
Oportunidade no funil. `id`, `nome` (a PESSOA com quem se fala), `empresa?` (razão social / clínica — é ela que nomeia a conta na conversão), **`cnpj?`** (ADR-119: opcional no 1º contato, validado por dígito verificador quando preenchido, viaja para a ficha do cliente na conversão), `email?`, `telefone?`, `origem?`, **`rastreio? @Text`** (de onde veio — atribuição da captação OU nota de cadastro manual), `valorEstimado Decimal? @db.Decimal(12,2)` (era `Float` até a ADR-118; **DERIVADO quando o negócio é 100% percentual — ADR-125**), **`faturamentoMensalEstimado? Decimal @db.Decimal(12,2)`** (ADR-125: quanto a clínica fatura por mês, perguntado na Qualificação **em vez do** valor estimado quando todos os serviços do lead são percentuais — hoje só o Faturamento de contas médicas; o `valorEstimado` sai de `faturamento × percentual`), `observacoes?`, `ordem Int`, `pipelineStageId`, `responsavelId?`, **`convertidoEmClienteId?`** (ganho) + **`convertidoEm?`** (data do ganho → "cliente desde" na ficha), **`clienteId?`** (conta ligada p/ Portal do prospect — independe de conversão), **`perdidoEm? / motivoPerda?`** (perda; reversível — marcada pela equipe **ou** pelo próprio prospect ao desistir no Portal, `dados.origem="portal"` no log), timestamps, `deletedAt?`.
- N-N com `Servico` (LeadServicos). `passos[]` (LeadPasso). Um lead sai do board ativo quando é convertido, perdido ou removido.

### LeadPasso
Passo do checklist de um lead numa etapa (os "próximos passos" do card). `id`, `leadId`, `stageId`, `servicoId?` (null = passo geral da etapa; senão do serviço, p/ agrupar), `titulo`, `obrigatorio`, **`acaoDoc?`** (briefing|proposta|contrato → gera documento), `documentoId?`, **`autoRegra?`** (null = manual; `servicos`/`valor` = derivado reversível; `proposta_enviada`/`proposta_assinada`/`contrato_enviado`/`contrato_assinado` = evento), `ordem`, `concluido`, `concluidoEm?`, `concluidoPorId?`. Semeado do playbook da etapa + passos dos serviços.

### Nota
Polimórfica. `id`, `autorId`, `entidadeTipo`, `entidadeId`, `conteudo @Text`, timestamps. Serve Lead/Cliente/Projeto/Card (comentários de card reusam Nota — não há model Comentario).

### SuporteMensagem
Canal de suporte Portal ↔ equipe, isolado por `clienteId`. `id`, `clienteId`, `autorId`, `corpo @Text`, `daEquipe Boolean`, `lida Boolean`, `createdAt`.

> **Timeline** de Lead/Cliente = agregação de `ActivityLog` + `Nota` + eventos de negócio, ordenada por data.

---

## 4. Projetos, Kanban, Timer (Fase 2)

### Projeto
`id`, `clienteId`, **`servicoId?`** (serviço de origem — um projeto = um serviço contratado do cliente, ADR-38; nulo em projetos gerais/manuais; `onDelete: SetNull`), `nome`, `descricao?`, `status (ProjetoStatus: ATIVO|PAUSADO|CONCLUIDO)`, `responsavelId?`, `inicio?`, `previsaoFim?`, timestamps, `deletedAt?`. Relações: `servico?`, `cards[]`, `eventos[]`, `documentos[]`, `participantes[]`. **Nome padrão:** `"<Serviço> — <Cliente>"` (ou `"Projeto — <Cliente>"` quando geral).

### ProjetoParticipante
Membros do projeto (além do responsável). `id`, `projetoId`, `userId`, `@@unique([projetoId, userId])`.

### Card (Tarefa)
Colunas do kanban são o enum `CardStatus` no próprio card. `id`, `projetoId`, `titulo`, `descricao?`, `status (CardStatus: A_FAZER|EM_ANDAMENTO|AGUARDANDO_CLIENTE|AGUARDANDO_TERCEIROS|CONCLUIDO — default A_FAZER; fluxo em etapas, ADR-35)`, `prioridade (Prioridade: BAIXA|MEDIA|ALTA|URGENTE)`, `responsavelId?`, **`servicoId?`** (serviço de origem do card — ADR-36), `prazo?`, `ordem`, timestamps, `deletedAt?`. Relações: `servico?`, `checklist[]`, `timeEntries[]`. **Automação (ADR-34/35/36):** contratar/converter um serviço cria o card do serviço **com checklist = exigências obrigatórias do cliente + passos do serviço** (`garantirCardDoServicoContratado`→`criarCardDoServico`); o **status anda sozinho** (`reconciliarStatusCard`): entrega de cliente pendente → Aguardando cliente; tudo feito → Concluído; algo → Em andamento; nada → A fazer (nunca mexe em Aguardando terceiros). Concluir todos os cards auto-conclui o projeto.
- **ChecklistItem (ADR-36):** ganhou **`requisitoId?`** (relação `requisito?`) — quando preenchido, o item é uma **entrega do cliente**: marca-se sozinho quando o cliente entrega (upload/briefing) e é só-leitura para a equipe. Entregar/desfazer dispara `reconciliarCardsDoServico`.

### ChecklistItem
`id`, `cardId`, `texto`, `concluido`, `ordem`.

### TimeEntry (Timer)
`id`, `cardId?`, `userId`, `inicio`, `fim?`, `duracaoSeg?` (calculado ao finalizar), `descricao?`. Um registro por sessão start→stop.

---

## 5. Agenda & Notificações (Fase 3)

### Evento
`id`, `titulo`, `descricao?`, `tipo (EventoTipo: COMPROMISSO|RETORNO|REUNIAO|LEMBRETE|PESSOAL)`, **`escopo (EventoEscopo: PESSOAL|EMPRESA)`**, `inicio`, `fim?`, `diaInteiro`, `local?`, `linkReuniao?`, **`recorrencia (Recorrencia: NENHUMA|DIARIA|SEMANAL|MENSAL)`**, `recorrenciaAte?`, `donoId`, `clienteId?`, `projetoId?`, `lembreteEnviado Boolean`, timestamps, `deletedAt?`. Recorrência é enum + `recorrenciaAte` (expandida no servidor); não há model separado.

### Notificacao
`id`, `userId`, `tipo`, `titulo`, `corpo?`, `entidadeTipo?`, `entidadeId?`, `lida`, `createdAt`. Notificação in-app; em produção o cliente busca por polling (Socket.IO fica desligado em prod, só dev/reforço — ADR-84). Clicável (leva à entidade).

---

## 6. Financeiro (Fase 4)

### Conta (a pagar / a receber)
`id`, `tipo (ContaTipo: PAGAR|RECEBER)`, **`escopo (Escopo: EMPRESA|PESSOAL)`**, **`donoId?`** (dono da carteira PESSOAL; null em EMPRESA), `descricao`, `valor Decimal(12,2)`, `vencimento`, `pago`, `pagoEm?`, `categoriaId?`, `clienteId?`, `recorrencia (Recorrencia)`, **`recorrenciaAte?`** (limite da série), **`recorrenteId?`** (âncora = id da 1ª conta da série; agrupa as geradas), `observacoes?`, timestamps, `deletedAt?`. Índices: `[escopo,donoId]`, `[recorrenteId]`, **`@@unique([recorrenteId, vencimento])`** (ADR-93: uma série não pode ter duas parcelas no mesmo vencimento — vale inclusive para linhas soft-deletadas, por isso a geração ressuscita a apagada em vez de criar outra; conta não-recorrente tem `recorrenteId` nulo e fica fora, pois o MySQL trata NULL como distinto). **Carteiras (ADR-45):** EMPRESA = livros da Med (compartilhada ADMIN/ROOT); PESSOAL = privada por usuário (`donoId`). **Recorrência materializa** (ADR-45): marcar paga cria a próxima ocorrência (mesma série via `recorrenteId`). Contas a receber ainda são **provisionadas na conversão de um lead** (EMPRESA, a partir do `valorEstimado`).

### Categoria
`id`, `nome`, `tipo (CategoriaTipo: RECEITA|DESPESA)`, **`escopo (Escopo: EMPRESA|PESSOAL)`**, **`donoId?`**, `cor?`. Categorias EMPRESA são compartilhadas; PESSOAL são privadas por usuário (semeadas no 1º acesso). Índice `[escopo,donoId,tipo]`.

> **Fluxo de caixa** = agregação de `Conta`. **Alertas de vencimento** = scan que cria `Notificacao`.

---

## 7. E-mails transacionais

### EmailEnviado
Histórico de todo e-mail disparado (log, sem FK). `id`, `para`, `assunto`, `template?`, `corpo @Text`, `status (EmailStatus: ENVIADO|FALHOU)`, **`erro? @Text`** (motivo da falha — mensagem do SMTP ou "modo dev"; só quando FALHOU), `userId?`, `clienteId?`, `leadId?`, `createdAt`. Índice `[status, createdAt]` para o monitor. Resolve os vínculos pelo destinatário; exibido na ficha do lead/cliente, no Portal, em Configurações e no **monitor global "E-mails enviados"** (ROOT/ADMIN). (Ver também `EmailTemplate` e `PreferenciaEmail` na §2.)

---

## 7-A. E-mail dentro da aplicação (caixa IMAP por usuário — ADR-95)

> **Não confunda com a §7.** `EmailEnviado` é o e-mail que a **aplicação dispara** (transacional).
> Esta seção é a **caixa pessoal** que a pessoa pluga para ler e responder a correspondência real.

### CaixaEmail
A caixa que **um** usuário plugou na própria conta — a privacidade nasce do `userId`, e toda consulta filtra por ele. `id`, `userId`, `email`, `rotulo?`, `nomeExibicao`, `assinatura? @Text`, `imapHost`/`imapPorta` (993), `smtpHost`/`smtpPorta` (465), `usuario`, **`segredo @Text`** (a senha **cifrada** com `EMAIL_CRYPTO_KEY` — AES-256-GCM; nunca volta para a tela), `padrao`, `ativa`, `estado (CaixaEstado: OK|AUTENTICACAO_FALHOU|ERRO)`, `ultimoErro? @Text`, `ultimaSyncEm?`, `importarDesde?`, `createdAt`, `deletedAt?`. `@@unique([userId, email])` — a mesma caixa pode ser plugada por duas pessoas (o `contato@` é de todo mundo que tem a senha), cada uma com o seu registro.

### CaixaPasta
Uma pasta da caixa **com os ponteiros de sincronização do IMAP**: `caixaId`, `caminho` (separador **ponto** no Dovecot: `INBOX.spam`), `nome`, `papel? (PastaPapel)`, `uidValidity`, `ultimoUid`, `highestModseq` (todos `BigInt`), `naoLidos`, `total`, `ordem`, `sincronizando?`. `@@unique([caixaId, caminho])`. Guardar os três ponteiros é o que permite sincronizar **só o que mudou** (QRESYNC/CONDSTORE, disponíveis no servidor).

### EmailMensagem
**Índice** da mensagem — o corpo é **cache**, nulo até alguém abrir. `caixaId`, `pastaId`, `uid`, `messageId?`, `inReplyTo?`, `referencias? @Text`, `threadKey?`, `deNome?`/`deEmail`, `assunto? @Text`, `trecho? @Text`, `dataEm`, `lido`, `respondido`, `temAnexo`, `tamanho?`, `corpoHtml?`/`corpoTexto? @LongText`, `corpoEm?`, **`particular`** (um clique tira a mensagem da ficha do cliente), `createdAt`. `@@unique([pastaId, uid])` + índices `[caixaId, dataEm]` e `[threadKey]`. **Não espelhamos a caixa inteira**: busca em corpo usa o `ESEARCH` do servidor, sem baixar corpo nenhum.

### EmailEndereco
**Todos** os endereços de uma mensagem, um por linha: `mensagemId`, `papel (EnderecoPapel: DE|PARA|CC|CCO|RESPONDER_A)`, `nome?`, `endereco`. Índice em `[endereco]`.

> **Por que uma tabela só para endereço:** é ela que resolve "este e-mail é de qual cliente?" **por JOIN, na hora da consulta** — nunca gravado fixo. Cliente que troca de e-mail, ou e-mail que chega antes de o cliente existir no cadastro, passam a aparecer na ficha **sozinhos**, sem migração nem reprocessamento. Guardar um `clienteId` na mensagem congelaria a resposta no dia em que ela chegou.

### EmailAnexo
`mensagemId`, `nome`, `tipo`, `tamanho`, `parte` (a parte MIME, para buscar sob demanda), `cid?` (imagem embutida), `arquivoId?` (quando a pessoa salva o anexo nos arquivos do cliente).

---

## 8. Mensagens Internas (Fase 6)

### Conversa
`id`, `tipo (ConversaTipo: INDIVIDUAL|GRUPO|PROJETO|CLIENTE)`, `nome?`, `projetoId?`, `clienteId?`, timestamps.

### ConversaParticipante
`id`, `conversaId`, `userId`, `ultimaLeituraEm?`.

### Mensagem
`id`, `conversaId`, `autorId`, `conteudo @Text`, timestamps, `deletedAt?`. Anexos/menções ainda não existem (planejado).

---

## 9. Documentos & Assinatura (Fases 7 & 9 + assinatura)

### ModeloDocumento
`id`, `nome`, `tipo (TipoModelo: PROPOSTA|CONTRATO|BRIEFING|ESCOPO|ONBOARDING|CHECKLIST|ATA|RELATORIO|PAUTA_REUNIAO|PAUTA_POSTAGEM|RECIBO|DIAGNOSTICO|PLANO_ACAO)`, `corpo @Text` (**Markdown** com placeholders `{{...}}` — renderizado na moldura `DocumentoBranded`; propostas usam `{{apresentacao}}` e `{{servicos}}` como marcadores do construtor), **`editadoManualmente`** (a semente NUNCA sobrescreve modelo editado pela equipe), `ativo`, timestamps. 18 modelos-semente (ADR-47/50).

### Documento
`id`, `modeloId?`, `clienteId?`, `projetoId?`, `titulo`, `conteudo @Text` (Markdown), `status (StatusDocumento: RASCUNHO|EM_REVISAO|APROVADO|ENVIADO)`, `criadoPorId`, `aprovadoPorId?`, `enviadoEm?`, **`assinaturaSolicitadaEm? / assinadoEm?`**, **aceite online da proposta (ADR-47): `propostaToken? @unique`, `propostaStatus?` (PENDENTE|ACEITA|RECUSADA), `propostaHash?`, `propostaSolicitadaEm? / propostaRespondidaEm? / propostaRespIp? / propostaMotivoRecusa?`**, timestamps, `deletedAt?`. Relações: `versoes[]`, `assinaturas[]`, `credenciamentos[]`.

**`numero Int? @unique` (ADR-104).** Número sequencial da proposta, exibido com 4 dígitos (`0225`), que **continua a contagem MANUAL da Thaís** — ela estava em 224 em 10/08/2026. Só a proposta cujo modelo declara `{{numero}}` recebe um; o resto dos documentos fica nulo (o MySQL trata NULL como distinto em índice único, então convivem sem conflito). **Não há contador em tabela à parte de propósito:** o maior número já emitido *é* o estado, e um contador poderia divergir dos documentos. Duas emissões simultâneas disputam o número — o índice único derruba a segunda, que tenta o seguinte **e reescreve o número no corpo do documento** (trocar só a coluna deixaria o papel mentindo).

### Assinatura
Assinatura eletrônica avançada (Lei 14.063/2020) por signatário. `id`, `documentoId`, `papel` ("CLIENTE"|"MEDCONSULTORIA"), `nome`, `email?`, `ordem`, **`token @unique`** (link de assinatura), `status` (PENDENTE|ASSINADO), `metodo?` (DESENHO|DIGITADO), `imagem? @Text` (data-URI do traço), `nomeDigitado?`, **`hashDocumento?`** (sha256 do conteúdo no envio — prova de integridade), `ip?`, `userAgent?`, `assinadoEm?`, `criadoEm`. Trilha de auditoria completa.

### DocumentoVersao
`id`, `documentoId`, `conteudo @Text`, `autorId?`, `origem (OrigemVersao: MANUAL|IA)`, `createdAt`.

---

## 10. Enums (resumo)

`Role` · `ProjetoStatus` · `CardStatus` · `Prioridade` · `EventoTipo` · `EventoEscopo` · `Recorrencia` · `ContaTipo` · `CategoriaTipo` · `Escopo (EMPRESA|PESSOAL)` · `ConversaTipo` · `TipoModelo` · `StatusDocumento` · `OrigemVersao` · `EmailStatus`. Valores nas seções acima.

### Conversa / ConversaParticipante / Mensagem (Mensagens + Helpdesk, ADR-40/41)
`Conversa`: `id`, `tipo (ConversaTipo: INDIVIDUAL|GRUPO|PROJETO|CLIENTE)`, `nome?`, `projetoId?`, `clienteId?`, **`numero?`** (protocolo do chamado, sequencial global), **`assunto?`**, **`status (ChamadoStatus: ABERTO|EM_ANDAMENTO|RESOLVIDO)`** (RESOLVIDO = fechado/histórico, reabrível), **`prioridade (ChamadoPrioridade: BAIXA|NORMAL|ALTA)`**, **`responsavelId?`**, **`resolvidoEm?`**, **`criadoPorId?`**, timestamps, **`deletedAt?`**. Relações: `cliente?`, `responsavel?`, `criadoPor?`, `participantes[]`, `mensagens[]`. Uma conversa `CLIENTE` = **chamado/ticket de suporte** — um cliente/lead pode ter **vários** (helpdesk com histórico). Participantes = usuários do Portal do cliente + responsável + admins. **Categoria** exibida (Diretas/Grupos/Clientes/Leads) é derivada em runtime (CLIENTE com lead ativo → Leads; senão Clientes). `ConversaParticipante`: `conversaId`, `userId`, `ultimaLeituraEm?`, **`fixadoEm?`/`silenciadoEm?`/`arquivadoEm?`/`ocultoEm?`** (preferências por usuário: fixar/silenciar/arquivar/ocultar), `@@unique([conversaId,userId])`. `Mensagem`: `conversaId`, `autorId`, `conteudo`, **`editadoEm?`**, `createdAt`, `deletedAt?` (apagada = lápide). **`SuporteMensagem` é legado** (histórico migrado; mantido como backup, sem uso novo).

### Evento / EventoParticipante (Agenda, ADR-39)
`Evento`: `id`, `titulo`, `descricao?`, `tipo (EventoTipo)`, `escopo (EventoEscopo)`, `inicio`, `fim?`, `diaInteiro`, `local?`, `linkReuniao?`, `recorrencia (Recorrencia)`, `recorrenciaAte?`, `donoId`, `clienteId?`, `projetoId?`, `lembreteEnviado`, **`lembreteClienteEnviado`** (lembrete por e-mail ao cliente, só não recorrentes), **`clienteConfirmadoEm?`** (cliente confirmou presença pelo Portal), timestamps, `deletedAt?`. Relações: `dono`, `cliente?`, `projeto?`, **`participantes[]`**. Recorrência é expandida em ocorrências no servidor (`listEventos`); editar/arrastar afeta a **série** (recorrentes não são arrastáveis). **`EventoParticipante`** (join): `id`, `eventoId`, `userId`, `@@unique([eventoId,userId])` — membro da equipe convidado (além do dono); vê o evento na agenda e recebe lembrete.

---

## 11. Anexos / arquivos (planejado — ainda não implementado)

Não há model `Attachment` nem upload. Quando for implementado: metadados no banco + binário em disco fora do web root, download por endpoint autorizado (ver ARCHITECTURE §7). Vale para anexos de card/cliente/mensagem/comprovante financeiro.

---

## 12. Diagrama (resumo)

```
User ─< Session ; User ─< Token ; User ─< PreferenciaEmail ; User ─< Notificacao ; User ─< ActivityLog
Cliente ─< Contato ; Cliente ─< Projeto ; Cliente ─< Conta ; Cliente ─< Documento ; Cliente ─< SuporteMensagem
Cliente ─< usuariosPortal(User CLIENTE)
Servico ─< ServicoPasso ; Servico >─< Lead (LeadServicos)
PipelineStage ─< Lead ─< LeadPasso ; Lead >─ Cliente (convertidoEmCliente / clientePortal)
Projeto ─< Card ─< ChecklistItem ; Card ─< TimeEntry ; Projeto ─< ProjetoParticipante >─ User
Conta >─ Categoria
Conversa ─< Mensagem ; Conversa ─< ConversaParticipante >─ User
ModeloDocumento ─< Documento ─< DocumentoVersao ; Documento ─< Assinatura
ErrorLog / Incidente (observabilidade, sem FK) ; EmailEnviado (log, sem FK)
(*) Nota / ActivityLog / Notificacao são polimórficos (entidadeTipo + entidadeId)
```
