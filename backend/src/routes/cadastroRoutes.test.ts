// Integration tests for the cadastro routes: GET/POST /tipos-de-acordo,
// /motivos-de-nao-cumprimento and /usuarios (task 6.4), plus
// DELETE /tipos-de-acordo/:id and DELETE /motivos-de-nao-cumprimento/:id
// (task 13.4, covering the routes implemented by task 13.3).
//
// These tests exercise the real Express routers wired to the real
// CadastroService/CadastroRepository stack, against an isolated SQLite
// database (mirroring the pattern used by taskRepository.test.ts and
// prisma/seed.test.ts), covering the happy path and each applicable
// error category (400 validation, 404 not found, 409 conflict — per
// design.md's "Error Handling" table) end-to-end through HTTP, per
// design.md's "Testing Strategy": "Integração ponta a ponta de cada rota
// REST com a camada de persistência (Prisma/SQLite), usando 1–3 exemplos
// representativos por rota."
//
// The routers are built from singleton services bound to the shared
// PrismaClient in db/prismaClient.ts, which reads `DATABASE_URL` from
// `process.env` at construction time. Setting `process.env.DATABASE_URL`
// to an isolated test database *before* dynamically importing the route
// modules (in `beforeAll`) makes the whole stack — routers, services,
// repositories, and the shared PrismaClient — operate against that
// isolated database, without requiring any test-only wiring in
// application code.
//
// _Requirements: 1.1, 1.8, 10.2, 10.3, 10.5, 11.2, 11.5, 15.2, 15.5_

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

describe('cadastro routes (GET/POST /tipos-de-acordo, /motivos-de-nao-cumprimento, /usuarios)', () => {
  let tempDir: string;
  let prisma: PrismaClient;
  let app: Express;

  beforeAll(async () => {
    // Isolated SQLite file so this test never depends on (or mutates) the
    // developer's local database, mirroring taskRepository.test.ts.
    tempDir = mkdtempSync(join(tmpdir(), 'daily-agreements-cadastro-routes-test-'));
    const dbPath = join(tempDir, 'test.db');
    const databaseUrl = `file:${dbPath}`;

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });

    // Must be set before the dynamic imports below, so that the shared
    // PrismaClient singleton (db/prismaClient.ts) — constructed the first
    // time it is imported, transitively, by the routers/services — binds
    // to this isolated test database instead of the developer's dev.db.
    process.env.DATABASE_URL = databaseUrl;

    const { prisma: sharedPrisma } = await import('../db/prismaClient.js');
    const {
      motivosDeNaoCumprimentoRouter,
      tiposDeAcordoRouter,
      usuariosRouter,
    } = await import('./cadastroRoutes.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');

    prisma = sharedPrisma;

    app = express();
    app.use(express.json());
    app.use('/tipos-de-acordo', tiposDeAcordoRouter);
    app.use('/motivos-de-nao-cumprimento', motivosDeNaoCumprimentoRouter);
    app.use('/usuarios', usuariosRouter);
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

  describe('GET/POST /tipos-de-acordo', () => {
    it('happy path: lists an empty cadastro, then the added value after POST (Requirement 10.2)', async () => {
      const antes = await request(app).get('/tipos-de-acordo');
      expect(antes.status).toBe(200);
      expect(antes.body).toEqual([]);

      const post = await request(app)
        .post('/tipos-de-acordo')
        .send({ nome: 'Enviar para review' });
      expect(post.status).toBe(201);
      expect(post.body).toMatchObject({ nome: 'Enviar para review' });
      expect(post.body.id).toBeTruthy();

      const depois = await request(app).get('/tipos-de-acordo');
      expect(depois.status).toBe(200);
      expect(depois.body).toEqual([post.body]);
    });

    it('rejects an empty nome with 400 and { erro: { codigo, mensagem } } (Requirement 10.3)', async () => {
      const res = await request(app).post('/tipos-de-acordo').send({ nome: '   ' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');

      const list = await request(app).get('/tipos-de-acordo');
      expect(list.body).toEqual([]);
    });

    it('rejects a duplicate nome (case-insensitive) with 409 (Requirement 10.3)', async () => {
      await request(app).post('/tipos-de-acordo').send({ nome: 'Finalizar' });

      const res = await request(app).post('/tipos-de-acordo').send({ nome: 'FINALIZAR' });

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');

      const list = await request(app).get('/tipos-de-acordo');
      expect(list.body).toHaveLength(1);
    });

    it('happy path: removes an unused Tipo_de_Acordo (Requirement 10.5)', async () => {
      const post = await request(app).post('/tipos-de-acordo').send({ nome: 'Enviar para deploy' });

      const res = await request(app).delete(`/tipos-de-acordo/${post.body.id}`);

      expect(res.status).toBe(204);
      const list = await request(app).get('/tipos-de-acordo');
      expect(list.body).toEqual([]);
    });

    it('rejects removal of a Tipo_de_Acordo that does not exist with 404 (Requirement 10.5)', async () => {
      const res = await request(app).delete('/tipos-de-acordo/nao-existe');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });

    it('rejects removal of a Tipo_de_Acordo referenced by an existing Acordo with 409 (Requirement 10.5)', async () => {
      const post = await request(app).post('/tipos-de-acordo').send({ nome: 'Avaliar e planejar' });
      const task = await prisma.task.create({ data: { titulo: 'Task de teste', ordemExibicao: 0 } });
      await prisma.acordo.create({ data: { taskId: task.id, tipoAcordoId: post.body.id } });

      const res = await request(app).delete(`/tipos-de-acordo/${post.body.id}`);

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');

      const list = await request(app).get('/tipos-de-acordo');
      expect(list.body).toHaveLength(1);
    });
  });

  describe('GET/POST /motivos-de-nao-cumprimento', () => {
    it('happy path: adds a Motivo_de_Nao_Cumprimento and lists it back (Requirement 11.2)', async () => {
      const post = await request(app)
        .post('/motivos-de-nao-cumprimento')
        .send({ nome: 'Dependência externa' });

      expect(post.status).toBe(201);
      expect(post.body).toMatchObject({ nome: 'Dependência externa' });

      const list = await request(app).get('/motivos-de-nao-cumprimento');
      expect(list.status).toBe(200);
      expect(list.body).toEqual([post.body]);
    });

    it('rejects a nome exceeding 100 characters with 400 (Requirement 11.3)', async () => {
      const res = await request(app)
        .post('/motivos-de-nao-cumprimento')
        .send({ nome: 'a'.repeat(101) });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });

    it('happy path: removes an unused Motivo_de_Nao_Cumprimento (Requirement 11.5)', async () => {
      const post = await request(app)
        .post('/motivos-de-nao-cumprimento')
        .send({ nome: 'Problema ambiente' });

      const res = await request(app).delete(`/motivos-de-nao-cumprimento/${post.body.id}`);

      expect(res.status).toBe(204);
      const list = await request(app).get('/motivos-de-nao-cumprimento');
      expect(list.body).toEqual([]);
    });

    it('rejects removal of a Motivo_de_Nao_Cumprimento that does not exist with 404 (Requirement 11.5)', async () => {
      const res = await request(app).delete('/motivos-de-nao-cumprimento/nao-existe');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });

    it('rejects removal of a Motivo_de_Nao_Cumprimento referenced by an existing Acordo with 409 (Requirement 11.5)', async () => {
      const post = await request(app)
        .post('/motivos-de-nao-cumprimento')
        .send({ nome: 'Falta de conhecimento técnico' });
      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Enviar para review' } });
      const task = await prisma.task.create({ data: { titulo: 'Task de teste', ordemExibicao: 0 } });
      await prisma.acordo.create({
        data: {
          taskId: task.id,
          tipoAcordoId: tipoAcordo.id,
          estadoCumprimento: 'nao_cumprido',
          motivoNaoCumprimentoId: post.body.id,
        },
      });

      const res = await request(app).delete(`/motivos-de-nao-cumprimento/${post.body.id}`);

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');

      const list = await request(app).get('/motivos-de-nao-cumprimento');
      expect(list.body).toHaveLength(1);
    });
  });

  describe('GET/POST /usuarios', () => {
    it('happy path: adds a Usuário_Cadastrado (nomeLogin) and lists it back (Requirement 15.2)', async () => {
      const post = await request(app).post('/usuarios').send({ nomeLogin: 'joao.silva' });

      expect(post.status).toBe(201);
      expect(post.body).toMatchObject({ nomeLogin: 'joao.silva' });

      const list = await request(app).get('/usuarios');
      expect(list.status).toBe(200);
      expect(list.body).toEqual([post.body]);
    });

    it('rejects a missing nomeLogin field with 400 (Requirement 15.2)', async () => {
      const res = await request(app).post('/usuarios').send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });

    it('rejects a duplicate nomeLogin (case-insensitive) with 409 (Requirement 15.5)', async () => {
      await request(app).post('/usuarios').send({ nomeLogin: 'maria.souza' });

      const res = await request(app).post('/usuarios').send({ nomeLogin: 'MARIA.SOUZA' });

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');

      const list = await request(app).get('/usuarios');
      expect(list.body).toHaveLength(1);
    });

    it('happy path: removes an unused Usuário_Cadastrado (Requirement 15.8)', async () => {
      const post = await request(app).post('/usuarios').send({ nomeLogin: 'pedro.lima' });

      const res = await request(app).delete(`/usuarios/${post.body.id}`);

      expect(res.status).toBe(204);
      const list = await request(app).get('/usuarios');
      expect(list.body).toEqual([]);
    });

    it('rejects removal of a Usuário_Cadastrado that does not exist with 404 (Requirement 15.8)', async () => {
      const res = await request(app).delete('/usuarios/nao-existe');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');
    });

    it('rejects removal of a Usuário_Cadastrado referenced as Responsável by an existing Task with 409 (Requirement 15.8)', async () => {
      const post = await request(app).post('/usuarios').send({ nomeLogin: 'carla.mendes' });
      await prisma.task.create({
        data: { titulo: 'Task de teste', ordemExibicao: 0, responsavelId: post.body.id },
      });

      const res = await request(app).delete(`/usuarios/${post.body.id}`);

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('erro.codigo');
      expect(res.body).toHaveProperty('erro.mensagem');

      const list = await request(app).get('/usuarios');
      expect(list.body).toHaveLength(1);
    });

    it('lists Usuário_Cadastrado in pt-BR alphabetical order, case/accent-insensitive (Requirements 6.1, 10.7)', async () => {
      // Seeded out of order and with mixed case; naive ASCII/binary
      // ordering would sort "1-teste" and accented names differently
      // (e.g. "Água"/"Ávila" after "Zeca").
      await request(app).post('/usuarios').send({ nomeLogin: 'Bruno' });
      await request(app).post('/usuarios').send({ nomeLogin: 'ávila' });
      await request(app).post('/usuarios').send({ nomeLogin: 'Alberto' });
      await request(app).post('/usuarios').send({ nomeLogin: 'ÁGUA' });
      await request(app).post('/usuarios').send({ nomeLogin: '1-teste' });

      const list = await request(app).get('/usuarios');

      expect(list.status).toBe(200);
      expect(list.body.map((usuario: { nomeLogin: string }) => usuario.nomeLogin)).toEqual([
        '1-teste',
        'ÁGUA',
        'Alberto',
        'ávila',
        'Bruno',
      ]);
    });
  });
});
