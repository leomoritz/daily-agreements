// Testes das funções tipadas do API client (ver ./client.ts). Focam em
// verificar que cada função monta a requisição HTTP correta (método, URL,
// corpo) e propaga corretamente o resultado (ou erro) do fetch wrapper —
// as regras de parse/erro em si já são cobertas por ./http.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import {
  criarTask,
  editarTask,
  listarTiposDeAcordo,
  obterAtividadesFinalizadas,
  obterLista,
  removerTask,
  removerUsuario,
  reordenarTask,
} from './client';

function mockFetchOnce(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('obterLista: faz GET /tasks e retorna a Lista_de_Acordos desserializada', async () => {
    const lista = { taskNova: [], taskComAcordo: [] };
    const fetchMock = mockFetchOnce(jsonResponse(200, lista));

    const resultado = await obterLista();

    expect(resultado).toEqual(lista);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/tasks');
    expect(init.method).toBe('GET');
  });

  it('listarTiposDeAcordo: faz GET /tipos-de-acordo e retorna a lista desserializada', async () => {
    const tipos = [{ id: '1', nome: 'Prazo' }];
    const fetchMock = mockFetchOnce(jsonResponse(200, tipos));

    const resultado = await listarTiposDeAcordo();

    expect(resultado).toEqual(tipos);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/tipos-de-acordo');
  });

  it('removerTask: faz DELETE /tasks/:id e resolve sem corpo (204)', async () => {
    const fetchMock = mockFetchOnce(new Response(null, { status: 204 }));

    const resultado = await removerTask('abc');

    expect(resultado).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/tasks/abc');
    expect(init.method).toBe('DELETE');
  });

  it('reordenarTask: faz PUT /tasks/:id/ordem com o corpo { novaPosicao } e resolve sem corpo (204)', async () => {
    const fetchMock = mockFetchOnce(new Response(null, { status: 204 }));

    const resultado = await reordenarTask('abc', 3);

    expect(resultado).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/tasks/abc/ordem');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ novaPosicao: 3 });
  });

  it('criarTask: faz POST /tasks com o corpo informado', async () => {
    const input = { titulo: 'Nova task', descricao: 'desc' };
    const taskCriada = { id: '1', ...input, responsavelId: null };
    const fetchMock = mockFetchOnce(jsonResponse(201, taskCriada));

    const resultado = await criarTask(input);

    expect(resultado).toEqual(taskCriada);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/tasks');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it('editarTask: faz PATCH /tasks/:id apenas com os campos informados', async () => {
    const taskEditada = { id: 'abc', titulo: 'Novo título' };
    const fetchMock = mockFetchOnce(jsonResponse(200, taskEditada));

    const resultado = await editarTask('abc', { titulo: 'Novo título' });

    expect(resultado).toEqual(taskEditada);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/tasks/abc');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ titulo: 'Novo título' });
  });

  it('removerUsuario: faz DELETE /usuarios/:id e resolve sem corpo (204)', async () => {
    const fetchMock = mockFetchOnce(new Response(null, { status: 204 }));

    const resultado = await removerUsuario('abc');

    expect(resultado).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/usuarios/abc');
    expect(init.method).toBe('DELETE');
  });

  it('obterAtividadesFinalizadas: faz GET /tasks/finalizadas e retorna a lista desserializada', async () => {
    const atividades = [
      { id: '1', titulo: 'Task finalizada', dataFinalizacao: '2026-07-13T10:00:00.000Z', finalizadaHoje: true },
    ];
    const fetchMock = mockFetchOnce(jsonResponse(200, atividades));

    const resultado = await obterAtividadesFinalizadas();

    expect(resultado).toEqual(atividades);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/tasks/finalizadas');
    expect(init.method).toBe('GET');
  });

  it('propaga ApiError quando o backend responde com erro', async () => {
    mockFetchOnce(
      jsonResponse(404, { erro: { codigo: 'TASK_NAO_ENCONTRADA', mensagem: 'Task não encontrada.' } }),
    );

    await expect(removerTask('inexistente')).rejects.toBeInstanceOf(ApiError);
  });
});
