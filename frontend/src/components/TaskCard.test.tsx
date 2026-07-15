import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskCard } from './TaskCard';
import { ApiError } from '../api/errors';
import type { TaskComAcordoItem, TaskNovaItem } from '../api/types';

const { editarTask, removerTask, listarUsuarios, repetirUltimoAcordo, finalizarTask } = vi.hoisted(() => ({
  editarTask: vi.fn(),
  removerTask: vi.fn(),
  listarUsuarios: vi.fn(),
  repetirUltimoAcordo: vi.fn(),
  finalizarTask: vi.fn(),
}));

vi.mock('../api/client', () => ({
  editarTask,
  removerTask,
  listarUsuarios,
  repetirUltimoAcordo,
  finalizarTask,
}));

function criarTaskNova(overrides: Partial<TaskNovaItem> = {}): TaskNovaItem {
  return {
    id: 'task-nova-1',
    titulo: 'Investigar bug de login',
    ordemExibicao: 0,
    ...overrides,
  };
}

function criarTaskComAcordo(overrides: Partial<TaskComAcordoItem> = {}): TaskComAcordoItem {
  return {
    id: 'task-acordo-1',
    titulo: 'Enviar para review',
    ordemExibicao: 0,
    tipoAcordoNome: 'Enviar para review',
    dataRegistroAcordoAtual: '2024-05-10T10:00:00.000Z',
    alerta: false,
    numTentativas: 0,
    alertaTentativasAvaliarPlanejar: false,
    tentativasAvaliarPlanejar: 0,
    ...overrides,
  };
}

describe('TaskCard', () => {
  it('renders título e Responsável quando presentes (Task_Nova)', () => {
    render(<TaskCard item={criarTaskNova({ responsavelNome: 'ana.silva' })} />);

    expect(screen.getByText('Investigar bug de login')).toBeInTheDocument();
    expect(screen.getByText('ana.silva')).toBeInTheDocument();
  });

  it('não renderiza Responsável quando ausente', () => {
    render(<TaskCard item={criarTaskNova({ responsavelNome: undefined })} />);

    expect(screen.queryByText(/Responsável:/i)).not.toBeInTheDocument();
  });

  it('renderiza Tipo_de_Acordo e data de registro para Task_Com_Acordo', () => {
    render(
      <TaskCard
        item={criarTaskComAcordo({
          tipoAcordoNome: 'Enviar para deploy',
          dataRegistroAcordoAtual: '2024-05-10T10:00:00.000Z',
        })}
      />,
    );

    expect(screen.getByText(/Enviar para deploy/)).toBeInTheDocument();
    expect(screen.getByText(/Registrado em:/i)).toBeInTheDocument();
  });

  it('renderiza indicador de alerta e Nº_Tentativas quando alerta é true (Requisito 3.6)', () => {
    render(<TaskCard item={criarTaskComAcordo({ alerta: true, numTentativas: 3 })} />);

    const card = screen.getByTestId('task-card');
    expect(card.className).toContain('task-card--alerta');
    expect(screen.getByRole('status')).toHaveTextContent(/alerta/i);
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it('não renderiza indicador de alerta quando alerta é false', () => {
    render(<TaskCard item={criarTaskComAcordo({ alerta: false })} />);

    const card = screen.getByTestId('task-card');
    expect(card.className).not.toContain('task-card--alerta');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('não renderiza indicador de alerta para Task_Nova', () => {
    render(<TaskCard item={criarTaskNova()} />);

    const card = screen.getByTestId('task-card');
    expect(card.className).not.toContain('task-card--alerta');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renderiza indicador de alerta de tentativas de Avaliar e planejar alto quando alertaTentativasAvaliarPlanejar é true', () => {
    render(
      <TaskCard
        item={criarTaskComAcordo({ alertaTentativasAvaliarPlanejar: true, tentativasAvaliarPlanejar: 3 })}
      />,
    );

    const card = screen.getByTestId('task-card');
    expect(card.className).toContain('task-card--alerta');
    expect(screen.getByRole('status')).toHaveTextContent(/Avaliar e planejar/i);
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it('não renderiza indicador de alerta de tentativas de Avaliar e planejar quando alertaTentativasAvaliarPlanejar é false', () => {
    render(<TaskCard item={criarTaskComAcordo({ alertaTentativasAvaliarPlanejar: false })} />);

    const card = screen.getByTestId('task-card');
    expect(card.className).not.toContain('task-card--alerta');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('rejeita edição com título vazio, exibindo o erro e mantendo o modo de edição (Requisito 9.2)', async () => {
    listarUsuarios.mockResolvedValue([]);
    editarTask.mockRejectedValue(new ApiError(400, 'TITULO_INVALIDO', 'Título é obrigatório.'));
    const onTaskEditada = vi.fn();

    render(<TaskCard item={criarTaskNova()} onTaskEditada={onTaskEditada} />);

    fireEvent.click(screen.getByTestId('task-card-editar'));

    const inputTitulo = await screen.findByTestId('task-card-editar-titulo');
    fireEvent.change(inputTitulo, { target: { value: '' } });
    fireEvent.click(screen.getByTestId('task-card-salvar'));

    expect(await screen.findByTestId('task-card-erro-edicao')).toHaveTextContent(
      'Título é obrigatório.',
    );
    // Continua em modo de edição: o formulário/input ainda estão presentes.
    expect(screen.getByTestId('task-card-editar-form')).toBeInTheDocument();
    expect(screen.getByTestId('task-card-editar-titulo')).toHaveValue('');
    expect(onTaskEditada).not.toHaveBeenCalled();
  });

  describe('Repetir último acordo', () => {
    it('exibe o botão "Repetir último acordo" apenas para Task_Com_Acordo quando onAcordoAlterado é informado', () => {
      const { rerender } = render(
        <TaskCard item={criarTaskComAcordo()} onAcordoAlterado={vi.fn()} />,
      );
      expect(screen.getByTestId('task-card-repetir-ultimo-acordo')).toBeInTheDocument();

      rerender(<TaskCard item={criarTaskNova()} onAcordoAlterado={vi.fn()} />);
      expect(screen.queryByTestId('task-card-repetir-ultimo-acordo')).not.toBeInTheDocument();
    });

    it('não exibe o botão quando onAcordoAlterado não é informado', () => {
      render(<TaskCard item={criarTaskComAcordo()} />);
      expect(screen.queryByTestId('task-card-repetir-ultimo-acordo')).not.toBeInTheDocument();
    });

    it('chama repetirUltimoAcordo com o id da Task e onAcordoAlterado ao clicar no botão', async () => {
      repetirUltimoAcordo.mockResolvedValue({
        id: 'acordo-novo',
        taskId: 'task-acordo-1',
        tipoAcordoId: 'tipo-1',
        dataRegistro: '2024-05-11T10:00:00.000Z',
        estadoCumprimento: 'pendente',
        motivoNaoCumprimentoId: null,
      });
      const onAcordoAlterado = vi.fn();

      render(
        <TaskCard item={criarTaskComAcordo({ id: 'task-acordo-1' })} onAcordoAlterado={onAcordoAlterado} />,
      );

      fireEvent.click(screen.getByTestId('task-card-repetir-ultimo-acordo'));

      expect(repetirUltimoAcordo).toHaveBeenCalledWith('task-acordo-1');
      await waitFor(() => expect(onAcordoAlterado).toHaveBeenCalled());
    });

    it('exibe erro e não chama onAcordoAlterado quando a API rejeita', async () => {
      repetirUltimoAcordo.mockRejectedValue(
        new ApiError(409, 'SEM_ACORDO_ATUAL', 'A Task não possui Acordo_Atual.'),
      );
      const onAcordoAlterado = vi.fn();

      render(<TaskCard item={criarTaskComAcordo()} onAcordoAlterado={onAcordoAlterado} />);

      fireEvent.click(screen.getByTestId('task-card-repetir-ultimo-acordo'));

      expect(await screen.findByTestId('task-card-erro-repetir')).toHaveTextContent(
        'A Task não possui Acordo_Atual.',
      );
      expect(onAcordoAlterado).not.toHaveBeenCalled();
    });
  });

  describe('Finalizar', () => {
    it('exibe o botão "Finalizar" apenas para Task_Com_Acordo quando onAcordoAlterado é informado', () => {
      const { rerender } = render(
        <TaskCard item={criarTaskComAcordo()} onAcordoAlterado={vi.fn()} />,
      );
      expect(screen.getByTestId('task-card-finalizar')).toBeInTheDocument();

      rerender(<TaskCard item={criarTaskNova()} onAcordoAlterado={vi.fn()} />);
      expect(screen.queryByTestId('task-card-finalizar')).not.toBeInTheDocument();
    });

    it('não exibe o botão quando onAcordoAlterado não é informado', () => {
      render(<TaskCard item={criarTaskComAcordo()} />);
      expect(screen.queryByTestId('task-card-finalizar')).not.toBeInTheDocument();
    });

    it('chama finalizarTask com o id da Task e onAcordoAlterado ao clicar no botão', async () => {
      finalizarTask.mockResolvedValue({
        id: 'acordo-1',
        taskId: 'task-acordo-1',
        tipoAcordoId: 'tipo-1',
        dataRegistro: '2024-05-11T10:00:00.000Z',
        estadoCumprimento: 'cumprido',
        motivoNaoCumprimentoId: null,
      });
      const onAcordoAlterado = vi.fn();

      render(
        <TaskCard item={criarTaskComAcordo({ id: 'task-acordo-1' })} onAcordoAlterado={onAcordoAlterado} />,
      );

      fireEvent.click(screen.getByTestId('task-card-finalizar'));

      expect(finalizarTask).toHaveBeenCalledWith('task-acordo-1');
      await waitFor(() => expect(onAcordoAlterado).toHaveBeenCalled());
    });

    it('exibe erro e não chama onAcordoAlterado quando a API rejeita', async () => {
      finalizarTask.mockRejectedValue(
        new ApiError(409, 'SEM_ACORDO_ATUAL', 'A Task não possui Acordo_Atual.'),
      );
      const onAcordoAlterado = vi.fn();

      render(<TaskCard item={criarTaskComAcordo()} onAcordoAlterado={onAcordoAlterado} />);

      fireEvent.click(screen.getByTestId('task-card-finalizar'));

      expect(await screen.findByTestId('task-card-erro-finalizar')).toHaveTextContent(
        'A Task não possui Acordo_Atual.',
      );
      expect(onAcordoAlterado).not.toHaveBeenCalled();
    });
  });
});
