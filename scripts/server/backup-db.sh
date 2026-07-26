#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Backup automático do MySQL — SERVIDOR (TineHost).
# Instalado em ~/domains/workspace.medconsultoria.com.br/ops/ e chamado por cron
# DIÁRIO (03:00 BRT). NÃO roda no dev local — usa os caminhos do servidor.
# Ver docs/DEPLOY.md § Backup & monitoramento.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DOMAIN_BASE="$HOME/domains/workspace.medconsultoria.com.br"
APP="$DOMAIN_BASE/public_html"
BACKUPS="$DOMAIN_BASE/backups"
KEEP=14   # quantos backups automáticos manter (14 dias)

cd "$APP"
set -a; source .env; set +a
# O activate do CloudLinux não é "nounset"-safe (usa CL_VIRTUAL_ENV sem definir),
# então desligamos o -u só ao redor do source.
set +u
# shellcheck disable=SC1090
source "$HOME/nodevenv/domains/workspace.medconsultoria.com.br/public_html/20/bin/activate"
set -u

# Parse robusto do DATABASE_URL (node lida com URL-encoding na senha).
export MYSQL_PWD="$(node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).password)')"
DBU="$(node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).username)')"
DBH="$(node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).hostname)')"
DBP="$(node -e 'process.stdout.write(String(new URL(process.env.DATABASE_URL).port||3306))')"
DBN="$(node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).pathname.slice(1))')"

mkdir -p "$BACKUPS"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUPS/auto-db-$TS.sql.gz"

# --single-transaction: dump consistente do InnoDB sem travar as tabelas.
mysqldump --no-tablespaces --single-transaction --quick -h "$DBH" -P "$DBP" -u "$DBU" "$DBN" | gzip > "$OUT"
echo "[$(date '+%F %T')] backup OK: $OUT ($(du -h "$OUT" | cut -f1))"

# Rotação: mantém os KEEP mais recentes; apaga o resto.
ls -1t "$BACKUPS"/auto-db-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "[$(date '+%F %T')] rotacao: $(ls -1 "$BACKUPS"/auto-db-*.sql.gz 2>/dev/null | wc -l) backups automaticos mantidos"
