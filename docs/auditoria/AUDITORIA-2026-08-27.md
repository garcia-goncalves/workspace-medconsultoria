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

### A3 — Lead novo dispara 6 e-mails internos · AVALIAR
Um único lead pelo site gerou notificação para andre.cintra@, root@, thiago.garcia@,
thais.garcia@ (+2 contas locais). Com lead real chegando todo dia, isso vira ruído e a
equipe para de ler. Conferir se as preferências por usuário resolvem.

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
