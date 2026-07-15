// ListaDeAcordosService — builds the Lista_de_Acordos projection: the
// grouped, ordered (and, in a later task, filtered) view of active Tasks
// consumed by the Daily. See design.md "Components and Interfaces" >
// ListaDeAcordosService.
//
// `obterLista` (task 15.1) selects active Tasks (Requirements 3.2, 3.4,
// 8.1 — not concluída by "Finalizar" completion, and not manually removed;
// manual removal is already a physical delete, so `TaskRepository`'s
// active-Task query is the only filter needed), partitions them into
// `taskNova[]` (no Acordo_Atual) and `taskComAcordo[]` (has an
// Acordo_Atual), and orders each group by `ordemExibicao` ascending
// (Requirement 3.5). Both groups are always present in the returned
// structure, even when empty (Requirements 3.2, 3.4, 8.1).
//
// Each Task_Com_Acordo item carries título, Tipo_de_Acordo (of the
// Acordo_Atual), the Acordo_Atual's data de registro, and Responsável when
// defined (Requirements 3.1, 3.3); each Task_Nova item carries título and
// Responsável when defined (Requirement 3.3). When a Task_Com_Acordo's
// Acordo_Atual is `nao_cumprido`, the item additionally carries an active
// alert indicator and the Task's current `numTentativas` (Requirement
// 3.6) — Task_Nova items never carry this indicator, since they have no
// Acordo_Atual to evaluate.
//
// `obterLista` (task 15.6) additionally accepts an optional `filtro`: when
// a non-empty term is given, only Tasks whose título contains the term
// (case-insensitive) OR whose current Responsável (nome/login) contains
// the term (case-insensitive) are included (Requirements 13.1, 13.2). The
// filter is applied before partitioning into taskNova/taskComAcordo, so
// both groups remain always present, even if empty after filtering
// (Requirement 13.3). When `filtro` is empty/undefined, the full active
// Task set is used, restoring the complete list (Requirement 13.4).

import { TaskRepository } from '../repositories/taskRepository.js';
import type { TaskWithAcordoAtualEResponsavel } from '../repositories/taskRepository.js';

const ESTADO_NAO_CUMPRIDO = 'nao_cumprido';

/**
 * Limite de `tentativasAvaliarPlanejar` a partir do qual o Sistema passa a
 * alertar sobre o alto número de ciclos consecutivos de "Avaliar e
 * planejar" cumprido seguido de outro "Avaliar e planejar" — dando
 * visibilidade ao time de que alguma ação precisa ser tomada para aquela
 * Task, sem tratar isso como um Acordo não cumprido.
 */
const LIMITE_TENTATIVAS_AVALIAR_PLANEJAR_PARA_ALERTA = 3;

/** Item of the `taskNova[]` group (Requirements 3.3, 3.4). */
export interface TaskNovaItem {
  id: string;
  titulo: string;
  responsavelNome?: string;
  ordemExibicao: number;
}

/** Item of the `taskComAcordo[]` group (Requirements 3.1, 3.3, 3.6). */
export interface TaskComAcordoItem {
  id: string;
  titulo: string;
  responsavelNome?: string;
  ordemExibicao: number;
  tipoAcordoNome: string;
  dataRegistroAcordoAtual: Date;
  /** Active alert indicator when the Acordo_Atual is `nao_cumprido` (Requirement 3.6). */
  alerta: boolean;
  /** The Task's current Nº_Tentativas, included alongside `alerta` (Requirement 3.6). */
  numTentativas: number;
  /**
   * Active alert indicator for a high number of consecutive "Avaliar e
   * planejar" cycles (cumprido, followed by another "Avaliar e
   * planejar") — active once `tentativasAvaliarPlanejar` reaches the
   * configured threshold. Distinct from `alerta`: it never implies the
   * Acordo_Atual was not cumprido.
   */
  alertaTentativasAvaliarPlanejar: boolean;
  /** The Task's current count of consecutive "Avaliar e planejar" cycles, included alongside `alertaTentativasAvaliarPlanejar`. */
  tentativasAvaliarPlanejar: number;
}

/** Result of `obterLista`: both groups are always present, even when empty (Requirements 3.2, 3.4, 8.1). */
export interface ListaDeAcordos {
  taskNova: TaskNovaItem[];
  taskComAcordo: TaskComAcordoItem[];
}

export class ListaDeAcordosService {
  private readonly taskRepository: TaskRepository;

  constructor(taskRepository: TaskRepository = new TaskRepository()) {
    this.taskRepository = taskRepository;
  }

  /**
   * Builds the Lista_de_Acordos projection.
   *
   * Selects active Tasks — not concluída and not manually removed
   * (manual removal is already a physical delete, so it requires no
   * additional filter here) — optionally narrowed by `filtro`
   * (Requirements 13.1, 13.2, 13.3, 13.4, see below), and partitions the
   * result into `taskNova` (no Acordo_Atual) and `taskComAcordo` (has an
   * Acordo_Atual). Both groups are always present in the result, even
   * when empty (Requirements 3.2, 3.4, 8.1, 13.3).
   *
   * Each group is ordered by `ordemExibicao` ascending (Requirement 3.5).
   *
   * Each `taskComAcordo` item includes título, the Acordo_Atual's
   * Tipo_de_Acordo nome, the Acordo_Atual's data de registro, and
   * Responsável nome when defined (Requirements 3.1, 3.3). Each
   * `taskNova` item includes título and Responsável nome when defined
   * (Requirement 3.3).
   *
   * When a `taskComAcordo` item's Acordo_Atual has
   * `estadoCumprimento === 'nao_cumprido'`, the item additionally carries
   * an active alert indicator and the Task's current `numTentativas`
   * (Requirement 3.6).
   *
   * @param filtro Optional search term. When given and non-empty (after
   *   trimming), only Tasks whose título contains the term
   *   (case-insensitive) OR whose current Responsável nome/login contains
   *   the term (case-insensitive) are included (Requirements 13.1, 13.2).
   *   Task_Nova items with no Responsável can only match on título. When
   *   omitted or empty, the full active Task set is used, restoring the
   *   complete list (Requirement 13.4).
   */
  async obterLista(filtro?: string): Promise<ListaDeAcordos> {
    const tasks = await this.taskRepository.listActiveWithAcordoAtualEResponsavel();
    const tasksFiltradas = this.aplicarFiltro(tasks, filtro);

    const taskNova = tasksFiltradas
      .filter((task) => !task.acordoAtualId || !task.acordoAtual)
      .sort((a, b) => a.ordemExibicao - b.ordemExibicao)
      .map((task) => this.toTaskNovaItem(task));

    const taskComAcordo = tasksFiltradas
      .filter((task): task is TaskWithAcordoAtualEResponsavel & { acordoAtual: NonNullable<TaskWithAcordoAtualEResponsavel['acordoAtual']> } =>
        Boolean(task.acordoAtualId && task.acordoAtual),
      )
      .sort((a, b) => a.ordemExibicao - b.ordemExibicao)
      .map((task) => this.toTaskComAcordoItem(task));

    return { taskNova, taskComAcordo };
  }

  /**
   * Applies the optional título/Responsável search filter (Requirements
   * 13.1, 13.2, 13.3, 13.4). An empty/undefined `filtro` (after trimming)
   * restores the full list unchanged (Requirement 13.4); otherwise, only
   * Tasks matching the term (case-insensitive) on título or on the
   * current Responsável's nome/login are kept — Tasks with no
   * Responsável simply never match on that criterion (Requirement 13.3).
   */
  private aplicarFiltro(
    tasks: TaskWithAcordoAtualEResponsavel[],
    filtro: string | undefined,
  ): TaskWithAcordoAtualEResponsavel[] {
    const termo = filtro?.trim().toLowerCase();
    if (!termo) {
      return tasks;
    }

    return tasks.filter((task) => {
      const tituloContemTermo = task.titulo.toLowerCase().includes(termo);
      const responsavelContemTermo = task.responsavel?.nomeLogin.toLowerCase().includes(termo) ?? false;
      return tituloContemTermo || responsavelContemTermo;
    });
  }

  private toTaskNovaItem(task: TaskWithAcordoAtualEResponsavel): TaskNovaItem {
    return {
      id: task.id,
      titulo: task.titulo,
      responsavelNome: task.responsavel?.nomeLogin ?? undefined,
      ordemExibicao: task.ordemExibicao,
    };
  }

  private toTaskComAcordoItem(
    task: TaskWithAcordoAtualEResponsavel & { acordoAtual: NonNullable<TaskWithAcordoAtualEResponsavel['acordoAtual']> },
  ): TaskComAcordoItem {
    const acordoAtual = task.acordoAtual;
    // O alerta de não cumprimento também permanece ativo quando o
    // Acordo_Atual é uma repetição (via "Repetir último acordo") de um
    // Acordo não cumprido do mesmo Tipo_de_Acordo: nesse fluxo o
    // Acordo_Atual já volta a ficar `pendente` no mesmo momento em que o
    // anterior é marcado não cumprido, então depender só de
    // `estadoCumprimento` faria o alerta desaparecer de imediato em vez
    // de surgir já na primeira repetição (Task.repeteAcordoNaoCumprido).
    const naoCumprido = acordoAtual.estadoCumprimento === ESTADO_NAO_CUMPRIDO || task.repeteAcordoNaoCumprido;
    const alertaTentativasAvaliarPlanejar =
      task.tentativasAvaliarPlanejar >= LIMITE_TENTATIVAS_AVALIAR_PLANEJAR_PARA_ALERTA;

    return {
      id: task.id,
      titulo: task.titulo,
      responsavelNome: task.responsavel?.nomeLogin ?? undefined,
      ordemExibicao: task.ordemExibicao,
      tipoAcordoNome: acordoAtual.tipoAcordo.nome,
      dataRegistroAcordoAtual: acordoAtual.dataRegistro,
      alerta: naoCumprido,
      numTentativas: task.numTentativas,
      alertaTentativasAvaliarPlanejar,
      tentativasAvaliarPlanejar: task.tentativasAvaliarPlanejar,
    };
  }
}

/** Shared singleton instance, wired to the default (Prisma-backed) repository. */
export const listaDeAcordosService = new ListaDeAcordosService();
