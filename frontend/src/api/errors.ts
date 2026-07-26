// Erro lançado pelo fetch wrapper quando o backend responde com o formato
// padrão `{ "erro": { "codigo": string, "mensagem": string } }` (ver
// design.md "Error Handling"). Carrega o código HTTP da resposta junto
// com `codigo`/`mensagem` do corpo, para que quem consome a API possa
// decidir a ação (ex.: 404 vs 409) sem precisar reinspecionar o body.

export class ApiError extends Error {
  /** Código HTTP da resposta (400, 404, 409, 500, ...). */
  readonly status: number;
  /** Código do erro de domínio (ex.: "TITULO_INVALIDO"), quando disponível. */
  readonly codigo: string;

  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.name = 'ApiError';
    this.status = status;
    this.codigo = codigo;
  }
}
