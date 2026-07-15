// Fetch wrapper compartilhado por todas as funções do API client
// (ver frontend/src/api/client.ts). Centraliza:
//
// - a base URL configurável do backend (lida de `VITE_API_BASE_URL`; ver
//   frontend/.env.example e o proxy de dev em frontend/vite.config.ts —
//   task 28.2);
// - a serialização/deserialização JSON das requisições/respostas;
// - o parse do formato de erro padrão do backend
//   `{ "erro": { "codigo", "mensagem" } }` (design.md "Error Handling"),
//   traduzido para uma `ApiError` com `status`, `codigo` e `mensagem`.

import { ApiError } from './errors';

/**
 * Base URL do backend. Lida de `VITE_API_BASE_URL` (configurável por
 * ambiente); quando não definida, usa string vazia (paths relativos,
 * mesma origem) — que é o caso do `npm run dev`, onde o proxy configurado
 * em `vite.config.ts` encaminha as chamadas para o backend local
 * (backend/.env.example > PORT=3001), evitando problemas de CORS. Para
 * apontar diretamente para um backend em outro host/porta (ex.: rodando
 * `npm run preview` sem o proxy de dev), defina `VITE_API_BASE_URL`
 * explicitamente.
 */
const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

/** Corpo de erro padrão retornado pelo backend (design.md "Error Handling"). */
interface ErroResponseBody {
  erro: {
    codigo: string;
    mensagem: string;
  };
}

function isErroResponseBody(value: unknown): value is ErroResponseBody {
  if (typeof value !== 'object' || value === null || !('erro' in value)) {
    return false;
  }
  const erro = (value as { erro: unknown }).erro;
  return (
    typeof erro === 'object' &&
    erro !== null &&
    typeof (erro as { codigo: unknown }).codigo === 'string' &&
    typeof (erro as { mensagem: unknown }).mensagem === 'string'
  );
}

/**
 * Extrai `{ codigo, mensagem }` do corpo de uma resposta de erro. Quando o
 * corpo não segue o formato padrão (ex.: erro de rede antes de chegar ao
 * backend, ou um 500 sem corpo JSON), cai em valores genéricos em vez de
 * lançar durante o próprio tratamento de erro.
 */
async function extrairErro(response: Response): Promise<{ codigo: string; mensagem: string }> {
  try {
    const body: unknown = await response.json();
    if (isErroResponseBody(body)) {
      return body.erro;
    }
  } catch {
    // corpo ausente ou não é JSON válido — cai no fallback abaixo.
  }

  return {
    codigo: 'ERRO_DESCONHECIDO',
    mensagem: `Falha na requisição (HTTP ${response.status}).`,
  };
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Query params a anexar na URL (valores `undefined` são omitidos). */
  query?: Record<string, string | undefined>;
}

function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  // `URL` exige uma base absoluta; quando `API_BASE_URL` está vazia (paths
  // relativos, mesma origem — ver comentário acima), usa a origem atual da
  // página como base.
  const url = new URL(path, API_BASE_URL || window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

/**
 * Executa uma requisição HTTP contra o backend e retorna o corpo já
 * desserializado como `T`.
 *
 * Quando a resposta não é `ok` (status >= 400), lança uma `ApiError`
 * carregando o `status` HTTP e o `codigo`/`mensagem` extraídos do corpo
 * `{ "erro": { "codigo", "mensagem" } }` (design.md "Error Handling").
 *
 * Quando a resposta é `204 No Content`, retorna `undefined as T` — usado
 * pelas rotas que respondem sem corpo (ex.: `DELETE /tasks/:id`,
 * `PUT /tasks/:id/ordem`).
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query } = options;

  const response = await fetch(buildUrl(path, query), {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const { codigo, mensagem } = await extrairErro(response);
    throw new ApiError(response.status, codigo, mensagem);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
