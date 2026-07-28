import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaClient } from '../../generated/prisma/index.js';
import { CadastroRepository } from './cadastroRepository.js';

const backendDir = fileURLToPath(new URL('../..', import.meta.url));

describe('CadastroRepository', () => {
  let tempDir: string;
  let prisma: PrismaClient;
  let tipoAcordoRepository: CadastroRepository<
    Awaited<ReturnType<PrismaClient['tipoAcordo']['create']>>,
    Parameters<PrismaClient['tipoAcordo']['create']>[0]['data']
  >;
  let usuarioCadastradoRepository: CadastroRepository<
    Awaited<ReturnType<PrismaClient['usuarioCadastrado']['create']>>,
    Parameters<PrismaClient['usuarioCadastrado']['create']>[0]['data']
  >;

  beforeAll(() => {
    // Isolated SQLite file so this test never depends on (or mutates) the
    // developer's local database, mirroring taskRepository.test.ts.
    tempDir = mkdtempSync(join(tmpdir(), 'daily-agreements-cadastro-repo-test-'));
    const dbPath = join(tempDir, 'test.db');
    const databaseUrl = `file:${dbPath}`;

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });

    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    tipoAcordoRepository = new CadastroRepository(prisma.tipoAcordo, 'nome');
    usuarioCadastradoRepository = new CadastroRepository(prisma.usuarioCadastrado, 'nomeLogin');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.task.deleteMany();
    await prisma.tipoAcordo.deleteMany();
    await prisma.motivoNaoCumprimento.deleteMany();
    await prisma.usuarioCadastrado.deleteMany();
  });

  describe('list', () => {
    it('returns an empty array initially', async () => {
      const result = await tipoAcordoRepository.list();

      expect(result).toEqual([]);
    });

    it('returns all rows after adding, including seeded and later-added ones (Requirements 10.4, 11.4, 15.6)', async () => {
      await tipoAcordoRepository.add({ nome: 'Enviar para review' });
      await tipoAcordoRepository.add({ nome: 'Enviar para deploy' });

      const result = await tipoAcordoRepository.list();

      expect(result.map((r) => r.nome).sort()).toEqual(['Enviar para deploy', 'Enviar para review']);
    });
  });

  describe('add', () => {
    it('creates a row that is retrievable by findById', async () => {
      const created = await tipoAcordoRepository.add({ nome: 'Avaliar e planejar' });

      const found = await tipoAcordoRepository.findById(created.id);

      expect(found?.id).toBe(created.id);
      expect(found?.nome).toBe('Avaliar e planejar');
    });
  });

  describe('remove', () => {
    it('deletes a row so it no longer appears in list() or findById()', async () => {
      const created = await tipoAcordoRepository.add({ nome: 'Finalizar' });

      await tipoAcordoRepository.remove(created.id);

      const found = await tipoAcordoRepository.findById(created.id);
      const list = await tipoAcordoRepository.list();
      expect(found).toBeNull();
      expect(list).toEqual([]);
    });
  });

  describe('findById', () => {
    it('returns null when the row does not exist', async () => {
      const found = await tipoAcordoRepository.findById('does-not-exist');

      expect(found).toBeNull();
    });
  });

  describe('existsByNameCaseInsensitive', () => {
    it('returns true for an exact match', async () => {
      await tipoAcordoRepository.add({ nome: 'Enviar para review' });

      const exists = await tipoAcordoRepository.existsByNameCaseInsensitive('Enviar para review');

      expect(exists).toBe(true);
    });

    it('returns true for a different-case match', async () => {
      await tipoAcordoRepository.add({ nome: 'Enviar para review' });

      const exists = await tipoAcordoRepository.existsByNameCaseInsensitive('ENVIAR PARA REVIEW');

      expect(exists).toBe(true);
    });

    it('returns false for a non-existent value', async () => {
      const exists = await tipoAcordoRepository.existsByNameCaseInsensitive('não existe');

      expect(exists).toBe(false);
    });
  });

  // Brief check that the generic factory works for a second model too,
  // proving genericity across distinct Prisma delegates and name fields.
  describe('genericity across models (usuarioCadastradoRepository)', () => {
    it('lists, adds, removes and checks existence case-insensitively for nomeLogin', async () => {
      expect(await usuarioCadastradoRepository.list()).toEqual([]);

      const created = await usuarioCadastradoRepository.add({ nomeLogin: 'joao.silva' });

      expect(await usuarioCadastradoRepository.findById(created.id)).not.toBeNull();
      expect(await usuarioCadastradoRepository.existsByNameCaseInsensitive('JOAO.SILVA')).toBe(true);
      expect(await usuarioCadastradoRepository.existsByNameCaseInsensitive('maria.souza')).toBe(false);

      await usuarioCadastradoRepository.remove(created.id);

      expect(await usuarioCadastradoRepository.findById(created.id)).toBeNull();
    });
  });
});
