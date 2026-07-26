import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaClient } from '../../generated/prisma/index.js';
import { AcordoRepository } from './acordoRepository.js';

const backendDir = fileURLToPath(new URL('../..', import.meta.url));

describe('AcordoRepository', () => {
  let tempDir: string;
  let prisma: PrismaClient;
  let repository: AcordoRepository;

  beforeAll(() => {
    // Isolated SQLite file so this test never depends on (or mutates) the
    // developer's local database, mirroring taskRepository.test.ts.
    tempDir = mkdtempSync(join(tmpdir(), 'daily-agreements-acordo-repo-test-'));
    const dbPath = join(tempDir, 'test.db');
    const databaseUrl = `file:${dbPath}`;

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });

    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    repository = new AcordoRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Acordo rows cascade-delete with their Task (schema.prisma onDelete: Cascade).
    await prisma.task.deleteMany();
    await prisma.tipoAcordo.deleteMany();
    await prisma.motivoNaoCumprimento.deleteMany();
    await prisma.usuarioCadastrado.deleteMany();
  });

  it('creates an Acordo linked to a Task and a TipoAcordo', async () => {
    const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Enviar para review' } });
    const task = await prisma.task.create({ data: { titulo: 'Task de teste', ordemExibicao: 0 } });

    const acordo = await repository.create({ taskId: task.id, tipoAcordoId: tipoAcordo.id });

    expect(acordo.id).toBeTruthy();
    expect(acordo.taskId).toBe(task.id);
    expect(acordo.tipoAcordoId).toBe(tipoAcordo.id);
    expect(acordo.estadoCumprimento).toBe('pendente');
  });

  it('finds an Acordo by id', async () => {
    const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Enviar para deploy' } });
    const task = await prisma.task.create({ data: { titulo: 'Task de teste', ordemExibicao: 0 } });
    const created = await repository.create({ taskId: task.id, tipoAcordoId: tipoAcordo.id });

    const found = await repository.findById(created.id);

    expect(found?.id).toBe(created.id);
    expect(found?.taskId).toBe(task.id);
  });

  it('returns null when finding an Acordo by a non-existent id', async () => {
    const found = await repository.findById('does-not-exist');

    expect(found).toBeNull();
  });

  it('returns an empty array for a Task with no Acordos (Requirement 7.1)', async () => {
    const task = await prisma.task.create({ data: { titulo: 'Sem acordos', ordemExibicao: 0 } });

    const history = await repository.findHistoryByTaskId(task.id);

    expect(history).toEqual([]);
  });

  it('returns all Acordos for a Task ordered by dataRegistro ascending, regardless of insertion order (Requirements 7.1, 7.2, 7.3)', async () => {
    const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Avaliar e planejar' } });
    const task = await prisma.task.create({ data: { titulo: 'Com histórico', ordemExibicao: 0 } });

    const oldest = new Date('2024-01-01T00:00:00.000Z');
    const middle = new Date('2024-02-01T00:00:00.000Z');
    const newest = new Date('2024-03-01T00:00:00.000Z');

    // Insert out of chronological order to verify sorting is enforced by
    // the query itself, not by insertion order.
    const middleAcordo = await repository.create({
      taskId: task.id,
      tipoAcordoId: tipoAcordo.id,
      dataRegistro: middle,
    });
    const newestAcordo = await repository.create({
      taskId: task.id,
      tipoAcordoId: tipoAcordo.id,
      dataRegistro: newest,
    });
    const oldestAcordo = await repository.create({
      taskId: task.id,
      tipoAcordoId: tipoAcordo.id,
      dataRegistro: oldest,
    });

    const history = await repository.findHistoryByTaskId(task.id);

    expect(history.map((a) => a.id)).toEqual([oldestAcordo.id, middleAcordo.id, newestAcordo.id]);
    for (const acordo of history) {
      expect(acordo.tipoAcordoId).toBe(tipoAcordo.id);
      expect(acordo.estadoCumprimento).toBeTruthy();
    }
  });

  it('updates an Acordo by id', async () => {
    const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Finalizar' } });
    const task = await prisma.task.create({ data: { titulo: 'Task de teste', ordemExibicao: 0 } });
    const created = await repository.create({ taskId: task.id, tipoAcordoId: tipoAcordo.id });

    const updated = await repository.update(created.id, { estadoCumprimento: 'cumprido' });

    expect(updated.estadoCumprimento).toBe('cumprido');
    const found = await repository.findById(created.id);
    expect(found?.estadoCumprimento).toBe('cumprido');
  });
});
