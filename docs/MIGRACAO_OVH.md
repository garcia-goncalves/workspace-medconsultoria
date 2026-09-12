# Migração para VPS próprio (OVHcloud)

> **Runbook.** A decisão e o porquê estão na **ADR-154**. Aqui é o passo a passo.
> Nada neste documento toca a produção antes da Fase 3 — e a TineHost só é desligada na Fase 5.

## 0. O que muda

| | TineHost (hoje) | VPS (depois) |
|---|---|---|
| Publicar | `tar` por SSH + `npm ci` **no servidor** | `docker compose pull && up -d` |
| Dependências | resolvidas **em produção**, a cada deploy | congeladas na **imagem**, construída na CI |
| Prisma Client | `generate` em produção | gerado no build da imagem |
| Migrations | dentro do mesmo passo do `npm ci` | passo próprio, antes de trocar o tráfego |
| Reiniciar | `touch tmp/restart.txt` (Passenger) | `docker compose up -d` com healthcheck |
| Node | virtualenv do CloudLinux (`source .../activate`) | o da imagem |
| TLS / estáticos | LiteSpeed + `.htaccess` que não pode ser apagado | Caddy, certificado automático |
| Rollback | `tar.gz` em `~/backups` | `docker compose up -d` na tag anterior |
| Acesso | pouco, e instável | root |

O `npm ci` que travou duas vezes em 12/09/2026 (2h15 e 38 min, sem uma linha de log) **deixa de
existir**: ninguém instala dependência em produção.

## 1. Fase 0 — antes de tocar em qualquer coisa

**1.1 Escolher o datacenter.** A OVH **não tem** datacenter no Brasil. Beauharnois (Canadá, `BHS`) é a
escolha padrão: a medição de 12/09 mostrou **146 ms de handshake TCP** contra a TineHost atual, ou seja,
a produção de hoje **já não está no Brasil** — BHS empata ou melhora. Confirmar a opção na tela do
pedido.

**1.2 Aderir às cláusulas-padrão da ANPD** (Resolução CD/ANPD nº 19/2024; o período de graça terminou em
23/08/2025). Sem elas, hospedar dado pessoal fora do Brasil não tem base contratual válida.
⚠️ Isto **já vale para a TineHost** — a migração não cria a pendência, só a torna visível.

**1.3 Levantar os segredos do `.env` de produção**, pelo File Manager do painel, sem SSH.
⚠️ **`PACIENTE_CRYPTO_KEY` e `EMAIL_CRYPTO_KEY` são COPIADAS, jamais regeradas.** Gerar de novo torna
ilegível todo dado de paciente já importado e toda senha de caixa de e-mail — o conserto seria
reimportar cada competência e replugar cada caixa.

**1.4 Inventário.** Tamanho do banco (o phpMyAdmin mostra) e de `storage/uploads` (o File Manager
mostra). É o que define quanto tempo a janela de corte precisa ter.

## 2. Fase 1 — provisionar o VPS (produção intocada)

VPS-2 (4 vCore, 8 GB RAM, 75 GB NVMe, ~US$ 8,50/mês) sobra para esta carga. Debian 12.

```bash
# 1. usuário sem root + chave; root e senha desligados no SSH
adduser med && usermod -aG sudo med
rsync --archive --chown=med:med ~/.ssh /home/med
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# 2. firewall: só 22, 80 e 443
ufw default deny incoming && ufw allow OpenSSH && ufw allow 80,443/tcp && ufw --force enable

# 3. docker
curl -fsSL https://get.docker.com | sh && usermod -aG docker med

# 4. atualização de segurança sozinha
apt install -y unattended-upgrades fail2ban
```

Estrutura em disco:

```
/srv/medconsultoria/
  docker-compose.yml
  Caddyfile
  .env              # 600, med:med
  uploads/          # volume do app (UPLOADS_DIR)
  backups/          # dumps, antes de subirem para fora da máquina
```

## 3. Fase 2 — a esteira (ninguém compila em produção)

**`Dockerfile`** — o `build:deploy` e o `conferir-artefato.mjs` continuam valendo; só mudam de lugar, do
servidor para o build:

```dockerfile
FROM node:20.20.2-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build:deploy && node scripts/conferir-artefato.mjs

FROM node:20.20.2-bookworm-slim
WORKDIR /app
COPY --from=build /app/apps/api/dist ./
RUN npm ci --omit=dev && npm run prisma:generate   # aqui, não em produção
EXPOSE 4319
CMD ["node", "app.cjs"]
```

**`docker-compose.yml`**: `app` (imagem do GHCR) + `mysql:8.4` (o mesmo do `docker-compose.yml` de
desenvolvimento, mesma collation `utf8mb4_unicode_ci`) + `caddy`. O Caddy resolve TLS sozinho e fala com
`app:4319`. O `app` ganha `healthcheck` batendo em `/health` — o mesmo endpoint que o smoke test já usa.

**`.github/workflows/deploy-ovh.yml`**: constrói a imagem, publica no GHCR com a tag do commit, e no
servidor roda **três** comandos, nesta ordem, cada um com seu código de saída:

```bash
docker compose pull
docker compose run --rm app npm run prisma:deploy   # migrations antes de o tráfego trocar
docker compose up -d                                # só troca se o healthcheck passar
```

Continua valendo o que já é lei: `concurrency: deploy-producao`, gatilho manual digitando `PUBLICAR`, e
a suíte completa (`ci.yml`) verde antes de qualquer coisa tocar o servidor.

## 4. Fase 3 — ensaio com dado real (a produção continua no ar)

Sobe tudo num subdomínio (`homolog.workspace.medconsultoria.com.br`) apontando para o VPS, com uma
**cópia** do banco de produção. É o ensaio que prova a restauração antes de ela virar cutover.

**Extrair da TineHost sem SSH** — é aqui que o pouco acesso dói, e dá para fazer só pelo painel:

1. **Banco:** phpMyAdmin → Exportar → SQL (ou DirectAdmin → Backup Wizard → apenas MySQL). Baixar.
2. **Uploads:** File Manager → comprimir `storage/uploads` → baixar o `.zip`.
3. **`.env`:** File Manager → abrir e copiar os valores (ver 1.3 — chaves de cifra **copiadas**).

Restaurar e conferir:

```bash
gunzip < dump.sql.gz | docker compose exec -T mysql mysql -u med -p medconsultoria
unzip uploads.zip -d /srv/medconsultoria/uploads
docker compose run --rm app npm run prisma:deploy   # deve aplicar só a conciliacao_producao
docker compose up -d
```

Verificar na tela, logado: Início, Clientes, Credenciamentos, Documentos, **Conciliação**, E-mail e um
upload de arquivo. Na Conciliação, com a `PACIENTE_CRYPTO_KEY` copiada, **importar uma competência e ver
o paciente decifrado** — é o teste que prova que a chave veio inteira.

**Só se o ensaio passar inteiro é que existe Fase 4.**

## 5. Fase 4 — cutover

**24 h antes:** baixar o TTL do DNS para 300 s.
**Janela:** noite ou fim de semana — fora do horário da Thaís, que usa credenciamento todo dia.

| # | Passo | Tempo |
|---|---|---|
| 1 | Avisar e **congelar**: ninguém usa o sistema a partir daqui | — |
| 2 | Pôr a TineHost em manutenção (ou avisar, se não houver como) | 2 min |
| 3 | Dump final do banco + zip final de uploads (painel) | 5–15 min |
| 4 | Restaurar no VPS e rodar `prisma:deploy` | 5–15 min |
| 5 | Conferir na tela **pelo subdomínio**, ainda sem mexer no DNS | 10 min |
| 6 | Apontar o DNS para o VPS | 1 min |
| 7 | Esperar propagar (TTL 300) e conferir `/health`, `/` e `/credenciamentos` | 5–10 min |
| 8 | Descongelar e avisar | — |

**Ponto de não retorno: o passo 8.** Depois que alguém escrever no VPS, voltar para a TineHost significa
**perder o que foi escrito**. Entre o 6 e o 8 ainda dá para voltar o DNS sem perda nenhuma.

**Rollback:** apontar o DNS de volta. A TineHost fica **intacta e ligada por 14 dias** — não se apaga,
não se cancela e não se "limpa" nada lá dentro nesse período.

## 6. Fase 5 — depois do corte

1. **Backup automatizado** — `mysqldump` diário + `uploads`, para **fora** da máquina (OVH Object Storage
   ou outro provedor). Backup que mora no mesmo VPS não é backup.
2. **Ensaio de restauração** — restaurar esse backup num container descartável **uma vez**, e anotar o
   tempo. Backup nunca restaurado é esperança, não garantia.
3. **Monitoramento externo** de `/health`. Em 12/09/2026 quem descobriu que a produção estava meio
   quebrada foi o dono, olhando a tela.
4. **Só então** desligar a TineHost, depois de 14 dias limpos.

## 7. O que morre e o que continua valendo

**Morrem** (viram história no `deploy.sh`): o virtualenv do CloudLinux, o `/tmp` em outro dispositivo, o
`.htaccess` que não pode ser apagado, o estrangulamento de SSH por IP desconhecido, o `npm ci` em
produção, o `touch tmp/restart.txt` e a cópia de socorro do `node_modules`.

**Continuam valendo**, porque nunca foram da hospedagem:

- **Uma coisa por vez, com código de saída próprio** — comando encadeado com `&&` esconde falha.
- **Nada troca o tráfego sem prova de vida** — era o ensaio de boot, vira o `healthcheck`.
- **Migration antes do tráfego**, sempre.
- **Segredo não se imprime**, e chave de cifra não se rotaciona por engano.
- **Não se anuncia publicação sem resposta HTTP lida.**
