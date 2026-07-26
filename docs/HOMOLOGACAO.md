# HOMOLOGAÇÃO — primeiro deploy, em ambiente separado

> **⚠️ SUPERADO (2026-07-26).** Este documento é um registro PRÉ-DEPLOY. O app já está **em
> produção** em https://workspace.medconsultoria.com.br (TineHost/LiteSpeed-lsnode; tempo real
> por polling; backup automático ativo). Estado atual e decisões: ver `/CLAUDE.md` e
> `docs/DECISIONS.md` (ADR-84..87). Mantido abaixo como histórico.

> **Para que serve:** subir a aplicação num endereço real da TineHost **antes** de produção, para
> descobrir o que só aparece no servidor (versão do Node, ~~Passenger~~ LiteSpeed/lsnode, limites
> do MySQL, WebSocket — hoje sabe-se **não suportado**, tempo real por polling, ADR-84 — pasta de
> uploads). Com dados de teste e **sem** e-mail real.
>
> Tudo que foi validado até aqui foi **local**. O primeiro deploy sempre revela algo — é por isso
> que ele acontece aqui, e não direto no ambiente que a Thaís vai usar.
>
> Este documento cobre **só o que difere de produção**. O passo a passo detalhado
> (DirectAdmin, CloudLinux Node.js Selector, LiteSpeed/lsnode, rsync) está em **`docs/DEPLOY.md`
> §12** — siga aquele, aplicando as diferenças abaixo.

---

## 1. A regra que torna homologação segura

**Homologação NUNCA compartilha nada com produção.** Três separações obrigatórias:

| | Homologação | Produção |
|---|---|---|
| Subdomínio | `homolog.medconsultoria.com.br` | `workspace.medconsultoria.com.br` |
| Banco MySQL | `..._homolog` | `..._prod` |
| Pasta de uploads | `~/uploads-homolog/` | `~/uploads/` |

Se qualquer um dos três for compartilhado, um teste em homologação altera dados reais. **Confira
os três antes de subir.**

---

## 2. O que você precisa fazer (só você tem acesso)

1. **Subdomínio + SSL** no DirectAdmin: `homolog.medconsultoria.com.br` (DEPLOY.md §12, Passo 1).
2. **Aplicação Node** no CloudLinux Node.js Selector apontando para esse subdomínio (Passo 2).
3. **Banco MySQL novo**, exclusivo de homologação, com usuário próprio (Passo 6).
4. **Pasta de uploads** fora do diretório do deploy — o rsync sobrescreve (Passo 3 e §11).

> Anote a **versão do Node** que o painel oferece. O projeto exige **Node ≥ 20**; se só houver
> versão menor, pare e me avise — isso muda o plano.

---

## 3. O `.env` de homologação (no servidor)

Igual ao de produção (DEPLOY.md §5), **com estas diferenças deliberadas**:

```
NODE_ENV=production          # é um build de produção, ainda que o ambiente seja de teste
WEB_ORIGIN=https://homolog.medconsultoria.com.br
DATABASE_URL=mysql://<user_homolog>:<senha>@localhost:3306/<banco_homolog>
SESSION_SECRET=<gere um NOVO, diferente do de produção>
UPLOADS_DIR=/home/<usuario>/uploads-homolog

# E-MAIL: deixe VAZIO em homologação.
# Sem SMTP_HOST/USER/PASS, o sistema registra o envio no histórico e NÃO envia nada.
# É assim que se testa o fluxo de e-mail sem escrever para clientes de verdade.
# SMTP_HOST=
# SMTP_USER=
# SMTP_PASS=

# IA: opcional. Sem OPENAI_API_KEY, os recursos de IA aparecem desativados (comportamento
# já coberto por teste automatizado) — não quebra nada.
# OPENAI_API_KEY=

# Senha do primeiro ROOT (usada uma vez pelo seed; troque depois pelo app).
SEED_ROOT_EMAIL=root@medconsultoria.com.br
SEED_ROOT_PASSWORD=<senha forte, DIFERENTE da de produção>
```

> **`SESSION_SECRET` e `SEED_ROOT_PASSWORD` diferentes de produção não é preciosismo:** se
> homologação vazar, produção continua intacta.

---

## 4. Subir

```bash
pnpm build:deploy      # gera apps/api/dist/ auto-contido (server.js + public/ + prisma/)
```

Envie o conteúdo de `apps/api/dist/` para o Application Root do subdomínio (DEPLOY.md §12,
Passo 4) e no servidor:

```bash
npx prisma migrate deploy    # cria o schema
node prisma/seed.js          # cria o ROOT + o ADMIN + as etapas do funil
```

**NÃO rode `db:demo`.** Ele tem trava de produção e vai recusar — é o comportamento correto.

---

## 5. Popular com dados de teste

Homologação precisa de dados para exercitar os fluxos, mas **inventados por você pelo próprio
app** — não importe base de cliente real (LGPD).

Entre como ROOT e crie pela interface: 1 cliente fictício, 1 lead, 1 projeto, 1 conta a pagar e
1 documento. É o suficiente para os fluxos principais.

---

## 6. Validar

**Automático — o mesmo verificador, agora contra o servidor real:**

```bash
pnpm doutor --url https://homolog.medconsultoria.com.br
pnpm doutor --url https://homolog.medconsultoria.com.br --perfil admin
```

15 rotas × 8 tamanhos de tela (320px a 1920px). Sai com erro se achar algo.

**Manual — o que o doutor não vê e só o servidor revela:**

- [ ] **Login** entra e a sessão **sobrevive a um refresh** (cookie com `Secure` sob HTTPS).
- [ ] **WebSocket**: abrir Mensagens em duas abas e ver a mensagem chegar sozinha.
      *~~É o item de maior risco atrás do Passenger.~~ RESOLVIDO: a hospedagem (LiteSpeed/lsnode)
      não suporta WebSocket; tempo real é por polling (`refetchInterval`), ADR-84 — não há mais
      item a validar aqui.*
- [ ] **Upload**: anexar um arquivo na ficha de um cliente, baixar de volta,
      **reiniciar a aplicação pelo painel** e conferir que o arquivo continua lá
      (prova que `UPLOADS_DIR` está fora do diretório do deploy).
- [ ] **PDF**: abrir um documento e imprimir/salvar em PDF (é feito no navegador, sem servidor).
- [ ] **Celular de verdade** — não só o emulador: abrir no seu telefone e navegar.
- [ ] **Portal do Cliente**: enviar acesso a um cliente fictício e entrar com ele.
- [ ] **Painel Sistema** (`/sistema`, só ROOT): a aba **Banco** mostra a conexão e o tamanho;
      a aba **Erros** deve estar vazia depois da navegação.

---

## 7. Quando promover para produção

Só quando **todos** forem verdade:

1. `pnpm doutor` contra homologação: **zero achados**;
2. a lista manual do §6: **toda marcada**;
3. a aba **Erros** do painel Sistema **vazia** após um dia de uso;
4. os **4 dados jurídicos** preenchidos — razão social, CNPJ, endereço e foro
   (`packages/shared/src/constants/institucional.ts`, hoje `null` de propósito).

> **O item 4 é bloqueador de negócio, não de código.** Sem ele, todo contrato gerado sai com
> `**[A PREENCHER: CNPJ]**` em negrito no corpo. Não assine contrato com cliente assim.

---

## 8. Se algo der errado

O deploy é **reversível**: mantenha o bundle anterior e restaure o dump do banco
(DEPLOY.md §8). Em homologação o custo de errar é zero — **é exatamente para isso que ela existe.**

Os riscos conhecidos e seus planos B estão em **DEPLOY.md §7**. Os quatro pendentes desde o
início do projeto (`docs/CLAUDE.md §12`) só se resolvem aqui: versão do Node, Passenger vs
Nginx Unit, limite de conexões do MySQL e WebSocket atrás do proxy.
> **ATUALIZAÇÃO 2026-07-26:** resolvidos — hospedagem é LiteSpeed/lsnode (não Passenger nem
> Nginx Unit); WebSocket não suportado, tempo real por polling (ADR-84).

---

## 9. O que eu preciso de você para acompanhar

Depois de subir, me mande:

- o **endereço** de homologação;
- a saída de `node scripts/preflight.mjs` rodado **no servidor** (DEPLOY.md §10);
- o resultado do `pnpm doutor --url https://homolog...`;
- qualquer erro que aparecer na aba **Erros** do painel Sistema.

Com isso eu corrijo o que aparecer antes de produção.
