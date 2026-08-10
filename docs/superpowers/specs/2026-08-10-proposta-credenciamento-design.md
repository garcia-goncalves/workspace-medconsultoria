# Proposta de Credenciamento inteligente — especificação

> **Data:** 10/08/2026 · **Origem:** os dois PDFs reais da Thaís em `brand/identidade/`
> (`Proposta Credenciamento Omint - Care Plus - Amil One.pdf` e
> `Lista de documentos credenciamento médico.pdf`) + regras de negócio ditadas pelo dono
> em 10/08/2026.
>
> **Regra que manda em tudo:** *não inventar nada* — principalmente documentos. Toda
> exigência desta spec sai do PDF da Thaís. Onde eu decidi algo por conta própria, está
> marcado como **[decisão minha]** e pode ser vetado.

---

## 1. Por que este trabalho existe

Hoje a aplicação tem um modelo chamado "Proposta de credenciamento" que **não é o
documento da Thaís**. É um texto de marketing escrito por cima, que:

- omite as cláusulas que protegem a Med (honorário só no sucesso, uma tentativa, confidencialidade);
- inventa uma lista de documentos que **não bate** com a lista real;
- não sabe o nome nem a especialidade dos médicos que estão sendo credenciados.

E a lista de exigências que o Portal apresenta ao cliente **pede um documento que a Thaís
não pede** (RG e CPF) e **deixa de pedir nove que ela pede**. O médico entrega tudo o que o
Portal manda e ainda falta metade — a Thaís descobre depois, por e-mail, uma pendência de
cada vez.

Pergunta-guia do produto: *como fazer a Thaís trabalhar com muito menos estresse?* A maior
resposta aqui não é a proposta mais bonita — é a **triagem** (§3), que evita começar um
trabalho impossível.

---

## 2. Comparação: o documento real × o que existe no sistema

| A proposta da Thaís (nº 0034, 12/02/2025) | O modelo no sistema em 10/08/2026 |
| --- | --- |
| Numeração sequencial ("Proposta 0034") | não existe |
| 5 seções numeradas | texto corrido |
| Nomeia cada médico com a especialidade | fala só com `{{cliente.nome}}` |
| Plano de trabalho em 6 passos | 4 passos, outra redação |
| "Repasse só no sucesso, após assinatura com a operadora. Sem adiantamento." | ausente |
| "Após 1 tentativa e negativa, encerramos" | ausente |
| Cláusula de confidencialidade | ausente |
| Assinatura das duas partes | ausente |
| Explicação de "o que é credenciamento" | **presente — e não existe no original** |
| Lista genérica de documentos | **presente — e contradiz a lista real** |

---

## 3. Regras de negócio (ditadas pelo dono em 10/08/2026)

### 3.1 Elegibilidade — a triagem

**Credenciamento só existe para pessoa jurídica.** O cadastro na aplicação pode ser CPF
(médico independente), mas **credenciar exige CNPJ**.

Um profissional/clínica **não pode ser credenciado** se faltar qualquer um destes:

| # | Regra | Nível | Veredito quando falha |
| --- | --- | --- | --- |
| R1 | Cliente é PJ | clínica | **INAPTO** |
| R2 | Alvará de funcionamento | clínica | **PENDENTE** |
| R3 | Alvará da Vigilância Sanitária | clínica | **PENDENTE** |
| R4 | Registro no CNES | clínica | **PENDENTE** |
| R5 | Pelo menos 5 anos de formado | profissional | **INAPTO** (com a data em que ficará apto) |
| R6 | Título de especialista | profissional | **PENDENTE** |

**A distinção entre os dois vereditos é o ponto da triagem** — e é [decisão minha]:

- **INAPTO** = fato que papelada nenhuma resolve hoje. A Thaís não vende.
- **PENDENTE** = falta documento. A Thaís cobra o cliente e segue.

Para R5, o sistema calcula e mostra **a data em que o profissional fica apto**
("apto a partir de 03/2027"). Não é regra nova — é aritmética sobre a regra dada, e
transforma um "não" em uma oportunidade agendada.

**A triagem avisa; não bloqueia sozinha** [decisão minha]. Gerar a proposta para quem está
INAPTO/PENDENTE é possível, mas exige uma justificativa escrita, gravada no documento. Um
bloqueio duro erraria sempre que a realidade estivesse na frente do cadastro (o alvará
existe, só não foi enviado ainda) e o sistema seria contornado por fora — que é onde o
caos mora. **Se o dono preferir bloqueio duro, é uma linha de código.**

### 3.2 Documentos

**Uma lista só, igual para todas as operadoras.** Confirmado pelo dono em 10/08/2026:
"todos os modelos de credenciamento/documentos servem para todas as operadoras".

### 3.3 Honorários

Repasse **somente no sucesso**, após a assinatura do contrato com a operadora. Sem
adiantamento e sem despesas adicionais. Consequência no sistema: a conta a receber nasce
quando **a operadora aprova**, não quando o cliente aceita a proposta (§6.3).

### 3.4 Tentativas

Após **uma** tentativa e negativa da operadora, aquele credenciamento se encerra — salvo
acordo expresso para nova tentativa.

### 3.5 Conselhos aceitos

CRM · **CRO** · CRP · CRN · Crefito · CRFa. O CRO não consta no PDF da Thaís; foi
confirmado pelo dono em 10/08/2026 ("atendemos odonto sim").

---

## 4. A lista real de documentos (fonte: PDF da Thaís)

Dezoito itens, em quatro escopos. O escopo diz **a quem o documento pertence** e se ele
**repete por médico**.

### 4.1 Da empresa — escopo `EMPRESA` (só aparece quando o cliente é PJ)

1. Cópia do contrato/estatuto social e alterações (registrados)
2. Comprovante de inscrição no CNPJ
3. Comprovantes de isenções fiscais, tributárias e contribuições — *se houver* (não obrigatório)
4. Carta ou contrato de locação
5. Dados bancários — **documento emitido pelo banco** com CNPJ e/ou razão social + agência e conta (extrato, folha de cheque ou cartão). Não é digitar o número.

### 4.2 Da clínica — escopo `CLINICA`

6. Inscrição da entidade no Conselho
7. Alvará de funcionamento — **trava R2**
8. Alvará da Vigilância Sanitária — **trava R3**
9. Registro no CNES — **trava R4**
10. Duas fotos do consultório (recepção e sala de atendimento), para divulgação no site

> **[decisão minha]** O item 10 está listado em "Documentos pessoais" no PDF, mas é do
> consultório, não de uma pessoa. Movido para este bloco — é onde o médico vai procurar.
> Nenhum item foi criado, removido ou reescrito; só reagrupado.

### 4.3 De cada profissional — escopo `PROFISSIONAL` (repete por médico)

11. CRM ou CRO ou CRP ou CRN ou Crefito ou CRFa — **frente e verso**
12. Diploma — **frente e verso**
13. Especializações — **frente e verso** — **trava R6**

### 4.4 Do responsável técnico — escopo `RESPONSAVEL_TECNICO` (um só)

14. Currículo resumido do responsável técnico

### 4.5 O que o sistema pede hoje e a Thaís não pede

"RG e CPF do médico" **não existe na lista dela**. **Não será apagado**: em produção pode
haver cliente que já enviou arquivo nessa vaga, e apagar a exigência desliga o arquivo do
dono (`Arquivo.requisitoId` é `SetNull`) — o arquivo fica órfão e invisível. Será marcado
como **não obrigatório**, e a Thaís o remove pela tela se quiser. Apagar dado de produção
por conta própria não é decisão do agente.

---

## 5. O que muda no banco

Todas as colunas novas são **opcionais** — nada do que já existe quebra.

### 5.1 `Profissional` (novo)

O médico/dentista a credenciar. Pertence a um `Cliente`.

| Campo | Para quê |
| --- | --- |
| `clienteId` | dono |
| `nome` | entra na proposta |
| `conselho` | CRM · CRO · CRP · CRN · CREFITO · CRFA |
| `conselhoNumero`, `conselhoUf` | identificação |
| `especialidade` | entra na proposta ("cardiologista") |
| `anoFormatura` | **R5** — calcula os 5 anos e a data em que fica apto |
| `tituloEspecialista` | **R6** — declarado; o comprovante é o documento 13 |
| `responsavelTecnico` | quem responde pelo item 14 |
| `ativo` | desligar sem apagar histórico |

### 5.2 `ServicoRequisito` — três colunas novas

| Campo | Para quê |
| --- | --- |
| `escopo` | `EMPRESA` · `CLINICA` · `PROFISSIONAL` · `RESPONSAVEL_TECNICO`. Ausente = comportamento de hoje |
| `frenteVerso` | divide a exigência em duas vagas de envio |
| `travaElegibilidade` | marca as exigências que travam R2/R3/R4/R6 |

### 5.3 `Arquivo` — duas colunas novas

`profissionalId` (de qual médico é este arquivo) e `lado` (`FRENTE`/`VERSO`). Ambas
opcionais; arquivo antigo continua válido sem elas.

### 5.4 `Credenciamento` (novo) — a grade médico × operadora

Cada cruzamento é uma linha. **Uma peça, três funções:** monta o preço da proposta,
acompanha o andamento e dispara a cobrança.

| Campo | Para quê |
| --- | --- |
| `clienteId`, `profissionalId`, `operadoraId` | o cruzamento |
| `valor` | preço daquela célula |
| `status` | `A_PROTOCOLAR` · `PROTOCOLADO` · `EM_ANALISE` · `APROVADO` · `NEGADO` · `ENCERRADO` |
| `documentoId` | a proposta que o originou |
| `contaId` | a conta a receber criada na aprovação (§6.3) |
| `tentativa` | 1 por padrão; 2 exige o acordo do §3.4 |
| datas por status + `motivoNegativa` | histórico |

Chave única `(profissionalId, operadoraId, tentativa)` — não existem duas linhas para o
mesmo par na mesma tentativa.

### 5.5 `Documento` — uma coluna nova

`numero` (inteiro, sequencial, exibido com 4 dígitos: `0034`). **Pendente do dono:** em que
número a Thaís está hoje. Sem a resposta, a contagem começa em **35** e é corrigível por
configuração.

---

## 6. Como cada parte funciona

### 6.1 A triagem na tela

Um card **"Pode credenciar?"** com o veredito e os motivos, em três lugares:

- **ficha do cliente** — antes de a Thaís escrever qualquer coisa;
- **painel do lead, no funil** — antes de vender;
- **Portal do cliente** — só os itens `PENDENTE`, redigidos como pedido, sem julgamento
  ("falta enviar o alvará da Vigilância Sanitária"). O cliente **nunca** lê a palavra
  "inapto" nem o motivo de uma recusa comercial.

Ao gerar a proposta de credenciamento com veredito diferente de APTO, o diálogo mostra o
que falta e pede a justificativa do §3.1.

### 6.2 O Portal do cliente

A lista agrupada por escopo, com o bloco `PROFISSIONAL` repetido por médico e barra de
progresso ("faltam 7 de 18"). Exigência `frenteVerso` aparece como duas vagas.

O progresso conta **pares (exigência × profissional)**, não exigências — senão uma clínica
com dois médicos mostraria 100% com metade da papelada.

### 6.3 O dinheiro

A conta a receber do credenciamento **nasce quando o status vira `APROVADO`**, no valor da
célula. Aceite de proposta **não** cria cobrança para este serviço.

`NEGADO` encerra aquele cruzamento (§3.4). Reabrir cria a **tentativa 2** e exige ação
explícita de quem registrou o acordo, com o motivo gravado.

> Esta é a única mudança de comportamento em dinheiro. Vai em commit próprio, com teste
> que prova que o aceite **não** cria conta e que a aprovação cria.

### 6.4 O documento

Modelo novo em 5 seções, fiel ao PDF.

**Escrito pelo sistema:** número, data, cliente, profissionais com especialidade
(`{{profissionais}}` → "Dr. Marcos Lottenberg, cardiologista, e Dra. Carina Lottenberg,
ginecologista e obstetra"), operadoras, valor + valor por extenso (`valorPorExtenso` já
existe), consultora responsável.

**Fixo, palavra por palavra do original:** plano de trabalho em 6 passos; honorários no
sucesso; observações (responsabilidade documental do cliente + uma tentativa);
confidencialidade; assinatura das duas partes.

O construtor (`CredenciamentoPicker`) troca "valor por operadora × quantidade" pela grade
médico × operadora, preenchida com o valor padrão e editável célula a célula.

---

## 7. Fora de escopo

Lista diferente por operadora (§3.2 a descarta) · conferir validade ou autenticidade de
documento enviado · OCR · integração com sites de operadora · cobrança automática ao
cliente. Cada um é um projeto próprio.

---

## 8. Como se prova que funciona

**Testes automáticos (Vitest)**

- a semente cria os 18 itens nos escopos certos, e **não apaga** o item do §4.5;
- a triagem devolve INAPTO para cliente PF, INAPTO com data futura para menos de 5 anos de
  formação, e PENDENTE para cada alvará/CNES/título ausente;
- o progresso conta pares (exigência × profissional) — dois médicos, metade enviada = 50%;
- a grade soma o total certo com células vazias no meio;
- **aceite de proposta não cria conta a receber; `APROVADO` cria, no valor da célula**;
- `NEGADO` encerra; reabrir exige tentativa 2;
- a proposta rende certo com 1 e com 2 profissionais.

**Teste de tela (Playwright)**

- Portal com dois médicos mostra dois blocos separados; enviar frente e verso move a barra.

**Verificação com o dono**

- abrir o Portal local com dois médicos de teste e mostrar a tela.

---

## 9. Ordem de execução

1. **Bloco A** — `Profissional`, escopos nas exigências, `frenteVerso`, a lista real, a
   triagem, o Portal. Entrega valor sozinho.
2. **Bloco B** — a grade médico × operadora, o construtor da proposta, o acompanhamento.
3. **Bloco C** — o documento fiel, a numeração, o gatilho da conta a receber.

Blocos B e C mexem em estrutura de banco e em dinheiro: ramo separado, PR, revisão por
especialista (`database-reviewer`, `security-reviewer`) e CI verde antes de qualquer merge.
Nada vai a produção sem aviso ao dono.

---

## 10. Pendente do dono

- **Em que número a Thaís está na contagem das propostas** (a que ele mandou é a 0034).
  Trava só o §5.5; A e B seguem sem isso.
