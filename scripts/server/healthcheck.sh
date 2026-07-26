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
ALERT_TO="root@medconsultoria.com.br"        # quem recebe o aviso de "app fora"
ALERT_FROM="sistema@medconsultoria.com.br"   # remetente (domínio da conta, p/ não cair em spam)
COOLDOWN_FILE="$HOME/domains/workspace.medconsultoria.com.br/backups/.last-alert"
COOLDOWN_SEG=1800                            # não repetir o e-mail por 30 min

check() { curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$URL" 2>/dev/null || echo "000"; }

# Envia e-mail ao ROOT, respeitando o cooldown (evita spam se ficar caído). Usa o MTA local
# (sendmail), que funciona MESMO com o app fora — é justamente o ponto cego dos monitores internos.
alertar() {
  local agora ultimo
  agora="$(date +%s)"
  ultimo=0
  [ -f "$COOLDOWN_FILE" ] && ultimo="$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)"
  if [ $((agora - ultimo)) -ge "$COOLDOWN_SEG" ] && command -v sendmail >/dev/null 2>&1; then
    printf 'From: Workspace Monitor <%s>\nTo: %s\nSubject: [Workspace] App fora do ar (HTTP %s) — restart disparado\n\nO health-check detectou o app fora do ar em %s e disparou o restart automatico.\n\nVerifique a pagina SISTEMA > Operacao: %s\n' \
      "$ALERT_FROM" "$ALERT_TO" "$1" "$(date '+%F %T %Z')" "https://workspace.medconsultoria.com.br/sistema" \
      | /usr/sbin/sendmail -t 2>/dev/null && echo "$agora" > "$COOLDOWN_FILE"
  fi
}

code="$(check)"
if [ "$code" != "200" ]; then
  sleep 5
  code2="$(check)"
  if [ "$code2" != "200" ]; then
    mkdir -p "$APP/tmp"
    touch "$APP/tmp/restart.txt"
    echo "[$(date '+%F %T')] DOWN (HTTP $code/$code2) -> restart disparado + alerta ao ROOT" >> "$LOG"
    alertar "$code2"
  else
    echo "[$(date '+%F %T')] recuperou na 2a tentativa (HTTP $code -> $code2)" >> "$LOG"
  fi
fi

# Quando está OK não loga nada (evita log gigante). Trunca o log se crescer demais.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 500 ]; then
  tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
