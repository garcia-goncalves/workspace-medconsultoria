# Auditoria completa antes dos dados reais — 27/08/2026

> Pedido do dono: "clicar exatamente 100% EM TODA A APLICAÇÃO e TESTAR TUDO",
> antes de começar a cadastrar dado real em produção. Lead/cliente de teste:
> **Thiago — Clínica Teste — tibamooca@gmail.com**.

## Base (antes de clicar)

- `pnpm -r typecheck` — VERDE nos 5 pacotes (os erros do editor são cache do Prisma)
- `pnpm lint` — VERDE

## Roteiro

### Equipe (ordem do menu)
- [ ] Início
- [ ] Tarefas
- [ ] Agenda
- [ ] Projetos
- [ ] Vendas (funil)
- [ ] Clientes
- [ ] Credenciamentos
- [ ] Documentos
- [ ] Financeiro
- [ ] E-mail
- [ ] Mensagens
- [ ] Ajustes
- [ ] Serviços
- [ ] Modelos de documento
- [ ] Mensagens automáticas
- [ ] Equipe e acessos
- [ ] E-mails enviados
- [ ] Configurações
- [ ] Sistema

### Portal do cliente
- [ ] Entrada / painel
- [ ] Documentos e aceite
- [ ] Formulários
- [ ] Serviços
- [ ] Suporte
- [ ] Quem da clínica entra aqui (ADR-131)
- [ ] Perfil

### Público
- [ ] /comecar (captura de lead)
- [ ] Login / esqueci minha senha
- [ ] Aceite de proposta por link
- [ ] Formulário por link

### Ponta a ponta
- [ ] Lead Thiago/Clínica Teste -> proposta -> aceite -> cliente -> Portal
- [ ] E-mail real chegando em tibamooca@gmail.com

## Achados

(preenchido durante a varredura)

---

## Achados

### A1 — "Enviados hoje" conta FALHA como envio (monitor de e-mails) · CONSERTAR
`apps/api/src/modules/emails/enviados.service.ts:168` conta `emailEnviado` do dia **sem filtrar
`status`**, e a tela rotula o número como *"Enviados hoje"*. Na tela, agora: *Enviados (7 dias) = 0*,
*Taxa de entrega = 0%* e *Enviados hoje = 23* — os três ao mesmo tempo, contradizendo-se.
**Por que importa:** se o e-mail parar em produção, o painel dirá "Enviados hoje: 40" e o dono
concluirá que está funcionando. Foi assim que ninguém percebeu, por meses, que NENHUM e-mail
saía (ADR-122).
**Conserto:** contar só `ENVIADO`, e mostrar as falhas de hoje ao lado quando houver.

### A2 — Catálogo público com lixo de teste · CONFERIR EM PRODUÇÃO
`/comecar` lista todos os serviços ativos. No banco local aparecem
"Servico E2E Briefing", "Serviço E2E SVC049828", "Serviço Guard SVC052678",
"Serviço E2E SVC114905", "Serviço Guard SVC118255" — restos dos testes automatizados.
Inofensivo no local; **em produção seria visível a um futuro cliente**.

### A3 — Lead novo dispara 6 e-mails internos · **RESOLVIDO** (ADR-134)
Um único lead pelo site gerou notificação para andre.cintra@, root@, thiago.garcia@,
thais.garcia@ (+2 contas locais). Com lead real chegando todo dia, isso vira ruído e a
equipe para de ler.

**Causa:** o lead nasce **sem responsável**, então o sistema avisa toda conta ADMIN/ROOT
ativa — não é esquecimento, é a única saída quando não há a quem endereçar. A preferência
por pessoa já existia; o padrão é que era "tudo ligado", e ninguém desliga o que não notou.

**Conserto (ADR-134):** (1) a conta de sistema `root@` **nunca** recebe e-mail operacional,
nem com a preferência ligada à mão; (2) "lead novo" **nasce ligado só para ADMIN** — o ROOT
nominal vê pelo sininho e liga se quiser; (3) a tela de preferências virou **seis seções**
com texto explicando que desligar o e-mail **não** esconde o aviso do sistema.
Em produção, de 4 e-mails por lead para **2** — os dois que realmente atendem.
A régua inteira mora em `decidirEmailOperacional` (`@app/shared`), a mesma que a tela lê.

### A4 — Fim do formulário público não tem saída · REFINO
Depois de "Recebemos seu contato!" a tela fica sem nenhum link (nem para o site, nem para
o Portal). Beco sem saída.

### Ambiente (não é defeito da aplicação)
O computador local não tem servidor de e-mail: toda tentativa falha com
`connect ECONNREFUSED 127.0.0.1:587`. O **disparo** funciona (o registro para
tibamooca@gmail.com existe, com o assunto certo). A entrega só pode ser provada
em produção — onde já foi provada em 22/08 (ADR-122).

### A5 — Recaptura de lead joga fora telefone/empresa/nome novos · CONSERTAR
`leads.service.ts:1418+` — quando alguém que já é lead preenche o formulário de novo, só a
mensagem entra em `observacoes`. Telefone, empresa e nome informados na 2ª vez são
descartados em silêncio.
**Conserto seguro:** preencher só o que está VAZIO no lead; nunca sobrescrever valor que a
equipe já corrigiu à mão.

### A6 — Documento/proposta só oferecia CLIENTE, nunca LEAD · **RESOLVIDO** (ADR-132, PR #138)
Achado pela auditoria e confirmado pelo dono na mesma hora. `clientes.list` exclui prospect de
propósito (ADR-24), mas era ele que alimentava o "Novo documento" — e a proposta é o papel que
se manda para quem AINDA NÃO É cliente. A saída na tela era converter o lead antes da hora.
Corrigido: pré-venda aceita lead, pós-venda continua exigindo cliente. Zero migração.

### A7 — Painel do lead não mostrava documento nenhum · **RESOLVIDO** (ADR-132)
Emitir a proposta e não achá-la mais pelo funil. Nasceu o bloco "Documentos" no painel.

---

## Situação ao fim da 1ª janela (27/08/2026, ~11h30)

### Resolvido e mesclado (`f9ca577`, PR #138 — CI 3/3 verde)
- **A6** — documento/proposta agora aceita LEAD (ADR-132)
- **A7** — painel do lead mostra os documentos (ADR-132)
- **A1** — "Enviados hoje" parou de contar falha como envio (ADR-133)
- **A5** — recaptura de lead parou de descartar telefone/empresa novos (ADR-133)

### Em aberto

**A3 — o lead novo dispara um e-mail para CADA ADMIN/ROOT ativo.** Investigado e
explicado ao dono. Não é defeito: `capturarLead` avisa todos os ADMIN e ROOT porque o
lead **nasce sem responsável** e o sistema não sabe quem vai atender. Em produção são
**4 contas** (`root@`, `thiago.garcia@`, `andre.cintra@`, `thais.garcia@`); no local
apareceram 6 por causa das contas de teste.

A preferência por pessoa **já existe** (`PreferenciaEmail`, tela em Configurações), mas o
padrão de fábrica é **tudo ligado** e ninguém entra ali para desligar.

**Plano combinado com o dono, para a próxima janela:**
1. **`root@` nunca recebe e-mail operacional** — é conta de sistema (ADR-89), ninguém lê
   aquela caixa. Corta 1 dos 4 imediatamente.
2. **Padrão de "lead novo" ligado só para quem toca o comercial (ADMIN)**; ROOT nominal vê
   pelo sininho e liga o e-mail se quiser — a chave já existe, muda só o padrão.
3. **Deixar a tela de preferências fácil de achar**, com texto explicando cada aviso.

⚠️ Ao mexer, lembrar: a regra vive em `notificar()` (`notificacoes.service.ts:110-126`), num
lugar só. Não espalhar checagem por chamador.

**A2 / A8 — lixo de teste no catálogo de serviços.** `Servico E2E Briefing`,
`Serviço E2E SVC049828`, `Serviço Guard SVC052678`, `Serviço E2E SVC114905`,
`Serviço Guard SVC118255`. Aparecem na **página pública `/comecar`** e no **"Solicitar" do
Portal do cliente** — os dois visíveis a quem não é da casa. Inofensivo no local;
**conferir em produção antes do dado real**.

> ✅ **FECHADO em 27/08/2026, 21:50 — conferido em PRODUÇÃO, não presumido.** Depois da
> publicação da `v1.2.0`, `/comecar` e o **"Solicitar" do Portal** foram abertos no
> navegador em `workspace.medconsultoria.com.br`: os dois listam **só os 10 serviços
> reais** (Gestão Operacional · Faturamento · Credenciamento · Negociação com operadoras ·
> Branding · Manual da marca · Site · Redes sociais · Conteúdo & SEO · Tráfego pago).
> **Nenhum** `Serviço E2E` ou `Serviço Guard`. O lixo é só do banco local, onde os e2e o
> criam — e lá ele **fica**, porque limpar o banco de desenvolvimento não prova nada sobre
> produção e o próximo `pnpm test:e2e` o recria.

**A4 — fim do formulário público é beco sem saída.** Depois de "Recebemos seu contato!"
não há link nenhum. Refino pequeno.

**A9 — conta de Portal com nome gerado** (`Portal · Clínica teste`). Dado de teste local;
com cadastro real não acontece. Só observar.

### Telas ainda NÃO percorridas
~~Tarefas · Agenda · Projetos · E-mail · Mensagens · Ajustes · Serviços · Modelos ·
Equipe e acessos · Sistema~~ — **TODAS percorridas na 2ª janela (28/08/2026), ver abaixo.
A varredura de tela antes do dado real está CONCLUÍDA.**

### Já percorridas, sadias
`/comecar` (captura) · Funil (card, painel, edição, passos automáticos, avanço de etapa) ·
Documentos (lista, construtor, geração) · Clientes · Credenciamentos · Financeiro ·
E-mails enviados · **Portal do cliente completo** (serviços, exigências, projetos,
documentos, "Quem da clínica entra aqui", e-mails) · Início.

Varredura automática: **20 rotas, zero erro de console, zero HTTP >= 400, zero
NaN/Invalid Date/undefined** na tela.

### Ambiente — não é defeito da aplicação
O computador do dono **não tem servidor de e-mail**: toda tentativa falha com
`connect ECONNREFUSED 127.0.0.1:587`. O **disparo** funciona (o registro sai com
destinatário e assunto certos). A entrega só se prova em produção — onde já foi provada em
22/08 (ADR-122). ⚠️ Para testar lá, use o botão **"Enviar acesso"** no card do lead: reenviar
o formulário do site com e-mail já conhecido cai na recaptura e **não manda convite novo**.

---

# 2ª janela — 28/08/2026 · as 10 telas que faltavam

Percorridas **clicando**, como o dono pediu (a varredura automática de 20 rotas já tinha dado
"limpo" e não achou nenhum dos defeitos abaixo). Entrada como **Thaís Garcia (ADMIN)** — que é
quem vai usar o sistema — e depois como **ROOT**, para o painel Sistema.

## Telas percorridas nesta janela

Tarefas · Agenda · Projetos · E-mail · Mensagens · Ajustes (índice + os 6 modais: Categorias
financeiras, Origens de leads, Operadoras e convênios, Dados da empresa, Mensagens automáticas,
Equipe e acessos) · Serviços · Modelos · Equipe e acessos · Sistema (as 9 abas).

**A varredura de tela antes do dado real está CONCLUÍDA.**

## Sadias, sem nenhum achado

- **Serviços** — os 10 serviços reais nas 5 categorias, com preço certo (`5% do faturamento/mês`
  no Faturamento). As 4 abas de configuração conferem com os contadores do card (7 passos, 6
  pedidos, 3 tarefas). A exigência duplicada de operadoras (ADR-126) está mesmo removida.
- **Modelos** — 16 modelos + 4 briefings, categorizados. A prévia da Proposta de faturamento sai
  em 3 folhas com cabeçalho corrido e "Página N de M" (ADR-129 funcionando), e os marcadores
  aparecem em português (`[dados para pagamento]`, `[nome do cliente]` — ADR-130).
- **Tarefas** — abas Comigo/Deleguei/Da equipe, data em dd/mm/aaaa, cliente vinculado. ⚠️ O
  seletor de cliente **não lista prospect**, coerente com a ADR-24.
- **Projetos** — 12 projetos, KPIs batendo (11 ativos + 1 pausado = 12), quadro com 5 colunas,
  cartão com o checklist dos 14 documentos de credenciamento.
- **Mensagens** — 5 conversas, contador de não lidas, campo de resposta funcionando.
- **Equipe e acessos** — "Convite pendente" × "Ativo" bem distintos, com **Reenviar** só nos
  pendentes. É a ADR-131 fazendo efeito: antes `ativo=false` era ambíguo.
- **Ajustes** e os 6 modais — dados da empresa completos (inclusive os bancários), 18 operadoras
  com a marcação por serviço conferindo com as abas (6 credenciamento / 18 faturamento).
- **Agenda** — a reunião semanal recorrente aparece nas 5 segundas do mês (3, 10, 17, 24, 31) e
  os conflitos marcados com ⚠️ são reais. As 5 visões abrem.
- **RBAC** — a Thaís (ADMIN) é barrada em `/sistema` com "Acesso restrito". Correto (ADR-43).

## Achados CORRIGIDOS nesta janela (ADR-135)

| # | Onde | O quê |
|---|---|---|
| **B1** | Sistema → Erros | O painel dizia "5 erros não resolvidos" e **nenhum era bug**: 66 ocorrências eram a caixa de e-mail com a senha vencida, estado esperado que a tela já trata com o botão *Reconectar*. Cada primeiro registro manda e-mail ao ROOT, e "resolver" só faz o próximo reabrir como regressão. |
| **B2** | Sistema → Manutenção | "Proteção de cabeçalhos (CSP): **Desligada**" com a CSP **ligada** — provado com `curl -D -`. Era um `false` fixo no código. Agora quem acende é o boot. |
| **B3** | Sistema → Desempenho | **P95 maior que o máximo** (256 ms de p95 com máximo de 184 ms), porque o percentil devolvia o teto do balde do histograma. |
| **B4** | E-mail ao cliente | O médico que ativava o acesso ao **Portal** recebia "Bem-vindo ao **Workspace** MedConsultoria", prometendo clientes e finanças, com botão para o **sistema interno**. Mais o rodapé dos 42 templates e o e-mail de redefinir senha, com o mesmo vazamento. |

## Achados em ABERTO — refino de tela, nenhum produz dado errado

### B5 — o nome do cliente aparece até 3× na mesma linha

Na **Agenda** (visão Lista) e em **Projetos**, o nome vem colado dentro do título e a tela ainda
o mostra à parte:

```
10:00–11:00
Reunião de kickoff — Clínica Vida Plena              ← título do evento
Reunião
Clínica Vida Plena                                   ← selo do cliente
· Credenciamento médico e odontológico — Clínica Vida Plena   ← nome do projeto
```

Vem da conversão do lead, que gera o evento como `Reunião de kickoff — {cliente}` e o projeto
como `{serviço} — {cliente}`. Com nome real e comprido, o card fica ilegível. **Conserto
sugerido:** parar de colar o nome do cliente no título gerado, já que as duas telas o exibem.
⚠️ Mexe em dado já gravado (os títulos existentes continuariam com o nome dentro).

### B6 — editar um evento recorrente abre a data errada, sem avisar

Cliquei na reunião desenhada em **24/08** e o formulário abriu com **03/08** — a primeira
ocorrência da série. Não há nenhum texto dizendo que se está editando **a série inteira**: quem
mudar o horário ali muda todas as reuniões, achando que mudou uma.

### B7 — Equipe e acessos não mostra o papel no Portal

A coluna *Papel* diz só "Cliente" para quem tem acesso ao Portal. Depois da ADR-131 existem dois
papéis — **Responsável** (assina, contrata, convida) e **Equipe** (só operacional) —, e essa tela
não os distingue. Quem olha não sabe se "Marina Souza (secretária)" pode assinar. A informação
existe no card *Pessoas com acesso ao Portal* da ficha do cliente; falta aqui.

### B8 — vocabulário: "LEAD" de um lado, "cliente" do outro

Em **Mensagens**, a lista lateral marca a conversa com o selo **LEAD** e a assinatura da mensagem,
na mesma tela, diz **"Clínica teste · cliente"**.

## Pendência do DONO (só ele faz)

⚠️ **Preencher o "Foro de eleição"** em *Ajustes → Dados da empresa*. Está em branco, e enquanto
ficar assim o contrato sai com **`[A PREENCHER]`** no lugar — que é o comportamento correto (o
sistema nunca inventa dado jurídico), mas precisa estar preenchido antes do primeiro contrato
real. Os demais campos jurídicos e os bancários já estão completos.

## Observações de ambiente — não são defeito

- O **lixo de teste** no catálogo (`Serviço E2E`, `Serviço Guard`) e os briefings/eventos `E2E`
  são do banco **local**, recriados pelos e2e. Em produção já foi conferido: só os 10 reais.
- A caixa de e-mail da Thaís está com **"a senha guardada não funciona mais"** no localhost — a
  máquina não tem servidor de e-mail. É esse estado que produziu o achado B1.
- O incidente **"E-mail transacional não está saindo — 50 falhas seguidas"** é consequência do
  mesmo. Em produção o e-mail está provado funcionando desde 22/08 (ADR-122).
