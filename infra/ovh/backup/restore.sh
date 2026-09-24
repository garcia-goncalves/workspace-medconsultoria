#!/usr/bin/env bash
# ENSAIO DE RESTAURAÇÃO: pega um backup do bucket, decifra, carrega num MySQL DESCARTÁVEL e
# confere contra o manifesto. Não toca na produção — nem no banco, nem nos uploads, nem no compose.
#
# POR QUE EXISTE: "backup nunca restaurado é esperança, não garantia" (docs/MIGRACAO_OVH.md,
# Fase 5). A pergunta que este script responde não é "o arquivo existe?", é "se a VPS sumisse
# hoje, eu conseguiria voltar com ISTO?" — e em quanto tempo.
#
# Isolamento do banco descartável, e por quê:
#   --network none   → não fala com ninguém; um erro de digitação não alcança a produção.
#   --tmpfs          → dados em memória (ENSAIO_TMPFS_TAMANHO): não disputa o disco da VPS
#                      compartilhada, e some sozinho quando o container morre.
#   nome próprio     → medconsultoria-ensaio-<carimbo>, removido no fim mesmo se algo falhar.
#
# Uso:
#   restore.sh                      o backup diário mais novo do bucket
#   restore.sh <nome.tar.enc>       um backup específico de diario/ (ou semanal/<nome>, mensal/<nome>)
#   restore.sh /caminho/local.tar.enc   um arquivo já baixado
# Saída: 0 = restaurou e conferiu; 1 = falhou (o motivo está na última linha "!!").
#
# ⚠️ RESTAURAR A PRODUÇÃO DE VERDADE NÃO É ISTO. É um procedimento manual, com janela e com a
# aplicação parada, descrito em docs/OPERACAO_OVH.md — de propósito sem atalho em script.

set -Eeuo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=comum.sh
source "$AQUI/comum.sh"

carregar_config
exigir_comandos
baixar_prioridade

ALVO="${1:-}"
BASE="$PROJETO_DIR/backup"
mkdir -p "$BASE"
TMP="$(mktemp -d "$BASE/ensaio.XXXXXX")"
CONTAINER="medconsultoria-ensaio-$(date -u +%Y%m%d%H%M%S)"
INICIO="$(date +%s)"
terminar() {
  local codigo=$?
  docker rm -f "$CONTAINER" >/dev/null 2>&1 </dev/null || true
  rm -rf "$TMP"
  if [ "$codigo" -eq 0 ]; then
    log "ENSAIO OK — restaurado e conferido em $(( $(date +%s) - INICIO )) s"
  else
    log "ENSAIO FALHOU (código $codigo) depois de $(( $(date +%s) - INICIO )) s"
  fi
  exit "$codigo"
}
trap terminar EXIT

# ── 1. Obter o arquivo ──────────────────────────────────────────────────────────────────────
if [ -n "$ALVO" ] && [ -f "$ALVO" ]; then
  log "1/5 · arquivo local: $ALVO"
  cp "$ALVO" "$TMP/backup.tar.enc"
  [ -f "$ALVO.sha256" ] && (cd "$TMP" && sed "s|  .*|  backup.tar.enc|" "$ALVO.sha256" > backup.tar.enc.sha256)
else
  if [ -z "$ALVO" ]; then
    ALVO="$(rclone_ -- lsf --files-only "$DESTINO/diario/" | grep -E '^medconsultoria-[0-9]{8}-[0-9]{6}Z\.tar\.enc$' | sort | tail -n 1 || true)"
    [ -n "$ALVO" ] || falhar "não há backup nenhum em $BACKUP_PREFIXO/diario/ no bucket"
  fi
  case "$ALVO" in */*) CAMINHO="$ALVO" ;; *) CAMINHO="diario/$ALVO" ;; esac
  [[ "$CAMINHO" =~ ^(diario|semanal|mensal)/medconsultoria-[0-9]{8}-[0-9]{6}Z\.tar\.enc$ ]] \
    || falhar "nome de backup inválido: '$ALVO'"
  log "1/5 · baixando $CAMINHO"
  rclone_ -v "$TMP:/dados" -- copyto "$DESTINO/$CAMINHO" /dados/backup.tar.enc
  rclone_ -v "$TMP:/dados" -- copyto "$DESTINO/$CAMINHO.sha256" /dados/remoto.sha256 || true
  if [ -f "$TMP/remoto.sha256" ]; then
    sed "s|  .*|  backup.tar.enc|" "$TMP/remoto.sha256" > "$TMP/backup.tar.enc.sha256"
  fi
fi

# ── 2. Integridade e decifra ────────────────────────────────────────────────────────────────
# O .sha256 é conferido ANTES de decifrar: `openssl enc` não autentica, então é aqui que um
# arquivo corrompido ou adulterado é pego (ver o porquê em backup.sh, passo 4).
if [ -f "$TMP/backup.tar.enc.sha256" ]; then
  (cd "$TMP" && sha256sum -c --quiet backup.tar.enc.sha256) || falhar "o sha256 NÃO confere — arquivo corrompido ou adulterado"
  log "2/5 · sha256 confere"
else
  log "2/5 · aviso: sem .sha256 ao lado do backup — integridade não conferida"
fi
openssl enc -d "${CIFRA_ARGS[@]}" -pass "file:$CHAVE_ARQ" -in "$TMP/backup.tar.enc" | tar -C "$TMP" -xf - \
  || falhar "não decifrou — a chave instalada não é a que cifrou este backup, ou o arquivo está corrompido"
rm -f "$TMP/backup.tar.enc"
for f in manifesto.txt banco.sql.gz uploads.tar; do
  [ -f "$TMP/$f" ] || falhar "o backup não tem '$f'"
done
grep -q "^formato $FORMATO\$" "$TMP/manifesto.txt" || falhar "formato de backup desconhecido (este script entende o $FORMATO)"
log "     backup de $(awk '/^criado_em /{print $2}' "$TMP/manifesto.txt"), banco '$(awk '/^banco /{print $2}' "$TMP/manifesto.txt")'"

# ── 3. MySQL descartável ────────────────────────────────────────────────────────────────────
# Senha sorteada agora, só para este container; entra por `-e NOME` (valor lido do ambiente,
# fora do `ps`) e morre com ele.
log "3/5 · subindo MySQL descartável ($CONTAINER)"
MYSQL_ROOT_PASSWORD="$(openssl rand -hex 24)"
export MYSQL_ROOT_PASSWORD
TMPFS_ARGS=()
[ -n "$ENSAIO_TMPFS_TAMANHO" ] && TMPFS_ARGS=(--tmpfs "/var/lib/mysql:rw,size=$ENSAIO_TMPFS_TAMANHO")
docker run -d --name "$CONTAINER" --network none --label medconsultoria.ensaio=1 \
  -e MYSQL_ROOT_PASSWORD "${TMPFS_ARGS[@]}" "$MYSQL_IMAGEM" \
  --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci </dev/null >/dev/null
unset MYSQL_ROOT_PASSWORD
# ⚠️ "mysqladmin ping" responde durante a INICIALIZAÇÃO, quando a imagem sobe um servidor
# temporário sem rede (porta 0) para criar o root — e depois o derruba. Carregar dados nesse
# servidor é perdê-los. O sinal certo é o servidor definitivo dizendo "ready for connections"
# na porta 3306.
PRONTO=""
for _ in $(seq 1 90); do
  if docker logs "$CONTAINER" 2>&1 </dev/null | grep -q 'ready for connections.*port: 3306'; then PRONTO=1; break; fi
  docker ps -q -f "name=^${CONTAINER}\$" </dev/null | grep -q . || falhar "o MySQL descartável morreu ao subir (pouca memória para o tmpfs? ver ENSAIO_TMPFS_TAMANHO)"
  sleep 2
done
[ -n "$PRONTO" ] || falhar "o MySQL descartável não ficou pronto em 180 s"

# ── 4. Carregar ─────────────────────────────────────────────────────────────────────────────
log "4/5 · carregando o dump"
sql_no_ensaio() { docker exec -i "$CONTAINER" sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql -uroot "$@"' _ "$@"; }
sql_no_ensaio -e "CREATE DATABASE ensaio CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" </dev/null
gzip -dc "$TMP/banco.sql.gz" | sql_no_ensaio ensaio || falhar "o dump não carregou no MySQL descartável"

# ── 5. Conferir ─────────────────────────────────────────────────────────────────────────────
log "5/5 · conferindo contra o manifesto"
sql_no_ensaio -N -B ensaio <<< "$SQL_CONTAGEM" | tr '\t' ' ' | grep '^tabela ' | sort > "$TMP/restaurado.txt"
grep '^tabela ' "$TMP/manifesto.txt" | sort > "$TMP/esperado.txt"

ERROS=0
T_ESP="$(wc -l < "$TMP/esperado.txt")"
T_RES="$(wc -l < "$TMP/restaurado.txt")"
log "     tabelas: $T_RES restauradas / $T_ESP no manifesto"
[ "$T_ESP" = "$T_RES" ] || { log "!! número de tabelas diferente"; ERROS=$((ERROS + 1)); }
# Linha a linha: faltou tabela = falha; tabela com linhas que voltou VAZIA = falha; diferença
# pequena de contagem = aviso (escrita entre o dump e a contagem do manifesto, ver backup.sh).
TOTAL=0
while read -r _ tabela esperado; do
  restaurado="$(awk -v t="$tabela" '$2 == t {print $3}' "$TMP/restaurado.txt")"
  if [ -z "$restaurado" ]; then
    log "!! tabela '$tabela' não existe na restauração"; ERROS=$((ERROS + 1)); continue
  fi
  TOTAL=$((TOTAL + restaurado))
  if [ "$esperado" -gt 0 ] && [ "$restaurado" -eq 0 ]; then
    log "!! tabela '$tabela' tinha $esperado linhas e voltou VAZIA"; ERROS=$((ERROS + 1))
  elif [ "$esperado" != "$restaurado" ]; then
    log "     aviso: '$tabela' $restaurado linhas (manifesto: $esperado)"
  fi
done < "$TMP/esperado.txt"
log "     linhas restauradas: $TOTAL"
MIGR="$(sql_no_ensaio -N -B ensaio -e "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL" </dev/null 2>/dev/null || echo 0)"
log "     migrações aplicadas no banco restaurado: $MIGR"
[ "$MIGR" -gt 0 ] || { log "!! o banco restaurado não tem migração nenhuma registrada"; ERROS=$((ERROS + 1)); }

A_ESP="$(awk '/^arquivos_uploads /{print $2}' "$TMP/manifesto.txt")"
A_RES="$(tar -tf "$TMP/uploads.tar" | grep -vc '/$' || true)"
log "     uploads: $A_RES arquivos no pacote / $A_ESP no manifesto"
[ "$A_ESP" = "$A_RES" ] || { log "!! número de arquivos de upload diferente"; ERROS=$((ERROS + 1)); }

[ "$ERROS" -eq 0 ] || falhar "$ERROS problema(s) na conferência — este backup NÃO restaura inteiro"
