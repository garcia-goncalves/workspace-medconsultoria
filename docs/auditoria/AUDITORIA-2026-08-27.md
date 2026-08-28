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
Tarefas · Agenda · Projetos · E-mail · Mensagens · Ajustes · Serviços · Modelos ·
Equipe e acessos · Sistema (exige ROOT — a Thaís é ADMIN, entrar como `root@`).

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
