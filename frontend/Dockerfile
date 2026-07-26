# syntax=docker/dockerfile:1

# Build context: raiz do monorepo (necessário para o npm workspaces
# resolver corretamente backend + frontend a partir do lockfile único).

FROM node:20-slim AS base

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci

# ---------------------------------------------------------------------------
# dev: estágio usado pelo docker-compose.override.yml para hot reload.
#
# Não copia o código-fonte do frontend: o docker-compose.override.yml monta
# frontend/ como bind mount em /app/frontend, então o servidor de dev do
# Vite (npm run dev) detecta as alterações feitas no host e faz HMR sem
# precisar rebuildar ou recriar o container.

FROM base AS dev

ENV NODE_ENV=development

WORKDIR /app/frontend

EXPOSE 5173

# --host é necessário para o servidor de dev do Vite aceitar conexões de
# fora do container (por padrão ele só escuta em localhost).
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---------------------------------------------------------------------------
# build: imagem de produção — código-fonte copiado e o build estático
# gerado nesta etapa.

FROM base AS build

COPY frontend ./frontend

# VITE_API_BASE_URL vazio (padrão): o frontend usa paths relativos
# (mesma origem) e o Nginx (nginx.conf) faz o proxy de /tasks,
# /tipos-de-acordo, /motivos-de-nao-cumprimento, /usuarios e /health
# para o serviço `backend`, evitando CORS — mesmo esquema do proxy de
# dev do Vite (frontend/vite.config.ts).
RUN npm run build --workspace frontend

# ---------------------------------------------------------------------------

FROM nginx:1.27-alpine AS runtime

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
