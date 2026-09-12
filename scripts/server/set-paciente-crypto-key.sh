#!/usr/bin/env bash
# Gera a PACIENTE_CRYPTO_KEY no .env de PRODUÇÃO (ADR-125). Roda NO SERVIDOR.
#
# É ela que cifra CPF, telefone e e-mail de PACIENTE no módulo de Conciliação (AES-256-GCM) e que
# deriva o HMAC usado para casar o mesmo paciente entre relatórios. Sem ela o módulo fica
# DESLIGADO — a tela diz isso, e o resto da aplicação funciona normalmente. Importar sem cifra
# não é opção: é dado pessoal de terceiro, e a Med é operadora dele.
#
# É irmã do `set-email-crypto-key.sh` e segue os mesmos três cuidados, mas a chave é OUTRA de
# propósito: rotacionar a do paciente não pode tornar ilegível a senha de caixa de ninguém, e
# vice-versa.
#
#  1. **NUNCA imprime o valor.** Nem em sucesso, nem em erro. Imprimir jogaria o segredo no
#     terminal, no scrollback e no transcript de quem estivesse acompanhando (ADR-98).
#  2. **Recusa sobrescrever uma chave que já existe.** Trocá-la torna ILEGÍVEL todo dado de
#     paciente já gravado — o conserto seria reimportar cada competência. Se a troca for mesmo a
#     intenção, apague a linha à mão e rode de novo: o passo tem de ser deliberado.
#  3. **Copia o .env antes de tocar nele**, com permissão 600 e carimbo de data.
set -euo pipefail

ALVO="${1:-$PWD}"
cd "$ALVO"

if [ ! -f .env ]; then
  echo "ERRO: não achei um .env em $PWD." >&2
  echo "Rode este script dentro do Application Root (onde ficam server.js e app.cjs)." >&2
  exit 1
fi

if grep -q '^PACIENTE_CRYPTO_KEY=' .env; then
  echo "A PACIENTE_CRYPTO_KEY JÁ existe neste .env — não vou mexer."
  echo "Trocá-la tornaria ilegível todo dado de paciente já importado (seria preciso reimportar"
  echo "cada competência). Se a troca for mesmo o que você quer, apague a linha à mão e rode de novo."
  exit 0
fi

CARIMBO="$(date +%Y%m%d-%H%M%S)"
cp -p .env ".env.bak-${CARIMBO}"
chmod 600 ".env.bak-${CARIMBO}"
echo "Cópia de segurança: .env.bak-${CARIMBO}"

# 32 bytes aleatórios em base64 — o tamanho que o AES-256-GCM exige. O valor vai direto do node
# para o arquivo, sem passar por variável de ambiente nem pela tela.
node -e 'const c=require("crypto");process.stdout.write("PACIENTE_CRYPTO_KEY=\""+c.randomBytes(32).toString("base64")+"\"\n")' >> .env

# Confere só a FORMA (existe? tem o tamanho certo?), nunca o conteúdo.
if [ "$(grep -c '^PACIENTE_CRYPTO_KEY=' .env)" != "1" ]; then
  echo "ERRO: a linha não foi gravada como esperado. Restaurando a cópia." >&2
  cp -p ".env.bak-${CARIMBO}" .env
  exit 1
fi
TAM=$(grep '^PACIENTE_CRYPTO_KEY=' .env | sed 's/^PACIENTE_CRYPTO_KEY=//; s/"//g' | tr -d '\n' | wc -c)
echo "Chave gravada. Tamanho em base64: ${TAM} caracteres (o esperado para 32 bytes é 44)."

echo
echo "FALTA REINICIAR para a aplicação enxergar a chave:"
echo "   touch tmp/restart.txt"
echo
echo "Depois, confira na tela: /conciliacao NÃO deve mais mostrar o aviso de módulo desligado."
