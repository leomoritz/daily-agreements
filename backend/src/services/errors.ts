// Domain-level error types shared by all services (TaskService, AcordoService,
// CadastroService, etc). These map to the HTTP status codes and error
// categories defined in design.md "Error Handling":
//
//   ValidationError -> 400 (input validation / invalid reference)
//   NotFoundError   -> 404 (Task, Acordo_Atual or cadastro value not found)
//   ConflictError   -> 409 (state conflict, uniqueness conflict, in-use)
//
// The REST layer (task 6.1, not yet implemented) is expected to catch
// AppError instances and translate them into the standard
// `{ "erro": { "codigo": string, "mensagem": string } }` response shape.

export class AppError extends Error {
  readonly codigo: string;

  constructor(codigo: string, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.codigo = codigo;
  }
}

/** Input validation failures and invalid references (HTTP 400). */
export class ValidationError extends AppError {}

/** Requested resource does not exist (HTTP 404). */
export class NotFoundError extends AppError {}

/** State conflict, uniqueness conflict, or resource in use (HTTP 409). */
export class ConflictError extends AppError {}
