import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvaliarAcordoForm } from './AvaliarAcordoForm';
import { ApiError } from '../api/errors';
import type { Acordo, MotivoNaoCumprimento } from '../api/types';

const { avaliarAcordoAtual, listarMotivos } = vi.hoisted(() => ({
  avaliarAcordoAtual: vi.fn(),
  listarMotivos: vi.fn(),
}));

vi.mock('../api/client', () => ({
  avaliarAcordoAtual,
  listarMotivos,
}));

const MOTIVOS: MotivoNaoCumprimento[] = [
  { id: 'motivo-1', nome: 'Dependência externa' },
  { id: 'motivo-2', nome: 'Problema ambiente' },
];

function criarAcordo(overrides: Partial<Acordo> = {}): Acordo {
  return {
    id: 'acordo-1',
    taskId: 'task-1',
    tipoAcordoId: 'tipo-1',
    dataRegistro: '2024-05-10T10:00:00.000Z',
    estadoCumprimento: 'cumprido',
    motivoNaoCumprimentoId: null,
    ...overrides,
  };
}

async function renderFormularioCarregado(onAvaliado = vi.fn()) {
  render(<AvaliarAcordoForm taskId="task-1" onAvaliado={onAvaliado} />);

  await screen.findByTestId('avaliar-acordo-form-cumprido');
  return { onAvaliado };
}

describe('AvaliarAcordoForm', () => {
  beforeEach(() => {
    listarMotivos.mockReset().mockResolvedValue(MOTIVOS);
    avaliarAcordoAtual.mockReset();
  });

  it('submete "cumprido" sem motivoId ao clicar em marcar cumprido, chamando onAvaliado com o Acordo retornado (Requisito 4.1)', async () => {
    const acordoRetornado = criarAcordo({ estadoCumprimento: 'cumprido' });
    avaliarAcordoAtual.mockResolvedValue(acordoRetornado);

    const { onAvaliado } = await renderFormularioCarregado();

    fireEvent.click(screen.getByTestId('avaliar-acordo-form-cumprido'));

    await waitFor(() => expect(avaliarAcordoAtual).toHaveBeenCalledTimes(1));
    expect(avaliarAcordoAtual).toHaveBeenCalledWith('task-1', { resultado: 'cumprido' });
    await waitFor(() => expect(onAvaliado).toHaveBeenCalledWith(acordoRetornado));
  });

  it('submete "não cumprido" sem Motivo selecionado ao confirmar, sem enviar motivoId (Requisito 4.6)', async () => {
    const acordoRetornado = criarAcordo({ estadoCumprimento: 'nao_cumprido' });
    avaliarAcordoAtual.mockResolvedValue(acordoRetornado);

    const { onAvaliado } = await renderFormularioCarregado();

    fireEvent.click(screen.getByTestId('avaliar-acordo-form-nao-cumprido'));
    const confirmar = await screen.findByTestId('avaliar-acordo-form-confirmar-nao-cumprido');
    fireEvent.click(confirmar);

    await waitFor(() => expect(avaliarAcordoAtual).toHaveBeenCalledTimes(1));
    expect(avaliarAcordoAtual).toHaveBeenCalledWith('task-1', { resultado: 'nao_cumprido' });
    await waitFor(() => expect(onAvaliado).toHaveBeenCalledWith(acordoRetornado));
  });

  it('submete "não cumprido" com Motivo selecionado ao confirmar, enviando motivoId (Requisito 4.5)', async () => {
    const acordoRetornado = criarAcordo({
      estadoCumprimento: 'nao_cumprido',
      motivoNaoCumprimentoId: 'motivo-1',
    });
    avaliarAcordoAtual.mockResolvedValue(acordoRetornado);

    const { onAvaliado } = await renderFormularioCarregado();

    fireEvent.click(screen.getByTestId('avaliar-acordo-form-nao-cumprido'));
    const selectMotivo = await screen.findByTestId('avaliar-acordo-form-motivo-select');
    fireEvent.change(selectMotivo, { target: { value: 'motivo-1' } });
    fireEvent.click(screen.getByTestId('avaliar-acordo-form-confirmar-nao-cumprido'));

    await waitFor(() => expect(avaliarAcordoAtual).toHaveBeenCalledTimes(1));
    expect(avaliarAcordoAtual).toHaveBeenCalledWith('task-1', {
      resultado: 'nao_cumprido',
      motivoId: 'motivo-1',
    });
    await waitFor(() => expect(onAvaliado).toHaveBeenCalledWith(acordoRetornado));
  });

  it('exibe o erro retornado pela API e preserva a seleção do formulário quando a avaliação de não cumprido é rejeitada (Requisito 4.7)', async () => {
    avaliarAcordoAtual.mockRejectedValue(
      new ApiError(400, 'MOTIVO_INVALIDO', 'Motivo de não cumprimento informado não existe.'),
    );

    await renderFormularioCarregado();

    fireEvent.click(screen.getByTestId('avaliar-acordo-form-nao-cumprido'));
    const selectMotivo = await screen.findByTestId('avaliar-acordo-form-motivo-select');
    fireEvent.change(selectMotivo, { target: { value: 'motivo-1' } });
    fireEvent.click(screen.getByTestId('avaliar-acordo-form-confirmar-nao-cumprido'));

    const erro = await screen.findByTestId('avaliar-acordo-form-erro-submissao');
    expect(erro).toHaveTextContent('Motivo de não cumprimento informado não existe.');

    expect(screen.getByTestId('avaliar-acordo-form-motivo-select')).toHaveValue('motivo-1');
    expect(screen.getByTestId('avaliar-acordo-form-motivo-form')).toBeInTheDocument();
  });
});
