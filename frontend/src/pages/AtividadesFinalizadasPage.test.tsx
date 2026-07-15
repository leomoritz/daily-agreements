import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AtividadesFinalizadasPage } from './AtividadesFinalizadasPage';
import type { AtividadeFinalizadaItem } from '../api/types';

const { obterAtividadesFinalizadas } = vi.hoisted(() => ({
  obterAtividadesFinalizadas: vi.fn(),
}));

vi.mock('../api/client', () => ({
  obterAtividadesFinalizadas,
}));

function atividade(overrides: Partial<AtividadeFinalizadaItem> = {}): AtividadeFinalizadaItem {
  return {
    id: 'a1',
    titulo: 'Atividade concluída',
    dataFinalizacao: '2026-07-01T10:00:00.000Z',
    finalizadaHoje: false,
    ...overrides,
  };
}

describe('AtividadesFinalizadasPage', () => {
  it('exibe indicação de lista vazia quando não há atividades finalizadas', async () => {
    obterAtividadesFinalizadas.mockResolvedValue([]);

    render(<AtividadesFinalizadasPage />);

    expect(await screen.findByText(/nenhuma atividade finalizada/i)).toBeInTheDocument();
  });

  it('renderiza as atividades na ordem retornada pela API', async () => {
    obterAtividadesFinalizadas.mockResolvedValue([
      atividade({ id: 'a1', titulo: 'Primeira' }),
      atividade({ id: 'a2', titulo: 'Segunda' }),
    ]);

    render(<AtividadesFinalizadasPage />);

    const itens = await screen.findAllByTestId('atividades-finalizadas-item');
    expect(itens).toHaveLength(2);
    expect(within(itens[0]!).getByText('Primeira')).toBeInTheDocument();
    expect(within(itens[1]!).getByText('Segunda')).toBeInTheDocument();
  });

  it('exibe o Responsável quando definido', async () => {
    obterAtividadesFinalizadas.mockResolvedValue([atividade({ responsavelNome: 'alice' })]);

    render(<AtividadesFinalizadasPage />);

    expect(await screen.findByText(/alice/i)).toBeInTheDocument();
  });

  it('destaca visualmente e textualmente as atividades finalizadas hoje', async () => {
    obterAtividadesFinalizadas.mockResolvedValue([
      atividade({ id: 'a1', titulo: 'Atividade de hoje', finalizadaHoje: true }),
      atividade({ id: 'a2', titulo: 'Atividade antiga', finalizadaHoje: false }),
    ]);

    render(<AtividadesFinalizadasPage />);

    const itens = await screen.findAllByTestId('atividades-finalizadas-item');

    const itemHoje = itens.find((item) => within(item).queryByText('Atividade de hoje'));
    const itemAntes = itens.find((item) => within(item).queryByText('Atividade antiga'));

    expect(itemHoje).toBeDefined();
    expect(itemAntes).toBeDefined();

    // destaque textual explícito, não dependente apenas de cor.
    expect(within(itemHoje!).getByText(/finalizada hoje/i)).toBeInTheDocument();
    expect(itemHoje!.className).toContain('atividades-finalizadas-page__item--hoje');

    expect(within(itemAntes!).queryByText(/finalizada hoje/i)).not.toBeInTheDocument();
    expect(itemAntes!.className).not.toContain('atividades-finalizadas-page__item--hoje');
  });

  it('exibe mensagem de erro quando o carregamento falha', async () => {
    obterAtividadesFinalizadas.mockRejectedValue(new Error('falha'));

    render(<AtividadesFinalizadasPage />);

    expect(
      await screen.findByText(/não foi possível carregar as atividades finalizadas/i),
    ).toBeInTheDocument();
  });
});
