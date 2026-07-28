import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaClient } from '../generated/prisma/index.js';
import {
  MOTIVOS_NAO_CUMPRIMENTO,
  seedDatabase,
  TIPOS_ACORDO,
  USUARIO_SEED_LOGIN,
} from './seed.js';

const backendDir = fileURLToPath(new URL('..', import.meta.url));

describe('seedDatabase', () => {
  let tempDir: string;
  let dbPath: string;
  let databaseUrl: string;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Use a dedicated SQLite file, isolated from dev.db, so this test never
    // depends on (or mutates) the developer's local database.
    tempDir = mkdtempSync(join(tmpdir(), 'daily-agreements-seed-test-'));
    dbPath = join(tempDir, 'test.db');
    databaseUrl = `file:${dbPath}`;

    // Apply all migrations to the fresh test database before seeding it.
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });

    prisma = new PrismaClient({ datasourceUrl: databaseUrl });

    await seedDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('initializes Cadastro_de_Tipos_de_Acordo with exactly the specified seeded values (Requirement 10.1)', async () => {
    const tipos = await prisma.tipoAcordo.findMany({ select: { nome: true } });
    const nomes = tipos.map((t) => t.nome);

    expect(nomes.sort()).toEqual([...TIPOS_ACORDO].sort());
    expect(nomes).toHaveLength(TIPOS_ACORDO.length);
  });

  it('initializes Cadastro_de_Motivos_de_Nao_Cumprimento with exactly the specified seeded values (Requirement 11.1)', async () => {
    const motivos = await prisma.motivoNaoCumprimento.findMany({ select: { nome: true } });
    const nomes = motivos.map((m) => m.nome);

    expect(nomes.sort()).toEqual([...MOTIVOS_NAO_CUMPRIMENTO].sort());
    expect(nomes).toHaveLength(MOTIVOS_NAO_CUMPRIMENTO.length);
  });

  it('initializes Cadastro_de_Usuários with the seeded Usuário_Cadastrado, available since initialization (Requirement 15.1)', async () => {
    const usuarios = await prisma.usuarioCadastrado.findMany({ select: { nomeLogin: true } });

    expect(usuarios.length).toBeGreaterThanOrEqual(1);
    expect(usuarios.some((u) => u.nomeLogin === USUARIO_SEED_LOGIN)).toBe(true);
  });

  it('is idempotent: running the seed twice does not create duplicate rows', async () => {
    await seedDatabase(prisma);
    await seedDatabase(prisma);

    const [tipos, motivos, usuarios] = await Promise.all([
      prisma.tipoAcordo.findMany(),
      prisma.motivoNaoCumprimento.findMany(),
      prisma.usuarioCadastrado.findMany({ where: { nomeLogin: USUARIO_SEED_LOGIN } }),
    ]);

    expect(tipos).toHaveLength(TIPOS_ACORDO.length);
    expect(motivos).toHaveLength(MOTIVOS_NAO_CUMPRIMENTO.length);
    expect(usuarios).toHaveLength(1);
  });
});

describe('seed database file setup sanity check', () => {
  it('confirms the migrations directory exists so migrate deploy is meaningful', () => {
    expect(existsSync(join(backendDir, 'prisma', 'migrations'))).toBe(true);
  });
});
