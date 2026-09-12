## pedido_original
"⚠️ UMA CLÍNICA PODE TER VÁRIOS USUÁRIOS — médicos e secretárias com acesso PRÓPRIO ao
Portal, não uma conta só. MEXE NO BANCO e no Portal."
E, na abertura desta sessão: "Sim, comece por onde achar melhor. Vá até o fim sem parar."

## entendimento
Hoje uma clínica tem UMA conta de Portal, e o e-mail/senha dela circula entre médicos e
secretárias. Vamos dar acesso próprio a cada pessoa da clínica, com nome, e-mail e senha
dela, mais um papel que separa quem FALA PELA CLÍNICA (aceitar proposta, pedir ou cancelar
serviço, desistir do atendimento) de quem só toca o operacional (enviar documento,
responder briefing, falar no suporte). Quem convida e revoga é a equipe da Med, pela ficha
do cliente, e também o responsável da própria clínica, de dentro do Portal.

## usuario_alvo
Três pessoas, em três momentos. (1) A Thaís, na ficha do cliente, quando a clínica pede
"a secretária também precisa entrar" — hoje ela não tem onde clicar. (2) O médico ou a
secretária da clínica, entrando no Portal com o e-mail dele em vez do login compartilhado.
(3) O responsável da clínica, que quer incluir um colega sem abrir chamado com a Med.
Nenhum deles é desenvolvedor — a lente DX não se aplica.

## criterio_de_aceitacao
- `pnpm -r typecheck` e `pnpm lint` saem sem erro.
- Migração aplica no MySQL local e `pnpm --filter @app/db exec prisma migrate status` diz
  que não há pendência.
- Teste de unidade da função pura de permissão do Portal passa (`pnpm --filter @app/shared test`),
  cobrindo: responsável pode aceitar proposta; equipe NÃO pode; equipe pode responder briefing.
- Teste contra o MySQL de verdade provando que (a) duas pessoas da MESMA clínica entram e
  cada uma vê os dados daquela clínica; (b) uma pessoa da clínica A não alcança nada da
  clínica B; (c) revogar derruba a sessão da pessoa revogada.
- Teste provando que a clínica NUNCA fica sem responsável: revogar ou rebaixar o último é
  recusado com mensagem em português.
- Na tela (navegador, olhando): a ficha do cliente mostra o card "Pessoas com acesso ao
  Portal" listando cada pessoa com nome, e-mail, papel, situação e último acesso; convidar
  uma segunda pessoa cria a conta e o e-mail de convite sai; revogar tira o acesso e a
  linha passa a dizer "sem acesso".
- Na tela: entrando no Portal como a segunda pessoa (papel equipe), o botão de aceitar
  proposta e o de cancelar serviço não aparecem, e tentar pela API responde recusa.
- Na tela: o responsável, dentro do Portal, convida um colega e o vê aparecer na lista.
- Zero erro no console do navegador nas telas tocadas.

## fora_de_escopo
Papel por MÉDICO ligado ao cadastro `Profissional` (um usuário do Portal não vira
automaticamente um profissional credenciado — são cadastros diferentes e misturá-los agora
estragaria a grade de credenciamento). Permissão granular por tela ou por documento.
Esconder valores financeiros da secretária — a trava desta entrega é sobre ASSINAR, não
sobre ver, pelo mesmo motivo da ADR-128. Autenticação em dois fatores. Convite em lote.
Publicação em produção (o ritmo é publicar uma vez no fim do dia, e o dono dá o sinal).

## riscos
Migração de banco: uma coluna nova (`User.papelPortal`) e um `UPDATE` que marca como
RESPONSAVEL quem já tem acesso ao Portal hoje. Nada é apagado, nada é convertido, nenhuma
linha muda de sentido — reverter é apagar a coluna. Risco de autorização: mexer em quem
pode escrever no Portal é mexer em isolamento entre clientes; por isso a trava nasce
NEGANDO por padrão e é liberada ação por ação, e o revisor de segurança entra antes do PR.
Sem dado de paciente e sem pagamento nesta entrega.

## plano_de_voo
Fases 1, 4, 5, 6 e 7. A fase 2 (descoberta) fica de fora: o terreno já foi levantado
nesta sessão lendo `schema.prisma`, `trpc.ts`, `acesso-portal.ts`, `usuarios.service.ts` e
`clientes.service.ts`, e a ADR-128 já decidiu o modelo de sessão. A fase 3 (design) fica
de fora: não há direção visual nova — o card de pessoas usa o padrão de card da ficha e a
página do Portal usa o padrão de lista que já existe. Execução no fio da conversa, sem
worktree, porque as etapas tocam os mesmos arquivos e conflitariam. Despachos previstos: 4
(revisores de typescript, react, database e segurança, em paralelo, na fase 6).
