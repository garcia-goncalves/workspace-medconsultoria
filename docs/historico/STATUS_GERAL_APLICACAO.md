# STATUS GERAL DA APLICAÇÃO

> **⚠️ SUPERADO (2026-07-26).** Este documento é um registro PRÉ-DEPLOY. O app já está **em
> produção** em https://workspace.medconsultoria.com.br (TineHost/LiteSpeed-lsnode; tempo real
> por polling; backup automático ativo). Estado atual e decisões: ver `/CLAUDE.md` e
> `docs/DECISIONS.md` (ADR-84..87). Mantido abaixo como histórico.

> Auditoria consolidada · **21/07/2026** · main `32ffa42`
> Base: 42 PRs mergeados com CI verde, 12 bugs registrados, validação ao vivo em navegador.
>
> **Este documento não afirma nada só porque um teste passou.** Onde a evidência é automática,
> está escrito; onde é manual, está escrito; onde **não há evidência**, está escrito também.

---

## 1. Estado atual

| Camada | Situação |
|---|---|
| Frontend (React/Vite) | 21 rotas · 8 tamanhos de tela varridos sem defeito |
| Backend (Fastify/tRPC) | 24 módulos · RBAC validado por teste **e** por tentativa direta na API |
| Banco (MySQL/Prisma) | 53 migrations aplicadas · banco de dev **zerado** de dados fictícios |
| Autenticação | 12 bugs de acesso resolvidos · login instrumentado |
| Testes | 85 unitários · 74 E2E · 24 specs · CI 3 jobs |
| Deploy | Bundle auto-contido compila · guias de produção e homologação escritos [ATUALIZAÇÃO 2026-07-26: deploy já feito, app em produção] |

**Nunca rodou fora da máquina local.** Todo "funciona" abaixo significa *funciona em ambiente
de desenvolvimento*. [ATUALIZAÇÃO 2026-07-26: desde então o app rodou e validou em produção —
ver `/CLAUDE.md`.]

---

## 2. Funcionalidades prontas

**Validadas ao vivo no navegador**, com fluxo concluído e persistência conferida:

- **Vendas/Funil** — lead, checklist por etapa, avanço automático, conversão em cliente
- **Clientes** — ficha, contatos, serviços contratados, arquivos, Portal
- **Projetos** — kanban, cartões, checklist, cronômetro, comentários
- **Agenda** — 5 visões, arrastar para reagendar, aviso de conflito
- **Financeiro** — carteiras Empresa/Pessoal, recorrência, "Precisa de você"
- **Documentos** — 19 modelos, folha A4, aceite online, assinatura eletrônica
- **Mensagens** — conversas, grupos, helpdesk do cliente, tempo real
- **Portal do Cliente** — isolamento por cliente confirmado por tentativa direta na API
- **Sistema (ROOT)** — 8 abas com dados reais; ações exercidas, não só lidas
- **Ajustes** — serviços, modelos, catálogos, equipe, e-mails
- **RBAC** — 4 papéis; negação verificada na UI **e** por chamada direta à API (403)

**Ferramentas de operação** — `pnpm doutor` (saúde da app) · `pnpm acessos` (diagnóstico de
login) · `pnpm db:limpar` (zerar dados de teste, com dump) · `pnpm verificar:bootstrap` (ensaio
de banco limpo) · `pnpm test:e2e:isolado` (E2E sem sujar o banco de dev).

---

## 3. Funcionalidades incompletas ou pendentes

| Item | Situação | Impacto |
|---|---|---|
| **Dados jurídicos do contrato** | razão social, CNPJ, endereço e foro estão `null` **de propósito**; o contrato imprime `[A PREENCHER: CNPJ]` | 🔴 **bloqueia uso comercial** — não assine contrato assim |
| **Conteúdo institucional** | equipe real, tabela de preços, operadoras, hospitais, textos dos modelos | 🟠 app funciona, conteúdo é de partida |
| **Guia "?" por página** | existe (`GuiaTour`), mas **não auditei página a página** nem o tamanho do pop-up em telas pequenas | 🟠 pedido explícito do dono, **não feito** |
| **Busca / "Perguntar à IA"** | funciona com chave configurada; **não auditei cobertura** (o que a busca encontra, o que a IA responde) | 🟠 pedido explícito do dono, **não feito** |
| **E-mail real** | nunca disparado (proibido em teste); SMTP validado só contra Mailpit | 🟠 primeiro envio real é no deploy |
| **PDF** | gerado no navegador (sem servidor); testado no Chrome apenas | 🟡 |

---

## 4. Bugs

**12 registrados, 12 corrigidos, 0 abertos** (detalhe em `BUG_TRACKER.md`). Os graves:

| # | Bug | Como foi achado |
|---|---|---|
| 004 | **Configurações** renderizava **em branco** — `useEffect` devolvendo Promise | varredura manual |
| 007 | **Impossível trocar de conta**: `/login` redirecionava em silêncio | relato do dono |
| 008 | **Login enviava o estado do React, não a tela** (autofill) | simulação de autofill |
| 009 | **Catálogo de serviços podia nunca ser criado** (`if count === 0`) | perseguir falha de teste |
| 012 | **"E-mail inválido" com o e-mail certo** — U+200B colado do markdown | **instrumentação + inspeção dos bytes** |

> **Padrão que vale registrar:** os 3 bugs mais graves **não foram achados por teste** — foram
> achados usando a aplicação e, no caso do 012, só depois de instrumentar e olhar o hexadecimal.
> Suíte verde não é prova de que está pronto.

---

## 5. Riscos técnicos

| Risco | Gravidade | Situação |
|---|---|---|
| **Nunca rodou na TineHost** — Node, Passenger, WebSocket atrás do proxy, limite de conexões MySQL | 🔴 | 4 pendências abertas desde o início (`CLAUDE.md §12`); só o deploy resolve [ATUALIZAÇÃO 2026-07-26: RESOLVIDAS — hospedagem é LiteSpeed/lsnode (não Passenger); WebSocket não é suportado, tempo real por polling (ADR-84)] |
| **Credenciais expostas em 21/07** — chave OpenAI e senha SMTP coladas em conversa | 🔴 | **rotacionar antes do deploy** |
| **Bundle > 500 kB** sem divisão de código | 🟡 | aceitável para app interno; piora em 3G |
| **Throttle de login em memória** | 🟡 | zera a cada restart; ok para 1 processo |
| **Sem backup automatizado do MySQL** | 🟠 | `db:limpar` faz dump; produção precisa de rotina [ATUALIZAÇÃO 2026-07-26: IMPLEMENTADO — cron diário 03:00 (`scripts/server/backup-db.sh`), ADR-86] |
| **Sem monitoramento externo** | 🟡 | painel Sistema é interno: se o app cair, ninguém avisa |

---

## 6. Melhorias recomendadas (não bloqueiam)

1. Dividir o bundle (`manualChunks`) — primeiro carregamento no celular.
2. Backup automático do MySQL + teste de restauração.
3. Monitor externo de uptime (o painel não avisa se o app cair).
4. Throttle de login em banco, se algum dia houver mais de um processo.
5. `pnpm doutor` no CI, contra o app subido — pega regressão visual antes do merge.

---

## 7. Pendências ANTES da homologação

- [ ] **Rotacionar a chave da OpenAI e a senha do SMTP** (expostas em 21/07)
- [ ] Subdomínio + SSL, app Node, **banco separado**, **pasta de uploads persistente**
- [ ] `.env` de homologação a partir de `.env.production.example`, **com SMTP vazio**
- [ ] Confirmar **Node ≥ 20** no painel — se não houver, o plano muda

---

## 8. Pendências ANTES do deploy em produção

- [ ] Homologação validada: `pnpm doutor --url https://homolog…` **sem achados**
- [ ] Lista manual do `docs/HOMOLOGACAO.md §6` — **WebSocket** e **upload sobrevivendo a restart** são os itens de risco
- [ ] Aba **Erros** do painel Sistema vazia após um dia de uso
- [ ] **Os 4 dados jurídicos preenchidos** 🔴
- [ ] Conteúdo institucional revisado pela Thaís
- [ ] Rotina de backup do banco definida

---

## 9. Nota e conclusão

### Nota geral: **7,5 / 10**

| Dimensão | Nota | Por quê |
|---|---:|---|
| Funcionalidade | 9,0 | módulos completos e exercitados ao vivo |
| Qualidade de código | 8,5 | tipado, testado, lint limpo, 42 PRs revisados |
| Testes | 8,0 | 159 testes; ainda assim os piores bugs escaparam deles |
| Segurança | 7,5 | RBAC sólido; **credenciais expostas** pesam |
| UX / Responsividade | 8,0 | 320–1920px sem defeito; guia "?" e busca **não auditados** |
| Prontidão operacional | 5,0 | **nunca rodou fora do localhost** |
| Conteúdo | 4,0 | dados jurídicos e institucionais faltando |

### Conclusão estimada: **85%**

- Software: **~95%**
- Operação (deploy, backup, monitoramento): **~40%**
- Conteúdo (jurídico + institucional): **~30%**

> **Os 15% que faltam quase não são código.** São conteúdo que depende da Thaís, e a validação
> no servidor real — que, por definição, não dá para antecipar aqui.

---

## 10. Checklist para "pronta para produção"

**Bloqueadores** — sem estes, não vá:
- [ ] Chave OpenAI e senha SMTP **rotacionadas**
- [ ] Razão social, CNPJ, endereço e foro preenchidos
- [ ] Homologação no ar e validada
- [ ] WebSocket funcionando atrás do Passenger
- [ ] Upload sobrevivendo a restart da aplicação
- [ ] Backup do banco configurado e **restauração testada**

**Importantes** — não impedem, mas cobram depois:
- [ ] Conteúdo institucional revisado
- [ ] Guia "?" auditado página a página
- [ ] Busca/IA com cobertura conferida
- [ ] Monitor externo de uptime
- [ ] Primeiro e-mail real enviado e recebido

**Desejáveis:**
- [ ] Bundle dividido · [ ] `doutor` no CI · [ ] throttle em banco

---

### Veredito

**A aplicação está pronta para HOMOLOGAÇÃO. Não está pronta para PRODUÇÃO** — faltam os dados
jurídicos, a rotação das credenciais e a validação no servidor real.

O caminho está documentado ponta a ponta (`docs/HOMOLOGACAO.md` → `docs/DEPLOY.md`). O próximo
passo depende de acesso ao painel da TineHost.

> **ATUALIZAÇÃO 2026-07-26:** o app **já está em produção** desde 26/07/2026
> (https://workspace.medconsultoria.com.br). Pendências restantes: dados jurídicos e rotacionar
> chave OpenAI/senha SMTP — ver `/CLAUDE.md §11-12`.
