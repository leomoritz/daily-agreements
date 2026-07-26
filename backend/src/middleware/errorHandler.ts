import type { ErrorRequestHandler } from 'express';

import { ConflictError, NotFoundError, ValidationError } from '../services/errors.js';

// Central error-handling middleware. Translates domain errors (AppError
// subclasses defined in services/errors.ts) into the standard API error
// response shape defined in design.md "Error Handling":
//
//   { "erro": { "codigo": string, "mensagem": string } }
//
//   ValidationError -> 400
//   NotFoundError   -> 404
//   ConflictError   -> 409
//   anything else   -> 500 (infra/unexpected errors, generic response)
//
// Must be registered last, after all routes, per Express conventions.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ValidationError) {
    res.status(400).json({ erro: { codigo: err.codigo, mensagem: err.message } });
    return;
  }

  if (err instanceof NotFoundError) {
    res.status(404).json({ erro: { codigo: err.codigo, mensagem: err.message } });
    return;
  }

  if (err instanceof ConflictError) {
    res.status(409).json({ erro: { codigo: err.codigo, mensagem: err.message } });
    return;
  }

  console.error(err);
  res
    .status(500)
    .json({ erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno do servidor' } });
};
