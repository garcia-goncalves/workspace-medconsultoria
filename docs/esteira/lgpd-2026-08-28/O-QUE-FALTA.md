# Conformidade com a lei — o que falta fazer (ordem do dono, 28/08/2026)

> **Ordem, com todas as letras:** *"Não quero quebrar regras de lei. Resolva tudo e deixe tudo
> conforme a lei."* — e, sobre publicar: *"podemos primeiro resolver tudo e desenvolver tudo pra
> depois publicar"*, para não gastar Actions à toa.
>
> Este arquivo é o **estado da tarefa**, escrito para a próxima janela executar. Cada item traz o
> diagnóstico já verificado no código, a recomendação e o que precisa ser decidido.

**Ponto de partida:** `main` @ `04e0c5b` (PR #150 mesclado, ADR-140). **Nada disto começou.**

---

## 1. Dado de cliente indo para a OpenAI — o mais grave dos quatro

**Onde:** `apps/api/src/modules/ia/ia.service.ts:220` (`resumirCliente`) e `:247`
(`sugerirProximoPassoLead`). Os dois montam o contexto com `cliente.observacoes` /
`lead.observacoes` (selecionado em `:202`).

**Por que é grave:** o campo `observacoes` **não é neutro**. A migração
`packages/db/prisma/migrations/20260819161500_cliente_sempre_pj/migration.sql` (passo 1) moveu para
dentro dele o **CPF** de todo cliente que era pessoa física, com o texto `[ADR-119] Documento do
cadastro antigo…`. E `leads.service.ts:1509-1511,1539` grava ali o texto livre que qualquer pessoa
digita no formulário público.

Além disso, `docs/IA_PRIVACIDADE.md` **declara para `resumirCliente` apenas** "Nome do cliente +
serviços ativos + etapa no funil" — o código manda mais do que o documento promete, e a mesma
página lista **"Base legal / DPA com a OpenAI"** como pendência não fechada. Ou seja: hoje há
transferência de dado pessoal identificável a um operador estrangeiro, sem base legal registrada, e
**ninguém na casa sabe que isso acontece**.

**RECOMENDAÇÃO: PARAR DE ENVIAR.** Fechar um DPA com a OpenAI é trabalho jurídico que não existe
hoje, e o campo não é necessário para o resumo funcionar. Três camadas:

1. Tirar `observacoes` das duas montagens de contexto.
2. **Segunda tranca:** função pura `redigirDadoPessoal()` (em `@app/shared`, testada) que apaga
   CPF, CNPJ, CRM, RG, telefone e e-mail por expressão regular de **todo** texto que for para a IA
   — não só desses dois lugares. Motivo: a lição da ADR-140 é que a segunda porta é a que fura a
   trava; amanhã alguém acrescenta um campo novo ao contexto.
3. Corrigir `docs/IA_PRIVACIDADE.md` para descrever o que o código faz, não o que se pretendia.

⚠️ **Conferir também:** o `ia.service.ts` inteiro — quais outros pontos mandam texto livre
(mensagens de suporte, respostas de formulário, corpo de documento). O `security-reviewer` não
achou tool-calling nem execução, então o teto do risco é o **conteúdo enviado**, não uma ação da IA.

---

## 2. LGPD: retenção e direito de eliminação

**Diagnóstico verificado:**

- Só `Session` tem limpeza (`sistema.service.ts:548`).
- `EmailEnviado` guarda o **corpo completo** para sempre (`schema.prisma:1075-1094`). Idem
  `ActivityLog`, `ErrorLog` e `Arquivo`.
- `excluirDefinitivoCliente` (`clientes.service.ts:332`) bloqueia diante de **qualquer** vínculo —
  na prática **nenhum cliente real é eliminável** — e não existe anonimização como alternativa.
- Reter por obrigação contratual/legal é defensável. Reter **sem prazo, sem base declarada e sem
  rotina** não é.

**RECOMENDAÇÃO, em três partes:**

1. **Anonimizar, já que eliminar é impossível.** Ação de ROOT que substitui nome, e-mail, CNPJ,
   telefone e observações por marcador (`[dado removido a pedido do titular]`), preserva as linhas
   contábeis e registra quem fez e quando. É a saída que a LGPD aceita quando há obrigação de
   guarda. ⚠️ **Zero migração** se o marcador for texto nos próprios campos.
2. **Expurgo do corpo de e-mail.** Manter metadados (para quem, assunto, quando, entregue ou não —
   é disso que o monitor precisa) e **apagar o corpo** depois de N dias. `ErrorLog` idem.
   **PRECISA DE DECISÃO DO DONO — recomendo 180 dias**, com o número editável em
   *Ajustes → Dados da empresa*, como já é o prazo de credenciamento (ADR-106).
3. **Prazo de guarda do acervo de credenciamento depois de encerrado o contrato.**
   **PRECISA DE DECISÃO DO DONO — recomendo 5 anos** (alinha com a guarda fiscal), contado do
   encerramento. ⚠️ **Nada é apagado automaticamente:** o sistema **avisa** que passou do prazo e a
   Thaís decide. Apagar sozinho o diploma de um médico é pior que guardar demais.

**E falta a página `/privacidade`** (`apps/web/src/app/router.tsx` não tem nenhuma): finalidade,
base legal, prazo e contato do encarregado, linkada em `/comecar` (`CapturaLeadPage.tsx:183`, hoje
só a frase "conforme a LGPD") e no rodapé do Portal (`PortalLayout.tsx:248`). Gravar **data +
versão do aviso** aceito na captura.

---

## 3. Link de proposta e de assinatura não expira

**Onde:** `assinaturas.service.ts:113-137` (`getPorToken`) e `propostas.service.ts:112-136`.
`Assinatura.token` (`schema.prisma:1442`) e `Documento.propostaToken` (`:1396`) são **texto claro**
no banco — ao contrário de `Token.tokenHash`, que é hash.

**O que acontece hoje:** um link de um ano atrás, na caixa de um ex-sócio, **abre o documento
inteiro** (o `getPorToken` devolve `conteudo` completo), sem login, inclusive depois de assinado. E
um backup do banco entrega poder de **assinar**, não só de ler.

**RECOMENDAÇÃO — e dá para fazer com ZERO MIGRAÇÃO:** derivar a validade de `criadoEm`, que já
existe nas duas tabelas.

- **30 dias** a partir da emissão para abrir o link.
- Depois de respondido/assinado, mais **90 dias** só para o signatário reler o que assinou; passado
  isso, recusa com frase em português.
- **Registrar cada acesso por token** (`activityLog`) — hoje ninguém sabe quem abriu.

⚠️ **Cuidado:** a página pública precisa distinguir **expirado** de **inválido** de **falha de
rede** — são três frases diferentes. A ADR-140 já separou as duas últimas; a terceira entra agora.
⚠️ E há e2e que exige a frase "Link inválido" (`e2e/flows-erros-ux.spec.ts:45`).

---

## 4. Credenciamento reaberto cobra de novo? — SÓ O DONO DECIDE

**Onde:** `credenciamento-grade.service.ts:262-264` cria a conta sempre que `!atual.contaId`; e
`abrirNovaTentativa` (`:391-401`) cria a linha nova **sem herdar** `contaId`. Logo, o ciclo
**Aprovado → Encerrado → nova tentativa → Aprovado** gera uma **segunda** conta pelo mesmo médico
na mesma operadora.

**Isto pode ser certo ou errado, e é regra comercial, não código.**

**RECOMENDO: sim, cobra de novo** — a proposta real da Thaís diz *"somente no sucesso"* e *"após 1
(uma) tentativa"*, e uma tentativa nova é trabalho novo. **Mas então a tela precisa dizer isso na
hora de reabrir**, com o valor à vista, senão vira cobrança surpresa.

⚠️ Dois vizinhos do mesmo arquivo, também dinheiro, também abertos:

- **M15:** credenciamento "a combinar" (valor 0) aprovado cria conta de **R$ 0,00** e grava o
  vínculo — nunca mais gera cobrança (`credenciamento-grade.service.ts:263,340`).
- **M1:** contratar pela ficha do prospect gera conta, e converter o lead depois provisiona de novo
  pelos contratados → **cobra 2×**.

---

## Ordem sugerida de execução

1. **Item 1** (IA) — é o único que está transferindo dado **agora**, a cada clique de "resumir".
2. **Item 3** (expiração de token) — zero migração, fecha um acesso permanente.
3. **Item 2** (anonimização + expurgo + página de privacidade) — o maior; a anonimização é zero
   migração, o expurgo precisa de um campo de prazo em `IdentidadeInstitucional`.
4. **Item 4** — depende da resposta do dono; sendo "sim", é a tela avisando, não o código mudando.

**Publicar UMA vez, no fim de tudo** — ordem do dono nesta janela.
