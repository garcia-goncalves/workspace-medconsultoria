#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Instala (idempotente) os crons de OPS no SERVIDOR (TineHost):
#   - backup do MySQL, diário 03:00 BRT
#   - health-check + auto-restart, a cada 5 min
# Preserva qualquer cron já existente (só ANEXA o que falta). Rode uma vez.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

OPS="$HOME/domains/workspace.medconsultoria.com.br/ops"
BK="$HOME/domains/workspace.medconsultoria.com.br/backups"
TMP="$(mktemp)"

crontab -l > "$TMP" 2>/dev/null || true
grep -q 'ops/backup-db.sh'   "$TMP" || echo "0 3 * * * /bin/bash $OPS/backup-db.sh >> $BK/backup.log 2>&1" >> "$TMP"
grep -q 'ops/healthcheck.sh' "$TMP" || echo "*/5 * * * * /bin/bash $OPS/healthcheck.sh" >> "$TMP"
crontab "$TMP"
rm -f "$TMP"

echo "cron instalado. Entradas de OPS do workspace:"
crontab -l | grep -E 'ops/(backup-db|healthcheck)\.sh'
