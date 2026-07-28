#!/bin/sh
# Entrypoint do container do backend.
#
# Garante que o banco SQLite (persistido no volume /app/backend/data via
# DATABASE_URL) esteja com as migrations aplicadas e os cadastros base
# semeados antes de subir o servidor Express. Roda a cada start do
# container: `prisma migrate deploy` e o seed (prisma/seed.ts) são
# idempotentes, então é seguro reexecutar em restarts.
set -e

cd "$(dirname "$0")"

echo "[entrypoint] Aplicando migrations do Prisma..."
npx prisma migrate deploy

echo "[entrypoint] Executando seed (idempotente)..."
npx tsx prisma/seed.ts

echo "[entrypoint] Iniciando aplicação..."
exec "$@"
