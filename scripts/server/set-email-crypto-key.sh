#!/usr/bin/env bash
# Gera a EMAIL_CRYPTO_KEY no .env de PRODUÇÃO (ADR-95). Roda NO SERVIDOR.
#
# É ela que cifra a senha das caixas que cada pessoa pluga em /email (AES-256-GCM). Sem ela o
# módulo de e-mail fica desligado — o resto da aplicação funciona normalmente.
#
# Três cuidados, e cada um existe por um motivo:
#
#  1. **NUNCA imprime o valor.** Nem em sucesso, nem em erro. Quem precisar ver, abre a linha do
#     .env no servidor. Imprimir jogaria o segredo no terminal, no scrollback e no transcript de
#     quem estivesse acompanhando — mesmo critério do `pnpm senha:rotacionar` (ADR-98).
#  2. **Recusa sobrescrever uma chave que já existe.** Trocar a chave torna ILEGÍVEL toda senha de
#     caixa já guardada: todo mundo teria de replugar. Se a intenção for mesmo trocar, apague a
#     linha à mão e rode de novo — o passo tem de ser deliberado, não um efeito colateral.
#  3. **Copia o .env antes de tocar nele.** A cópia herda permissão 600 e fica ao lado, com
#     carimbo de data. Se algo der errado, o arquivo original está a um `cp` de distância.
set -euo pipefail

ALVO="${1:-$PWD}"
cd "$ALVO"

if [ ! -f .env ]; then
  echo "ERRO: não achei um .env em $PWD." >&2
  echo "Rode este script dentro do Application Root (onde ficam server.js e app.cjs)." >&2
  exit 1
fi

if grep -q '^EMAIL_CRYPTO_KEY=' .env; then
  echo "A EMAIL_CRYPTO_KEY JÁ existe neste .env — não vou mexer."
  echo "Trocá-la tornaria ilegíveis as senhas de caixa já guardadas (todos teriam de replugar)."
  echo "Se a troca for mesmo o que você quer, apague a linha à mão e rode este script de novo."
  exit 0
fi

CARIMBO="$(date +%Y%m%d-%H%M%S)"
cp -p .env ".env.bak-${CARIMBO}"
chmod 600 ".env.bak-${CARIMBO}"
echo "Cópia de segurança: .env.bak-${CARIMBO}"

# 32 bytes aleatórios em base64 — o tamanho que o AES-256-GCM exige. O valor vai direto do node
# para o arquivo, sem passar por variável de ambiente nem pela tela.
node -e 'const c=require("crypto");process.stdout.write("EMAIL_CRYPTO_KEY=\""+c.randomBytes(32).toString("base64")+"\"\n")' >> .env

# Confere só a FORMA (existe? tem o tamanho certo?), nunca o conteúdo.
if [ "$(grep -c '^EMAIL_CRYPTO_KEY=' .env)" != "1" ]; then
  echo "ERRO: a linha não foi gravada como esperado. Restaurando a cópia." >&2
  cp -p ".env.bak-${CARIMBO}" .env
  exit 1
fi
TAM=$(grep '^EMAIL_CRYPTO_KEY=' .env | sed 's/^EMAIL_CRYPTO_KEY=//; s/"//g' | tr -d '\n' | wc -c)
echo "Chave gravada. Tamanho em base64: ${TAM} caracteres (o esperado para 32 bytes é 44)."

echo
echo "FALTA REINICIAR para a aplicação enxergar a chave:"
echo "   touch tmp/restart.txt"
