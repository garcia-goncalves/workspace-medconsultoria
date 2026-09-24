# shellcheck shell=bash disable=SC2034
# (SC2034: CIFRA_ARGS, FORMATO, DESTINO e SQL_CONTAGEM são lidas por quem faz `source` deste arquivo.)
# Peças comuns ao backup.sh e ao restore.sh. Não é executado sozinho: `source comum.sh`.
#
# ⚠️ REGRA QUE VALE PARA TUDO AQUI: NENHUM SEGREDO É IMPRESSO, NEM VAI PARA A LINHA DE COMANDO.
# A VPS é compartilhada — o que passa por argumento aparece no `ps` de quem mais estiver na
# máquina, e o log fica em disco. Por isso:
#   - a senha do root do banco nunca sai do container do mysql (é lida lá dentro, de
#     $MYSQL_ROOT_PASSWORD, e entregue ao cliente por MYSQL_PWD);
#   - as chaves do bucket vão para o container do rclone com `-e NOME` (só o nome: o Docker lê o
#     valor do ambiente deste processo), nunca `-e NOME=valor`;
#   - a chave de cifra é lida de ARQUIVO (`-pass file:`), nunca de argumento.

RCLONE_IMAGEM="${RCLONE_IMAGEM:-rclone/rclone:1.71}"
MYSQL_IMAGEM="${MYSQL_IMAGEM:-mysql:8.4}"
ALPINE_IMAGEM="${ALPINE_IMAGEM:-alpine:3}"
CONF_DIR="${BACKUP_CONF_DIR:-$HOME/.config/medconsultoria-backup}"
CHAVE_ARQ="$CONF_DIR/chave"
# Parâmetros da cifra. ⚠️ Mudar qualquer um torna os backups ANTIGOS ilegíveis com o comando novo:
# o restore.sh teria de saber qual versão usar. Se mudar, suba FORMATO e trate os dois.
CIFRA_ARGS=(-aes-256-cbc -salt -pbkdf2 -iter 200000 -md sha256)
FORMATO=1

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
falhar() { log "!! $*"; exit 1; }

# Lê o backup.env linha a linha — NÃO faz `source`. Arquivo de configuração não deve poder
# executar comando, e `source` executaria qualquer `$(...)` escrito num valor.
carregar_config() {
  local arq="$CONF_DIR/backup.env" linha nome valor
  [ -f "$arq" ] || falhar "configuração não encontrada em $arq (ver infra/ovh/backup/backup.env.example)"
  [ -f "$CHAVE_ARQ" ] || falhar "chave de cifra não encontrada em $CHAVE_ARQ"
  # Permissão 600 conferida, não presumida: chave legível por outro usuário da máquina
  # compartilhada é backup que outra pessoa decifra.
  for f in "$arq" "$CHAVE_ARQ"; do
    case "$(stat -c '%a' "$f")" in
      600|400) ;;
      *) falhar "$f precisa de permissão 600 (chmod 600 '$f')" ;;
    esac
  done
  while IFS= read -r linha || [ -n "$linha" ]; do
    linha="${linha%$'\r'}"
    case "$linha" in ''|'#'*) continue ;; esac
    nome="${linha%%=*}"
    valor="${linha#*=}"
    [[ "$nome" =~ ^[A-Z_][A-Z0-9_]*$ ]] || falhar "linha inválida em $arq (esperado CHAVE=valor): '$nome'"
    export "$nome=$valor"
  done < "$arq"

  : "${PROJETO_DIR:=$HOME/medconsultoria}"
  : "${VOLUME_UPLOADS:=medconsultoria_uploads}"
  : "${BACKUP_PREFIXO:=medconsultoria}"
  : "${MANTER_DIARIOS:=7}" "${MANTER_SEMANAIS:=4}" "${MANTER_MENSAIS:=12}"
  : "${ENSAIO_TMPFS_TAMANHO=1g}"
  [ -n "${BACKUP_BUCKET:-}" ] || falhar "BACKUP_BUCKET vazio em $arq"
  for n in RCLONE_CONFIG_DESTINO_TYPE RCLONE_CONFIG_DESTINO_ENDPOINT RCLONE_CONFIG_DESTINO_ACCESS_KEY_ID RCLONE_CONFIG_DESTINO_SECRET_ACCESS_KEY; do
    [ -n "${!n:-}" ] || falhar "$n vazio em $arq"
  done
  for n in MANTER_DIARIOS MANTER_SEMANAIS MANTER_MENSAIS; do
    [[ "${!n}" =~ ^[1-9][0-9]*$ ]] || falhar "$n precisa ser um número >= 1"
  done
  DESTINO="destino:$BACKUP_BUCKET/$BACKUP_PREFIXO"
}

exigir_comandos() {
  local c
  for c in docker gzip openssl sha256sum tar stat; do
    command -v "$c" >/dev/null || falhar "falta o comando '$c' na VPS"
  done
  # -pbkdf2 só existe a partir do OpenSSL 1.1.1. Sem ele a cifra cairia no derivador antigo
  # (uma rodada de MD5), que é o que o próprio OpenSSL chama de inseguro.
  openssl enc -help 2>&1 | grep -q pbkdf2 || falhar "o openssl desta máquina não tem -pbkdf2 (precisa >= 1.1.1)"
}

# ⚠️ Prioridade BAIXA, e não OCIOSA, de propósito. Em 21/09/2026 um vizinho saturou o disco
# (iowait 60%, carga 186). Com `ionice -c3` (ocioso) o backup, num disco que nunca fica ocioso,
# NUNCA terminaria; com `-c2 -n7` ele anda devagar sem roubar a vez de ninguém.
# Os filhos herdam (gzip, openssl, tar). O que roda DENTRO dos containers não é filho deste
# shell, e por isso o mysqldump recebe o mesmo tratamento lá dentro (ver backup.sh).
baixar_prioridade() {
  renice -n 10 -p $$ >/dev/null 2>&1 || true
  ionice -c2 -n7 -p $$ >/dev/null 2>&1 || true
}

# O banco que o APP usa de verdade, lido da DATABASE_URL do .env do projeto — e não o
# MYSQL_DATABASE. ⚠️ Na OVH eles DIVERGEM: o app usa `medconsultoria_prod`, e `medconsultoria`
# é o banco vazio que ficou como volta atrás da importação de 13/09/2026. Fazer backup pelo
# MYSQL_DATABASE seria guardar, todo dia, um banco vazio — e só descobrir no dia da restauração.
# Só o NOME do banco sai daqui; a URL (que tem a senha) nunca é impressa.
nome_do_banco() {
  local nome
  if [ -n "${BANCO:-}" ]; then
    nome="$BANCO"
  else
    nome="$(grep -m1 '^DATABASE_URL=' "$PROJETO_DIR/.env" \
      | sed -E 's/^DATABASE_URL=//; s/^["'\'']//; s/["'\'']$//; s/\?.*$//; s|^.*/||')" || true
  fi
  [[ "$nome" =~ ^[A-Za-z0-9_]+$ ]] || falhar "não consegui ler o nome do banco da DATABASE_URL em $PROJETO_DIR/.env (ou defina BANCO= no backup.env)"
  printf '%s' "$nome"
}

# Uma linha "tabela <nome> <linhas>" por tabela, numa ida só ao banco (um SELECT COUNT(*) por
# tabela, juntos por UNION ALL e preparados no servidor). Contagem EXATA, não a estimativa do
# information_schema, que no InnoDB pode errar por dezenas de por cento.
SQL_CONTAGEM="SET SESSION group_concat_max_len = 1000000;
SELECT GROUP_CONCAT(CONCAT('SELECT ''tabela'', ''', table_name, ''', COUNT(*) FROM \`', table_name, '\`') ORDER BY table_name SEPARATOR ' UNION ALL ')
  INTO @q FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';
PREPARE s FROM @q; EXECUTE s; DEALLOCATE PREPARE s;"

# rclone em container, com a configuração do destino inteira por variável de ambiente.
# Uso: rclone_ [-v dir:/dados[:ro]] -- <argumentos do rclone>
rclone_() {
  local montagens=()
  while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do montagens+=("$1"); shift; done
  [ "${1:-}" = "--" ] && shift
  local envs=() n
  for n in $(compgen -e | grep '^RCLONE_CONFIG_DESTINO_'); do envs+=(-e "$n"); done
  # --user: arquivo baixado nasce do usuário da VPS, não do root do container (senão ninguém
  # consegue apagar a pasta temporária depois). HOME=/tmp porque esse usuário não existe lá.
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e RCLONE_CONFIG=/tmp/sem-arquivo.conf \
    "${envs[@]}" "${montagens[@]}" "$RCLONE_IMAGEM" \
    --s3-no-check-bucket --retries 3 --low-level-retries 5 -q "$@" </dev/null
}

ping_healthcheck() { # $1 = "" (sucesso) ou "/fail"
  [ -n "${HEALTHCHECK_PING_URL:-}" ] || return 0
  curl -fsS -m 15 --retry 3 -o /dev/null "${HEALTHCHECK_PING_URL}${1:-}" || log "aviso: ping do healthcheck falhou"
}
