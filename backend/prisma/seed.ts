// Seed script for Daily Agreements.
// Populates Cadastro_de_Tipos_de_Acordo, Cadastro_de_Motivos_de_Nao_Cumprimento
// and a seeded Usuário_Cadastrado.
//
// Idempotent: uses upsert on each model's unique field so running this
// script multiple times (e.g. via `prisma migrate reset`) never creates
// duplicate rows.

import { PrismaClient } from '../generated/prisma/index.js';

export const TIPOS_ACORDO = [
  'Avaliar e planejar',
  'Enviar para code review',
  'Enviar para review',
  'Enviar para deploy',
  'Finalizar',
];

export const MOTIVOS_NAO_CUMPRIMENTO = [
  'Dependência externa',
  'Requisito não previsto',
  'Problema ambiente',
  'Falta de conhecimento negócio',
  'Falta de conhecimento técnico',
];

export const USUARIO_SEED_LOGIN = 'admin';

/**
 * Populates Cadastro_de_Tipos_de_Acordo, Cadastro_de_Motivos_de_Nao_Cumprimento
 * and the seeded Usuário_Cadastrado on the given Prisma client's database.
 *
 * Idempotent: uses upsert on each model's unique field so calling this
 * multiple times against the same database never creates duplicate rows.
 */
export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  for (const nome of TIPOS_ACORDO) {
    await prisma.tipoAcordo.upsert({
      where: { nome },
      update: {},
      create: { nome },
    });
  }

  for (const nome of MOTIVOS_NAO_CUMPRIMENTO) {
    await prisma.motivoNaoCumprimento.upsert({
      where: { nome },
      update: {},
      create: { nome },
    });
  }

  await prisma.usuarioCadastrado.upsert({
    where: { nomeLogin: USUARIO_SEED_LOGIN },
    update: {},
    create: { nomeLogin: USUARIO_SEED_LOGIN },
  });
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedDatabase(prisma);
    console.log('Seed completed.');
  } finally {
    await prisma.$disconnect();
  }
}

// Only run the seed script when this module is executed directly
// (e.g. `tsx prisma/seed.ts`), not when its exports are imported by tests.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
