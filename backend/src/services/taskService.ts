// TaskService — domain logic for Task creation (and, in later tasks,
// editing/removal/reordering/history). See design.md "Components and
// Interfaces" > TaskService.
//
// `criarTask` (task 4.1): validates the title (trim, 1-200 chars), the
// optional description (<=2000 chars) and the optional Responsável (must
// exist in the Cadastro_de_Usuários), then creates the Task with
// `numTentativas = 0` and `ordemExibicao` at the end of the current list.
// A newly created Task never has `acordoAtualId` set, so it is implicitly
// classified as Task_Nova (Requirements 1.1-1.3, 1.5-1.9).
//
// `buscarHistorico` (task 10.1): validates the Task exists, then delegates
// to `AcordoRepository.findHistoryByTaskId` to return the Task's full
// Acordo history, ordered by `dataRegistro` ascending, including the
// Acordo_Atual when present (Requirements 7.1, 7.2, 7.4, 7.5).
//
// `editarTask` (task 11.1): validates the Task exists, then validates and
// updates the título (trim, 1-200 chars). Task 11.3 extends the same
// method with Responsável editing: an empty value removes the Responsável
// (sets it to null), while a non-empty value must reference an existing
// Usuário_Cadastrado (Requirements 9.1, 9.2, 9.3, 9.6, 9.7).
//
// `removerTask` (task 11.5): validates the Task exists, then physically
// deletes it — and, by DB-level cascade, all of its Acordos — so it (and
// its history) never appears in any future query (Requirements 9.4, 9.5).

import type { Acordo, Task } from '../../generated/prisma/index.js';
import { TaskRepository } from '../repositories/taskRepository.js';
import { AcordoRepository } from '../repositories/acordoRepository.js';
import { usuarioCadastradoRepository } from '../repositories/cadastroRepository.js';
import type { CadastroRepository } from '../repositories/cadastroRepository.js';
import { NotFoundError, ValidationError } from './errors.js';

const TITULO_MAX_LENGTH = 200;
const DESCRICAO_MAX_LENGTH = 2000;

/** Input accepted by `TaskService.criarTask`. */
export interface CriarTaskInput {
  titulo: string;
  descricao?: string | null;
  responsavelId?: string | null;
}

/**
 * Input accepted by `TaskService.editarTask`. All fields are optional —
 * `undefined` means "not editing this field". For `responsavelId`, `null`
 * or an empty (after trim) string means "remove the Responsável".
 */
export interface EditarTaskInput {
  titulo?: string;
  responsavelId?: string | null;
}

export class TaskService {
  private readonly taskRepository: TaskRepository;
  private readonly acordoRepository: AcordoRepository;
  private readonly usuarioCadastradoRepository: Pick<
    CadastroRepository<{ id: string }, unknown>,
    'findById'
  >;

  constructor(
    taskRepository: TaskRepository = new TaskRepository(),
    usuarioRepository: Pick<
      CadastroRepository<{ id: string }, unknown>,
      'findById'
    > = usuarioCadastradoRepository,
    acordoRepository: AcordoRepository = new AcordoRepository(),
  ) {
    this.taskRepository = taskRepository;
    this.usuarioCadastradoRepository = usuarioRepository;
    this.acordoRepository = acordoRepository;
  }

  /**
   * Creates a new Task, classified implicitly as Task_Nova (no
   * `acordoAtualId`).
   *
   * Validates and rejects (throwing `ValidationError`) when:
   * - the trimmed título is empty or exceeds 200 chars (Requirements 1.2, 1.3)
   * - a descrição is provided and exceeds 2000 chars (Requirement 1.6)
   * - a responsavelId is provided and does not exist in the
   *   Cadastro_de_Usuários (Requirement 1.8)
   *
   * On success (Requirements 1.1, 1.5, 1.7, 1.9):
   * - stores the trimmed título
   * - stores the descrição, when provided and valid
   * - stores the responsavelId reference, when provided and valid
   * - initializes numTentativas at 0
   * - assigns ordemExibicao at the end of the current active list
   */
  async criarTask(input: CriarTaskInput): Promise<Task> {
    const titulo = input.titulo.trim();
    if (titulo.length < 1 || titulo.length > TITULO_MAX_LENGTH) {
      throw new ValidationError(
        'TITULO_INVALIDO',
        `O título é obrigatório e deve ter no máximo ${TITULO_MAX_LENGTH} caracteres.`,
      );
    }

    const descricao = input.descricao?.trim();
    if (descricao && descricao.length > DESCRICAO_MAX_LENGTH) {
      throw new ValidationError(
        'DESCRICAO_INVALIDA',
        `A descrição excede o limite máximo de ${DESCRICAO_MAX_LENGTH} caracteres.`,
      );
    }

    const responsavelId = input.responsavelId?.trim() || undefined;
    if (responsavelId) {
      const responsavel = await this.usuarioCadastradoRepository.findById(responsavelId);
      if (!responsavel) {
        throw new ValidationError(
          'RESPONSAVEL_NAO_CADASTRADO',
          'O Responsável informado não está cadastrado.',
        );
      }
    }

    const ordemExibicao = await this.proximaOrdemExibicao();

    return this.taskRepository.create({
      titulo,
      descricao: descricao || null,
      responsavelId: responsavelId ?? null,
      numTentativas: 0,
      ordemExibicao,
    });
  }

  /**
   * Returns the full Acordo history of a Task, ordered by `dataRegistro`
   * ascending (oldest to newest), including the Acordo_Atual when there
   * is one (Requirements 7.1, 7.2, 7.4).
   *
   * Validates and rejects (throwing `NotFoundError`) when the Task does
   * not exist (Requirement 7.5).
   *
   * On success, returns every Acordo ever registered for the Task — each
   * one already carries `tipoAcordoId`, `dataRegistro` and
   * `estadoCumprimento` (Requirement 7.2) — or an empty list when the
   * Task has no Acordos (Requirement 7.4).
   */
  async buscarHistorico(taskId: string): Promise<Acordo[]> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new NotFoundError('TASK_NAO_ENCONTRADA', 'A Task não foi encontrada.');
    }

    return this.acordoRepository.findHistoryByTaskId(taskId);
  }

  /**
   * Edits an existing Task's título and/or Responsável (Requisito 9).
   *
   * Validates and rejects (throwing `NotFoundError`) when the Task does
   * not exist (Requirement 9.3).
   *
   * When `input.titulo` is provided, validates and rejects (throwing
   * `ValidationError`, preserving the previous título) when the trimmed
   * título is empty or exceeds 200 chars (Requirement 9.2).
   *
   * When `input.responsavelId` is provided (i.e. not `undefined`),
   * an empty value (`null` or, after trim, `''`) removes the Responsável,
   * allowing the Task to be left without one (Requirement 9.6). A
   * non-empty value must reference an existing Usuário_Cadastrado — when
   * it does not, the edition is rejected (throwing `ValidationError`,
   * preserving the previous Responsável) (Requirement 9.7).
   *
   * On success, updates the título to the trimmed value (Requirement 9.1)
   * and/or the Responsável to the new value (Requirement 9.6).
   */
  async editarTask(taskId: string, input: EditarTaskInput): Promise<Task> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new NotFoundError('TASK_NAO_ENCONTRADA', 'A Task não foi encontrada.');
    }

    const data: { titulo?: string; responsavelId?: string | null } = {};

    if (input.titulo !== undefined) {
      const titulo = input.titulo.trim();
      if (titulo.length < 1 || titulo.length > TITULO_MAX_LENGTH) {
        throw new ValidationError(
          'TITULO_INVALIDO',
          `O título é obrigatório e deve ter no máximo ${TITULO_MAX_LENGTH} caracteres.`,
        );
      }
      data.titulo = titulo;
    }

    if (input.responsavelId !== undefined) {
      const responsavelId = input.responsavelId?.trim() || undefined;
      if (responsavelId) {
        const responsavel = await this.usuarioCadastradoRepository.findById(responsavelId);
        if (!responsavel) {
          throw new ValidationError(
            'RESPONSAVEL_NAO_CADASTRADO',
            'O Responsável informado não está cadastrado.',
          );
        }
      }
      data.responsavelId = responsavelId ?? null;
    }

    if (data.titulo === undefined && data.responsavelId === undefined) {
      return task;
    }

    return this.taskRepository.update(taskId, data);
  }

  /**
   * Removes a Task permanently (Requisito 9).
   *
   * Validates and rejects (throwing `NotFoundError`) when the Task does
   * not exist (Requirement 9.5).
   *
   * On success, physically deletes the Task from the database — and, via
   * DB-level cascade, all of its Acordos — so neither the Task nor its
   * history appear in any future query (Requirement 9.4).
   */
  async removerTask(taskId: string): Promise<void> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new NotFoundError('TASK_NAO_ENCONTRADA', 'A Task não foi encontrada.');
    }

    await this.taskRepository.delete(taskId);
  }

  /**
   * Reorders a Task within the active list to `novaPosicao` (Requisito 14).
   *
   * Validates and rejects (throwing `NotFoundError`) when the Task does
   * not exist (Requirement 14.3).
   *
   * On success, computes the active Tasks' current relative order (by
   * `ordemExibicao`), moves the target Task to `novaPosicao` — clamped to
   * the valid range `[0, length - 1]` — and reassigns sequential
   * `ordemExibicao` values (0, 1, 2, ...) to every Task whose position in
   * the resulting order changed, persisting each change (Requirement
   * 14.1). The new order is reflected in all future queries until a new
   * manual reorder, batch registration, or Task removal occurs
   * (Requirement 14.2).
   */
  async reordenarTask(taskId: string, novaPosicao: number): Promise<void> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new NotFoundError('TASK_NAO_ENCONTRADA', 'A Task não foi encontrada.');
    }

    const tasksOrdenadas = (await this.taskRepository.listActive()).sort(
      (a, b) => a.ordemExibicao - b.ordemExibicao,
    );

    const posicaoAtual = tasksOrdenadas.findIndex((t) => t.id === taskId);
    const [taskMovida] = tasksOrdenadas.splice(posicaoAtual, 1);

    const posicaoDestino = Math.min(Math.max(novaPosicao, 0), tasksOrdenadas.length);
    tasksOrdenadas.splice(posicaoDestino, 0, taskMovida);

    const atualizacoes = tasksOrdenadas
      .map((t, ordemExibicao) => ({ id: t.id, ordemExibicaoAnterior: t.ordemExibicao, ordemExibicao }))
      .filter((t) => t.ordemExibicao !== t.ordemExibicaoAnterior);

    await Promise.all(
      atualizacoes.map((t) => this.taskRepository.update(t.id, { ordemExibicao: t.ordemExibicao })),
    );
  }

  /** Computes the next `ordemExibicao`, placing a new Task at the end of the current active list. */
  private async proximaOrdemExibicao(): Promise<number> {
    const tasks = await this.taskRepository.listActive();
    if (tasks.length === 0) {
      return 0;
    }
    return Math.max(...tasks.map((t) => t.ordemExibicao)) + 1;
  }
}

/** Shared singleton instance, wired to the default (Prisma-backed) repositories. */
export const taskService = new TaskService();
