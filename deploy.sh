#!/usr/bin/env bash
# Deploy para TineHost/DirectAdmin (LiteSpeed/lsnode) via SSH. Uso: ./deploy.sh
# Pré-requisitos: .env.deploy local (NUNCA commitado), chave SSH, e o .env de PRODUÇÃO
# já presente no servidor (ver docs/DEPLOY.md).
#
# Envia um artefato AUTO-CONTIDO (apps/api/dist com server.js + public/ + prisma/ +
# package.json de produção) e reinicia o lsnode.
#
# ─────────────────────────────────────────────────────────────────────────────────────────
# TRÊS COISAS AQUI PARECEM ESTRANHAS E TODAS SÃO CICATRIZ. Não "simplifique" nenhuma —
# as três foram descobertas no deploy de 05/08/2026, que derrubou a produção por ~9 minutos.
#
# 1. `tar | ssh`, e NÃO `rsync`. Motivos, em ordem de gravidade:
#      (a) `rsync --delete` apagaria o `.htaccess` e o `cgi-bin` do destino, que NÃO vêm no
#          artefato — e é o `.htaccess` que faz o LiteSpeed servir o site;
#      (b) o Git Bash do Windows (a máquina de quem publica) não tem `rsync` instalado.
#    O tar sobrepõe sem apagar. O preço é acumular chunk antigo com hash velho no destino:
#    ocupa disco, não atrapalha (o `index.html` aponta só para os novos).
#
# 2. `npm` NÃO existe numa sessão SSH não interativa — ele vive no virtualenv do CloudLinux.
#    Sem o `source .../activate`, o `npm install` falha com "command not found", o servidor
#    fica com um `server.js` novo e um `node_modules` velho, e o app morre no boot com
#    ERR_MODULE_NOT_FOUND (foi exatamente isso que derrubou a produção: faltava `imapflow`).
#
# 3. Cada passo depois do envio vai numa CONEXÃO SSH PRÓPRIA. Encadeado com `&&`, o
#    `prisma generate` derruba o resto da cadeia: o deploy termina dizendo "concluído" e a
#    aplicação segue rodando o código ANTIGO, sem nunca ter reiniciado.
# ─────────────────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [ -f .env.deploy ]; then
  set -a; . ./.env.deploy; set +a
fi

: "${DEPLOY_HOST:?defina DEPLOY_HOST (em .env.deploy)}"
: "${DEPLOY_USER:?defina DEPLOY_USER (em .env.deploy)}"
: "${DEPLOY_PATH:?defina DEPLOY_PATH (em .env.deploy)}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"
# Virtualenv do Node no CloudLinux — é onde `npm` e `node` de verdade moram (ver nota 2).
DEPLOY_NODE_VENV="${DEPLOY_NODE_VENV:-~/nodevenv/domains/workspace.medconsultoria.com.br/public_html/20/bin/activate}"
RESTART_CMD="${DEPLOY_RESTART_CMD:-mkdir -p tmp && touch tmp/restart.txt}"

SSH_OPTS="-p ${DEPLOY_SSH_PORT} -o LogLevel=ERROR"
[ -n "${DEPLOY_SSH_KEY:-}" ] && SSH_OPTS="${SSH_OPTS} -i ${DEPLOY_SSH_KEY}"
CARIMBO="$(date +%Y%m%d-%H%M%S)"
remoto() { ssh ${SSH_OPTS} "${DEPLOY_USER}@${DEPLOY_HOST}" "$@"; }

echo "==> 1/6 Build de produção + bundle auto-contido"
pnpm install --frozen-lockfile
pnpm build:deploy

echo "==> 2/6 Snapshot do release atual (é o rollback)"
remoto "mkdir -p ~/backups && cd '${DEPLOY_PATH}' && \
  tar -czf ~/backups/release-pre-${CARIMBO}.tar.gz --exclude=node_modules . && \
  ls -lh ~/backups/release-pre-${CARIMBO}.tar.gz | awk '{print \$5, \$9}'"

echo "==> 3/6 Enviando o artefato (tar — sobrepõe sem apagar; ver nota 1)"
tar -czf - -C apps/api/dist . | remoto "cd '${DEPLOY_PATH}' && tar -xzf - && echo 'artefato extraído'"

echo "==> 4/6 Dependências de produção (dentro do virtualenv; ver nota 2)"
remoto "cd '${DEPLOY_PATH}' && source ${DEPLOY_NODE_VENV} && npm install --omit=dev 2>&1 | tail -3"

echo "==> 5/6 Prisma Client e migrations (conexões separadas; ver nota 3)"
remoto "cd '${DEPLOY_PATH}' && source ${DEPLOY_NODE_VENV} && npm run prisma:generate 2>&1 | tail -2"
remoto "cd '${DEPLOY_PATH}' && source ${DEPLOY_NODE_VENV} && npm run prisma:deploy 2>&1 | tail -3"

# Sobe o app à mão ANTES de reiniciar o de verdade: se faltar dependência ou variável, o erro
# aparece aqui, com a produção ainda servindo a versão antiga — em vez de aparecer como um 503
# para quem está usando o sistema.
#
# O `head` NÃO entra aqui: cortar a saída antes das linhas de "Server listening" produz um FALSO
# NEGATIVO — o app subiu, o script diz que não, e o deploy trava por nada (aconteceu em 05/08 ao
# ligar a EMAIL_CRYPTO_KEY). A saída vai inteira para um arquivo no servidor e só então é filtrada.
echo "==> 6/6 Ensaio de boot (a produção ainda está no ar servindo a versão anterior)"
if remoto "cd '${DEPLOY_PATH}' && source ${DEPLOY_NODE_VENV} && timeout 25 node app.cjs > /tmp/boot-teste.log 2>&1; grep -c 'Server listening' /tmp/boot-teste.log; echo '--- erros ---'; grep -iE 'error|invalid' /tmp/boot-teste.log | head -5" | tee /tmp/boot-teste.log | head -1 | grep -qvE "^0$"; then
  echo "    boot OK — pode reiniciar"
else
  echo "    !! O app NÃO subiu. A produção continua na versão anterior (nada foi reiniciado)."
  echo "    !! Saída do ensaio:"; cat /tmp/boot-teste.log
  echo "    !! Rollback, se quiser desfazer o envio: ~/backups/release-pre-${CARIMBO}.tar.gz"
  exit 1
fi

echo "==> Restart + prova de que reiniciou"
remoto "cd '${DEPLOY_PATH}' && ${RESTART_CMD} && date -r tmp/restart.txt '+restart.txt marcado em %Y-%m-%d %H:%M:%S'"

# `--compressed` é obrigatório: sem ele o LiteSpeed devolve corpo comprimido e o smoke test
# mostra lixo binário em vez do JSON de saúde.
echo "==> Smoke test"
sleep 10
curl -s --compressed --max-time 25 "https://workspace.medconsultoria.com.br/health"; echo
echo "==> Feito. Rollback: extrair ~/backups/release-pre-${CARIMBO}.tar.gz sobre ${DEPLOY_PATH} e reiniciar."
