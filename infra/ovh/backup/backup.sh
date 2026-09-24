#!/usr/bin/env bash
# Backup do Workspace MedConsultoria na VPS OVH: banco + uploads, cifrado, para FORA da máquina.
#
# POR QUE EXISTE: até 24/09/2026 a produção na OVH não tinha backup nenhum que saísse da VPS — e
# "backup que mora no mesmo VPS não é backup" (docs/MIGRACAO_OVH.md, Fase 5). A VPS é
# compartilhada com outros projetos; um disco perdido, uma reinstalação ou um vizinho
# comprometido (o inkflow-app, 18/09/2026) levaria junto todo dado de cliente e de paciente.
#
# O QUE FAZ, cada passo com o próprio código de saída (nada encadeado que esconda falha):
#   1. mysqldump CONSISTENTE (--single-transaction) do banco que o app usa de verdade
#   2. contagem exata de linhas por tabela → manifesto (é contra ele que o ensaio confere)
#   3. tar do volume de uploads (lido por um container descartável, sem precisar de root)
#   4. junta tudo, cifra (AES-256 + PBKDF2, chave em arquivo 600 fora do repositório) e
#      autentica (HMAC-SHA256 em <nome>.hmac, chave derivada da mesma)
#   5. envia ao bucket S3-compatível (rclone em container: nada instalado na VPS)
#   6. aplica a retenção NO DESTINO (diários / semanais / mensais)
#
# Uso: backup.sh            (é o que o cron chama)
# Saída: 0 = backup enviado; diferente de 0 = falhou (e o Healthchecks, se configurado, é avisado).
# Log: $PROJETO_DIR/backup/logs/backup-<data>.log e, sempre, $PROJETO_DIR/backup/ultimo.log.

set -Eeuo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=comum.sh
source "$AQUI/comum.sh"

carregar_config
exigir_comandos
baixar_prioridade

BASE="$PROJETO_DIR/backup"
mkdir -p "$BASE/logs"
chmod 700 "$BASE"
CARIMBO="$(date -u +%Y%m%d-%H%M%SZ)"
LOG="$BASE/logs/backup-$CARIMBO.log"
# Tudo o que sai daqui vai para a tela E para o log. ⚠️ Nada neste script imprime segredo — é
# isso que torna seguro guardar o log.
exec > >(tee -a "$LOG") 2>&1

# Uma execução por vez. Dois backups simultâneos disputariam o mesmo disco já disputado, e o
# segundo subiria um arquivo com o mesmo minuto no nome.
if command -v flock >/dev/null; then
  exec 9>"$BASE/.trava"
  flock -n 9 || { log "outro backup já está rodando — este não faz nada"; exit 3; }
fi

TMP="$(mktemp -d "$BASE/tmp.XXXXXX")"
terminar() {
  local codigo=$?
  rm -rf "$TMP"
  if [ "$codigo" -eq 0 ]; then
    log "BACKUP OK"
    ping_healthcheck ""
  else
    log "BACKUP FALHOU (código $codigo)"
    ping_healthcheck "/fail"
  fi
  cp -f "$LOG" "$BASE/ultimo.log" 2>/dev/null || true
  # Guarda os 60 logs mais novos; o resto vai embora (o disco é o gargalo da máquina).
  find "$BASE/logs" -name 'backup-*.log' -type f | sort | head -n -60 | xargs -r rm -f
  exit "$codigo"
}
trap terminar EXIT

cd "$PROJETO_DIR"
BANCO="$(nome_do_banco)"
NOME="medconsultoria-$CARIMBO.tar.enc"
log "início · banco '$BANCO' · volume '$VOLUME_UPLOADS' · destino $BACKUP_PREFIXO/"

# ── 1. Banco ────────────────────────────────────────────────────────────────────────────────
# `--single-transaction`: foto consistente sem travar as tabelas (InnoDB) — o app segue servindo.
# `--routines --triggers --events`: sem eles a restauração devolve as tabelas e perde a lógica.
# `--set-gtid-purged=OFF`: o dump restaura em QUALQUER servidor (inclusive o descartável do
# ensaio), sem exigir o mesmo histórico de GTID.
# ⚠️ `</dev/null`: `docker compose exec` lê o stdin se houver; num script chamado por cron/ssh
# ele comeria a entrada de quem chamou (a armadilha de 13/09/2026).
# ⚠️ A senha do root é lida DENTRO do container ($MYSQL_ROOT_PASSWORD, do env_file do serviço)
# e entregue por MYSQL_PWD — nunca por argumento, que apareceria no `ps`.
log "1/6 · dump do banco"
docker compose exec -T mysql sh -c '
  P=""; command -v nice >/dev/null && P="nice -n 10"
  command -v ionice >/dev/null && P="ionice -c2 -n7 $P"
  export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
  exec $P mysqldump -uroot \
    --single-transaction --quick --routines --triggers --events --hex-blob \
    --no-tablespaces --set-gtid-purged=OFF --default-character-set=utf8mb4 "$1"
' _ "$BANCO" </dev/null | gzip -6 > "$TMP/banco.sql.gz"
# Um dump que falhou no meio pode deixar um .gz válido e truncado. A última linha de um dump
# completo é sempre "-- Dump completed" — sem ela, o arquivo não serve.
gzip -dc "$TMP/banco.sql.gz" | tail -n 1 | grep -q 'Dump completed' || falhar "o dump não terminou (falta 'Dump completed' no fim)"
log "     $(du -h "$TMP/banco.sql.gz" | cut -f1) comprimido"

# ── 2. Manifesto ────────────────────────────────────────────────────────────────────────────
# ⚠️ As contagens são tiradas LOGO DEPOIS do dump, noutra transação: se alguém gravou entre
# um e outro, a diferença é de poucas linhas — o ensaio de restauração trata isso como aviso,
# não como falha. O que ele trata como falha é tabela faltando ou tabela que tinha linha e
# voltou vazia.
log "2/6 · manifesto (linhas por tabela)"
{
  echo "formato $FORMATO"
  echo "criado_em $CARIMBO"
  echo "banco $BANCO"
  docker compose exec -T mysql sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot -N -B "$1"' _ "$BANCO" \
    <<< "$SQL_CONTAGEM" | tr '\t' ' '
} > "$TMP/manifesto.txt"
TABELAS="$(grep -c '^tabela ' "$TMP/manifesto.txt" || true)"
[ "$TABELAS" -gt 0 ] || falhar "o manifesto não tem tabela nenhuma — o banco '$BANCO' está vazio ou inacessível"
log "     $TABELAS tabelas"

# ── 3. Uploads ──────────────────────────────────────────────────────────────────────────────
# Lido por um container descartável montando o volume SÓ-LEITURA: o usuário da VPS não tem
# acesso a /var/lib/docker, e não deve precisar de sudo para fazer backup.
log "3/6 · uploads (volume $VOLUME_UPLOADS)"
docker volume inspect "$VOLUME_UPLOADS" >/dev/null 2>&1 </dev/null || falhar "o volume '$VOLUME_UPLOADS' não existe"
docker run --rm -v "$VOLUME_UPLOADS":/dados:ro "$ALPINE_IMAGEM" \
  nice -n 10 tar -C /dados -cf - . </dev/null > "$TMP/uploads.tar"
ARQUIVOS="$(tar -tf "$TMP/uploads.tar" | grep -vc '/$' || true)"
echo "arquivos_uploads $ARQUIVOS" >> "$TMP/manifesto.txt"
log "     $ARQUIVOS arquivos · $(du -h "$TMP/uploads.tar" | cut -f1)"

# ── 4. Juntar e cifrar ──────────────────────────────────────────────────────────────────────
# ⚠️ Por que openssl e não `age`: o openssl já existe em toda VPS Debian/Ubuntu (nada a
# instalar), e o arquivo se decifra em qualquer máquina com OpenSSL >= 1.1.1 — inclusive a do
# dono, no dia em que a VPS não existir mais. `openssl enc` (CBC) não autentica, então a
# integridade vem de um HMAC-SHA256 do arquivo cifrado, com chave derivada da chave do backup
# (`<nome>.hmac`, ver hmac_do_arquivo em comum.sh). O restore confere o HMAC ANTES de decifrar e
# RECUSA se ele faltar ou não bater. (Até 24/09/2026 era um .sha256 sem chave, que quem tem
# escrita no bucket recalcula junto com o arquivo trocado.) Documentado em docs/OPERACAO_OVH.md.
log "4/6 · empacotar, cifrar e autenticar (HMAC)"
tar -C "$TMP" -cf - manifesto.txt banco.sql.gz uploads.tar \
  | openssl enc "${CIFRA_ARGS[@]}" -pass "file:$CHAVE_ARQ" -out "$TMP/$NOME"
printf '%s  %s\n' "$(hmac_do_arquivo "$TMP/$NOME")" "$NOME" > "$TMP/$NOME.hmac"
conferir_hmac "$TMP/$NOME" "$TMP/$NOME.hmac"
# Prova de que o arquivo decifra com a chave instalada ANTES de mandá-lo embora — backup que
# só se descobre ilegível no dia da restauração é o pior tipo.
openssl enc -d "${CIFRA_ARGS[@]}" -pass "file:$CHAVE_ARQ" -in "$TMP/$NOME" | tar -tf - >/dev/null \
  || falhar "o arquivo cifrado não decifra com a chave instalada"
log "     $NOME · $(du -h "$TMP/$NOME" | cut -f1)"

# ── 5. Enviar ───────────────────────────────────────────────────────────────────────────────
log "5/6 · enviar para o bucket"
rclone_ -v "$TMP:/dados:ro" -- copy /dados "$DESTINO/diario/" --include "$NOME" --include "$NOME.hmac"
# Domingo vira também semanal; dia 1º vira também mensal. Cópia DENTRO do provedor (o arquivo
# não volta a passar pela VPS).
if [ "$(date -u +%u)" = "7" ]; then
  rclone_ -- copyto "$DESTINO/diario/$NOME" "$DESTINO/semanal/$NOME"
  rclone_ -- copyto "$DESTINO/diario/$NOME.hmac" "$DESTINO/semanal/$NOME.hmac"
  log "     cópia semanal feita"
fi
if [ "$(date -u +%d)" = "01" ]; then
  rclone_ -- copyto "$DESTINO/diario/$NOME" "$DESTINO/mensal/$NOME"
  rclone_ -- copyto "$DESTINO/diario/$NOME.hmac" "$DESTINO/mensal/$NOME.hmac"
  log "     cópia mensal feita"
fi
# Conferência do que chegou, pelo NOME e pelo TAMANHO — "o rclone não reclamou" não é prova.
TAM_LOCAL="$(stat -c %s "$TMP/$NOME")"
TAM_REMOTO="$(rclone_ -- lsf --files-only --format s "$DESTINO/diario/" --include "$NOME")"
[ "$TAM_REMOTO" = "$TAM_LOCAL" ] || falhar "o arquivo no bucket tem '$TAM_REMOTO' bytes; o local tem $TAM_LOCAL"
# Sem o .hmac lá, o restore recusa este backup — então a falta dele é falha do backup, agora.
[ -n "$(rclone_ -- lsf --files-only "$DESTINO/diario/" --include "$NOME.hmac")" ] \
  || falhar "o $NOME.hmac não chegou ao bucket — sem ele este backup não é restaurável"
log "     conferido no bucket: $TAM_REMOTO bytes"

# ── 6. Retenção ─────────────────────────────────────────────────────────────────────────────
# Só apaga arquivo com o NOSSO padrão de nome, e só depois de o de hoje estar conferido lá.
# ⚠️ A régua é "os N mais novos", não "mais velhos que N dias": se o backup parar de rodar por
# um mês, a regra por data apagaria TUDO no dia em que voltasse; a por quantidade não apaga nada.
aplicar_retencao() { # $1 = pasta, $2 = quantos manter
  local pasta="$1" manter="$2" lista apagar a
  lista="$(rclone_ -- lsf --files-only "$DESTINO/$pasta/" | grep -E '^medconsultoria-[0-9]{8}-[0-9]{6}Z\.tar\.enc$' | sort || true)"
  apagar="$(printf '%s\n' "$lista" | sed '/^$/d' | head -n "-$manter")"
  for a in $apagar; do
    rclone_ -- deletefile "$DESTINO/$pasta/$a"
    rclone_ -- deletefile "$DESTINO/$pasta/$a.hmac" || true
    log "     retenção: apagado $pasta/$a"
  done
}
log "6/6 · retenção (diário $MANTER_DIARIOS · semanal $MANTER_SEMANAIS · mensal $MANTER_MENSAIS)"
aplicar_retencao diario "$MANTER_DIARIOS"
aplicar_retencao semanal "$MANTER_SEMANAIS"
aplicar_retencao mensal "$MANTER_MENSAIS"
