import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrarAcordoForm } from './RegistrarAcordoForm';
import { ApiError } from '../api/errors';
import type { Acordo, TipoAcordo, UsuarioCadastrado } from '../api/types';

const { listarTiposDeAcordo, listarUsuarios, registrarAcordo } = vi.hoisted(() => ({
  listarTiposDeAcordo: vi.fn(),
  listarUsuarios: vi.fn(),
  registrarAcordo: vi.fn(),
}));

vi.mock('../api/client', () => ({
  listarTiposDeAcordo,
  listarUsuarios,
  registrarAcordo,
}));

const TIPOS: TipoAcordo[] = [
  { id: 'tipo-1', nome: 'Enviar para review' },
  { id: 'tipo-2', nome: 'Finalizar' },
];

const USUARIOS: UsuarioCadastrado[] = [
  { id: 'user-1', nomeLogin: 'ana.silva' },
  { id: 'user-2', nomeLogin: 'joao.souza' },
];

function criarAcordo(overrides: Partial<Acordo> = {}): Acordo {
  return {
    id: 'acordo-1',
    taskId: 'task-1',
    tipoAcordoId: 'tipo-1',
    dataRegistro: '2024-05-10T10:00:00.000Z',
    estadoCumprimento: 'pendente',
    motivoNaoCumprimentoId: null,
    ...overrides,
  };
}

async function renderFormularioCarregado(onRegistrado = vi.fn()) {
  render(<RegistrarAcordoForm taskId="task-1" onRegistrado={onRegistrado} />);

  const selectTipo = await screen.findByTestId('registrar-acordo-form-tipo-select');
  return { selectTipo, onRegistrado };
}

describe('RegistrarAcordoForm', () => {
  beforeEach(() => {
    listarTiposDeAcordo.mockReset().mockResolvedValue(TIPOS);
    listarUsuarios.mockReset().mockResolvedValue(USUARIOS);
    registrarAcordo.mockReset();
  });

  it('submete com Tipo_de_Acordo e Responsável selecionados, chamando onRegistrado com o Acordo retornado (Requisitos 2.1, 5.1, 5.6)', async () => {
    const acordoRetornado = criarAcordo({ tipoAcordoId: 'tipo-1' });
    registrarAcordo.mockResolvedValue(acordoRetornado);

    const { selectTipo, onRegistrado } = await renderFormularioCarregado();
    const selectResponsavel = screen.getByTestId('registrar-acordo-form-responsavel-select');

    fireEvent.change(selectTipo, { target: { value: 'tipo-1' } });
    fireEvent.change(selectResponsavel, { target: { value: 'user-1' } });
    fireEvent.click(screen.getByTestId('registrar-acordo-form-submit'));

    await waitFor(() => expect(registrarAcordo).toHaveBeenCalledTimes(1));
    expect(registrarAcordo).toHaveBeenCalledWith('task-1', {
      tipoAcordoId: 'tipo-1',
      responsavelId: 'user-1',
    });
    await waitFor(() => expect(onRegistrado).toHaveBeenCalledWith(acordoRetornado));
  });

  it('submete apenas com Tipo_de_Acordo quando nenhum Responsável é selecionado, sem enviar responsavelId (Requisito 5.2)', async () => {
    const acordoRetornado = criarAcordo({ tipoAcordoId: 'tipo-2' });
    registrarAcordo.mockResolvedValue(acordoRetornado);

    const { selectTipo, onRegistrado } = await renderFormularioCarregado();

    fireEvent.change(selectTipo, { target: { value: 'tipo-2' } });
    fireEvent.click(screen.getByTestId('registrar-acordo-form-submit'));

    await waitFor(() => expect(registrarAcordo).toHaveBeenCalledTimes(1));
    expect(registrarAcordo).toHaveBeenCalledWith('task-1', { tipoAcordoId: 'tipo-2' });
    await waitFor(() => expect(onRegistrado).toHaveBeenCalledWith(acordoRetornado));
  });

  it('exibe o erro retornado pela API e preserva a seleção do formulário quando o registro é rejeitado (Requisitos 2.2, 5.4, 5.8)', async () => {
    registrarAcordo.mockRejectedValue(
      new ApiError(400, 'TIPO_DE_ACORDO_INVALIDO', 'Tipo_de_Acordo informado não existe.'),
    );

    const { selectTipo } = await renderFormularioCarregado();
    const selectResponsavel = screen.getByTestId('registrar-acordo-form-responsavel-select');

    fireEvent.change(selectTipo, { target: { value: 'tipo-1' } });
    fireEvent.change(selectResponsavel, { target: { value: 'user-1' } });
    fireEvent.click(screen.getByTestId('registrar-acordo-form-submit'));

    const erro = await screen.findByTestId('registrar-acordo-form-erro-submissao');
    expect(erro).toHaveTextContent('Tipo_de_Acordo informado não existe.');

    expect(selectTipo).toHaveValue('tipo-1');
    expect(selectResponsavel).toHaveValue('user-1');
  });
});
