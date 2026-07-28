// Property-based tests for AcordoService.registrarAcordo (task 8.2).
//
// These tests exercise the domain/service layer against in-memory fakes of
// TaskRepository, AcordoRepository, and the Cadastro_de_Tipos_de_Acordo /
// Cadastro_de_Usuários lookups, keeping the property runs fast and
// deterministic (per design.md "Testing Strategy": "Os testes de
// propriedade operam sobre a camada de domínio/serviços com persistência
// em memória ou mockada").

import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { Acordo, Task } from '../../generated/prisma/index.js';
import type { AcordoCreateData, AcordoRepository, AcordoUpdateData } from '../repositories/acordoRepository.js';
import type { CadastroRepository } from '../repositories/cadastroRepository.js';
import type { TaskCreateData, TaskRepository, TaskUpdateData } from '../repositories/taskRepository.js';
import { AcordoService } from './acordoService.js';
import type { TransactionRunner } from './acordoService.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';

/** In-memory fake of TaskRepository, exposing the same public surface used by AcordoService. */
class InMemoryTaskRepository {
  private readonly tasks = new Map<string, Task>();

  async create(data: TaskCreateData): Promise<Task> {
    const task: Task = {
      id: randomUUID(),
      titulo: data.titulo,
      descricao: data.descricao ?? null,
      responsavelId: data.responsavelId ?? null,
      numTentativas: data.numTentativas ?? 0,
      tentativasAvaliarPlanejar: data.tentativasAvaliarPlanejar ?? 0,
      repeteAcordoNaoCumprido: data.repeteAcordoNaoCumprido ?? false,
      ordemExibicao: data.ordemExibicao,
      acordoAtualId: data.acordoAtualId ?? null,
      concluida: data.concluida ?? false,
      criadaEm: new Date(),
    } as Task;
    this.tasks.set(task.id, task);
    return task;
  }

  async findById(id: string): Promise<Task | null> {
    return this.tasks.get(id) ?? null;
  }

  async update(id: string, data: TaskUpdateData): Promise<Task> {
    const existing = this.tasks.get(id);
    if (!existing) {
      throw new Error(`Task not found: ${id}`);
    }
    const updated = { ...existing, ...data } as Task;
    this.tasks.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.tasks.delete(id);
  }

  async listActive(): Promise<Task[]> {
    return [...this.tasks.values()].filter((t) => !t.concluida);
  }

  /** Snapshot completo do estado interno, usado por um TransactionRunner de teste que simula rollback (task 3.13). */
  snapshot(): Map<string, Task> {
    return new Map([...this.tasks.entries()].map(([id, task]) => [id, { ...task }]));
  }

  /** Restaura o estado interno a partir de um snapshot anterior (task 3.13). */
  restore(snapshot: Map<string, Task>): void {
    this.tasks.clear();
    for (const [id, task] of snapshot) {
      this.tasks.set(id, { ...task });
    }
  }
}

/** In-memory fake of AcordoRepository, exposing the same public surface used by AcordoService. */
class InMemoryAcordoRepository {
  private readonly acordos = new Map<string, Acordo>();

  async create(data: AcordoCreateData): Promise<Acordo> {
    const acordo: Acordo = {
      id: randomUUID(),
      taskId: data.taskId,
      tipoAcordoId: data.tipoAcordoId,
      dataRegistro: data.dataRegistro ?? new Date(),
      estadoCumprimento: data.estadoCumprimento ?? 'pendente',
      motivoNaoCumprimentoId: data.motivoNaoCumprimentoId ?? null,
    } as Acordo;
    this.acordos.set(acordo.id, acordo);
    return acordo;
  }

  async findById(id: string): Promise<Acordo | null> {
    return this.acordos.get(id) ?? null;
  }

  async findHistoryByTaskId(taskId: string): Promise<Acordo[]> {
    return [...this.acordos.values()]
      .filter((a) => a.taskId === taskId)
      .sort((a, b) => a.dataRegistro.getTime() - b.dataRegistro.getTime());
  }

  async update(id: string, data: AcordoUpdateData): Promise<Acordo> {
    const existing = this.acordos.get(id);
    if (!existing) {
      throw new Error(`Acordo not found: ${id}`);
    }
    const updated = { ...existing, ...data } as Acordo;
    this.acordos.set(id, updated);
    return updated;
  }

  /** Snapshot completo do estado interno, usado por um TransactionRunner de teste que simula rollback (task 3.13). */
  snapshot(): Map<string, Acordo> {
    return new Map([...this.acordos.entries()].map(([id, acordo]) => [id, { ...acordo }]));
  }

  /** Restaura o estado interno a partir de um snapshot anterior (task 3.13). */
  restore(snapshot: Map<string, Acordo>): void {
    this.acordos.clear();
    for (const [id, acordo] of snapshot) {
      this.acordos.set(id, { ...acordo });
    }
  }
}

/** In-memory fake of a CadastroRepository lookup (TipoAcordo/UsuarioCadastrado), exposing only `findById`. */
class InMemoryCadastroLookup implements Pick<CadastroRepository<{ id: string }, unknown>, 'findById'> {
  private readonly ids: Set<string>;

  constructor(ids: string[] = []) {
    this.ids = new Set(ids);
  }

  async findById(id: string): Promise<{ id: string } | null> {
    return this.ids.has(id) ? { id } : null;
  }
}

/**
 * In-memory fake of the Cadastro_de_Tipos_de_Acordo lookup that also carries
 * each Tipo_de_Acordo's `nome`, needed to test the "Finalizar" logical
 * removal by completion (task 9.6, Requirements 6.1-6.3).
 */
class InMemoryTipoAcordoLookup implements Pick<CadastroRepository<{ id: string; nome: string }, unknown>, 'findById'> {
  private readonly tipos: Map<string, string>;

  constructor(tipos: Array<{ id: string; nome: string }> = []) {
    this.tipos = new Map(tipos.map((t) => [t.id, t.nome]));
  }

  async findById(id: string): Promise<{ id: string; nome: string } | null> {
    const nome = this.tipos.get(id);
    return nome === undefined ? null : { id, nome };
  }
}

/**
 * In-memory fake of the Cadastro_de_Motivos_de_Nao_Cumprimento lookup used
 * by the private `resolverMotivo` (task 2.1): supports id lookup (existing
 * behaviour), case-insensitive name lookup and inline creation (Requirements
 * 3.4, 3.5, 10.7). Exposes `list()` in addition, purely for test assertions
 * on the resulting cadastro state — not part of the surface `resolverMotivo`
 * itself depends on.
 */
class InMemoryMotivoRepository {
  private readonly rows: { id: string; nome: string }[] = [];

  constructor(nomesIniciais: string[] = []) {
    for (const nome of nomesIniciais) {
      this.rows.push({ id: randomUUID(), nome });
    }
  }

  async findById(id: string): Promise<{ id: string; nome: string } | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findByNomeCaseInsensitive(nome: string): Promise<{ id: string; nome: string } | null> {
    const target = nome.toLowerCase();
    return this.rows.find((r) => r.nome.toLowerCase() === target) ?? null;
  }

  async add(data: { nome: string }): Promise<{ id: string; nome: string }> {
    const row = { id: randomUUID(), nome: data.nome };
    this.rows.push(row);
    return row;
  }

  async list(): Promise<{ id: string; nome: string }[]> {
    return [...this.rows];
  }

  /** Snapshot completo do estado interno, usado por um TransactionRunner de teste que simula rollback (task 3.13). */
  snapshot(): { id: string; nome: string }[] {
    return this.rows.map((r) => ({ ...r }));
  }

  /** Restaura o estado interno a partir de um snapshot anterior (task 3.13). */
  restore(snapshot: { id: string; nome: string }[]): void {
    this.rows.length = 0;
    for (const row of snapshot) {
      this.rows.push({ ...row });
    }
  }
}

/** Builds a fresh Task_Nova (no acordoAtualId) via an in-memory TaskRepository. */
async function criarTaskNova(taskRepository: InMemoryTaskRepository, titulo: string): Promise<Task> {
  return taskRepository.create({ titulo, ordemExibicao: 0 });
}

/**
 * Builds an AcordoService for tests, injecting a *passthrough*
 * TransactionRunner (`(fn) => fn(svc)`) instead of the default
 * `prisma.$transaction`-based one (task 1.2, Requirement 10.1). This keeps
 * every composed operation that runs inside `runTransaction` (e.g.
 * `repetirUltimoAcordo`, `marcarNaoCumprido`) operating on this very same
 * instance and its in-memory fake repositories, so the existing test suite
 * never attempts to open a real Prisma transaction.
 *
 * Forwards every argument as-is to the `AcordoService` constructor, so all
 * existing call sites keep working unchanged — only the transactionRunner
 * argument (not otherwise settable by callers) is added.
 */
function construirAcordoServicoDeTeste(
  taskRepository?: ConstructorParameters<typeof AcordoService>[0],
  acordoRepository?: ConstructorParameters<typeof AcordoService>[1],
  tipoAcordoRepo?: ConstructorParameters<typeof AcordoService>[2],
  usuarioRepo?: ConstructorParameters<typeof AcordoService>[3],
  clock?: ConstructorParameters<typeof AcordoService>[4],
  motivoNaoCumprimentoRepo?: ConstructorParameters<typeof AcordoService>[5],
): AcordoService {
  let svc: AcordoService;
  svc = new AcordoService(
    taskRepository,
    acordoRepository,
    tipoAcordoRepo,
    usuarioRepo,
    clock,
    motivoNaoCumprimentoRepo,
    (fn) => fn(svc),
  );
  return svc;
}

describe('AcordoService.registrarAcordo', () => {
  // Property 5: Primeiro Acordo reclassifica a Task
  // Validates: Requirements 2.1, 8.2
  it('Feature: daily-agreements, Property 5: Primeiro Acordo reclassifica a Task', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.uuid(),
        async (titulo, tipoAcordoId) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const tipoAcordoRepository = new InMemoryCadastroLookup([tipoAcordoId]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          // Task_Nova: sem acordoAtualId
          const taskNova = await criarTaskNova(taskRepository, titulo);
          expect(taskNova.acordoAtualId).toBeFalsy();

          const acordo = await service.registrarAcordo(taskNova.id, tipoAcordoId);

          // o Acordo criado referencia o Tipo_de_Acordo informado
          expect(acordo.tipoAcordoId).toBe(tipoAcordoId);

          const taskAtualizada = await taskRepository.findById(taskNova.id);
          expect(taskAtualizada).not.toBeNull();

          // o Acordo retornado passa a ser o Acordo_Atual da Task
          expect(taskAtualizada!.acordoAtualId).toBe(acordo.id);

          // a Task é reclassificada como Task_Com_Acordo (acordoAtualId truthy)
          // em qualquer apresentação subsequente (nova leitura via findById)
          const taskReconsultada = await taskRepository.findById(taskNova.id);
          expect(taskReconsultada!.acordoAtualId).toBeTruthy();
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 6: Tipo_de_Acordo inválido rejeita o registro
  // Validates: Requirements 2.2, 5.4
  //
  // registrarAcordo (task 8.1) does not currently distinguish between the
  // "first Acordo" (Task_Nova, Requirement 2.2) and the "next Acordo"
  // (Task_Com_Acordo with an already-evaluated Acordo_Atual, Requirement
  // 5.4) cases when validating the Tipo_de_Acordo: it always looks the
  // Tipo_de_Acordo up first, before any Task-state branching (see
  // acordoService.ts). This property therefore covers Requirement 2.2 on a
  // Task_Nova today, and — since that same validation path is shared —
  // will keep passing for a Task_Com_Acordo whose Acordo_Atual has already
  // been evaluated once task 8.7 (Requirement 5.4's "next Acordo"
  // extension) lands; no changes to this test should be needed then.
  it('Feature: daily-agreements, Property 6: Tipo_de_Acordo inválido rejeita o registro', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.uuid(),
        async (titulo, tipoAcordoIdInvalido) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          // Cadastro_de_Tipos_de_Acordo vazio: tipoAcordoIdInvalido nunca pertence a ele.
          const tipoAcordoRepository = new InMemoryCadastroLookup([]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          // Task_Nova: sem Acordo_Atual (ou ausência dele)
          const taskNova = await criarTaskNova(taskRepository, titulo);
          const acordoAtualIdAntes = taskNova.acordoAtualId;

          await expect(service.registrarAcordo(taskNova.id, tipoAcordoIdInvalido)).rejects.toThrow(
            ValidationError,
          );

          // o Acordo_Atual (ou a ausência dele) da Task permanece inalterado
          const taskDepois = await taskRepository.findById(taskNova.id);
          expect(taskDepois!.acordoAtualId).toBe(acordoAtualIdAntes);
          expect(taskDepois!.acordoAtualId).toBeFalsy();

          // nenhum Acordo foi persistido para a Task
          const historico = await acordoRepository.findHistoryByTaskId(taskNova.id);
          expect(historico).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 8: Registro de novo Acordo bloqueado com Acordo_Atual pendente
  // Validates: Requirements 2.5, 5.5
  it('Feature: daily-agreements, Property 8: Registro de novo Acordo bloqueado com Acordo_Atual pendente', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.uuid(),
        fc.uuid(),
        async (titulo, tipoAcordoIdInicial, tipoAcordoIdTentativa) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const tipoAcordoRepository = new InMemoryCadastroLookup([tipoAcordoIdInicial, tipoAcordoIdTentativa]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          // Task_Nova recebe seu primeiro Acordo, que permanece `pendente` (não avaliado).
          const taskNova = await criarTaskNova(taskRepository, titulo);
          const acordoAtual = await service.registrarAcordo(taskNova.id, tipoAcordoIdInicial);
          expect(acordoAtual.estadoCumprimento).toBe('pendente');

          const taskComAcordoPendente = await taskRepository.findById(taskNova.id);
          expect(taskComAcordoPendente!.acordoAtualId).toBe(acordoAtual.id);

          // qualquer tentativa de registrar um novo Acordo enquanto o Acordo_Atual
          // ainda não foi avaliado, sem confirmar o cumprimento, deve ser
          // rejeitada com ValidationError CONFIRMACAO_CUMPRIMENTO_OBRIGATORIA
          // (Requirement 8.11 — substitui o antigo ConflictError
          // ACORDO_ATUAL_PENDENTE)
          let erroCapturado: unknown;
          try {
            await service.registrarAcordo(taskNova.id, tipoAcordoIdTentativa);
          } catch (erro) {
            erroCapturado = erro;
          }
          expect(erroCapturado).toBeInstanceOf(ValidationError);
          expect((erroCapturado as ValidationError).codigo).toBe('CONFIRMACAO_CUMPRIMENTO_OBRIGATORIA');

          // o Acordo_Atual existente permanece inalterado
          const taskDepois = await taskRepository.findById(taskNova.id);
          expect(taskDepois!.acordoAtualId).toBe(acordoAtual.id);

          // nenhum novo Acordo foi persistido para a Task
          const historico = await acordoRepository.findHistoryByTaskId(taskNova.id);
          expect(historico).toHaveLength(1);
          expect(historico[0]!.id).toBe(acordoAtual.id);
          expect(historico[0]!.estadoCumprimento).toBe('pendente');

          // com a confirmação de cumprimento, o registro é aceito: o
          // Acordo_Atual anterior é avaliado como cumprido e um novo Acordo
          // pendente passa a ser o Acordo_Atual (Registro_de_Acordo_com_Avaliacao)
          const novoAcordo = await service.registrarAcordo(taskNova.id, tipoAcordoIdTentativa, undefined, {
            confirmaCumprimentoAcordoAtual: true,
          });
          expect(novoAcordo.estadoCumprimento).toBe('pendente');
          expect(novoAcordo.id).not.toBe(acordoAtual.id);

          const taskAposConfirmacao = await taskRepository.findById(taskNova.id);
          expect(taskAposConfirmacao!.acordoAtualId).toBe(novoAcordo.id);

          const historicoAposConfirmacao = await acordoRepository.findHistoryByTaskId(taskNova.id);
          expect(historicoAposConfirmacao).toHaveLength(2);
          expect(historicoAposConfirmacao[0]!.id).toBe(acordoAtual.id);
          expect(historicoAposConfirmacao[0]!.estadoCumprimento).toBe('cumprido');
          expect(historicoAposConfirmacao[1]!.id).toBe(novoAcordo.id);
          expect(historicoAposConfirmacao[1]!.estadoCumprimento).toBe('pendente');
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 9: Task_Nova permanece sem Acordo indefinidamente
  // Validates: Requirements 2.6
  it('Feature: daily-agreements, Property 9: Task_Nova permanece sem Acordo indefinidamente', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.nat({ max: 20 }),
        async (titulo, numApresentacoes) => {
          const taskRepository = new InMemoryTaskRepository();

          // Task_Nova: sem Acordo registrado (sem acordoAtualId).
          const taskNova = await criarTaskNova(taskRepository, titulo);
          expect(taskNova.acordoAtualId).toBeFalsy();

          // Qualquer sequência de apresentações da Lista_de_Acordos (leituras
          // somente-consulta, repetidas um número arbitrário de vezes) que não
          // inclua o registro explícito de um Acordo para essa Task.
          for (let i = 0; i < numApresentacoes; i += 1) {
            const viaFindById = await taskRepository.findById(taskNova.id);
            expect(viaFindById!.acordoAtualId).toBeFalsy();

            const viaListActive = await taskRepository.listActive();
            const taskNaLista = viaListActive.find((t) => t.id === taskNova.id);
            expect(taskNaLista!.acordoAtualId).toBeFalsy();
          }

          // A Task permanece classificada como Task_Nova, sem Acordo_Atual,
          // independentemente de quantas vezes a Lista_de_Acordos foi apresentada.
          const taskFinal = await taskRepository.findById(taskNova.id);
          expect(taskFinal!.acordoAtualId).toBeFalsy();
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 18: Registro do próximo Acordo substitui o Acordo_Atual
  // Validates: Requirements 5.1, 5.2, 5.3, 7.3
  it('Feature: daily-agreements, Property 18: Registro do próximo Acordo substitui o Acordo_Atual', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.uuid(),
        fc.uuid(),
        fc.constantFrom<'cumprido' | 'nao_cumprido'>('cumprido', 'nao_cumprido'),
        async (titulo, tipoAcordoIdInicial, tipoAcordoIdProximo, estadoCumprimentoAnterior) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const tipoAcordoRepository = new InMemoryCadastroLookup([tipoAcordoIdInicial, tipoAcordoIdProximo]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          // Task_Nova recebe seu primeiro Acordo, que se torna o Acordo_Atual.
          const taskNova = await criarTaskNova(taskRepository, titulo);
          const acordoAnterior = await service.registrarAcordo(taskNova.id, tipoAcordoIdInicial);

          // o Acordo_Atual já foi avaliado — cumprido ou não cumprido,
          // independentemente do desfecho (Requirements 5.1, 5.2, 5.3)
          await acordoRepository.update(acordoAnterior.id, { estadoCumprimento: estadoCumprimentoAnterior });

          // registra um novo Acordo válido para essa Task
          const proximoAcordo = await service.registrarAcordo(taskNova.id, tipoAcordoIdProximo);

          const taskDepois = await taskRepository.findById(taskNova.id);
          expect(taskDepois).not.toBeNull();

          // o novo Acordo passa a ser o Acordo_Atual da Task
          expect(taskDepois!.acordoAtualId).toBe(proximoAcordo.id);

          // ...substituindo o anterior (que difere do novo Acordo_Atual)
          expect(proximoAcordo.id).not.toBe(acordoAnterior.id);
          expect(taskDepois!.acordoAtualId).not.toBe(acordoAnterior.id);

          // o Acordo anterior é preservado no histórico da Task, não excluído
          // (Requirement 7.3: histórico preserva o Acordo substituído)
          const historico = await acordoRepository.findHistoryByTaskId(taskNova.id);
          expect(historico).toHaveLength(2);
          expect(historico.map((a) => a.id).sort()).toEqual([acordoAnterior.id, proximoAcordo.id].sort());

          const acordoAnteriorNoHistorico = historico.find((a) => a.id === acordoAnterior.id);
          expect(acordoAnteriorNoHistorico).toBeDefined();
          expect(acordoAnteriorNoHistorico!.estadoCumprimento).toBe(estadoCumprimentoAnterior);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 20: Atualização condicional de Responsável ao registrar novo Acordo
  // Validates: Requirements 5.6, 5.7, 5.8
  //
  // Exercises the three mutually exclusive branches of Requirement 5.6-5.8
  // for the "next Acordo" case (registering a new Acordo for a Task whose
  // Acordo_Atual has already been evaluated), picking which branch to run
  // per property iteration via `fc.constantFrom`:
  // - 'valido': a Responsável that exists in the Cadastro_de_Usuários is
  //   informed -> the Task's Responsável must be updated to that reference.
  // - 'nenhum': no Responsável is informed -> the Task's Responsável must
  //   remain exactly as it was before this registration.
  // - 'invalido': a Responsável that does not exist in the
  //   Cadastro_de_Usuários is informed -> the whole registration must be
  //   rejected, preserving both the Acordo_Atual and the Responsável from
  //   before the attempt.
  it('Feature: daily-agreements, Property 20: Atualização condicional de Responsável ao registrar novo Acordo', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.uuid(),
        fc.uuid(),
        fc.constantFrom<'cumprido' | 'nao_cumprido'>('cumprido', 'nao_cumprido'),
        fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b),
        fc.boolean(),
        fc.constantFrom<'valido' | 'nenhum' | 'invalido'>('valido', 'nenhum', 'invalido'),
        async (
          titulo,
          tipoAcordoIdInicial,
          tipoAcordoIdProximo,
          estadoCumprimentoAnterior,
          [responsavelIdValido, responsavelIdInvalido],
          taskComecaComResponsavel,
          branch,
        ) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const tipoAcordoRepository = new InMemoryCadastroLookup([tipoAcordoIdInicial, tipoAcordoIdProximo]);
          // Cadastro_de_Usuários contém apenas responsavelIdValido; responsavelIdInvalido nunca pertence a ele.
          const usuarioCadastradoRepository = new InMemoryCadastroLookup([responsavelIdValido]);

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          // Task_Nova, opcionalmente já com um Responsável (válido) definido antes
          // do registro do próximo Acordo, para poder verificar que o branch
          // 'nenhum'/'invalido' preserva esse valor anterior, seja ele qual for.
          const taskNova = await taskRepository.create({
            titulo,
            responsavelId: taskComecaComResponsavel ? responsavelIdValido : undefined,
            ordemExibicao: 0,
          });

          const primeiroAcordo = await service.registrarAcordo(taskNova.id, tipoAcordoIdInicial);

          // o Acordo_Atual já foi avaliado, habilitando o registro do próximo Acordo
          await acordoRepository.update(primeiroAcordo.id, { estadoCumprimento: estadoCumprimentoAnterior });

          const taskAntes = await taskRepository.findById(taskNova.id);
          expect(taskAntes!.acordoAtualId).toBe(primeiroAcordo.id);

          if (branch === 'valido') {
            const novoAcordo = await service.registrarAcordo(
              taskNova.id,
              tipoAcordoIdProximo,
              responsavelIdValido,
            );

            const taskDepois = await taskRepository.findById(taskNova.id);
            // o Responsável atual da Task é atualizado para a referência informada
            expect(taskDepois!.responsavelId).toBe(responsavelIdValido);
            // o registro do próximo Acordo prossegue normalmente
            expect(taskDepois!.acordoAtualId).toBe(novoAcordo.id);
          } else if (branch === 'nenhum') {
            const novoAcordo = await service.registrarAcordo(taskNova.id, tipoAcordoIdProximo);

            const taskDepois = await taskRepository.findById(taskNova.id);
            // o Responsável atual permanece inalterado (igual ao valor anterior ao registro)
            expect(taskDepois!.responsavelId).toBe(taskAntes!.responsavelId);
            // o registro do próximo Acordo prossegue normalmente
            expect(taskDepois!.acordoAtualId).toBe(novoAcordo.id);
          } else {
            await expect(
              service.registrarAcordo(taskNova.id, tipoAcordoIdProximo, responsavelIdInvalido),
            ).rejects.toThrow(ValidationError);

            const taskDepois = await taskRepository.findById(taskNova.id);
            // o registro completo é rejeitado: Acordo_Atual e Responsável preservados
            expect(taskDepois!.acordoAtualId).toBe(taskAntes!.acordoAtualId);
            expect(taskDepois!.responsavelId).toBe(taskAntes!.responsavelId);

            // nenhum novo Acordo foi persistido para a Task
            const historico = await acordoRepository.findHistoryByTaskId(taskNova.id);
            expect(historico).toHaveLength(1);
            expect(historico[0]!.id).toBe(primeiroAcordo.id);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Unit tests (task 8.7): the "next Acordo" case — registering a new
  // Acordo for a Task whose current Acordo_Atual has already been
  // evaluated (cumprido or não cumprido) — reuses the same
  // `registrarAcordo` code path as the first-Acordo case (task 8.1), only
  // gated on `estadoCumprimento !== 'pendente'`. Property tests for this
  // extension are covered separately by tasks 8.8/8.9 (Properties 18/20);
  // these unit tests exercise a few concrete examples of each branch.
  describe('registro do próximo Acordo (Acordo_Atual já avaliado)', () => {
    async function montarCenarioComAcordoAvaliado(estadoCumprimento: 'cumprido' | 'nao_cumprido') {
      const taskRepository = new InMemoryTaskRepository();
      const acordoRepository = new InMemoryAcordoRepository();
      const tipoAcordoIdInicial = randomUUID();
      const tipoAcordoIdProximo = randomUUID();
      const responsavelIdValido = randomUUID();
      const tipoAcordoRepository = new InMemoryCadastroLookup([tipoAcordoIdInicial, tipoAcordoIdProximo]);
      const usuarioCadastradoRepository = new InMemoryCadastroLookup([responsavelIdValido]);

      const service = construirAcordoServicoDeTeste(
        taskRepository as unknown as TaskRepository,
        acordoRepository as unknown as AcordoRepository,
        tipoAcordoRepository,
        usuarioCadastradoRepository,
      );

      const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
      const primeiroAcordo = await service.registrarAcordo(taskNova.id, tipoAcordoIdInicial);

      // simula a avaliação do Acordo_Atual (fora do escopo deste service)
      await acordoRepository.update(primeiroAcordo.id, { estadoCumprimento });

      return {
        service,
        taskRepository,
        acordoRepository,
        taskId: taskNova.id,
        primeiroAcordoId: primeiroAcordo.id,
        tipoAcordoIdProximo,
        responsavelIdValido,
      };
    }

    it('substitui o Acordo_Atual cumprido pelo novo Acordo (Requirements 5.1, 5.3)', async () => {
      const cenario = await montarCenarioComAcordoAvaliado('cumprido');

      const novoAcordo = await cenario.service.registrarAcordo(cenario.taskId, cenario.tipoAcordoIdProximo);

      expect(novoAcordo.id).not.toBe(cenario.primeiroAcordoId);
      const taskDepois = await cenario.taskRepository.findById(cenario.taskId);
      expect(taskDepois!.acordoAtualId).toBe(novoAcordo.id);

      // o Acordo anterior permanece no histórico, apenas deixa de ser o Acordo_Atual
      const historico = await cenario.acordoRepository.findHistoryByTaskId(cenario.taskId);
      expect(historico.map((a) => a.id).sort()).toEqual([cenario.primeiroAcordoId, novoAcordo.id].sort());
    });

    it('substitui o Acordo_Atual não cumprido pelo novo Acordo (Requirements 5.2, 5.3)', async () => {
      const cenario = await montarCenarioComAcordoAvaliado('nao_cumprido');

      const novoAcordo = await cenario.service.registrarAcordo(cenario.taskId, cenario.tipoAcordoIdProximo);

      const taskDepois = await cenario.taskRepository.findById(cenario.taskId);
      expect(taskDepois!.acordoAtualId).toBe(novoAcordo.id);
      expect(taskDepois!.acordoAtualId).not.toBe(cenario.primeiroAcordoId);
    });

    it('atualiza o Responsável quando um valor válido é informado (Requirement 5.6)', async () => {
      const cenario = await montarCenarioComAcordoAvaliado('cumprido');

      await cenario.service.registrarAcordo(cenario.taskId, cenario.tipoAcordoIdProximo, cenario.responsavelIdValido);

      const taskDepois = await cenario.taskRepository.findById(cenario.taskId);
      expect(taskDepois!.responsavelId).toBe(cenario.responsavelIdValido);
    });

    it('mantém o Responsável atual inalterado quando nenhum é informado (Requirement 5.7)', async () => {
      const cenario = await montarCenarioComAcordoAvaliado('cumprido');

      // primeiro próximo Acordo, definindo um Responsável válido
      await cenario.service.registrarAcordo(cenario.taskId, cenario.tipoAcordoIdProximo, cenario.responsavelIdValido);
      const taskComResponsavel = await cenario.taskRepository.findById(cenario.taskId);
      expect(taskComResponsavel!.responsavelId).toBe(cenario.responsavelIdValido);

      // avalia esse Acordo_Atual e registra outro próximo Acordo, agora sem informar responsavelId
      await cenario.acordoRepository.update(taskComResponsavel!.acordoAtualId!, { estadoCumprimento: 'cumprido' });
      const outroTipoAcordoId = randomUUID();
      const cenarioComTipoExtra = construirAcordoServicoDeTeste(
        cenario.taskRepository as unknown as TaskRepository,
        cenario.acordoRepository as unknown as AcordoRepository,
        new InMemoryCadastroLookup([outroTipoAcordoId]),
        new InMemoryCadastroLookup([cenario.responsavelIdValido]),
      );

      await cenarioComTipoExtra.registrarAcordo(cenario.taskId, outroTipoAcordoId);

      const taskFinal = await cenario.taskRepository.findById(cenario.taskId);
      expect(taskFinal!.responsavelId).toBe(cenario.responsavelIdValido);
    });

    it('rejeita e preserva o Acordo_Atual e o Responsável quando o Responsável informado é inválido (Requirement 5.8)', async () => {
      const cenario = await montarCenarioComAcordoAvaliado('cumprido');
      const taskAntes = await cenario.taskRepository.findById(cenario.taskId);
      const responsavelIdInvalido = randomUUID();

      await expect(
        cenario.service.registrarAcordo(cenario.taskId, cenario.tipoAcordoIdProximo, responsavelIdInvalido),
      ).rejects.toThrow(ValidationError);

      const taskDepois = await cenario.taskRepository.findById(cenario.taskId);
      expect(taskDepois!.acordoAtualId).toBe(taskAntes!.acordoAtualId);
      expect(taskDepois!.responsavelId).toBe(taskAntes!.responsavelId);

      // nenhum novo Acordo foi persistido
      const historico = await cenario.acordoRepository.findHistoryByTaskId(cenario.taskId);
      expect(historico).toHaveLength(1);
    });
  });

  // Unit test (task 8.6): `dataRegistro` is generated exclusively from the
  // injected clock (Requirement 2.3), never from a client-supplied value.
  // Uses a mockable clock (a vi.fn stub) instead of the real system clock so
  // the generated timestamp can be asserted deterministically.
  describe('geração automática de dataRegistro a partir do clock injetável', () => {
    it('usa o valor retornado pelo clock mockado como dataRegistro', async () => {
      const taskRepository = new InMemoryTaskRepository();
      const acordoRepository = new InMemoryAcordoRepository();
      const tipoAcordoId = randomUUID();
      const tipoAcordoRepository = new InMemoryCadastroLookup([tipoAcordoId]);
      const usuarioCadastradoRepository = new InMemoryCadastroLookup();

      const dataMockada = new Date('2030-01-15T10:30:00.000Z');
      const clockMockado = vi.fn<() => Date>(() => dataMockada);

      const service = construirAcordoServicoDeTeste(
        taskRepository as unknown as TaskRepository,
        acordoRepository as unknown as AcordoRepository,
        tipoAcordoRepository,
        usuarioCadastradoRepository,
        clockMockado,
      );

      const taskNova = await criarTaskNova(taskRepository, 'Task de teste');

      const acordo = await service.registrarAcordo(taskNova.id, tipoAcordoId);

      // dataRegistro corresponde exatamente ao instante retornado pelo clock injetado
      expect(acordo.dataRegistro).toEqual(dataMockada);
      expect(clockMockado).toHaveBeenCalledTimes(1);
    });

    it('reflete cada instante retornado pelo clock em chamadas sucessivas, e não o relógio real do sistema', async () => {
      const taskRepository = new InMemoryTaskRepository();
      const acordoRepository = new InMemoryAcordoRepository();
      const tipoAcordoIdInicial = randomUUID();
      const tipoAcordoIdProximo = randomUUID();
      const tipoAcordoRepository = new InMemoryCadastroLookup([tipoAcordoIdInicial, tipoAcordoIdProximo]);
      const usuarioCadastradoRepository = new InMemoryCadastroLookup();

      // O clock mockado avança de forma controlada, bem distante do relógio real,
      // provando que dataRegistro depende do clock injetado, não de Date.now().
      const instantes = [new Date('2099-06-01T00:00:00.000Z'), new Date('1999-06-01T00:00:00.000Z')];
      let chamada = 0;
      const clockMockado = vi.fn<() => Date>(() => instantes[chamada++]!);

      const service = construirAcordoServicoDeTeste(
        taskRepository as unknown as TaskRepository,
        acordoRepository as unknown as AcordoRepository,
        tipoAcordoRepository,
        usuarioCadastradoRepository,
        clockMockado,
      );

      const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
      const primeiroAcordo = await service.registrarAcordo(taskNova.id, tipoAcordoIdInicial);
      expect(primeiroAcordo.dataRegistro).toEqual(instantes[0]);

      const agoraReal = Date.now();
      expect(primeiroAcordo.dataRegistro.getTime()).not.toBeCloseTo(agoraReal, -5);
    });

    it('ignora qualquer valor de dataRegistro fornecido pelo cliente, usando sempre o clock injetado', async () => {
      const taskRepository = new InMemoryTaskRepository();
      const acordoRepository = new InMemoryAcordoRepository();
      const tipoAcordoId = randomUUID();
      const tipoAcordoRepository = new InMemoryCadastroLookup([tipoAcordoId]);
      const usuarioCadastradoRepository = new InMemoryCadastroLookup();

      const dataDoClock = new Date('2030-01-15T10:30:00.000Z');
      const clockMockado = vi.fn<() => Date>(() => dataDoClock);

      const service = construirAcordoServicoDeTeste(
        taskRepository as unknown as TaskRepository,
        acordoRepository as unknown as AcordoRepository,
        tipoAcordoRepository,
        usuarioCadastradoRepository,
        clockMockado,
      );

      const taskNova = await criarTaskNova(taskRepository, 'Task de teste');

      // `registrarAcordo` não expõe nenhum parâmetro de dataRegistro em sua
      // assinatura pública; simula-se aqui uma tentativa de um cliente
      // malicioso/descuidado de injetar um valor arbitrário para dataRegistro
      // através de um argumento extra (via `any`), provando que ele é
      // ignorado e o clock injetado prevalece.
      const dataFornecidaPeloCliente = new Date('1970-01-01T00:00:00.000Z');
      const registrarAcordoComArgumentoExtra = service.registrarAcordo.bind(service) as (
        taskId: string,
        tipoAcordoId: string,
        responsavelId?: string | null,
        dataRegistro?: Date,
      ) => Promise<Acordo>;

      const acordo = await registrarAcordoComArgumentoExtra(
        taskNova.id,
        tipoAcordoId,
        undefined,
        dataFornecidaPeloCliente,
      );

      expect(acordo.dataRegistro).toEqual(dataDoClock);
      expect(acordo.dataRegistro).not.toEqual(dataFornecidaPeloCliente);
    });
  });
});

// Unit and property tests for the "Avaliar e planejar" consecutive-cycle
// counter (`Task.tentativasAvaliarPlanejar`): incremented when an Acordo
// "Avaliar e planejar" evaluated as cumprido is immediately followed by
// registering another Acordo "Avaliar e planejar" for the same Task —
// mirroring how `numTentativas` is incremented on não cumprimento, but
// WITHOUT marking a não-cumprido alert, since the Acordo in question was
// cumprido. `ListaDeAcordosService` (tested separately) is responsible
// for turning this counter into a distinct "alto número de tentativas"
// alert once it reaches the configured threshold.
describe('AcordoService.registrarAcordo — cadeia de "Avaliar e planejar" consecutivos', () => {
  const NOME_AVALIAR_E_PLANEJAR = 'Avaliar e planejar';

  async function montarCenarioComTipos(nomesPorId: Record<string, string>) {
    const taskRepository = new InMemoryTaskRepository();
    const acordoRepository = new InMemoryAcordoRepository();
    const tipoAcordoRepository = new InMemoryTipoAcordoLookup(
      Object.entries(nomesPorId).map(([id, nome]) => ({ id, nome })),
    );
    const usuarioCadastradoRepository = new InMemoryCadastroLookup();

    const service = construirAcordoServicoDeTeste(
      taskRepository as unknown as TaskRepository,
      acordoRepository as unknown as AcordoRepository,
      tipoAcordoRepository,
      usuarioCadastradoRepository,
    );

    const taskNova = await criarTaskNova(taskRepository, 'Task de teste');

    return { service, taskRepository, acordoRepository, taskId: taskNova.id };
  }

  it('incrementa tentativasAvaliarPlanejar quando um Acordo "Avaliar e planejar" cumprido é seguido por outro "Avaliar e planejar"', async () => {
    const idAvaliarPlanejar = randomUUID();
    const { service, taskRepository, taskId } = await montarCenarioComTipos({
      [idAvaliarPlanejar]: NOME_AVALIAR_E_PLANEJAR,
    });

    const primeiroAcordo = await service.registrarAcordo(taskId, idAvaliarPlanejar);
    await service.avaliarAcordoAtual(taskId, 'cumprido');

    const taskAntes = await taskRepository.findById(taskId);
    expect(taskAntes!.tentativasAvaliarPlanejar).toBe(0);

    await service.registrarAcordo(taskId, idAvaliarPlanejar);

    const taskDepois = await taskRepository.findById(taskId);
    expect(taskDepois!.tentativasAvaliarPlanejar).toBe(1);

    // este incremento não deve ser confundido com um Acordo não cumprido:
    // o Acordo anterior foi avaliado como cumprido, e numTentativas não é afetado.
    expect(taskDepois!.numTentativas).toBe(0);

    // o Acordo anterior permanece preservado no histórico
    expect(taskDepois!.acordoAtualId).not.toBe(primeiroAcordo.id);
  });

  it('acumula o contador ao longo de vários ciclos consecutivos de "Avaliar e planejar" cumprido', async () => {
    const idAvaliarPlanejar = randomUUID();
    const { service, taskRepository, taskId } = await montarCenarioComTipos({
      [idAvaliarPlanejar]: NOME_AVALIAR_E_PLANEJAR,
    });

    await service.registrarAcordo(taskId, idAvaliarPlanejar);

    for (let i = 1; i <= 3; i += 1) {
      await service.avaliarAcordoAtual(taskId, 'cumprido');
      await service.registrarAcordo(taskId, idAvaliarPlanejar);

      const task = await taskRepository.findById(taskId);
      expect(task!.tentativasAvaliarPlanejar).toBe(i);
    }
  });

  it('reinicia o contador quando o próximo Acordo é de um Tipo_de_Acordo diferente', async () => {
    const idAvaliarPlanejar = randomUUID();
    const idOutroTipo = randomUUID();
    const { service, taskRepository, taskId } = await montarCenarioComTipos({
      [idAvaliarPlanejar]: NOME_AVALIAR_E_PLANEJAR,
      [idOutroTipo]: 'Enviar para review',
    });

    await service.registrarAcordo(taskId, idAvaliarPlanejar);
    await service.avaliarAcordoAtual(taskId, 'cumprido');
    await service.registrarAcordo(taskId, idAvaliarPlanejar);

    const taskComUmaTentativa = await taskRepository.findById(taskId);
    expect(taskComUmaTentativa!.tentativasAvaliarPlanejar).toBe(1);

    await service.avaliarAcordoAtual(taskId, 'cumprido');
    await service.registrarAcordo(taskId, idOutroTipo);

    const taskDepois = await taskRepository.findById(taskId);
    expect(taskDepois!.tentativasAvaliarPlanejar).toBe(0);
  });

  it('bloqueia a avaliação como não cumprido do Acordo_Atual "Avaliar e planejar" e preserva o contador da cadeia (Requirement 5.2)', async () => {
    const idAvaliarPlanejar = randomUUID();
    const { service, taskRepository, taskId } = await montarCenarioComTipos({
      [idAvaliarPlanejar]: NOME_AVALIAR_E_PLANEJAR,
    });

    await service.registrarAcordo(taskId, idAvaliarPlanejar);
    await service.avaliarAcordoAtual(taskId, 'cumprido');
    await service.registrarAcordo(taskId, idAvaliarPlanejar);

    const taskComUmaTentativa = await taskRepository.findById(taskId);
    expect(taskComUmaTentativa!.tentativasAvaliarPlanejar).toBe(1);

    // "Avaliar e planejar" nunca é avaliado como não cumprido (Requirement
    // 5.2): a tentativa é rejeitada antes de qualquer escrita, e a cadeia
    // de tentativasAvaliarPlanejar permanece exatamente como estava.
    let erroCapturado: unknown;
    try {
      await service.avaliarAcordoAtual(taskId, 'nao_cumprido');
    } catch (erro) {
      erroCapturado = erro;
    }

    expect(erroCapturado).toBeInstanceOf(ConflictError);
    expect((erroCapturado as ConflictError).codigo).toBe(
      'ACORDO_AVALIAR_PLANEJAR_NAO_CUMPRIMENTO_BLOQUEADO',
    );

    const taskDepois = await taskRepository.findById(taskId);
    expect(taskDepois!.tentativasAvaliarPlanejar).toBe(1);
    // a rejeição não afeta numTentativas, que só é incrementado em um
    // não cumprimento efetivamente processado
    expect(taskDepois!.numTentativas).toBe(0);
  });

  it('não incrementa no primeiro Acordo de uma Task_Nova (sem Acordo_Atual anterior)', async () => {
    const idAvaliarPlanejar = randomUUID();
    const { service, taskRepository, taskId } = await montarCenarioComTipos({
      [idAvaliarPlanejar]: NOME_AVALIAR_E_PLANEJAR,
    });

    await service.registrarAcordo(taskId, idAvaliarPlanejar);

    const task = await taskRepository.findById(taskId);
    expect(task!.tentativasAvaliarPlanejar).toBe(0);
  });

  // Property: tentativasAvaliarPlanejar reflete exatamente o tamanho da
  // cadeia de ciclos consecutivos "Avaliar e planejar cumprido -> outro
  // Avaliar e planejar" em curso, reiniciando sempre que o Acordo_Atual
  // anterior não era "Avaliar e planejar" cumprido, ou o novo Acordo
  // registrado não é "Avaliar e planejar".
  //
  // Cada ciclo escolhe (a) se o tipo anterior avaliado era "Avaliar e
  // planejar" ou outro tipo, (b) o resultado dessa avaliação, e (c) se o
  // próximo Acordo registrado é "Avaliar e planejar" ou outro tipo — o
  // modelo de referência recalcula, a cada passo, se a condição de
  // incremento é satisfeita a partir do estado anterior conhecido pelo
  // teste (nunca inspecionando o serviço), e compara com o valor
  // persistido pelo serviço após o passo.
  it('Property: tentativasAvaliarPlanejar reflete o tamanho da cadeia atual de ciclos consecutivos cumpridos', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'avaliarPlanejar' | 'outro'>('avaliarPlanejar', 'outro'),
        fc.array(
          fc.record({
            resultado: fc.constantFrom<'cumprido' | 'nao_cumprido'>('cumprido', 'nao_cumprido'),
            proximoTipo: fc.constantFrom<'avaliarPlanejar' | 'outro'>('avaliarPlanejar', 'outro'),
          }),
          { minLength: 1, maxLength: 15 },
        ),
        async (tipoInicial, ciclos) => {
          const idAvaliarPlanejar = randomUUID();
          const idOutroTipo = randomUUID();
          const idPorTag = { avaliarPlanejar: idAvaliarPlanejar, outro: idOutroTipo } as const;

          const { service, taskRepository, taskId } = await montarCenarioComTipos({
            [idAvaliarPlanejar]: NOME_AVALIAR_E_PLANEJAR,
            [idOutroTipo]: 'Enviar para review',
          });

          // primeiro Acordo, do tipo escolhido, sem Acordo_Atual anterior —
          // nunca incrementa o contador (Task_Nova).
          await service.registrarAcordo(taskId, idPorTag[tipoInicial]);

          let tipoAtual: 'avaliarPlanejar' | 'outro' = tipoInicial;
          let contadorEsperado = 0;

          for (const ciclo of ciclos) {
            // "Avaliar e planejar" nunca é avaliado como não cumprido
            // (Requirement 5.2): a operação é rejeitada antes de qualquer
            // escrita, o contador permanece inalterado, e a sequência para
            // aqui — não há um novo Acordo_Atual para continuar o ciclo.
            if (tipoAtual === 'avaliarPlanejar' && ciclo.resultado === 'nao_cumprido') {
              await expect(service.avaliarAcordoAtual(taskId, ciclo.resultado)).rejects.toThrow(
                ConflictError,
              );

              const task = await taskRepository.findById(taskId);
              expect(task!.tentativasAvaliarPlanejar).toBe(contadorEsperado);
              return;
            }

            await service.avaliarAcordoAtual(taskId, ciclo.resultado);

            const incrementaEsperado =
              tipoAtual === 'avaliarPlanejar' &&
              ciclo.resultado === 'cumprido' &&
              ciclo.proximoTipo === 'avaliarPlanejar';

            await service.registrarAcordo(taskId, idPorTag[ciclo.proximoTipo]);

            contadorEsperado = incrementaEsperado ? contadorEsperado + 1 : 0;

            const task = await taskRepository.findById(taskId);
            expect(task!.tentativasAvaliarPlanejar).toBe(contadorEsperado);

            tipoAtual = ciclo.proximoTipo;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('AcordoService.avaliarAcordoAtual', () => {
  // Property 14: Avaliação preserva o Acordo_Atual até substituição
  // Validates: Requirements 4.1, 4.2, 8.3
  it('Feature: daily-agreements, Property 14: Avaliação preserva o Acordo_Atual até substituição', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.uuid(),
        fc.constantFrom<'cumprido' | 'nao_cumprido'>('cumprido', 'nao_cumprido'),
        async (titulo, tipoAcordoId, resultado) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const tipoAcordoRepository = new InMemoryCadastroLookup([tipoAcordoId]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          // Task_Nova recebe seu primeiro Acordo, tornando-se Task_Com_Acordo.
          const taskNova = await criarTaskNova(taskRepository, titulo);
          const acordoAtual = await service.registrarAcordo(taskNova.id, tipoAcordoId);

          const taskAntes = await taskRepository.findById(taskNova.id);
          expect(taskAntes!.acordoAtualId).toBe(acordoAtual.id);

          // avalia o Acordo_Atual como cumprido ou como não cumprido
          // (resultado arbitrário, sem informar motivo)
          const acordoAvaliado = await service.avaliarAcordoAtual(taskNova.id, resultado);

          // a avaliação alterou apenas o estadoCumprimento desse mesmo Acordo,
          // sem criar/substituir Acordo alguma
          expect(acordoAvaliado.id).toBe(acordoAtual.id);
          expect(acordoAvaliado.estadoCumprimento).toBe(resultado);

          // o Acordo avaliado permanece o Acordo_Atual da Task até que um novo
          // Acordo seja explicitamente registrado (Requirements 4.1, 4.2, 8.3)
          const taskDepois = await taskRepository.findById(taskNova.id);
          expect(taskDepois!.acordoAtualId).toBe(acordoAtual.id);

          // o estado persistido do Acordo reflete a avaliação
          const acordoPersistido = await acordoRepository.findById(acordoAtual.id);
          expect(acordoPersistido!.id).toBe(acordoAtual.id);
          expect(acordoPersistido!.estadoCumprimento).toBe(resultado);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 15: Nº_Tentativas só incrementa em não cumprido
  // Validates: Requirements 4.3, 4.4
  //
  // Exercises an arbitrary sequence of evaluations of a Task_Com_Acordo's
  // Acordo_Atual. Between evaluations, a new next Acordo is registered
  // (via `registrarAcordo`, reusing the same Tipo_de_Acordo — its identity
  // is irrelevant to this property) so a fresh Acordo_Atual is available
  // to evaluate again, mirroring the real "avaliar -> próximo Acordo"
  // cycle described by Requirements 5.1-5.3. After each evaluation,
  // `numTentativas` must increment by exactly 1 when the result is
  // 'nao_cumprido' (Requirement 4.3) and remain exactly unchanged when the
  // result is 'cumprido' (Requirement 4.4); by the end of the sequence,
  // the total must match the number of 'nao_cumprido' results.
  it('Feature: daily-agreements, Property 15: Nº_Tentativas só incrementa em não cumprido', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.uuid(),
        fc.array(fc.constantFrom<'cumprido' | 'nao_cumprido'>('cumprido', 'nao_cumprido'), {
          minLength: 1,
          maxLength: 20,
        }),
        async (titulo, tipoAcordoId, resultados) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const tipoAcordoRepository = new InMemoryCadastroLookup([tipoAcordoId]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          // Task_Nova recebe seu primeiro Acordo, tornando-se Task_Com_Acordo.
          const taskNova = await criarTaskNova(taskRepository, titulo);
          await service.registrarAcordo(taskNova.id, tipoAcordoId);

          const taskInicial = await taskRepository.findById(taskNova.id);
          expect(taskInicial!.numTentativas).toBe(0);

          let numTentativasEsperado = 0;

          for (let i = 0; i < resultados.length; i += 1) {
            const resultado = resultados[i]!;

            const taskAntes = await taskRepository.findById(taskNova.id);
            const numTentativasAntes = taskAntes!.numTentativas;

            await service.avaliarAcordoAtual(taskNova.id, resultado);

            const taskDepois = await taskRepository.findById(taskNova.id);

            if (resultado === 'nao_cumprido') {
              // incrementa em exatamente 1 a cada avaliação como não cumprido
              numTentativasEsperado += 1;
              expect(taskDepois!.numTentativas).toBe(numTentativasAntes + 1);
            } else {
              // permanece inalterado em qualquer avaliação como cumprido
              expect(taskDepois!.numTentativas).toBe(numTentativasAntes);
            }

            expect(taskDepois!.numTentativas).toBe(numTentativasEsperado);

            // registra um novo Acordo (próximo ciclo), disponibilizando um novo
            // Acordo_Atual para a próxima avaliação da sequência
            if (i < resultados.length - 1) {
              await service.registrarAcordo(taskNova.id, tipoAcordoId);
            }
          }

          // o total final corresponde exatamente ao número de resultados
          // 'nao_cumprido' na sequência avaliada
          const totalNaoCumpridos = resultados.filter((r) => r === 'nao_cumprido').length;
          const taskFinal = await taskRepository.findById(taskNova.id);
          expect(taskFinal!.numTentativas).toBe(totalNaoCumpridos);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 16: Tratamento do Motivo de não cumprimento
  // Validates: Requirements 4.5, 4.6, 4.7
  //
  // Exercises the three mutually exclusive branches of Requirements
  // 4.5-4.7 for a single `avaliarAcordoAtual(taskId, 'nao_cumprido', ...)`
  // call, picking which branch to run per property iteration via
  // `fc.constantFrom`:
  // - 'valido': a motivoId that belongs to the
  //   Cadastro_de_Motivos_de_Nao_Cumprimento is informed -> it must be
  //   associated with the Acordo (Requirement 4.5).
  // - 'nenhum': no motivoId is informed -> the Acordo must be registered
  //   as não cumprido with no motivo associated (Requirement 4.6).
  // - 'invalido': a motivoId that does not belong to the cadastro is
  //   informed -> the association must be rejected (`ValidationError`,
  //   Requirement 4.7), and — per acordoService.ts, this validation
  //   happens before any write — the evaluation already registered for
  //   the Acordo (whatever it was before this call: still `pendente` if
  //   this is the first evaluation, or an already-evaluated
  //   `nao_cumprido` state from a prior call otherwise) must be preserved
  //   exactly, along with the Task's `numTentativas`.
  //
  // `jaAvaliadoAntes` additionally randomizes whether the Acordo_Atual
  // arrives at the tested call already evaluated as não cumprido once
  // before (with or without a motivo of its own), so the 'invalido'
  // branch's preservation check covers both "nothing registered yet" and
  // "an evaluation already registered" starting states, matching
  // Requirement 4.7's "avaliação de não cumprimento já registrada deve
  // ser preservada".
  it('Feature: daily-agreements, Property 16: Tratamento do Motivo de não cumprimento', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.uuid(),
        fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom<'valido' | 'nenhum' | 'invalido'>('valido', 'nenhum', 'invalido'),
        async (
          titulo,
          tipoAcordoId,
          [motivoIdValido, motivoIdInvalido],
          jaAvaliadoAntes,
          comMotivoAntes,
          branch,
        ) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const tipoAcordoRepository = new InMemoryCadastroLookup([tipoAcordoId]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();
          // Cadastro_de_Motivos_de_Nao_Cumprimento contém apenas motivoIdValido;
          // motivoIdInvalido nunca pertence a ele.
          const motivoNaoCumprimentoRepository = new InMemoryCadastroLookup([motivoIdValido]);

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
            undefined,
            motivoNaoCumprimentoRepository,
          );

          // Task_Nova recebe seu primeiro Acordo, tornando-se Task_Com_Acordo.
          const taskNova = await criarTaskNova(taskRepository, titulo);
          const acordoAtual = await service.registrarAcordo(taskNova.id, tipoAcordoId);

          // opcionalmente, a avaliação de não cumprimento já foi registrada uma
          // vez antes (com ou sem motivo), para verificar que a preservação do
          // branch 'invalido' cobre também esse estado inicial já avaliado.
          if (jaAvaliadoAntes) {
            await service.avaliarAcordoAtual(
              taskNova.id,
              'nao_cumprido',
              comMotivoAntes ? motivoIdValido : undefined,
            );
          }

          const acordoAntes = await acordoRepository.findById(acordoAtual.id);
          const taskAntes = await taskRepository.findById(taskNova.id);
          const estadoCumprimentoAntes = acordoAntes!.estadoCumprimento;
          const motivoNaoCumprimentoIdAntes = acordoAntes!.motivoNaoCumprimentoId;
          const numTentativasAntes = taskAntes!.numTentativas;

          if (branch === 'valido') {
            const acordoAvaliado = await service.avaliarAcordoAtual(
              taskNova.id,
              'nao_cumprido',
              motivoIdValido,
            );

            // o motivo informado (pertencente ao cadastro) é associado ao Acordo
            // (Requirement 4.5)
            expect(acordoAvaliado.estadoCumprimento).toBe('nao_cumprido');
            expect(acordoAvaliado.motivoNaoCumprimentoId).toBe(motivoIdValido);

            const acordoPersistido = await acordoRepository.findById(acordoAtual.id);
            expect(acordoPersistido!.motivoNaoCumprimentoId).toBe(motivoIdValido);

            // o Acordo permanece o Acordo_Atual, e Nº_Tentativas incrementa em 1
            const taskDepois = await taskRepository.findById(taskNova.id);
            expect(taskDepois!.acordoAtualId).toBe(acordoAtual.id);
            expect(taskDepois!.numTentativas).toBe(numTentativasAntes + 1);
          } else if (branch === 'nenhum') {
            const acordoAvaliado = await service.avaliarAcordoAtual(taskNova.id, 'nao_cumprido');

            // nenhum motivo foi informado -> o Acordo é registrado como não
            // cumprido sem motivo associado (Requirement 4.6)
            expect(acordoAvaliado.estadoCumprimento).toBe('nao_cumprido');
            expect(acordoAvaliado.motivoNaoCumprimentoId).toBeFalsy();

            const acordoPersistido = await acordoRepository.findById(acordoAtual.id);
            expect(acordoPersistido!.motivoNaoCumprimentoId).toBeFalsy();

            const taskDepois = await taskRepository.findById(taskNova.id);
            expect(taskDepois!.acordoAtualId).toBe(acordoAtual.id);
            expect(taskDepois!.numTentativas).toBe(numTentativasAntes + 1);
          } else {
            // motivoIdInvalido não pertence ao Cadastro_de_Motivos_de_Nao_Cumprimento
            await expect(
              service.avaliarAcordoAtual(taskNova.id, 'nao_cumprido', motivoIdInvalido),
            ).rejects.toThrow(ValidationError);

            // a associação é rejeitada, mas a avaliação já registrada para o
            // Acordo (pendente, se ainda não avaliado, ou não cumprido de uma
            // chamada anterior) é preservada integralmente (Requirement 4.7)
            const acordoDepois = await acordoRepository.findById(acordoAtual.id);
            expect(acordoDepois!.estadoCumprimento).toBe(estadoCumprimentoAntes);
            expect(acordoDepois!.motivoNaoCumprimentoId).toBe(motivoNaoCumprimentoIdAntes);

            // Nº_Tentativas também permanece inalterado
            const taskDepois = await taskRepository.findById(taskNova.id);
            expect(taskDepois!.numTentativas).toBe(numTentativasAntes);
            expect(taskDepois!.acordoAtualId).toBe(acordoAtual.id);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 17: Avaliação sem Acordo_Atual é rejeitada
  // Validates: Requirements 4.8
  //
  // Exercises a Task_Nova — one for which no Acordo has ever been
  // registered (`acordoAtualId` is falsy) — against an arbitrary
  // evaluation attempt (either resultado, with or without a motivoId,
  // whose value/validity is irrelevant here since acordoService.ts checks
  // for the absence of an Acordo_Atual before any motivo validation).
  // Every such attempt must be rejected with a `ConflictError`
  // (Requirement 4.8, classified as a state conflict per design.md "Error
  // Handling"), and the Task's state — `acordoAtualId`, `numTentativas`,
  // and every other field — must remain fully unchanged, since the
  // rejection happens before any write.
  it('Feature: daily-agreements, Property 17: Avaliação sem Acordo_Atual é rejeitada', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.constantFrom<'cumprido' | 'nao_cumprido'>('cumprido', 'nao_cumprido'),
        fc.option(fc.uuid(), { nil: undefined }),
        async (titulo, resultado, motivoId) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const tipoAcordoRepository = new InMemoryCadastroLookup();
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          // Task_Nova: nenhum Acordo jamais foi registrado para ela.
          const taskNova = await criarTaskNova(taskRepository, titulo);
          expect(taskNova.acordoAtualId).toBeFalsy();

          const taskAntes = await taskRepository.findById(taskNova.id);

          // qualquer tentativa de avaliar cumprimento deve ser rejeitada
          await expect(service.avaliarAcordoAtual(taskNova.id, resultado, motivoId)).rejects.toThrow(
            ConflictError,
          );

          // o estado da Task permanece inteiramente inalterado
          const taskDepois = await taskRepository.findById(taskNova.id);
          expect(taskDepois).toEqual(taskAntes);
          expect(taskDepois!.acordoAtualId).toBeFalsy();
          expect(taskDepois!.numTentativas).toBe(taskAntes!.numTentativas);

          // nenhum Acordo foi persistido para a Task
          const historico = await acordoRepository.findHistoryByTaskId(taskNova.id);
          expect(historico).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Unit tests (task 9.6): logical removal by completion of a "Finalizar"
  // Acordo (Requirements 6.1, 6.2, 6.3). Property-based coverage for this
  // behavior (Property 21) is implemented separately by task 9.7 — these
  // are concrete examples exercising the marking of `Task.concluida`
  // itself (and its absence for the cases that must NOT trigger it),
  // ahead of that property test.
  describe('remoção lógica por conclusão do Acordo "Finalizar"', () => {
    it('marca Task.concluida = true quando o Acordo_Atual "Finalizar" é avaliado como cumprido (Requirement 6.1)', async () => {
      const taskRepository = new InMemoryTaskRepository();
      const acordoRepository = new InMemoryAcordoRepository();
      const tipoAcordoIdFinalizar = randomUUID();
      const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
        { id: tipoAcordoIdFinalizar, nome: 'Finalizar' },
      ]);
      const usuarioCadastradoRepository = new InMemoryCadastroLookup();

      const service = construirAcordoServicoDeTeste(
        taskRepository as unknown as TaskRepository,
        acordoRepository as unknown as AcordoRepository,
        tipoAcordoRepository,
        usuarioCadastradoRepository,
      );

      const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
      const acordoAtual = await service.registrarAcordo(taskNova.id, tipoAcordoIdFinalizar);

      await service.avaliarAcordoAtual(taskNova.id, 'cumprido');

      const taskDepois = await taskRepository.findById(taskNova.id);
      expect(taskDepois!.concluida).toBe(true);

      // a Task e seu histórico permanecem armazenados e consultáveis (Requirements 6.2, 6.3)
      expect(taskDepois!.id).toBe(taskNova.id);
      const historico = await acordoRepository.findHistoryByTaskId(taskNova.id);
      expect(historico).toHaveLength(1);
      expect(historico[0]!.id).toBe(acordoAtual.id);
      expect(historico[0]!.estadoCumprimento).toBe('cumprido');
    });

    it('não marca Task.concluida quando um Acordo "Finalizar" é avaliado como não cumprido', async () => {
      const taskRepository = new InMemoryTaskRepository();
      const acordoRepository = new InMemoryAcordoRepository();
      const tipoAcordoIdFinalizar = randomUUID();
      const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
        { id: tipoAcordoIdFinalizar, nome: 'Finalizar' },
      ]);
      const usuarioCadastradoRepository = new InMemoryCadastroLookup();

      const service = construirAcordoServicoDeTeste(
        taskRepository as unknown as TaskRepository,
        acordoRepository as unknown as AcordoRepository,
        tipoAcordoRepository,
        usuarioCadastradoRepository,
      );

      const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
      await service.registrarAcordo(taskNova.id, tipoAcordoIdFinalizar);

      await service.avaliarAcordoAtual(taskNova.id, 'nao_cumprido');

      const taskDepois = await taskRepository.findById(taskNova.id);
      expect(taskDepois!.concluida).toBe(false);
    });

    it('não marca Task.concluida quando um Acordo de outro Tipo_de_Acordo é avaliado como cumprido', async () => {
      const taskRepository = new InMemoryTaskRepository();
      const acordoRepository = new InMemoryAcordoRepository();
      const tipoAcordoIdOutro = randomUUID();
      const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
        { id: tipoAcordoIdOutro, nome: 'Enviar para review' },
      ]);
      const usuarioCadastradoRepository = new InMemoryCadastroLookup();

      const service = construirAcordoServicoDeTeste(
        taskRepository as unknown as TaskRepository,
        acordoRepository as unknown as AcordoRepository,
        tipoAcordoRepository,
        usuarioCadastradoRepository,
      );

      const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
      await service.registrarAcordo(taskNova.id, tipoAcordoIdOutro);

      await service.avaliarAcordoAtual(taskNova.id, 'cumprido');

      const taskDepois = await taskRepository.findById(taskNova.id);
      expect(taskDepois!.concluida).toBe(false);
    });

    it('não marca Task.concluida quando o nome do Tipo_de_Acordo difere de "Finalizar" apenas em caixa (comparação sensível a maiúsculas/minúsculas)', async () => {
      const taskRepository = new InMemoryTaskRepository();
      const acordoRepository = new InMemoryAcordoRepository();
      const tipoAcordoIdVariante = randomUUID();
      const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
        { id: tipoAcordoIdVariante, nome: 'finalizar' },
      ]);
      const usuarioCadastradoRepository = new InMemoryCadastroLookup();

      const service = construirAcordoServicoDeTeste(
        taskRepository as unknown as TaskRepository,
        acordoRepository as unknown as AcordoRepository,
        tipoAcordoRepository,
        usuarioCadastradoRepository,
      );

      const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
      await service.registrarAcordo(taskNova.id, tipoAcordoIdVariante);

      await service.avaliarAcordoAtual(taskNova.id, 'cumprido');

      const taskDepois = await taskRepository.findById(taskNova.id);
      expect(taskDepois!.concluida).toBe(false);
    });
  });

  // Property 21: "Finalizar" cumprido remove permanentemente da lista preservando histórico
  // Validates: Requirements 6.1, 6.2, 6.3
  //
  // ListaDeAcordosService does not exist yet (task 15). This property
  // therefore exercises what is testable today: `Task.concluida` and its
  // effect on `TaskRepository.listActive()` — the "active tasks" listing
  // that will back the Lista_de_Acordos — while confirming the Task and
  // its full Acordo history remain queryable via `findById` and
  // `findHistoryByTaskId` (Requirements 6.2, 6.3). "Multiple subsequent
  // presentations of the Lista_de_Acordos" are simulated by calling
  // `listActive()` several times and asserting exclusion holds every
  // time (Requirement 6.1).
  //
  // The Tipo_de_Acordo `nome` is generated so it is exactly "Finalizar"
  // in roughly half of runs and an arbitrary different string otherwise,
  // covering both the positive case (must be excluded) and the negative
  // case (must remain listed) in the same property.
  it('Feature: daily-agreements, Property 21: "Finalizar" cumprido remove permanentemente da lista preservando histórico', async () => {
    const NOME_TIPO_ACORDO_FINALIZAR = 'Finalizar';

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.uuid(),
        fc.boolean(),
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s !== NOME_TIPO_ACORDO_FINALIZAR),
        fc.nat({ max: 10 }),
        async (titulo, tipoAcordoId, ehFinalizar, nomeOutroTipo, numApresentacoes) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const nomeTipoAcordo = ehFinalizar ? NOME_TIPO_ACORDO_FINALIZAR : nomeOutroTipo;
          const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
            { id: tipoAcordoId, nome: nomeTipoAcordo },
          ]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          const taskNova = await criarTaskNova(taskRepository, titulo);
          const acordoAtual = await service.registrarAcordo(taskNova.id, tipoAcordoId);

          // pré-condição: antes da avaliação, a Task aparece na listagem ativa
          const listaAntes = await taskRepository.listActive();
          expect(listaAntes.some((t) => t.id === taskNova.id)).toBe(true);

          await service.avaliarAcordoAtual(taskNova.id, 'cumprido');

          // a Task e seu histórico completo de Acordo permanecem consultáveis,
          // independentemente do Tipo_de_Acordo ser "Finalizar" ou não
          // (Requirements 6.2, 6.3)
          const taskConsultada = await taskRepository.findById(taskNova.id);
          expect(taskConsultada).not.toBeNull();
          expect(taskConsultada!.id).toBe(taskNova.id);

          const historico = await acordoRepository.findHistoryByTaskId(taskNova.id);
          expect(historico.length).toBeGreaterThan(0);
          expect(historico.some((a) => a.id === acordoAtual.id && a.estadoCumprimento === 'cumprido')).toBe(
            true,
          );

          if (ehFinalizar) {
            // um Acordo "Finalizar" cumprido remove a Task permanentemente da
            // lista: em qualquer apresentação subsequente da Lista_de_Acordos
            // (múltiplas leituras de listActive()), a Task não deve aparecer
            // em nenhum grupo (Requirement 6.1)
            expect(taskConsultada!.concluida).toBe(true);

            for (let i = 0; i < numApresentacoes + 1; i += 1) {
              const listaDepois = await taskRepository.listActive();
              expect(listaDepois.some((t) => t.id === taskNova.id)).toBe(false);
            }
          } else {
            // um Acordo cumprido de qualquer outro Tipo_de_Acordo não
            // dispara a remoção lógica: a Task permanece ativa em qualquer
            // apresentação subsequente
            expect(taskConsultada!.concluida).toBe(false);

            for (let i = 0; i < numApresentacoes + 1; i += 1) {
              const listaDepois = await taskRepository.listActive();
              expect(listaDepois.some((t) => t.id === taskNova.id)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 6: Resolução do motivo e idempotência da criação inline
  // Validates: Requirements 3.3, 3.4, 3.5, 3.6, 10.7
  //
  // Exercises `avaliarAcordoAtual(taskId, 'nao_cumprido', { motivoNome })`
  // — the only public entrypoint that reaches the private `resolverMotivo`
  // (task 2.1) — against the four mutually exclusive outcomes defined by
  // Requirements 3.3-3.6. `resolverMotivo`'s case-insensitive match is a
  // plain `.toLowerCase()` comparison (see cadastroRepository.ts's
  // `findByNomeCaseInsensitive`): it folds letter case (including
  // accented letters, e.g. 'Á'.toLowerCase() === 'á') but does NOT treat
  // different base letters (accented vs. unaccented) as equivalent — so
  // "accented variants" here means the generated names may contain
  // accented characters as literal content, matched by re-casing that
  // same exact text, not by swapping in different diacritics.
  // - 'vazio': `motivoNome` trims to 0 characters (including a
  //   whitespace-only string, or the field omitted entirely) -> no motivo
  //   is associated (`null`) and the Cadastro_de_Motivos_de_Nao_Cumprimento
  //   is left with the exact same values (Requirement 3.6).
  // - 'novo': a genuinely new `motivoNome`, 1-100 characters after trim,
  //   that does not match (case-insensitively) any value already in the
  //   cadastro -> exactly 1 new value is created with the trimmed text,
  //   and its id is associated to the Acordo_Atual (Requirement 3.4).
  // - 'existente': a `motivoNome` that matches, case-insensitively, one
  //   already-cadastrado value — rendered with mixed case over the exact
  //   same (possibly accented) characters -> the existing id is used, and
  //   the cadastro's count and texts stay unchanged (Requirement 3.5).
  // - 'idempotencia': the exact same new name is confirmed twice in a row
  //   for two distinct Tasks sharing the same starting cadastro -> the
  //   second confirmation never creates a duplicate cadastro entry
  //   (Requirement 10.7).
  //
  // `cadastroInicial` varies between empty and non-empty across runs
  // (including the empty case, Requirement 3.2's "cadastro vazio"), and
  // the name generators cover the 1 and 100 character boundaries (the 0
  // character boundary is covered by the 'vazio' branch) plus surrounding
  // whitespace and mixed case.
  it('Feature: melhorias-acordos, Property 6: Resolução do motivo e idempotência da criação inline', async () => {
    /** A non-whitespace character, safe for building names whose length survives trim(). */
    const charNaoEspacoArb = fc.char().filter((c) => c.trim().length > 0);

    /** A name whose trim() has exactly 1 character. */
    const nomeUmCaractereArb = charNaoEspacoArb;

    /** A name whose trim() has exactly 100 characters (the upper boundary). */
    const nomeCemCaracteresArb = fc
      .array(charNaoEspacoArb, { minLength: 100, maxLength: 100 })
      .map((chars) => chars.join(''));

    /** A name whose trim() has between 2 and 99 characters. */
    const nomeMeioArb = fc
      .array(charNaoEspacoArb, { minLength: 2, maxLength: 99 })
      .map((chars) => chars.join(''));

    /** A new motivo name (1-100 characters after trim), covering the length boundaries. */
    const nomeNovoArb = fc.oneof(nomeUmCaractereArb, nomeCemCaracteresArb, nomeMeioArb);

    /** Any whitespace-only (space/tab/newline) string: trim() results in an empty string, or absence of the field. */
    const motivoVazioArb = fc.oneof(
      fc.constant(undefined),
      fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { maxLength: 10 }),
    );

    /** Optional leading/trailing whitespace, trimmed away before comparison/storage. */
    const espacosOpcionaisArb = fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { maxLength: 5 });

    /** A short name built from a pt-BR-flavored pool including accented letters, used by the 'existente' branch. */
    const palavraComAcentoArb = fc
      .array(
        fc.constantFrom('a', 'á', 'à', 'â', 'ã', 'e', 'é', 'ê', 'i', 'í', 'o', 'ó', 'õ', 'u', 'ú', 'c', 'ç'),
        { minLength: 1, maxLength: 15 },
      )
      .map((letras) => letras.join(''));

    /** Enough independent booleans to re-case any generated name (max length used above is 100). */
    const casingBitsArb = fc.array(fc.boolean(), { minLength: 100, maxLength: 100 });

    /** Re-cases each character of `texto` per `bits[i]` (true -> uppercase, false -> lowercase); non-letters are unaffected by (to/from)UpperCase. */
    function aplicarCasing(texto: string, bits: boolean[]): string {
      return texto
        .split('')
        .map((char, i) => (bits[i] ? char.toUpperCase() : char.toLowerCase()))
        .join('');
    }

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.uuid(),
        // cadastro inicial: 0 a 4 valores distintos já cadastrados (Requirement 3.2's "cadastro vazio" quando o array é []).
        fc.array(nomeMeioArb, { minLength: 0, maxLength: 4 }),
        fc.constantFrom<'vazio' | 'novo' | 'existente' | 'idempotencia'>(
          'vazio',
          'novo',
          'existente',
          'idempotencia',
        ),
        motivoVazioArb,
        nomeNovoArb,
        espacosOpcionaisArb,
        espacosOpcionaisArb,
        palavraComAcentoArb,
        casingBitsArb,
        casingBitsArb,
        async (
          titulo,
          tipoAcordoId,
          outrosValoresCadastrados,
          branch,
          nomeVazio,
          nomeNovo,
          espacosAntes,
          espacosDepois,
          palavraAcentuada,
          casingBits1,
          casingBits2,
        ) => {
          // Cadastro inicial deduplicado (case-insensitive), para que a
          // contagem de valores seja previsível.
          const cadastroInicialUnico: string[] = [];
          for (const valor of outrosValoresCadastrados) {
            if (!cadastroInicialUnico.some((v) => v.toLowerCase() === valor.toLowerCase())) {
              cadastroInicialUnico.push(valor);
            }
          }

          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const tipoAcordoRepository = new InMemoryCadastroLookup([tipoAcordoId]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();
          const motivoNaoCumprimentoRepository = new InMemoryMotivoRepository(cadastroInicialUnico);

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
            undefined,
            motivoNaoCumprimentoRepository,
          );

          /** Builds a fresh Task_Com_Acordo (Acordo_Atual pendente) ready to be evaluated as não cumprido. */
          async function criarTaskComAcordoPendente(): Promise<Task> {
            const task = await criarTaskNova(taskRepository, titulo);
            const acordo = await service.registrarAcordo(task.id, tipoAcordoId);
            expect(acordo.estadoCumprimento).toBe('pendente');
            return task;
          }

          const cadastroAntes = await motivoNaoCumprimentoRepository.list();
          const quantidadeAntes = cadastroAntes.length;
          const textosAntes = new Set(cadastroAntes.map((m) => m.nome));

          if (branch === 'vazio') {
            const task = await criarTaskComAcordoPendente();

            const acordoAvaliado = await service.avaliarAcordoAtual(task.id, 'nao_cumprido', {
              motivoNome: nomeVazio,
            });

            // nenhum motivo associado (Requirement 3.6)
            expect(acordoAvaliado.motivoNaoCumprimentoId).toBeFalsy();

            const acordoPersistido = await acordoRepository.findById(acordoAvaliado.id);
            expect(acordoPersistido!.motivoNaoCumprimentoId).toBeFalsy();

            // cadastro inalterado: mesma quantidade e mesmos textos
            const cadastroDepois = await motivoNaoCumprimentoRepository.list();
            expect(cadastroDepois).toHaveLength(quantidadeAntes);
            expect(new Set(cadastroDepois.map((m) => m.nome))).toEqual(textosAntes);
          } else if (branch === 'novo') {
            // nome novo: nunca coincide com nenhum valor já cadastrado
            fc.pre(!cadastroInicialUnico.some((v) => v.toLowerCase() === nomeNovo.trim().toLowerCase()));
            const nomeCompleto = `${espacosAntes}${nomeNovo}${espacosDepois}`;

            const task = await criarTaskComAcordoPendente();

            const acordoAvaliado = await service.avaliarAcordoAtual(task.id, 'nao_cumprido', {
              motivoNome: nomeCompleto,
            });

            // exatamente 1 novo valor criado, com o texto pós-trim (Requirement 3.4)
            const cadastroDepois = await motivoNaoCumprimentoRepository.list();
            expect(cadastroDepois).toHaveLength(quantidadeAntes + 1);

            const novoValor = cadastroDepois.find((m) => !textosAntes.has(m.nome));
            expect(novoValor).toBeDefined();
            expect(novoValor!.nome).toBe(nomeNovo.trim());

            // o id recém-criado é associado ao Acordo_Atual
            expect(acordoAvaliado.motivoNaoCumprimentoId).toBe(novoValor!.id);
            const acordoPersistido = await acordoRepository.findById(acordoAvaliado.id);
            expect(acordoPersistido!.motivoNaoCumprimentoId).toBe(novoValor!.id);
          } else if (branch === 'existente') {
            // garante que a palavra acentuada já está cadastrada — adicionada
            // canonicamente ao cadastro inicial quando ainda não presente
            // (case-insensitively), ou reaproveitada quando já estiver.
            const jaCadastradoCanonico = cadastroInicialUnico.find(
              (v) => v.toLowerCase() === palavraAcentuada.toLowerCase(),
            );
            const cadastroInicialComExistente = jaCadastradoCanonico
              ? cadastroInicialUnico
              : [...cadastroInicialUnico, palavraAcentuada];
            const motivoRepositoryComExistente = new InMemoryMotivoRepository(cadastroInicialComExistente);
            const motivoExistente = await motivoRepositoryComExistente.findByNomeCaseInsensitive(
              palavraAcentuada,
            );
            expect(motivoExistente).not.toBeNull();

            const svcComExistente = construirAcordoServicoDeTeste(
              taskRepository as unknown as TaskRepository,
              acordoRepository as unknown as AcordoRepository,
              tipoAcordoRepository,
              usuarioCadastradoRepository,
              undefined,
              motivoRepositoryComExistente,
            );

            const task = await criarTaskNova(taskRepository, titulo);
            await svcComExistente.registrarAcordo(task.id, tipoAcordoId);

            const quantidadeAntesExistente = (await motivoRepositoryComExistente.list()).length;
            const textosAntesExistente = new Set(
              (await motivoRepositoryComExistente.list()).map((m) => m.nome),
            );

            // variante com caixa mista sobre o texto canônico já cadastrado
            // (mesmos caracteres, inclusive acentuados), com espaços à volta
            // (Requirement 3.5)
            const nomeComCasingMisto = aplicarCasing(motivoExistente!.nome, casingBits1);
            const nomeComEspacos = `${espacosAntes}${nomeComCasingMisto}${espacosDepois}`;

            const acordoAvaliado = await svcComExistente.avaliarAcordoAtual(task.id, 'nao_cumprido', {
              motivoNome: nomeComEspacos,
            });

            // usa o id já cadastrado; nenhum novo valor é criado
            expect(acordoAvaliado.motivoNaoCumprimentoId).toBe(motivoExistente!.id);

            const cadastroDepois = await motivoRepositoryComExistente.list();
            expect(cadastroDepois).toHaveLength(quantidadeAntesExistente);
            expect(new Set(cadastroDepois.map((m) => m.nome))).toEqual(textosAntesExistente);
          } else {
            // idempotência: a mesma resolução (nome novo) confirmada para duas
            // Tasks distintas com o mesmo cadastro inicial nunca cria um
            // segundo valor duplicado — a segunda confirmação reutiliza o id
            // criado pela primeira (Requirement 10.7).
            fc.pre(!cadastroInicialUnico.some((v) => v.toLowerCase() === nomeNovo.trim().toLowerCase()));
            const nomeCompleto = `${espacosAntes}${nomeNovo}${espacosDepois}`;

            const primeiraTask = await criarTaskComAcordoPendente();
            const primeiraAvaliacao = await service.avaliarAcordoAtual(primeiraTask.id, 'nao_cumprido', {
              motivoNome: nomeCompleto,
            });

            const cadastroAposPrimeira = await motivoNaoCumprimentoRepository.list();
            expect(cadastroAposPrimeira).toHaveLength(quantidadeAntes + 1);

            // segunda confirmação: nova Task, mesmo nome com caixa/espaços
            // possivelmente diferentes, mas equivalente sem diferenciar
            // maiúsculas de minúsculas
            const nomeComCasingDiferente = aplicarCasing(nomeNovo.trim(), casingBits2);
            const nomeSegundaConfirmacao = `${espacosDepois}${nomeComCasingDiferente}${espacosAntes}`;

            const segundaTask = await criarTaskComAcordoPendente();
            const segundaAvaliacao = await service.avaliarAcordoAtual(segundaTask.id, 'nao_cumprido', {
              motivoNome: nomeSegundaConfirmacao,
            });

            // nenhum valor novo é criado na segunda confirmação: mesma
            // quantidade de valores no cadastro, e o mesmo id é reutilizado
            const cadastroAposSegunda = await motivoNaoCumprimentoRepository.list();
            expect(cadastroAposSegunda).toHaveLength(quantidadeAntes + 1);
            expect(segundaAvaliacao.motivoNaoCumprimentoId).toBe(primeiraAvaliacao.motivoNaoCumprimentoId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 7: Nome de motivo acima do limite é rejeitado sem efeito
  // Validates: Requirements 3.8
  //
  // Exercises `avaliarAcordoAtual(taskId, 'nao_cumprido', { motivoNome })`
  // — the same entrypoint used by Property 6 — with names whose trim()
  // exceeds the 100-character limit (Requirement 3.8's counterpart to
  // Property 6's 1-100 character 'novo' branch). `resolverMotivo` checks
  // the length **before** doing any cadastro lookup/creation and before
  // `avaliarAcordoAtual` performs any write, so the rejection must leave
  // everything untouched: the Cadastro_de_Motivos_de_Nao_Cumprimento (no
  // inline creation attempted), the Acordo_Atual's `estadoCumprimento`
  // (still `pendente`, not `nao_cumprido`), and the Task's `numTentativas`
  // (not incremented, since the increment happens only after
  // `resolverMotivo` succeeds).
  //
  // The generator covers lengths from 101 to ~150 characters (varying how
  // far past the boundary the name goes) and optionally adds surrounding
  // whitespace that is trimmed away but still leaves the trimmed text
  // above 100 characters, mirroring how Property 6 builds names around
  // the 1/100 boundaries.
  it('Feature: melhorias-acordos, Property 7: Nome de motivo acima do limite é rejeitado sem efeito', async () => {
    /** A non-whitespace character, safe for building names whose length survives trim(). */
    const charNaoEspacoArb = fc.char().filter((c) => c.trim().length > 0);

    /** A name whose trim() has between 101 and 150 characters (strictly above the limit). */
    const nomeAcimaDoLimiteArb = fc
      .array(charNaoEspacoArb, { minLength: 101, maxLength: 150 })
      .map((chars) => chars.join(''));

    /** Optional leading/trailing whitespace, trimmed away but not affecting the >100 trimmed length. */
    const espacosOpcionaisArb = fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { maxLength: 5 });

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.uuid(),
        // cadastro inicial: 0 a 4 valores distintos já cadastrados.
        fc
          .array(
            fc.array(charNaoEspacoArb, { minLength: 1, maxLength: 20 }).map((chars) => chars.join('')),
            { minLength: 0, maxLength: 4 },
          )
          .map((valores) => {
            const unicos: string[] = [];
            for (const valor of valores) {
              if (!unicos.some((v) => v.toLowerCase() === valor.toLowerCase())) {
                unicos.push(valor);
              }
            }
            return unicos;
          }),
        nomeAcimaDoLimiteArb,
        espacosOpcionaisArb,
        espacosOpcionaisArb,
        async (titulo, tipoAcordoId, cadastroInicial, nomeAcimaDoLimite, espacosAntes, espacosDepois) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const tipoAcordoRepository = new InMemoryCadastroLookup([tipoAcordoId]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();
          const motivoNaoCumprimentoRepository = new InMemoryMotivoRepository(cadastroInicial);

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
            undefined,
            motivoNaoCumprimentoRepository,
          );

          const task = await criarTaskNova(taskRepository, titulo);
          const acordoRegistrado = await service.registrarAcordo(task.id, tipoAcordoId);
          expect(acordoRegistrado.estadoCumprimento).toBe('pendente');

          const cadastroAntes = await motivoNaoCumprimentoRepository.list();
          const quantidadeAntes = cadastroAntes.length;
          const textosAntes = new Set(cadastroAntes.map((m) => m.nome));
          const taskAntes = await taskRepository.findById(task.id);
          const numTentativasAntes = taskAntes!.numTentativas;

          const nomeCompleto = `${espacosAntes}${nomeAcimaDoLimite}${espacosDepois}`;

          let erroCapturado: unknown;
          try {
            await service.avaliarAcordoAtual(task.id, 'nao_cumprido', { motivoNome: nomeCompleto });
          } catch (erro) {
            erroCapturado = erro;
          }

          expect(erroCapturado).toBeInstanceOf(ValidationError);
          expect((erroCapturado as ValidationError).codigo).toBe('VALOR_EXCEDE_LIMITE');

          // o Acordo_Atual permanece pendente (a avaliação foi rejeitada)
          const acordoDepois = await acordoRepository.findById(acordoRegistrado.id);
          expect(acordoDepois!.estadoCumprimento).toBe('pendente');
          expect(acordoDepois!.motivoNaoCumprimentoId).toBeFalsy();

          // Nº_Tentativas da Task permanece inalterado (o incremento só
          // acontece após a avaliação ser aceita)
          const taskDepois = await taskRepository.findById(task.id);
          expect(taskDepois!.numTentativas).toBe(numTentativasAntes);

          // o Cadastro_de_Motivos_de_Nao_Cumprimento permanece inalterado
          // em quantidade e em conteúdo: nenhuma criação inline é tentada
          const cadastroDepois = await motivoNaoCumprimentoRepository.list();
          expect(cadastroDepois).toHaveLength(quantidadeAntes);
          expect(new Set(cadastroDepois.map((m) => m.nome))).toEqual(textosAntes);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 9: Não cumprimento é bloqueado para "Avaliar e planejar"
  // Validates: Requirements 5.2, 5.5
  //
  // Exercises `avaliarAcordoAtual(taskId, 'nao_cumprido', motivo)` against a
  // Task whose Acordo_Atual's Tipo_de_Acordo `nome` is exactly "Avaliar e
  // planejar" (task 3.1's block). `motivo` varies across every shape the
  // Combobox_de_Motivo can produce — including a `motivoNome` genuinely
  // intended for inline creation — to prove the block is checked **before**
  // `resolverMotivo` runs (Requirement 5.5): no motivo is ever created
  // inline for a rejected operation, regardless of what was informed.
  // - 'ausente'/'nulo': no motivo informed at all.
  // - 'idValido': a `motivoId` that already belongs to the
  //   Cadastro_de_Motivos_de_Nao_Cumprimento.
  // - 'idInvalido': a `motivoId` that does not belong to the cadastro (the
  //   block must take precedence over the "motivo inválido" validation).
  // - 'nomeNovo': a `motivoNome`, 1-100 characters, that does not match
  //   (case-insensitively) any value already cadastrado — the exact shape
  //   that would otherwise trigger inline creation (Requirement 3.4).
  // - 'idStringCompat': a plain string (treated as a `motivoId` for
  //   compatibility with existing callers, see `avaliarAcordoAtual`).
  //
  // Takes a full snapshot of the Task (`findById`), the Acordo history
  // (`findHistoryByTaskId`) and the Cadastro_de_Motivos_de_Nao_Cumprimento
  // (`list()`) before and after the rejected call and asserts they are
  // deep-equal, proving zero side effects — including that no inline
  // motivo was created even when a new name was supplied.
  it('Feature: melhorias-acordos, Property 9: Não cumprimento é bloqueado para "Avaliar e planejar"', async () => {
    /** A non-whitespace character, safe for building names whose length survives trim(). */
    const charNaoEspacoArb = fc.char().filter((c) => c.trim().length > 0);

    /** A motivoNome, 1-100 characters after trim, intended for inline creation. */
    const nomeNovoArb = fc.array(charNaoEspacoArb, { minLength: 1, maxLength: 100 }).map((chars) => chars.join(''));

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.uuid(),
        fc.uuid(),
        fc.constantFrom<'ausente' | 'nulo' | 'idValido' | 'idInvalido' | 'nomeNovo' | 'idStringCompat'>(
          'ausente',
          'nulo',
          'idValido',
          'idInvalido',
          'nomeNovo',
          'idStringCompat',
        ),
        nomeNovoArb,
        async (titulo, tipoAcordoId, motivoIdInvalido, branch, nomeNovo) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          // Acordo_Atual da Task é exatamente "Avaliar e planejar" (task 3.1's block).
          const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
            { id: tipoAcordoId, nome: 'Avaliar e planejar' },
          ]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();
          // Cadastro com exatamente 1 valor pré-existente, usado pelo branch
          // 'idValido' e como referência de não-colisão para 'nomeNovo'.
          const motivoNaoCumprimentoRepository = new InMemoryMotivoRepository(['Motivo já cadastrado']);
          const motivoExistente = (await motivoNaoCumprimentoRepository.list())[0]!;

          // 'nomeNovo' deve realmente ser novo: nunca coincidir, sem diferenciar
          // maiúsculas de minúsculas, com o valor já cadastrado.
          fc.pre(nomeNovo.trim().toLowerCase() !== motivoExistente.nome.toLowerCase());
          // motivoIdInvalido nunca deve coincidir com o id já cadastrado.
          fc.pre(motivoIdInvalido !== motivoExistente.id);

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
            undefined,
            motivoNaoCumprimentoRepository,
          );

          // Task_Com_Acordo com Acordo_Atual pendente, de Tipo_de_Acordo
          // "Avaliar e planejar".
          const taskNova = await criarTaskNova(taskRepository, titulo);
          const acordoAtual = await service.registrarAcordo(taskNova.id, tipoAcordoId);
          expect(acordoAtual.estadoCumprimento).toBe('pendente');

          let motivo: string | { motivoId?: string | null; motivoNome?: string | null } | null | undefined;
          switch (branch) {
            case 'ausente':
              motivo = undefined;
              break;
            case 'nulo':
              motivo = null;
              break;
            case 'idValido':
              motivo = { motivoId: motivoExistente.id };
              break;
            case 'idInvalido':
              motivo = { motivoId: motivoIdInvalido };
              break;
            case 'nomeNovo':
              motivo = { motivoNome: nomeNovo };
              break;
            case 'idStringCompat':
              motivo = motivoExistente.id;
              break;
          }

          // Snapshot completo antes da chamada rejeitada.
          const taskAntes = await taskRepository.findById(taskNova.id);
          const historicoAntes = await acordoRepository.findHistoryByTaskId(taskNova.id);
          const cadastroAntes = await motivoNaoCumprimentoRepository.list();

          let erroCapturado: unknown;
          try {
            await service.avaliarAcordoAtual(taskNova.id, 'nao_cumprido', motivo);
          } catch (erro) {
            erroCapturado = erro;
          }

          expect(erroCapturado).toBeInstanceOf(ConflictError);
          expect((erroCapturado as ConflictError).codigo).toBe(
            'ACORDO_AVALIAR_PLANEJAR_NAO_CUMPRIMENTO_BLOQUEADO',
          );

          // Snapshot completo depois: Task, histórico de Acordos e cadastro de
          // motivos permanecem exatamente iguais — inclusive quando o motivo
          // informado era um nome novo destinado a criação inline.
          const taskDepois = await taskRepository.findById(taskNova.id);
          const historicoDepois = await acordoRepository.findHistoryByTaskId(taskNova.id);
          const cadastroDepois = await motivoNaoCumprimentoRepository.list();

          expect(taskDepois).toEqual(taskAntes);
          expect(historicoDepois).toEqual(historicoAntes);
          expect(cadastroDepois).toEqual(cadastroAntes);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('AcordoService.marcarNaoCumprido', () => {
  // Property 10: Operações que exigem Acordo_Atual pendente são rejeitadas sem efeito
  // Validates: Requirements 3.11, 4.9
  //
  // `marcarNaoCumprido` (task 3.2) is the only operation that requires the
  // Task's Acordo_Atual to be specifically `pendente` — rejecting when
  // there is no Acordo_Atual at all (`ConflictError SEM_ACORDO_ATUAL`,
  // Task_Nova) *and* when there is one but it has already been evaluated
  // (`ConflictError ACORDO_ATUAL_JA_AVALIADO`, Requirement 3.11),
  // regardless of the evaluated outcome (cumprido or não cumprido).
  //
  // The generator covers every possible starting state for a Task
  // regarding this specific requirement:
  // - 'semAcordo': a Task_Nova, with no Acordo_Atual at all.
  // - 'pendente': a Task_Com_Acordo whose Acordo_Atual is `pendente` — the
  //   contrasting positive case, asserted within the same property to
  //   prove the rejection is specific to a non-`pendente` state, not to
  //   `marcarNaoCumprido` itself.
  // - 'cumprido' / 'nao_cumprido': a Task_Com_Acordo whose Acordo_Atual has
  //   already been evaluated with that exact outcome.
  //
  // Uses a Tipo_de_Acordo whose `nome` is NOT "Avaliar e planejar", so this
  // property isolates the `pendente`-requirement rejection from task 3.1/
  // 3.3's separate "Avaliar e planejar" block (Property 9).
  //
  // For every rejection branch ('semAcordo', 'cumprido', 'nao_cumprido'),
  // takes a full snapshot of the Task (`findById`) and the Acordo history
  // (`findHistoryByTaskId`) before and after the rejected call and asserts
  // they are deep-equal, proving zero side effects — nothing is registered
  // or altered.
  it('Feature: melhorias-acordos, Property 10: Operações que exigem Acordo_Atual pendente são rejeitadas sem efeito', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.uuid(),
        fc.constantFrom<'semAcordo' | 'pendente' | 'cumprido' | 'nao_cumprido'>(
          'semAcordo',
          'pendente',
          'cumprido',
          'nao_cumprido',
        ),
        async (titulo, tipoAcordoId, branch) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          // Tipo_de_Acordo diferente de "Avaliar e planejar", para isolar
          // essa propriedade do bloqueio coberto pela Property 9.
          const tipoAcordoRepository = new InMemoryTipoAcordoLookup([{ id: tipoAcordoId, nome: 'Outro tipo' }]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          const taskNova = await criarTaskNova(taskRepository, titulo);

          if (branch === 'semAcordo') {
            expect(taskNova.acordoAtualId).toBeFalsy();

            const taskAntes = await taskRepository.findById(taskNova.id);
            const historicoAntes = await acordoRepository.findHistoryByTaskId(taskNova.id);

            let erroCapturado: unknown;
            try {
              await service.marcarNaoCumprido(taskNova.id);
            } catch (erro) {
              erroCapturado = erro;
            }

            expect(erroCapturado).toBeInstanceOf(ConflictError);
            expect((erroCapturado as ConflictError).codigo).toBe('SEM_ACORDO_ATUAL');

            const taskDepois = await taskRepository.findById(taskNova.id);
            const historicoDepois = await acordoRepository.findHistoryByTaskId(taskNova.id);
            expect(taskDepois).toEqual(taskAntes);
            expect(historicoDepois).toEqual(historicoAntes);
            return;
          }

          // Task_Com_Acordo: registra o primeiro Acordo (fica `pendente`) e,
          // fora dos branches 'pendente', avalia-o com o desfecho do branch.
          const acordoAtual = await service.registrarAcordo(taskNova.id, tipoAcordoId);
          expect(acordoAtual.estadoCumprimento).toBe('pendente');

          if (branch !== 'pendente') {
            await acordoRepository.update(acordoAtual.id, { estadoCumprimento: branch });
          }

          if (branch === 'pendente') {
            // Caso contrastante positivo: com o Acordo_Atual `pendente`, a
            // operação é aceita normalmente.
            const numTentativasAntes = (await taskRepository.findById(taskNova.id))!.numTentativas;

            const acordoAvaliado = await service.marcarNaoCumprido(taskNova.id);

            expect(acordoAvaliado.id).toBe(acordoAtual.id);
            expect(acordoAvaliado.estadoCumprimento).toBe('nao_cumprido');

            const taskDepois = await taskRepository.findById(taskNova.id);
            expect(taskDepois!.acordoAtualId).toBe(acordoAtual.id);
            expect(taskDepois!.numTentativas).toBe(numTentativasAntes + 1);
            return;
          }

          // 'cumprido' / 'nao_cumprido': o Acordo_Atual já foi avaliado —
          // marcarNaoCumprido deve rejeitar sem qualquer efeito.
          const taskAntes = await taskRepository.findById(taskNova.id);
          const historicoAntes = await acordoRepository.findHistoryByTaskId(taskNova.id);

          let erroCapturado: unknown;
          try {
            await service.marcarNaoCumprido(taskNova.id);
          } catch (erro) {
            erroCapturado = erro;
          }

          expect(erroCapturado).toBeInstanceOf(ConflictError);
          expect((erroCapturado as ConflictError).codigo).toBe('ACORDO_ATUAL_JA_AVALIADO');

          const taskDepois = await taskRepository.findById(taskNova.id);
          const historicoDepois = await acordoRepository.findHistoryByTaskId(taskNova.id);
          expect(taskDepois).toEqual(taskAntes);
          expect(historicoDepois).toEqual(historicoAntes);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property 8: Contadores são monotônicos e mutuamente exclusivos
// Validates: Requirements 1.3, 4.6, 5.3
//
// `numTentativas` e `tentativasAvaliarPlanejar` são dois contadores
// independentes da Task, cada um avançado por uma etapa distinta de uma
// mesma sequência "avaliar Acordo_Atual -> registrar próximo Acordo":
// - a etapa de avaliação (`avaliarAcordoAtual`) incrementa `numTentativas`
//   em exatamente 1 quando o resultado é `nao_cumprido` (Requirement
//   4.6/5.3) e nunca toca `tentativasAvaliarPlanejar`;
// - a etapa de registro (`registrarAcordo`) subsequente incrementa
//   `tentativasAvaliarPlanejar` em exatamente 1 quando o Acordo_Atual
//   substituído era "Avaliar e planejar" avaliado como cumprido e o novo
//   Acordo também é "Avaliar e planejar" (reiniciando a 0 quando essa
//   cadeia se rompe — ver o describe "cadeia de Avaliar e planejar
//   consecutivos" acima) e nunca toca `numTentativas`.
//
// Este teste generaliza esse comportamento como duas propriedades sobre
// uma sequência arbitrária de ciclos: (1) monotonicidade — nenhum dos dois
// contadores decresce a cada etapa, exceto o reinício documentado de
// `tentativasAvaliarPlanejar` quando a cadeia se rompe — e (2)
// exclusividade mútua — cada etapa (avaliação ou registro) afeta no
// máximo um dos dois contadores, nunca ambos. `numTentativas` é semeado
// tanto em 0 quanto em 9999 diretamente via `taskRepository.update`,
// verificando que o contador continua incrementando corretamente nos dois
// extremos documentados (Requirement 1.2), sem qualquer overflow/
// wraparound.
describe('AcordoService — contadores (Property 8)', () => {
  const NOME_AVALIAR_E_PLANEJAR = 'Avaliar e planejar';

  it('Feature: melhorias-acordos, Property 8: Contadores são monotônicos e mutuamente exclusivos', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'avaliarPlanejar' | 'outro'>('avaliarPlanejar', 'outro'),
        fc.constantFrom(0, 9999),
        fc.array(
          fc.record({
            resultadoSeOutro: fc.constantFrom<'cumprido' | 'nao_cumprido'>('cumprido', 'nao_cumprido'),
            proximoTipo: fc.constantFrom<'avaliarPlanejar' | 'outro'>('avaliarPlanejar', 'outro'),
          }),
          { minLength: 1, maxLength: 15 },
        ),
        async (tipoInicial, numTentativasInicial, ciclos) => {
          const idAvaliarPlanejar = randomUUID();
          const idOutroTipo = randomUUID();
          const idPorTag = { avaliarPlanejar: idAvaliarPlanejar, outro: idOutroTipo } as const;

          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
            { id: idAvaliarPlanejar, nome: NOME_AVALIAR_E_PLANEJAR },
            { id: idOutroTipo, nome: 'Enviar para review' },
          ]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          const taskNova = await criarTaskNova(taskRepository, 'Task de teste de contadores');

          // Semeia numTentativas no extremo escolhido (0 ou 9999) diretamente
          // pelo repositório fake, contornando o serviço — exercita os dois
          // extremos documentados sem depender de 9999 avaliações reais.
          await taskRepository.update(taskNova.id, { numTentativas: numTentativasInicial });

          // primeiro Acordo, sem Acordo_Atual anterior — não afeta nenhum dos
          // dois contadores (Task_Nova).
          await service.registrarAcordo(taskNova.id, idPorTag[tipoInicial]);

          let numTentativasEsperado = numTentativasInicial;
          let tentativasAvaliarPlanejarEsperado = 0;
          let tipoAtual: 'avaliarPlanejar' | 'outro' = tipoInicial;

          const taskAposPrimeiroRegistro = await taskRepository.findById(taskNova.id);
          expect(taskAposPrimeiroRegistro!.numTentativas).toBe(numTentativasEsperado);
          expect(taskAposPrimeiroRegistro!.tentativasAvaliarPlanejar).toBe(tentativasAvaliarPlanejarEsperado);

          for (const ciclo of ciclos) {
            // "Avaliar e planejar" só pode ser avaliado como cumprido — o
            // não cumprimento é bloqueado (Property 9); qualquer outro tipo
            // aceita ambos os resultados.
            const resultado: 'cumprido' | 'nao_cumprido' =
              tipoAtual === 'avaliarPlanejar' ? 'cumprido' : ciclo.resultadoSeOutro;

            // --- Etapa de avaliação (avaliarAcordoAtual) ---
            const numTentativasAntesEval = numTentativasEsperado;
            const tentativasAvaliarPlanejarAntesEval = tentativasAvaliarPlanejarEsperado;

            await service.avaliarAcordoAtual(taskNova.id, resultado);

            if (resultado === 'nao_cumprido') {
              numTentativasEsperado += 1;
            }
            // tentativasAvaliarPlanejar nunca é tocado pela avaliação em si.

            const taskAposEval = await taskRepository.findById(taskNova.id);
            expect(taskAposEval!.numTentativas).toBe(numTentativasEsperado);
            expect(taskAposEval!.tentativasAvaliarPlanejar).toBe(tentativasAvaliarPlanejarAntesEval);

            // monotonicidade: nenhum dos dois contadores decresce nesta etapa
            expect(numTentativasEsperado).toBeGreaterThanOrEqual(numTentativasAntesEval);
            expect(taskAposEval!.tentativasAvaliarPlanejar).toBeGreaterThanOrEqual(
              tentativasAvaliarPlanejarAntesEval,
            );

            // exclusividade mútua: esta etapa nunca toca tentativasAvaliarPlanejar,
            // e nunca altera os dois contadores simultaneamente
            const numTentativasMudouEval = numTentativasEsperado !== numTentativasAntesEval;
            const tentativasAvaliarPlanejarMudouEval =
              taskAposEval!.tentativasAvaliarPlanejar !== tentativasAvaliarPlanejarAntesEval;
            expect(tentativasAvaliarPlanejarMudouEval).toBe(false);
            expect(numTentativasMudouEval && tentativasAvaliarPlanejarMudouEval).toBe(false);

            // --- Etapa de registro (registrarAcordo) ---
            const numTentativasAntesRegistro = numTentativasEsperado;
            const tentativasAvaliarPlanejarAntesRegistro = tentativasAvaliarPlanejarEsperado;

            await service.registrarAcordo(taskNova.id, idPorTag[ciclo.proximoTipo]);

            const incrementaCadeia =
              tipoAtual === 'avaliarPlanejar' && resultado === 'cumprido' && ciclo.proximoTipo === 'avaliarPlanejar';
            tentativasAvaliarPlanejarEsperado = incrementaCadeia ? tentativasAvaliarPlanejarEsperado + 1 : 0;

            const taskAposRegistro = await taskRepository.findById(taskNova.id);
            expect(taskAposRegistro!.numTentativas).toBe(numTentativasEsperado);
            expect(taskAposRegistro!.tentativasAvaliarPlanejar).toBe(tentativasAvaliarPlanejarEsperado);

            // monotonicidade: numTentativas nunca decresce; tentativasAvaliarPlanejar
            // só pode decrescer (reinício a 0) exatamente quando a cadeia se rompe
            expect(numTentativasEsperado).toBeGreaterThanOrEqual(numTentativasAntesRegistro);
            if (incrementaCadeia) {
              expect(tentativasAvaliarPlanejarEsperado).toBeGreaterThan(tentativasAvaliarPlanejarAntesRegistro);
            }

            // exclusividade mútua: esta etapa nunca toca numTentativas
            const numTentativasMudouRegistro = taskAposRegistro!.numTentativas !== numTentativasAntesRegistro;
            const tentativasAvaliarPlanejarMudouRegistro =
              tentativasAvaliarPlanejarEsperado !== tentativasAvaliarPlanejarAntesRegistro;
            expect(numTentativasMudouRegistro).toBe(false);
            expect(numTentativasMudouRegistro && tentativasAvaliarPlanejarMudouRegistro).toBe(false);

            tipoAtual = ciclo.proximoTipo;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Unit tests for AcordoService.finalizarTask ("Finalizar" — ação manual):
// composes avaliarAcordoAtual('cumprido') instead of duplicating its
// validation, so these tests focus on the behavior added on top of it:
// marking the Task as concluída unconditionally, regardless of the
// Acordo_Atual's Tipo_de_Acordo, and the error cases already covered by
// avaliarAcordoAtual (Task não encontrada, sem Acordo_Atual).
describe('AcordoService.finalizarTask', () => {
  async function montarCenarioComAcordoAtual(nomeTipoAcordo: string) {
    const taskRepository = new InMemoryTaskRepository();
    const acordoRepository = new InMemoryAcordoRepository();
    const tipoAcordoId = randomUUID();
    const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
      { id: tipoAcordoId, nome: nomeTipoAcordo },
    ]);
    const usuarioCadastradoRepository = new InMemoryCadastroLookup();

    const service = construirAcordoServicoDeTeste(
      taskRepository as unknown as TaskRepository,
      acordoRepository as unknown as AcordoRepository,
      tipoAcordoRepository,
      usuarioCadastradoRepository,
    );

    const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
    const acordoAtual = await service.registrarAcordo(taskNova.id, tipoAcordoId);

    return { service, taskRepository, acordoRepository, taskId: taskNova.id, acordoAtual };
  }

  it('marca o Acordo_Atual como cumprido e a Task como concluída, mesmo quando o Tipo_de_Acordo não é "Finalizar"', async () => {
    const cenario = await montarCenarioComAcordoAtual('Enviar para review');

    const acordoAtualizado = await cenario.service.finalizarTask(cenario.taskId);

    expect(acordoAtualizado.id).toBe(cenario.acordoAtual.id);
    expect(acordoAtualizado.estadoCumprimento).toBe('cumprido');

    const taskDepois = await cenario.taskRepository.findById(cenario.taskId);
    expect(taskDepois!.concluida).toBe(true);

    // Acordo_Atual e histórico permanecem preservados/consultáveis
    expect(taskDepois!.acordoAtualId).toBe(cenario.acordoAtual.id);
    const historico = await cenario.acordoRepository.findHistoryByTaskId(cenario.taskId);
    expect(historico).toHaveLength(1);
  });

  it('marca a Task como concluída também quando o Tipo_de_Acordo do Acordo_Atual é "Finalizar"', async () => {
    const cenario = await montarCenarioComAcordoAtual('Finalizar');

    await cenario.service.finalizarTask(cenario.taskId);

    const taskDepois = await cenario.taskRepository.findById(cenario.taskId);
    expect(taskDepois!.concluida).toBe(true);
  });

  it('rejeita uma Task que não existe com NotFoundError', async () => {
    const taskRepository = new InMemoryTaskRepository();
    const acordoRepository = new InMemoryAcordoRepository();
    const service = construirAcordoServicoDeTeste(
      taskRepository as unknown as TaskRepository,
      acordoRepository as unknown as AcordoRepository,
      new InMemoryCadastroLookup(),
      new InMemoryCadastroLookup(),
    );

    await expect(service.finalizarTask(randomUUID())).rejects.toThrow(NotFoundError);
  });

  it('rejeita uma Task_Nova (sem Acordo_Atual) com ConflictError, preservando concluida = false', async () => {
    const taskRepository = new InMemoryTaskRepository();
    const acordoRepository = new InMemoryAcordoRepository();
    const service = construirAcordoServicoDeTeste(
      taskRepository as unknown as TaskRepository,
      acordoRepository as unknown as AcordoRepository,
      new InMemoryCadastroLookup(),
      new InMemoryCadastroLookup(),
    );

    const taskNova = await criarTaskNova(taskRepository, 'Task_Nova sem acordo');

    await expect(service.finalizarTask(taskNova.id)).rejects.toThrow(ConflictError);

    const taskDepois = await taskRepository.findById(taskNova.id);
    expect(taskDepois!.concluida).toBe(false);
  });
});

// Unit tests for AcordoService.repetirUltimoAcordo ("Repetir último
// acordo"): composes avaliarAcordoAtual + registrarAcordo instead of
// duplicating their logic, so these tests focus on the two branching
// behaviors (Tipo_de_Acordo == "Avaliar e planejar" vs. any other) and on
// the error cases already covered individually by those two methods.
describe('AcordoService.repetirUltimoAcordo', () => {
  const NOME_TIPO_ACORDO_AVALIAR_E_PLANEJAR = 'Avaliar e planejar';

  it('quando o Acordo_Atual é "Avaliar e planejar": marca cumprido e registra um novo Acordo "Avaliar e planejar", mantendo o Responsável', async () => {
    const taskRepository = new InMemoryTaskRepository();
    const acordoRepository = new InMemoryAcordoRepository();
    const tipoAcordoId = randomUUID();
    const responsavelId = randomUUID();
    const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
      { id: tipoAcordoId, nome: NOME_TIPO_ACORDO_AVALIAR_E_PLANEJAR },
    ]);
    const usuarioCadastradoRepository = new InMemoryCadastroLookup([responsavelId]);

    const service = construirAcordoServicoDeTeste(
      taskRepository as unknown as TaskRepository,
      acordoRepository as unknown as AcordoRepository,
      tipoAcordoRepository,
      usuarioCadastradoRepository,
    );

    const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
    const acordoAtual = await service.registrarAcordo(taskNova.id, tipoAcordoId, responsavelId);

    const novoAcordo = await service.repetirUltimoAcordo(taskNova.id);

    // o Acordo anterior foi marcado como cumprido, mas permanece no histórico
    const acordoAnteriorAtualizado = await acordoRepository.findById(acordoAtual.id);
    expect(acordoAnteriorAtualizado!.estadoCumprimento).toBe('cumprido');

    // um novo Acordo do mesmo tipo ("Avaliar e planejar") foi registrado e
    // passou a ser o Acordo_Atual
    expect(novoAcordo.tipoAcordoId).toBe(tipoAcordoId);
    expect(novoAcordo.estadoCumprimento).toBe('pendente');
    expect(novoAcordo.id).not.toBe(acordoAtual.id);

    const taskDepois = await taskRepository.findById(taskNova.id);
    expect(taskDepois!.acordoAtualId).toBe(novoAcordo.id);

    // o Responsável permanece o mesmo
    expect(taskDepois!.responsavelId).toBe(responsavelId);
  });

  it('quando o Acordo_Atual não é "Avaliar e planejar": marca não cumprido e registra um novo Acordo do mesmo tipo, mantendo o Responsável', async () => {
    const taskRepository = new InMemoryTaskRepository();
    const acordoRepository = new InMemoryAcordoRepository();
    const tipoAcordoId = randomUUID();
    const responsavelId = randomUUID();
    const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
      { id: tipoAcordoId, nome: 'Enviar para review' },
    ]);
    const usuarioCadastradoRepository = new InMemoryCadastroLookup([responsavelId]);

    const service = construirAcordoServicoDeTeste(
      taskRepository as unknown as TaskRepository,
      acordoRepository as unknown as AcordoRepository,
      tipoAcordoRepository,
      usuarioCadastradoRepository,
    );

    const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
    const acordoAtual = await service.registrarAcordo(taskNova.id, tipoAcordoId, responsavelId);

    const novoAcordo = await service.repetirUltimoAcordo(taskNova.id);

    // o Acordo anterior foi marcado como não cumprido, mas permanece no histórico
    const acordoAnteriorAtualizado = await acordoRepository.findById(acordoAtual.id);
    expect(acordoAnteriorAtualizado!.estadoCumprimento).toBe('nao_cumprido');

    // Nº_Tentativas da Task foi incrementado, como em qualquer não cumprimento
    const taskDepois = await taskRepository.findById(taskNova.id);
    expect(taskDepois!.numTentativas).toBe(1);

    // um novo Acordo do mesmo Tipo_de_Acordo foi registrado e passou a ser
    // o Acordo_Atual
    expect(novoAcordo.tipoAcordoId).toBe(tipoAcordoId);
    expect(novoAcordo.estadoCumprimento).toBe('pendente');
    expect(novoAcordo.id).not.toBe(acordoAtual.id);
    expect(taskDepois!.acordoAtualId).toBe(novoAcordo.id);

    // o Responsável permanece o mesmo
    expect(taskDepois!.responsavelId).toBe(responsavelId);
  });

  it('mantém a Task sem Responsável quando o Acordo_Atual repetido nunca teve um definido', async () => {
    const taskRepository = new InMemoryTaskRepository();
    const acordoRepository = new InMemoryAcordoRepository();
    const tipoAcordoId = randomUUID();
    const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
      { id: tipoAcordoId, nome: 'Enviar para review' },
    ]);
    const usuarioCadastradoRepository = new InMemoryCadastroLookup();

    const service = construirAcordoServicoDeTeste(
      taskRepository as unknown as TaskRepository,
      acordoRepository as unknown as AcordoRepository,
      tipoAcordoRepository,
      usuarioCadastradoRepository,
    );

    const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
    await service.registrarAcordo(taskNova.id, tipoAcordoId);

    await service.repetirUltimoAcordo(taskNova.id);

    const taskDepois = await taskRepository.findById(taskNova.id);
    expect(taskDepois!.responsavelId).toBeFalsy();
  });

  it('rejeita com NotFoundError quando a Task não existe', async () => {
    const taskRepository = new InMemoryTaskRepository();
    const acordoRepository = new InMemoryAcordoRepository();
    const tipoAcordoRepository = new InMemoryCadastroLookup();
    const usuarioCadastradoRepository = new InMemoryCadastroLookup();

    const service = construirAcordoServicoDeTeste(
      taskRepository as unknown as TaskRepository,
      acordoRepository as unknown as AcordoRepository,
      tipoAcordoRepository,
      usuarioCadastradoRepository,
    );

    await expect(service.repetirUltimoAcordo(randomUUID())).rejects.toThrow(NotFoundError);
  });

  it('rejeita com ConflictError quando a Task não possui Acordo_Atual (Task_Nova)', async () => {
    const taskRepository = new InMemoryTaskRepository();
    const acordoRepository = new InMemoryAcordoRepository();
    const tipoAcordoRepository = new InMemoryCadastroLookup();
    const usuarioCadastradoRepository = new InMemoryCadastroLookup();

    const service = construirAcordoServicoDeTeste(
      taskRepository as unknown as TaskRepository,
      acordoRepository as unknown as AcordoRepository,
      tipoAcordoRepository,
      usuarioCadastradoRepository,
    );

    const taskNova = await criarTaskNova(taskRepository, 'Task de teste');

    await expect(service.repetirUltimoAcordo(taskNova.id)).rejects.toThrow(ConflictError);
  });

  it('quando repetido "Avaliar e planejar" encadeado, incrementa tentativasAvaliarPlanejar (reaproveita a lógica de registrarAcordo)', async () => {
    const taskRepository = new InMemoryTaskRepository();
    const acordoRepository = new InMemoryAcordoRepository();
    const tipoAcordoId = randomUUID();
    const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
      { id: tipoAcordoId, nome: NOME_TIPO_ACORDO_AVALIAR_E_PLANEJAR },
    ]);
    const usuarioCadastradoRepository = new InMemoryCadastroLookup();

    const service = construirAcordoServicoDeTeste(
      taskRepository as unknown as TaskRepository,
      acordoRepository as unknown as AcordoRepository,
      tipoAcordoRepository,
      usuarioCadastradoRepository,
    );

    const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
    await service.registrarAcordo(taskNova.id, tipoAcordoId);

    await service.repetirUltimoAcordo(taskNova.id);
    const taskDepoisPrimeiraRepeticao = await taskRepository.findById(taskNova.id);
    expect(taskDepoisPrimeiraRepeticao!.tentativasAvaliarPlanejar).toBe(1);

    await service.repetirUltimoAcordo(taskNova.id);
    const taskDepoisSegundaRepeticao = await taskRepository.findById(taskNova.id);
    expect(taskDepoisSegundaRepeticao!.tentativasAvaliarPlanejar).toBe(2);
  });

  it('quando repetido um Tipo_de_Acordo diferente de "Avaliar e planejar" várias vezes, incrementa Nº_Tentativas a cada repetição (reaproveita a lógica de avaliarAcordoAtual)', async () => {
    const taskRepository = new InMemoryTaskRepository();
    const acordoRepository = new InMemoryAcordoRepository();
    const tipoAcordoId = randomUUID();
    const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
      { id: tipoAcordoId, nome: 'Enviar para review' },
    ]);
    const usuarioCadastradoRepository = new InMemoryCadastroLookup();

    const service = construirAcordoServicoDeTeste(
      taskRepository as unknown as TaskRepository,
      acordoRepository as unknown as AcordoRepository,
      tipoAcordoRepository,
      usuarioCadastradoRepository,
    );

    const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
    await service.registrarAcordo(taskNova.id, tipoAcordoId);

    await service.repetirUltimoAcordo(taskNova.id);
    const taskDepoisPrimeiraRepeticao = await taskRepository.findById(taskNova.id);
    expect(taskDepoisPrimeiraRepeticao!.numTentativas).toBe(1);

    await service.repetirUltimoAcordo(taskNova.id);
    const taskDepoisSegundaRepeticao = await taskRepository.findById(taskNova.id);
    expect(taskDepoisSegundaRepeticao!.numTentativas).toBe(2);

    await service.repetirUltimoAcordo(taskNova.id);
    const taskDepoisTerceiraRepeticao = await taskRepository.findById(taskNova.id);
    expect(taskDepoisTerceiraRepeticao!.numTentativas).toBe(3);
  });

  // Task.repeteAcordoNaoCumprido: sinaliza que o Acordo_Atual é uma
  // repetição de um Acordo não cumprido do mesmo Tipo_de_Acordo — usado
  // por ListaDeAcordosService para manter o alerta de não cumprimento
  // (Requirement 3.6) visível já na primeira repetição, já que o
  // Acordo_Atual volta a ficar `pendente` no mesmo instante em que o
  // anterior é marcado não cumprido.
  describe('Task.repeteAcordoNaoCumprido', () => {
    it('marca repeteAcordoNaoCumprido = true já na primeira repetição de um Tipo_de_Acordo diferente de "Avaliar e planejar"', async () => {
      const taskRepository = new InMemoryTaskRepository();
      const acordoRepository = new InMemoryAcordoRepository();
      const tipoAcordoId = randomUUID();
      const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
        { id: tipoAcordoId, nome: 'Enviar para review' },
      ]);
      const usuarioCadastradoRepository = new InMemoryCadastroLookup();

      const service = construirAcordoServicoDeTeste(
        taskRepository as unknown as TaskRepository,
        acordoRepository as unknown as AcordoRepository,
        tipoAcordoRepository,
        usuarioCadastradoRepository,
      );

      const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
      const taskAntesDaRepeticao = await service.registrarAcordo(taskNova.id, tipoAcordoId);
      const taskLogoAposRegistro = await taskRepository.findById(taskNova.id);
      expect(taskLogoAposRegistro!.repeteAcordoNaoCumprido).toBe(false);
      expect(taskAntesDaRepeticao).toBeTruthy();

      await service.repetirUltimoAcordo(taskNova.id);

      const taskDepois = await taskRepository.findById(taskNova.id);
      expect(taskDepois!.repeteAcordoNaoCumprido).toBe(true);
      // o novo Acordo_Atual já está pendente novamente — só a flag denuncia a repetição
      const acordoAtual = await acordoRepository.findById(taskDepois!.acordoAtualId!);
      expect(acordoAtual!.estadoCumprimento).toBe('pendente');
    });

    it('não marca repeteAcordoNaoCumprido quando o Tipo_de_Acordo repetido é "Avaliar e planejar"', async () => {
      const taskRepository = new InMemoryTaskRepository();
      const acordoRepository = new InMemoryAcordoRepository();
      const tipoAcordoId = randomUUID();
      const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
        { id: tipoAcordoId, nome: NOME_TIPO_ACORDO_AVALIAR_E_PLANEJAR },
      ]);
      const usuarioCadastradoRepository = new InMemoryCadastroLookup();

      const service = construirAcordoServicoDeTeste(
        taskRepository as unknown as TaskRepository,
        acordoRepository as unknown as AcordoRepository,
        tipoAcordoRepository,
        usuarioCadastradoRepository,
      );

      const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
      await service.registrarAcordo(taskNova.id, tipoAcordoId);

      await service.repetirUltimoAcordo(taskNova.id);

      const taskDepois = await taskRepository.findById(taskNova.id);
      expect(taskDepois!.repeteAcordoNaoCumprido).toBe(false);
    });

    it('reseta repeteAcordoNaoCumprido quando o Acordo_Atual repetido é finalmente avaliado como cumprido', async () => {
      const taskRepository = new InMemoryTaskRepository();
      const acordoRepository = new InMemoryAcordoRepository();
      const tipoAcordoId = randomUUID();
      const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
        { id: tipoAcordoId, nome: 'Enviar para review' },
      ]);
      const usuarioCadastradoRepository = new InMemoryCadastroLookup();

      const service = construirAcordoServicoDeTeste(
        taskRepository as unknown as TaskRepository,
        acordoRepository as unknown as AcordoRepository,
        tipoAcordoRepository,
        usuarioCadastradoRepository,
      );

      const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
      await service.registrarAcordo(taskNova.id, tipoAcordoId);
      await service.repetirUltimoAcordo(taskNova.id);

      const taskComFlagAtiva = await taskRepository.findById(taskNova.id);
      expect(taskComFlagAtiva!.repeteAcordoNaoCumprido).toBe(true);

      await service.avaliarAcordoAtual(taskNova.id, 'cumprido');

      const taskDepois = await taskRepository.findById(taskNova.id);
      expect(taskDepois!.repeteAcordoNaoCumprido).toBe(false);
    });

    it('reseta repeteAcordoNaoCumprido ao registrar manualmente um novo Acordo (fora do fluxo de repetição)', async () => {
      const taskRepository = new InMemoryTaskRepository();
      const acordoRepository = new InMemoryAcordoRepository();
      const tipoAcordoId = randomUUID();
      const outroTipoAcordoId = randomUUID();
      const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
        { id: tipoAcordoId, nome: 'Enviar para review' },
        { id: outroTipoAcordoId, nome: 'Enviar para deploy' },
      ]);
      const usuarioCadastradoRepository = new InMemoryCadastroLookup();

      const service = construirAcordoServicoDeTeste(
        taskRepository as unknown as TaskRepository,
        acordoRepository as unknown as AcordoRepository,
        tipoAcordoRepository,
        usuarioCadastradoRepository,
      );

      const taskNova = await criarTaskNova(taskRepository, 'Task de teste');
      await service.registrarAcordo(taskNova.id, tipoAcordoId);
      await service.repetirUltimoAcordo(taskNova.id);

      const taskComFlagAtiva = await taskRepository.findById(taskNova.id);
      expect(taskComFlagAtiva!.repeteAcordoNaoCumprido).toBe(true);

      // o Acordo_Atual está pendente (repetido); avalia manualmente e
      // registra um novo Acordo de outro tipo, fora do fluxo de "Repetir
      // último acordo" — isso deve resetar a flag.
      await service.avaliarAcordoAtual(taskNova.id, 'nao_cumprido');
      await service.registrarAcordo(taskNova.id, outroTipoAcordoId);

      const taskDepois = await taskRepository.findById(taskNova.id);
      expect(taskDepois!.repeteAcordoNaoCumprido).toBe(false);
    });
  });
});

// Property 11: Repetição do último Acordo é uma operação única e completa
// Validates: Requirements 4.2, 4.3, 4.5
//
// `repetirUltimoAcordo` compõe `avaliarAcordoAtual` + `registrarAcordo`
// dentro de um único `runTransaction` (task 3.6). Esta propriedade exercita
// as duas ramificações de Tipo_de_Acordo do Acordo_Atual em uma única
// chamada de `repetirUltimoAcordo` e verifica que o resultado é sempre
// completo e consistente — nunca parcial:
//
// - 'outro' (Tipo_de_Acordo diferente de "Avaliar e planejar",
//   Requirement 4.2): o Acordo_Atual é avaliado como `nao_cumprido` (com o
//   motivo resolvido quando informado), Nº_Tentativas incrementa em
//   exatamente 1, e um novo Acordo do mesmo Tipo_de_Acordo é registrado
//   como o novo Acordo_Atual, mantendo o Responsável.
// - 'avaliarPlanejar' (Tipo_de_Acordo "Avaliar e planejar", Requirements
//   4.3 e 4.5): o Acordo_Atual é avaliado como `cumprido` (com o motivo
//   resolvido quando informado — a mesma resolução de motivo se aplica
//   independentemente do resultado, Requirement 4.5), Nº_Tentativas
//   permanece inalterado, e um novo Acordo "Avaliar e planejar" é
//   registrado como o novo Acordo_Atual, mantendo o Responsável. O
//   Nº_Tentativas_Avaliar_Planejar inicial varia incluindo valores abaixo
//   de 2 (onde o Requirement 4.3 dispensa o Modal_de_Motivo no frontend) e
//   a partir de 2 (onde o Requirement 4.4 exige o Modal_de_Motivo no
//   frontend) — o próprio `repetirUltimoAcordo` não decide sobre o Modal
//   (decisão do frontend, Property 12): esta propriedade prova que o
//   backend produz o mesmo resultado atômico e completo em ambos os
//   casos, dado um motivo (ou a ausência dele) já resolvido pelo Usuário.
//
// A ramificação do motivo cobre as formas que o Combobox_de_Motivo pode
// produzir (Requirements 3.3-3.5 reaproveitados por `resolverMotivo`):
// - 'ausente': nenhum motivo informado.
// - 'idExistente': um `motivoId` já cadastrado.
// - 'nomeNovo': um `motivoNome` que não coincide com nenhum valor já
//   cadastrado — dispara criação inline.
// - 'nomeExistente': um `motivoNome` que coincide, sem diferenciar
//   maiúsculas de minúsculas, com um valor já cadastrado — reaproveita o
//   id existente sem duplicar o cadastro.
//
// "Operação única e completa": a chamada única a `repetirUltimoAcordo`
// deve produzir, sempre em conjunto, exatamente 1 novo Acordo no
// histórico (nunca 0 nem mais de 1), o Acordo anterior avaliado com o
// resultado e o motivo esperados, os contadores (`numTentativas` e
// `tentativasAvaliarPlanejar`) each atualizado exatamente como esperado, e
// o Responsável preservado — nunca um subconjunto desses efeitos.
describe('AcordoService.repetirUltimoAcordo — atomicidade e completude (Property 11)', () => {
  const NOME_AVALIAR_E_PLANEJAR = 'Avaliar e planejar';

  it('Feature: melhorias-acordos, Property 11: Repetição do último Acordo é uma operação única e completa', async () => {
    /** A non-whitespace character, safe for building names whose length survives trim(). */
    const charNaoEspacoArb = fc.char().filter((c) => c.trim().length > 0);

    /** A new motivo name (1-100 characters after trim). */
    const nomeNovoArb = fc.array(charNaoEspacoArb, { minLength: 1, maxLength: 100 }).map((chars) => chars.join(''));

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.uuid(),
        fc.constantFrom<'avaliarPlanejar' | 'outro'>('avaliarPlanejar', 'outro'),
        fc.constantFrom(0, 1, 2, 5),
        fc.constantFrom<'ausente' | 'idExistente' | 'nomeNovo' | 'nomeExistente'>(
          'ausente',
          'idExistente',
          'nomeNovo',
          'nomeExistente',
        ),
        nomeNovoArb,
        fc.boolean(),
        fc.uuid(),
        async (
          titulo,
          tipoAcordoId,
          tipoBranch,
          tentativasAvaliarPlanejarInicial,
          motivoBranch,
          nomeNovo,
          comResponsavel,
          responsavelId,
        ) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const nomeTipoAcordo = tipoBranch === 'avaliarPlanejar' ? NOME_AVALIAR_E_PLANEJAR : 'Enviar para review';
          const tipoAcordoRepository = new InMemoryTipoAcordoLookup([{ id: tipoAcordoId, nome: nomeTipoAcordo }]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup(comResponsavel ? [responsavelId] : []);
          // Cadastro com exatamente 1 valor pré-existente, usado pelos
          // branches 'idExistente'/'nomeExistente' e como referência de
          // não-colisão para 'nomeNovo'.
          const motivoNaoCumprimentoRepository = new InMemoryMotivoRepository(['Motivo já cadastrado']);
          const motivoExistente = (await motivoNaoCumprimentoRepository.list())[0]!;

          // 'nomeNovo' deve realmente ser novo: nunca coincidir, sem
          // diferenciar maiúsculas de minúsculas, com o valor já cadastrado.
          fc.pre(nomeNovo.trim().toLowerCase() !== motivoExistente.nome.toLowerCase());

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
            undefined,
            motivoNaoCumprimentoRepository,
          );

          // Task_Com_Acordo com Acordo_Atual pendente do Tipo_de_Acordo
          // escolhido, com Responsável opcional.
          const taskNova = await criarTaskNova(taskRepository, titulo);
          const acordoAtual = await service.registrarAcordo(
            taskNova.id,
            tipoAcordoId,
            comResponsavel ? responsavelId : undefined,
          );
          expect(acordoAtual.estadoCumprimento).toBe('pendente');

          // Semeia Nº_Tentativas_Avaliar_Planejar diretamente pelo
          // repositório fake, contornando o serviço — o valor inicial não
          // deveria influenciar o comportamento do backend (a decisão do
          // Modal_de_Motivo baseada nesse contador é do frontend, Property
          // 12): repete-se, aqui, tanto abaixo quanto a partir de 2.
          if (tipoBranch === 'avaliarPlanejar') {
            await taskRepository.update(taskNova.id, {
              tentativasAvaliarPlanejar: tentativasAvaliarPlanejarInicial,
            });
          }

          let motivo: string | { motivoId?: string | null; motivoNome?: string | null } | null | undefined;
          switch (motivoBranch) {
            case 'ausente':
              motivo = undefined;
              break;
            case 'idExistente':
              motivo = { motivoId: motivoExistente.id };
              break;
            case 'nomeNovo':
              motivo = { motivoNome: nomeNovo };
              break;
            case 'nomeExistente':
              motivo = { motivoNome: motivoExistente.nome.toUpperCase() };
              break;
          }

          const taskAntes = await taskRepository.findById(taskNova.id);
          const historicoAntes = await acordoRepository.findHistoryByTaskId(taskNova.id);
          const cadastroAntes = await motivoNaoCumprimentoRepository.list();
          expect(historicoAntes).toHaveLength(1);

          // Operação única: uma só chamada a `repetirUltimoAcordo`.
          const novoAcordo = await service.repetirUltimoAcordo(taskNova.id, motivo);

          // --- Completude: todos os efeitos esperados ocorreram juntos ---

          // (1) Exatamente 1 novo Acordo foi registrado — nunca 0, nunca 2+.
          const historicoDepois = await acordoRepository.findHistoryByTaskId(taskNova.id);
          expect(historicoDepois).toHaveLength(historicoAntes.length + 1);
          expect(novoAcordo.id).not.toBe(acordoAtual.id);

          // (2) O novo Acordo é do mesmo Tipo_de_Acordo, `pendente`, e passou
          // a ser o Acordo_Atual da Task.
          expect(novoAcordo.tipoAcordoId).toBe(tipoAcordoId);
          expect(novoAcordo.estadoCumprimento).toBe('pendente');
          const taskDepois = await taskRepository.findById(taskNova.id);
          expect(taskDepois!.acordoAtualId).toBe(novoAcordo.id);

          // (3) O Acordo anterior foi avaliado com o resultado esperado.
          const acordoAnteriorAtualizado = await acordoRepository.findById(acordoAtual.id);
          const resultadoEsperado = tipoBranch === 'avaliarPlanejar' ? 'cumprido' : 'nao_cumprido';
          expect(acordoAnteriorAtualizado!.estadoCumprimento).toBe(resultadoEsperado);

          // (4) O motivo resolvido foi associado ao Acordo anterior,
          // independentemente do resultado (Requirement 4.5) — a mesma
          // resolução de `resolverMotivo` (Requirements 3.3-3.5) se aplica.
          if (motivoBranch === 'ausente') {
            expect(acordoAnteriorAtualizado!.motivoNaoCumprimentoId).toBeFalsy();
            const cadastroDepois = await motivoNaoCumprimentoRepository.list();
            expect(cadastroDepois).toHaveLength(cadastroAntes.length);
          } else if (motivoBranch === 'idExistente' || motivoBranch === 'nomeExistente') {
            expect(acordoAnteriorAtualizado!.motivoNaoCumprimentoId).toBe(motivoExistente.id);
            const cadastroDepois = await motivoNaoCumprimentoRepository.list();
            expect(cadastroDepois).toHaveLength(cadastroAntes.length);
          } else {
            const cadastroDepois = await motivoNaoCumprimentoRepository.list();
            expect(cadastroDepois).toHaveLength(cadastroAntes.length + 1);
            const novoValor = cadastroDepois.find((m) => m.id !== motivoExistente.id);
            expect(novoValor).toBeDefined();
            expect(novoValor!.nome).toBe(nomeNovo.trim());
            expect(acordoAnteriorAtualizado!.motivoNaoCumprimentoId).toBe(novoValor!.id);
          }

          // (5) Os contadores refletem exatamente a ramificação exercitada,
          // e nunca ambos ao mesmo tempo (Property 8 generaliza essa
          // exclusividade mútua; aqui verifica-se o caso específico da
          // repetição em uma única chamada).
          if (tipoBranch === 'outro') {
            expect(taskDepois!.numTentativas).toBe(taskAntes!.numTentativas + 1);
            expect(taskDepois!.tentativasAvaliarPlanejar).toBe(taskAntes!.tentativasAvaliarPlanejar);
          } else {
            expect(taskDepois!.numTentativas).toBe(taskAntes!.numTentativas);
            // a cadeia de "Avaliar e planejar" consecutivos incrementa em 1
            // (Acordo_Atual anterior era "Avaliar e planejar" avaliado como
            // cumprido, e o novo Acordo registrado também é "Avaliar e
            // planejar" — ver `registrarAcordo`), independentemente do valor
            // inicial do contador (0, 1, 2 ou 5).
            expect(taskDepois!.tentativasAvaliarPlanejar).toBe(taskAntes!.tentativasAvaliarPlanejar + 1);
          }

          // (6) O Responsável atual da Task é preservado, com ou sem
          // Responsável definido originalmente.
          if (comResponsavel) {
            expect(taskDepois!.responsavelId).toBe(responsavelId);
          } else {
            expect(taskDepois!.responsavelId).toBeFalsy();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property-based test for the Registro_de_Acordo_com_Avaliacao (task 3.8):
// `registrarAcordo` with `confirmaCumprimentoAcordoAtual` embutindo a
// avaliação do Acordo_Atual pendente no mesmo registro do novo Acordo.
//
// Exercises the four mutually exclusive branches that `registrarAcordo`
// distinguishes when deciding whether to apply the
// Registro_de_Acordo_com_Avaliacao, picking which branch to run per
// property iteration via `fc.constantFrom`:
// - 'pendenteConfirmado': o Acordo_Atual está `pendente` e Tipo_de_Acordo
//   diferente de "Finalizar", e a confirmação é enviada -> avalia o
//   Acordo_Atual como cumprido e registra o novo Acordo em uma única
//   operação, mantendo o Nº_Tentativas inalterado (Requirement 8.2).
// - 'pendenteFinalizar': o Acordo_Atual está `pendente` e seu
//   Tipo_de_Acordo é exatamente "Finalizar", e a confirmação é enviada ->
//   avalia o Acordo_Atual como cumprido, marca `Task.concluida = true` e
//   NÃO registra nenhum novo Acordo (Requirement 8.7).
// - 'taskNova': a Task não possui Acordo_Atual (Task_Nova) -> o registro
//   do primeiro Acordo prossegue normalmente, e a presença/ausência da
//   confirmação (randomizada) não tem efeito nenhum (Requirement 8.4).
// - 'jaAvaliado': o Acordo_Atual já foi avaliado (cumprido ou não
//   cumprido, randomizado) antes desta chamada -> o registro do próximo
//   Acordo prossegue normalmente (caminho já existente antes desta
//   tarefa), e a presença/ausência da confirmação (randomizada) não tem
//   efeito nenhum (Requirement 8.4).
describe('AcordoService.registrarAcordo — Registro_de_Acordo_com_Avaliacao (Property 14)', () => {
  const NOME_FINALIZAR = 'Finalizar';
  const NOME_OUTRO_TIPO = 'Enviar para review';

  // Property 14: Registro de Acordo com avaliação embutida
  // Validates: Requirements 8.2, 8.4, 8.7
  it('Feature: melhorias-acordos, Property 14: Registro de Acordo com avaliação embutida', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b),
        fc.constantFrom<'pendenteConfirmado' | 'pendenteFinalizar' | 'taskNova' | 'jaAvaliado'>(
          'pendenteConfirmado',
          'pendenteFinalizar',
          'taskNova',
          'jaAvaliado',
        ),
        fc.boolean(),
        fc.constantFrom<'cumprido' | 'nao_cumprido'>('cumprido', 'nao_cumprido'),
        async (titulo, [tipoAcordoIdVelho, tipoAcordoIdNovo], branch, confirmacaoEnviada, estadoAnterior) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();

          const nomeTipoVelho = branch === 'pendenteFinalizar' ? NOME_FINALIZAR : NOME_OUTRO_TIPO;
          const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
            { id: tipoAcordoIdVelho, nome: nomeTipoVelho },
            { id: tipoAcordoIdNovo, nome: NOME_OUTRO_TIPO },
          ]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          const taskNova = await criarTaskNova(taskRepository, titulo);

          if (branch === 'taskNova') {
            // Task_Nova: sem Acordo_Atual. A confirmação (randomizada) é
            // ignorada quando enviada (Requirement 8.4).
            const options = confirmacaoEnviada ? { confirmaCumprimentoAcordoAtual: true } : undefined;
            const novoAcordo = await service.registrarAcordo(taskNova.id, tipoAcordoIdNovo, undefined, options);

            expect(novoAcordo.tipoAcordoId).toBe(tipoAcordoIdNovo);
            expect(novoAcordo.estadoCumprimento).toBe('pendente');

            const taskDepois = await taskRepository.findById(taskNova.id);
            expect(taskDepois!.acordoAtualId).toBe(novoAcordo.id);
            expect(taskDepois!.numTentativas).toBe(0);

            const historico = await acordoRepository.findHistoryByTaskId(taskNova.id);
            expect(historico).toHaveLength(1);
            return;
          }

          // Demais branches: a Task_Com_Acordo recebe primeiro seu Acordo_Atual
          // (do Tipo_de_Acordo controlado por `nomeTipoVelho`).
          const acordoVelho = await service.registrarAcordo(taskNova.id, tipoAcordoIdVelho);
          expect(acordoVelho.estadoCumprimento).toBe('pendente');

          if (branch === 'jaAvaliado') {
            // O Acordo_Atual já foi avaliado (cumprido ou não cumprido,
            // randomizado) antes da chamada testada.
            await acordoRepository.update(acordoVelho.id, { estadoCumprimento: estadoAnterior });

            const taskAntes = await taskRepository.findById(taskNova.id);

            // a confirmação (randomizada) é ignorada quando enviada
            // (Requirement 8.4): o registro prossegue normalmente de qualquer forma.
            const options = confirmacaoEnviada ? { confirmaCumprimentoAcordoAtual: true } : undefined;
            const novoAcordo = await service.registrarAcordo(taskNova.id, tipoAcordoIdNovo, undefined, options);

            expect(novoAcordo.tipoAcordoId).toBe(tipoAcordoIdNovo);
            expect(novoAcordo.estadoCumprimento).toBe('pendente');

            const taskDepois = await taskRepository.findById(taskNova.id);
            expect(taskDepois!.acordoAtualId).toBe(novoAcordo.id);
            // numTentativas não é afetado pelo registro do próximo Acordo,
            // independentemente da confirmação enviada.
            expect(taskDepois!.numTentativas).toBe(taskAntes!.numTentativas);

            // o Acordo anterior (já avaliado) permanece no histórico, inalterado.
            const acordoVelhoDepois = await acordoRepository.findById(acordoVelho.id);
            expect(acordoVelhoDepois!.estadoCumprimento).toBe(estadoAnterior);

            const historico = await acordoRepository.findHistoryByTaskId(taskNova.id);
            expect(historico).toHaveLength(2);
            return;
          }

          if (branch === 'pendenteConfirmado') {
            // Acordo_Atual `pendente`, Tipo_de_Acordo diferente de "Finalizar",
            // com confirmação enviada -> avalia como cumprido e registra o
            // novo Acordo em uma única operação (Requirement 8.2), sem
            // alterar numTentativas.
            const novoAcordo = await service.registrarAcordo(taskNova.id, tipoAcordoIdNovo, undefined, {
              confirmaCumprimentoAcordoAtual: true,
            });

            // o novo Acordo foi registrado e passou a ser o Acordo_Atual
            expect(novoAcordo.id).not.toBe(acordoVelho.id);
            expect(novoAcordo.tipoAcordoId).toBe(tipoAcordoIdNovo);
            expect(novoAcordo.estadoCumprimento).toBe('pendente');

            const taskDepois = await taskRepository.findById(taskNova.id);
            expect(taskDepois!.acordoAtualId).toBe(novoAcordo.id);
            expect(taskDepois!.concluida).toBe(false);
            // avaliação como cumprido nunca incrementa numTentativas
            expect(taskDepois!.numTentativas).toBe(0);

            // o Acordo_Atual anterior foi avaliado como cumprido e preservado
            // no histórico, substituído (não excluído) pelo novo.
            const acordoVelhoDepois = await acordoRepository.findById(acordoVelho.id);
            expect(acordoVelhoDepois!.estadoCumprimento).toBe('cumprido');

            const historico = await acordoRepository.findHistoryByTaskId(taskNova.id);
            expect(historico).toHaveLength(2);
            expect(historico.map((a) => a.id).sort()).toEqual([acordoVelho.id, novoAcordo.id].sort());
            return;
          }

          // branch === 'pendenteFinalizar': Acordo_Atual `pendente` cujo
          // Tipo_de_Acordo é exatamente "Finalizar", com confirmação enviada
          // -> avalia como cumprido, marca Task.concluida = true e NÃO
          // registra nenhum novo Acordo (Requirement 8.7).
          const acordoRetornado = await service.registrarAcordo(taskNova.id, tipoAcordoIdNovo, undefined, {
            confirmaCumprimentoAcordoAtual: true,
          });

          // o Acordo retornado é o próprio Acordo_Atual avaliado, não um novo Acordo
          expect(acordoRetornado.id).toBe(acordoVelho.id);
          expect(acordoRetornado.estadoCumprimento).toBe('cumprido');

          const taskDepois = await taskRepository.findById(taskNova.id);
          // nenhum novo Acordo substitui o Acordo_Atual: a referência permanece a mesma
          expect(taskDepois!.acordoAtualId).toBe(acordoVelho.id);
          expect(taskDepois!.concluida).toBe(true);
          expect(taskDepois!.numTentativas).toBe(0);

          // nenhum novo Acordo foi persistido para a Task
          const historico = await acordoRepository.findHistoryByTaskId(taskNova.id);
          expect(historico).toHaveLength(1);
          expect(historico[0]!.id).toBe(acordoVelho.id);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property-based test for the confirmation guard added to `registrarAcordo`
// (task 3.8, Requirement 8.11): when the Task's Acordo_Atual is `pendente`
// and the caller submits a registration WITHOUT confirming that this
// Acordo_Atual was cumprido — either by omitting
// `confirmaCumprimentoAcordoAtual` entirely (no `options` argument, or
// `options` present without that field) or by sending it explicitly as
// `false` — the registration must be rejected with `ValidationError
// CONFIRMACAO_CUMPRIMENTO_OBRIGATORIA` and leave every observable piece of
// state untouched: the Acordo_Atual (same id, still `pendente`, same
// motivo), o Nº_Tentativas, o Nº_Tentativas_Avaliar_Planejar, o
// Responsável e o histórico de Acordos da Task — regardless of the other
// option fields sent alongside it (`repeteAcordoNaoCumprido`) or of the
// `responsavelId` argument passed to the rejected call.
describe('AcordoService.registrarAcordo — confirmação de cumprimento obrigatória (Property 15)', () => {
  // Property 15: Confirmação de cumprimento é obrigatória com Acordo_Atual pendente
  // Validates: Requirements 8.11
  it('Feature: melhorias-acordos, Property 15: Confirmação de cumprimento é obrigatória com Acordo_Atual pendente', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b),
        fc.uuid(),
        // Como a confirmação está ausente/negativa é decidido por este
        // gerador; cobre tanto a omissão total do campo (sem `options` ou
        // `options` sem o campo) quanto o envio explícito de `false`.
        fc.constantFrom<'sem_options' | 'options_sem_campo' | 'campo_false'>(
          'sem_options',
          'options_sem_campo',
          'campo_false',
        ),
        // outro campo de `options`, cujo valor não deve ter nenhum efeito
        // sobre a rejeição desta operação.
        fc.boolean(),
        // `responsavelId` passado à chamada rejeitada — arbitrário,
        // inclusive um id que não pertence ao Cadastro_de_Usuários, já que
        // a confirmação é validada antes de qualquer outra verificação.
        fc.option(fc.uuid(), { nil: undefined }),
        async (
          titulo,
          [tipoAcordoIdVelho, tipoAcordoIdNovo],
          responsavelIdInicial,
          confirmMode,
          repeteAcordoNaoCumprido,
          responsavelIdChamada,
        ) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
            { id: tipoAcordoIdVelho, nome: 'Enviar para review' },
            { id: tipoAcordoIdNovo, nome: 'Enviar para review' },
          ]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup([responsavelIdInicial]);

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          const taskNova = await criarTaskNova(taskRepository, titulo);

          // Acordo_Atual pendente, com Responsável inicial definido.
          const acordoVelho = await service.registrarAcordo(taskNova.id, tipoAcordoIdVelho, responsavelIdInicial);
          expect(acordoVelho.estadoCumprimento).toBe('pendente');

          const taskAntes = await taskRepository.findById(taskNova.id);
          const numTentativasAntes = taskAntes!.numTentativas;
          const tentativasAvaliarPlanejarAntes = taskAntes!.tentativasAvaliarPlanejar;
          const responsavelIdAntes = taskAntes!.responsavelId;

          const options =
            confirmMode === 'sem_options'
              ? undefined
              : confirmMode === 'options_sem_campo'
                ? { repeteAcordoNaoCumprido }
                : { confirmaCumprimentoAcordoAtual: false as const, repeteAcordoNaoCumprido };

          let erroCapturado: unknown;
          try {
            await service.registrarAcordo(taskNova.id, tipoAcordoIdNovo, responsavelIdChamada, options);
          } catch (erro) {
            erroCapturado = erro;
          }

          expect(erroCapturado).toBeInstanceOf(ValidationError);
          expect((erroCapturado as ValidationError).codigo).toBe('CONFIRMACAO_CUMPRIMENTO_OBRIGATORIA');

          // o Acordo_Atual permanece exatamente o mesmo, ainda pendente e
          // sem motivo associado.
          const acordoDepois = await acordoRepository.findById(acordoVelho.id);
          expect(acordoDepois!.id).toBe(acordoVelho.id);
          expect(acordoDepois!.estadoCumprimento).toBe('pendente');
          expect(acordoDepois!.motivoNaoCumprimentoId).toBeFalsy();

          // o Nº_Tentativas, o Nº_Tentativas_Avaliar_Planejar e o
          // Responsável da Task permanecem inalterados.
          const taskDepois = await taskRepository.findById(taskNova.id);
          expect(taskDepois!.acordoAtualId).toBe(acordoVelho.id);
          expect(taskDepois!.numTentativas).toBe(numTentativasAntes);
          expect(taskDepois!.tentativasAvaliarPlanejar).toBe(tentativasAvaliarPlanejarAntes);
          expect(taskDepois!.responsavelId).toBe(responsavelIdAntes);

          // nenhum novo Acordo foi persistido para a Task.
          const historico = await acordoRepository.findHistoryByTaskId(taskNova.id);
          expect(historico).toHaveLength(1);
          expect(historico[0]!.id).toBe(acordoVelho.id);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property-based test for the "Avaliar e planejar" consecutive-cycle
// counter (`Task.tentativasAvaliarPlanejar`), exercised end-to-end through
// the *público* caminho real de avaliação usado pelo Sistema (task 3.11,
// Requirements 8.9, 8.10):
// - quando o Acordo_Atual pendente é de Tipo_de_Acordo "Avaliar e
//   planejar", a única avaliação possível é `cumprido`, obtida via
//   `registrarAcordo(..., { confirmaCumprimentoAcordoAtual: true })`
//   (Registro_de_Acordo_com_Avaliacao) — `avaliarAcordoAtual`/
//   `marcarNaoCumprido` bloqueiam `nao_cumprido` para esse Tipo_de_Acordo
//   (Requirement 5.2), então essa combinação nunca é gerada;
// - quando o Acordo_Atual pendente é de qualquer outro Tipo_de_Acordo, a
//   avaliação pode ser `cumprido` (mesmo caminho de confirmação embutida)
//   ou `nao_cumprido` (via `marcarNaoCumprido`, seguido do registro do
//   próximo Acordo sem exigir confirmação, já que o Acordo_Atual anterior
//   já foi avaliado).
//
// O modelo de referência recalcula, a cada ciclo, se a condição de
// incremento (Requirement 8.9) é satisfeita a partir do estado conhecido
// pelo teste — Acordo_Atual anterior "Avaliar e planejar" avaliado como
// cumprido **e** novo Acordo também "Avaliar e planejar" — e reinicia o
// contador a zero em qualquer outra combinação (Requirement 8.10),
// comparando com o valor persistido pelo serviço após cada passo.
describe('AcordoService.registrarAcordo — Property 17: cadeia de ciclos de "Avaliar e planejar"', () => {
  const NOME_AVALIAR_E_PLANEJAR = 'Avaliar e planejar';
  const NOME_OUTRO_TIPO = 'Enviar para review';

  // Property 17: Cadeia de ciclos de "Avaliar e planejar"
  // Validates: Requirements 8.9, 8.10
  it('Feature: melhorias-acordos, Property 17: Cadeia de ciclos de "Avaliar e planejar"', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'avaliarPlanejar' | 'outro'>('avaliarPlanejar', 'outro'),
        fc.array(
          fc.record({
            proximoTipo: fc.constantFrom<'avaliarPlanejar' | 'outro'>('avaliarPlanejar', 'outro'),
            // Só tem efeito quando o Tipo_de_Acordo do Acordo_Atual em curso
            // for diferente de "Avaliar e planejar" — para "Avaliar e
            // planejar" a única avaliação possível é `cumprido`.
            resultadoQuandoOutroTipo: fc.constantFrom<'cumprido' | 'nao_cumprido'>('cumprido', 'nao_cumprido'),
          }),
          { minLength: 1, maxLength: 15 },
        ),
        async (tipoInicial, ciclos) => {
          const idAvaliarPlanejar = randomUUID();
          const idOutroTipo = randomUUID();
          const idPorTag = { avaliarPlanejar: idAvaliarPlanejar, outro: idOutroTipo } as const;

          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
            { id: idAvaliarPlanejar, nome: NOME_AVALIAR_E_PLANEJAR },
            { id: idOutroTipo, nome: NOME_OUTRO_TIPO },
          ]);
          const usuarioCadastradoRepository = new InMemoryCadastroLookup();

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          const taskNova = await criarTaskNova(taskRepository, 'Task de teste');

          // Primeiro Acordo (Task_Nova, sem Acordo_Atual anterior): nunca
          // incrementa o contador.
          await service.registrarAcordo(taskNova.id, idPorTag[tipoInicial]);

          let tipoAtual: 'avaliarPlanejar' | 'outro' = tipoInicial;
          let numTentativasEsperado = 0;
          let contadorEsperado = 0;

          for (const ciclo of ciclos) {
            // "Avaliar e planejar" só pode ser avaliado como cumprido
            // (Requirement 5.2 bloqueia não cumprimento para esse tipo).
            const resultado: 'cumprido' | 'nao_cumprido' =
              tipoAtual === 'avaliarPlanejar' ? 'cumprido' : ciclo.resultadoQuandoOutroTipo;

            const incrementaEsperado =
              tipoAtual === 'avaliarPlanejar' && resultado === 'cumprido' && ciclo.proximoTipo === 'avaliarPlanejar';

            if (resultado === 'cumprido') {
              // Registro_de_Acordo_com_Avaliacao: avalia o Acordo_Atual
              // pendente como cumprido e registra o novo Acordo em uma
              // única operação (Requirements 8.2, 8.9).
              await service.registrarAcordo(taskNova.id, idPorTag[ciclo.proximoTipo], undefined, {
                confirmaCumprimentoAcordoAtual: true,
              });
            } else {
              // Marca o Acordo_Atual pendente (de Tipo_de_Acordo diferente
              // de "Avaliar e planejar") como não cumprido e, em seguida,
              // registra o próximo Acordo — o Acordo_Atual já avaliado não
              // exige confirmação.
              await service.marcarNaoCumprido(taskNova.id);
              await service.registrarAcordo(taskNova.id, idPorTag[ciclo.proximoTipo]);
              numTentativasEsperado += 1;
            }

            contadorEsperado = incrementaEsperado ? contadorEsperado + 1 : 0;

            const task = await taskRepository.findById(taskNova.id);
            // Requirements 8.9, 8.10: o contador incrementa em exatamente 1
            // apenas na combinação descrita, e reinicia a 0 em qualquer
            // outra.
            expect(task!.tentativasAvaliarPlanejar).toBe(contadorEsperado);
            // Sanidade: o não cumprimento nunca afeta este contador, apenas
            // numTentativas (verificado por outras propriedades).
            expect(task!.numTentativas).toBe(numTentativasEsperado);

            tipoAtual = ciclo.proximoTipo;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property-based test for the conditional Responsável update performed by
// `completarRegistro` (task 3.12, Requirements 9.2, 9.3, 9.8, 9.9): the same
// logic is reached both by the plain registration path (Task_Nova, or an
// already-evaluated Acordo_Atual) and by the Registro_de_Acordo_com_Avaliacao
// path (Acordo_Atual `pendente` + `confirmaCumprimentoAcordoAtual: true`),
// so the generator below exercises `estadoInicial` across all four
// possibilities and combines it with every `inputBranch`:
// - 'valido': a Responsável belonging to the Cadastro_de_Usuários is
//   informed -> the Task's Responsável must become exactly that
//   Usuário_Cadastrado (Requirements 9.2, 9.3).
// - 'ausente'/'vazio': no Responsável is informed (parameter omitted, or an
//   empty/whitespace-only string that trims to nothing) -> the Task's
//   current Responsável must be preserved unchanged (Requirement 9.8).
// - 'invalido': a Responsável that does not belong to the
//   Cadastro_de_Usuários is informed -> the whole registration is rejected
//   with `ValidationError`, and the Task's `acordoAtualId` (same reference)
//   and `responsavelId` remain exactly as they were immediately before the
//   call, with no new Acordo appended to the history (Requirement 9.9).
//   For `estadoInicial === 'pendente'` this assertion is scoped to what
//   `completarRegistro` itself guarantees (the Responsável check happens
//   before any Task write): whether the just-evaluated Acordo_Atual's own
//   `estadoCumprimento` survives the rejection end-to-end is an atomicity
//   concern covered separately by Property 13 (task 3.13), which exercises
//   a real transaction/rollback instead of the passthrough test runner.
describe('AcordoService.registrarAcordo — Property 24: atualização condicional do Responsável', () => {
  const NOME_OUTRO_TIPO = 'Enviar para review';

  // Property 24: Atualização condicional do Responsável no registro de Acordo
  // Validates: Requirements 9.2, 9.3, 9.8, 9.9
  it('Feature: melhorias-acordos, Property 24: Atualização condicional do Responsável no registro de Acordo', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b),
        fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b),
        fc.constantFrom<'novo' | 'avaliadoCumprido' | 'avaliadoNaoCumprido' | 'pendente'>(
          'novo',
          'avaliadoCumprido',
          'avaliadoNaoCumprido',
          'pendente',
        ),
        fc.boolean(),
        fc.constantFrom<'valido' | 'ausente' | 'vazio' | 'invalido'>('valido', 'ausente', 'vazio', 'invalido'),
        fc.constantFrom('', '   ', '\t\n'),
        async (
          titulo,
          [tipoAcordoIdInicial, tipoAcordoIdProximo],
          [responsavelIdValido, responsavelIdInvalido],
          estadoInicial,
          taskComecaComResponsavel,
          inputBranch,
          valorVazio,
        ) => {
          const taskRepository = new InMemoryTaskRepository();
          const acordoRepository = new InMemoryAcordoRepository();
          const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
            { id: tipoAcordoIdInicial, nome: NOME_OUTRO_TIPO },
            { id: tipoAcordoIdProximo, nome: NOME_OUTRO_TIPO },
          ]);
          // Cadastro_de_Usuários contém apenas responsavelIdValido;
          // responsavelIdInvalido nunca pertence a ele.
          const usuarioCadastradoRepository = new InMemoryCadastroLookup([responsavelIdValido]);

          const service = construirAcordoServicoDeTeste(
            taskRepository as unknown as TaskRepository,
            acordoRepository as unknown as AcordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
          );

          const taskInicial = await taskRepository.create({
            titulo,
            responsavelId: taskComecaComResponsavel ? responsavelIdValido : undefined,
            ordemExibicao: 0,
          });

          let acordoAtualAnteriorId: string | null = null;
          if (estadoInicial !== 'novo') {
            const acordoInicial = await service.registrarAcordo(taskInicial.id, tipoAcordoIdInicial);
            acordoAtualAnteriorId = acordoInicial.id;

            if (estadoInicial === 'avaliadoCumprido') {
              await acordoRepository.update(acordoInicial.id, { estadoCumprimento: 'cumprido' });
            } else if (estadoInicial === 'avaliadoNaoCumprido') {
              await acordoRepository.update(acordoInicial.id, { estadoCumprimento: 'nao_cumprido' });
            }
            // 'pendente': mantém o Acordo_Atual pendente, sem avaliação —
            // exercitando o Registro_de_Acordo_com_Avaliacao a seguir.
          }

          const taskAntes = await taskRepository.findById(taskInicial.id);
          const historicoAntes = await acordoRepository.findHistoryByTaskId(taskInicial.id);

          // Acordo_Atual pendente exige a confirmação para que o registro
          // do próximo Acordo prossiga (Requirement 8.11); os demais
          // estados iniciais não exigem nem usam esse campo.
          const options = estadoInicial === 'pendente' ? { confirmaCumprimentoAcordoAtual: true as const } : undefined;

          let responsavelIdParaChamada: string | undefined;
          if (inputBranch === 'valido') {
            responsavelIdParaChamada = responsavelIdValido;
          } else if (inputBranch === 'invalido') {
            responsavelIdParaChamada = responsavelIdInvalido;
          } else if (inputBranch === 'vazio') {
            responsavelIdParaChamada = valorVazio;
          } else {
            responsavelIdParaChamada = undefined;
          }

          if (inputBranch === 'invalido') {
            let erroCapturado: unknown;
            try {
              await service.registrarAcordo(taskInicial.id, tipoAcordoIdProximo, responsavelIdParaChamada, options);
            } catch (erro) {
              erroCapturado = erro;
            }

            expect(erroCapturado).toBeInstanceOf(ValidationError);
            expect((erroCapturado as ValidationError).codigo).toBe('RESPONSAVEL_NAO_CADASTRADO');

            const taskDepois = await taskRepository.findById(taskInicial.id);
            // Requirement 9.9: o registro completo é rejeitado, preservando a
            // referência ao Acordo_Atual e o Responsável atual da Task.
            expect(taskDepois!.acordoAtualId).toBe(taskAntes!.acordoAtualId);
            expect(taskDepois!.responsavelId).toBe(taskAntes!.responsavelId);

            // nenhum novo Acordo foi persistido para a Task.
            const historicoDepois = await acordoRepository.findHistoryByTaskId(taskInicial.id);
            expect(historicoDepois.map((a) => a.id).sort()).toEqual(historicoAntes.map((a) => a.id).sort());
            return;
          }

          // Branches 'valido', 'ausente' e 'vazio': o registro prossegue com sucesso.
          const novoAcordo = await service.registrarAcordo(
            taskInicial.id,
            tipoAcordoIdProximo,
            responsavelIdParaChamada,
            options,
          );

          const taskDepois = await taskRepository.findById(taskInicial.id);

          if (inputBranch === 'valido') {
            // Requirements 9.2, 9.3: o Responsável passa a ser exatamente o
            // Usuário_Cadastrado informado, independentemente do Responsável
            // anterior (definido ou não).
            expect(taskDepois!.responsavelId).toBe(responsavelIdValido);
          } else {
            // Requirement 9.8: sem Responsável informado — omitido, `undefined`
            // ou string vazia/apenas espaços após trim —, o Responsável atual
            // da Task é preservado exatamente como estava antes da chamada.
            expect(taskDepois!.responsavelId).toBe(taskAntes!.responsavelId);
          }

          // Em qualquer um desses branches o registro do novo Acordo prossegue
          // normalmente, tanto no caminho simples quanto no
          // Registro_de_Acordo_com_Avaliacao.
          expect(taskDepois!.acordoAtualId).toBe(novoAcordo.id);
          expect(novoAcordo.tipoAcordoId).toBe(tipoAcordoIdProximo);
          expect(novoAcordo.estadoCumprimento).toBe('pendente');

          if (acordoAtualAnteriorId !== null) {
            expect(taskDepois!.acordoAtualId).not.toBe(acordoAtualAnteriorId);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Property 13: Atomicidade — rejeição implica estado inalterado
// Validates: Requirements 3.9, 4.8, 8.5, 10.5
//
// Exercises the two multi-write combined operations `AcordoService` runs
// inside `runTransaction` — `repetirUltimoAcordo` (avaliação + registro,
// task 3.6) and the Registro_de_Acordo_com_Avaliacao branch of
// `registrarAcordo` (avaliação + registro, task 3.8), gated on
// `confirmaCumprimentoAcordoAtual: true` with a `pendente` Acordo_Atual —
// and, for each, a step of that operation that gets rejected:
// - 'tipoAcordoInvalido' (registroComAvaliacao only): the new Acordo's
//   Tipo_de_Acordo does not belong to the Cadastro_de_Tipos_de_Acordo —
//   rejected before the transaction even opens.
// - 'responsavelInvalido' (registroComAvaliacao only): the Responsável
//   informed does not belong to the Cadastro_de_Usuários — rejected
//   inside the transaction, **after** the embedded avaliação (cumprido)
//   has already written to both the Acordo and the Task.
// - 'motivoAcimaDoLimite' (repetir only): the motivoNome informed exceeds
//   the 100-character limit — rejected by `resolverMotivo`, before any
//   write of the operation.
// - 'falhaCreateAcordo' / 'falhaUpdateTask' (both operations): an
//   unconditional failure is injected into the fake repository's
//   `create`/`update`, at the exact call belonging to this operation's
//   *last* write — after every other write of the operation (including
//   the embedded avaliação) has already happened — simulating an
//   infrastructure failure at the very end of the combined operation.
//
// The in-memory fakes used elsewhere in this file have no real
// transactional behaviour (their TransactionRunner is a plain
// passthrough, `(fn) => fn(this)` — see `construirAcordoServicoDeTeste`),
// which is exactly why Property 24's own atomicity assertion is scoped to
// what `completarRegistro` alone guarantees. This test instead builds a
// TransactionRunner that genuinely simulates `prisma.$transaction`'s
// rollback contract (Requirement 10.5): every fake repository is
// snapshotted right before the callback runs, and restored to that
// snapshot when the callback throws — so a failure injected *after*
// earlier writes of the same combined operation actually exercises a
// rollback, instead of merely proving "no write was ever attempted".
//
// For every branch, takes a full snapshot of the Task (`findById`), the
// Acordo history (`findHistoryByTaskId`) and the Cadastro_de_Motivos_de_
// Nao_Cumprimento (`list()`) immediately before the rejected call and
// asserts it is deep-equal to the same snapshot taken right after the
// rejection — proving zero observable side effects, including the
// absence of any value the operation attempted to create inline.
describe('AcordoService — Property 13: Atomicidade (rejeição implica estado inalterado)', () => {
  const NOME_OUTRO_TIPO = 'Enviar para review';

  /**
   * Wraps InMemoryAcordoRepository, injecting an unconditional failure on
   * the Nth call (1-indexed) to `create` or `update` — used to simulate
   * an infrastructure failure at a specific write of a combined
   * operation. `snapshot`/`restore` are inherited unchanged, since they
   * operate on the same underlying in-memory state as the base class.
   */
  class AcordoRepositoryComFalhaInjetada extends InMemoryAcordoRepository {
    private chamadasCreate = 0;
    private chamadasUpdate = 0;
    private readonly falha: { metodo: 'create' | 'update'; naChamada: number } | null;

    constructor(falha: { metodo: 'create' | 'update'; naChamada: number } | null) {
      super();
      this.falha = falha;
    }

    async create(data: AcordoCreateData): Promise<Acordo> {
      this.chamadasCreate += 1;
      if (this.falha?.metodo === 'create' && this.chamadasCreate === this.falha.naChamada) {
        throw new Error('Falha injetada em AcordoRepository.create (task 3.13)');
      }
      return super.create(data);
    }

    async update(id: string, data: AcordoUpdateData): Promise<Acordo> {
      this.chamadasUpdate += 1;
      if (this.falha?.metodo === 'update' && this.chamadasUpdate === this.falha.naChamada) {
        throw new Error('Falha injetada em AcordoRepository.update (task 3.13)');
      }
      return super.update(id, data);
    }
  }

  /** Same idea as AcordoRepositoryComFalhaInjetada, injecting a failure into TaskRepository.update. */
  class TaskRepositoryComFalhaInjetada extends InMemoryTaskRepository {
    private chamadasUpdate = 0;
    private readonly falha: { metodo: 'update'; naChamada: number } | null;

    constructor(falha: { metodo: 'update'; naChamada: number } | null) {
      super();
      this.falha = falha;
    }

    async update(id: string, data: TaskUpdateData): Promise<Task> {
      this.chamadasUpdate += 1;
      if (this.falha?.metodo === 'update' && this.chamadasUpdate === this.falha.naChamada) {
        throw new Error('Falha injetada em TaskRepository.update (task 3.13)');
      }
      return super.update(id, data);
    }
  }

  /**
   * Builds an AcordoService whose TransactionRunner genuinely simulates
   * `prisma.$transaction`'s rollback contract (Requirement 10.5): every
   * fake repository is snapshotted before the callback runs, and
   * restored to that snapshot if the callback throws. Unlike
   * `construirAcordoServicoDeTeste`'s plain passthrough runner (task
   * 1.2), this is required here so that a failure injected *after*
   * earlier writes of the same combined operation actually exercises a
   * rollback, instead of merely proving "no write was attempted".
   */
  function construirServicoComRollback(
    taskRepository: InMemoryTaskRepository,
    acordoRepository: InMemoryAcordoRepository,
    tipoAcordoRepository: InMemoryTipoAcordoLookup,
    usuarioCadastradoRepository: InMemoryCadastroLookup,
    motivoNaoCumprimentoRepository: InMemoryMotivoRepository,
  ): AcordoService {
    let svc: AcordoService;
    const runner: TransactionRunner = async (fn) => {
      const taskSnapshot = taskRepository.snapshot();
      const acordoSnapshot = acordoRepository.snapshot();
      const motivoSnapshot = motivoNaoCumprimentoRepository.snapshot();
      try {
        return await fn(svc);
      } catch (erro) {
        taskRepository.restore(taskSnapshot);
        acordoRepository.restore(acordoSnapshot);
        motivoNaoCumprimentoRepository.restore(motivoSnapshot);
        throw erro;
      }
    };
    svc = new AcordoService(
      taskRepository as unknown as TaskRepository,
      acordoRepository as unknown as AcordoRepository,
      tipoAcordoRepository,
      usuarioCadastradoRepository,
      undefined,
      motivoNaoCumprimentoRepository,
      runner,
    );
    return svc;
  }

  // 'repetir': etapas de AcordoService.repetirUltimoAcordo.
  // 'registroComAvaliacao': etapas do Registro_de_Acordo_com_Avaliacao
  // (registrarAcordo com Acordo_Atual pendente + confirmação).
  const cenarioArb = fc.oneof(
    fc.record({
      operacao: fc.constant<'repetir'>('repetir'),
      branch: fc.constantFrom<'motivoAcimaDoLimite' | 'falhaCreateAcordo' | 'falhaUpdateTask'>(
        'motivoAcimaDoLimite',
        'falhaCreateAcordo',
        'falhaUpdateTask',
      ),
    }),
    fc.record({
      operacao: fc.constant<'registroComAvaliacao'>('registroComAvaliacao'),
      branch: fc.constantFrom<'tipoAcordoInvalido' | 'responsavelInvalido' | 'falhaCreateAcordo' | 'falhaUpdateTask'>(
        'tipoAcordoInvalido',
        'responsavelInvalido',
        'falhaCreateAcordo',
        'falhaUpdateTask',
      ),
    }),
  );

  it('Feature: melhorias-acordos, Property 13: Atomicidade — rejeição implica estado inalterado', async () => {
    /** A non-whitespace character, safe for building names whose length survives trim(). */
    const charNaoEspacoArb = fc.char().filter((c) => c.trim().length > 0);

    /** A motivoNome whose trim() has between 101 and 150 characters (strictly above the limit, Requirement 3.8). */
    const nomeAcimaDoLimiteArb = fc
      .array(charNaoEspacoArb, { minLength: 101, maxLength: 150 })
      .map((chars) => chars.join(''));

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.tuple(fc.uuid(), fc.uuid(), fc.uuid()).filter(([a, b, c]) => a !== b && a !== c && b !== c),
        fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b),
        cenarioArb,
        nomeAcimaDoLimiteArb,
        async (
          titulo,
          [tipoAcordoIdInicial, tipoAcordoIdNovo, tipoAcordoIdInvalido],
          [responsavelIdValido, responsavelIdInvalido],
          cenario,
          nomeMotivoAcimaDoLimite,
        ) => {
          const falhaCreateAcordo = cenario.branch === 'falhaCreateAcordo';
          const falhaUpdateTask = cenario.branch === 'falhaUpdateTask';

          // A 1ª chamada (#1) de cada método é sempre a escrita de setup
          // do primeiro Acordo (abaixo, fora da operação testada); a
          // escrita injetada com falha é sempre a última da própria
          // operação combinada — depois de toda escrita anterior dela
          // (inclusive a avaliação embutida) já ter acontecido.
          const NA_CHAMADA_CREATE_ACORDO_DA_OPERACAO = 2;
          const NA_CHAMADA_UPDATE_TASK_DA_OPERACAO = 3;

          const taskRepository = new TaskRepositoryComFalhaInjetada(
            falhaUpdateTask ? { metodo: 'update', naChamada: NA_CHAMADA_UPDATE_TASK_DA_OPERACAO } : null,
          );
          const acordoRepository = new AcordoRepositoryComFalhaInjetada(
            falhaCreateAcordo ? { metodo: 'create', naChamada: NA_CHAMADA_CREATE_ACORDO_DA_OPERACAO } : null,
          );
          const tipoAcordoRepository = new InMemoryTipoAcordoLookup([
            { id: tipoAcordoIdInicial, nome: NOME_OUTRO_TIPO },
            { id: tipoAcordoIdNovo, nome: NOME_OUTRO_TIPO },
          ]);
          // Cadastro_de_Usuários contém apenas responsavelIdValido; responsavelIdInvalido nunca pertence a ele.
          const usuarioCadastradoRepository = new InMemoryCadastroLookup([responsavelIdValido]);
          const motivoNaoCumprimentoRepository = new InMemoryMotivoRepository(['Motivo já cadastrado']);

          const service = construirServicoComRollback(
            taskRepository,
            acordoRepository,
            tipoAcordoRepository,
            usuarioCadastradoRepository,
            motivoNaoCumprimentoRepository,
          );

          // Setup (fora da operação testada): Task_Com_Acordo com um
          // primeiro Acordo, que permanece `pendente` — suficiente tanto
          // para repetirUltimoAcordo (que aceita Acordo_Atual pendente ou
          // já avaliado) quanto para o Registro_de_Acordo_com_Avaliacao
          // (que exige Acordo_Atual pendente).
          const taskNova = await criarTaskNova(taskRepository, titulo);
          const acordoInicial = await service.registrarAcordo(taskNova.id, tipoAcordoIdInicial);
          expect(acordoInicial.estadoCumprimento).toBe('pendente');

          // Snapshot completo imediatamente antes da chamada rejeitada.
          const taskAntes = await taskRepository.findById(taskNova.id);
          const historicoAntes = await acordoRepository.findHistoryByTaskId(taskNova.id);
          const cadastroMotivosAntes = await motivoNaoCumprimentoRepository.list();

          let erroCapturado: unknown;
          try {
            if (cenario.operacao === 'repetir') {
              const motivo =
                cenario.branch === 'motivoAcimaDoLimite' ? { motivoNome: nomeMotivoAcimaDoLimite } : undefined;
              await service.repetirUltimoAcordo(taskNova.id, motivo);
            } else {
              const tipoAcordoIdParaChamada =
                cenario.branch === 'tipoAcordoInvalido' ? tipoAcordoIdInvalido : tipoAcordoIdNovo;
              const responsavelIdParaChamada =
                cenario.branch === 'responsavelInvalido' ? responsavelIdInvalido : undefined;
              await service.registrarAcordo(taskNova.id, tipoAcordoIdParaChamada, responsavelIdParaChamada, {
                confirmaCumprimentoAcordoAtual: true,
              });
            }
          } catch (erro) {
            erroCapturado = erro;
          }

          expect(erroCapturado).toBeDefined();

          // Snapshot completo depois da rejeição: idêntico ao estado
          // imediatamente anterior à submissão — o mesmo Acordo_Atual com
          // o mesmo estado de cumprimento e o mesmo motivo associado, o
          // mesmo Nº_Tentativas, o mesmo Nº_Tentativas_Avaliar_Planejar, o
          // mesmo Responsável, o mesmo histórico completo de Acordos e o
          // mesmo Cadastro_de_Motivos_de_Nao_Cumprimento — incluindo a
          // ausência de qualquer valor que a operação tenha tentado criar
          // inline.
          const taskDepois = await taskRepository.findById(taskNova.id);
          const historicoDepois = await acordoRepository.findHistoryByTaskId(taskNova.id);
          const cadastroMotivosDepois = await motivoNaoCumprimentoRepository.list();

          expect(taskDepois).toEqual(taskAntes);
          expect(historicoDepois).toEqual(historicoAntes);
          expect(cadastroMotivosDepois).toEqual(cadastroMotivosAntes);
        },
      ),
      { numRuns: 100 },
    );
  });
});
