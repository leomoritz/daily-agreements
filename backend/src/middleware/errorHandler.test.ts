import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { ConflictError, NotFoundError, ValidationError } from '../services/errors.js';
import { errorHandler } from './errorHandler.js';

// Minimal test app wiring dummy routes that throw each domain error type,
// mirroring how real routes will call `next(err)` (or throw inside an
// async handler wrapper) once implemented in later tasks.
function buildTestApp() {
  const app = express();

  app.get('/validation', () => {
    throw new ValidationError('TITULO_INVALIDO', 'título obrigatório');
  });

  app.get('/not-found', () => {
    throw new NotFoundError('TASK_NAO_ENCONTRADA', 'Task não encontrada');
  });

  app.get('/conflict', () => {
    throw new ConflictError('ACORDO_ATUAL_PENDENTE', 'já existe um Acordo pendente');
  });

  app.get('/unexpected', () => {
    throw new Error('falha inesperada de infraestrutura');
  });

  app.use(errorHandler);
  return app;
}

describe('errorHandler middleware', () => {
  it('maps ValidationError to 400 with { erro: { codigo, mensagem } }', async () => {
    const res = await request(buildTestApp()).get('/validation');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      erro: { codigo: 'TITULO_INVALIDO', mensagem: 'título obrigatório' },
    });
  });

  it('maps NotFoundError to 404 with { erro: { codigo, mensagem } }', async () => {
    const res = await request(buildTestApp()).get('/not-found');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      erro: { codigo: 'TASK_NAO_ENCONTRADA', mensagem: 'Task não encontrada' },
    });
  });

  it('maps ConflictError to 409 with { erro: { codigo, mensagem } }', async () => {
    const res = await request(buildTestApp()).get('/conflict');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      erro: { codigo: 'ACORDO_ATUAL_PENDENTE', mensagem: 'já existe um Acordo pendente' },
    });
  });

  it('maps unexpected errors to a generic 500 response', async () => {
    const res = await request(buildTestApp()).get('/unexpected');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('erro.codigo');
    expect(res.body).toHaveProperty('erro.mensagem');
  });
});

// Task 6.5: format/content of error responses for each category of the
// design.md "Error Handling" table. ValidationError covers both the
// "Validação de entrada" and "Referência inválida" categories (both map
// to 400 — the design distinguishes them only by cause, not by HTTP
// status or error shape), and ConflictError covers "Conflito de
// unicidade" (409). Every response must follow the standard shape
// `{ erro: { codigo: string, mensagem: string } }` exactly (no
// additional or missing top-level fields), with `codigo` and `mensagem`
// both non-empty strings.
describe('errorHandler response format and content per category', () => {
  function expectStandardErrorShape(body: unknown, status: number, res: { status: number }) {
    expect(res.status).toBe(status);
    expect(body).toEqual({
      erro: {
        codigo: expect.any(String),
        mensagem: expect.any(String),
      },
    });
  }

  it('categoria "validação de entrada" (400): ValidationError for a bad título maps to { erro: { codigo, mensagem } }', async () => {
    // Requirements 1.2, 1.3, 1.6: título/descrição validation failures.
    const app = express();
    app.get('/validacao', () => {
      throw new ValidationError('TITULO_INVALIDO', 'O título é obrigatório e deve ter no máximo 200 caracteres.');
    });
    app.use(errorHandler);

    const res = await request(app).get('/validacao');

    expectStandardErrorShape(res.body, 400, res);
    expect(res.body).toEqual({
      erro: { codigo: 'TITULO_INVALIDO', mensagem: 'O título é obrigatório e deve ter no máximo 200 caracteres.' },
    });
    expect(res.body.erro.codigo.length).toBeGreaterThan(0);
    expect(res.body.erro.mensagem.length).toBeGreaterThan(0);
  });

  it('categoria "referência inválida" (400): ValidationError for a non-existent Responsável maps to { erro: { codigo, mensagem } }', async () => {
    // Requirement 1.8: Responsável informado não existe no Cadastro_de_Usuários.
    // Same HTTP status and response shape as generic validation, per the
    // design's Error Handling table (both categories map to 400 via
    // ValidationError).
    const app = express();
    app.get('/referencia-invalida', () => {
      throw new ValidationError('RESPONSAVEL_NAO_CADASTRADO', 'O Responsável informado não está cadastrado.');
    });
    app.use(errorHandler);

    const res = await request(app).get('/referencia-invalida');

    expectStandardErrorShape(res.body, 400, res);
    expect(res.body).toEqual({
      erro: { codigo: 'RESPONSAVEL_NAO_CADASTRADO', mensagem: 'O Responsável informado não está cadastrado.' },
    });
  });

  it('categoria "conflito de unicidade" (409): ConflictError for a duplicate cadastro value maps to { erro: { codigo, mensagem } }', async () => {
    // Requirements 10.3, 11.3, 15.3, 15.4, 15.5: nome de cadastro (Tipo/Motivo/Usuário)
    // já existente, case-insensitive.
    const app = express();
    app.get('/duplicado', () => {
      throw new ConflictError('VALOR_DUPLICADO', 'Usuário informado já está cadastrado.');
    });
    app.use(errorHandler);

    const res = await request(app).get('/duplicado');

    expectStandardErrorShape(res.body, 409, res);
    expect(res.body).toEqual({
      erro: { codigo: 'VALOR_DUPLICADO', mensagem: 'Usuário informado já está cadastrado.' },
    });
  });

  it('every category response has exactly the "erro.codigo"/"erro.mensagem" fields, with no extra top-level keys', async () => {
    const app = express();
    app.get('/validacao', () => {
      throw new ValidationError('VALOR_OBRIGATORIO', 'Valor é obrigatório.');
    });
    app.get('/duplicado', () => {
      throw new ConflictError('VALOR_DUPLICADO', 'Valor informado já está cadastrado.');
    });
    app.use(errorHandler);

    const validacaoRes = await request(app).get('/validacao');
    const duplicadoRes = await request(app).get('/duplicado');

    expect(Object.keys(validacaoRes.body)).toEqual(['erro']);
    expect(Object.keys(validacaoRes.body.erro).sort()).toEqual(['codigo', 'mensagem']);
    expect(Object.keys(duplicadoRes.body)).toEqual(['erro']);
    expect(Object.keys(duplicadoRes.body.erro).sort()).toEqual(['codigo', 'mensagem']);
  });
});
