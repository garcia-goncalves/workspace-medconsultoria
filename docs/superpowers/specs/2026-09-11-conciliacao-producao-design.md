# Módulo de Conciliação — Fase 1: a produção entra no sistema

> **Data:** 11/09/2026 · **Origem:** reunião Meet `wwj-vyqc-jwq` de 11/09/2026 (Sérgio Almeida,
> Thais Tiba, Andre, Thiago; ligação ao vivo com Juliana, do cliente) — ata em
> `d:\Downloads\reuniao-medconsultoria-2026-09-11.md`. Documentos citados: relatório de produção
> de consultas (plataforma das Nuvens) e Descrição Cirúrgica (TASY), enviados no grupo DVS.
>
> **Regra que manda em tudo:** _não inventar nada_. Coluna, convênio e regra que aparecem aqui
> saem da ata ou do arquivo real. Onde eu decidi por conta própria está marcado **[decisão minha]**
> e pode ser vetado.
>
> **Status:** proposta. Não escrevi código de produção ainda.

---

## 1. Por que este trabalho existe

Hoje o faturamento do cliente é feito **na mão**: a Lúcia processa, a Joyce trabalha de casa, e
quando alguém sai de férias o processo para. Ninguém consegue responder a pergunta que o Sérgio
fez na reunião com todas as letras:

> _"deveria ter recebido 18 mil, recebeu 800"_ — e, depois, _"em média o senhor vai receber X
> daqui a dois meses"_.

Responder isso exige três coisas, nesta ordem: (1) saber **o que foi produzido**, (2) saber
**quanto isso vale**, (3) saber **o que entrou**. Este documento cobre só a **(1)**, porque as
outras duas estão bloqueadas por terceiros — ver §2.

A pergunta-guia do produto continua valendo: _como fazer a Thaís trabalhar com muito menos
estresse?_ Aqui a resposta é: parar de reler planilha.

---

## 2. O que está bloqueado, e por quem (isto define o recorte)

A ata é explícita sobre o que ainda não existe. Registro aqui para que ninguém planeje em cima
de coisa que não chegou:

> **Corrigido em 11/09/2026, depois de ver as amostras.** A primeira versão desta seção dizia que
> o "recebido" não tinha fonte de dados nenhuma. **Estava errado para cirurgia:** dois dos cinco
> prints são o relatório de repasse (§4b). A ata já dizia isso e eu li errado — Bloco 5:
> _"ainda não existe modelo de relatório de pagamento para **consulta** da BP; de **cirurgia** já
> existe (os dois modelinhos enviados)"_. Estes são os dois modelinhos.

| Peça                                                | Estado em 11/09/2026                                                            | Quem destrava               |
| --------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| Relatório de produção de **consultas**              | **Print recebido** (colunas e valores reais — §4)                               | —                           |
| Descrição Cirúrgica (2 páginas)                     | **Print recebido** (completo — §9)                                              | —                           |
| Relatório de **repasse de CIRURGIA** (o "recebido") | **Print recebido** (§4b)                                                        | —                           |
| **Os arquivos de verdade** (.xlsx / .pdf)           | Só tenho print — **trava o parser**                                             | Andre / Thaís               |
| Relatório de consultas **do TASY**                  | Caminho no sistema desconhecido                                                 | Juliana / Guilherme         |
| **Tabela de valores negociados**                    | Só a tabela, sem contrato; faltam códigos (ressecção de tumor cardíaco, eletro) | Juliana / Thaís / operadora |
| Relatório de **pagamento de CONSULTA da BP**        | **Não existe modelo** (Bloco 5 da ata)                                          | BP                          |
| 5 "modelinhos" de cirurgia                          | Pendente — trava o cálculo de pacote                                            | Juliana / Thaís             |

**Consequência direta, revista:** a conciliação **de cirurgia** tem as duas pontas do "recebido"
disponíveis em modelo; falta o "esperado" (a tabela de valores). A conciliação **de consulta** só
tem a produção — o pagamento não tem nem modelo. Em nenhum dos dois casos eu tenho o **arquivo**,
só o print: dá para desenhar o banco com segurança, não dá para escrever o parser.

O que segue desbloqueado é o que o Sérgio pediu no Bloco 7: _"todo mês vai vir isso"_ — a produção
entrando no sistema.

---

## 3. Recorte da Fase 1

**Entra:**

- Importar o **relatório de produção de consultas**, por cliente e por competência (mês).
- Guardar o arquivo original e **todas** as colunas — inclusive as que não serão exibidas.
- Tela de produção: lista com filtros (competência, convênio, profissional, tipo), contadores.
- Agrupar por **operadora**, não pelo texto cru do convênio (§6.4) — é o que dá a leitura
  "quanto de Porto Seguro, quanto de Cassi".

**Não entra (e por quê):**

- Produção de **cirurgias** — o documento é PDF de 2 páginas com narrativa livre; parsear isso
  é outro trabalho, com outro modelo de dados (§9 guarda a estrutura para não se perder).
- **Valor esperado** — depende da tabela, que está incompleta.
- **Conciliação esperado × recebido** — não há relatório de pagamento de consulta.
- **Previsibilidade / média por operadora** — depende do recebido.
- Portal do cliente — a produção é ferramenta da equipe nesta fase.

---

## 4. O arquivo real

Colunas do relatório de produção de consultas, conforme a ata:

| Coluna               | Vai para o banco?                     | Aparece na tela? |
| -------------------- | ------------------------------------- | ---------------- |
| Data da agenda       | sim                                   | sim              |
| Data do atendimento  | sim                                   | sim              |
| Paciente             | sim                                   | **sim**          |
| CPF do paciente      | sim, **cifrado**                      | **não**          |
| Telefone do Paciente | sim, **cifrado**                      | **não**          |
| E-mail               | sim, **cifrado**                      | **não**          |
| Tipo de atendimento  | sim                                   | sim              |
| Plano de convênio    | sim (texto cru + operadora resolvida) | sim              |
| Profissional         | sim                                   | sim              |

Valores **lidos do print de 11/09/2026** (competência 08/2026) — é isto que o parser precisa
aguentar sem reclamar. **Onde o print discorda da ata, o print manda:**

- **Tipo de atendimento:** `Consulta`, `Cortesia`, `Sem vínculo com a agenda`.
- **Plano de convênio** — o texto real, com a caixa que ele tem:
  `PORTO SEGURO - BÁSICO`, `PORTO SEGURO - ESPECIAL I`, `Cassi - Associados`, **`Cassi`**,
  `CENTRAL NACIONAL UNIMED - INTERCÂMBIO`, `Sul America - Semar`, `Bradesco Saúde - Empresa`,
  `CET - Única`, `Plan Assiste - MPF`, `CABESP`,
  `PARTICULAR DR. LÉO - MAESTRO CARDIM`, `PARTICULAR DR. MOHAMAD - MAESTRO CARDIM`.
- **Profissional** (tudo em caixa alta): `DR. LEONARDO GIGLIO DRAGONE`,
  `DRA. LAYS JOSE MORESCHI`, `DR. MOHAMAD SAID GHANDOUR`.

### 4.1 O que o print corrigiu na ata

| A ata dizia                             | O arquivo diz                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `Sul América - Seguros`                 | **`Sul America - Semar`** (sem acento, e "Semar", não "Seguros")                      |
| `Plan Assiste MPF`                      | **`Plan Assiste - MPF`** (com hífen)                                                  |
| `Unimed Central Nacional - Intercâmbio` | **`CENTRAL NACIONAL UNIMED - INTERCÂMBIO`** (outra ordem)                             |
| `Particular`                            | **`PARTICULAR DR. LÉO - MAESTRO CARDIM`** e `PARTICULAR DR. MOHAMAD - MAESTRO CARDIM` |

O último é o que mais muda o desenho: **particular não é um valor, é um par médico × local**.
Um de-para que trate "Particular" como uma operadora só junta o consultório de dois médicos
diferentes na mesma linha do relatório.

### 4.2 Sujeira real do arquivo — cada item aqui é um defeito se ignorado

1. **Data no formato `dd/mm/aaaa`** (`31/08/2026`).
2. **`Data da agenda` vem VAZIA** — e não é aleatório: vem vazia exatamente quando o tipo é
   `Sem vínculo com a agenda`. Faz sentido (não houve agendamento). `dataAgenda` nullable estava
   certo, e agora tem prova.
3. **As duas datas divergem de verdade:** `LUCAS BEVILACQUA` tem agenda em 25/08 e atendimento em
   28/08. Guardar só uma perde informação.
4. **Telefone traz VÁRIOS números na mesma célula**, separados por vírgula — vi até três:
   `(00) 98269-5583, (00) 2204-9854, (00) 98434-3383`. Um campo "telefone" que assuma um número só
   trunca dado.
5. **DDD `(00)`** aparece. É lixo do cadastro, não telefone. Não normalizar, não "consertar" — só
   guardar como veio (está cifrado de qualquer forma).
6. **E-mail vazio é comum** — várias linhas sem nada.
7. **Caixa inconsistente na MESMA coluna:** `PORTO SEGURO - BÁSICO` (tudo maiúsculo) ao lado de
   `Cassi - Associados` (capitalizado). O de-para tem de casar sem caixa e sem acento, ou
   `Cassi` e `CASSI` viram duas operadoras.
8. **A mesma pessoa aparece duas vezes no mesmo dia, com tipos diferentes:**
   `LILIAN FERRAZ FORNAZARI` (CPF 044.430.998-59) tem, em 28/08, uma linha `Sem vínculo com a
agenda` e outra `Consulta`. Ver §6.3 — é a prova de que deduplicar linha a linha apagaria
   atendimento real.

> ⚠️ **Pendência que ainda trava o parser:** o que chegou foi **print**, não arquivo. O print
> resolve o modelo de dados (colunas, valores, sujeira) e **não** resolve o parser: falta saber
> nome da aba, em que linha começa o cabeçalho, se a data é data ou texto, e o encoding. Ver §8.

---

## 4b. O relatório de repasse — o "recebido" (fora da Fase 1, registrado agora)

**Não implementar nesta fase.** Está aqui porque a amostra chegou e porque ela **muda decisões da
Fase 1** — principalmente qual é a chave de casamento (§4b.2).

Documento: **"BP - Repasses para Terceiros (Pagamentos Realizados)"**, saída de relatório do TASY
(PDF impresso, não planilha).

- **Cabeçalho:** `Referência: De 31/08/26 até 31/08/26` (é o **período de pagamento**, não de
  atendimento) · `Prestador: Dr. Sergio Almeida de Oliveira Cirurgia` — o prestador é a **PJ do
  médico**, o que casa com a discussão da ata sobre acesso e credenciamento pela PJ.
- **Agrupado por `Repasse: <nº>`**, e cada grupo traz **`Valor Líquido`** e **`Imposto Retido`**
  (ex.: repasse 179978 → líquido 159.666,00, imposto retido 10.462,93).
- **Colunas:** Convênio · Atend · Medico Executor · Paciente · Dt Item · Código · Descrição ·
  Data Pagamento · Vl Repasse.

### 4b.1 Três armadilhas que este documento já mostra

1. **Nem toda linha é procedimento.** Há linhas de acordo/incremento com `Atend = 0`,
   `Código = 0`, **sem paciente e sem convênio** — por exemplo
   _"Sergio Almeida de Oliveira - Mês de Competencia JULHO/26 · Realizada 5 - Gatilho 4 · Valor do
   Incremento 1.000,00"_ e _"MC - JUNHO/26" = R$ 12.106,64_. Um importador que assuma "toda linha
   tem paciente e código" **descarta doze mil reais numa linha só**, em silêncio.
2. **Imposto retido é por repasse, não por linha.** Conciliar a produção contra o **bruto** e
   comparar com o que caiu na conta produz uma diferença falsa **todo mês**. Líquido = bruto −
   imposto retido, e o imposto só existe no cabeçalho do grupo.
3. **O nome do convênio é DIFERENTE do que a produção usa.** Aqui aparece `SUS - BP Paulista` e
   `Unimed Seguros Saúde`; na produção de consultas, `CENTRAL NACIONAL UNIMED - INTERCÂMBIO`.
   O de-para (§6.4) tem de atender **os dois lados**, senão a conciliação não cruza nada.

### 4b.2 A chave de casamento é `Atend`, não o CPF

No print da Unimed, **todas** as linhas têm `Atend = 19100842`: é **uma** cirurgia, decomposta em
vários procedimentos × vários executantes (Israel Ferreira da Silva, Gustavo Ieno Judas, Joao
Antonio Caparroz Vieira, Rafael Albino Lencioni, Caio Leite Ladessa), cada um com o seu valor.

Isso significa que o número do atendimento — e não o paciente — é o que amarra produção,
descrição cirúrgica e repasse. O `apelidoCpf` que já construí continua útil (o repasse traz
paciente, a produção traz CPF), mas **`Atend` é a chave forte**. Quando a Fase 2 chegar, o
modelo de produção cirúrgica precisa guardá-lo.

### 4b.3 A defasagem — é ela que dá a previsibilidade

`Dt Item 15/05/2026` → `Data Pagamento 31/08/2026`: **~3,5 meses**. É exatamente a matéria-prima
da frase do Sérgio — _"em média o senhor vai receber X daqui a dois meses"_. Medir essa defasagem
por operadora é o produto, não um extra.

### 4b.4 Os códigos são de tabelas DIFERENTES — não dá para juntar por código

| Onde                | Exemplos                                    | Tabela                |
| ------------------- | ------------------------------------------- | --------------------- |
| Descrição cirúrgica | `30917042`, `30905036`, `30906164`          | TUSS (8 dígitos)      |
| Repasse Unimed      | `40020045`, `40040100`, `39030016`, `20010` | TUSS / tabela própria |
| Repasse SUS - BP    | `406010935`, `412030128`                    | SIGTAP (9-10 dígitos) |

A **mesma** revascularização é `40020045` na Unimed e `406010935` no SUS. Casar procedimento por
código, sem tabela de correspondência, não funciona. Mais uma razão para `Atend` ser a chave.

⚠️ E há divergência **dentro do próprio documento cirúrgico**: a tabela estruturada de
Procedimentos lista `30913098` (Cateter atrial/peritoneal), enquanto o bloco "TUSS:" da narrativa
da página 2 escreve `CVC 30913012` e cita `SVD 20105037`, que não está na tabela. A Fase 2 tem de
tratar a tabela como fonte e a narrativa como conferência — nunca o contrário.

---

## 5. A regra do dado pessoal — a parte que não pode sair errada

A ata registra as duas posições e o acordo:

- **Sérgio:** não quer e-mail, telefone, CEP nem dado pessoal de paciente dentro do sistema.
- **Andre:** importar o arquivo como vem (descartar dá mais trabalho), **salvar tudo e exibir só
  o necessário**. **Acordado.**
- **Bloco 7:** _"tirar as colunas CPF, telefone e e-mail; o restante é necessário"_.

Isso resolve o que exibir. Não resolve **como fica no banco** — e essa decisão foi tomada em
11/09/2026 pelo dono:

> **CPF, telefone e e-mail do paciente ficam CIFRADOS em repouso e não existem no retorno do
> tRPC.** Nem como campo opcional, nem atrás de flag.

Como isso é feito:

- **Cifra:** AES-256-GCM, mesmo esquema já em produção em `apps/api/src/lib/cripto-caixa.ts`
  (formato `v1:<iv>:<tag>:<cifrado>`, tudo base64; o GCM detecta adulteração). **[decisão minha]**
  O primitivo sai para `apps/api/src/lib/cripto.ts` e o `cripto-caixa.ts` vira invólucro de 5
  linhas — duplicar implementação de cripto é pior que mexer no que funciona. A senha da caixa de
  e-mail **não muda de chave nem de formato**; só de arquivo.
- **Chave:** nova env `PACIENTE_CRYPTO_KEY` (32 bytes em base64), separada da `EMAIL_CRYPTO_KEY`
  de propósito — rotacionar uma não deve tornar ilegível a outra. **Ausente → o módulo de
  Conciliação fica desligado**, e o resto da app segue normal (mesma degradação graciosa do SMTP
  e do e-mail na app).
- **CPF precisa casar, e GCM não casa:** o IV é aleatório, então o mesmo CPF cifra diferente toda
  vez — busca e deduplicação por igualdade ficam impossíveis. Por isso vai junto um
  `pacienteCpfHash` = **HMAC-SHA256** do CPF só com os dígitos, com subchave derivada da
  `PACIENTE_CRYPTO_KEY` via HKDF. É determinístico (casa), é indexável, e **não é reversível**
  como um `SHA256(cpf)` puro seria (o espaço de CPF é pequeno demais — 11 dígitos com dígito
  verificador se quebra por força bruta em minutos; com HMAC e chave secreta, não).
- **O arquivo original** vai para o `Arquivo`/`UPLOADS_DIR` que já existe, com a checagem de posse
  que já existe. Ele **contém** os dados em claro — é o arquivo do cliente, tal como veio. Fica
  atrás da mesma autenticação do resto dos documentos de cliente.
- **Nome do paciente fica em claro**, porque o Bloco 7 diz que ele é necessário na tela e um
  nome cifrado não se ordena nem se busca. É PII: entra na mesma tela protegida, não vaza em log.

**Trava de teste:** um teste garante que o retorno do router de conciliação **não tem** nenhuma
chave `cpf`/`telefone`/`email` do paciente. Regressão aqui é vazamento, não bug de tela.

---

## 6. Modelo de dados

Convenções da casa (`docs/DATABASE.md`): PK `cuid`, `createdAt`/`updatedAt`, soft delete onde faz
sentido, dinheiro em `Decimal(12,2)` e **`Decimal` nunca atravessa o tRPC** (ADR-118 — converter
com `emReais()`). Nesta fase não há dinheiro ainda.

### 6.1 `ProducaoLote` — uma importação

| Campo                                                  | Tipo                                      | Nota                                                                                                                                                      |
| ------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                   | cuid                                      |                                                                                                                                                           |
| `clienteId`                                            | FK `Cliente`                              | de quem é a produção                                                                                                                                      |
| `competencia`                                          | `Char(7)`                                 | `AAAA-MM`. String, não `DateTime` — competência é um mês, não um instante, e `DateTime` convida bug de fuso (a app já tem `lib/datas.ts` por causa disso) |
| `origem`                                               | enum `CONSULTAS_NUVENS`                   | um valor só nesta fase; `CIRURGIAS_TASY` entra na Fase 2                                                                                                  |
| `arquivoId`                                            | FK `Arquivo`, SetNull                     | o original guardado                                                                                                                                       |
| `nomeArquivo`                                          | String                                    | como veio                                                                                                                                                 |
| `formato`                                              | String                                    | como o arquivo foi lido de verdade (`csv`/`xlsx`/`html`), detectado pelo conteúdo — vale para o suporte                                                   |
| `hashArquivo`                                          | `Char(64)`                                | SHA-256 do conteúdo — reimportar o mesmo arquivo é reconhecido                                                                                            |
| `competenciaVigente`                                   | `Char(7)?`                                | a competência, mas só enquanto este lote for o vigente; nulo quando substituído                                                                           |
| `substituidoPorId` / `substituidoEm`                   | FK própria / DateTime?                    | qual lote tomou o lugar deste, e quando                                                                                                                   |
| `status`                                               | enum `PROCESSANDO \| IMPORTADO \| FALHOU` |                                                                                                                                                           |
| `erro`                                                 | Text?                                     | por que falhou, em português                                                                                                                              |
| `linhasLidas` / `linhasImportadas` / `linhasIgnoradas` | Int                                       | o relatório da importação                                                                                                                                 |
| `importadoPorId`                                       | FK `User`, SetNull                        | quem importou                                                                                                                                             |

**A trava mora no banco:** `@@unique([clienteId, origem, competenciaVigente])`. Como no MySQL
nulos **não colidem** em índice único, isso significa exatamente "um lote vigente por
cliente/origem/mês" e ainda deixa quantos substituídos existirem conviverem no histórico. Um
`@@unique` sobre `competencia` cru impediria guardar o lote antigo; conferir só na aplicação
deixaria a porta aberta para duas importações simultâneas duplicarem o mês. Mesma escolha da
trava de recorrência do Financeiro (ADR-93). Índices: `[clienteId, competencia]`,
`[clienteId, origem, hashArquivo]` (a checagem de "este arquivo já entrou") e as FKs.

**APLICADO em 11/09/2026** — migração `20260911182904_conciliacao_producao`, gerada por
`migrate diff` e aplicada com `migrate deploy`. O `migrate dev` não roda aqui: o usuário do MySQL
local não tem permissão de criar o banco de sombra, e ele ainda reexecutaria o seed (armadilha
registrada no `CLAUDE.md`). O SQL é só `CREATE TABLE` + FK — não toca em tabela existente.

### 6.2 `ProducaoConsulta` — uma linha do relatório

| Campo                     | Tipo                                                       | Nota                                                          |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| `loteId`                  | FK `ProducaoLote`, Cascade                                 | apagar o lote apaga as linhas                                 |
| `clienteId`               | FK `Cliente`                                               | desnormalizado de propósito: toda consulta filtra por cliente |
| `competencia`             | `Char(7)`                                                  | idem — evita join só para filtrar o mês                       |
| `linha`                   | Int                                                        | número da linha no arquivo, para explicar erro                |
| `dataAgenda`              | DateTime?                                                  |                                                               |
| `dataAtendimento`         | DateTime                                                   |                                                               |
| `pacienteNome`            | String                                                     | em claro (§5)                                                 |
| `pacienteCpfCifrado`      | Text?                                                      | §5                                                            |
| `pacienteCpfHash`         | `Char(64)`?                                                | HMAC, indexado                                                |
| `pacienteTelefoneCifrado` | Text?                                                      | §5                                                            |
| `pacienteEmailCifrado`    | Text?                                                      | §5                                                            |
| `tipoAtendimento`         | enum `CONSULTA \| CORTESIA \| SEM_VINCULO_AGENDA \| OUTRO` |                                                               |
| `tipoAtendimentoBruto`    | String                                                     | o texto original — `OUTRO` sem o original é dado perdido      |
| `convenioBruto`           | String                                                     | `"Porto Seguro - Básico"`, como veio                          |
| `operadoraId`             | FK `Operadora`, SetNull                                    | resolvido pelo de-para; **nulo é estado válido**              |
| `plano`                   | String?                                                    | `"Básico"`, extraído pelo de-para                             |
| `profissionalBruto`       | String                                                     | `"Dr. Leonardo Giglio Dragone"`                               |
| `profissionalId`          | FK `Profissional`, SetNull                                 | idem                                                          |

`@@index([clienteId, competencia])` · `@@index([operadoraId])` · `@@index([pacienteCpfHash])`

### 6.3 Reimportação — o que acontece quando o mês vem de novo

O caso real é comum: a Thaís reextrai o mês porque faltou um dia. **[decisão minha]**

- Mesmo `hashArquivo` já importado → a tela diz _"este arquivo já foi importado em DD/MM"_ e
  não faz nada. Sem duplicata silenciosa.
- Arquivo diferente para a mesma `(cliente, competência, origem)` → a tela **pergunta**:
  _substituir a importação de DD/MM?_ Substituir apaga as linhas do lote anterior e insere as
  novas, numa transação. O lote antigo fica com `status` marcando a substituição.
- **Não faço deduplicação linha a linha.** Isto deixou de ser precaução e virou fato observado:
  no print de 08/2026, `LILIAN FERRAZ FORNAZARI` (CPF 044.430.998-59) tem **duas linhas em
  28/08** — uma `Sem vínculo com a agenda` e outra `Consulta`. Uma chave
  `(cpf, data, profissional)` apagaria uma das duas, e é atendimento real. Substituição por mês é
  como o relatório de fato funciona.

### 6.4 `MapeamentoConvenio` — o de-para

O relatório escreve `PORTO SEGURO - BÁSICO` e `PORTO SEGURO - ESPECIAL I`. Para o Sérgio isso é
**uma** operadora com dois planos. Sem este de-para, a leitura "quanto de Porto Seguro" não
existe — e ela é o objetivo declarado (_"montar banco de dados por operadora"_).

O print elevou a importância desta tabela. Ela agora resolve **quatro** problemas reais, não um:

1. **Plano dentro do texto:** `PORTO SEGURO - BÁSICO` × `PORTO SEGURO - ESPECIAL I`.
2. **Caixa e acento inconsistentes na mesma coluna:** `Cassi - Associados` e `Cassi` convivem;
   `PORTO SEGURO` é caixa alta e `Bradesco Saúde` não é. **A chave de casamento é o texto
   normalizado** (minúsculas, sem acento, espaços colapsados), não o texto cru — senão o mesmo
   convênio vira duas operadoras.
3. **Particular é par médico × local:** `PARTICULAR DR. LÉO - MAESTRO CARDIM` e
   `PARTICULAR DR. MOHAMAD - MAESTRO CARDIM` são consultórios diferentes, não "a operadora
   Particular".
4. **Os dois lados falam nomes diferentes** (§4b.1): a produção diz
   `CENTRAL NACIONAL UNIMED - INTERCÂMBIO`, o repasse diz `Unimed Seguros Saúde`. A mesma tabela
   tem de aceitar textos dos dois documentos apontando para a **mesma** `Operadora`.

| Campo              | Tipo                      | Nota                                                                                                                                        |
| ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `clienteId`        | FK `Cliente`              |                                                                                                                                             |
| `textoBruto`       | String                    | como veio, para a tela mostrar o que o arquivo disse                                                                                        |
| `textoNormalizado` | String                    | minúsculas/sem acento — `@@unique([clienteId, textoNormalizado])`                                                                           |
| `operadoraId`      | FK `Operadora?`, Restrict | nulo **só** quando `particular` — o consultório do médico não é operadora e não entra no catálogo, que é compartilhado com o credenciamento |
| `plano`            | String?                   | `Básico`, `Especial I`, `Associados`                                                                                                        |
| `particular`       | Boolean                   | tira das somas de convênio sem sumir da produção (§8)                                                                                       |

Comportamento: a importação **não bloqueia** por convênio desconhecido — importa com
`operadoraId` nulo e a tela mostra um aviso acionável _"2 convênios novos apareceram: ligue-os a
uma operadora"_. Ligar depois **retroage** nas linhas já importadas daquele texto.
`Operadora` já existe no catálogo (usada pelo credenciamento) e é reaproveitada, não duplicada.

O mesmo vale para profissional (`MapeamentoProfissional`, ligando `"Dr. Leonardo Giglio Dragone"`
ao `Profissional` do cliente) — **[decisão minha]** com uma tentativa de casamento automático por
nome normalizado (sem acento, sem `Dr.`/`Dra.`) na primeira importação, sempre revisável.

---

## 7. Telas

**Nova página `/conciliacao`** no grupo **Negócio** do menu, `minRole: FUNCIONARIO`.

> ⚠️ **Restrição real:** "Negócio" já tem 5 itens e o ADR-94 pede no máximo 4; o que é **lei
> testada** é o menu não rolar (`e2e/menu-sem-scroll.spec.ts`). Um 6º item pode reprovar esse
> teste. **Isso será verificado rodando o teste, não presumido.** Se reprovar, o item vai para
> fora do menu (acessível por Ctrl+K e pela ficha do cliente) e a decisão vira ADR.

Conteúdo:

1. **Importar** — escolher cliente + competência, soltar o arquivo, **pré-visualizar** (as
   primeiras linhas já mapeadas, com os erros apontados por número de linha) e só então
   confirmar. Ninguém importa às cegas.
2. **Produção do mês** — tabela com Data do atendimento · Paciente · Tipo · Convênio (operadora +
   plano) · Profissional. Filtros por competência, operadora, profissional e tipo. **Sem CPF,
   telefone e e-mail** — as colunas não existem no retorno da API.
3. **Resumo** — atendimentos por operadora e por profissional; separa `Cortesia` e `Particular`,
   que não geram recebimento e não podem poluir a contagem.
4. **Pendências** — convênios e profissionais sem de-para, com o botão de ligar ali.

Na **ficha do cliente**, um card "Produção" com o último mês importado e link para a página.

---

## 8. O que ainda não decidi, e por quê

- ~~**Biblioteca de parser.**~~ **RESOLVIDO em 11/09/2026 — e sem dependência nenhuma.** O
  importador aceita **CSV, XLSX e tabela HTML**, detectando pelo **conteúdo** e não pela extensão
  (`modules/conciliacao/planilha/`). O caminho óbvio era o `exceljs`, e ele **não pode ser
  publicado aqui**: é biblioteca de ler _e escrever_, e a metade que escreve (`archiver`) arrasta
  um `minimatch` com falha ALTA. Fechar isso exigiria override escopado por major
  (`brace-expansion@1` + `@2`), e o tradutor do artefato **recusa** — o npm não sabe escopar
  override por major do próprio pacote (ADR-116/117). Com override, `pnpm build:deploy` quebra;
  sem override, o portão de auditoria reprova. Como nós só **lemos**, o `.xlsx` virou leitor
  próprio: `zip.ts` (diretório central + `inflateRaw`, que já vem no Node) + `xlsx.ts` (OOXML).
  Saldo: **zero dependência nova, zero aviso de segurança novo, `build:deploy` verde.**
  O **`.xls` binário antigo (BIFF/OLE2)** é **detectado e recusado** com a saída pronta ("salve
  como .xlsx ou CSV") — lê-lo exigiria a SheetJS, cuja versão no npm está parada em duas falhas
  conhecidas.
- **O que só o arquivo responde** (o print não): nome da aba, em que linha começa o cabeçalho
  (há relatórios com título e filtro acima), se a data é data de verdade ou texto, e o encoding.
- **O relatório de repasse é PDF impresso**, com agrupamento e cabeçalho de grupo — não é
  planilha. Extrair aquilo é trabalho de outra natureza (Fase 2), e talvez a saída seja pedir a
  versão em planilha ao suporte do TASY antes de escrever extrator de PDF.
- ~~**Se `Particular` é operadora.**~~ **Resolvido pelo print:** não é um valor, é par médico ×
  local (§4.1). Vira `MapeamentoConvenio.particular = true`, sai dos totais de convênio e continua
  contando como atendimento. Segue valendo a pergunta ao Sérgio sobre **contar ou não** (§11.1).

---

## 9. Descrição Cirúrgica — estrutura registrada para a Fase 2

Fora do escopo agora. **Conferido contra o documento real** (print de 11/09/2026 — paciente
Dilton Caldas Ferreira, cirurgia 374.557, atendimento 19.178.391, Centro Cirúrgico BP Paulista,
convênio Sul América, cirurgião Gustavo Ieno Judas, CRM105256). A estrutura da ata bate. O que o
documento acrescenta:

- **`Atendimento` (19.178.391) está no cabeçalho** — é a chave que amarra com o repasse (§4b.2).
  Também há `Cirurgia` (374.557), `Prescrição` (85.816.052), `Prontuário` (6226677) e `Setor`.
- **Duração em minutos** (394) e **Dt. Início / Dt. Término** com hora (27/04/2026 07:00 → 15:04).
- **Participantes têm função e procedimento vinculado** — 9 pessoas neste caso, do Anestesista ao
  4º Auxiliar. É por pessoa que o repasse paga (§4b.2), então esta tabela é o elo.
- Rodapé com `Impresso em`, página, `CRM` e um identificador (`CATE448`).

Estrutura registrada:

- **Cabeçalho:** Paciente · Prontuário · Dt. Nasc. · Idade · Sexo · Caráter (Eletiva) · Condição ·
  Cirurgia (código) · Plano de convênio · Atendimento · Dt. início · Dt. Término · Nr. série ·
  Duração · Cirurgião · Observação.
- **Procedimentos** (tabela Código | Procedimento | Via de acesso) — ex.: `30917042` Retirada de
  tumores intracardíacos (Principal), `30904080` Implante de marca-passo temporário transvenoso,
  `30905036` Circuito de circulação extracorpórea, `30905060` Perfusionista, `30906164`
  Cateterismo da artéria radial, `30913098` Cateter atrial/peritoneal. **São códigos TUSS** — a
  Fase 2 precisa de uma tabela de procedimentos, não de texto livre.
- **Participantes** (Função | Participante | Observação | Procedimento): Anestesista, Circulante,
  Cirurgião Principal, Instrumentador, 1º a 4º Auxiliar.
- **Anestesia** (Técnica | Profissional).
- **Descrição:** Diagnóstico Pré/Pós-Operatório, Resumo (com CEC e PINÇA em minutos), Exame
  Radiológico, Anatomopatológico, Intercorrência, Achados operatórios; página 2 é **narrativa
  livre + assinatura**.
- **Regra de negócio da ata que a Fase 2 tem de honrar:** a descrição cirúrgica é o documento que
  **comprova o realizado**, e o auditor da operadora a confronta com o **autorizado**. Divergência
  autorizado × realizado é o achado que gera recurso (diferença) ou complemento (código não
  lançado). Ou seja: a Fase 2 não é "importar cirurgia", é **cruzar autorizado com realizado**.

---

## 10. Como isto será provado (nada de "typecheck verde" como evidência)

A casa já se queimou duas vezes com tipagem verde que não provava nada (ADR-118, ADR-119).

| O que                       | Como se prova                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Parser                      | Teste unitário contra **fixture sintética** (CPF/telefone/e-mail inventados) em `apps/api/src/test/fixtures/` — nunca o arquivo real |
| Cifra e HMAC                | Teste de ida e volta + o mesmo CPF gerando o mesmo hash e cifrado diferente                                                          |
| **Nenhum PII no tRPC**      | Teste que varre o retorno do router atrás de `cpf`/`telefone`/`email` — o teste que mais importa                                     |
| Idempotência e substituição | Teste de integração contra **MySQL de verdade** (`*.integration.test.ts`), como manda a ADR-124                                      |
| Menu não rolar              | `e2e/menu-sem-scroll.spec.ts` executado, não presumido (§7)                                                                          |
| A tela                      | Percorrida no navegador: importar → ver → filtrar → ligar convênio → retroagir                                                       |

Fora disso: `pnpm typecheck` nos 5 pacotes, `pnpm lint`, e PR (a `main` não aceita push direto).

---

## 11. Perguntas para o Sérgio antes de eu implementar

1. **`Particular` e `Cortesia`** entram na produção como atendimento contado, ou só aparecem
   separados? (§8)
2. O módulo é **por cliente** (cada médico/clínica com a sua produção) — confirma? A ata fala em
   _"vender para outros clientes"_ depois, mas o `CLAUDE.md` diz que a app **não é multi-tenant**.
   Nesta fase trato como mais um cliente dentro da Med, que é o que "uma coisa de cada vez" quer
   dizer. Se a intenção for vender a plataforma, isso é outra conversa de arquitetura — e cara.
3. **Quem pode ver a produção?** Propus `FUNCIONARIO`+ (a Thaís precisa). Financeiro hoje é
   `ADMIN`. Como tem nome de paciente, cabe restringir a `ADMIN`.
4. Competência é o **mês do atendimento** ou o mês em que o relatório foi extraído? Muda o que
   acontece com um atendimento de 30/09 que aparece no relatório de outubro.
