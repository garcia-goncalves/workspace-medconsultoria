# Operação da produção na VPS OVH — o que foi preparado e o que o dono aplica

> Escrito em 24/09/2026 (Onda 1, agente W6), **sem acesso à VPS**. Tudo aqui foi PREPARADO e
> ensaiado fora dela; nada foi aplicado em produção. O checklist da seção 2 é a ordem certa de
> aplicar — cada passo tem o comando pronto e como conferir que deu certo.
>
> Contexto: `docs/MIGRACAO_OVH.md` (a migração, ADR-154), `docs/DEPLOY.md`, `.github/workflows/deploy-ovh.yml`.

---

## 1. O que foi preparado

| # | O quê | Onde | Muda algo em produção sozinho? |
|---|---|---|---|
| A | **Backup cifrado** do banco + uploads para um bucket S3 fora da VPS, com retenção 7 diários / 4 semanais / 12 mensais, e **ensaio de restauração** num MySQL descartável | `infra/ovh/backup/` · workflow **Instalar backup OVH** | Não — só quando o dono disparar o workflow |
| B | **`/health/pronto`**: responde `200 {"status":"pronto"}` só se o banco responde (`SELECT 1`, prazo de 2 s); senão `503`, sem detalhe. `/health` continua igual | `apps/api/src/http/saude.ts` | Entra no próximo deploy |
| C | **Deploy com volta automática**: o smoke test usa `/health/pronto`; se falhar depois da troca, o `.env` volta para a imagem anterior e o app sobe de novo (`--no-deps`), e o workflow termina **vermelho** dizendo que voltou | `deploy-ovh.yml` | Entra no próximo deploy |
| D | **Compose endurecido**: o `mysql` lê `mysql.env` (só `MYSQL_*`) e os dois serviços têm limite de log (5 × 10 MB) | `infra/ovh/docker-compose.yml`, `infra/ovh/mysql.env.example` | Não — exige o passo 2.5 |
| E | **Node 22 LTS** (`22.23.3`) na imagem, na CI e no `.nvmrc` | `Dockerfile`, `ci.yml`, `.nvmrc`, `package.json` | Entra no próximo deploy (imagem nova) |
| F | O link de **redefinição de senha não vai mais ao log em produção** quando o e-mail falha | `apps/api/src/lib/log-de-link.ts` | Entra no próximo deploy |
| G | Workflows antigos: **Emitir credencial do agente** e **Diagnóstico do servidor** passaram a falar com a OVH; o **Deploy da TineHost** exige digitar `PUBLICAR-TINEHOST` | `.github/workflows/` | Não |
| H | **Espelho do nginx de produção** (`workspace` + `www`) | `infra/ovh/nginx-producao.conf` | Não — referência para conferir |
| I | **Chave do servidor conferida** em todo workflow da OVH (segredo novo `VPS_KNOWN_HOSTS`), no lugar do `accept-new` | `infra/ovh/acoes/abrir-ssh-vps/action.yml` | ⚠️ **Sim, no sentido de travar:** sem o segredo, os workflows da OVH param — é o passo 2.1 |

### Decisões e o porquê (resumo; o detalhe está nos comentários de cada arquivo)

- **Cifra: `openssl enc -aes-256-cbc -pbkdf2 -iter 200000`, chave em arquivo 600** fora do
  repositório (`~/.config/medconsultoria-backup/chave`). O `openssl` já existe na VPS (nada a
  instalar) e o arquivo se decifra em qualquer máquina com OpenSSL ≥ 1.1.1 — inclusive a do dono,
  no dia em que a VPS não existir. **Custo conhecido:** `openssl enc` não autentica (sem MAC). A
  integridade vem do `.sha256` enviado junto e **conferido antes de decifrar** (ensaiado: arquivo
  adulterado é recusado), e do tar/gzip, que recusam arquivo quebrado. O `age` seria autenticado,
  mas exigiria instalar binário na VPS compartilhada.
- **Cliente S3: `rclone/rclone:1.71` em container**, configurado só por variável de ambiente
  (nenhum arquivo de configuração com chave no disco além do `backup.env` 600).
- **Agendamento: cron do usuário**, não systemd. Timer de usuário do systemd só roda com a pessoa
  deslogada se alguém com root fizer `loginctl enable-linger`; sem isso o backup para em silêncio.
  Timer de sistema exige root numa máquina de vários projetos. O cron do usuário não exige nada.
- **Prioridade baixa, não ociosa** (`nice 10` + `ionice -c2 -n7`, também dentro do container do
  mysqldump). Com `ionice -c3` (ocioso), num disco que nunca fica ocioso — 21/09/2026, iowait 60%
  por causa de um vizinho — o backup nunca terminaria.
- **O banco do backup é o da `DATABASE_URL`, não o `MYSQL_DATABASE`.** Na OVH eles divergem: o app
  usa `medconsultoria_prod`; `medconsultoria` é o banco vazio que ficou como volta atrás da
  importação. Backup pelo `MYSQL_DATABASE` guardaria, todo dia, um banco vazio.
- **Retenção por quantidade, não por data.** Se o backup parar um mês, a regra por data apagaria
  tudo no dia em que voltasse; a por quantidade não apaga nada.
- **HEALTHCHECK da imagem continua em `/health`** (vida do processo), não em `/health/pronto`. Se o
  banco cai, reiniciar o app não conserta nada e o estado "unhealthy" convida a reinício em laço.
  Quem pergunta pelo banco é o smoke test do deploy e o monitor externo.

### O que foi provado, e como

- `/health/pronto` na **imagem Node 22 construída de verdade** (`docker build`), com MySQL real:
  banco no ar → `200 {"status":"pronto"}` com `cache-control: no-store`; banco parado → `503
  {"status":"indisponivel"}` e `/health` ainda `200`. Testes de unidade: 4 (saúde) + 3 (log).
- Backup e ensaio de restauração rodados de ponta a ponta numa **VPS simulada** (`docker:dind`) com
  o `docker-compose.yml` novo, MySQL 8.4 real, volume de uploads e um S3 local: backup OK,
  retenção apagando o excedente, ensaio OK em ~8 s; **negativos**: arquivo adulterado recusado no
  sha256, chave errada recusada ao decifrar, chave com permissão 644 recusada; nenhum segredo nos
  logs; acentos preservados no dump; nenhum container de ensaio sobrando.
- **Troca do `env_file` do mysql ensaiada** na mesma VPS simulada: o `up -d --no-deps mysql`
  recria o container, **os dados sobrevivem** (volume nomeado), a chave do paciente some do
  ambiente do banco, e depois disso **mudar o `.env` não faz o compose querer recriar o mysql**
  (nem num `up -d` sem `--no-deps`).
- `nginx -t` verde (nginx 1.30.5) com o arquivo de produção e o de homologação juntos.
- `actionlint` limpo em todos os workflows; `shellcheck` limpo nos scripts.

---

## 2. Checklist do dono — nesta ordem

> Comandos com `HOST`, `PORTA` e `andre` usam os mesmos valores dos segredos `VPS_HOST`,
> `VPS_PORT` e `VPS_USER` (que não estão escritos no repositório de propósito).
> Onde houver diferença, a receita está em **bash** e em **PowerShell** (o terminal do dono).

### 2.0 Mesclar o PR

CI verde → mesclar. Nada disto age sozinho depois do merge; os próximos passos disparam cada coisa.

### 2.1 Fixar a chave do servidor (`VPS_KNOWN_HOSTS`) — ANTES de qualquer workflow da OVH

⚠️ **Sem este segredo, Deploy OVH, Instalar backup, Emitir credencial e Diagnóstico param** no
primeiro passo, dizendo exatamente isso. É de propósito: `accept-new` num runner que nasce limpo a
cada execução aceitava qualquer servidor que respondesse naquele IP.

1. Numa máquina de confiança, leia a chave que o servidor apresenta:
   ```bash
   ssh-keyscan -p PORTA -t ed25519,ecdsa,rsa HOST > known_hosts_vps
   ssh-keygen -lf known_hosts_vps          # mostra as impressões digitais (SHA256:...)
   ```
2. **Confira contra o próprio servidor** (é isto que impede gravar a chave de um impostor):
   ```bash
   ssh -p PORTA andre@HOST 'for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$f"; done'
   ```
   As impressões `SHA256:...` dos dois comandos têm de ser **iguais**.
3. Grave o segredo:
   - bash: `gh secret set VPS_KNOWN_HOSTS < known_hosts_vps`
   - PowerShell: `Get-Content known_hosts_vps -Raw | gh secret set VPS_KNOWN_HOSTS`
4. ⚠️ Use no `ssh-keyscan` **exatamente** o mesmo `HOST` do segredo `VPS_HOST` (IP com IP,
   domínio com domínio). A ação confere isso e avisa se não bater.
5. **Conferir:** Actions → **Diagnóstico do servidor** → `OVH` → verde, com carga, disco e
   containers impressos.

### 2.2 Backup — bucket, chave e instalação

1. **Criar o bucket** S3-compatível, **privado**. Recomendado: **outra região ou outro provedor**
   que não o da VPS (se o datacenter da VPS tiver problema, o backup não vai junto).
   - OVH: Public Cloud → Object Storage → criar container **S3**; criar um **usuário S3** com
     acesso só a esse container; anotar endpoint (ex.: `https://s3.gra.io.cloud.ovh.net`),
     região (`gra`), access key e secret key.
   - Backblaze B2 / Cloudflare R2 / Wasabi também servem (provider `Other` + endpoint S3).
   - Deixe **versionamento e object lock desligados** para este bucket: a retenção é feita pelo
     script, e o versionamento guardaria cópia de tudo o que ele apaga (cobrado).
2. **Preencher o `backup.env`** a partir de `infra/ovh/backup/backup.env.example` (numa pasta
   FORA do repositório). `PROJETO_DIR` já vem com `/home/andre/medconsultoria`.
3. **Gerar a chave de cifra e GUARDAR UMA CÓPIA FORA DO GITHUB** (gerenciador de senhas) — sem ela
   nenhum backup se decifra, e segredo do GitHub não se lê de volta:
   ```bash
   openssl rand -base64 48        # uma linha de 64 caracteres; copie para o gerenciador de senhas
   ```
4. **Criar os dois segredos:**
   - bash: `gh secret set BACKUP_ENV < backup.env` e `gh secret set BACKUP_CHAVE` (cole a chave)
   - PowerShell: `Get-Content backup.env -Raw | gh secret set BACKUP_ENV` e `gh secret set BACKUP_CHAVE`
   - Depois **apague o `backup.env` local** (ou guarde-o junto da chave no gerenciador).
5. **Disparar:** Actions → **Instalar backup OVH** → digitar `INSTALAR`.
6. **Conferir no log do workflow:** `BACKUP OK`, e no fim `ENSAIO OK — restaurado e conferido em
   N s`, com tabelas/linhas/migrações/uploads batendo. **Anote o N** (é o tempo de restauração).
   No bucket devem aparecer `medconsultoria/diario/medconsultoria-<data>.tar.enc` + `.sha256`.
7. O cron fica instalado: backup **todo dia às 06:17** (hora da VPS; o log mostra o fuso — em UTC é
   03:17 de Brasília) e ensaio **todo domingo às 07:47**. Último resultado sempre em
   `~/medconsultoria/backup/ultimo.log` e `ultimo-ensaio.log` (o Diagnóstico mostra o primeiro).

### 2.3 Monitor externo

1. **UptimeRobot** (ou similar), monitor HTTP(S) **com palavra-chave**:
   - URL: `https://workspace.medconsultoria.com.br/health/pronto`
   - palavra-chave: `"pronto"` (presente = ok) · intervalo: 5 min · alerta por e-mail/WhatsApp
   - ⚠️ Use `/health/pronto`, **não** `/health`: o segundo disse "ok" com o banco fora em 22/09/2026.
2. **Healthchecks.io** para o backup (o cron não sabe avisar que não rodou):
   - criar um check "medconsultoria-backup", período **1 dia**, tolerância **2 h**;
   - pôr a URL de ping em `HEALTHCHECK_PING_URL=` no `backup.env`, atualizar o segredo
     `BACKUP_ENV` e disparar **Instalar backup OVH** de novo (é idempotente: a chave igual é
     mantida, o cron não duplica).
3. **Conferir:** o UptimeRobot mostra "Up"; o Healthchecks mostra o ping do backup do passo 2.2.

### 2.4 SMTP e Gemini no `.env` da VPS

Hoje o `.env` da OVH **não tem** `GEMINI_API_KEY` (os botões de IA ficam escondidos) e o e-mail
precisa apontar para o servidor de e-mail, que **continua na TineHost** (ADR-154).

```bash
ssh -p PORTA andre@HOST
cd ~/medconsultoria
cp -p .env .env.antes-smtp              # para voltar
nano .env                               # preencher/ajustar as linhas abaixo
```
```
GEMINI_API_KEY=<chave do Google AI Studio — a do Workspace, não a da Cora>
SMTP_HOST=<nome do servidor de e-mail da TineHost, ex.: mail.medconsultoria.com.br>
SMTP_PORT=465            # ou 587
SMTP_USER=<caixa que envia>
SMTP_PASS=<senha da caixa>
```
⚠️ `SMTP_HOST` **não pode ser `localhost`** aqui: o servidor de e-mail não mora na VPS. Com host
remoto, o certificado é conferido inteiro (ADR-122) — o nome tem de bater com o do certificado.

Aplicar (o `env_file` só é relido ao **recriar** o container; `restart` não relê):
```bash
docker compose up -d --no-deps app      # ⚠️ SEMPRE com --no-deps até o passo 2.5
curl -s http://127.0.0.1:4319/health/pronto
```
**Conferir:** no site, abra um modelo de e-mail e use "Enviar teste" para `tibamooca@gmail.com`
(chegou? e o monitor de E-mails enviados mostra `enviado`?) e, no Início, o botão de IA "Gerar meu plano" aparece e responde (a 1ª chamada pode
levar ~30 s).

### 2.5 Separar o `env_file` do banco (janela curta, com backup antes)

Recria o container do mysql **uma vez**: o banco fica fora por ~20–40 s (o site responde, o
`/health/pronto` dá 503 nesse intervalo). Os dados moram no volume nomeado `mysql_dados` e
**sobrevivem** — ensaiado.

1. **Janela** fora do horário da Thaís. **Backup antes:**
   `bash ~/medconsultoria/backup/backup.sh` → tem de terminar em `BACKUP OK`.
2. Criar o `mysql.env` com os valores **atuais** (não imprime nada):
   ```bash
   cd ~/medconsultoria
   ( umask 077; grep -E '^MYSQL_(ROOT_PASSWORD|DATABASE|USER|PASSWORD)=' .env > mysql.env )
   wc -l mysql.env                      # tem de dizer 4
   ```
3. Guardar o compose atual e comparar com o novo **antes** de trocar:
   ```bash
   cp -p docker-compose.yml docker-compose.yml.antes-envfile
   # traga o infra/ovh/docker-compose.yml do repositório para ~/medconsultoria/docker-compose.novo.yml
   # (scp da sua máquina, ou cole com nano), e então:
   diff docker-compose.yml docker-compose.novo.yml
   ```
   O `diff` deve mostrar **só** `env_file: mysql.env` no mysql, os blocos `logging` e comentários.
   Se aparecer qualquer outra diferença (o arquivo da VPS pode ter ajuste feito à mão), **pare** e
   traga-a para o repositório primeiro.
4. Trocar e validar:
   ```bash
   mv docker-compose.novo.yml docker-compose.yml
   docker compose config --quiet && echo "config ok"
   ```
5. Recriar **só o banco**, esperar ficar saudável, depois o app:
   ```bash
   docker compose up -d --no-deps mysql
   docker compose ps                    # repetir até o mysql dizer (healthy)
   docker compose up -d --no-deps app   # o bloco logging também recria o app
   curl -s http://127.0.0.1:4319/health/pronto     # {"status":"pronto",...}
   ```
6. **Conferir:**
   - `docker compose exec -T mysql sh -c 'env | grep -c CRYPTO_KEY' </dev/null` → `0`
     (o banco não carrega mais as chaves de cifra do app);
   - login no site, Clientes e Conciliação abrindo com os dados de sempre.
7. **Voltar atrás**, se algo der errado: `mv docker-compose.yml.antes-envfile docker-compose.yml`
   e `docker compose up -d --no-deps mysql` (+ `app`). Os dados não são tocados em nenhum sentido.

### 2.6 Node 22

Nada a fazer além do próximo **Deploy OVH** (a imagem nova já é Node 22).
**Conferir:** `docker compose exec -T app node -v </dev/null` → `v22.23.3`.
⚠️ O `scripts/bundle-deploy.mjs` segue com `target: "node20"` de propósito enquanto a TineHost
(Node 20) for a rede de segurança; pode subir para `node22` depois que ela for desligada.

### 2.7 nginx (só conferência)

```bash
ls /etc/nginx/sites-enabled/
sudo cat /etc/nginx/sites-available/<site-de-producao>
```
Compare com `infra/ovh/nginx-producao.conf` e traga para o repositório o que o servidor tiver de
diferente. Pontos a olhar: `client_max_body_size` (precisa ser ≥ 25m — o upload do app é de até
20 MB; com o padrão do nginx, 1 MB, anexar documento falha com página em inglês) e se o `www`
redireciona para o sem `www`. Aplicar só com `sudo nginx -t` antes do reload.

### 2.8 Apertar a chave de deploy — DECISÃO DO DONO (não aplicado)

Hoje a chave do GitHub entra como `andre`, que está no grupo `docker` — **equivale a root na VPS
inteira**, inclusive nos containers dos outros projetos. Se o repositório (ou o GitHub) vazar a
chave, o estrago não fica no Workspace. Opções, da mais simples à mais forte:

1. **Restringir de onde a chave entra** — em `~/.ssh/authorized_keys`, prefixar a linha da chave do
   deploy com `from="<faixas de IP do GitHub Actions>",no-agent-forwarding,no-port-forwarding,no-X11-forwarding`.
   Barato, mas as faixas do GitHub são amplas e mudam.
2. **Usuário dedicado sem grupo docker + `sudo` restrito** — criar `deploy-med`, com um script
   `/usr/local/sbin/medconsultoria-deploy` (dono root, 755) que só aceita as ações do workflow
   (`pull`, `migrar`, `subir`, `voltar`, `pronto`) e roda `docker compose` em
   `/home/andre/medconsultoria`; em `sudoers`: `deploy-med ALL=(root) NOPASSWD: /usr/local/sbin/medconsultoria-deploy`;
   e na chave: `command="sudo /usr/local/sbin/medconsultoria-deploy $SSH_ORIGINAL_COMMAND",restrict`.
   A chave vazada passa a só conseguir publicar o Workspace. Exige root e ajustar os workflows
   para chamar as ações por nome.
3. **Docker rootless** para este projeto — isola de verdade, mas muda portas, volumes e o
   comportamento do compose; é projeto, não ajuste.

Recomendação: **2**, numa rodada própria (mexe em todos os workflows da OVH e precisa de root).

### 2.9 Pendências registradas (fora deste lote)

- **Emitir credencial do agente**: o workflow **mascara** o segredo e o token antes de imprimir
  (`::add-mask::`) — então quem dispara vê `***` e não consegue copiar o valor. Isso vem de antes
  desta migração e contradiz o próprio comentário ("aparece uma vez no log"). Decidir: entregar o
  valor por outro canal (ex.: gravar cifrado num artefato do run com senha informada no disparo)
  ou tirar a máscara (só aceitável com repositório privado, que é o caso hoje).
- `docs/DEPLOY.md` e `docs/LINKS.md` ainda descrevem o `deploy.yml` com `PUBLICAR`; o botão da
  TineHost agora pede `PUBLICAR-TINEHOST` e o de produção é o **Deploy OVH**.
- Localmente (Windows, npm 11.17), `pnpm build:deploy` falha com `EALLOWSCRIPTS` ao gerar o lock do
  artefato — é do npm desta máquina; no Linux da CI e no `docker build` (npm do Node 22.23.3) o
  mesmo passo passa. Se a CI um dia ganhar npm ≥ 11 com essa regra, é aqui que vai aparecer.

---

## 3. Restaurar a PRODUÇÃO de verdade (manual, de propósito sem atalho)

O `restore.sh` é **ensaio**: carrega num MySQL descartável e não toca em nada. Voltar a produção
de um backup é decisão de gente, com janela e o app parado:

```bash
cd ~/medconsultoria
docker compose stop app                                      # ninguém escreve durante a volta
bash backup/backup.sh                                        # foto do estado atual, por via das dúvidas
# baixar e decifrar o backup escolhido numa pasta 700:
mkdir -m 700 ~/volta && cd ~/volta
# (baixe <nome>.tar.enc e .sha256 do bucket — pelo painel do provedor ou pelo rclone do restore.sh)
sha256sum -c <nome>.tar.enc.sha256
openssl enc -d -aes-256-cbc -salt -pbkdf2 -iter 200000 -md sha256 \
  -pass file:$HOME/.config/medconsultoria-backup/chave -in <nome>.tar.enc | tar -xf -
cat manifesto.txt
```
Carregar num banco **NOVO** (nunca por cima do atual — ele é a volta atrás desta volta):
```bash
cd ~/medconsultoria
docker compose exec -T mysql sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; mysql -uroot -e "CREATE DATABASE medconsultoria_restaurado CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON medconsultoria_restaurado.* TO \`$MYSQL_USER\`@\`%\`;"' </dev/null
gzip -dc ~/volta/banco.sql.gz | docker compose exec -T mysql sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot medconsultoria_restaurado'
```
Uploads (o volume atual vai para uma cópia antes):
```bash
docker run --rm -v medconsultoria_uploads:/d alpine:3 tar -C /d -cf - . > ~/volta/uploads-antes.tar
docker run --rm -i -v medconsultoria_uploads:/d alpine:3 tar -C /d -xf - < ~/volta/uploads.tar
```
Trocar o banco no `.env` (só o nome no fim da `DATABASE_URL`, `..._prod` → `..._restaurado`) e subir:
```bash
nano .env
docker compose up -d --no-deps app
curl -s http://127.0.0.1:4319/health/pronto
```
Conferir na tela. Os dois bancos ficam lado a lado até alguém decidir apagar o antigo.

---

## 4. Trocar a chave do backup (raro, e com consequência)

Os backups **já enviados** só abrem com a chave **antiga**. Trocar é: guardar a antiga no
gerenciador de senhas com a data ("vale para backups até DD/MM"), gerar a nova, apagar o arquivo
`~/.config/medconsultoria-backup/chave` na VPS, atualizar o segredo `BACKUP_CHAVE` e disparar
**Instalar backup OVH**. O workflow recusa sobrescrever uma chave diferente justamente para que
isso nunca aconteça sem esses passos.

---

## 5. Arquivos

| Arquivo | Papel |
|---|---|
| `infra/ovh/backup/backup.sh` | backup diário (dump + manifesto + uploads + cifra + envio + retenção) |
| `infra/ovh/backup/restore.sh` | ensaio de restauração em MySQL descartável |
| `infra/ovh/backup/comum.sh` | peças comuns (configuração, rclone, contagem de linhas) |
| `infra/ovh/backup/instalar-agendamento.sh` | cron do usuário, idempotente |
| `infra/ovh/backup/backup.env.example` | modelo do segredo `BACKUP_ENV` |
| `infra/ovh/acoes/abrir-ssh-vps/action.yml` | SSH com chave do servidor conferida (`VPS_KNOWN_HOSTS`) |
| `infra/ovh/docker-compose.yml` · `mysql.env.example` | compose endurecido (passo 2.5) |
| `infra/ovh/nginx-producao.conf` | espelho do site de produção no nginx do host |
| `.github/workflows/instalar-backup-ovh.yml` | instala o backup e prova (1 backup + 1 ensaio) |
| `.github/workflows/deploy-ovh.yml` | publicar, com `/health/pronto` e volta automática |
| `.github/workflows/diagnostico-servidor.yml` | retrato só-leitura da OVH (ou da TineHost) |
| `.github/workflows/emitir-credencial-agente.yml` | credencial da Cora, dentro do container da OVH |
