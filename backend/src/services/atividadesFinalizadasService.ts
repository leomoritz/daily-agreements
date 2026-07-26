// AtividadesFinalizadasService — builds the Atividades_Finalizadas
// projection: the list of Tasks logically removed by completion
// (`concluida = true`, see AcordoService.avaliarAcordoAtual > logical
// removal by "Finalizar"), used by a dedicated view that lets the team
// see everything that has been wrapped up, independent of the active
// Lista_de_Acordos (which excludes concluída Tasks by design).
//
// A Task becomes concluída when its Acordo_Atual — whose Tipo_de_Acordo
// `nome` is exactly "Finalizar" — is evaluated as `cumprido`
// (acordoService.ts). That Acordo's `dataRegistro` is therefore the
// Task's data de finalização: since a Task's Acordo_Atual is never
// replaced after conclusão (there is no further "Registrar Acordo" once
// a Task is concluída and hidden from the Lista_de_Acordos), the
// "Finalizar" Acordo evaluated as cumprido is always the last one in the
// Task's history — but this projection locates it explicitly (the most
// recent cumprido "Finalizar" Acordo) rather than assuming positionally,
// so it stays correct even if that assumption ever changes.
//
// Each item is ordered by data de finalização descending (most recently
// finalized first), and carries an `finalizadaHoje` indicator — true when
// the data de finalização falls on the current calendar day (server
// clock, local time) — so the frontend can highlight what was wrapped up
// "today" without duplicating date-comparison logic.

import { TaskRepository } from '../repositories/taskRepository.js';
import type { TaskWithAcordosEResponsavel } from '../repositories/taskRepository.js';
import { mesmoDia } from '../utils/data.js';

const ESTADO_CUMPRIDO = 'cumprido';
const TIPO_ACORDO_FINALIZAR = 'Finalizar';

/** Injectable clock, defaulting to the real system clock. Used only to compute `finalizadaHoje`. */
export type Clock = () => Date;

/** Item of the Atividades_Finalizadas list. */
export interface AtividadeFinalizadaItem {
  id: string;
  titulo: string;
  responsavelNome?: string;
  /** Data de registro do Acordo "Finalizar" (cumprido) que concluiu a Task. */
  dataFinalizacao: Date;
  /** `true` quando `dataFinalizacao` cai no dia calendário atual (Requisito de destaque). */
  finalizadaHoje: boolean;
}

export class AtividadesFinalizadasService {
  private readonly taskRepository: TaskRepository;
  private readonly clock: Clock;

  constructor(taskRepository: TaskRepository = new TaskRepository(), clock: Clock = () => new Date()) {
    this.taskRepository = taskRepository;
    this.clock = clock;
  }

  /**
   * Builds the Atividades_Finalizadas projection: every Task marked
   * `concluida = true`, ordered by data de finalização descending (most
   * recently finalized first), each carrying a `finalizadaHoje`
   * indicator for Tasks finalized on the current calendar day.
   *
   * A concluída Task with no locatable "Finalizar" Acordo (cumprido) in
   * its history — which should not happen given how `concluida` is set,
   * but is handled defensively — falls back to the Task's `criadaEm` as
   * its data de finalização, so it is never dropped from the list.
   */
  async obterAtividadesFinalizadas(): Promise<AtividadeFinalizadaItem[]> {
    const tasks = await this.taskRepository.listConcluidasWithAcordosEResponsavel();
    const agora = this.clock();

    return tasks
      .map((task) => this.toAtividadeFinalizadaItem(task, agora))
      .sort((a, b) => b.dataFinalizacao.getTime() - a.dataFinalizacao.getTime());
  }

  /** Locates the data de finalização: the most recent cumprido "Finalizar" Acordo's dataRegistro. */
  private dataFinalizacaoDe(task: TaskWithAcordosEResponsavel): Date {
    const acordosFinalizarCumpridos = task.acordos
      .filter(
        (acordo) =>
          acordo.estadoCumprimento === ESTADO_CUMPRIDO &&
          acordo.tipoAcordo.nome === TIPO_ACORDO_FINALIZAR,
      )
      .sort((a, b) => b.dataRegistro.getTime() - a.dataRegistro.getTime());

    return acordosFinalizarCumpridos[0]?.dataRegistro ?? task.criadaEm;
  }

  private toAtividadeFinalizadaItem(
    task: TaskWithAcordosEResponsavel,
    agora: Date,
  ): AtividadeFinalizadaItem {
    const dataFinalizacao = this.dataFinalizacaoDe(task);

    return {
      id: task.id,
      titulo: task.titulo,
      responsavelNome: task.responsavel?.nomeLogin ?? undefined,
      dataFinalizacao,
      finalizadaHoje: mesmoDia(dataFinalizacao, agora),
    };
  }
}

/** Shared singleton instance, wired to the default (Prisma-backed) repository and the real system clock. */
export const atividadesFinalizadasService = new AtividadesFinalizadasService();
