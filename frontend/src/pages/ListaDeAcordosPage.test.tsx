import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ListaDeAcordosPage } from './ListaDeAcordosPage';
import type { ListaDeAcordos } from '../api/types';

const { obterLista, reordenarTask, removerTask, listarUsuarios, processarLote } = vi.hoisted(
  () => ({
    obterLista: vi.fn(),
    reordenarTask: vi.fn(),
    removerTask: vi.fn(),
    listarUsuarios: vi.fn(),
    processarLote: vi.fn(),
  }),
);

vi.mock('../api/client', () => ({
  obterLista,
  reordenarTask,
  removerTask,
  listarUsuarios,
  processarLote,
}));

// `SortableTaskGroup` real depende de medições de DOM/pointer events do
// `@dnd-kit` que não são simuláveis de forma confiável em jsdom (ver
// tarefa 22.2). Este mock preserva o contrato usado pela
// `ListaDeAcordosPage` (renderiza os itens via `renderItem`, ou
// `emptyMessage` quando vazio) e expõe um botão de teste que, ao ser
// clicado, invoca `onReorder` como o `DndContext` real faria ao final de
// um drag-and-drop — simulando o "drop" de forma determinística.
vi.mock('../components/SortableTaskGroup', () => ({
  SortableTaskGroup: ({
    items,
    onReorder,
    renderItem,
    emptyMessage,
  }: {
    items: { id: string }[];
    onReorder: (oldIndex: number, newIndex: number, movedId: string) => void;
    renderItem: (item: { id: string }) => ReactNode;
    emptyMessage: ReactNode;
  }) => {
    if (items.length === 0) {
      return <>{emptyMessage}</>;
    }
    return (
      <div>
        <button
          type="button"
          data-testid="simular-drop"
          onClick={() => onReorder(0, 1, items[0]!.id)}
        >
          Simular drop
        </button>
        {items.map((item) => renderItem(item))}
      </div>
    );
  },
}));

function listaVazia(): ListaDeAcordos {
  return { taskNova: [], taskComAcordo: [] };
}

describe('ListaDeAcordosPage', () => {
  it('exibe indicação de "nenhuma Task nessa categoria" para grupos vazios, mantendo os containers (Requisito 3.4)', async () => {
    obterLista.mockResolvedValue(listaVazia());

    render(<ListaDeAcordosPage />);

    const grupoTaskNova = await screen.findByTestId('grupo-task-nova');
    const grupoTaskComAcordo = screen.getByTestId('grupo-task-com-acordo');

    expect(within(grupoTaskNova).getByText(/nenhuma task nessa categoria/i)).toBeInTheDocument();
    expect(
      within(grupoTaskComAcordo).getByText(/nenhuma task nessa categoria/i),
    ).toBeInTheDocument();
  });

  it('renderiza as Tasks de cada grupo na mesma ordem retornada por obterLista (Requisito 3.5)', async () => {
    obterLista.mockResolvedValue({
      taskNova: [
        { id: 'n1', titulo: 'Primeira task nova', ordemExibicao: 0 },
        { id: 'n2', titulo: 'Segunda task nova', ordemExibicao: 1 },
        { id: 'n3', titulo: 'Terceira task nova', ordemExibicao: 2 },
      ],
      taskComAcordo: [
        {
          id: 'c1',
          titulo: 'Primeira com acordo',
          ordemExibicao: 0,
          tipoAcordoNome: 'Avaliar e planejar',
          dataRegistroAcordoAtual: '2024-05-10T10:00:00.000Z',
          alerta: false,
          numTentativas: 0,
          alertaTentativasAvaliarPlanejar: false,
          tentativasAvaliarPlanejar: 0,
        },
        {
          id: 'c2',
          titulo: 'Segunda com acordo',
          ordemExibicao: 1,
          tipoAcordoNome: 'Enviar para review',
          dataRegistroAcordoAtual: '2024-05-11T10:00:00.000Z',
          alerta: true,
          numTentativas: 2,
          alertaTentativasAvaliarPlanejar: false,
          tentativasAvaliarPlanejar: 0,
        },
      ],
    } satisfies ListaDeAcordos);

    render(<ListaDeAcordosPage />);

    const grupoTaskNova = await screen.findByTestId('grupo-task-nova');
    const titulosTaskNova = within(grupoTaskNova)
      .getAllByRole('heading', { level: 3 })
      .map((el) => el.textContent);
    expect(titulosTaskNova).toEqual([
      'Primeira task nova',
      'Segunda task nova',
      'Terceira task nova',
    ]);

    const grupoTaskComAcordo = screen.getByTestId('grupo-task-com-acordo');
    const titulosTaskComAcordo = within(grupoTaskComAcordo)
      .getAllByRole('heading', { level: 3 })
      .map((el) => el.textContent);
    expect(titulosTaskComAcordo).toEqual(['Primeira com acordo', 'Segunda com acordo']);
  });

  it('exibe "Nenhuma Task encontrada." quando a busca não retorna resultados em nenhum grupo (Requisito 13.3)', async () => {
    obterLista.mockResolvedValueOnce(listaVazia());

    render(<ListaDeAcordosPage />);

    // Espera o carregamento inicial (sem filtro) terminar antes de buscar.
    await screen.findByTestId('grupo-task-nova');

    obterLista.mockResolvedValueOnce(listaVazia());

    const campoBusca = screen.getByLabelText(/buscar por título ou responsável/i);
    fireEvent.change(campoBusca, { target: { value: 'termo-sem-resultado' } });

    expect(await screen.findByText(/nenhuma task encontrada/i)).toBeInTheDocument();
    expect(obterLista).toHaveBeenLastCalledWith('termo-sem-resultado');
    expect(screen.queryByTestId('grupo-task-nova')).not.toBeInTheDocument();
    expect(screen.queryByTestId('grupo-task-com-acordo')).not.toBeInTheDocument();
  });

  it('ao limpar a busca, recarrega e exibe a lista completa (Requisito 13.4)', async () => {
    const listaCompleta: ListaDeAcordos = {
      taskNova: [{ id: 'n1', titulo: 'Task encontrada pela busca', ordemExibicao: 0 }],
      taskComAcordo: [],
    };

    obterLista.mockResolvedValueOnce(listaCompleta);

    render(<ListaDeAcordosPage />);

    await screen.findByText('Task encontrada pela busca');

    obterLista.mockResolvedValueOnce(listaVazia());

    const campoBusca = screen.getByLabelText(/buscar por título ou responsável/i);
    fireEvent.change(campoBusca, { target: { value: 'termo-sem-resultado' } });

    await screen.findByText(/nenhuma task encontrada/i);
    expect(obterLista).toHaveBeenLastCalledWith('termo-sem-resultado');

    obterLista.mockResolvedValueOnce(listaCompleta);

    fireEvent.change(campoBusca, { target: { value: '' } });

    expect(await screen.findByText('Task encontrada pela busca')).toBeInTheDocument();
    expect(obterLista).toHaveBeenLastCalledWith(undefined);
    expect(screen.queryByText(/nenhuma task encontrada/i)).not.toBeInTheDocument();
  });

  it('ao soltar uma Task em nova posição, chama reordenarTask com a nova posição global (Requisito 14.1)', async () => {
    reordenarTask.mockResolvedValue(undefined);
    obterLista.mockResolvedValue({
      taskNova: [
        { id: 'n1', titulo: 'Primeira task nova', ordemExibicao: 0 },
        { id: 'n2', titulo: 'Segunda task nova', ordemExibicao: 1 },
        { id: 'n3', titulo: 'Terceira task nova', ordemExibicao: 2 },
      ],
      taskComAcordo: [],
    } satisfies ListaDeAcordos);

    render(<ListaDeAcordosPage />);

    const grupoTaskNova = await screen.findByTestId('grupo-task-nova');
    const botaoSimularDrop = within(grupoTaskNova).getByTestId('simular-drop');

    fireEvent.click(botaoSimularDrop);

    // Ao soltar 'n1' (índice 0) na posição 1 dentro do grupo, o grupo
    // resultante é [n2, n1, n3]: 'n1' passa a ficar imediatamente após
    // 'n2', que ocupa a posição global 0 (sem 'n1'), então a nova posição
    // global esperada para 'n1' é 1.
    expect(reordenarTask).toHaveBeenCalledWith('n1', 1);
  });

  it('ao remover uma Task (confirmando a remoção), atualiza a lista exibida (Requisito 9.4)', async () => {
    removerTask.mockResolvedValue(undefined);
    obterLista.mockResolvedValue({
      taskNova: [
        { id: 'n1', titulo: 'Task a ser removida', ordemExibicao: 0 },
        { id: 'n2', titulo: 'Task que permanece', ordemExibicao: 1 },
      ],
      taskComAcordo: [],
    } satisfies ListaDeAcordos);

    render(<ListaDeAcordosPage />);

    await screen.findByText('Task a ser removida');
    expect(screen.getByText('Task que permanece')).toBeInTheDocument();

    const botoesRemover = screen.getAllByTestId('task-card-remover');
    fireEvent.click(botoesRemover[0]!);
    fireEvent.click(screen.getByTestId('task-card-confirmar-remocao'));

    await screen.findByText('Task que permanece');
    expect(screen.queryByText('Task a ser removida')).not.toBeInTheDocument();
    expect(removerTask).toHaveBeenCalledWith('n1');
  });
});
