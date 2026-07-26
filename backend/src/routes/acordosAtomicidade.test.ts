// Integration tests for real transactional rollback of the combined
// AcordoService operations (Registro_de_Acordo_com_Avaliacao and Repetir
// Ultimo Acordo), plus GET /tasks/nao-atualizados with a controlled
// clock — task 7.6.
//
// `acordoService.test.ts`'s Property 13 already exercises "rejeição
// implica estado inalterado" against fake in-memory repositories with a
// *passthrough* transaction runner — that runner never opens a real
// database transaction, so it cannot prove that a rejection partway
// through a combined operation actually rolls back the writes already
// performed by its first step. This file complements that property with
// a real Prisma/SQLite database (mirroring the isolated-DB bootstrap
// pattern from taskRoutes.test.ts), exercising the production
// `prisma.$transaction`-backed TransactionRunner end-to-end through HTTP,
// per design.md's "Atomicidade das operações combinadas": "um teste de
// integração com Prisma/SQLite real cobre o rollback de fato — o runner
// passthrough não exercita a transação."
//
// Both rollback scenarios are forced through the public HTTP contract (or
// the closest realistic real-DB equivalent) rather than by mocking any
// service/repository internals:
//
// - `POST /tasks/:id/acordos` with `confirmaCumprimentoAcordoAtual: true`:
//   the first step (evaluating the pendente Acordo_Atual as cumprido)
//   succeeds and writes; the second step (registering the new Acordo)
//   fails because the caller also supplies a `responsavelId` that does
//   not exist in the Cadastro_de_Usuários — a real, client-triggerable
//   validation failure that design.md explicitly lists as one of the
//   generator's injected failures for Property 13.
// - `POST /tasks/:id/acordos/repetir`: the Acordo_Atual's `tipoAcordoId`
//   is corrupted directly at the database level (bypassing the FK
//   constraint only for that single seeding statement) to simulate
//   design.md's own example of the atomicity gap this feature closes —
//   "Tipo_de_Acordo removido do cadastro no meio do caminho". The first
//   step (evaluating não cumprido, including the inline creation of a
//   new Motivo_de_Nao_Cumprimento via `motivoNome`) succeeds and writes;
//   the second step (registering the repeated Acordo) then fails
//   `registrarAcordo`'s own Tipo_de_Acordo existence check.
//
// _Requirements: 4.8, 5.5, 7.3, 8.5, 10.5_

import express, { type Express } from 'express';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../generated/prisma/index.js';

const backendDir = fileURLToPath(new URL('../..', import.meta.url));

describe('atomicidade das operações combinadas de Acordo (Prisma/SQLite real)', () => {
  let tempDir: string;
  let prisma: PrismaClient;
  let app: Express;

  beforeAll(async () => {
    // Isolated SQLite file so this test never depends on (or mutates) the
    // developer's local database, mirroring taskRoutes.test.ts.
    tempDir = mkdtempSync(join(tmpdir(), 'daily-agreements-acordos-atomicidade-test-'));
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

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('POST /tasks/:id/acordos (Registro_de_Acordo_com_Avaliacao)', () => {
    it('rolls back the cumprido evaluation of the Acordo_Atual pendente when the segunda etapa (Responsável inválido) falha (Requirements 8.5, 10.5)', async () => {
      const tipoAtual = await prisma.tipoAcordo.create({ data: { nome: 'Enviar para review' } });
      const tipoNovo = await prisma.tipoAcordo.create({ data: { nome: 'Enviar para deploy' } });
      const task = await prisma.task.create({ data: { titulo: 'Task de teste', ordemExibicao: 0 } });
      const acordoAtual = await prisma.acordo.create({
        data: { taskId: task.id, tipoAcordoId: tipoAtual.id },
      });
      await prisma.task.update({ where: { id: task.id }, data: { acordoAtualId: acordoAtual.id } });

      const res = await request(app)
        .post(`/tasks/${task.id}/acordos`)
        .send({
          tipoAcordoId: tipoNovo.id,
          confirmaCumprimentoAcordoAtual: true,
          responsavelId: 'responsavel-que-nao-existe',
        });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ erro: { codigo: 'RESPONSAVEL_NAO_CADASTRADO' } });
      expect(res.body.erro.mensagem).toBeTruthy();

      // A avaliação do Acordo_Atual como cumprido (primeira etapa, já
      // persistida antes da segunda etapa falhar) deve ter sido
      // integralmente revertida pela transação real.
      const acordoAtualDepois = await prisma.acordo.findUnique({ where: { id: acordoAtual.id } });
      expect(acordoAtualDepois?.estadoCumprimento).toBe('pendente');

      const taskDepois = await prisma.task.findUnique({ where: { id: task.id } });
      expect(taskDepois?.acordoAtualId).toBe(acordoAtual.id);

      const acordosDaTask = await prisma.acordo.findMany({ where: { taskId: task.id } });
      expect(acordosDaTask).toHaveLength(1);
    });
  });

  describe('POST /tasks/:id/acordos/repetir', () => {
    it('rolls back the não cumprido evaluation e a criação inline do Motivo_de_Nao_Cumprimento quando a segunda etapa (Tipo_de_Acordo inválido) falha (Requirements 4.8, 5.5, 10.5)', async () => {
      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Enviar para review' } });
      const task = await prisma.task.create({ data: { titulo: 'Task de teste', ordemExibicao: 0 } });
      const acordoAtual = await prisma.acordo.create({
        data: { taskId: task.id, tipoAcordoId: tipoAcordo.id },
      });
      await prisma.task.update({ where: { id: task.id }, data: { acordoAtualId: acordoAtual.id } });

      // Simula, ao nível do banco, o cenário que design.md usa para
      // justificar a transação ("Tipo_de_Acordo removido do cadastro no
      // meio do caminho"): corrompe o tipoAcordoId do Acordo_Atual para um
      // id inexistente, desabilitando a checagem de chave estrangeira só
      // para esta única instrução de seed (fora da transação exercitada
      // pela rota) — sem mockar nenhum serviço/repositório.
      await prisma.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
      await prisma.$executeRaw`UPDATE "Acordo" SET "tipoAcordoId" = 'tipo-de-acordo-inexistente' WHERE "id" = ${acordoAtual.id}`;
      await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');

      const res = await request(app)
        .post(`/tasks/${task.id}/acordos/repetir`)
        .send({ motivoNome: 'Motivo criado inline' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ erro: { codigo: 'TIPO_ACORDO_INVALIDO' } });
      expect(res.body.erro.mensagem).toBeTruthy();

      // A avaliação não cumprido (com o motivo resolvido) da primeira
      // etapa deve ter sido revertida junto com a criação inline do
      // motivo — nada disso deve sobreviver à falha da segunda etapa.
      const acordoAtualDepois = await prisma.acordo.findUnique({ where: { id: acordoAtual.id } });
      expect(acordoAtualDepois?.estadoCumprimento).toBe('pendente');
      expect(acordoAtualDepois?.motivoNaoCumprimentoId).toBeFalsy();

      const taskDepois = await prisma.task.findUnique({ where: { id: task.id } });
      expect(taskDepois?.numTentativas).toBe(0);
      expect(taskDepois?.acordoAtualId).toBe(acordoAtual.id);

      const motivoCriadoInline = await prisma.motivoNaoCumprimento.findMany({
        where: { nome: 'Motivo criado inline' },
      });
      expect(motivoCriadoInline).toHaveLength(0);

      const acordosDaTask = await prisma.acordo.findMany({ where: { taskId: task.id } });
      expect(acordosDaTask).toHaveLength(1);
    });
  });

  describe('GET /tasks/nao-atualizados com clock controlado', () => {
    it('exclui Tasks com Acordo registrado hoje e inclui Tasks com Acordo em dia anterior ou sem Acordo (Requirements 7.3, 7.4, 7.5, 7.6, 7.7)', async () => {
      // Clock controlado via fake timers do vitest: `new Date()` dentro do
      // ListaDeAcordosService (clock padrão, injetado pela instância
      // singleton usada pela rota) passa a refletir este instante fixo,
      // sem precisar reconstruir o serviço/rota.
      const hoje = new Date(2024, 5, 15, 12, 0, 0);
      vi.useFakeTimers();
      vi.setSystemTime(hoje);

      const tipoAcordo = await prisma.tipoAcordo.create({ data: { nome: 'Enviar para review' } });

      const taskSemAcordo = await prisma.task.create({
        data: { titulo: 'Task sem acordo', ordemExibicao: 0 },
      });

      const taskAtualizadaHoje = await prisma.task.create({
        data: { titulo: 'Task atualizada hoje (limite 00:00)', ordemExibicao: 1 },
      });
      const acordoHoje = await prisma.acordo.create({
        data: {
          taskId: taskAtualizadaHoje.id,
          tipoAcordoId: tipoAcordo.id,
          dataRegistro: new Date(2024, 5, 15, 0, 0, 0),
        },
      });
      await prisma.task.update({
        where: { id: taskAtualizadaHoje.id },
        data: { acordoAtualId: acordoHoje.id },
      });

      const taskDiaAnterior = await prisma.task.create({
        data: { titulo: 'Task de dia anterior (limite 23:59:59)', ordemExibicao: 2 },
      });
      const acordoDiaAnterior = await prisma.acordo.create({
        data: {
          taskId: taskDiaAnterior.id,
          tipoAcordoId: tipoAcordo.id,
          dataRegistro: new Date(2024, 5, 14, 23, 59, 59),
        },
      });
      await prisma.task.update({
        where: { id: taskDiaAnterior.id },
        data: { acordoAtualId: acordoDiaAnterior.id },
      });

      const res = await request(app).get('/tasks/nao-atualizados');

      expect(res.status).toBe(200);
      const ids = res.body.map((t: { id: string }) => t.id);
      expect(ids).toEqual([taskSemAcordo.id, taskDiaAnterior.id]);
      expect(ids).not.toContain(taskAtualizadaHoje.id);

      const itemSemAcordo = res.body.find((t: { id: string }) => t.id === taskSemAcordo.id);
      expect(itemSemAcordo.dataUltimaAtualizacaoAcordo).toBeFalsy();

      const itemDiaAnterior = res.body.find((t: { id: string }) => t.id === taskDiaAnterior.id);
      expect(itemDiaAnterior.dataUltimaAtualizacaoAcordo).toBeTruthy();
      expect(itemDiaAnterior.tipoAcordoNome).toBe('Enviar para review');
    });
  });
});
