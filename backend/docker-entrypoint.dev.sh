#!/bin/sh
# Entrypoint do container do backend em modo dev (docker-compose.override.yml).
#
# O código-fonte chega via bind mount (backend/ do host montado em
# /app/backend), então rodamos `prisma generate` a cada start para garantir
# que o Prisma Client (backend/generated/prisma, ignorado no git) exista e
# corresponda ao schema atual, mesmo que o host nunca tenha gerado o client
# ou tenha gerado para outra plataforma. Migrations e seed seguem o mesmo
# comportamento idempotente do entrypoint de produção
# (docker-entrypoint.sh).
set -e

cd "$(dirname "$0")/backend"

echo "[entrypoint:dev] Gerando Prisma Client..."
npx prisma generate

echo "[entrypoint:dev] Aplicando migrations do Prisma..."
npx prisma migrate deploy

echo "[entrypoint:dev] Executando seed (idempotente)..."
npx tsx prisma/seed.ts

echo "[entrypoint:dev] Iniciando aplicação em modo watch..."
exec "$@"
