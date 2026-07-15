// Integration tests for the task routes: POST /tasks (task 6.4),
// POST /tasks/:id/acordos, PATCH /tasks/:id/acordos/atual (task 13.4,
// covering the routes implemented by task 13.1), GET /tasks/:id/historico,
// PATCH /tasks/:id, DELETE /tasks/:id and PUT /tasks/:id/ordem (task 13.4,
// covering the routes implemented by task 13.2), and POST /tasks/lote
// (task 17.5, covering the route implemented by task 17.4).
//
// These tests exercise the real Express router wired to the real
// TaskService/AcordoService/*Repository stack (and the
// Cadastro_de_Usuários/Tipos_de_Acordo/Motivos_de_Nao_Cumprimento
// lookups), against an isolated SQLite database (mirroring the pattern
// used by taskRepository.test.ts and prisma/seed.test.ts), covering the
// happy path and each applicable error category (400 validation, 404 not
// found, 409 conflict — per design.md's "Error Handling" table)
// end-to-end through HTTP, per design.md's "Testing Strategy": "Integração
// ponta a ponta de cada rota REST com a camada de persistência
// (Prisma/SQLite), usando 1–3 exemplos representativos por rota."
//
// _Requirements: 1.1, 1.8, 2.4, 4.8, 5.5, 7.5, 9.5, 14.3, 12.5, 12.6_

import express, { type Express } from 'express';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../generated/prisma/index.js';

const backendDir = fileURLToPath(new URL('../..', import.meta.url));

describe('task routes (POST /tasks)', () => {
  let tempDir: string;
  let prisma: PrismaClient;
  let app: Express;

  beforeAll(async () => {
    // Isolated SQLite file so this test never depends on (or mutates) the
    // developer's local database, mirroring taskRepository.test.ts.
    tempDir = mkdtempSync(join(tmpdir(), 'daily-agreements-task-routes-test-'));
    const dbPath = join(tempDir, 'test.db');
    const databaseUrl = `file:${dbPath}`;

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });

    // Must be set before the dynamic imports below, so that the shared
    // PrismaClient singleton (db/prismaClient.ts) — constructed the first
    // time it is imported, transitively, by the router/service — binds
    // to this isolated test database instead of the developer's dev.db.
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

  beforeEach(async () => {
    await prisma.task.deleteMany();
    await prisma.tipoAcordo.deleteMany();
    await prisma.motivoNaoCumprimento.deleteMany();
    await prisma.usuarioCadastrado.deleteMany();
  });

  it('happy path: creates a Task with título, descrição and a valid responsavelId (Requirement 1.1)', async () => {
    const usuario = await prisma.usuarioCadastrado.create({ data: { nomeLogin: 'joao.silva' } });

    const res = await request(app).post('/tasks').send({
      titulo: 'Revisar PR #42',
      descricao: 'Conferir cobertura de testes',
      responsavelId: usuario.id,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      titulo: 'Revisar PR #42',
      descricao: 'Conferir cobertura de testes',
      responsavelId: usuario.id,
      numTentativas: 0,
    });
    expect(res.body.id).toBeTruthy();
    expect(res.body.acordoAtualId).toBeFalsy();
  });

  it('rejects an empty título with 400 and { erro: { codigo, mensagem } } (Requirement 1.2)', async () => {
    const res = await request(app).post('/tasks').send({ titulo: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('erro.codigo');
    expect(res.body).toHaveProperty('erro.mensagem');

    const list = await prisma.task.findMany();
    expect(list).toEqual([]);
  });

  it('rejects a responsavelId that does not exist in the Cadastro_de_Usuários with 400 (Requirement 1.8)', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ titulo: 'Task com responsável inválido', responsavelId: 'nao-existe' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('erro.codigo');
    expect(res.body).toHaveProperty('erro.mensagem');

    const list = await prisma.task.findMany();
    expect(list).toEqual([]);
  });

  describe('GET /tasks', () => {
    it('happy path: returns both groups (taskNova and taskComAcordo) when no search is given (Requirement 3.4)', async () => {
      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Avaliar e planejar' } });
      const nova = await prisma.task.create({ data: { titulo: 'Task nova sem acordo', ordemExibicao: 0 } });
      const comAcordoTask = await prisma.task.create({ data: { titulo: 'Task com acordo', ordemExibicao: 1 } });
      const acordo = await prisma.acordo.create({
        data: { taskId: comAcordoTask.id, tipoAcordoId: tipoAcordo.id },
      });
      await prisma.task.update({ where: { id: comAcordoTask.id }, data: { acordoAtualId: acordo.id } });

      const res = await request(app).get('/tasks');

      expect(res.status).toBe(200);
      expect(res.body.taskNova.map((t: { id: string }) => t.id)).toEqual([nova.id]);
      expect(res.body.taskComAcordo.map((t: { id: string }) => t.id)).toEqual([comAcordoTask.id]);
    });

    it('returns both groups empty when the search term matches no Task (Requirements 3.4, 13.3)', async () => {
      await prisma.task.create({ data: { titulo: 'Revisar PR #42', ordemExibicao: 0 } });

      const res = await request(app).get('/tasks').query({ search: 'termo-sem-correspondencia' });

      expect(res.status).toBe(200);
      expect(res.body.taskNova).toEqual([]);
      expect(res.body.taskComAcordo).toEqual([]);
    });

    it('returns only the Tasks whose título matches the search term, case-insensitively (Requirement 13.1)', async () => {
      const alvo = await prisma.task.create({ data: { titulo: 'Revisar PR #42', ordemExibicao: 0 } });
      await prisma.task.create({ data: { titulo: 'Outra atividade', ordemExibicao: 1 } });

      const res = await request(app).get('/tasks').query({ search: 'revisar' });

      expect(res.status).toBe(200);
      expect(res.body.taskNova.map((t: { id: string }) => t.id)).toEqual([alvo.id]);
      expect(res.body.taskComAcordo).toEqual([]);
    });
  });

  describe('GET /tasks/finalizadas', () => {
    it('happy path: returns concluída Tasks with the data de finalização from the "Finalizar" cumprido Acordo', async () => {
      const tipoFinalizar = await prisma.tipoAcordo.create({ data: { nome: 'Finalizar' } });
      const task = await prisma.task.create({ data: { titulo: 'Task finalizada', ordemExibicao: 0 } });
      const acordo = await prisma.acordo.create({
        data: {
          taskId: task.id,
          tipoAcordoId: tipoFinalizar.id,
          estadoCumprimento: 'cumprido',
        },
      });
      await prisma.task.update({
        where: { id: task.id },
        data: { acordoAtualId: acordo.id, concluida: true },
      });

      const res = await request(app).get('/tasks/finalizadas');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ id: task.id, titulo: 'Task finalizada' });
      expect(res.body[0].dataFinalizacao).toBeTruthy();
      expect(typeof res.body[0].finalizadaHoje).toBe('boolean');
    });

    it('does not include active (não concluída) Tasks', async () => {
      await prisma.task.create({ data: { titulo: 'Task ativa', ordemExibicao: 0 } });

      const res = await request(app).get('/tasks/finalizadas');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('marks finalizadaHoje as true for a Task finalized with the current system date', async () => {
      const tipoFinalizar = await prisma.tipoAcordo.create({ data: { nome: 'Finalizar' } });
      const task = await prisma.task.create({ data: { titulo: 'Task de hoje', ordemExibicao: 0 } });
      const acordo = await prisma.acordo.create({
        data: {
          taskId: task.id,
          tipoAcordoId: tipoFinalizar.id,
          estadoCumprimento: 'cumprido',
          dataRegistro: new Date(),
        },
      });
      await prisma.task.update({
        where: { id: task.id },
        data: { acordoAtualId: acordo.id, concluida: true },
      });

      const res = await request(app).get('/tasks/finalizadas');

      expect(res.status).toBe(200);
      expect(res.body[0].finalizadaHoje).toBe(true);
    });
  });

  describe('POST /tasks/:id/acordos', () => {
    it('happy path: registers the first Acordo for a Task_Nova (Requirement 2.1)', async () => {
      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Avaliar e planejar' } });
      const task = await prisma.task.create({ data: { titulo: 'Task de teste', ordemExibicao: 0 } });

      const res = await request(app)
        .post(`/tasks/${task.id}/acordos`)
        .send({ tipoAcordoId: tipoAcordo.id });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        taskId: task.id,
        tipoAcordoId: tipoAcordo.id,
        estadoCumprimento: 'pendente',
      });

      const atualizada = await prisma.task.findUnique({ where: { id: task.id } });
      expect(atualizada?.acordoAtualId).toBe(res.body.id);
    });

    it('rejects a Task that does not exist with 404 (Requirement 2.4)', async () => {
      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Avaliar e planejar' } });

      const res = await request(app)
        .post('/tasks/nao-existe/acordos')
        .send({ tipoAcordoId: tipoAcordo.id });

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });

    it('rejects a second Acordo while the Acordo_Atual is still pendente with 409 (Requirement 5.5)', async () => {
      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Enviar para review' } });
      const task = await prisma.task.create({ data: { titulo: 'Task de teste', ordemExibicao: 0 } });

      await request(app).post(`/tasks/${task.id}/acordos`).send({ tipoAcordoId: tipoAcordo.id });
      const res = await request(app)
        .post(`/tasks/${task.id}/acordos`)
        .send({ tipoAcordoId: tipoAcordo.id });

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });
  });

  describe('PATCH /tasks/:id/acordos/atual', () => {
    it('happy path: evaluates the Acordo_Atual as cumprido (Requirement 4.1)', async () => {
      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Enviar para deploy' } });
      const task = await prisma.task.create({ data: { titulo: 'Task de teste', ordemExibicao: 0 } });
      const acordo = await prisma.acordo.create({ data: { taskId: task.id, tipoAcordoId: tipoAcordo.id } });
      await prisma.task.update({ where: { id: task.id }, data: { acordoAtualId: acordo.id } });

      const res = await request(app)
        .patch(`/tasks/${task.id}/acordos/atual`)
        .send({ resultado: 'cumprido' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: acordo.id, estadoCumprimento: 'cumprido' });
    });

    it('rejects an invalid resultado with 400 (Requirement 4.7 category — validação de entrada)', async () => {
      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Enviar para deploy' } });
      const task = await prisma.task.create({ data: { titulo: 'Task de teste', ordemExibicao: 0 } });
      const acordo = await prisma.acordo.create({ data: { taskId: task.id, tipoAcordoId: tipoAcordo.id } });
      await prisma.task.update({ where: { id: task.id }, data: { acordoAtualId: acordo.id } });

      const res = await request(app)
        .patch(`/tasks/${task.id}/acordos/atual`)
        .send({ resultado: 'invalido' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });

    it('rejects evaluation of a Task with no Acordo_Atual with 409 (Requirement 4.8)', async () => {
      const task = await prisma.task.create({ data: { titulo: 'Task_Nova sem acordo', ordemExibicao: 0 } });

      const res = await request(app)
        .patch(`/tasks/${task.id}/acordos/atual`)
        .send({ resultado: 'cumprido' });

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });
  });

  describe('POST /tasks/:id/acordos/repetir', () => {
    it('happy path: quando o Acordo_Atual é "Avaliar e planejar", marca cumprido e registra um novo "Avaliar e planejar"', async () => {
      const usuario = await prisma.usuarioCadastrado.create({ data: { nomeLogin: 'joao.silva' } });
      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Avaliar e planejar' } });
      const task = await prisma.task.create({
        data: { titulo: 'Task de teste', ordemExibicao: 0, responsavelId: usuario.id },
      });
      const acordoAtual = await prisma.acordo.create({
        data: { taskId: task.id, tipoAcordoId: tipoAcordo.id },
      });
      await prisma.task.update({ where: { id: task.id }, data: { acordoAtualId: acordoAtual.id } });

      const res = await request(app).post(`/tasks/${task.id}/acordos/repetir`);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        taskId: task.id,
        tipoAcordoId: tipoAcordo.id,
        estadoCumprimento: 'pendente',
      });
      expect(res.body.id).not.toBe(acordoAtual.id);

      const acordoAnterior = await prisma.acordo.findUnique({ where: { id: acordoAtual.id } });
      expect(acordoAnterior?.estadoCumprimento).toBe('cumprido');

      const taskAtualizada = await prisma.task.findUnique({ where: { id: task.id } });
      expect(taskAtualizada?.acordoAtualId).toBe(res.body.id);
      expect(taskAtualizada?.responsavelId).toBe(usuario.id);
    });

    it('happy path: quando o Acordo_Atual não é "Avaliar e planejar", marca não cumprido e registra um novo Acordo do mesmo tipo', async () => {
      const usuario = await prisma.usuarioCadastrado.create({ data: { nomeLogin: 'maria.souza' } });
      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Enviar para review' } });
      const task = await prisma.task.create({
        data: { titulo: 'Task de teste', ordemExibicao: 0, responsavelId: usuario.id },
      });
      const acordoAtual = await prisma.acordo.create({
        data: { taskId: task.id, tipoAcordoId: tipoAcordo.id },
      });
      await prisma.task.update({ where: { id: task.id }, data: { acordoAtualId: acordoAtual.id } });

      const res = await request(app).post(`/tasks/${task.id}/acordos/repetir`);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        taskId: task.id,
        tipoAcordoId: tipoAcordo.id,
        estadoCumprimento: 'pendente',
      });
      expect(res.body.id).not.toBe(acordoAtual.id);

      const acordoAnterior = await prisma.acordo.findUnique({ where: { id: acordoAtual.id } });
      expect(acordoAnterior?.estadoCumprimento).toBe('nao_cumprido');

      const taskAtualizada = await prisma.task.findUnique({ where: { id: task.id } });
      expect(taskAtualizada?.acordoAtualId).toBe(res.body.id);
      expect(taskAtualizada?.numTentativas).toBe(1);
      expect(taskAtualizada?.responsavelId).toBe(usuario.id);
    });

    it('rejects a Task that does not exist with 404', async () => {
      const res = await request(app).post('/tasks/nao-existe/acordos/repetir');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });

    it('rejects a Task_Nova (sem Acordo_Atual) with 409', async () => {
      const task = await prisma.task.create({ data: { titulo: 'Task_Nova sem acordo', ordemExibicao: 0 } });

      const res = await request(app).post(`/tasks/${task.id}/acordos/repetir`);

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });

    it('mantém o indicador de alerta na Lista_de_Acordos já na primeira repetição de um Tipo_de_Acordo diferente de "Avaliar e planejar"', async () => {
      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Enviar para review' } });
      const task = await prisma.task.create({ data: { titulo: 'Task de teste', ordemExibicao: 0 } });
      const acordoAtual = await prisma.acordo.create({
        data: { taskId: task.id, tipoAcordoId: tipoAcordo.id },
      });
      await prisma.task.update({ where: { id: task.id }, data: { acordoAtualId: acordoAtual.id } });

      await request(app).post(`/tasks/${task.id}/acordos/repetir`);

      const listaRes = await request(app).get('/tasks');
      const item = listaRes.body.taskComAcordo.find((t: { id: string }) => t.id === task.id);

      expect(item).toBeDefined();
      expect(item.alerta).toBe(true);
      expect(item.numTentativas).toBe(1);
    });
  });

  describe('POST /tasks/:id/finalizar', () => {
    it('happy path: marca o Acordo_Atual como cumprido e a Task como concluída', async () => {
      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Enviar para review' } });
      const task = await prisma.task.create({ data: { titulo: 'Task de teste', ordemExibicao: 0 } });
      const acordoAtual = await prisma.acordo.create({
        data: { taskId: task.id, tipoAcordoId: tipoAcordo.id },
      });
      await prisma.task.update({ where: { id: task.id }, data: { acordoAtualId: acordoAtual.id } });

      const res = await request(app).post(`/tasks/${task.id}/finalizar`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: acordoAtual.id, estadoCumprimento: 'cumprido' });

      const taskAtualizada = await prisma.task.findUnique({ where: { id: task.id } });
      expect(taskAtualizada?.concluida).toBe(true);
    });

    it('rejects a Task that does not exist with 404', async () => {
      const res = await request(app).post('/tasks/nao-existe/finalizar');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });

    it('rejects a Task_Nova (sem Acordo_Atual) with 409', async () => {
      const task = await prisma.task.create({ data: { titulo: 'Task_Nova sem acordo', ordemExibicao: 0 } });

      const res = await request(app).post(`/tasks/${task.id}/finalizar`);

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });

    it('remove a Task da Lista_de_Acordos após ser finalizada', async () => {
      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Enviar para deploy' } });
      const task = await prisma.task.create({ data: { titulo: 'Task a finalizar', ordemExibicao: 0 } });
      const acordoAtual = await prisma.acordo.create({
        data: { taskId: task.id, tipoAcordoId: tipoAcordo.id },
      });
      await prisma.task.update({ where: { id: task.id }, data: { acordoAtualId: acordoAtual.id } });

      await request(app).post(`/tasks/${task.id}/finalizar`);

      const listaRes = await request(app).get('/tasks');
      const idsNaLista = [
        ...listaRes.body.taskNova.map((t: { id: string }) => t.id),
        ...listaRes.body.taskComAcordo.map((t: { id: string }) => t.id),
      ];
      expect(idsNaLista).not.toContain(task.id);
    });
  });

  describe('GET /tasks/:id/historico', () => {
    it('happy path: returns the Acordo history ordered by dataRegistro ascending (Requirement 7.1)', async () => {
      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Avaliar e planejar' } });
      const task = await prisma.task.create({ data: { titulo: 'Com histórico', ordemExibicao: 0 } });
      const oldest = await prisma.acordo.create({
        data: {
          taskId: task.id,
          tipoAcordoId: tipoAcordo.id,
          dataRegistro: new Date('2024-01-01T00:00:00.000Z'),
        },
      });
      const newest = await prisma.acordo.create({
        data: {
          taskId: task.id,
          tipoAcordoId: tipoAcordo.id,
          dataRegistro: new Date('2024-02-01T00:00:00.000Z'),
        },
      });

      const res = await request(app).get(`/tasks/${task.id}/historico`);

      expect(res.status).toBe(200);
      expect(res.body.map((a: { id: string }) => a.id)).toEqual([oldest.id, newest.id]);
    });

    it('returns an empty list when the Task has no Acordos (Requirement 7.4)', async () => {
      const task = await prisma.task.create({ data: { titulo: 'Sem acordos', ordemExibicao: 0 } });

      const res = await request(app).get(`/tasks/${task.id}/historico`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('rejects a Task that does not exist with 404 (Requirement 7.5)', async () => {
      const res = await request(app).get('/tasks/nao-existe/historico');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });
  });

  describe('PATCH /tasks/:id', () => {
    it('happy path: edits título and responsavelId (Requirement 9.1)', async () => {
      const usuario = await prisma.usuarioCadastrado.create({ data: { nomeLogin: 'joao.silva' } });
      const task = await prisma.task.create({ data: { titulo: 'Título antigo', ordemExibicao: 0 } });

      const res = await request(app)
        .patch(`/tasks/${task.id}`)
        .send({ titulo: 'Título novo', responsavelId: usuario.id });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ titulo: 'Título novo', responsavelId: usuario.id });
    });

    it('rejects an empty título with 400, preserving the previous título (Requirement 9.2)', async () => {
      const task = await prisma.task.create({ data: { titulo: 'Título original', ordemExibicao: 0 } });

      const res = await request(app).patch(`/tasks/${task.id}`).send({ titulo: '   ' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');

      const atualizada = await prisma.task.findUnique({ where: { id: task.id } });
      expect(atualizada?.titulo).toBe('Título original');
    });

    it('rejects a Task that does not exist with 404 (Requirement 9.3)', async () => {
      const res = await request(app).patch('/tasks/nao-existe').send({ titulo: 'Novo título' });

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });
  });

  describe('DELETE /tasks/:id', () => {
    it('happy path: removes the Task permanently (Requirement 9.4)', async () => {
      const task = await prisma.task.create({ data: { titulo: 'A remover', ordemExibicao: 0 } });

      const res = await request(app).delete(`/tasks/${task.id}`);

      expect(res.status).toBe(204);
      const encontrada = await prisma.task.findUnique({ where: { id: task.id } });
      expect(encontrada).toBeNull();
    });

    it('rejects a Task that does not exist with 404 (Requirement 9.5)', async () => {
      const res = await request(app).delete('/tasks/nao-existe');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });
  });

  describe('PUT /tasks/:id/ordem', () => {
    it('happy path: reorders the Task to the given position (Requirement 14.1)', async () => {
      const t0 = await prisma.task.create({ data: { titulo: 'Task 0', ordemExibicao: 0 } });
      const t1 = await prisma.task.create({ data: { titulo: 'Task 1', ordemExibicao: 1 } });

      const res = await request(app).put(`/tasks/${t0.id}/ordem`).send({ novaPosicao: 1 });

      expect(res.status).toBe(204);
      const atualizado0 = await prisma.task.findUnique({ where: { id: t0.id } });
      const atualizado1 = await prisma.task.findUnique({ where: { id: t1.id } });
      expect(atualizado1!.ordemExibicao).toBeLessThan(atualizado0!.ordemExibicao);
    });

    it('rejects a missing novaPosicao with 400 (categoria de validação de entrada)', async () => {
      const task = await prisma.task.create({ data: { titulo: 'Task de teste', ordemExibicao: 0 } });

      const res = await request(app).put(`/tasks/${task.id}/ordem`).send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });

    it('rejects a Task that does not exist with 404 (Requirement 14.3)', async () => {
      const res = await request(app).put('/tasks/nao-existe/ordem').send({ novaPosicao: 0 });

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });
  });

  describe('POST /tasks/lote', () => {
    it('returns 200 with a per-line report for a batch mixing valid and invalid lines, creating Tasks only for the valid ones (Requirements 12.5, 12.6)', async () => {
      await prisma.tipoAcordo.create({ data: { nome: 'Avaliar e planejar' } });

      const texto = [
        'Revisar PR #42',
        'Preparar apresentação;Avaliar e planejar',
        '',
        'Linha com tipo inexistente;Tipo_Que_Nao_Existe',
        'a'.repeat(201),
      ].join('\n');

      const res = await request(app).post('/tasks/lote').send({ texto });

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(5);

      const [linha1, linha2, linha3, linha4, linha5] = res.body;

      // Linha 1: título simples, sem Tipo_de_Acordo — aceita como Task_Nova.
      expect(linha1).toMatchObject({ numeroLinha: 1, linha: 'Revisar PR #42', aceita: true });
      expect(linha1.taskId).toBeTruthy();

      // Linha 2: título + Tipo_de_Acordo válido — aceita como Task_Com_Acordo.
      expect(linha2).toMatchObject({
        numeroLinha: 2,
        linha: 'Preparar apresentação;Avaliar e planejar',
        aceita: true,
      });
      expect(linha2.taskId).toBeTruthy();

      // Linha 3: título vazio após trim — rejeitada.
      expect(linha3).toMatchObject({ numeroLinha: 3, linha: '', aceita: false });
      expect(linha3.motivoCodigo).toBeTruthy();
      expect(linha3.motivoMensagem).toBeTruthy();
      expect(linha3.taskId).toBeFalsy();

      // Linha 4: Tipo_de_Acordo desconhecido — rejeitada.
      expect(linha4).toMatchObject({
        numeroLinha: 4,
        linha: 'Linha com tipo inexistente;Tipo_Que_Nao_Existe',
        aceita: false,
      });
      expect(linha4.motivoCodigo).toBeTruthy();
      expect(linha4.motivoMensagem).toBeTruthy();
      expect(linha4.taskId).toBeFalsy();

      // Linha 5: título excede 200 caracteres — rejeitada.
      expect(linha5).toMatchObject({ numeroLinha: 5, aceita: false });
      expect(linha5.motivoCodigo).toBeTruthy();
      expect(linha5.taskId).toBeFalsy();

      // Somente as linhas aceitas devem ter criado Tasks reais no banco.
      const tasksNoBanco = await prisma.task.findMany();
      expect(tasksNoBanco).toHaveLength(2);
      expect(tasksNoBanco.map((t) => t.id).sort()).toEqual(
        [linha1.taskId, linha2.taskId].sort(),
      );

      const taskComAcordo = tasksNoBanco.find((t) => t.id === linha2.taskId);
      expect(taskComAcordo?.acordoAtualId).toBeTruthy();

      // Confirma via GET /tasks que ambas aparecem na Lista_de_Acordos, cada
      // uma no grupo correspondente à sua classificação.
      const listaRes = await request(app).get('/tasks');
      expect(listaRes.body.taskNova.map((t: { id: string }) => t.id)).toEqual([linha1.taskId]);
      expect(listaRes.body.taskComAcordo.map((t: { id: string }) => t.id)).toEqual([
        linha2.taskId,
      ]);
    });

    it('rejects a missing/non-string texto with 400 (categoria de validação de entrada)', async () => {
      const res = await request(app).post('/tasks/lote').send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');

      const tasksNoBanco = await prisma.task.findMany();
      expect(tasksNoBanco).toEqual([]);
    });
  });
});
