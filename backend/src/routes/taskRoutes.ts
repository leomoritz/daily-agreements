// Task routes — GET /tasks?search= (Lista_de_Acordos), POST /tasks (task
// creation) and POST /tasks/lote (batch task creation). See design.md
// "Backend — API REST (contratos)":
//
//   GET  /tasks?search=
//   POST /tasks
//   POST /tasks/lote
//
// Delegates all validation (título, descrição, Responsável) to
// TaskService.criarTask, which throws ValidationError on rejection. That
// error is forwarded to the central errorHandler middleware via the
// asyncHandler wrapper, which renders the standard
// `{ "erro": { "codigo", "mensagem" } }` response with the appropriate
// HTTP status (task 6.1).
//
// Note on route ordering: `/lote` is registered as a literal path
// segment, so Express matches it before it would ever consider `/:id`
// (literal segments take precedence over param segments at the same
// position) — but it is still registered here, right after `POST /`,
// so there's no ambiguity to reason about when reading the file.

import { Router } from 'express';

import { acordoService } from '../services/acordoService.js';
import { atividadesFinalizadasService } from '../services/atividadesFinalizadasService.js';
import { cadastroEmLoteService } from '../services/cadastroEmLoteService.js';
import { listaDeAcordosService } from '../services/listaDeAcordosService.js';
import { taskService } from '../services/taskService.js';
import { ValidationError } from '../services/errors.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const tasksRouter = Router();

// GET /tasks/finalizadas — returns the Atividades_Finalizadas view: every
// Task logically removed by completion (`concluida = true`), ordered by
// data de finalização descending, each flagged with `finalizadaHoje` when
// finalized on the current calendar day. Registered before `/:id`-shaped
// routes below so Express matches this literal segment first.
tasksRouter.get(
  '/finalizadas',
  asyncHandler(async (_req, res) => {
    const atividades = await atividadesFinalizadasService.obterAtividadesFinalizadas();
    res.status(200).json(atividades);
  }),
);

// GET /tasks?search= — returns the Lista_de_Acordos (grouped, ordered,
// and optionally filtered by título/Responsável). Delegates to
// ListaDeAcordosService.obterLista (Requirements 3.1, 3.2, 3.3, 3.4, 3.5,
// 3.6, 13.1, 13.2, 13.3, 13.4).
tasksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const lista = await listaDeAcordosService.obterLista(search);
    res.status(200).json(lista);
  }),
);

tasksRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};

    if (typeof body.titulo !== 'string') {
      throw new ValidationError(
        'TITULO_INVALIDO',
        'O título é obrigatório e deve ter no máximo 200 caracteres.',
      );
    }

    const descricao = typeof body.descricao === 'string' ? body.descricao : undefined;
    const responsavelId =
      typeof body.responsavelId === 'string' ? body.responsavelId : undefined;

    const criada = await taskService.criarTask({
      titulo: body.titulo,
      descricao,
      responsavelId,
    });
    res.status(201).json(criada);
  }),
);

// POST /tasks/lote — batch Task registration from pasted text.
// Delegates to CadastroEmLoteService.processarLote (Requirements 12.1,
// 12.5, 12.6). This request always responds 200 with a per-line report
// (accepted/rejected + reason): the batch as a whole never fails
// all-or-nothing, only individual lines are rejected.
tasksRouter.post(
  '/lote',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};

    if (typeof body.texto !== 'string') {
      throw new ValidationError('TEXTO_INVALIDO', 'O texto é obrigatório e deve ser uma string.');
    }

    const relatorio = await cadastroEmLoteService.processarLote(body.texto);
    res.status(200).json(relatorio);
  }),
);

// POST /tasks/:id/acordos — registers a new Acordo (first or next) for
// the Task. Delegates to AcordoService.registrarAcordo (Requirements
// 2.1, 2.2, 2.4, 2.5, 5.1, 5.2, 5.4, 5.5, 5.6, 5.7, 5.8).
tasksRouter.post(
  '/:id/acordos',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};

    if (typeof body.tipoAcordoId !== 'string') {
      throw new ValidationError(
        'TIPO_ACORDO_ID_OBRIGATORIO',
        'O Tipo_de_Acordo é obrigatório.',
      );
    }

    const responsavelId =
      typeof body.responsavelId === 'string' ? body.responsavelId : undefined;

    const acordo = await acordoService.registrarAcordo(
      req.params.id,
      body.tipoAcordoId,
      responsavelId,
    );
    res.status(201).json(acordo);
  }),
);

// PATCH /tasks/:id/acordos/atual — evaluates the Task's Acordo_Atual.
// Delegates to AcordoService.avaliarAcordoAtual (Requirements 4.1, 4.2,
// 4.3, 4.5, 4.6, 4.7, 4.8).
tasksRouter.patch(
  '/:id/acordos/atual',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};

    if (body.resultado !== 'cumprido' && body.resultado !== 'nao_cumprido') {
      throw new ValidationError(
        'RESULTADO_INVALIDO',
        "O resultado é obrigatório e deve ser 'cumprido' ou 'nao_cumprido'.",
      );
    }

    const motivoId = typeof body.motivoId === 'string' ? body.motivoId : undefined;

    const acordo = await acordoService.avaliarAcordoAtual(
      req.params.id,
      body.resultado,
      motivoId,
    );
    res.status(200).json(acordo);
  }),
);

// POST /tasks/:id/acordos/repetir — "Repetir último acordo": evaluates
// the Task's Acordo_Atual (cumprido if its Tipo_de_Acordo is "Avaliar e
// planejar", não cumprido otherwise) and registers a new Acordo of that
// same Tipo_de_Acordo, keeping the current Responsável. Delegates to
// AcordoService.repetirUltimoAcordo. Registered before `/:id/acordos`
// would ever conflict — Express matches the more specific
// `/:id/acordos/repetir` literal segment ahead of any param-only route,
// so there is no ambiguity with `POST /:id/acordos`.
tasksRouter.post(
  '/:id/acordos/repetir',
  asyncHandler(async (req, res) => {
    const acordo = await acordoService.repetirUltimoAcordo(req.params.id);
    res.status(201).json(acordo);
  }),
);

// POST /tasks/:id/finalizar — "Finalizar": marca o Acordo_Atual da Task
// como cumprido e finaliza a atividade (marca a Task como concluída),
// independentemente do Tipo_de_Acordo do Acordo_Atual. Delegates to
// AcordoService.finalizarTask. Registered before `/:id/acordos` would
// ever conflict — Express matches the more specific `/:id/finalizar`
// literal segment ahead of any param-only route.
tasksRouter.post(
  '/:id/finalizar',
  asyncHandler(async (req, res) => {
    const acordo = await acordoService.finalizarTask(req.params.id);
    res.status(200).json(acordo);
  }),
);

// GET /tasks/:id/historico — returns the Task's full Acordo history.
// Delegates to TaskService.buscarHistorico (Requirements 7.1, 7.4, 7.5).
tasksRouter.get(
  '/:id/historico',
  asyncHandler(async (req, res) => {
    const historico = await taskService.buscarHistorico(req.params.id);
    res.status(200).json(historico);
  }),
);

// PATCH /tasks/:id — edits título and/or Responsável. Delegates to
// TaskService.editarTask (Requirements 9.1, 9.2, 9.3, 9.6, 9.7). Only
// fields actually present in the request body are forwarded to the
// service, so that "not provided" (leave untouched) can be
// distinguished from "provided as empty/null" (remove Responsável).
tasksRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const input: { titulo?: string; responsavelId?: string | null } = {};

    if (Object.prototype.hasOwnProperty.call(body, 'titulo')) {
      input.titulo = body.titulo;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'responsavelId')) {
      input.responsavelId = body.responsavelId;
    }

    const atualizada = await taskService.editarTask(req.params.id, input);
    res.status(200).json(atualizada);
  }),
);

// DELETE /tasks/:id — physically removes the Task. Delegates to
// TaskService.removerTask (Requirements 9.4, 9.5).
tasksRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await taskService.removerTask(req.params.id);
    res.status(204).send();
  }),
);

// PUT /tasks/:id/ordem — reorders the Task to a new position. Delegates
// to TaskService.reordenarTask (Requirements 14.1, 14.3).
tasksRouter.put(
  '/:id/ordem',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};

    if (typeof body.novaPosicao !== 'number' || Number.isNaN(body.novaPosicao)) {
      throw new ValidationError(
        'NOVA_POSICAO_INVALIDA',
        'A nova posição é obrigatória e deve ser um número.',
      );
    }

    await taskService.reordenarTask(req.params.id, body.novaPosicao);
    res.status(204).send();
  }),
);
