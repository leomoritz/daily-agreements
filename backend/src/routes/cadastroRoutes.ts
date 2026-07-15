// Cadastro routes — GET/POST/DELETE endpoints for the three configurable
// cadastros (Tipos_de_Acordo, Motivos_de_Nao_Cumprimento, Usuários). See
// design.md "Backend — API REST (contratos)":
//
//   GET/POST/DELETE /tipos-de-acordo(/:id)
//   GET/POST/DELETE /motivos-de-nao-cumprimento(/:id)
//   GET/POST/DELETE /usuarios(/:id)
//
// All three share the same shape (list all values; add a new value from
// a single string field in the request body; remove a value by id),
// mirroring the shared CadastroService<T> abstraction (design.md
// "Princípios de design" #4). This router factory is built once and
// reused for each cadastro (task 6.2, Requirements 10.2, 10.3, 10.4,
// 11.2, 11.3, 11.4, 15.2, 15.3, 15.4, 15.5, 15.6).
//
// Validation (trim, length limit, case-insensitive uniqueness) is
// performed by CadastroService.adicionar, which throws ValidationError /
// ConflictError on rejection. Those are forwarded to the central
// errorHandler middleware via the asyncHandler wrapper.
//
// DELETE /:id (task 13.3, Requirements 10.5, 11.5) is wired for all
// three routers — removal is delegated to CadastroService.remover, which
// rejects with NotFoundError (unknown id) or ConflictError (value in
// use: referenced by an existing Acordo for Tipos_de_Acordo/
// Motivos_de_Nao_Cumprimento, or referenced as Responsável of an
// existing Task for Usuários).

import { Router } from 'express';

import type { CadastroService } from '../services/cadastroService.js';
import {
  motivoNaoCumprimentoService,
  tipoAcordoService,
  usuarioCadastradoService,
} from '../services/cadastroService.js';
import { ValidationError } from '../services/errors.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Builds a GET/POST router for a single configurable cadastro.
 *
 * @param service the CadastroService instance backing this cadastro
 * @param bodyField the request body field holding the value to add
 *   (e.g. "nome" for Tipos_de_Acordo/Motivos_de_Nao_Cumprimento, or
 *   "nomeLogin" for Usuários, per design.md's Data Models)
 * @param label human-readable label used in the "campo obrigatório"
 *   validation error message when the body field is missing/not a string
 * @param comRemocao whether to also wire a `DELETE /:id` route backed by
 *   `service.remover` (Requirements 10.5, 11.5). Defaults to `false`.
 */
function buildCadastroRouter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: CadastroService<any, any>,
  bodyField: string,
  label: string,
  comRemocao = false,
): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const valores = await service.listar();
      res.status(200).json(valores);
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const valor = req.body?.[bodyField];

      if (typeof valor !== 'string') {
        throw new ValidationError(
          'VALOR_OBRIGATORIO',
          `${label} é obrigatório.`,
        );
      }

      const criado = await service.adicionar(valor);
      res.status(201).json(criado);
    }),
  );

  if (comRemocao) {
    router.delete(
      '/:id',
      asyncHandler(async (req, res) => {
        await service.remover(req.params.id);
        res.status(204).send();
      }),
    );
  }

  return router;
}

export const tiposDeAcordoRouter = buildCadastroRouter(
  tipoAcordoService,
  'nome',
  'Tipo_de_Acordo',
  true,
);

export const motivosDeNaoCumprimentoRouter = buildCadastroRouter(
  motivoNaoCumprimentoService,
  'nome',
  'Motivo_de_Nao_Cumprimento',
  true,
);

export const usuariosRouter = buildCadastroRouter(
  usuarioCadastradoService,
  'nomeLogin',
  'Usuário',
  true,
);
