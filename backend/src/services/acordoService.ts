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
import { prisma } from '../db/prismaClient.js';
import { AcordoRepository } from '../repositories/acordoRepository.js';
import { TaskRepository } from '../repositories/taskRepository.js';
import type { TaskUpdateData } from '../repositories/taskRepository.js';
import { CadastroRepository } from '../repositories/cadastroRepository.js';
import {
  motivoNaoCumprimentoRepository,
  tipoAcordoRepository,
  usuarioCadastradoRepository,
} from '../repositories/cadastroRepository.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';

/** Injectable clock, defaulting to the real system clock. Never accepts a client-supplied value (Requirement 2.3). */
export type Clock = () => Date;

/**
 * Executa `fn` recebendo uma instância de AcordoService cujos
 * repositórios estão ligados ao client apropriado — em produção, o
 * client transacional de `prisma.$transaction` (Requirements 10.5, 10.6).
 * Usado pelos métodos compostos (ex.: `repetirUltimoAcordo`) para que
 * todas as escritas de uma operação combinada aconteçam atomicamente:
 * uma exceção lançada dentro de `fn` propaga sem tradução, provocando
 * rollback automático da transação e deixando o `errorHandler` existente
 * responder no formato já adotado.
 *
 * Nos testes, injeta-se tipicamente um runner *passthrough*
 * (`(fn) => fn(this)`) para operar sobre repositórios fake em memória
 * sem abrir uma transação real.
 */
export type TransactionRunner = <T>(fn: (svc: AcordoService) => Promise<T>) => Promise<T>;

const ESTADO_PENDENTE = 'pendente';
const ESTADO_CUMPRIDO = 'cumprido';
const ESTADO_NAO_CUMPRIDO = 'nao_cumprido';

/** Tipo_de_Acordo `nome` (exact match, case-sensitive) that triggers logical removal by completion (Requirements 6.1-6.3). */
const TIPO_ACORDO_FINALIZAR = 'Finalizar';

/** Tipo_de_Acordo `nome` (exact match, case-sensitive) tracked for consecutive "cumprido, mesmo tipo" cycles. */
const TIPO_ACORDO_AVALIAR_E_PLANEJAR = 'Avaliar e planejar';

/** Result of evaluating a Task's Acordo_Atual, as accepted by `avaliarAcordoAtual`. */
export type ResultadoAvaliacao = typeof ESTADO_CUMPRIDO | typeof ESTADO_NAO_CUMPRIDO;

/** Length limit (chars, after trim) for a `motivoNome`, mirroring CadastroService's shared limit (Requirement 3.8). */
const MOTIVO_NOME_MAX_LENGTH = 100;

/**
 * Minimal repository surface `resolverMotivo` depends on for the
 * Cadastro_de_Motivos_de_Nao_Cumprimento: id lookup (existing behaviour),
 * case-insensitive name lookup and inline creation (Requirements 3.4,
 * 3.5). Structurally satisfied by `CadastroRepository<MotivoNaoCumprimento, …>`
 * — including the one bound to a transactional client by `comCliente`.
 */
type MotivoNaoCumprimentoLookup = Pick<
  CadastroRepository<{ id: string; nome: string }, { nome: string }>,
  'findById' | 'findByNomeCaseInsensitive' | 'add'
>;

/**
 * Motivo informado pelo Combobox_de_Motivo: um id já cadastrado OU um
 * nome (que pode ser novo). Aceito por `resolverMotivo` e, em tarefas
 * seguintes, por `avaliarAcordoAtual` e `repetirUltimoAcordo` (Requisitos
 * 3.3-3.6, 3.8, 4.1).
 */
export interface MotivoInput {
  motivoId?: string | null;
  motivoNome?: string | null;
}

/**
 * Opções de `registrarAcordo`. `repeteAcordoNaoCumprido` já existe
 * (mantém o Alerta_de_Nao_Cumprimento visível ao longo de uma repetição,
 * ver comentário no topo do arquivo); `confirmaCumprimentoAcordoAtual` é
 * nova (Requisito 8: habilita o Registro_de_Acordo_com_Avaliacao).
 */
export interface RegistrarAcordoOptions {
  repeteAcordoNaoCumprido?: boolean;
  confirmaCumprimentoAcordoAtual?: boolean;
}

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
  private readonly transactionRunner: TransactionRunner;

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
    transactionRunner?: TransactionRunner,
  ) {
    this.taskRepository = taskRepository;
    this.acordoRepository = acordoRepository;
    this.tipoAcordoRepository = tipoAcordoRepo;
    this.usuarioCadastradoRepository = usuarioRepo;
    this.clock = clock;
    this.motivoNaoCumprimentoRepository = motivoNaoCumprimentoRepo;
    // Runner padrão (produção): abre uma transação interativa do Prisma e
    // reconstrói este serviço com repositórios ligados ao client
    // transacional (Requirements 10.5, 10.6). Injetável para permitir um
    // runner *passthrough* nos testes (repositórios fake em memória).
    this.transactionRunner =
      transactionRunner ?? ((fn) => prisma.$transaction((tx) => fn(this.comCliente(tx as unknown as typeof prisma))));
  }

  /**
   * Devolve uma nova instância de AcordoService cujos repositórios estão
   * ligados a `client` (tipicamente o client transacional `tx` de
   * `prisma.$transaction`), preservando o `clock` e as demais
   * dependências deste serviço. Os repositórios em si não mudam: eles já
   * aceitam o client por construtor e só usam delegates de modelo, que o
   * `Prisma.TransactionClient` expõe da mesma forma que o `PrismaClient`
   * completo.
   */
  private comCliente(client: typeof prisma): AcordoService {
    // Referência resolvida antes de `passthroughRunner` ser efetivamente
    // invocado (o construtor abaixo só guarda a função). Dentro de uma
    // transação já aberta, qualquer chamada interna a `runTransaction`
    // deve continuar na mesma `tx` em vez de abrir outra — daí o
    // passthrough, no mesmo padrão usado pelos testes.
    const ref: { current: AcordoService | null } = { current: null };
    const passthroughRunner: TransactionRunner = (fn) => fn(ref.current as AcordoService);

    const clone = new AcordoService(
      new TaskRepository(client),
      new AcordoRepository(client),
      new CadastroRepository(client.tipoAcordo, 'nome'),
      new CadastroRepository(client.usuarioCadastrado, 'nomeLogin'),
      this.clock,
      new CadastroRepository(client.motivoNaoCumprimento, 'nome'),
      passthroughRunner,
    );
    ref.current = clone;
    return clone;
  }

  /**
   * Executa `fn` em uma transação, entregando um AcordoService cujos
   * repositórios usam o client transacional (Requirements 10.5, 10.6).
   * Uma exceção lançada dentro de `fn` propaga sem tradução, provocando
   * rollback automático e deixando o `errorHandler` existente responder
   * no formato já adotado.
   */
  private async runTransaction<T>(fn: (svc: AcordoService) => Promise<T>): Promise<T> {
    return this.transactionRunner(fn);
  }

  /**
   * Resolves a `MotivoInput` (id and/or name informed via o
   * Combobox_de_Motivo) into the `motivoNaoCumprimentoId` to associate to
   * an Acordo, or `null` when no motivo should be associated (Requisitos
   * 3.3-3.6, 3.8, 5.5, 10.7).
   *
   * `motivoId` tem precedência sobre `motivoNome` (o combobox nunca envia
   * os dois; a regra existe para tornar o contrato determinístico):
   * - `motivoId` informado e existente no cadastro → usa esse id.
   * - `motivoId` informado e inexistente → `ValidationError
   *   MOTIVO_NAO_CUMPRIMENTO_INVALIDO` (comportamento já existente).
   * - Caso contrário, com `motivoNome`:
   *   - trim com 0 caracteres (ou ausente) → `null` (avaliação sem
   *     motivo, Requisito 3.6).
   *   - trim com mais de 100 caracteres → `ValidationError
   *     VALOR_EXCEDE_LIMITE` (Requisito 3.8).
   *   - trim que coincide, sem diferenciar maiúsculas de minúsculas, com
   *     um valor já cadastrado → usa o id desse valor; o cadastro
   *     permanece com a mesma quantidade de valores e com os mesmos
   *     textos (Requisito 3.5).
   *   - trim novo (1 a 100 caracteres) → cria exatamente 1 novo valor com
   *     o texto pós-trim e usa o id recém-criado (Requisito 3.4).
   *
   * Não realiza nenhuma escrita relativa ao próprio Acordo/Task — apenas,
   * quando aplicável, a criação inline do Motivo_de_Nao_Cumprimento. Deve
   * ser chamado antes de qualquer outra escrita da operação e, em
   * operações compostas, com o `motivoNaoCumprimentoRepository` já ligado
   * ao client transacional (via `comCliente`), para que essa criação
   * inline participe do rollback (Requisito 5.5).
   */
  private async resolverMotivo(input?: MotivoInput): Promise<string | null> {
    const motivoIdTrimmed = input?.motivoId?.trim() || undefined;
    if (motivoIdTrimmed) {
      const motivo = await this.motivoNaoCumprimentoRepository.findById(motivoIdTrimmed);
      if (!motivo) {
        throw new ValidationError(
          'MOTIVO_NAO_CUMPRIMENTO_INVALIDO',
          'O Motivo_de_Nao_Cumprimento informado é inválido.',
        );
      }
      return motivoIdTrimmed;
    }

    const motivoNomeTrimmed = input?.motivoNome?.trim() ?? '';
    if (motivoNomeTrimmed.length < 1) {
      return null;
    }

    if (motivoNomeTrimmed.length > MOTIVO_NOME_MAX_LENGTH) {
      throw new ValidationError(
        'VALOR_EXCEDE_LIMITE',
        `Motivo_de_Nao_Cumprimento excede o limite máximo de ${MOTIVO_NOME_MAX_LENGTH} caracteres.`,
      );
    }

    // Cast para a interface mais rica: em produção (uso real, direto ou
    // via `comCliente`) o repositório é sempre um `CadastroRepository`
    // completo — a assinatura do campo/constructor permanece com o Pick
    // mais estreito (`findById`) só para preservar a compatibilidade dos
    // fakes usados pelos testes já existentes, que ainda não exercitam
    // `resolverMotivo` (sem chamadores até esta tarefa).
    const motivoRepository = this.motivoNaoCumprimentoRepository as MotivoNaoCumprimentoLookup;

    const existente = await motivoRepository.findByNomeCaseInsensitive(motivoNomeTrimmed);
    if (existente) {
      return existente.id;
    }

    const criado = await motivoRepository.add({ nome: motivoNomeTrimmed });
    return criado.id;
  }

  /**
   * Registers an Acordo for a Task — covers the first Acordo (Task_Nova),
   * the next Acordo (replacing an already-evaluated Acordo_Atual,
   * Requirements 5.1-5.3) and, now, the Registro_de_Acordo_com_Avaliacao
   * (Requirement 8): registering a new Acordo while the current
   * Acordo_Atual is still `pendente`, confirming in the same call that it
   * was cumprido.
   *
   * Validates and rejects when:
   * - the Task does not exist (`NotFoundError`, Requirement 2.4)
   * - the Tipo_de_Acordo does not exist in the Cadastro_de_Tipos_de_Acordo
   *   (`ValidationError`, Requirements 2.2, 5.4)
   * - the Task has a pending (not yet evaluated) Acordo_Atual and
   *   `options.confirmaCumprimentoAcordoAtual !== true` (`ValidationError
   *   CONFIRMACAO_CUMPRIMENTO_OBRIGATORIA`, Requirement 8.11) — replaces,
   *   in this case, the previous `ConflictError ACORDO_ATUAL_PENDENTE`;
   *   the message indicates that confirming cumprimento is mandatory and
   *   that não cumprimento must be registered via a Acao_Marcar_Nao_Cumprido
   * - a responsavelId is provided and does not exist in the
   *   Cadastro_de_Usuários (`ValidationError`, Requirement 5.8) — checked
   *   before any Acordo is created or the Task is updated, so the
   *   Acordo_Atual and Responsável remain unchanged on rejection
   *
   * When the Acordo_Atual is `pendente` and the confirmation is `true`
   * (Registro_de_Acordo_com_Avaliacao, Requirements 8.2, 8.7, 8.9, 8.10):
   * the Acordo_Atual is evaluated as cumprido (via `avaliarAcordoAtual`,
   * without motivo) and the new Acordo is registered, all inside the same
   * transaction (Requirement 8.5) — `numTentativas` is left unchanged,
   * since evaluating as cumprido never increments it. When the
   * Acordo_Atual's Tipo_de_Acordo is exactly "Finalizar",
   * `avaliarAcordoAtual` already marks `Task.concluida = true`, and no
   * new Acordo is registered (Requirement 8.7) — the evaluated Acordo is
   * returned instead. Otherwise, registration proceeds exactly as below,
   * using the just-evaluated (cumprido) Acordo_Atual to feed the
   * "Avaliar e planejar" consecutive-cycle chain (Requirements 8.9, 8.10)
   * the same way an already-evaluated Acordo_Atual would.
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
   *
   * When the Task has no Acordo_Atual (Task_Nova) or the existing
   * Acordo_Atual has already been evaluated as cumprido/não cumprido,
   * registration proceeds exactly as before and the confirmation option
   * is ignored when sent (Requirements 8.3, 8.4).
   *
   * Executes entirely inside `runTransaction` (Requirement 8.5, mirroring
   * the atomicity already implemented for `repetirUltimoAcordo`): a
   * rejection at any point — including the confirmation check and the
   * Responsável validation — leaves zero persisted changes.
   */
  async registrarAcordo(
    taskId: string,
    tipoAcordoId: string,
    responsavelId?: string | null,
    options?: RegistrarAcordoOptions,
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
    }

    if (acordoAtualAnterior && acordoAtualAnterior.estadoCumprimento === ESTADO_PENDENTE) {
      if (options?.confirmaCumprimentoAcordoAtual !== true) {
        throw new ValidationError(
          'CONFIRMACAO_CUMPRIMENTO_OBRIGATORIA',
          'É necessário confirmar que o Acordo_Atual foi cumprido para registrar um novo Acordo; para registrar o não cumprimento, utilize a ação "Marcar como não cumprido".',
        );
      }

      // Registro_de_Acordo_com_Avaliacao (Requirements 8.2, 8.5, 8.7): avalia
      // o Acordo_Atual pendente como cumprido e registra o novo Acordo (ou,
      // no caso "Finalizar", só a avaliação) em uma única transação — a
      // única situação em que este método precisa de atomicidade
      // multi-escrita, já que os demais caminhos (abaixo) fazem uma única
      // sequência de escritas equivalente à já existente antes desta tarefa.
      return this.runTransaction(async (svc) => {
        const acordoAvaliado = await svc.avaliarAcordoAtual(taskId, ESTADO_CUMPRIDO);

        // Quando o Tipo_de_Acordo do Acordo_Atual avaliado é "Finalizar",
        // `avaliarAcordoAtual` já marcou `Task.concluida = true`
        // (Requirement 8.7): nenhum novo Acordo é registrado.
        const tipoAcordoAvaliado = await svc.tipoAcordoRepository.findById(acordoAvaliado.tipoAcordoId);
        if (tipoAcordoAvaliado?.nome === TIPO_ACORDO_FINALIZAR) {
          return acordoAvaliado;
        }

        return svc.completarRegistro(task, tipoAcordoId, tipoAcordo, responsavelId, options, acordoAvaliado);
      });
    }

    return this.completarRegistro(task, tipoAcordoId, tipoAcordo, responsavelId, options, acordoAtualAnterior);
  }

  /**
   * Efetivamente cria o novo Acordo e atualiza a Task — a parte comum a
   * todos os caminhos de `registrarAcordo` (Task_Nova, Acordo_Atual já
   * avaliado, e a continuação do Registro_de_Acordo_com_Avaliacao após a
   * avaliação como cumprido). Extraído para que apenas o caminho que
   * precisa de atomicidade (Acordo_Atual `pendente` com confirmação) abra
   * uma transação; os demais caminhos permanecem exatamente como antes
   * desta tarefa (sem `runTransaction`), preservando o comportamento para
   * chamadores que constroem `AcordoService` sem um `TransactionRunner`
   * passthrough (ex.: testes de outros serviços que nunca precisaram de
   * um, já que `registrarAcordo` nunca exigiu transação fora deste novo
   * caso).
   *
   * `acordoAtualAnterior` já reflete o resultado `cumprido` quando esta
   * chamada é a continuação do Registro_de_Acordo_com_Avaliacao.
   */
  private async completarRegistro(
    task: NonNullable<Awaited<ReturnType<TaskRepository['findById']>>>,
    tipoAcordoId: string,
    tipoAcordo: { id: string; nome?: string },
    responsavelId: string | null | undefined,
    options: RegistrarAcordoOptions | undefined,
    acordoAtualAnterior: Acordo | null,
  ): Promise<Acordo> {
    const taskId = task.id;

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
      responsavelId: responsavelIdToSet,
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
   * - `resultado === 'nao_cumprido'` and the Acordo_Atual's Tipo_de_Acordo
   *   `nome` is exactly "Avaliar e planejar" (`ConflictError
   *   ACORDO_AVALIAR_PLANEJAR_NAO_CUMPRIMENTO_BLOQUEADO`, Requirements
   *   5.2, 5.5) — checked before resolving `motivo`, so no motivo is ever
   *   created inline for a rejected operation, and before any write, so
   *   `estadoCumprimento`, the associated motivo, `numTentativas`,
   *   `tentativasAvaliarPlanejar` and Ultimo_Motivo_Informado remain fully
   *   unchanged
   * - a `motivo` is provided (as a string id or as `MotivoInput.motivoId`)
   *   that does not belong to the Cadastro_de_Motivos_de_Nao_Cumprimento
   *   (`ValidationError`, Requirement 4.7) — checked before any write, so
   *   the evaluation already registered for the Acordo is preserved
   *   (nothing is written at all in this rejection case, since the
   *   evaluation being requested is the one being rejected)
   *
   * `motivo` accepts a plain string (treated as a `motivoId`, for
   * compatibility with existing callers) or a `MotivoInput` (id and/or
   * name, resolved via `resolverMotivo`) or `null`/`undefined` (no
   * motivo). See `resolverMotivo` for the full resolution rules
   * (Requirements 3.3-3.6, 3.8).
   *
   * On success:
   * - updates only the Acordo_Atual's `estadoCumprimento` (and, when
   *   applicable, `motivoNaoCumprimentoId`); the Acordo remains the Task's
   *   `acordoAtualId` — it is never replaced or cleared by this method
   *   (Requirements 4.1, 4.2)
   * - the resolved motivo is associated regardless of `resultado`
   *   (Requirement 4.5) — needed because repeating "Avaliar e planejar"
   *   from the 3rd attempt onward evaluates the Acordo as `cumprido` and
   *   still needs to carry the informed motivo; `null` is stored when no
   *   motivo is resolved
   * - when `resultado === 'nao_cumprido'`: increments the Task's
   *   `numTentativas` by 1 (Requirement 4.3)
   * - when `resultado === 'cumprido'`: leaves `numTentativas` untouched
   *   (Requirement 4.4)
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
    motivo?: string | MotivoInput | null,
  ): Promise<Acordo> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new NotFoundError('TASK_NAO_ENCONTRADA', 'A Task não foi encontrada.');
    }

    if (!task.acordoAtualId) {
      throw new ConflictError('SEM_ACORDO_ATUAL', 'A Task não possui Acordo_Atual.');
    }

    // Bloqueio de não cumprimento para "Avaliar e planejar" (Requirement
    // 5.2): checado antes de resolver o motivo, para que nenhum motivo
    // seja criado inline por uma operação rejeitada (Requirement 5.5), e
    // antes de qualquer escrita, para que estadoCumprimento, motivo
    // associado, numTentativas, tentativasAvaliarPlanejar e
    // Ultimo_Motivo_Informado da Task permaneçam inalterados.
    if (resultado === ESTADO_NAO_CUMPRIDO) {
      const acordoAtual = await this.acordoRepository.findById(task.acordoAtualId);
      const tipoAcordoAtual = acordoAtual
        ? await this.tipoAcordoRepository.findById(acordoAtual.tipoAcordoId)
        : null;
      if (tipoAcordoAtual?.nome === TIPO_ACORDO_AVALIAR_E_PLANEJAR) {
        throw new ConflictError(
          'ACORDO_AVALIAR_PLANEJAR_NAO_CUMPRIMENTO_BLOQUEADO',
          'Acordos de Tipo_de_Acordo "Avaliar e planejar" são avaliados apenas por repetição ou finalização.',
        );
      }
    }

    const motivoInput: MotivoInput | undefined =
      typeof motivo === 'string' ? { motivoId: motivo } : motivo ?? undefined;
    const motivoIdToSet = await this.resolverMotivo(motivoInput);

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
   * Ponto de entrada da Acao_Marcar_Nao_Cumprido (Requisitos 3.3, 3.6,
   * 3.11, 5.3). Um método fino sobre `avaliarAcordoAtual`: adiciona uma
   * única regra própria — a exigência de que o Acordo_Atual esteja
   * `pendente` — e delega todo o resto (resolução do motivo, incremento
   * de `numTentativas`, bloqueio de "Avaliar e planejar" etc.) a
   * `avaliarAcordoAtual`.
   *
   * Validates and rejects when:
   * - the Task does not exist (`NotFoundError TASK_NAO_ENCONTRADA`)
   * - the Task has no Acordo_Atual (`ConflictError SEM_ACORDO_ATUAL`)
   * - the Task's Acordo_Atual is not `pendente` (`ConflictError
   *   ACORDO_ATUAL_JA_AVALIADO`, Requirement 3.11) — checked before any
   *   write, so nothing is registered nor created inline for a rejected
   *   operation
   *
   * A exigência de estado `pendente` fica **apenas** aqui, e não em
   * `avaliarAcordoAtual`: `repetirUltimoAcordo` e `finalizarTask`
   * continuam podendo avaliar um Acordo_Atual já avaliado (fluxo real
   * "marcar não cumprido → repetir último acordo"), o que evita uma
   * regressão de comportamento não pedida por nenhum requisito.
   *
   * Executa dentro de `runTransaction`, para que a checagem de estado, a
   * criação inline do motivo (quando aplicável) e a avaliação do
   * Acordo_Atual sejam tudo-ou-nada.
   */
  async marcarNaoCumprido(taskId: string, motivo?: string | MotivoInput | null): Promise<Acordo> {
    return this.runTransaction(async (svc) => {
      const task = await svc.taskRepository.findById(taskId);
      if (!task) {
        throw new NotFoundError('TASK_NAO_ENCONTRADA', 'A Task não foi encontrada.');
      }

      if (!task.acordoAtualId) {
        throw new ConflictError('SEM_ACORDO_ATUAL', 'A Task não possui Acordo_Atual.');
      }

      const acordoAtual = await svc.acordoRepository.findById(task.acordoAtualId);
      if (!acordoAtual || acordoAtual.estadoCumprimento !== ESTADO_PENDENTE) {
        throw new ConflictError(
          'ACORDO_ATUAL_JA_AVALIADO',
          'O Acordo_Atual dessa Task já foi avaliado.',
        );
      }

      return svc.avaliarAcordoAtual(taskId, ESTADO_NAO_CUMPRIDO, motivo);
    });
  }

  /**
   * Repeats the Task's Acordo_Atual ("Repetir último acordo",
   * Requirements 4.2, 4.5, 4.6, 4.8, 4.9):
   *
   * - if the Acordo_Atual's Tipo_de_Acordo is exactly "Avaliar e
   *   planejar", marks it as cumprido (associating the resolved `motivo`
   *   when informed, Requirement 4.5), increments
   *   `tentativasAvaliarPlanejar` by 1 and leaves `numTentativas`
   *   unchanged (Requirement 4.6), and registers a new Acordo of the
   *   same "Avaliar e planejar" type;
   * - otherwise, marks it as não cumprido (associating the resolved
   *   `motivo` when informed, Requirement 4.2), increments
   *   `numTentativas` by 1 and registers a new Acordo of the same
   *   Tipo_de_Acordo as the one being repeated.
   *
   * In both cases the new Acordo is registered with the same
   * `tipoAcordoId` and no `responsavelId` — `registrarAcordo` leaves the
   * Task's Responsável unchanged, preserving the current Responsável
   * (Requirement 4.2). `motivo` is always optional: the backend never
   * requires it, resolving it via the same `resolverMotivo`/`MotivoInput`
   * machinery already used by `avaliarAcordoAtual`.
   *
   * Executes inside `runTransaction` (Requirement 4.8): validations, the
   * evaluation of the Acordo_Atual (including any inline motivo
   * creation) and the registration of the new Acordo all happen inside a
   * single transaction, so a failure at any point rolls back everything.
   *
   * Reuses `avaliarAcordoAtual` and `registrarAcordo` for all validation
   * and side effects (`numTentativas`/`tentativasAvaliarPlanejar`
   * bookkeeping, "Finalizar" logical removal by completion), so this
   * method adds no new failure modes beyond the ones already documented
   * on those two methods:
   * - the Task does not exist (`NotFoundError TASK_NAO_ENCONTRADA`)
   * - the Task has no Acordo_Atual (`ConflictError SEM_ACORDO_ATUAL`,
   *   Requirement 4.9)
   */
  async repetirUltimoAcordo(taskId: string, motivo?: string | MotivoInput | null): Promise<Acordo> {
    return this.runTransaction(async (svc) => {
      const task = await svc.taskRepository.findById(taskId);
      if (!task) {
        throw new NotFoundError('TASK_NAO_ENCONTRADA', 'A Task não foi encontrada.');
      }

      if (!task.acordoAtualId) {
        throw new ConflictError('SEM_ACORDO_ATUAL', 'A Task não possui Acordo_Atual.');
      }

      const acordoAtual = await svc.acordoRepository.findById(task.acordoAtualId);
      if (!acordoAtual) {
        throw new ConflictError('SEM_ACORDO_ATUAL', 'A Task não possui Acordo_Atual.');
      }

      const tipoAcordoAtual = await svc.tipoAcordoRepository.findById(acordoAtual.tipoAcordoId);
      const ehAvaliarEPlanejar = tipoAcordoAtual?.nome === TIPO_ACORDO_AVALIAR_E_PLANEJAR;

      const resultado: ResultadoAvaliacao = ehAvaliarEPlanejar ? ESTADO_CUMPRIDO : ESTADO_NAO_CUMPRIDO;

      await svc.avaliarAcordoAtual(taskId, resultado, motivo);

      return svc.registrarAcordo(taskId, acordoAtual.tipoAcordoId, undefined, {
        // Fora do caso "Avaliar e planejar", o Acordo_Atual acabou de ser
        // marcado não cumprido acima e já está sendo substituído por um
        // novo Acordo `pendente` nesta mesma chamada — sem esta flag, o
        // alerta de não cumprimento (Requirement 3.6) desapareceria
        // imediatamente em vez de permanecer visível já na primeira
        // repetição (ver comentário no topo do arquivo).
        repeteAcordoNaoCumprido: !ehAvaliarEPlanejar,
      });
    });
  }

  /**
   * "Finalizar" (ação manual): marca o Acordo_Atual da Task como cumprido
   * e finaliza a atividade imediatamente, independentemente do
   * Tipo_de_Acordo do Acordo_Atual — diferente da remoção lógica por
   * conclusão feita por `avaliarAcordoAtual` (que só marca
   * `Task.concluida = true` quando o Tipo_de_Acordo do Acordo_Atual é
   * exatamente "Finalizar").
   *
   * Reutiliza `avaliarAcordoAtual(taskId, 'cumprido')` para toda a
   * validação e os efeitos colaterais já existentes (Task não encontrada,
   * Task sem Acordo_Atual, incremento/reset de contadores), e então força
   * `Task.concluida = true` incondicionalmente — cobrindo também o caso
   * em que o Tipo_de_Acordo do Acordo_Atual não é "Finalizar".
   *
   * Assim como na remoção lógica por conclusão, isso é apenas uma
   * ocultação lógica: a Task e todo o seu histórico de Acordos
   * permanecem no banco e continuam disponíveis para consulta (ex.: via
   * histórico ou Atividades_Finalizadas).
   */
  async finalizarTask(taskId: string): Promise<Acordo> {
    const acordo = await this.avaliarAcordoAtual(taskId, ESTADO_CUMPRIDO);
    await this.taskRepository.update(taskId, { concluida: true });
    return acordo;
  }
}

/** Shared singleton instance, wired to the default (Prisma-backed) repositories and the real system clock. */
export const acordoService = new AcordoService();
