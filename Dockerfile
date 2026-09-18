# Imagem de produção do Workspace MedConsultoria (ADR-154).
#
# A RAZÃO DE EXISTIR DESTE ARQUIVO: até 12/09/2026 as dependências de produção eram resolvidas
# DENTRO do servidor, a cada deploy (`npm ci` por SSH). Isso travou duas vezes no mesmo dia, sem
# log, com o front novo já servido contra o back velho. Aqui o `npm ci` roda no build — onde
# falhar é barato, o log é legível e ninguém está esperando na tela.
#
# Três estágios, de propósito:
#   build   — o monorepo inteiro (pnpm + turbo) para montar `apps/api/dist`
#   deps    — `npm ci` do artefato COM compilador, para o argon2 nativo
#   runtime — só o que roda: sem pnpm, sem compilador, sem código-fonte
#
# ⚠️ O Prisma precisa de `openssl` até no estágio final: sem ele o Client sobe com
# "Unable to require libquery_engine" e o app morre no boot.

# ── 1. build: monta o artefato auto-contido ──────────────────────────────────────────────────
FROM node:20.20.2-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /app
COPY . .
# O mesmo par que o deploy.sh/deploy.yml já rodavam: montar e CONFERIR o artefato (ADR-116/117).
# O conferidor prova que o lockfile viajou, que os overrides foram traduzidos para a sintaxe do
# npm e que o `npm ci` aceita esse lock — ensaiado a seco, antes de valer.
RUN pnpm install --frozen-lockfile \
 && pnpm build:deploy \
 && node scripts/conferir-artefato.mjs

# ── 2. deps: instala as dependências de runtime do artefato ──────────────────────────────────
FROM node:20.20.2-bookworm-slim AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 build-essential \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Só o que o `npm ci` precisa ler — assim mudar código do app não invalida esta camada.
COPY --from=build /app/apps/api/dist/package.json      ./package.json
COPY --from=build /app/apps/api/dist/package-lock.json ./package-lock.json
COPY --from=build /app/apps/api/dist/prisma            ./prisma
# `npm ci`, nunca `npm install` (ADR-116): recusa rodar se o lock discordar do package.json.
RUN npm ci --omit=dev && npm run prisma:generate

# ── 3. runtime: o que vai para o ar ──────────────────────────────────────────────────────────
FROM node:20.20.2-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
# `--chown` na cópia, NUNCA `chown -R` depois: numa camada nova o chown recursivo REGRAVA cada
# arquivo (~1 GB de node_modules). No disco da VPS compartilhada isso ficou 70 min sem terminar
# em 18/09/2026; com `--chown` o passo sumiu.
COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./
# Os uploads moram FORA de /app, em caminho absoluto: o próprio app recusa subir em produção
# com UPLOADS_DIR relativo ("deve ser um caminho ABSOLUTO e persistente, fora do diretório do
# deploy"). E é volume porque arquivo dentro do container some na primeira troca de imagem.
RUN mkdir -p /dados/uploads && chown node:node /app && chown -R node:node /dados
USER node
EXPOSE 4319

# Prova de vida, e é ela que decide se o tráfego troca: o `docker compose up -d` não encaminha
# para um container que não respondeu. É o ensaio de boot do deploy antigo, agora contínuo.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:4319/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "app.cjs"]
