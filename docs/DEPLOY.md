# DEPLOY.md — Publicar em produção (TineHost / DirectAdmin)

Guia para colocar o Workspace no ar em **https://workspace.medconsultoria.com.br**.
O app é **um único processo Node** (`server.js`) que serve, na mesma porta: a API tRPC, o WebSocket (Socket.IO) e o site (SPA) já buildado. O deploy envia um **artefato auto-contido** por SSH (a TineHost tem SSH, mas não Git).

> ✅ Este é o **pipeline real de produção**, já validado: homologação e produção foram concluídas — o app está **no ar** em `https://workspace.medconsultoria.com.br`.
>
> Passo a passo de homologação (referência histórica): **[`HOMOLOGACAO.md`](./HOMOLOGACAO.md)**. Este documento continua sendo a
> referência técnica (DirectAdmin, LiteSpeed/lsnode, rsync); a homologação só muda os endereços e o `.env`.

---

## 1. O que preciso que você busque na TineHost (uma vez)

No painel DirectAdmin da TineHost (ou com o suporte deles), reúna:

**Acesso SSH**
- [ ] **Host** SSH (ex.: `ssh.seudominio.com.br` ou um IP).
- [ ] **Usuário** do DirectAdmin.
- [ ] **Porta** SSH (geralmente 22; a TineHost às vezes usa outra).
- [ ] Preferir **chave SSH** (mais seguro que senha). Se não tiver, eu te ajudo a gerar uma e cadastrar.

**Banco de dados MySQL (de produção)**
- [ ] Criar um **banco** e um **usuário** MySQL no painel (ex.: banco `medconsult_prod`, usuário `medconsult_app`).
- [ ] Anotar **host** (normalmente `localhost`), **porta** (3306), **nome do banco**, **usuário** e **senha**.
- [ ] Isso vira a `DATABASE_URL` de produção (ver §3).

**Node / hospedagem**
- [ ] Qual **versão do Node** a TineHost oferece? Precisa ser **≥ 20**.
- [x] O painel usa **LiteSpeed/lsnode** para apps Node (confirmado — não é Passenger nem Nginx Unit).
- [ ] O caminho da pasta do app (algo como `/home/SEU_USUARIO/domains/workspace.medconsultoria.com.br/app`).
- [ ] A rede de saída (outbound) está liberada? (necessário só se for usar a **IA/OpenAI** em produção.)

Assim que você me mandar isso (ou preencher você mesmo), o resto é quase automático.

---

## 2. Configurar o `.env.deploy` (na sua máquina — NÃO commitado)

Copie `.env.deploy.example` para `.env.deploy` e preencha com os dados de SSH (não segredos do banco):

```bash
DEPLOY_HOST="ssh.seudominio.com.br"
DEPLOY_USER="seu-usuario"
DEPLOY_PATH="/home/seu-usuario/domains/workspace.medconsultoria.com.br/app"
DEPLOY_SSH_PORT="22"
DEPLOY_SSH_KEY="C:/Users/Desktop/.ssh/id_ed25519"
# Se a TineHost usar Nginx Unit (não Passenger), defina o restart adequado:
# DEPLOY_RESTART_CMD="..."
```

---

## 3. Configurar o `.env` de **produção** (no servidor)

Este arquivo fica **no servidor**, na pasta do app (ao lado do `server.js`) — o app já procura o `.env` ali. Nunca vai para o git. Conteúdo:

```bash
NODE_ENV="production"
API_PORT="3000"                 # a porta que o Passenger/Unit espera (confirmar no painel)
DATABASE_URL="mysql://USUARIO:SENHA@localhost:3306/BANCO"
SESSION_SECRET="<gere um aleatório de 32+ bytes>"   # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
WEB_ORIGIN="https://workspace.medconsultoria.com.br"
# Opcional — liga a IA (assistente de busca + geração de documentos):
# OPENAI_API_KEY="sk-..."
```

> **SESSION_SECRET** deve ser forte e único (não reutilize o de dev). **Nunca** comite este arquivo.

---

## 4. Configurar o app Node no painel DirectAdmin

- **Startup file / arquivo de entrada:** `server.js` (dentro de `DEPLOY_PATH`).
- **App root:** a pasta `DEPLOY_PATH`.
- **Node version:** ≥ 20.
- **Domínio:** `workspace.medconsultoria.com.br` com **SSL/HTTPS** (Let's Encrypt do próprio painel).

---

## 5. Deploy

O script `deploy.sh` faz tudo: build + bundle auto-contido + rsync + instalar deps + gerar Prisma + migrations + restart.

```bash
./deploy.sh
```

O que ele executa:
1. `pnpm build:deploy` → gera `apps/api/dist/` com **`server.js` + `public/` (o SPA) + `prisma/` + `package.json` de produção**.
2. `rsync` desse `dist/` para o servidor (preserva o `.env` de produção que já está lá).
3. No servidor: `npm install --omit=dev` → `npm run prisma:generate` → `npm run prisma:deploy` (migrations) → **restart**.

> **1º deploy:** garanta antes que o **`.env` de produção já existe no servidor** (§3) e que o **banco foi criado** (§1). Sem isso, as migrations falham.

---

## 6. Smoke test (validar que subiu)

- [ ] `https://workspace.medconsultoria.com.br/health` → `{"status":"ok"}`.
- [ ] Abrir o site → tela de **login**.
- [ ] Criar/rodar o **seed do 1º ROOT** (uma vez): no servidor, `npm run prisma:generate` já roda; para o usuário inicial use um seed ou crie direto (posso te passar o comando). Depois, **login** e navegar por uma tela autenticada.

---

## 7. Riscos a validar no 1º deploy (e planos B)

| Item | Risco | Plano B |
|------|-------|---------|
| **`@node-rs/argon2` (nativo)** | Hash de senha usa binário nativo; hospedagem compartilhada pode não ter binário compatível (glibc/plataforma). | Trocar por `argon2` (WASM) ou `@node-rs/bcrypt`; ou pré-compilar. **Testar login logo no 1º deploy.** |
| **Versão do Node** | Precisa ≥ 20. | Pedir upgrade à TineHost ou usar o selector de versão do painel. |
| ~~**Passenger vs Nginx Unit**~~ | **RESOLVIDO:** confirmado **LiteSpeed/lsnode**. WebSocket não é suportado pelo proxy → tempo real por polling (ADR-84). | — |
| **CSP do Helmet** | Hoje `contentSecurityPolicy: false` (para não quebrar o SPA). | Ligar e afinar `script-src` testando o SPA buildado (o Vite injeta um pequeno script de módulo). |
| **Pool do MySQL** | Limite de conexões do plano. | Ajustar `connection_limit` na `DATABASE_URL` do Prisma. |
| **Rede outbound (OpenAI)** | Pode estar bloqueada. | Só afeta a IA; sem a chave, o app funciona igual. |
| **PDF de documentos** | — | Já é client-side (`window.print`/blob), **sem** puppeteer. Sem risco. |

---

## 8. Backup & rollback

- **Backup do MySQL:** agende um dump periódico (`mysqldump`) no painel ou via cron. Guardar fora do servidor.
- **Rollback de código:** mantenha o `apps/api/dist` anterior (o `rsync --delete` substitui; se quiser rollback fácil, versione os artefatos em pastas `releases/<data>` e aponte um symlink — posso adaptar o `deploy.sh` para isso quando formos publicar).

---

## 9. Resumo do fluxo

```
[sua máquina]  pnpm build:deploy → apps/api/dist (server.js + public + prisma + package.json)
                     │ rsync (SSH)
                     ▼
[TineHost]     npm install --omit=dev → prisma generate → migrate deploy → restart
                     ▼
            https://workspace.medconsultoria.com.br  (1 processo: API + WS + SPA)
```

> Restart ajustado para LiteSpeed/lsnode (`touch tmp/restart.txt`); deploy já conduzido, com smoke test e login validados.

---

## 10. Preflight de produção (rodar no servidor ANTES de publicar)

A app **não é considerada compatível com a TineHost até o preflight passar** (ver decisão #3/#4/#22 da finalização). Depois de subir o bundle e rodar `npm install --omit=dev`, execute na pasta do app:

```bash
node scripts/preflight.mjs        # ou: node preflight.mjs (se copiado para a raiz do bundle)
```

Ele verifica, com base na stack real (exit ≠ 0 se alguma verificação **CRÍTICA** falhar):

| Verificação | Nível | O que garante |
|---|---|---|
| Node ≥ 20 | crítico | versão suportada |
| **Argon2id (hash+verify)** | crítico | o binário nativo `@node-rs/argon2` roda na hospedagem — **se falhar, o login não funciona** |
| Plano B `bcryptjs` | aviso | fallback portátil disponível |
| **UPLOADS_DIR** | crítico | caminho **absoluto** em produção + escrita/leitura reais |
| **Conexão MySQL** (Prisma) | crítico | `DATABASE_URL` válida |
| **Migrations aplicadas** | crítico | `_prisma_migrations` populada (rode `prisma migrate deploy` se divergir) |
| Env obrigatórias + `SESSION_SECRET` forte | crítico | segredo ≥ 16 chars |
| `NODE_ENV=production` | aviso | cookies `secure`, e-mail/CSP reais |
| DNS de `WEB_ORIGIN`, rede OpenAI/SMTP | aviso | outbound liberado onde necessário |
| ~~WebSocket (Socket.IO)~~ | obsoleto | WS indisponível na hospedagem (LiteSpeed/lsnode não faz upgrade); tempo real por **polling** (ADR-84) |

Se o Argon2 nativo falhar no plano de hospedagem: a app tem **Plano B portátil (`bcryptjs`)** — a abstração `apps/api/src/lib/password.ts` identifica o algoritmo pelo prefixo do hash, então argon2 e bcrypt coexistem; no login bem-sucedido, hashes legados são **reescritos (rehash)** para Argon2id quando ele estiver disponível.

## 11. Uploads persistentes (obrigatório configurar)

`UPLOADS_DIR` **deve** apontar para uma pasta **fora** do diretório do deploy (o `rsync --delete` apaga tudo que está no destino). Em produção deve ser **caminho absoluto** — o boot da API valida isso e **recusa subir** se for relativo ou sem permissão de escrita (`validarPastaUploads` em `apps/api/src/lib/storage.ts`).

- Exemplo (ajustar ao caminho real da TineHost): `UPLOADS_DIR="/home/SEU_USUARIO/uploads-medconsultoria"` — **[PREENCHER com o caminho real do servidor]**.
- **Backup:** incluir essa pasta no backup periódico (junto com o dump do MySQL).
- **Restauração:** restaurar a pasta no mesmo caminho antes de subir a app; os registros no banco (`Arquivo.caminho`) são relativos a `UPLOADS_DIR`.
- Os arquivos **sobrevivem a restart e redeploy** porque ficam fora do diretório substituído pelo rsync.

---

## 12. Guia passo a passo — CloudLinux Node.js Selector + LiteSpeed/lsnode (infra CONFIRMADA)

> Ambiente **testado diretamente na TineHost** (probe Node + LiteSpeed/lsnode + Argon2, todos OK). **WebSocket NÃO é suportado** por essa infra — o tempo real de produção é **polling** (ADR-84). Este guia usa os valores reais confirmados. Onde aparecer **[CONFIRMAR]**, verifique no painel na hora.

**Valores confirmados**
| Item | Valor |
|---|---|
| Sistema | Linux EL8 x86_64 (CloudLinux) |
| HOME | `/home3/medconsultoria` |
| Application Root | `/home3/medconsultoria/workspace-medconsultoria` |
| Diretório do domínio | `/home3/medconsultoria/domains/workspace.medconsultoria.com.br` |
| public_html | `/home3/medconsultoria/domains/workspace.medconsultoria.com.br/public_html` |
| Uploads persistentes | `/home3/medconsultoria/app-data/workspace-medconsultoria/uploads` |
| Node | **20.19.2** · npm 10.8.2 |
| Banco | **MariaDB 10.6.22** em `localhost` |
| Modo | **Production** · LiteSpeed/lsnode · startup `app.cjs` |
| Domínio | `https://workspace.medconsultoria.com.br` |
| Repositório | `https://github.com/thi-garcia/workspace-medconsultoria` (privado) |

### Passo 1 — Subdomínio + SSL (DirectAdmin)
1. Em **Domain Setup**, garanta que `workspace.medconsultoria.com.br` existe e aponta para a conta.
2. Em **SSL Certificates**, emita **Let's Encrypt** para o subdomínio (Force HTTPS ligado).
3. **Remova/renomeie** o `index.html` padrão em `public_html` (senão ele intercepta o domínio e o lsnode não assume). Ex.: `mv public_html/index.html public_html/_index.html.bak`.

### Passo 2 — Criar a aplicação Node (CloudLinux Node.js Selector)
No painel **Setup Node.js App** → **Create Application**:
- **Node.js version:** `20.19.2`.
- **Application mode:** `Production`.
- **Application root:** `workspace-medconsultoria` (relativo ao HOME → `/home3/medconsultoria/workspace-medconsultoria`).
- **Application URL:** `workspace.medconsultoria.com.br` (raiz do domínio).
- **Application startup file:** `app.cjs` (shim CommonJS gerado pelo `bundle-deploy` que carrega o servidor ESM por import dinâmico — ver Passo 4).
- Criar. O painel gera um **virtualenv** e o registro do proxy (LiteSpeed/lsnode) em `public_html/.htaccess`. Anote o comando **"Enter to the virtual environment"** (`source /home3/medconsultoria/nodevenv/.../bin/activate`) para instalar deps com o Node certo.

### Passo 3 — Pasta persistente de uploads
```bash
mkdir -p /home3/medconsultoria/app-data/workspace-medconsultoria/uploads
```
Fica **fora** do Application Root e do `public_html` → o deploy (`rsync --delete`) não a toca. No `.env` de produção: `UPLOADS_DIR=/home3/medconsultoria/app-data/workspace-medconsultoria/uploads`.

### Passo 4 — Enviar o build + startup
1. Na sua máquina: `pnpm build:deploy` (gera `apps/api/dist` auto-contido: `server.js` + `public/` + `prisma/` + `package.json` de produção + `preflight.mjs`).
2. Ajuste o `deploy.sh` (`.env.deploy`): `DEPLOY_PATH=/home3/medconsultoria/workspace-medconsultoria`, host/usuário/porta/chave SSH **[CONFIRMAR]**.
3. `./deploy.sh` faz: `rsync` do `dist/` → Application Root; via SSH, `npm install --omit=dev`, `prisma generate`, `prisma migrate deploy`, restart.
4. **Startup `app.cjs`** (gerado automaticamente pelo `bundle-deploy`, fica na raiz do Application Root ao lado de `server.js`): o lsnode carrega o startup via `require()` (CommonJS), então usar `.cjs` que faz `import("./server.js")` evita o `ERR_REQUIRE_ESM` (o `server.js` é ESM). **Validado localmente**: `node app.cjs` sobe a API e responde `/health`. O lsnode **intercepta o `.listen()`** do Fastify e gerencia a porta/socket — por isso `API_PORT` é ignorado sob lsnode (não precisa casar com a porta do painel).

### Passo 5 — Variáveis de ambiente (`.env` na raiz do Application Root)
```
NODE_ENV=production
# API_PORT: ignorado sob LiteSpeed/lsnode (ele gerencia a porta). Deixe o default ou omita.
DATABASE_URL=mysql://USUARIO:SENHA@localhost:3306/BANCO   # MariaDB local [CONFIRMAR user/senha/banco]
SESSION_SECRET=<gerar 32+ bytes: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
WEB_ORIGIN=https://workspace.medconsultoria.com.br
UPLOADS_DIR=/home3/medconsultoria/app-data/workspace-medconsultoria/uploads
# Opcionais (a IA/e-mail ligam se preenchidos):
OPENAI_API_KEY=...        # rotacionar antes de usar
SMTP_HOST=... SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... SMTP_FROM=...
```
> O `.env` **nunca** é versionado nem sobrescrito pelo deploy (`rsync --exclude .env`).

### Passo 6 — Banco (MariaDB 10.6) + migrations + seed do ROOT
1. Em **MySQL Management**, crie o banco + usuário e conceda permissão. Monte a `DATABASE_URL` com `@localhost:3306`.
2. As **migrations** rodam no deploy (`prisma migrate deploy`). Para rodar à mão: dentro do virtualenv, `npx prisma migrate deploy`.
3. **Seed do 1º ROOT:** com `SEED_ROOT_EMAIL/PASSWORD/NOME` no `.env`, rode `node prisma/seed.js` (ou `npx prisma db seed` se configurado). **Não** rode o `demo-seed` (dados fictícios) em produção.

### Passo 7 — Preflight (OBRIGATÓRIO antes de considerar publicado)
Dentro do Application Root, no virtualenv:
```bash
node preflight.mjs
```
Só siga se **todas as verificações CRÍTICAS** passarem (Argon2, MySQL, migrations, UPLOADS_DIR absoluto+gravável, SESSION_SECRET). Ver §10.

### Passo 8 — Restart, logs, WebSocket
- **Restart:** botão **Restart** no Node Selector, ou `touch tmp/restart.txt` no Application Root (lsnode/LiteSpeed relê).
- **Logs:** `stderr.log`/`stdout.log` do lsnode (no painel ou em `~/logs`), + o `ErrorLog` no painel **Sistema** da app (ROOT).
- **WebSocket:** **NÃO suportado** na TineHost — LiteSpeed/lsnode não faz upgrade de WS. O tempo real de produção é **polling** (ADR-84); religa o Socket.IO em prod com `VITE_REALTIME=1` se algum dia a hospedagem passar a suportar upgrade.

### Passo 9 — Atualização de versão (deploys futuros)
`pnpm build:deploy` → `./deploy.sh` (rsync + migrate + restart). O `.env` e a pasta de uploads são preservados.

### Passo 10 — Backup e rollback

**Backup automático (implementado 26/07):** scripts em `scripts/server/`, instalados no servidor em `~/domains/workspace.medconsultoria.com.br/ops/` e agendados no cron do usuário:
- `backup-db.sh` — **diário 03:00 BRT**: `mysqldump --single-transaction` + gzip → `../backups/auto-db-<TS>.sql.gz`, **retém os 14 mais recentes** (rotação automática). Log em `../backups/backup.log`.
- `healthcheck.sh` — **a cada 5 min**: `curl /health`; se cair (2 tentativas), dispara `touch tmp/restart.txt` (auto-restart do lsnode) e loga em `../backups/health.log`.
- `install-cron.sh` — instalador **idempotente** (preserva crons existentes; roda uma vez).
- **Reinstalar** (após recriar o ambiente): reenviar `scripts/server/*.sh` para `ops/`, `chmod +x`, rodar `install-cron.sh`.
- ⚠️ **Falta cobrir:** os backups ficam **no mesmo servidor** (protegem contra erro lógico/DROP, não contra perda do host) e a pasta `uploads/` ainda não entra no backup automático. **Recomendação ao dono:** (a) baixar os dumps para fora do servidor periodicamente (ou storage externo) e (b) um **monitor de uptime externo** (ex.: UptimeRobot, grátis) — o `healthcheck` interno não alerta se o servidor inteiro cair.

**Rollback:** o deploy tira **snapshot do release** (`../backups/release-pre-<TS>.tar.gz`, sem `node_modules`) e **dump do banco** antes de migrar. Para reverter: extrair o snapshot sobre `public_html` e restaurar o dump.

**Restauração:** `gunzip < auto-db-<TS>.sql.gz | mysql <db>` + restaurar `uploads/` no mesmo caminho.
