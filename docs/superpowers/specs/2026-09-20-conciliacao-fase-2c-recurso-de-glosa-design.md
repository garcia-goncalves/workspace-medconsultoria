# Conciliação — Fase 2c: o recurso de glosa (o que se faz DEPOIS de achar o problema)

**Data:** 2026-09-20 · **Depende de:** Fase 2b (ADR-155)

## 1. O problema

A Fase 2b fez a tela **achar** o dinheiro que não entrou: `R$ 2.000,00` de glosa parcial na
Unimed, cirurgia tal, paciente tal. E para aí.

O que acontece a seguir — a clínica **recorre da glosa**, pelo portal da operadora, com protocolo
e prazo — vive fora do sistema. Consequências que aparecem no dia a dia:

- Não há como responder **"de quais glosas já recorremos?"**. Duas pessoas recorrem da mesma, ou
  ninguém recorre de nenhuma.
- Não há como responder **"recorri e a operadora respondeu?"**. Recurso protocolado em maio, sem
  resposta, é dinheiro que se perde por decurso de prazo — em silêncio.
- E a pergunta que mais dói: **"quanto foi glosado e ninguém recorreu?"** Hoje ela não tem
  resposta nenhuma, e é dinheiro perdido por omissão, não por negativa.

## 2. As decisões, e o porquê de cada uma

### 2.1 ⚠️ O recurso NÃO guarda dinheiro

Quando a operadora acata, o valor entra num **repasse futuro** — e o repasse já é importado, já
sobe o `recebido` e já faz a glosa se recalcular sozinha.

Gravar "valor recuperado" no recurso criaria uma **segunda fonte do mesmo número**, e as duas
divergiriam no primeiro caso em que a operadora pagasse diferente do que respondeu. O recurso
guarda o **processo**: quando se recorreu, por onde, com qual protocolo, o que a operadora alegou
e qual foi o desfecho.

**Descartado:** um campo `valorContestado`. Ele responderia "quanto está em recurso" mesmo depois
de a glosa mudar — mas a resposta que interessa é a de **agora**, e essa é derivada: a soma da
glosa atual das cirurgias com recurso aberto. Menos um número para divergir.

### 2.2 O status do recurso é GRAVADO — ao contrário do status da conciliação

Parece contradizer a Fase 2b, e não contradiz. O status da conciliação é **derivado de números
que o sistema conhece** (cobrado × recebido), então gravá-lo só criaria a chance de ele envelhecer.
O status do recurso é um **fato do mundo** que só uma pessoa sabe — a operadora respondeu, e o quê.
Não há de onde calculá-lo.

### 2.3 Um recurso por cirurgia, e recorrer de novo é linha nova

A glosa é por cirurgia (é ali que `cobrado − recebido` existe). Recorrer de novo da mesma cirurgia
é **tentativa 2**, linha nova — o molde do `Credenciamento` (ADR-104): **negado não vira acatado
por edição**. Sem isso, a segunda tentativa apagaria a prova de que a primeira foi negada, que é
justamente o que se leva para a operadora.

### 2.4 Só se recorre do que foi glosado

O servidor recusa abrir recurso em cirurgia que não esteja em `GLOSA_PARCIAL` ou `GLOSA_TOTAL`.

⚠️ **Mas o recurso FICA se a cirurgia sair desse estado depois.** Recorri, a operadora pagou, o
status virou `PAGO` — o recurso continua ali, como história do que aconteceu. Apagá-lo apagaria a
explicação de por que o dinheiro entrou.

### 2.5 O recurso tem prazo próprio, e é o "o que travou?" dele

Mesma régua da Fase 2b, outro relógio: `DIAS_ATE_A_RESPOSTA_DO_RECURSO = 30`. Recurso aberto além
disso, sem resposta, é o que precisa de telefonema.

⚠️ Constante, e não campo em Ajustes, pelo mesmo motivo da defasagem de pagamento: é
característica do ciclo das operadoras, não preferência da casa. Vira campo no dia em que alguém
pedir — e o número já estará aqui.

### 2.6 O filtro que mais importa é o do que NÃO tem recurso

"Glosado e ninguém recorreu" é dinheiro perdido por omissão. É o primeiro filtro da tela, não o
último.

## 3. O modelo

```prisma
model RecursoDeGlosa {
  id         String @id @default(cuid())
  clienteId  String
  cirurgiaId String
  tentativa  Int    @default(1)

  status       StatusRecursoGlosa @default(ABERTO)
  canal        String?            @db.VarChar(60)  // portal da operadora, e-mail, telefone
  protocolo    String?            @db.VarChar(60)
  abertoEm     DateTime           @db.Date
  respondidoEm DateTime?          @db.Date

  motivoDaGlosa String? @db.Text   // o que a operadora alegou
  observacao    String? @db.Text

  criadoPorId String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([cirurgiaId, tentativa])
}

enum StatusRecursoGlosa {
  ABERTO
  ACATADO
  NEGADO
  ENCERRADO   // desistiu, prescreveu, acordo por fora
}
```

**Migração aditiva:** uma tabela nova e um enum novo. Nenhuma tabela existente muda, nenhum
backfill. Reverter é `DROP TABLE` + `DROP TYPE`.

## 4. O que a linha da conciliação ganha

`recurso: { id, status, tentativa, abertoEm, respondidoEm, protocolo, semResposta } | null` — o
**mais recente** daquela cirurgia. As tentativas anteriores existem no banco e aparecem no diálogo.

E os totais ganham três números:

| Número                | O que responde                                                          |
| --------------------- | ----------------------------------------------------------------------- |
| `emRecurso`           | Glosa das cirurgias com recurso **aberto** — o que está sendo disputado |
| `glosaSemRecurso`     | Glosa de quem **nunca** teve recurso — o dinheiro perdido por omissão   |
| `recursosSemResposta` | Recursos abertos além do prazo — o que precisa de telefonema            |

## 5. O que fica de fora desta fase

- **Recurso que cobre várias cirurgias de uma vez** (um protocolo para o lote do mês). Acontece, e
  o desenho aqui não impede: são N recursos com o mesmo `protocolo`. Agrupar de verdade é desenho
  próprio, e ninguém pediu.
- **Anexar o comprovante do protocolo.** O acervo de arquivos do cliente já existe; ligar um
  arquivo ao recurso é passo seguinte.
- **Aviso automático** quando o prazo vence. A tela mostra; avisar por e-mail é outra decisão.
