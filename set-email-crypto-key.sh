#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Cria a EMAIL_CRYPTO_KEY no .env de PRODUÇÃO (a chave que cifra as senhas das
# caixas de e-mail — ADR-95). Rode UMA vez, antes do primeiro deploy do módulo
# de e-mail. Sem ela, /email fica desligado e o resto da app funciona normal.
#
# Uso (na pasta do projeto):   bash set-email-crypto-key.sh
#
# Por que existe um script em vez de "cole esta chave lá":
#   - a chave é gerada DENTRO do servidor: o valor nunca passa por conversa,
#     log, histórico do terminal ou transcript de IA;
#   - as credenciais de acesso saem do .env.deploy, lido pelo shell (igual ao
#     deploy.sh) — ninguém precisa vê-las;
#   - é idempotente: se a chave já existir, NÃO sobrescreve. Trocar a chave
#     invalidaria as senhas já cifradas, e cada pessoa teria de plugar a caixa
#     de novo (a app avisa isso na tela, mas é retrabalho à toa).
#
# Para ROTACIONAR de propósito (chave vazada, por exemplo): apague a linha
# EMAIL_CRYPTO_KEY do .env do servidor e rode de novo — sabendo que todas as
# caixas plugadas terão de ser reconectadas.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [ ! -f .env.deploy ]; then
  echo "ERRO: rode este script na pasta do projeto (não achei o .env.deploy)."
  exit 1
fi

set -a; . ./.env.deploy; set +a
: "${DEPLOY_HOST:?falta DEPLOY_HOST no .env.deploy}"
: "${DEPLOY_USER:?falta DEPLOY_USER no .env.deploy}"
: "${DEPLOY_PATH:?falta DEPLOY_PATH no .env.deploy}"

SSH_OPTS="-p ${DEPLOY_SSH_PORT:-22}"
[ -n "${DEPLOY_SSH_KEY:-}" ] && SSH_OPTS="${SSH_OPTS} -i ${DEPLOY_SSH_KEY}"

echo "==> Conferindo a chave no servidor (nenhum segredo é impresso)"
# shellcheck disable=SC2086
ssh $SSH_OPTS -o ConnectTimeout=20 "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "bash -s -- '${DEPLOY_PATH}'" <<'REMOTO'
set -euo pipefail
cd "$1"

[ -f .env ] || { echo "ERRO: não existe .env em $1 — veja docs/DEPLOY.md §3."; exit 2; }

if grep -q '^EMAIL_CRYPTO_KEY=' .env; then
  echo "RESULTADO: a chave JÁ EXISTIA — nada foi alterado."
else
  cp .env ".env.bak-antes-email-$(date +%Y%m%d-%H%M%S)"
  printf 'EMAIL_CRYPTO_KEY="%s"\n' \
    "$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')" >> .env
  echo "RESULTADO: chave CRIADA (backup do .env salvo ao lado, com data no nome)."
fi

# Conferência que não revela o valor: só o tamanho decodificado precisa bater.
node -e '
  const m = require("fs").readFileSync(".env","utf8")
    .match(/^EMAIL_CRYPTO_KEY="?([^"\r\n]+)"?/m);
  const n = m ? Buffer.from(m[1],"base64").length : 0;
  console.log("CONFERÊNCIA: " + n + " bytes " + (n === 32 ? "— OK" : "— INVÁLIDA (esperado 32)"));
  process.exit(n === 32 ? 0 : 3);
'
REMOTO

echo "==> Pronto. Agora um deploy (./deploy.sh) e a página /email liga em produção."
