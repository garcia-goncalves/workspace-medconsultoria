#!/usr/bin/env bash
# ⚠️ SÓ PARA VPS DEDICADA E VAZIA. A VPS OVH atual é COMPARTILHADA com outros projetos, tem
# SSH na porta 3119 e nginx do host nas 80/443 — este script NÃO roda lá: ele libera só a
# porta 22 antes de ligar o firewall (tranca a 3119 para fora) e reescreve o sshd de todos.
#
# Prepara o VPS do zero (ADR-154). Rode NO SERVIDOR, como root, UMA vez:
#
#   bash bootstrap.sh
#
# Ele NÃO sobe a aplicação — só deixa a máquina pronta e diz o que falta. Subir é
# `docker compose up -d`, depois que o .env estiver preenchido e a imagem acessível.
#
# É idempotente: rodar de novo não estraga nada. Cada passo confere antes de agir.
set -euo pipefail

ALVO="/srv/medconsultoria"
USUARIO="${SUDO_USER:-med}"

echo "── 1/5 · Pacotes e atualizações de segurança automáticas"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl unattended-upgrades fail2ban ufw
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "── 2/5 · Firewall: só 22, 80 e 443"
ufw allow OpenSSH >/dev/null
ufw allow 80,443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status numbered | head -8

echo "── 3/5 · Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
else
  echo "já instalado: $(docker --version)"
fi
id "$USUARIO" >/dev/null 2>&1 && usermod -aG docker "$USUARIO" || true
systemctl enable --now docker

echo "── 4/5 · Pastas em $ALVO"
mkdir -p "$ALVO"/{uploads,backups}
# Os uploads são escritos pelo usuário `node` da imagem (uid 1000) — o mesmo uid do usuário
# comum do Debian. Sem isto o app sobe e falha no primeiro upload, com EACCES.
chown -R 1000:1000 "$ALVO/uploads"
id "$USUARIO" >/dev/null 2>&1 && chown -R "$USUARIO":"$USUARIO" "$ALVO/backups" || true
ls -la "$ALVO"

echo "── 5/5 · SSH: sem root, sem senha"
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sshd -t && systemctl restart ssh
echo "ok"

cat <<'FIM'

════════════════════════════════════════════════════════════════════════════
A MÁQUINA ESTÁ PRONTA. Falta o que não dá para adivinhar:

1. Copiar para /srv/medconsultoria/ os três arquivos do repositório:
      infra/ovh/docker-compose.yml
      infra/ovh/Caddyfile
      infra/ovh/.env.example   → renomeado para .env, preenchido, chmod 600

   ⚠️ As duas chaves de cifra (PACIENTE_CRYPTO_KEY e EMAIL_CRYPTO_KEY) são COPIADAS
      do .env da produção antiga. Gerar novas = dado de paciente ilegível.

2. Entrar no registry para poder baixar a imagem (ela é privada):
      docker login ghcr.io -u SEU_USUARIO_GITHUB
      (a senha é um token do GitHub com permissão read:packages)

3. Subir, nesta ordem, cada comando por vez:
      docker compose pull
      docker compose run --rm app npm run prisma:deploy
      docker compose up -d

4. Conferir com resposta HTTP lida, não com "parece que subiu":
      curl -s localhost/health   (ou https://SEU_DOMINIO/health se o DNS já aponta)

O certificado do Caddy só é emitido quando o DNS do domínio JÁ aponta para esta máquina.
Antes do cutover, use o subdomínio de homologação.
════════════════════════════════════════════════════════════════════════════
FIM
