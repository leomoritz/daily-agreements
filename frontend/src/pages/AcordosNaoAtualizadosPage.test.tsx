import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcordosNaoAtualizadosPage } from './AcordosNaoAtualizadosPage';
import { ApiError } from '../api/errors';
import type { TaskNaoAtualizadaItem } from '../api/types';

const { obterAcordosNaoAtualizados } = vi.hoisted(() => ({
  obterAcordosNaoAtualizados: vi.fn(),
}));

vi.mock('../api/client', () => ({
  obterAcordosNaoAtualizados,
}));

function item(overrides: Partial<TaskNaoAtualizadaItem> = {}): TaskNaoAtualizadaItem {
  return {
    id: 't1',
    titulo: 'Task não atualizada',
    ordemExibicao: 0,
    ...overrides,
  };
}

/** Formata uma data ISO em dd/mm/aaaa, igual ao formatarData da página. */
function formatarDataEsperada(dataIso: string): string {
  const data = new Date(dataIso);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(data);
}

/**
 * `toHaveTextContent` normaliza apenas o texto recebido do DOM (múltiplos
 * espaços em sequência colapsam para 1, com trim), mas não normaliza o
 * valor esperado passado como argumento. Como os textos gerados pelo
 * `fast-check` podem conter espaços múltiplos internos, comparamos contra
 * essa mesma normalização para não gerar falsos-negativos.
 */
function normalizarEspacos(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

// Property 22: Renderização do item de Acordo Não Atualizado
// Validates: Requirements 7.6, 7.10
describe('AcordosNaoAtualizadosPage', () => {
  afterEach(() => {
    cleanup();
  });

  it('Feature: melhorias-acordos, Property 22: Renderização do item de Acordo Não Atualizado', async () => {
    // Gerador combinando presença/ausência de Responsável, data e tipo. Quando não há
    // data (Acordo inexistente), o tipo também não deve ser gerado, espelhando o
    // formato de dados real (Requisito 7.10: sem Acordo, não há tipo).
    const textoArb = (maxLength: number) =>
      fc
        .string({ minLength: 1, maxLength })
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

    const itemArb = fc
      .record({
        id: fc.uuid(),
        titulo: textoArb(60),
        ordemExibicao: fc.integer({ min: 0, max: 1000 }),
        responsavelNome: fc.option(textoArb(40), { nil: undefined }),
        possuiAcordo: fc.boolean(),
        dataUltimaAtualizacaoAcordo: fc.date({
          min: new Date('2020-01-01T00:00:00.000Z'),
          max: new Date('2030-12-31T00:00:00.000Z'),
        }),
        tipoAcordoNome: fc.option(textoArb(40), { nil: undefined }),
      })
      .map(({ possuiAcordo, dataUltimaAtualizacaoAcordo, tipoAcordoNome, ...resto }) => {
        const item: TaskNaoAtualizadaItem = { ...resto };
        if (resto.responsavelNome === undefined) {
          delete item.responsavelNome;
        }
        if (possuiAcordo) {
          item.dataUltimaAtualizacaoAcordo = dataUltimaAtualizacaoAcordo.toISOString();
          if (tipoAcordoNome !== undefined) {
            item.tipoAcordoNome = tipoAcordoNome;
          }
        }
        return item;
      });

    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(itemArb, { selector: (item) => item.id, minLength: 1, maxLength: 15 }),
        async (itens: TaskNaoAtualizadaItem[]) => {
          obterAcordosNaoAtualizados.mockReset().mockResolvedValue(itens);

          const { findAllByTestId, unmount } = render(<AcordosNaoAtualizadosPage />);

          try {
            const elementos = await findAllByTestId('acordos-nao-atualizados-item');
            expect(elementos).toHaveLength(itens.length);

            itens.forEach((item, index) => {
              const elemento = elementos[index]!;

              // Título sempre presente (Requisito 7.6). Consultado pela classe do
              // elemento (não pelo texto) porque títulos gerados podem coincidir
              // textualmente com o Responsável ou o Tipo_de_Acordo gerados.
              const titulo = elemento.querySelector('.acordos-nao-atualizados-page__titulo');
              expect(titulo).not.toBeNull();
              expect(titulo).toHaveTextContent(normalizarEspacos(item.titulo));

              // Responsável exibido apenas quando presente (Requisito 7.6).
              const responsavel = elemento.querySelector(
                '.acordos-nao-atualizados-page__responsavel',
              );
              if (item.responsavelNome) {
                expect(responsavel).not.toBeNull();
                expect(responsavel).toHaveTextContent(normalizarEspacos(item.responsavelNome));
              } else {
                expect(responsavel).toBeNull();
              }

              const dataEl = elemento.querySelector('.acordos-nao-atualizados-page__data');
              const tipoEl = elemento.querySelector('.acordos-nao-atualizados-page__tipo-acordo');
              const semAcordoEl = elemento.querySelector(
                '.acordos-nao-atualizados-page__sem-acordo',
              );

              if (item.dataUltimaAtualizacaoAcordo) {
                // Com Acordo: data em dd/mm/aaaa e "Sem Acordo registrado" ausente (Requisito 7.6, 7.10).
                const dataFormatada = formatarDataEsperada(item.dataUltimaAtualizacaoAcordo);
                expect(dataEl).not.toBeNull();
                expect(dataEl).toHaveTextContent(dataFormatada);
                expect(semAcordoEl).toBeNull();

                if (item.tipoAcordoNome) {
                  expect(tipoEl).not.toBeNull();
                  expect(tipoEl).toHaveTextContent(normalizarEspacos(item.tipoAcordoNome));
                } else {
                  expect(tipoEl).toBeNull();
                }
              } else {
                // Sem Acordo: indicação de ausência no lugar de data e tipo (Requisito 7.10).
                expect(semAcordoEl).not.toBeNull();
                expect(semAcordoEl).toHaveTextContent('Sem Acordo registrado');
                expect(dataEl).toBeNull();
                expect(tipoEl).toBeNull();
              }
            });
          } finally {
            unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('exibe indicação de carregamento enquanto a requisição está pendente', async () => {
    let resolver: ((itens: TaskNaoAtualizadaItem[]) => void) | undefined;
    obterAcordosNaoAtualizados.mockReset().mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );

    render(<AcordosNaoAtualizadosPage />);

    expect(await screen.findByRole('status')).toHaveTextContent(/carregando/i);

    resolver!([]);
    expect(await screen.findByText(/todas as tasks ativas possuem acordo registrado hoje/i)).toBeInTheDocument();
  });

  it('exibe "Todas as Tasks ativas possuem Acordo registrado hoje" e nenhum item quando a lista está vazia (Requisito 7.8)', async () => {
    obterAcordosNaoAtualizados.mockReset().mockResolvedValue([]);

    render(<AcordosNaoAtualizadosPage />);

    expect(
      await screen.findByText(/todas as tasks ativas possuem acordo registrado hoje/i),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId('acordos-nao-atualizados-item')).toHaveLength(0);
  });

  it('em falha, encerra o carregamento, exibe erro e permite tentar novamente (Requisito 7.11)', async () => {
    obterAcordosNaoAtualizados
      .mockReset()
      .mockRejectedValueOnce(new ApiError(500, 'ERRO_INTERNO', 'Falha ao carregar a lista.'))
      .mockResolvedValueOnce([item({ id: 't1', titulo: 'Recuperada' })]);

    render(<AcordosNaoAtualizadosPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao carregar a lista.');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const botaoTentarNovamente = screen.getByTestId(
      'acordos-nao-atualizados-page-tentar-novamente',
    );
    fireEvent.click(botaoTentarNovamente);

    const itens = await screen.findAllByTestId('acordos-nao-atualizados-item');
    expect(itens).toHaveLength(1);
    expect(obterAcordosNaoAtualizados).toHaveBeenCalledTimes(2);
  });

  it('em timeout, encerra o carregamento e exibe erro (Requisito 7.2, 7.11)', async () => {
    obterAcordosNaoAtualizados
      .mockReset()
      .mockRejectedValue(new ApiError(408, 'TIMEOUT', 'A requisição excedeu o tempo limite.'));

    render(<AcordosNaoAtualizadosPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A requisição excedeu o tempo limite.',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('recarrega os dados a cada montagem da página, como em AtividadesFinalizadasPage (Requisito 10.8)', async () => {
    obterAcordosNaoAtualizados.mockReset().mockResolvedValue([]);

    const { unmount } = render(<AcordosNaoAtualizadosPage />);
    await screen.findByText(/todas as tasks ativas possuem acordo registrado hoje/i);
    expect(obterAcordosNaoAtualizados).toHaveBeenCalledTimes(1);
    unmount();

    render(<AcordosNaoAtualizadosPage />);
    await screen.findByText(/todas as tasks ativas possuem acordo registrado hoje/i);
    expect(obterAcordosNaoAtualizados).toHaveBeenCalledTimes(2);
  });
});
