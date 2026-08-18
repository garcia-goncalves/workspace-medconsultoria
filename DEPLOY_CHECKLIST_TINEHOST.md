# DEPLOY_CHECKLIST_TINEHOST.md

> **⚠️ SUPERADO (2026-07-26).** Este documento é um registro PRÉ-DEPLOY. O app já está **em
> produção** em https://workspace.medconsultoria.com.br (TineHost/LiteSpeed-lsnode; tempo real
> por polling; backup automático ativo). Estado atual e decisões: ver `/CLAUDE.md` e
> `docs/DECISIONS.md` (ADR-84..87). Mantido abaixo como histórico.

> Auditoria de deploy · **21/07/2026** · main `5eea798`
> ~~**Ambiente de homologação ainda não existe.** Nada aqui foi executado no servidor.~~
> **ATUALIZAÇÃO 2026-07-26:** já executado — app em produção desde 26/07/2026.
>
> Escopo: tudo que pode **impedir ou dificultar** a execução na TineHost.
> Companheiros: `docs/DEPLOY.md` (passo a passo técnico) · `docs/HOMOLOGACAO.md` (1º deploy).

---

## 1. O que JÁ está pronto

Auditado no código, não presumido.

| Área | Situação | Evidência |
|---|---|---|
| **Estrutura** | 1 processo Node serve API + WebSocket + SPA na mesma porta | `apps/api/src/server.ts` |
| **Build** | `pnpm build:deploy` gera bundle **auto-contido** em `apps/api/dist/` (`server.js`, `public/`, `prisma/`, `package.json`, `app.cjs`) | executado, compila |
| **Startup Passenger** | `app.cjs` gerado automaticamente (CJS → evita `ERR_REQUIRE_ESM`) | `scripts/bundle-deploy.mjs` |
| **Node** | `engines: node >= 20` declarado | `package.json` |
| **Preflight** | `preflight.mjs` (**vai no bundle**) checa Node, Argon2 (+fallback bcrypt), `UPLOADS_DIR` gravável, MySQL, migrations, força do `SESSION_SECRET`, DNS do `WEB_ORIGIN`, rede para OpenAI e SMTP | script existente |
| **Variáveis** | validadas por Zod no boot — o app **não sobe** com config faltando | `apps/api/src/config.ts` |
| **Exemplos de `.env`** | `.env.example` e `.env.production.example`, sem segredos | PR #43 |
| **Cookie** | `httpOnly` · `signed` · `sameSite=lax` · **`secure` automático quando `NODE_ENV=production`** | `auth.router.ts` |
| **CORS** | restrito a `WEB_ORIGIN`, com `credentials: true` | `server.ts` |
| **Segurança HTTP** | Helmet + rate-limit global (300/min) + throttle de login (8/15min por IP+e-mail) | `server.ts`, `auth.service.ts` |
| **WebSocket** | ~~Socket.IO sem forçar transporte → cai para long-polling se o upgrade falhar~~ ATUALIZADO: a infra (LiteSpeed/lsnode) não suporta WebSocket; Socket.IO fica **desligado no build de produção** por decisão — tempo real é por **polling** (`refetchInterval`), religável com `VITE_REALTIME=1` (ADR-84) | `realtime/socket.ts` |
| **Migrations** | 53, aplicadas por `prisma migrate deploy` (nunca `migrate dev`) | `docs/DEPLOY.md` |
| **Uploads** | `UPLOADS_DIR` configurável, com default local | `config.ts` |
| **Seed** | cria ROOT + ADMIN + etapas do funil; idempotente, **nunca sobrescreve senha existente** | `packages/db/prisma/seed.ts` |
| **Trava de dados fictícios** | `db:demo` **recusa** rodar com `NODE_ENV=production` ou banco remoto | `seed-guard.ts` + teste |
| **Logs de erro** | `ErrorLog` + incidentes no painel Sistema (só ROOT) | `/sistema` |
| **Diagnóstico** | `pnpm doutor` (saúde da app, aceita `--url`) · `pnpm acessos` (login) | validados localmente |
| **Backup antes de apagar** | `pnpm db:limpar` faz `mysqldump` automático | validado |

---

## 2. O que precisa ser configurado NA TINEHOST

| # | Item | Por quê |
|---|---|---|
| 1 | **Node ≥ 20** no Node.js Selector | `engines` exige. **Se não houver, o plano muda** — confirme antes de tudo |
| 2 | **Banco MySQL/MariaDB** + usuário com permissão só nele | least privilege |
| 3 | **Pasta de uploads FORA do Application Root** (ex.: `/home/USUARIO/uploads`) | o rsync sobrescreve o diretório do deploy e levaria os arquivos junto |
| 4 | **SSL** no subdomínio | sem HTTPS o cookie `secure` não volta e **ninguém loga** |
| 5 | **WebSocket liberado** no proxy | se não, o tempo real cai para polling (funciona, mas consome mais) |
| 6 | **Rede de saída** para `api.openai.com:443` e o SMTP | IA e e-mail dependem |
| 7 | **Backup do MySQL** (rotina do painel ou cron) | ~~não existe hoje~~ IMPLEMENTADO: cron diário 03:00 (`scripts/server/backup-db.sh`), ADR-86 |

---

## 3. O que precisa ser criado no DirectAdmin

- [ ] Subdomínio `homolog.medconsultoria.com.br` **+ certificado SSL**
- [ ] Aplicação Node (CloudLinux Node.js Selector) apontando para esse subdomínio
  - **Application startup file: `app.cjs`** ← não `server.js`
  - Application root: a pasta onde o bundle será enviado
- [ ] Banco MySQL + usuário exclusivos de homologação
- [ ] Pasta `~/uploads-homolog/` (fora do Application Root)
- [ ] Chave SSH para o rsync do `deploy.sh` (se ainda não houver)
- [ ] `.env` na raiz do Application Root, a partir de `.env.production.example`

---

## 4. O que depende de VOCÊ (Thiago)

**Antes de qualquer coisa:**
- [ ] 🔴 **Rotacionar a chave da OpenAI e a senha do SMTP** — foram expostas em 21/07
- [ ] Confirmar a **versão do Node** disponível no painel
- [ ] Criar os itens da §3 e me passar: endereço, caminho do Application Root, caminho da pasta de uploads

**Durante:**
- [ ] Preencher o `.env` no servidor (só você — eu não toco em credenciais)
- [ ] Rodar `node preflight.mjs` **no servidor** e me mandar a saída
- [ ] Executar o deploy (eu não conecto ao servidor)

**Decisões:**
- [ ] Política de backup (frequência e retenção)
- [ ] Monitor externo de uptime — hoje **não existe**: se o app cair, ninguém é avisado

---

## 5. O que depende da THAÍS

Nada bloqueia o deploy **técnico** de homologação. Bloqueiam o **uso comercial**:

- [ ] 🔴 **Razão social, CNPJ, endereço e foro** — sem eles o contrato imprime `[A PREENCHER: CNPJ]`
- [ ] Equipe real (quem entra e com qual papel)
- [ ] Tabela de preços dos serviços
- [ ] Operadoras e hospitais reais
- [ ] Revisão dos textos dos modelos de documento e dos e-mails automáticos

> Dá para homologar sem isso. **Não dá para assinar contrato com cliente sem isso.**

---

## 6. Riscos

| # | Risco | Grav. | Mitigação |
|---|---|---|---|
| R1 | **Node < 20 no servidor** | 🔴 | Confirmar ANTES. Sem saída simples — Argon2 e o build exigem |
| R2 | **WebSocket bloqueado pelo Passenger** | 🟠 | ~~Já mitigado: Socket.IO não força transporte e cai para long-polling. Validar na §8~~ ATUALIZADO: hospedagem é LiteSpeed/lsnode (não Passenger); WebSocket confirmado **não suportado**; Socket.IO desligado no build de prod, tempo real por polling (ADR-84) |
| R3 | **Uploads dentro do Application Root** | 🔴 | `UPLOADS_DIR` fora dele. **Testar com um restart**, não só com um upload |
| R4 | **Sem HTTPS → ninguém loga** | 🔴 | `secure: isProd`. SSL é pré-requisito, não item de polimento |
| R5 | **`WEB_ORIGIN` divergente do domínio** | 🔴 | Quebra CORS e cookie. Tem de bater **exatamente**, com `https://` |
| R6 | **Migrations em banco com dados** | 🟠 | `migrate deploy` é aditivo; **dump antes de cada deploy** |
| R7 | **Credenciais expostas em 21/07** | 🔴 | Rotacionar antes de subir |
| R8 | **Sem backup** | 🟠 | Definir rotina + **testar a restauração** (backup não testado não é backup) |
| R9 | **Sem monitoramento externo** | 🟡 | O painel Sistema é interno: não avisa se o app cair |
| R10 | **Argon2 nativo pode não compilar** | 🟡 | Há fallback bcrypt; o preflight detecta |
| R11 | **Limite de conexões do MySQL compartilhado** | 🟡 | Pool do Prisma; monitorar a aba Banco do painel |
| R12 | **Bundle > 500 kB sem divisão** | 🟡 | Aceitável em rede boa; piora no 3G |
| R13 | **Throttle de login em memória** | 🟡 | Zera a cada restart; ok com 1 processo |

---

## 7. Plano de homologação

**Fase 0 — pré-requisitos:** rotacionar credenciais · confirmar Node ≥ 20 · criar §3.
**Fase 1 — subir:** `pnpm build:deploy` → enviar `apps/api/dist/` → `.env` → `npm ci --omit=dev` → `npx prisma migrate deploy` → `node prisma/seed.js` → **`node preflight.mjs`** (não siga se falhar).
**Fase 2 — dados de teste:** criar **pela interface** 1 cliente, 1 lead, 1 projeto, 1 conta e 1 documento. **Não importar base real** (LGPD).
**Fase 3 — validar:** §9 e §10.
**Fase 4 — promover:** só com a §10 inteira marcada.

---

## 8. Plano de rollback

**O deploy é reversível.** Antes de cada publicação:

1. **Guardar o bundle anterior** — `cp -r ~/app ~/app.bak-AAAAMMDD`
2. **Dump do banco** — `mysqldump -u USER -p BANCO > ~/backup-AAAAMMDD.sql`

**Se der errado:**
- App não sobe / erro 500 → restaurar `~/app.bak-*` e reiniciar pelo painel
- Migration quebrou o banco → restaurar o dump **e** o bundle anterior (schema e código andam juntos)
- Só uma tela quebrada → não faça rollback: registre e corrija pelo fluxo normal

> **Migration nunca volta sozinha.** Voltar o código sem voltar o banco deixa o app com schema à frente. Restaure os dois.

---

## 9. Checklist de DEPLOY

**Antes**
- [ ] Credenciais rotacionadas · [ ] CI verde na main · [ ] `pnpm build:deploy` sem erro
- [ ] Dump do banco · [ ] Cópia do bundle anterior

**Durante**
- [ ] Bundle enviado · [ ] `.env` conferido (`WEB_ORIGIN` com `https://` e domínio exato)
- [ ] `npm ci --omit=dev` · [ ] `prisma migrate deploy` · [ ] seed (só no 1º)
- [ ] **`node preflight.mjs` — TUDO ok** (se falhar, pare)
- [ ] App reiniciado pelo painel

**Logo depois**
- [ ] `https://…/health` responde · [ ] tela de login abre · [ ] login entra
- [ ] aba **Erros** do painel Sistema vazia

---

## 10. Checklist de VALIDAÇÃO (pós-deploy)

**Automático**
```
pnpm doutor --url https://homolog.medconsultoria.com.br
pnpm doutor --url https://homolog.medconsultoria.com.br --perfil admin
```
- [ ] **zero achados** (15 rotas × 8 tamanhos de tela)

**Manual — o que o doutor não vê e só o servidor revela**
- [ ] **Login sobrevive a refresh** (cookie `secure` sob HTTPS) 🔴
- [ ] **Tempo real**: Mensagens em duas abas, mensagem chega sozinha 🟠 *(~~maior risco~~
      ATUALIZADO: WebSocket não suportado pela hospedagem; tempo real é por polling, ADR-84)*
- [ ] **Upload sobrevive a restart**: anexar → **reiniciar pelo painel** → arquivo continua lá 🔴
- [ ] **Download** do arquivo anexado
- [ ] **PDF**: abrir documento e salvar em PDF
- [ ] **Celular de verdade**, não emulador
- [ ] **Portal do Cliente**: enviar acesso e entrar como cliente
- [ ] **RBAC**: com ADMIN, `/sistema` → "Acesso restrito"
- [ ] **E-mail**: com SMTP vazio, o convite aparece na tela e **nada é enviado**
- [ ] Painel **Sistema → Banco** conectado; **Erros** vazia após um dia de uso

**Promover para produção só com tudo acima + os dados jurídicos da §5.**

---

## 11. Lacunas conhecidas (declaradas, não resolvidas)

1. ~~**Nada disto foi executado num servidor.** Toda a validação foi local.~~ ATUALIZADO
   2026-07-26: executado — app em produção.
2. ~~**Sem backup automatizado** — só o dump manual do `db:limpar`.~~ ATUALIZADO: implementado
   (cron diário, ADR-86).
3. **Sem monitoramento externo.**
4. **Script de atualização** não existe como comando único: hoje é `build:deploy` + `deploy.sh` + migrate + restart, manual. Vale automatizar **depois** do 1º deploy bem-sucedido — automatizar um processo nunca executado é otimizar no escuro.
5. **`pnpm doutor` não roda no CI** contra um app subido.
