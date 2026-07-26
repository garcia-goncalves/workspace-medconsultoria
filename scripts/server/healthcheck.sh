#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Health-check + auto-restart — SERVIDOR (TineHost).
# Instalado em ~/domains/workspace.medconsultoria.com.br/ops/ e chamado por cron
# a CADA 5 MIN. Se /health não responder 200, tenta de novo e, persistindo,
# dispara o restart do app (touch tmp/restart.txt) e registra no log.
#
# Isto cobre o app TRAVADO/caído. NÃO cobre queda total do servidor — para isso,
# recomenda-se um monitor EXTERNO (ex.: UptimeRobot), que é ação do dono.
# Ver docs/DEPLOY.md § Backup & monitoramento.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

URL="https://workspace.medconsultoria.com.br/health"
APP="$HOME/domains/workspace.medconsultoria.com.br/public_html"
LOG="$HOME/domains/workspace.medconsultoria.com.br/backups/health.log"

check() { curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$URL" 2>/dev/null || echo "000"; }

code="$(check)"
if [ "$code" != "200" ]; then
  sleep 5
  code2="$(check)"
  if [ "$code2" != "200" ]; then
    mkdir -p "$APP/tmp"
    touch "$APP/tmp/restart.txt"
    echo "[$(date '+%F %T')] DOWN (HTTP $code/$code2) -> restart disparado" >> "$LOG"
  else
    echo "[$(date '+%F %T')] recuperou na 2a tentativa (HTTP $code -> $code2)" >> "$LOG"
  fi
fi

# Quando está OK não loga nada (evita log gigante). Trunca o log se crescer demais.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 500 ]; then
  tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
