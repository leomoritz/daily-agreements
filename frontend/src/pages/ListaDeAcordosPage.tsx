// ListaDeAcordosPage — página principal do app (design.md > Frontend
// Components > ListaDeAcordosPage). Consome `GET /tasks` (via
// `obterLista`, ver src/api/client.ts) e renderiza os dois grupos da
// Lista_de_Acordos: Task_Nova e Task_Com_Acordo.
//
// Requisito 3.2: os dois grupos são sempre renderizados, identificados
// claramente por título.
// Requisito 3.4: quando um grupo não possui itens, o container do grupo
// permanece visível com uma indicação de "nenhuma Task nessa categoria"
// em vez de ser omitido.
// Requisito 3.5: os itens de cada grupo são renderizados na ordem
// retornada pela API (já ordenada por Ordem_de_Exibição no backend).
//
// Requisito 13 (busca/filtro): a barra de busca envia o termo para
// `GET /tasks?search=` a cada alteração (sem debounce — o volume de
// Tasks esperado é pequeno o suficiente para não justificar a
// complexidade extra). Quando o resultado filtrado não contém nenhuma
// Task em nenhum dos dois grupos, uma indicação única de "nenhuma Task
// encontrada" é exibida no lugar dos grupos (Requisito 13.3). Ao limpar
// o termo de busca, a lista completa (sem filtro) é recarregada
// (Requisito 13.4).
//
// Requisito 14 (reordenação manual via drag-and-drop, tarefa 22): cada
// grupo (Task_Nova, Task_Com_Acordo) é envolvido por um `SortableTaskGroup`
// (`@dnd-kit`) independente — arrastar um item só reordena dentro do
// próprio grupo, nunca entre grupos (a reclassificação Task_Nova →
// Task_Com_Acordo só ocorre ao registrar um Acordo, não por
// drag-and-drop).
//
// `TaskService.reordenarTask` (backend/src/services/taskService.ts)
// calcula `novaPosicao` como um índice dentro da lista de TODAS as Tasks
// ativas (os dois grupos combinados), ordenada por `ordemExibicao` — não
// um índice local ao grupo. Por isso, ao soltar um item em uma nova
// posição local (dentro do seu grupo), `calcularNovaPosicaoGlobal`
// traduz essa posição local para o índice global equivalente: localiza o
// item que passará a ficar imediatamente antes do item movido (dentro do
// próprio grupo, após o reordenamento local) e usa a posição desse item
// na lista global (os dois grupos combinados, ordenados por
// `ordemExibicao`) para determinar `novaPosicao` — garantindo que a
// ordem relativa dentro do grupo movido corresponda exatamente ao que foi
// solicitado no drop, sem depender de nenhuma ordenação específica entre
// os dois grupos.

import { useCallback, useEffect, useRef, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { obterLista, reordenarTask } from '../api/client';
import { ApiError } from '../api/errors';
import type { ListaDeAcordos, TaskComAcordoItem, TaskNovaItem } from '../api/types';
import { CadastroEmLotePanel } from '../components/CadastroEmLotePanel';
import { SortableTaskGroup } from '../components/SortableTaskGroup';
import { SortableTaskItem } from '../components/SortableTaskItem';
import type { TaskEdicaoResultado } from '../components/TaskCard';
import './ListaDeAcordosPage.css';

type ItemComOrdemExibicao = { id: string; ordemExibicao: number };

/**
 * Traduz uma posição local (dentro de um grupo) para o índice global
 * equivalente, esperado por `reordenarTask(taskId, novaPosicao)` (ver
 * comentário de topo de arquivo e `backend/src/services/taskService.ts`
 * > `reordenarTask`).
 *
 * `grupoAposMover` é o grupo (Task_Nova ou Task_Com_Acordo) já reordenado
 * localmente (isto é, com o item movido já na posição de destino).
 */
function calcularNovaPosicaoGlobal(
  lista: ListaDeAcordos,
  grupoAposMover: ItemComOrdemExibicao[],
  movedId: string,
): number {
  const globalSemMovido = [...lista.taskNova, ...lista.taskComAcordo]
    .filter((item) => item.id !== movedId)
    .sort((a, b) => a.ordemExibicao - b.ordemExibicao);

  const indiceNoGrupo = grupoAposMover.findIndex((item) => item.id === movedId);
  const predecessorId = indiceNoGrupo > 0 ? grupoAposMover[indiceNoGrupo - 1]!.id : null;

  if (predecessorId === null) {
    return 0;
  }

  const indicePredecessorGlobal = globalSemMovido.findIndex((item) => item.id === predecessorId);
  return indicePredecessorGlobal + 1;
}

type Status = 'carregando' | 'sucesso' | 'erro';

export function ListaDeAcordosPage() {
  const [lista, setLista] = useState<ListaDeAcordos | null>(null);
  const [status, setStatus] = useState<Status>('carregando');
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);
  const [termoBusca, setTermoBusca] = useState('');

  // Guarda a requisição mais recente para ignorar respostas de buscas
  // anteriores que retornem fora de ordem (ex.: digitação rápida).
  const requisicaoAtualRef = useRef(0);

  const carregarLista = useCallback((termo?: string) => {
    const idDaRequisicao = ++requisicaoAtualRef.current;

    setStatus('carregando');
    setMensagemErro(null);

    obterLista(termo)
      .then((resultado) => {
        if (idDaRequisicao !== requisicaoAtualRef.current) return;
        setLista(resultado);
        setStatus('sucesso');
      })
      .catch((error: unknown) => {
        if (idDaRequisicao !== requisicaoAtualRef.current) return;
        const mensagem =
          error instanceof ApiError
            ? error.message
            : 'Não foi possível carregar a lista de Tasks.';
        setMensagemErro(mensagem);
        setStatus('erro');
      });
  }, []);

  useEffect(() => {
    carregarLista();
  }, [carregarLista]);

  /**
   * Trata o drop de um item de um grupo em uma nova posição local
   * (Requisito 14.1, 14.2): reordena o estado local de forma otimista, e
   * então chama `reordenarTask` com a posição global equivalente. Em
   * caso de erro (`ApiError`), desfaz a reordenação otimista e exibe uma
   * mensagem de erro.
   */
  function handleReorder(
    grupo: 'taskNova' | 'taskComAcordo',
    oldIndex: number,
    newIndex: number,
    movedId: string,
  ) {
    const listaAnterior = lista;
    if (listaAnterior === null) return;

    const grupoAnterior = listaAnterior[grupo] as (TaskNovaItem | TaskComAcordoItem)[];
    const grupoReordenado = arrayMove(grupoAnterior, oldIndex, newIndex);
    const novaPosicao = calcularNovaPosicaoGlobal(listaAnterior, grupoReordenado, movedId);

    // Reconstrói a ordem global e reatribui `ordemExibicao` sequencialmente
    // (0, 1, 2, ...) exatamente como o backend fará em `reordenarTask` (ver
    // comentário de topo de arquivo). Sem isso, o `ordemExibicao` de cada
    // item ficaria defasado após a reordenação otimista — e reordenações
    // subsequentes (antes de um refetch) calculariam a posição global a
    // partir de valores desatualizados, persistindo no servidor uma ordem
    // divergente da exibida. Essa divergência só se tornava visível no
    // próximo refetch (registrar/finalizar/editar Acordo etc.), fazendo a
    // ordenação escolhida "se perder" após qualquer ação.
    const movedItem = grupoReordenado.find((item) => item.id === movedId)!;
    const novaOrdemGlobal = [...listaAnterior.taskNova, ...listaAnterior.taskComAcordo]
      .filter((item) => item.id !== movedId)
      .sort((a, b) => a.ordemExibicao - b.ordemExibicao);
    novaOrdemGlobal.splice(novaPosicao, 0, movedItem);
    const ordemPorId = new Map(novaOrdemGlobal.map((item, index) => [item.id, index]));

    function reatribuirOrdemExibicao<T extends ItemComOrdemExibicao>(itens: T[]): T[] {
      return itens.map((item) => ({
        ...item,
        ordemExibicao: ordemPorId.get(item.id) ?? item.ordemExibicao,
      }));
    }

    const listaOtimista: ListaDeAcordos = {
      taskNova: reatribuirOrdemExibicao(
        grupo === 'taskNova' ? (grupoReordenado as TaskNovaItem[]) : listaAnterior.taskNova,
      ),
      taskComAcordo: reatribuirOrdemExibicao(
        grupo === 'taskComAcordo'
          ? (grupoReordenado as TaskComAcordoItem[])
          : listaAnterior.taskComAcordo,
      ),
    };

    setLista(listaOtimista);

    reordenarTask(movedId, novaPosicao).catch((error: unknown) => {
      const mensagem =
        error instanceof ApiError ? error.message : 'Não foi possível reordenar a Task.';
      setMensagemErro(mensagem);
      // Desfaz a reordenação otimista, restaurando o estado anterior.
      setLista(listaAnterior);
    });
  }

  /**
   * Atualiza o item exibido (em qualquer um dos grupos) após uma edição
   * de título/Responsável ter sido aceita pela API (Requisito 9.1, 9.2,
   * 9.6, 9.7 — tarefa 27.1). `TaskCard` já resolveu `responsavelNome` a
   * partir do Usuário selecionado antes de chamar este handler.
   */
  function handleTaskEditada(taskId: string, resultado: TaskEdicaoResultado) {
    setLista((listaAtual) => {
      if (listaAtual === null) return listaAtual;

      function aplicarEdicao<T extends { id: string }>(itens: T[]): T[] {
        return itens.map((item) =>
          item.id === taskId ? { ...item, ...resultado } : item,
        );
      }

      return {
        taskNova: aplicarEdicao(listaAtual.taskNova),
        taskComAcordo: aplicarEdicao(listaAtual.taskComAcordo),
      };
    });
  }

  /**
   * Remove o item exibido (em qualquer um dos grupos) após a remoção ter
   * sido aceita pela API (Requisito 9.4, 9.5 — tarefa 27.1).
   */
  function handleTaskRemovida(taskId: string) {
    setLista((listaAtual) => {
      if (listaAtual === null) return listaAtual;

      return {
        taskNova: listaAtual.taskNova.filter((item) => item.id !== taskId),
        taskComAcordo: listaAtual.taskComAcordo.filter((item) => item.id !== taskId),
      };
    });
  }

  /**
   * Chamado após um registro ou avaliação de Acordo ser aceito pela API,
   * a partir de qualquer `TaskCard` (tarefa 28.1 — wiring final do
   * frontend). Em vez de reclassificar/atualizar o item localmente,
   * recarrega a lista completa do servidor com o termo de busca atual —
   * a mesma lógica que já computa agrupamento/ordenação/alerta em
   * `ListaDeAcordosService` no backend, evitando duplicá-la no cliente.
   */
  function handleAcordoAlterado() {
    const termo = termoBusca.trim();
    carregarLista(termo.length > 0 ? termo : undefined);
  }

  /**
   * Chamado após um cadastro em lote ser aceito pela API (tarefa 28.1):
   * recarrega a lista completa para que as novas Tasks apareçam.
   */
  function handleLoteProcessado() {
    const termo = termoBusca.trim();
    carregarLista(termo.length > 0 ? termo : undefined);
  }

  function handleChangeBusca(event: React.ChangeEvent<HTMLInputElement>) {
    const valor = event.target.value;
    setTermoBusca(valor);

    const termo = valor.trim();
    // Requisito 13.4: termo vazio recarrega a lista completa (sem filtro).
    carregarLista(termo.length > 0 ? termo : undefined);
  }

  const buscaSemResultados =
    status === 'sucesso' &&
    lista !== null &&
    termoBusca.trim().length > 0 &&
    lista.taskNova.length === 0 &&
    lista.taskComAcordo.length === 0;

  return (
    <main className="lista-de-acordos-page">
      <h1>Lista de Acordos</h1>

      <CadastroEmLotePanel onProcessado={handleLoteProcessado} />

      <form
        className="lista-de-acordos-page__busca"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <label htmlFor="busca-tasks">Buscar por título ou Responsável</label>
        <input
          id="busca-tasks"
          type="search"
          value={termoBusca}
          onChange={handleChangeBusca}
          placeholder="Buscar por título ou Responsável..."
        />
      </form>

      {status === 'carregando' && <p role="status">Carregando lista de Tasks...</p>}

      {status === 'erro' && (
        <p role="alert" className="lista-de-acordos-page__erro">
          {mensagemErro}
        </p>
      )}

      {status === 'sucesso' && lista !== null && (
        buscaSemResultados ? (
          <p role="status" className="lista-de-acordos-page__sem-resultados">
            Nenhuma Task encontrada.
          </p>
        ) : (
          <>
            <section
              className="lista-de-acordos-page__grupo"
              aria-labelledby="grupo-task-nova-titulo"
              data-testid="grupo-task-nova"
            >
              <h2 id="grupo-task-nova-titulo">Task Nova</h2>
              <SortableTaskGroup
                items={lista.taskNova}
                onReorder={(oldIndex, newIndex, movedId) =>
                  handleReorder('taskNova', oldIndex, newIndex, movedId)
                }
                renderItem={(item) => (
                  <SortableTaskItem
                    key={item.id}
                    item={item}
                    onTaskEditada={handleTaskEditada}
                    onTaskRemovida={handleTaskRemovida}
                    onAcordoAlterado={handleAcordoAlterado}
                  />
                )}
                emptyMessage={
                  <p className="lista-de-acordos-page__grupo-vazio">
                    Nenhuma Task nessa categoria.
                  </p>
                }
              />
            </section>

            <section
              className="lista-de-acordos-page__grupo"
              aria-labelledby="grupo-task-com-acordo-titulo"
              data-testid="grupo-task-com-acordo"
            >
              <h2 id="grupo-task-com-acordo-titulo">Task Com Acordo</h2>
              <SortableTaskGroup
                items={lista.taskComAcordo}
                onReorder={(oldIndex, newIndex, movedId) =>
                  handleReorder('taskComAcordo', oldIndex, newIndex, movedId)
                }
                renderItem={(item) => (
                  <SortableTaskItem
                    key={item.id}
                    item={item}
                    onTaskEditada={handleTaskEditada}
                    onTaskRemovida={handleTaskRemovida}
                    onAcordoAlterado={handleAcordoAlterado}
                  />
                )}
                emptyMessage={
                  <p className="lista-de-acordos-page__grupo-vazio">
                    Nenhuma Task nessa categoria.
                  </p>
                }
              />
            </section>
          </>
        )
      )}
    </main>
  );
}

export default ListaDeAcordosPage;
