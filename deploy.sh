#!/usr/bin/env bash
# ============================================================
# deploy.sh — Publica o Workspace MedConsultoria na TineHost
# Rodar na raiz do repositório (Git Bash ou WSL):  ./deploy.sh
#
# Pré-requisitos:
#   .env.deploy na raiz (copie de .env.deploy.example)
#   chave SSH cujo par público esteja no servidor
#   o .env de PRODUÇÃO já presente no servidor (ver docs/DEPLOY.md §3)
#
# Atalhos:  ./deploy.sh --sim     publica sem pedir confirmação
#           ./deploy.sh --ensaio  faz tudo, menos reiniciar (não troca a versão no ar)
# ============================================================
#
# ─────────────────────────────────────────────────────────────────────────────────────────
# CINCO COISAS AQUI PARECEM ESTRANHAS E TODAS SÃO CICATRIZ. Não "simplifique" nenhuma.
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
#    ERR_MODULE_NOT_FOUND (foi exatamente isso que derrubou a produção por ~9 min em 05/08).
#
# 3. Cada passo remoto é um `ssh` PRÓPRIO, nunca encadeado com `&&`. Encadeado, o
#    `prisma generate` derruba o resto da cadeia: o deploy termina dizendo "concluído" e a
#    aplicação segue rodando o código ANTIGO, sem nunca ter reiniciado.
#    (Isso NÃO conflita com o ControlMaster do passo 1: lá é UMA conexão TCP reaproveitada
#     por vários `ssh`; aqui é sobre não juntar comandos num `&&` só.)
#
# 4. O ensaio de boot não passa por cano nem por `head`. `head -1` fecha o cano, o `ssh`
#    morre com SIGPIPE e o `pipefail` reprova um boot PERFEITO; e o comando remoto herda o
#    código do `grep` de erros, que sai 1 quando não acha nada. Saída vai para variável.
#
# 5. `curl --compressed` no smoke test. Sem isso o LiteSpeed devolve corpo comprimido e o
#    teste mostra lixo binário em vez do JSON de saúde.
# ─────────────────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuração ─────────────────────────────────────────────
[ -f .env.deploy ] || {
  echo "✗ .env.deploy não encontrado. Copie .env.deploy.example e preencha os valores."
  exit 1
}
set -a; . ./.env.deploy; set +a

: "${DEPLOY_HOST:?defina DEPLOY_HOST em .env.deploy}"
: "${DEPLOY_USER:?defina DEPLOY_USER em .env.deploy}"
: "${DEPLOY_PATH:?defina DEPLOY_PATH em .env.deploy}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-1992}"
DEPLOY_NODE_VENV="${DEPLOY_NODE_VENV:-~/nodevenv/domains/workspace.medconsultoria.com.br/public_html/20/bin/activate}"
RESTART_CMD="${DEPLOY_RESTART_CMD:-mkdir -p tmp && touch tmp/restart.txt}"
DOMINIO="${DEPLOY_DOMINIO:-https://workspace.medconsultoria.com.br}"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; DIM='\033[2m'; NC='\033[0m'
info()    { echo -e "${BLUE}[→]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*"; exit 1; }
passo()   { echo ""; echo -e "${BLUE}━━ $* ${NC}"; }

CONFIRMAR="sim"; SO_ENSAIO="nao"
for arg in "$@"; do
  case "$arg" in
    --sim|-y)  CONFIRMAR="nao" ;;
    --ensaio)  SO_ENSAIO="sim" ;;
    *) error "argumento desconhecido: $arg (use --sim ou --ensaio)" ;;
  esac
done

CARIMBO="$(date +%Y%m%d-%H%M%S)"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
RAMO="$(git branch --show-current 2>/dev/null || echo '?')"

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║   Workspace MedConsultoria — Deploy TineHost       ║"
echo "║   workspace.medconsultoria.com.br                  ║"
echo "╚════════════════════════════════════════════════════╝"
echo -e "${DIM}   ramo ${RAMO} · commit ${COMMIT} · ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_SSH_PORT}${NC}"
echo ""

# ── Trava de concorrência ────────────────────────────────────
# ⛔ A ARMADILHA MAIS CARA DESTE PROJETO. Dois deploys ao mesmo tempo se sabotam: disputam o
# mesmo /tmp/boot-teste.log, a mesma porta do `node app.cjs` e o mesmo node_modules. Os dois
# falham SEM defeito no código, e a evidência some (ensaio de boot com 0 e "--- erros ---"
# vazio). O workflow do GitHub resolvia isso com `concurrency: deploy-producao`; fora dele,
# a trava tem de ser esta. Se precisar voltar atrás, restaure o PRIMEIRO snapshot da rodada.
TRAVA="${TMPDIR:-/tmp}/medconsultoria-deploy.lock"
if ! mkdir "$TRAVA" 2>/dev/null; then
  error "JÁ EXISTE UM DEPLOY EM ANDAMENTO (trava: $TRAVA).
    O deploy passa de 2 min e PARECE travado — não rode de novo.
    Se tiver certeza de que nenhum outro está rodando: rmdir '$TRAVA'"
fi
trap 'rmdir "$TRAVA" 2>/dev/null || true' EXIT

if [ "$CONFIRMAR" = "sim" ]; then
  warn "Isto publica EM PRODUÇÃO. O \`npm ci\` refaz o node_modules (~1 min servindo)."
  printf "    Digite PUBLICAR para seguir: "
  read -r RESPOSTA
  [ "$RESPOSTA" = "PUBLICAR" ] || error "cancelado (você digitou '${RESPOSTA}')"
fi

# ── 1. Conexão única com o servidor (ADR-113) ────────────────
# A TineHost corta conexões SSH repetidas de um IP que ela não conhece. Uma conexão mestre
# reaproveitada por todos os passos evita o castigo — e é mais rápida.
passo "1/8 · Abrir UMA conexão com o servidor e mantê-la"
CM="${TMPDIR:-/tmp}/cm-medconsultoria-$$"
SSH_OPTS=(-p "${DEPLOY_SSH_PORT}" -o LogLevel=ERROR -o StrictHostKeyChecking=accept-new
          -o ControlMaster=auto -o ControlPath="${CM}" -o ControlPersist=15m
          -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -o ConnectTimeout=30)
[ -n "${DEPLOY_SSH_KEY:-}" ] && SSH_OPTS+=(-i "${DEPLOY_SSH_KEY}" -o IdentitiesOnly=yes)
ALVO="${DEPLOY_USER}@${DEPLOY_HOST}"
remoto() { ssh "${SSH_OPTS[@]}" "${ALVO}" "$@"; }
trap 'ssh "${SSH_OPTS[@]}" -O exit "${ALVO}" 2>/dev/null || true; rmdir "$TRAVA" 2>/dev/null || true' EXIT

# Paciência de propósito: se a hospedagem estiver punindo o IP, esperar é o que resolve —
# insistir rápido é o que prolonga o castigo.
for TENTATIVA in 1 2 3 4; do
  if ssh "${SSH_OPTS[@]}" -N -f "${ALVO}" 2>/tmp/ssh-erro-$$; then
    success "conexão aberta na tentativa ${TENTATIVA}"
    break
  fi
  warn "tentativa ${TENTATIVA} falhou: $(cat /tmp/ssh-erro-$$ 2>/dev/null)"
  [ "$TENTATIVA" = "4" ] && error "não consegui conectar em ${ALVO}:${DEPLOY_SSH_PORT}.
    Confira DEPLOY_SSH_KEY no .env.deploy e se a pública está no servidor."
  sleep $((TENTATIVA * 30))
done
rm -f /tmp/ssh-erro-$$

# ── 2. Build ─────────────────────────────────────────────────
passo "2/8 · Build de produção + bundle auto-contido"
pnpm install --frozen-lockfile
pnpm build:deploy
success "artefato montado em apps/api/dist"

# ── 3. Portão do artefato (ADR-116/117) ──────────────────────
# O portão que faltava até 18/08/2026: prova que o artefato leva lockfile e overrides, que o
# `npm ci` do servidor aceita esse lock (ensaiado a seco) e que a árvore passa no audit. Sem
# ele, o servidor re-resolvia as dependências e instalava falha ALTA que a CI dizia fechada.
passo "3/8 · O artefato está inteiro e limpo? (lockfile, overrides, audit)"
node scripts/conferir-artefato.mjs

# ── 4. Snapshot (é o rollback) ───────────────────────────────
passo "4/8 · Snapshot do release atual (é o rollback)"
remoto "mkdir -p ~/backups && cd '${DEPLOY_PATH}' && \
  tar -czf ~/backups/release-pre-${CARIMBO}.tar.gz --exclude=node_modules . && \
  ls -lh ~/backups/release-pre-${CARIMBO}.tar.gz | awk '{print \$5, \$9}'"
success "rollback disponível: ~/backups/release-pre-${CARIMBO}.tar.gz"

# ── 5. Enviar ────────────────────────────────────────────────
passo "5/8 · Enviar o artefato (tar — sobrepõe sem apagar; ver nota 1)"
tar -czf - -C apps/api/dist . | remoto "cd '${DEPLOY_PATH}' && tar -xzf - && echo 'artefato extraído'"
success "artefato no servidor"

# ── 6. Dependências + Prisma ─────────────────────────────────
passo "6/8 · Dependências, Prisma Client e migrations (dentro do virtualenv; ver nota 2)"
# `npm ci`, não `npm install` (ADR-116): o artefato leva `package-lock.json` e o `ci` instala
# exatamente aquela lista, recusando rodar se o lock discordar do package.json.
# Duas cicatrizes juntas: (a) `| tail -N` dentro do `ssh` roda no shell REMOTO, que não tem
# `pipefail` — o código que volta é o do `tail`, sempre 0, e a falha passa despercebida;
# (b) o `npm ci` APAGA o node_modules antes de instalar, e o snapshot do passo 4 é
# `--exclude=node_modules`, ou seja não devolve a pasta. Daí a cópia de socorro.
# `/tmp` na TineHost é OUTRO DISPOSITIVO (`cp -al` = "Invalid cross-device link"), e a versão
# antiga apagava a pasta antes de conferir se a cópia existia — foi assim que a produção ficou
# sem node_modules em 18/08. Hoje a cópia vai para ~/nm-antes e nada é apagado sem conferir.
PRESERVAR="{ cp -al node_modules ~/nm-antes || cp -a node_modules ~/nm-antes ; } && echo 'node_modules preservado'"
remoto "cd '${DEPLOY_PATH}' && rm -rf ~/nm-antes && { ${PRESERVAR} ; } || echo 'sem node_modules previo'"

CI_CMD="npm ci --omit=dev > /tmp/npm-ci.log 2>&1"
SOCORRO="echo '!! npm ci FALHOU'; tail -30 /tmp/npm-ci.log; if [ -d ~/nm-antes ]; then rm -rf node_modules && { cp -al ~/nm-antes node_modules || cp -a ~/nm-antes node_modules ; } && echo '>> node_modules ANTERIOR restaurado'; else echo '>> SEM copia de seguranca: node_modules foi DEIXADO como estava'; fi; exit 1"
remoto "cd '${DEPLOY_PATH}' && source ${DEPLOY_NODE_VENV} && { ${CI_CMD} ; } || { ${SOCORRO} ; }"

GEN_CMD="npm run prisma:generate > /tmp/prisma-gen.log 2>&1"
remoto "cd '${DEPLOY_PATH}' && source ${DEPLOY_NODE_VENV} && { ${GEN_CMD} ; } || { echo '!! prisma generate FALHOU'; tail -20 /tmp/prisma-gen.log; exit 1; }"
DEP_CMD="npm run prisma:deploy > /tmp/prisma-dep.log 2>&1"
remoto "cd '${DEPLOY_PATH}' && source ${DEPLOY_NODE_VENV} && { ${DEP_CMD} ; } || { echo '!! migrate deploy FALHOU'; tail -20 /tmp/prisma-dep.log; exit 1; }"
remoto "tail -3 /tmp/npm-ci.log; tail -2 /tmp/prisma-gen.log; tail -3 /tmp/prisma-dep.log"
success "dependências instaladas e migrations aplicadas"

# ── 7. Ensaio de boot ────────────────────────────────────────
# Sobe o app à mão ANTES de reiniciar o de verdade: se faltar dependência ou variável, o erro
# aparece aqui, com a produção ainda servindo a versão antiga — em vez de virar 503 para quem
# está usando o sistema. Sem cano e sem `head` (ver nota 4).
passo "7/8 · Ensaio de boot (a produção ainda está no ar na versão anterior)"
ENSAIO="$(remoto "cd '${DEPLOY_PATH}' && source ${DEPLOY_NODE_VENV} && timeout 25 node app.cjs > /tmp/boot-teste.log 2>&1; grep -c 'Server listening' /tmp/boot-teste.log; echo '--- erros ---'; { grep -iE 'error|invalid' /tmp/boot-teste.log | head -5; } || true" || true)"
OUVINDO="$(printf '%s\n' "${ENSAIO}" | head -1 | tr -dc '0-9')"
if [ -n "${OUVINDO}" ] && [ "${OUVINDO}" -gt 0 ]; then
  success "boot OK (${OUVINDO} portas ouvindo) — pode reiniciar"
else
  echo -e "${RED}[✗]${NC} O app NÃO subiu. A produção continua na versão anterior (nada foi reiniciado)."
  echo "    Saída do ensaio:"; printf '%s\n' "${ENSAIO}"
  echo "    Rollback do envio: ~/backups/release-pre-${CARIMBO}.tar.gz"
  exit 1
fi

if [ "$SO_ENSAIO" = "sim" ]; then
  echo ""
  warn "--ensaio: parando aqui. O artefato está no servidor e o boot passou,"
  warn "mas NADA foi reiniciado — a produção segue na versão anterior."
  exit 0
fi

# ── 8. Restart + smoke test ──────────────────────────────────
passo "8/8 · Reiniciar e provar que reiniciou"
remoto "cd '${DEPLOY_PATH}' && ${RESTART_CMD} && date -r tmp/restart.txt '+restart.txt marcado em %Y-%m-%d %H:%M:%S'"

info "Smoke test — o site respondeu de verdade?"
sleep 15
SAUDE="$(curl -fsS --compressed --max-time 30 "${DOMINIO}/health")"
echo "    /health -> ${SAUDE}"
printf '%s' "${SAUDE}" | grep -q '"status":"ok"' || error "/health não disse ok"
for ROTA in / /credenciamentos /comecar; do
  CODIGO="$(curl -s --compressed -o /dev/null -w '%{http_code}' --max-time 30 "${DOMINIO}${ROTA}")"
  echo "    ${ROTA} -> ${CODIGO}"
  [ "$CODIGO" = "200" ] || error "${ROTA} não devolveu 200"
done
success "todas as rotas responderam"

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo -e "║  ${GREEN}✓ NO AR${NC}                                           ║"
echo "║  → https://workspace.medconsultoria.com.br         ║"
echo "╚════════════════════════════════════════════════════╝"
echo -e "${DIM}   commit ${COMMIT} · rollback: ~/backups/release-pre-${CARIMBO}.tar.gz${NC}"
echo ""
