// Testes do fetch wrapper `request` (ver ./http.ts). Cobrem os casos
// documentados no próprio wrapper: resposta de sucesso com corpo JSON,
// resposta de sucesso sem corpo (204), resposta de erro no formato padrão
// `{ "erro": { "codigo", "mensagem" } }`, e resposta de erro com corpo
// malformado/não-JSON (fallback de `extrairErro`).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import { request } from './http';

function mockFetchOnce(response: Response): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('request', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retorna o corpo desserializado quando a resposta é ok', async () => {
    const corpo = { id: '1', titulo: 'Minha task' };
    mockFetchOnce(jsonResponse(200, corpo));

    const resultado = await request<typeof corpo>('/tasks');

    expect(resultado).toEqual(corpo);
  });

  it('retorna undefined sem tentar parsear o corpo quando a resposta é 204', async () => {
    const response = new Response(null, { status: 204 });
    const jsonSpy = vi.spyOn(response, 'json');
    mockFetchOnce(response);

    const resultado = await request<void>('/tasks/abc/ordem', {
      method: 'PUT',
      body: { novaPosicao: 2 },
    });

    expect(resultado).toBeUndefined();
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it('lança ApiError com status/codigo/mensagem quando a resposta não é ok', async () => {
    mockFetchOnce(
      jsonResponse(409, {
        erro: { codigo: 'TASK_JA_TEM_ACORDO_ATIVO', mensagem: 'A task já possui um acordo ativo.' },
      }),
    );

    await expect(request('/tasks/abc/acordos', { method: 'POST', body: {} })).rejects.toMatchObject(
      {
        status: 409,
        codigo: 'TASK_JA_TEM_ACORDO_ATIVO',
        message: 'A task já possui um acordo ativo.',
      },
    );
  });

  it('lança ApiError com valores de fallback quando o corpo de erro não é JSON válido', async () => {
    const response = new Response('<html>Internal Server Error</html>', {
      status: 500,
      headers: { 'Content-Type': 'text/html' },
    });
    mockFetchOnce(response);

    let erroCapturado: unknown;
    try {
      await request('/tasks');
    } catch (erro) {
      erroCapturado = erro;
    }

    expect(erroCapturado).toBeInstanceOf(ApiError);
    expect(erroCapturado).toMatchObject({
      status: 500,
      codigo: 'ERRO_DESCONHECIDO',
      message: 'Falha na requisição (HTTP 500).',
    });
  });

  it('lança ApiError com valores de fallback quando o corpo de erro não segue o formato esperado', async () => {
    mockFetchOnce(jsonResponse(400, { mensagemInesperada: 'algo deu errado' }));

    await expect(request('/tasks')).rejects.toMatchObject({
      status: 400,
      codigo: 'ERRO_DESCONHECIDO',
      message: 'Falha na requisição (HTTP 400).',
    });
  });
});
