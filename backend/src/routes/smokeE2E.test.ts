// Smoke end-to-end test (task 28.3) covering the full flow: cadastrar
// Task → registrar Acordo → avaliar → registrar próximo Acordo, ponta a
// ponta contra a API real (Express + Prisma/SQLite), complementando
// (sem duplicar) os testes por rota já existentes em taskRoutes.test.ts.
//
// Segue o mesmo padrão de banco SQLite isolado em diretório temporário
// usado por taskRoutes.test.ts, com um prefixo de diretório distinto
// para não colidir caso os arquivos de teste rodem em paralelo.
//
// _Requirements: 1.1, 2.1, 4.1, 5.1_

import express, { type Express } from 'express';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../generated/prisma/index.js';

const backendDir = fileURLToPath(new URL('../..', import.meta.url));

describe('smoke e2e: Task → Acordo → avaliação → próximo Acordo', () => {
  let tempDir: string;
  let prisma: PrismaClient;
  let app: Express;

  beforeAll(async () => {
    // Isolated SQLite file, distinct prefix from taskRoutes.test.ts so
    // this file never collides with it if the test runner parallelizes.
    tempDir = mkdtempSync(join(tmpdir(), 'daily-agreements-smoke-e2e-test-'));
    const dbPath = join(tempDir, 'test.db');
    const databaseUrl = `file:${dbPath}`;

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });

    // Must be set before the dynamic imports below, so that the shared
    // PrismaClient singleton (db/prismaClient.ts) binds to this isolated
    // test database instead of the developer's dev.db.
    process.env.DATABASE_URL = databaseUrl;

    const { prisma: sharedPrisma } = await import('../db/prismaClient.js');
    const { tasksRouter } = await import('./taskRoutes.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');

    prisma = sharedPrisma;

    app = express();
    app.use(express.json());
    app.use('/tasks', tasksRouter);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs the full flow end-to-end through the real HTTP + persistence stack (Requirements 1.1, 2.1, 4.1, 5.1)', async () => {
    // Setup: Tipo_de_Acordo e Usuário_Cadastrado diretamente via Prisma,
    // como já é feito em taskRoutes.test.ts.
    const tipoAcordo = await prisma.tipoAcordo.create({
      data: { nome: 'Avaliar e planejar' },
    });
    const usuario = await prisma.usuarioCadastrado.create({
      data: { nomeLogin: 'maria.souza' },
    });

    // 1. POST /tasks — cria a Task (Requirement 1.1). Task_Nova: sem
    // acordoAtualId.
    const criarTaskRes = await request(app).post('/tasks').send({
      titulo: 'Preparar apresentação do sprint',
      responsavelId: usuario.id,
    });

    expect(criarTaskRes.status).toBe(201);
    expect(criarTaskRes.body.acordoAtualId).toBeFalsy();
    const taskId = criarTaskRes.body.id as string;

    // 2. POST /tasks/:id/acordos — registra o primeiro Acordo
    // (Requirement 2.1). A Task passa a ser Task_Com_Acordo.
    const primeiroAcordoRes = await request(app)
      .post(`/tasks/${taskId}/acordos`)
      .send({ tipoAcordoId: tipoAcordo.id, responsavelId: usuario.id });

    expect(primeiroAcordoRes.status).toBe(201);
    expect(primeiroAcordoRes.body).toMatchObject({
      taskId,
      tipoAcordoId: tipoAcordo.id,
      estadoCumprimento: 'pendente',
    });
    const primeiroAcordoId = primeiroAcordoRes.body.id as string;

    const taskAposPrimeiroAcordo = await prisma.task.findUnique({ where: { id: taskId } });
    expect(taskAposPrimeiroAcordo?.acordoAtualId).toBe(primeiroAcordoId);

    // 3. PATCH /tasks/:id/acordos/atual — avalia o Acordo_Atual como
    // cumprido (Requirement 4.1).
    const avaliarRes = await request(app)
      .patch(`/tasks/${taskId}/acordos/atual`)
      .send({ resultado: 'cumprido' });

    expect(avaliarRes.status).toBe(200);
    expect(avaliarRes.body).toMatchObject({
      id: primeiroAcordoId,
      estadoCumprimento: 'cumprido',
    });

    // 4. POST /tasks/:id/acordos novamente — registra o próximo Acordo
    // (Requirement 5.1), agora que o anterior foi avaliado. Substitui o
    // Acordo_Atual anterior.
    const segundoAcordoRes = await request(app)
      .post(`/tasks/${taskId}/acordos`)
      .send({ tipoAcordoId: tipoAcordo.id, responsavelId: usuario.id });

    expect(segundoAcordoRes.status).toBe(201);
    expect(segundoAcordoRes.body).toMatchObject({
      taskId,
      tipoAcordoId: tipoAcordo.id,
      estadoCumprimento: 'pendente',
    });
    const segundoAcordoId = segundoAcordoRes.body.id as string;
    expect(segundoAcordoId).not.toBe(primeiroAcordoId);

    const taskAposSegundoAcordo = await prisma.task.findUnique({ where: { id: taskId } });
    expect(taskAposSegundoAcordo?.acordoAtualId).toBe(segundoAcordoId);

    // 5. GET /tasks/:id/historico — confirma que ambos os Acordos
    // persistiram e aparecem no histórico completo.
    const historicoRes = await request(app).get(`/tasks/${taskId}/historico`);

    expect(historicoRes.status).toBe(200);
    expect(historicoRes.body.map((a: { id: string }) => a.id)).toEqual([
      primeiroAcordoId,
      segundoAcordoId,
    ]);
    expect(historicoRes.body[0]).toMatchObject({ estadoCumprimento: 'cumprido' });
    expect(historicoRes.body[1]).toMatchObject({ estadoCumprimento: 'pendente' });
  });
});
