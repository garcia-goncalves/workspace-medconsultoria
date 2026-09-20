# Conciliação — fechar a competência ("maio está conferido")

**Data:** 2026-09-20 · **Depende de:** Fase 2b (ADR-155) e Fase 2c (recurso de glosa)

## 1. O problema

Todo número desta tela é **calculado a cada leitura** — foi a decisão central da Fase 2b, e ela
está certa: status gravado envelhece no dia em que alguém corrige um valor.

O efeito colateral é que **nenhum mês nunca termina**. Maio de 2026, conferido linha a linha em
setembro, tem exatamente a mesma cara de setembro, importado ontem: os dois "abertos", os dois
pedindo atenção. Não há como dizer "este eu já conferi", e por isso:

- A pessoa reconfere o mesmo mês sem saber que já o conferiu.
- Duas pessoas conferem o mesmo mês.
- E o pior: **o mês conferido muda depois, e ninguém fica sabendo.** Basta alguém corrigir o valor
  de um procedimento no de-para — que vale para todas as cirurgias daquele procedimento, inclusive
  as de meses antigos — para os números de maio serem outros, em silêncio.

## 2. ⚠️ A tensão, e como ela se resolve

**"Fechar" e "tudo calculado" se contradizem** — e fingir que não seria o defeito.

Congelar os números de verdade exigiria gravá-los e passar a lê-los no lugar do cálculo. Isso é
exatamente o que a Fase 2b recusou, e por bom motivo: o mês fechado deixaria de refletir um repasse
que chegasse depois, e a tela passaria a mostrar dois dinheiros diferentes para a mesma cirurgia.

A saída não é congelar: é **responder outra pergunta**.

| Pergunta                                     | Quem responde                                             |
| -------------------------------------------- | --------------------------------------------------------- |
| "Quanto este mês vale **hoje**?"             | O cálculo de sempre — nada muda                           |
| "Quanto ele valia **quando foi conferido**?" | O retrato gravado no fechamento                           |
| "Mudou alguma coisa desde então?"            | A comparação entre os dois — e **é isso que se quer ver** |

⚠️ **O retrato NÃO concorre com o cálculo.** Ele não é lido para exibir dinheiro em lugar nenhum;
existe só para a comparação acima. É por isso que ele não repete o erro que a Fase 2c evitou ao
recusar guardar valor no recurso: lá, os dois números responderiam **a mesma** pergunta.

E a divergência deixa de ser silenciosa: vira um aviso na tela — _"fechado com R$ 128.400,00 em
12/09; hoje soma R$ 131.900,00"_.

## 3. As decisões

### 3.1 Fechar trava a EDIÇÃO MANUAL, não a importação

Fechado, o servidor recusa `editarCirurgia`, `abrirRecurso` e `responderRecurso` daquele mês, com
recado dizendo **quem fechou, quando, e que é preciso reabrir**.

⚠️ **A importação continua passando, de propósito.** O mapa do TASY vem por **período**, não por
mês (ADR-155): recusar o arquivo inteiro porque uma cirurgia cai num mês fechado faria a pessoa
não importar nada — e o arquivo é a verdade da origem. O que a importação faz é **avisar** quantas
linhas tocaram mês fechado.

### 3.2 Reabrir é explícito, e fica registrado

Reabrir apaga a linha de fechamento? **Não.** `reabertoEm`/`reabertoPorId` ficam na mesma linha, e
fechar de novo cria um retrato novo. Apagar destruiria a resposta de "quem conferiu isso, e quando".

### 3.3 O fechamento é por cliente E por mês

`@@unique([clienteId, competencia])`. Não existe "fechar tudo": cada clínica tem o seu ritmo, e
fechar em bloco esconderia o mês que ainda não foi olhado.

### 3.4 Só ADMIN+ fecha e reabre

Conferir o mês é ato de quem responde pela conta. O funcionário opera o mês; **declarar que ele
está conferido** é outra coisa. (É a mesma régua do Financeiro, que é `adminProcedure` inteiro.)

## 4. O modelo

```prisma
model CompetenciaFechada {
  id          String @id @default(cuid())
  clienteId   String
  competencia String @db.Char(7)

  fechadoEm    DateTime  @default(now())
  fechadoPorId String?
  reabertoEm   DateTime?
  reabertoPorId String?
  observacao   String?   @db.Text

  // ⚠️ O RETRATO do que foi conferido. NÃO é fonte de verdade do dinheiro de hoje — nenhuma tela
  // o exibe como valor corrente. Serve para uma coisa só: dizer que os números mudaram depois.
  cobrado   Decimal @db.Decimal(12, 2)
  recebido  Decimal @db.Decimal(12, 2)
  glosa     Decimal @db.Decimal(12, 2)
  aReceber  Decimal @db.Decimal(12, 2)
  cirurgias Int

  @@unique([clienteId, competencia])
}
```

**Migração aditiva e isolada:** uma tabela nova. Reverter é `DROP TABLE`.

## 5. Na tela

- Ao lado do seletor de mês: **"Fechar mês"** (ADMIN+), ou o selo **"Conferido em 12/09 por
  Thaís"** com **"Reabrir"**.
- Mês fechado que mudou depois mostra o aviso de divergência, com os dois números.
- A linha da tabela some com o botão de editar? **Não** — o botão continua, e a recusa explica. A
  tela que esconde não ensina; a que recusa, sim.

## 6. O que fica de fora

- **Fechar vários meses de uma vez.** Ninguém pediu, e esconde o mês não olhado.
- **Impedir mudar o de-para de um procedimento** porque ele afeta mês fechado. É a fonte da
  divergência, mas travar o cadastro por causa do histórico é o rabo abanando o cachorro — o aviso
  de divergência é a resposta certa.
- **Fechar a competência de CONSULTAS** (Fase 1). O dinheiro está nas cirurgias; consultas ainda
  não têm valor nenhum.
