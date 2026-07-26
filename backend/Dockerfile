# syntax=docker/dockerfile:1

# Build context: raiz do monorepo (necessário para o npm workspaces
# resolver corretamente backend + frontend a partir do lockfile único).

FROM node:20-slim AS base

# openssl e ca-certificates são exigidos pela engine do Prisma
# (download do binário correto e conexões TLS durante o `prisma generate`).
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia apenas os manifests primeiro para aproveitar o cache de camadas do
# Docker: `npm ci` só é re-executado quando os package.json/lockfile mudam.
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci

# ---------------------------------------------------------------------------
# dev: estágio usado pelo docker-compose.override.yml para hot reload.
#
# Não copia o código-fonte do backend: o docker-compose.override.yml monta
# backend/ como bind mount em /app/backend, então o `tsx watch` (npm run
# dev) detecta as alterações feitas no host sem precisar parar, rebuildar
# ou recriar o container.

FROM base AS dev

ENV NODE_ENV=development

COPY backend/docker-entrypoint.dev.sh /app/docker-entrypoint.dev.sh
RUN chmod +x /app/docker-entrypoint.dev.sh

WORKDIR /app/backend

EXPOSE 3001

ENTRYPOINT ["/app/docker-entrypoint.dev.sh"]
CMD ["npm", "run", "dev"]

# ---------------------------------------------------------------------------
# build: imagem de produção — código-fonte copiado e compilado nesta etapa.

FROM base AS build

# Código-fonte do backend (schema Prisma, migrations, src, tsconfig).
COPY backend ./backend

RUN npm run prisma:generate --workspace backend
RUN npm run build --workspace backend

# ---------------------------------------------------------------------------

FROM node:20-slim AS runtime

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --shell /bin/sh app

ENV NODE_ENV=production

WORKDIR /app

# node_modules hoisted pelo npm workspaces (inclui os symlinks
# node_modules/backend -> ../backend usados pela resolução de módulos).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/backend ./backend

COPY backend/docker-entrypoint.sh /app/backend/docker-entrypoint.sh
RUN chmod +x /app/backend/docker-entrypoint.sh \
  && mkdir -p /app/backend/data \
  && chown -R app:app /app

WORKDIR /app/backend
USER app

EXPOSE 3001

ENTRYPOINT ["/app/backend/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
