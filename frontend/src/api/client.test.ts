// Testes das funções tipadas do API client (ver ./client.ts). Focam em
// verificar que cada função monta a requisição HTTP correta (método, URL,
// corpo) e propaga corretamente o resultado (ou erro) do fetch wrapper —
// as regras de parse/erro em si já são cobertas por ./http.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import {
  avaliarAcordoAtual,
  criarTask,
  editarTask,
  listarTiposDeAcordo,
  obterAcordosNaoAtualizados,
  obterAtividadesFinalizadas,
  obterLista,
  registrarAcordo,
  removerTask,
  removerUsuario,
  reordenarTask,
  repetirUltimoAcordo,
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

  it('obterAcordosNaoAtualizados: faz GET /tasks/nao-atualizados e retorna a lista desserializada', async () => {
    const naoAtualizados = [
      { id: '1', titulo: 'Task sem acordo hoje', ordemExibicao: 0 },
    ];
    const fetchMock = mockFetchOnce(jsonResponse(200, naoAtualizados));

    const resultado = await obterAcordosNaoAtualizados();

    expect(resultado).toEqual(naoAtualizados);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/tasks/nao-atualizados');
    expect(init.method).toBe('GET');
  });

  it('obterAcordosNaoAtualizados: propaga ApiError quando o backend responde com erro', async () => {
    mockFetchOnce(
      jsonResponse(500, { erro: { codigo: 'ERRO_INTERNO', mensagem: 'Falha inesperada.' } }),
    );

    await expect(obterAcordosNaoAtualizados()).rejects.toMatchObject({
      status: 500,
      codigo: 'ERRO_INTERNO',
      message: 'Falha inesperada.',
    });
  });

  it('repetirUltimoAcordo: faz POST /tasks/:id/acordos/repetir sem corpo quando chamado sem input', async () => {
    const acordo = { id: '2', taskId: 'abc', tipoAcordoId: 'tipo-1', dataRegistro: '2026-07-13T10:00:00.000Z', estadoCumprimento: 'pendente', motivoNaoCumprimentoId: null };
    const fetchMock = mockFetchOnce(jsonResponse(201, acordo));

    const resultado = await repetirUltimoAcordo('abc');

    expect(resultado).toEqual(acordo);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/tasks/abc/acordos/repetir');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('repetirUltimoAcordo: faz POST /tasks/:id/acordos/repetir com o corpo { motivoId?, motivoNome? } quando informado', async () => {
    const acordo = { id: '2', taskId: 'abc', tipoAcordoId: 'tipo-1', dataRegistro: '2026-07-13T10:00:00.000Z', estadoCumprimento: 'pendente', motivoNaoCumprimentoId: null };
    const fetchMock = mockFetchOnce(jsonResponse(201, acordo));

    const resultado = await repetirUltimoAcordo('abc', { motivoId: 'motivo-1', motivoNome: 'Motivo digitado' });

    expect(resultado).toEqual(acordo);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/tasks/abc/acordos/repetir');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ motivoId: 'motivo-1', motivoNome: 'Motivo digitado' });
  });

  it('registrarAcordo: envia confirmaCumprimentoAcordoAtual no corpo quando informado', async () => {
    const acordo = { id: '3', taskId: 'abc', tipoAcordoId: 'tipo-1', dataRegistro: '2026-07-13T10:00:00.000Z', estadoCumprimento: 'pendente', motivoNaoCumprimentoId: null };
    const fetchMock = mockFetchOnce(jsonResponse(201, acordo));

    const input = { tipoAcordoId: 'tipo-1', confirmaCumprimentoAcordoAtual: true };
    const resultado = await registrarAcordo('abc', input);

    expect(resultado).toEqual(acordo);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/tasks/abc/acordos');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it('avaliarAcordoAtual: envia motivoNome no corpo quando informado', async () => {
    const acordo = { id: '3', taskId: 'abc', tipoAcordoId: 'tipo-1', dataRegistro: '2026-07-13T10:00:00.000Z', estadoCumprimento: 'nao_cumprido', motivoNaoCumprimentoId: 'motivo-1' };
    const fetchMock = mockFetchOnce(jsonResponse(200, acordo));

    const input = { resultado: 'nao_cumprido' as const, motivoNome: 'Motivo digitado' };
    const resultado = await avaliarAcordoAtual('abc', input);

    expect(resultado).toEqual(acordo);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/tasks/abc/acordos/atual');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  describe('timeout traduzido em ApiError de falha de comunicação', () => {
    // O fetch mock nunca resolve por conta própria — apenas rejeita com
    // AbortError quando o `AbortController` (criado pelo wrapper em
    // ./http.ts) aborta o `signal`, replicando o comportamento real do
    // `fetch` diante de um `AbortController.abort()`.
    function mockFetchNuncaResolve(): void {
      const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      });
      vi.stubGlobal('fetch', fetchMock);
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('operação de Acordo (registrarAcordo): timeout de 30s rejeita com ApiError ERRO_COMUNICACAO', async () => {
      vi.useFakeTimers();
      mockFetchNuncaResolve();

      const expectativa = expect(
        registrarAcordo('abc', { tipoAcordoId: 'tipo-1' }),
      ).rejects.toMatchObject({ status: 0, codigo: 'ERRO_COMUNICACAO' });

      await vi.advanceTimersByTimeAsync(30_000);
      await expectativa;
    });

    it('obterAcordosNaoAtualizados: timeout de 3s rejeita com ApiError ERRO_COMUNICACAO', async () => {
      vi.useFakeTimers();
      mockFetchNuncaResolve();

      const expectativa = expect(obterAcordosNaoAtualizados()).rejects.toMatchObject({
        status: 0,
        codigo: 'ERRO_COMUNICACAO',
      });

      await vi.advanceTimersByTimeAsync(3_000);
      await expectativa;
    });
  });
});
