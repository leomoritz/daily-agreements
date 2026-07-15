import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaClient } from '../../generated/prisma/index.js';
import { TaskRepository } from './taskRepository.js';

const backendDir = fileURLToPath(new URL('../..', import.meta.url));

describe('TaskRepository', () => {
  let tempDir: string;
  let prisma: PrismaClient;
  let repository: TaskRepository;

  beforeAll(() => {
    // Isolated SQLite file so this test never depends on (or mutates) the
    // developer's local database, mirroring prisma/seed.test.ts.
    tempDir = mkdtempSync(join(tmpdir(), 'daily-agreements-task-repo-test-'));
    const dbPath = join(tempDir, 'test.db');
    const databaseUrl = `file:${dbPath}`;

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });

    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    repository = new TaskRepository(prisma);
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

  it('creates a Task and assigns it a unique id (Requirement 1.4)', async () => {
    const task = await repository.create({ titulo: 'Escrever testes', ordemExibicao: 0 });

    expect(task.id).toBeTruthy();
    expect(task.titulo).toBe('Escrever testes');
    expect(task.numTentativas).toBe(0);
    expect(task.concluida).toBe(false);
  });

  it('finds a Task by id', async () => {
    const created = await repository.create({ titulo: 'Buscar por id', ordemExibicao: 0 });

    const found = await repository.findById(created.id);

    expect(found?.id).toBe(created.id);
    expect(found?.titulo).toBe('Buscar por id');
  });

  it('returns null when finding a Task by a non-existent id', async () => {
    const found = await repository.findById('does-not-exist');

    expect(found).toBeNull();
  });

  it('updates a Task by id', async () => {
    const created = await repository.create({ titulo: 'Título original', ordemExibicao: 0 });

    const updated = await repository.update(created.id, { titulo: 'Título editado' });

    expect(updated.titulo).toBe('Título editado');
    const found = await repository.findById(created.id);
    expect(found?.titulo).toBe('Título editado');
  });

  it('physically deletes a Task and cascades to its Acordos (Requirement 9.4)', async () => {
    const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Finalizar' } });
    const task = await repository.create({ titulo: 'Task com acordo', ordemExibicao: 0 });
    const acordo = await prisma.acordo.create({
      data: { taskId: task.id, tipoAcordoId: tipoAcordo.id },
    });

    await repository.delete(task.id);

    expect(await repository.findById(task.id)).toBeNull();
    expect(await prisma.acordo.findUnique({ where: { id: acordo.id } })).toBeNull();
  });

  it('lists active Tasks, excluding concluída ones (Requirement 6.2)', async () => {
    const ativa = await repository.create({ titulo: 'Ativa', ordemExibicao: 0 });
    const concluida = await repository.create({
      titulo: 'Concluída',
      ordemExibicao: 1,
      concluida: true,
    });

    const active = await repository.listActive();
    const ids = active.map((t) => t.id);

    expect(ids).toContain(ativa.id);
    expect(ids).not.toContain(concluida.id);
  });

  it('does not list manually deleted Tasks, since they are physically removed', async () => {
    const task = await repository.create({ titulo: 'Removida manualmente', ordemExibicao: 0 });

    await repository.delete(task.id);

    const active = await repository.listActive();
    expect(active.map((t) => t.id)).not.toContain(task.id);
  });

  describe('existsByResponsavelId', () => {
    it('returns true when a Task references the given Usuário_Cadastrado as Responsável', async () => {
      const usuario = await prisma.usuarioCadastrado.create({ data: { nomeLogin: 'joao.silva' } });
      await repository.create({ titulo: 'Task com responsável', ordemExibicao: 0, responsavelId: usuario.id });

      const exists = await repository.existsByResponsavelId(usuario.id);

      expect(exists).toBe(true);
    });

    it('returns false when no Task references the given Usuário_Cadastrado as Responsável', async () => {
      const usuario = await prisma.usuarioCadastrado.create({ data: { nomeLogin: 'maria.souza' } });

      const exists = await repository.existsByResponsavelId(usuario.id);

      expect(exists).toBe(false);
    });

    it('returns true even when the referencing Task is concluída (logically removed)', async () => {
      const usuario = await prisma.usuarioCadastrado.create({ data: { nomeLogin: 'ana.costa' } });
      await repository.create({
        titulo: 'Task concluída',
        ordemExibicao: 0,
        responsavelId: usuario.id,
        concluida: true,
      });

      const exists = await repository.existsByResponsavelId(usuario.id);

      expect(exists).toBe(true);
    });
  });
});
