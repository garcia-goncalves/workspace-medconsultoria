#!/usr/bin/env bash
# Instala (ou reinstala) o agendamento do backup no crontab DO USUÁRIO da VPS. Idempotente:
# rodar de novo substitui as linhas marcadas, nunca duplica.
#
# POR QUE CRON DO USUÁRIO, e não systemd timer:
#   - a VPS é COMPARTILHADA e não há root garantido para este projeto. `crontab -e` do próprio
#     usuário funciona sem sudo;
#   - um timer de usuário do systemd (`systemctl --user`) só roda com a pessoa DESLOGADA se
#     alguém com root tiver feito `loginctl enable-linger <usuário>` — sem isso, o backup
#     simplesmente para de acontecer quando ninguém está conectado, em silêncio;
#   - um timer de sistema (/etc/systemd/system) exige root e mexe numa máquina que é de vários
#     projetos.
# O que o cron não dá (aviso quando falha, e quando NÃO roda) vem do Healthchecks, se
# configurado no backup.env — ver docs/OPERACAO_OVH.md.
#
# Horários (no fuso da VPS — o workflow de instalação mostra qual é):
#   backup diário ............ 06:17   (= 03:17 em Brasília se a VPS estiver em UTC)
#   ensaio de restauração .... domingo 07:47, depois do backup do dia
# Fora do horário da Thaís, e em minuto "quebrado" para não coincidir com os crons redondos
# dos vizinhos da máquina (00, 15, 30...), que disputariam o mesmo disco.

set -euo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARCA="# medconsultoria-backup"
command -v crontab >/dev/null || { echo "!! esta máquina não tem 'crontab' — ver alternativa em docs/OPERACAO_OVH.md"; exit 1; }
chmod 700 "$AQUI/backup.sh" "$AQUI/restore.sh"
mkdir -p "$AQUI/logs"

# `timeout`: backup que pendura (disco saturado, 21/09/2026) não pode ficar dias rodando nem
# segurar a trava do seguinte. PATH explícito: o cron roda com um PATH mínimo, sem /usr/local/bin.
CAMINHO="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
LINHAS="17 6 * * * $CAMINHO timeout 3h $AQUI/backup.sh >/dev/null 2>&1 $MARCA
47 7 * * 0 $CAMINHO timeout 1h $AQUI/restore.sh > $AQUI/ultimo-ensaio.log 2>&1 $MARCA"

{ crontab -l 2>/dev/null | grep -vF "$MARCA" || true; printf '%s\n' "$LINHAS"; } | crontab -
echo "agendamento instalado:"
crontab -l | grep -F "$MARCA"
echo "fuso da VPS: $(date +%Z) (agora: $(date '+%Y-%m-%d %H:%M'))"
