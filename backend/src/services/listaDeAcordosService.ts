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
// Acordo_Atual), the Acordo_Atual's data de registro, and Responsável
// (id and nome) when defined (Requirements 3.1, 3.3, 9.5); each
// Task_Nova item carries título and Responsável (id and nome) when
// defined (Requirements 3.3, 9.5). When a Task_Com_Acordo's Acordo_Atual
// is `nao_cumprido`, the item additionally carries an active alert
// indicator and the Task's current `numTentativas` (Requirement 3.6) —
// Task_Nova items never carry this indicator, since they have no
// Acordo_Atual to evaluate. Each Task_Com_Acordo item also carries the
// Acordo_Atual's current `estadoCumprimentoAcordoAtual` (Requirements
// 8.1, 8.4) and the Ultimo_Motivo_Informado (`ultimoMotivoNome`), scoped
// to the current ciclo de não-cumprimento: present only while the
// não-cumprimento alert (`alerta`) is active for the Task — i.e. while
// the Acordo_Atual itself is `nao_cumprido`, or while it is a fresh
// `pendente` repetição of a `nao_cumprido` Acordo of the same
// Tipo_de_Acordo (`Task.repeteAcordoNaoCumprido`) — and derived,
// respectively, from that Acordo_Atual's own motivo or from the motivo of
// the Acordo it just replaced. Once the cycle is resolved (the
// Acordo_Atual is evaluated as `cumprido`, clearing both the alert and
// `repeteAcordoNaoCumprido`), `ultimoMotivoNome` goes back to absent
// until a new não-cumprimento is registered.
//
// `obterLista` (task 15.6) additionally accepts an optional `filtro`: when
// a non-empty term is given, only Tasks whose título contains the term
// (case-insensitive) OR whose current Responsável (nome/login) contains
// the term (case-insensitive) are included (Requirements 13.1, 13.2). The
// filter is applied before partitioning into taskNova/taskComAcordo, so
// both groups remain always present, even if empty after filtering
// (Requirement 13.3). When `filtro` is empty/undefined, the full active
// Task set is used, restoring the complete list (Requirement 13.4).
//
// `obterNaoAtualizados` (Requirement 7) builds the separate
// Lista_de_Acordos_Nao_Atualizados projection: active Tasks whose most
// recent Acordo's data de registro is not on the current calendar day
// (server clock, via an injectable `Clock` following the pattern of
// `AtividadesFinalizadasService`), plus Tasks with no Acordo at all,
// regardless of estado de cumprimento, ordered by `ordemExibicao`
// ascending and returned in full, without pagination.

import { TaskRepository } from '../repositories/taskRepository.js';
import type {
  TaskWithAcordoAtualResponsavelEUltimoMotivo,
  TaskWithUltimoAcordoEResponsavel,
} from '../repositories/taskRepository.js';
import { mesmoDia } from '../utils/data.js';

/** Injectable clock, defaulting to the real system clock. Used only by `obterNaoAtualizados`. */
export type Clock = () => Date;

const ESTADO_NAO_CUMPRIDO = 'nao_cumprido';

/**
 * Limite de `tentativasAvaliarPlanejar` a partir do qual o Sistema passa a
 * alertar sobre o alto número de ciclos consecutivos de "Avaliar e
 * planejar" cumprido seguido de outro "Avaliar e planejar" — dando
 * visibilidade ao time de que alguma ação precisa ser tomada para aquela
 * Task, sem tratar isso como um Acordo não cumprido.
 */
const LIMITE_TENTATIVAS_AVALIAR_PLANEJAR_PARA_ALERTA = 3;

/** Item of the `taskNova[]` group (Requirements 3.3, 3.4, 9.5). */
export interface TaskNovaItem {
  id: string;
  titulo: string;
  /** The current Responsável's id, when defined (Requirement 9.5). */
  responsavelId?: string;
  responsavelNome?: string;
  ordemExibicao: number;
}

/** Item of the `taskComAcordo[]` group (Requirements 3.1, 3.3, 3.6, 8.1, 9.5). */
export interface TaskComAcordoItem {
  id: string;
  titulo: string;
  /** The current Responsável's id, when defined (Requirement 9.5). */
  responsavelId?: string;
  responsavelNome?: string;
  ordemExibicao: number;
  tipoAcordoNome: string;
  dataRegistroAcordoAtual: Date;
  /** The Acordo_Atual's current estadoCumprimento (Requirements 8.1, 8.4). */
  estadoCumprimentoAcordoAtual: 'pendente' | 'cumprido' | 'nao_cumprido';
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
  /**
   * The Ultimo_Motivo_Informado, scoped to the current ciclo de
   * não-cumprimento: the `nome` of the Motivo_de_Nao_Cumprimento
   * associated with the Acordo that is currently triggering `alerta` for
   * this Task — the Acordo_Atual's own motivo when it is itself
   * `nao_cumprido`, or the motivo of the Acordo it just replaced when the
   * Acordo_Atual is a fresh `pendente` repetição (`repeteAcordoNaoCumprido`).
   * Absent whenever `alerta` is `false` (the cycle was resolved by a
   * cumprido evaluation or a fresh Acordo was registered), or when the
   * triggering Acordo carries no motivo.
   */
  ultimoMotivoNome?: string;
}

/** Result of `obterLista`: both groups are always present, even when empty (Requirements 3.2, 3.4, 8.1). */
export interface ListaDeAcordos {
  taskNova: TaskNovaItem[];
  taskComAcordo: TaskComAcordoItem[];
}

/** Item of the Lista_de_Acordos_Nao_Atualizados (Requirements 7.3, 7.4, 7.5, 7.6, 7.7, 7.10). */
export interface TaskNaoAtualizadaItem {
  id: string;
  titulo: string;
  responsavelId?: string;
  responsavelNome?: string;
  ordemExibicao: number;
  /** Absent when the Task has no Acordo registered at all (Requirements 7.6, 7.10). */
  dataUltimaAtualizacaoAcordo?: Date;
  /** Tipo_de_Acordo do Acordo_Atual, quando houver (Requirement 7.6). */
  tipoAcordoNome?: string;
}

export class ListaDeAcordosService {
  private readonly taskRepository: TaskRepository;
  private readonly clock: Clock;

  constructor(taskRepository: TaskRepository = new TaskRepository(), clock: Clock = () => new Date()) {
    this.taskRepository = taskRepository;
    this.clock = clock;
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
    const tasks = await this.taskRepository.listActiveWithAcordoAtualResponsavelEUltimoMotivo();
    const tasksFiltradas = this.aplicarFiltro(tasks, filtro);

    const taskNova = tasksFiltradas
      .filter((task) => !task.acordoAtualId || !task.acordoAtual)
      .sort((a, b) => a.ordemExibicao - b.ordemExibicao)
      .map((task) => this.toTaskNovaItem(task));

    const taskComAcordo = tasksFiltradas
      .filter(
        (
          task,
        ): task is TaskWithAcordoAtualResponsavelEUltimoMotivo & {
          acordoAtual: NonNullable<TaskWithAcordoAtualResponsavelEUltimoMotivo['acordoAtual']>;
        } => Boolean(task.acordoAtualId && task.acordoAtual),
      )
      .sort((a, b) => a.ordemExibicao - b.ordemExibicao)
      .map((task) => this.toTaskComAcordoItem(task));

    return { taskNova, taskComAcordo };
  }

  /**
   * Builds the Lista_de_Acordos_Nao_Atualizados projection (Requirement 7).
   *
   * Selects active Tasks (not concluída; manually removed Tasks are
   * already physically deleted — Requirement 7.5) and includes a Task
   * when it has no Acordo at all, or when its most recent Acordo's
   * `dataRegistro` falls on a calendar day different from today
   * (server clock), regardless of that Acordo's estado de cumprimento
   * (Requirements 7.3, 7.4). The result is ordered by `ordemExibicao`
   * ascending and returned in full, without pagination (Requirement 7.7).
   */
  async obterNaoAtualizados(): Promise<TaskNaoAtualizadaItem[]> {
    const tasks = await this.taskRepository.listActiveWithUltimoAcordoEResponsavel();
    const agora = this.clock();

    return tasks
      .filter((task) => this.naoAtualizadaHoje(task, agora))
      .sort((a, b) => a.ordemExibicao - b.ordemExibicao)
      .map((task) => this.toTaskNaoAtualizadaItem(task));
  }

  /**
   * A Task is included in the Lista_de_Acordos_Nao_Atualizados when it
   * has no Acordo registered, or when its most recent Acordo's
   * `dataRegistro` is not on the same calendar day as `agora`
   * (Requirements 7.3, 7.4).
   */
  private naoAtualizadaHoje(task: TaskWithUltimoAcordoEResponsavel, agora: Date): boolean {
    const dataUltimaAtualizacaoAcordo = task.acordos[0]?.dataRegistro;
    return !dataUltimaAtualizacaoAcordo || !mesmoDia(dataUltimaAtualizacaoAcordo, agora);
  }

  private toTaskNaoAtualizadaItem(task: TaskWithUltimoAcordoEResponsavel): TaskNaoAtualizadaItem {
    return {
      id: task.id,
      titulo: task.titulo,
      responsavelId: task.responsavel?.id ?? undefined,
      responsavelNome: task.responsavel?.nomeLogin ?? undefined,
      ordemExibicao: task.ordemExibicao,
      dataUltimaAtualizacaoAcordo: task.acordos[0]?.dataRegistro ?? undefined,
      tipoAcordoNome: task.acordoAtual?.tipoAcordo.nome ?? undefined,
    };
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
    tasks: TaskWithAcordoAtualResponsavelEUltimoMotivo[],
    filtro: string | undefined,
  ): TaskWithAcordoAtualResponsavelEUltimoMotivo[] {
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

  private toTaskNovaItem(task: TaskWithAcordoAtualResponsavelEUltimoMotivo): TaskNovaItem {
    return {
      id: task.id,
      titulo: task.titulo,
      responsavelId: task.responsavel?.id ?? undefined,
      responsavelNome: task.responsavel?.nomeLogin ?? undefined,
      ordemExibicao: task.ordemExibicao,
    };
  }

  private toTaskComAcordoItem(
    task: TaskWithAcordoAtualResponsavelEUltimoMotivo & {
      acordoAtual: NonNullable<TaskWithAcordoAtualResponsavelEUltimoMotivo['acordoAtual']>;
    },
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
    // Ultimo_Motivo_Informado, escopado ao ciclo de não-cumprimento
    // corrente: só aparece enquanto `alerta` estiver ativo para essa
    // Task, refletindo o motivo do próprio Acordo_Atual (quando ele
    // mesmo está `nao_cumprido`) ou o motivo do Acordo imediatamente
    // anterior (quando o Acordo_Atual é uma repetição `pendente` recém
    // criada — `task.repeteAcordoNaoCumprido`, cujo motivo relevante é o
    // do Acordo que ela substituiu, não o dela mesma, que ainda não foi
    // avaliada). Uma vez que o ciclo é resolvido (avaliação cumprida,
    // que também zera `alerta` e `repeteAcordoNaoCumprido`), o campo
    // volta a ficar ausente até um novo não cumprimento ser registrado.
    const ultimoMotivoNome = naoCumprido
      ? acordoAtual.estadoCumprimento === ESTADO_NAO_CUMPRIDO
        ? acordoAtual.motivoNaoCumprimento?.nome ?? undefined
        : task.acordos.find((acordo) => acordo.id !== acordoAtual.id)?.motivoNaoCumprimento?.nome ?? undefined
      : undefined;

    return {
      id: task.id,
      titulo: task.titulo,
      responsavelId: task.responsavel?.id ?? undefined,
      responsavelNome: task.responsavel?.nomeLogin ?? undefined,
      ordemExibicao: task.ordemExibicao,
      tipoAcordoNome: acordoAtual.tipoAcordo.nome,
      dataRegistroAcordoAtual: acordoAtual.dataRegistro,
      estadoCumprimentoAcordoAtual: acordoAtual.estadoCumprimento as
        | 'pendente'
        | 'cumprido'
        | 'nao_cumprido',
      alerta: naoCumprido,
      numTentativas: task.numTentativas,
      alertaTentativasAvaliarPlanejar,
      tentativasAvaliarPlanejar: task.tentativasAvaliarPlanejar,
      ultimoMotivoNome,
    };
  }
}

/** Shared singleton instance, wired to the default (Prisma-backed) repository. */
export const listaDeAcordosService = new ListaDeAcordosService();
