// AcordoService — domain logic for registering an Acordo for a Task (see
// design.md "Components and Interfaces" > AcordoService).
//
// `registrarAcordo` (tasks 8.1 and 8.7) covers both the Task_Nova case
// (first Acordo) and the "next Acordo" case (replacing an
// already-evaluated Acordo_Atual, Requirements 5.1-5.3, 5.6-5.8) with a
// single, unified code path: it does not special-case Task_Nova vs
// Task_Com_Acordo. It only blocks registration while the current
// Acordo_Atual is still `pendente` (Requirement 2.5/5.5); when there is no
// Acordo_Atual (Task_Nova) or the existing one has already been evaluated
// as cumprido/não cumprido (Task_Com_Acordo), registration proceeds and
// the new Acordo replaces the previous Acordo_Atual (Requirement 5.3).
//
// Validates that the Task and the Tipo_de_Acordo exist, generates
// `dataRegistro` from an injectable clock (never accepting a
// client-supplied value), defines the new Acordo as the Task's
// Acordo_Atual, and updates the Task's Responsável only when a valid one
// is provided (Requirements 5.6-5.7), rejecting the whole operation
// (preserving both Acordo_Atual and Responsável) when an invalid
// Responsável is provided (Requirement 5.8) — that check happens before
// any Acordo is created or the Task is updated, so a rejection never
// leaves partial state behind.
//
// `avaliarAcordoAtual` (task 9.1) evaluates the compliance of a Task's
// Acordo_Atual (Requirements 4.1-4.8): it never replaces or clears the
// Acordo_Atual (that only happens via `registrarAcordo`), only updates its
// `estadoCumprimento` and, when applicable, `motivoNaoCumprimentoId`. All
// validation (Task existence, Task has an Acordo_Atual, motivo validity)
// happens before any write, so a rejection leaves state fully unchanged.
//
// (task 9.6) also implements logical removal by completion (Requirements
// 6.1-6.3): when the Acordo_Atual being evaluated has a Tipo_de_Acordo
// whose `nome` is exactly "Finalizar" and `resultado === 'cumprido'`, the
// Task is marked `concluida = true`. This is a logical removal only — the
// Task row and its full Acordo history remain in the database and stay
// queryable (e.g. via histórico); it is `ListaDeAcordosService`'s job
// (later task) to exclude concluída Tasks from the Lista_de_Acordos. This
// is unrelated to, and must not be confused with, the physical/manual
// deletion implemented by `TaskService.removerTask` (task 11.5).
//
// `repetirUltimoAcordo` (Repetir_Ultimo_Acordo) repeats the Task's
// Acordo_Atual with a single call, composing `avaliarAcordoAtual` and
// `registrarAcordo` rather than duplicating their validation/side-effect
// logic:
// - when the Acordo_Atual's Tipo_de_Acordo is exactly "Avaliar e
//   planejar", it is evaluated as cumprido and a new Acordo of the same
//   "Avaliar e planejar" type is registered — this also feeds the
//   consecutive-cycle counter (`tentativasAvaliarPlanejar`) below, since
//   from `registrarAcordo`'s point of view this is indistinguishable from
//   a normal "cumprido, then registered Avaliar e planejar again" flow;
// - for any other Tipo_de_Acordo, it is evaluated as não cumprido (which
//   increments `numTentativas`, mirroring a manual "Marcar não cumprido"
//   followed by "Registrar Acordo" with the same tipo) and a new Acordo of
//   that same type is registered, additionally marking
//   `Task.repeteAcordoNaoCumprido = true` (see below).
// In both cases the Responsável is left untouched: `registrarAcordo` is
// called without a `responsavelId`, which keeps the Task's current
// Responsável (if any) — Requirement equivalent to 5.7.
//
// `Task.repeteAcordoNaoCumprido` exists specifically to keep the não
// cumprido alert (Requirement 3.6) visible across a "Repetir último
// acordo" cycle for any Tipo_de_Acordo other than "Avaliar e planejar":
// since `repetirUltimoAcordo` marks the old Acordo não cumprido and
// *immediately* replaces it with a new `pendente` Acordo in the same
// call, the Acordo_Atual seen by any subsequent read of the Lista_de_Acordos
// is already `pendente` again — without this flag the alert would
// disappear right away instead of surfacing on the very first repetition,
// even though `numTentativas` was correctly incremented.
// `ListaDeAcordosService` ORs this flag into the same `alerta` indicator
// used for a directly não-cumprido Acordo_Atual (Requirement 3.6), since
// both represent the same underlying situation from the team's
// perspective. The flag is reset to `false`:
// - by `registrarAcordo` on every call that isn't itself the
//   "repetir, não cumprido" branch (a manual "Registrar Acordo" — first
//   or next — always starts a fresh cycle with no outstanding alert);
// - by `avaliarAcordoAtual` whenever the Acordo_Atual is evaluated as
//   cumprido (the outstanding repetition is resolved).
//
// `registrarAcordo` also tracks consecutive "Avaliar e planejar" cycles:
// whenever the Acordo_Atual being replaced was itself "Avaliar e
// planejar" and was evaluated as cumprido, and the new Acordo being
// registered is also "Avaliar e planejar", `Task.tentativasAvaliarPlanejar`
// is incremented by 1 — mirroring how `numTentativas` is incremented on
// não cumprimento, but for this specific "cumprido, mas repete o mesmo
// tipo" chain. This does NOT set the não-cumprido alert (the Acordo was,
// after all, cumprido): it is a distinct signal, surfaced by
// `ListaDeAcordosService` as a separate "alto número de tentativas" alert
// once the counter reaches 3, to give the team visibility that the Task
// keeps cycling through planning without moving forward. Any registration
// that breaks that chain (different Tipo_de_Acordo, or the previous
// Acordo_Atual wasn't cumprido/"Avaliar e planejar") resets the counter
// back to zero.

import type { Acordo } from '../../generated/prisma/index.js';
import { AcordoRepository } from '../repositories/acordoRepository.js';
import { TaskRepository } from '../repositories/taskRepository.js';
import type { TaskUpdateData } from '../repositories/taskRepository.js';
import type { CadastroRepository } from '../repositories/cadastroRepository.js';
import {
  motivoNaoCumprimentoRepository,
  tipoAcordoRepository,
  usuarioCadastradoRepository,
} from '../repositories/cadastroRepository.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';

/** Injectable clock, defaulting to the real system clock. Never accepts a client-supplied value (Requirement 2.3). */
export type Clock = () => Date;

const ESTADO_PENDENTE = 'pendente';
const ESTADO_CUMPRIDO = 'cumprido';
const ESTADO_NAO_CUMPRIDO = 'nao_cumprido';

/** Tipo_de_Acordo `nome` (exact match, case-sensitive) that triggers logical removal by completion (Requirements 6.1-6.3). */
const TIPO_ACORDO_FINALIZAR = 'Finalizar';

/** Tipo_de_Acordo `nome` (exact match, case-sensitive) tracked for consecutive "cumprido, mesmo tipo" cycles. */
const TIPO_ACORDO_AVALIAR_E_PLANEJAR = 'Avaliar e planejar';

/** Result of evaluating a Task's Acordo_Atual, as accepted by `avaliarAcordoAtual`. */
export type ResultadoAvaliacao = typeof ESTADO_CUMPRIDO | typeof ESTADO_NAO_CUMPRIDO;

export class AcordoService {
  private readonly taskRepository: TaskRepository;
  private readonly acordoRepository: AcordoRepository;
  private readonly tipoAcordoRepository: Pick<
    CadastroRepository<{ id: string; nome?: string }, unknown>,
    'findById'
  >;
  private readonly usuarioCadastradoRepository: Pick<CadastroRepository<{ id: string }, unknown>, 'findById'>;
  private readonly motivoNaoCumprimentoRepository: Pick<CadastroRepository<{ id: string }, unknown>, 'findById'>;
  private readonly clock: Clock;

  constructor(
    taskRepository: TaskRepository = new TaskRepository(),
    acordoRepository: AcordoRepository = new AcordoRepository(),
    tipoAcordoRepo: Pick<
      CadastroRepository<{ id: string; nome?: string }, unknown>,
      'findById'
    > = tipoAcordoRepository,
    usuarioRepo: Pick<CadastroRepository<{ id: string }, unknown>, 'findById'> = usuarioCadastradoRepository,
    clock: Clock = () => new Date(),
    motivoNaoCumprimentoRepo: Pick<
      CadastroRepository<{ id: string }, unknown>,
      'findById'
    > = motivoNaoCumprimentoRepository,
  ) {
    this.taskRepository = taskRepository;
    this.acordoRepository = acordoRepository;
    this.tipoAcordoRepository = tipoAcordoRepo;
    this.usuarioCadastradoRepository = usuarioRepo;
    this.clock = clock;
    this.motivoNaoCumprimentoRepository = motivoNaoCumprimentoRepo;
  }

  /**
   * Registers an Acordo for a Task — covers both the first Acordo
   * (Task_Nova) and the next Acordo (replacing an already-evaluated
   * Acordo_Atual, Requirements 5.1-5.3).
   *
   * Validates and rejects when:
   * - the Task does not exist (`NotFoundError`, Requirement 2.4)
   * - the Tipo_de_Acordo does not exist in the Cadastro_de_Tipos_de_Acordo
   *   (`ValidationError`, Requirements 2.2, 5.4)
   * - the Task already has a pending (not yet evaluated) Acordo_Atual
   *   (`ConflictError`, Requirements 2.5, 5.5)
   * - a responsavelId is provided and does not exist in the
   *   Cadastro_de_Usuários (`ValidationError`, Requirement 5.8) — checked
   *   before any Acordo is created or the Task is updated, so the
   *   Acordo_Atual and Responsável remain unchanged on rejection
   *
   * On success (Requirements 2.1, 2.3, 2.6, 5.1, 5.2, 5.3, 5.6, 5.7):
   * - generates `dataRegistro` from the injected clock, never from a
   *   client-supplied value
   * - creates the Acordo with `estadoCumprimento = 'pendente'`
   * - sets it as the Task's `acordoAtualId`, replacing the previous
   *   Acordo_Atual (if any) regardless of how it was evaluated; this
   *   reclassifies a Task_Nova as Task_Com_Acordo (a Task_Nova only ever
   *   gets this classification when a first Acordo is explicitly
   *   registered, never implicitly), and keeps an already Task_Com_Acordo
   *   in that same classification
   * - updates the Task's Responsável when a valid responsavelId is
   *   provided (Requirement 5.6), leaving it unchanged otherwise
   *   (Requirement 5.7)
   * - resets `Task.repeteAcordoNaoCumprido` to `false`, unless this call
   *   originates from `repetirUltimoAcordo`'s "não cumprido" branch
   *   (`options.repeteAcordoNaoCumprido === true`), in which case it is
   *   set to `true` instead — see the module-level comment above for why
   *   this flag exists
   */
  async registrarAcordo(
    taskId: string,
    tipoAcordoId: string,
    responsavelId?: string | null,
    options?: { repeteAcordoNaoCumprido?: boolean },
  ): Promise<Acordo> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new NotFoundError('TASK_NAO_ENCONTRADA', 'A Task não foi encontrada.');
    }

    const tipoAcordo = await this.tipoAcordoRepository.findById(tipoAcordoId);
    if (!tipoAcordo) {
      throw new ValidationError('TIPO_ACORDO_INVALIDO', 'O Tipo_de_Acordo informado é inválido.');
    }

    let acordoAtualAnterior: Acordo | null = null;
    if (task.acordoAtualId) {
      acordoAtualAnterior = await this.acordoRepository.findById(task.acordoAtualId);
      if (acordoAtualAnterior && acordoAtualAnterior.estadoCumprimento === ESTADO_PENDENTE) {
        throw new ConflictError(
          'ACORDO_ATUAL_PENDENTE',
          'A Task já possui um Acordo_Atual pendente de avaliação.',
        );
      }
    }

    let responsavelIdToSet = task.responsavelId;
    const responsavelIdTrimmed = responsavelId?.trim() || undefined;
    if (responsavelIdTrimmed) {
      const responsavel = await this.usuarioCadastradoRepository.findById(responsavelIdTrimmed);
      if (!responsavel) {
        throw new ValidationError(
          'RESPONSAVEL_NAO_CADASTRADO',
          'O Responsável informado não está cadastrado.',
        );
      }
      responsavelIdToSet = responsavelIdTrimmed;
    }

    // Cadeia de "Avaliar e planejar" consecutivos: quando o Acordo_Atual
    // sendo substituído foi avaliado como cumprido e era "Avaliar e
    // planejar", e o novo Acordo registrado também é "Avaliar e
    // planejar", incrementa `tentativasAvaliarPlanejar` — o mesmo tipo de
    // sinal usado para não cumprimento (`numTentativas`), mas sem marcar
    // o Acordo como não cumprido. Qualquer outra combinação (Tipo_de_Acordo
    // diferente, ou Acordo_Atual anterior não cumprido/pendente) quebra a
    // cadeia e reinicia o contador em zero.
    let repeteAvaliarEPlanejarAposCumprido = false;
    if (
      acordoAtualAnterior !== null &&
      acordoAtualAnterior.estadoCumprimento === ESTADO_CUMPRIDO &&
      tipoAcordo.nome === TIPO_ACORDO_AVALIAR_E_PLANEJAR
    ) {
      const tipoAcordoAnterior = await this.tipoAcordoRepository.findById(acordoAtualAnterior.tipoAcordoId);
      repeteAvaliarEPlanejarAposCumprido = tipoAcordoAnterior?.nome === TIPO_ACORDO_AVALIAR_E_PLANEJAR;
    }

    const tentativasAvaliarPlanejarToSet = repeteAvaliarEPlanejarAposCumprido
      ? task.tentativasAvaliarPlanejar + 1
      : 0;

    const dataRegistro = this.clock();

    const acordo = await this.acordoRepository.create({
      taskId,
      tipoAcordoId,
      dataRegistro,
      estadoCumprimento: ESTADO_PENDENTE,
    });

    await this.taskRepository.update(taskId, {
      acordoAtualId: acordo.id,
      responsavelId: responsavelIdToSet,
      tentativasAvaliarPlanejar: tentativasAvaliarPlanejarToSet,
      repeteAcordoNaoCumprido: options?.repeteAcordoNaoCumprido ?? false,
    });

    return acordo;
  }

  /**
   * Evaluates the compliance of a Task's Acordo_Atual (Requirements 4.1,
   * 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8).
   *
   * Validates and rejects when:
   * - the Task does not exist (`NotFoundError`, Requirement 2.4/analogous)
   * - the Task has no Acordo_Atual (`ConflictError`, Requirement 4.8 —
   *   classified as a state conflict per design.md "Error Handling")
   * - `resultado === 'nao_cumprido'` and a `motivoId` is provided that does
   *   not belong to the Cadastro_de_Motivos_de_Nao_Cumprimento
   *   (`ValidationError`, Requirement 4.7) — checked before any write, so
   *   the evaluation already registered for the Acordo is preserved
   *   (nothing is written at all in this rejection case, since the
   *   evaluation being requested is the one being rejected)
   *
   * On success:
   * - updates only the Acordo_Atual's `estadoCumprimento` (and, when
   *   applicable, `motivoNaoCumprimentoId`); the Acordo remains the Task's
   *   `acordoAtualId` — it is never replaced or cleared by this method
   *   (Requirements 4.1, 4.2)
   * - when `resultado === 'nao_cumprido'`: increments the Task's
   *   `numTentativas` by 1 (Requirement 4.3), and associates the provided
   *   `motivoId` when valid (Requirement 4.5) or stores no motivo when
   *   none is provided (Requirement 4.6)
   * - when `resultado === 'cumprido'`: leaves `numTentativas` untouched
   *   (Requirement 4.4) and does not accept/store a motivoId
   * - when `resultado === 'cumprido'` and the Acordo_Atual's
   *   Tipo_de_Acordo `nome` is exactly "Finalizar" (case-sensitive):
   *   additionally marks the Task as `concluida = true` — a logical
   *   removal from the Lista_de_Acordos only; the Task row and its full
   *   Acordo history are preserved in the database and remain queryable
   *   (Requirements 6.1, 6.2, 6.3)
   */
  async avaliarAcordoAtual(
    taskId: string,
    resultado: ResultadoAvaliacao,
    motivoId?: string | null,
  ): Promise<Acordo> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new NotFoundError('TASK_NAO_ENCONTRADA', 'A Task não foi encontrada.');
    }

    if (!task.acordoAtualId) {
      throw new ConflictError('SEM_ACORDO_ATUAL', 'A Task não possui Acordo_Atual.');
    }

    let motivoIdToSet: string | null = null;
    if (resultado === ESTADO_NAO_CUMPRIDO) {
      const motivoIdTrimmed = motivoId?.trim() || undefined;
      if (motivoIdTrimmed) {
        const motivo = await this.motivoNaoCumprimentoRepository.findById(motivoIdTrimmed);
        if (!motivo) {
          throw new ValidationError(
            'MOTIVO_NAO_CUMPRIMENTO_INVALIDO',
            'O Motivo_de_Nao_Cumprimento informado é inválido.',
          );
        }
        motivoIdToSet = motivoIdTrimmed;
      }
    }

    const acordoAtualizado = await this.acordoRepository.update(task.acordoAtualId, {
      estadoCumprimento: resultado,
      motivoNaoCumprimentoId: motivoIdToSet,
    });

    if (resultado === ESTADO_NAO_CUMPRIDO) {
      await this.taskRepository.update(taskId, {
        numTentativas: task.numTentativas + 1,
      });
    } else if (resultado === ESTADO_CUMPRIDO) {
      const taskUpdate: TaskUpdateData = {
        // Resolve qualquer alerta de repetição de não cumprimento pendente
        // (ver `Task.repeteAcordoNaoCumprido`, comentário no topo do arquivo).
        repeteAcordoNaoCumprido: false,
      };
      const tipoAcordo = await this.tipoAcordoRepository.findById(acordoAtualizado.tipoAcordoId);
      if (tipoAcordo?.nome === TIPO_ACORDO_FINALIZAR) {
        taskUpdate.concluida = true;
      }
      await this.taskRepository.update(taskId, taskUpdate);
    }

    return acordoAtualizado;
  }

  /**
   * Repeats the Task's Acordo_Atual ("Repetir último acordo"):
   *
   * - if the Acordo_Atual's Tipo_de_Acordo is exactly "Avaliar e
   *   planejar", marks it as cumprido and registers a new Acordo of the
   *   same "Avaliar e planejar" type;
   * - otherwise, marks it as não cumprido and registers a new Acordo of
   *   the same Tipo_de_Acordo as the one being repeated.
   *
   * In both cases the new Acordo is registered for the same Responsável
   * the Task currently has (if any) — no `responsavelId` is passed to
   * `registrarAcordo`, which leaves the Task's Responsável unchanged.
   *
   * Reuses `avaliarAcordoAtual` and `registrarAcordo` for all validation
   * and side effects (Task existence, Acordo_Atual existence,
   * `numTentativas`/`tentativasAvaliarPlanejar` bookkeeping, "Finalizar"
   * logical removal by completion), so this method adds no new failure
   * modes beyond the ones already documented on those two methods:
   * - the Task does not exist (`NotFoundError`)
   * - the Task has no Acordo_Atual (`ConflictError`)
   */
  async repetirUltimoAcordo(taskId: string): Promise<Acordo> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new NotFoundError('TASK_NAO_ENCONTRADA', 'A Task não foi encontrada.');
    }

    if (!task.acordoAtualId) {
      throw new ConflictError('SEM_ACORDO_ATUAL', 'A Task não possui Acordo_Atual.');
    }

    const acordoAtual = await this.acordoRepository.findById(task.acordoAtualId);
    if (!acordoAtual) {
      throw new ConflictError('SEM_ACORDO_ATUAL', 'A Task não possui Acordo_Atual.');
    }

    const tipoAcordoAtual = await this.tipoAcordoRepository.findById(acordoAtual.tipoAcordoId);
    const ehAvaliarEPlanejar = tipoAcordoAtual?.nome === TIPO_ACORDO_AVALIAR_E_PLANEJAR;

    const resultado: ResultadoAvaliacao = ehAvaliarEPlanejar ? ESTADO_CUMPRIDO : ESTADO_NAO_CUMPRIDO;

    await this.avaliarAcordoAtual(taskId, resultado);

    return this.registrarAcordo(taskId, acordoAtual.tipoAcordoId, undefined, {
      // Fora do caso "Avaliar e planejar", o Acordo_Atual acabou de ser
      // marcado não cumprido acima e já está sendo substituído por um
      // novo Acordo `pendente` nesta mesma chamada — sem esta flag, o
      // alerta de não cumprimento (Requirement 3.6) desapareceria
      // imediatamente em vez de permanecer visível já na primeira
      // repetição (ver comentário no topo do arquivo).
      repeteAcordoNaoCumprido: !ehAvaliarEPlanejar,
    });
  }
}

/** Shared singleton instance, wired to the default (Prisma-backed) repositories and the real system clock. */
export const acordoService = new AcordoService();
