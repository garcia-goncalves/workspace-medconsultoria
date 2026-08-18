# DEPLOY.md — Publicar em produção (TineHost / DirectAdmin)

Guia para colocar o Workspace no ar em **https://workspace.medconsultoria.com.br**.
O app é **um único processo Node** (`server.js`) que serve, na mesma porta: a API tRPC, o WebSocket (Socket.IO) e o site (SPA) já buildado. O deploy envia um **artefato auto-contido** por SSH (a TineHost tem SSH, mas não Git).

> ✅ Este é o **pipeline real de produção**, já validado: homologação e produção foram concluídas — o app está **no ar** em `https://workspace.medconsultoria.com.br`.
>
> Passo a passo de homologação (referência histórica): **[`HOMOLOGACAO.md`](./HOMOLOGACAO.md)**. Este documento continua sendo a
> referência técnica (DirectAdmin, LiteSpeed/lsnode, rsync); a homologação só muda os endereços e o `.env`.

---

## 0. Como se publica HOJE — o botão no GitHub (desde 17/08/2026)

**O deploy não sai mais do computador de ninguém.** Ele roda no GitHub, pelo arquivo
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), que faz exatamente a mesma
sequência de 6 passos descrita neste documento.

**Por que mudou:** a chave SSH precisava morar no disco de quem publicava, e o classificador
de segurança do assistente barrava o comando de forma imprevisível — em 17/08/2026 ele barrou
uma correção já pronta, testada e com CI verde. Agora a chave mora em *GitHub Secrets*, e
publicar é apertar um botão.

### Como publicar (o jeito do dono, sem terminal)

1. Abra **https://github.com/thi-garcia/workspace-medconsultoria/actions/workflows/deploy.yml**
2. Botão **"Run workflow"**, no canto direito.
3. No campo que aparece, digite **`PUBLICAR`** (em maiúsculas) e confirme.
4. **Deu certo quando** o último passo, *"Smoke test"*, terminar em verde mostrando
   `{"status":"ok"}` e `NO AR: https://workspace.medconsultoria.com.br`.
5. **Deu errado?** O passo que falhou fica vermelho e diz o motivo. Se falhou no
   *"Ensaio de boot"*, **a produção não foi tocada** — ela continua servindo a versão
   anterior, e não há nada de urgente a fazer.

Pelo terminal, o equivalente é `gh workflow run deploy.yml -f confirmar=PUBLICAR`.

### Os três segredos (uma vez por projeto, só o dono faz)

O valor nunca passa pela conversa nem pelo repositório — o terminal pede sem exibir na tela:

```
gh secret set DEPLOY_HOST      # o endereço SSH do servidor
gh secret set DEPLOY_USER      # o usuário do DirectAdmin
gh secret set DEPLOY_SSH_KEY < caminho/da/chave/privada
```

A chave privada é a mesma que já funcionava (`~/.ssh/medconsultoria_deploy`). O caminho do
app e a porta 1992 **não** são segredo e ficam escritos no próprio workflow.

**Os três já estão postos** (17/08/2026). Confira com `gh secret list`.

### Trocar a chave do servidor — o workflow "Rotacionar chave de deploy" (ADR-114)

Chave de servidor se troca quando vaza, quando alguém sai da equipe, ou de tempos em tempos
por higiene. **Gerar uma chave nova não revoga a antiga**: quem revoga é apagar a linha dela
do arquivo de chaves autorizadas do servidor. É o passo que mais se esquece, e é o único que
importa.

A troca **não se faz do laptop** (§0.9 do CLAUDE.md global). Roda no GitHub, pelo mesmo
motivo do deploy — e por um a mais: o runner já tem a chave antiga funcionando, então ele se
autoriza sozinho, sem ninguém abrir SSH à mão.

> **Já foi feita uma vez, em 18/08/2026** (ADR-114): a chave exposta em 17/08 foi revogada e
> substituída pela `deploy-workspace-med-2026-08-18`. O roteiro abaixo é para a **próxima**.

> ⚠️ **O terminal do dono é o PowerShell, não o bash.** O operador `<` (mandar arquivo para
> dentro de um comando) **não existe** no PowerShell — ele responde
> `The '<' operator is reserved for future use`. Use sempre a coluna PowerShell.

**Passo 1 — gerar o par.** O `-N ""` diz "sem senha de chave", e é obrigatório: o runner não
tem como digitar senha, e uma chave protegida travaria o workflow esperando. O comentário
(`-C`) é livre e não influencia nada — a revogação casa pelo **conteúdo** da chave, nunca pelo
apelido.

PowerShell (o terminal do VS Code):

```powershell
ssh-keygen -t ed25519 -C "deploy-workspace-med" -f "$HOME\.ssh\med_deploy_3" -N '""'
Get-Content "$HOME\.ssh\med_deploy_3" -Raw | gh secret set DEPLOY_SSH_KEY_NOVA
```

Git Bash / Linux / macOS, se for o caso:

```bash
ssh-keygen -t ed25519 -C "deploy-workspace-med" -f ~/.ssh/med_deploy_3 -N ""
gh secret set DEPLOY_SSH_KEY_NOVA < ~/.ssh/med_deploy_3
```

**Passo 2 — Actions → "Rotacionar chave de deploy" → Run workflow**, digitando `ROTACIONAR`.
Não há mais nada a preencher: o workflow descobre sozinho qual linha remover, derivando a
identidade da chave antiga do próprio segredo `DEPLOY_SSH_KEY`.

**Passo 3 — promover a nova a oficial. Entre a revogação e este comando o Deploy está
quebrado** (ele ainda aponta para a chave que acabou de ser revogada), então não publique
nesse intervalo:

```powershell
Get-Content "$HOME\.ssh\med_deploy_3" -Raw | gh secret set DEPLOY_SSH_KEY
gh secret delete DEPLOY_SSH_KEY_NOVA
```

**Passo 4 — rodar o Deploy.** É a prova de ponta a ponta: publicou, logo a chave nova serve.

**A ordem dentro do workflow é deliberada:** autoriza a nova → prova que a nova entra → remove
a velha → prova que a nova **continua** entrando e que a velha é **recusada**. Falhou antes da
remoção, o acesso antigo continua intacto e é só rodar de novo. O caminho contrário tranca
todo mundo do lado de fora se a chave nova tiver qualquer defeito. O arquivo de chaves do
servidor é copiado antes de ser editado (`~/.ssh/authorized_keys.bak-<carimbo>`, no servidor).

**Por que só um segredo, e nenhum campo para digitar:** a revisão de segurança da ADR-114
mostrou que as duas comodidades que existiam ali — informar o comentário da chave a revogar e
mandar a pública num segredo separado — eram justamente os dois caminhos para desastre. A
pública é derivada da privada dentro do workflow, e a chave a revogar é identificada pelo
corpo dela. Não sobrou nada para o dono errar.

**Três recusas que parecem defeito e não são:** chave privada com senha (refaça com `-N ""`);
chave nova idêntica à antiga; ou o `authorized_keys` do servidor não bater com a conta
esperada (o workflow reprova em vez de gravar). Nenhuma delas mexe no servidor.

**E se o resultado for "INCONCLUSIVO"** no último passo: o acesso falhou, mas não por chave
recusada — quase sempre é a hospedagem cortando o IP do runner. **Não** considere revogada;
espere alguns minutos e rode de novo. O workflow foi feito para ser repetível.

### Duas armadilhas que a primeira publicação revelou (ADR-113)

As duas existiam havia meses e só apareceram num ambiente limpo. Se voltarem, é aqui que se olha:

1. **`ERR_MODULE_NOT_FOUND: 'esbuild'` no passo 1.** O `scripts/bundle-deploy.mjs` importa `esbuild`, que agora é **dependência declarada na raiz** (`0.27.7`). Se alguém a remover, o deploy morre no build — e no laptop continua "funcionando", porque lá sobra uma cópia solta no `node_modules`. Convivem quatro versões de esbuild na árvore: sem a declaração, qual delas monta o artefato de produção é sorte.
2. **`connect to host ... port 1992: Connection timed out` no meio do deploy.** A TineHost **corta conexões SSH repetidas** vindas de um IP desconhecido, e o runner do GitHub é sempre um IP novo. Por isso o workflow abre **uma só** conexão (`ControlMaster`, passo 2) e todos os passos a reaproveitam. **Não "resolva" isso encadeando comandos com `&&`** — a cicatriz do §5 continua valendo: o `prisma generate` derruba a cadeia e o deploy termina dizendo "concluído" com a produção rodando o código antigo.

### O que o workflow ganhou de brinde

**A armadilha dos dois deploys simultâneos morreu.** O `concurrency: deploy-producao` faz a
segunda execução **esperar** a primeira terminar. Não existe mais como colidir por impaciência
— era isso que produzia o ensaio de boot com `0` e a lista de erros vazia (§5).

### Rollback

Rodar o mesmo workflow apontando para o commit anterior:
`gh workflow run deploy.yml --ref <tag-ou-sha> -f confirmar=PUBLICAR`.
O snapshot em `~/backups/release-pre-<carimbo>.tar.gz` continua sendo tirado a cada
publicação, como sempre foi.

### E o `deploy.sh`?

**Continua no repositório de propósito**, com todas as cicatrizes comentadas. Ele é a
documentação executável da sequência e a saída de emergência se o GitHub estiver fora do ar.
Só não é mais o caminho normal.

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
DEPLOY_PATH="/home3/medconsultoria/domains/workspace.medconsultoria.com.br/public_html"
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
EMAIL_CRYPTO_KEY="<32 bytes em base64>"   # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Opcional — liga a IA (assistente de busca + geração de documentos):
# OPENAI_API_KEY="sk-..."
```

> **SESSION_SECRET** deve ser forte e único (não reutilize o de dev). **Nunca** comite este arquivo.
>
> **EMAIL_CRYPTO_KEY** (ADR-95) cifra a senha das caixas de e-mail que cada pessoa pluga em `/email` (AES-256-GCM). Gere **32 bytes em base64** com o comando acima. Duas consequências que precisam estar claras antes de o dono mexer: **(a) perder ou trocar a chave torna ilegível toda senha já guardada** — as caixas passam a pedir reconexão (é só replugar, nada mais se perde); **(b) a chave é de produção e não se reaproveita de dev.** Sem a variável, a página `/email` não pluga caixa nenhuma — o resto da aplicação segue normal.

---

## 4. Configurar o app Node no painel DirectAdmin

- **Startup file / arquivo de entrada:** `server.js` (dentro de `DEPLOY_PATH`).
- **App root:** a pasta `DEPLOY_PATH`.
- **Node version:** ≥ 20.
- **Domínio:** `workspace.medconsultoria.com.br` com **SSL/HTTPS** (Let's Encrypt do próprio painel).

---

## 5. Deploy

O script `deploy.sh` faz tudo: build + bundle auto-contido + **snapshot de rollback** + envio + deps + Prisma + migrations + **ensaio de boot** + restart + smoke test.

```bash
./deploy.sh
```

> ### ⛔ NUNCA rode dois `./deploy.sh` ao mesmo tempo (12/08/2026)
>
> O deploy passa de 2 minutos e **parece travado** — foi o que levou a colar o comando duas
> vezes. **Os dois falharam, sem nenhum defeito no código.** Eles se sabotam em três pontos:
> escrevem no **mesmo `/tmp/boot-teste.log`** do servidor, sobem `node app.cjs` na **mesma
> porta**, e rodam `prisma generate` sobre os **mesmos `node_modules`** (o segundo travou o
> Node ali). Uma execução limpa depois passou de primeira: `boot OK (16 portas ouvindo)`,
> restart, smoke `{"status":"ok"}`.
>
> **Como reconhecer o sintoma:** ensaio de boot reportando `0` com `--- erros ---` e **nada
> embaixo**. Lista de erros vazia = evidência apagada por concorrência, **não** app quebrado.
> Antes de culpar o código, confirme que só há um deploy rodando.
>
> **Qual snapshot restaurar, se precisar voltar:** o **PRIMEIRO** da rodada. Do segundo deploy
> em diante o snapshot já foi tirado *depois* de outro ter sobrescrito arquivos — restaurá-lo
> devolve um estado misturado.
>
> **Por que resolver no mesmo dia:** o passo 3 grava os arquivos novos **antes** do ensaio. Se
> o ensaio reprova, a produção segue no ar porque **não reinicia** — mas o disco já tem a
> versão nova, e o healthcheck automático (a cada 5 min) reiniciaria com ela.

O que ele executa:
1. `pnpm build:deploy` → gera `apps/api/dist/` com **`server.js` + `public/` (o SPA) + `prisma/` + `package.json` de produção**.
2. **Snapshot** do release atual em `~/backups/release-pre-<TS>.tar.gz` — é o rollback.
3. Envia o `dist/` por **`tar | ssh`** (o `.env` de produção fica intacto).
4. No servidor, **dentro do virtualenv**: `npm install --omit=dev` → `prisma:generate` → `prisma:deploy`.
5. **Ensaio de boot** (`node app.cjs` por 15 s) com a produção ainda no ar servindo a versão antiga. Não subiu? O script **para aqui** e não reinicia nada.
6. Restart + conferência da data do `tmp/restart.txt` + smoke test do `/health`.

> **Três armadilhas que custaram ~9 min de produção fora do ar em 05/08/2026, todas comentadas dentro do `deploy.sh` — leia antes de "simplificar" o script:**
>
> - **Não é `rsync`, é `tar`.** O `--delete` do rsync apagaria o **`.htaccess`** (que é o que faz o LiteSpeed servir o site) e o `cgi-bin`, porque nenhum dos dois vem no artefato. De quebra, o Git Bash do Windows não tem `rsync` instalado — o script antigo nunca teria rodado nessa máquina.
> - **`npm` não existe em sessão SSH não interativa.** Ele mora no virtualenv do CloudLinux (`source ~/nodevenv/.../20/bin/activate`). Sem isso o `npm install` falha com *command not found*, o servidor fica com **`server.js` novo e `node_modules` velho**, e o app morre no boot com `ERR_MODULE_NOT_FOUND` — foi exatamente assim que a produção caiu (faltava `imapflow`).
> - **Cada passo em uma conexão SSH própria.** Encadeado com `&&`, o `prisma generate` derruba o resto da cadeia: o deploy diz "concluído" e a aplicação segue rodando o código **antigo**.

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
                     │ snapshot do release atual (rollback)
                     │ tar | ssh   ← NÃO rsync (apagaria o .htaccess; e não existe no Git Bash)
                     ▼
[TineHost]     source nodevenv/…/activate → npm install --omit=dev → prisma generate
               → migrate deploy → ENSAIO DE BOOT → restart → smoke test
               (cada passo numa conexão SSH própria — o generate derruba a cadeia)
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
| Application Root | `/home3/medconsultoria/domains/workspace.medconsultoria.com.br/public_html` ⚠️ **corrigido em 05/08/2026** — esta tabela dizia `/home3/medconsultoria/workspace-medconsultoria`, pasta que **não existe** no servidor |
| Diretório do domínio | `/home3/medconsultoria/domains/workspace.medconsultoria.com.br` |
| public_html | `/home3/medconsultoria/domains/workspace.medconsultoria.com.br/public_html` |
| Uploads persistentes | `/home3/medconsultoria/app-data/workspace-medconsultoria/uploads` |
| Node | **20.19.2** · npm 10.8.2 — **só dentro do virtualenv**: `source ~/nodevenv/domains/workspace.medconsultoria.com.br/public_html/20/bin/activate`. Numa sessão SSH não interativa, `npm` é *command not found* |
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
2. Ajuste o `deploy.sh` (`.env.deploy`): **`DEPLOY_PATH="/home3/medconsultoria/domains/workspace.medconsultoria.com.br/public_html"`**, host/usuário/porta/chave SSH.
   > ⚠️ **Corrigido em 10/08/2026.** Esta linha dizia `/home3/medconsultoria/workspace-medconsultoria` — pasta que **não existe** no servidor —, e o `.env.deploy` da máquina de quem publica tinha esse valor. O deploy morria no passo 2 com `cd: No such file or directory`. É o mesmo erro que a tabela do §9 já tinha corrigido em 05/08; aqui ele sobreviveu.
3. `./deploy.sh` faz: `tar | ssh` do `dist/` → Application Root; via SSH, `npm install --omit=dev`, `prisma generate`, `prisma migrate deploy`, **ensaio de boot**, restart e smoke test.
   > ⚠️ **O ensaio de boot é um portão, e ele já reprovou boot perfeito** (10/08/2026). A avaliação usava `remoto … | tee | head -1 | grep -q`, e com `set -o pipefail` isso falha de duas formas: o `head -1` fecha o cano e mata `tee`/`ssh` com SIGPIPE; e o comando remoto herda o código do último `grep`, que sai 1 quando **não acha erro nenhum**. Resultado: quanto mais limpo o boot, mais certa a reprovação. Hoje a saída é capturada em variável e avaliada com `test` — se voltar a reprovar, o problema é real, não o portão.
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

**Rollback:** o `deploy.sh` tira **snapshot do release** (`../backups/release-pre-<TS>.tar.gz`, sem `node_modules`) **antes do rsync**. Para reverter: extrair o snapshot sobre o Application Root e reiniciar (`touch tmp/restart.txt`).

> **Correção de 05/08/2026:** até esta data este parágrafo descrevia um snapshot **e um dump do banco** que o script **nunca fez** — a promessa existia só aqui. O snapshot foi implementado; o **dump antes de migrar continua não existindo**, e o que protege o banco é o backup automático das 03:00. Antes de um deploy **com migration destrutiva**, tire o dump à mão (`ops/backup-db.sh`). Documentação que descreve salvaguarda inexistente é pior que documentação nenhuma: dá coragem para uma operação que não tem rede.

**Duas armadilhas do deploy que já morderam** (as duas estão comentadas dentro do `deploy.sh`, não as "simplifique"):

1. **O restart vai numa chamada SSH separada.** Encadeado com `&&` depois do `prisma generate`, ele **não roda**: o `generate` derruba o resto da cadeia neste servidor, o deploy termina dizendo "concluído" e a aplicação segue servindo o código **antigo**. Por isso o script confere a **data do `tmp/restart.txt`** depois — mandar reiniciar não é prova de que reiniciou.
2. **`curl` na produção exige `--compressed`.** Sem isso o LiteSpeed devolve o corpo comprimido e o smoke test mostra lixo binário em vez do JSON de `/health`.

**Restauração:** `gunzip < auto-db-<TS>.sql.gz | mysql <db>` + restaurar `uploads/` no mesmo caminho.
