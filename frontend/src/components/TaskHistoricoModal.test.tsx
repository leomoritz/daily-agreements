import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskHistoricoModal } from './TaskHistoricoModal';
import type { Acordo, TipoAcordo, UsuarioCadastrado } from '../api/types';

const { buscarHistorico, listarTiposDeAcordo, listarUsuarios } = vi.hoisted(() => ({
  buscarHistorico: vi.fn(),
  listarTiposDeAcordo: vi.fn(),
  listarUsuarios: vi.fn(),
}));

vi.mock('../api/client', () => ({
  buscarHistorico,
  listarTiposDeAcordo,
  listarUsuarios,
}));

const TIPOS: TipoAcordo[] = [
  { id: 'tipo-1', nome: 'Combinado com o time' },
  { id: 'tipo-2', nome: 'Combinado com o cliente' },
];

const USUARIOS: UsuarioCadastrado[] = [
  { id: 'usuario-1', nomeLogin: 'ana.silva' },
];

function criarAcordo(overrides: Partial<Acordo> = {}): Acordo {
  return {
    id: 'acordo-1',
    taskId: 'task-1',
    tipoAcordoId: 'tipo-1',
    responsavelId: null,
    dataRegistro: '2024-05-10T10:00:00.000Z',
    estadoCumprimento: 'pendente',
    motivoNaoCumprimentoId: null,
    ...overrides,
  };
}

describe('TaskHistoricoModal', () => {
  beforeEach(() => {
    buscarHistorico.mockReset();
    listarTiposDeAcordo.mockReset().mockResolvedValue(TIPOS);
    listarUsuarios.mockReset().mockResolvedValue(USUARIOS);
  });

  it('exibe indicação de histórico vazio, sem renderizar a lista, quando não há Acordos (Requisito 7.4)', async () => {
    buscarHistorico.mockResolvedValue([]);

    render(<TaskHistoricoModal taskId="task-1" onClose={vi.fn()} />);

    const vazio = await screen.findByTestId('task-historico-modal-vazio');
    expect(vazio).toHaveTextContent('Nenhum Acordo registrado.');
    expect(screen.queryByTestId('task-historico-modal-lista')).not.toBeInTheDocument();
  });

  it('exibe todos os Acordos na ordem retornada e, quando houver, o Responsável antes dos demais campos', async () => {
    const acordos: Acordo[] = [
      criarAcordo({
        id: 'acordo-1',
        tipoAcordoId: 'tipo-1',
        responsavelId: 'usuario-1',
        dataRegistro: '2024-05-10T10:00:00.000Z',
        estadoCumprimento: 'cumprido',
      }),
      criarAcordo({
        id: 'acordo-2',
        tipoAcordoId: 'tipo-2',
        dataRegistro: '2024-05-15T14:30:00.000Z',
        estadoCumprimento: 'nao_cumprido',
      }),
      criarAcordo({
        id: 'acordo-3',
        tipoAcordoId: 'tipo-1',
        dataRegistro: '2024-05-20T09:00:00.000Z',
        estadoCumprimento: 'pendente',
      }),
    ];
    buscarHistorico.mockResolvedValue(acordos);

    render(<TaskHistoricoModal taskId="task-1" onClose={vi.fn()} />);

    const itens = await screen.findAllByTestId('task-historico-modal-item');
    expect(itens).toHaveLength(3);

    expect(itens[0]).toHaveTextContent('ana.silva');
    expect(
      Array.from(itens[0].querySelectorAll('.task-historico-modal__label')).map(
        (label) => label.textContent,
      ),
    ).toEqual(['Responsável:', 'Tipo de Acordo:', 'Registrado em:', 'Estado:']);
    expect(itens[0]).toHaveTextContent('Combinado com o time');
    expect(itens[0]).toHaveTextContent('Cumprido');

    expect(itens[1]).not.toHaveTextContent('Responsável:');
    expect(itens[1]).toHaveTextContent('Combinado com o cliente');
    expect(itens[1]).toHaveTextContent('Não cumprido');

    expect(itens[2]).toHaveTextContent('Combinado com o time');
    expect(itens[2]).toHaveTextContent('Pendente');
  });

  it('chama onClose ao clicar no botão de fechar', async () => {
    buscarHistorico.mockResolvedValue([]);
    const onClose = vi.fn();

    render(<TaskHistoricoModal taskId="task-1" onClose={onClose} />);

    await screen.findByTestId('task-historico-modal-vazio');
    fireEvent.click(screen.getByTestId('task-historico-modal-fechar'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
