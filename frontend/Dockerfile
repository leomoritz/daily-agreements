# syntax=docker/dockerfile:1

# Build context: raiz do monorepo (necessário para o npm workspaces
# resolver corretamente backend + frontend a partir do lockfile único).

FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci

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
